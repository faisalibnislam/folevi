"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppState } from "@/lib/app/state";
import { useEngineSelector } from "@/lib/hooks/useEngine";
import { localDb } from "@/lib/sync/db";
import { localNotes, overlayNotes, sameLocalNotes, searchLocalNotes, type LocalNote, type NoteRow, type OverlayOptions } from "@/lib/sync/localNotes";

/** This device's notes with changes still waiting (re-renders only when what lists show of them changes). */
export function useLocalNotes(): Map<string, LocalNote> {
  const { engine } = useAppState();
  return useEngineSelector(engine, localNotes, sameLocalNotes);
}

/**
 * A list of notes from the server (or the copy kept on this device) with this device's own notes laid over
 * it (lib/sync/localNotes.ts): a note made offline shows at once, marked as waiting. Undefined while there's
 * no list yet (offline with notes made here: those alone).
 */
export function useNotesWithLocal<T extends NoteRow>(list: readonly T[] | undefined, opts: Omit<OverlayOptions, "scope">): T[] | undefined {
  const { scope, online } = useAppState();
  const locals = useLocalNotes();
  const { include, folderId, byUpdated, limit } = opts;
  return useMemo(() => {
    const hasNew = include !== "none" && [...locals.values()].some((n) => n.isNew);
    // Online, the server's list is on its way: nothing shows alone ahead of it.
    if (list === undefined && (online || !hasNew)) return undefined;
    return overlayNotes(list ?? [], locals, { scope, include, folderId, byUpdated, limit });
  }, [list, locals, scope, online, include, folderId, byUpdated, limit]);
}

export interface LocalSearchHit {
  id: string;
  title: string;
  icon: string | null;
  updatedAt: number;
  snippet?: string;
  waiting?: "queued" | "failed";
}

/**
 * Search with what's on this device: notes made or renamed here (always, so a note written offline is found
 * at once) and, while offline, the notes kept from the last lists seen (titles and first words). The server's
 * search covers the rest when there's a connection.
 */
export function useLocalSearch(query: string): LocalSearchHit[] {
  const { scope, scopeKey, profile, online } = useAppState();
  const locals = useLocalNotes();
  const [kept, setKept] = useState<{ key: string; hits: LocalSearchHit[] } | null>(null);
  const q = query.trim().toLowerCase();
  useEffect(() => {
    if (online || !q) return;
    let live = true;
    void (async () => {
      try {
        const db = await localDb(profile.id);
        const docs = await db.getAllFromIndex("documents", "by_scope", scopeKey);
        const hits = docs
          .filter((d) => `${d.title} ${d.excerpt}`.toLowerCase().includes(q))
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 20)
          .map((d) => ({ id: d.id, title: d.title, icon: d.icon, updatedAt: d.updatedAt, snippet: d.excerpt.slice(0, 120) }));
        if (live) setKept({ key: `${scopeKey}:${q}`, hits });
      } catch {
        /* nothing kept on this device */
      }
    })();
    return () => {
      live = false;
    };
  }, [online, q, profile.id, scopeKey]);
  return useMemo(() => {
    if (!q) return [];
    const mine = searchLocalNotes(locals, q, scope).map((n) => ({ id: n.id, title: n.title ?? "", icon: n.icon ?? null, updatedAt: n.updatedAt, snippet: n.excerpt.slice(0, 120), waiting: n.waiting }));
    const seen = new Set(mine.map((h) => h.id));
    const fromDevice = !online && kept?.key === `${scopeKey}:${q}` ? kept.hits.filter((h) => !seen.has(h.id)).map((h) => ({ ...h, title: locals.get(h.id)?.title ?? h.title })) : [];
    return [...mine, ...fromDevice];
  }, [q, locals, scope, online, kept, scopeKey]);
}
