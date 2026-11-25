// The phone interface's screens (components/iphone), in one module that loads on its own (./lazy.tsx): a window
// 700 px or wider (the website on a computer, the Mac, iPad and Windows apps) never downloads or runs them. The
// small pieces the other layouts share (Sheet, Glass, SettingsKit, Grouped, Swipe) stay where they are.
export { IphoneShell } from "./IphoneShell";
export { IphoneScreen } from "./Screen";
export { IphoneHome } from "./IphoneHome";
export { IphoneNoteList } from "./NoteList";
export { IphoneTasks } from "./Tasks";
export { IphoneTaskSheet } from "./TaskSheet";
export { IphoneAgenda } from "./Agenda";
export { RootAvatar, RootPill } from "./RootBar";
export { IphoneFolders, IphoneTags } from "./Organize";
export { PhoneQuickAdd } from "./QuickAddSheet";
export { IphoneScopes } from "./SearchScopes";
export { NoteBars } from "./NoteBars";
export { NotePlaceChip, NoteSyncTrailing, NoteTrailing, ToolSheet } from "./NoteChrome";
