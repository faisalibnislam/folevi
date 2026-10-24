// Revision 6's views (docs/NATIVE_APP_PLAN.md sections 5.1, 5.10 and 5.11): the account for the switcher and
// Settings > Account, the Settings sections that are native (general, appearance, notifications, Foli AI's basics,
// security's sessions), a note's sharing, and invitation links. Settings read the profile the page already has
// (users.me), so they change the moment a setting is saved.
import { api } from "@/lib/convex/api";
import type { EngineDeps, ViewContext } from "./context";
import { source, type ValueViewDef } from "./views";
import { id, oneOf, only, text } from "./validate";
import type { AccountDetails, AiSettings, NotificationSettings, NotificationTopicSetting, SharingValue, ViewName } from "./protocol";

type Args = Record<string, unknown>;
const noArgs = (args: Args) => (only(args, []), {});

/** A view computed from the deps alone (the profile, the workspaces). */
function fromDeps(ctx: ViewContext, compute: (deps: EngineDeps) => unknown) {
  return { signals: [ctx.appSignal], compute: () => ({ value: compute(ctx.deps()), stale: false, error: null }) };
}

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---- account.details

type BillingData = { storageUsedBytes: number; storageLimitBytes: number | null; devicesActive: number };

export function accountDetails(deps: EngineDeps, billing: BillingData | undefined): AccountDetails {
  const p = deps.app.profileData;
  const e = (p.entitlements ?? null) as Record<string, unknown> | null;
  return {
    profile: deps.app.profile,
    plan: e ? { tier: str(e.plan, "free"), id: str(e.planId), paid: Boolean(e.paid), trialing: Boolean(e.trialing), trialEndsAt: num(e.trialEndsAt), ai: Boolean(e.ai) } : null,
    storage: billing ? { usedBytes: billing.storageUsedBytes, limitBytes: billing.storageLimitBytes ?? null } : null,
    devicesActive: billing?.devicesActive ?? null,
    deviceLimit: e ? num(e.devices) : null,
    spaces: deps.app.spaces.map((s) => {
      const w = s.kind === "workspace" ? deps.app.workspaceData[s.id] : undefined;
      const used = num(w?.storageUsedBytes);
      return {
        id: s.id,
        kind: s.kind,
        name: s.name,
        logoUrl: (w?.logoUrl as string | null | undefined) ?? (s.kind === "personal" ? deps.app.profile.avatarUrl : null),
        role: s.role,
        storage: s.kind === "personal" ? (billing ? { usedBytes: billing.storageUsedBytes, limitBytes: billing.storageLimitBytes ?? null } : null) : used === null ? null : { usedBytes: used, limitBytes: num(w?.storageQuotaBytes) },
      };
    }),
  };
}

const accountDetailsView: ValueViewDef = {
  kind: "value",
  parse: noArgs,
  create: (ctx) => {
    const billing = ctx.deps().app.mode === "account" ? source<BillingData>(ctx, api.billing.mine, {}, null) : null;
    return {
      signals: [ctx.appSignal, ...(billing ? [billing] : [])],
      compute: () => {
        const b = billing?.snapshot();
        return { value: accountDetails(ctx.deps(), b?.value), stale: Boolean(b?.stale && b.value), error: null };
      },
    };
  },
};

// ---- settings sections

const settingsAccount: ValueViewDef = {
  kind: "value",
  parse: noArgs,
  create: (ctx) => fromDeps(ctx, (d) => ({ name: d.app.profile.name, email: d.app.profile.email, avatarUrl: d.app.profile.avatarUrl, timeZone: d.app.timeZone })),
};

const settingsGeneral: ValueViewDef = {
  kind: "value",
  parse: noArgs,
  create: (ctx) => fromDeps(ctx, (d) => ({ timeZone: d.app.timeZone, locale: str(d.app.profileData.locale, "en"), reviewAppEdits: d.app.profileData.reviewAppEdits === true })),
};

const settingsAppearance: ValueViewDef = {
  kind: "value",
  parse: noArgs,
  create: (ctx) => fromDeps(ctx, (d) => ({ appearance: d.app.appearance })),
};

/** The topics of Settings > Notifications (components/views/settings/NotificationsSection.tsx ROWS). */
export const NOTIFICATION_TOPICS: { id: string; label: string; hint: string }[] = [
  { id: "comments", label: "Comments", hint: "On notes you created or follow" },
  { id: "replies", label: "Replies", hint: "In comment threads you took part in" },
  { id: "mentions", label: "Mentions", hint: "When someone @mentions you in a note or a comment" },
  { id: "shares", label: "Shares and invitations", hint: "Pages shared with you and workspace invitations" },
  { id: "access", label: "Access changes", hint: "When your access to a page or workspace changes" },
  { id: "reminders", label: "Task reminders", hint: "When a reminder you set on a to-do is due. The email shows that to-do line." },
];

export type NotificationPrefs = { mentions: boolean; comments: boolean; shares: boolean; invites: boolean; digest: string; productEmail: boolean; replies?: boolean; access?: boolean; reminders?: boolean; inApp?: Record<string, boolean> };

/** The email switch for a topic (replies and access changes follow comments and shares until set), as the web reads it. */
export function topicEmail(prefs: NotificationPrefs, topic: string): boolean {
  switch (topic) {
    case "comments":
      return prefs.comments;
    case "replies":
      return prefs.replies ?? prefs.comments;
    case "mentions":
      return prefs.mentions;
    case "shares":
      return prefs.shares && prefs.invites;
    case "access":
      return prefs.access ?? prefs.shares;
    case "reminders":
      return prefs.reminders ?? true;
    default:
      return false;
  }
}

/** The change to the stored prefs for a topic's email switch (shares turns invites with it, as on the web). */
export function topicEmailPatch(topic: string, on: boolean): Partial<NotificationPrefs> {
  return topic === "shares" ? { shares: on, invites: on } : { [topic]: on };
}

export function notificationSettings(prefs: NotificationPrefs): NotificationSettings {
  const topics: NotificationTopicSetting[] = NOTIFICATION_TOPICS.map((t) => ({ ...t, inApp: prefs.inApp?.[t.id] ?? true, email: topicEmail(prefs, t.id) }));
  return { topics, digest: prefs.digest ?? "off", productEmail: Boolean(prefs.productEmail) };
}

const settingsNotifications: ValueViewDef = {
  kind: "value",
  parse: noArgs,
  create: (ctx) => fromDeps(ctx, (d) => notificationSettings((d.app.profileData.notificationPrefs ?? { mentions: true, comments: true, shares: true, invites: true, digest: "off", productEmail: false }) as NotificationPrefs)),
};

export function aiSettings(deps: EngineDeps): AiSettings {
  const p = deps.app.profileData;
  const prefs = (p.aiPrefs ?? {}) as Partial<Record<string, boolean>>;
  const on = (k: string, fallback: boolean) => (typeof prefs[k] === "boolean" ? (prefs[k] as boolean) : fallback);
  const e = (p.entitlements ?? null) as Record<string, unknown> | null;
  return {
    included: e ? Boolean(e.ai) : deps.app.capabilities.ai,
    enabled: p.aiEnabled !== false,
    history: on("history", true),
    memory: on("memory", true),
    suggestions: on("suggestions", true),
    attachments: on("attachments", true),
    webResearch: on("webResearch", true),
    digests: on("digests", false),
    readImages: on("readImages", false),
    deviceText: on("deviceText", true),
  };
}

const settingsAi: ValueViewDef = { kind: "value", parse: noArgs, create: (ctx) => fromDeps(ctx, aiSettings) };

type SessionData = { id: string; label: string; client: string; current: boolean; lastSeenAt: number }[];

const settingsSecurity: ValueViewDef = {
  kind: "value",
  parse: noArgs,
  create: (ctx) => {
    if (ctx.deps().app.mode === "local") return { signals: [], compute: () => ({ value: { sessions: [] }, stale: false, error: null }) };
    const src = source<SessionData>(ctx, api.users.listSessions, {}, null);
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        return { value: s.value === undefined ? undefined : { sessions: s.value.map((x) => ({ id: x.id, label: x.label, client: x.client, current: x.current, lastSeenAt: x.lastSeenAt })) }, stale: s.stale, error: null };
      },
    };
  },
};

// ---- sharing.get

type SharingData = {
  accessMode: string;
  yourAccess: string;
  canManage: boolean;
  canShare: boolean;
  maxRole: string | null;
  youAreGuest: boolean;
  ownerName: string;
  sharedBy: string | null;
  people: { profileId: string; displayName: string; email: string | null; role: string; guest: boolean; isYou: boolean; canChange: boolean }[];
  pendingInvites: { id: string; email: string; role: string; expiresAt: number; expired: boolean }[];
  links: { id: string; tokenHint: string; expiresAt: number | null; expired: boolean; hasPassword: boolean; allowIndexing: boolean; theme: string; viewCount: number; createdAt: number; encrypted?: true }[];
  publicLinksAvailable: boolean;
};

export function sharingValue(noteId: string, d: SharingData, encrypted: boolean): SharingValue {
  return {
    noteId,
    accessMode: d.accessMode,
    yourAccess: d.yourAccess,
    canManage: d.canManage,
    canShare: d.canShare,
    maxRole: d.maxRole ?? null,
    youAreGuest: d.youAreGuest,
    ownerName: d.ownerName,
    sharedBy: d.sharedBy ?? null,
    people: d.people.map((p) => ({ profileId: p.profileId, name: p.displayName, email: p.email ?? null, role: p.role, guest: p.guest, isYou: p.isYou, canChange: p.canChange })),
    invites: d.pendingInvites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, expired: i.expired })),
    links: d.links.map((l) => ({ id: l.id, tokenHint: l.tokenHint, expiresAt: l.expiresAt ?? null, expired: l.expired, hasPassword: l.hasPassword, allowIndexing: l.allowIndexing, theme: l.theme, viewCount: l.viewCount, createdAt: l.createdAt, encrypted: Boolean(l.encrypted) })),
    publicLinksAvailable: d.publicLinksAvailable,
    encrypted,
  };
}

const sharingGet: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, ["id"]), { id: id(args, "id") }),
  create: (ctx, args) => {
    const noteId = args.id as string;
    const src = source<SharingData>(ctx, api.sharing.get, { documentId: noteId }, null);
    const meta = source<{ document: { sealed?: unknown; locked?: true } } | null>(ctx, api.documents.get, { documentId: noteId }, null);
    return {
      signals: [src, meta],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        const doc = meta.snapshot().value?.document;
        return { value: s.value === undefined ? undefined : sharingValue(noteId, s.value, Boolean(doc?.sealed || doc?.locked)), stale: s.stale, error: null };
      },
    };
  },
};

// ---- invite.preview

type WorkspaceInvitePreview = { valid: false } | { valid: true; workspaceName: string; inviterName: string; roleLabel: string; emailMatches: boolean };
type PageInvitePreview = { valid: false } | { valid: true; emailMatches: boolean; inviterName: string; title: string | null; roleLabel: string };

const invitePreview: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["kind", "token"]);
    return { kind: oneOf(args, "kind", ["workspace", "page"] as const), token: text(args, "token", { max: 200 }) as string };
  },
  create: (ctx, args) => {
    const kind = args.kind as "workspace" | "page";
    const src = kind === "workspace" ? source<WorkspaceInvitePreview>(ctx, api.workspaces.previewInvite, { token: args.token }, null) : source<PageInvitePreview>(ctx, api.sharing.previewPageInvite, { token: args.token }, null);
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        const v = s.value as WorkspaceInvitePreview | PageInvitePreview | undefined;
        if (v === undefined) return { value: undefined, stale: true, error: null };
        if (!v.valid) return { value: { valid: false, kind, inviterName: null, name: null, roleLabel: null, emailMatches: false }, stale: false, error: null };
        const name = "workspaceName" in v ? v.workspaceName : (v as { title: string | null }).title;
        return { value: { valid: true, kind, inviterName: v.inviterName, name: name ?? null, roleLabel: v.roleLabel, emailMatches: v.emailMatches }, stale: s.stale, error: null };
      },
    };
  },
};

export const ACCOUNT_VALUE_VIEWS = {
  "account.details": accountDetailsView,
  "settings.account": settingsAccount,
  "settings.general": settingsGeneral,
  "settings.appearance": settingsAppearance,
  "settings.notifications": settingsNotifications,
  "settings.ai": settingsAi,
  "settings.security": settingsSecurity,
  "sharing.get": sharingGet,
  "invite.preview": invitePreview,
} satisfies Partial<Record<ViewName, ValueViewDef>>;
