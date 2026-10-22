package com.folevi.android

import com.folevi.android.web.Links
import com.folevi.android.web.Links.Target
import org.junit.Assert.assertEquals
import org.junit.Test

class LinksTest {
    private val app = "https://localhost"
    private val site = "https://app.folevi.com"
    private fun t(url: String) = Links.target(url, app, site)

    @Test
    fun routesLinks() {
        assertEquals(Target.App("/d/01J9ZDOC000000000000000001#block-x"), t("https://localhost/d/01J9ZDOC000000000000000001#block-x"))
        assertEquals(Target.App("/tasks/today"), t("https://app.folevi.com/tasks/today"))
        assertEquals(Target.Browser, t("https://app.folevi.com/s/abc"))
        assertEquals(Target.Browser, t("https://example.com/page"))
        assertEquals(Target.System, t("mailto:help@folevi.com"))
        assertEquals(Target.System, t("tel:+15551234"))
        assertEquals(Target.DeepLink("folevi://quick-add"), t("folevi://quick-add"))
        for (bad in listOf("javascript:alert(1)", "file:///etc/hosts", "intent://x#Intent;end", "content://x", "market://details?id=x"))
            assertEquals(bad, Target.Ignore, t(bad))
    }

    @Test
    fun neverOpensPricing() {
        assertEquals(Target.Ignore, t("https://folevi.com/pricing"))
        assertEquals(Target.Ignore, t("https://app.folevi.com/pricing"))
        assertEquals(Target.Ignore, t("https://www.folevi.com/pricing?plan=pro"))
    }

    @Test
    fun appLinksBecomeFoleviLinks() {
        assertEquals("folevi://d/01J9ZDOC000000000000000001#block-abc", Links.asDeepLink("https://app.folevi.com/d/01J9ZDOC000000000000000001#block-abc", site))
        assertEquals("folevi://tasks/today", Links.asDeepLink("https://app.folevi.com/tasks/today", site))
        assertEquals(null, Links.asDeepLink("https://app.folevi.com/s/token", site))
        assertEquals(null, Links.asDeepLink("https://evil.example/d/01J9ZDOC000000000000000001", site))
    }
}
