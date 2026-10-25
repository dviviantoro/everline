package id.cantol.mobile.link;

import java.util.List;

/**
 * The screens to try, in order, to land the operator on the phone's hotspot settings (ADR-003
 * strategy S3). There is no public API that opens that screen, so the first entries are what
 * AOSP and common OEM builds are known to answer to, and the last two are public and always
 * exist: the user then finds the hotspot one level down. Held as data so field results can add
 * to it without touching the logic. Entries that do not exist on a phone are skipped.
 */
public final class SettingsTargets {
    private SettingsTargets() {}

    /** An action, or a package and class name; never both. */
    public record Target(String label, String action, String pkg, String cls) {
        public boolean isPublic() {
            return action != null && (action.equals("android.settings.WIRELESS_SETTINGS") || action.equals("android.settings.SETTINGS"));
        }
    }

    public static final List<Target> ORDERED = List.of(
            new Target("Tethering settings", "android.settings.TETHER_SETTINGS", null, null),
            new Target("Tethering settings (AOSP)", null, "com.android.settings", "com.android.settings.TetherSettings"),
            new Target("Tethering settings (activity)", null, "com.android.settings", "com.android.settings.Settings$TetherSettingsActivity"),
            new Target("Wi-Fi hotspot settings (older AOSP)", null, "com.android.settings", "com.android.settings.Settings$WifiApSettingsActivity"),
            new Target("Network settings", "android.settings.WIRELESS_SETTINGS", null, null),
            new Target("Settings", "android.settings.SETTINGS", null, null));
}
