// Page breaks split the sheet into separate pages with the note's own background (its colour, image or blur)
// showing in the gap: the sheet is masked with one rounded rectangle per page, worked out from where the
// breaks are. The sheet's shadow is kept down its outer edges.
import { useLayoutEffect } from "react";

/** How far outside the sheet its shadow reaches (kept visible by the mask). */
const SHADOW = 40;

const MASK_PROPS = ["mask-image", "-webkit-mask-image", "mask-size", "-webkit-mask-size", "mask-position", "-webkit-mask-position", "mask-repeat", "-webkit-mask-repeat", "mask-clip", "-webkit-mask-clip"];

/** A box inside the sheet that stays visible in a gap (the break's label). */
type Box = { x: number; y: number; w: number; h: number };

/** The SVG mask for a sheet `w`×`h` with corner radius `r`, cut at each `[top, bottom]` gap. */
export function pageMask(w: number, h: number, r: number, gaps: [number, number][], keep: Box[] = []): string {
  const P = SHADOW;
  const pages: [number, number][] = [];
  let top = 0;
  for (const [a, b] of gaps) {
    pages.push([top, a]);
    top = b;
  }
  pages.push([top, h]);
  const shapes: string[] = [];
  pages.forEach(([y0, y1], i) => {
    if (y1 - y0 <= 0) return;
    const first = i === 0;
    const last = i === pages.length - 1;
    const rr = Math.min(r, (y1 - y0) / 2);
    // The page itself, rounded at every corner (the sheet's own clipping rounds its outer ends anyway).
    shapes.push(`<rect x="${P}" y="${P + y0}" width="${w}" height="${y1 - y0}" rx="${rr}"/>`);
    // Its shadow: outside the sheet, beside the page (and above the first / below the last), stopping short
    // of a cut so the gap stays clean.
    const sy0 = first ? 0 : P + y0 + rr;
    const sy1 = last ? h + 2 * P : P + y1 - rr;
    if (sy1 > sy0) {
      shapes.push(`<rect x="0" y="${sy0}" width="${P}" height="${sy1 - sy0}"/>`, `<rect x="${P + w}" y="${sy0}" width="${P}" height="${sy1 - sy0}"/>`);
    }
    if (first) shapes.push(`<rect x="0" y="0" width="${w + 2 * P}" height="${P}"/>`);
    if (last) shapes.push(`<rect x="0" y="${P + h}" width="${w + 2 * P}" height="${P}"/>`);
  });
  for (const k of keep) shapes.push(`<rect x="${P + k.x}" y="${P + k.y}" width="${k.w}" height="${k.h}" rx="${k.h / 2}"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 2 * P}" height="${h + 2 * P}"><g fill="#fff">${shapes.join("")}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function usePageBreakMask(sheet: HTMLElement | null) {
  useLayoutEffect(() => {
    if (!sheet) return;
    let frame = 0;
    let last = "";
    const clear = () => {
      for (const p of MASK_PROPS) sheet.style.removeProperty(p);
      last = "";
    };
    const measure = () => {
      frame = 0;
      const breaks = sheet.querySelectorAll<HTMLElement>(".fb-editor > .fb-page-break:not(.fb-hidden)");
      if (!breaks.length) {
        if (last) clear();
        return;
      }
      const w = sheet.offsetWidth;
      const h = sheet.offsetHeight;
      const box = sheet.getBoundingClientRect();
      // Measured on screen, then scaled to layout size (the sheet may be mid-animation with a transform).
      const scale = box.height ? h / box.height : 1;
      const gaps: [number, number][] = [];
      const keep: Box[] = [];
      breaks.forEach((b) => {
        const r = b.getBoundingClientRect();
        if (!r.height) return;
        const gap: [number, number] = [Math.round((r.top - box.top) * scale), Math.round((r.bottom - box.top) * scale)];
        // Breaks one after another make one gap (not an empty page between them).
        const prev = gaps[gaps.length - 1];
        if (prev && b.previousElementSibling?.classList.contains("fb-page-break")) prev[1] = gap[1];
        else gaps.push(gap);
        // The label (shown on hover or when the break is selected) stays on its own little piece of sheet,
        // only while it shows.
        const label = b.matches(":hover, .ProseMirror-selectednode") ? b.querySelector<HTMLElement>(".fb-page-break-label")?.getBoundingClientRect() : null;
        if (label?.width) keep.push({ x: Math.round((label.left - box.left) * scale), y: Math.round((label.top - box.top) * scale), w: Math.round(label.width * scale), h: Math.round(label.height * scale) });
      });
      const radius = parseFloat(getComputedStyle(sheet).borderTopLeftRadius) || 0;
      const key = `${w}x${h}:${radius}:${gaps.join(";")}:${keep.map((k) => `${k.x},${k.y},${k.w},${k.h}`).join(";")}`;
      if (key === last) return;
      last = key;
      const image = pageMask(w, h, radius, gaps, keep);
      const set = (prop: string, value: string) => {
        sheet.style.setProperty(prop, value);
        sheet.style.setProperty(`-webkit-${prop}`, value);
      };
      set("mask-image", image);
      set("mask-size", `${w + 2 * SHADOW}px ${h + 2 * SHADOW}px`);
      set("mask-position", `${-SHADOW}px ${-SHADOW}px`);
      set("mask-repeat", "no-repeat");
      sheet.style.setProperty("mask-clip", "no-clip");
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    const resize = new ResizeObserver(schedule);
    resize.observe(sheet);
    // Blocks added, removed, moved, folded away or resized change where the breaks are.
    const mutations = new MutationObserver(schedule);
    mutations.observe(sheet, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    sheet.addEventListener("animationend", schedule);
    // Hovering a break shows its label (no class changes for the observer to see).
    const onPointer = (e: Event) => {
      if ((e.target as Element | null)?.classList?.contains("fb-page-break")) schedule();
    };
    sheet.addEventListener("pointerover", onPointer);
    sheet.addEventListener("pointerout", onPointer);
    return () => {
      sheet.removeEventListener("pointerover", onPointer);
      sheet.removeEventListener("pointerout", onPointer);
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      sheet.removeEventListener("animationend", schedule);
      clear();
    };
  }, [sheet]);
}
