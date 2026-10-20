// settings.* and clock.now in local mode (convex/settings.ts, convex/clock.ts). There's no maintenance
// banner, read-only switch, admin feature flag or minimum app version on a device: the platform settings are
// their defaults. (A local library is opened by the app version that has it, so nothing asks the person to
// update.) Which built-in templates admins switched off comes from the snapshot bundled with the app.
import { BUILT_IN_TEMPLATES } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { defineLocal } from "../registry";
import { getProfile } from "./shared";
import { bundledSnapshot } from "./themes";

defineLocal(api.settings.status, "query", async () => ({ bannerMessage: null, readOnly: false, flags: {}, minShellVersion: { mac: null, ios: null } }));

defineLocal(api.settings.builtInTemplates, "query", async (ctx) => {
  if (!(await getProfile(ctx.db))) return [];
  const disabled = new Set((await bundledSnapshot()).templates.disabled);
  return BUILT_IN_TEMPLATES.filter((t) => !disabled.has(t.key)).map((t) => ({ key: `builtin:${t.key}`, name: t.name, description: t.description, icon: t.icon }));
});

/** Keys only, as the template gallery reads them. */
defineLocal(api.settings.disabledBuiltInTemplates, "query", async () => [...(await bundledSnapshot()).templates.disabled]);

/**
 * The time now. The sticky notes workshop timer asks the server's clock so every viewer agrees; on a device
 * there's one viewer and one clock.
 */
defineLocal(api.clock.now, "mutation", async (ctx) => ctx.now());
