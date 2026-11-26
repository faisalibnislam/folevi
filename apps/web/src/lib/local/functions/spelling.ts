// spelling.* in local mode (convex/spelling.ts): the person's spelling settings and personal dictionary, one
// value in the library's meta ("spelling"), so they travel with the library to every device it syncs to.
import { isValidId } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { defineLocal } from "../registry";
import { requireProfile } from "./shared";

const KEY = "spelling";
/** As the server (convex/spelling.ts SPELLING_WORDS_MAX). */
const WORDS_MAX = 5000;

interface Saved {
  spellcheck?: boolean;
  predictions?: boolean;
  english?: "en-US" | "en-GB";
  learnt?: string[];
  ignored?: string[];
  offNotes?: string[];
}

defineLocal(api.spelling.get, "query", async (ctx) => {
  await requireProfile(ctx);
  const s = ((await ctx.db.get("meta", KEY)) as Saved | null | undefined) ?? {};
  return { spellcheck: s.spellcheck ?? null, predictions: s.predictions ?? null, english: s.english ?? null, learnt: s.learnt ?? [], ignored: s.ignored ?? [], offNotes: s.offNotes ?? [] };
});

defineLocal(api.spelling.setPrefs, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const s = ((await ctx.db.get("meta", KEY)) as Saved | null | undefined) ?? {};
  const patch = Object.fromEntries(Object.entries(args).filter(([, x]) => x !== undefined));
  ctx.db.put("meta", KEY, { ...s, ...patch });
  return null;
});

defineLocal(api.spelling.setWord, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const word = args.word.trim();
  if (!word || word.length > 64 || /\s/.test(word)) fail("invalid_argument", "That isn't a word.");
  const s = ((await ctx.db.get("meta", KEY)) as Saved | null | undefined) ?? {};
  const list = (s[args.kind] ?? []).filter((w) => w !== word);
  if (args.add) list.push(word);
  ctx.db.put("meta", KEY, { ...s, [args.kind]: list.slice(-WORDS_MAX) });
  return null;
});

defineLocal(api.spelling.setNote, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  if (!isValidId(args.documentId)) fail("invalid_argument", "Invalid note id.");
  const s = ((await ctx.db.get("meta", KEY)) as Saved | null | undefined) ?? {};
  const list = (s.offNotes ?? []).filter((id) => id !== args.documentId);
  if (!args.on) list.push(args.documentId);
  ctx.db.put("meta", KEY, { ...s, offNotes: list.slice(-2000) });
  return null;
});
