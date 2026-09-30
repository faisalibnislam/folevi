"use client";

import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { LIMITS, markdownToBlocks, plainTextToBlocks, ulid, type WireBlock } from "@folevi/editor-schema";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex/api";
import type { SyncEngine } from "@/lib/sync/engine";
import { enqueueUpload } from "@/lib/sync/uploads";
import { decorationsKey, type DecorationInputs, type TriggerState } from "./plugins";
import { editorExtensions } from "./editorExtensions";
import { blockToNode, blocksToDoc, contentKey, diffBlocks, docToBlocks } from "./convert";
import { flattenTree } from "@folevi/editor-schema";
import { htmlToBlocks } from "./paste";
import { EditorMenus } from "./EditorMenus";
import { subtreeRange, normalizeDepths, moveSubtreeTo } from "./commands";
import { closeHistory } from "@tiptap/pm/history";
import { useAiEnabled } from "@/components/ai/useAi";

export interface EditorHandle {
  /** Pushes pending local edits into the sync engine immediately. */
  flush: () => void;
  /** Re-applies the engine's view of the document (remote changes) without disturbing the cursor. */
  applyFromEngine: () => void;
  editor: TiptapEditor | null;
  focusBlock: (blockId: string) => void;
}

interface Props {
  documentId: string;
  engine: SyncEngine;
  accountKey: string;
  editable: boolean;
  decorations: DecorationInputs;
  onFocusBlock?: (blockId: string | null) => void;
  onCommentBlock?: (blockId: string) => void;
  onEditorReady?: (editor: TiptapEditor) => void;
  placeholder?: string;
}

const FLUSH_DELAY = 250;

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { documentId, engine, accountKey, editable, decorations, onFocusBlock, onCommentBlock, onEditorReady, placeholder },
  ref,
) {
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  // The empty-line hint mentions ⌘J while the AI assistant is on (read by the placeholder at render time).
  const aiHint = useRef(false);
  aiHint.current = useAiEnabled() && editable;
  // Nothing is ever flushed until the editor shows the document's real content (prevents an empty,
  // not-yet-loaded editor from being mistaken for "the person deleted everything").
  const hydrated = useRef(false);

  const engineBlocksMap = useCallback(() => new Map(engine.documentBlocks(documentId).map((b) => [b.id, b])), [engine, documentId]);

  // Fractional ranks grow when blocks are repeatedly inserted between the same neighbours. When one gets
  // long, ask the server to re-space that sibling list once our own queued changes have synced.
  const rebalance = useMutation(api.blocks.rebalance);
  const rebalanceParents = useRef(new Set<string | null>());
  const runRebalance = useCallback(() => {
    if (!rebalanceParents.current.size || engine.hasLocalWork(documentId) || !navigator.onLine) return;
    const parents = [...rebalanceParents.current];
    rebalanceParents.current.clear();
    for (const parentId of parents) {
      rebalance({ documentId, parentId }).catch(() => {
        // Not fatal (e.g. read-only now): ranks stay valid, just long. Try again after the next edit.
      });
    }
  }, [engine, documentId, rebalance]);
  useEffect(() => engine.subscribe(() => runRebalance()), [engine, runRebalance]);

  const extensions = useMemo(
    () => editorExtensions({ aiHint, placeholder, onTrigger: setTrigger }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const flushLocal = useCallback(
    (editor: TiptapEditor | null) => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      if (!editor || !dirty.current || !hydrated.current) return;
      dirty.current = false;
      engine.setEditing(documentId, false);
      const previous = engineBlocksMap();
      const next = docToBlocks(editor.state.doc, previous);
      const diff = diffBlocks(previous, next);
      for (const d of diff.deletes) engine.deleteBlock(documentId, d);
      for (const u of diff.upserts) {
        engine.upsertBlock(documentId, u.block, u.fields);
        if (u.fields.includes("position") && u.block.rank.length > LIMITS.maxRankLength / 2) rebalanceParents.current.add(u.block.parentId);
      }
    },
    [engine, documentId, engineBlocksMap],
  );

  const editor = useEditor({
    extensions,
    editable,
    immediatelyRender: false,
    content: blocksToDoc(engine.documentBlocks(documentId)),
    editorProps: {
      attributes: {
        class: "fb-editor",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Document body",
        spellcheck: "true",
      },
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length && editable) {
          event.preventDefault();
          void insertFiles(files);
          return true;
        }
        const html = event.clipboardData?.getData("text/html");
        const text = event.clipboardData?.getData("text/plain") ?? "";
        // Inside code blocks paste raw text.
        if (view.state.selection.$from.parent.type.name === "codeBlock") return false;
        let blocks: WireBlock[] | null = null;
        if (html && !html.includes("data-pm-slice")) blocks = htmlToBlocks(html);
        else if (!html && text && (/\n/.test(text) || /^(#{1,3} |[-*+] |\d+[.)] |> |```|\[[ x]\] )/m.test(text))) {
          blocks = looksLikeMarkdown(text) ? markdownToBlocks(text, { titleFromHeading: false }).blocks : plainTextToBlocks(text);
        }
        if (!blocks || !blocks.length) return false;
        event.preventDefault();
        insertBlocks(view.state.selection.$from.index(0), blocks);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !editable) return false;
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (pos) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos.pos))));
        void insertFiles(files);
        return true;
      },
    },
    onCreate: () => {
      hydrated.current = true;
    },
    onUpdate: ({ transaction }) => {
      // Only genuine local document changes count (setEditable and meta-only transactions emit updates too).
      if (!transaction.docChanged || transaction.getMeta("remote")) return;
      dirty.current = true;
      if (hydrated.current) engine.setEditing(documentId, true);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => flushLocal(editorRef.current), FLUSH_DELAY);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const $from = ed.state.selection.$from;
      const node = $from.depth >= 1 ? $from.node(1) : ed.state.doc.nodeAt(ed.state.selection.from);
      onFocusBlock?.((node?.attrs.id as string | undefined) ?? null);
    },
    onBlur: () => flushLocal(editorRef.current),
  });

  const editorRef = useRef<TiptapEditor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    if (editor) onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // Push decoration inputs (presence, comments, conflicts) into the plugin.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(decorationsKey, decorations).setMeta("addToHistory", false).setMeta("remote", true));
  }, [editor, decorations]);

  const applyFromEngine = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    flushLocal(ed);
    const blocks = engine.documentBlocks(documentId);
    const desired = flattenTree(blocks);
    const current: { id: string | null; key: string; depth: number }[] = [];
    ed.state.doc.forEach((n) => current.push({ id: n.attrs.id as string | null, key: "", depth: Number(n.attrs.depth ?? 0) }));
    const currentBlocks = docToBlocks(ed.state.doc, new Map(blocks.map((b) => [b.id, b])));
    const currentById = new Map(currentBlocks.map((b) => [b.id, b]));
    const sameOrder = desired.length === current.length && desired.every((d, i) => d.block.id === current[i]!.id && d.depth === current[i]!.depth);
    const tr = ed.state.tr;
    if (sameOrder) {
      let pos = 0;
      ed.state.doc.forEach((node, _offset, i) => {
        const want = desired[i]!;
        const have = currentById.get(want.block.id);
        if (!have || contentKey(have) !== contentKey(want.block)) {
          const replacement = ed.schema.nodeFromJSON(blockToNode(want.block, want.depth));
          tr.replaceWith(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize), replacement);
        }
        pos += node.nodeSize;
      });
    } else {
      // Structural change: rebuild and restore the cursor by block id + offset.
      const $from = ed.state.selection.$from;
      const anchorId = $from.depth >= 1 ? ($from.node(1).attrs.id as string) : null;
      const anchorOffset = $from.parentOffset;
      const doc = ed.schema.nodeFromJSON(blocksToDoc(blocks));
      tr.replaceWith(0, ed.state.doc.content.size, doc.content);
      if (anchorId) {
        let target: number | null = null;
        tr.doc.forEach((n, offset) => {
          if (n.attrs.id === anchorId) target = offset + 1 + Math.min(anchorOffset, n.content.size);
        });
        if (target !== null) tr.setSelection(TextSelection.near(tr.doc.resolve(target)));
      }
    }
    if (!tr.docChanged) return;
    tr.setMeta("remote", true).setMeta("addToHistory", false);
    ed.view.dispatch(tr);
  }, [engine, documentId, flushLocal]);

  // Engine events: attachment uploads finishing update the node attrs.
  useEffect(() => {
    return engine.subscribe((e) => {
      if (e.type === "upload-complete" && e.documentId === documentId) {
        const ed = editorRef.current;
        if (!ed) return;
        let target: number | null = null;
        ed.state.doc.forEach((n, offset) => {
          if (n.attrs.id === e.blockId) target = offset;
        });
        if (target === null) return;
        const node = ed.state.doc.nodeAt(target)!;
        ed.view.dispatch(ed.state.tr.setNodeMarkup(target, undefined, { ...node.attrs, fileId: e.fileId, uploadId: null }).setMeta("remote", true).setMeta("addToHistory", false));
      }
    });
  }, [engine, documentId]);

  // Flush on tab hide / unload so nothing typed is lost.
  useEffect(() => {
    const onHide = () => flushLocal(editorRef.current);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      onHide();
      engine.setEditing(documentId, false);
    };
  }, [flushLocal, engine, documentId]);

  const insertBlocks = useCallback(
    (afterIndex: number, blocks: WireBlock[]) => {
      const ed = editorRef.current;
      if (!ed) return;
      const flat = flattenTree(blocks);
      const $from = ed.state.selection.$from;
      const baseDepth = $from.depth >= 1 ? Number($from.node(1).attrs.depth ?? 0) : 0;
      const nodes = flat.map(({ block, depth }) => ed.schema.nodeFromJSON(blockToNode({ ...block, id: ulid() }, baseDepth + depth)));
      let at = 0;
      for (let i = 0; i <= Math.min(afterIndex, ed.state.doc.childCount - 1); i++) at += ed.state.doc.child(i).nodeSize;
      const currentNode = ed.state.doc.child(Math.min(afterIndex, ed.state.doc.childCount - 1));
      const tr = ed.state.tr;
      if (currentNode.isTextblock && currentNode.content.size === 0) {
        tr.replaceWith(at - currentNode.nodeSize, at, nodes);
      } else {
        tr.insert(at, nodes);
      }
      normalizeDepths(tr);
      ed.view.dispatch(tr.scrollIntoView());
    },
    [],
  );

  const insertFiles = useCallback(
    async (files: File[]) => {
      const ed = editorRef.current;
      if (!ed) return;
      for (const file of files.slice(0, 10)) {
        const isImage = /^image\/(png|jpe?g|gif|webp)$/i.test(file.type);
        const blockId = ulid();
        const $from = ed.state.selection.$from;
        const depth = $from.depth >= 1 ? Number($from.node(1).attrs.depth ?? 0) : 0;
        const node = isImage
          ? ed.schema.nodes.image!.create({ id: blockId, depth, alt: file.name.replace(/\.[^.]+$/, ""), caption: "" })
          : ed.schema.nodes.file!.create({ id: blockId, depth, name: file.name, size: file.size, mimeType: file.type || "application/octet-stream" });
        // Register the upload before the block exists so its sync op is held until the upload finishes.
        await enqueueUpload(accountKey, engine, { documentId, blockId, file, kind: isImage ? "image" : "file" });
        const index = ed.state.selection.$from.index(0);
        let at = 0;
        for (let i = 0; i <= Math.min(index, ed.state.doc.childCount - 1); i++) at += ed.state.doc.child(i).nodeSize;
        ed.view.dispatch(ed.state.tr.insert(at, node).scrollIntoView());
      }
      window.dispatchEvent(new CustomEvent("folevi:uploads-changed"));
    },
    [accountKey, engine, documentId],
  );

  useImperativeHandle(
    ref,
    () => ({
      flush: () => flushLocal(editorRef.current),
      applyFromEngine,
      editor: editorRef.current,
      focusBlock: (blockId: string) => {
        const ed = editorRef.current;
        if (!ed) return;
        ed.state.doc.forEach((n, offset) => {
          if (n.attrs.id === blockId) {
            ed.chain().focus().setTextSelection(offset + 1).scrollIntoView().run();
          }
        });
      },
    }),
    [flushLocal, applyFromEngine],
  );

  // Block drag & drop (the grip in EditorMenus runs the pointer drag; this applies the move).
  const onDropBlock = useCallback((fromIndex: number, toIndex: number, depth: number) => {
    const ed = editorRef.current;
    if (!ed) return null;
    const count = subtreeRange(ed.state, fromIndex).count;
    const moved = moveSubtreeTo(ed.state, fromIndex, toIndex, depth);
    if (!moved) return null;
    ed.view.dispatch(closeHistory(moved.tr).scrollIntoView());
    return { index: moved.index, count };
  }, []);

  return (
    <div className="relative" data-fb-root={documentId}>
      <EditorContent editor={editor} />
      {editor ? (
        <EditorMenus
          editor={editor}
          documentId={documentId}
          engine={engine}
          trigger={trigger}
          editable={editable}
          onInsertFiles={insertFiles}
          onDropBlock={onDropBlock}
          onCommentBlock={onCommentBlock}
        />
      ) : null}
    </div>
  );
});

function looksLikeMarkdown(text: string): boolean {
  return /^(#{1,6} |[-*+] |\d+[.)] |> |```|\[[ x]\] |\|.*\|)/m.test(text) || /\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/.test(text);
}
