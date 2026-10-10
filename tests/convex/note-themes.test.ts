import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { applyThemeDefaults, BUILT_IN_THEME_KEYS, builtInSetup, FONT_POOL, isFontId, STANDARD_FONTS, type FontSlot } from "../../convex/lib/themes";
import { person, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function newDoc(p: Person, title = "Doc") {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    scope: p.scope,
    deviceId: "device-themes",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

const setTheme = (p: Person, documentId: string, key: string, style?: Record<string, unknown>) =>
  p.as.mutation(api.sync.push, {
    scope: p.scope,
    deviceId: "device-themes",
    ops: [{ opId: ulid(), kind: "document.update", documentId, patch: { cover: { kind: "art", value: key }, ...(style ? { style } : {}) }, baseRevision: null }] as never,
  });

const docRow = (t: T, publicId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("documents")
      .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
      .unique(),
  );

/** An admin's change to a theme (as the Theme manager writes it). */
const themeRow = (t: T, key: string, fields: { status?: "draft" | "published" | "retired"; plan?: "free" | "core" | "pro" | "pro_ai" }) =>
  t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("noteThemes", { key, status: fields.status ?? "published", plan: fields.plan ?? "free", order: 1, createdAt: now, updatedAt: now });
  });

const endTrial = (t: T, p: Person) =>
  t.run(async (ctx) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", p.profileId as Id<"profiles">))
      .unique();
    if (sub) await ctx.db.patch(sub._id, { trialEndsAt: Date.now() - 1 });
  });

describe("note themes", () => {
  test("every built-in theme is set up with typefaces from the pool", () => {
    expect(BUILT_IN_THEME_KEYS).toHaveLength(57);
    for (const key of BUILT_IN_THEME_KEYS) {
      const setup = builtInSetup(key)!;
      for (const slot of Object.keys(FONT_POOL) as FontSlot[]) expect(isFontId(slot, setup.fonts[slot]), `${key} ${slot}`).toBe(true);
    }
    for (const slot of Object.keys(FONT_POOL) as FontSlot[]) {
      expect(FONT_POOL[slot].length).toBeGreaterThanOrEqual(4);
      expect(isFontId(slot, STANDARD_FONTS[slot])).toBe(true);
    }
  });

  test("a theme's defaults replace the colours, separator and font type, and nothing else", () => {
    const style = { font: "mono", width: "wide", background: "paper", accent: "accent", card: "folio", sheet: "ivory", text: "navy", separator: "dots", blur: true } as const;
    expect(applyThemeDefaults({ ...style }, { font: "serif", separator: "doodle" })).toEqual({ font: "serif", width: "wide", background: "paper", accent: "accent", card: "folio", separator: "doodle", blur: true });
    expect(applyThemeDefaults({ ...style }, { font: "sans", separator: "line", sheet: "night" })).toMatchObject({ font: "sans", separator: "line", sheet: "night" });
  });

  test("picking a theme: drafts and retired themes are refused, paid ones need the plan, and a note keeps what it has", async () => {
    const t = setup();
    const a = await person(t, "themes-a@example.com");
    const doc = await newDoc(a);
    await themeRow(t, "art-05", { status: "draft" });
    await themeRow(t, "art-06", { status: "retired" });
    await themeRow(t, "art-07", { plan: "pro" });
    expect((await setTheme(a, doc, "art-05"))[0]!.status).not.toBe("applied");
    expect((await setTheme(a, doc, "art-06"))[0]!.status).not.toBe("applied");
    expect((await setTheme(a, doc, "art-99-missing"))[0]!.status).not.toBe("applied");
    // On the Pro trial a Pro theme is fine; on Free it isn't, but the note that has it keeps it.
    expect((await setTheme(a, doc, "art-07"))[0]!.status).toBe("applied");
    await endTrial(t, a);
    expect(await a.as.query(api.themes.planForDocument, { documentId: doc })).toBe("free");
    const other = await newDoc(a, "Other");
    expect((await setTheme(a, other, "art-07"))[0]!.status).not.toBe("applied");
    expect((await setTheme(a, doc, "art-07", { font: "serif", width: "wide", background: "paper", accent: "accent", card: "folio" }))[0]!.status).toBe("applied");
    expect((await docRow(t, doc))!.cover).toEqual({ kind: "art", value: "art-07" });
    // Free themes are fine on Free.
    expect((await setTheme(a, other, "art-27"))[0]!.status).toBe("applied");
  });

  test("the public list leaves out drafts of added themes; the admin list and changes need a role", async () => {
    const t = setup();
    const a = await person(t, "themes-list@example.com");
    await themeRow(t, "art-03", { status: "retired" });
    await themeRow(t, `th-${ulid()}`, { status: "draft" });
    const list = await a.as.query(api.themes.list, {});
    expect(list.map((r) => r.key)).toEqual(["art-03"]);
    await expect(a.as.query(api.adminThemes.list, {})).rejects.toThrow();
    await expect(a.as.mutation(api.adminThemes.setStatus, { key: "art-03", status: "published" })).rejects.toThrow();
    await t.run(async (ctx) => {
      await ctx.db.patch(a.profileId as Id<"profiles">, { platformRole: "support_admin" });
    });
    // Support staff can look, not change.
    expect((await a.as.query(api.adminThemes.list, {})).length).toBe(2);
    await expect(a.as.mutation(api.adminThemes.setStatus, { key: "art-03", status: "published" })).rejects.toThrow();
    await t.run(async (ctx) => {
      await ctx.db.patch(a.profileId as Id<"profiles">, { platformRole: "ops_admin" });
    });
    await a.as.mutation(api.adminThemes.setStatus, { key: "art-03", status: "published" });
    await a.as.mutation(api.adminThemes.update, { key: "art-03", plan: "core", fonts: { modern: "figtree", serif: "lora", mono: "space-mono", soft: "nunito" } });
    await expect(a.as.mutation(api.adminThemes.update, { key: "art-03", fonts: { modern: "comic-sans", serif: "lora", mono: "space-mono", soft: "nunito" } })).rejects.toThrow();
    const row = (await a.as.query(api.themes.list, {})).find((r) => r.key === "art-03")!;
    expect(row).toMatchObject({ status: "published", plan: "core", fonts: { serif: "lora" } });
    // Every change is in the audit log.
    const actions = await t.run(async (ctx) => (await ctx.db.query("adminAuditLogs").collect()).map((l) => l.action));
    expect(actions).toEqual(expect.arrayContaining(["theme.set_status", "theme.update"]));
  });

  test("resetting notes puts each themed note on its theme's defaults; deleting a theme moves its notes", async () => {
    const t = setup();
    const a = await person(t, "themes-reset@example.com");
    const doc = await newDoc(a);
    // A note on Black satin with its own colours and font, from before themes set them.
    await setTheme(a, doc, "art-51", { font: "mono", width: "wide", background: "paper", accent: "accent", card: "folio", sheet: "ivory", text: "navy", separator: "dots" });
    const before = (await docRow(t, doc))!;
    await t.mutation(internal.themes.resetNotesToThemeDefaults, {});
    await t.finishAllScheduledFunctions(() => undefined);
    const after = (await docRow(t, doc))!;
    expect(after.style).toMatchObject({ font: "serif", separator: "line", sheet: "night" });
    expect(after.style.text).toBeUndefined();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.seq).toBeGreaterThan(before.seq);

    // An added theme, deleted for good: the note moves to the replacement, then the theme goes.
    const key = `th-${ulid()}`;
    await themeRow(t, key, {});
    await t.run(async (ctx) => {
      const d = await ctx.db.get(after._id);
      await ctx.db.patch(after._id, { cover: { kind: "art", value: key }, revision: d!.revision });
      await ctx.db.patch(a.profileId as Id<"profiles">, { platformRole: "super_admin" });
    });
    await a.as.mutation(api.adminThemes.deleteForever, { key, replacement: "art-03", reason: "Cleaning up a test theme." });
    await t.finishAllScheduledFunctions(() => undefined);
    const moved = (await docRow(t, doc))!;
    expect(moved.cover).toEqual({ kind: "art", value: "art-03" });
    expect(moved.style).toMatchObject({ font: "serif", separator: "doodle" });
    expect(await t.run(async (ctx) => ctx.db.query("noteThemes").withIndex("by_key", (q) => q.eq("key", key)).unique())).toBeNull();
  });
});
