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
        <div role="radiogroup" aria-label="Theme" className="grid max-w-md grid-cols-3 gap-3">
          {(
            [
              ["light", "Light", <Sun key="s" size={18} />],
              ["dark", "Dark", <Moon key="m" size={18} />],
              ["system", "System", <Monitor key="d" size={18} />],
            ] as const
          ).map(([v, label, icon]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={appearance === v}
              onClick={() => {
                setAppearance(v);
                void update({ appearance: v });
              }}
              // Hover tints the card; the chosen one has a firm ring and a check (not only a brighter border).
              className={`relative flex flex-col items-center gap-2 rounded-control border p-4 text-subheadline outline-none transition-[background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-focus ${appearance === v ? "border-transparent bg-accent-soft font-semibold text-heading shadow-[inset_0_0_0_2px_var(--color-heading)]" : "border-line bg-surface hover:bg-[var(--glass-hover)] hover:text-heading"}`}
            >
              {appearance === v ? (
                <span aria-hidden className="absolute right-2 top-2 grid h-4 w-4 place-items-center rounded-tiny bg-heading text-canvas">
                  <Check size={11} strokeWidth={3} />
                </span>
              ) : null}
              {icon}
              {label}
            </button>
          ))}
        </div>
      </Card>
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
