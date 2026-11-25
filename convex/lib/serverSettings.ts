// Folevi Server's settings: one row in `serverSettings` (docs/self-hosting/CONTRACT.md §8), its defaults, the
// view admins read (secrets replaced by `{set}`), how a partial update merges, and the role mapping between
// server roles and the profile fields the cloud already has. Only the server edition reads or writes these.
//
// Secrets (SMTP and IMAP passwords, API keys, the Google client secret, the Unsplash key) are write-only:
// no public function ever returns them. Only internal functions that use them (sending mail, calling an AI
// provider) read them, inside the backend.
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------------------------------
// Stored shape
// ---------------------------------------------------------------------------------------------------

export const vSignUpMode = v.union(v.literal("invite"), v.literal("open"), v.literal("domains"));
export const vSignInMethods = v.object({ password: v.boolean(), passkey: v.boolean(), folevi: v.boolean(), google: v.boolean(), apple: v.boolean() });
export const vEmailMode = v.union(v.literal("off"), v.literal("folevi"), v.literal("smtp"));
export const vSmtpSecurity = v.union(v.literal("tls"), v.literal("starttls"), v.literal("none"));
export const vEmailInMode = v.union(v.literal("off"), v.literal("folevi"), v.literal("imap"));
export const vAiMode = v.union(v.literal("off"), v.literal("folevi"), v.literal("gemini"), v.literal("openai"));
export const vAiAllowed = v.union(v.literal("everyone"), v.literal("admins"));
export const vCoversMode = v.union(v.literal("off"), v.literal("folevi"), v.literal("unsplash"));
/** The roles a person can hold on a server (CONTRACT §7). */
export const vServerRole = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"), v.literal("guest"));
/** The roles an invite can give (the owner is never invited: ownership is transferred). */
export const vInvitableRole = v.union(v.literal("admin"), v.literal("member"), v.literal("guest"));

export const serverSettingsFields = {
  /** Always "server": the table holds one row. */
  key: v.literal("server"),
  name: v.string(),
  signUp: vSignUpMode,
  allowedDomains: v.array(v.string()),
  signIn: vSignInMethods,
  google: v.optional(v.object({ clientId: v.string(), clientSecret: v.optional(v.string()) })),
  publicLinks: v.boolean(),
  defaultQuotaBytes: v.optional(v.number()),
  email: v.object({
    mode: vEmailMode,
    smtp: v.optional(
      v.object({ host: v.string(), port: v.number(), security: vSmtpSecurity, username: v.optional(v.string()), password: v.optional(v.string()), from: v.string() }),
    ),
  }),
  emailIn: v.object({
    mode: vEmailInMode,
    imap: v.optional(v.object({ host: v.string(), port: v.number(), username: v.string(), password: v.optional(v.string()), folder: v.string() })),
  }),
  ai: v.object({
    mode: vAiMode,
    gemini: v.optional(v.object({ apiKey: v.optional(v.string()), model: v.optional(v.string()), embeddingModel: v.optional(v.string()) })),
    openai: v.optional(v.object({ baseUrl: v.string(), apiKey: v.optional(v.string()), model: v.string(), embeddingModel: v.optional(v.string()) })),
    allowed: vAiAllowed,
    monthlyLimitPerPerson: v.optional(v.number()),
  }),
  push: v.object({ relay: v.boolean() }),
  covers: v.object({ mode: vCoversMode, unsplashKey: v.optional(v.string()) }),
  ownerUserId: v.optional(v.id("profiles")),
  updatedAt: v.number(),
  updatedBy: v.optional(v.id("profiles")),
};

export const vServerSettings = v.object(serverSettingsFields);
export type ServerSettings = Infer<typeof vServerSettings>;
export type ServerRole = Infer<typeof vServerRole>;
export type InvitableRole = Infer<typeof vInvitableRole>;

/** A fresh server: invite-only, password and passkey sign-in, public links on, every outside service off. */
export function defaultServerSettings(now = 0): ServerSettings {
  return {
    key: "server",
    name: "Folevi",
    signUp: "invite",
    allowedDomains: [],
    signIn: { password: true, passkey: true, folevi: false, google: false, apple: false },
    publicLinks: true,
    email: { mode: "off" },
    emailIn: { mode: "off" },
    ai: { mode: "off", allowed: "everyone" },
    push: { relay: false },
    covers: { mode: "off" },
    updatedAt: now,
  };
}

export async function settingsRow(ctx: Ctx): Promise<Doc<"serverSettings"> | null> {
  return await ctx.db
    .query("serverSettings")
    .withIndex("by_key", (q) => q.eq("key", "server"))
    .first();
}

/** The settings in force: the stored row, or the defaults before anyone saved any. */
export async function readServerSettings(ctx: Ctx): Promise<ServerSettings> {
  const row = await settingsRow(ctx);
  if (!row) return defaultServerSettings();
  const { _id, _creationTime, ...rest } = row;
  void _id;
  void _creationTime;
  return rest;
}

/** Writes the whole settings row (creating it the first time). */
export async function writeServerSettings(ctx: MutationCtx, next: ServerSettings): Promise<void> {
  const row = await settingsRow(ctx);
  if (row) await ctx.db.replace(row._id, next);
  else await ctx.db.insert("serverSettings", next);
}

// ---------------------------------------------------------------------------------------------------
// What is set up
// ---------------------------------------------------------------------------------------------------

/** Whether email goes out at all. Email verification is required only then (CONTRACT §8). */
export function emailConfigured(s: ServerSettings): boolean {
  if (s.email.mode === "smtp") return Boolean(s.email.smtp?.host && s.email.smtp.from);
  if (s.email.mode === "folevi") return hasConnectToken();
  return false;
}

/** Whether Foli AI can answer: a mode other than "off" with what that mode needs. */
export function aiConfigured(s: ServerSettings): boolean {
  if (s.ai.mode === "gemini") return Boolean(s.ai.gemini?.apiKey);
  if (s.ai.mode === "openai") return Boolean(s.ai.openai?.baseUrl && s.ai.openai.model);
  if (s.ai.mode === "folevi") return hasConnectToken();
  return false;
}

/** The AI part of the settings the provider needs (keys included: backend only, never returned to a client). */
export function serverAiSettingsOf(s: ServerSettings) {
  return { mode: s.ai.mode, configured: aiConfigured(s), gemini: s.ai.gemini ?? null, openai: s.ai.openai ?? null };
}

/** Whether notifications to phones go through Folevi's push relay (it needs the Connect token). */
export function pushRelayOn(s: ServerSettings): boolean {
  return s.push.relay && hasConnectToken();
}

function hasConnectToken(): boolean {
  const t = (process.env.FOLEVI_CONNECT_TOKEN ?? "").trim();
  return Boolean(t && t !== "none");
}

// ---------------------------------------------------------------------------------------------------
// The admin view: secrets replaced by {set}
// ---------------------------------------------------------------------------------------------------

const isSet = (value: string | undefined) => ({ set: Boolean(value) });

/** The settings as `serverAdmin:getSettings` returns them: every secret is `{set: boolean}`. */
export function publicSettingsView(s: ServerSettings) {
  return {
    name: s.name,
    signUp: s.signUp,
    allowedDomains: s.allowedDomains,
    signIn: s.signIn,
    ...(s.google ? { google: { clientId: s.google.clientId, clientSecret: isSet(s.google.clientSecret) } } : {}),
    publicLinks: s.publicLinks,
    ...(s.defaultQuotaBytes !== undefined ? { defaultQuotaBytes: s.defaultQuotaBytes } : {}),
    email: {
      mode: s.email.mode,
      ...(s.email.smtp
        ? {
            smtp: {
              host: s.email.smtp.host,
              port: s.email.smtp.port,
              security: s.email.smtp.security,
              ...(s.email.smtp.username !== undefined ? { username: s.email.smtp.username } : {}),
              password: isSet(s.email.smtp.password),
              from: s.email.smtp.from,
            },
          }
        : {}),
    },
    emailIn: {
      mode: s.emailIn.mode,
      ...(s.emailIn.imap
        ? { imap: { host: s.emailIn.imap.host, port: s.emailIn.imap.port, username: s.emailIn.imap.username, password: isSet(s.emailIn.imap.password), folder: s.emailIn.imap.folder } }
        : {}),
    },
    ai: {
      mode: s.ai.mode,
      ...(s.ai.gemini
        ? {
            gemini: {
              apiKey: isSet(s.ai.gemini.apiKey),
              ...(s.ai.gemini.model ? { model: s.ai.gemini.model } : {}),
              ...(s.ai.gemini.embeddingModel ? { embeddingModel: s.ai.gemini.embeddingModel } : {}),
            },
          }
        : {}),
      ...(s.ai.openai
        ? {
            openai: {
              baseUrl: s.ai.openai.baseUrl,
              apiKey: isSet(s.ai.openai.apiKey),
              model: s.ai.openai.model,
              ...(s.ai.openai.embeddingModel ? { embeddingModel: s.ai.openai.embeddingModel } : {}),
            },
          }
        : {}),
      allowed: s.ai.allowed,
      ...(s.ai.monthlyLimitPerPerson !== undefined ? { monthlyLimitPerPerson: s.ai.monthlyLimitPerPerson } : {}),
    },
    push: s.push,
    covers: { mode: s.covers.mode, unsplashKey: isSet(s.covers.unsplashKey) },
    ...(s.ownerUserId ? { ownerUserId: s.ownerUserId as string } : {}),
    configured: { email: emailConfigured(s), ai: aiConfigured(s), pushRelay: pushRelayOn(s) },
    updatedAt: s.updatedAt,
  };
}

// ---------------------------------------------------------------------------------------------------
// Updates: a partial of §8, secrets write-only
// ---------------------------------------------------------------------------------------------------

/** A secret in an update: a string sets it, null clears it, left out keeps it. */
const vSecret = v.optional(v.union(v.string(), v.null()));

export const vSettingsPatch = v.object({
  name: v.optional(v.string()),
  signUp: v.optional(vSignUpMode),
  allowedDomains: v.optional(v.array(v.string())),
  signIn: v.optional(
    v.object({ password: v.optional(v.boolean()), passkey: v.optional(v.boolean()), folevi: v.optional(v.boolean()), google: v.optional(v.boolean()), apple: v.optional(v.boolean()) }),
  ),
  google: v.optional(v.union(v.null(), v.object({ clientId: v.optional(v.string()), clientSecret: vSecret }))),
  publicLinks: v.optional(v.boolean()),
  defaultQuotaBytes: v.optional(v.union(v.number(), v.null())),
  email: v.optional(
    v.object({
      mode: v.optional(vEmailMode),
      smtp: v.optional(
        v.object({
          host: v.optional(v.string()),
          port: v.optional(v.number()),
          security: v.optional(vSmtpSecurity),
          username: v.optional(v.union(v.string(), v.null())),
          password: vSecret,
          from: v.optional(v.string()),
        }),
      ),
    }),
  ),
  emailIn: v.optional(
    v.object({
      mode: v.optional(vEmailInMode),
      imap: v.optional(
        v.object({ host: v.optional(v.string()), port: v.optional(v.number()), username: v.optional(v.string()), password: vSecret, folder: v.optional(v.string()) }),
      ),
    }),
  ),
  ai: v.optional(
    v.object({
      mode: v.optional(vAiMode),
      gemini: v.optional(v.object({ apiKey: vSecret, model: v.optional(v.union(v.string(), v.null())), embeddingModel: v.optional(v.union(v.string(), v.null())) })),
      openai: v.optional(
        v.object({ baseUrl: v.optional(v.string()), apiKey: vSecret, model: v.optional(v.string()), embeddingModel: v.optional(v.union(v.string(), v.null())) }),
      ),
      allowed: v.optional(vAiAllowed),
      monthlyLimitPerPerson: v.optional(v.union(v.number(), v.null())),
    }),
  ),
  push: v.optional(v.object({ relay: v.optional(v.boolean()) })),
  covers: v.optional(v.object({ mode: v.optional(vCoversMode), unsplashKey: vSecret })),
});
export type SettingsPatch = Infer<typeof vSettingsPatch>;

/** Why a patch can't be applied, in words for the admin (the caller turns it into an invalid_argument). */
export class SettingsError extends Error {}

const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MAX_SECRET = 4096;
const MAX_MODEL = 200;

const secret = (next: string | null | undefined, current: string | undefined, label: string): string | undefined => {
  if (next === undefined) return current;
  if (next === null) return undefined;
  const value = next.trim();
  if (!value) return undefined;
  if (value.length > MAX_SECRET) throw new SettingsError(`${label} is too long.`);
  return value;
};

const optionalText = (next: string | null | undefined, current: string | undefined, label: string, max = MAX_MODEL): string | undefined => {
  if (next === undefined) return current;
  if (next === null) return undefined;
  const value = next.trim();
  if (!value) return undefined;
  if (value.length > max) throw new SettingsError(`${label} is too long.`);
  return value;
};

const port = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new SettingsError(`${label} must be a port number from 1 to 65535.`);
  return value;
};

/** The address in an SMTP From ("Name <a@b.c>" or "a@b.c"), or null. */
export function fromAddress(from: string): string | null {
  const m = /<([^<>]+)>\s*$/.exec(from);
  const addr = (m ? m[1]! : from).trim();
  return EMAIL_RE.test(addr) ? addr : null;
}

/** An http(s) base URL without a trailing slash, or an error. */
function baseUrl(value: string): string {
  const raw = value.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SettingsError("The AI service address must be a full address, like http://192.168.1.20:11434/v1.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SettingsError("The AI service address must start with http:// or https://.");
  if (url.username || url.password) throw new SettingsError("Put the AI service's key in the key field, not in its address.");
  return raw;
}

/**
 * The settings after a partial update. Validates every changed field; nothing is half-applied (it throws
 * SettingsError before anything is written).
 */
export function applySettingsPatch(current: ServerSettings, patch: SettingsPatch, now: number, actor?: Id<"profiles">): ServerSettings {
  const next: ServerSettings = structuredClone(current);
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name || name.length > 80) throw new SettingsError("The server's name must be 1 to 80 characters.");
    next.name = name;
  }
  if (patch.signUp !== undefined) next.signUp = patch.signUp;
  if (patch.allowedDomains !== undefined) {
    const domains = [...new Set(patch.allowedDomains.map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];
    if (domains.length > 100) throw new SettingsError("At most 100 email domains.");
    for (const d of domains) if (!HOSTNAME_RE.test(d)) throw new SettingsError(`"${d.slice(0, 80)}" isn't an email domain.`);
    next.allowedDomains = domains;
  }
  if (next.signUp === "domains" && next.allowedDomains.length === 0) throw new SettingsError("Add at least one email domain for sign-up by domain.");
  if (patch.signIn) next.signIn = { ...next.signIn, ...Object.fromEntries(Object.entries(patch.signIn).filter(([, value]) => value !== undefined)) };
  if (!next.signIn.password && !next.signIn.passkey && !next.signIn.folevi && !next.signIn.google && !next.signIn.apple) {
    throw new SettingsError("Keep at least one way to sign in.");
  }
  if (patch.google === null) next.google = undefined;
  else if (patch.google) {
    const clientId = patch.google.clientId !== undefined ? patch.google.clientId.trim() : next.google?.clientId;
    if (!clientId || clientId.length > 300) throw new SettingsError("Enter the Google client ID.");
    next.google = { clientId, clientSecret: secret(patch.google.clientSecret, next.google?.clientSecret, "The Google client secret") };
  }
  if (patch.publicLinks !== undefined) next.publicLinks = patch.publicLinks;
  if (patch.defaultQuotaBytes !== undefined) {
    if (patch.defaultQuotaBytes === null) next.defaultQuotaBytes = undefined;
    else {
      if (!Number.isFinite(patch.defaultQuotaBytes) || patch.defaultQuotaBytes < 0) throw new SettingsError("A storage quota can't be negative.");
      next.defaultQuotaBytes = Math.floor(patch.defaultQuotaBytes);
    }
  }
  if (patch.email) {
    if (patch.email.smtp) {
      const p = patch.email.smtp;
      const cur = next.email.smtp;
      const host = (p.host ?? cur?.host ?? "").trim().toLowerCase();
      const from = (p.from ?? cur?.from ?? "").trim();
      if (!host || host.length > 253 || /\s/.test(host)) throw new SettingsError("Enter the SMTP server's host name.");
      if (!from || from.length > 320 || !fromAddress(from)) throw new SettingsError('Enter the From address, like "Folevi <folevi@example.com>".');
      next.email.smtp = {
        host,
        port: port(p.port ?? cur?.port ?? 587, "The SMTP port"),
        security: p.security ?? cur?.security ?? "starttls",
        username: optionalText(p.username, cur?.username, "The SMTP user name", 320),
        password: secret(p.password, cur?.password, "The SMTP password"),
        from,
      };
    }
    if (patch.email.mode !== undefined) next.email.mode = patch.email.mode;
    if (next.email.mode === "smtp" && !next.email.smtp) throw new SettingsError("Enter the SMTP server's details first.");
  }
  if (patch.emailIn) {
    if (patch.emailIn.imap) {
      const p = patch.emailIn.imap;
      const cur = next.emailIn.imap;
      const host = (p.host ?? cur?.host ?? "").trim().toLowerCase();
      const username = (p.username ?? cur?.username ?? "").trim();
      if (!host || host.length > 253 || /\s/.test(host)) throw new SettingsError("Enter the IMAP server's host name.");
      if (!username || username.length > 320) throw new SettingsError("Enter the IMAP user name.");
      const folder = (p.folder ?? cur?.folder ?? "INBOX").trim() || "INBOX";
      next.emailIn.imap = { host, port: port(p.port ?? cur?.port ?? 993, "The IMAP port"), username, password: secret(p.password, cur?.password, "The IMAP password"), folder: folder.slice(0, 200) };
    }
    if (patch.emailIn.mode !== undefined) next.emailIn.mode = patch.emailIn.mode;
    if (next.emailIn.mode === "imap" && !next.emailIn.imap) throw new SettingsError("Enter the IMAP server's details first.");
  }
  if (patch.ai) {
    const a = patch.ai;
    if (a.gemini) {
      const cur = next.ai.gemini;
      next.ai.gemini = {
        apiKey: secret(a.gemini.apiKey, cur?.apiKey, "The Gemini API key"),
        model: optionalText(a.gemini.model, cur?.model, "The model name"),
        embeddingModel: optionalText(a.gemini.embeddingModel, cur?.embeddingModel, "The embedding model name"),
      };
    }
    if (a.openai) {
      const cur = next.ai.openai;
      const rawBase = a.openai.baseUrl ?? cur?.baseUrl;
      const model = (a.openai.model ?? cur?.model ?? "").trim();
      if (!rawBase) throw new SettingsError("Enter the AI service's address.");
      if (!model || model.length > MAX_MODEL) throw new SettingsError("Enter the model's name.");
      next.ai.openai = {
        baseUrl: baseUrl(rawBase),
        apiKey: secret(a.openai.apiKey, cur?.apiKey, "The API key"),
        model,
        embeddingModel: optionalText(a.openai.embeddingModel, cur?.embeddingModel, "The embedding model name"),
      };
    }
    if (a.allowed !== undefined) next.ai.allowed = a.allowed;
    if (a.monthlyLimitPerPerson !== undefined) {
      if (a.monthlyLimitPerPerson === null) next.ai.monthlyLimitPerPerson = undefined;
      else {
        if (!Number.isFinite(a.monthlyLimitPerPerson) || a.monthlyLimitPerPerson < 0 || a.monthlyLimitPerPerson > 1_000_000_000) throw new SettingsError("The monthly limit must be 0 or more.");
        next.ai.monthlyLimitPerPerson = Math.floor(a.monthlyLimitPerPerson);
      }
    }
    if (a.mode !== undefined) next.ai.mode = a.mode;
    if (next.ai.mode === "openai" && !next.ai.openai) throw new SettingsError("Enter the AI service's address and model first.");
  }
  if (patch.push?.relay !== undefined) next.push = { relay: patch.push.relay };
  if (patch.covers) {
    next.covers = {
      mode: patch.covers.mode ?? next.covers.mode,
      unsplashKey: secret(patch.covers.unsplashKey, next.covers.unsplashKey, "The Unsplash key"),
    };
    if (next.covers.mode === "unsplash" && !next.covers.unsplashKey) throw new SettingsError("Enter the Unsplash key first.");
  }
  // Drop undefined members so the row matches the stored validator exactly.
  next.updatedAt = now;
  next.updatedBy = actor;
  return stripUndefined(next);
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => [k, stripUndefined(x)])) as T;
  }
  return value;
}

/** Which fields a patch touched, for the audit record (names only; never a value of a secret). */
export function changedFields(patch: SettingsPatch): string[] {
  const out: string[] = [];
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, x] of Object.entries(obj)) {
      if (x === undefined) continue;
      const path = prefix ? `${prefix}.${k}` : k;
      if (x && typeof x === "object" && !Array.isArray(x)) walk(x as Record<string, unknown>, path);
      else out.push(path);
    }
  };
  walk(patch as Record<string, unknown>, "");
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------------------------------

/**
 * A person's server role, from the fields the cloud already has (CONTRACT §7): owner = platformRole
 * "super_admin", admin = "ops_admin", guest = serverGuest, everyone else a member.
 */
export function serverRoleOf(p: Pick<Doc<"profiles">, "platformRole" | "serverGuest">): ServerRole {
  if (p.platformRole === "super_admin") return "owner";
  if (p.platformRole === "ops_admin") return "admin";
  if (p.serverGuest) return "guest";
  return "member";
}

/** The profile fields for a role (the owner is only ever set by claimOwner and transferOwnership). */
export function roleFields(role: ServerRole): Pick<Doc<"profiles">, "platformRole" | "serverGuest"> {
  if (role === "owner") return { platformRole: "super_admin", serverGuest: undefined };
  if (role === "admin") return { platformRole: "ops_admin", serverGuest: undefined };
  if (role === "guest") return { platformRole: undefined, serverGuest: true };
  return { platformRole: undefined, serverGuest: undefined };
}

// ---------------------------------------------------------------------------------------------------
// Storage quotas
// ---------------------------------------------------------------------------------------------------

/** Everything a person stored on the server: their Personal plus what counts against them in workspaces. */
export async function storageUsedBy(ctx: Ctx, profile: Doc<"profiles">): Promise<number> {
  let total = profile.personalStorageUsedBytes ?? 0;
  const memberships = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .take(500);
  for (const m of memberships) {
    const row = await ctx.db
      .query("workspaceStorage")
      .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", m.workspaceId).eq("profileId", profile._id))
      .unique();
    total += row?.usedBytes ?? 0;
  }
  return total;
}

/** A person's quota: their own, else the server's default; undefined = no limit. */
export function quotaFor(profile: Pick<Doc<"profiles">, "serverQuotaBytes">, s: ServerSettings): number | undefined {
  return profile.serverQuotaBytes ?? s.defaultQuotaBytes;
}

// ---------------------------------------------------------------------------------------------------
// Sign-up rules
// ---------------------------------------------------------------------------------------------------

/** The part after "@", lowercased. */
export const emailDomain = (email: string) => email.trim().toLowerCase().split("@").pop() ?? "";

/** Whether an address may sign up under the domains rule. */
export function domainAllowed(email: string, s: ServerSettings): boolean {
  const domain = emailDomain(email);
  return s.allowedDomains.some((d) => domain === d);
}
