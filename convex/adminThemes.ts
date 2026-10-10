// The admin console's Theme manager: add note themes, change any theme (built-in or added), publish,
// retire, reorder, and delete added themes for good (their notes move to a theme the admin picks). Every
// change is audited. Staff can look; owners and admins can change (as for templates and configuration).
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { ulid } from "@folevi/editor-schema";
import { ALL_ADMIN_ROLES, requirePlatformRole, type PlatformRole } from "./lib/auth";
import { recordAudit } from "./lib/audit";
import { fail } from "./lib/errors";
import { effectiveTheme, themeRow } from "./lib/noteThemes";
import { BUILT_IN_THEME_KEYS, builtInSetup, isCustomThemeKey, isFontId, type FontSlot } from "./lib/themes";
import { vThemeDefaults, vThemeFonts, vThemeImage, vThemePalette, vThemePlan, vThemeStatus } from "./lib/validators";
import { themeForClient } from "./themes";

const EDITORS: PlatformRole[] = ["super_admin", "ops_admin"];
const vMeta = { requestId: v.optional(v.string()), clientHash: v.optional(v.string()) };

const HEX = /^#[0-9a-f]{6}$/i;
/** The longest a theme image may be per version (the 3200 px WebP is well under this). */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

type Palette = Doc<"noteThemes">["palette"];
type Fonts = Doc<"noteThemes">["fonts"];

function checkPalette(p: Palette) {
  if (!p) return;
  const colours = [p.paper, p.ink, p.paperDark, p.inkDark, p.accent, p.accentDark, ...p.text, ...p.textDark, ...p.highlight, ...p.highlightDark];
  if (p.text.length !== 5 || p.textDark.length !== 5 || p.names.length !== 5 || p.highlight.length !== 4 || p.highlightDark.length !== 4) {
    fail("invalid_argument", "A theme needs five text colours and four highlights, for light and dark.");
  }
  if (!colours.every((c) => HEX.test(c))) fail("invalid_argument", "Colours are written as #rrggbb.");
  if (p.names.some((n) => !n.trim() || n.length > 24)) fail("invalid_argument", "Give each text colour a short name.");
}

function checkFonts(f: Fonts) {
  if (!f) return;
  for (const slot of ["modern", "serif", "mono", "soft"] as FontSlot[]) {
    if (!isFontId(slot, f[slot])) fail("invalid_argument", "Pick each typeface from the list.");
  }
}

function checkName(name: string | undefined) {
  if (name === undefined) return;
  const n = name.trim();
  if (!n || n.length > 40) fail("invalid_argument", "Give the theme a name of up to 40 characters.");
}

/** The three image versions have to be WebP images the admin just uploaded. */
async function checkImage(ctx: MutationCtx, image: Doc<"noteThemes">["image"]) {
  if (!image) return;
  for (const id of [image.full, image.half, image.thumb]) {
    const meta = await ctx.db.system.get(id);
    if (!meta || meta.contentType !== "image/webp" || meta.size > MAX_IMAGE_BYTES) fail("invalid_argument", "That image couldn't be used. Try another.");
  }
  if (image.width < 800 || image.height < 500) fail("invalid_argument", "Use an image at least 800 × 500 px (2400 × 1500 px is best).");
}

async function dropImage(ctx: MutationCtx, image: Doc<"noteThemes">["image"]) {
  if (!image) return;
  for (const id of [image.full, image.half, image.thumb]) await ctx.storage.delete(id).catch(() => undefined);
}

/** A built-in theme's position before anyone reordered (its place in the shipped list). */
const shippedOrder = (key: string) => BUILT_IN_THEME_KEYS.indexOf(key) + 1;

/** The theme's row, made from the shipped theme the first time a built-in is changed. */
async function rowFor(ctx: MutationCtx, key: string): Promise<Doc<"noteThemes">> {
  const row = await themeRow(ctx, key);
  if (row) return row;
  if (!builtInSetup(key)) fail("not_found", "That theme doesn't exist.");
  const now = Date.now();
  const id = await ctx.db.insert("noteThemes", { key, status: "published", order: shippedOrder(key), plan: "free", createdAt: now, updatedAt: now });
  return (await ctx.db.get(id))!;
}

async function audit(ctx: MutationCtx, actor: Doc<"profiles">, action: string, key: string, extra: { before?: unknown; after?: unknown; reason?: string; requestId?: string; clientHash?: string } = {}) {
  await recordAudit(ctx, actor, { action, targetType: "theme", targetId: key, ...extra });
}

/** What an audit record keeps of a theme (no storage ids). */
const summary = (row: Doc<"noteThemes"> | null) =>
  row ? { name: row.name, status: row.status, plan: row.plan, order: row.order, defaults: row.defaults, fonts: row.fonts, palette: row.palette ? "custom" : undefined, image: row.image ? "custom" : undefined } : null;

// ---------------------------------------------------------------- reading

/** Every theme row (drafts too) with its image URLs and the palette its image gave. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformRole(ctx, ALL_ADMIN_ROLES);
    const rows = await ctx.db.query("noteThemes").withIndex("by_order").take(1000);
    return Promise.all(rows.map(async (row) => ({ ...(await themeForClient(ctx, row)), autoPalette: row.autoPalette ?? null, createdAt: row.createdAt })));
  },
});

// ---------------------------------------------------------------- changing

/** Where the admin's browser uploads a theme image version (it makes the three WebP sizes itself). */
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requirePlatformRole(ctx, EDITORS);
    return await ctx.storage.generateUploadUrl();
  },
});

const vFields = {
  name: v.optional(v.string()),
  image: v.optional(vThemeImage),
  palette: v.optional(vThemePalette),
  autoPalette: v.optional(vThemePalette),
  defaults: v.optional(vThemeDefaults),
  fonts: v.optional(vThemeFonts),
  plan: v.optional(vThemePlan),
};

/** A new theme, as a draft (nobody sees it until it's published). */
export const create = mutation({
  args: { ...vFields, name: v.string(), image: vThemeImage, palette: vThemePalette, autoPalette: vThemePalette, defaults: vThemeDefaults, fonts: vThemeFonts, ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, EDITORS);
    checkName(args.name);
    checkPalette(args.palette);
    checkPalette(args.autoPalette);
    checkFonts(args.fonts);
    await checkImage(ctx, args.image);
    const last = await ctx.db.query("noteThemes").withIndex("by_order").order("desc").first();
    const key = `th-${ulid()}`;
    const now = Date.now();
    await ctx.db.insert("noteThemes", {
      key,
      name: args.name.trim(),
      status: "draft",
      order: Math.max(last?.order ?? 0, BUILT_IN_THEME_KEYS.length) + 1,
      plan: args.plan ?? "free",
      image: args.image,
      palette: args.palette,
      autoPalette: args.autoPalette,
      defaults: args.defaults,
      fonts: args.fonts,
      createdAt: now,
      updatedAt: now,
      updatedBy: admin._id,
    });
    await audit(ctx, admin, "theme.create", key, { after: summary(await themeRow(ctx, key)), requestId: args.requestId, clientHash: args.clientHash });
    return key;
  },
});

/** Changes a theme. `null` clears a built-in's change (back to how it shipped). */
export const update = mutation({
  args: {
    key: v.string(),
    name: v.optional(v.union(v.string(), v.null())),
    image: v.optional(v.union(vThemeImage, v.null())),
    palette: v.optional(v.union(vThemePalette, v.null())),
    autoPalette: v.optional(v.union(vThemePalette, v.null())),
    defaults: v.optional(v.union(vThemeDefaults, v.null())),
    fonts: v.optional(v.union(vThemeFonts, v.null())),
    plan: v.optional(vThemePlan),
    ...vMeta,
  },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, EDITORS);
    const custom = isCustomThemeKey(args.key);
    const row = await rowFor(ctx, args.key);
    const before = summary(row);
    // An added theme has no shipped version to fall back to.
    if (custom && (args.name === null || args.image === null || args.palette === null || args.defaults === null || args.fonts === null)) {
      fail("invalid_argument", "An added theme keeps its name, image, colours, defaults and typefaces.");
    }
    if (args.name) checkName(args.name);
    if (args.palette) checkPalette(args.palette);
    if (args.autoPalette) checkPalette(args.autoPalette);
    if (args.fonts) checkFonts(args.fonts);
    if (args.image) await checkImage(ctx, args.image);
    const patch: Partial<Doc<"noteThemes">> = { updatedAt: Date.now(), updatedBy: admin._id };
    const set = <K extends keyof Doc<"noteThemes">>(k: K, value: Doc<"noteThemes">[K] | null | undefined) => {
      if (value === undefined) return;
      patch[k] = (value === null ? undefined : value) as Doc<"noteThemes">[K];
    };
    set("name", args.name === null ? null : args.name?.trim());
    set("image", args.image);
    set("palette", args.palette);
    set("autoPalette", args.autoPalette);
    set("defaults", args.defaults);
    set("fonts", args.fonts);
    if (args.plan) patch.plan = args.plan;
    // A new image replaces the old one's files (unless it's the same upload).
    const oldImage = args.image !== undefined && row.image && row.image.full !== args.image?.full ? row.image : undefined;
    await ctx.db.patch(row._id, patch);
    await dropImage(ctx, oldImage);
    await audit(ctx, admin, "theme.update", args.key, { before, after: summary(await ctx.db.get(row._id)), requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** Publish (people can pick it), back to draft (hidden), or retire (hidden; notes using it keep it). */
export const setStatus = mutation({
  args: { key: v.string(), status: vThemeStatus, ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, EDITORS);
    const row = await rowFor(ctx, args.key);
    if (args.status === "published" && isCustomThemeKey(args.key) && !(row.image && row.palette && row.defaults && row.fonts && row.name)) {
      fail("invalid_argument", "Finish the theme (name, image, colours, defaults and typefaces) before publishing it.");
    }
    await ctx.db.patch(row._id, { status: args.status, updatedAt: Date.now(), updatedBy: admin._id });
    await audit(ctx, admin, "theme.set_status", args.key, { before: { status: row.status }, after: { status: args.status }, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** The picker's order, as the full list of keys from first to last. */
export const reorder = mutation({
  args: { keys: v.array(v.string()), ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, EDITORS);
    if (args.keys.length > 1000 || new Set(args.keys).size !== args.keys.length) fail("invalid_argument", "That order has a theme twice.");
    for (const [i, key] of args.keys.entries()) {
      const row = (await themeRow(ctx, key)) ?? (builtInSetup(key) ? await rowFor(ctx, key) : null);
      if (!row) continue;
      if (row.order !== i + 1) await ctx.db.patch(row._id, { order: i + 1, updatedAt: Date.now(), updatedBy: admin._id });
    }
    await audit(ctx, admin, "theme.reorder", "all", { after: { count: args.keys.length }, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** A built-in theme back to exactly how it shipped (its row and any replacement image go). */
export const resetBuiltIn = mutation({
  args: { key: v.string(), reason: v.string(), ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, EDITORS);
    if (!builtInSetup(args.key)) fail("invalid_argument", "Only built-in themes can be reset.");
    const row = await themeRow(ctx, args.key);
    if (!row) return null;
    await ctx.db.delete(row._id);
    await dropImage(ctx, row.image);
    await audit(ctx, admin, "theme.reset", args.key, { before: summary(row), reason: args.reason.trim().slice(0, 500), requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/**
 * Deletes an added theme for good. Notes that use it move to `replacement` (with its defaults) first, then
 * the theme and its image go. Built-in themes can only be retired: they ship with the app.
 */
export const deleteForever = mutation({
  args: { key: v.string(), replacement: v.string(), reason: v.string(), ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, EDITORS);
    if (!isCustomThemeKey(args.key)) fail("invalid_argument", "Built-in themes can be retired, not deleted.");
    const reason = args.reason.trim();
    if (reason.length < 8) fail("invalid_argument", "Give a reason of at least a few words. It is kept in the audit log.");
    if (args.replacement === args.key) fail("invalid_argument", "Pick a different theme for its notes.");
    const row = await themeRow(ctx, args.key);
    if (!row) fail("not_found", "That theme doesn't exist.");
    const target = await effectiveTheme(ctx, args.replacement);
    if (!target || target.status !== "published") fail("invalid_argument", "Move its notes to a published theme.");
    // Hidden right away; the notes move in the background, then the row goes (finishDelete).
    await ctx.db.patch(row._id, { status: "retired", updatedAt: Date.now(), updatedBy: admin._id });
    await ctx.scheduler.runAfter(0, internal.themes.resetNotesToThemeDefaults, { from: args.key, to: args.replacement });
    await audit(ctx, admin, "theme.delete", args.key, { before: summary(row), after: { replacement: args.replacement }, reason: reason.slice(0, 500), requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** The last step of deleteForever, once no note uses the theme. */
export const finishDelete = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if (!isCustomThemeKey(args.key)) return null;
    const row = await themeRow(ctx, args.key);
    if (!row) return null;
    await ctx.db.delete(row._id);
    await dropImage(ctx, row.image);
    return null;
  },
});
