"use client";
// The page's side of the native Mac app's capabilities (apps/mac, docs/MAC_WEBKIT_PLAN.md §10 WM5;
// lib/desktop/capabilities.ts): what the app asks of the page and what the page keeps it told.
// - File > Share and Print: the open note (its Markdown and, with an account, its link; its print layout, the PDF
//   export's clean page), and which note File > Share would send (setShareTarget).
// - The "New Folevi Note with Selection" service and Shortcuts' New Note: a note from text (its first line the title).
// - Shortcuts' Add a Task: a task in the Inbox.
// - Spotlight: every note of this place, archived ones too, with its whole text (locked and encrypted notes never):
//   a full look at the start, when "Show notes in Spotlight" changes and every few minutes, and the recent and
//   bookmarked notes as soon as they change. Only notes whose stamp differs from what Spotlight holds are sent.
// - Notes dragged out to Finder: each one's Markdown and attachments, made when it's dropped.
// Rendered by Shell next to DesktopBridge; nothing in the Electron app (it has none of these) or a browser.
import { useConvex, useMutation, useQuery, type ConvexReactClient } from "convex/react";
import type { WireScope } from "@folevi/editor-schema";
import { useEffect, useRef } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { useBackendMode } from "@/lib/mode";
import { APP_URL } from "@/lib/env";
import { asCapabilityCommand, macDesktop, noteFromText, setNoteFileSource, type DesktopSpotlightItem, type MacCapabilities, type MacCapabilityCommand } from "@/lib/desktop/capabilities";
import { desktopChanged } from "@/lib/engine/viewsSettings";
// Export (Markdown, PDF, zips) loads when a note is first shared, printed or dragged out.
const exporting = () => import("@/components/doc/export");
import { errorMessage, useToast } from "@/components/ui/Toast";

/** Changes settle this long before Spotlight hears of them. */
const SETTLE_MS = 1500;
const SPOTLIGHT_RECENT = 30;
const SPOTLIGHT_STARRED = 30;
/** Notes a list call hands over at a time, and a text call reads (convex/documents.ts SPOTLIGHT_TEXT_MAX). */
const SPOTLIGHT_PAGE = 100;
const SPOTLIGHT_BATCH = 50;
/** A full look this often (it catches notes moved, trashed or put in a renamed folder out of sight). */
const SPOTLIGHT_SWEEP_MS = 10 * 60_000;
/** A library bigger than this is indexed up to here, and nothing is taken out (the list wasn't whole). */
const SPOTLIGHT_MAX_NOTES = 50_000;

/** A note as the lists give it. */
type ListedNote = { id: string; title: string; excerpt?: string | null; updatedAt: number; starred?: boolean; homeFolder?: { name: string } | null; sealed?: unknown };
type SpotlightRow = { n: ListedNote; archived: boolean };

/** What a note's Spotlight entry is made from, besides its text (which only changes with updatedAt). */
const spotlightStamp = ({ n, archived }: SpotlightRow) => `${n.updatedAt}|${n.starred ? 1 : 0}|${archived ? 1 : 0}|${n.homeFolder?.name ?? ""}|${n.title}`;

/** Every note of the place, the archived ones after, or null when the list couldn't be read whole. */
async function everyNote(client: ConvexReactClient, scope: WireScope): Promise<SpotlightRow[] | null> {
  const out: SpotlightRow[] = [];
  for (const view of ["all", "archive"] as const) {
    let cursor: string | null = null;
    for (;;) {
      const page: { page: unknown[]; isDone: boolean; continueCursor: string } = await client.query(api.documents.list, { scope, view, paginationOpts: { numItems: SPOTLIGHT_PAGE, cursor } });
      for (const n of page.page as ListedNote[]) out.push({ n, archived: view === "archive" });
      if (out.length >= SPOTLIGHT_MAX_NOTES) return null;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
  }
  return out;
}

/**
 * Sends Spotlight the notes among `rows` whose stamp differs from what it holds, with their text, 50 at a time; with
 * `whole` (every note of the place), the notes it holds that aren't among them come out.
 */
async function feedSpotlight(client: ConvexReactClient, bridge: MacCapabilities, rows: SpotlightRow[], whole: boolean) {
  const state = await bridge.spotlightState?.();
  if (!state?.enabled) return;
  const latest = new Map<string, SpotlightRow>();
  for (const r of rows) if (!r.n.sealed) latest.set(r.n.id, r);
  const changed = [...latest.values()].filter((r) => state.known[r.n.id] !== spotlightStamp(r));
  // Notes with no text to give (locked, end-to-end encrypted, gone): never kept.
  const refused = new Set<string>();
  for (let i = 0; i < changed.length; i += SPOTLIGHT_BATCH) {
    const batch = changed.slice(i, i + SPOTLIGHT_BATCH);
    const texts = new Map((await client.query(api.documents.spotlightText, { ids: batch.map((r) => r.n.id) })).map((t) => [t.id, t.text]));
    const items: DesktopSpotlightItem[] = [];
    for (const r of batch) {
      const text = texts.get(r.n.id);
      if (text == null) refused.add(r.n.id);
      else items.push({ id: r.n.id, title: r.n.title || "Untitled", excerpt: (r.n.excerpt ?? "").slice(0, 300), text, location: r.n.homeFolder?.name || "Drafts", starred: r.n.starred === true, archived: r.archived, updatedAt: r.n.updatedAt, stamp: spotlightStamp(r) });
    }
    if (items.length) await bridge.indexSpotlight?.(items);
  }
  if (whole) await bridge.indexSpotlight?.([], [...latest.keys()].filter((id) => !refused.has(id)));
}

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

  // Spotlight: every note of this place. One look at a time, in turn: a full one at the start, when the settings
  // change and every few minutes; the recent and bookmarked notes as soon as they settle after a change.
  const feeds = Boolean(bridge.indexSpotlight && bridge.spotlightState);
  const recent = useQuery(api.documents.recentNotes, feeds ? { scope, limit: SPOTLIGHT_RECENT } : "skip");
  const starred = useQuery(api.documents.list, feeds ? { scope, view: "starred", paginationOpts: { numItems: SPOTLIGHT_STARRED, cursor: null } } : "skip");
  const spotlightTurn = useRef<Promise<void>>(Promise.resolve());
  const look = useRef<(rows: SpotlightRow[] | null) => void>(() => undefined);
  look.current = (rows) => {
    spotlightTurn.current = spotlightTurn.current
      .then(async () => {
        const all = rows ?? (await everyNote(client, scope));
        if (all) await feedSpotlight(client, bridge, all, rows === null);
      })
      .catch(() => undefined); // Offline, or Spotlight isn't there: the next look tries again.
  };
  useEffect(() => {
    if (!feeds) return;
    const first = setTimeout(() => look.current(null), SETTLE_MS);
    const sweep = setInterval(() => look.current(null), SPOTLIGHT_SWEEP_MS);
    const unsubscribe = desktopChanged.subscribe(() => look.current(null));
    return () => {
      clearTimeout(first);
      clearInterval(sweep);
      unsubscribe();
    };
  }, [feeds, scope]);
  useEffect(() => {
    if (!recent || !starred) return;
    const rows = [...(recent as ListedNote[]).map((n) => ({ n, archived: false })), ...(starred.page as ListedNote[]).map((n) => ({ n, archived: false }))];
    const timer = setTimeout(() => look.current(rows), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [recent, starred]);

  // Notes dragged out of the app: their Markdown and attachments, made when they're dropped.
  useEffect(() => {
    setNoteFileSource(async (id, folder) => {
      const held = engine?.documentBlocks(id) ?? [];
      const [doc, listed] = await Promise.all([client.query(api.documents.get, { documentId: id }), held.length ? null : client.query(api.blocks.list, { documentId: id })]);
      if (!doc) return null;
      return await (await exporting()).markdownWithFiles(client, doc.document.title, held.length ? held : (listed?.blocks ?? []), folder);
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
          return { ok: true, title: now.title || "Untitled", text: (await exporting()).markdownNow(now.title, now.engine?.documentBlocks(now.docId) ?? []), url: now.link };
        }
        case "print": {
          if (!now.docId) return { handled: false };
          await (await exporting()).exportPdf(now.client, now.title, now.engine?.documentBlocks(now.docId) ?? []);
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
