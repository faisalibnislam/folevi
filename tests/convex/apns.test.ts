// Push to the iPhone and iPad app through Apple's push service: registering a device token, what's sent
// (the payload, the headers, the signed JWT), Apple's answers (a gone token is removed, a busy Apple is
// tried again), and the reminders and mentions that send it. The HTTP/2 sender is replaced here, so no
// socket is ever opened.
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { apnsConfig, apnsOutcome, apnsPayload, apnsSetup, appPath, deliverWithRetry, pemOf } from "../../convex/lib/apns";
import { apnsJwt, forgetApnsJwt } from "../../convex/lib/apnsJwt";
import type { ApnsRequest, ApnsResponse } from "../../convex/lib/apnsHttp2";
import { inWorkspace, para, person, PERSONAL, setup, ulid, type T } from "./helpers";

const wire = vi.hoisted(() => ({ sent: [] as ApnsRequest[], answers: [] as ApnsResponse[], opened: 0, closed: 0 }));
vi.mock("../../convex/lib/apnsHttp2", () => ({
  createApnsClient: () => {
    wire.opened++;
    return {
      send: async (r: ApnsRequest) => {
        wire.sent.push(r);
        return wire.answers.shift() ?? { status: 200 };
      },
      close: () => void wire.closed++,
    };
  },
}));

type Person = Awaited<ReturnType<typeof person>>;

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const P8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const ENV = { APNS_KEY_ID: "ABC123DEFG", APNS_TEAM_ID: "TEAM123456", APNS_KEY: P8, APNS_BUNDLE_ID: "com.folevi.ios" };

const hex = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const device = (n: number, extra: Record<string, string> = {}) => ({ token: hex(n), environment: "sandbox" as const, bundleId: "com.folevi.ios", deviceId: `install-${n}-0000`, deviceName: "iPhone 18 Pro", ...extra });

function configure(on = true) {
  for (const [k, value] of Object.entries(ENV)) {
    if (on) process.env[k] = value;
    else delete process.env[k];
  }
}

beforeEach(() => {
  wire.sent = [];
  wire.answers = [];
  wire.opened = wire.closed = 0;
  forgetApnsJwt();
  configure();
});
afterEach(() => configure(false));

async function rows(t: T) {
  return await t.run(async (ctx) => await ctx.db.query("apnsTokens").collect());
}

async function scheduled(t: T, name: string) {
  return await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((j) => j.name.includes(name)).map((j) => j.args[0] as Record<string, unknown>));
}

/** A page in Personal with one to-do whose reminder is due. */
async function dueTodo(p: Person, text: string) {
  const docId = ulid();
  await p.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-apns", ops: [{ opId: ulid(), kind: "document.create", document: { id: docId, parentDocumentId: null, folderId: null, kind: "document", title: "House jobs", icon: null } }] as never });
  const todo = { ...para(ulid(), text), type: "todo", props: { checked: false, reminderAt: Date.now() - 1000 } };
  await p.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-apns", ops: [{ opId: ulid(), kind: "block.upsert", documentId: docId, block: todo, baseRevision: null, fields: ["content", "position"] }] as never });
  return { docId, blockId: todo.id };
}

async function setPrefs(t: T, p: Person, patch: Partial<Doc<"profiles">["notificationPrefs"]>) {
  await t.run(async (ctx) => {
    const row = (await ctx.db.get(p.profileId as Id<"profiles">))!;
    await ctx.db.patch(row._id, { notificationPrefs: { ...row.notificationPrefs, ...patch } });
  });
}

describe("APNs settings", () => {
  test("apnsAvailable is off without the key, on with all four variables", async () => {
    const t = setup();
    const a = await person(t, "apns-env@example.com");
    expect(await a.as.query(api.push.apnsAvailable, {})).toBe(true);
    configure(false);
    expect(await a.as.query(api.push.apnsAvailable, {})).toBe(false);
    process.env.APNS_KEY_ID = "ABC123DEFG";
    expect(await a.as.query(api.push.apnsAvailable, {})).toBe(false);
    expect(apnsSetup()).toBe("partial");
    delete process.env.APNS_KEY_ID;
    expect(apnsSetup()).toBe("none");
    await expect(t.query(api.push.apnsAvailable, {})).rejects.toThrow();
  });

  test("the key reads as pasted, with escaped newlines, or as a bare base64 body; APNS_ENV picks the default", () => {
    const body = P8.split("\n").filter((l) => l && !l.startsWith("-----")).join("");
    expect(pemOf(P8.replace(/\n/g, "\\n"))).toBe(P8.trim());
    expect(createPublicKey(pemOf(body)).export({ type: "spki", format: "pem" })).toBe(publicKey.export({ type: "spki", format: "pem" }));
    expect(apnsConfig({ ...ENV })?.environment).toBe("production");
    expect(apnsConfig({ ...ENV, APNS_ENV: "sandbox" })?.environment).toBe("sandbox");
    expect(apnsConfig({ ...ENV, APNS_KEY: "none" })).toBeNull();
  });
});

describe("registering a device", () => {
  test("needs a signed-in person, and checks what it's given", async () => {
    const t = setup();
    await expect(t.mutation(api.push.registerApns, device(1))).rejects.toThrow();
    const a = await person(t, "apns-check@example.com");
    await expect(a.as.mutation(api.push.registerApns, { ...device(1), token: "not-a-token" })).rejects.toThrow();
    await expect(a.as.mutation(api.push.registerApns, { ...device(1), deviceId: "x" })).rejects.toThrow();
    expect(await rows(t)).toHaveLength(0);
  });

  test("one row per token: registering again updates it, a new token for the device replaces it", async () => {
    const t = setup();
    const a = await person(t, "apns-one@example.com");
    await a.as.mutation(api.push.registerApns, device(1));
    await a.as.mutation(api.push.registerApns, { ...device(1), token: hex(1).toUpperCase(), environment: "production", deviceName: "iPhone 18 Pro Max" });
    let all = await rows(t);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ token: hex(1), environment: "production", deviceName: "iPhone 18 Pro Max" });
    expect(await a.as.query(api.push.apnsStatus, { deviceId: device(1).deviceId })).toEqual({ devices: 1, thisDevice: true });
    // The same install with a new token (iOS changed it): still one row, the new token.
    await a.as.mutation(api.push.registerApns, { ...device(1), token: hex(2) });
    all = await rows(t);
    expect(all.map((r) => r.token)).toEqual([hex(2)]);
    // Another device of theirs is a second row.
    await a.as.mutation(api.push.registerApns, device(3));
    expect((await a.as.query(api.push.apnsStatus, {})).devices).toBe(2);
  });

  test("a token signed in as someone else is theirs now; only the owner can remove one", async () => {
    const t = setup();
    const a = await person(t, "apns-a@example.com");
    const b = await person(t, "apns-b@example.com");
    await a.as.mutation(api.push.registerApns, device(4));
    await b.as.mutation(api.push.registerApns, device(4));
    expect((await a.as.query(api.push.apnsStatus, {})).devices).toBe(0);
    expect((await b.as.query(api.push.apnsStatus, { deviceId: device(4).deviceId })).thisDevice).toBe(true);
    await a.as.mutation(api.push.unregisterApns, { token: hex(4), deviceId: device(4).deviceId });
    expect(await rows(t)).toHaveLength(1);
    await b.as.mutation(api.push.unregisterApns, { token: hex(4) });
    expect(await rows(t)).toHaveLength(0);
  });

  test("a device with several accounts (docs/MULTI_ACCOUNT_PLAN.md §5.3): each keeps its registration, with its own label", async () => {
    const t = setup();
    const a = await person(t, "apns-multi-a@example.com");
    const b = await person(t, "apns-multi-b@example.com");
    await a.as.mutation(api.push.registerApns, { ...device(7), label: "a@example.com", keepOthers: true });
    await b.as.mutation(api.push.registerApns, { ...device(7), label: "b@example.com\u0007<x>", keepOthers: true });
    const both = await rows(t);
    expect(both).toHaveLength(2);
    expect(both.map((r) => r.label).sort()).toEqual(["a@example.com", "b@example.comx"]);
    // Signing out of one leaves the other.
    await a.as.mutation(api.push.unregisterApns, { deviceId: device(7).deviceId });
    expect((await rows(t)).map((r) => r.label)).toEqual(["b@example.comx"]);
    // Without keepOthers (one account on the device), someone else's registration goes, as before.
    await a.as.mutation(api.push.registerApns, device(7));
    expect(await rows(t)).toHaveLength(1);
  });

  test("signing out (by the app's install id) removes the device", async () => {
    const t = setup();
    const a = await person(t, "apns-out@example.com");
    await a.as.mutation(api.push.registerApns, device(5));
    await a.as.mutation(api.push.registerApns, device(6));
    await a.as.mutation(api.push.unregisterApns, { deviceId: device(5).deviceId });
    expect((await rows(t)).map((r) => r.token)).toEqual([hex(6)]);
  });
});

describe("sending", () => {
  const message = { kind: "reminder" as const, title: "Reminder: Take the bins out", body: "In House jobs", path: "/d/01JA2YQ8ABCDEFGHJKMNPQRSTV#block-01JA2Z5XABCDEFGHJKMNPQRSTV", threadId: "01JA2YQ8ABCDEFGHJKMNPQRSTV", taskId: "01JA2Z5XABCDEFGHJKMNPQRSTV", collapseId: "reminder:abc" };

  test("on a device with several accounts the payload names the account: a subtitle, and its user id", () => {
    const p = apnsPayload(message, 1, { label: "ana@example.com", place: "userAna" }) as { aps: { alert: Record<string, string> }; place?: string };
    expect(p.aps.alert.subtitle).toBe("ana@example.com");
    expect(p.place).toBe("userAna");
    expect((apnsPayload(message, 1) as { place?: string }).place).toBeUndefined();
  });

  test("the payload: alert, badge, thread, category, mutable content and the app path", () => {
    expect(apnsPayload(message, 3)).toEqual({
      aps: { alert: { title: "Reminder: Take the bins out", body: "In House jobs" }, sound: "default", badge: 3, "thread-id": message.threadId, category: "REMINDER", "mutable-content": 1 },
      kind: "reminder",
      path: message.path,
      taskId: message.taskId,
    });
    const mention = apnsPayload({ kind: "mention", title: "Sam mentioned you in Plan", path: "/d/01JA2YQ8ABCDEFGHJKMNPQRSTV" }, 0) as { aps: Record<string, unknown> };
    expect(mention.aps).toMatchObject({ category: "MENTION", badge: 0 });
    expect((mention.aps.alert as Record<string, string>).body).toBeUndefined();
    expect((apnsPayload({ kind: "routine", title: "Ready", path: "/d/x" }, 1) as { aps: Record<string, unknown> }).aps.category).toBeUndefined();
    expect(appPath("https://app.folevi.com/d/ABC#block-X")).toBe("/d/ABC#block-X");
    expect(appPath("//evil.example.com")).toBe("/documents");
    expect(appPath("javascript:alert(1)")).toBe("/documents");
  });

  test("the JWT: ES256 with the key id, the team as issuer, signed by the .p8 key, kept 50 minutes", () => {
    const now = Date.parse("2026-10-16T09:00:00Z");
    const jwt = apnsJwt(apnsConfig()!, now);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(JSON.parse(Buffer.from(c!, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: now / 1000 });
    expect(Buffer.from(s!, "base64url")).toHaveLength(64);
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"))).toBe(true);
    expect(apnsJwt(apnsConfig()!, now + 49 * 60_000)).toBe(jwt);
    expect(apnsJwt(apnsConfig()!, now + 51 * 60_000)).not.toBe(jwt);
    expect(apnsJwt(apnsConfig()!, now + 51 * 60_000, true)).not.toBe(jwt);
  });

  test("Apple's answers: sent, gone, tried again, a fresh JWT, or given up", async () => {
    expect(apnsOutcome({ status: 200 })).toBe("sent");
    expect(apnsOutcome({ status: 410, reason: "Unregistered" })).toBe("gone");
    expect(apnsOutcome({ status: 400, reason: "BadDeviceToken" })).toBe("gone");
    expect(apnsOutcome({ status: 400, reason: "DeviceTokenNotForTopic" })).toBe("gone");
    expect(apnsOutcome({ status: 429, reason: "TooManyRequests" })).toBe("retry");
    expect(apnsOutcome({ status: 503 })).toBe("retry");
    expect(apnsOutcome({ status: 0 })).toBe("retry");
    expect(apnsOutcome({ status: 403, reason: "ExpiredProviderToken" })).toBe("refresh");
    expect(apnsOutcome({ status: 400, reason: "PayloadTooLarge" })).toBe("failed");

    const pauses: number[] = [];
    const sleep = async (ms: number) => void pauses.push(ms);
    const answering = (...answers: { status: number; reason?: string }[]) => {
      const fresh: boolean[] = [];
      return { fresh, attempt: async (f: boolean) => (fresh.push(f), answers.shift() ?? { status: 200 }) };
    };
    // Busy, then fine: three tries at most, with pauses between.
    let a = answering({ status: 429 }, { status: 503 });
    expect(await deliverWithRetry(a.attempt, sleep)).toMatchObject({ outcome: "sent", attempts: 3 });
    expect(pauses).toEqual([1000, 4000]);
    a = answering({ status: 500 }, { status: 500 }, { status: 500 }, { status: 200 });
    expect(await deliverWithRetry(a.attempt, sleep)).toMatchObject({ outcome: "failed", attempts: 3 });
    // An expired JWT: once more with a new one, never twice.
    a = answering({ status: 403, reason: "ExpiredProviderToken" });
    expect(await deliverWithRetry(a.attempt, sleep)).toMatchObject({ outcome: "sent", attempts: 2 });
    expect(a.fresh).toEqual([false, true]);
    a = answering({ status: 403, reason: "ExpiredProviderToken" }, { status: 403, reason: "ExpiredProviderToken" });
    expect(await deliverWithRetry(a.attempt, sleep)).toMatchObject({ outcome: "failed", attempts: 2 });
    // Gone or refused: no second try.
    a = answering({ status: 410, reason: "Unregistered" });
    expect(await deliverWithRetry(a.attempt, sleep)).toMatchObject({ outcome: "gone", attempts: 1 });
  });

  test("each device gets one request to its own host; a gone token is removed, the others marked sent", async () => {
    const t = setup();
    const a = await person(t, "apns-send@example.com");
    await a.as.mutation(api.push.registerApns, device(7));
    await a.as.mutation(api.push.registerApns, { ...device(8), environment: "production" });
    await a.as.mutation(api.push.registerApns, { ...device(9), bundleId: "com.example.other" });
    // Two unread notifications make the badge.
    await t.run(async (ctx) => {
      for (const title of ["One", "Two"]) await ctx.db.insert("notifications", { profileId: a.profileId as Id<"profiles">, kind: "system", title, createdAt: Date.now() });
    });
    wire.answers = [{ status: 200 }, { status: 410, reason: "Unregistered" }];
    const r = await t.action(internal.apnsSend.sendToProfile, { profileId: a.profileId as Id<"profiles">, message });
    expect(r).toEqual({ sent: 1 });
    expect(wire.sent.map((s) => [s.host, s.token])).toEqual([
      ["api.sandbox.push.apple.com", hex(7)],
      ["api.push.apple.com", hex(8)],
    ]);
    const first = wire.sent[0]!;
    expect(first.headers).toMatchObject({ "apns-push-type": "alert", "apns-topic": "com.folevi.ios", "apns-priority": "10", "apns-collapse-id": "reminder:abc" });
    expect(first.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(Number(first.headers["apns-expiration"])).toBeGreaterThan(Date.now() / 1000);
    expect(JSON.parse(first.body)).toMatchObject({ aps: { badge: 2, category: "REMINDER", "thread-id": message.threadId }, path: message.path, taskId: message.taskId });
    expect(wire.closed).toBe(wire.opened);
    const left = await rows(t);
    expect(left.map((x) => x.token).sort()).toEqual([hex(7), hex(9)]);
    expect(left.find((x) => x.token === hex(7))!.lastSentAt).toBeTypeOf("number");
  });

  test("nothing is sent (or opened) without the key, or without a device", async () => {
    const t = setup();
    const a = await person(t, "apns-quiet@example.com");
    expect(await t.action(internal.apnsSend.sendToProfile, { profileId: a.profileId as Id<"profiles">, message })).toEqual({ sent: 0 });
    await a.as.mutation(api.push.registerApns, device(10));
    configure(false);
    expect(await t.action(internal.apnsSend.sendToProfile, { profileId: a.profileId as Id<"profiles">, message })).toEqual({ sent: 0 });
    configure();
    process.env.APNS_KEY = "not a key";
    expect(await t.action(internal.apnsSend.sendToProfile, { profileId: a.profileId as Id<"profiles">, message })).toEqual({ sent: 0 });
    expect(wire.opened).toBe(0);
  });

  test("tokens and notification text never reach the logs", async () => {
    const t = setup();
    const a = await person(t, "apns-logs@example.com");
    await a.as.mutation(api.push.registerApns, device(11));
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logged.push(args.join(" ")));
    try {
      await t.action(internal.apnsSend.sendToProfile, { profileId: a.profileId as Id<"profiles">, message });
    } finally {
      spy.mockRestore();
    }
    const all = logged.join("\n");
    expect(all).toContain("apns.send");
    expect(all).not.toContain(hex(11));
    expect(all).not.toContain("bins");
  });
});

describe("what sends it", () => {
  test("a due reminder goes to the person's devices with its to-do, note, task and path", async () => {
    const t = setup();
    const a = await person(t, "apns-reminder@example.com");
    await a.as.mutation(api.push.registerApns, device(12));
    const { docId, blockId } = await dueTodo(a, "Take the bins out");
    await t.mutation(internal.tasks.processReminders, {});
    const [job] = await scheduled(t, "apnsSend");
    expect(job).toMatchObject({
      profileId: a.profileId,
      message: { kind: "reminder", title: "Reminder: Take the bins out", body: "In House jobs", path: `/d/${docId}#block-${blockId}`, threadId: docId, taskId: blockId },
    });
    // The browsers' push is still scheduled beside it.
    expect(await scheduled(t, "pushSend")).toHaveLength(1);
  });

  test("a reminder turned off in the bell isn't pushed; nobody with a device, or no key, schedules nothing", async () => {
    const t = setup();
    const a = await person(t, "apns-off@example.com");
    await a.as.mutation(api.push.registerApns, device(13));
    await setPrefs(t, a, { inApp: { comments: true, replies: true, mentions: true, shares: true, access: true, reminders: false } });
    await dueTodo(a, "Quietly");
    await t.mutation(internal.tasks.processReminders, {});
    expect(await scheduled(t, "apnsSend")).toHaveLength(0);

    const b = await person(t, "apns-nodevice@example.com");
    await dueTodo(b, "No phone");
    await t.mutation(internal.tasks.processReminders, {});
    expect(await scheduled(t, "apnsSend")).toHaveLength(0);

    const c = await person(t, "apns-nokey@example.com");
    await c.as.mutation(api.push.registerApns, device(14));
    configure(false);
    await dueTodo(c, "No key");
    await t.mutation(internal.tasks.processReminders, {});
    expect(await scheduled(t, "apnsSend")).toHaveLength(0);
  });

  test("an @mention goes as who and where, only while mentions are on in the bell", async () => {
    const t = setup();
    const owner = await person(t, "apns-owner@example.com");
    const editor = await person(t, "apns-editor@example.com");
    const { id: teamId } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Garden Team" });
    await owner.as.mutation(api.workspaces.invite, { workspaceId: teamId, email: "apns-editor@example.com", role: "editor" });
    const invite = (await editor.as.query(api.notifications.list, {})).find((n) => n.kind === "invite")!;
    await editor.as.mutation(api.workspaces.acceptInvite, { inviteId: invite.inviteId! });
    await editor.as.mutation(api.push.registerApns, device(15));
    const docId = ulid();
    const scope = inWorkspace(teamId);
    await owner.as.mutation(api.sync.push, { scope, deviceId: "device-apns", ops: [{ opId: ulid(), kind: "document.create", document: { id: docId, parentDocumentId: null, folderId: null, kind: "document", title: "Launch review", icon: null } }] as never });
    const mention = (label: string) => ({ ...para(ulid(), ""), text: [{ type: "text", text: `${label} ` }, { type: "mention", userId: editor.profileId, label: "editor" }] });
    const first = mention("Over to");
    await owner.as.mutation(api.sync.push, { scope, deviceId: "device-apns", ops: [{ opId: ulid(), kind: "block.upsert", documentId: docId, block: first, baseRevision: null, fields: ["content", "position"] }] as never });
    const jobs = await scheduled(t, "apnsSend");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ profileId: editor.profileId, message: { kind: "mention", title: "apns-owner mentioned you in Launch review", path: `/d/${docId}#block-${first.id}`, threadId: docId } });
    expect((jobs[0]!.message as Record<string, unknown>).body).toBeUndefined();

    await setPrefs(t, editor, { inApp: { comments: true, replies: true, mentions: false, shares: true, access: true } });
    const doc2 = ulid();
    await owner.as.mutation(api.sync.push, { scope, deviceId: "device-apns", ops: [{ opId: ulid(), kind: "document.create", document: { id: doc2, parentDocumentId: null, folderId: null, kind: "document", title: "Second", icon: null } }] as never });
    await owner.as.mutation(api.sync.push, { scope, deviceId: "device-apns", ops: [{ opId: ulid(), kind: "block.upsert", documentId: doc2, block: mention("Again"), baseRevision: null, fields: ["content", "position"] }] as never });
    expect(await scheduled(t, "apnsSend")).toHaveLength(1);
  });

  test("the notification's Done and Snooze: the device's token checks the task off, or moves its reminder so it rings again", async () => {
    const t = setup();
    const a = await person(t, "apns-actions@example.com");
    const { token } = await a.as.mutation(api.apiTokens.ensureDevice, { deviceId: "install-actions-0000", family: "iPhone", model: "iPhone 18 Pro" });
    const { blockId } = await dueTodo(a, "Water the plants");
    await t.mutation(internal.tasks.processReminders, {});
    const patch = async (body: unknown) => {
      const res = await t.fetch(`/api/v1/tasks/${blockId}`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };
    const task = () => t.run(async (ctx) => (await ctx.db.query("tasks").withIndex("by_block", (q) => q.eq("blockId", blockId)).unique())!);
    expect((await task()).reminderSentAt).toBeTypeOf("number");
    // Snooze 1 hour (here: a moment ago, so it's due at once).
    const later = new Date(Date.now() - 500).toISOString();
    const snoozed = await patch({ remindAt: later });
    expect(snoozed).toMatchObject({ status: 200, json: { id: blockId, completed: false, remindAt: later } });
    expect((await task()).reminderSentAt).toBeUndefined();
    await t.mutation(internal.tasks.processReminders, {});
    const bell = await t.run(async (ctx) => await ctx.db.query("notifications").withIndex("by_profile_created", (q) => q.eq("profileId", a.profileId as Id<"profiles">)).collect());
    expect(bell.filter((n) => n.title === "Reminder: Water the plants")).toHaveLength(2);
    expect((await patch({ remindAt: "in an hour" })).status).toBe(422);
    // Done.
    expect(await patch({ completed: true })).toMatchObject({ status: 200, json: { completed: true } });
    expect((await task()).status).toBe("done");
  });

  test("deleting the account removes its devices and browsers", async () => {
    const t = setup();
    const a = await person(t, "apns-delete@example.com");
    await a.as.mutation(api.push.registerApns, device(16));
    await a.as.mutation(api.push.subscribe, { endpoint: `https://push.example.com/send/${"x".repeat(16)}`, p256dh: "p256dh-key-abcdefgh", auth: "auth-key-abcd" });
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.patch(a.profileId as Id<"profiles">, { status: "pending_deletion" });
      await ctx.db.insert("deletionJobs", { kind: "account", targetId: a.profileId, requestedBy: a.profileId as Id<"profiles">, requestedByAdmin: false, reason: "test", scheduledFor: now - 1, status: "scheduled", progress: 0, createdAt: now });
    });
    for (let i = 0; i < 20; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    expect(await rows(t)).toHaveLength(0);
    expect(await t.run(async (ctx) => await ctx.db.query("pushSubscriptions").collect())).toHaveLength(0);
  });
});
