#!/usr/bin/env node
// Runs before every Vercel build. Fails production builds that are misconfigured or that could expose
// development-only tools; warns (without failing) on previews.
import { execFileSync } from "node:child_process";

const env = process.env.VERCEL_ENV ?? "development";
const problems = [];
const warn = [];

if (process.env.FOLEVI_DEV_MAILBOX_SECRET) {
  (env === "production" ? problems : warn).push("FOLEVI_DEV_MAILBOX_SECRET is set (the development mailbox must not exist in production).");
}
if (env === "production") {
  for (const name of ["FOLEVI_SERVER_SECRET", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_MARKETING_URL", "CONVEX_DEPLOY_KEY"]) {
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
      if (!/^https:\/\//.test(get("SITE_URL") ?? "")) problems.push("Convex SITE_URL must be the https app origin (e.g. https://app.folevi.com).");
      for (const k of ["BETTER_AUTH_SECRET", "FOLEVI_HASH_SALT", "FOLEVI_FILE_URL_SECRET", "FOLEVI_SERVER_SECRET", "LOOPS_API_KEY"]) {
        if (!get(k) || get(k) === "none") problems.push(`Convex ${k} is not set.`);
      }
      if ((get("BETTER_AUTH_SECRET") ?? "").length < 32) problems.push("Convex BETTER_AUTH_SECRET must be at least 32 characters.");
      for (const k of ["FOLEVI_DEV_MAILBOX_SECRET", "FOLEVI_AUTH_RATE_LIMIT_SCALE"]) {
        if (get(k) && get(k) !== "none") problems.push(`Convex ${k} must not be set in production.`);
      }
      for (const k of ["FOLEVI_REQUIRE_VERIFIED_EMAIL", "FOLEVI_REQUIRE_MFA"]) {
        if (get(k) === "false") problems.push(`Convex ${k}=false disables a required protection; remove it in production.`);
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
