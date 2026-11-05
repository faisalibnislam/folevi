"use client";

import type { CSSProperties, InputHTMLAttributes } from "react";

/**
 * Folevi's slider: a range input drawn in Folevi's own look (`.ui-slider` in globals.css: a sunken track filled
 * up to the value in the heading colour, a raised round-cornered thumb, the focus ring for the keyboard), never the
 * browser's default. It stays a native `<input type="range">`, so arrow keys, Page Up/Down, Home/End and assistive
 * tech work as they always do. For every slider in the app (Settings > Appearance, Foli DNA's layout controls).
 */
export function Slider({
  value,
  min,
  max,
  step,
  onValueChange,
  className = "",
  style,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "min" | "max" | "onChange"> & {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
}) {
  const fill = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <input
      {...rest}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onValueChange(Number(e.target.value))}
      className={`ui-slider ${className}`}
      style={{ ...style, ["--slider-fill" as string]: `${fill}%` } as CSSProperties}
    />
  );
}
