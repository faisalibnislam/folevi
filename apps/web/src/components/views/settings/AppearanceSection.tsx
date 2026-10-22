"use client";

import { useMutation } from "convex/react";
import { Monitor, Moon, Sun, Type } from "lucide-react";
import { useIphoneLook } from "@/lib/iphone";
import { ChoiceRow, IosSection } from "@/components/iphone/SettingsKit";
import { RowIcon } from "@/components/iphone/Grouped";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { Card } from "./Card";

const ZOOMS = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35];

export function AppearanceSection() {
  const { appearance, setAppearance } = useAppState();
  const update = useMutation(api.users.updateProfile);
  const [zoom, setZoom] = useLocalStorage<number>("folevi:editor-zoom", 1);
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
              className={`flex flex-col items-center gap-2 rounded-control border p-4 text-sm ${appearance === v ? "border-accent bg-accent-soft text-accent-soft-ink" : "border-line bg-surface"}`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </Card>
      <Card title="Editor text size">
        <label className="flex max-w-md items-center gap-3 text-sm">
          <span>Smaller</span>
          <input
            type="range"
            min={0.85}
            max={1.35}
            step={0.05}
            value={zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
            aria-label="Editor text size"
            className="flex-1 accent-[var(--color-accent)]"
          />
          <span>Larger</span>
        </label>
      </Card>
    </>
  );
}
