// Builds a Loops import kit: one zip per template (`index.mjml` at the root, as Loops expects) and a
// SETUP.md checklist with each template's subject, preview text, sender, data variables and the Convex
// env var its published id goes in. See docs/EMAIL_OPERATIONS.md §4.
//
//   node packages/email/scripts/loops-kit.ts <out-dir> [sending-domain]
//
// Order: the two identity templates first — sign-up and password reset don't work without them.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emailManifest, TEMPLATE_KEYS } from "../src/manifest.ts";
import type { TemplateKey } from "../src/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const templates = resolve(here, "../templates");
const out = resolve(process.argv[2] ?? "loops-kit");
const domain = process.argv[3] ?? "mail.folevi.com";
const replyTo = "support@folevi.com";

const rank = { identity: 0, security: 1, product: 2 } as const;
const keys = [...TEMPLATE_KEYS].sort((a, b) => rank[emailManifest[a].category] - rank[emailManifest[b].category]);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const lines: string[] = [
  "# Folevi — Loops transactional templates",
  "",
  `Sending domain: \`${domain}\` (verify it in Loops → Settings → Domain first). Reply-To on every template: \`${replyTo}\`.`,
  "",
  "For each template, in Loops: **Transactional → New** → editor → **Code** → upload the zip → set Subject,",
  "Preview, From and Reply-To → add each data variable (tick *optional* only where marked) → **Publish** →",
  "copy its **Transactional ID** and save it to Convex production:",
  "",
  "```",
  "npx convex env set <ENV VAR>        # prompts for the value",
  "```",
  "",
  "Do the first two before anyone signs up: without them, confirmation and password-reset emails can't send.",
  "",
];

keys.forEach((key: TemplateKey, i) => {
  const t = emailManifest[key];
  const n = String(i + 1).padStart(2, "0");
  const zip = `${n}-${key}.zip`;
  const tmp = mkdtempSync(join(tmpdir(), "loops-"));
  copyFileSync(join(templates, `${key}.mjml`), join(tmp, "index.mjml"));
  execFileSync("zip", ["-q", "-j", join(out, zip), join(tmp, "index.mjml")]);
  rmSync(tmp, { recursive: true, force: true });

  lines.push(`## ${n}. ${key}${t.category === "identity" ? "  — needed before launch" : ""}`, "");
  lines.push(`- **Upload:** \`${zip}\``);
  lines.push(`- **Subject:** ${t.subject}`);
  lines.push(`- **Preview:** ${t.previewText}`);
  lines.push(`- **From:** ${t.sender.name} <${t.sender.localPart}@${domain}>`);
  lines.push(`- **Reply-To:** ${replyTo}`);
  lines.push(`- **Data variables:**`);
  for (const [name, spec] of Object.entries(t.variables)) {
    lines.push(`  - \`${name}\` (${spec.type}${spec.required ? "" : ", **optional**"}) — ${spec.description}`);
  }
  lines.push(`- **Save the Transactional ID to:** \`${t.envVar}\``, "");
});

writeFileSync(join(out, "SETUP.md"), `${lines.join("\n")}\n`);
console.log(`Wrote ${keys.length} templates and SETUP.md to ${out}`);
