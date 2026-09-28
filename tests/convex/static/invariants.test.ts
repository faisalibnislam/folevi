// Source-level invariants that are easier to guarantee statically than at runtime.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(__dirname, "..", "..", "..", "convex");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "_generated" || f === "tests") return [];
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const sources = files(root).map((p) => ({ p, s: readFileSync(p, "utf8") }));

describe("backend invariants", () => {
  test("the admin audit log is append-only (no patch/replace/delete anywhere)", () => {
    for (const { p, s } of sources) {
      const lines = s.split("\n");
      lines.forEach((line, i) => {
        if (/adminAuditLogs/.test(line) && /(patch|replace|delete)\(/.test(line)) throw new Error(`${p}:${i + 1} mutates adminAuditLogs`);
      });
      // Heuristic: a variable read from adminAuditLogs must not be passed to db.patch/delete.
      expect(/query\("adminAuditLogs"\)[\s\S]{0,400}db\.(patch|delete|replace)\(/.test(s) && !p.endsWith("admin.ts") ? p : "ok").toBe("ok");
    }
  });

  test("every public function authenticates (requireProfile/requirePlatformRole/optionalProfile) or is explicitly public", () => {
    const allowPublic = new Set(["users.ts:me", "settings.ts:status", "settings.ts:ping", "sharing.ts:openPublicLink", "authEmails.ts:devMailbox", "users.ts:bootstrap", "users.ts:registerSession", "users.ts:heartbeat", "users.ts:listSessions", "users.ts:revokeOtherSessions"]);
    for (const { p, s } of sources) {
      const name = p.split("/").pop()!;
      const re = /export const (\w+) = (query|mutation|action)\(\{[\s\S]*?handler: async \([^)]*\)[^{]*\{([\s\S]*?)\n {2}\},\n\}\);/g;
      for (const m of s.matchAll(re)) {
        const [, fn, , body] = m;
        const guarded = /requireProfile|requirePlatformRole|optionalProfile|requireIdentity|collectionFor|threadFor|folderFor|tagFor|writableDoc|checkServer|taskBlock|currentProfileId|internal\.exports\.prepare/.test(body!);
        if (!guarded && !allowPublic.has(`${name}:${fn}`)) throw new Error(`${name}:${fn} has no authorization check`);
      }
    }
  });

  test("only Folevi's own issuer is trusted, and development-only tools refuse production", () => {
    const cfg = readFileSync(join(root, "auth.config.ts"), "utf8");
    expect(cfg).toMatch(/providers: \[getAuthConfigProvider\(\)\]/);
    expect(cfg).not.toMatch(/customJwt|auth0|FOLEVI_DEV_AUTH/i);
    const mailbox = readFileSync(join(root, "authEmails.ts"), "utf8");
    expect(mailbox).toMatch(/FOLEVI_ENV !== "production"/);
    expect(mailbox).toMatch(/timingSafeEqualHex\(args\.secret, expected\)/);
    const testSupport = readFileSync(join(root, "testSupport.ts"), "utf8");
    expect(testSupport).toMatch(/FOLEVI_ENV === "production"\) throw/);
    expect(testSupport).not.toMatch(/export const \w+ = (query|mutation|action)\(/);
  });

  test("identity cryptography is delegated to Better Auth (no hand-rolled password or TOTP code)", () => {
    for (const { p, s } of sources) {
      if (/bcrypt|scrypt|argon2|hmac-sha1|base32/i.test(s) && !p.includes("betterAuth")) throw new Error(`${p}: credential crypto should come from Better Auth`);
    }
  });

  test("no module logs note content, tokens or raw emails", () => {
    for (const { p, s } of sources) {
      for (const m of s.matchAll(/console\.(log|warn|error)\(([^;]*)\);/g)) {
        const arg = m[2]!;
        if (/\.text\b|searchText|excerpt|\btoken\b|access_token|\.email\b|body/.test(arg)) throw new Error(`${p}: suspicious log: ${arg.slice(0, 80)}`);
      }
    }
  });
});
