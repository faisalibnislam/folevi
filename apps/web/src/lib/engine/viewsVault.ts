// Revision 13's views: the Vault (lib/engine/vault.ts). Each opens on the engine what the web's screen opens on the
// page (components/vault/*): the summaries of a section's items, folder names, Health, the log, people and shares.
import { api } from "@/lib/convex/api";
import { eventLabel } from "@/components/vault/events";
import { vaultSessions } from "@/lib/vault/keys";
import type { ValueViewDef } from "./views";
import { bool, id, nullableId, oneOf, only, text } from "./validate";
import { BridgeError } from "./validate";
import type { VaultActivityValue, VaultPeopleValue, VaultSharesValue, ViewName } from "./protocol";
import { bindVault, decrypting, folderNames, healthGroups, isLocal, KIND_DEFS, openRow, scopeArgs, sessionSignal, summaryOf, vaultSource, type Row, type VaultInfo } from "./vault";
import { signalOf } from "./live";
import { getKeySession } from "@/lib/e2ee/keys/session";

type Args = Record<string, unknown>;

const vaultIdArg = (args: Args) => text(args, "vaultId", { max: 64 }) as string;

const summary: ValueViewDef = {
  kind: "value",
  parse: (args: Args) => (only(args, ["space"]), args.space === undefined ? {} : { space: text(args, "space", { max: 200 }) }),
  create: (ctx, args) => {
    const deps = ctx.deps();
    bindVault(deps);
    const info = vaultSource<VaultInfo>(ctx, api.vault.get, scopeArgs(deps, args.space as string | undefined));
    // The auto-lock time moves with every action: the summary says again when it'll lock, once a second at most.
    return {
      signals: [info, sessionSignal, ctx.appSignal, deps.e2eeSignal, signalOf((cb) => getKeySession().subscribe(cb))],
      compute: () => {
        bindVault(ctx.deps());
        const s = info.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: true, error: null };
        return { value: summaryOf(ctx.deps(), s.value), stale: s.stale, error: null };
      },
    };
  },
};

const items: ValueViewDef = {
  kind: "value",
  parse: (args: Args) => {
    only(args, ["vaultId", "section", "folderId"]);
    const section = oneOf(args, "section", ["passwords", "files", "trash"] as const);
    const folderId = nullableId(args, "folderId") ?? null;
    return { vaultId: vaultIdArg(args), section, ...(section === "files" ? { folderId } : {}) };
  },
  create: (ctx, args) => {
    const vaultId = args.vaultId as string;
    const list = vaultSource<{ items: Row[] }>(ctx, api.vaultItems.list, args);
    return decrypting(
      [list],
      () => {
        const s = list.snapshot();
        return { ready: s.value !== undefined && vaultSessions().isOpen(vaultId), stale: s.stale, error: s.error, token: [s.value, vaultSessions().isOpen(vaultId)] };
      },
      async () => ({ items: (await Promise.all(list.snapshot().value!.items.map((r) => openRow(vaultId, r)))).map((o) => o.out), kinds: KIND_DEFS }),
    );
  },
};

const folders: ValueViewDef = {
  kind: "value",
  parse: (args: Args) => (only(args, ["vaultId"]), { vaultId: vaultIdArg(args) }),
  create: (ctx, args) => {
    const vaultId = args.vaultId as string;
    const rows = vaultSource<{ id: string; parentId: string | null; sealedName: ArrayBuffer; keyVersion: number; updatedAt: number }[]>(ctx, api.vaultFiles.folders, args);
    return decrypting(
      [rows],
      () => {
        const s = rows.snapshot();
        return { ready: s.value !== undefined && vaultSessions().isOpen(vaultId), stale: s.stale, error: s.error, token: [s.value, vaultSessions().isOpen(vaultId)] };
      },
      async () => ({ folders: await folderNames(vaultId, rows.snapshot().value!) }),
    );
  },
};

const health: ValueViewDef = {
  kind: "value",
  parse: (args: Args) => (only(args, ["vaultId"]), { vaultId: vaultIdArg(args) }),
  create: (ctx, args) => {
    const vaultId = args.vaultId as string;
    const list = vaultSource<{ items: Row[] }>(ctx, api.vaultItems.list, { vaultId, section: "passwords" });
    const reuse = vaultSource<Record<string, number>>(ctx, api.vaultItems.reuse, { vaultId });
    return decrypting(
      [list, reuse],
      () => {
        const a = list.snapshot();
        const b = reuse.snapshot();
        return { ready: a.value !== undefined && b.value !== undefined && vaultSessions().isOpen(vaultId), stale: a.stale || b.stale, error: a.error ?? b.error, token: [a.value, b.value, vaultSessions().isOpen(vaultId)] };
      },
      async () => healthGroups(await Promise.all(list.snapshot().value!.items.map((r) => openRow(vaultId, r))), reuse.snapshot().value!, Date.now()),
    );
  },
};

type LogData = { everything: boolean; entries: { seq: number; actorName: string; actorRole?: string | null; event: string; outcome?: string; reason?: string | null; at: number; itemKind?: string | null; device?: { label?: string } | null; ip?: string | null; source?: string }[] };

const activity: ValueViewDef = {
  kind: "value",
  parse: (args: Args) => {
    only(args, ["vaultId", "event", "failedOnly", "personId"]);
    const event = text(args, "event", { max: 40, optional: true, allowEmpty: true });
    const failedOnly = args.failedOnly === undefined ? undefined : bool(args, "failedOnly");
    const personId = args.personId === undefined ? undefined : id(args, "personId");
    return { vaultId: vaultIdArg(args), ...(event ? { event } : {}), ...(failedOnly ? { failedOnly } : {}), ...(personId ? { personId } : {}) };
  },
  create: (ctx, args) => {
    if (isLocal(ctx.deps())) throw new BridgeError("unavailable", "Sign in to Folevi to keep the Vault's activity log.");
    const log = vaultSource<LogData>(ctx, api.vaultLog.list, args);
    return {
      signals: [log],
      compute: () => {
        const s = log.snapshot();
        if (s.value === undefined) return { value: undefined, stale: !s.error, error: s.error };
        const value: VaultActivityValue = {
          everything: s.value.everything,
          entries: s.value.entries.map((e) => ({
            seq: e.seq,
            actorName: e.actorName,
            label: eventLabel(e.event),
            failed: e.outcome === "failed",
            reason: e.reason ? e.reason.replace(/_/g, " ") : null,
            at: e.at,
            detail: [e.actorRole, e.itemKind, e.device?.label, e.ip, e.source === "device" ? "reported by the device" : null].filter(Boolean).join(" · "),
          })),
        };
        return { value, stale: s.stale, error: null };
      },
    };
  },
};

type PeopleData = { people: { profileId: string; name: string; email?: string | null; avatarUrl?: string | null; role: string; isYou: boolean; ready: boolean; waiting: boolean }[]; canAdd: boolean; canNameCustodians: boolean; onlyOneCustodian: boolean };
type MembersData = { members?: { profileId: string; displayName: string }[] };

const people: ValueViewDef = {
  kind: "value",
  parse: (args: Args) => (only(args, ["vaultId"]), { vaultId: vaultIdArg(args) }),
  create: (ctx, args) => {
    const deps = ctx.deps();
    if (isLocal(deps)) throw new BridgeError("unavailable", "Sign in to Folevi to share the Vault with people.");
    const list = vaultSource<PeopleData>(ctx, api.vaultPeople.list, args);
    const space = deps.app.spaces.find((s) => s.id === deps.app.space);
    const members = space?.kind === "workspace" ? vaultSource<MembersData>(ctx, api.workspaces.members, { workspaceId: space.id }) : null;
    return {
      signals: members ? [list, members] : [list],
      compute: () => {
        const s = list.snapshot();
        if (s.value === undefined) return { value: undefined, stale: !s.error, error: s.error };
        const inVault = new Set(s.value.people.map((p) => p.profileId));
        const value: VaultPeopleValue = {
          people: s.value.people.map((p) => ({ profileId: p.profileId, name: p.name, email: p.email ?? null, avatarUrl: p.avatarUrl ?? null, role: p.role, isYou: p.isYou, status: p.ready ? "Can open it" : p.waiting ? "Waiting for the key" : "Hasn't set a passcode yet" })),
          canAdd: s.value.canAdd,
          canNameCustodians: s.value.canNameCustodians,
          onlyOneCustodian: s.value.onlyOneCustodian,
          candidates: (members?.snapshot().value?.members ?? []).filter((m) => !inVault.has(m.profileId)).map((m) => ({ profileId: m.profileId, name: m.displayName })),
        };
        return { value, stale: s.stale, error: null };
      },
    };
  },
};

type SharesData = { people: { id: string; name: string; email?: string | null; canEdit: boolean; expired: boolean; expiresAt?: number | null }[]; links: { id: string; views: number; maxViews: number; expiresAt: number; hasPassword: boolean; endedHow?: string | null }[] };

const shares: ValueViewDef = {
  kind: "value",
  parse: (args: Args) => (only(args, ["vaultId", "itemId"]), { vaultId: vaultIdArg(args), itemId: id(args, "itemId") }),
  create: (ctx, args) => {
    if (isLocal(ctx.deps())) throw new BridgeError("unavailable", "Sign in to Folevi to share and collaborate");
    const src = vaultSource<SharesData>(ctx, api.vaultShares.ofItem, args);
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.value === undefined) return { value: undefined, stale: !s.error, error: s.error };
        const value: VaultSharesValue = {
          people: s.value.people.map((p) => ({ id: p.id, name: p.name, email: p.email ?? null, canEdit: p.canEdit, expired: p.expired, expiresAt: p.expiresAt ?? null })),
          links: s.value.links.filter((l) => !l.endedHow).map((l) => ({ id: l.id, views: l.views, maxViews: l.maxViews, expiresAt: l.expiresAt, hasPassword: l.hasPassword })),
        };
        return { value, stale: s.stale, error: null };
      },
    };
  },
};

export const VAULT_VALUE_VIEWS = {
  "vault.summary": summary,
  "vault.items": items,
  "vault.folders": folders,
  "vault.health": health,
  "vault.activity": activity,
  "vault.people": people,
  "vault.shares": shares,
} satisfies Partial<Record<ViewName, ValueViewDef>>;
