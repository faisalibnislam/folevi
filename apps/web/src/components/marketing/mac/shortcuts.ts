/**
 * Menu and shortcut data for the Mac app illustrations. Keys follow macOS glyph order (⌃ ⌥ ⇧ ⌘).
 * MAC_MENUS mirrors the app menu in apps/desktop/src/main.ts (buildMenu). SHORTCUT_GROUPS lists keys the
 * web app handles itself (components/app/Shell.tsx, editor/plugins.ts, editor/extensions.ts) plus the
 * Mac menu's own (⌘N, ⇧⌘N, ⌘[ ⌘], and Quick Add's ⌥Space, which can be changed).
 */

export type MenuItem = { label: string; keys?: string } | "separator";
export type Menu = { name: string; items: MenuItem[] };

export const MAC_MENUS: Menu[] = [
  {
    name: "File",
    items: [
      { label: "New Note", keys: "⌘N" },
      { label: "Quick Add Task…", keys: "⌥Space" },
      "separator",
      { label: "New Window", keys: "⇧⌘N" },
      { label: "Close Window", keys: "⌘W" },
    ],
  },
  {
    name: "Edit",
    items: [
      { label: "Undo", keys: "⌘Z" },
      { label: "Redo", keys: "⇧⌘Z" },
      "separator",
      { label: "Cut", keys: "⌘X" },
      { label: "Copy", keys: "⌘C" },
      { label: "Paste", keys: "⌘V" },
      { label: "Select All", keys: "⌘A" },
    ],
  },
  {
    name: "View",
    items: [
      { label: "Reload", keys: "⌘R" },
      "separator",
      { label: "Actual Size", keys: "⌘0" },
      { label: "Zoom In", keys: "⌘+" },
      { label: "Zoom Out", keys: "⌘-" },
      "separator",
      { label: "Toggle Full Screen", keys: "⌃⌘F" },
    ],
  },
  {
    name: "Go",
    items: [
      { label: "Back", keys: "⌘[" },
      { label: "Forward", keys: "⌘]" },
      "separator",
      { label: "Notes" },
      { label: "Tasks" },
      { label: "Calendar" },
    ],
  },
  {
    name: "Window",
    items: [
      { label: "Minimize", keys: "⌘M" },
      { label: "Zoom" },
      "separator",
      { label: "Bring All to Front" },
    ],
  },
  {
    name: "Help",
    items: [{ label: "Folevi Help" }],
  },
];

export const SHORTCUT_GROUPS: Array<{ group: string; rows: Array<{ action: string; keys: string[] }> }> = [
  {
    group: "Notes & windows",
    rows: [
      { action: "New note", keys: ["⌘N"] },
      { action: "New note (also on the web)", keys: ["⌥⌘N"] },
      { action: "New window", keys: ["⇧⌘N"] },
      { action: "Quick Add a task from any app", keys: ["⌥Space"] },
      { action: "Quick Add a task in Folevi", keys: ["⇧⌘A"] },
    ],
  },
  {
    group: "Getting around",
    rows: [
      { action: "Search or jump to a page", keys: ["⌘K"] },
      { action: "Back / forward", keys: ["⌘[", "⌘]"] },
      { action: "Today’s tasks", keys: ["⌥⌘T"] },
      { action: "Show or hide the sidebar", keys: ["⌘\\"] },
      { action: "Show or hide the inspector", keys: ["⌥⌘I"] },
      { action: "Ask AI (when AI is on)", keys: ["⌘J"] },
    ],
  },
  {
    group: "In a note",
    rows: [
      { action: "Insert any block", keys: ["/"] },
      { action: "Link to a page", keys: ["[["] },
      { action: "Heading 1, 2, 3", keys: ["⌥⌘1", "⌥⌘2", "⌥⌘3"] },
      { action: "Bulleted list, numbered list", keys: ["⇧⌘8", "⇧⌘7"] },
      { action: "Checklist", keys: ["⇧⌘9"] },
      { action: "Check off a task", keys: ["⌘↩"] },
      { action: "Move block up / down", keys: ["⌥⇧↑", "⌥⇧↓"] },
      { action: "Duplicate block", keys: ["⌘D"] },
    ],
  },
  {
    group: "Text",
    rows: [
      { action: "Bold, italic, underline", keys: ["⌘B", "⌘I", "⌘U"] },
      { action: "Strikethrough", keys: ["⇧⌘X"] },
      { action: "Inline code", keys: ["⌘E"] },
      { action: "Highlight", keys: ["⇧⌘H"] },
      { action: "Undo / redo", keys: ["⌘Z", "⇧⌘Z"] },
    ],
  },
];
