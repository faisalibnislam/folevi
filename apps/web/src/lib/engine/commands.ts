// The engine's commands (docs/NATIVE_APP_PLAN.md section 3.2, "Commands"): the writes native screens make. Each
// goes the way the web's own controls go (the sync engine for notes, the outbox for folders and moves,
// documents.bulkUpdate for stars, archive and trash, through whichever client the page uses, so they work offline
// and are sealed in encrypted spaces), and replies once the change is applied on this device.
import { ulid, DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { requireOutbox } from "@/lib/app/folders";
import type { EngineDeps, EngineSpace } from "./context";
import { spaceOf } from "./context";
import { toEngineError } from "./live";
import { catchUpCard, setCatchUp } from "./catchUp";
import { runToastAction } from "./toasts";
import { BridgeError, argsOf, bool, id, ids, nullableId, only, optionalId, text } from "./validate";
import type { BulkResult, CatchUpCard, CommandName } from "./protocol";

type Args = Record<string, unknown>;

export interface CommandDef {
  run(deps: EngineDeps, args: Args): Promise<unknown>;
}

/** The server takes at most this many notes per bulk call (documents.MAX_BULK). */
const CHUNK = 50;

function spaceArg(deps: EngineDeps, args: Args): EngineSpace {
  const s = spaceOf(deps.app, optionalId(args, "space"));
  if (!s) throw new BridgeError("not_found", "That Personal or workspace isn't in this place.");
  return s;
}

const spaceKey = (s: EngineSpace) => (s.scope.kind === "personal" ? "personal" : s.scope.workspaceId);

type BulkAction = { kind: "star"; starred: boolean } | { kind: "archive"; archived: boolean } | { kind: "trash" } | { kind: "restore" };

/** documents.bulkUpdate in turns of 50. Offline, it's handed to the client's queue and reported as done. */
async function bulk(deps: EngineDeps, documentIds: string[], action: BulkAction): Promise<BulkResult> {
  const calls: Promise<{ done: string[]; skipped: number }>[] = [];
  for (let i = 0; i < documentIds.length; i += CHUNK) {
    calls.push(deps.client.mutation(api.documents.bulkUpdate, { documentIds: documentIds.slice(i, i + CHUNK), action }) as Promise<{ done: string[]; skipped: number }>);
  }
  if (!deps.app.online && deps.app.mode === "account") {
    // The Convex client sends them when the connection is back; a refusal then is reported as a toast.
    for (const c of calls) void c.catch(() => undefined);
    return { done: documentIds, skipped: 0, queued: true };
  }
  const results = await Promise.all(calls);
  return { done: results.flatMap((r) => r.done), skipped: results.reduce((n, r) => n + r.skipped, 0), queued: false };
}

const notes = (n: number) => (n === 1 ? "a note" : `${n.toLocaleString()} notes`);

export const COMMANDS: Record<CommandName, CommandDef> = {
  "space.switch": {
    async run(deps, args) {
      only(args, ["space"]);
      const space = id(args, "space");
      if (!deps.app.spaces.some((s) => s.id === space)) throw new BridgeError("not_found", "That Personal or workspace isn't in this place.");
      deps.setSpace(space);
      return { space };
    },
  },

  "note.create": {
    async run(deps, args) {
      only(args, ["space", "folderId", "parentId", "title", "templateId", "open"]);
      const engine = deps.app.engine;
      if (!engine) throw new BridgeError("engine_not_ready", "Folevi is still starting. Try again in a moment.");
      const space = spaceArg(deps, args);
      if (!space.canEdit) throw new BridgeError("forbidden", `You can't add notes in ${space.name}.`);
      const folderId = nullableId(args, "folderId") ?? null;
      const parentId = nullableId(args, "parentId") ?? null;
      const templateId = args.templateId === undefined || args.templateId === null ? null : (text(args, "templateId", { max: 200 }) as string);
      const title = (text(args, "title", { optional: true, allowEmpty: true, max: 500 }) ?? "").trim();
      const open = bool(args, "open", false);
      const noteId = ulid();
      engine.createDocument({
        id: noteId,
        parentDocumentId: parentId,
        folderId: parentId ? null : folderId,
        kind: "document",
        title,
        icon: null,
        style: DEFAULT_DOCUMENT_STYLE,
        cover: DEFAULT_COVER,
        templateId,
        ...(parentId ? {} : { scope: space.scope }),
      });
      await engine.persisted();
      if (open) deps.navigate(`/d/${noteId}?new=1`);
      return { id: noteId };
    },
  },

  "note.star": {
    async run(deps, args) {
      only(args, ["ids", "starred"]);
      return bulk(deps, ids(args), { kind: "star", starred: bool(args, "starred") });
    },
  },

  "note.archive": {
    async run(deps, args) {
      only(args, ["ids", "archived"]);
      return bulk(deps, ids(args), { kind: "archive", archived: bool(args, "archived") });
    },
  },

  "note.trash": {
    async run(deps, args) {
      only(args, ["ids"]);
      return bulk(deps, ids(args), { kind: "trash" });
    },
  },

  "note.restore": {
    async run(deps, args) {
      only(args, ["ids"]);
      return bulk(deps, ids(args), { kind: "restore" });
    },
  },

  "note.move": {
    // Through the outbox, after the folder it names (which may have been made offline), as noteActions.ts does.
    async run(deps, args): Promise<BulkResult> {
      only(args, ["ids", "folderId"]);
      const documentIds = ids(args);
      if (args.folderId === undefined) throw new BridgeError("invalid_args", "folderId must be a folder id or null.");
      const folderId = nullableId(args, "folderId") ?? null;
      const outbox = requireOutbox(deps.app.outbox);
      const sent: Promise<unknown>[] = [];
      for (let i = 0; i < documentIds.length; i += CHUNK) {
        const chunk = documentIds.slice(i, i + CHUNK);
        const keys = [...(folderId ? [`folder:${folderId}`] : []), ...chunk.map((d) => `note:${d}`)];
        sent.push(
          outbox.enqueue("documents.bulkUpdate", { documentIds: chunk, action: { kind: "move", folderId } }, { keys, label: chunk.length === 1 ? "Move a note" : `Move ${notes(chunk.length)}`, after: chunk.map((documentId) => ({ documentId, blockId: null })) })
            .result,
        );
      }
      if (!deps.app.online) {
        for (const s of sent) void s.catch(() => undefined);
        return { done: documentIds, skipped: 0, queued: true };
      }
      const results = (await Promise.all(sent)) as { done: string[]; skipped: number }[];
      return { done: results.flatMap((r) => r.done), skipped: results.reduce((n, r) => n + r.skipped, 0), queued: false };
    },
  },

  "note.hideFromRecent": {
    async run(deps, args) {
      only(args, ["ids"]);
      const r = (await deps.client.mutation(api.documents.hideFromRecent, { documentIds: ids(args, "ids", 50) })) as { hidden: number };
      return { hidden: r.hidden };
    },
  },

  "folder.create": {
    async run(deps, args) {
      only(args, ["space", "name", "parentId", "color"]);
      const space = spaceArg(deps, args);
      if (!space.canEdit) throw new BridgeError("forbidden", `You can't add folders in ${space.name}.`);
      const name = (text(args, "name", { max: 80 }) as string).trim();
      const parentId = nullableId(args, "parentId") ?? null;
      const color = args.color === undefined || args.color === null ? null : (text(args, "color", { max: 32 }) as string);
      const outbox = requireOutbox(deps.app.outbox);
      const folderId = ulid();
      outbox.enqueue(
        "organization.createFolder",
        { scope: space.scope, name, ...(parentId ? { parentFolderId: parentId } : {}), id: folderId },
        { keys: [`folder:${folderId}`, ...(parentId ? [`folder:${parentId}`] : [])], label: `New folder “${name}”`, creates: [folderId] },
      );
      if (color) outbox.enqueue("organization.setFolderColor", { folderId, color }, { keys: [`folder:${folderId}`], label: "Folder color" });
      await outbox.persisted();
      return { id: folderId };
    },
  },

  "catchUp.run": {
    async run(deps, args): Promise<CatchUpCard> {
      only(args, ["space"]);
      const space = spaceArg(deps, args);
      const key = spaceKey(space);
      if (!deps.app.capabilities.ai) throw new BridgeError("ai_unavailable", "Foli AI isn't on here.");
      setCatchUp(key, { state: "running", brief: catchUpCard(key, true).brief, error: null });
      try {
        const r = deps.brief ? await deps.brief(space.scope, deps.app.today) : ((await deps.client.action(api.ai.brief, { scope: space.scope, today: deps.app.today })) as { answer: string; sources: { id: string; title: string }[] });
        setCatchUp(key, { state: "ready", brief: { text: r.answer, sources: r.sources.map((s) => ({ id: s.id, title: s.title })), at: Date.now() }, error: null });
      } catch (e) {
        const error = toEngineError(e);
        setCatchUp(key, { state: "error", brief: null, error });
        throw new BridgeError(error.code, error.message);
      }
      return catchUpCard(key, true);
    },
  },

  "catchUp.clear": {
    async run(deps, args) {
      only(args, ["space"]);
      setCatchUp(spaceKey(spaceArg(deps, args)), null);
      return { ok: true };
    },
  },

  "engine.refresh": {
    async run(deps, args) {
      only(args, []);
      deps.app.engine?.scheduleFlush(0);
      deps.app.outbox?.scheduleFlush(0);
      return { ok: true };
    },
  },

  "toast.action": {
    async run(_deps, args) {
      only(args, ["id"]);
      if (!runToastAction(id(args, "id"))) throw new BridgeError("not_found", "That button has gone.");
      return { ok: true };
    },
  },
};

/** Runs a command's handler with its checked args. */
export async function runCommand(name: CommandName, deps: EngineDeps, raw: unknown): Promise<unknown> {
  return COMMANDS[name].run(deps, argsOf(raw));
}
