"use client";
// The page's side of the native Mac app's capabilities (apps/mac, docs/MAC_WEBKIT_PLAN.md §10 WM5;
// lib/desktop/capabilities.ts): what the app asks of the page and what the page keeps it told.
// - File > Share and Print: the open note (its Markdown and, with an account, its link; its print layout, the PDF
//   export's clean page), and which note File > Share would send (setShareTarget).
// - The "New Folevi Note with Selection" service and Shortcuts' New Note: a note from text (its first line the title).
// - Shortcuts' Add a Task: a task in the Inbox.
// - Spotlight: the recent and starred notes of this place, whenever they change.
// - Notes dragged out to Finder: each one's Markdown and attachments, made when it's dropped.
// Rendered by Shell next to DesktopBridge; nothing in the Electron app (it has none of these) or a browser.
import { useConvex, useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { useBackendMode } from "@/lib/mode";
import { APP_URL } from "@/lib/env";
import { asCapabilityCommand, macDesktop, noteFromText, setNoteFileSource, type MacCapabilityCommand } from "@/lib/desktop/capabilities";
import { exportPdf, markdownNow, markdownWithFiles } from "@/components/doc/export";
import { spotlightItems } from "@/components/app/LocalExtensions";
import { errorMessage, useToast } from "@/components/ui/Toast";

/** Changes settle this long before Spotlight hears of them. */
const SETTLE_MS = 1500;
const SPOTLIGHT_RECENT = 30;
const SPOTLIGHT_STARRED = 30;

type ListedNote = Parameters<typeof spotlightItems>[0][number];

export function DesktopCapabilities() {
  return macDesktop()?.commandDone ? <Capabilities /> : null;
}

function Capabilities() {
  const bridge = macDesktop()!;
  const client = useConvex();
  const { scope, engine, today, deviceId } = useAppState();
  const { route, navigate } = useAppRouter();
  const local = useBackendMode() === "local";
  const toast = useToast();
  const quickAdd = useMutation(api.tasks.quickAdd);
  const importText = useMutation(api.imports.importText);

  const docId = route.name === "doc" ? route.id : null;
  const meta = useQuery(api.documents.get, docId ? { documentId: docId } : "skip");
  const title = meta?.document.title ?? "";
  const link = docId && !local ? `${APP_URL.replace(/\/$/, "")}/d/${docId}` : undefined;

  // File > Share's services are for the note in front.
  useEffect(() => {
    bridge.setShareTarget?.(docId && meta ? { title: title || "Untitled", url: link } : null);
  }, [bridge, docId, meta, title, link]);
  useEffect(() => () => bridge.setShareTarget?.(null), [bridge]);

  // Spotlight: this place's recent and starred notes, once their changes settle.
  const feeds = Boolean(bridge.indexSpotlight);
  const recent = useQuery(api.documents.recentNotes, feeds ? { scope, limit: SPOTLIGHT_RECENT } : "skip");
  const starred = useQuery(api.documents.list, feeds ? { scope, view: "starred", paginationOpts: { numItems: SPOTLIGHT_STARRED, cursor: null } } : "skip");
  useEffect(() => {
    if (!recent || !starred) return;
    const timer = setTimeout(() => void bridge.indexSpotlight?.(spotlightItems(recent as ListedNote[], starred.page as ListedNote[])), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [bridge, recent, starred]);

  // Notes dragged out of the app: their Markdown and attachments, made when they're dropped.
  useEffect(() => {
    setNoteFileSource(async (id, folder) => {
      const held = engine?.documentBlocks(id) ?? [];
      const [doc, listed] = await Promise.all([client.query(api.documents.get, { documentId: id }), held.length ? null : client.query(api.blocks.list, { documentId: id })]);
      if (!doc) return null;
      return await markdownWithFiles(client, doc.document.title, held.length ? held : (listed?.blocks ?? []), folder);
    });
    return () => setNoteFileSource(null);
  }, [client, engine]);

  // The app's commands, answered with commandDone.
  const latest = useRef({ docId, title, link, scope, today, deviceId, engine, client, quickAdd, importText, navigate, toast });
  latest.current = { docId, title, link, scope, today, deviceId, engine, client, quickAdd, importText, navigate, toast };
  useEffect(() => {
    const answer = async (c: MacCapabilityCommand): Promise<Record<string, unknown>> => {
      const now = latest.current;
      switch (c.type) {
        case "share": {
          if (!now.docId) return { ok: false };
          return { ok: true, title: now.title || "Untitled", text: markdownNow(now.title, now.engine?.documentBlocks(now.docId) ?? []), url: now.link };
        }
        case "print": {
          if (!now.docId) return { handled: false };
          await exportPdf(now.client, now.title, now.engine?.documentBlocks(now.docId) ?? []);
          return { handled: true };
        }
        case "new-note-with-text": {
          const { title, body } = noteFromText(c.text);
          try {
            // Plain text from another app: each line its own paragraph (a single newline would join them).
            const made = await now.importText({ scope: now.scope, filename: title, content: body.split(/\n+/).join("\n\n"), format: "text" });
            now.navigate(`/d/${made.document.id}`);
            return { ok: true };
          } catch (e) {
            now.toast.show(errorMessage(e), { tone: "error" });
            return { ok: false, message: errorMessage(e) };
          }
        }
        case "add-task": {
          try {
            await now.quickAdd({ scope: now.scope, title: c.text, today: now.today, ...(c.dueDate ? { dueDate: c.dueDate } : {}), deviceId: now.deviceId ?? undefined });
            now.toast.show("Added the task from Shortcuts");
            return { ok: true, message: "Added to your Inbox." };
          } catch (e) {
            return { ok: false, message: errorMessage(e) };
          }
        }
      }
    };
    return bridge.onCommand((raw) => {
      const c = asCapabilityCommand(raw);
      if (!c) return;
      void answer(c).then(
        (value) => bridge.commandDone?.(c.id, value),
        (e) => bridge.commandDone?.(c.id, { ok: false, handled: false, message: errorMessage(e) }),
      );
    });
  }, [bridge]);
  return null;
}
