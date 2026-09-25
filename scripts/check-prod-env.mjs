#!/usr/bin/env node
// Runs before every Vercel build. Fails production builds that are misconfigured or that could enable
// the development identity; warns (without failing) on previews.
import { execFileSync } from "node:child_process";

const env = process.env.VERCEL_ENV ?? "development";
const problems = [];
const warn = [];

if (process.env.FOLEVI_DEV_AUTH === "1" || process.env.FOLEVI_ALLOW_DEV_AUTH_BUILD === "1") {
  (env === "production" ? problems : warn).push("Development sign-in variables are set (FOLEVI_DEV_AUTH / FOLEVI_ALLOW_DEV_AUTH_BUILD).");
}
if (env === "production") {
  for (const name of ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "FOLEVI_SERVER_SECRET", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_MARKETING_URL", "CONVEX_DEPLOY_KEY"]) {
    if (!process.env[name]) problems.push(`${name} is not set.`);
  }
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("NEXT_PUBLIC_") && /SECRET|KEY|TOKEN|PASSWORD/.test(name)) problems.push(`${name} looks like a secret exposed to the browser.`);
  }
  if (process.env.CONVEX_DEPLOY_KEY) {
    try {
      const out = execFileSync("npx", ["convex", "env", "list"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const get = (k) => new RegExp(`^${k}=(.*)$`, "m").exec(out)?.[1];
      if (get("FOLEVI_ENV") !== "production") problems.push("Convex FOLEVI_ENV must be 'production'.");
      if ((get("FOLEVI_DEV_AUTH_JWKS") ?? "none") !== "none") problems.push("Convex FOLEVI_DEV_AUTH_JWKS must be 'none' in production.");
      for (const k of ["FOLEVI_HASH_SALT", "FOLEVI_FILE_URL_SECRET", "FOLEVI_SERVER_SECRET", "AUTH0_WEB_CLIENT_ID", "AUTH0_MAC_CLIENT_ID", "LOOPS_API_KEY"]) {
        if (!get(k) || get(k) === "none") problems.push(`Convex ${k} is not set.`);
      }
    } catch {
      warn.push("Could not read the Convex environment (skipping Convex checks).");
    }
  }
}
for (const w of warn) console.warn(`warning: ${w}`);
if (problems.length) {
  for (const p of problems) console.error(`error: ${p}`);
  process.exit(1);
}
console.log(`environment check passed (${env})`);
