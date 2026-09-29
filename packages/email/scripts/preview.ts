// Renders every template with its manifest fixture into packages/email/preview/ (gitignored):
// one <key>.html and <key>.txt per template plus an index.html with light and dark previews side by side.
// The logo is loaded from the local brand files (apps/web/public/brand/email), so previews work offline.
//
//   pnpm --filter @folevi/email preview
//
// Uses the real renderEmail(). src/ uses extensionless imports (bundler resolution), so a resolve hook
// maps them to their .ts files for Node's type stripping.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { emailManifest, TEMPLATE_KEYS } = await import("../src/manifest.ts");
const { renderEmail, escapeHtml } = await import("../src/render.ts");

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../preview");
const brandDir = join(here, "../../../apps/web/public/brand/email");
const brandBaseUrl = relative(out, brandDir).split("\\").join("/");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const cards: string[] = [];
for (const key of TEMPLATE_KEYS) {
  const def = emailManifest[key];
  const email = renderEmail(key, def.fixture, { brandBaseUrl: brandBaseUrl.startsWith(".") ? brandBaseUrl : `./${brandBaseUrl}` });
  writeFileSync(join(out, `${key}.html`), email.html);
  writeFileSync(join(out, `${key}.txt`), email.text);
  const k = escapeHtml(key);
  cards.push(`<section>
  <h2>${k} <small>${escapeHtml(def.category)}</small></h2>
  <p class="meta"><b>Subject:</b> ${escapeHtml(email.subject)}<br><b>Preview:</b> ${escapeHtml(email.previewText)}<br>
  <a href="${k}.html">HTML</a> · <a href="${k}.txt">Text</a></p>
  <div class="pair">
    <figure><figcaption>Light</figcaption><iframe src="${k}.html" title="${k} (light)" style="color-scheme: light"></iframe></figure>
    <figure class="dark"><figcaption>Dark (prefers-color-scheme)</figcaption><iframe src="${k}.html" title="${k} (dark)" style="color-scheme: dark"></iframe></figure>
  </div>
</section>`);
}

writeFileSync(
  join(out, "index.html"),
  `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Folevi email previews</title>
<style>
  body { margin: 0; padding: 32px; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background: #fff; color: #0B0B0C; }
  h1 { font: 400 28px Georgia, serif; margin: 0 0 4px; }
  section { margin: 40px 0; }
  h2 { font-size: 16px; margin: 0; } small { color: #63636B; font-weight: 400; }
  .meta { color: #63636B; margin: 4px 0 12px; }
  .pair { display: flex; gap: 16px; flex-wrap: wrap; }
  figure { margin: 0; flex: 1 1 420px; } figcaption { color: #63636B; margin-bottom: 6px; }
  iframe { width: 100%; height: 760px; border: 1px solid #E4E4E7; border-radius: 12px; }
</style></head>
<body>
<h1>Folevi email previews</h1>
<p class="meta">${TEMPLATE_KEYS.length} templates rendered with their manifest fixtures. The dark column sets the frame's colour scheme, which is what Apple Mail's dark mode reacts to (open a template on its own with your system in dark mode to check it too).</p>
${cards.join("\n")}
</body></html>
`,
);

console.log(`Wrote ${readdirSync(out).length} files to ${out}\nOpen ${join(out, "index.html")}`);
