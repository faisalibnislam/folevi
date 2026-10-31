// Every view and command the bridge answers, put together from the modules that define them (each revision adds
// a module; protocol.ts's name lists say what must be here, and the type below fails when one is missing).
import type { CommandName, ViewName } from "./protocol";
import { CORE_COMMANDS, type CommandDef } from "./commands";
import { MORE_COMMANDS } from "./commandsMore";
import { WORK_COMMANDS } from "./commandsWork";
import { WORK_VALUE_VIEWS } from "./viewsWork";
import { ACCOUNT_VALUE_VIEWS } from "./viewsAccount";
import { ACCOUNT_COMMANDS } from "./commandsAccount";
import { AI_VALUE_VIEWS } from "./viewsAi";
import { AI_COMMANDS } from "./commandsAi";
import { MAC_VALUE_VIEWS } from "./viewsMac";
import { MAC_COMMANDS } from "./commandsMac";
import { PLANNER_VALUE_VIEWS } from "./viewsPlanner";
import { PLANNER_COMMANDS } from "./commandsPlanner";
import { DEVICE_VALUE_VIEWS } from "./viewsDevice";
import { DEVICE_COMMANDS } from "./commandsDevice";
import { EXTRA_VALUE_VIEWS } from "./viewsExtra";
import { EXTRA_COMMANDS } from "./commandsExtra";
import { FOLDER_VALUE_VIEWS } from "./viewsFolders";
import { FOLDER_COMMANDS } from "./commandsFolders";
import { CORE_VALUE_VIEWS, LIST_VIEWS, type ValueViewDef } from "./views";
import { MORE_VALUE_VIEWS } from "./viewsMore";
import { SCREEN_COMMANDS, SCREEN_VALUE_VIEWS } from "./viewsScreens";
import { SETTINGS_COMMANDS, SETTINGS_VALUE_VIEWS } from "./viewsSettings";
import { VAULT_VALUE_VIEWS } from "./viewsVault";
import { VAULT_COMMANDS } from "./commandsVault";
import { E2EE_COMMANDS, E2EE_VALUE_VIEWS } from "./commandsE2ee";
import { NOTE_STYLE_COMMANDS, NOTE_STYLE_VALUE_VIEWS } from "./noteStyle";
import { COMMENT_COMMANDS } from "./commandsComments";
import { TEXT_COMMANDS } from "./commandsText";

export const VALUE_VIEWS: Record<ViewName, ValueViewDef> = { ...CORE_VALUE_VIEWS, ...MORE_VALUE_VIEWS, ...WORK_VALUE_VIEWS, ...ACCOUNT_VALUE_VIEWS, ...AI_VALUE_VIEWS, ...MAC_VALUE_VIEWS, ...PLANNER_VALUE_VIEWS, ...DEVICE_VALUE_VIEWS, ...EXTRA_VALUE_VIEWS, ...FOLDER_VALUE_VIEWS, ...SETTINGS_VALUE_VIEWS, ...SCREEN_VALUE_VIEWS, ...VAULT_VALUE_VIEWS, ...E2EE_VALUE_VIEWS, ...NOTE_STYLE_VALUE_VIEWS };

export { LIST_VIEWS };

export const COMMANDS: Record<CommandName, CommandDef> = { ...CORE_COMMANDS, ...MORE_COMMANDS, ...WORK_COMMANDS, ...ACCOUNT_COMMANDS, ...AI_COMMANDS, ...MAC_COMMANDS, ...PLANNER_COMMANDS, ...DEVICE_COMMANDS, ...EXTRA_COMMANDS, ...FOLDER_COMMANDS, ...SETTINGS_COMMANDS, ...SCREEN_COMMANDS, ...VAULT_COMMANDS, ...E2EE_COMMANDS, ...NOTE_STYLE_COMMANDS, ...COMMENT_COMMANDS, ...TEXT_COMMANDS };
