package app.glimpse.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Updates from GitHub Releases: downloads a new APK, checks it against the release's SHA-256, then hands it to
 * Android's installer (which also checks it's signed with the same key as the installed app).
 * Events ("progress"): { received, total }.
 */
@CapacitorPlugin(name = "GlimpseUpdate")
public class GlimpseUpdatePlugin extends Plugin {
    private final ExecutorService work = Executors.newSingleThreadExecutor();

    /** Whether Android will let Glimpse install updates ("Install unknown apps" for Glimpse). */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(r);
    }

    /** Opens the "Install unknown apps" setting for Glimpse. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Intent i = Build.VERSION.SDK_INT >= 26
            ? new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))
            : new Intent(Settings.ACTION_SECURITY_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** Downloads { url, sha256, version } into the app's cache. Resolves to { path } once the checksum matches. */
    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        final String want = call.getString("sha256", "").trim().toLowerCase();
        final String version = call.getString("version", "update").replaceAll("[^\\w.-]", "_");
        if (url == null || !url.startsWith("https://")) {
            call.reject("No download link.");
            return;
        }
        if (!want.matches("[0-9a-f]{64}")) {
            call.reject("This release has no checksum, so it can't be checked. Download it from GitHub instead.");
            return;
        }
        work.execute(() -> {
            File dir = new File(getContext().getCacheDir(), "updates");
            dir.mkdirs();
            for (File old : dir.listFiles() != null ? dir.listFiles() : new File[0]) old.delete();
            File out = new File(dir, "glimpse-" + version + ".apk");
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000);
                c.setReadTimeout(60000);
                c.setRequestProperty("Accept", "application/octet-stream");
                if (c.getResponseCode() != 200) throw new Exception("GitHub answered " + c.getResponseCode());
                long total = c.getContentLengthLong(), got = 0, tick = 0;
                MessageDigest sha = MessageDigest.getInstance("SHA-256");
                try (InputStream in = c.getInputStream(); OutputStream o = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        o.write(buf, 0, n);
                        sha.update(buf, 0, n);
                        got += n;
                        long now = System.currentTimeMillis();
                        if (now - tick > 250) {
                            tick = now;
                            JSObject p = new JSObject();
                            p.put("received", got);
                            p.put("total", total);
                            notifyListeners("progress", p);
                        }
                    }
                }
                StringBuilder hex = new StringBuilder();
                for (byte b : sha.digest()) hex.append(String.format("%02x", b));
                if (!hex.toString().equals(want)) {
                    out.delete();
                    call.reject("The download didn't match the release's checksum, so it wasn't installed. Try again.");
                    return;
                }
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                call.resolve(r);
            } catch (Exception e) {
                out.delete();
                call.reject("Couldn't download the update: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    /** Opens Android's installer for a downloaded update: { path }. */
    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        File f = path != null ? new File(path) : null;
        File cache = new File(getContext().getCacheDir(), "updates");
        if (f == null || !f.exists() || !cache.equals(f.getParentFile())) {
            call.reject("The downloaded update is missing. Download it again.");
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
