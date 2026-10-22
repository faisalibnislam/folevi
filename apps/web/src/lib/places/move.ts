"use client";
// "Move or copy notes..." between places (docs/MULTI_ACCOUNT_PLAN.md §7): the open place and another one, both
// reached from this page. The open place through the client the page already has (the E2EE router when that
// account encrypts); another account through a Convex HTTP client with its own short-lived token (website: the
// tab-pinned token route; apps: the host's `places.convexToken`); the library on this device opened beside an
// account (apps only). The copy itself is lib/migrate's, reshaped (picked notes, new ids), and a move then puts
// the originals in Trash.
import { ConvexHttpClient } from "convex/browser";
import { inboxDocumentId, PERSONAL_SCOPE_KEY, type WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { PIN_HEADER } from "@/lib/auth/placesCookies";
import { isShell, shell } from "@/lib/shell";
import { copyLibrary, MigrationError } from "@/lib/migrate/copy";
import { freshSource, pickedSource, pickIsEverything, trashOriginals, type Pick } from "@/lib/migrate/reshape";
import { accountFiles, clientSource, libraryFiles } from "@/lib/migrate/source";
import { accountUpload, clientTarget, libraryPutFile } from "@/lib/migrate/target";
import type { MigrationClient, MigrationProgress, MigrationState, MigrationSource, MigrationTarget, ProgressStore } from "@/lib/migrate/types";
import { userIdOf, type PlaceId } from "./registry";

/** One side of a move: a place and, for an account, which of its spaces. */
export interface MoveSide {
  place: PlaceId;
  scope: WireScope;
  /** For people to read: "Personal", "Acme", "On this Mac". */
  label: string;
}

export interface PlaceMove {
  from: MoveSide;
  to: MoveSide;
  /** null: everything. */
  pick: Pick | null;
  mode: "copy" | "move";
  versions: boolean;
  /** Keeps the new ids the same if the move stops and goes on. */
  key: string;
  startedAt: number;
}

/** A place's client as a move uses it. */
export interface MoveEnd {
  client: MigrationClient;
  kind: "account" | "library";
  /** Where attachments are read and stored. */
  source(scope: WireScope): MigrationSource;
  target(scope: WireScope, deviceId: string): MigrationTarget;
  close(): Promise<void>;
}

/** The end for a client this page already has (the open place). */
export function pageEnd(client: MigrationClient, kind: "account" | "library", store?: Parameters<typeof libraryFiles>[0]): MoveEnd {
  return {
    client,
    kind,
    source: (scope) => clientSource(client, { scope, readFile: kind === "library" && store ? libraryFiles(store) : accountFiles(client) }),
    target: (scope, deviceId) =>
      clientTarget(client, {
        scope,
        deviceId,
        putFile: kind === "library" ? libraryPutFile((client as unknown as { local: Parameters<typeof libraryPutFile>[0] }).local) : accountUpload(client),
      }),
    close: async () => {},
  };
}

const TOKEN_LIFE_MS = 10 * 60_000;

/** A Convex token for another account of this browser (the /api/auth proxy answers as the account named). */
async function webToken(userId: string): Promise<string | null> {
  const res = await fetch("/api/auth/convex/token", { headers: { [PIN_HEADER]: userId }, credentials: "same-origin", cache: "no-store" });
  if (!res.ok) return null;
  return ((await res.json()) as { token?: string }).token ?? null;
}

/** Another account, reached over HTTP with a token of its own (refreshed before it runs out). */
export async function otherAccountEnd(place: PlaceId): Promise<MoveEnd> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Folevi isn't connected to a backend here.");
  const userId = userIdOf(place);
  if (!userId) throw new Error("That isn't an account.");
  const token = async () => (isShell() ? await (shell()?.places?.convexToken(place) ?? Promise.resolve(null)) : await webToken(userId));
  const http = new ConvexHttpClient(url);
  let at = 0;
  const fresh = async () => {
    if (Date.now() - at < TOKEN_LIFE_MS) return;
    const t = await token();
    if (!t) throw new MigrationError("failed", "That account needs you to sign in again before notes can move there.");
    http.setAuth(t);
    at = Date.now();
  };
  const client = {
    query: async (ref: never, args: never) => (await fresh(), http.query(ref, args)),
    mutation: async (ref: never, args: never) => (await fresh(), http.mutation(ref, args)),
    action: async (ref: never, args: never) => (await fresh(), http.action(ref, args)),
  } as unknown as MigrationClient;
  return { ...pageEnd(client, "account"), close: async () => {} };
}

/** Whether an account's space is end-to-end encrypted (a raw client can't read or write it). */
export async function encryptedThere(end: MoveEnd, scope: WireScope): Promise<boolean> {
  if (end.kind !== "account") return false;
  try {
    const s = (await end.client.query(api.e2ee.spaces.get, { scope })) as { active?: boolean };
    return s.active === true;
  } catch {
    return false;
  }
}

/**
 * Runs a move (or goes on with one that stopped): the copy with new ids into `to`, then, for a move, the
 * originals into Trash where they were. `encrypted` names which side the page itself can read encrypted (the open
 * place, through its router); the other must be Standard.
 */
export async function runPlaceMove(o: {
  move: PlaceMove;
  from: MoveEnd;
  to: MoveEnd;
  /** The open place's side: its encryption is the router's to handle. */
  open: "from" | "to";
  deviceId: string;
  progress: ProgressStore;
  onProgress?: (p: MigrationProgress) => void;
  onTrash?: (done: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<MigrationState> {
  const { move } = o;
  const other = o.open === "from" ? { end: o.to, scope: move.to.scope, label: move.to.label } : { end: o.from, scope: move.from.scope, label: move.from.label };
  if (await encryptedThere(other.end, other.scope)) {
    throw new MigrationError("failed", `${other.label} is end-to-end encrypted, so its notes can only move from there. Open it and move them from its own menu.`);
  }
  let source = o.from.source(move.from.scope);
  if (!pickIsEverything(move.pick)) source = pickedSource(source, move.pick!);
  const everything = pickIsEverything(move.pick);
  // The Inbox pours into the Inbox there only for a whole Personal into a Personal.
  const mapInbox = everything && move.from.scope.kind === "personal" && move.to.scope.kind === "personal";
  const fresh = freshSource(source, move.key, { keepInbox: mapInbox });
  const state = await copyLibrary({
    source: fresh,
    target: o.to.target(move.to.scope, o.deviceId),
    progress: o.progress,
    direction: "upload",
    versions: move.versions,
    mapInbox,
    onProgress: o.onProgress,
    signal: o.signal,
  });
  if (move.mode === "move") {
    // (A picked source lists only what came along: the picked folders, their subfolders and notes.)
    const notes = await source.notes();
    const folders = (await source.organization()).folders.map((f) => f.id);
    const me = await source.profileId();
    await trashOriginals({ client: o.from.client, notes, folders, inboxId: inboxDocumentId(me, PERSONAL_SCOPE_KEY), onProgress: o.onTrash });
  }
  return state;
}
