"use client";

import { useEffect, useId, useRef } from "react";
import { PETALS } from "./AiIcon";

/** The mark's eight petals, one path each (the brand file's sub-paths, in its order). */
const PETAL_PATHS = PETALS.split(/(?=M)/);
/** Each petal's direction from the centre, in degrees clockwise from the top, in PETAL_PATHS' order. */
const ANGLES = [180, 225, 135, 270, 90, 315, 45, 0];
const CENTRE = "251px 251px";
const SPRING = "cubic-bezier(.34,1.56,.64,1)";

/** How far a petal travels while thinking and on a reply (in the mark's own 502-unit drawing). */
const DRIFT = 34;
const BURST = 110;

/** The first automatic bloom comes this soon, then one at a random moment in this range; only after the page has been quiet this long. */
const FIRST_SURPRISE_MS = [10_000, 25_000] as const;
const SURPRISE_EVERY_MS = [20_000, 60_000] as const;
const QUIET_MS = 3_000;

const shift = (i: number, by: number) => {
  const a = (ANGLES[i]! * Math.PI) / 180;
  return `${Math.sin(a) * -by}px, ${Math.cos(a) * by}px`;
};

const petalsOf = (svg: SVGSVGElement | null) => [...(svg?.querySelectorAll<SVGPathElement>("path") ?? [])];

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Foli AI's mark, alive: AiIcon's eight petals drawn one by one so they can move. Now and then, while nothing else
 * is happening, the petals ripple open one after another (`surprises`); while Foli AI works they drift in and out
 * (`thinking`); when an answer lands they burst and snap back (each new `replied` count). Only transform and
 * opacity move, so it stays on the compositor; with reduced motion it's the still mark.
 */
export function AiMark({ size = 17, thinking = false, replied = 0, surprises = false, className }: { size?: number; thinking?: boolean; replied?: number; surprises?: boolean; className?: string }) {
  const gradient = `ai-${useId().replace(/:/g, "")}`;
  const svgRef = useRef<SVGSVGElement>(null);

  // Thinking: the petals drift towards the centre and back, one just after another.
  useEffect(() => {
    if (!thinking || reducedMotion()) return;
    const running = petalsOf(svgRef.current).map((p, i) =>
      p.animate([{ transform: "translate(0, 0)" }, { transform: `translate(${shift(i, DRIFT)})` }, { transform: "translate(0, 0)" }], { duration: 1200, delay: i * 40, iterations: Infinity, easing: "ease-in-out" }),
    );
    return () => running.forEach((a) => a.cancel());
  }, [thinking]);

  // A reply: every petal flies out through the centre and springs back.
  const seen = useRef(replied);
  useEffect(() => {
    if (replied === seen.current) return;
    seen.current = replied;
    if (reducedMotion()) return;
    petalsOf(svgRef.current).forEach((p, i) =>
      p.animate(
        [
          { transform: "translate(0, 0) scale(1)", opacity: 1 },
          { transform: `translate(${shift(i, BURST)}) scale(.7)`, opacity: 0.6, offset: 0.4 },
          { transform: "translate(0, 0) scale(1)", opacity: 1 },
        ],
        { duration: 700, easing: SPRING },
      ),
    );
  }, [replied]);

  // Now and then: a bloom, the petals opening a little in turn. Never while typing, thinking or in a hidden tab.
  useEffect(() => {
    if (!surprises || thinking || reducedMotion()) return;
    let lastInput = Date.now();
    const onInput = () => (lastInput = Date.now());
    window.addEventListener("keydown", onInput, true);
    window.addEventListener("pointerdown", onInput, true);
    let timer: ReturnType<typeof setTimeout>;
    let first = true;
    const next = () => {
      const [min, max] = first ? FIRST_SURPRISE_MS : SURPRISE_EVERY_MS;
      first = false;
      timer = setTimeout(() => {
        if (!document.hidden && Date.now() - lastInput > QUIET_MS) {
          petalsOf(svgRef.current).forEach((p, i) => p.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 420, delay: i * 70, easing: "ease-in-out" }));
        }
        next();
      }, min + Math.random() * (max - min));
    };
    next();
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onInput, true);
      window.removeEventListener("pointerdown", onInput, true);
    };
  }, [surprises, thinking]);

  return (
    <svg ref={svgRef} width={size} height={size} viewBox="0 0 502 502" fill="none" aria-hidden className={className} style={{ overflow: "visible" }} data-thinking={thinking || undefined}>
      {PETAL_PATHS.map((d, i) => (
        <path key={i} d={d} fill={`url(#${gradient})`} style={{ transformOrigin: CENTRE }} />
      ))}
      <defs>
        <linearGradient id={gradient} x1="73.5" y1="73.5" x2="452.56" y2="339.79" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7C6FEF" />
          <stop offset="1" stopColor="#FF555E" />
        </linearGradient>
      </defs>
    </svg>
  );
}
