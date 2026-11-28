"use client";

import { useMutation } from "convex/react";
import { Check, Monitor, Moon, Sun, Type } from "lucide-react";
import { useIphoneLook } from "@/lib/iphone";
import { ChoiceRow, IosSection } from "@/components/iphone/SettingsKit";
import { RowIcon } from "@/components/iphone/Grouped";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { EDITOR_ZOOMS, EDITOR_ZOOM_KEY } from "@/lib/editorZoom";
import { Slider } from "@/components/ui/Slider";
import { Card } from "./Card";
import { useNoteColumnsPref } from "@/lib/app/useNoteColumns";

const ZOOMS = EDITOR_ZOOMS;

export function AppearanceSection() {
  const { appearance, setAppearance } = useAppState();
  const update = useMutation(api.users.updateProfile);
  const [zoom, setZoom] = useLocalStorage<number>(EDITOR_ZOOM_KEY, 1);
  const iphone = useIphoneLook();
  const applyZoom = (v: number) => {
    setZoom(v);
    document.documentElement.style.setProperty("--editor-zoom", String(v));
  };
  if (iphone) {
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const closest = ZOOMS.reduce((a, b) => (Math.abs(b - zoom) < Math.abs(a - zoom) ? b : a), 1);
    return (
      <>
        <IosSection footer="Dark mode is designed, not inverted: note colours are softened and code stays readable.">
          <ChoiceRow
            screen="theme"
            label="Theme"
            icon={<RowIcon>{appearance === "dark" ? <Moon /> : appearance === "light" ? <Sun /> : <Monitor />}</RowIcon>}
            value={appearance}
            choices={[
              { value: "light", label: "Light", icon: <RowIcon><Sun /></RowIcon> },
              { value: "dark", label: "Dark", icon: <RowIcon><Moon /></RowIcon> },
              { value: "system", label: "System", description: "Follows this device's Light or Dark appearance", icon: <RowIcon><Monitor /></RowIcon> },
            ]}
            onChange={(v) => {
              setAppearance(v);
              void update({ appearance: v });
            }}
          />
        </IosSection>
        <IosSection footer="The size of a note's text in the editor, on this device. iOS's own text size changes everything else.">
          <ChoiceRow
            screen="editor-text-size"
            label="Editor text size"
            icon={<RowIcon><Type /></RowIcon>}
            value={String(closest)}
            choices={ZOOMS.map((z) => ({ value: String(z), label: z === 1 ? `${pct(z)} (default)` : pct(z) }))}
            valueLabel={pct(closest)}
            onChange={(v) => applyZoom(Number(v))}
          />
        </IosSection>
      </>
    );
  }
  return (
    <>
      <Card title="Theme" description="Dark mode is designed, not inverted: document colors are softened and code stays readable.">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
          {(
            [
              ["light", "Light", "Always light"],
              ["dark", "Dark", "Always dark"],
              ["system", "System", "Matches your device"],
            ] as const
          ).map(([v, label, caption]) => {
            const chosen = appearance === v;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={chosen}
                onClick={() => {
                  setAppearance(v);
                  void update({ appearance: v });
                }}
                // Panel corners: the picture's 8px corners sit 6px in (8 + 6 = 14). The chosen tile is ringed in ink,
                // hover only tints, and a checked mark by the name says which one is on (not the ring alone).
                className={`group flex flex-col gap-2.5 rounded-panel p-1.5 pb-3 text-left outline-none transition-[background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-focus ${chosen ? "bg-surface shadow-[inset_0_0_0_2px_var(--color-heading)]" : "hover:bg-[var(--glass-hover)]"}`}
              >
                <ThemePicture theme={v} />
                <span className="flex items-start gap-2 px-1.5">
                  <span aria-hidden className={`mt-px grid size-4 flex-none place-items-center rounded-small ${chosen ? "bg-heading text-canvas" : "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]"}`}>
                    {chosen ? <Check size={10} strokeWidth={3.5} /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-subheadline leading-4 ${chosen ? "font-semibold text-heading" : "font-medium text-ink"}`}>{label}</span>
                    <span className="mt-0.5 block text-footnote text-muted">{caption}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>
      <NoteListsCard />
      <Card title="Editor text size">
        <label className="flex max-w-md items-center gap-3 text-subheadline">
          <span>Smaller</span>
          <Slider min={0.85} max={1.35} step={0.05} value={zoom} onValueChange={applyZoom} aria-label="Editor text size" className="flex-1" />
          <span>Larger</span>
        </label>
      </Card>
    </>
  );
}

// The theme pictures draw Folevi in each theme's own colors (design tokens' light and dark palettes), whatever the
// theme is now: a sidebar, a tab, and a note with a title, lines and two to-dos.
const PALETTES = {
  light: { canvas: "#FAF6F3", sidebar: "#F5EEEA", surface: "#FFFFFF", ink: "#1D1814", heading: "#4A2F2C", faint: "#D8C8C3", line: "#EDE3DF" },
  dark: { canvas: "#15110F", sidebar: "#1B1513", surface: "#211A18", ink: "#F6F0EC", heading: "#F7DDD1", faint: "#4D403C", line: "#352B28" },
} as const;

function Window({ p }: { p: (typeof PALETTES)[keyof typeof PALETTES] }) {
  const bar = (w: string, c: string, h = 3) => <span className="block rounded-tiny" style={{ width: w, height: h, background: c }} />;
  return (
    <span className="absolute inset-0 flex" style={{ background: p.canvas }}>
      <span className="flex w-[30%] flex-col gap-[7%] px-[5%] py-[9%]" style={{ background: p.sidebar, boxShadow: `inset -1px 0 0 ${p.line}` }}>
        {bar("70%", p.heading)}
        {bar("85%", p.faint)}
        {bar("60%", p.faint)}
        {bar("75%", p.faint)}
        {bar("55%", p.faint)}
      </span>
      <span className="flex flex-1 flex-col gap-[6%] px-[6%] py-[7%]">
        <span className="flex gap-[4%]">
          <span className="block h-[7px] w-[30%] rounded-tiny" style={{ background: p.surface, boxShadow: `0 0 0 1px ${p.line}` }} />
          {bar("18%", p.faint, 7)}
        </span>
        <span className="flex flex-1 flex-col gap-[7%] rounded-tiny px-[7%] py-[8%]" style={{ background: p.surface, boxShadow: `0 0 0 1px ${p.line}` }}>
          {bar("55%", p.heading, 5)}
          {bar("90%", p.faint)}
          {bar("75%", p.faint)}
          {[0, 1].map((i) => (
            <span key={i} className="flex items-center gap-[5%]">
              <span className="block size-[5px] flex-none" style={{ boxShadow: `inset 0 0 0 1px ${p.ink}` }} />
              {bar(i ? "45%" : "60%", p.faint)}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

function ThemePicture({ theme }: { theme: "light" | "dark" | "system" }) {
  return (
    <span aria-hidden className="ui-img-outline relative block aspect-[16/10] w-full overflow-hidden rounded-small">
      {theme === "dark" ? <Window p={PALETTES.dark} /> : <Window p={PALETTES.light} />}
      {/* System: light on the left half, dark on the right. */}
      {theme === "system" ? (
        <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
          <Window p={PALETTES.dark} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * How note lists open (docs/NOTE_COLUMNS.md): cards and rows filling the page, or the list in a column beside the
 * open note. Layout in the Sidebar menu flips the same choice.
 */
function NoteListsCard() {
  const [columns, setColumns] = useNoteColumnsPref();
  return (
    <Card title="Note lists" description="Folders, Drafts, All notes, Bookmarks, tags, Archive and Trash. Layout in the sidebar's menu (the panel button) switches it at any time.">
      <div role="radiogroup" aria-label="Note lists" className="grid max-w-lg grid-cols-2 gap-3">
        {(
          [
            [false, "Cards and rows", "A list fills the page"],
            [true, "Columns", "The list beside the open note"],
          ] as const
        ).map(([v, label, caption]) => {
          const chosen = columns === v;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => setColumns(v)}
              className={`group flex flex-col gap-2.5 rounded-panel p-1.5 pb-3 text-left outline-none transition-[background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-focus ${chosen ? "bg-surface shadow-[inset_0_0_0_2px_var(--color-heading)]" : "hover:bg-[var(--glass-hover)]"}`}
            >
              <ListsPicture columns={v} />
              <span className="flex items-start gap-2 px-1.5">
                <span aria-hidden className={`mt-px grid size-4 flex-none place-items-center rounded-small ${chosen ? "bg-heading text-canvas" : "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]"}`}>
                  {chosen ? <Check size={10} strokeWidth={3.5} /> : null}
                </span>
                <span className="min-w-0">
                  <span className={`block text-subheadline leading-4 ${chosen ? "font-semibold text-heading" : "font-medium text-ink"}`}>{label}</span>
                  <span className="mt-0.5 block text-footnote text-muted">{caption}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** A small drawing of each choice: a sidebar and cards, or a sidebar, a column of rows and a note. */
function ListsPicture({ columns }: { columns: boolean }) {
  const line = "h-1 rounded-tiny bg-[var(--color-line-strong)]";
  return (
    <span aria-hidden className="flex h-20 gap-1.5 overflow-hidden rounded-small bg-sunken p-1.5">
      <span className="flex w-1/6 flex-none flex-col gap-1 pt-1">
        <span className={`${line} w-3/4`} />
        <span className={`${line} w-2/3`} />
        <span className={`${line} w-3/4`} />
      </span>
      {columns ? (
        <>
          <span className="flex w-1/3 flex-none flex-col gap-1.5 pt-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className={`flex flex-col gap-0.5 rounded-tiny p-1 ${i === 0 ? "bg-surface" : ""}`}>
                <span className={`${line} w-3/4 !bg-heading/50`} />
                <span className={`${line} w-full`} />
              </span>
            ))}
          </span>
          <span className="flex flex-1 flex-col gap-1 rounded-tiny bg-surface p-1.5">
            <span className={`${line} w-1/2 !bg-heading/50`} />
            <span className={`${line} w-full`} />
            <span className={`${line} w-5/6`} />
          </span>
        </>
      ) : (
        <span className="grid flex-1 grid-cols-3 gap-1">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="rounded-tiny bg-surface" />
          ))}
        </span>
      )}
    </span>
  );
}
