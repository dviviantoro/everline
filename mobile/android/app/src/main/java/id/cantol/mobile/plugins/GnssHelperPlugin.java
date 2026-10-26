package id.cantol.mobile.plugins;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import androidx.core.content.ContextCompat;

/**
 * What {@code @capacitor/geolocation} does not do: tell whether location services are switched
 * on, and open the screens that fix it (location settings, this app's own settings). Reading the
 * fixes and asking for the permission stay with the geolocation plugin, except that the geolocation
 * plugin REJECTS both permission calls while location services are off (its "location disabled"
 * error), so {@link #permissionState} answers what it cannot: whether the permission is granted. The Play Services dialog
 * that turns location on without leaving the app is not used: it would tie the app to Google
 * Play Services, so the operator is sent to the system screen instead.
 */
@CapacitorPlugin(name = "GnssHelper")
public class GnssHelperPlugin extends Plugin {
    @PluginMethod
    public void servicesEnabled(PluginCall call) {
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        boolean enabled = false;
        if (manager != null) {
            enabled = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? manager.isLocationEnabled()
                    : manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        }
        JSObject out = new JSObject();
        out.put("enabled", enabled);
        call.resolve(out);
    }

    /** Whether each location permission is granted. A plain system check: it works with location off. */
    @PluginMethod
    public void permissionState(PluginCall call) {
        JSObject out = new JSObject();
        out.put("fine", ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED);
        out.put("coarse", ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED);
        call.resolve(out);
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        start(call, new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        start(call, new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null)));
    }

    private void start(PluginCall call, Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException | SecurityException e) {
            call.reject("the settings screen could not be opened", "no_settings");
        }
    }
}
