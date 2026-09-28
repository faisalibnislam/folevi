"use client";

import { useMutation } from "convex/react";
import { Monitor, Moon, Sun } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { Card } from "./Card";

export function AppearanceSection() {
  const { appearance, setAppearance } = useAppState();
  const update = useMutation(api.users.updateProfile);
  const [zoom, setZoom] = useLocalStorage<number>("folevi:editor-zoom", 1);
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
              className={`flex flex-col items-center gap-2 rounded-[8px] border p-4 text-sm ${appearance === v ? "border-accent bg-accent-soft text-accent-soft-ink" : "border-line bg-surface"}`}
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
            onChange={(e) => {
              const v = Number(e.target.value);
              setZoom(v);
              document.documentElement.style.setProperty("--editor-zoom", String(v));
            }}
            aria-label="Editor text size"
            className="flex-1 accent-[var(--color-accent)]"
          />
          <span>Larger</span>
        </label>
      </Card>
    </>
  );
}
