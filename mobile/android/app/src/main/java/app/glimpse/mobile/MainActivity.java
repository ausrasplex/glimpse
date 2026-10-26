package app.glimpse.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Glimpse's own native pieces: the photo library and camera, uploads that keep going in the background, and
        // updates from GitHub Releases.
        registerPlugin(GlimpseMediaPlugin.class);
        registerPlugin(GlimpseUploadsPlugin.class);
        registerPlugin(GlimpseUpdatePlugin.class);
        super.onCreate(savedInstanceState);
        // Phone videos are served to the page with proper byte ranges, so trimming can seek through them.
        getBridge().setWebViewClient(new MediaWebViewClient(getBridge()));
    }
}
