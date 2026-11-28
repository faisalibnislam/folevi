"use client";
// The Mac's menu bar note (lib/desktop/menuBarNote.ts), the page's side: the float page without its bar in the
// panel the menu bar icon and ⌥Space open.
// - MenuBarComposer (`/float/new?panel=1&space=&folder=`): makes a new note in Drafts, or the folder picked, the way
//   the web's New note does, and shows it. A note the panel made and left empty is taken away when it moves on.
// - useMenuBarCommands: what the Mac app asks of the panel's page: the spaces and folders new notes can go to, and a
//   screenshot to put into the note (as a paste: the editor uploads it with the note), whether the note is empty, and
//   moving the page (New, a destination picked).
import { useEffect, useRef } from "react";
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, ulid } from "@folevi/editor-schema";
import { useConvex } from "convex/react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { desktop } from "@/lib/desktop";
import { composerTarget, noteSpaces, pasteImage, scopeOfSpace } from "@/lib/desktop/menuBarNote";

export function MenuBarComposer() {
  const { engine, workspaces } = useAppState();
  const { search, navigate } = useAppRouter();
  const made = useRef(false);
  const { space, folderId } = composerTarget(search);
  const workspace = space === "personal" ? null : workspaces.find((w) => w.id === space);
  const where = space === "personal" ? "Personal" : (workspace?.name ?? "this workspace");
  const canEdit = space === "personal" || workspace?.canEdit !== false;

  // A new note at once, as the web's New note makes it (the engine: offline, end-to-end encrypted spaces and an "On
  // this Mac" or iCloud library work as everywhere), shown in the editor with its title focused. Nothing stands in
  // for it, so nothing moves when typing starts. One left empty is taken away when the panel moves on (below).
  useEffect(() => {
    if (made.current || !engine || !canEdit) return;
    made.current = true;
    const id = ulid();
    engine.createDocument({
      id,
      parentDocumentId: null,
      folderId,
      kind: "document",
      title: "",
      icon: null,
      style: DEFAULT_DOCUMENT_STYLE,
      cover: DEFAULT_COVER,
      templateId: null,
      scope: scopeOfSpace(space),
    });
    navigate(`/float/${encodeURIComponent(id)}?panel=1&new=1`, { replace: true });
  }, [engine, canEdit, folderId, space, navigate]);

  if (canEdit) return null;
  return <p className="px-10 pt-20 text-subheadline text-muted">You can’t add notes in {where}. Choose another place above.</p>;
}

/** Whether the note on this page has nothing in it: no title, no text, no picture or file. */
export function noteLooksEmpty(doc: Document, id: string): boolean {
  const title = doc.getElementById(`title-${id}`) as HTMLTextAreaElement | null;
  if (title?.value.trim()) return false;
  const body = doc.querySelector(".fb-editor");
  if (!body) return !title;
  return !body.textContent?.trim() && !body.querySelector("img, video, iframe, [data-file], .fb-file, .fb-embed");
}

/** Takes away a note the panel made and left empty (to the Trash, then for good), retried while it reaches the server. */
async function discardEmpty(client: ReturnType<typeof useConvex>, id: string) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = (await client.mutation(api.documents.bulkUpdate, { documentIds: [id], action: { kind: "trash" } })) as { done: string[] };
      if (r.done.includes(id)) {
        await client.mutation(api.documents.bulkUpdate, { documentIds: [id], action: { kind: "delete" } });
        return;
      }
    } catch {
      /* offline or not there yet: tried again */
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
}

/** The Mac app's commands to the panel's page, answered with commandDone. */
export function useMenuBarCommands(enabled: boolean) {
  const client = useConvex();
  const { workspaces, profile } = useAppState();
  const { navigate, route } = useAppRouter();
  const current = route.name === "float" && route.id !== "new" ? route.id : null;
  const personal = { displayName: profile.displayName, avatarUrl: profile.avatarUrl ?? null };
  const latest = useRef({ client, workspaces, navigate, current, personal });
  latest.current = { client, workspaces, navigate, current, personal };
  useEffect(() => {
    const bridge = desktop() as (ReturnType<typeof desktop> & { commandDone?: (id: string, value: Record<string, unknown>) => void }) | null;
    if (!enabled || !bridge?.onCommand || !bridge.commandDone) return;
    return bridge.onCommand((raw) => {
      const c = raw as { type?: unknown; id?: unknown; data?: unknown; mime?: unknown; name?: unknown; path?: unknown };
      // New, a destination picked, another note: the panel moves its page (the main window's DesktopBridge, which
      // does this there, isn't on this page). Only to the panel's own pages.
      if (c.type === "navigate" && typeof c.path === "string" && /^\/float\/[^/?#]+\?panel=1/.test(c.path)) {
        // Moving on from a note left empty: it goes, so no empty "Untitled" stays in Drafts.
        const leaving = latest.current.current;
        if (leaving && !c.path.startsWith(`/float/${leaving}?`) && noteLooksEmpty(document, leaving)) void discardEmpty(latest.current.client, leaving);
        latest.current.navigate(c.path, { replace: true });
        return;
      }
      if (typeof c.id !== "string") return;
      const id = c.id;
      if (c.type === "menu-note-destinations") {
        void noteSpaces(latest.current.client as never, latest.current.workspaces, latest.current.personal).then(
          (spaces) => bridge.commandDone!(id, { ok: true, spaces }),
          (e) => bridge.commandDone!(id, { ok: false, message: e instanceof Error ? e.message : String(e) }),
        );
      } else if (c.type === "menu-note-state") {
        const shown = latest.current.current;
        bridge.commandDone!(id, { ok: true, empty: !shown || noteLooksEmpty(document, shown) });
      } else if (c.type === "menu-note-image") {
        if (typeof c.data !== "string" || typeof c.mime !== "string" || !/^image\//.test(c.mime)) return bridge.commandDone!(id, { ok: false, message: "That isn't an image." });
        const ok = pasteImage(document, c.data, c.mime, typeof c.name === "string" && c.name ? c.name : "Screenshot.png");
        bridge.commandDone!(id, ok ? { ok: true } : { ok: false, message: "Write a word first, then add the screenshot." });
      }
    });
  }, [enabled]);
}
