// The Vault's notifications (docs/VAULT_PLAN.md §8): everyone with access, except whoever did it, hears that files,
// notes or passwords were added or changed and that people were added or removed. The text says who and what kind
// only, never an item's name. Bursts fold into one ("Maya added 12 files to the Vault"). Security notices (many wrong
// passcodes, a share to someone outside the workspace, an export) go to the owner and custodians, whatever their
// settings. Bell and push; the person's Vault setting turns the change notices off.
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { schedulePush } from "../push";
import { vaultRoleOf, type VaultRole } from "./access";

export type VaultChange = { what: "file" | "note" | "password" | "person"; verb: "added" | "changed" | "removed"; count?: number; personName?: string };

/** Changes from one person within this long fold into one notification. */
const FOLD_MS = 10 * 60_000;

const NOUNS: Record<VaultChange["what"], [string, string]> = {
  file: ["a file", "files"],
  note: ["a note", "notes"],
  password: ["a password", "passwords"],
  person: ["someone", "people"],
};

/** "Maya added a file to the Vault", "Sam changed 3 passwords in the Vault", "Lee added Ana to the Vault". */
export function changeText(actorName: string, c: VaultChange): string {
  const who = actorName.slice(0, 80) || "Someone";
  const n = c.count ?? 1;
  if (c.what === "person") return c.verb === "removed" ? `${who} removed ${c.personName ?? "someone"} from the Vault` : `${who} added ${c.personName ?? "someone"} to the Vault`;
  const thing = n === 1 ? NOUNS[c.what][0] : `${n} ${NOUNS[c.what][1]}`;
  return c.verb === "added" ? `${who} added ${thing} to the Vault` : c.verb === "removed" ? `${who} removed ${thing} from the Vault` : `${who} changed ${thing} in the Vault`;
}

/** Everyone with access to a Vault, with their role. */
async function audience(ctx: MutationCtx, vault: Doc<"vaults">): Promise<{ profile: Doc<"profiles">; role: VaultRole }[]> {
  const out: { profile: Doc<"profiles">; role: VaultRole }[] = [];
  const consider = async (id: Id<"profiles">) => {
    if (out.some((o) => o.profile._id === id)) return;
    const p = await ctx.db.get(id);
    const role = p ? await vaultRoleOf(ctx, p, vault) : null;
    if (p && role) out.push({ profile: p, role });
  };
  if (vault.ownerProfileId) await consider(vault.ownerProfileId);
  if (vault.workspaceId) {
    const ws = await ctx.db.get(vault.workspaceId);
    if (ws) await consider(ws.ownerId);
    for (const m of await ctx.db
      .query("vaultMembers")
      .withIndex("by_vault", (q) => q.eq("vaultId", vault._id))
      .take(500))
      await consider(m.profileId);
  }
  return out;
}

async function deliver(ctx: MutationCtx, vault: Doc<"vaults">, to: Doc<"profiles">, actorId: Id<"profiles"> | null, title: (count: number) => string, key: string, adds = 1) {
  const now = Date.now();
  // A burst from the same person about the same kind of change folds into the unread notification already there.
  const recent = await ctx.db
    .query("notifications")
    .withIndex("by_profile_created", (q) => q.eq("profileId", to._id).gt("createdAt", now - FOLD_MS))
    .order("desc")
    .take(20);
  const same = recent.find((n) => n.kind === "vault" && n.vaultId === vault._id && !n.readAt && n.body === key && (n.actorId ?? null) === actorId);
  if (same) {
    const count = (same.count ?? 1) + adds;
    await ctx.db.patch(same._id, { title: title(count), count, createdAt: now });
    return;
  }
  await ctx.db.insert("notifications", { profileId: to._id, ...(vault.workspaceId ? { workspaceId: vault.workspaceId } : {}), kind: "vault", vaultId: vault._id, ...(actorId ? { actorId } : {}), title: title(adds), body: key, count: adds, createdAt: now });
  // The push uses the generic kind (the apps' own Vault category comes with them).
  await schedulePush(ctx, { profileId: to._id, kind: "routine", title: title(adds), path: "/vault", tag: `vault:${vault.publicId}:${key}` });
}

/** Tells everyone in the Vault (but `actor`) about a change, unless they turned Vault notices off. */
export async function notifyVaultChange(ctx: MutationCtx, vault: Doc<"vaults">, actor: Doc<"profiles"> | null, change: VaultChange): Promise<void> {
  const key = `${change.what}:${change.verb}`;
  for (const { profile } of await audience(ctx, vault)) {
    if (actor && profile._id === actor._id) continue;
    if (profile.notificationPrefs.inApp?.vault === false) continue;
    await deliver(ctx, vault, profile, actor?._id ?? null, (count) => changeText(actor?.displayName ?? "Someone", { ...change, count }), key, change.count ?? 1);
  }
}

/** A security notice to the owner and custodians (always delivered). */
export async function notifyVaultSecurity(ctx: MutationCtx, vault: Doc<"vaults">, actor: Doc<"profiles"> | null, title: string, key: string): Promise<void> {
  for (const { profile, role } of await audience(ctx, vault)) {
    if (role === "member" || (actor && profile._id === actor._id)) continue;
    await deliver(ctx, vault, profile, actor?._id ?? null, () => title.slice(0, 200), `security:${key}`);
  }
}
