import type { WireBlock } from "@folevi/editor-schema";
import { specsToWireBlocks, type BlockSpec } from "./create";
import { weeklyResetBlocks } from "./seedContent";

/** Built-in, immutable starter templates. Admins can enable/disable them (builtInTemplates table). */
export const BUILT_IN_TEMPLATES: { key: string; name: string; description: string; icon: string; blocks: () => BlockSpec[] }[] = [
  {
    key: "daily-page",
    name: "Daily Page",
    description: "A light structure for a day: intentions, notes and a short look back.",
    icon: "☀️",
    blocks: () => [
      { type: "heading", props: { level: 3 }, md: "Intentions" },
      { type: "todo", props: { checked: false }, md: "" },
      { type: "heading", props: { level: 3 }, md: "Notes" },
      { type: "paragraph", md: "" },
      { type: "heading", props: { level: 3 }, md: "Looking back" },
      { type: "paragraph", md: "" },
    ],
  },
  {
    key: "meeting-notes",
    name: "Meeting Notes",
    description: "Agenda, decisions and follow-ups that turn into tasks.",
    icon: "🗒",
    blocks: () => [
      { type: "callout", props: { tone: "note" }, md: "**When:** · **Who:**" },
      { type: "heading", props: { level: 2 }, md: "Agenda" },
      { type: "numbered", md: "" },
      { type: "heading", props: { level: 2 }, md: "Decisions" },
      { type: "bulleted", md: "" },
      { type: "heading", props: { level: 2 }, md: "Follow-ups" },
      { type: "todo", props: { checked: false }, md: "" },
    ],
  },
  {
    key: "project-brief",
    name: "Project Brief",
    description: "Goal, scope, milestones and risks on one page.",
    icon: "🧭",
    blocks: () => [
      { type: "callout", props: { tone: "info" }, md: "**Goal:** " },
      { type: "heading", props: { level: 2 }, md: "Why now" },
      { type: "paragraph", md: "" },
      { type: "heading", props: { level: 2 }, md: "Scope" },
      { type: "bulleted", md: "" },
      { type: "heading", props: { level: 2 }, md: "Milestones" },
      {
        type: "table",
        props: {
          headerRow: true,
          rows: [
            [[{ type: "text", text: "Milestone" }], [{ type: "text", text: "Owner" }], [{ type: "text", text: "Target" }]],
            [[], [], []],
          ],
        },
      },
      { type: "heading", props: { level: 2 }, md: "Risks" },
      { type: "bulleted", md: "" },
    ],
  },
  {
    key: "weekly-reset",
    name: "Weekly Reset",
    description: "Close last week and open the next in thirty quiet minutes.",
    icon: "🔁",
    blocks: weeklyResetBlocks,
  },
  {
    key: "reading-notes",
    name: "Reading Notes",
    description: "Quotes, ideas and questions from something you are reading.",
    icon: "📖",
    blocks: () => [
      { type: "callout", props: { tone: "note" }, md: "**Author:** · **Started:**" },
      { type: "heading", props: { level: 2 }, md: "Big ideas" },
      { type: "bulleted", md: "" },
      { type: "heading", props: { level: 2 }, md: "Quotes" },
      { type: "quote", md: "" },
      { type: "heading", props: { level: 2 }, md: "Questions" },
      { type: "bulleted", md: "" },
    ],
  },
];

export function builtInTemplateBlocks(key: string): WireBlock[] | null {
  const t = BUILT_IN_TEMPLATES.find((x) => x.key === key);
  return t ? specsToWireBlocks(t.blocks()) : null;
}
