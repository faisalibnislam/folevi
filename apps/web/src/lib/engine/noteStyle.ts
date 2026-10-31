// Revision 22: the note's Style tool for the native apps (components/doc/Inspector.tsx StylePanel): `note.style`
// says what it shows; `note.style.set` and `note.theme.set` change the note's look the way the panel does (the
// sync engine's document patch, a theme setting what it decides).
import type { DocumentCover, DocumentStyle } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { coverArtOf, coverArtThumbUrl, pageBackdrop, styleColorsOf } from "@/lib/cover";
import { allThemes, applyThemeDefaults, FONT_TYPES, PLAIN_DEFAULTS, planAllows, SHEETS, TEXTS, THEME_PLANS, type ThemeDefaults } from "@/lib/themes";
import type { CommandDef } from "./commands";
import { EDIT_ACCESS, source, engineSignal, type ValueViewDef } from "./views";
import { BridgeError, bool, id, oneOf, only, text } from "./validate";
import type { CommandName, NoteStyleValue, ViewName } from "./protocol";
import type { EngineDeps } from "./context";

type DocumentGet = { document: { id: string; style: DocumentStyle; cover: DocumentCover; revision: number }; access: string; inTrash: boolean } | null;
type Plan = Parameters<typeof planAllows>[0];

const SEPARATORS = [
  { id: "line", name: "Line" },
  { id: "dots", name: "Dots" },
  { id: "doodle", name: "Doodle" },
];

/** Drops undefined keys (Convex values can't carry undefined). */
const clean = (style: DocumentStyle): DocumentStyle => Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined)) as DocumentStyle;

export function noteStyleValue(got: DocumentGet, plan: Plan | null): NoteStyleValue {
  const sheets = SHEETS.map((s) => ({ id: s.id, name: s.name, color: s.color }));
  const texts = TEXTS.map((t) => ({ id: t.id, name: t.name, color: t.color }));
  const fonts = FONT_TYPES.map((f) => ({ id: f.id, name: f.name }));
  if (!got) {
    return { found: false, canEdit: false, current: "plain", styleName: "Plain", themeId: null, ownImage: false, themes: [], hasBackdrop: false, blur: false, sheet: null, text: null, sheetColor: "#ffffff", textColor: "#1c1c1f", autoPaper: null, autoInk: null, font: "serif", separator: "line", width: "default", sheets, texts, fonts, separators: SEPARATORS };
  }
  const { style, cover } = got.document;
  const art = coverArtOf(cover);
  const ownImage = cover.kind === "image" && Boolean(cover.value);
  const auto = styleColorsOf(cover, null);
  const themes = allThemes()
    .filter((t) => t.status === "published" || t.id === art?.id)
    .map((t) => {
      const thumb = coverArtThumbUrl(t.id);
      return { id: t.id, name: t.name, thumb: /^https?:/.test(thumb) ? thumb : null, locked: Boolean(plan && !planAllows(plan, t.plan) && t.id !== art?.id) };
    });
  return {
    found: true,
    canEdit: EDIT_ACCESS.has(got.access) && !got.inTrash,
    current: art?.id ?? (ownImage ? "image" : "plain"),
    styleName: art?.name ?? (ownImage ? "Your image" : "Plain"),
    themeId: art?.id ?? null,
    ownImage,
    themes,
    hasBackdrop: Boolean(pageBackdrop(style, cover, ownImage ? "image" : null)),
    blur: Boolean(style.blur),
    sheet: style.sheet ?? null,
    text: style.text ?? null,
    sheetColor: SHEETS.find((s) => s.id === style.sheet)?.color ?? auto?.paper ?? "#ffffff",
    textColor: TEXTS.find((t) => t.id === style.text)?.color ?? auto?.ink ?? "#1c1c1f",
    autoPaper: auto?.paper ?? null,
    autoInk: auto?.ink ?? null,
    font: style.font,
    separator: style.separator ?? "line",
    width: style.width === "wide" ? "wide" : "default",
    sheets,
    texts,
    fonts,
    separators: SEPARATORS,
  };
}

const noteStyle: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["id"]);
    return { id: id(args, "id") };
  },
  create: (ctx, args) => {
    const noteId = args.id as string;
    const got = source<DocumentGet>(ctx, api.documents.get, { documentId: noteId }, null);
    const plan = ctx.deps().app.mode === "account" ? source<Plan>(ctx, api.themes.planForDocument, { documentId: noteId }, null) : null;
    return {
      signals: [got, ...(plan ? [plan] : []), engineSignal(ctx)],
      compute: () => {
        const s = got.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        return { value: noteStyleValue(s.value ?? null, plan?.snapshot().value ?? null), stale: s.stale, error: null };
      },
    };
  },
};

async function documentOf(deps: EngineDeps, noteId: string) {
  const got = (await deps.client.query(api.documents.get, { documentId: noteId })) as DocumentGet;
  if (!got) throw new BridgeError("unavailable", "That note isn’t there any more.");
  if (!EDIT_ACCESS.has(got.access) || got.inTrash) throw new BridgeError("read_only", "You can only read this note.");
  const engine = deps.app.engine;
  if (!engine) throw new BridgeError("unavailable", "The note is still opening.");
  return { doc: got.document, engine };
}

export const NOTE_STYLE_VALUE_VIEWS = { "note.style": noteStyle } satisfies Partial<Record<ViewName, ValueViewDef>>;

export const NOTE_STYLE_COMMANDS = {
  "note.style.set": {
    async run(deps, args) {
      only(args, ["id", "sheet", "text", "font", "separator", "width", "blur"]);
      const noteId = id(args, "id");
      const { doc, engine } = await documentOf(deps, noteId);
      const patch: Partial<DocumentStyle> = {};
      if (args.sheet !== undefined) {
        const sheet = args.sheet === null ? undefined : oneOf(args, "sheet", SHEETS.map((s) => s.id));
        patch.sheet = sheet;
        // The panel's rule: Night pairs with white text, a light page leaves white text for ink.
        if (sheet === "night" && (!doc.style.text || doc.style.text === "ink")) patch.text = "white";
        if (sheet !== "night" && doc.style.text === "white") patch.text = "ink";
      }
      if (args.text !== undefined) patch.text = args.text === null ? undefined : oneOf(args, "text", TEXTS.map((t) => t.id));
      if (args.font !== undefined) patch.font = oneOf(args, "font", FONT_TYPES.map((f) => f.id));
      if (args.separator !== undefined) {
        const sep = oneOf(args, "separator", SEPARATORS.map((s) => s.id));
        patch.separator = sep === "line" ? undefined : (sep as DocumentStyle["separator"]);
      }
      if (args.width !== undefined) patch.width = oneOf(args, "width", ["default", "wide"] as const);
      if (args.blur !== undefined) patch.blur = bool(args, "blur") || undefined;
      engine.updateDocument(noteId, { style: clean({ ...doc.style, ...patch }) }, doc.revision);
      return { ok: true };
    },
  },
  "note.theme.set": {
    async run(deps, args) {
      only(args, ["id", "theme"]);
      const noteId = id(args, "id");
      const theme = text(args, "theme", { max: 80 }) as string;
      const { doc, engine } = await documentOf(deps, noteId);
      const base = { ...doc.style, backdrop: undefined };
      if (theme === "plain") {
        engine.updateDocument(noteId, { cover: { kind: "none" }, style: clean(applyThemeDefaults(base, PLAIN_DEFAULTS)) }, doc.revision);
        return { ok: true };
      }
      const t = allThemes().find((x) => x.id === theme);
      if (!t) throw new BridgeError("invalid_args", "There's no theme called that.");
      const current = coverArtOf(doc.cover)?.id;
      if (deps.app.mode === "account" && t.id !== current) {
        const plan = (await deps.client.query(api.themes.planForDocument, { documentId: noteId }).catch(() => null)) as Plan | null;
        if (plan && !planAllows(plan, t.plan)) {
          const needs = THEME_PLANS.find((p) => p.id === t.plan)?.name ?? "a paid plan";
          throw new BridgeError("unavailable", `${t.name} is for ${needs.replace(" and up", " plans and up")}. Change your plan in Settings, under Plan & billing.`);
        }
      }
      engine.updateDocument(noteId, { cover: { kind: "art", value: t.id }, style: clean(applyThemeDefaults(base, t.defaults as ThemeDefaults)) }, doc.revision);
      return { ok: true };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
