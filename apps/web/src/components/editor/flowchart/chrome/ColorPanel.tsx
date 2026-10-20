"use client";

// Colours for the selected shapes: fill (the theme's soft tints, which follow light and dark and the note's
// palette, or a custom colour, or none), outline (colour, width, style) and the label's text colour (the
// note editor's text colours). A custom fill keeps its label readable in both themes: the model picks a
// dark or light label for it (customFillInk), and custom colours are the same in light and dark.
import { useState } from "react";
import { Ban } from "lucide-react";
import { FLOWCHART_COLORS, FLOWCHART_COLOR_LABEL, TextColorValues, type FlowColor, type FlowNode, type TextColor } from "../schema";
import { parseHex, type Paint } from "../contentOps";
import { FlowPanel } from "./FlowPanel";

/** Custom colours offered as swatches: soft and strong tones, and neutrals. */
export const CUSTOM_COLORS = [
  "#fee2e2", "#ffedd5", "#fef3c7", "#dcfce7", "#cffafe", "#dbeafe", "#ede9fe", "#fce7f3",
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
  "#ffffff", "#e4e4e7", "#71717a", "#18181b",
] as const;

const TEXT_LABEL: Record<TextColor, string> = { muted: "Grey", accent: "Accent", moss: "Green", marigold: "Orange", plum: "Purple", coral: "Red" };
const WIDTHS = [1, 1.5, 2, 3, 4] as const;
const STYLES = [
  { value: "solid", label: "Solid", dash: undefined },
  { value: "dashed", label: "Dashed", dash: "4 3" },
  { value: "dotted", label: "Dotted", dash: "0.1 3" },
] as const;

type Tab = "fill" | "outline" | "text";

/** What the selected shapes share (null where they differ or have none). */
export interface PaintState {
  color: FlowColor | null;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number | null;
  strokeStyle: NonNullable<FlowNode["strokeStyle"]> | null;
  textColor: TextColor | null | "mixed";
}

function HexField({ label, onApply }: { label: string; onApply: (hex: string) => void }) {
  const [value, setValue] = useState("");
  const hex = parseHex(value);
  return (
    <form
      className="fc-hex"
      onSubmit={(e) => {
        e.preventDefault();
        if (hex) onApply(hex);
      }}
    >
      <span className="fc-hex-chip" aria-hidden style={{ background: hex ?? "transparent" }} />
      <input className="fc-input" aria-label={label} placeholder="#3b82f6" value={value} spellCheck={false} autoComplete="off" maxLength={7} onChange={(e) => setValue(e.target.value)} aria-invalid={value.trim() !== "" && !hex ? true : undefined} />
      <button type="submit" className="fc-btn fc-btn-text" disabled={!hex}>
        Apply
      </button>
    </form>
  );
}

function CustomSwatches({ value, onPick, label }: { value: string | null; onPick: (hex: string) => void; label: string }) {
  return (
    <div className="fc-swatch-grid" role="group" aria-label={label}>
      {CUSTOM_COLORS.map((c) => (
        <button key={c} type="button" className="fc-swatch fc-swatch-custom" style={{ background: c }} aria-pressed={value === c} aria-label={c} title={c} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

export function ColorPanel({ state, onPaint, onTextColor, onClose }: { state: PaintState; onPaint: (p: Paint) => void; onTextColor: (c: TextColor | null) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("fill");
  return (
    <FlowPanel title="Colours" onClose={onClose} className="fc-panel-colors">
      <div className="fc-seg" role="radiogroup" aria-label="What to colour">
        {(["fill", "outline", "text"] as const).map((t) => (
          <button key={t} type="button" role="radio" aria-checked={tab === t} className="fc-seg-btn" onClick={() => setTab(t)}>
            {t === "fill" ? "Fill" : t === "outline" ? "Outline" : "Text"}
          </button>
        ))}
      </div>
      <div className="fc-panel-scroll fc-color-body">
        {tab === "fill" ? (
          <>
            <h4 className="fc-panel-heading">Theme</h4>
            <div className="fc-swatch-grid" role="group" aria-label="Theme fills">
              {FLOWCHART_COLORS.map((c) => (
                <button key={c} type="button" className="fc-swatch" data-color={c} aria-pressed={!state.fill && state.color === c} aria-label={`${FLOWCHART_COLOR_LABEL[c]} fill`} title={FLOWCHART_COLOR_LABEL[c]} onClick={() => onPaint({ color: c })} />
              ))}
              <button type="button" className="fc-swatch fc-swatch-none" aria-pressed={state.fill === "none"} aria-label="No fill" title="No fill" onClick={() => onPaint({ fill: "none" })}>
                <Ban size={14} aria-hidden />
              </button>
            </div>
            <h4 className="fc-panel-heading">Custom</h4>
            <CustomSwatches label="Custom fills" value={state.fill} onPick={(fill) => onPaint({ fill })} />
            <HexField label="Custom fill colour" onApply={(fill) => onPaint({ fill })} />
          </>
        ) : null}
        {tab === "outline" ? (
          <>
            <h4 className="fc-panel-heading">Colour</h4>
            <div className="fc-swatch-grid" role="group" aria-label="Outline colours">
              <button type="button" className="fc-swatch" data-color={state.color ?? "neutral"} aria-pressed={!state.stroke} aria-label="Default outline" title="Default" onClick={() => onPaint({ stroke: null })} />
              <button type="button" className="fc-swatch fc-swatch-none" aria-pressed={state.stroke === "none"} aria-label="No outline" title="No outline" onClick={() => onPaint({ stroke: "none" })}>
                <Ban size={14} aria-hidden />
              </button>
            </div>
            <CustomSwatches label="Custom outlines" value={state.stroke} onPick={(stroke) => onPaint({ stroke })} />
            <HexField label="Custom outline colour" onApply={(stroke) => onPaint({ stroke })} />
            <h4 className="fc-panel-heading">Width</h4>
            <div className="fc-seg" role="radiogroup" aria-label="Outline width">
              {WIDTHS.map((w) => (
                <button key={w} type="button" role="radio" aria-checked={(state.strokeWidth ?? 1.5) === w} aria-label={`${w} point outline`} className="fc-seg-btn" onClick={() => onPaint({ strokeWidth: w === 1.5 ? null : w })}>
                  <svg width="28" height="14" viewBox="0 0 28 14" aria-hidden>
                    <path d="M3 7h22" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
                  </svg>
                </button>
              ))}
            </div>
            <h4 className="fc-panel-heading">Style</h4>
            <div className="fc-seg" role="radiogroup" aria-label="Outline style">
              {STYLES.map((s) => (
                <button key={s.value} type="button" role="radio" aria-checked={(state.strokeStyle ?? "solid") === s.value} aria-label={`${s.label} outline`} className="fc-seg-btn" onClick={() => onPaint({ strokeStyle: s.value })}>
                  <svg width="28" height="14" viewBox="0 0 28 14" aria-hidden>
                    <path d="M3 7h22" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeDasharray={s.dash} />
                  </svg>
                </button>
              ))}
            </div>
          </>
        ) : null}
        {tab === "text" ? (
          <>
            <h4 className="fc-panel-heading">Text colour</h4>
            <div className="fc-swatch-grid fc-text-swatches" role="group" aria-label="Text colours">
              <button type="button" className="fc-swatch fc-text-swatch" aria-pressed={state.textColor === null} aria-label="Default text colour" title="Default" onClick={() => onTextColor(null)}>
                <span aria-hidden>A</span>
              </button>
              {TextColorValues.map((c) => (
                <button key={c} type="button" className="fc-swatch fc-text-swatch" aria-pressed={state.textColor === c} aria-label={`${TEXT_LABEL[c]} text`} title={TEXT_LABEL[c]} onClick={() => onTextColor(c)}>
                  <span aria-hidden className={`fb-color-${c}`}>
                    A
                  </span>
                </button>
              ))}
            </div>
            <p className="fc-panel-note">Colours the whole label. To colour some words, select them while writing.</p>
          </>
        ) : null}
      </div>
    </FlowPanel>
  );
}
