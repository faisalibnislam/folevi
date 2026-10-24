// Every view and command the bridge answers, put together from the modules that define them (each revision adds
// a module; protocol.ts's name lists say what must be here, and the type below fails when one is missing).
import type { CommandName, ViewName } from "./protocol";
import { CORE_COMMANDS, type CommandDef } from "./commands";
import { MORE_COMMANDS } from "./commandsMore";
import { CORE_VALUE_VIEWS, LIST_VIEWS, type ValueViewDef } from "./views";
import { MORE_VALUE_VIEWS } from "./viewsMore";

export const VALUE_VIEWS: Record<ViewName, ValueViewDef> = { ...CORE_VALUE_VIEWS, ...MORE_VALUE_VIEWS };

export { LIST_VIEWS };

export const COMMANDS: Record<CommandName, CommandDef> = { ...CORE_COMMANDS, ...MORE_COMMANDS };
