// Revision 9's commands (R10.3): the calendar feed of tasks for other calendar apps.
import { api } from "@/lib/convex/api";
import { APP_URL } from "@/lib/env";
import type { CommandDef } from "./commands";
import { bool, only } from "./validate";
import type { CommandName } from "./protocol";

export const PLANNER_COMMANDS = {
  "calendar.feedCreate": {
    // A new link ends the old one; it's shown once (the server keeps only its hash).
    async run(deps, args) {
      only(args, ["includeWorkspaces"]);
      const r = (await deps.client.mutation(api.calendarFeeds.create, { includeWorkspaces: bool(args, "includeWorkspaces", false) })) as { token: string };
      return { url: `${APP_URL.replace(/\/$/, "")}/api/calendar/${r.token}.ics` };
    },
  },

  "calendar.feedRevoke": {
    async run(deps, args) {
      only(args, []);
      await deps.client.mutation(api.calendarFeeds.remove, {});
      return { ok: true };
    },
  },

  "calendar.feedWorkspaces": {
    async run(deps, args) {
      only(args, ["includeWorkspaces"]);
      await deps.client.mutation(api.calendarFeeds.setIncludeWorkspaces, { includeWorkspaces: bool(args, "includeWorkspaces") });
      return { ok: true };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
