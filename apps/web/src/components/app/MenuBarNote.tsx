"use client";
// The Mac's menu bar note (lib/desktop/menuBarNote.ts), the page's side: the float page without its bar in the
// panel the menu bar icon and ⌥Space open.
// - MenuBarComposer: the empty page (`/float/new?panel=1&space=&folder=`). The first keystroke makes a real note in
//   Drafts, or the folder picked (the same way the web's New note does: the engine, so offline, end-to-end encrypted
//   spaces and an "On this Mac" or iCloud library work as everywhere), with what was typed as its title, then shows
//   that note in the editor with the caret after it.
// - useMenuBarCommands: what the Mac app asks of the panel's page: the spaces and folders new notes can go to, and a
//   screenshot to put into the note (as a paste: the editor uploads it with the note).
import { useEffect, useRef, useState } from "react";
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, ulid } from "@folevi/editor-schema";
import { useConvex } from "convex/react";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { desktop } from "@/lib/desktop";
import { composerTarget, noteSpaces, pasteImage, scopeOfSpace } from "@/lib/desktop/menuBarNote";

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

  useEffect(() => {
    void preloadEditor();
    field.current?.focus();
  }, []);

  const start = (value: string) => {
    setText(value);
    if (made.current || !engine || !value.trim() || !canEdit) return;
    made.current = true;
    const id = ulid();
    engine.createDocument({
      id,
      parentDocumentId: null,
      folderId,
      kind: "document",
      title: value.replace(/\s+/g, " ").slice(0, 500),
      icon: null,
      style: DEFAULT_DOCUMENT_STYLE,
      cover: DEFAULT_COVER,
      templateId: null,
      scope: scopeOfSpace(space),
    });
    navigate(`/float/${encodeURIComponent(id)}?panel=1&new=typed`, { replace: true });
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-7 pt-6">
      <textarea
        ref={field}
        value={text}
        onChange={(e) => start(e.target.value)}
        rows={1}
        aria-label={`New note in ${where}`}
        placeholder={canEdit ? "Start typing" : `You can't add notes in ${where}`}
        disabled={!canEdit || !engine}
        className="mt-4 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[40px] font-semibold leading-[1.12] tracking-[-0.012em] text-heading outline-none [font-family:var(--note-serif,var(--font-serif))] [font-size-adjust:ex-height_0.45] placeholder:text-[color-mix(in_oklab,var(--color-ink-faint)_70%,transparent)] disabled:opacity-60"
      />
      <p className="mt-2 text-footnote text-muted">{folderId ? "Saved as a note in the folder above." : `Saved as a note in ${where}’s Drafts.`}</p>
    </div>
  );
}

/** The Mac app's commands to the panel's page, answered with commandDone. */
export function useMenuBarCommands(enabled: boolean) {
  const client = useConvex();
  const { workspaces } = useAppState();
  const latest = useRef({ client, workspaces });
  latest.current = { client, workspaces };
  useEffect(() => {
    const bridge = desktop() as (ReturnType<typeof desktop> & { commandDone?: (id: string, value: Record<string, unknown>) => void }) | null;
    if (!enabled || !bridge?.onCommand || !bridge.commandDone) return;
    return bridge.onCommand((raw) => {
      const c = raw as { type?: unknown; id?: unknown; data?: unknown; mime?: unknown; name?: unknown };
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
