// settings.* in local mode (convex/settings.ts). There's no maintenance banner, read-only switch, admin
// feature flag or minimum app version on a device: the platform settings are their defaults. (A local
// library is opened by the app version that has it, so nothing asks the person to update.)
import { api } from "@/lib/convex/api";
import { defineLocal } from "../registry";

defineLocal(api.settings.status, "query", async () => ({ bannerMessage: null, readOnly: false, flags: {}, minShellVersion: { mac: null, ios: null } }));
