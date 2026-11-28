"use client";
// The Mac's menu bar note (lib/desktop/menuBarNote.ts), the page's side: the float page without its bar in the
// panel the menu bar icon and ⌥Space open.
// - MenuBarComposer: the empty page (`/float/new?panel=1&space=&folder=`), drawn as a new note is (paper, "Untitled",
//   "Start writing"). The first keystroke in the title, Return, or a click on the text makes a real note in Drafts, or
//   the folder picked (the same way the web's New note does: the engine, so offline, end-to-end encrypted spaces and
//   an "On this Mac" or iCloud library work as everywhere), then shows it in the editor with the caret where it was.
// - useMenuBarCommands: what the Mac app asks of the panel's page: the spaces and folders new notes can go to, and a
//   screenshot to put into the note (as a paste: the editor uploads it with the note).
import { useEffect, useRef, useState } from "react";
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, ulid } from "@folevi/editor-schema";
import { useConvex } from "convex/react";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { desktop } from "@/lib/desktop";
import { composerTarget, noteSpaces, pasteImage, scopeOfSpace } from "@/lib/desktop/menuBarNote";
import { sheetProps } from "@/lib/cover";

// The editor's code, fetched while the empty page waits, so the note opens at once on the first keystroke.
const preloadEditor = () => import("@/components/doc/DocumentView");

export function MenuBarComposer() {
  const { engine, workspaces } = useAppState();
  const { search, navigate } = useAppRouter();
  const [text, setText] = useState("");
  const made = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const { space, folderId } = composerTarget(search);
  const workspace = space === "personal" ? null : workspaces.find((w) => w.id === space);
  const where = space === "personal" ? "Personal" : (workspace?.name ?? "this workspace");
  const canEdit = space === "personal" || workspace?.canEdit !== false;
  const style = DEFAULT_DOCUMENT_STYLE;
  const sheet = sheetProps(style, DEFAULT_COVER);

  useEffect(() => {
    void preloadEditor();
    field.current?.focus();
  }, []);

  /** Makes the note (once) and shows it in the editor: its title from what was typed, the caret in the title, or
   *  in the text when the body was chosen. */
  const make = (title: string, into: "typed" | "body") => {
    if (made.current || !engine || !canEdit) return;
    made.current = true;
    const id = ulid();
    engine.createDocument({
      id,
      parentDocumentId: null,
      folderId,
      kind: "document",
      title: title.replace(/\s+/g, " ").slice(0, 500),
      icon: null,
      style: DEFAULT_DOCUMENT_STYLE,
      cover: DEFAULT_COVER,
      templateId: null,
      scope: scopeOfSpace(space),
    });
    navigate(`/float/${encodeURIComponent(id)}?panel=1&new=${into}`, { replace: true });
  };

  // The same page, paper and title as a new note (DocumentView: fb-page, fb-sheet, DocumentHeader), so the empty
  // page is a new note in every way but one: it isn't made until something is written.
  return (
    <div
      className="fb-page relative h-full overflow-y-auto rounded-panel px-3 pb-28 pt-8 shadow-[var(--glass-edge),var(--glass-shadow)] sm:px-8"
      data-font={style.font}
      data-width={style.width}
      style={{ background: "var(--color-surface-sunken)" }}
    >
      <article className="fb-sheet ui-sheet relative mx-auto" data-background={style.background} {...sheet} data-separator={style.separator} style={{ ...sheet.style, maxWidth: "calc(var(--editor-width) + 8rem)" }}>
        <div className="h-10" aria-hidden />
        <div className="px-5 sm:px-16">
          <textarea
            ref={field}
            value={text}
            rows={1}
            placeholder="Untitled"
            aria-label={`Title of a new note in ${where}`}
            title={canEdit ? `New notes go to ${folderId ? "the folder chosen above" : `${where}’s Drafts`}` : `You can't add notes in ${where}`}
            disabled={!canEdit || !engine}
            onChange={(e) => {
              const value = e.target.value.replace(/\s*\n\s*/g, " ");
              setText(value);
              if (value.trim()) make(value, "typed");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                make(text, "body");
              }
            }}
            className="mt-4 block w-full resize-none overflow-hidden bg-transparent text-[40px] font-semibold leading-[1.12] tracking-[-0.012em] text-heading outline-none [font-family:var(--note-serif,var(--font-serif))] [font-size-adjust:ex-height_0.45] placeholder:text-[color-mix(in_oklab,var(--color-ink-faint)_70%,transparent)]"
          />
        </div>
        <div className="px-5 sm:px-16">
          {/* The empty note's first line, as the editor shows it; a click starts the note there. */}
          <div className="fb-editor" onClick={() => make(text, "body")}>
            <p className="is-empty cursor-text" data-placeholder="Start writing, or type / for blocks" />
          </div>
        </div>
      </article>
    </div>
  );
}

/** The Mac app's commands to the panel's page, answered with commandDone. */
export function useMenuBarCommands(enabled: boolean) {
  const client = useConvex();
  const { workspaces } = useAppState();
  const { navigate } = useAppRouter();
  const latest = useRef({ client, workspaces, navigate });
  latest.current = { client, workspaces, navigate };
  useEffect(() => {
    const bridge = desktop() as (ReturnType<typeof desktop> & { commandDone?: (id: string, value: Record<string, unknown>) => void }) | null;
    if (!enabled || !bridge?.onCommand || !bridge.commandDone) return;
    return bridge.onCommand((raw) => {
      const c = raw as { type?: unknown; id?: unknown; data?: unknown; mime?: unknown; name?: unknown; path?: unknown };
      // New, a destination picked, another note: the panel moves its page (the main window's DesktopBridge, which
      // does this there, isn't on this page). Only to the panel's own pages.
      if (c.type === "navigate" && typeof c.path === "string" && /^\/float\/[^/?#]+\?panel=1/.test(c.path)) {
        latest.current.navigate(c.path, { replace: true });
        return;
      }
      if (typeof c.id !== "string") return;
      const id = c.id;
      if (c.type === "menu-note-destinations") {
        void noteSpaces(latest.current.client as never, latest.current.workspaces).then(
          (spaces) => bridge.commandDone!(id, { ok: true, spaces }),
          (e) => bridge.commandDone!(id, { ok: false, message: e instanceof Error ? e.message : String(e) }),
        );
      } else if (c.type === "menu-note-image") {
        if (typeof c.data !== "string" || typeof c.mime !== "string" || !/^image\//.test(c.mime)) return bridge.commandDone!(id, { ok: false, message: "That isn't an image." });
        const ok = pasteImage(document, c.data, c.mime, typeof c.name === "string" && c.name ? c.name : "Screenshot.png");
        bridge.commandDone!(id, ok ? { ok: true } : { ok: false, message: "Write a word first, then add the screenshot." });
      }
    });
  }, [enabled]);
}
