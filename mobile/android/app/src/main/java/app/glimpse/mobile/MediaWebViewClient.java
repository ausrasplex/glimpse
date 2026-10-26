package app.glimpse.mobile;

import android.content.ContentResolver;
import android.content.res.AssetFileDescriptor;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves a photo or video from the phone at http://localhost/_glimpse_media_/?uri=content://…, honouring Range
 * requests so a video can be seeked while trimming. Same origin as the page, so frames can be drawn to a canvas.
 */
public class MediaWebViewClient extends BridgeWebViewClient {
    static final String PATH = "/_glimpse_media_/";
    private final Bridge bridge;

    public MediaWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (!"localhost".equals(url.getHost()) || url.getPath() == null || !url.getPath().startsWith(PATH)) {
            return super.shouldInterceptRequest(view, request);
        }
        String raw = url.getQueryParameter("uri");
        if (raw == null || !raw.startsWith("content://")) return status(404, "Not Found");
        try {
            return serve(Uri.parse(raw), request.getRequestHeaders());
        } catch (Exception e) {
            return status(404, "Not Found");
        }
    }

    private WebResourceResponse serve(Uri uri, Map<String, String> headers) throws IOException {
        ContentResolver cr = bridge.getContext().getContentResolver();
        String mime = cr.getType(uri);
        if (mime == null) mime = "application/octet-stream";
        long size = -1;
        try (AssetFileDescriptor fd = cr.openAssetFileDescriptor(uri, "r")) {
            if (fd != null) size = fd.getLength();
        }
        String range = headers.get("Range");
        if (range == null) range = headers.get("range");
        Map<String, String> out = new HashMap<>();
        out.put("Accept-Ranges", "bytes");
        out.put("Cache-Control", "no-store");
        InputStream in = cr.openInputStream(uri);
        if (in == null) return status(404, "Not Found");
        if (range == null || size < 0 || !range.startsWith("bytes=")) {
            if (size >= 0) out.put("Content-Length", String.valueOf(size));
            return new WebResourceResponse(mime, null, 200, "OK", out, in);
        }
        String[] p = range.substring(6).split("-", 2);
        long from = p[0].isEmpty() ? Math.max(0, size - Long.parseLong(p[1])) : Long.parseLong(p[0]);
        long to = p.length > 1 && !p[1].isEmpty() && !p[0].isEmpty() ? Math.min(Long.parseLong(p[1]), size - 1) : size - 1;
        if (from >= size || from > to) {
            in.close();
            out.put("Content-Range", "bytes */" + size);
            return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", out, null);
        }
        skipFully(in, from);
        out.put("Content-Range", "bytes " + from + "-" + to + "/" + size);
        out.put("Content-Length", String.valueOf(to - from + 1));
        return new WebResourceResponse(mime, null, 206, "Partial Content", out, new Limited(in, to - from + 1));
    }

    static void skipFully(InputStream in, long n) throws IOException {
        while (n > 0) {
            long k = in.skip(n);
            if (k <= 0) {
                if (in.read() < 0) throw new IOException("Past the end");
                k = 1;
            }
            n -= k;
        }
    }

    private static WebResourceResponse status(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, new HashMap<>(), null);
    }

    /** Reads at most `left` bytes. */
    static class Limited extends FilterInputStream {
        private long left;

        Limited(InputStream in, long left) {
            super(in);
            this.left = left;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = super.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }
    }
}
