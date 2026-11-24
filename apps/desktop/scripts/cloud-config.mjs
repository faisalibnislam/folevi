// Writes dist/cloud-config.json: the public OAuth client ids for "Sync with Dropbox" and "Sync with Google
// Drive" (src/library/cloud/config.ts), taken from the environment at build time so they are never committed.
// Missing ids are left out; the app then hides that option and says why in its log.
//   FOLEVI_DROPBOX_APP_KEY=... FOLEVI_GOOGLE_DESKTOP_CLIENT_ID=... pnpm build
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = {};
const take = (key, env) => {
  const v = process.env[env]?.trim();
  if (v) config[key] = v;
};
take("dropboxAppKey", "FOLEVI_DROPBOX_APP_KEY");
take("googleClientId", "FOLEVI_GOOGLE_DESKTOP_CLIENT_ID");
take("googleClientSecret", "FOLEVI_GOOGLE_DESKTOP_CLIENT_SECRET");
const out = join(root, "dist", "cloud-config.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
const has = (k) => (config[k] ? "yes" : "no");
console.log(`cloud-config.json: Dropbox ${has("dropboxAppKey")}, Google Drive ${has("googleClientId")}${config.googleClientSecret ? " (with client secret)" : ""}`);
