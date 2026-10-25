// Revision 6's commands (docs/NATIVE_APP_PLAN.md sections 5.10 and 5.11): Settings changes through
// users.updateProfile (the page's profile updates by itself), sessions, a note's sharing and public links,
// and invitation links.
import { api } from "@/lib/convex/api";
import { APP_URL } from "@/lib/env";
import type { EngineDeps } from "./context";
import type { CommandDef } from "./commands";
import { EDITOR_ZOOMS, setEditorZoom, topicEmailPatch, type NotificationPrefs } from "./viewsAccount";
import { BridgeError, bool, id, num, oneOf, only, text } from "./validate";
import { AI_PREF_KEYS, type CommandName } from "./protocol";

const THEMES = ["note", "article", "docs", "minimal"] as const;

/** A link on Folevi's own address (the apps' pages run on capacitor://localhost or app://folevi). */
export function onAppOrigin(url: string): string {
  const u = new URL(url);
  return `${APP_URL.replace(/\/$/, "")}${u.pathname}${u.search}${u.hash}`;
}
const ROLES = ["editor", "commenter", "viewer"] as const;
const TOPICS = ["comments", "replies", "mentions", "shares", "access", "reminders"] as const;

const prefsOf = (deps: EngineDeps) => (deps.app.profileData.notificationPrefs ?? { mentions: true, comments: true, shares: true, invites: true, digest: "off", productEmail: false }) as NotificationPrefs;

/** The prefs as the server stores them: every required field, the optional ones only when set. */
function fullPrefs(p: NotificationPrefs): Record<string, unknown> {
  const out: Record<string, unknown> = { mentions: p.mentions, comments: p.comments, shares: p.shares, invites: p.invites, digest: p.digest, productEmail: p.productEmail };
  for (const k of ["replies", "access", "reminders", "inApp"] as const) if (p[k] !== undefined) out[k] = p[k];
  return out;
}

export const ACCOUNT_COMMANDS = {
  "settings.update": {
    async run(deps, args) {
      only(args, ["name", "appearance", "timeZone", "reviewAppEdits", "aiEnabled", "editorZoom"]);
      const patch: Record<string, unknown> = {};
      // The editor's text size is this device's own (not the profile's).
      if (args.editorZoom !== undefined) {
        const z = num(args, "editorZoom", { min: 0.85, max: 1.35 });
        setEditorZoom(EDITOR_ZOOMS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a), 1));
        if (Object.keys(args).length === 1) return { ok: true };
      }
      if (args.name !== undefined) patch.displayName = (text(args, "name", { max: 80 }) as string).trim();
      if (args.appearance !== undefined) patch.appearance = oneOf(args, "appearance", ["system", "light", "dark"] as const);
      if (args.timeZone !== undefined) patch.timeZone = text(args, "timeZone", { max: 64 });
      if (args.reviewAppEdits !== undefined) patch.reviewAppEdits = bool(args, "reviewAppEdits");
      if (args.aiEnabled !== undefined) patch.aiEnabled = bool(args, "aiEnabled");
      if (!Object.keys(patch).length) throw new BridgeError("invalid_args", "Say what to change.");
      await deps.client.mutation(api.users.updateProfile, patch);
      return { ok: true };
    },
  },

  "settings.setAiPref": {
    async run(deps, args) {
      only(args, ["key", "on"]);
      const key = oneOf(args, "key", AI_PREF_KEYS);
      await deps.client.mutation(api.users.updateProfile, { aiPrefs: { [key]: bool(args, "on") } });
      return { ok: true };
    },
  },

  "settings.setNotificationTopic": {
    async run(deps, args) {
      only(args, ["topic", "inApp", "email"]);
      const topic = oneOf(args, "topic", TOPICS);
      const prefs = prefsOf(deps);
      let next: NotificationPrefs = { ...prefs };
      if (args.inApp !== undefined) next = { ...next, inApp: { comments: true, replies: true, mentions: true, shares: true, access: true, reminders: true, ...prefs.inApp, [topic]: bool(args, "inApp") } };
      if (args.email !== undefined) next = { ...next, ...topicEmailPatch(topic, bool(args, "email")) };
      if (args.inApp === undefined && args.email === undefined) throw new BridgeError("invalid_args", "Say what to change: inApp or email.");
      await deps.client.mutation(api.users.updateProfile, { notificationPrefs: fullPrefs(next) });
      return { ok: true };
    },
  },

  "settings.setNotificationEmails": {
    async run(deps, args) {
      only(args, ["digest", "productEmail"]);
      const next: NotificationPrefs = { ...prefsOf(deps) };
      if (args.digest !== undefined) next.digest = oneOf(args, "digest", ["off", "daily"] as const);
      if (args.productEmail !== undefined) next.productEmail = bool(args, "productEmail");
      if (args.digest === undefined && args.productEmail === undefined) throw new BridgeError("invalid_args", "Say what to change.");
      await deps.client.mutation(api.users.updateProfile, { notificationPrefs: fullPrefs(next) });
      return { ok: true };
    },
  },

  "settings.removeAvatar": {
    async run(deps, args) {
      only(args, []);
      await deps.client.mutation(api.users.removeAvatar, {});
      return { ok: true };
    },
  },

  "session.revoke": {
    async run(deps, args) {
      only(args, ["id"]);
      await deps.client.mutation(api.users.revokeSession, { sessionId: text(args, "id", { max: 200 }) as string });
      return { ok: true };
    },
  },

  "sharing.invite": {
    async run(deps, args) {
      only(args, ["noteId", "email", "role"]);
      const r = (await deps.client.mutation(api.sharing.grant, { documentId: id(args, "noteId"), email: text(args, "email", { max: 254 }) as string, role: oneOf(args, "role", ROLES) })) as { status: string };
      return { status: r.status };
    },
  },

  "sharing.revoke": {
    async run(deps, args) {
      only(args, ["noteId", "profileId"]);
      await deps.client.mutation(api.sharing.revoke, { documentId: id(args, "noteId"), profileId: id(args, "profileId") });
      return { ok: true };
    },
  },

  "sharing.cancelInvite": {
    async run(deps, args) {
      only(args, ["inviteId"]);
      await deps.client.mutation(api.sharing.revokePageInvite, { inviteId: id(args, "inviteId") });
      return { ok: true };
    },
  },

  "sharing.setAccessMode": {
    async run(deps, args) {
      only(args, ["noteId", "mode"]);
      await deps.client.mutation(api.sharing.setAccessMode, { documentId: id(args, "noteId"), mode: oneOf(args, "mode", ["workspace", "restricted"] as const) });
      return { ok: true };
    },
  },

  "publicLink.create": {
    // Standard notes only: an encrypted note's link wraps its key on the device (the note page's Share does it).
    async run(deps, args) {
      only(args, ["noteId", "expiresAt", "password", "allowIndexing", "theme", "plainCopy"]);
      const noteId = id(args, "noteId");
      // An encrypted note: the link wraps its key on this device (lib/e2ee/links.ts), or publishes a readable copy.
      const meta = (await deps.client.query(api.documents.get, { documentId: noteId }).catch(() => null)) as { document: { sealed?: unknown; locked?: true } } | null;
      if (meta?.document.sealed || meta?.document.locked) {
        const [links, { requireActiveRouter }] = await Promise.all([import("@/lib/e2ee/links"), import("@/lib/e2ee/router/active")]);
        const router = requireActiveRouter();
        const made = bool(args, "plainCopy", false)
          ? await links.publishPlainCopyWith(router, noteId)
          : await links.createEncryptedLinkWith(router, noteId, {
              ...(args.expiresAt !== undefined ? { expiresAt: num(args, "expiresAt", { min: 0 }) } : {}),
              ...(args.password !== undefined ? { password: text(args, "password", { max: 200 }) } : {}),
              ...(args.theme !== undefined ? { theme: oneOf(args, "theme", THEMES) } : {}),
            });
        return { id: made.linkId, url: onAppOrigin(made.url) };
      }
      const r = (await deps.client.mutation(api.sharing.createPublicLink, {
        documentId: noteId,
        ...(args.expiresAt !== undefined ? { expiresAt: num(args, "expiresAt", { min: 0 }) } : {}),
        ...(args.password !== undefined ? { password: text(args, "password", { max: 200 }) } : {}),
        ...(args.allowIndexing !== undefined ? { allowIndexing: bool(args, "allowIndexing") } : {}),
        ...(args.theme !== undefined ? { theme: oneOf(args, "theme", THEMES) } : {}),
      })) as { id: string; token: string };
      return { id: r.id, url: `${APP_URL.replace(/\/$/, "")}/s/${r.token}` };
    },
  },

  "publicLink.setTheme": {
    async run(deps, args) {
      only(args, ["linkId", "theme"]);
      await deps.client.mutation(api.sharing.setPublicLinkTheme, { linkId: id(args, "linkId"), theme: oneOf(args, "theme", THEMES) });
      return { ok: true };
    },
  },

  "publicLink.revoke": {
    async run(deps, args) {
      only(args, ["linkId"]);
      await deps.client.mutation(api.sharing.revokePublicLink, { linkId: id(args, "linkId") });
      return { ok: true };
    },
  },

  "invite.acceptLink": {
    async run(deps, args) {
      only(args, ["kind", "token"]);
      const kind = oneOf(args, "kind", ["workspace", "page", "folder"] as const);
      const token = text(args, "token", { max: 200 }) as string;
      if (kind === "folder") {
        const r = (await deps.client.mutation(api.folderSharing.acceptInvite, { token })) as { folderId: string };
        return { noteId: null, space: null, folderId: r.folderId };
      }
      if (kind === "page") {
        const r = (await deps.client.mutation(api.sharing.acceptPageInvite, { token })) as { documentId: string };
        return { noteId: r.documentId, space: null, folderId: null };
      }
      const r = (await deps.client.mutation(api.workspaces.acceptInvite, { token })) as { workspaceId?: string } | null;
      return { noteId: null, space: r?.workspaceId ?? null, folderId: null };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
