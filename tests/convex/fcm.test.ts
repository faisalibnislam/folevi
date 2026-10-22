// Push to Folevi for Android through Firebase Cloud Messaging: the settings (off until the service account is
// set), registering a token, what's sent (a data message the app draws with its actions), the service account's
// signed assertion and access token, Google's answers (a gone token is removed, a busy FCM is tried again, an
// expired access token is made again), and the reminders that send it. fetch is replaced, so nothing leaves.
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { deliverFcm, fcmBody, fcmConfig, fcmErrorCode, fcmOutcome, fcmSetup } from "../../convex/lib/fcm";
import { FCM_SCOPE, fcmAssertion, forgetFcmToken, GOOGLE_TOKEN_URL } from "../../convex/lib/fcmAuth";
import { para, person, PERSONAL, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const ACCOUNT = JSON.stringify({ type: "service_account", project_id: "folevi-test", client_email: "fcm@folevi-test.iam.gserviceaccount.com", private_key: KEY });

const token = (n: number) => `fcm${n}:APA91b${"x".repeat(140)}${n}`;
const device = (n: number) => ({ token: token(n), deviceId: `install-${n}-0000`, deviceName: "Pixel 9" });

const sent: { url: string; body: Record<string, unknown>; auth: string }[] = [];
let answers: { status: number; body?: unknown }[] = [];
let tokenCalls = 0;

beforeEach(() => {
  process.env.FCM_SERVICE_ACCOUNT = ACCOUNT;
  sent.length = 0;
  answers = [];
  tokenCalls = 0;
  forgetFcmToken();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url === GOOGLE_TOKEN_URL) {
      tokenCalls++;
      return new Response(JSON.stringify({ access_token: `ya29.access-${tokenCalls}`, expires_in: 3599 }), { status: 200 });
    }
    sent.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") ?? "" });
    const a = answers.shift() ?? { status: 200, body: { name: "projects/folevi-test/messages/1" } };
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status });
  });
});
afterEach(() => {
  delete process.env.FCM_SERVICE_ACCOUNT;
  vi.unstubAllGlobals();
});

async function rows(t: T) {
  return await t.run(async (ctx) => await ctx.db.query("fcmTokens").collect());
}

async function scheduled(t: T, name: string) {
  return await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((j) => j.name.includes(name)).map((j) => j.args[0] as Record<string, unknown>));
}

async function dueTodo(p: Person, text: string) {
  const docId = ulid();
  await p.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-fcm", ops: [{ opId: ulid(), kind: "document.create", document: { id: docId, parentDocumentId: null, folderId: null, kind: "document", title: "House jobs", icon: null } }] as never });
  const todo = { ...para(ulid(), text), type: "todo", props: { checked: false, reminderAt: Date.now() - 1000 } };
  await p.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-fcm", ops: [{ opId: ulid(), kind: "block.upsert", documentId: docId, block: todo, baseRevision: null, fields: ["content", "position"] }] as never });
  return { docId, blockId: todo.id };
}

describe("FCM settings", () => {
  test("off without the service account, on with it; a broken one is partial", async () => {
    const t = setup();
    const a = await person(t, "fcm-env@example.com");
    expect(await a.as.query(api.push.fcmAvailable, {})).toBe(true);
    expect(fcmConfig()?.projectId).toBe("folevi-test");
    delete process.env.FCM_SERVICE_ACCOUNT;
    expect(await a.as.query(api.push.fcmAvailable, {})).toBe(false);
    expect(fcmSetup()).toBe("none");
    process.env.FCM_SERVICE_ACCOUNT = "{not json";
    expect(fcmSetup()).toBe("partial");
    expect(fcmConfig({ FCM_SERVICE_ACCOUNT: ACCOUNT.replace(/\\n/g, "\\\\n") })?.privateKey).toContain("PRIVATE KEY");
    await expect(t.query(api.push.fcmAvailable, {})).rejects.toThrow();
  });
});

describe("registering an Android device", () => {
  test("checks what it's given; one row per token and per device; only the owner removes one", async () => {
    const t = setup();
    await expect(t.mutation(api.push.registerFcm, device(1))).rejects.toThrow();
    const a = await person(t, "fcm-a@example.com");
    const b = await person(t, "fcm-b@example.com");
    await expect(a.as.mutation(api.push.registerFcm, { ...device(1), token: "short" })).rejects.toThrow(/look wrong/);
    await a.as.mutation(api.push.registerFcm, device(1));
    await a.as.mutation(api.push.registerFcm, device(1));
    expect(await rows(t)).toHaveLength(1);
    // The same phone with a new token: the old one goes.
    await a.as.mutation(api.push.registerFcm, { ...device(1), token: token(2) });
    expect((await rows(t)).map((r) => r.token)).toEqual([token(2)]);
    // Signed in as someone else on that phone: it's theirs now.
    await b.as.mutation(api.push.registerFcm, { ...device(1), token: token(2) });
    expect((await rows(t)).map((r) => r.profileId)).toEqual([b.profileId]);
    await a.as.mutation(api.push.unregisterFcm, { deviceId: device(1).deviceId });
    expect(await rows(t)).toHaveLength(1);
    expect(await b.as.query(api.push.fcmStatus, { deviceId: device(1).deviceId })).toEqual({ devices: 1, thisDevice: true });
    await b.as.mutation(api.push.unregisterFcm, { deviceId: device(1).deviceId });
    expect(await rows(t)).toHaveLength(0);
  });
});

describe("sending", () => {
  test("a data message for the app to draw, high priority, an hour to live, signed in with the service account", async () => {
    const t = setup();
    const a = await person(t, "fcm-send@example.com");
    await a.as.mutation(api.push.registerFcm, device(3));
    const message = { kind: "reminder" as const, title: "Reminder: Take the bins out", body: "In House jobs", path: "/d/01J9ZDOC000000000000000001#block-abc", threadId: "01J9ZDOC000000000000000001", taskId: "abc", collapseId: "reminder:abc" };
    expect(await t.action(internal.fcmSend.sendToProfile, { profileId: a.profileId as Id<"profiles">, message })).toEqual({ sent: 1 });
    expect(sent[0]!.url).toBe("https://fcm.googleapis.com/v1/projects/folevi-test/messages:send");
    expect(sent[0]!.auth).toBe("Bearer ya29.access-1");
    expect(sent[0]!.body).toEqual({
      message: {
        token: token(3),
        data: { kind: "reminder", title: "Reminder: Take the bins out", body: "In House jobs", path: "/d/01J9ZDOC000000000000000001#block-abc", threadId: "01J9ZDOC000000000000000001", taskId: "abc", collapseId: "reminder:abc", badge: "0" },
        android: { priority: "HIGH", ttl: "3600s", collapse_key: "reminder:abc" },
      },
    });
    // The access token is kept: a second send asks Google for none.
    await t.action(internal.fcmSend.sendToProfile, { profileId: a.profileId as Id<"profiles">, message });
    expect(tokenCalls).toBe(1);
  });

  test("a gone token is removed; nothing is sent without the service account", async () => {
    const t = setup();
    const a = await person(t, "fcm-gone@example.com");
    await a.as.mutation(api.push.registerFcm, device(4));
    answers = [{ status: 404, body: { error: { status: "NOT_FOUND", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } } }];
    const message = { kind: "mention" as const, title: "Sam mentioned you", path: "/d/01J9ZDOC000000000000000001" };
    expect(await t.action(internal.fcmSend.sendToProfile, { profileId: a.profileId as Id<"profiles">, message })).toEqual({ sent: 0 });
    expect(await rows(t)).toHaveLength(0);
    await a.as.mutation(api.push.registerFcm, device(5));
    delete process.env.FCM_SERVICE_ACCOUNT;
    expect(await t.action(internal.fcmSend.sendToProfile, { profileId: a.profileId as Id<"profiles">, message })).toEqual({ sent: 0 });
    expect(sent).toHaveLength(1);
  });

  test("Google's answers: sent, gone, tried again, a fresh access token, or given up", async () => {
    expect(fcmOutcome({ status: 200 })).toBe("sent");
    expect(fcmOutcome({ status: 404, code: "UNREGISTERED" })).toBe("gone");
    expect(fcmOutcome({ status: 400, code: "INVALID_ARGUMENT" })).toBe("gone");
    expect(fcmOutcome({ status: 403, code: "SENDER_ID_MISMATCH" })).toBe("gone");
    expect(fcmOutcome({ status: 401 })).toBe("refresh");
    expect(fcmOutcome({ status: 503 })).toBe("retry");
    expect(fcmOutcome({ status: 0 })).toBe("retry");
    expect(fcmOutcome({ status: 403, code: "PERMISSION_DENIED" })).toBe("failed");
    expect(fcmErrorCode(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }))).toBe("UNREGISTERED");
    const waits: number[] = [];
    const seq = [{ status: 503 }, { status: 401 }, { status: 200 }];
    const fresh: boolean[] = [];
    const r = await deliverFcm(async (f) => (fresh.push(f), seq.shift()!), async (ms) => void waits.push(ms));
    expect(r).toMatchObject({ outcome: "sent", attempts: 3 });
    expect(fresh).toEqual([false, false, true]);
    expect(waits).toEqual([1000]);
    const busy = await deliverFcm(async () => ({ status: 500 }), async () => undefined);
    expect(busy).toMatchObject({ outcome: "failed", attempts: 3 });
  });

  test("the assertion: RS256, the account as issuer, FCM's scope, Google's token endpoint, an hour", () => {
    const config = fcmConfig()!;
    const jwt = fcmAssertion(config, 1_800_000_000_000);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(c!, "base64url").toString())).toEqual({ iss: "fcm@folevi-test.iam.gserviceaccount.com", scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat: 1_800_000_000, exp: 1_800_003_600 });
    expect(verify("sha256", Buffer.from(`${h}.${c}`), createPublicKey(publicKey.export({ type: "spki", format: "pem" })), Buffer.from(s!, "base64url"))).toBe(true);
  });

  test("a due reminder goes to the person's Android devices too, beside the browsers' push", async () => {
    const t = setup();
    const a = await person(t, "fcm-reminder@example.com");
    await a.as.mutation(api.push.registerFcm, device(6));
    const { docId, blockId } = await dueTodo(a, "Take the bins out");
    await t.mutation(internal.tasks.processReminders, {});
    const [job] = await scheduled(t, "fcmSend");
    expect(job).toMatchObject({ profileId: a.profileId, message: { kind: "reminder", title: "Reminder: Take the bins out", body: "In House jobs", path: `/d/${docId}#block-${blockId}`, threadId: docId, taskId: blockId } });
    expect(await scheduled(t, "pushSend")).toHaveLength(1);
    expect(fcmBody("t", { kind: "routine", title: "x", path: "javascript:alert(1)" }, 3).message).toMatchObject({ data: { path: "/documents", badge: "3" } });
  });
});
