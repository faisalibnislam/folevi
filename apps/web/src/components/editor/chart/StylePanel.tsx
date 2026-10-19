"use client";

// The chart's Style panel: colours for its series (or slices, sets, teams), the legend, value labels,
// the order, bars sideways, and the axes' titles and range. Every change is saved at once (⌘Z undoes it).
import { useId, useState } from "react";
import { Check } from "lucide-react";
import { CHART_COLORS, CHART_LIMITS, type ChartColor, type ChartData, type ChartLegend, type ChartSort } from "@folevi/editor-schema";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { colorTargets } from "./model";
import { COLOR_NAME } from "./palette";

const LEGENDS: [ChartLegend, string][] = [
  ["auto", "Auto"],
  ["top", "Top"],
  ["bottom", "Bottom"],
  ["right", "Right"],
  ["none", "Off"],
];
const SORTS: [ChartSort, string][] = [
  ["none", "As entered"],
  ["desc", "Largest first"],
  ["asc", "Smallest first"],
  ["label", "A to Z"],
];

const AXES = new Set(["bar", "stackedBar", "line", "area", "scatter", "bubble"]);
const SORTABLE = new Set(["bar", "stackedBar", "line", "area", "pie", "donut"]);
const LEGEND = new Set(["bar", "stackedBar", "line", "area", "scatter", "bubble", "pie", "donut"]);

/** A number field that saves on blur or Enter (empty is automatic). */
function NumberField({ label, value, onCommit }: { label: string; value: number | null; onCommit: (n: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = draft.trim() === "" ? null : Number(draft.replace(/,/g, ""));
    if (n === null || Number.isFinite(n)) onCommit(n);
    setDraft(null);
  };
  return (
    <label className="fb-chart-field">
      <span>{label}</span>
      <input
        className="ui-input fb-chart-input"
        inputMode="decimal"
        placeholder="Auto"
        value={draft ?? (value === null ? "" : String(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}

export function StylePanel({ chart, onChange }: { chart: ChartData; onChange: (patch: Partial<ChartData>) => void }) {
  const uid = useId();
  const targets = colorTargets(chart).slice(0, 12);
  const setColor = (name: string, color: ChartColor | null) => {
    const colors = { ...chart.colors };
    if (color) colors[name] = color;
    else delete colors[name];
    onChange({ colors });
  };
  return (
    <div className="fb-chart-panel">
      {targets.length ? (
        <section aria-labelledby={`${uid}-colors`}>
          <h3 id={`${uid}-colors`} className="ui-caps">
            Colors
          </h3>
          {targets.map((t) => (
            <div key={t.name} className="fb-chart-color-row">
              <span className="fb-chart-color-name">{t.name}</span>
              <div className="fb-chart-swatches" role="radiogroup" aria-label={`Color for ${t.name}`}>
                {CHART_COLORS.map((c) => {
                  const on = t.color === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`${COLOR_NAME[c]}${chart.colors[t.name] ? "" : on ? " (automatic)" : ""}`}
                      title={COLOR_NAME[c]}
                      className="fb-chart-swatch"
                      style={{ background: `var(--chart-${c})` }}
                      onClick={() => setColor(t.name, on && chart.colors[t.name] ? null : c)}
                    >
                      {on ? <Check size={11} strokeWidth={3} aria-hidden style={{ color: `var(--chart-on-${c})` }} /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {Object.keys(chart.colors).length ? (
            <button type="button" className="fb-chart-link" onClick={() => onChange({ colors: {} })}>
              Use automatic colors
            </button>
          ) : null}
        </section>
      ) : null}

      {LEGEND.has(chart.kind) ? (
        <section aria-labelledby={`${uid}-legend`}>
          <h3 id={`${uid}-legend`} className="ui-caps">
            Legend
          </h3>
          <div className="ui-seg ui-well" role="group" aria-labelledby={`${uid}-legend`}>
            {LEGENDS.map(([v, label]) => (
              <button key={v} type="button" aria-pressed={chart.legend === v} onClick={() => onChange({ legend: v })}>
                {label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-label="Labels and order" className="fb-chart-switches">
        {chart.kind !== "org" ? (
          <div className="fb-chart-switch-row">
            <span id={`${uid}-values`}>Value labels</span>
            <Switch checked={chart.values} onChange={(values) => onChange({ values })} label="Value labels" />
          </div>
        ) : null}
        {chart.kind === "bar" || chart.kind === "stackedBar" ? (
          <div className="fb-chart-switch-row">
            <span>Bars run sideways</span>
            <Switch checked={chart.horizontal} onChange={(horizontal) => onChange({ horizontal })} label="Bars run sideways" />
          </div>
        ) : null}
        {SORTABLE.has(chart.kind) ? (
          <label className="fb-chart-switch-row">
            <span>Order</span>
            <Select value={chart.sort} onChange={(e) => onChange({ sort: e.target.value as ChartSort })} aria-label="Order">
              {SORTS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </section>

      {AXES.has(chart.kind) ? (
        <section aria-labelledby={`${uid}-axes`}>
          <h3 id={`${uid}-axes`} className="ui-caps">
            Axes
          </h3>
          <div className="fb-chart-fields">
            <label className="fb-chart-field fb-chart-field-wide">
              <span>{chart.horizontal ? "Category axis title" : "Bottom axis title"}</span>
              <input className="ui-input fb-chart-input" value={chart.xLabel} maxLength={CHART_LIMITS.maxAxisLabel} placeholder="None" onChange={(e) => onChange({ xLabel: e.target.value })} />
            </label>
            <label className="fb-chart-field fb-chart-field-wide">
              <span>{chart.horizontal ? "Value axis title" : "Side axis title"}</span>
              <input className="ui-input fb-chart-input" value={chart.yLabel} maxLength={CHART_LIMITS.maxAxisLabel} placeholder="None" onChange={(e) => onChange({ yLabel: e.target.value })} />
            </label>
            <NumberField label="Values from" value={chart.yMin} onCommit={(yMin) => onChange(yMin !== null && chart.yMax !== null && yMin >= chart.yMax ? { yMin, yMax: null } : { yMin })} />
            <NumberField label="Values to" value={chart.yMax} onCommit={(yMax) => onChange(yMax !== null && chart.yMin !== null && yMax <= chart.yMin ? { yMax, yMin: null } : { yMax })} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
