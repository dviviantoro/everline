package id.cantol.mobile.link;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.Test;

public class SettingsTargetsTest {
    @Test
    public void everyEntryIsAnActionOrAComponentAndNeverBoth() {
        for (SettingsTargets.Target t : SettingsTargets.ORDERED) {
            boolean action = t.action() != null;
            boolean component = t.pkg() != null && t.cls() != null;
            assertTrue(t.label(), action ^ component);
            assertFalse(t.label(), t.label().isEmpty());
        }
    }

    @Test
    public void theTablePrefersTheExactScreenAndEndsOnTwoPublicOnes() {
        List<SettingsTargets.Target> t = SettingsTargets.ORDERED;
        assertFalse("the first try is not a fallback", t.get(0).isPublic());
        assertTrue(t.get(t.size() - 2).isPublic());
        assertTrue(t.get(t.size() - 1).isPublic());
        int firstPublic = 0;
        while (!t.get(firstPublic).isPublic()) firstPublic++;
        for (int i = firstPublic; i < t.size(); i++) assertTrue("public fallbacks come last", t.get(i).isPublic());
    }

    @Test
    public void noEntryIsListedTwice() {
        Set<String> seen = new HashSet<>();
        for (SettingsTargets.Target t : SettingsTargets.ORDERED) {
            assertTrue(t.label(), seen.add(t.action() + "|" + t.pkg() + "|" + t.cls()));
        }
        assertEquals(SettingsTargets.ORDERED.size(), seen.size());
    }
}
