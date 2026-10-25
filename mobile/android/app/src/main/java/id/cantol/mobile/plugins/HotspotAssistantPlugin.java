package id.cantol.mobile.plugins;

import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import id.cantol.mobile.link.HotspotProbe;
import id.cantol.mobile.link.SettingsTargets;

/**
 * ADR-003 strategies S0 (detect a hotspot that is already on) and S3 (open the system hotspot
 * settings). Android has no public API to switch the hotspot on or set its name and password, so
 * the operator does that once on the phone; this plugin finds out when it worked and gets them to
 * the right screen. No permission is needed for either.
 */
@CapacitorPlugin(name = "HotspotAssistant")
public class HotspotAssistantPlugin extends Plugin {
    /** Is an access-point-style interface up with a private address? Best effort, see HotspotProbe. */
    @PluginMethod
    public void isOn(PluginCall call) {
        HotspotProbe.Hotspot hotspot = HotspotProbe.detect(HotspotProbe.fromSystem());
        JSObject out = new JSObject();
        out.put("on", hotspot != null);
        if (hotspot != null) {
            out.put("iface", hotspot.iface());
            out.put("address", hotspot.address());
            out.put("prefix", hotspot.prefix());
        }
        call.resolve(out);
    }

    /** Tries the settings screens in order and reports which one opened. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        int index = 0;
        for (SettingsTargets.Target target : SettingsTargets.ORDERED) {
            Intent intent = target.action() != null
                    ? new Intent(target.action())
                    : new Intent().setComponent(new ComponentName(target.pkg(), target.cls()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(intent);
                JSObject out = new JSObject();
                out.put("index", index);
                out.put("label", target.label());
                // The public screens open the network settings, one level above the hotspot.
                out.put("exact", !target.isPublic());
                call.resolve(out);
                return;
            } catch (ActivityNotFoundException | SecurityException e) {
                index++;
            }
        }
        call.reject("no settings screen could be opened", "no_settings");
    }
}
