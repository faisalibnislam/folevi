/** Menu and shortcut data for the Mac app illustrations. Keys follow macOS glyph order (⌃ ⌥ ⇧ ⌘). */

export type MenuItem = { label: string; keys?: string } | "separator";
export type Menu = { name: string; items: MenuItem[] };

export const MAC_MENUS: Menu[] = [
  {
    name: "File",
    items: [
      { label: "New Document", keys: "⌘N" },
      { label: "New Window", keys: "⇧⌘N" },
      "separator",
      { label: "Export as Markdown…" },
      { label: "Export as PDF…" },
      "separator",
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
      "separator",
      { label: "Search Workspace…", keys: "⌘K" },
    ],
  },
  {
    name: "Format",
    items: [
      { label: "Bold", keys: "⌘B" },
      { label: "Italic", keys: "⌘I" },
      { label: "Underline", keys: "⌘U" },
      "separator",
      { label: "Heading 1", keys: "⌥⌘1" },
      { label: "Heading 2", keys: "⌥⌘2" },
      { label: "Heading 3", keys: "⌥⌘3" },
    ],
  },
  {
    name: "Block",
    items: [
      { label: "Checklist", keys: "⇧⌘8" },
      { label: "Insert Block…", keys: "/" },
      "separator",
      { label: "Move Block Up", keys: "⌥⇧↑" },
      { label: "Move Block Down", keys: "⌥⇧↓" },
    ],
  },
  {
    name: "View",
    items: [
      { label: "Toggle Sidebar", keys: "⌃⌘S" },
      { label: "Toggle Inspector", keys: "⌥⌘I" },
      "separator",
      { label: "Enter Full Screen", keys: "⌃⌘F" },
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
];

export const SHORTCUT_GROUPS: Array<{ group: string; rows: Array<{ action: string; keys: string[] }> }> = [
  {
    group: "Documents & windows",
    rows: [
      { action: "New document", keys: ["⌘N"] },
      { action: "New window", keys: ["⇧⌘N"] },
      { action: "Search your workspace", keys: ["⌘K"] },
    ],
  },
  {
    group: "Layout",
    rows: [
      { action: "Show or hide the sidebar", keys: ["⌃⌘S"] },
      { action: "Show or hide the inspector", keys: ["⌥⌘I"] },
    ],
  },
  {
    group: "Blocks",
    rows: [
      { action: "Insert any block", keys: ["/"] },
      { action: "Heading 1, 2, 3", keys: ["⌥⌘1", "⌥⌘2", "⌥⌘3"] },
      { action: "Checklist", keys: ["⇧⌘8"] },
      { action: "Move block up / down", keys: ["⌥⇧↑", "⌥⇧↓"] },
      { action: "Link to a page", keys: ["[["] },
    ],
  },
  {
    group: "Text",
    rows: [
      { action: "Bold, italic, underline", keys: ["⌘B", "⌘I", "⌘U"] },
      { action: "Undo / redo", keys: ["⌘Z", "⇧⌘Z"] },
    ],
  },
];
