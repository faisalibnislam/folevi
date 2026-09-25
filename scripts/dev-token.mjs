#!/usr/bin/env node
// Prints a development-only identity token for the local Convex deployment (tests, native client,
// CLI experiments). Reads the key from apps/web/.env.local written by scripts/setup-local.mjs.
//   node scripts/dev-token.mjs --email ada@example.com --name "Ada Example" [--device mac-1] [--no-mfa] [--unverified]
import { createPrivateKey, createSign, createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    email: { type: "string", default: "ada@example.com" },
    name: { type: "string", default: "Ada Example" },
    device: { type: "string" },
    "no-mfa": { type: "boolean", default: false },
    unverified: { type: "boolean", default: false },
    ttl: { type: "string", default: "3600" },
  },
});

const envText = readFileSync(resolve(import.meta.dirname, "../apps/web/.env.local"), "utf8");
const env = Object.fromEntries(envText.split("\n").map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
if (env.FOLEVI_DEV_AUTH !== "1") throw new Error("Development sign-in is not enabled (run scripts/setup-local.mjs).");

export function devToken({ email, name, device, mfa = true, verified = true, ttl = 3600 }) {
  const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const normalized = email.trim().toLowerCase();
  const payload = {
    iss: env.FOLEVI_DEV_AUTH_ISSUER,
    aud: "folevi-dev",
    sub: `dev|${createHash("sha256").update(normalized).digest("hex").slice(0, 24)}`,
    email: normalized,
    email_verified: verified,
    name,
    sid: device ? `dev-${device}` : `dev-${randomUUID()}`,
    "https://folevi.com/email_verified": verified,
    "https://folevi.com/mfa": mfa,
    iat: now,
    exp: now + ttl,
  };
  const header = { alg: "RS256", typ: "JWT", kid: env.FOLEVI_DEV_AUTH_KID };
  const input = `${b64(header)}.${b64(payload)}`;
  const key = createPrivateKey(Buffer.from(env.FOLEVI_DEV_AUTH_PRIVATE_KEY, "base64").toString("utf8"));
  const sig = createSign("RSA-SHA256").update(input).sign(key).toString("base64url");
  return `${input}.${sig}`;
}

process.stdout.write(
  devToken({
    email: values.email,
    name: values.name,
    device: values.device,
    mfa: !values["no-mfa"],
    verified: !values.unverified,
    ttl: Number(values.ttl),
  }) + "\n",
);
