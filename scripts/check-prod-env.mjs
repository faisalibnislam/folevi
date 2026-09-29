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
for (const name of Object.keys(process.env)) {
  if (name.startsWith("LOOPS_")) warn.push(`${name} is set but unused (Loops is no longer used); remove it.`);
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
      const has = (k) => Boolean(get(k)) && get(k) !== "none";
      for (const k of ["BETTER_AUTH_SECRET", "FOLEVI_HASH_SALT", "FOLEVI_FILE_URL_SECRET", "FOLEVI_SERVER_SECRET"]) {
        if (!has(k)) problems.push(`Convex ${k} is not set.`);
      }
      // Email: Mailtrap is the only provider and is required in production.
      if (has("MAILTRAP_API_TOKEN")) {
        if (!has("MAILTRAP_WEBHOOK_SECRET")) warn.push("Convex MAILTRAP_WEBHOOK_SECRET is not set: no delivery, bounce or complaint tracking, and bounced addresses are never suppressed.");
      } else {
        problems.push("Convex MAILTRAP_API_TOKEN is not set (no email provider: sign-up confirmation and password reset emails can't be sent).");
      }
      // Support inbox: optional, but half a setup means email to support@folevi.com never becomes a ticket.
      if (has("MAILTRAP_INBOUND_WEBHOOK_SECRET") !== has("MAILTRAP_INBOUND_API_TOKEN")) {
        warn.push("Convex MAILTRAP_INBOUND_WEBHOOK_SECRET and MAILTRAP_INBOUND_API_TOKEN must be set together, or email to support@folevi.com won't become tickets (docs/SUPPORT.md).");
      } else if (!has("MAILTRAP_INBOUND_WEBHOOK_SECRET")) {
        warn.push("Convex MAILTRAP_INBOUND_WEBHOOK_SECRET is not set: email to support@folevi.com isn't turned into support tickets (docs/SUPPORT.md).");
      }
      if (["support@folevi.com", "security@folevi.com"].includes((get("SUPPORT_NOTIFY_EMAIL") ?? "").trim().toLowerCase())) {
        warn.push("Convex SUPPORT_NOTIFY_EMAIL must not be the support or security mailbox (it is ignored); use a staff address.");
      }
      // Leftovers from the old email provider are never read; flag them so they get deleted.
      for (const [, k] of out.matchAll(/^(LOOPS_[A-Z0-9_]*)=/gm)) warn.push(`Convex ${k} is set but unused (Loops is no longer used); remove it.`);
      for (const k of ["MAILTRAP_SANDBOX_INBOX_ID", "MAILTRAP_SANDBOX_TOKEN"]) {
        if (has(k)) warn.push(`Convex ${k} is set in production; it is ignored there (the sandbox is for non-production only). Remove it.`);
      }
      if ((get("BETTER_AUTH_SECRET") ?? "").length < 32) problems.push("Convex BETTER_AUTH_SECRET must be at least 32 characters.");
      for (const k of ["FOLEVI_DEV_MAILBOX_SECRET", "FOLEVI_AUTH_RATE_LIMIT_SCALE"]) {
        if (get(k) && get(k) !== "none") problems.push(`Convex ${k} must not be set in production.`);
      }
      for (const k of ["FOLEVI_REQUIRE_VERIFIED_EMAIL"]) {
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
