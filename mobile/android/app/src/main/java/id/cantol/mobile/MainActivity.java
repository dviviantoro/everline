package id.cantol.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import id.cantol.mobile.plugins.CantolLinkPlugin;
import id.cantol.mobile.plugins.GnssHelperPlugin;
import id.cantol.mobile.plugins.HotspotAssistantPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The three app plugins must be registered before the bridge starts.
        registerPlugin(HotspotAssistantPlugin.class);
        registerPlugin(CantolLinkPlugin.class);
        registerPlugin(GnssHelperPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
