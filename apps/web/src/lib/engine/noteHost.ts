// The open note as the bridge sees it (docs/NATIVE_APP_PLAN.md sections 4.2, 4.3 and 8): DocumentView registers
// a handle while it shows a note in native chrome mode (lib/engine/editorCommands.ts builds it, inside the note
// page's own code chunk, so the editor never loads with the first screen), and the host sends it the editor
// commands of the keyboard toolbar, the bars and the menus. This module is light: it holds the handle only.
import type { EditorCommandName, EditorPanel, EditorStateEvent, EventMap, EventName } from "./protocol";

export interface NoteHandle {
  noteId: string;
  /** Runs an editor command (not note.prepare/show/close, which the host does); throws a BridgeError when it can't. */
  run(name: EditorCommandName, args: Record<string, unknown>): Promise<unknown> | unknown;
  state(): EditorStateEvent;
  panel(): EditorPanel | null;
}

type Emit = <N extends EventName>(name: N, data: EventMap[N]) => void;

let active: NoteHandle | null = null;
let emitter: Emit | null = null;
const ready = new Set<string>();
const listeners = new Set<() => void>();

/** Set by the bridge host while it's installed. */
export function setNoteEmitter(e: Emit | null): void {
  emitter = e;
}

/** The note page's way to send an event (a no-op without a native host). */
export function emitNoteEvent<N extends EventName>(name: N, data: EventMap[N]): void {
  emitter?.(name, data);
}

/** Whether a native host is listening (native chrome mode with the bridge installed). */
export function bridgeListening(): boolean {
  return emitter !== null;
}

export function activeNote(): NoteHandle | null {
  return active;
}

/** DocumentView: this note is on screen and takes editor commands; returns the function that lets go. */
export function registerNote(handle: NoteHandle): () => void {
  active = handle;
  for (const l of [...listeners]) l();
  return () => {
    if (active !== handle) return;
    active = null;
    ready.delete(handle.noteId);
    for (const l of [...listeners]) l();
  };
}

/** DocumentView: the note's first frame (title and first blocks) is drawn. Sent once per showing. */
export function markNoteReady(id: string, title: string): void {
  if (ready.has(id)) return;
  ready.add(id);
  emitNoteEvent("note.ready", { id, title });
  for (const l of [...listeners]) l();
}

export function isNoteReady(id: string): boolean {
  return ready.has(id);
}

/** Forget that a note was ready (it's about to be shown again from scratch). */
export function resetNoteReady(id: string): void {
  ready.delete(id);
}

/** Hears the handle being registered or let go, and notes becoming ready. */
export function onNoteHost(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

let focus = false;

/** Focus Mode (R8.9): the native app hides its bars around the note; the page closes its panel. */
export function focusMode(): boolean {
  return focus;
}

export function setFocusMode(on: boolean): void {
  if (focus === on) return;
  focus = on;
  for (const l of [...listeners]) l();
}

/** For tests. */
export function resetNoteHost(): void {
  focus = false;
  active = null;
  ready.clear();
  listeners.clear();
}
