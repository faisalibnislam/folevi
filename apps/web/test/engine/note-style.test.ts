// Revision 22: the note's Style tool and comments for the native apps (src/lib/engine/noteStyle.ts and
// commandsComments.ts): what the Style tool shows for a note, and the comment commands' refusals.
import { describe, expect, it } from "vitest";
import { noteStyleValue } from "@/lib/engine/noteStyle";
import { COMMENT_COMMANDS } from "@/lib/engine/commandsComments";
import { BridgeError } from "@/lib/engine/validate";

const doc = (over: Record<string, unknown> = {}) => ({
  document: { id: "doc_1", revision: 3, cover: { kind: "none" }, style: { font: "serif", width: "default", background: "none", accent: "accent", card: "plain" }, ...over },
  access: "manage",
  inTrash: false,
});

describe("note.style", () => {
  it("a plain note: Plain, no backdrop, the standard colours, every choice offered", () => {
    const v = noteStyleValue(doc() as never, null);
    expect(v).toMatchObject({ found: true, canEdit: true, current: "plain", styleName: "Plain", themeId: null, ownImage: false, hasBackdrop: false, sheet: null, text: null, font: "serif", separator: "line", width: "default" });
    expect(v.sheets.map((s) => s.id)).toContain("night");
    expect(v.separators.map((s) => s.id)).toEqual(["line", "dots", "doodle"]);
  });

  it("chosen colours and a read-only note", () => {
    const v = noteStyleValue({ ...doc({ style: { font: "mono", width: "wide", background: "none", accent: "accent", card: "plain", sheet: "night", text: "white", separator: "dots" } }), access: "read" } as never, null);
    expect(v).toMatchObject({ canEdit: false, sheet: "night", text: "white", sheetColor: "#161618", textColor: "#f2f2f4", font: "mono", width: "wide", separator: "dots" });
  });

  it("a note that isn't there", () => {
    expect(noteStyleValue(null, null)).toMatchObject({ found: false, canEdit: false });
  });
});

describe("comment commands", () => {
  it("need an account", async () => {
    const deps = { app: { mode: "local", outbox: null } } as never;
    await expect(COMMENT_COMMANDS["comment.create"].run(deps, { noteId: "doc_1", text: "Hi" })).rejects.toBeInstanceOf(BridgeError);
  });

  it("go through the outbox", async () => {
    const queued: string[] = [];
    const deps = { app: { mode: "account", outbox: { enqueue: (name: string) => queued.push(name) } } } as never;
    const made = await COMMENT_COMMANDS["comment.create"].run(deps, { noteId: "doc_1", text: " Looks good " });
    expect(made.threadId).toBeTruthy();
    await COMMENT_COMMANDS["comment.reply"].run(deps, { threadId: made.threadId, text: "Thanks" });
    await COMMENT_COMMANDS["comment.resolve"].run(deps, { threadId: made.threadId, resolved: true });
    await COMMENT_COMMANDS["comment.read"].run(deps, { threadId: made.threadId, read: false });
    await COMMENT_COMMANDS["comment.deleteThread"].run(deps, { threadId: made.threadId });
    expect(queued).toEqual(["comments.create", "comments.reply", "comments.setResolved", "comments.markThreadUnread", "comments.deleteThread"]);
    await expect(COMMENT_COMMANDS["comment.reply"].run(deps, { threadId: made.threadId, text: "   " })).rejects.toBeInstanceOf(BridgeError);
  });
});
