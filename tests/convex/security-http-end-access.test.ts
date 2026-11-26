// A password reset or change also ends what someone who had the session for a while could have left behind to
// keep listening (security audit 2026-11-26, M3): outbound webhooks are turned off, the private calendar link is
// deleted, and the email-to-note address gets a new token with its extra senders cleared. Before, endAllAccess
// only deleted API tokens and connected apps. Someone else's stay.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { sha256Hex } from "../../convex/lib/crypto";
import { person, setup, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const authSubjectOf = (t: T, p: Person) => t.run(async (ctx) => (await ctx.db.get(p.profileId as Id<"profiles">))!.authSubject);

/** What an intruder with the session sets up to keep hearing about the account. */
async function leaveBehind(p: Person, host: string) {
  const hook = await p.as.mutation(api.webhooks.create, { url: `https://${host}/hook`, events: ["note.created", "note.updated", "task.created"], personal: true, workspaceIds: [] });
  const feed = await p.as.mutation(api.calendarFeeds.create, { includeWorkspaces: true });
  const { address } = await p.as.mutation(api.emailNotes.create, {});
  await p.as.mutation(api.emailNotes.addSender, { email: `intruder@${host}` });
  return { hookId: hook.id, feedToken: feed.token, address };
}

const feedAnswers = async (t: T, token: string) => (await t.query(internal.calendarFeeds.render, { tokenHash: await sha256Hex(token) })) !== null;

describe("a password change ends webhooks, the calendar link and the email-to-note address too", { timeout: 30_000 }, () => {
  test("webhooks go off, the calendar link stops, the address is replaced and its extra senders cleared; another person's stay", async () => {
    const t = setup();
    const a = await person(t, "left-a@example.com");
    const b = await person(t, "left-b@example.com");
    const left = await leaveBehind(a, "attacker.example");
    const others = await leaveBehind(b, "b-own.example");
    expect((await a.as.query(api.webhooks.list, {}))[0]).toMatchObject({ enabled: true });
    expect(await feedAnswers(t, left.feedToken)).toBe(true);

    await t.mutation(internal.apiTokens.endAllAccess, { authUserId: await authSubjectOf(t, a), reason: "password_reset" });

    // The webhook is off (still listed, so its owner sees it and can delete it), and hears nothing more.
    expect((await a.as.query(api.webhooks.list, {}))[0]).toMatchObject({ id: left.hookId, enabled: false });
    await a.as.mutation(api.documents.create, { scope: a.scope, title: "After the reset" });
    const queued = await t.run(async (ctx) => (await ctx.db.query("webhookEvents").collect()).map((e) => e._id));
    expect(queued.length).toBeGreaterThan(0);
    for (const eventId of queued) expect(await t.mutation(internal.webhooks.fanout, { eventId })).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("webhookDeliveries").collect()).length)).toBe(0);
    // The calendar link answers nothing, and Settings shows there is none.
    expect(await feedAnswers(t, left.feedToken)).toBe(false);
    expect(await a.as.query(api.calendarFeeds.status, {})).toBeNull();
    // The old email-to-note address is dead and nobody else may send to the new one.
    const status = await a.as.query(api.emailNotes.status, {});
    expect(status!.address).not.toBe(left.address);
    expect(status!.extraSenders).toEqual([]);
    const oldToken = left.address.slice(2, left.address.indexOf("@"));
    expect(await t.query(internal.emailNotes.pending, { tokens: [oldToken], emailId: "email-1" })).toEqual([]);
    // Told once, in the bell, without anything secret.
    const notices = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).filter((n) => n.profileId === (a.profileId as Id<"profiles">) && n.title.startsWith("Your password changed")),
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.body).toMatch(/1 webhook, your calendar link, your email-to-note address/);
    expect(notices[0]!.body).not.toContain("attacker.example");

    // B is untouched.
    expect((await b.as.query(api.webhooks.list, {}))[0]).toMatchObject({ enabled: true });
    expect(await feedAnswers(t, others.feedToken)).toBe(true);
    expect(await b.as.query(api.emailNotes.status, {})).toMatchObject({ address: others.address, extraSenders: ["intruder@b-own.example"] });
  });

  test("nothing set up: no notice", async () => {
    const t = setup();
    const a = await person(t, "left-none@example.com");
    expect(await t.mutation(internal.apiTokens.endAllAccess, { authUserId: await authSubjectOf(t, a), reason: "password_changed" })).toEqual({ tokens: 0, apps: 0 });
    expect(await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.title.startsWith("Your password changed")).length)).toBe(0);
  });
});
