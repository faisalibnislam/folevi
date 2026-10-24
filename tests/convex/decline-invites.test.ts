// Declining invitations (R11.2): a workspace invitation and a page invitation, bound to the invited address,
// idempotent, telling nobody, and taking the notification out of the bell.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { person, PERSONAL, setup } from "./helpers";

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

describe("declining invitations", () => {
  test("a workspace invitation: only the invited address, once, and the bell forgets it", async () => {
    const t = setup();
    const owner = await person(t, "dec-owner@example.com");
    const guest = await person(t, "dec-guest@example.com");
    const stranger = await person(t, "dec-stranger@example.com");
    const { id: teamId } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Team" });
    await owner.as.mutation(api.workspaces.invite, { workspaceId: teamId, email: "dec-guest@example.com", role: "member" });
    const invite = (await guest.as.query(api.notifications.list, {})).find((n) => n.kind === "invite")!;
    const ownerNotes = (await owner.as.query(api.notifications.list, {})).length;

    expect(await codeOf(stranger.as.mutation(api.workspaces.declineInvite, { inviteId: invite.inviteId! }))).toBe("forbidden");
    await guest.as.mutation(api.workspaces.declineInvite, { inviteId: invite.inviteId! });
    expect((await guest.as.query(api.notifications.list, {})).find((n) => n.kind === "invite")).toBeUndefined();
    // Again: nothing to do, no error.
    await guest.as.mutation(api.workspaces.declineInvite, { inviteId: invite.inviteId! });
    // It can't be accepted any more, and nobody was told.
    expect(await codeOf(guest.as.mutation(api.workspaces.acceptInvite, { inviteId: invite.inviteId! }))).toBe("not_found");
    expect((await owner.as.query(api.notifications.list, {})).length).toBe(ownerNotes);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("workspaceInvites").withIndex("by_public_id", (q) => q.eq("publicId", invite.inviteId!)).unique();
      expect(row!.status).toBe("declined");
    });
    expect(await codeOf(guest.as.mutation(api.workspaces.declineInvite, { inviteId: "nope" }))).toBe("not_found");
  });

  test("a page invitation", async () => {
    const t = setup();
    const owner = await person(t, "pdec-owner@example.com");
    const { id: page } = await owner.as.mutation(api.documents.create, { scope: PERSONAL, title: "Garden" });
    await owner.as.mutation(api.sharing.grant, { documentId: page, email: "pdec-friend@example.com", role: "viewer" });
    const friend = await person(t, "pdec-friend@example.com");
    const other = await person(t, "pdec-other@example.com");
    const item = (await friend.as.query(api.notifications.list, {})).find((n) => n.pageInviteId)!;
    expect(await codeOf(other.as.mutation(api.sharing.declinePageInvite, { inviteId: item.pageInviteId! }))).toBe("forbidden");
    await friend.as.mutation(api.sharing.declinePageInvite, { inviteId: item.pageInviteId! });
    await friend.as.mutation(api.sharing.declinePageInvite, { inviteId: item.pageInviteId! });
    expect((await friend.as.query(api.notifications.list, {})).find((n) => n.id === item.id)).toBeUndefined();
    expect(await codeOf(friend.as.mutation(api.sharing.acceptPageInvite, { inviteId: item.pageInviteId! }))).toBe("not_found");
    expect(await friend.as.query(api.documents.get, { documentId: page })).toBeNull();
  });
});
