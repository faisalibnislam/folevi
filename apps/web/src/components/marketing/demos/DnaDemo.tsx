"use client";

import { useEffect, useState } from "react";
import { DemoCard, LiveRegion } from "./DemoCard";

// The Foli DNA picture on folevi.com: a few weeks of notes appearing in the order they were written, links joining
// them, two clusters shading in, and a suggested link (dashed) between notes that mention the same person. It plays
// once and loops; with reduced motion it shows the finished map.
type N = { id: string; label: string; x: number; y: number; kind?: "person" | "project"; week: number };
const NODES: N[] = [
  { id: "kyoto", label: "Kyoto in November", x: 150, y: 120, week: 0 },
  { id: "pack", label: "Packing list", x: 80, y: 200, week: 1 },
  { id: "ryokan", label: "Ryokan options", x: 230, y: 70, week: 1 },
  { id: "sam", label: "Sam", x: 210, y: 190, kind: "person", week: 2 },
  { id: "budget", label: "Trip budget", x: 60, y: 90, week: 2 },
  { id: "launch", label: "Spring launch", x: 470, y: 150, kind: "project", week: 3 },
  { id: "brief", label: "Launch brief", x: 400, y: 80, week: 3 },
  { id: "press", label: "Press list", x: 540, y: 80, week: 4 },
  { id: "retro", label: "Weekly review", x: 380, y: 220, week: 4 },
  { id: "photos", label: "Photographer", x: 520, y: 230, week: 5 },
];
const LINKS: [string, string, number][] = [
  ["kyoto", "pack", 1],
  ["kyoto", "ryokan", 1],
  ["kyoto", "budget", 2],
  ["sam", "kyoto", 2],
  ["sam", "pack", 2],
  ["brief", "launch", 3],
  ["press", "launch", 4],
  ["retro", "launch", 4],
  ["photos", "launch", 5],
  ["retro", "sam", 5],
];
const WEEKS = 6;
const CLUSTERS = [
  { name: "Kyoto trip", x: 145, y: 135, r: 125, color: "var(--color-accent)", week: 2 },
  { name: "Spring launch", x: 465, y: 155, r: 120, color: "var(--color-moss)", week: 4 },
];
const COLOR = { person: "var(--color-coral)", project: "var(--color-accent)" } as const;
const byId = new Map(NODES.map((n) => [n.id, n]));

export function DnaDemo() {
  const [week, setWeek] = useState(WEEKS);
  useEffect(() => {
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setWeek(0);
    const t = setInterval(() => setWeek((w) => (w >= WEEKS + 2 ? 0 : w + 1)), 900);
    return () => clearInterval(t);
  }, []);
  const shown = Math.min(week, WEEKS);
  return (
    <DemoCard title="Foli DNA" meta={<span className="tabular-nums">{shown >= WEEKS ? "Today" : `Week ${shown + 1}`}</span>}>
      <LiveRegion message={shown >= WEEKS ? "Ten notes in two clusters, Kyoto trip and Spring launch, with a suggested link." : ""} />
      <svg viewBox="0 0 620 300" role="img" aria-label="Notes appearing week by week, linked into two clusters, Kyoto trip and Spring launch, with a dashed suggested link between two notes that mention Sam." className="block w-full">
        {CLUSTERS.map((c) => (
          <g key={c.name} style={{ opacity: shown >= c.week ? 1 : 0, transition: "opacity 600ms ease" }}>
            <circle cx={c.x} cy={c.y} r={c.r} fill={c.color} opacity={0.07} />
            <text x={c.x} y={c.y - c.r - 6} textAnchor="middle" fontSize={12} fontWeight={600} fill={c.color}>
              {c.name}
            </text>
          </g>
        ))}
        {LINKS.map(([a, b, w]) => {
          const p = byId.get(a)!;
          const q = byId.get(b)!;
          return <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="var(--color-line-strong)" strokeWidth={1.3} style={{ opacity: shown >= w ? 0.7 : 0, transition: "opacity 500ms ease" }} />;
        })}
        <line x1={byId.get("budget")!.x} y1={byId.get("budget")!.y} x2={byId.get("photos")!.x} y2={byId.get("photos")!.y} stroke="var(--color-accent)" strokeWidth={1.3} strokeDasharray="3 5" style={{ opacity: shown >= WEEKS ? 0.9 : 0, transition: "opacity 600ms ease" }} />
        {NODES.map((n) => {
          const r = n.kind ? 9 : 7;
          return (
            <g key={n.id} transform={`translate(${n.x} ${n.y})`} style={{ opacity: shown >= n.week ? 1 : 0, transition: "opacity 500ms ease" }}>
              {n.kind === "person" ? (
                <path d={`M0 ${-r * 1.2} L${r * 1.2} 0 L0 ${r * 1.2} L${-r * 1.2} 0 Z`} fill={COLOR.person} stroke="var(--color-canvas)" strokeWidth={1.5} />
              ) : n.kind === "project" ? (
                <rect x={-r} y={-r} width={r * 2} height={r * 2} fill={COLOR.project} stroke="var(--color-canvas)" strokeWidth={1.5} />
              ) : (
                <circle r={r} fill="var(--color-ink-muted)" stroke="var(--color-canvas)" strokeWidth={1.5} />
              )}
              <text y={r + 14} textAnchor="middle" fontSize={11.5} fill="var(--color-ink)" style={{ paintOrder: "stroke", stroke: "var(--color-canvas)", strokeWidth: 3 }}>
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </DemoCard>
  );
}
