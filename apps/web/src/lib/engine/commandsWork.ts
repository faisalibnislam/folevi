// Revision 5's commands (docs/NATIVE_APP_PLAN.md sections 5.8 and 5.12): Quick Add's task (dates read as the web
// reads them; kept on the device and sent later when offline, like the web's Quick Add), task changes and moves,
// and calendar subscriptions.
import { api } from "@/lib/convex/api";
import { quickAddOnDevice } from "@/lib/quickAddOffline";
import type { EngineDeps } from "./context";
import { spaceArg, type CommandDef } from "./commands";
import { planQuickTask, repeatProps } from "./quickTask";
import { BridgeError, bool, id, invalid, num, oneOf, only, optionalId, text } from "./validate";
import type { CommandName, TaskCreateResult } from "./protocol";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const PRIORITIES = ["low", "medium", "high"] as const;

function dateArg(args: Record<string, unknown>, key: string, re: RegExp, what: string): string | null | undefined {
  const v = args[key];
  if (v === undefined || v === null) return v as null | undefined;
  if (typeof v !== "string" || !re.test(v)) throw invalid(`${key} must be ${what} or null.`);
  return v;
}

async function noteTitle(deps: EngineDeps, noteId: string): Promise<string> {
  const titles = await Promise.race([deps.client.query(api.documents.titles, { documentIds: [noteId] }) as Promise<Record<string, { title: string }>>, new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500))]).catch(() => undefined);
  return titles?.[noteId]?.title || "Untitled";
}

export const WORK_COMMANDS = {
  "task.create": {
    async run(deps, args): Promise<TaskCreateResult> {
      only(args, ["text", "space", "noteId", "dueDate", "dueTime", "priority", "keepText"]);
      const typed = text(args, "text", { max: 1000 }) as string;
      const space = spaceArg(deps, args);
      const noteId = optionalId(args, "noteId");
      const dueDate = dateArg(args, "dueDate", DATE, "a day (YYYY-MM-DD)");
      const dueTime = dateArg(args, "dueTime", TIME, "a time (HH:MM)");
      const priority = args.priority === undefined ? undefined : oneOf(args, "priority", PRIORITIES);
      const plan = planQuickTask(typed, deps.app.today, { keepText: bool(args, "keepText", false), ...(dueDate !== undefined ? { dueDate } : {}), ...(dueTime !== undefined ? { dueTime } : {}) });
      if (!plan.title) throw new BridgeError("invalid_args", "Write the task first.");
      const task = {
        title: plan.title,
        ...(plan.dueDate ? { dueDate: plan.dueDate } : {}),
        ...(plan.dueDate && plan.dueTime ? { dueTime: plan.dueTime } : {}),
        ...(plan.repeat ? { repeat: repeatProps(plan.repeat) } : {}),
        ...(priority ? { priority } : {}),
        ...(noteId ? { documentId: noteId } : {}),
      };
      const engine = deps.app.engine;
      const deviceId = engine?.deviceId ?? null;
      const r =
        !deps.app.online && engine
          ? await quickAddOnDevice({ engine, profileId: deps.app.accountKey, deviceId }, space.scope, task)
          : ((await deps.client.mutation(api.tasks.quickAdd, { scope: space.scope, today: deps.app.today, ...task, ...(deviceId ? { deviceId } : {}) })) as { blockId: string; documentId: string });
      return { id: r.blockId, noteId: r.documentId, where: noteId ? await noteTitle(deps, noteId) : "Inbox" };
    },
  },

  "task.update": {
    async run(deps, args) {
      only(args, ["id", "checked", "canceled", "dueDate", "dueTime", "priority", "assigneeId", "reminderAt"]);
      const patch: Record<string, unknown> = { blockId: id(args, "id") };
      if (args.checked !== undefined) patch.checked = bool(args, "checked");
      if (args.canceled !== undefined) patch.canceled = bool(args, "canceled");
      const dueDate = dateArg(args, "dueDate", DATE, "a day (YYYY-MM-DD)");
      if (dueDate !== undefined) patch.dueDate = dueDate;
      const dueTime = dateArg(args, "dueTime", TIME, "a time (HH:MM)");
      if (dueTime !== undefined) patch.dueTime = dueTime;
      if (args.priority !== undefined) patch.priority = oneOf(args, "priority", ["none", ...PRIORITIES] as const);
      if (args.assigneeId !== undefined) patch.assigneeId = args.assigneeId === null ? null : id(args, "assigneeId");
      if (args.reminderAt !== undefined) patch.reminderAt = args.reminderAt === null ? null : num(args, "reminderAt", { min: 0 });
      if (Object.keys(patch).length === 1) throw invalid("Say what to change.");
      await deps.client.mutation(api.tasks.update, patch);
      return { ok: true };
    },
  },

  "task.moveToNote": {
    async run(deps, args) {
      only(args, ["id", "noteId"]);
      const noteId = optionalId(args, "noteId");
      await deps.client.mutation(api.tasks.moveToDocument, { blockId: id(args, "id"), ...(noteId ? { documentId: noteId } : {}) });
      return { ok: true };
    },
  },

  "calendar.add": {
    async run(deps, args) {
      only(args, ["url", "name", "color"]);
      const r = (await deps.client.mutation(api.externalCalendars.add, {
        url: text(args, "url", { max: 2000 }) as string,
        ...(args.name !== undefined ? { name: text(args, "name", { max: 80, allowEmpty: true }) } : {}),
        ...(args.color !== undefined ? { color: text(args, "color", { max: 20 }) } : {}),
      })) as { id: string };
      return { id: r.id };
    },
  },

  "calendar.update": {
    async run(deps, args) {
      only(args, ["id", "name", "color", "visible"]);
      await deps.client.mutation(api.externalCalendars.update, {
        calendarId: id(args, "id"),
        ...(args.name !== undefined ? { name: text(args, "name", { max: 80 }) } : {}),
        ...(args.color !== undefined ? { color: text(args, "color", { max: 20 }) } : {}),
        ...(args.visible !== undefined ? { visible: bool(args, "visible") } : {}),
      });
      return { ok: true };
    },
  },

  "calendar.remove": {
    async run(deps, args) {
      only(args, ["id"]);
      await deps.client.mutation(api.externalCalendars.remove, { calendarId: id(args, "id") });
      return { ok: true };
    },
  },

  "calendar.refresh": {
    async run(deps, args) {
      only(args, ["id"]);
      await deps.client.mutation(api.externalCalendars.refresh, { calendarId: id(args, "id") });
      return { ok: true };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
