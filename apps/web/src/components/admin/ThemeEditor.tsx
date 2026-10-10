"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ImagePlus, Loader2, RotateCcw } from "lucide-react";
import { api } from "@/lib/convex/api";
import type { Id } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { errorMessage, useToast } from "@/components/ui/Toast";
import type { StylePalette } from "@/lib/palette";
import { BUILT_IN_THEMES, familyFor, FONT_POOL, FONT_TYPES, SHEETS, STANDARD_DEFAULTS, STANDARD_FONTS, TEXTS, THEME_PLANS, themesFrom, type FontSlot, type ThemeDefaults, type ThemeFonts, type ThemePlan, type ThemeRow } from "@/lib/themes";
import { ActionDialog } from "./ActionDialog";
import { useAdmin } from "./AdminApp";
import { rolesFor } from "./permissions";
import { requestMeta } from "./request";
import { ThemePreview } from "./ThemePreview";
import { STATUS_LABEL, STATUS_TONE } from "./ThemesView";
import { contrastRatio, prepareThemeImage, THEME_IMAGE_HINT } from "./themeImage";
import { Badge, Callout, DocTitle, inputCls, PageHeader, Panel } from "./ui";

type Image = { full: Id<"_storage">; half: Id<"_storage">; thumb: Id<"_storage">; width: number; height: number };

interface Form {
  name: string;
  palette: StylePalette | null;
  autoPalette: StylePalette | null;
  defaults: ThemeDefaults;
  fonts: ThemeFonts;
  plan: ThemePlan;
  /** A new image uploaded in this session (saved with the rest), with a local preview. */
  image: (Image & { preview: string }) | null;
}

const SLOT_NAMES: Record<FontSlot, string> = { modern: "Modern", serif: "Serif", mono: "Mono", soft: "Soft" };
const SEPARATORS: { id: ThemeDefaults["separator"]; name: string }[] = [
  { id: "line", name: "Line" },
  { id: "dots", name: "Dots" },
  { id: "doodle", name: "Doodle" },
];

/** Uploads one prepared image version; returns its storage id. */
async function upload(url: string, blob: Blob): Promise<Id<"_storage">> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "image/webp" }, body: blob });
  if (!res.ok) throw new Error("The image didn't upload. Try again.");
  return ((await res.json()) as { storageId: Id<"_storage"> }).storageId;
}

/** A colour as #rrggbb: a swatch and its hex, edited as text (no system colour picker). */
function HexField({ label, value, onChange, disabled, note }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; note?: ReactNode }) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = /^#[0-9a-f]{6}$/i.test(text);
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-20 flex-none truncate text-[12.5px] text-muted">
        {label}
      </label>
      <span aria-hidden className="size-7 flex-none rounded-chip shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: valid ? text : value }} />
      <input
        id={id}
        value={text}
        disabled={disabled}
        spellCheck={false}
        aria-invalid={!valid || undefined}
        onChange={(e) => {
          const v = e.target.value.trim();
          setText(v);
          if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toLowerCase());
        }}
        onBlur={() => setText(value)}
        className={`${inputCls} min-w-0 flex-1 font-mono text-[12.5px]`}
      />
      <span className="flex w-[72px] flex-none justify-end">{note}</span>
    </div>
  );
}

/** A contrast ratio, flagged when text would be hard to read. */
function Ratio({ a, b, min }: { a: string; b: string; min: number }) {
  const r = contrastRatio(a, b);
  const tone = r >= min ? "neutral" : r >= 3 ? "warning" : "danger";
  return (
    <Badge tone={tone} title={r >= min ? "Reads well" : `Below ${min}:1. Text in this colour may be hard to read.`}>
      {r.toFixed(1)}:1{r < min ? " low" : ""}
    </Badge>
  );
}

function Seg<T extends string>({ label, value, options, onChange, disabled, fontOf }: { label: string; value: T; options: { id: T; name: string }[]; onChange: (v: T) => void; disabled?: boolean; fontOf?: (id: T) => string }) {
  return (
    <div className="ui-seg ui-well" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" disabled={disabled} aria-pressed={value === o.id} onClick={() => onChange(o.id)} className="!flex-1" style={fontOf ? { fontFamily: fontOf(o.id), fontSizeAdjust: "ex-height 0.52" } : undefined}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[12.5px] font-semibold text-heading">{label}</p>
      {children}
      {hint ? <p className="text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * One theme in the Theme manager (or a new one, `themeKey` "new"): its image, name, colours (picked from
 * the image, each one editable, with contrast checks), what a note starts with when the theme is picked,
 * the typeface behind each font type, who can pick it, and its status. Changes are saved together; the
 * preview shows them as they're made.
 */
export function ThemeEditor({ themeKey }: { themeKey: string }) {
  const admin = useAdmin();
  const toast = useToast();
  const router = useRouter();
  const canEdit = admin.can("themes.edit");
  const isNew = themeKey === "new";
  const rows = useQuery(api.adminThemes.list, {});
  const uploadUrl = useMutation(api.adminThemes.uploadUrl);
  const create = useMutation(api.adminThemes.create);
  const update = useMutation(api.adminThemes.update);
  const setStatus = useMutation(api.adminThemes.setStatus);
  const resetBuiltIn = useMutation(api.adminThemes.resetBuiltIn);
  const deleteForever = useMutation(api.adminThemes.deleteForever);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "reset" | null>(null);

  const all = useMemo(() => (rows ? themesFrom(rows as ThemeRow[]) : null), [rows]);
  const theme = all?.find((t) => t.id === themeKey) ?? null;
  const row = (rows as ThemeRow[] | undefined)?.find((r) => r.key === themeKey) ?? null;
  const shipped = BUILT_IN_THEMES.find((t) => t.id === themeKey) ?? null;

  const initial = useMemo<Form | null>(() => {
    if (isNew) return { name: "", palette: null, autoPalette: null, defaults: STANDARD_DEFAULTS, fonts: STANDARD_FONTS, plan: "free", image: null };
    if (!theme) return null;
    const { id: _id, name, builtIn: _b, status: _s, plan, order: _o, defaults, fonts, image: _i, width: _w, height: _h, ...palette } = theme;
    const auto = (rows as (ThemeRow & { autoPalette?: StylePalette | null })[] | undefined)?.find((r) => r.key === themeKey)?.autoPalette ?? (shipped ? (({ id: _a, name: _n, builtIn: _bb, status: _ss, plan: _p, order: _oo, defaults: _d, fonts: _f, image: _ii, width: _ww, height: _hh, ...p }) => p)(shipped) : null);
    return { name, palette: palette as StylePalette, autoPalette: auto as StylePalette | null, defaults, fonts, plan, image: null };
  }, [isNew, theme, rows, themeKey, shipped]);

  const [form, setForm] = useState<Form | null>(null);
  // Load once the theme arrives (and again after a save brings the new saved values).
  const savedKey = JSON.stringify(initial);
  useEffect(() => {
    if (initial) setForm(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  if (!isNew && rows !== undefined && !theme) {
    return (
      <>
        <DocTitle>Theme not found</DocTitle>
        <PageHeader title="Theme not found" description={<Link href="/admin/themes" className="underline">Back to note themes</Link>} />
      </>
    );
  }
  if (!form) return <p className="text-sm text-muted">Loading…</p>;

  const dirty = JSON.stringify(form) !== savedKey;
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const setPalette = (patch: Partial<StylePalette>) => form.palette && set({ palette: { ...form.palette, ...patch } });
  const setAt = (key: "text" | "textDark" | "names" | "highlight" | "highlightDark", i: number, v: string) => {
    if (!form.palette) return;
    const next = [...form.palette[key]];
    next[i] = v;
    setPalette({ [key]: next });
  };
  const imageCss = form.image ? `url(${JSON.stringify(form.image.preview)})` : theme ? `url(${JSON.stringify(theme.image ? theme.image.half : `/covers/${theme.id}-1x.webp`)})` : null;
  const status = theme?.status ?? "draft";
  const custom = !shipped;

  const pickImage = async (file: File) => {
    setBusy("image");
    try {
      const prepared = await prepareThemeImage(file);
      const [full, half, thumb] = await Promise.all([prepared.full, prepared.half, prepared.thumb].map(async (b) => upload(await uploadUrl({}), b)));
      // A new image brings its own colours (any colour changes start again from them).
      set({ image: { full: full!, half: half!, thumb: thumb!, width: prepared.width, height: prepared.height, preview: prepared.preview }, palette: prepared.palette, autoPalette: prepared.palette });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!form.name.trim()) return toast.show("Give the theme a name.", { tone: "error" });
    if (!form.palette) return toast.show("Add an image first.", { tone: "error" });
    setBusy("save");
    try {
      const meta = await requestMeta();
      const image = form.image ? { full: form.image.full, half: form.image.half, thumb: form.image.thumb, width: form.image.width, height: form.image.height } : undefined;
      if (isNew) {
        if (!image) throw new Error("Add an image first.");
        const key = await create({ name: form.name, image, palette: form.palette, autoPalette: form.autoPalette ?? form.palette, defaults: form.defaults, fonts: form.fonts, plan: form.plan, ...meta });
        toast.show("Theme saved as a draft. Publish it when it's ready.", { tone: "success" });
        router.replace(`/admin/themes/${key}`);
        return;
      }
      const was = initial!;
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      await update({
        key: themeKey,
        ...(form.name !== was.name ? { name: form.name } : {}),
        ...(image ? { image, autoPalette: form.autoPalette ?? undefined } : {}),
        ...(!same(form.palette, was.palette) ? { palette: form.palette } : {}),
        ...(!same(form.defaults, was.defaults) ? { defaults: form.defaults } : {}),
        ...(!same(form.fonts, was.fonts) ? { fonts: form.fonts } : {}),
        ...(form.plan !== was.plan ? { plan: form.plan } : {}),
        ...meta,
      });
      toast.show("Theme saved.", { tone: "success" });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = async (next: "draft" | "published" | "retired") => {
    if (dirty) return toast.show("Save your changes first.", { tone: "error" });
    setBusy(next);
    try {
      await setStatus({ key: themeKey, status: next, ...(await requestMeta()) });
      toast.show(next === "published" ? "Published. People can pick it now." : next === "retired" ? "Retired. It's out of the picker; notes using it keep it." : "Moved to drafts. It's out of the picker.", { tone: "success" });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const p = form.palette;
  const disabled = !canEdit || Boolean(busy);
  const title = isNew ? "New theme" : form.name || "Untitled theme";
  const published = (all ?? []).filter((t) => t.status === "published" && t.id !== themeKey);

  return (
    <>
      <DocTitle>{title}</DocTitle>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin/themes" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-heading">
              <ArrowLeft size={13} aria-hidden /> Note themes
            </Link>
            {!isNew ? <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge> : <Badge tone="outline">Draft</Badge>}
            {shipped ? <Badge>Built in</Badge> : !isNew ? <Badge>Added</Badge> : null}
          </>
        }
        title={title}
        actions={
          canEdit ? (
            <>
              {!isNew && status !== "published" ? (
                <Button variant="secondary" disabled={disabled} onClick={() => void changeStatus("published")}>
                  {status === "retired" ? "Publish again" : "Publish"}
                </Button>
              ) : null}
              {!isNew && status === "published" ? (
                <>
                  <Button variant="secondary" disabled={disabled} onClick={() => void changeStatus("draft")}>
                    Move to drafts
                  </Button>
                  <Button variant="secondary" disabled={disabled} onClick={() => void changeStatus("retired")}>
                    Retire
                  </Button>
                </>
              ) : null}
              <Button variant="primary" disabled={disabled || (!dirty && !isNew)} aria-busy={busy === "save"} onClick={() => void save()}>
                {busy === "save" ? <Loader2 size={15} className="mr-1.5 animate-spin" aria-hidden /> : null}
                {isNew ? "Save as draft" : "Save changes"}
              </Button>
            </>
          ) : null
        }
      />
      {!canEdit ? (
        <div className="mb-4">
          <Callout>Read-only for your role. {rolesFor("themes.edit")}</Callout>
        </div>
      ) : null}
      {status === "retired" ? (
        <div className="mb-4">
          <Callout title="Retired">Out of the picker. Notes that already use it keep it.</Callout>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <Panel title="Image and name" description="The image is the note's cover and page background. Its colours are picked from it.">
            <div className="flex flex-wrap items-start gap-4">
              <span aria-hidden className="block aspect-[16/10] w-48 flex-none rounded-control bg-sunken" style={imageCss ? { background: `${imageCss} center / cover no-repeat` } : undefined} />
              <div className="min-w-0 flex-1 space-y-3">
                <Field label="Name">
                  <input value={form.name} maxLength={40} disabled={disabled} onChange={(e) => set({ name: e.target.value })} className={inputCls} aria-label="Name" placeholder="Ultramarine" />
                </Field>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void pickImage(f);
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" disabled={disabled} aria-busy={busy === "image"} onClick={() => fileInput.current?.click()}>
                    {busy === "image" ? <Loader2 size={14} className="mr-1.5 animate-spin" aria-hidden /> : <ImagePlus size={14} className="mr-1.5" aria-hidden />}
                    {busy === "image" ? "Preparing…" : imageCss ? "Replace image…" : "Choose image…"}
                  </Button>
                </div>
                <p className="text-[12px] text-muted">{THEME_IMAGE_HINT} A new image brings its own colours.</p>
              </div>
            </div>
          </Panel>

          {p ? (
            <Panel
              title="Colours"
              description="Picked from the image. Change any of them; text colours need 4.5:1 against the page to read well."
              actions={
                form.autoPalette && JSON.stringify(p) !== JSON.stringify(form.autoPalette) ? (
                  <Button variant="ghost" size="sm" disabled={disabled} onClick={() => set({ palette: form.autoPalette })}>
                    <RotateCcw size={13} className="mr-1.5" aria-hidden /> Use the image's colours
                  </Button>
                ) : null
              }
            >
              <div className="grid gap-5 md:grid-cols-2">
                {(["light", "dark"] as const).map((mode) => {
                  const d = mode === "dark";
                  const paper = d ? p.paperDark : p.paper;
                  return (
                    <div key={mode} className="space-y-2">
                      <p className="ui-caps">{d ? "Dark mode" : "Light mode"}</p>
                      <HexField label="Page" value={paper} disabled={disabled} onChange={(v) => setPalette(d ? { paperDark: v } : { paper: v })} />
                      <HexField label="Text" value={d ? p.inkDark : p.ink} disabled={disabled} onChange={(v) => setPalette(d ? { inkDark: v } : { ink: v })} note={<Ratio a={d ? p.inkDark : p.ink} b={paper} min={7} />} />
                      <HexField label="Accent" value={d ? p.accentDark : p.accent} disabled={disabled} onChange={(v) => setPalette(d ? { accentDark: v } : { accent: v })} note={<Ratio a={d ? p.accentDark : p.accent} b={paper} min={4.5} />} />
                      <p className="pt-2 text-[12px] font-semibold text-heading">Text colours</p>
                      {(d ? p.textDark : p.text).map((c, i) => (
                        <HexField key={`t${i}`} label={p.names[i] ?? `Colour ${i + 1}`} value={c} disabled={disabled} onChange={(v) => setAt(d ? "textDark" : "text", i, v)} note={<Ratio a={c} b={paper} min={4.5} />} />
                      ))}
                      <p className="pt-2 text-[12px] font-semibold text-heading">Highlights</p>
                      {(d ? p.highlightDark : p.highlight).map((c, i) => (
                        <HexField key={`h${i}`} label={`Highlight ${i + 1}`} value={c} disabled={disabled} onChange={(v) => setAt(d ? "highlightDark" : "highlight", i, v)} note={<Ratio a={d ? p.inkDark : p.ink} b={c} min={4.5} />} />
                      ))}
                    </div>
                  );
                })}
              </div>
              <div className="mt-5 space-y-2">
                <p className="text-[12px] font-semibold text-heading">Colour names (shown in the text colour menu)</p>
                <div className="grid gap-2 sm:grid-cols-5">
                  {p.names.map((n, i) => (
                    <input key={i} value={n} maxLength={24} disabled={disabled} aria-label={`Name of text colour ${i + 1}`} onChange={(e) => setAt("names", i, e.target.value)} className={inputCls} />
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <span className="text-[12.5px] text-muted">Title on the cover</span>
                  <Seg label="Title on the cover" value={p.tone} disabled={disabled} options={[{ id: "deep", name: "White" }, { id: "light", name: "Text colour" }]} onChange={(tone) => setPalette({ tone })} />
                </div>
              </div>
            </Panel>
          ) : null}

          <Panel title="What a note starts with" description="Picking the theme sets these on the note. People can change them afterwards.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Document colour" hint="Auto uses the page colour above.">
                <Select value={form.defaults.sheet ?? "auto"} disabled={disabled} aria-label="Document colour" onChange={(e) => set({ defaults: { ...form.defaults, sheet: e.target.value === "auto" ? undefined : (e.target.value as ThemeDefaults["sheet"]) } })}>
                  <option value="auto">Auto (from the image)</option>
                  {SHEETS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Text colour" hint="Auto uses the text colour above.">
                <Select value={form.defaults.text ?? "auto"} disabled={disabled} aria-label="Text colour" onChange={(e) => set({ defaults: { ...form.defaults, text: e.target.value === "auto" ? undefined : (e.target.value as ThemeDefaults["text"]) } })}>
                  <option value="auto">Auto (from the image)</option>
                  {TEXTS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Separator">
                <Seg label="Separator" value={form.defaults.separator} options={SEPARATORS} disabled={disabled} onChange={(separator) => set({ defaults: { ...form.defaults, separator } })} />
              </Field>
              <Field label="Font">
                <Seg label="Font" value={form.defaults.font} options={FONT_TYPES.map((f) => ({ id: f.id, name: f.name }))} disabled={disabled} fontOf={(id) => familyFor(id, form.fonts)} onChange={(font) => set({ defaults: { ...form.defaults, font } })} />
              </Field>
            </div>
          </Panel>

          <Panel title="Typefaces" description="The family behind each font type in this theme. People only see Modern, Serif, Mono and Soft.">
            <div className="grid gap-4 sm:grid-cols-2">
              {(Object.keys(SLOT_NAMES) as FontSlot[]).map((slot) => (
                <Field key={slot} label={SLOT_NAMES[slot]} hint={<span style={{ fontFamily: familyFor(FONT_TYPES.find((f) => f.slot === slot)!.id, form.fonts), fontSize: 15 }}>The quick brown fox, <em>italic</em> and <strong>bold</strong>.</span>}>
                  <Select value={form.fonts[slot]} disabled={disabled} aria-label={`${SLOT_NAMES[slot]} typeface`} onChange={(e) => set({ fonts: { ...form.fonts, [slot]: e.target.value } })}>
                    {FONT_POOL[slot].map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          </Panel>

          <Panel title="Who can pick it" description="Notes that already use it keep it, whatever the plan.">
            <div className="max-w-xs">
              <Select value={form.plan} disabled={disabled} aria-label="Who can pick it" onChange={(e) => set({ plan: e.target.value as ThemePlan })}>
                {THEME_PLANS.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name}
                  </option>
                ))}
              </Select>
            </div>
          </Panel>

          {!isNew && canEdit ? (
            <Panel title={custom ? "Delete" : "Back to how it shipped"} description={custom ? "Deletes the theme and its image. Notes that use it move to a theme you pick." : "Undoes every change to this built-in theme: name, image, colours, defaults, typefaces, plan, status and position."}>
              {custom ? (
                <Button variant="danger" disabled={disabled} onClick={() => setConfirm("delete")}>
                  Delete theme…
                </Button>
              ) : (
                <Button variant="secondary" disabled={disabled || !row} onClick={() => setConfirm("reset")}>
                  <RotateCcw size={14} className="mr-1.5" aria-hidden /> Reset to shipped
                </Button>
              )}
            </Panel>
          ) : null}
        </div>

        <aside className="space-y-3 lg:sticky lg:top-4" aria-label="Preview">
          <div className="flex items-center justify-between">
            <p className="ui-caps">Preview</p>
            <Seg label="Preview mode" value={dark ? "dark" : "light"} options={[{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }]} onChange={(m) => setDark(m === "dark")} />
          </div>
          {p ? (
            <ThemePreview theme={{ name: form.name, image: imageCss, palette: p, defaults: form.defaults, fonts: form.fonts }} dark={dark} />
          ) : (
            <div className="grid aspect-[4/5] place-items-center rounded-panel bg-sunken px-6 text-center text-sm text-muted">Choose an image to see the theme.</div>
          )}
        </aside>
      </div>

      <ActionDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        title={`Delete “${form.name || "this theme"}”?`}
        description="It leaves the picker now. Notes that use it move to the theme you pick (with its colours, separator and font), then the theme and its image are deleted. This can't be undone."
        confirmLabel="Delete theme"
        tone="danger"
        fields={[{ name: "replacement", label: "Move its notes to", type: "select", initial: published[0]?.id ?? "", options: published.map((t) => ({ value: t.id, label: t.name })) }]}
        onSubmit={async ({ reason, fields, meta }) => {
          await deleteForever({ key: themeKey, replacement: fields.replacement!, reason, ...meta });
          router.replace("/admin/themes");
          return "Deleting. Its notes are moving to the theme you picked.";
        }}
      />
      <ActionDialog
        open={confirm === "reset"}
        onClose={() => setConfirm(null)}
        title={`Reset “${shipped?.name ?? form.name}”?`}
        description="It goes back to exactly how it shipped. Notes that use it redraw with the shipped colours and typefaces; their own settings stay."
        confirmLabel="Reset to shipped"
        onSubmit={async ({ reason, meta }) => {
          await resetBuiltIn({ key: themeKey, reason, ...meta });
          return "Back to how it shipped.";
        }}
      />
    </>
  );
}

