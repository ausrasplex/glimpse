package app.glimpse.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Glimpse's own native pieces: the photo library and camera, and uploads that keep going in the background.
        registerPlugin(GlimpseMediaPlugin.class);
        registerPlugin(GlimpseUploadsPlugin.class);
        super.onCreate(savedInstanceState);
        // Phone videos are served to the page with proper byte ranges, so trimming can seek through them.
        getBridge().setWebViewClient(new MediaWebViewClient(getBridge()));
    }
}
