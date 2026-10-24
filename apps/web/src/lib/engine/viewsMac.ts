// Revision 8's views: moving or copying notes between places (R8.7), current titles for restored tabs (R8.8), and
// a conversation's research jobs (Foli AI's Research mode).
import { api } from "@/lib/convex/api";
import { deviceWords } from "@/lib/shell/words";
import { clientSource } from "@/lib/migrate/source";
import type { MigrationClient } from "@/lib/migrate/types";
import type { EngineDeps } from "./context";
import { QuerySource } from "./live";
import { requireSpace, source, type ValueViewDef } from "./views";
import { BridgeError, id, ids, only, text } from "./validate";
import type { NoteBrief, PlaceMoveDestination, ResearchJob, ViewName } from "./protocol";

type Args = Record<string, unknown>;

/** Every place but this one: the library, and each account's Personal and workspaces (components/places/MovePlaces.tsx destinations). */
export function moveDestinations(deps: EngineDeps): PlaceMoveDestination[] {
  const out: PlaceMoveDestination[] = [];
  const local = deps.app.mode === "local";
  for (const p of deps.app.places.places) {
    if (p.id === deps.app.places.current || p.id === deps.app.place) continue;
    if (p.kind === "library") {
      out.push({ value: `${p.id}|personal`, label: `On ${deviceWords().here}`, place: p.id, space: "personal", switches: false });
      continue;
    }
    const name = p.name || p.email || "Folevi account";
    out.push({ value: `${p.id}|personal`, label: `${name}: Personal`, place: p.id, space: "personal", switches: local });
    for (const w of p.workspaces) out.push({ value: `${p.id}|ws:${w.id}`, label: `${name}: ${w.name}`, place: p.id, space: w.id, switches: local });
  }
  return out;
}

export function pickArgs(args: Args): { folders: string[]; notes: string[] } {
  const list = (key: string) => (args[key] === undefined || (Array.isArray(args[key]) && !(args[key] as unknown[]).length) ? [] : ids(args, key, 1000));
  return { folders: list("folders"), notes: list("notes") };
}

const placesMovePreview: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["to", "folders", "notes"]);
    const out: Args = { ...pickArgs(args) };
    if (args.to !== undefined) out.to = text(args, "to", { max: 200 });
    return out;
  },
  create: (ctx, args) => {
    const pick = { folders: args.folders as string[], notes: args.notes as string[] };
    const everything = !pick.folders.length && !pick.notes.length;
    // Counting everything reads the space's folders and notes once.
    let counted: { folders: number; notes: number } | null = everything ? null : { folders: pick.folders.length, notes: pick.notes.length };
    const listeners = new Set<() => void>();
    const signal = { subscribe: (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb)) };
    if (everything) {
      const deps = ctx.deps();
      const space = requireSpace(deps, undefined);
      const src = clientSource(deps.client as unknown as MigrationClient, { scope: space.scope, readFile: async () => null });
      void Promise.all([src.organization(), src.notes()]).then(
        ([org, notes]) => {
          counted = { folders: org.folders.length, notes: notes.filter((n) => !n.parentDocumentId && !n.inTrash && n.kind !== "synced" && n.kind !== "collectionRow").length };
          for (const l of listeners) l();
        },
        () => undefined,
      );
    }
    return {
      signals: [ctx.appSignal, signal],
      compute: () => {
        const deps = ctx.deps();
        const destinations = moveDestinations(deps);
        const to = (args.to ? destinations.find((d) => d.value === args.to) : destinations[0]) ?? null;
        if (args.to && !to) return { value: undefined, stale: false, error: new BridgeError("not_found", "That place isn't on this device any more.").toEngineError() };
        const here = requireSpace(deps, undefined);
        return {
          value: { from: deps.app.mode === "local" ? `On ${deviceWords().here}` : here.name, destinations, to, folders: counted?.folders ?? 0, notes: counted?.notes ?? 0, everything, fits: null },
          stale: counted === null,
          error: null,
        };
      },
    };
  },
};

type TitlesData = Record<string, { title: string; icon: string | null; inTrash: boolean }>;

const notesMeta: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, ["ids"]), { ids: ids(args, "ids", 200) }),
  create: (ctx, args) => {
    const wanted = args.ids as string[];
    const src = source<TitlesData>(ctx, api.documents.titles, { documentIds: wanted }, null);
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: true, error: null };
        const got = s.value;
        const notes: NoteBrief[] = wanted.map((noteId) => (got[noteId] ? { id: noteId, found: true, title: got[noteId]!.title ?? "", icon: got[noteId]!.icon ?? null, inTrash: Boolean(got[noteId]!.inTrash) } : { id: noteId, found: false, title: "", icon: null, inTrash: false }));
        return { value: { notes }, stale: s.stale, error: null };
      },
    };
  },
};

type JobData = {
  id: string;
  messageId: string;
  question: string;
  status: string;
  steps: { kind: string; label: string; status: string; count?: number }[];
  sources: ({ n: number; kind: "note"; id: string; title: string } | { n: number; kind: "web"; url: string; title: string; domain: string })[];
  noteId: string | null;
  error: { code: string; message: string } | null;
  credits: number | null;
  createdAt: number;
  finishedAt: number | null;
};

export function researchJob(j: JobData): ResearchJob {
  return {
    id: j.id,
    messageId: j.messageId,
    question: j.question,
    status: j.status,
    steps: j.steps.map((s) => ({ kind: s.kind, label: s.label, status: s.status, count: s.count ?? null })),
    sources: j.sources.map((s) => (s.kind === "note" ? { n: s.n, kind: "note", noteId: s.id, url: null, title: s.title, domain: null } : { n: s.n, kind: "web", noteId: null, url: s.url, title: s.title, domain: s.domain })),
    noteId: j.noteId ?? null,
    error: j.error ? { code: j.error.code, message: j.error.message } : null,
    credits: j.credits ?? null,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt ?? null,
  };
}

const aiResearch: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, ["conversationId"]), { conversationId: id(args, "conversationId") }),
  create: (ctx, args) => {
    // (A report can quote encrypted notes: never kept on the device.)
    const src = new QuerySource<JobData[]>(ctx.deps().client, api.aiResearch.forConversation, { conversationId: args.conversationId }, { kept: null });
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: true, error: null };
        return { value: { jobs: s.value.map(researchJob) }, stale: false, error: null };
      },
    };
  },
};

export const MAC_VALUE_VIEWS = {
  "places.move.preview": placesMovePreview,
  "notes.meta": notesMeta,
  "ai.research": aiResearch,
} satisfies Partial<Record<ViewName, ValueViewDef>>;
