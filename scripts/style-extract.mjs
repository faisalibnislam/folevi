// The computed styles of the elements marked `data-style` (or, given `tags`, found by selector and marked first),
// as WebStyles.swift needs them: box, padding, radius, colours as exact sRGB, shadows, font and line box. Run in
// the page by its source (`extract.toString()`): scripts/web-styles.mjs (the samples page and the Mac app's web
// frame) and apps/ios/scripts/gate-styles.mjs (the iPhone app's web frame in the Simulator).
export function extract(tags) {
  // (App mode: mark the elements first, by selector, as the samples page marks its own with data-style.)
  if (tags) {
    // No transitions: a window behind others doesn't run them, so a colour caught mid-change would stay there.
    if (!document.getElementById("__webStylesStill")) {
      const still = document.createElement("style");
      still.id = "__webStylesStill";
      still.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
      document.documentElement.appendChild(still);
    }
    for (const [id, t] of Object.entries(tags)) {
      if (id === "__vars") continue;
      let el = [...document.querySelectorAll(t.selector)][t.nth ?? 0];
      for (let i = 0; el && i < (t.parent ?? 0); i++) el = el.parentElement;
      if (el) el.setAttribute("data-style", id);
    }
  }
  const ctx = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  const probe = document.createElement("i");
  document.body.append(probe);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const round3 = (v) => Math.round(v * 1000) / 1000;
  const linToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255;
  const oklab = (L, a, b, alpha) => {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      clamp(linToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
      clamp(linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
      clamp(linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
      round3(alpha),
    ];
  };
  const num = (v, pct = 1) => (v.endsWith("%") ? (Number.parseFloat(v) / 100) * pct : Number.parseFloat(v));
  // Exact sRGB from the computed value (rgb(), color(srgb), oklab(), oklch()); a canvas only as a last resort.
  const rgba = (css) => {
    if (!css || css === "none" || css === "transparent") return [0, 0, 0, 0];
    probe.style.color = "";
    probe.style.color = css;
    const v = getComputedStyle(probe).color.trim();
    let m = v.match(/^rgba?\(([^)]*)\)$/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean);
      return [clamp(num(p[0], 255)), clamp(num(p[1], 255)), clamp(num(p[2], 255)), round3(p[3] === undefined ? 1 : num(p[3]))];
    }
    m = v.match(/^color\(srgb\s+([^)]*)\)$/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean);
      return [clamp(num(p[0]) * 255), clamp(num(p[1]) * 255), clamp(num(p[2]) * 255), round3(p[3] === undefined ? 1 : num(p[3]))];
    }
    m = v.match(/^oklab\(([^)]*)\)$/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean);
      return oklab(num(p[0]), num(p[1], 0.4), num(p[2], 0.4), p[3] === undefined ? 1 : num(p[3]));
    }
    m = v.match(/^oklch\(([^)]*)\)$/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean);
      const c = num(p[1], 0.4), h = (Number.parseFloat(p[2]) * Math.PI) / 180;
      return oklab(num(p[0]), c * Math.cos(h), c * Math.sin(h), p[3] === undefined ? 1 : num(p[3]));
    }
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], round3(d[3] / 255)];
  };
  // Splits at top-level commas (not inside parentheses).
  const split = (s) => {
    const parts = [];
    let depth = 0, cur = "";
    for (const ch of s) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  };
  const colorRe = /(rgba?\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\)|color\([^)]*\)|color-mix\((?:[^()]|\([^)]*\))*\)|#[0-9a-f]{3,8}\b|\btransparent\b|\bwhite\b|\bblack\b)/i;
  const shadows = (s) =>
    !s || s === "none"
      ? []
      : split(s).map((layer) => {
          const color = layer.match(colorRe)?.[0] ?? "black";
          const rest = layer.replace(color, " ");
          const nums = [...rest.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
          return { x: nums[0] ?? 0, y: nums[1] ?? 0, blur: nums[2] ?? 0, spread: nums[3] ?? 0, color: rgba(color), inset: /\binset\b/.test(rest) };
        });
  const gradient = (img) => {
    if (!img || img === "none") return null;
    const m = img.match(/linear-gradient\((.*)\)$/);
    if (!m) return { unsupported: img };
    const parts = split(m[1]);
    let angle = 180;
    if (/deg$|^to /.test(parts[0])) {
      const p = parts.shift();
      angle = p === "to bottom" ? 180 : p === "to top" ? 0 : Number.parseFloat(p);
    }
    return { angle, stops: parts.map((p) => rgba(p.match(colorRe)?.[0] ?? p)) };
  };
  const px = (v) => (v === "normal" || v === "" ? null : Number.parseFloat(v));
  const result = {};
  // CSS custom properties that are colours (app mode: the Mac's own variables), as "var:<name>".
  for (const name of tags?.__vars?.names ?? []) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
    if (v) result[`var:${name}`] = { color: rgba(v) };
  }
  for (const el of document.querySelectorAll("[data-style]")) {
    if (tags && !tags[el.dataset.style]) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    result[el.dataset.style] = {
      x: Math.round(r.left * 100) / 100,
      y: Math.round(r.top * 100) / 100,
      width: Math.round(r.width * 100) / 100,
      height: Math.round(r.height * 100) / 100,
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px),
      margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(px),
      radius: px(cs.borderTopLeftRadius) ?? 0,
      background: rgba(cs.backgroundColor),
      gradient: gradient(cs.backgroundImage),
      shadows: shadows(cs.boxShadow),
      border: { width: px(cs.borderTopWidth) ?? 0, color: rgba(cs.borderTopColor) },
      color: rgba(cs.color),
      opacity: Number(cs.opacity),
      fontFamily: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      fontSize: px(cs.fontSize),
      fontWeight: Number(cs.fontWeight),
      lineHeight: px(cs.lineHeight),
      letterSpacing: px(cs.letterSpacing) ?? 0,
      gap: px(cs.columnGap) ?? 0,
      backdropBlur: Number((cs.backdropFilter || cs.webkitBackdropFilter || "").match(/blur\(([\d.]+)px\)/)?.[1] ?? 0),
    };
  }
  return result;
}
