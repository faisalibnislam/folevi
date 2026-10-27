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
    const allowPublic = new Set(["users.ts:me", "settings.ts:status", "settings.ts:ping", "sharing.ts:openPublicLink", "vaultShares.ts:openLink", "authEmails.ts:devMailbox", "users.ts:bootstrap", "users.ts:registerSession", "users.ts:heartbeat", "users.ts:listSessions", "users.ts:revokeOtherSessions", "themes.ts:list"]);
    for (const { p, s } of sources) {
      // The Better Auth component's functions are only reachable from Folevi's own functions, never the internet.
      if (p.includes("/betterAuth/")) continue;
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
    for (const { p, s: source } of sources) {
      // The E2EE validators name the passphrase KDF a device used (docs/E2EE_DESIGN.md §4.7.3); the server
      // only stores its parameters and never runs it. That one literal is the only exception.
      const s = p.endsWith(join("lib", "e2ee", "validators.ts")) ? source.replace('v.literal("argon2id")', "") : source;
      if (/bcrypt|scrypt|argon2|hmac-sha1|base32/i.test(s) && !p.includes("betterAuth")) throw new Error(`${p}: credential crypto should come from Better Auth`);
    }
  });

  test("end-to-end encryption: the server may seal but never opens (docs/E2EE_DESIGN.md §11.2)", () => {
    const opening = /\b(openRecord|openSealed|openFileStream|openFileStreamRange|passphraseWrapKey|recoveryWrapKey|prfWrapKey|linkWrapKey|deriveAccountKeys|deriveSpaceKeys|deriveNoteKeys)\b/;
    for (const { p, s } of sources) {
      if (!/@folevi\/local-store\/e2ee/.test(s)) continue;
      for (const m of s.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"@folevi\/local-store\/e2ee"/g)) {
        if (opening.test(m[1]!)) throw new Error(`${p}: imports a function that opens sealed data or derives keys`);
      }
      if (/import\s*\*\s*as\s+\w+\s+from\s*"@folevi\/local-store\/e2ee"/.test(s)) throw new Error(`${p}: namespace import of @folevi/local-store/e2ee (import only the sealing functions by name)`);
    }
    // The KDF never runs here: nothing in convex/ calls it.
    for (const { p, s } of sources) if (/argon2id(Async)?\(/.test(s)) throw new Error(`${p}: runs the passphrase KDF`);
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

  test("the Vault's log is append-only: written only by lib/vault/log.ts, deleted only by the 3-year expiry (docs/VAULT_PLAN.md §7.4)", () => {
    const allowed = [join("convex", "schema.ts"), join("lib", "vault", "log.ts"), join("convex", "vaultLog.ts")];
    for (const { p, s } of sources) {
      if (p.includes(`${join("convex", "_generated")}`)) continue;
      if (!/["']vaultLog["']/.test(s)) continue;
      if (!allowed.some((a) => p.endsWith(a))) throw new Error(`${p}: touches the Vault's log; only lib/vault/log.ts writes it and vaultLog.ts reads and expires it`);
    }
    const writer = sources.find(({ p }) => p.endsWith(join("lib", "vault", "log.ts")))!.s;
    expect(writer).not.toMatch(/\.delete\(|\.replace\(\s*\w+\.\_id/);
    expect([...writer.matchAll(/\.insert\(\s*"vaultLog"/g)]).toHaveLength(1);
    const reader = sources.find(({ p }) => p.endsWith(join("convex", "vaultLog.ts")))?.s ?? "";
    // One delete, in the expiry (entries past expiresAt); nothing patches an entry.
    expect([...reader.matchAll(/\.delete\(/g)].length).toBeLessThanOrEqual(1);
    if (/\.delete\(/.test(reader)) expect(reader).toMatch(/expiresAt/);
    expect(reader).not.toMatch(/\.patch\(/);
  });

  test("the Vault stays in its own modules: no other door reads it (docs/VAULT_PLAN.md §9, V9)", () => {
    const vaultModule = (p: string) => /[\\/]vault[A-Z]?\w*\.ts$/.test(p) || p.includes(join("lib", "vault"));
    // Only the Vault's own modules, the schema, scope's table list and account and workspace deletion name its tables.
    const allowed = (p: string) => vaultModule(p) || [join("convex", "schema.ts"), join("lib", "scope.ts"), join("convex", "maintenance.ts")].some((a) => p.endsWith(a));
    for (const { p, s } of sources) {
      if (p.includes(`${join("convex", "_generated")}`)) continue;
      if (/"vault[A-Z]\w*"|"vaults"/.test(s) && !allowed(p)) throw new Error(`${p}: names a Vault table; only the Vault's modules read its data`);
    }
    // Nothing that serves search, Foli AI, apps (MCP, REST, webhooks), exports, sync or email imports a Vault module.
    const doors = /[\\/](search|ai\w*|mcp\w*|api\w*|webhooks?|exports?|sync|emailNotes|aiExport|http)\.ts$/;
    for (const { p, s } of sources) {
      if (!doors.test(p)) continue;
      if (/from\s+"\.\/vault|from\s+"\.\/lib\/vault|from\s+"\.\.\/vault/.test(s)) throw new Error(`${p}: imports the Vault; it must never be reachable from here`);
    }
  });
});
