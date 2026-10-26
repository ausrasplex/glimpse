package app.glimpse.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Size;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The phone's photo library (newest first, with the day each was taken), thumbnails for it, and the camera.
 * Items look like { id, uri, kind: "video"|"photo", mime, name, size, taken (ms), duration (s), width, height }.
 */
@CapacitorPlugin(
    name = "GlimpseMedia",
    permissions = {
        @Permission(alias = "media", strings = { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO }),
        @Permission(alias = "partial", strings = { "android.permission.READ_MEDIA_VISUAL_USER_SELECTED" }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class GlimpseMediaPlugin extends Plugin {
    private final ExecutorService work = Executors.newFixedThreadPool(3);

    // ---------- Access ----------

    private boolean granted(String p) {
        return ContextCompat.checkSelfPermission(getContext(), p) == PackageManager.PERMISSION_GRANTED;
    }

    /** "full", "partial" (Android 14+: only the photos the person picked) or "none". */
    private String access() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (granted(Manifest.permission.READ_MEDIA_IMAGES) && granted(Manifest.permission.READ_MEDIA_VIDEO)) return "full";
            if (Build.VERSION.SDK_INT >= 34 && granted("android.permission.READ_MEDIA_VISUAL_USER_SELECTED")) return "partial";
            return "none";
        }
        return granted(Manifest.permission.READ_EXTERNAL_STORAGE) ? "full" : "none";
    }

    @PluginMethod
    public void access(PluginCall call) {
        JSObject r = new JSObject();
        r.put("access", access());
        call.resolve(r);
    }

    /** Asks for access (again). With partial access this is also how the person picks more photos. */
    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) requestPermissionForAliases(new String[] { "media", "partial" }, call, "accessResult");
        else if (Build.VERSION.SDK_INT >= 33) requestPermissionForAlias("media", call, "accessResult");
        else requestPermissionForAlias("storage", call, "accessResult");
    }

    @PermissionCallback
    private void accessResult(PluginCall call) {
        access(call);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    // ---------- Library ----------

    private static final String TAKEN = "datetaken";
    // When a file has no "date taken" (often downloads and shared videos), its last-modified time stands in.
    private static final String WHEN = "COALESCE(datetaken, date_modified*1000)";

    /** Up to `limit` items taken before `before` (newest first), or after `after` (oldest first). Times in ms. */
    @PluginMethod
    public void list(PluginCall call) {
        if (access().equals("none")) {
            call.reject("No access to photos and videos", "NO_ACCESS");
            return;
        }
        final Long before = GlimpseUploadsPlugin.num(call, "before", null);
        final Long after = GlimpseUploadsPlugin.num(call, "after", null);
        final int limit = Math.max(1, Math.min(500, call.getInt("limit", 150)));
        work.execute(() -> {
            try {
                JSArray items = new JSArray();
                String sel = "(" + MediaStore.Files.FileColumns.MEDIA_TYPE + "=? OR " + MediaStore.Files.FileColumns.MEDIA_TYPE + "=?)";
                java.util.List<String> args = new java.util.ArrayList<>();
                args.add(String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE));
                args.add(String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO));
                // Written in as numbers: arguments bind as text, and SQLite counts every number as less than any text.
                if (before != null) sel += " AND " + WHEN + "<" + before.longValue();
                if (after != null) sel += " AND " + WHEN + ">=" + after.longValue();
                String order = WHEN + (after != null ? " ASC" : " DESC");
                try (Cursor c = query(MediaStore.Files.getContentUri("external"), sel, args.toArray(new String[0]), order, limit)) {
                    while (c != null && c.moveToNext()) items.put(describe(c, null));
                }
                JSObject r = new JSObject();
                r.put("items", items);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Couldn't read your photos and videos: " + e.getMessage());
            }
        });
    }

    private static final String[] COLS = {
        MediaStore.Files.FileColumns._ID,
        MediaStore.Files.FileColumns.MEDIA_TYPE,
        MediaStore.MediaColumns.MIME_TYPE,
        MediaStore.MediaColumns.DISPLAY_NAME,
        MediaStore.MediaColumns.SIZE,
        TAKEN,
        MediaStore.MediaColumns.DATE_ADDED,
        MediaStore.MediaColumns.DATE_MODIFIED,
        "duration",
        MediaStore.MediaColumns.WIDTH,
        MediaStore.MediaColumns.HEIGHT,
        "orientation"
    };

    private Cursor query(Uri uri, String sel, String[] args, String order, int limit) {
        ContentResolver cr = getContext().getContentResolver();
        if (Build.VERSION.SDK_INT >= 26) {
            Bundle q = new Bundle();
            if (sel != null) {
                q.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, sel);
                q.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args);
            }
            if (order != null) q.putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, order);
            if (limit > 0) q.putInt(ContentResolver.QUERY_ARG_LIMIT, limit);
            return cr.query(uri, COLS, q, null);
        }
        return cr.query(uri, COLS, sel, args, order != null && limit > 0 ? order + " LIMIT " + limit : order);
    }

    private static long num(Cursor c, String col) {
        int i = c.getColumnIndex(col);
        return i < 0 || c.isNull(i) ? 0 : c.getLong(i);
    }

    private static String text(Cursor c, String col) {
        int i = c.getColumnIndex(col);
        return i < 0 || c.isNull(i) ? null : c.getString(i);
    }

    /** One row as an item. `uri` is given for a single item (camera result); otherwise it's built from the id. */
    private JSObject describe(Cursor c, Uri uri) {
        long id = num(c, MediaStore.Files.FileColumns._ID);
        String mime = text(c, MediaStore.MediaColumns.MIME_TYPE);
        long type = num(c, MediaStore.Files.FileColumns.MEDIA_TYPE);
        boolean video = type == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO || (mime != null && mime.startsWith("video/"));
        if (uri == null) uri = ContentUris.withAppendedId(video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
        long taken = num(c, TAKEN);
        if (taken <= 0) taken = num(c, MediaStore.MediaColumns.DATE_MODIFIED) * 1000;
        if (taken <= 0) taken = num(c, MediaStore.MediaColumns.DATE_ADDED) * 1000;
        long w = num(c, MediaStore.MediaColumns.WIDTH), h = num(c, MediaStore.MediaColumns.HEIGHT);
        long rot = num(c, "orientation");
        if (rot == 90 || rot == 270) {
            long t = w;
            w = h;
            h = t;
        }
        JSObject o = new JSObject();
        o.put("id", String.valueOf(id));
        o.put("uri", uri.toString());
        o.put("kind", video ? "video" : "photo");
        o.put("mime", mime != null ? mime : video ? "video/mp4" : "image/jpeg");
        o.put("name", text(c, MediaStore.MediaColumns.DISPLAY_NAME));
        o.put("size", num(c, MediaStore.MediaColumns.SIZE));
        o.put("taken", taken);
        o.put("duration", num(c, "duration") / 1000.0);
        o.put("width", w);
        o.put("height", h);
        return o;
    }

    /** Small JPEG thumbnails, cached. Takes { items: [{ id, uri, kind }], size } and returns { paths: { id: path } }. */
    @PluginMethod
    public void thumbnails(PluginCall call) {
        final JSONArray items = call.getArray("items");
        final int size = Math.max(64, Math.min(512, call.getInt("size", 256)));
        if (items == null) {
            call.reject("No items");
            return;
        }
        work.execute(() -> {
            JSObject paths = new JSObject();
            File dir = new File(getContext().getCacheDir(), "thumbs");
            dir.mkdirs();
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null) continue;
                String id = it.optString("id");
                File f = new File(dir, id.replaceAll("[^\\w-]", "_") + "_" + size + ".jpg");
                try {
                    if (!f.exists()) {
                        Bitmap b = thumb(Uri.parse(it.optString("uri")), id, "video".equals(it.optString("kind")), size);
                        if (b == null) continue;
                        try (FileOutputStream out = new FileOutputStream(f)) {
                            b.compress(Bitmap.CompressFormat.JPEG, 78, out);
                        }
                        b.recycle();
                    }
                    paths.put(id, f.getAbsolutePath());
                } catch (Exception e) {
                    // No thumbnail for this one; the gallery shows a plain tile.
                }
            }
            JSObject r = new JSObject();
            r.put("paths", paths);
            call.resolve(r);
        });
    }

    @SuppressWarnings("deprecation")
    private Bitmap thumb(Uri uri, String id, boolean video, int size) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        if (Build.VERSION.SDK_INT >= 29) return cr.loadThumbnail(uri, new Size(size, size), null);
        long n = Long.parseLong(id);
        return video
            ? MediaStore.Video.Thumbnails.getThumbnail(cr, n, MediaStore.Video.Thumbnails.MINI_KIND, null)
            : MediaStore.Images.Thumbnails.getThumbnail(cr, n, MediaStore.Images.Thumbnails.MINI_KIND, null);
    }

    /** Still frames from a phone video, for the trim filmstrip: { uri, times: [s], width } → { frames: [dataUrl|null] }. */
    @PluginMethod
    public void frames(PluginCall call) {
        final String uri = call.getString("uri");
        final JSONArray times = call.getArray("times");
        final int width = Math.max(32, Math.min(720, call.getInt("width", 120)));
        if (uri == null || times == null) {
            call.reject("Missing video");
            return;
        }
        work.execute(() -> {
            android.media.MediaMetadataRetriever mr = new android.media.MediaMetadataRetriever();
            JSArray out = new JSArray();
            try {
                mr.setDataSource(getContext(), Uri.parse(uri));
                for (int i = 0; i < times.length(); i++) {
                    long us = (long) (times.optDouble(i, 0) * 1e6);
                    Bitmap b = mr.getFrameAtTime(us, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                    if (b == null) {
                        out.put(JSONObject.NULL);
                        continue;
                    }
                    int h = Math.max(1, Math.round(b.getHeight() * (width / (float) b.getWidth())));
                    Bitmap sm = Bitmap.createScaledBitmap(b, width, h, true);
                    java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                    sm.compress(Bitmap.CompressFormat.JPEG, 70, bytes);
                    out.put("data:image/jpeg;base64," + android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP));
                    if (sm != b) sm.recycle();
                    b.recycle();
                }
                JSObject r = new JSObject();
                r.put("frames", out);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Couldn't read frames from that video");
            } finally {
                try {
                    mr.release();
                } catch (Exception ignored) {
                    // Already released.
                }
            }
        });
    }

    // ---------- Camera ----------

    /** Films a video with the phone's camera app. Resolves to the new item, or { cancelled: true }. */
    @PluginMethod
    public void record(PluginCall call) {
        Intent i = new Intent(MediaStore.ACTION_VIDEO_CAPTURE);
        i.putExtra(MediaStore.EXTRA_VIDEO_QUALITY, 1);
        if (i.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("This phone has no camera app that can film video.");
            return;
        }
        startActivityForResult(call, i, "recorded");
    }

    @ActivityCallback
    private void recorded(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject r = new JSObject();
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        work.execute(() -> {
            // Every column, since camera apps may hand back their own kind of link with fewer of them.
            try (Cursor c = getContext().getContentResolver().query(uri, null, null, null, null)) {
                JSObject o;
                if (c != null && c.moveToFirst()) o = describe(c, uri);
                else {
                    o = new JSObject();
                    o.put("uri", uri.toString());
                    o.put("kind", "video");
                    o.put("mime", "video/mp4");
                    o.put("taken", System.currentTimeMillis());
                }
                o.put("taken", System.currentTimeMillis());
                if (o.optString("name", "").isEmpty()) o.put("name", "Glimpse.mp4");
                if (o.optLong("size", 0) <= 0) {
                    try (android.content.res.AssetFileDescriptor fd = getContext().getContentResolver().openAssetFileDescriptor(uri, "r")) {
                        if (fd != null) o.put("size", fd.getLength());
                    }
                }
                call.resolve(o);
            } catch (Exception e) {
                call.reject("Couldn't open the video you just filmed: " + e.getMessage());
            }
        });
    }
}
