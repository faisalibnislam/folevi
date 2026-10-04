"use client";

import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { LIMITS, ulid } from "@folevi/editor-schema";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex/api";
import type { SyncEngine } from "@/lib/sync/engine";
import { enqueueUpload } from "@/lib/sync/uploads";
import { decorationsKey, type DecorationInputs, type TriggerState } from "./plugins";
import { editorExtensions } from "./editorExtensions";
import { blocksToDoc, diffBlocks, docToBlocks } from "./convert";
import { clipboardBlocks, insertPastedBlocks, pasteIntoCode, prepareForPaste } from "./paste";
import { remoteTransaction } from "./remoteApply";
import { pasteAddress } from "./autolink";
import { EditorMenus } from "./EditorMenus";
import { insertBlockAfterCurrent, subtreeRange, moveSubtreeTo } from "./commands";
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
  /** ↑ on the first line: leave the body (to the title). Returns whether it did. */
  onExitTop?: () => boolean;
}

const FLUSH_DELAY = 250;

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { documentId, engine, accountKey, editable, decorations, onFocusBlock, onCommentBlock, onEditorReady, placeholder, onExitTop },
  ref,
) {
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onExitTopRef = useRef(onExitTop);
  onExitTopRef.current = onExitTop;
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
      const diff = diffBlocks(previous, next, editor.schema);
      // One save for the whole flush. Changes go first, in document order (parents before the blocks nested
      // under them), then deletes: a block moved out from under a deleted parent must move before the delete,
      // which takes the parent's subtree with it on the server.
      engine.batch(() => {
        for (const u of diff.upserts) {
          // A block that comes back after this device deleted it (undo) is restored, not re-created.
          if (engine.isBlockDeleted(documentId, u.block.id)) engine.restoreBlock(documentId, u.block.id);
          engine.upsertBlock(documentId, u.block, u.fields);
          if (u.fields.includes("position") && u.block.rank.length > LIMITS.maxRankLength / 2) rebalanceParents.current.add(u.block.parentId);
        }
        for (const d of diff.deletes) engine.deleteBlock(documentId, d);
      });
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
      handlePaste: (view, event, slice) => {
        prepareForPaste(view, slice);
        if (pasteIntoCode(view, event.clipboardData)) {
          event.preventDefault();
          return true;
        }
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length && editable) {
          event.preventDefault();
          void insertFiles(files);
          return true;
        }
        // A plain web address: a link (over the selected text, if any).
        if (pasteAddress(view, event.clipboardData)) {
          event.preventDefault();
          return true;
        }
        const blocks = clipboardBlocks(view, event.clipboardData);
        if (!blocks) return false;
        event.preventDefault();
        insertPastedBlocks(view, blocks);
        return true;
      },
      handleKeyDown: (view, event) => {
        if (event.key !== "ArrowUp" || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
        const { selection } = view.state;
        if (!selection.empty || selection.$from.index(0) !== 0 || !view.endOfTextblock("up")) return false;
        if (!onExitTopRef.current?.()) return false;
        event.preventDefault();
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !editable) return false;
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length) {
          // Text or a web page dragged in from another app: the same clean-up as pasting it.
          if (view.dragging) return false;
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!at) return false;
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
          const blocks = clipboardBlocks(view, event.dataTransfer);
          if (!blocks) return false;
          event.preventDefault();
          insertPastedBlocks(view, blocks);
          return true;
        }
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
    // Never while an input method is composing text (it would break the composition): apply when it ends.
    if (ed.view.composing) {
      ed.view.dom.addEventListener("compositionend", () => setTimeout(() => applyFromEngineRef.current(), 0), { once: true });
      return;
    }
    flushLocal(ed);
    const tr = remoteTransaction(ed.state, engine.documentBlocks(documentId));
    if (!tr) return;
    tr.setMeta("remote", true).setMeta("addToHistory", false);
    ed.view.dispatch(tr);
  }, [engine, documentId, flushLocal]);
  const applyFromEngineRef = useRef(applyFromEngine);
  applyFromEngineRef.current = applyFromEngine;

  // Engine events: attachment uploads finishing update the node attrs; a change the engine made to this
  // document (a conflict's resolution, a rejected edit, rows from the server) is shown.
  useEffect(() => {
    return engine.subscribe((e) => {
      if (e.type === "remote" && e.documentId === documentId) {
        applyFromEngineRef.current();
        return;
      }
      if (e.type === "upload-complete" && e.documentId === documentId) {
        const ed = editorRef.current;
        if (!ed) return;
        let target: number | null = null;
        ed.state.doc.forEach((n, offset) => {
          if (n.attrs.id === e.blockId) target = offset;
        });
        if (target === null) return;
        const node = ed.state.doc.nodeAt(target)!;
        ed.view.dispatch(
          ed.state.tr
            .setNodeMarkup(target, undefined, { ...node.attrs, fileId: e.fileId, uploadId: null })
            .setMeta("remote", true)
            .setMeta("addToHistory", false),
        );
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

  const insertFiles = useCallback(
    async (files: File[]) => {
      const ed = editorRef.current;
      if (!ed) return;
      // Files go in order after the caret's block (and anything nested under it); an empty line is replaced.
      const $from = ed.state.selection.$from;
      const startIndex = Math.min($from.index(0), ed.state.doc.childCount - 1);
      const startNode = ed.state.doc.child(startIndex);
      const depth = Number(startNode.attrs.depth ?? 0);
      let afterId = (startNode.attrs.id as string | null) ?? null;
      let replaceId = startNode.type.name === "paragraph" && startNode.content.size === 0 ? afterId : null;
      for (const file of files.slice(0, 10)) {
        const isImage = /^image\/(png|jpe?g|gif|webp)$/i.test(file.type);
        const blockId = ulid();
        const node = isImage
          ? ed.schema.nodes.image!.create({ id: blockId, depth, alt: file.name.replace(/\.[^.]+$/, ""), caption: "" })
          : ed.schema.nodes.file!.create({ id: blockId, depth, name: file.name, size: file.size, mimeType: file.type || "application/octet-stream" });
        // Register the upload before the block exists so its sync op is held until the upload finishes.
        await enqueueUpload(accountKey, engine, { documentId, blockId, file, kind: isImage ? "image" : "file" });
        if (ed.isDestroyed) return;
        const { state } = ed;
        let index = -1;
        state.doc.forEach((n, _o, i) => {
          if (index < 0 && afterId && n.attrs.id === afterId) index = i;
        });
        const tr = state.tr;
        let at: number;
        if (index >= 0 && replaceId === afterId) {
          at = 0;
          for (let i = 0; i < index; i++) at += state.doc.child(i).nodeSize;
          tr.replaceWith(at, at + state.doc.child(index).nodeSize, node);
        } else {
          at = index >= 0 ? subtreeRange(state, index).end : state.doc.content.size;
          tr.insert(at, node);
        }
        replaceId = null;
        afterId = blockId;
        tr.setSelection(NodeSelection.create(tr.doc, at));
        ed.view.dispatch(tr.scrollIntoView());
      }
      window.dispatchEvent(new CustomEvent("folevi:uploads-changed"));
    },
    [accountKey, engine, documentId],
  );

  // A finished "/Audio recording": stored on the device and uploaded like any attachment.
  const insertAudio = useCallback(
    async (file: File, duration: number) => {
      const ed = editorRef.current;
      if (!ed) return;
      const blockId = ulid();
      // Register the upload before the block exists so its sync op is held until the upload finishes.
      await enqueueUpload(accountKey, engine, { documentId, blockId, file, kind: "audio" });
      // Takes the place of the empty line the "/" was typed on.
      insertBlockAfterCurrent(ed, "audio", {
        id: blockId,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        duration: Math.round(duration * 10) / 10,
      });
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
            ed.chain()
              .focus()
              .setTextSelection(offset + 1)
              .scrollIntoView()
              .run();
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
          onInsertAudio={insertAudio}
          onDropBlock={onDropBlock}
          onCommentBlock={onCommentBlock}
        />
      ) : null}
    </div>
  );
});
