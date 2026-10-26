package app.glimpse.mobile;

import android.content.Context;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Uploads a phone file to the Glimpse server in pieces, the same resumable protocol the website uses
 * (PUT /api/upload/media/session/{id} with X-Offset). Runs in a foreground service, so it carries on when the app is
 * in the background or the screen is locked, and waits out lost connections.
 *
 * Events ("upload"): { uploadId, state: "progress"|"waiting"|"done"|"failed", received, size, mediaId, error }.
 */
@CapacitorPlugin(name = "GlimpseUploads", permissions = { @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }) })
public class GlimpseUploadsPlugin extends Plugin {
    static final Map<String, Job> jobs = new ConcurrentHashMap<>();
    private static final ExecutorService pool = Executors.newFixedThreadPool(2);
    private static GlimpseUploadsPlugin live;

    static class Job {
        String id, server, token, uri, name;
        long size, at, chunk;
        volatile boolean cancelled, waiting;
    }

    /** A number from the call, whatever type JSON gave it (Capacitor's getLong() only accepts Long). */
    static Long num(com.getcapacitor.PluginCall call, String name, Long def) {
        Object v = call.getData().opt(name);
        return v instanceof Number ? Long.valueOf(((Number) v).longValue()) : def;
    }

    @Override
    public void load() {
        live = this;
    }

    /** Start (or re-attach to) an upload: { uploadId, uri, size, offset, chunk, server, token, name }. */
    @PluginMethod
    public void start(PluginCall call) {
        String id = call.getString("uploadId");
        if (id == null || call.getString("uri") == null || call.getString("server") == null) {
            call.reject("Missing upload details");
            return;
        }
        if (!jobs.containsKey(id)) {
            Job j = new Job();
            j.id = id;
            j.uri = call.getString("uri");
            j.server = call.getString("server");
            j.token = call.getString("token");
            j.name = call.getString("name", "clip");
            j.size = num(call, "size", 0L);
            j.at = num(call, "offset", 0L);
            j.chunk = Math.max(256 * 1024, num(call, "chunk", 5L * 1024 * 1024));
            if (j.size <= 0) {
                // Not given: ask the phone how big the file is.
                try (android.content.res.AssetFileDescriptor fd = getContext().getContentResolver().openAssetFileDescriptor(Uri.parse(j.uri), "r")) {
                    if (fd != null) j.size = fd.getLength();
                } catch (Exception e) {
                    call.reject("Glimpse can't open that file.");
                    return;
                }
            }
            jobs.put(id, j);
            UploadService.update(getContext());
            pool.execute(() -> run(getContext().getApplicationContext(), j));
        }
        call.resolve();
    }

    /** Android 13+: asks to show notifications, so upload progress (and reminders) can be seen. */
    @PluginMethod
    public void askNotifications(PluginCall call) {
        if (android.os.Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            notified(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "notified");
    }

    @PermissionCallback
    private void notified(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", android.os.Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Job j = jobs.get(call.getString("uploadId", ""));
        if (j != null) j.cancelled = true;
        call.resolve();
    }

    /** What's running now, for a page that was reloaded: { uploads: [{ uploadId, received, size, waiting }] }. */
    @PluginMethod
    public void running(PluginCall call) {
        com.getcapacitor.JSArray a = new com.getcapacitor.JSArray();
        for (Job j : jobs.values()) {
            JSObject o = new JSObject();
            o.put("uploadId", j.id);
            o.put("received", j.at);
            o.put("size", j.size);
            o.put("waiting", j.waiting);
            a.put(o);
        }
        JSObject r = new JSObject();
        r.put("uploads", a);
        call.resolve(r);
    }

    private static void emit(Job j, String state, JSObject extra) {
        JSObject o = extra != null ? extra : new JSObject();
        o.put("uploadId", j.id);
        o.put("state", state);
        o.put("received", j.at);
        o.put("size", j.size);
        o.put("waiting", j.waiting);
        if (live != null) live.notifyListeners("upload", o, true);
    }

    /** A refusal from the server that retrying won't fix. */
    static class Refused extends IOException {
        final int status;

        Refused(int status, String msg) {
            super(msg);
            this.status = status;
        }
    }

    private static void run(Context ctx, Job j) {
        int fails = 0;
        long lastTick = 0;
        try {
            while (!j.cancelled) {
                try {
                    final long from = j.at, end = Math.min(j.size, j.at + j.chunk);
                    final long[] tick = { lastTick };
                    JSONObject r = put(ctx, j, from, end, (sent) -> {
                        long now = System.currentTimeMillis();
                        if (now - tick[0] > 400) {
                            tick[0] = now;
                            JSObject o = new JSObject();
                            o.put("sending", from + sent);
                            emit(j, "progress", o);
                            UploadService.update(ctx);
                        }
                    });
                    lastTick = tick[0];
                    if (j.waiting) {
                        j.waiting = false;
                        emit(j, "waiting", null);
                    }
                    fails = 0;
                    if (r.optBoolean("done")) {
                        j.at = j.size;
                        JSObject o = new JSObject();
                        o.put("mediaId", r.optString("mediaId"));
                        emit(j, "done", o);
                        return;
                    }
                    j.at = r.optLong("received", end);
                    emit(j, "progress", null);
                    UploadService.update(ctx);
                } catch (Refused e) {
                    if (e.status == 404) fail(j, "This upload expired. Choose the file again.");
                    else fail(j, e.getMessage());
                    return;
                } catch (Exception e) {
                    // A connection problem: wait (up to 30s between tries) and ask the server where it got to.
                    fails++;
                    if (!j.waiting) {
                        j.waiting = true;
                        emit(j, "waiting", null);
                        UploadService.update(ctx);
                    }
                    try {
                        Thread.sleep(Math.min(30000, 1000L << Math.min(fails, 5)));
                    } catch (InterruptedException ie) {
                        return;
                    }
                    try {
                        JSONObject st = status(j);
                        if (st.optBoolean("done")) {
                            JSObject o = new JSObject();
                            o.put("mediaId", st.optString("mediaId"));
                            emit(j, "done", o);
                            return;
                        }
                        j.at = st.optLong("received", j.at);
                    } catch (Refused r) {
                        if (r.status == 404) {
                            fail(j, "This upload expired. Choose the file again.");
                            return;
                        }
                    } catch (Exception ignored) {
                        // Still offline.
                    }
                }
            }
            fail(j, "Upload cancelled.");
        } finally {
            jobs.remove(j.id);
            UploadService.update(ctx);
        }
    }

    private static void fail(Job j, String msg) {
        JSObject o = new JSObject();
        o.put("error", msg);
        emit(j, "failed", o);
    }

    interface Sent {
        void sent(long n);
    }

    private static HttpURLConnection open(Job j, String path, String method) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(j.server + path).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(20000);
        c.setReadTimeout(120000);
        c.setRequestProperty("X-Glimpse-App", "1");
        if (j.token != null) c.setRequestProperty("Authorization", "Bearer " + j.token);
        return c;
    }

    private static JSONObject reply(HttpURLConnection c) throws IOException {
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String body = "";
        if (in != null) {
            try (InputStream s = in) {
                body = new String(readAll(s), StandardCharsets.UTF_8);
            }
        }
        JSONObject o;
        try {
            o = new JSONObject(body);
        } catch (Exception e) {
            o = new JSONObject();
        }
        if (code >= 200 && code < 300) return o;
        if (code < 500 && code != 408 && code != 429) throw new Refused(code, o.optString("error", "Upload failed (" + code + ")"));
        throw new IOException("Server error " + code);
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        return b.toByteArray();
    }

    private static JSONObject status(Job j) throws IOException {
        HttpURLConnection c = open(j, "/api/upload/media/session/" + j.id, "GET");
        try {
            return reply(c);
        } finally {
            c.disconnect();
        }
    }

    private static JSONObject put(Context ctx, Job j, long from, long end, Sent progress) throws IOException {
        HttpURLConnection c = open(j, "/api/upload/media/session/" + j.id, "PUT");
        try {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/octet-stream");
            c.setRequestProperty("X-Offset", String.valueOf(from));
            c.setFixedLengthStreamingMode(end - from);
            try (InputStream in = ctx.getContentResolver().openInputStream(Uri.parse(j.uri))) {
                if (in == null) throw new Refused(410, "The file is no longer on this phone.");
                MediaWebViewClient.skipFully(in, from);
                try (OutputStream out = c.getOutputStream()) {
                    byte[] buf = new byte[64 * 1024];
                    long left = end - from, sent = 0;
                    while (left > 0) {
                        if (j.cancelled) throw new IOException("cancelled");
                        int n = in.read(buf, 0, (int) Math.min(buf.length, left));
                        if (n < 0) throw new Refused(410, "The file changed on this phone. Choose it again.");
                        out.write(buf, 0, n);
                        left -= n;
                        sent += n;
                        progress.sent(sent);
                    }
                }
            } catch (SecurityException e) {
                throw new Refused(403, "Glimpse can no longer open that file. Choose it again.");
            }
            return reply(c);
        } finally {
            c.disconnect();
        }
    }
}
