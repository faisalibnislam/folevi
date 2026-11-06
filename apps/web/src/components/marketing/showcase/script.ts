// The showcase's chapters, played in the Mac frame on the real app (driver.ts), with the iPhone frame showing the
// same notes: it opens the page the Mac is on and picks up each change from the shared library, as sync would.
// Every chapter first puts its notes back the way it starts (so the loop can run forever), then plays at about a
// person's pace, 8 to 10 seconds. `still` shows a chapter's end without playing it (reduced motion).
import type { Editor } from "@tiptap/core";
import type { InlineNode } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { localLibrary } from "@/lib/local";
import { replaceEntry, startHistoryNav } from "@/lib/app/historyNav";
import { asSam, SAM_SESSION } from "./collab";
import { IDS } from "./seed";
import { SHOWCASE_QUESTION } from "./ai";
import { prepareShowcaseVault, SHOWCASE_PASSCODE } from "./vault";
import { vaultSessions } from "@/lib/vault/keys";
import { byText, Caret, check, click, editorKey, fireClick, noteEditor, Pointer, pressKey, pretendFocus, sleep, Stopped, typeInEditor, typeInField, waitFor, type Ctx } from "./driver";

export type ChapterId = "write" | "together" | "tasks" | "board" | "ai" | "vault";

export interface ShowcaseFrame {
  device: "mac" | "phone";
  /** Resolves once the app is showing Home on the demo notes. */
  ready: Promise<void>;
  /** Opens a page without anyone clicking (the iPhone following the Mac). */
  go(path: string): void;
  play(chapter: ChapterId, o: { signal: AbortSignal; phone: ShowcaseFrame | null; still?: boolean }): Promise<void>;
}

declare global {
  interface Window {
    __foleviShowcase?: ShowcaseFrame;
    /** What went wrong in a chapter (for whoever is looking: the chapter goes on to the next). */
    __showcaseLog?: string[];
  }
}

const client = () => localLibrary().client;

/** Opens a page in place (no history entry: the frame's history is the visitor's page's too). */
function go(path: string): void {
  startHistoryNav();
  replaceEntry(path);
}

const text = (s: string): InlineNode[] => (s ? [{ type: "text", text: s }] : []);

/** Spring launch as the first chapter leaves it. */
const TABLE_ROWS = [
  ["Task", "Owner", "Status"],
  ["Press kit", "Maya", "Done"],
  ["Launch post", "Sam", "Doing"],
  ["Pricing page", "Ines", "Doing"],
];
const INTRO = "Launch day is Thursday the 12th. Here's who does what.";
const SAM_LINE = "Press kit, launch post, pricing page.";

/** The main area fades while a chapter sets its page up, as a page change does. */
function hold(on: boolean): void {
  const main = document.getElementById("main");
  if (!main) return;
  main.style.transition = "opacity 180ms ease";
  main.style.opacity = on ? "0" : "1";
}

/**
 * Opens a note: already open, it stays; otherwise the pointer clicks its link in the sidebar (Bookmarks), or the
 * app goes there when no link shows. Then waits for its editor.
 */
async function openNote(ctx: Ctx, pointer: Pointer, id: string): Promise<Editor> {
  const path = `/d/${id}`;
  if (location.pathname !== path) {
    const link = [...document.querySelectorAll<HTMLAnchorElement>(`a[href="${path}"]`)].find((a) => a.getBoundingClientRect().width > 0);
    if (link) await click(ctx, pointer, link);
    else go(path);
  }
  return await waitFor(ctx, () => {
    const e = noteEditor();
    return e && !e.isDestroyed && location.pathname === path ? e : null;
  });
}

/** Opens an app page by its link in the sidebar (Home, Tasks, Calendar, Vault), or goes there. */
async function openPage(ctx: Ctx, pointer: Pointer, path: string): Promise<void> {
  if (location.pathname === path) return;
  const link = [...document.querySelectorAll<HTMLAnchorElement>(`nav a[href="${path}"], a[href="${path}"]`)].find((a) => a.getBoundingClientRect().width > 0);
  if (link) await click(ctx, pointer, link);
  else go(path);
  await waitFor(ctx, () => location.pathname === path);
}

/** The table block's node and position in the editor. */
function findTable(editor: Editor): { pos: number; attrs: Record<string, unknown> } | null {
  let found: { pos: number; attrs: Record<string, unknown> } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "table") found = { pos, attrs: node.attrs };
    return true;
  });
  return found;
}

function setRows(editor: Editor, rows: string[][]): void {
  const t = findTable(editor);
  if (!t) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(t.pos, undefined, { ...t.attrs, headerRow: true, rows: rows.map((r) => r.map((c) => text(c))) }));
}

/** Spring launch with only its title (chapter 1's start). */
function emptyPage(editor: Editor): void {
  editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
}

/** Spring launch as chapter 1 leaves it (chapter 2's start). */
function writtenPage(editor: Editor): void {
  editor.commands.setContent({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: INTRO }] },
      { type: "table", attrs: { headerRow: true, rows: TABLE_ROWS.map((r) => r.map((c) => text(c))) } },
    ],
  });
}

/** Closes what the last chapter left open (the Foli AI chat), as a person would before moving on. */
function tidy(): void {
  for (const b of document.querySelectorAll<HTMLElement>('button[aria-label="Close chat"], button[aria-label="Close Foli AI"]')) if (b.getBoundingClientRect().width > 0) fireClick(b, 0, 0);
}

/** No comments on Spring launch yet. */
async function clearComments(): Promise<void> {
  for (const t of ((await client().query(api.comments.threads, { documentId: IDS.spring })) as { threads: { id: string }[] }).threads) await client().mutation(api.comments.deleteThread, { threadId: t.id });
}

// ---- the chapters -----------------------------------------------------------------------------------------

type Chapter = (ctx: Ctx, run: Run) => Promise<void>;
interface Run {
  pointer: Pointer;
  caret: Caret;
  phone: ShowcaseFrame | null;
  still: boolean;
}

const write: Chapter = async (ctx, { pointer, caret, phone, still }) => {
  hold(true);
  const editor = await openNote(ctx, pointer, IDS.spring);
  emptyPage(editor);
  await clearComments();
  phone?.go(`/d/${IDS.spring}`);
  hold(false);
  if (still) {
    writtenPage(editor);
    return;
  }
  await sleep(ctx, 300);
  // Click into the empty page and write.
  await click(ctx, pointer, editor.view.dom, [0.2, 0.12]);
  editor.commands.setTextSelection(1);
  pretendFocus(editor);
  caret.follow(editor);
  pointer.show(false);
  await typeInEditor(ctx, editor, INTRO);
  await sleep(ctx, 250);
  editorKey(editor, "Enter");
  await typeInEditor(ctx, editor, "/table");
  // The "/" menu: Simple table.
  const option = await waitFor(ctx, () => byText('[role="option"]', /^Simple table/));
  await sleep(ctx, 350);
  await click(ctx, pointer, option, [0.3, 0.5]);
  caret.follow(null);
  await waitFor(ctx, () => findTable(editor));
  // Fill the table, cell by cell.
  const rows = TABLE_ROWS.map((r) => r.map(() => ""));
  for (const [r, row] of TABLE_ROWS.entries()) {
    for (const [c, cell] of row.entries()) {
      for (const ch of cell) {
        check(ctx);
        rows[r]![c] += ch;
        setRows(editor, rows);
        await sleep(ctx, 34);
      }
      await sleep(ctx, 90);
    }
  }
  // Done: the caret moves on past the table, so its row and column handles go away.
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  pointer.show(false);
  await sleep(ctx, 1200);
};

const together: Chapter = async (ctx, { pointer, caret, phone, still }) => {
  hold(true);
  const editor = await openNote(ctx, pointer, IDS.spring);
  writtenPage(editor);
  await clearComments();
  phone?.go(`/d/${IDS.spring}`);
  hold(false);
  // Sam opens the page: his picture joins Maya's.
  await sleep(ctx, still ? 0 : 500);
  await client().mutation(api.presence.heartbeat, { documentId: IDS.spring, sessionId: SAM_SESSION });
  await sleep(ctx, still ? 0 : 700);
  // He writes a line under the table, his caret moving as he types.
  const end = editor.state.doc.content.size;
  editor.view.dispatch(editor.state.tr.insert(end, editor.schema.nodes.paragraph!.create()));
  const at = editor.state.doc.content.size - 1;
  editor.commands.setTextSelection(at);
  const blockId = () => (editor.state.selection.$head.parent.attrs as { id?: string }).id ?? "";
  if (still) editor.view.dispatch(editor.state.tr.insertText(SAM_LINE, at));
  else {
    let offset = 0;
    for (const ch of SAM_LINE) {
      check(ctx);
      editor.view.dispatch(editor.state.tr.insertText(ch, at + offset));
      offset += 1;
      if (offset % 3 === 0 || offset === SAM_LINE.length) {
        const point = { blockId: blockId(), offset };
        void client().mutation(api.presence.setCursor, { documentId: IDS.spring, sessionId: SAM_SESSION, cursor: { anchor: point, head: point } });
      }
      await sleep(ctx, 55);
    }
  }
  // Maya comments on the intro, for Sam.
  const intro = editor.view.dom.querySelector("p") ?? editor.view.dom;
  editor.commands.setTextSelection({ from: 1, to: 1 + INTRO.length });
  pretendFocus(editor);
  const firstBlock = (editor.state.doc.firstChild?.attrs as { id?: string } | undefined)?.id ?? null;
  const ask = "Sam, can the embargo lift at 9am on the 12th?";
  const body: InlineNode[] = text(ask);
  if (!still) {
    await click(ctx, pointer, intro, [0.5, 0.5]);
    const button = await waitFor(ctx, () => byText("button", "Comments"));
    await click(ctx, pointer, button);
    const composer = await waitFor(ctx, () => document.querySelector<HTMLTextAreaElement>('aside textarea, [role="complementary"] textarea, textarea[placeholder*="omment"]'), 2500).catch(() => null);
    if (composer) {
      await typeInField(ctx, composer, ask);
      await sleep(ctx, 250);
      pressKey(composer, "Enter");
    } else await client().mutation(api.comments.create, { documentId: IDS.spring, blockId: firstBlock ?? undefined, body });
  } else await client().mutation(api.comments.create, { documentId: IDS.spring, blockId: firstBlock ?? undefined, body });
  await sleep(ctx, still ? 0 : 1300);
  // Sam answers.
  const thread = ((await client().query(api.comments.threads, { documentId: IDS.spring })) as { threads: { id: string }[] }).threads[0];
  if (thread) await asSam(() => client().mutation(api.comments.reply, { threadId: thread.id, body: text("Yes, 9am works. I'll schedule the launch post for then.") }));
  caret.follow(null);
  // Maya opens the thread to read it.
  const replies = await waitFor(ctx, () => {
    const label = byText("span", /^1 reply$/);
    return label ? (label.closest<HTMLElement>("button, [role=button], a, li") ?? label) : null;
  }, 2500).catch(() => null);
  if (replies && !still) {
    await sleep(ctx, 500);
    await click(ctx, pointer, replies);
  } else if (replies) fireClick(replies, 0, 0);
  pointer.show(false);
  await sleep(ctx, still ? 0 : 2200);
  void client().mutation(api.presence.leave, { documentId: IDS.spring, sessionId: SAM_SESSION });
};

const tasks: Chapter = async (ctx, { pointer, phone, still }) => {
  // The press kit isn't sent yet.
  await setPressKit(false);
  phone?.go("/tasks/all");
  await openPage(ctx, pointer, "/tasks/today");
  // All of this week's tasks, with their dates.
  const all = await waitFor(ctx, () => byText("main button, main a, main [role=tab]", /^All\s*\d*$/));
  await sleep(ctx, still ? 0 : 400);
  await click(ctx, pointer, all);
  const row = await waitFor(ctx, () => [...document.querySelectorAll<HTMLElement>("main li, main [role=listitem], main [data-task]")].find((el) => /Send the press kit/.test(el.innerText)));
  const box = row.querySelector<HTMLElement>('[role="checkbox"], input[type="checkbox"], button[aria-label*="omplete"], button[aria-label*="Mark"]');
  await sleep(ctx, still ? 0 : 1500);
  if (box) await click(ctx, pointer, box);
  else await setPressKit(true);
  await sleep(ctx, still ? 0 : 1600);
  await openPage(ctx, pointer, "/calendar");
  phone?.go("/calendar");
  pointer.show(false);
  await sleep(ctx, still ? 0 : 2400);
};

/** Ticks or unticks the press kit to-do (through the library, so both devices see it). */
async function setPressKit(checked: boolean): Promise<void> {
  await client().mutation(api.tasks.update, { blockId: IDS.pressKitTask, checked });
}

/** Sets the Launch video row's status (ideas, doing, done). */
async function setLaunchVideo(status: string): Promise<void> {
  const c = (await client().query(api.collections.get, { collectionId: IDS.collection })) as { properties: { id: string; name: string }[]; rows: { id: string; documentId: string; values: Record<string, unknown> }[] };
  const prop = c.properties.find((p) => p.name === "Status");
  const row = c.rows.find((r) => r.documentId === IDS.launchVideo);
  if (!prop || !row || row.values[prop.id] === status) return;
  await client().mutation(api.collections.setValue, { collectionId: IDS.collection, rowId: row.id, propertyId: prop.id, value: status });
}

const board: Chapter = async (ctx, { pointer, phone, still }) => {
  hold(true);
  await openNote(ctx, pointer, IDS.contentPlan);
  phone?.go(`/d/${IDS.contentPlan}`);
  hold(false);
  const region = await waitFor(ctx, () => document.getElementById("main"));
  await waitFor(ctx, () => byText("button", /^Board$/, region));
  // Back to the table first.
  const tableTab = byText('[role="tab"], [role="radio"], button', /^Table$/, region);
  if (tableTab && tableTab.getAttribute("aria-selected") !== "true") fireClick(tableTab, 0, 0);
  await sleep(ctx, still ? 0 : 1600);
  // Launch video starts among the ideas.
  await setLaunchVideo("ideas");
  const boardTab = await waitFor(ctx, () => byText('[role="tab"], [role="radio"], button', /^Board$/, region));
  await click(ctx, pointer, boardTab);
  pointer.show(false);
  await sleep(ctx, still ? 0 : 1800);
  // Sam starts on the launch video: its card moves to Doing, here and on the iPhone.
  await setLaunchVideo("doing");
  await sleep(ctx, still ? 0 : 2600);
};

const ai: Chapter = async (ctx, { pointer, phone, still }) => {
  await openPage(ctx, pointer, "/documents");
  phone?.go("/documents");
  const open = await waitFor(ctx, () => byText("button", /^Ask Foli AI$/));
  await sleep(ctx, still ? 0 : 500);
  await click(ctx, pointer, open);
  const box = await waitFor(ctx, () => [...document.querySelectorAll<HTMLTextAreaElement>("textarea")].find((t) => /^Ask anything/.test(t.placeholder) && t.getBoundingClientRect().width > 0));
  await click(ctx, pointer, box);
  pointer.show(false);
  await typeInField(ctx, box, SHOWCASE_QUESTION);
  await sleep(ctx, 250);
  pressKey(box, "Enter");
  await sleep(ctx, still ? 0 : 4200);
};

const vault: Chapter = async (ctx, { pointer, phone, still }) => {
  // Locked, as it is whenever nobody's using it.
  const vaultId = await prepareShowcaseVault();
  if (vaultId && vaultSessions().isOpen(vaultId)) await vaultSessions().lock(vaultId, "manual");
  await openPage(ctx, pointer, "/vault");
  phone?.go("/vault");
  const field = await waitFor(ctx, () => [...document.querySelectorAll<HTMLInputElement>("main input")].find((i) => /passcode/i.test(`${i.getAttribute("aria-label") ?? ""} ${i.labels?.[0]?.textContent ?? ""} ${i.placeholder}`) && i.getBoundingClientRect().width > 0));
  await sleep(ctx, still ? 0 : 400);
  await click(ctx, pointer, field);
  pointer.show(false);
  await typeInField(ctx, field, SHOWCASE_PASSCODE);
  await sleep(ctx, 200);
  const unlock = byText("main button", /^(Unlock|Open)/);
  if (unlock) await click(ctx, pointer, unlock);
  else pressKey(field, "Enter");
  // The passwords, once the passcode has opened the Vault's key.
  const passwords = await waitFor(ctx, () => byText("main button, main [role=tab], main a", /Passwords/), 8000);
  await sleep(ctx, still ? 0 : 500);
  await click(ctx, pointer, passwords);
  const item = await waitFor(ctx, () => byText("main a, main button, main [role=row], main li", /^Studio website/), 4000);
  await sleep(ctx, still ? 0 : 900);
  await click(ctx, pointer, item);
  pointer.show(false);
  await sleep(ctx, still ? 0 : 3200);
};

const CHAPTERS: Record<ChapterId, Chapter> = { write, together, tasks, board, ai, vault };

/** Starts the showcase's side of this frame. */
export function startShowcaseFrame(device: "mac" | "phone"): ShowcaseFrame {
  let pointer: Pointer | null = null;
  let caret: Caret | null = null;
  const ready = (async () => {
    const ctx: Ctx = { signal: new AbortController().signal, speed: 1 };
    await waitFor(ctx, () => document.getElementById("main") && document.querySelector("nav, [data-iphone-tabbar], main"), 30_000);
    // The Mac hosts the library: the demo Vault is made there, ahead of its chapter.
    if (device === "mac") void prepareShowcaseVault();
  })();
  const frame: ShowcaseFrame = {
    device,
    ready,
    go,
    async play(chapter, o) {
      await ready;
      pointer ??= new Pointer(device === "phone");
      caret ??= new Caret();
      const ctx: Ctx = { signal: o.signal, speed: o.still ? 40 : 1 };
      try {
        tidy();
        await CHAPTERS[chapter](ctx, { pointer, caret, phone: o.phone, still: Boolean(o.still) });
      } catch (e) {
        if (!(e instanceof Stopped)) {
          console.warn(`[showcase] ${chapter}:`, e);
          (window.__showcaseLog ??= []).push(`${chapter}: ${(e as Error).message}`);
        }
      } finally {
        caret.follow(null);
        pointer.show(false);
        hold(false);
      }
    },
  };
  window.__foleviShowcase = frame;
  // Development: the library and its functions, for looking at what a chapter did.
  if (process.env.NODE_ENV !== "production") Object.assign(window, { __showcaseDebug: { client, api } });
  return frame;
}
