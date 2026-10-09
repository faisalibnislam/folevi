// AI attachments and audio (convex/aiAttachments.ts, lib/ai/attachments.ts, docs/AI_ASSISTANT.md milestone
// 5): what the assistant can read and the limits, chat uploads (private to the uploader, claimed by their
// conversation, deleted with it), access checks before anything is read, inline images and PDFs, text
// files as text, unsupported files refused, the Settings switch, `calculate` with spreadsheet data,
// read_attachment for the agent, and transcription with its credits. Gemini is a stubbed `fetch`.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { attachmentKind, checkAttachment, checkInlineBudget, decodeText, htmlToText, toBase64 } from "../../convex/lib/ai/attachments";
import { cleanTranscript } from "../../convex/aiAttachments";
import { SCHEMA_VERSION } from "@folevi/editor-schema";
import { inWorkspace, join, person, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;
type Call = { name: string; args: Record<string, unknown> };
type Turn = { text?: string; calls?: Call[] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.GEMINI_API_KEY;
});

const USAGE = { promptTokenCount: 20_000, candidatesTokenCount: 400 };
const enc = new TextEncoder();
// A valid 1×1 PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const PDF = enc.encode("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04]);
const DOCX = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00, 0x00, 0x00, 0x21, 0x00]);

function reply(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: USAGE }), { status: 200 });
}

function streamed(text: string) {
  const half = Math.ceil(text.length / 2);
  const sse = [text.slice(0, half), text.slice(half)]
    .map((p, i) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: p }] }, ...(i === 1 ? { finishReason: "STOP" } : {}) }], usageMetadata: USAGE })}\r\n\r\n`)
    .join("");
  return new Response(sse, { status: 200 });
}

/** A model turn with function calls (each with a thought signature to send back). */
function modelTurn(turn: Turn) {
  const parts = [...(turn.text ? [{ text: turn.text }] : []), ...(turn.calls ?? []).map((c, i) => ({ functionCall: { name: c.name, args: c.args }, thoughtSignature: `sig-${i}` }))];
  return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata: USAGE }), { status: 200 });
}

/**
 * Stubs Gemini: streamed answers, a conversation title, transcripts, a file read for the agent, and
 * otherwise the next scripted model turn. Returns every request (url and body).
 */
function gemini(o: { answer?: string; transcript?: string; read?: string; turns?: Turn[] } = {}) {
  process.env.GEMINI_API_KEY = "test-key";
  const calls: { url: string; body: string }[] = [];
  const queue = [...(o.turns ?? [])];
  const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
    if (url.includes(":batchEmbedContents")) return new Response("{}", { status: 500 });
    calls.push({ url, body: init.body });
    if (url.includes("streamGenerateContent")) return streamed(o.answer ?? "The file covers the ferry times.");
    if (init.body.includes("You name conversations")) return reply("Ferry plans");
    if (init.body.includes("You transcribe recordings")) return reply(o.transcript ?? "Speaker 1: Book the ferry for Friday.");
    if (init.body.includes("You read files for an assistant")) return reply(o.read ?? "Ferry timetable: 9:00, 13:00.");
    return modelTurn(queue.shift() ?? { text: "Done." });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Uploads a file into a chat (the app's upload flow: intent, stored bytes, verified finalize). */
async function attach(t: T, p: Person, filename: string, bytes: Uint8Array, mimeType: string, scope = p.scope): Promise<string> {
  const { intentId } = await p.as.mutation(api.files.generateUploadUrl, { scope, filename, size: bytes.length, mimeType, kind: "attachment" });
  const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType })));
  return (await p.as.action(api.files.finalize, { intentId, storageId, sha256: await sha256(bytes) })).fileId;
}

/** A note with a file in it (as an uploaded file block would leave it). Returns the note's and file's ids. */
async function noteWithFile(t: T, p: Person, o: { filename: string; bytes: Uint8Array; mimeType: string; kind: "image" | "file" | "audio"; title?: string }) {
  const note = await p.as.mutation(api.documents.create, { scope: p.scope, title: o.title ?? "Trip" });
  const fileId = ulid();
  await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([o.bytes as Uint8Array<ArrayBuffer>], { type: o.mimeType }));
    const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", note.id)).unique())!;
    await ctx.db.insert("files", { publicId: fileId, storageId, ownerProfileId: doc.ownerProfileId, workspaceId: doc.workspaceId, documentId: doc._id, uploadedBy: doc.createdBy, filename: o.filename, mimeType: o.mimeType, size: o.bytes.length, sha256: "x", kind: o.kind, status: "ready", createdAt: Date.now() });
    const now = Date.now();
    await ctx.db.insert("blocks", { blockId: ulid(), documentId: doc._id, ownerProfileId: doc.ownerProfileId, workspaceId: doc.workspaceId, parentId: null, rank: "z", type: o.kind, schemaVersion: SCHEMA_VERSION, text: [], props: { fileId, name: o.filename }, revision: 1, contentRev: 1, positionRev: 1, seq: 1, createdAt: now, updatedAt: now, updatedBy: doc.createdBy });
  });
  return { noteId: note.id, fileId };
}

async function sendWith(p: Person, text: string, attachments: string[], o: { conversationId?: string; context?: { kind: "note"; ids: string[] } } = {}) {
  const conversationId = o.conversationId ?? ulid();
  const sent = await p.as.action(api.aiChat.send, { scope: p.scope, conversationId, text, attachments, context: o.context });
  const got = (await p.as.query(api.aiChat.get, { conversationId }))!;
  return { sent, conversationId, got, answer: got.messages.find((m) => m.id === sent.messageId)! };
}

const modelBodies = (calls: { url: string; body: string }[]) => calls.filter((c) => c.url.includes("generateContent") || c.url.includes("streamGenerateContent")).map((c) => JSON.parse(c.body) as { systemInstruction: { parts: { text: string }[] }; contents: { role: string; parts: Record<string, unknown>[] }[]; tools?: { functionDeclarations?: { name: string }[] }[] });
const balance = async (p: Person) => (await p.as.query(api.billing.credits, { scope: p.scope })).available;
const fileRow = (t: T, publicId: string) => t.run(async (ctx) => await ctx.db.query("files").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique());

describe("what the assistant can read", () => {
  test("kinds by type and name, Office files and other types refused, limits per kind and together, model inputs", () => {
    expect(attachmentKind({ filename: "a.png", mimeType: "image/png" })).toBe("image");
    expect(attachmentKind({ filename: "a.pdf", mimeType: "application/pdf" })).toBe("pdf");
    expect(attachmentKind({ filename: "rec.webm", mimeType: "audio/webm" })).toBe("audio");
    expect(attachmentKind({ filename: "notes.md", mimeType: "text/plain" })).toBe("markdown");
    expect(attachmentKind({ filename: "budget.csv", mimeType: "" })).toBe("csv");
    expect(attachmentKind({ filename: "page.html", mimeType: "application/octet-stream" })).toBe("html");
    expect(attachmentKind({ filename: "data.json", mimeType: "application/json" })).toBe("json");
    expect(attachmentKind({ filename: "archive.zip", mimeType: "application/zip" })).toBeNull();
    expect(checkAttachment({ filename: "report.docx", mimeType: "application/zip", size: 10 })).toMatchObject({ ok: false, reason: expect.stringMatching(/isn't supported yet.*Word, Excel and PowerPoint/) });
    expect(checkAttachment({ filename: "sheet.xlsx", mimeType: "application/zip", size: 10 }).ok).toBe(false);
    expect(checkAttachment({ filename: "anim.gif", mimeType: "image/gif", size: 10 })).toMatchObject({ ok: false, reason: expect.stringMatching(/PNG, JPEG or WebP/) });
    expect(checkAttachment({ filename: "big.pdf", mimeType: "application/pdf", size: 15 * 1024 * 1024 })).toMatchObject({ ok: false, reason: expect.stringMatching(/too large.*14 MB/) });
    expect(checkAttachment({ filename: "a.png", mimeType: "image/png", size: 100 }, { vision: false, audioIn: true })).toMatchObject({ ok: false, reason: "The AI model in use can't read images." });
    expect(checkAttachment({ filename: "r.webm", mimeType: "audio/webm", size: 100 }, { vision: true, audioIn: false }).ok).toBe(false);
    expect(checkAttachment({ filename: "notes.txt", mimeType: "text/plain", size: 100 }, { vision: false, audioIn: false })).toEqual({ ok: true, kind: "text" });
    expect(checkInlineBudget([{ kind: "pdf", size: 10 * 1024 * 1024 }, { kind: "image", size: 5 * 1024 * 1024 }])).toMatch(/too large together/);
    expect(checkInlineBudget([{ kind: "pdf", size: 10 * 1024 * 1024 }, { kind: "text", size: 2 * 1024 * 1024 }])).toBeNull();
  });

  test("HTML becomes its text, binary isn't text, base64 matches, transcripts are tidied", () => {
    expect(htmlToText("<html><head><title>x</title><script>steal()</script><style>p{}</style></head><body><h1>Trip</h1><p>Ferry at 9 &amp; snacks&nbsp;too</p><ul><li>Jacket</li></ul><!-- hidden --></body></html>")).toBe("Trip\n\nFerry at 9 & snacks too\n\n- Jacket");
    expect(decodeText(enc.encode("\uFEFFhello"))).toBe("hello");
    expect(decodeText(Uint8Array.from([0, 1, 2, 255, 254]))).toBeNull();
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) % 256);
    expect(toBase64(bytes)).toBe(btoa(String.fromCharCode(...bytes)));
    expect(toBase64(Uint8Array.from([1, 2]))).toBe(btoa("\u0001\u0002"));
    expect(cleanTranscript("Transcript: Hello.")).toBe("Hello.");
  });
});

describe("chat attachments", () => {
  test("a chat upload is only its uploader's (even in a shared workspace), and a file someone can't open is refused before anything is sent", async () => {
    const t = setup();
    const a = await person(t, "attach-owner@example.com");
    const b = await person(t, "attach-other@example.com");
    const { fetchMock } = gemini();
    const mine = await attach(t, a, "notes.txt", enc.encode("Ferry at 9."), "text/plain");
    expect(Object.keys(await a.as.query(api.files.urls, { fileIds: [mine], now: Date.now() }))).toEqual([mine]);
    expect(await b.as.query(api.files.urls, { fileIds: [mine], now: Date.now() })).toEqual({});
    const { fileId: noteFile } = await noteWithFile(t, a, { filename: "photo.png", bytes: PNG, mimeType: "image/png", kind: "image" });
    for (const id of [mine, noteFile]) await expect(b.as.action(api.aiChat.send, { scope: b.scope, conversationId: ulid(), text: "What's in this?", attachments: [id] })).rejects.toThrow(/isn't there anymore, or you can't open it/);
    // Not a file anyone can attach: an id that doesn't exist.
    await expect(a.as.action(api.aiChat.send, { scope: a.scope, conversationId: ulid(), text: "Hi", attachments: [ulid()] })).rejects.toThrow(/can't open it/);
    expect(fetchMock).not.toHaveBeenCalled();

    // In a team workspace: the other members don't see it either.
    const { workspaceId } = await teamWorkspace(a, "Studio");
    await join(t, a, b, "attach-other@example.com", workspaceId, "editor");
    const there = await attach(t, a, "plan.md", enc.encode("# Plan"), "text/plain", inWorkspace(workspaceId));
    expect(await b.as.query(api.files.urls, { fileIds: [there], now: Date.now() })).toEqual({});
    await expect(b.as.action(api.aiChat.send, { scope: inWorkspace(workspaceId), conversationId: ulid(), text: "Read it", attachments: [there] })).rejects.toThrow(/can't open it/);
    // An upload sent in one conversation can't be sent in another.
    const first = await sendWith(a, "Summarize", [mine]);
    expect(first.answer.status).toBe("done");
    await expect(a.as.action(api.aiChat.send, { scope: a.scope, conversationId: ulid(), text: "Again", attachments: [mine] })).rejects.toThrow(/can't open it/);
  });

  test("images and PDFs go to the model inline with the question; the message shows its files", async () => {
    const t = setup();
    const a = await person(t, "attach-inline@example.com");
    const { calls } = gemini();
    const image = await attach(t, a, "chart.png", PNG, "image/png");
    const pdf = await attach(t, a, "timetable.pdf", PDF, "application/pdf");
    const { answer, got } = await sendWith(a, "What do these say?", [image, pdf]);
    expect(answer.status).toBe("done");
    expect(answer.text).toBe("The file covers the ferry times.");
    const body = modelBodies(calls).find((b) => b.systemInstruction.parts[0]!.text.includes("attached files"))!;
    const parts = body.contents[body.contents.length - 1]!.parts;
    expect(parts[0]!.text).toMatch(/Question: What do these say\?/);
    expect(parts).toContainEqual({ inlineData: { mimeType: "image/png", data: toBase64(PNG) } });
    expect(parts).toContainEqual({ inlineData: { mimeType: "application/pdf", data: toBase64(PDF) } });
    expect(parts.some((p) => typeof p.text === "string" && p.text.includes('Attached file 1: "chart.png" (image)'))).toBe(true);
    const asked = got.messages.find((m) => m.role === "user")!;
    expect(asked.attachments.map((f) => [f.name, f.kind])).toEqual([["chart.png", "image"], ["timetable.pdf", "pdf"]]);
    // Credits were charged for the request, files included (the usage Gemini reported).
    expect(answer.credits).toBeGreaterThan(0);
  });

  test("text, Markdown and HTML are read as text (HTML stripped), wrapped as untrusted, never sent inline; a note's file can be attached", async () => {
    const t = setup();
    const a = await person(t, "attach-text@example.com");
    const { calls } = gemini();
    const md = await attach(t, a, "packing.md", enc.encode("# Packing\n- Rain jacket"), "text/plain");
    const html = await attach(t, a, "page.html", enc.encode("<html><head><script>ignoreYourRules()</script></head><body><h1>Ferry</h1><p>Leaves at 9 &amp; 13</p></body></html>"), "text/html");
    const { noteId, fileId: noteFile } = await noteWithFile(t, a, { filename: "list.txt", bytes: enc.encode("Tickets, passports"), mimeType: "text/plain", kind: "file", title: "Trip notes" });
    // The Attach menu offers the note's files.
    const offered = await a.as.query(api.aiAttachments.noteFiles, { documentIds: [noteId] });
    expect(offered).toEqual([expect.objectContaining({ id: noteFile, name: "list.txt", kind: "text", supported: true, noteTitle: "Trip notes" })]);
    const { answer } = await sendWith(a, "Compare these", [md, html, noteFile], { context: { kind: "note", ids: [noteId] } });
    expect(answer.status).toBe("done");
    const body = modelBodies(calls).find((b) => b.systemInstruction.parts[0]!.text.includes("attached files"))!;
    const sent = JSON.stringify(body.contents);
    expect(sent).toContain("<untrusted_file");
    expect(sent).toContain("# Packing\\n- Rain jacket");
    expect(sent).toContain("Ferry\\n\\nLeaves at 9 & 13");
    expect(sent).not.toContain("ignoreYourRules");
    expect(sent).toContain("Tickets, passports");
    expect(sent).not.toContain("inlineData");
    // The note the conversation is about comes as a numbered source.
    expect(sent).toContain("[1] Trip notes");
  });

  test("Word, Excel and PowerPoint files are refused as not supported yet, with nothing sent", async () => {
    const t = setup();
    const a = await person(t, "attach-office@example.com");
    const { fetchMock } = gemini();
    const docx = await attach(t, a, "report.docx", DOCX, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    await expect(a.as.action(api.aiChat.send, { scope: a.scope, conversationId: ulid(), text: "Summarize", attachments: [docx] })).rejects.toThrow(/isn't supported yet/);
    const many = await Promise.all(["a", "b", "c", "d", "e", "f"].map((n) => attach(t, a, `${n}.txt`, enc.encode(n), "text/plain")));
    await expect(a.as.action(api.aiChat.send, { scope: a.scope, conversationId: ulid(), text: "All of them", attachments: many })).rejects.toThrow(/up to 5 files/);
    // A binary file named like text: read, found not to be text, refused plainly.
    const fake = await attach(t, a, "secret.txt", Uint8Array.from([0, 159, 146, 150, 0, 1, 2, 3]), "text/plain");
    const { answer } = await sendWith(a, "Read this", [fake]);
    expect(answer.status).toBe("error");
    expect(answer.error?.message).toMatch(/couldn't be read as text/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("spreadsheet data: the model gets calculate and is told to use it for every number", async () => {
    const t = setup();
    const a = await person(t, "attach-csv@example.com");
    const { calls } = gemini({ turns: [{ calls: [{ name: "calculate", args: { expression: "1200 + 350" } }] }, { text: "You spent 1550 in total." }] });
    const csv = await attach(t, a, "budget.csv", enc.encode("month,amount\nJan,1200\nFeb,350\n"), "text/csv");
    const { answer } = await sendWith(a, "What did I spend in total?", [csv]);
    expect(answer.status).toBe("done");
    expect(answer.text).toBe("You spent 1550 in total.");
    const bodies = modelBodies(calls).filter((b) => b.systemInstruction.parts[0]!.text.includes("attached files"));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.tools?.[0]?.functionDeclarations?.map((d) => d.name)).toEqual(["calculate"]);
    expect(bodies[0]!.systemInstruction.parts[0]!.text).toMatch(/call the calculate tool.*Never work numbers out yourself/);
    expect(JSON.stringify(bodies[1]!.contents)).toContain('"functionResponse":{"name":"calculate","response":{"result":1550}');
  });

  test("Settings > AI off: no uploads, nothing attached, no transcription, nothing sent; on again, earlier files come along with follow-ups", async () => {
    const t = setup();
    const a = await person(t, "attach-off@example.com");
    const { fetchMock, calls } = gemini();
    const txt = await attach(t, a, "notes.txt", enc.encode("Ferry at 9."), "text/plain");
    const { noteId, fileId: audio } = await noteWithFile(t, a, { filename: "memo.webm", bytes: WEBM, mimeType: "audio/webm", kind: "audio" });
    await a.as.mutation(api.users.updateProfile, { aiPrefs: { attachments: false } });
    await expect(a.as.mutation(api.files.generateUploadUrl, { scope: a.scope, filename: "x.txt", size: 3, mimeType: "text/plain", kind: "attachment" })).rejects.toThrow(/turned off in Settings > AI/);
    await expect(a.as.action(api.aiChat.send, { scope: a.scope, conversationId: ulid(), text: "Read", attachments: [txt] })).rejects.toThrow(/turned off in Settings > AI/);
    await expect(a.as.action(api.aiAttachments.transcribe, { scope: a.scope, documentId: noteId, fileId: audio })).rejects.toThrow(/turned off in Settings > AI/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await a.as.query(api.aiChat.capabilities, {})).prefs.attachments).toBe(false);

    await a.as.mutation(api.users.updateProfile, { aiPrefs: { attachments: true } });
    const { conversationId } = await sendWith(a, "Read this", [txt]);
    await sendWith(a, "And when does it leave?", [], { conversationId });
    const last = modelBodies(calls).filter((b) => b.systemInstruction.parts[0]!.text.includes("attached files")).pop()!;
    expect(JSON.stringify(last.contents)).toContain("Ferry at 9.");
  });

  test("Core: refused with nothing sent (chat with files, and transcription)", async () => {
    const t = setup();
    const a = await person(t, "attach-core@example.com");
    const { fetchMock } = gemini();
    const txt = await attach(t, a, "notes.txt", enc.encode("Ferry at 9."), "text/plain");
    const { noteId, fileId: audio } = await noteWithFile(t, a, { filename: "memo.webm", bytes: WEBM, mimeType: "audio/webm", kind: "audio" });
    await a.as.mutation(api.billing.testPurchase, { plan: "core", interval: "month" });
    const { answer } = await sendWith(a, "Read this", [txt]);
    expect(answer.status).toBe("error");
    expect(answer.error).toMatchObject({ code: "forbidden", reason: "ai_not_included" });
    await expect(a.as.action(api.aiAttachments.transcribe, { scope: a.scope, documentId: noteId, fileId: audio })).rejects.toThrow(/Core/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a conversation takes its uploads with it (a note's files stay), and uploads never sent are swept after a day", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "attach-delete@example.com");
    gemini();
    const sent = await attach(t, a, "notes.txt", enc.encode("Ferry at 9."), "text/plain");
    const unsent = await attach(t, a, "draft.txt", enc.encode("Not sent"), "text/plain");
    const { fileId: noteFile } = await noteWithFile(t, a, { filename: "list.txt", bytes: enc.encode("Tickets"), mimeType: "text/plain", kind: "file" });
    const { conversationId } = await sendWith(a, "Read these", [sent, noteFile]);
    expect((await fileRow(t, sent))?.conversationId).toBeDefined();
    const used = (await t.run(async (ctx) => (await ctx.db.query("profiles").collect()).find((p) => p.email === "attach-delete@example.com")!.personalStorageUsedBytes)) ?? 0;
    await a.as.mutation(api.aiChat.remove, { conversationId });
    expect(await fileRow(t, sent)).toBeNull();
    expect(await fileRow(t, noteFile)).not.toBeNull();
    const after = (await t.run(async (ctx) => (await ctx.db.query("profiles").collect()).find((p) => p.email === "attach-delete@example.com")!.personalStorageUsedBytes)) ?? 0;
    expect(used - after).toBe(enc.encode("Ferry at 9.").length);
    expect((await t.mutation(internal.aiChat.sweep, {})).files).toBe(0);
    vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
    expect((await t.mutation(internal.aiChat.sweep, {})).files).toBe(1);
    expect(await fileRow(t, unsent)).toBeNull();
  });
});

describe("read_attachment (the agent)", () => {
  test("reads a sent file as text and a note's image through the model, refuses files it can't open, and is off with the setting", async () => {
    const t = setup();
    const a = await person(t, "attach-agent@example.com");
    const b = await person(t, "attach-agent-other@example.com");
    const csv = await attach(t, a, "budget.csv", enc.encode("month,amount\nJan,1200\n"), "text/csv");
    const { noteId, fileId: image } = await noteWithFile(t, a, { filename: "timetable.png", bytes: PNG, mimeType: "image/png", kind: "image" });
    const { fileId: theirs } = await noteWithFile(t, b, { filename: "private.png", bytes: PNG, mimeType: "image/png", kind: "image" });
    const { calls } = gemini({
      turns: [
        { calls: [{ name: "get_note", args: { noteId } }, { name: "read_attachment", args: { fileId: csv } }, { name: "read_attachment", args: { fileId: image } }, { name: "read_attachment", args: { fileId: theirs } }] },
        { text: "Your budget and the timetable are in." },
      ],
    });
    const conversationId = ulid();
    const sent = await a.as.action(api.aiAgent.send, { scope: a.scope, conversationId, text: "Read my files", attachments: [csv] });
    expect(sent.status).toBe("done");
    const bodies = modelBodies(calls);
    // The opening lists the files sent in the conversation.
    expect(JSON.stringify(bodies[0]!.contents)).toContain(`\\"fileId\\":\\"${csv}\\"`);
    // get_note shows the note's file ids.
    const second = JSON.stringify(bodies[bodies.length - 1]!.contents);
    expect(second).toContain(`fileId ${image}`);
    expect(second).toContain("month,amount");
    expect(second).toContain("Use calculate for any arithmetic");
    expect(second).toContain("Ferry timetable: 9:00, 13:00.");
    expect(second).toContain("There's no file with that id here");
    // The image was read in a call of its own, inline.
    const read = bodies.find((x) => x.systemInstruction.parts[0]!.text.includes("You read files for an assistant"))!;
    expect(read.contents[0]!.parts).toContainEqual({ inlineData: { mimeType: "image/png", data: toBase64(PNG) } });

    // Off in Settings: the tool isn't offered, and a message with files is refused.
    await a.as.mutation(api.users.updateProfile, { aiPrefs: { attachments: false } });
    const { calls: later } = gemini({ turns: [{ text: "Okay." }] });
    await a.as.action(api.aiAgent.send, { scope: a.scope, conversationId: ulid(), text: "Hello" });
    const names = modelBodies(later)[0]!.tools![0]!.functionDeclarations!.map((d) => d.name);
    expect(names).not.toContain("read_attachment");
    expect(names).toContain("calculate");
  });
});

describe("transcription", () => {
  test("sends the recording inline as audio, returns the transcript, and charges credits", async () => {
    const t = setup();
    const a = await person(t, "attach-transcribe@example.com");
    const b = await person(t, "attach-transcribe-other@example.com");
    const { calls } = gemini({ transcript: "Transcript: Speaker 1: Book the ferry for Friday." });
    const { noteId, fileId } = await noteWithFile(t, a, { filename: "memo.webm", bytes: WEBM, mimeType: "audio/webm", kind: "audio" });
    const before = await balance(a);
    const out = await a.as.action(api.aiAttachments.transcribe, { scope: a.scope, documentId: noteId, fileId });
    expect(out.text).toBe("Speaker 1: Book the ferry for Friday.");
    expect(out.credits).toBeGreaterThan(0);
    expect(before - (await balance(a))).toBe(out.credits);
    const [body] = modelBodies(calls);
    expect(body!.systemInstruction.parts[0]!.text).toMatch(/You transcribe recordings/);
    const parts = body!.contents[0]!.parts;
    expect(parts[0]!.text).toMatch(/^Transcribe this recording word for word/);
    expect(parts[1]).toEqual({ inlineData: { mimeType: "audio/webm", data: toBase64(WEBM) } });
    // Someone who can't open the note can't have it transcribed; a file that isn't the note's recording isn't one.
    await expect(b.as.action(api.aiAttachments.transcribe, { scope: b.scope, documentId: noteId, fileId })).rejects.toThrow();
    const { fileId: image } = await noteWithFile(t, a, { filename: "p.png", bytes: PNG, mimeType: "image/png", kind: "image" });
    await expect(a.as.action(api.aiAttachments.transcribe, { scope: a.scope, documentId: noteId, fileId: image })).rejects.toThrow(/isn't there anymore/);
    expect(modelBodies(calls)).toHaveLength(1);
  });
});
