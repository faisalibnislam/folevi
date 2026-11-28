"use client";
// The Mac's menu bar note (lib/desktop/menuBarNote.ts), the page's side. The panel is Home's quick note drawn natively
// (apps/native-kit FoleviMenuBarNote); it keeps a quiet page of the place, `/float/menu?panel=1`, which shows nothing
// and answers its commands with commandDone:
// - menu-note-destinations: Personal and the workspaces, with their marks and folders;
// - menu-note-save: a note of the text (its first line the title) in Drafts or the folder picked, with the
//   screenshots uploaded into it, as Home's Save does (imports.importText);
// - menu-note-task: the text's first line as a task, as Home's Add as a task does;
// - menu-note-unsave: Undo of a save (the note to the Trash).
import { useEffect, useRef } from "react";
import { useConvex, useMutation } from "convex/react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { desktop } from "@/lib/desktop";
import { noteFromText } from "@/lib/desktop/capabilities";
import { menuNoteContent, noteSpaces, scopeOfSpace, validateMenuNote } from "@/lib/desktop/menuBarNote";
import { uploadFileNow } from "@/lib/sync/uploads";
import { errorMessage } from "@/components/ui/Toast";

function base64Blob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** The Mac app's commands to the panel's page, answered with commandDone. */
export function useMenuBarCommands(enabled: boolean) {
  const client = useConvex();
  const { workspaces, profile, today, deviceId } = useAppState();
  const importText = useMutation(api.imports.importText);
  const quickAdd = useMutation(api.tasks.quickAdd);
  const personal = { displayName: profile.displayName, avatarUrl: profile.avatarUrl ?? null };
  const latest = useRef({ client, workspaces, personal, today, deviceId, importText, quickAdd });
  latest.current = { client, workspaces, personal, today, deviceId, importText, quickAdd };
  useEffect(() => {
    const bridge = desktop() as (ReturnType<typeof desktop> & { commandDone?: (id: string, value: Record<string, unknown>) => void }) | null;
    if (!enabled || !bridge?.onCommand || !bridge.commandDone) return;
    const done = bridge.commandDone;
    return bridge.onCommand((raw) => {
      const c = raw as { type?: unknown; id?: unknown; note?: unknown; text?: unknown; space?: unknown; noteId?: unknown };
      if (typeof c.id !== "string" || typeof c.type !== "string" || !c.type.startsWith("menu-note-")) return;
      const id = c.id;
      const now = latest.current;
      const answer = (run: () => Promise<Record<string, unknown>>) =>
        void run().then(
          (value) => done(id, value),
          (e) => done(id, { ok: false, message: errorMessage(e) }),
        );
      switch (c.type) {
        case "menu-note-destinations":
          return answer(async () => ({ ok: true, spaces: await noteSpaces(now.client as never, now.workspaces, now.personal) }));
        case "menu-note-save":
          return answer(async () => {
            const note = validateMenuNote(c.note);
            if (!note) return { ok: false, message: "Write something first." };
            const scope = scopeOfSpace(note.space);
            const imageMap: Record<string, string> = {};
            for (const [i, img] of note.images.entries()) {
              imageMap[`menu-note-image-${i + 1}`] = await uploadFileNow(now.client as never, { scope, blob: base64Blob(img.data, img.mime), filename: img.name, mimeType: img.mime, kind: "image" });
            }
            const { title, content, format } = menuNoteContent(note.text, note.images.length, noteFromText);
            const made = (await now.importText({ scope, filename: title, content, format, ...(note.folderId ? { folderId: note.folderId } : {}), ...(note.images.length ? { imageMap } : {}) })) as { document: { id: string } };
            return { ok: true, noteId: made.document.id };
          });
        case "menu-note-task":
          return answer(async () => {
            const text = typeof c.text === "string" ? c.text.trim() : "";
            if (!text || typeof c.space !== "string") return { ok: false, message: "Write the task first." };
            await now.quickAdd({ scope: scopeOfSpace(c.space), title: text.split("\n")[0]!.slice(0, 500), today: now.today, deviceId: now.deviceId ?? undefined });
            return { ok: true };
          });
        case "menu-note-unsave":
          return answer(async () => {
            if (typeof c.noteId !== "string") return { ok: false };
            await now.client.mutation(api.documents.bulkUpdate, { documentIds: [c.noteId], action: { kind: "trash" } });
            return { ok: true };
          });
      }
    });
  }, [enabled]);
}
