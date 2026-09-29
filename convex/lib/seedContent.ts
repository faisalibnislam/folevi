// Seed documents for a new person's Personal. Fictional, original Folevi copy.
import { addDays } from "@folevi/editor-schema";
import type { BlockSpec } from "./create";

export const WELCOME_TITLE = "Welcome to Folevi";

export function welcomeBlocks(today: string): BlockSpec[] {
  return [
    {
      type: "paragraph",
      md: "Folevi is a quiet place for ideas that keep growing. Start with a loose thought, give it shape when you are ready, and find it again when you need it.",
    },
    { type: "callout", props: { tone: "info", icon: "✳︎" }, md: "Everything you type here is saved as you go. The status in the top bar says **Saved** only after the server has confirmed it." },
    { type: "heading", props: { level: 2 }, md: "Capture in three seconds" },
    {
      type: "bulleted",
      md: "Press **⌘N** in the Mac app (**⌘⌥N** on the web) for a new document, or **⌘K** to search and jump anywhere.",
    },
    { type: "bulleted", md: "Type `/` on an empty line to insert headings, checklists, tables, code, callouts and more." },
    { type: "bulleted", md: "Type `[[` to link to another page. Links show up as backlinks on the page you linked to." },
    { type: "heading", props: { level: 2 }, md: "Shape it when you are ready" },
    {
      type: "paragraph",
      md: "Every paragraph is a block. Drag the handle to the left of a block, or use **⌥⇧↑** and **⌥⇧↓** to move it. **Tab** nests a block under the one above it.",
    },
    {
      type: "toggle",
      props: { collapsed: true },
      md: "Keyboard shortcuts worth learning first",
      children: [
        { type: "bulleted", md: "**⌘B**, **⌘I**, **⌘U** — bold, italic, underline" },
        { type: "bulleted", md: "**⌘E** — inline code" },
        { type: "bulleted", md: "**⌘⇧9** — turn a line into a checklist item" },
        { type: "bulleted", md: "**⌘⌥1**, **⌘⌥2**, **⌘⌥3** — headings" },
        { type: "bulleted", md: "**⌘⌥I** — open the inspector" },
      ],
    },
    { type: "heading", props: { level: 2 }, md: "Try these" },
    { type: "todo", props: { checked: false }, md: "Add a task with Quick Add (⇧⌘A) — it lands in your Inbox page" },
    { type: "todo", props: { checked: false, dueDate: today }, md: "Give this task a due date and find it again under **Tasks → Today**" },
    { type: "todo", props: { checked: false }, md: "Open the inspector and change this page's accent color" },
    { type: "todo", props: { checked: true }, md: "Open Folevi for the first time" },
    { type: "heading", props: { level: 2 }, md: "Return to it later" },
    {
      type: "paragraph",
      md: "Folders and tags organize things you want to keep; the Archive holds finished work without cluttering your lists; Trash keeps deleted pages for 30 days. You can export any page as Markdown, HTML or PDF, or your whole workspace as a ZIP.",
    },
    { type: "quote", md: "Write it down loosely. Tidy it up later. Keep it for years." },
    { type: "divider" },
    { type: "paragraph", md: "_You can delete this page whenever you like — it is yours._" },
  ];
}

export function fieldNotesBlocks(): BlockSpec[] {
  return [
    {
      type: "paragraph",
      md: "The kettle took longer than usual. Outside, the street was the color of wet slate and nobody seemed in a hurry.",
    },
    { type: "heading", props: { level: 3 }, md: "Noticed" },
    { type: "bulleted", md: "Two magpies on the aerial, arguing about something important." },
    { type: "bulleted", md: "The bakery switched to rye on Thursdays. Worth remembering." },
    { type: "bulleted", md: "Light through the kitchen blind makes a perfect index of lines on the table." },
    { type: "heading", props: { level: 3 }, md: "A thought to come back to" },
    {
      type: "paragraph",
      md: "Most good ideas arrive half-finished. The trick is to give them somewhere to wait that is not the back of my mind.",
    },
    { type: "quote", md: "Slow mornings make fast afternoons." },
    { type: "todo", props: { checked: false }, md: "Ask Mira about the rye starter" },
  ];
}

export function atlasBriefBlocks(today: string): BlockSpec[] {
  return [
    { type: "callout", props: { tone: "note" }, md: "**Goal:** a lightweight field guide app for the city's community gardens, ready for the spring planting season." },
    { type: "heading", props: { level: 2 }, md: "Why now" },
    {
      type: "paragraph",
      md: "Garden coordinators keep plot maps, watering rotas and seed swaps in five different places. Volunteers miss updates. Atlas brings the essentials into one calm, printable guide.",
    },
    { type: "heading", props: { level: 2 }, md: "Scope" },
    { type: "numbered", md: "Plot map with who tends what" },
    { type: "numbered", md: "Watering rota with reminders" },
    { type: "numbered", md: "Seed library: what is available and where" },
    { type: "heading", props: { level: 2 }, md: "Milestones" },
    {
      type: "table",
      props: {
        headerRow: true,
        rows: [
          [[{ type: "text", text: "Milestone" }], [{ type: "text", text: "Owner" }], [{ type: "text", text: "Target" }]],
          [[{ type: "text", text: "Interview five coordinators" }], [{ type: "text", text: "Priya" }], [{ type: "date", date: addDays(today, 7) }]],
          [[{ type: "text", text: "Paper prototype of the plot map" }], [{ type: "text", text: "Tomás" }], [{ type: "date", date: addDays(today, 14) }]],
          [[{ type: "text", text: "Pilot at Ashgrove Gardens" }], [{ type: "text", text: "Priya & Tomás" }], [{ type: "date", date: addDays(today, 35) }]],
        ],
      },
    },
    { type: "heading", props: { level: 2 }, md: "Next steps" },
    { type: "todo", props: { checked: false, dueDate: addDays(today, 2), priority: "high" }, md: "Draft interview questions" },
    { type: "todo", props: { checked: false, dueDate: addDays(today, 4) }, md: "Book the community hall for the kickoff" },
    { type: "todo", props: { checked: false }, md: "Collect three example plot maps" },
    { type: "heading", props: { level: 2 }, md: "Risks" },
    { type: "bulleted", md: "Coordinators have little time in peak season — keep interviews to 20 minutes." },
    { type: "bulleted", md: "Many volunteers share one phone; printable views matter as much as the app." },
  ];
}

export function atlasQuestionsBlocks(): BlockSpec[] {
  return [
    { type: "paragraph", md: "Questions we have not answered yet. Move them into the brief once they have an owner." },
    { type: "bulleted", md: "Do gardens want public maps, or members-only?" },
    { type: "bulleted", md: "Who approves changes to the watering rota?" },
    { type: "bulleted", md: "Can the seed library work offline at the garden shed?" },
  ];
}

export function tripSketchBlocks(today: string): BlockSpec[] {
  const fri = addDays(today, 12);
  const sat = addDays(today, 13);
  const sun = addDays(today, 14);
  return [
    {
      type: "paragraph",
      text: [
        { type: "text", text: "A long weekend on the coast, leaving " },
        { type: "date", date: fri },
        { type: "text", text: " and back by " },
        { type: "date", date: sun },
        { type: "text", text: "." },
      ],
    },
    { type: "heading", props: { level: 2 }, md: "Before we go" },
    { type: "todo", props: { checked: false, dueDate: addDays(today, 3), priority: "high" }, md: "Book the ferry for Friday morning" },
    { type: "todo", props: { checked: false, dueDate: addDays(today, 6) }, md: "Confirm the cottage key pickup" },
    { type: "todo", props: { checked: false, dueDate: addDays(today, 10), dueTime: "18:00" }, md: "Pack the tide book and binoculars" },
    { type: "heading", props: { level: 2 }, md: "Loose plan" },
    {
      type: "table",
      props: {
        headerRow: true,
        rows: [
          [[{ type: "text", text: "Day" }], [{ type: "text", text: "Morning" }], [{ type: "text", text: "Evening" }]],
          [[{ type: "date", date: fri }], [{ type: "text", text: "Ferry across, coffee on the quay" }], [{ type: "text", text: "Fish supper, early night" }]],
          [[{ type: "date", date: sat }], [{ type: "text", text: "Lighthouse walk at low tide" }], [{ type: "text", text: "Harbor concert" }]],
          [[{ type: "date", date: sun }], [{ type: "text", text: "Rock pools" }], [{ type: "text", text: "Ferry home" }]],
        ],
      },
    },
    { type: "heading", props: { level: 2 }, md: "Packing" },
    {
      type: "toggle",
      props: { collapsed: false },
      md: "Bag",
      children: [
        { type: "todo", props: { checked: false }, md: "Wool socks" },
        { type: "todo", props: { checked: false }, md: "Rain shell" },
        { type: "todo", props: { checked: true }, md: "Notebook" },
      ],
    },
    { type: "callout", props: { tone: "warning" }, md: "The last ferry back leaves at 21:00 on Sundays." },
  ];
}

export function weeklyResetBlocks(): BlockSpec[] {
  return [
    { type: "paragraph", md: "Thirty quiet minutes to close last week and open the next." },
    { type: "heading", props: { level: 2 }, md: "Look back" },
    { type: "bulleted", md: "What went well?" },
    { type: "bulleted", md: "What felt heavier than it should have?" },
    { type: "heading", props: { level: 2 }, md: "Clear the decks" },
    { type: "todo", props: { checked: false }, md: "Empty the Tasks inbox" },
    { type: "todo", props: { checked: false }, md: "Archive finished documents" },
    { type: "todo", props: { checked: false }, md: "Skim last week's notes" },
    { type: "heading", props: { level: 2 }, md: "Plan the week" },
    { type: "numbered", md: "The one thing that matters most" },
    { type: "numbered", md: "Two things that would be nice" },
    { type: "heading", props: { level: 2 }, md: "Notes" },
    { type: "paragraph", md: "" },
  ];
}

export const READING_SHELF = {
  title: "Reading Shelf",
  intro: "Books in progress, books waiting, books finished. Switch views with the tabs above the table.",
  properties: [
    { key: "author", name: "Author", type: "text" as const },
    {
      key: "status",
      name: "Status",
      type: "select" as const,
      options: [
        { id: "to-read", name: "To read", color: "plum" },
        { id: "reading", name: "Reading", color: "marigold" },
        { id: "finished", name: "Finished", color: "moss" },
      ],
    },
    { key: "rating", name: "Rating", type: "number" as const },
    { key: "started", name: "Started", type: "date" as const },
    {
      key: "format",
      name: "Format",
      type: "multiSelect" as const,
      options: [
        { id: "paper", name: "Paper", color: "coral" },
        { id: "ebook", name: "E-book", color: "accent" },
        { id: "audio", name: "Audio", color: "moss" },
      ],
    },
    { key: "link", name: "Link", type: "url" as const },
  ],
  rows: [
    { title: "The Cartographer's Almanac", author: "Inès Varga", status: "reading", rating: 4, started: -9, format: ["paper"], link: "https://example.com/almanac" },
    { title: "Salt and Signal", author: "Theo Ashdown", status: "finished", rating: 5, started: -40, format: ["ebook"] },
    { title: "Small Rooms, Long Summers", author: "Maren Holt", status: "to-read", format: ["paper", "audio"] },
    { title: "Notes from the Allotment", author: "Duc Pham", status: "to-read", format: ["paper"] },
    { title: "A Grammar of Tides", author: "Oyelaran Bello", status: "finished", rating: 4, started: -75, format: ["audio"] },
  ],
};
