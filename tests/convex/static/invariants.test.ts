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
        const guarded = /requireProfile|requirePlatformRole|optionalProfile|requireIdentity|collectionFor|threadFor|commentFor|folderFor|tagFor|writableDoc|historyDocument|versionByPublicId|checkServer|taskBlock|currentProfileId|internal\.exports\.prepare/.test(body!);
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

  test("content rows are written only through insertScoped (exactly one of ownerProfileId / workspaceId)", () => {
    const scopeSource = readFileSync(join(root, "lib", "scope.ts"), "utf8");
    const list = /export const SCOPED_TABLES = \[([\s\S]*?)\]/.exec(scopeSource)![1]!;
    const scopedTables = [...list.matchAll(/"(\w+)"/g)].map((m) => m[1]!);
    expect(scopedTables.length).toBeGreaterThanOrEqual(20);
    // Every table that spreads the scope fields in the schema is in SCOPED_TABLES, and vice versa.
    const schema = readFileSync(join(root, "schema.ts"), "utf8");
    const inSchema = [...schema.matchAll(/^ {2}(\w+): defineTable\(\{([\s\S]*?)^ {2}\}\)/gm)].filter((m) => /\.\.\.scoped,/.test(m[2]!)).map((m) => m[1]!);
    expect(inSchema.sort()).toEqual([...scopedTables].sort());
    // …and none of them declares its own workspaceId (it would bypass the "exactly one" rule).
    for (const m of schema.matchAll(/^ {2}(\w+): defineTable\(\{([\s\S]*?)^ {2}\}\)/gm)) {
      if (scopedTables.includes(m[1]!)) expect(m[2], m[1]).not.toMatch(/\bworkspaceId: v\./);
    }
    for (const { p, s } of sources) {
      if (p.endsWith(join("lib", "scope.ts"))) continue;
      for (const table of scopedTables) {
        const direct = new RegExp(`\\.insert\\(\\s*"${table}"`);
        if (direct.test(s)) throw new Error(`${p}: inserts into "${table}" directly; use insertScoped(ctx, "${table}", scope, …)`);
      }
    }
  });

  test("billing rows are written only through lib/billing.ts (exactly one of profileId / workspaceId)", () => {
    for (const { p, s } of sources) {
      if (p.endsWith(join("lib", "billing.ts"))) continue;
      if (/\.insert\(\s*"(subscriptions|payments)"/.test(s)) throw new Error(`${p}: inserts a billing row directly; use insertSubscription / insertPayment`);
    }
    const schema = readFileSync(join(root, "schema.ts"), "utf8");
    for (const table of ["subscriptions", "payments"]) {
      const body = new RegExp(`^ {2}${table}: defineTable\\(\\{([\\s\\S]*?)^ {2}\\}\\)`, "m").exec(schema)![1]!;
      expect(body, table).toMatch(/\bprofileId: v\.optional\(v\.id\("profiles"\)\)/);
      expect(body, table).toMatch(/\bworkspaceId: v\.optional\(v\.id\("workspaces"\)\)/);
    }
  });

  test("every workspace billing function checks billing permission on the server", () => {
    const s = readFileSync(join(root, "workspaceBilling.ts"), "utf8");
    const re = /export const (\w+) = (query|mutation|action|internalQuery|internalMutation)\(\{[\s\S]*?handler: async \([^)]*\)[^{]*\{([\s\S]*?)\n {2}\},\n\}\);/g;
    const publicFns = [...s.matchAll(re)].filter((m) => m[2] === "query" || m[2] === "mutation" || m[2] === "action");
    expect(publicFns.length).toBeGreaterThanOrEqual(7);
    for (const [, fn, , body] of publicFns) expect(/requireWorkspaceBilling|contextFor|setCancel\(/.test(body!), fn).toBe(true);
    // The contexts the actions use check it too.
    expect(/billingContext = internalQuery[\s\S]*?requireWorkspaceBilling/.test(s)).toBe(true);
    expect(/setLocalCancel = internalMutation[\s\S]*?requireWorkspaceBilling/.test(s)).toBe(true);
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
