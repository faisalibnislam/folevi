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
    const allowPublic = new Set(["users.ts:me", "settings.ts:status", "settings.ts:ping", "sharing.ts:openPublicLink", "authSupport.ts:requestVerificationEmail", "users.ts:bootstrap", "users.ts:registerSession", "users.ts:heartbeat", "users.ts:listSessions", "users.ts:revokeOtherSessions"]);
    for (const { p, s } of sources) {
      const name = p.split("/").pop()!;
      const re = /export const (\w+) = (query|mutation|action)\(\{[\s\S]*?handler: async \([^)]*\)[^{]*\{([\s\S]*?)\n  \},\n\}\);/g;
      for (const m of s.matchAll(re)) {
        const [, fn, , body] = m;
        const guarded = /requireProfile|requirePlatformRole|optionalProfile|requireIdentity|collectionFor|threadFor|folderFor|tagFor|writableDoc|checkServer|taskBlock|currentProfileId|internal\.exports\.prepare/.test(body!);
        if (!guarded && !allowPublic.has(`${name}:${fn}`)) throw new Error(`${name}:${fn} has no authorization check`);
      }
    }
  });

  test("the development issuer can never be trusted in production", () => {
    const cfg = readFileSync(join(root, "auth.config.ts"), "utf8");
    expect(cfg).toMatch(/FOLEVI_ENV !== "production"/);
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
