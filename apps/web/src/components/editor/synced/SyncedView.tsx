"use client";

// A synced block in a note (docs/SYNCED_BLOCKS.md): a quiet frame with "Synced, in 3 notes" and its menu, around
// an editor of its own for the content it shows. That editor is the note editor (Editor.tsx) on the synced
// content's id, through the same sync engine, so typing in it is saved, synced and kept offline like any note,
// and edits made in another note arrive live. Someone who can only read it (or the note) gets it read-only;
// someone who can't see it at all gets "You don't have access".
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Copy, ExternalLink, Lock, RefreshCw, Trash2, Unlink } from "lucide-react";
import type { WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { useEngineSelector } from "@/lib/hooks/useEngine";
import { useOfflineQuery } from "@/lib/sync/queryCache";
import { localDb } from "@/lib/sync/db";
import { haptic } from "@/lib/nativeApp";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";
import { Editor, type EditorHandle } from "../Editor";
import type { DecorationInputs } from "../plugins";
import { useEditable } from "../useEditable";
import { SYNCED_BODY_ATTR } from "./nested";
import { UNSYNC_EVENT, copySyncedBlock, focusWhenShown, pendingFileShares, unsyncBlock } from "./actions";
import { shownSyncedContent } from "./expand";
import "./synced.css";

type SourceBlocks = NonNullable<FunctionReturnType<typeof api.blocks.list>>;
/** Changes held on top of the loaded copy before it's folded in (as DocumentView does for a note). */
const REBASE_AFTER = 100;

/** The content's blocks as the server has them: loaded once, then only what changed (as DocumentView's useNoteBlocks). */
function useSourceBlocks(sourceId: string, enabled: boolean): SourceBlocks | null | undefined {
  const [base, setBase] = useState<{ id: string; blocks: SourceBlocks } | null>(null);
  const held = base?.id === sourceId ? base.blocks : null;
  const listed = useQuery(api.blocks.list, !enabled || held ? "skip" : { documentId: sourceId });
  const changes = useQuery(api.blocks.changes, enabled && held ? { documentId: sourceId, since: held.head } : "skip");
  useEffect(() => {
    if (!held && listed) setBase({ id: sourceId, blocks: listed });
  }, [held, listed, sourceId]);
  const merged = useMemo(() => {
    if (!held || !changes) return held;
    if (!changes.blocks.length && !changes.deleted.length && changes.revision === held.revision && changes.contentSeq === held.contentSeq) return held;
    const byId = new Map(held.blocks.map((b) => [b.id, b]));
    for (const id of changes.deleted) byId.delete(id);
    for (const b of changes.blocks) byId.set(b.id, b);
    return { documentId: held.documentId, revision: changes.revision, contentSeq: changes.contentSeq, head: changes.head, blocks: [...byId.values()] };
  }, [held, changes]);
  useEffect(() => {
    if (!held || !changes || !merged) return;
    if (changes.more) setBase(null);
    else if (changes.blocks.length + changes.deleted.length > REBASE_AFTER) setBase({ id: sourceId, blocks: merged });
  }, [held, changes, merged, sourceId]);
  if (!enabled) return undefined;
  if (!held) return listed;
  if (changes === null) return null;
  return merged;
}

const NO_DECORATIONS: DecorationInputs = { presence: [], commentBlocks: new Set(), selectedBlocks: new Set(), conflictBlocks: new Set() };

const plural = (n: number) => `${n} ${n === 1 ? "note" : "notes"}`;

export function SyncedView({ node, editor, getPos, selected, deleteNode }: ReactNodeViewProps) {
  const sourceId = String(node.attrs.sourceId ?? "");
  const { engine, profile, online } = useAppState();
  const { navigate } = useAppRouter();
  const toast = useToast();
  const parentEditable = useEditable(editor);
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<EditorHandle>(null);
  const [inner, setInner] = useState<TiptapEditor | null>(null);
  // The note this block is in, and whether that is itself a synced block's content (nothing nests).
  const [where, setWhere] = useState<{ noteId: string | null; nested: boolean }>({ noteId: null, nested: false });
  useLayoutEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    setWhere({ noteId: dom.closest("[data-fb-root]")?.getAttribute("data-fb-root") ?? null, nested: Boolean(dom.closest(`[${SYNCED_BODY_ATTR}]`)) });
  }, [editor]);

  const info = useOfflineQuery(api.synced.info, sourceId && !where.nested ? { sourceId } : "skip");
  // Made on this device and not on the server yet: it's ours, and editable, from the start.
  const creating = useEngineSelector(engine, (s) => [...s.inflight, ...s.pending].some((op) => op.kind === "document.create" && op.document.id === sourceId));
  const known = useEngineSelector(engine, () => Boolean(engine && sourceId && engine.documentBlocks(sourceId).length));
  const status: "loading" | "ok" | "forbidden" | "missing" = where.nested ? "missing" : creating ? "ok" : info === undefined ? (known ? "ok" : "loading") : info.status;
  const canEdit = parentEditable && (creating || (info?.status === "ok" ? info.canEdit : known && !online));
  const server = useSourceBlocks(sourceId, status === "ok" && !creating);

  // Server → engine → the block's editor, as DocumentView does for the note (local typing is flushed first).
  const [ready, setReady] = useState(false);
  const reconciledAt = useRef<string | null>(null);
  useEffect(() => {
    if (!engine || !server) return;
    let revisions = 0;
    for (const b of server.blocks) revisions += b.revision ?? 0;
    const at = `${server.revision}:${server.contentSeq}:${server.blocks.length}:${revisions}`;
    if (reconciledAt.current === at) return;
    reconciledAt.current = at;
    innerRef.current?.flush();
    engine.reconcileDocument(sourceId, server.blocks);
    innerRef.current?.applyFromEngine();
    setReady(true);
    // Kept on the device for an offline reload, like a note's blocks.
    const blocks = server.blocks;
    const t = setTimeout(() => {
      void localDb(profile.id).then((db) => db.put("blocks", { documentId: sourceId, blocks, cachedAt: Date.now() })).catch(() => undefined);
    }, 2000);
    return () => clearTimeout(t);
  }, [engine, server, sourceId, profile.id]);
  // Offline (or slow): the copy kept on this device.
  useEffect(() => {
    if (!engine || ready || status !== "ok" || server) return;
    const t = setTimeout(
      async () => {
        const cached = await (await localDb(profile.id)).get("blocks", sourceId).catch(() => undefined);
        if (cached && !engine.documentBlocks(sourceId).length) engine.reconcileDocument(sourceId, cached.blocks);
        setReady(true);
      },
      online ? 1500 : 0,
    );
    return () => clearTimeout(t);
  }, [engine, ready, status, server, sourceId, profile.id, online]);
  const showEditor = Boolean(engine) && status === "ok" && (ready || creating || known);

  // The same content twice in this tab (two notes open, or twice in one note): an edit in one shows in the other.
  useEffect(() => {
    if (!engine || !inner) return;
    // The engine hands back the same array while this content's blocks are unchanged.
    let last = engine.documentBlocks(sourceId);
    return engine.subscribe((e) => {
      if (e.type !== "state" || inner.isFocused || inner.isDestroyed) return;
      const now = engine.documentBlocks(sourceId);
      if (now === last) return;
      last = now;
      innerRef.current?.applyFromEngine();
    });
  }, [engine, inner, sourceId]);

  // A new synced block takes the caret.
  useEffect(() => {
    if (!inner || !focusWhenShown.has(sourceId)) return;
    focusWhenShown.delete(sourceId);
    requestAnimationFrame(() => inner.commands.focus("end"));
  }, [inner, sourceId]);

  // Files in lines just turned into a synced block get rows of the synced content once it's on the server
  // (files.shareForPaste), so every note showing it can open them.
  const share = useMutation(api.files.shareForPaste);
  useEffect(() => {
    if (!engine || !pendingFileShares.has(sourceId)) return;
    pendingFileShares.delete(sourceId);
    void (async () => {
      const fileIds = [...new Set(engine.documentBlocks(sourceId).flatMap((b) => (typeof (b.props as { fileId?: unknown }).fileId === "string" ? [String((b.props as { fileId: string }).fileId)] : [])))];
      if (!fileIds.length) return;
      try {
        await engine.whenDocumentOnServer(sourceId, 120_000);
        const map = await share({ documentId: sourceId, fileIds });
        innerRef.current?.flush();
        engine.batch(() => {
          for (const b of engine.documentBlocks(sourceId)) {
            const fid = (b.props as { fileId?: unknown }).fileId;
            const next = typeof fid === "string" ? map[fid] : undefined;
            if (next && next !== fid) engine.upsertBlock(sourceId, { ...b, props: { ...b.props, fileId: next } }, ["content"]);
          }
        });
        innerRef.current?.applyFromEngine();
      } catch {
        // The files stay those of the note they were in (it can still open them).
      }
    })();
  }, [engine, sourceId, share]);

  // Exports write what it shows now (expand.ts).
  useEffect(() => {
    if (!engine || status !== "ok") return;
    const read = () => engine.documentBlocks(sourceId);
    shownSyncedContent.set(sourceId, read);
    return () => {
      if (shownSyncedContent.get(sourceId) === read) shownSyncedContent.delete(sourceId);
    };
  }, [engine, sourceId, status]);

  const pos = () => (typeof getPos === "function" ? getPos() : undefined);
  const content = useCallback((): WireBlock[] => {
    innerRef.current?.flush();
    return engine ? engine.documentBlocks(sourceId) : [];
  }, [engine, sourceId]);
  const unsync = useCallback(() => {
    const at = pos();
    if (typeof at !== "number" || !editor.isEditable) return;
    if (unsyncBlock(editor, at, content())) {
      haptic("light");
      toast.show("Unsynced. This note keeps its own copy now.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, content, toast]);
  // The block menu's Unsync (actions.ts) asks the frame, which has the content.
  useEffect(() => {
    const host = wrapRef.current?.closest("[data-block-id]");
    if (!host) return;
    host.addEventListener(UNSYNC_EVENT, unsync);
    return () => host.removeEventListener(UNSYNC_EVENT, unsync);
  }, [unsync]);

  const copy = () => {
    const at = pos();
    if (typeof at !== "number") return;
    if (copySyncedBlock(editor, at)) toast.show("Synced block copied. Paste it into another note to show it there too.");
    else toast.show("Your browser blocked copying from the menu. Select the block and press ⌘C instead.", { tone: "error" });
  };

  const count = info?.status === "ok" ? info.noteCount : creating ? 1 : null;
  const others = info?.status === "ok" ? info.notes.filter((n) => n.id !== where.noteId) : [];
  const hidden = info?.status === "ok" ? Math.max(0, info.noteCount - info.notes.length) : 0;
  const last = count !== null && count <= 1;
  const items: MenuEntry[] = [];
  if (others.length || hidden) {
    items.push({ heading: "Also in" });
    for (const n of others.slice(0, 12)) items.push({ label: n.title, icon: <ExternalLink size={14} />, onSelect: () => navigate(`/d/${n.id}`) });
    if (hidden) items.push({ label: `${plural(hidden)} you can't open`, disabled: true, onSelect: () => undefined });
    items.push("separator");
  }
  if (status === "ok") items.push({ label: "Copy synced block", icon: <Copy size={14} />, description: "Paste it into another note to show it there too", onSelect: copy });
  if (parentEditable && status === "ok") items.push({ label: "Unsync", icon: <Unlink size={14} />, description: "This note keeps its own copy; the others stay synced", onSelect: unsync });
  if (parentEditable)
    items.push({
      label: "Remove from this note",
      icon: <Trash2 size={14} />,
      danger: true,
      description: status !== "ok" ? undefined : last ? "Only in this note: it's kept for 30 days, and Undo brings it back" : "It stays in the other notes",
      onSelect: () => deleteNode(),
    });

  const label = status === "ok" && count !== null ? `Synced, in ${plural(count)}` : status === "ok" || status === "loading" ? "Synced" : "Synced block";

  return (
    <NodeViewWrapper>
      <div ref={wrapRef} className="fb-synced" data-selected={selected ? "true" : undefined} data-state={status} data-editable={canEdit ? "true" : "false"} contentEditable={false}>
        <div className="fb-synced-bar">
          <RefreshCw size={12} aria-hidden className="fb-synced-icon" />
          {items.length ? (
            <MenuButton
              label={label.startsWith("Synced,") ? `${label}, options` : "Synced block options"}
              align="start"
              triggerClassName="fb-synced-label"
              trigger={
                <>
                  <span>{label}</span>
                  <ChevronDown size={12} aria-hidden />
                </>
              }
              items={items}
            />
          ) : (
            <span className="fb-synced-label">{label}</span>
          )}
          {status === "ok" && !canEdit && info?.status === "ok" ? <span className="fb-synced-note">View only</span> : null}
        </div>
        {showEditor && engine ? (
          <div {...{ [SYNCED_BODY_ATTR]: "" }} className="fb-synced-body">
            <Editor
              ref={innerRef}
              documentId={sourceId}
              engine={engine}
              accountKey={profile.id}
              editable={canEdit}
              decorations={NO_DECORATIONS}
              label="Synced block"
              placeholder="Write here. It shows in every note with this synced block."
              onEditorReady={setInner}
            />
          </div>
        ) : status === "loading" || (status === "ok" && !showEditor) ? (
          <div className="fb-synced-loading" aria-busy aria-label="Loading synced block" />
        ) : (
          <div className="fb-synced-empty" role="note">
            <Lock size={14} aria-hidden />
            <span>
              {where.nested
                ? "A synced block can't go inside another synced block."
                : status === "forbidden"
                  ? "You don't have access to this synced block. It comes from a place or note you can't open."
                  : "This synced block was deleted."}
            </span>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export default SyncedView;
