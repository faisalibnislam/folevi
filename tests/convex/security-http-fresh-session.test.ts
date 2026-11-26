// A stolen session alone must not be enough to make other people's devices hand over keys or readable text
// (security audit 2026-11-26, H1 and H2): starting encryption over (e2ee.keys.resetAccount), lowering a space's
// level or turning one of its switches on (e2ee.spaces.lower, setSwitches) and asking a Vault's custodians for
// its key again (vaultKeys.requestReset) all need a sign-in in the last 10 minutes (convex/lib/freshSession.ts).
import { describe, expect, test } from "vitest";
import { api, components } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { FRESH_SESSION_MS } from "../../convex/lib/freshSession";
import { e2eeEpoch, e2eePerson, e2eeRecoveryMethods, e2eeSpace, enableFlag, join, PERSONAL, setup, teamWorkspace, type T } from "./helpers";

const dataOf = (e: unknown) => (e as { data?: Record<string, unknown> }).data;
const NOT_FRESH = { code: "forbidden", reason: "session_not_fresh" };
const OFF = { foliAi: "off" as const, backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false };

/** Makes a session look as if the person signed in `agoMs` ago (what a session left open, or stolen, is). */
async function signedInAgo(t: T, sessionId: string, agoMs: number) {
  await t.run(async (ctx) => {
    await ctx.runMutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: sessionId }], update: { createdAt: Date.now() - agoMs } } });
  });
}

const OLD = FRESH_SESSION_MS + 60_000;

describe("a recent sign-in for the actions that make devices give keys or readable text away", { timeout: 120_000 }, () => {
  test("resetAccount: refused on a session older than 10 minutes, allowed right after signing in", async () => {
    const t = setup();
    const owner = await e2eePerson(t, "fresh-owner@example.com");
    const member = await e2eePerson(t, "fresh-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "fresh-member@example.com", workspaceId, "editor");
    await e2eeRecoveryMethods(owner);
    await e2eeSpace(owner, scope, [member]);
    await owner.as.mutation(api.e2ee.spaces.enable, { scope, level: "full", switches: OFF });
    const next = await e2eeEpoch(member.profileId, 2);

    await signedInAgo(t, member.sessionId, OLD);
    expect(await member.as.mutation(api.e2ee.keys.resetAccount, { newEpoch: next.registration, wraps: [] }).catch(dataOf)).toMatchObject(NOT_FRESH);
    // Nothing changed: no new epoch, nobody asked to share a key.
    expect(await owner.as.query(api.e2ee.grants.pending, { scope })).toEqual([]);
    expect(await t.run(async (ctx) => (await ctx.db.query("e2eeAccounts").collect()).filter((r) => r.profileId === (member.profileId as Id<"profiles">)).map((r) => r.epoch))).toEqual([1]);

    await signedInAgo(t, member.sessionId, 0);
    expect(await member.as.mutation(api.e2ee.keys.resetAccount, { newEpoch: next.registration, wraps: [] })).toEqual({ epoch: 2, pending: 1 });
  });

  test("lower: a fetched recovery wrap isn't enough on an old session", async () => {
    const t = setup();
    const a = await e2eePerson(t, "fresh-lower@example.com");
    const { recoveryWrapId } = await e2eeRecoveryMethods(a);
    await e2eeSpace(a, PERSONAL);
    await a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: OFF });
    // What someone with only the session can do: fetch the wrap (which stamps it as used) without opening it.
    await a.as.mutation(api.e2ee.keys.getWrap, { kind: "recoveryKey" });

    await signedInAgo(t, a.sessionId, OLD);
    expect(await a.as.mutation(api.e2ee.spaces.lower, { scope: PERSONAL, level: "standard", recheckedWrapId: recoveryWrapId }).catch(dataOf)).toMatchObject(NOT_FRESH);
    expect(await a.as.query(api.e2ee.spaces.get, { scope: PERSONAL })).toMatchObject({ level: "full", state: "enabling", migration: { direction: "seal" } });

    await signedInAgo(t, a.sessionId, 0);
    const { migrationId } = await a.as.mutation(api.e2ee.spaces.lower, { scope: PERSONAL, level: "standard", recheckedWrapId: recoveryWrapId });
    expect(migrationId).toBeTruthy();
  });

  test("setSwitches: turning a switch on needs a recent sign-in; turning switches off never does", async () => {
    const t = setup();
    const a = await e2eePerson(t, "fresh-switches@example.com");
    await e2eeRecoveryMethods(a);
    await e2eeSpace(a, PERSONAL);
    await a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "selected", switches: { ...OFF, foliAi: "ask", searchEverywhere: true } });

    await signedInAgo(t, a.sessionId, OLD);
    for (const on of [{ apps: true }, { backgroundAi: true }, { notificationPreviews: true }, { foliAi: "auto" as const }]) {
      expect(await a.as.mutation(api.e2ee.spaces.setSwitches, { scope: PERSONAL, switches: { ...OFF, foliAi: "ask", searchEverywhere: true, ...on } }).catch(dataOf)).toMatchObject(NOT_FRESH);
    }
    expect((await a.as.query(api.e2ee.spaces.get, { scope: PERSONAL })).switches).toMatchObject({ apps: false, backgroundAi: false, searchEverywhere: true, foliAi: "ask" });
    // Off is always allowed: it only takes readable copies away.
    expect(await a.as.mutation(api.e2ee.spaces.setSwitches, { scope: PERSONAL, switches: { ...OFF, foliAi: "off" } })).toEqual({ purged: ["search"] });

    await signedInAgo(t, a.sessionId, 0);
    await a.as.mutation(api.e2ee.spaces.setSwitches, { scope: PERSONAL, switches: { ...OFF, apps: true } });
    expect((await a.as.query(api.e2ee.spaces.get, { scope: PERSONAL })).switches).toMatchObject({ apps: true });
  });

  test("vaultKeys.requestReset: refused on an old session, so a custodian's device is never asked", async () => {
    const t = setup();
    await enableFlag(t, "vault");
    const owner = await e2eePerson(t, "fresh-vault-owner@example.com");
    const member = await e2eePerson(t, "fresh-vault-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "fresh-vault-member@example.com", workspaceId, "editor");
    const { id } = await owner.as.mutation(api.vault.create, { scope });
    await t.run(async (ctx) => {
      const vault = (await ctx.db
        .query("vaults")
        .withIndex("by_public_id", (q) => q.eq("publicId", id))
        .unique())!;
      await ctx.db.insert("vaultMembers", { vaultId: vault._id, workspaceId: vault.workspaceId!, profileId: member.profileId as Id<"profiles">, role: "member", addedBy: owner.profileId as Id<"profiles">, createdAt: Date.now() });
    });
    const waiting = () => t.run(async (ctx) => (await ctx.db.query("vaultPendingGrants").collect()).map((p) => p.reason));

    await signedInAgo(t, member.sessionId, OLD);
    expect(await member.as.mutation(api.vaultKeys.requestReset, { vaultId: id }).catch(dataOf)).toMatchObject(NOT_FRESH);
    expect(await waiting()).toEqual([]);

    await signedInAgo(t, member.sessionId, 0);
    await member.as.mutation(api.vaultKeys.requestReset, { vaultId: id });
    expect(await waiting()).toEqual(["reset"]);
  });
});
