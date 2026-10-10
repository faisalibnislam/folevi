"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ImagePlus, Loader2, Lock, Search } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useRadioGroup } from "@/lib/a11y/radioGroup";
import { COVER_IMAGE_ACCEPT } from "@/lib/app/coverImage";
import { COVER_IMAGE_HINT, coverArtThumbUrl } from "@/lib/cover";
import { familyFor, FONT_TYPES, planAllows, SHEETS, STANDARD_FONTS, TEXTS, THEME_PLANS, type FontType, type NoteTheme, type ThemeDefaults, type ThemeFonts, type ThemePlan } from "@/lib/themes";

/** The sample every card writes in its theme's fonts. */
const SAMPLE = "Slow mornings make fast afternoons. A list, a thought, a plan for later.";
const PLAIN_PAPER = "linear-gradient(180deg, #f6f6f8, #ececef)";

type Filter = "all" | FontType;

const isDark = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";

/** A small page in a theme: its title in the title face, a line of text in the body face, its colours. */
function Sheet({ name, defaults, fonts, paper, ink, accent, highlights }: { name: string; defaults: ThemeDefaults; fonts: ThemeFonts; paper: string; ink: string; accent?: string; highlights?: string[] }) {
  const title = familyFor(defaults.font === "sans" ? "serif" : defaults.font, fonts);
  return (
    <div className="absolute bottom-0 left-1/2 top-9 w-[70%] -translate-x-1/2 rounded-t-chip px-3 pt-2.5 shadow-[0_8px_22px_-8px_rgb(0_0_0/0.45)]" style={{ background: paper, color: ink }}>
      <p className="truncate text-[19px] font-semibold leading-tight" style={{ fontFamily: title, fontSizeAdjust: defaults.font === "mono" ? "ex-height 0.55" : defaults.font === "rounded" ? "ex-height 0.52" : "ex-height 0.45" }}>
        {name}
      </p>
      <p className="mt-1 line-clamp-2 text-[11.5px] leading-[1.45] opacity-85" style={{ fontFamily: familyFor(defaults.font, fonts) }}>
        {SAMPLE}
      </p>
      {accent || highlights?.length ? (
        <span aria-hidden className="mt-2 flex items-center gap-1">
          {accent ? <span className="size-2.5 rounded-tiny" style={{ background: accent }} /> : null}
          {highlights?.slice(0, 3).map((h, i) => (
            <span key={i} className="h-2.5 w-4 rounded-tiny" style={{ background: h }} />
          ))}
        </span>
      ) : null}
    </div>
  );
}

function Card({ label, on, onPick, art, footer, locked, children }: { label: string; on: boolean; onPick: () => void; art: string; footer: ReactNode; locked?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={label}
      onClick={onPick}
      className={`group relative flex flex-col overflow-hidden rounded-control bg-surface text-left transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${on ? "shadow-[0_0_0_2px_var(--color-heading)]" : "shadow-[var(--shadow-card)]"}`}
    >
      <span aria-hidden className="relative block aspect-[4/3] overflow-hidden" style={{ background: art }}>
        {children}
        {on ? (
          <span className="absolute right-1 top-1 grid size-6 place-items-center rounded-chip bg-heading text-canvas">
            <Check size={14} strokeWidth={2.5} />
          </span>
        ) : locked ? (
          <span className="absolute right-1 top-1 flex h-6 items-center gap-1 rounded-chip bg-[rgb(0_0_0/0.6)] px-1.5 text-[11px] font-semibold text-white backdrop-blur-sm">
            <Lock size={11} strokeWidth={2.5} /> {locked}
          </span>
        ) : null}
      </span>
      <span className="flex min-h-11 items-center gap-2 px-3 py-2">{footer}</span>
    </button>
  );
}

const fontNameOf = (t: { defaults: ThemeDefaults }) => FONT_TYPES.find((f) => f.id === t.defaults.font)?.name ?? "Modern";

/**
 * The note theme gallery (Style → Note Theme): every theme as a card showing its image and a small page in
 * its colours and fonts, Plain, your own image, and an upload. Picking one applies it straight away (the
 * note shows it behind), so people can try a few before closing. Themes above the note's plan show a lock.
 */
export function ThemeGallery({
  open,
  onClose,
  themes,
  currentId,
  plain,
  ownImage,
  plan,
  onPickTheme,
  onPickPlain,
  onUpload,
  uploading,
}: {
  open: boolean;
  onClose: () => void;
  themes: NoteTheme[];
  /** The note's theme id, "plain", or "image". */
  currentId: string;
  plain: ThemeDefaults;
  ownImage: string | null;
  plan: ThemePlan | null;
  onPickTheme: (t: NoteTheme) => void;
  onPickPlain: () => void;
  onUpload: (file: File) => void;
  uploading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // A theme above the note's plan says so here (a toast would sit behind the modal).
  const [notice, setNotice] = useState<string | null>(null);
  const group = useRadioGroup();
  const fileInput = useRef<HTMLInputElement>(null);
  const dark = isDark();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return themes.filter((t) => (filter === "all" || t.defaults.font === filter) && (!q || t.name.toLowerCase().includes(q)));
  }, [themes, filter, query]);
  const extras = filter === "all" && !query.trim();
  const sheetOf = (d: ThemeDefaults, paper: string, ink: string) => {
    const sheet = SHEETS.find((s) => s.id === d.sheet);
    const night = d.sheet === "night";
    return { paper: sheet?.color ?? paper, ink: TEXTS.find((x) => x.id === d.text)?.color ?? (night ? "#f2f2f4" : sheet ? "#1c1c1f" : ink) };
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Note theme"
      description="A theme sets the cover and background, the colours, the separator and the font. You can change any of them afterwards."
      footer={
        <div className="flex w-full flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            name="note-style-image"
            accept={COVER_IMAGE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onUpload(file);
            }}
          />
          <Button variant="secondary" disabled={uploading} aria-busy={uploading || undefined} onClick={() => fileInput.current?.click()}>
            {uploading ? <Loader2 size={15} aria-hidden className="mr-1.5 animate-spin" /> : <ImagePlus size={15} aria-hidden className="mr-1.5" />}
            {uploading ? "Uploading…" : ownImage ? "Replace your image…" : "Use your own image…"}
          </Button>
          <p className="min-w-0 flex-1 text-[12px] text-muted">{COVER_IMAGE_HINT}</p>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="sticky -top-4 z-10 -mx-6 -mt-4 mb-4 flex flex-wrap items-center gap-3 bg-[var(--glass-pop)] px-6 pb-3 pt-4 backdrop-blur-[28px]">
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Search themes</span>
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search themes" className="ui-input h-9 w-full rounded-control pl-9 pr-3 text-[13.5px]" />
        </label>
        <div className="ui-seg ui-well" role="group" aria-label="Show themes that start in">
          {[{ id: "all" as const, name: "All" }, ...FONT_TYPES].map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} style={f.id === "all" ? undefined : { fontFamily: familyFor(f.id as FontType), fontSizeAdjust: "ex-height 0.52" }}>
              {f.name}
            </button>
          ))}
        </div>
      </div>

      {notice ? (
        <p role="status" className="mb-3 flex items-center gap-2 rounded-control bg-[var(--glass-hover)] px-3 py-2.5 text-[13px] text-heading">
          <Lock size={14} aria-hidden className="flex-none" /> {notice}
        </p>
      ) : null}
      <div role="radiogroup" aria-label="Note theme" ref={group.ref} onKeyDown={group.onKeyDown} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {extras ? (
          <Card label="Plain" on={currentId === "plain"} onPick={onPickPlain} art={PLAIN_PAPER} footer={<><span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-heading">Plain</span><span className="text-[11.5px] text-muted">Serif</span></>}>
            <Sheet name="Plain" defaults={plain} fonts={STANDARD_FONTS} paper={dark ? "#1c1c1f" : "#ffffff"} ink={dark ? "#f2f2f4" : "#1c1c1f"} />
          </Card>
        ) : null}
        {extras && ownImage ? (
          <Card label="Note theme: Your image" on={currentId === "image"} onPick={() => undefined} art={`${ownImage} center / cover no-repeat`} footer={<><span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-heading">Your image</span><span className="text-[11.5px] text-muted">Standard fonts</span></>}>
            {null}
          </Card>
        ) : null}
        {shown.map((t) => {
          const needs = t.plan !== "free" && plan && !planAllows(plan, t.plan) && t.id !== currentId ? THEME_PLANS.find((p) => p.id === t.plan)?.name.replace(" and up", "+") : undefined;
          const { paper, ink } = sheetOf(t.defaults, dark ? t.paperDark : t.paper, dark ? t.inkDark : t.ink);
          return (
            <Card
              key={t.id}
              label={`Note theme: ${t.name}${needs ? ` (${THEME_PLANS.find((p) => p.id === t.plan)?.name})` : ""}`}
              on={t.id === currentId}
              onPick={() => {
                if (needs) return setNotice(`${t.name} is for ${THEME_PLANS.find((p) => p.id === t.plan)?.name.replace(" and up", " plans and up")}. Change your plan in Settings, under Plan & billing.`);
                setNotice(null);
                onPickTheme(t);
              }}
              art={`url(${coverArtThumbUrl(t.id)}) center / cover no-repeat`}
              locked={needs}
              footer={
                <>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-heading">{t.name}</span>
                  <span className="flex-none text-[11.5px] text-muted">{fontNameOf(t)}</span>
                </>
              }
            >
              <Sheet name={t.name} defaults={t.defaults} fonts={t.fonts} paper={paper} ink={ink} accent={t.defaults.sheet ? undefined : dark ? t.accentDark : t.accent} highlights={t.defaults.sheet ? undefined : dark ? t.highlightDark : t.highlight} />
            </Card>
          );
        })}
      </div>
      {shown.length === 0 && !extras ? <p className="py-10 text-center text-sm text-muted">No themes match.</p> : null}
    </Dialog>
  );
}
