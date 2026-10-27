"use client";

import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import { NodeSelection, TextSelection, type EditorState, type Selection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { LIMITS, ulid, type WireBlock } from "@folevi/editor-schema";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex/api";
import type { SyncEngine } from "@/lib/sync/engine";
import { enqueueUpload } from "@/lib/sync/uploads";
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES } from "@folevi/editor-schema/fileBytes";
import { decorationsKey, type DecorationInputs, type TriggerState } from "./plugins";
import { editorExtensions } from "./editorExtensions";
import { blocksToDoc, docToBlocks, localChanges } from "./convert";
import { clipboardBlocks, insertPastedBlocks, pasteIntoCode, prepareForPaste } from "./paste";
import { readBlockClip } from "./blockClipboard";
import { usePastedFiles } from "./pastedFiles";
import { useClipboardImageFiles } from "./canvas/imageFiles";
import { remoteTransaction } from "./remoteApply";
import { PageLinkStatusWatcher } from "./PageLinkStatusWatcher";
import { pasteAddress } from "./autolink";
import { EditorMenus } from "./EditorMenus";
import { insertBlockAfterCurrent, subtreeRange, moveSubtreeTo } from "./commands";
import { applySideDrop } from "./columns/columnsCommands";
import type { SideDrop } from "./columns/columnsLayout";
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
  /** The editor's accessible name ("Document body"; a synced block's own editor says "Synced block"). */
  label?: string;
}

const FLUSH_DELAY = 250;
const FLUSH_MAX_WAIT = 1000;

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { documentId, engine, accountKey, editable, decorations, onFocusBlock, onCommentBlock, onEditorReady, placeholder, onExitTop, label },
  ref,
) {
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtySince = useRef(0);
  const onExitTopRef = useRef(onExitTop);
  onExitTopRef.current = onExitTop;
  const dirty = useRef(false);
  // The empty-line hint mentions ⌘J while the AI assistant is on (read by the placeholder at render time).
  const aiHint = useRef(false);
  aiHint.current = useAiEnabled() && editable;
  // Nothing is ever flushed until the editor shows the document's real content (prevents an empty,
  // not-yet-loaded editor from being mistaken for "the person deleted everything").
  const hydrated = useRef(false);
  // The blocks as the editor last showed them (after its own last save, or the last remote change it took in).
  // Local edits are what differs from these, never what differs from the engine: the engine may already hold a
  // remote change the editor hasn't shown yet (one waiting for an input method to finish composing), and
  // comparing with it would save the older text over it, or delete a block someone just added.
  const shown = useRef<Map<string, WireBlock>>(new Map());
  const showEngine = useCallback(() => {
    shown.current = new Map(engine.documentBlocks(documentId).map((b) => [b.id, b]));
    engine.markShown(documentId);
  }, [engine, documentId]);

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
      dirtySince.current = 0;
      if (!editor || !dirty.current || !hydrated.current) return;
      dirty.current = false;
      engine.setEditing(documentId, false);
      const { next, upserts, deletes } = localChanges(editor.state.doc, shown.current, editor.schema);
      // One save for the whole flush. Changes go first, in document order (parents before the blocks nested
      // under them), then deletes: a block moved out from under a deleted parent must move before the delete.
      // Each is based on the version the editor showed (older than the engine's when a remote change to it is
      // still waiting to be shown).
      engine.batch(() => {
        for (const u of upserts) {
          // A block that comes back after this device deleted it (undo) is restored, not re-created.
          if (engine.isBlockDeleted(documentId, u.block.id)) engine.restoreBlock(documentId, u.block.id);
          engine.upsertBlock(documentId, u.block, u.fields, engine.unshownRevision(u.block.id));
          if (u.fields.includes("position") && u.block.rank.length > LIMITS.maxRankLength / 2) rebalanceParents.current.add(u.block.parentId);
        }
        for (const d of deletes) engine.deleteBlock(documentId, d, engine.unshownRevision(d));
      });
      shown.current = new Map(next.map((b) => [b.id, b]));
    },
    [engine, documentId],
  );

  // What the editor opened with (the engine's blocks as they were then): from here on, what differs from it is
  // the person's own and is saved. Only ever a document from before any local change, never one with typing
  // in it, or that typing would count as already saved and be lost.
  const hydrate = useCallback(
    (doc: PMNode) => {
      shown.current = new Map(docToBlocks(doc, new Map(engine.documentBlocks(documentId).map((b) => [b.id, b]))).map((b) => [b.id, b]));
      engine.markShown(documentId);
      hydrated.current = true;
    },
    [engine, documentId],
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
        "aria-label": label ?? "Document body",
        spellcheck: "true",
      },
      handlePaste: (view, event, slice) => {
        prepareForPaste(view, slice);
        if (pasteIntoCode(view, event.clipboardData)) {
          event.preventDefault();
          return true;
        }
        // Blocks copied in a Folevi note (they may come with a picture of themselves for other apps).
        const clip = readBlockClip(event.clipboardData);
        if (clip) {
          event.preventDefault();
          if (editable) insertPastedBlocks(view, clip.blocks);
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
    onCreate: ({ editor: ed }) => {
      if (!hydrated.current) hydrate(ed.state.doc);
      // A note that starts with an image (or any media) opens with nothing selected: ProseMirror would
      // select that block, and its tools (alt text, size) would show before anyone touched it.
      const plain = unselectedMedia(ed.state);
      if (plain) ed.view.dispatch(ed.state.tr.setSelection(plain).setMeta("addToHistory", false));
    },
    onUpdate: ({ editor: ed, transaction }) => {
      // Only genuine local document changes count (setEditable and meta-only transactions emit updates too).
      // Someone who can only read may still open and close toggles: that's theirs alone, never saved.
      if (!transaction.docChanged || transaction.getMeta("remote") || !ed.isEditable) return;
      // Typed before the editor said it was ready (a new note's first line, typed right after the title's
      // Enter): it opened with the document as it was before this change, and this change is the person's.
      if (!hydrated.current) hydrate(transaction.before);
      dirty.current = true;
      engine.setEditing(documentId, true);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      // Steady typing keeps pushing the debounce back: still save at least once a second.
      if (!dirtySince.current) dirtySince.current = Date.now();
      const wait = Math.max(0, Math.min(FLUSH_DELAY, dirtySince.current + FLUSH_MAX_WAIT - Date.now()));
      flushTimer.current = setTimeout(() => flushLocal(editorRef.current), wait);
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

  // Images, files and recordings pasted from another note get their own file rows here (pastedFiles.ts).
  usePastedFiles(editor, documentId);
  // ⌘C on a flowchart block puts its picture on the clipboard with the images in its shapes.
  useClipboardImageFiles();

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
    const tr = remoteTransaction(ed.state, engine.documentBlocks(documentId), shown.current);
    if (tr) {
      // The note's content arriving (or changing elsewhere) never selects a media block by itself.
      if (!ed.view.hasFocus() && tr.selection instanceof NodeSelection && !(ed.state.selection instanceof NodeSelection)) {
        const plain = TextSelection.findFrom(tr.doc.resolve(0), 1, true);
        if (plain) tr.setSelection(plain);
      }
      ed.view.dispatch(tr.setMeta("remote", true).setMeta("addToHistory", false));
    }
    showEngine();
  }, [engine, documentId, flushLocal, showEngine]);
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
        // The file's id is the engine's as well: not an edit of the editor's own.
        const before = shown.current.get(e.blockId);
        if (before) shown.current.set(e.blockId, { ...before, props: { ...before.props, fileId: e.fileId } });
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
        // Over the limit the server would refuse it after the upload: said now, and no block is made for it.
        const max = isImage ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
        if (file.size > max) {
          const what = isImage ? "Images" : "Files";
          window.dispatchEvent(new CustomEvent("folevi:error", { detail: `“${file.name}” is too large. ${what} can be up to ${Math.round(max / 1024 / 1024)} MB.` }));
          continue;
        }
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
  const onDropBlock = useCallback((fromIndex: number, toIndex: number, depth: number, lastIndex = fromIndex, side?: SideDrop) => {
    const ed = editorRef.current;
    if (!ed) return null;
    // Beside another block, or in a row's gap: a new row of columns, or a new column.
    if (side) {
      const made = applySideDrop(ed.state, fromIndex, lastIndex, side);
      if (!made) return null;
      ed.view.dispatch(closeHistory(made.tr).scrollIntoView());
      return { index: made.index, count: made.count };
    }
    const count = lastIndex - fromIndex + subtreeRange(ed.state, lastIndex).count;
    const moved = moveSubtreeTo(ed.state, fromIndex, toIndex, depth, lastIndex);
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
      {editor ? <PageLinkStatusWatcher editor={editor} /> : null}
    </div>
  );
});

/** The selection a note opens with when ProseMirror's own would select a media block: the first place to type. */
function unselectedMedia(state: EditorState): Selection | null {
  if (!(state.selection instanceof NodeSelection)) return null;
  return TextSelection.findFrom(state.doc.resolve(0), 1, true);
}
