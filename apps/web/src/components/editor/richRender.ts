// Lazy renderers for formula (KaTeX) and Mermaid blocks. Both libraries are large and only load the
// first time a page actually contains a formula or a diagram. Neither needs eval, so they run under the
// production Content Security Policy (script-src without 'unsafe-eval').

type Katex = typeof import("katex").default;
type Mermaid = typeof import("mermaid").default;

let katexPromise: Promise<Katex> | null = null;
export function loadKatex(): Promise<Katex> {
  katexPromise ??= import("katex").then((m) => m.default);
  return katexPromise;
}

/**
 * LaTeX → KaTeX markup. `trust: false` blocks \href, \url, \includegraphics and friends; with
 * `throwOnError: false` a mistake renders in red instead of failing. The output is KaTeX's own escaped
 * HTML/MathML (safe to inject).
 */
export async function renderLatex(latex: string, opts: { output?: "htmlAndMathml" | "mathml" } = {}): Promise<string> {
  const katex = await loadKatex();
  return katex.renderToString(latex, {
    displayMode: true,
    throwOnError: false,
    trust: false,
    strict: "ignore",
    output: opts.output ?? "htmlAndMathml",
    maxSize: 40,
    maxExpand: 500,
  });
}

let mermaidPromise: Promise<Mermaid> | null = null;
function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import("mermaid").then((m) => m.default);
  return mermaidPromise;
}

function isDark(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export type MermaidResult = { svg: string; width: number; height: number } | { error: string };

let queue: Promise<unknown> = Promise.resolve();
let seq = 0;

const SYSTEM_FONTS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

/** The app's sans family name as loaded by next/font (e.g. "Instrument Sans"), or null. */
function appFontFamily(): string | null {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-instrument-sans");
  const first = v.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  return first && /^[\w -]{1,64}$/.test(first) ? first : null;
}

let fontFacePromise: Promise<string | null> | null = null;
/**
 * An @font-face rule carrying the app font's Latin file as a data URL. Diagrams are shown as images, and
 * an SVG image can't load fonts from the page, so the font travels inside the SVG (fetched once, from our
 * own origin). Null when it can't be found; the diagram then uses the system font.
 */
function embeddedFontFace(family: string): Promise<string | null> {
  fontFacePromise ??= (async () => {
    const candidates: { url: URL; weight: string; latin: boolean }[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        if (rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim() !== family) continue;
        const src = /url\((["']?)([^"')]+)\1\)/.exec(rule.style.getPropertyValue("src"));
        if (!src) continue;
        const url = new URL(src[2]!, sheet.href ?? location.href);
        if (url.origin !== location.origin) continue;
        const range = rule.style.getPropertyValue("unicode-range");
        const weight = rule.style.getPropertyValue("font-weight").trim();
        candidates.push({ url, weight: /^[\d ]{1,12}$/.test(weight) ? weight : "100 900", latin: !range || /U\+0{1,4}-/i.test(range) });
      }
    }
    const pick = candidates.find((c) => c.latin) ?? candidates[0];
    if (!pick) return null;
    const res = await fetch(pick.url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 400_000) return null;
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const format = pick.url.pathname.endsWith(".woff") ? "woff" : "woff2";
    return `@font-face{font-family:"${family}";src:url(data:font/${format};base64,${btoa(bin)}) format("${format}");font-weight:${pick.weight};font-style:normal;}`;
  })().catch(() => null);
  return fontFacePromise;
}

/** Colours for a diagram, read from where it sits (the note's page, palette and theme). */
interface DiagramColors {
  surface: string;
  raised: string;
  ink: string;
  muted: string;
  edge: string;
  node: string;
  nodeLine: string;
  soft: string;
  faint: string;
  line: string;
  note: string;
  noteLine: string;
}

const LIGHT: DiagramColors = { surface: "#ffffff", raised: "#ffffff", ink: "#18181b", muted: "#56565e", edge: "#8a8a93", node: "#f6f6f7", nodeLine: "#b9b9c0", soft: "#eeeef0", faint: "#f7f7f8", line: "#e2e2e6", note: "#fdf3d0", noteLine: "#e3c35e" };
const DARK: DiagramColors = { surface: "#1c1c1e", raised: "#29292c", ink: "#f2f2f3", muted: "#a6a6ae", edge: "#86868e", node: "#262629", nodeLine: "#55555c", soft: "#303034", faint: "#222225", line: "#2c2c2f", note: "#3a3320", noteLine: "#8a7430" };

/** Resolves CSS colour expressions (variables, color-mix) in `el`'s context to hex. */
function resolveColors(el: Element, exprs: Record<keyof DiagramColors, string>, fallback: DiagramColors): DiagramColors {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const probe = document.createElement("span");
  probe.style.display = "none";
  el.appendChild(probe);
  const out = { ...fallback };
  try {
    for (const key of Object.keys(exprs) as (keyof DiagramColors)[]) {
      probe.style.color = "";
      probe.style.color = exprs[key];
      const computed = getComputedStyle(probe).color;
      if (!computed || !ctx) continue;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = computed;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      if (!a) continue;
      out[key] = `#${[r, g, b].map((n) => (n ?? 0).toString(16).padStart(2, "0")).join("")}`;
    }
  } catch {
    /* keep the fallback colours */
  } finally {
    probe.remove();
  }
  return out;
}

function diagramColors(el: Element | null, dark: boolean): DiagramColors {
  const fallback = dark ? DARK : LIGHT;
  if (!el?.isConnected) return fallback;
  const accent = "var(--doc-accent, var(--color-accent))";
  return resolveColors(
    el,
    {
      surface: "var(--color-surface)",
      raised: "var(--color-surface-raised)",
      ink: "var(--color-ink)",
      muted: "var(--color-ink-muted)",
      edge: "color-mix(in oklab, var(--color-ink) 48%, var(--color-surface))",
      node: `color-mix(in oklab, ${accent} 5%, var(--color-surface-raised))`,
      nodeLine: `color-mix(in oklab, ${accent} 24%, color-mix(in oklab, var(--color-ink) 22%, var(--color-surface)))`,
      soft: `color-mix(in oklab, ${accent} 11%, var(--color-surface))`,
      faint: "color-mix(in oklab, var(--color-ink) 3%, var(--color-surface))",
      line: "var(--color-line)",
      note: "color-mix(in oklab, #e0a800 15%, var(--color-surface))",
      noteLine: "color-mix(in oklab, #e0a800 45%, var(--color-surface))",
    },
    fallback,
  );
}

/** Folevi's calm diagram look: soft neutral shapes tinted by the note's accent, rounded corners, fine lines. */
function mermaidTheme(c: DiagramColors, dark: boolean, family: string) {
  return {
    darkMode: dark,
    background: c.surface,
    fontFamily: family,
    fontSize: "14px",
    primaryColor: c.node,
    primaryBorderColor: c.nodeLine,
    primaryTextColor: c.ink,
    secondaryColor: c.soft,
    secondaryBorderColor: c.nodeLine,
    secondaryTextColor: c.ink,
    tertiaryColor: c.faint,
    tertiaryBorderColor: c.line,
    tertiaryTextColor: c.ink,
    mainBkg: c.node,
    nodeBorder: c.nodeLine,
    nodeTextColor: c.ink,
    textColor: c.ink,
    titleColor: c.ink,
    lineColor: c.edge,
    edgeLabelBackground: c.surface,
    clusterBkg: c.faint,
    clusterBorder: c.line,
    noteBkgColor: c.note,
    noteBorderColor: c.noteLine,
    noteTextColor: c.ink,
    actorBkg: c.node,
    actorBorder: c.nodeLine,
    actorTextColor: c.ink,
    actorLineColor: c.line,
    signalColor: c.edge,
    signalTextColor: c.ink,
    labelBoxBkgColor: c.node,
    labelBoxBorderColor: c.nodeLine,
    labelTextColor: c.ink,
    loopTextColor: c.ink,
    activationBkgColor: c.soft,
    activationBorderColor: c.nodeLine,
    sequenceNumberColor: c.surface,
  };
}

function mermaidCss(c: DiagramColors): string {
  return [
    `.node rect,.node polygon,.node circle,.node ellipse,.node path{stroke-width:1.25px}`,
    `.node rect{rx:8px;ry:8px}`,
    `.cluster rect{rx:12px;ry:12px;stroke-width:1px}`,
    `.nodeLabel,.node .label{font-weight:500}`,
    `.flowchart-link,.edgePath .path,.messageLine0,.messageLine1,.relation,.transition{stroke-width:1.5px;stroke-linecap:round;stroke-linejoin:round}`,
    `.edgeLabel,.edgeLabel rect,.labelBkg{background-color:${c.surface};fill:${c.surface}}`,
    `.edgeLabel text,.edgeLabel span,.edgeLabel p{fill:${c.muted};color:${c.muted};font-size:12.5px;font-weight:500}`,
    `marker path,.arrowheadPath,.arrowMarkerPath{fill:${c.edge};stroke:${c.edge};stroke-linejoin:round}`,
  ].join("");
}

/**
 * Tidies Mermaid's SVG for Folevi's look: rounded node rectangles (for renderers without the CSS `rx`
 * property), a slimmer swept arrowhead, and the embedded font.
 */
function polishSvg(svg: string, fontFace: string | null): string {
  let out = svg
    .replace(/<rect(?![^>]*\brx=)([^>]*class="[^"]*\b(?:basic|label-container)\b[^"]*")/g, '<rect rx="8" ry="8"$1')
    .replace(/d="M 0 0 L 10 5 L 0 10 z"/g, 'd="M 0.5 1 L 10 5 L 0.5 9 Q 2.6 5 0.5 1 z"');
  if (fontFace) out = out.replace(/(<svg\b[^>]*>)/, `$1<style>${fontFace}</style>`);
  return out;
}

/**
 * Mermaid source → a standalone SVG string, styled after the note it sits in (`themeFrom`: an element in
 * the block, whose colours, palette and theme are read). `securityLevel: "strict"` sanitises labels and
 * disables click handlers; plain SVG text labels (no HTML) keep the output a valid image. Renders are
 * serialised because Mermaid keeps global state while it lays a diagram out.
 */
export function renderMermaid(code: string, themeFrom: Element | null = null): Promise<MermaidResult> {
  const run = async (): Promise<MermaidResult> => {
    const dark = isDark();
    const family = appFontFamily();
    const [mermaid, fontFace] = await Promise.all([loadMermaid(), family ? embeddedFontFace(family) : Promise.resolve(null)]);
    const fontFamily = family && fontFace ? `"${family}", ${SYSTEM_FONTS}` : SYSTEM_FONTS;
    if (family && fontFace) await document.fonts?.load(`500 14px "${family}"`).catch(() => undefined);
    const colors = diagramColors(themeFrom, dark);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: mermaidTheme(colors, dark, fontFamily),
      themeCSS: mermaidCss(colors),
      htmlLabels: false,
      suppressErrorRendering: true,
      fontFamily,
      flowchart: { curve: "basis", padding: 14, nodeSpacing: 44, rankSpacing: 52, diagramPadding: 12, useMaxWidth: false },
      sequence: { useMaxWidth: false },
    });
    const id = `fb-mermaid-${++seq}`;
    try {
      const rendered = await mermaid.render(id, code);
      const svg = polishSvg(rendered.svg, fontFace);
      const vb = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)"/.exec(svg);
      return { svg, width: vb ? Math.ceil(Number(vb[1])) : 600, height: vb ? Math.ceil(Number(vb[2])) : 300 };
    } catch (e) {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
      const message = e instanceof Error ? e.message : String(e);
      return { error: message.split("\n").find((l) => l.trim())?.slice(0, 160) ?? "Syntax error" };
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/** An SVG string as an <img> source (scripts inside an image never run). */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Calls `cb` when the app's light/dark theme changes (diagrams are re-rendered in the new theme), and,
 * with `el`, when the note around it changes style (page colour, text colour or palette).
 */
export function onThemeChange(cb: () => void, el?: Element | null): () => void {
  let dark = isDark();
  const check = () => {
    const now = isDark();
    if (now !== dark) {
      dark = now;
      cb();
    }
  };
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const styleObserver = el ? new MutationObserver(cb) : null;
  const watchSheet = () => {
    const sheet = el?.closest(".fb-sheet");
    if (sheet) styleObserver?.observe(sheet, { attributes: true, attributeFilter: ["style", "data-sheet", "data-text", "data-palette"] });
  };
  // A node view's element is attached to the page only after it's created.
  const attachFrame = el && !el.isConnected ? requestAnimationFrame(watchSheet) : (watchSheet(), null);
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener("change", check);
  return () => {
    observer.disconnect();
    if (attachFrame !== null) cancelAnimationFrame(attachFrame);
    styleObserver?.disconnect();
    media?.removeEventListener("change", check);
  };
}
