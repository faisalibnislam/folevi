// Revision 12's views: sharing folders (R14.4, docs/SHARING.md). A folder's people and invitations
// (convex/folderSharing.ts `get`), Shared with Me's folders (`sharedFolders`), a shared folder opened like a folder
// (`open`), and the warning before a move changes who sees notes through a folder (`moveCheck`, in the words the
// web's warning uses: lib/app/folderSharing.ts).
import { api } from "@/lib/convex/api";
import { moveWarning } from "@/lib/app/folderSharing";
import { source, type ValueViewDef } from "./views";
import { id, ids, nullableId, only } from "./validate";
import type { FolderShareGrant, FolderSharingValue, NotesMoveCheckValue, SharedFolderRow, SharedFolderValue, ViewName } from "./protocol";

type Args = Record<string, unknown>;

type Person = { profileId: string; displayName: string; email?: string | null; role: string; guest: boolean; isYou: boolean; canChange?: boolean };

export type FolderSharingData = {
  folder: { id: string; name: string; color: string | null };
  yourAccess: string;
  canManage: boolean;
  youAreGuest: boolean;
  ownerName: string | null;
  workspaceName: string | null;
  personal: boolean;
  sharedBy: string | null;
  people: Person[];
  inherited: { folderId: string; folderName: string; people: Person[] }[];
  pendingInvites: { id: string; email: string; role: string; expiresAt: number; expired: boolean }[];
  noteCount: number;
  blocked: string | null;
};

const grant = (p: Person): FolderShareGrant => ({ profileId: p.profileId, name: p.displayName, email: p.email ?? null, role: p.role, guest: p.guest, isYou: p.isYou, canChange: p.canChange ?? false });

export function folderSharingValue(d: FolderSharingData): FolderSharingValue {
  return {
    folderId: d.folder.id,
    name: d.folder.name,
    color: d.folder.color ?? null,
    yourAccess: d.yourAccess,
    canManage: d.canManage,
    youAreGuest: d.youAreGuest,
    ownerName: d.ownerName ?? null,
    workspaceName: d.workspaceName ?? null,
    personal: d.personal,
    sharedBy: d.sharedBy ?? null,
    noteCount: d.noteCount,
    blocked: d.blocked ?? null,
    people: d.people.map(grant),
    inherited: d.inherited.map((f) => ({ folderId: f.folderId, folderName: f.folderName, people: f.people.map(grant) })),
    invites: d.pendingInvites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, expired: i.expired })),
  };
}

const folderSharingGet: ValueViewDef = {
  kind: "value",
  parse: (args: Args) => (only(args, ["id"]), { id: id(args, "id") }),
  create: (ctx, args) => {
    const src = source<FolderSharingData>(ctx, api.folderSharing.get, { folderId: args.id }, null);
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        return { value: s.value === undefined ? undefined : folderSharingValue(s.value), stale: s.stale, error: null };
      },
    };
  },
};

export type SharedFoldersData = (Omit<SharedFolderRow, "color" | "workspaceName" | "ownerName"> & { color?: string | null; workspaceName: string | null; ownerName: string | null; access?: string })[];

export const sharedFolderRow = (f: SharedFoldersData[number]): SharedFolderRow => ({
  id: f.id,
  name: f.name,
  color: f.color ?? null,
  role: f.role,
  sharedBy: f.sharedBy,
  sharedAt: f.sharedAt,
  workspaceName: f.workspaceName ?? null,
  ownerName: f.ownerName ?? null,
  noteCount: f.noteCount,
  updatedAt: f.updatedAt,
  inYourPlace: f.inYourPlace,
});

const sharedFolders: ValueViewDef = {
  kind: "value",
  parse: (args: Args) => (only(args, []), {}),
  create: (ctx) => {
    // Local mode has no sharing.
    if (ctx.deps().app.mode === "local") return { signals: [], compute: () => ({ value: { rows: [] }, stale: false, error: null }) };
    const src = source<SharedFoldersData>(ctx, api.folderSharing.sharedFolders, {}, null);
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        return { value: s.value === undefined ? undefined : { rows: s.value.map(sharedFolderRow) }, stale: s.stale, error: null };
      },
    };
  },
};

export type SharedFolderData = {
  folder: { id: string; name: string; color: string | null };
  access: string;
  inYourPlace: boolean;
  role: string | null;
  roleLabel: string | null;
  sharedBy: string | null;
  sharedFolderId: string | null;
  ownerName: string | null;
  workspaceName: string | null;
  path: { id: string; name: string }[];
  subfolders: { id: string; name: string; color: string | null; noteCount: number }[];
  notes: { id: string; title: string; icon: string | null; kind: string; excerpt: string; updatedAt: number; access: string }[];
} | null;

export function sharedFolderValue(folderId: string, d: SharedFolderData): SharedFolderValue {
  if (!d) return { found: false, id: folderId, name: "", color: null, access: "none", roleLabel: null, sharedBy: null, sharedFolderId: null, ownerName: null, workspaceName: null, inYourPlace: false, path: [], subfolders: [], notes: [] };
  return {
    found: true,
    id: d.folder.id,
    name: d.folder.name,
    color: d.folder.color ?? null,
    access: d.access,
    roleLabel: d.roleLabel ?? null,
    sharedBy: d.sharedBy ?? null,
    sharedFolderId: d.sharedFolderId ?? null,
    ownerName: d.ownerName ?? null,
    workspaceName: d.workspaceName ?? null,
    inYourPlace: d.inYourPlace,
    path: d.path.map((p) => ({ id: p.id, name: p.name })),
    subfolders: d.subfolders.map((f) => ({ id: f.id, name: f.name, color: f.color ?? null, noteCount: f.noteCount })),
    notes: d.notes.map((n) => ({ id: n.id, title: n.title, icon: n.icon ?? null, kind: n.kind, excerpt: n.excerpt, updatedAt: n.updatedAt, access: n.access })),
  };
}

const sharedFolderOpen: ValueViewDef = {
  kind: "value",
  parse: (args: Args) => (only(args, ["id"]), { id: id(args, "id") }),
  create: (ctx, args) => {
    const folderId = args.id as string;
    const src = source<SharedFolderData>(ctx, api.folderSharing.open, { folderId }, null);
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        return { value: s.value === undefined ? undefined : sharedFolderValue(folderId, s.value), stale: s.stale, error: null };
      },
    };
  },
};

export type MoveCheckData = { gainCount: number; loseCount: number; gains: string[]; loses: string[] };

/** The check, and the warning's words for these notes and that folder (null title: move without asking). */
export function moveCheckValue(c: MoveCheckData, count: number, folderName: string): NotesMoveCheckValue {
  const w = moveWarning(c, count, folderName);
  return { gainCount: c.gainCount, loseCount: c.loseCount, gains: c.gains, loses: c.loses, title: w?.title ?? null, message: w?.message ?? null };
}

const notesMoveCheck: ValueViewDef = {
  kind: "value",
  parse: (args: Args) => {
    only(args, ["ids", "folderId"]);
    const folderId = nullableId(args, "folderId");
    return { ids: ids(args, "ids", 50), folderId: folderId ?? null };
  },
  create: (ctx, args) => {
    const noteIds = args.ids as string[];
    const folderId = args.folderId as string | null;
    // Local mode has no sharing: nothing to warn about.
    if (ctx.deps().app.mode === "local" || !noteIds.length) return { signals: [], compute: () => ({ value: moveCheckValue({ gainCount: 0, loseCount: 0, gains: [], loses: [] }, noteIds.length, ""), stale: false, error: null }) };
    const src = source<MoveCheckData>(ctx, api.folderSharing.moveCheck, { documentIds: noteIds, folderId }, null);
    // The folder's name for the warning ("through “Garden club”"); a guest can't move notes, so it's in reach.
    const target = folderId ? source<FolderSharingData>(ctx, api.folderSharing.get, { folderId }, null) : null;
    return {
      signals: target ? [src, target] : [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: true, error: null };
        const name = folderId ? (target!.snapshot().value?.folder.name ?? "the folder") : "Drafts";
        return { value: moveCheckValue(s.value, noteIds.length, name), stale: s.stale, error: null };
      },
    };
  },
};

export const FOLDER_VALUE_VIEWS = {
  "folderSharing.get": folderSharingGet,
  "shared.folders": sharedFolders,
  "sharedFolder.open": sharedFolderOpen,
  "notes.moveCheck": notesMoveCheck,
} satisfies Partial<Record<ViewName, ValueViewDef>>;
