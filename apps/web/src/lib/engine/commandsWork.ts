// Revision 5's commands (docs/NATIVE_APP_PLAN.md sections 5.8 and 5.12): Quick Add's task (dates read as the web
// reads them; kept on the device and sent later when offline, like the web's Quick Add), task changes and moves,
// and calendar subscriptions.
import { parseRepeatPhrase, type RepeatRule, type WireBlock } from "@folevi/editor-schema";
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

const SIMPLE_REPEATS = ["daily", "weekly", "weekdays", "monthly", "yearly"] as const;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** A repeat as native sends it: a kind ("weekly") or a rule in words ("every 2 weeks on mon,thu"). */
export function repeatRuleFrom(value: string): RepeatRule {
  const v = value.trim().toLowerCase();
  if ((SIMPLE_REPEATS as readonly string[]).includes(v)) return { repeat: v as RepeatRule["repeat"] };
  const parsed = parseRepeatPhrase(v.startsWith("every") ? v : `every ${v}`);
  if (!parsed) throw invalid(`“${value}” isn't a repeat Folevi knows (daily, weekly, weekdays, monthly, yearly, or “every 2 weeks on mon”).`);
  // "every 2 weeks on mon,thu": the days after "on" (the phrase reader takes the interval or the days, not both).
  const on = /\bon\s+([a-z,&\s]+)$/.exec(v);
  if (parsed.rule.repeat === "weekly" && on) {
    const days = [...new Set(on[1]!.split(/\s*(?:,|and|&|\s)\s*/).map((d) => DAYS.indexOf(d.slice(0, 3)) + 1).filter((d) => d > 0))].sort((a, b) => a - b);
    if (days.length) return { ...parsed.rule, days };
  }
  return parsed.rule;
}

/** Sets (or, with null, removes) a to-do's repeat by changing its block through the sync engine. */
async function setTaskRepeat(deps: EngineDeps, noteId: string, blockId: string, rule: RepeatRule | null): Promise<void> {
  const engine = deps.app.engine;
  if (!engine) throw new BridgeError("engine_not_ready", "Folevi is still starting. Try again in a moment.");
  let block = engine.documentBlocks(noteId).find((b) => b.id === blockId);
  if (!block) {
    const got = (await Promise.race([deps.client.query(api.blocks.list, { documentId: noteId }) as Promise<{ blocks: WireBlock[] } | null>, new Promise<null>((r) => setTimeout(() => r(null), 3000))]).catch(() => null)) as { blocks: WireBlock[] } | null;
    block = got?.blocks.find((b) => b.id === blockId);
  }
  if (!block) throw new BridgeError("not_found", "That task isn't there any more.");
  if (block.type !== "todo") throw invalid("That isn't a task.");
  const props: Record<string, unknown> = { ...(block.props as Record<string, unknown>) };
  delete props.repeat;
  delete props.repeatEvery;
  delete props.repeatDays;
  for (const [k, v] of Object.entries(repeatProps(rule))) if (v !== null) props[k] = v;
  engine.upsertBlock(noteId, { ...block, props } as WireBlock, ["content"], (block as { revision?: number | null }).revision ?? engine.serverRevision(blockId));
  await engine.persisted();
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
      only(args, ["id", "checked", "canceled", "dueDate", "dueTime", "priority", "assigneeId", "reminderAt", "repeat", "noteId"]);
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
      const repeating = args.repeat !== undefined;
      if (Object.keys(patch).length === 1 && !repeating) throw invalid("Say what to change.");
      // The repeat is the to-do line's own props, saved through the note like an edit (works offline).
      if (repeating) {
        const rule = args.repeat === null ? null : repeatRuleFrom(text(args, "repeat", { max: 100 }) as string);
        await setTaskRepeat(deps, id(args, "noteId"), patch.blockId as string, rule);
      }
      if (Object.keys(patch).length > 1) await deps.client.mutation(api.tasks.update, patch);
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
