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

/**
 * Mermaid source → a standalone SVG string. `securityLevel: "strict"` sanitises labels and disables
 * click handlers; plain SVG text labels (no HTML) keep the output a valid image. Renders are
 * serialised because Mermaid keeps global state while it lays a diagram out.
 */
export function renderMermaid(code: string): Promise<MermaidResult> {
  const run = async (): Promise<MermaidResult> => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: isDark() ? "dark" : "default",
      htmlLabels: false,
      suppressErrorRendering: true,
      fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    });
    const id = `fb-mermaid-${++seq}`;
    try {
      const { svg } = await mermaid.render(id, code);
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

/** Calls `cb` when the app's light/dark theme changes (diagrams are re-rendered in the new theme). */
export function onThemeChange(cb: () => void): () => void {
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
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener("change", check);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", check);
  };
}
