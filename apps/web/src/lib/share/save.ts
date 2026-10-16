"use client";
// Saving a share as a note under the Inbox page of a place, through the sync engine like any other page:
// kept on this device first, so it works offline, with shared images and PDFs in the usual upload queue.
// The share page (components/app/ShareSheet.tsx) and the iPhone and iPad app's share extension (what it
// kept for the app, components/app/NativeBridge.tsx) both save this way.
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, inboxDocumentId, rankBetween, SCHEMA_VERSION, scopeIdKey, ulid, type WireBlock, type WireScope } from "@folevi/editor-schema";
import type { SyncEngine } from "@/lib/sync/engine";
import { enqueueUpload } from "@/lib/sync/uploads";
import { shareBlocks, shareFileKind, type SharePayload } from "./payload";

/** How long to wait for the server before saving on this device alone (a connection that only looks online). */
const ONLINE_WAIT_MS = 8000;

export interface ShareSaver {
  engine: SyncEngine;
  profileId: string;
  deviceId: string | null;
  online: boolean;
  /** tasks.inbox: the place's Inbox page (brought back from Trash, or an older one found). */
  prepareInbox: (args: { scope: WireScope; deviceId?: string }) => Promise<{ documentId: string; lastRank: string | null }>;
}

/**
 * A place's Inbox page: from the server when it answers (it brings one back from Trash, finds an older
 * one), else its deterministic id, created here if it doesn't exist yet (the same page every device
 * makes). Also what /inbox opens (components/app/RouteView.tsx).
 */
export async function inboxPage(saver: ShareSaver, scope: WireScope): Promise<{ documentId: string; lastRank: string | null }> {
  const { engine, profileId, deviceId, online } = saver;
  if (online) {
    try {
      const found = await Promise.race([saver.prepareInbox({ scope, deviceId: deviceId ?? undefined }), new Promise<null>((r) => setTimeout(() => r(null), ONLINE_WAIT_MS))]);
      if (found) return found;
    } catch (e) {
      const code = (e as { data?: { code?: string } }).data?.code;
      if (code) throw e;
    }
  }
  const documentId = inboxDocumentId(profileId, scopeIdKey(scope));
  engine.createDocument({ id: documentId, parentDocumentId: null, folderId: null, kind: "document", title: "Inbox", icon: "📥", scope });
  const known = engine.documentBlocks(documentId).filter((b) => b.parentId === null);
  return { documentId, lastRank: known.reduce<string | null>((m, b) => (m === null || b.rank > m ? b.rank : m), null) ?? "z" };
}

/**
 * Saves the share as a new note in the Inbox of `place` ("personal" or a workspace's id). With
 * `waitForServer` (the share page), it also waits a little for the server to have it, to say so.
 */
export async function saveShare(
  saver: ShareSaver,
  share: { payload: SharePayload; files: File[]; title: string; place: string },
  { waitForServer = true }: { waitForServer?: boolean } = {},
): Promise<{ noteId: string; synced: boolean }> {
  const { engine, profileId, online } = saver;
  const scope: WireScope = share.place === "personal" ? { kind: "personal" } : { kind: "workspace", workspaceId: share.place };
  const inbox = await inboxPage(saver, scope);

  const noteId = ulid();
  const name = share.title.trim().slice(0, 200) || share.payload.title;
  engine.createDocument({ id: noteId, parentDocumentId: inbox.documentId, folderId: null, kind: "document", title: name, icon: null, style: DEFAULT_DOCUMENT_STYLE, cover: DEFAULT_COVER, templateId: null });
  // Files first: each block waits in the queue until its upload is done (and the note is on the server).
  const fileBlocks: WireBlock[] = [];
  for (const file of share.files) {
    const kind = shareFileKind(file);
    if (!kind) continue;
    const id = ulid();
    await enqueueUpload(profileId, engine, { documentId: noteId, blockId: id, file, kind });
    fileBlocks.push(
      kind === "image"
        ? { id, type: "image", parentId: null, rank: "", schemaVersion: SCHEMA_VERSION, text: [], props: { alt: file.name.replace(/\.[^.]+$/, "").slice(0, 200), caption: "" } }
        : { id, type: "file", parentId: null, rank: "", schemaVersion: SCHEMA_VERSION, text: [], props: { name: file.name.slice(0, 200), size: file.size, mimeType: file.type } },
    );
  }
  const blocks = shareBlocks({ ...share.payload, title: name }, fileBlocks);
  const card: WireBlock = {
    id: ulid(),
    type: "page",
    parentId: null,
    rank: rankBetween(inbox.lastRank, null),
    schemaVersion: SCHEMA_VERSION,
    text: [],
    props: { documentId: noteId, display: "card", titleCache: name || "Untitled" },
  };
  const inboxId = inbox.documentId;
  engine.batch(() => {
    for (const b of blocks) engine.upsertBlock(noteId, b, ["content", "position"], null);
    engine.upsertBlock(inboxId, card, ["content", "position"], null);
  });
  await engine.persisted();
  // Sent now, not after the usual pause: a bookmarklet window may be closed the moment it says saved.
  let synced = false;
  if (online && waitForServer) {
    const firstText = blocks.find((b) => b.type !== "image" && b.type !== "file");
    synced = await Promise.all([
      engine.whenDocumentOnServer(noteId, 15_000),
      engine.whenBlockOnServer(inboxId, card.id, 15_000),
      ...(firstText ? [engine.whenBlockOnServer(noteId, firstText.id, 15_000)] : []),
    ]).then(
      () => true,
      () => false,
    );
  }
  if (share.files.length) window.dispatchEvent(new CustomEvent("folevi:uploads-changed"));
  return { noteId, synced };
}
