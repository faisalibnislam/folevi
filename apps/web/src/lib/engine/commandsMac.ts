// Revision 8's commands: a macOS banner's actions (R8.6), moving or copying notes between places (R8.7), Foli AI's
// Research mode and the agent's proposed changes, and the profile picture.
import { ulid } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { uploadIdentityImage, identityImageProblem } from "@/lib/app/identityImages";
import { newMoveKey } from "@/lib/migrate/reshape";
import type { MigrationClient } from "@/lib/migrate/types";
import type { Place } from "@/lib/places";
import { startPlaceMove } from "@/components/places/MovePlaces";
import type { ConvexReactClient } from "convex/react";
import type { EngineDeps } from "./context";
import { spaceOf } from "./context";
import type { CommandDef } from "./commands";
import { gateEvent, pushGate } from "./gates";
import { moveDestinations, pickArgs } from "./viewsMac";
import { BridgeError, bool, id, ids, oneOf, only, optionalId, text } from "./validate";
import type { CommandName, PlaceMoveResult } from "./protocol";

type NotificationData = { id: string; kind: string; documentId: string | null; threadId: string | null; blockId: string | null }[];

/** When a snoozed reminder comes back: in an hour, this evening at 6 (tomorrow's, once it's late), tomorrow at 9. */
export function snoozeUntil(action: string, now: Date = new Date()): number {
  if (action === "snooze-hour") return now.getTime() + 3_600_000;
  const at = new Date(now);
  if (action === "snooze-evening") {
    at.setHours(18, 0, 0, 0);
    if (now.getHours() >= 17) at.setDate(at.getDate() + 1);
    return at.getTime();
  }
  at.setDate(at.getDate() + 1);
  at.setHours(9, 0, 0, 0);
  return at.getTime();
}

const ACTIONS = ["reply", "read", "done", "complete", "snooze-hour", "snooze-evening", "snooze-tomorrow"] as const;

function bytesOf(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const MAC_COMMANDS = {
  "notification.act": {
    async run(deps, args) {
      only(args, ["id", "action", "text", "thread"]);
      if (deps.app.mode === "local") throw new BridgeError("unavailable", "Local reminders are the system's own here.");
      const nid = id(args, "id");
      const action = oneOf(args, "action", ACTIONS);
      const markRead = () => deps.client.mutation(api.notifications.markRead, { ids: [nid] });
      if (action === "read") {
        await markRead();
        return { ok: true };
      }
      const list = (await deps.client.query(api.notifications.list, { limit: 100 })) as NotificationData;
      const n = list.find((x) => x.id === nid);
      if (action === "reply") {
        const body = (text(args, "text", { max: 4000 }) as string).trim();
        const threadId = args.thread !== undefined ? id(args, "thread") : n?.threadId;
        if (!threadId) throw new BridgeError("not_found", "That comment isn't there any more.");
        const outbox = deps.app.outbox;
        if (!outbox) throw new BridgeError("engine_not_ready", "Folevi is still starting. Try again in a moment.");
        const commentId = ulid();
        outbox.enqueue("comments.reply", { threadId, body: [{ type: "text", text: body }], commentId }, { keys: [`thread:${threadId}`, `comment:${commentId}`], label: `Reply “${body.slice(0, 40)}”` });
        await outbox.persisted();
        await markRead().catch(() => undefined);
        return { ok: true };
      }
      if (!n?.blockId) throw new BridgeError("not_found", "That task isn't there any more.");
      if (action === "done" || action === "complete") await deps.client.mutation(api.tasks.update, { blockId: n.blockId, checked: true });
      else await deps.client.mutation(api.tasks.update, { blockId: n.blockId, reminderAt: snoozeUntil(action) });
      await markRead().catch(() => undefined);
      return { ok: true };
    },
  },

  "places.move": {
    // Runs here (its progress as the placeMove gate), or switches to the account to run there (from the library).
    async run(deps, args): Promise<PlaceMoveResult> {
      only(args, ["to", "folders", "notes", "copy", "versions"]);
      const to = moveDestinations(deps).find((d) => d.value === text(args, "to", { max: 200 }));
      if (!to) throw new BridgeError("not_found", "That place isn't on this device any more.");
      const row = deps.app.places.places.find((p) => p.id === to.place)!;
      const here = spaceOf(deps.app, undefined)!;
      const pick = pickArgs(args);
      const copy = bool(args, "copy");
      const move = {
        from: { place: deps.app.place ?? "", scope: here.scope, label: here.name },
        to: { place: to.place, scope: to.space === "personal" ? ({ kind: "personal" } as const) : ({ kind: "workspace", workspaceId: to.space } as const), label: to.label },
        pick: pick.folders.length || pick.notes.length ? pick : null,
        mode: copy ? ("copy" as const) : ("move" as const),
        versions: bool(args, "versions", true),
        key: newMoveKey(),
        startedAt: Date.now(),
      };
      const place = { ...row, userId: row.id.replace(/^acct:/, ""), profileId: null, lastOpenedAt: 0 } as unknown as Place;
      const verb = copy ? "Copying notes" : "Moving notes";
      const gate = pushGate(gateEvent({ gate: "placeMove", title: verb, busy: true, progress: { done: 0, total: null, label: verb } }), new Map());
      try {
        const local = (deps.client as unknown as { local?: { library?: { flush(): Promise<void> } } }).local;
        const r = await startPlaceMove({
          convex: deps.client as unknown as MigrationClient,
          local: deps.app.mode === "local",
          flushLibrary: () => local?.library?.flush(),
          deviceId: deps.app.engine?.deviceId ?? null,
          move,
          to: place,
          onProgress: (p) => gate.update(gateEvent({ gate: "placeMove", title: verb, busy: true, progress: { done: p.notesDone, total: p.notesTotal, label: verb } }), new Map()),
        });
        if (r.kind === "switched") return { status: "switched", notes: 0, problems: 0 };
        return { status: "done", notes: Object.keys(r.state.notes).length, problems: r.state.problems.length };
      } finally {
        gate.release();
      }
    },
  },

  "ai.researchCancel": {
    async run(deps, args) {
      only(args, ["researchId"]);
      await deps.client.mutation(api.aiResearch.cancel, { researchId: id(args, "researchId") });
      return { ok: true };
    },
  },

  "ai.researchSave": {
    async run(deps, args) {
      only(args, ["researchId", "folderId"]);
      const folderId = optionalId(args, "folderId");
      const r = (await deps.client.mutation(api.aiResearch.saveAsNote, { researchId: id(args, "researchId"), ...(folderId ? { folderId } : {}) })) as { id: string };
      return { id: r.id };
    },
  },

  "ai.agentApprove": {
    async run(deps, args) {
      only(args, ["runId", "operationIds"]);
      await deps.client.action(api.aiAgent.approve, { runId: id(args, "runId"), operationIds: ids(args, "operationIds", 200) });
      return { ok: true };
    },
  },

  "ai.agentDiscard": {
    async run(deps, args) {
      only(args, ["runId"]);
      await deps.client.mutation(api.aiAgent.discard, { runId: id(args, "runId") });
      return { ok: true };
    },
  },

  "ai.agentUndo": {
    async run(deps, args) {
      only(args, ["runId", "force"]);
      const force = args.force === undefined ? undefined : oneOf(args, "force", ["all", "rest"] as const);
      const r = (await deps.client.action(api.aiAgent.undo, { runId: id(args, "runId"), ...(force ? { changed: force } : {}) })) as { status: string; changed: { key: string; label: string }[] };
      return { status: r.status, changed: r.changed.map((c) => c.label) };
    },
  },

  "settings.setAvatar": {
    // The bytes come in the message (base64) or, when big, from the scheme's /_bridge/<bodyId> route.
    async run(deps: EngineDeps, args) {
      only(args, ["data", "bodyId", "mimeType", "name"]);
      const mimeType = oneOf(args, "mimeType", ["image/jpeg", "image/png", "image/webp", "image/gif"] as const);
      let bytes: Uint8Array;
      if (args.bodyId !== undefined) {
        const res = await fetch(`/_bridge/${id(args, "bodyId")}`);
        if (!res.ok) throw new BridgeError("not_found", "The picture didn't arrive. Try again.");
        bytes = new Uint8Array(await res.arrayBuffer());
      } else bytes = bytesOf(text(args, "data", { max: 20_000_000 }) as string);
      const file = new File([bytes as Uint8Array<ArrayBuffer>], (args.name as string | undefined) ?? "avatar", { type: mimeType });
      const problem = identityImageProblem(file);
      if (problem) throw new BridgeError("invalid_args", problem);
      const client = deps.client as unknown as ConvexReactClient;
      const fileId = await uploadIdentityImage(client, { kind: "avatar", file });
      await deps.client.mutation(api.users.setAvatar, { fileId });
      return { ok: true };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
