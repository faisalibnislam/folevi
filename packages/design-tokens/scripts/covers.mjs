#!/usr/bin/env node
// Generates Folevi's 20 abstract cover artworks as SVG (deterministic), plus a manifest.
//   node packages/design-tokens/scripts/covers.mjs            → packages/design-tokens/covers/*.svg + covers.json,
//                                                               and apps/web/public/covers/*.svg
//   (apps/web/scripts/rasterize-covers.mjs turns them into PNGs for the Mac app)
// Original work in the Warm Folio palette — no third-party artwork.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../covers");
const webOut = resolve(here, "../../../apps/web/public/covers");
const W = 1600;
const H = 500;

const C = {
  cream: "#FAF6F3", paper: "#FFFDFB", peach: "#FFD0AE", peachSoft: "#FDE9DF", apricot: "#FBB38A",
  rose: "#F5DDD2", roseDeep: "#EDBFB4", lilac: "#E7D7EE", lilacDeep: "#C9ADD8",
  ember: "#F46036", emberLight: "#FB9173", cocoa: "#4A2F2C", cocoaMid: "#9B746E", roseBrown: "#C5A6A9",
  moss: "#3FAE6E", mossSoft: "#CDEBD7", sage: "#9CCFAF", marigold: "#F08A1C", butter: "#FFE2A8",
  plum: "#B67DAB", plumSoft: "#EFD9EA", coral: "#F2716F", coralSoft: "#FCD3D1", sand: "#F1E4D8",
};

// Small deterministic PRNG (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = (n) => Math.round(n * 10) / 10;

const svg = (defs, body, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">` +
  `<defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter>` +
  `<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="18"/></filter>${defs}</defs>` +
  `<rect width="${W}" height="${H}" fill="${bg}"/>${body}</svg>`;

const blob = (x, y, r, color, o = 1, filter = "b") => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${color}" opacity="${o}" filter="url(#${filter})"/>`;
const wave = (y, amp, len, phase, color, o = 1) => {
  let d = `M0 ${H} L0 ${f(y)}`;
  for (let x = 0; x <= W; x += 20) d += ` L${x} ${f(y + Math.sin((x / len) * Math.PI * 2 + phase) * amp)}`;
  return `<path d="${d} L${W} ${H} Z" fill="${color}" opacity="${o}"/>`;
};

const ART = [
  ["Peach dunes", () => svg("", [wave(170, 36, 900, 0.4, C.peach), wave(250, 30, 700, 2.1, C.apricot, 0.75), wave(330, 26, 1100, 4, C.emberLight, 0.55), wave(410, 20, 800, 1, C.rose)].join(""), C.peachSoft)],
  ["Ember sun", () => svg(`<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.peachSoft}"/><stop offset="1" stop-color="${C.rose}"/></linearGradient>`, [`<rect width="${W}" height="${H}" fill="url(#g)"/>`, blob(1120, 250, 260, C.peach, 0.9), `<circle cx="1120" cy="300" r="150" fill="${C.ember}" opacity="0.9"/>`, `<rect y="330" width="${W}" height="170" fill="${C.cream}" opacity="0.92"/>`, ...[0, 1, 2, 3].map((i) => `<rect x="${980 + i * 12}" y="${352 + i * 22}" width="${280 - i * 24}" height="6" rx="3" fill="${C.emberLight}" opacity="${0.5 - i * 0.1}"/>`)].join(""), C.peachSoft)],
  ["Rose fog", () => { const r = rng(3); return svg("", Array.from({ length: 7 }, () => blob(r() * W, r() * H, 140 + r() * 180, [C.rose, C.roseDeep, C.lilac, C.peach][Math.floor(r() * 4)], 0.9)).join(""), C.cream); }],
  ["Moss hills", () => svg("", [blob(1300, 80, 160, C.butter, 0.8), wave(230, 50, 1500, 0.2, C.mossSoft), wave(300, 44, 1100, 2.4, C.sage, 0.8), wave(380, 30, 900, 5, C.moss, 0.55), wave(440, 16, 700, 1.3, C.mossSoft)].join(""), "#F4F1E8")],
  ["Marigold rays", () => svg("", [...Array.from({ length: 18 }, (_, i) => { const a = (i / 18) * Math.PI; const x = 800 + Math.cos(a) * 1400; const y = 520 - Math.sin(a) * 1400; return `<path d="M800 520 L${f(x)} ${f(y)} L${f(800 + Math.cos(a + 0.08) * 1400)} ${f(520 - Math.sin(a + 0.08) * 1400)} Z" fill="${i % 2 ? C.butter : C.peach}" opacity="0.7"/>`; }), `<circle cx="800" cy="520" r="150" fill="${C.marigold}" opacity="0.9"/>`, `<circle cx="800" cy="520" r="210" fill="none" stroke="${C.marigold}" stroke-width="3" opacity="0.4"/>`].join(""), "#FFF4E3")],
  ["Plum orbit", () => svg("", [blob(1150, 200, 220, C.plumSoft, 1), ...Array.from({ length: 9 }, (_, i) => `<circle cx="1150" cy="250" r="${60 + i * 48}" fill="none" stroke="${C.plum}" stroke-width="${i % 3 ? 1.5 : 3}" opacity="${0.5 - i * 0.04}"/>`), `<circle cx="1150" cy="250" r="44" fill="${C.plum}" opacity="0.85"/>`, `<circle cx="${1150 + 204}" cy="${250 - 60}" r="12" fill="${C.ember}"/>`].join(""), "#F8F1F6")],
  ["Coral confetti", () => { const r = rng(7); return svg("", Array.from({ length: 60 }, () => { const x = r() * W, y = r() * H, w = 34 + r() * 70, rot = r() * 180, col = [C.coral, C.peach, C.emberLight, C.coralSoft, C.butter][Math.floor(r() * 5)]; return r() < 0.5 ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(w / 3)}" fill="${col}" opacity="0.85"/>` : `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(w / 3)}" rx="${f(w / 6)}" fill="${col}" opacity="0.85" transform="rotate(${f(rot)} ${f(x)} ${f(y)})"/>`; }).join(""), "#FFF6F3"); }],
  ["Cocoa grid", () => svg(`<pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${C.roseBrown}" stroke-width="1.5" opacity="0.6"/><circle cx="0" cy="0" r="3" fill="${C.cocoaMid}" opacity="0.6"/></pattern>`, [`<rect width="${W}" height="${H}" fill="url(#p)"/>`, blob(1250, 120, 220, C.emberLight, 0.55), blob(300, 420, 200, C.roseDeep, 0.7), `<rect x="1080" y="260" width="360" height="12" rx="6" fill="${C.cocoa}" opacity="0.55"/>`, `<rect x="1080" y="290" width="240" height="12" rx="6" fill="${C.cocoaMid}" opacity="0.5"/>`].join(""), C.sand)],
  ["Linen weave", () => svg(`<pattern id="p" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="14" height="28" fill="${C.rose}" opacity="0.55"/></pattern><pattern id="q" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="14" height="28" fill="${C.peach}" opacity="0.35"/></pattern>`, [`<rect width="${W}" height="${H}" fill="url(#p)"/>`, `<rect width="${W}" height="${H}" fill="url(#q)"/>`, blob(800, 250, 300, C.cream, 0.7)].join(""), C.peachSoft)],
  ["Tide lines", () => svg("", Array.from({ length: 16 }, (_, i) => { let d = ""; for (let x = 0; x <= W; x += 16) d += `${x ? "L" : "M"}${x} ${f(40 + i * 28 + Math.sin(x / 140 + i * 0.5) * 14)} `; return `<path d="${d}" fill="none" stroke="${i % 4 === 0 ? C.ember : C.roseBrown}" stroke-width="${i % 4 === 0 ? 2.5 : 1.5}" opacity="${i % 4 === 0 ? 0.7 : 0.45}"/>`; }).join(""), "#FBF4EF")],
  ["Bloom", () => svg("", [blob(800, 250, 280, C.peachSoft, 1), ...Array.from({ length: 12 }, (_, i) => `<ellipse cx="800" cy="130" rx="46" ry="120" fill="${i % 2 ? C.coralSoft : C.peach}" opacity="0.85" transform="rotate(${i * 30} 800 250)"/>`), `<circle cx="800" cy="250" r="56" fill="${C.ember}" opacity="0.9"/>`, `<circle cx="800" cy="250" r="24" fill="${C.butter}"/>`].join(""), "#FFF7F2")],
  ["Folio stack", () => svg("", [blob(1200, 150, 260, C.peach, 0.6), ...[0, 1, 2, 3].map((i) => `<rect x="${520 + i * 70}" y="${90 + i * 26}" width="620" height="440" rx="28" fill="${[C.rose, C.peachSoft, C.paper, "#FFFFFF"][i]}" stroke="${C.roseBrown}" stroke-opacity="0.25" transform="rotate(${-6 + i * 3} ${830 + i * 70} 300)"/>`), ...[0, 1, 2, 3, 4].map((i) => `<rect x="${760}" y="${200 + i * 34}" width="${360 - (i % 2) * 90}" height="10" rx="5" fill="${i ? C.roseBrown : C.ember}" opacity="${i ? 0.35 : 0.8}" transform="rotate(3 1040 300)"/>`)].join(""), C.cream)],
  ["Dawn mesh", () => svg("", [blob(200, 100, 280, C.lilac, 1), blob(700, 380, 300, C.peach, 1), blob(1200, 80, 260, C.rose, 1), blob(1500, 420, 240, C.lilacDeep, 0.7), blob(900, 120, 180, C.butter, 0.6)].join(""), C.cream)],
  ["Terrazzo", () => { const r = rng(14); return svg("", Array.from({ length: 90 }, () => { const x = r() * W, y = r() * H, s = 6 + r() * 26; const pts = Array.from({ length: 5 }, (_, k) => { const a = (k / 5) * Math.PI * 2 + r(); const rr = s * (0.6 + r() * 0.5); return `${f(x + Math.cos(a) * rr)},${f(y + Math.sin(a) * rr)}`; }).join(" "); return `<polygon points="${pts}" fill="${[C.emberLight, C.roseBrown, C.sage, C.peach, C.cocoaMid, C.lilacDeep][Math.floor(r() * 6)]}" opacity="0.75"/>`; }).join(""), "#F7F0EA"); }],
  ["Arches", () => svg("", [...[0, 1, 2, 3, 4].map((i) => { const cx = 260 + i * 270; const cols = [C.peach, C.rose, C.emberLight, C.sage, C.plumSoft]; return [0, 1, 2].map((k) => `<path d="M${cx - 110 + k * 30} ${H} V${230 + k * 30} a${110 - k * 30} ${110 - k * 30} 0 0 1 ${220 - k * 60} 0 V${H} Z" fill="${k === 1 ? C.cream : cols[i]}" opacity="${k === 1 ? 0.9 : 0.9}"/>`).join(""); }), `<circle cx="1420" cy="110" r="46" fill="${C.ember}" opacity="0.85"/>`].join(""), C.peachSoft)],
  ["Sandstone strata", () => svg("", [C.rose, C.peach, C.apricot, C.roseDeep, C.emberLight, C.roseBrown].map((c, i) => { let d = `M0 ${H}`; for (let x = 0; x <= W; x += 20) d += ` L${x} ${f(80 + i * 70 + Math.sin(x / 260 + i) * 34 + Math.sin(x / 90 + i * 2) * 6)}`; return `<path d="${d} L${W} ${H} Z" fill="${c}" opacity="0.9"/>`; }).join(""), C.peachSoft)],
  ["Pebbles", () => { const r = rng(17); return svg("", Array.from({ length: 26 }, () => { const x = r() * W, y = r() * H, rx = 40 + r() * 90; return `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(rx * (0.55 + r() * 0.3))}" fill="${[C.rose, C.sand, C.peachSoft, C.mossSoft, C.plumSoft][Math.floor(r() * 5)]}" stroke="#fff" stroke-width="3" opacity="0.95" transform="rotate(${f(r() * 60 - 30)} ${f(x)} ${f(y)})"/>`; }).join(""), "#F3EBE4"); }],
  ["Aurora", () => svg("", [...[C.lilacDeep, C.peach, C.coralSoft, C.sage].map((c, i) => { let d = ""; for (let x = -100; x <= W + 100; x += 40) d += `${x < 0 ? "M" : "L"}${x} ${f(120 + i * 80 + Math.sin(x / 220 + i * 1.3) * 70)} `; return `<path d="${d}" fill="none" stroke="${c}" stroke-width="90" stroke-linecap="round" opacity="0.8" filter="url(#s)"/>`; })].join(""), "#FBF3F4")],
  ["Checker sun", () => svg(`<pattern id="p" width="60" height="60" patternUnits="userSpaceOnUse"><rect width="30" height="30" fill="${C.rose}"/><rect x="30" y="30" width="30" height="30" fill="${C.rose}"/></pattern><linearGradient id="m" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient><mask id="k"><rect width="${W}" height="${H}" fill="url(#m)"/></mask>`, [`<rect width="${W}" height="${H}" fill="url(#p)" mask="url(#k)" opacity="0.8"/>`, `<circle cx="380" cy="250" r="170" fill="${C.emberLight}"/>`, `<circle cx="380" cy="250" r="170" fill="none" stroke="${C.ember}" stroke-width="3" stroke-dasharray="4 14"/>`].join(""), C.peachSoft)],
  ["Leaves", () => svg("", [blob(1300, 400, 260, C.mossSoft, 0.8), ...[[300, 330, -20, C.sage], [520, 250, 15, C.moss], [760, 340, -35, C.mossSoft], [1040, 230, 25, C.sage], [1280, 320, -10, C.moss]].map(([x, y, r, c]) => `<g transform="translate(${x} ${y}) rotate(${r})"><path d="M0 -150 C 90 -80 90 80 0 150 C -90 80 -90 -80 0 -150 Z" fill="${c}" opacity="0.85"/><path d="M0 -140 V140" stroke="#fff" stroke-width="3" opacity="0.6"/></g>`)].join(""), "#F2F3EA")],
];

mkdirSync(out, { recursive: true });
mkdirSync(webOut, { recursive: true });
const manifest = ART.map(([name, make], i) => {
  const id = `art-${String(i + 1).padStart(2, "0")}`;
  const content = make();
  writeFileSync(resolve(out, `${id}.svg`), content);
  writeFileSync(resolve(webOut, `${id}.svg`), content);
  return { id, name };
});
writeFileSync(resolve(out, "covers.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${manifest.length} covers to ${out}`);
