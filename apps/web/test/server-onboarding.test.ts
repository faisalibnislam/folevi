// Folevi Server onboarding: the admin Overview's first-run checklist and warnings, the "home only" address check
// for Connect your apps, and the web sign-up that signs a new server account in.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { checklistFinished, checklistItems } from "@/components/admin/server/checklist";
import { healthNotes } from "@/components/admin/server/health";
import { isHomeOnlyAddress } from "@/components/server/ConnectApps";
import type { ServerSettings } from "@/lib/server-edition/refs";
import type { BackupList, ControlStatus } from "@/components/admin/server/types";

const auth = vi.hoisted(() => ({ signUp: vi.fn(), signIn: vi.fn() }));
vi.mock("@/lib/auth/client", () => ({ authClient: { signUp: { email: auth.signUp }, signIn: { email: auth.signIn } } }));
import { serverSignUp } from "@/lib/server-edition/signUp";

const GB = 1024 ** 3;
function settings(over: Partial<ServerSettings> = {}): ServerSettings {
  return {
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
    ownerUserId: "p1",
    ...over,
  };
}
const backups = (over: Partial<BackupList> = {}): BackupList => ({ backups: [], schedule: { enabled: true, hour: 3, keep: 14, target: { kind: "local" } }, ...over });
const status = (over: Partial<ControlStatus> = {}): ControlStatus => ({
  version: "1.6.0",
  uptimeSeconds: 600,
  publicUrl: "http://192.168.1.20:8460",
  services: [
    { name: "folevid", state: "running", restarts: 0 },
    { name: "backend", state: "running", restarts: 0 },
    { name: "web", state: "running", restarts: 0 },
  ],
  disk: { dataBytes: 1 * GB, freeBytes: 500 * GB },
  memory: { totalBytes: 16 * GB, availableBytes: 10 * GB, profile: "high", low: false },
  ...over,
});

describe("first-run checklist", () => {
  test("a fresh server has everything but the owner to do", () => {
    const items = checklistItems({ settings: settings(), people: 1, invites: 0, backups: backups() });
    expect(items.map((i) => [i.id, i.state])).toEqual([
      ["name", "todo"],
      ["owner", "done"],
      ["remote", "todo"],
      ["email", "todo"],
      ["backups", "todo"],
      ["invite", "todo"],
      ["apps", "todo"],
    ]);
    expect(checklistFinished(items, settings())).toBe(false);
  });

  test("skipped steps count as finished, and the checklist goes away", () => {
    const s = settings({ name: "Smith family", setup: { remote: 1, email: 1, backups: 1, backupKey: 1, invite: 1, apps: 1 } });
    const items = checklistItems({ settings: s, people: 1, invites: 0, backups: backups() });
    expect(items.find((i) => i.id === "email")!.state).toBe("skipped");
    expect(items.find((i) => i.id === "backups")!.state).toBe("done");
    expect(checklistFinished(items, s)).toBe(true);
  });

  test("what Folevi can see is done without the owner saying so", () => {
    const s = settings({ name: "Smith family", email: { mode: "smtp" } });
    const items = checklistItems({ settings: s, people: 3, invites: 0, backups: backups(), remote: { publicUrl: "x", connect: { state: "linked" }, upnp: { state: "off" }, relay: { enabled: true, connected: true } } });
    expect(Object.fromEntries(items.map((i) => [i.id, i.state]))).toMatchObject({ name: "done", remote: "done", email: "done", invite: "done", backups: "todo", apps: "todo" });
  });

  test("the backup step needs the key saved, and nightly backups on", () => {
    expect(checklistItems({ settings: settings({ setup: { backupKey: 1 } }), people: 1, invites: 0, backups: backups({ schedule: { enabled: false, hour: 3, keep: 14, target: { kind: "local" } } }) }).find((i) => i.id === "backups")!.state).toBe("todo");
  });

  test("hiding the checklist hides it", () => {
    const s = settings({ setup: { checklist: 1 } });
    expect(checklistFinished(checklistItems({ settings: s, people: 1, invites: 0 }), s)).toBe(true);
  });
});

describe("health warnings", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  test("a healthy server says nothing", () => {
    expect(healthNotes({ status: status(), backups: backups({ backups: [{ id: "a", createdAt: now - 3600e3, sizeBytes: 1, kind: "nightly" }] }), now })).toEqual([]);
  });

  test("a 2 GB NAS low on memory and disk, with a missed backup, not reachable and an update", () => {
    const notes = healthNotes({
      status: status({ memory: { totalBytes: 2 * GB, availableBytes: 0.1 * GB, profile: "tiny", low: true }, disk: { dataBytes: 3 * GB, freeBytes: 0.5 * GB } }),
      backups: backups({ backups: [{ id: "a", createdAt: now - 3 * 86400e3, sizeBytes: 1, kind: "nightly" }] }),
      remote: { publicUrl: "x", connect: { state: "off" }, upnp: { state: "off" }, reachable: false, relay: { enabled: false, connected: false } },
      update: { current: "1.6.0", latest: "1.6.2", channel: "stable", managedBy: "store" },
      now,
    });
    expect(notes.map((n) => n.id)).toEqual(["disk-full", "memory-low", "backup-missed", "not-reachable", "update"]);
    expect(notes.every((n) => !n.body.includes("\u2014"))).toBe(true);
  });

  test("a small machine that is fine gets a calm note, not a warning", () => {
    const notes = healthNotes({ status: status({ memory: { totalBytes: 2 * GB, availableBytes: 0.9 * GB, profile: "tiny", low: false } }), now });
    expect(notes).toEqual([expect.objectContaining({ id: "memory-small", tone: "neutral" })]);
  });

  test("a stopped part and backups turned off", () => {
    const notes = healthNotes({ status: status({ services: [{ name: "backend", state: "stopped", restarts: 5 }] }), backups: backups({ schedule: { enabled: false, hour: 3, keep: 14, target: { kind: "local" } } }), now });
    expect(notes.map((n) => [n.id, n.tone])).toEqual([
      ["service-down", "danger"],
      ["backups-off", "warning"],
    ]);
  });
});

describe("Connect your apps", () => {
  test("home-network addresses", () => {
    for (const a of ["http://192.168.1.20:8460", "http://10.0.0.5:8460", "http://nas.local:8460", "http://diskstation:8460", "http://100.80.1.2:8460"]) expect(isHomeOnlyAddress(a)).toBe(true);
    for (const a of ["https://abc123.folevi.app", "https://notes.example.com", "http://203.0.113.9:8460"]) expect(isHomeOnlyAddress(a)).toBe(false);
  });
});

describe("server sign-up", () => {
  beforeEach(() => {
    auth.signUp.mockReset();
    auth.signIn.mockReset();
  });
  const input = { name: "Sam", email: "sam@example.com", password: "Sam keeps 4 green kayaks", callbackURL: "/join/welcome", inviteToken: "tok12345678" };

  test("signs in after a sign-up that returned no session (email off)", async () => {
    auth.signUp.mockResolvedValue({ data: { token: null, user: { emailVerified: true } }, error: null });
    auth.signIn.mockResolvedValue({ data: {}, error: null });
    expect(await serverSignUp(input)).toEqual({ error: null, needsConfirmation: false });
    expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ fetchOptions: { headers: { "x-folevi-invite": "tok12345678" } } }));
    expect(auth.signIn).toHaveBeenCalledWith({ email: "sam@example.com", password: input.password });
  });

  test("an unverified account waits for its email link", async () => {
    auth.signUp.mockResolvedValue({ data: { token: null, user: { emailVerified: false } }, error: null });
    expect(await serverSignUp(input)).toEqual({ error: null, needsConfirmation: true });
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  test("a refused sign-up returns its error", async () => {
    auth.signUp.mockResolvedValue({ data: null, error: { code: "SIGNUP_INVITE_ONLY" } });
    expect((await serverSignUp(input)).error).toEqual({ code: "SIGNUP_INVITE_ONLY" });
  });
});
