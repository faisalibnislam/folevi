"use client";

// Making, copying and unsyncing synced blocks (docs/SYNCED_BLOCKS.md). Everything goes through the sync engine's
// queue, in order, so it works offline like any edit: the content is created (a document of kind "synced" in
// the note's place) with its blocks, then the note's synced block that shows it is saved with the note.
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { createElement, useCallback, useEffect, useMemo } from "react";
import { Copy, RefreshCw, Unlink } from "lucide-react";
import { SCHEMA_VERSION, flattenTree, rankBetween, scopeIdKey, ulid, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { useOfflineQuery } from "@/lib/sync/queryCache";
import { useEngineSelector } from "@/lib/hooks/useEngine";
import { api } from "@/lib/convex/api";
import type { SyncEngine } from "@/lib/sync/engine";
import { useEditorEnvironment } from "../environment";
import { useToast } from "@/components/ui/Toast";
import { haptic } from "@/lib/nativeApp";
import { nodesToBlocks } from "../blockClipboard";
import { blockToNode } from "../convert";
import { insertBlockAfterCurrent, subtreeRange } from "../commands";
import { clearBlockSelection, setBlockSelection } from "../blockSelection";
import { SYNCED_BODY_ATTR } from "./nested";

export interface SyncedEnv {
  engine: SyncEngine | null;
  /** Where new synced content made in this note goes, when the person may make some here (else null). */
  scope: WireScope | null;
  /** This editor is a synced block's own: no synced block goes inside it. */
  nested: boolean;
  /** The site's demo note (no account): nothing can be made. */
  demo: boolean;
}

/** Synced blocks a person makes are at most this many lines (a note's limit is far above it). */
const MAX_SYNCED_LINES = 500;

/**
 * What the menus need to offer synced blocks in the note `documentId`: its place (Personal, if it's the
 * person's own; a workspace they belong to) and whether this is a synced block's own editor. Read from the
 * note's details (kept on the device for offline use), or from its create still waiting to sync.
 */
export function useSyncedEnv(documentId: string): SyncedEnv {
  const { engine, profile } = useAppState();
  const { demo } = useEditorEnvironment();
  const meta = useOfflineQuery(api.documents.get, demo ? "skip" : { documentId });
  const pending = useEngineSelector(
    engine,
    (s) => {
      const op = [...s.inflight, ...s.pending].find((o) => o.kind === "document.create" && o.document.id === documentId);
      return op?.kind === "document.create" ? op.document : null;
    },
    (a, b) => a?.id === b?.id,
  );
  let scope: WireScope | null = null;
  let nested = false;
  if (meta) {
    const d = meta.document;
    nested = d.kind === "synced";
    const canWrite = meta.access === "write" || meta.access === "manage";
    if (canWrite && meta.isMember && !meta.inTrash) {
      if (d.workspaceId) scope = { kind: "workspace", workspaceId: d.workspaceId };
      else if (d.ownerProfileId === profile.id) scope = { kind: "personal" };
    }
  } else if (pending) {
    nested = pending.kind === "synced";
    // A note made on this device and not synced yet: a top-level one goes where its create says.
    if (!pending.parentDocumentId && pending.scope) scope = pending.scope;
  }
  const scopeKey = scope ? scopeIdKey(scope) : null;
  // The same object while nothing it says changes (menus memoize on it).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ engine, scope: nested ? null : scope, nested, demo }), [engine, scopeKey, nested, demo]);
}

/** Asks the note's editor to add a synced block where the caret is (the Insert panel lives outside it). */
export function requestSyncedInsert(editor: Editor) {
  editor.view.dom.dispatchEvent(new CustomEvent(INSERT_EVENT));
}
const INSERT_EVENT = "folevi:insert-synced";

/**
 * The editor menus' synced block helpers: where content can be made (useSyncedEnv), and `insert` for the slash
 * menu and the Insert panel (requestSyncedInsert), which says why when it can't.
 */
export function useSyncedMenus(editor: Editor, documentId: string, editable: boolean): SyncedEnv & { insert: () => void } {
  const env = useSyncedEnv(documentId);
  const { unavailable } = useEditorEnvironment();
  const toast = useToast();
  const insert = useCallback(() => {
    if (env.demo) return unavailable("Synced blocks");
    if (!editable) return;
    if (env.nested || isNestedEditor(editor)) return toast.show("A synced block can't go inside another synced block.", { tone: "error" });
    if (!insertSyncedBlock(editor, env)) toast.show("Synced blocks can be added to notes in your own places (your Personal, or a workspace you're in).", { tone: "error" });
    else haptic("light");
  }, [editor, env, editable, unavailable, toast]);
  // Its view loads with the note (not on the first synced block): a new one takes the caret at once, so the
  // first letters typed land in it.
  useEffect(() => {
    if (!env.demo) void import("./SyncedView").catch(() => undefined);
  }, [env.demo]);
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const on = () => insert();
    dom.addEventListener(INSERT_EVENT, on);
    return () => dom.removeEventListener(INSERT_EVENT, on);
  }, [editor, insert]);
  return useMemo(() => ({ ...env, insert }), [env, insert]);
}

/** Whether the editor is a synced block's own (no synced block goes inside it), from where it sits. */
function isNestedEditor(editor: Editor): boolean {
  return Boolean((editor.view.dom as HTMLElement).closest(`[${SYNCED_BODY_ATTR}]`));
}

/** Synced content scheduled to take the caret when its block appears (SyncedView). */
export const focusWhenShown = new Set<string>();

/** Queues new synced content in `scope` holding `blocks` (wire blocks, as nodesToBlocks makes them). */
function createSource(engine: SyncEngine, scope: WireScope, blocks: WireBlock[]): string {
  const sourceId = ulid();
  engine.createDocument({ id: sourceId, parentDocumentId: null, folderId: null, kind: "synced", title: "", icon: null, scope });
  engine.batch(() => {
    for (const b of flattenTree(blocks)) engine.upsertBlock(sourceId, b.block, ["content", "position"], null);
  });
  return sourceId;
}

/** "Synced block" from the slash menu or the Insert panel: an empty one, with the caret in it. */
export function insertSyncedBlock(editor: Editor, env: SyncedEnv): boolean {
  if (!env.engine || !env.scope || env.nested || isNestedEditor(editor)) return false;
  const first: WireBlock = { id: ulid(), type: "paragraph", parentId: null, rank: rankBetween(null, null), schemaVersion: SCHEMA_VERSION, text: [], props: {} };
  const sourceId = createSource(env.engine, env.scope, [first]);
  focusWhenShown.add(sourceId);
  insertBlockAfterCurrent(editor, "synced", { sourceId });
  return true;
}

/** The note's top-level lines `from`..`to` with everything nested under the last one, and where they sit. */
function lines(editor: Editor, from: number, to: number): { nodes: PMNode[]; start: number; end: number; depth: number } | null {
  const { doc } = editor.state;
  if (from < 0 || to >= doc.childCount || to < from) return null;
  let start = 0;
  for (let i = 0; i < from; i++) start += doc.child(i).nodeSize;
  const end = subtreeRange(editor.state, to).end;
  const nodes: PMNode[] = [];
  doc.nodesBetween(start, end, (n, pos) => {
    if (pos >= start && pos < end) nodes.push(n);
    return false;
  });
  return { nodes, start, end, depth: Number(doc.child(from).attrs.depth ?? 0) };
}

/** Whether lines `from`..`to` can become a synced block (none is one already, and they're not too many). */
export function canTurnIntoSynced(editor: Editor, from: number, to: number, env: SyncedEnv): boolean {
  if (!env.engine || !env.scope || env.nested || !editor.isEditable) return false;
  const found = lines(editor, from, to);
  return Boolean(found && found.nodes.length <= MAX_SYNCED_LINES && found.nodes.every((n) => n.type.name !== "synced" && n.type.name !== "unknownBlock"));
}

/**
 * "Turn into synced block": the lines (and what's nested under them) become synced content, and a synced
 * block showing it takes their place, as one undo step in the note. Files in them are shared with the content
 * once it's on the server (SyncedView), like pasted ones.
 */
export function turnIntoSynced(editor: Editor, from: number, to: number, env: SyncedEnv): string | null {
  if (!canTurnIntoSynced(editor, from, to, env)) return null;
  const found = lines(editor, from, to)!;
  const blocks = nodesToBlocks(found.nodes);
  if (!blocks.length) return null;
  const sourceId = createSource(env.engine!, env.scope!, blocks);
  const { state } = editor;
  const node = state.schema.nodes.synced!.create({ id: ulid(), depth: found.depth, sourceId });
  const tr = state.tr.replaceWith(found.start, found.end, node);
  const after = found.start + node.nodeSize;
  if (!tr.doc.nodeAt(after)) tr.insert(after, state.schema.nodes.paragraph!.create({ id: ulid(), depth: found.depth }));
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, after + 1))));
  clearBlockSelection(editor.view);
  editor.view.dispatch(tr.scrollIntoView());
  pendingFileShares.add(sourceId);
  return sourceId;
}

/** Synced content just made from lines that may carry files: SyncedView shares those files with it. */
export const pendingFileShares = new Set<string>();

/**
 * "Unsync": this note's synced block becomes ordinary lines holding what it shows now. The content stays
 * shown in the other notes (and goes to Trash, keeping everything, if this was the last one).
 */
export function unsyncBlock(editor: Editor, pos: number, content: readonly WireBlock[]): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "synced") return false;
  const depth = Number(node.attrs.depth ?? 0);
  const { schema } = editor.state;
  const nodes = flattenTree(content).map(({ block, depth: d }) => schema.nodeFromJSON(blockToNode({ ...block, id: ulid() }, depth + d)));
  if (!nodes.length) nodes.push(schema.nodes.paragraph!.create({ id: ulid(), depth }));
  // Marked as a paste: the files in the copies get rows of this note (pastedFiles.ts), like pasted blocks.
  const tr = editor.state.tr.replaceWith(pos, pos + node.nodeSize, nodes).setMeta("paste", true).setMeta("uiEvent", "paste");
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, pos + 1))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * "Copy synced block": the synced block goes on the clipboard as a block (blockClipboard.ts), so pasting it in
 * another note shows the same content there. Returns whether the browser let it copy.
 */
export function copySyncedBlock(editor: Editor, pos: number): boolean {
  const index = editor.state.doc.resolve(pos).index(0);
  editor.view.focus();
  setBlockSelection(editor.view, index, index);
  let ok: boolean;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  clearBlockSelection(editor.view);
  return ok;
}

type BlockMenuItem = { label: string; hint: string; icon: React.ReactNode; run: () => void };

/**
 * The block menu's synced block items: "Turn into synced block" for ordinary lines, and for a synced block,
 * "Copy synced block" (to paste into other notes) and "Unsync" (via its own frame, which has its content).
 */
export function syncedMenuItems(
  editor: Editor,
  from: number,
  to: number,
  env: SyncedEnv,
  opts: { close: (refocus?: boolean) => void; copied: (ok: boolean) => void },
): BlockMenuItem[] {
  const single = from === to ? editor.state.doc.maybeChild(from) : null;
  if (single?.type.name === "synced") {
    let pos = 0;
    for (let i = 0; i < from; i++) pos += editor.state.doc.child(i).nodeSize;
    const items: BlockMenuItem[] = [
      {
        label: "Copy synced block",
        hint: "",
        icon: createElement(Copy, { size: 14 }),
        run: () => {
          opts.close(false);
          opts.copied(copySyncedBlock(editor, pos));
        },
      },
    ];
    if (editor.isEditable)
      items.push({
        label: "Unsync",
        hint: "",
        icon: createElement(Unlink, { size: 14 }),
        run: () => {
          opts.close(false);
          // The frame has the content as it shows it now (SyncedView listens for this).
          blockDomAt(editor, from)?.dispatchEvent(new CustomEvent(UNSYNC_EVENT));
        },
      });
    return items;
  }
  if (env.demo || !canTurnIntoSynced(editor, from, to, env)) return [];
  return [
    {
      label: "Turn into synced block",
      hint: "",
      icon: createElement(RefreshCw, { size: 14 }),
      run: () => {
        opts.close(false);
        turnIntoSynced(editor, from, to, env);
      },
    },
  ];
}

/** Asks a synced block's frame to unsync (it holds the content to keep). */
export const UNSYNC_EVENT = "folevi:synced-unsync";

function blockDomAt(editor: Editor, index: number): HTMLElement | null {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
  const el = editor.view.nodeDOM(pos);
  return el instanceof HTMLElement ? el : null;
}
