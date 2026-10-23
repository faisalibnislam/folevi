// The native Mac app's capabilities on window.foleviDesktop (apps/mac Bridge/capabilities.js and
// DesktopRouter+Capabilities.swift, docs/MAC_WEBKIT_PLAN.md §10 WM5): recording a call natively, notes dragged out
// as Markdown files, Share, Print, Spotlight, the clipboard for Folevi's own menus, Quick Look, and the commands the
// app sends for File > Share and Print, the "New Folevi Note with Selection" service and Shortcuts. Every member
// is optional: a browser has none of them.
import { desktop, type DesktopBridge } from "@/lib/desktop";

/** The native Mac app's call recorder (lib/callCapture.ts): this Mac's sound and the microphone, mixed there. */
export interface NativeCallRecorder {
  /** Starts recording; rejects with { code: "permission" | "microphone" | "busy" | "failed", message }. */
  start(): Promise<true>;
  pause(): void;
  resume(): void;
  /** Stops; the recording (audio/mp4) and its length, or null when there's none. */
  stop(): Promise<{ blob: Blob; seconds: number } | null>;
  /** Stops and throws the recording away. */
  cancel(): void;
  onLevel(listener: (level: number) => void): () => void;
  /** The recording ended on its own (sharing stopped, the microphone went away). */
  onEnded(listener: (reason: string) => void): () => void;
}

/** A note's file for a drag out of the app: its Markdown and its attachments (paths relative to the note's folder). */
export interface DraggedNoteFile {
  text: string;
  files?: { path: string; bytes: Uint8Array }[];
}

/** Spotlight's entry for a note. */
export interface DesktopSpotlightItem {
  id: string;
  title: string;
  excerpt: string;
  location: string;
  starred: boolean;
  /** Milliseconds since 1970. */
  updatedAt: number;
}

export interface MacCapabilities {
  /** Records a call natively (WebKit's getDisplayMedia has no system sound). */
  recordCall?: NativeCallRecorder;
  /**
   * A drag of notes is starting (from its dragstart): dropped outside Folevi, each becomes a Markdown file, with
   * `fileOf` asked for its contents then (`folder` is the folder beside it its attachments go in).
   */
  dragNotes?(notes: { id: string; title: string }[], fileOf: (id: string, folder: string) => Promise<DraggedNoteFile | null>): void;
  /** The page as it is, in the print panel. */
  print?(): void;
  /** The Share picker for a link, text, or a note's Markdown sent as a file named `fileName`; true once shared. */
  share?(item: { title?: string; text?: string; url?: string; fileName?: string; rect?: { x: number; y: number; width: number; height: number }; x?: number; y?: number }): Promise<boolean>;
  /** What File > Share sends from this window now: the open note, or null. */
  setShareTarget?(target: { title: string; url?: string } | null): void;
  /** Spotlight holds exactly these notes of this place afterwards. */
  indexSpotlight?(items: DesktopSpotlightItem[]): Promise<void>;
  /** The clipboard for Folevi's own menus (no "Paste" bubble). */
  clipboard?: {
    read(): Promise<{ text?: string; html?: string; image?: Uint8Array } | null>;
    write(data: { text?: string; html?: string; image?: Uint8Array }): Promise<boolean>;
  };
  /** Quick Look on files. */
  quickLook?(files: { name: string; bytes: Uint8Array }[]): Promise<boolean>;
  /** Answers a command that carried an id. */
  commandDone?(id: string, value: Record<string, unknown>): void;
}

export type MacDesktop = DesktopBridge & MacCapabilities;

/** The Mac app's bridge with its capabilities typed, or null in a browser. */
export function macDesktop(): MacDesktop | null {
  return desktop() as MacDesktop | null;
}

/** What the native Mac app asks of the page; each carries an id answered with commandDone(id, value). */
export type MacCapabilityCommand =
  | { type: "share"; id: string }
  | { type: "print"; id: string }
  | { type: "new-note-with-text"; id: string; text: string }
  | { type: "add-task"; id: string; text: string; dueDate?: string };

const COMMANDS = new Set(["share", "print", "new-note-with-text", "add-task"]);

/** The capability commands among the app's commands (the menus' and links' go to DesktopBridge). */
export function asCapabilityCommand(command: unknown): MacCapabilityCommand | null {
  if (!command || typeof command !== "object") return null;
  const c = command as { type?: unknown; id?: unknown; text?: unknown; dueDate?: unknown };
  if (typeof c.type !== "string" || !COMMANDS.has(c.type) || typeof c.id !== "string" || !c.id) return null;
  if ((c.type === "new-note-with-text" || c.type === "add-task") && typeof c.text !== "string") return null;
  if (c.dueDate !== undefined && (typeof c.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(c.dueDate))) return null;
  return command as MacCapabilityCommand;
}

/** A new note's title and body from text (the service's selection, Shortcuts' text): its first line is the title. */
export function noteFromText(text: string): { title: string; body: string } {
  const trimmed = text.replace(/\r\n?/g, "\n").trim();
  const nl = trimmed.indexOf("\n");
  const first = (nl < 0 ? trimmed : trimmed.slice(0, nl)).trim();
  // A long first line is a paragraph, not a title: the note starts with it all.
  if (!first || first.length > 120) return { title: first.slice(0, 80).trim() || "Untitled", body: trimmed };
  return { title: first.replace(/^#+\s*/, ""), body: nl < 0 ? "" : trimmed.slice(nl + 1).trim() };
}

type NoteFileSource = (id: string, folder: string) => Promise<DraggedNoteFile | null>;
let noteFileSource: NoteFileSource | null = null;

/** Where a dragged-out note's Markdown comes from (DesktopCapabilities sets it while the app is up). */
export function setNoteFileSource(source: NoteFileSource | null) {
  noteFileSource = source;
}

/** A dragged-out note's file, asked for when it's dropped outside Folevi. */
export function noteFileOf(id: string, folder: string): Promise<DraggedNoteFile | null> {
  return noteFileSource ? noteFileSource(id, folder) : Promise.resolve(null);
}

/** Tells the native Mac app a drag of these notes is starting (so a drop in Finder makes their files). */
export function dragNotesOut(ids: readonly string[], titleOf?: (id: string) => string | null | undefined) {
  const bridge = macDesktop();
  if (!bridge?.dragNotes || !ids.length) return;
  bridge.dragNotes(
    ids.map((id) => ({ id, title: titleOf?.(id) || "" })),
    noteFileOf,
  );
}
