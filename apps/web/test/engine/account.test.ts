// Revision 6 through the bridge host: the account for the switcher, the native Settings sections and their
// changes, sharing and public links, invitation links, and the web pages native shows with its own bars.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeHost } from "@/lib/engine/host";
import { resetNoteHost } from "@/lib/engine/noteHost";
import { resetGates } from "@/lib/engine/gates";
import type { AccountDetails, AiSettings, NotificationSettings, Reply, SharingValue } from "@/lib/engine/protocol";
import { Posts, rig, type Rig } from "./fakes";

const PLACE = "acct:user_1";
let host: BridgeHost;
let r: Rig;
let n = 0;
const send = async (m: Record<string, unknown>) => JSON.parse(await host.handle(JSON.stringify({ v: 1, id: String(++n), ...m }))) as Reply;
const ok = async (m: Record<string, unknown>) => {
  const reply = await send(m);
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.value;
};
const code = async (m: Record<string, unknown>) => {
  const reply = await send(m);
  return reply.ok ? null : reply.error.code;
};
const query = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "query", place: PLACE, name, args });
const command = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "command", place: PLACE, name, args });

beforeEach(() => {
  host = new BridgeHost({ post: new Posts().post, schedule: () => undefined, marker: { platform: "ios", protocol: 1, place: PLACE }, queryTimeoutMs: 50 });
  r = rig(PLACE);
  host.attach(r.deps());
  n = 0;
});
afterEach(() => {
  host.dispose();
  resetNoteHost();
  resetGates();
});

describe("account and Settings", () => {
  it("account.details: plan, storage and spaces", async () => {
    r.client.answer("billing:mine", { storageUsedBytes: 5, storageLimitBytes: 50, devicesActive: 2 });
    const v = (await query("account.details")) as AccountDetails;
    expect(v.plan).toEqual({ tier: "pro", id: "personal_pro_month", paid: true, trialing: false, trialEndsAt: null, ai: true });
    expect(v.storage).toEqual({ usedBytes: 5, limitBytes: 50 });
    expect(v.deviceLimit).toBe(5);
    expect(v.spaces.find((s) => s.id === "ws1")).toMatchObject({ name: "Studio", storage: { usedBytes: 100, limitBytes: 1000 } });
  });

  it("the native sections read the profile", async () => {
    expect(await query("settings.account")).toEqual({ name: "Faisal", email: "f@example.com", avatarUrl: null, timeZone: "UTC" });
    expect(await query("settings.general")).toEqual({ timeZone: "UTC", locale: "en", reviewAppEdits: false });
    expect(await query("settings.appearance")).toMatchObject({ appearance: "system", editorZoom: 1 });
    const notes = (await query("settings.notifications")) as NotificationSettings;
    expect(notes.topics.find((t) => t.id === "comments")).toMatchObject({ inApp: false, email: true });
    expect(notes.topics.find((t) => t.id === "replies")).toMatchObject({ inApp: true, email: true });
    const ai = (await query("settings.ai")) as AiSettings;
    expect(ai).toMatchObject({ included: true, enabled: true, memory: false, deviceText: true });
    r.client.answer("users:listSessions", [{ id: "s1", label: "iPhone", client: "ios", current: true, lastSeenAt: 9, extra: 1 }]);
    expect(await query("settings.security")).toMatchObject({ sessions: [{ id: "s1", label: "iPhone", client: "ios", current: true, lastSeenAt: 9 }] });
  });

  it("changes go through users.updateProfile with the whole notification prefs", async () => {
    await command("settings.update", { name: " Faisal I ", appearance: "dark" });
    expect(r.client.mutations.at(-1)).toEqual({ name: "users:updateProfile", args: { displayName: "Faisal I", appearance: "dark" } });
    await command("settings.setAiPref", { key: "memory", on: true });
    expect(r.client.mutations.at(-1)!.args).toEqual({ aiPrefs: { memory: true } });
    await command("settings.setNotificationTopic", { topic: "shares", email: false, inApp: false });
    expect(r.client.mutations.at(-1)!.args).toEqual({
      notificationPrefs: { mentions: true, comments: true, shares: false, invites: false, digest: "off", productEmail: false, inApp: { comments: false, replies: true, mentions: true, shares: false, access: true, reminders: true } },
    });
    await command("settings.setNotificationEmails", { digest: "daily" });
    expect((r.client.mutations.at(-1)!.args.notificationPrefs as { digest: string }).digest).toBe("daily");
    expect(await code({ kind: "command", place: PLACE, name: "settings.update", args: {} })).toBe("invalid_args");
    expect(await code({ kind: "command", place: PLACE, name: "settings.setAiPref", args: { key: "telepathy", on: true } })).toBe("invalid_args");
    await command("session.revoke", { id: "s2" });
    expect(r.client.mutations.at(-1)).toEqual({ name: "users:revokeSession", args: { sessionId: "s2" } });
  });
});

describe("sharing and invitations", () => {
  it("sharing.get and its commands", async () => {
    r.client.answer("sharing:get", { accessMode: "workspace", yourAccess: "manage", canManage: true, canShare: true, maxRole: "editor", youAreGuest: false, ownerName: "F", sharedBy: null, people: [{ profileId: "p1", displayName: "Lee", email: null, role: "viewer", guest: true, isYou: false, canChange: true }], pendingInvites: [], links: [], publicLinksAvailable: true });
    r.client.answer("documents:get", { document: { sealed: { x: 1 } } });
    const v = (await query("sharing.get", { id: "d1" })) as SharingValue;
    expect(v).toMatchObject({ noteId: "d1", encrypted: true, people: [{ profileId: "p1", name: "Lee", role: "viewer" }] });
    r.client.mutate = (name) => (name === "sharing:grant" ? { status: "shared" } : name === "sharing:createPublicLink" ? { id: "l1", token: "abc" } : name === "sharing:acceptPageInvite" ? { documentId: "d5" } : name === "workspaces:acceptInvite" ? { workspaceId: "ws1" } : null);
    expect(await command("sharing.invite", { noteId: "d1", email: "a@b.c", role: "viewer" })).toEqual({ status: "shared" });
    expect(await code({ kind: "command", place: PLACE, name: "sharing.invite", args: { noteId: "d1", email: "a@b.c", role: "owner" } })).toBe("invalid_args");
    r.client.answer("documents:get", { document: {} });
    expect(await command("publicLink.create", { noteId: "d1", theme: "docs" })).toEqual({ id: "l1", url: "https://app.folevi.com/s/abc" });
    await command("sharing.setAccessMode", { noteId: "d1", mode: "restricted" });
    await command("sharing.revoke", { noteId: "d1", profileId: "p1" });
    await command("publicLink.revoke", { linkId: "l1" });
    expect(await command("invite.acceptLink", { kind: "page", token: "t" })).toEqual({ noteId: "d5", space: null, folderId: null });
    expect(await command("invite.acceptLink", { kind: "workspace", token: "t" })).toEqual({ noteId: null, space: "ws1", folderId: null });
  });

  it("invite.preview for a workspace and an expired page invitation", async () => {
    r.client.answer("workspaces:previewInvite", { valid: true, workspaceName: "Studio", inviterName: "Sam", roleLabel: "Member", emailMatches: true, role: "member", memberAccess: "edit" });
    expect(await query("invite.preview", { kind: "workspace", token: "t" })).toEqual({ valid: true, kind: "workspace", inviterName: "Sam", name: "Studio", roleLabel: "Member", emailMatches: true });
    r.client.answer("sharing:previewPageInvite", { valid: false });
    expect(await query("invite.preview", { kind: "page", token: "t" })).toEqual({ valid: false, kind: "page", inviterName: null, name: null, roleLabel: null, emailMatches: false });
  });
});

describe("web pages", () => {
  it("web.show opens the page's route in place", async () => {
    expect(await ok({ kind: "editor", name: "web.show", args: { page: "settings.connectedApps" } })).toEqual({ id: "settings.connectedApps", ready: true });
    expect(await ok({ kind: "editor", name: "web.show", args: { page: "reviews" } })).toEqual({ id: "reviews", ready: true });
    expect(r.navigations).toEqual(["/settings/connected-apps", "/review"]);
    expect(await code({ kind: "editor", name: "web.show", args: { page: "settings.billing" } })).toBe("invalid_args");
  });
});
