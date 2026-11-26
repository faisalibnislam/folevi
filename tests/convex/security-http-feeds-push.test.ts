// Three smaller findings of the security audit of 2026-11-26:
//   L1  the tasks calendar link shows a workspace task only while its owner can still open the task's note;
//   L5  a web push subscription may only name a browser's own push service (the server sends requests there);
//   L8  adding and refreshing subscribed calendars is rate limited (each makes the server fetch a link).
import { createECDH } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { isPushServiceEndpoint } from "../../convex/lib/pushEndpoints";
import { join, para, person, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function todoIn(p: Person, scope: Person["scope"], title: string, props: Record<string, unknown>) {
  const docId = ulid();
  await p.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-feed",
    ops: [
      { opId: ulid(), kind: "document.create", document: { id: docId, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } },
      { opId: ulid(), kind: "block.upsert", documentId: docId, block: { ...para(ulid(), title), type: "todo", props: { checked: false, ...props } }, baseRevision: null, fields: ["content", "position"] },
    ] as never,
  });
  return docId;
}

async function feedText(t: T, token: string) {
  const res = await t.fetch(`/ical/${token}.ics`);
  return await res.text();
}

describe("L1: the calendar link and tasks in notes its owner can't open any more", { timeout: 60_000 }, () => {
  test("a task still assigned to someone who left the workspace, or whose page was restricted away, drops out", async () => {
    const t = setup();
    const owner = await person(t, "l1-owner@example.com");
    const me = await person(t, "l1-me@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Ops");
    await join(t, owner, me, "l1-me@example.com", workspaceId, "editor");
    const soon = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await todoIn(owner, scope, "Quarterly numbers", { dueDate: soon, assigneeId: me.profileId });
    const restricted = await todoIn(owner, scope, "Layoff list", { dueDate: soon, assigneeId: me.profileId });
    const { token } = await me.as.mutation(api.calendarFeeds.create, { includeWorkspaces: true });
    let text = await feedText(t, token);
    expect(text).toContain("Quarterly numbers");
    expect(text).toContain("Layoff list");

    // The page is restricted to its owner: the task is still assigned, but its note can't be opened.
    await owner.as.mutation(api.sharing.setAccessMode, { documentId: restricted, mode: "restricted" });
    text = await feedText(t, token);
    expect(text).toContain("Quarterly numbers");
    expect(text).not.toContain("Layoff list");

    // Removed from the workspace: nothing of it is left in the link, though both tasks still name them.
    await owner.as.mutation(api.workspaces.removeMember, { workspaceId, profileId: me.profileId });
    expect(await t.run(async (ctx) => (await ctx.db.query("tasks").collect()).filter((x) => x.assigneeId === (me.profileId as Id<"profiles">)).length)).toBe(2);
    text = await feedText(t, token);
    expect(text).not.toContain("Quarterly numbers");
    expect(text).not.toContain("Layoff list");
    expect(text).toContain("BEGIN:VCALENDAR");
  });
});

describe("L5: web push only to the browsers' push services", { timeout: 30_000 }, () => {
  const keys = { p256dh: "p256dh-key-abcdefgh", auth: "auth-key-abcd" };

  test("the services browsers hand out, and nothing else", () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc123:APA91b",
      "https://android.googleapis.com/gcm/send/abc",
      "https://jmt17.google.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGg1c",
      "https://wns2-by3p.notify.windows.com/w/?token=BQYAAAA",
      "https://FCM.googleapis.com:443/fcm/send/abc",
    ])
      expect(isPushServiceEndpoint(ok), ok).toBe(true);
    for (const bad of [
      "https://attacker.example/collect",
      "https://10.0.0.5/admin",
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/x-longer-path",
      "https://fcm.googleapis.com.attacker.example/fcm/send/abc",
      "https://attacker.example/fcm.googleapis.com/",
      "https://user@fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://push.apple.com/abc",
      "https://notify.windows.com/abc",
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://xfcm.googleapis.com/fcm/send/abc",
      "not a url at all",
    ])
      expect(isPushServiceEndpoint(bad), bad).toBe(false);
  });

  test("subscribe refuses any other address; one saved before the limit is dropped, never sent to", async () => {
    const t = setup();
    const a = await person(t, "l5@example.com");
    for (const endpoint of ["https://attacker.example/collect-everything", "https://10.0.0.5/internal-admin-panel", "https://fcm.googleapis.com.attacker.example/fcm/send/abc"]) {
      await expect(a.as.mutation(api.push.subscribe, { endpoint, ...keys })).rejects.toThrow(/push details look wrong/);
    }
    expect(await a.as.query(api.push.status, {})).toMatchObject({ devices: 0 });
    await a.as.mutation(api.push.subscribe, { endpoint: "https://fcm.googleapis.com/fcm/send/abc123:APA91b", ...keys });
    expect(await a.as.query(api.push.status, {})).toMatchObject({ devices: 1 });

    // A row from before: the sender skips it without a request and removes it.
    // A key pair made for this run (the sender only sends with one set); nothing is sent with it here.
    const pair = createECDH("prime256v1");
    pair.generateKeys();
    process.env.VAPID_PUBLIC_KEY = pair.getPublicKey().toString("base64url");
    process.env.VAPID_PRIVATE_KEY = Buffer.concat([Buffer.alloc(32), pair.getPrivateKey()]).subarray(-32).toString("base64url");
    try {
      const requests: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => (requests.push(String(input)), new Response(null, { status: 201 }))));
      const old = await t.run(async (ctx) => {
        for (const s of await ctx.db.query("pushSubscriptions").collect()) await ctx.db.delete(s._id);
        return await ctx.db.insert("pushSubscriptions", { profileId: a.profileId as Id<"profiles">, endpoint: "https://attacker.example/collect-everything", ...keys, createdAt: Date.now() });
      });
      expect(await t.action(internal.pushSend.sendToProfile, { profileId: a.profileId as Id<"profiles">, title: "Reminder", url: "https://app.folevi.com/d/x" })).toEqual({ sent: 0 });
      expect(requests).toEqual([]);
      expect(await t.run(async (ctx) => ctx.db.get(old))).toBeNull();
    } finally {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
    }
  });
});

describe("L8: subscribed calendars are rate limited", { timeout: 60_000 }, () => {
  test("30 adds or refreshes an hour per person, then rate_limited", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 26, 9, 0));
    const t = setup();
    const a = await person(t, "l8@example.com");
    const b = await person(t, "l8-other@example.com");
    // Nothing answers: the fetches fail quietly, which is all this test needs.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    const codeOf = async (p: Promise<unknown>) => {
      try {
        await p;
        return undefined;
      } catch (e) {
        return (e as { data?: { code?: string } }).data?.code ?? String(e);
      }
    };
    // Add and remove in a loop: before the limit this went on for ever.
    let refused: string | undefined;
    let done = 0;
    for (let i = 0; i < 40 && !refused; i++) {
      const added = await codeOf(
        a.as.mutation(api.externalCalendars.add, { url: `https://cal.example.com/${i}.ics` }).then(async ({ id }) => {
          await a.as.mutation(api.externalCalendars.remove, { calendarId: id });
        }),
      );
      if (added) refused = added;
      else done++;
    }
    expect(refused).toBe("rate_limited");
    expect(done).toBe(30);
    // Someone else isn't affected, and the next hour starts afresh.
    const { id } = await b.as.mutation(api.externalCalendars.add, { url: "https://cal.example.com/b.ics" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.setSystemTime(Date.UTC(2026, 10, 26, 10, 1));
    const again = await a.as.mutation(api.externalCalendars.add, { url: "https://cal.example.com/again.ics" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // Refreshing by hand counts too.
    let refreshRefused: string | undefined;
    for (let i = 0; i < 40 && !refreshRefused; i++) {
      refreshRefused = await codeOf(a.as.mutation(api.externalCalendars.refresh, { calendarId: again.id }));
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    expect(refreshRefused).toBe("rate_limited");
    await b.as.mutation(api.externalCalendars.refresh, { calendarId: id });
  });
});
