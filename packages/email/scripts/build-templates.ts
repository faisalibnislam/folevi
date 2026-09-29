// Generates packages/email/templates/<key>.mjml and <key>.txt from the manifest plus the
// copy below, so every template shares one audited layout (the neutral Folevi look, matching the app).
//
//   node scripts/build-templates.ts          # write files
//   node scripts/build-templates.ts --check  # exit 1 if files are stale (used by `typecheck`)
//
// Runs with Node >= 22.18 / 24 native type stripping (no build step, no dependencies).
// MJML is compiled by Loops on import — mjml is NOT a dependency of this repo.
//
// Loops transactional placeholders use `{DATA_VARIABLE:name}` (verified against
// https://loops.so/docs/creating-emails/uploading-custom-email, Sept 2026).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emailManifest, TEMPLATE_KEYS } from "../src/manifest.ts";
import type { TemplateDefinition, TemplateKey } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Brand tokens
// ---------------------------------------------------------------------------
// Neutral, like the app: white card on a soft grey canvas, near-black ink and a black button.
const C = {
  canvas: "#F4F4F5",
  card: "#FFFFFF",
  ink: "#0B0B0C",
  muted: "#63636B",
  accent: "#111114",
  hairline: "#E4E4E7",
  // The mark (brand files: a white F on a black disc) stays the same in dark mode.
  tile: "#0B0B0C",
  tileEdge: "#1F2227",
  // Dark-mode counterparts (applied only by clients that honour prefers-color-scheme).
  darkCanvas: "#0B0B0C",
  darkCard: "#18181B",
  darkInk: "#F2F2F3",
  darkMuted: "#A1A1AA",
  darkAccent: "#F2F2F3",
  darkHairline: "#2A2A2D",
} as const;

const SERIF = "'Iowan Old Style', 'Palatino Linotype', Georgia, ui-serif, 'Times New Roman', serif";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------
// Inline syntax inside strings:  {{name}} → placeholder,  [[name]] → bold placeholder.
type Block =
  | { kind: "p"; text: string; muted?: boolean }
  | { kind: "details"; rows: Array<[label: string, value: string]> }
  | { kind: "button"; label: string; urlVar: string }
  | { kind: "code"; variable: string }
  | { kind: "quote"; variable: string };

interface Content {
  eyebrow: string;
  heading: string;
  blocks: Block[];
  /** Product only: why the recipient got this email (before the preferences link). */
  reason?: string;
}

const SECURITY_FOOTER =
  "This is a required email about the security of your Folevi account, so it is sent even if you have turned off notifications.";

const CONTENT: Record<TemplateKey, Content> = {
  auth_verify_email: {
    eyebrow: "Your account",
    heading: "Confirm your email address",
    blocks: [
      {
        kind: "p",
        text: "Welcome to Folevi. To finish setting up your account, confirm that this email address belongs to you.",
      },
      { kind: "button", label: "Confirm email address", urlVar: "actionUrl" },
      {
        kind: "p",
        muted: true,
        text: "This link expires in {{expiresInHours}} hour(s). If you did not create a Folevi account, you can ignore this email and nothing will be activated.",
      },
    ],
  },
  auth_password_reset: {
    eyebrow: "Your account",
    heading: "Reset your password",
    blocks: [
      {
        kind: "p",
        text: "We received a request to reset the password for your Folevi account. Use the button below to choose a new one.",
      },
      { kind: "button", label: "Choose a new password", urlVar: "actionUrl" },
      {
        kind: "p",
        muted: true,
        text: "This link expires in {{expiresInHours}} hour(s) and works once. If you did not ask to reset your password, you can ignore this email and your current password will keep working.",
      },
    ],
  },
  security_new_device: {
    eyebrow: "Account security",
    heading: "New sign-in to your account",
    blocks: [
      {
        kind: "p",
        text: "Your Folevi account was just signed in to from a device we have not seen before.",
      },
      {
        kind: "details",
        rows: [
          ["Device", "{{deviceLabel}}"],
          ["Approximate location", "{{approximateLocation}}"],
          ["Time", "{{signedInAt}}"],
        ],
      },
      {
        kind: "p",
        text: "If this was you, there is nothing else to do. If it was not, sign that device out and change your password.",
      },
      { kind: "button", label: "Review account security", urlVar: "securityUrl" },
    ],
  },
  account_deletion_scheduled: {
    eyebrow: "Your account",
    heading: "Your account is scheduled for deletion",
    blocks: [
      {
        kind: "p",
        text: "As requested, your Folevi account will be permanently deleted on [[scheduledFor]], together with everything in your Personal and any workspace only you use. Workspaces other people use aren’t deleted.",
      },
      { kind: "p", text: "Until then, you can change your mind." },
      { kind: "button", label: "Cancel account deletion", urlVar: "cancelUrl" },
      {
        kind: "p",
        muted: true,
        text: "If you did not request this, cancel the deletion and change your password right away.",
      },
    ],
  },
  account_deletion_completed: {
    eyebrow: "Your account",
    heading: "Your account has been deleted",
    blocks: [
      {
        kind: "p",
        text: "Your Folevi account and its data were permanently deleted on [[completedOn]]. This is the last email you will receive about this account.",
      },
      {
        kind: "p",
        muted: true,
        text: "Limited records may be retained where the law requires it, as described in the Folevi privacy policy. Thank you for writing with Folevi.",
      },
    ],
  },
  workspace_invite: {
    eyebrow: "Invitation",
    heading: "You have been invited to a workspace",
    blocks: [
      {
        kind: "p",
        text: "[[inviterName]] invited you to join the workspace [[workspaceName]] as [[role]].",
      },
      { kind: "button", label: "Accept invitation", urlVar: "acceptUrl" },
      {
        kind: "p",
        muted: true,
        text: "This invitation expires in {{expiresInDays}} day(s). If you were not expecting it, you can ignore this email.",
      },
    ],
    reason: "You received this because someone invited this email address to Folevi.",
  },
  mention_notification: {
    eyebrow: "Mention",
    heading: "You were mentioned",
    blocks: [
      { kind: "p", text: "[[actorName]] mentioned you in [[documentTitle]]." },
      { kind: "p", muted: true, text: "Open the document to read it. Folevi never puts your notes or comments in email." },
      { kind: "button", label: "View the mention", urlVar: "documentUrl" },
    ],
    reason: "You received this because mention emails are turned on for your Folevi account.",
  },
  comment_notification: {
    eyebrow: "Comment",
    heading: "New comment on a document",
    blocks: [
      { kind: "p", text: "[[actorName]] commented on [[documentTitle]]." },
      { kind: "p", muted: true, text: "Open the document to read it. Folevi never puts your notes or comments in email." },
      { kind: "button", label: "View the comment", urlVar: "documentUrl" },
    ],
    reason: "You received this because comment emails are turned on for your Folevi account.",
  },
  comment_digest: {
    eyebrow: "Digest",
    heading: "Recent comments",
    blocks: [
      { kind: "p", text: "There are [[count]] new comment(s) on documents you follow." },
      { kind: "p", text: "{{summary}}" },
      { kind: "button", label: "Open your inbox", urlVar: "inboxUrl" },
    ],
    reason: "You received this because the comment digest is turned on for your Folevi account.",
  },
  share_notification: {
    eyebrow: "Shared with you",
    heading: "A document was shared with you",
    blocks: [
      { kind: "p", text: "[[actorName]] shared [[documentTitle]] with you." },
      { kind: "details", rows: [["Your access", "{{role}}"]] },
      { kind: "button", label: "Open the document", urlVar: "documentUrl" },
    ],
    reason: "You received this because share emails are turned on for your Folevi account.",
  },
  access_changed: {
    eyebrow: "Access",
    heading: "Your access changed",
    blocks: [
      { kind: "p", text: "[[actorName]] {{summary}}" },
      { kind: "button", label: "Open Folevi", urlVar: "actionUrl" },
      {
        kind: "p",
        muted: true,
        text: "If you think this was a mistake, ask the person who made the change.",
      },
    ],
    reason: "You received this because share emails are turned on for your Folevi account.",
  },
};

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------
const placeholder = (name: string) => `{DATA_VARIABLE:${name}}`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Static copy → HTML, expanding {{var}} / [[var]]. Placeholders are never escaped. */
function inlineHtml(s: string): string {
  return s
    .split(/(\{\{\w+\}\}|\[\[\w+\]\])/)
    .map((part) => {
      const plain = /^\{\{(\w+)\}\}$/.exec(part);
      if (plain) return placeholder(plain[1]!);
      const bold = /^\[\[(\w+)\]\]$/.exec(part);
      if (bold) return `<strong>${placeholder(bold[1]!)}</strong>`;
      return escapeHtml(part);
    })
    .join("");
}

function inlineText(s: string): string {
  return s.replace(/\{\{(\w+)\}\}|\[\[(\w+)\]\]/g, (_m, a: string, b: string) =>
    placeholder(a ?? b),
  );
}

function wrap(text: string, width = 72): string {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      if (line && line.length + 1 + word.length > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

// The Folevi mark (packages/design-tokens/brand): a white F on a black disc. Emails carry no images, so
// it's drawn with table cells from mark-pixels.json — a 28 x 28 grid of grey levels written by
// packages/design-tokens/scripts/brand-icons.mjs from the brand file, anti-aliased, with runs of equal
// cells merged. The disc is the table's rounded background. Hidden from assistive tech (the wordmark is text).
const MARK_PIXELS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "mark-pixels.json"), "utf8")) as { size: number; levels: number; rows: string[] };
/** Grey level → colour, from the disc (0) to white. */
function markLevel(level: number): string {
  const t = level / MARK_PIXELS.levels;
  const [r, g, b] = [0x0b, 0x0b, 0x0c].map((c) => Math.round(c + (255 - c) * t));
  return `#${[r, g, b].map((c) => c!.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
const LOGO_MARK = [
  `<table role="presentation" aria-hidden="true" cellpadding="0" cellspacing="0" border="0" class="fv-mark" style="border-collapse:separate;border:1px solid ${C.tileEdge};border-radius:50%;background-color:${C.tile};overflow:hidden;width:${MARK_PIXELS.size}px;height:${MARK_PIXELS.size}px;">`,
  ...MARK_PIXELS.rows.map((row) => {
    const runs: { level: number; w: number }[] = [];
    for (const ch of row) {
      const level = Number(ch);
      const last = runs[runs.length - 1];
      if (last && last.level === level) last.w++;
      else runs.push({ level, w: 1 });
    }
    const cells = runs.map(({ level, w }) => {
      const colour = level ? `background-color:${markLevel(level)};` : "";
      const cls = level ? ` class="fv-m${level}"` : "";
      return `<td${cls}${w > 1 ? ` colspan="${w}"` : ""} style="width:${w}px;height:1px;${colour}font-size:0;line-height:0;">&nbsp;</td>`;
    });
    return `<tr>${cells.join("")}</tr>`;
  }),
  `</table>`,
].join("");
/** Dark-mode clients that honour prefers-color-scheme keep the mark's own colours. */
const MARK_DARK_CSS = Array.from({ length: MARK_PIXELS.levels }, (_, i) => `.fv-canvas table.fv-mark td.fv-m${i + 1} { background-color: ${markLevel(i + 1)} !important; }`).join("\n        ");

function renderBlockMjml(block: Block): string {
  switch (block.kind) {
    case "p":
      return block.muted
        ? `        <mj-text css-class="fv-muted" color="${C.muted}" font-size="14px" line-height="22px">${inlineHtml(block.text)}</mj-text>`
        : `        <mj-text>${inlineHtml(block.text)}</mj-text>`;
    case "details": {
      const rows = block.rows
        .map(
          ([label, value]) =>
            `<tr><td class="fv-muted-cell" style="padding:6px 16px 6px 0;color:${C.muted};font-size:14px;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;font-size:15px;vertical-align:top;">${inlineHtml(value)}</td></tr>`,
        )
        .join("");
      return `        <mj-table css-class="fv-details" color="${C.ink}" font-family="${SANS}" padding="4px 32px 12px 32px">${rows}</mj-table>`;
    }
    case "button": {
      const href = placeholder(block.urlVar);
      return [
        `        <mj-button href="${href}" css-class="fv-button" background-color="${C.accent}" color="${C.card}" font-size="16px" font-weight="600" border-radius="8px" inner-padding="13px 24px" align="left" padding="12px 32px 8px 32px">${escapeHtml(block.label)}</mj-button>`,
        `        <mj-text css-class="fv-muted" color="${C.muted}" font-size="14px" line-height="22px" padding="4px 32px 16px 32px">Button not working? Paste this link into your browser:<br /><a href="${href}" class="fv-link" style="color:${C.accent};word-break:break-all;">${href}</a></mj-text>`,
      ].join("\n");
    }
    case "code":
      return `        <mj-text css-class="fv-code" align="left" font-family="${MONO}" font-size="30px" line-height="40px" letter-spacing="6px" padding="8px 32px 16px 32px"><span style="display:inline-block;padding:10px 18px;border:1px solid ${C.hairline};border-radius:8px;background-color:${C.canvas};" class="fv-code-box">${placeholder(block.variable)}</span></mj-text>`;
    case "quote":
      return `        <mj-text css-class="fv-muted" color="${C.muted}" font-size="15px" line-height="24px" font-style="italic" padding="0 32px 12px 32px">${placeholder(block.variable)}</mj-text>`;
  }
}

function renderMjml(def: TemplateDefinition, content: Content): string {
  const body = content.blocks.map(renderBlockMjml).join("\n");
  const product = def.category === "product";
  const footer = product
    ? `        <mj-text css-class="fv-muted" color="${C.muted}" font-size="14px" line-height="22px">${escapeHtml(content.reason ?? "")} <a href="${placeholder("preferencesUrl")}" class="fv-link" style="color:${C.accent};">Manage notification preferences</a></mj-text>`
    : `        <mj-text css-class="fv-muted" color="${C.muted}" font-size="14px" line-height="22px">${escapeHtml(SECURITY_FOOTER)}</mj-text>`;

  // The provenance comment sits inside <mj-head> so MJML parses it but it never reaches the
  // rendered HTML body.
  return `<mjml lang="en" dir="ltr">
  <mj-head>
    <!--
      GENERATED by packages/email/scripts/build-templates.ts; edit the script, not this file.
      Template: ${def.key} (${def.category}). Loops env var: ${def.envVar}.
      Sender: ${def.sender.name} <${def.sender.localPart}@LOOPS_SENDING_DOMAIN>.
      Import: copy to index.mjml, zip, upload via Loops editor > Code (docs/EMAIL_OPERATIONS.md).
    -->
    <mj-title>${escapeHtml(def.subject)}</mj-title>
    <mj-preview>${escapeHtml(def.previewText)}</mj-preview>
    <mj-raw>
      <meta name="color-scheme" content="light dark" />
      <meta name="supported-color-schemes" content="light dark" />
    </mj-raw>
    <mj-attributes>
      <mj-all font-family="${SANS}" />
      <mj-text color="${C.ink}" font-size="16px" line-height="26px" padding="0 32px 16px 32px" />
      <mj-section padding="0" />
    </mj-attributes>
    <mj-style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      .fv-link { color: ${C.accent}; text-decoration: underline; }
      @media (prefers-color-scheme: dark) {
        body, .fv-body, .fv-canvas, .fv-canvas table, .fv-canvas td { background-color: ${C.darkCanvas} !important; }
        /* The mark keeps its brand colours: a white F on a black disc. */
        .fv-canvas table.fv-mark, .fv-canvas table.fv-mark td { background-color: ${C.tile} !important; }
        ${MARK_DARK_CSS}
        .fv-card, .fv-card table, .fv-card td { background-color: ${C.darkCard} !important; border-color: ${C.darkHairline} !important; }
        .fv-card div, .fv-card td, .fv-card strong, .fv-wordmark div { color: ${C.darkInk} !important; }
        .fv-muted div, .fv-muted-cell, .fv-canvas .fv-muted div { color: ${C.darkMuted} !important; }
        .fv-link, .fv-card a.fv-link { color: ${C.darkAccent} !important; }
        .fv-button td, .fv-button a, .fv-button p { background-color: ${C.darkAccent} !important; color: ${C.darkCanvas} !important; }
        .fv-code-box { background-color: ${C.darkCanvas} !important; border-color: ${C.darkHairline} !important; }
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="${C.canvas}" width="600px" css-class="fv-body">
    <mj-wrapper css-class="fv-canvas" background-color="${C.canvas}" padding="32px 12px 8px 12px">
      <mj-section>
        <mj-column>
          <mj-raw>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 20px;">
              <tr>
                <td style="vertical-align:middle;padding-right:10px;">${LOGO_MARK}</td>
                <td class="fv-wordmark" style="vertical-align:middle;font-family:${SANS};font-size:22px;font-weight:700;line-height:24px;color:${C.ink};letter-spacing:-0.6px;"><div style="color:${C.ink};">Folevi</div></td>
              </tr>
            </table>
          </mj-raw>
        </mj-column>
      </mj-section>
    </mj-wrapper>
    <mj-wrapper css-class="fv-canvas" background-color="${C.canvas}" padding="0 12px">
      <mj-section css-class="fv-card" background-color="${C.card}" border="1px solid ${C.hairline}" border-radius="12px" padding="28px 0 16px 0">
        <mj-column>
        <mj-text css-class="fv-muted" color="${C.muted}" font-size="14px" line-height="20px" letter-spacing="1px" text-transform="uppercase" padding="0 32px 8px 32px">${escapeHtml(content.eyebrow)}</mj-text>
        <mj-text font-family="${SERIF}" font-size="28px" line-height="36px" padding="0 32px 16px 32px"><h1 style="margin:0;font-size:28px;line-height:36px;font-weight:normal;font-family:${SERIF};">${inlineHtml(content.heading)}</h1></mj-text>
${body}
        </mj-column>
      </mj-section>
    </mj-wrapper>
    <mj-wrapper css-class="fv-canvas" background-color="${C.canvas}" padding="16px 12px 32px 12px">
      <mj-section>
        <mj-column>
${footer}
        <mj-text css-class="fv-muted" color="${C.muted}" font-size="14px" line-height="22px">Folevi · A quieter place for ideas that keep growing.</mj-text>
        </mj-column>
      </mj-section>
    </mj-wrapper>
  </mj-body>
</mjml>
`;
}

function renderText(def: TemplateDefinition, content: Content): string {
  const parts: string[] = ["Folevi", "", wrap(inlineText(content.heading)), ""];
  for (const block of content.blocks) {
    switch (block.kind) {
      case "p":
        parts.push(wrap(inlineText(block.text)), "");
        break;
      case "details":
        for (const [label, value] of block.rows) parts.push(`${label}: ${inlineText(value)}`);
        parts.push("");
        break;
      case "button":
        parts.push(`${block.label}:`, placeholder(block.urlVar), "");
        break;
      case "code":
        parts.push(`    ${placeholder(block.variable)}`, "");
        break;
      case "quote":
        parts.push(`> ${placeholder(block.variable)}`, "");
        break;
    }
  }
  parts.push("--");
  if (def.category === "product") {
    parts.push(
      wrap(content.reason ?? ""),
      `Manage notification preferences: ${placeholder("preferencesUrl")}`,
    );
  } else {
    parts.push(wrap(SECURITY_FOOTER));
  }
  parts.push("Folevi · A quieter place for ideas that keep growing.", "");
  return parts.join("\n");
}

export function renderAll(): Map<string, string> {
  const files = new Map<string, string>();
  for (const key of TEMPLATE_KEYS) {
    const def = emailManifest[key];
    const content = CONTENT[key];
    files.set(def.source.path, renderMjml(def, content));
    files.set(def.source.path.replace(/\.mjml$/, ".txt"), renderText(def, content));
  }
  return files;
}

function main(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const check = process.argv.includes("--check");
  const stale: string[] = [];
  for (const [rel, contents] of renderAll()) {
    const abs = join(root, rel);
    let current: string | null;
    try {
      current = readFileSync(abs, "utf8");
    } catch {
      current = null;
    }
    if (current === contents) continue;
    if (check) {
      stale.push(rel);
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, contents);
      console.log(`wrote ${rel}`);
    }
  }
  if (check && stale.length > 0) {
    console.error(
      `Stale email templates (run: pnpm --filter @folevi/email templates):\n  ${stale.join("\n  ")}`,
    );
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
