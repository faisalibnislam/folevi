// The showcase's demo workspace, "Studio": Maya Patel's notes for a spring launch, as the home page shows them
// (DeviceShowcase). It's made in the library's setup mutation (lib/local/setup.ts setLocalSeeder), in memory,
// so every visit starts from the same notes. The pages the chapters write on start empty or short: the
// chapters type the rest on camera (script.ts).
import { rankSequence, specsToWireBlocks, ulid, type BlockSpec, type DocumentStyle } from "@folevi/editor-schema";
import type { LocalMutationCtx } from "@/lib/local/registry";
import type { LocalDocument, LocalFolder } from "@/lib/local/store";
import { PROFILE_KEY, insertDocument, type LocalProfile } from "@/lib/local/functions/shared";
import { nextFolderOrdinal } from "@/lib/local/functions/organization";
import { addView, createCollection, putRow } from "@/lib/local/functions/collections";
import { allThemes, applyThemeDefaults, type ThemeDefaults } from "@/lib/themes";

/** The ids the chapters find things by (fixed, so the driver knows them without asking). */
export const IDS = {
  spring: "showcase-spring-launch",
  contentPlan: "showcase-content-plan",
  launchWeek: "showcase-launch-week",
  collection: "showcase-content-collection",
  tableView: "showcase-view-table",
  boardView: "showcase-view-board",
  launchVideo: "showcase-row-launch-video",
  /** The to-do the Tasks chapter ticks off. */
  pressKitTask: "showcase-task-press-kit",
} as const;
export const MAYA_AVATAR = "/marketing/showcase/people/maya.jpg";
export const SAM_AVATAR = "/marketing/showcase/people/sam.jpg";

const BASE: DocumentStyle = { font: "serif", width: "wide", background: "paper", accent: "accent", card: "folio" };

/** A note theme by its name, as the Style panel sets it: the artwork, and the style it decides. */
function themed(name: string): { cover: LocalDocument["cover"]; style: DocumentStyle } {
  const t = allThemes().find((x) => x.name === name);
  if (!t) return { cover: { kind: "none" }, style: BASE };
  return { cover: { kind: "art", value: t.id }, style: applyThemeDefaults({ ...BASE }, t.defaults as ThemeDefaults) };
}

const lines = (...md: string[]): BlockSpec[] => md.map((m) => ({ type: "paragraph", md: m }));

function addDays(today: string, days: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function seedStudio(ctx: LocalMutationCtx, today: string, profile: LocalProfile): Promise<void> {
  const now = ctx.now();
  ctx.db.put("meta", PROFILE_KEY, { ...profile, displayName: "Maya Patel", avatarUrl: MAYA_AVATAR });

  // Folders, in the sidebar's order.
  const ranks = rankSequence(5);
  const folder = async (name: string, color: string, rank: string, parentFolderId: string | null = null): Promise<LocalFolder> => {
    const f: LocalFolder = { id: ulid(), name, color, parentFolderId, rank, createdAt: now, ordinal: await nextFolderOrdinal(ctx), updatedAt: now, deletedAt: null };
    ctx.db.put("folders", f.id, f);
    return f;
  };
  const springF = await folder("Spring launch", "coral", ranks[0]!);
  const contentF = await folder("Content plan", "blue", ranks[1]!);
  const wiki = await folder("Team wiki", "green", ranks[2]!);
  const onboardingF = await folder("Onboarding", "emerald", rankSequence(1)[0]!, wiki.id);
  const personal = await folder("Personal", "pink", ranks[3]!);

  const note = async (title: string, folderId: string, theme: string | null, body: BlockSpec[], icon = "📄", id?: string) => {
    const look = theme ? themed(theme) : { cover: undefined, style: undefined };
    return await insertDocument(ctx, { ...(id ? { id } : {}), title, icon, folderId, ...(look.cover ? { cover: look.cover } : {}), ...(look.style ? { style: look.style } : {}), blocks: specsToWireBlocks(body) });
  };
  let stars = 0;
  const star = (doc: LocalDocument) => {
    stars += 1;
    ctx.db.put("documents", doc.id, { ...doc, starred: true, starOrder: stars });
    ctx.db.put("meta", "starOrder", stars);
  };

  // Lived-in notes first (Home lists the newest first).
  await note("Reading list", personal.id, "Poppy print", lines("Books for the autumn:", "The Creative Act by Rick Rubin", "Four Thousand Weeks by Oliver Burkeman", "Tomorrow, and Tomorrow, and Tomorrow"), "📚");
  await note("Weekly review", personal.id, "Summer sky", lines("Wins: press kit is done and the pricing page draft is in.", "Next week: launch on Thursday, then a quiet Friday.", "Remember: thank-you notes to the beta testers."), "🗓️");
  await note("Release checklist", wiki.id, "Harbor blue", [{ type: "paragraph", md: "Before every release:" }, { type: "todo", props: { checked: true }, md: "Changelog written and reviewed" }, { type: "todo", props: { checked: false }, md: "Screenshots updated" }, { type: "todo", props: { checked: false }, md: "Support team briefed" }], "✅");
  await note("How we write", wiki.id, "Parchment", lines("Short sentences. Plain words. One idea per paragraph.", "Write for the reader who is in a hurry: lead with what changed and why it matters."), "✍️");
  await note("Onboarding", onboardingF.id, "Blossoms", lines("Welcome to Studio! Your first week, step by step.", "Day one: laptop, accounts and a coffee with your buddy.", "Day two: read How we write and the Release checklist."), "👋");

  // This week's tasks, with their dates (Tasks and the calendar read them).
  const weekBlocks = specsToWireBlocks([
    { type: "paragraph", md: "Everything that has to happen before Thursday." },
    { type: "todo", props: { checked: false, dueDate: today, priority: "high" }, md: "Send the press kit" },
    { type: "todo", props: { checked: false, dueDate: addDays(today, 1) }, md: "Review the launch post" },
    { type: "todo", props: { checked: false, dueDate: addDays(today, 2) }, md: "Publish the pricing page" },
    { type: "todo", props: { checked: false, dueDate: addDays(today, 4) }, md: "Thank-you notes to beta testers" },
  ]);
  weekBlocks[1]!.id = IDS.pressKitTask;
  await insertDocument(ctx, { id: IDS.launchWeek, title: "Launch week", icon: "🚀", folderId: springF.id, blocks: weekBlocks });

  // The Content plan: a collection seen as a table and as a board by status.
  const contentPlan = await note("Content plan", contentF.id, "Harbor blue", lines("What we publish around the launch, and who owns it."), "🗂️", IDS.contentPlan);
  const { collection, propertyIds } = await createCollection(ctx, {
    id: IDS.collection,
    documentId: contentPlan.id,
    name: "Content plan",
    seq: contentPlan.seq,
    properties: [
      { key: "status", name: "Status", type: "select", options: [ { id: "ideas", name: "Ideas", color: "plum" }, { id: "doing", name: "Doing", color: "marigold" }, { id: "done", name: "Done", color: "moss" } ] },
      { key: "owner", name: "Owner", type: "text" },
      { key: "type", name: "Type", type: "select", options: [ { id: "blog", name: "Blog", color: "accent" }, { id: "email", name: "Email", color: "coral" }, { id: "video", name: "Video", color: "moss" } ] },
      { key: "due", name: "Due", type: "date" },
    ],
  });
  const viewRanks = rankSequence(2);
  const all = ["status", "owner", "type", "due"].map((k) => propertyIds.get(k)!);
  const tableView = addView(ctx, collection, { id: IDS.tableView, name: "Table", type: "table", visibleProperties: all, rank: viewRanks[0]! });
  addView(ctx, collection, { id: IDS.boardView, name: "Board", type: "board", groupBy: propertyIds.get("status"), visibleProperties: [propertyIds.get("owner")!, propertyIds.get("type")!], rank: viewRanks[1]! });
  ctx.db.put("collections", collection.id, collection);
  const rows: Array<[string, string, string, string, number]> = [
    ["Launch post", "doing", "Sam", "blog", 3],
    ["Press kit email", "done", "Maya", "email", 0],
    ["Pricing page story", "doing", "Ines", "blog", 2],
    ["Launch video", "ideas", "Sam", "video", 6],
    ["April newsletter", "ideas", "Maya", "email", 9],
    ["Customer stories", "done", "Ines", "blog", -2],
  ];
  const rowRanks = rankSequence(rows.length);
  for (const [i, [title, status, owner, type, due]] of rows.entries()) {
    const row = await insertDocument(ctx, { ...(title === "Launch video" ? { id: IDS.launchVideo } : {}), title, icon: "📝", kind: "collectionRow", parentDocumentId: contentPlan.id, collectionId: collection.id, blocks: [] });
    putRow(ctx, row, {
      id: ulid(),
      collectionId: collection.id,
      rank: rowRanks[i]!,
      values: { [propertyIds.get("status")!]: status, [propertyIds.get("owner")!]: owner, [propertyIds.get("type")!]: type, [propertyIds.get("due")!]: addDays(today, due) },
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
  const id = ulid();
  const first = (await ctx.db.list("blocks", contentPlan.id))[0];
  ctx.db.put(
    "blocks",
    id,
    { id, documentId: contentPlan.id, parentId: null, rank: `${first?.rank ?? "V"}V`, type: "collection", schemaVersion: 1, text: [], props: { collectionId: collection.id, viewId: tableView }, revision: 1, contentRev: 1, positionRev: 1, seq: contentPlan.seq, deletedAt: null, createdAt: now, updatedAt: now },
    contentPlan.id,
  );

  // The page the first chapters write on: made last, so it's the newest note.
  const spring = await note("Spring launch", springF.id, "Irises", [], "🌷", IDS.spring);
  star(spring);
  star((await ctx.db.get("documents", contentPlan.id))!);

}
