// Compiles every Folevi email to final HTML + plain text in src/generated/templates.ts, from the
// manifest plus the copy below, so all templates share one audited layout (the neutral Folevi look,
// matching the app).
//
//   node scripts/build-templates.ts          # write the generated module
//   node scripts/build-templates.ts --check  # exit 1 if it is stale (used by `typecheck`)
//
// Runs with Node >= 22.18 / 24 native type stripping (no build step, no dependencies).
//
// Why hand-written tables rather than MJML: the layout is one centred column (logo, card, footer), which
// is a few dozen lines of table markup; writing it directly keeps the package dependency-free (mjml
// pulls in a large tree of html-minifier, juice, cheerio and js-beautify for what we'd use of it), makes the
// output deterministic for `--check`, and gives us exact control over the dark-mode classes and the
// Outlook conditionals. Everything that matters for email clients is here: role="presentation" tables,
// inline styles on every element, a 560 px max width (with an MSO fixed-width wrapper), bgcolor
// attributes, and a <style> block used only for progressive enhancement (dark mode, small screens).
//
// Placeholders: `{{name}}` is a template variable (renderEmail HTML-escapes it, validates URLs and turns
// newlines into <br> in HTML); `{{@brand}}` is the logo base URL. In the copy below, `[[name]]` is a bold
// variable.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EMAIL_LOGO, emailManifest, TEMPLATE_KEYS } from "../src/manifest.ts";
import type { GeneratedTemplate, TemplateDefinition, TemplateKey } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Brand tokens
// ---------------------------------------------------------------------------
// Neutral, like the app: a white card on the soft canvas, near-black ink, hairlines and a black button.
export const C = {
  canvas: "#F4F4F5",
  card: "#FFFFFF",
  ink: "#0B0B0C",
  muted: "#63636B",
  hairline: "#E4E4E7",
  panel: "#FAFAFA",
  buttonInk: "#FFFFFF",
  // Dark-mode counterparts (only for clients that honour prefers-color-scheme, e.g. Apple Mail).
  darkCanvas: "#0B0B0C",
  darkCard: "#18181B",
  darkInk: "#F2F2F3",
  darkMuted: "#A1A1AA",
  darkHairline: "#2A2A2D",
  darkPanel: "#111113",
} as const;

// Spectral and Instrument Sans in the app; email-safe stacks here (no web fonts: nothing remote but the logo).
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------
// Inline syntax inside strings:  {{name}} → variable,  [[name]] → bold variable.
type Block =
  | { kind: "p"; text: string; muted?: boolean }
  | { kind: "details"; rows: Array<[label: string, value: string]> }
  | { kind: "panel"; text: string }
  | { kind: "button"; label: string; urlVar: string };

interface Content {
  eyebrow: string;
  heading: string;
  blocks: Block[];
  /** Product only: why the recipient got this email (before the preferences link). */
  reason?: string;
  /** Support only: the footer line (defaults to SUPPORT_FOOTER). */
  footer?: string;
}

export const SECURITY_FOOTER =
  "This is a required email about the security of your Folevi account, so it is sent even if you have turned off notifications.";
export const SUPPORT_FOOTER =
  "You received this because you contacted Folevi support. Folevi support will never ask for your password or your two-step verification codes.";
const SUPPORT_THREAD_NOTE =
  "To add details, reply to this email. Keep the request number in the subject so your reply joins this request.";
export const SIGN_OFF = "Folevi · A quieter place for ideas that keep growing.";
const NO_CONTENT_NOTE = "Open the page to read it. Folevi never puts your notes or comments in email.";

export const CONTENT: Record<TemplateKey, Content> = {
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
        text: "This link expires in {{expiresInHours hour|hours}}. If you did not create a Folevi account, you can ignore this email and nothing will be activated.",
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
        text: "This link expires in {{expiresInHours hour|hours}} and works once. If you did not ask to reset your password, you can ignore this email and your current password will keep working.",
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
    heading: "You’re invited to a workspace",
    blocks: [
      {
        kind: "p",
        text: "[[inviterName]] invited you to join the workspace [[workspaceName]] as [[role]].",
      },
      {
        kind: "p",
        text: "A workspace is a shared space for a team. Joining it doesn’t share anything from your Personal.",
      },
      { kind: "button", label: "Accept invitation", urlVar: "acceptUrl" },
      {
        kind: "p",
        muted: true,
        text: "This invitation expires in {{expiresInDays}} day(s). If you don’t have a Folevi account yet, you can create one with this email address when you accept. If you were not expecting it, you can ignore this email.",
      },
    ],
    reason: "You received this because someone invited this email address to a Folevi workspace.",
  },
  mention_notification: {
    eyebrow: "Mention",
    heading: "You were mentioned",
    blocks: [
      { kind: "p", text: "[[actorName]] mentioned you on [[documentTitle]]." },
      { kind: "p", muted: true, text: NO_CONTENT_NOTE },
      { kind: "button", label: "View the mention", urlVar: "documentUrl" },
    ],
    reason: "You received this because mention emails are turned on for your Folevi account.",
  },
  comment_notification: {
    eyebrow: "Comment",
    heading: "New comment on a page",
    blocks: [
      { kind: "p", text: "[[actorName]] commented on [[documentTitle]]." },
      { kind: "p", muted: true, text: NO_CONTENT_NOTE },
      { kind: "button", label: "View the comment", urlVar: "documentUrl" },
    ],
    reason: "You received this because comment emails are turned on for your Folevi account.",
  },
  comment_digest: {
    eyebrow: "Daily digest",
    heading: "Recent comments",
    blocks: [
      { kind: "p", text: "There are [[count]] new comment(s) and mention(s) on pages you follow." },
      { kind: "panel", text: "{{summary}}" },
      { kind: "button", label: "Open Folevi", urlVar: "inboxUrl" },
    ],
    reason: "You received this because the daily digest is turned on for your Folevi account.",
  },
  share_notification: {
    eyebrow: "Shared with you",
    heading: "A page was shared with you",
    blocks: [
      { kind: "p", text: "[[actorName]] shared [[documentTitle]] with you." },
      { kind: "details", rows: [["Your access", "{{role}}"]] },
      { kind: "button", label: "Open the page", urlVar: "documentUrl" },
      {
        kind: "p",
        muted: true,
        text: "No Folevi account yet? You can create one with this email address to open it. You’ll see only what was shared with you.",
      },
    ],
    reason: "You received this because someone shared a page in Folevi with this email address.",
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
  support_ticket_received: {
    eyebrow: "Folevi support",
    heading: "We got your message",
    blocks: [
      {
        kind: "p",
        text: "Thanks for writing to Folevi support. We reply by email to this address.",
      },
      {
        kind: "details",
        rows: [
          ["Request", "#{{ticketNumber}}"],
          ["Topic", "{{topicLabel}}"],
        ],
      },
      { kind: "p", muted: true, text: "Here is what you sent:" },
      { kind: "panel", text: "{{quotedMessage}}" },
      { kind: "p", text: SUPPORT_THREAD_NOTE },
      {
        kind: "p",
        muted: true,
        text: "If you didn't contact Folevi support, you can ignore this email.",
      },
    ],
  },
  support_reply: {
    eyebrow: "Folevi support",
    heading: "A reply to your request",
    blocks: [
      { kind: "p", text: "Here is our reply to request #[[ticketNumber]]." },
      { kind: "panel", text: "{{replyText}}" },
      { kind: "p", text: SUPPORT_THREAD_NOTE },
    ],
  },
  support_staff_notice: {
    eyebrow: "Support inbox",
    heading: "New support activity",
    blocks: [
      { kind: "p", text: "[[activity]] on request #[[ticketNumber]]." },
      {
        kind: "details",
        rows: [
          ["Topic", "{{topicLabel}}"],
          ["Came from", "{{sourceLabel}}"],
        ],
      },
      {
        kind: "p",
        muted: true,
        text: "The message isn't included in this email. Open the request in the admin console to read and answer it.",
      },
      { kind: "button", label: "Open the request", urlVar: "adminUrl" },
    ],
    footer:
      "Sent to the Folevi support team because SUPPORT_NOTIFY_EMAIL is set on this deployment. Replies to this email are not read.",
  },
};

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------
const placeholder = (name: string) => `{{${name}}}`;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Static copy → HTML, keeping {{var}} and turning [[var]] into a bold {{var}}. */
function inlineHtml(s: string): string {
  return s
    .split(/(\{\{\w+\}\}|\[\[\w+\]\])/)
    .map((part) => {
      const plain = /^\{\{(\w+)\}\}$/.exec(part);
      if (plain) return placeholder(plain[1]!);
      const bold = /^\[\[(\w+)\]\]$/.exec(part);
      if (bold) return `<strong style="font-weight:600;">${placeholder(bold[1]!)}</strong>`;
      return escapeHtml(part);
    })
    .join("");
}

function inlineText(s: string): string {
  return s.replace(/\[\[(\w+)\]\]/g, (_m, name: string) => placeholder(name));
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

const font = (size: number, lineHeight: number, colour: string, family = SANS) =>
  `font-family:${family};font-size:${size}px;line-height:${lineHeight}px;color:${colour};`;

function paragraph(html: string, muted = false): string {
  return muted
    ? `<p class="fv-muted" style="margin:0 0 16px 0;${font(14, 22, C.muted)}">${html}</p>`
    : `<p class="fv-ink" style="margin:0 0 16px 0;${font(16, 26, C.ink)}">${html}</p>`;
}

function renderBlockHtml(block: Block): string {
  switch (block.kind) {
    case "p":
      return paragraph(inlineHtml(block.text), block.muted);
    case "details": {
      const rows = block.rows
        .map(([label, value], i) => {
          const border = i > 0 ? `border-top:1px solid ${C.hairline};` : "";
          return (
            `<tr>` +
            `<td class="fv-muted fv-hair fv-label" valign="top" width="1%" style="${border}width:1%;padding:12px 24px 12px 0;${font(14, 22, C.muted)}white-space:nowrap;">${escapeHtml(label)}</td>` +
            `<td class="fv-ink fv-hair" valign="top" style="${border}padding:12px 0;${font(15, 22, C.ink)}word-break:break-word;">${inlineHtml(value)}</td>` +
            `</tr>`
          );
        })
        .join("");
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fv-panel" bgcolor="${C.panel}" style="width:100%;margin:4px 0 20px 0;background-color:${C.panel};border:1px solid ${C.hairline};border-radius:12px;border-collapse:separate;">` +
        `<tr><td class="fv-panel-pad" style="padding:4px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">${rows}</table></td></tr></table>`
      );
    }
    case "panel":
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fv-panel" bgcolor="${C.panel}" style="width:100%;margin:4px 0 20px 0;background-color:${C.panel};border:1px solid ${C.hairline};border-radius:12px;border-collapse:separate;">` +
        `<tr><td class="fv-ink" style="padding:16px 20px;${font(15, 24, C.ink)}">${inlineHtml(block.text)}</td></tr></table>`
      );
    case "button": {
      const href = placeholder(block.urlVar);
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px 0;border-collapse:separate;"><tr>` +
        `<td class="fv-btn" align="center" bgcolor="${C.ink}" style="border-radius:10px;background-color:${C.ink};mso-padding-alt:14px 26px;">` +
        `<a href="${href}" target="_blank" rel="noopener" class="fv-btn-a" style="display:inline-block;padding:14px 26px;${font(16, 20, C.buttonInk)}font-weight:600;text-decoration:none;border-radius:10px;">${escapeHtml(block.label)}</a>` +
        `</td></tr></table>` +
        paragraph(
          `Button not working? Paste this link into your browser:<br><a href="${href}" target="_blank" rel="noopener" class="fv-link" style="color:${C.ink};text-decoration:underline;word-break:break-all;">${href}</a>`,
          true,
        )
      );
    }
  }
}

const DARK_CSS = `
      @media (prefers-color-scheme: dark) {
        body, .fv-canvas { background-color: ${C.darkCanvas} !important; }
        .fv-card { background-color: ${C.darkCard} !important; border-color: ${C.darkHairline} !important; }
        .fv-panel { background-color: ${C.darkPanel} !important; border-color: ${C.darkHairline} !important; }
        .fv-hair { border-color: ${C.darkHairline} !important; }
        .fv-ink, .fv-ink strong, h1.fv-ink { color: ${C.darkInk} !important; }
        .fv-muted { color: ${C.darkMuted} !important; }
        .fv-link { color: ${C.darkInk} !important; }
        .fv-btn { background-color: ${C.darkInk} !important; }
        .fv-btn-a { color: ${C.darkCanvas} !important; }
        .fv-logo-light { display: none !important; }
        .fv-logo-dark { display: block !important; max-height: none !important; overflow: visible !important; }
      }`;

// Outlook.com / Outlook apps rewrite colours in dark mode and mark the elements with data-ogsc / data-ogsb;
// swapping the logo there keeps the letters readable.
const OUTLOOK_DARK_CSS = `
      [data-ogsc] .fv-logo-light { display: none !important; }
      [data-ogsc] .fv-logo-dark { display: block !important; max-height: none !important; overflow: visible !important; }`;

function logoHtml(): string {
  const img = (file: string) =>
    `<img src="{{@brand}}/${file}" width="${EMAIL_LOGO.width}" height="${EMAIL_LOGO.height}" alt="Folevi" border="0" style="display:block;width:${EMAIL_LOGO.width}px;height:auto;max-width:${EMAIL_LOGO.width}px;border:0;outline:none;text-decoration:none;">`;
  const light = img(EMAIL_LOGO.light).replace("<img ", '<img class="fv-logo-light" ');
  // The dark variant is hidden unless the client applies the dark-mode rules above; Outlook desktop never sees it.
  const dark = `<!--[if !mso]><!--><div class="fv-logo-dark" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${img(EMAIL_LOGO.dark)}</div><!--<![endif]-->`;
  return light + dark;
}

/** Preview text, padded so clients don't pull body copy into the inbox preview. */
function preheader(text: string): string {
  const pad = "&#847;&zwnj;&nbsp;".repeat(40);
  return `<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas};opacity:0;">${escapeHtml(text)}${pad}</div>`;
}

function renderHtml(def: TemplateDefinition, content: Content): string {
  const body = content.blocks.map(renderBlockHtml).join("\n");
  const footer =
    def.category === "product"
      ? `${escapeHtml(content.reason ?? "")} <a href="${placeholder("preferencesUrl")}" target="_blank" rel="noopener" class="fv-muted" style="color:${C.muted};text-decoration:underline;">Manage notification preferences</a>`
      : def.category === "support"
        ? escapeHtml(content.footer ?? SUPPORT_FOOTER)
        : escapeHtml(SECURITY_FOOTER);

  return `<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<!-- GENERATED by packages/email/scripts/build-templates.ts (${def.key}, ${def.category}); edit the script, not this output. -->
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(def.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
      table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      img { -ms-interpolation-mode: bicubic; }
      a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
      @media only screen and (max-width: 600px) {
        .fv-outer { padding: 24px 12px !important; }
        .fv-card-pad { padding: 28px 20px 24px 20px !important; }
        .fv-h1 { font-size: 26px !important; line-height: 32px !important; }
        .fv-panel-pad { padding: 4px 14px !important; }
        .fv-label { white-space: normal !important; padding-right: 14px !important; }
      }${DARK_CSS}${OUTLOOK_DARK_CSS}
</style>
</head>
<body class="fv-canvas" style="margin:0;padding:0;background-color:${C.canvas};">
${preheader(def.previewText)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fv-canvas" bgcolor="${C.canvas}" style="width:100%;background-color:${C.canvas};">
<tr><td align="center" class="fv-outer" style="padding:40px 16px;">
<!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;margin:0 auto;">
<tr><td style="padding:0 4px 24px 4px;">${logoHtml()}</td></tr>
<tr><td class="fv-card fv-card-pad" bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.hairline};border-radius:16px;padding:40px 40px 28px 40px;">
<p class="fv-muted" style="margin:0 0 10px 0;${font(14, 20, C.muted)}font-weight:500;">${escapeHtml(content.eyebrow)}</p>
<h1 class="fv-ink fv-h1" style="margin:0 0 20px 0;${font(30, 38, C.ink, SERIF)}font-weight:normal;letter-spacing:-0.3px;">${inlineHtml(content.heading)}</h1>
${body}
</td></tr>
<tr><td style="padding:24px 8px 0 8px;">
<p class="fv-muted" style="margin:0 0 12px 0;${font(14, 22, C.muted)}">${footer}</p>
<p class="fv-muted" style="margin:0;${font(14, 22, C.muted)}">${escapeHtml(SIGN_OFF)}</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}

function renderText(def: TemplateDefinition, content: Content): string {
  const parts: string[] = ["Folevi", "", wrap(inlineText(content.heading)), ""];
  for (const block of content.blocks) {
    switch (block.kind) {
      case "p":
      case "panel":
        parts.push(wrap(inlineText(block.text)), "");
        break;
      case "details":
        for (const [label, value] of block.rows) parts.push(`${label}: ${inlineText(value)}`);
        parts.push("");
        break;
      case "button":
        parts.push(`${block.label}:`, placeholder(block.urlVar), "");
        break;
    }
  }
  parts.push("--");
  if (def.category === "product") {
    parts.push(
      wrap(content.reason ?? ""),
      `Manage notification preferences: ${placeholder("preferencesUrl")}`,
    );
  } else if (def.category === "support") {
    parts.push(wrap(content.footer ?? SUPPORT_FOOTER));
  } else {
    parts.push(wrap(SECURITY_FOOTER));
  }
  parts.push(SIGN_OFF, "");
  return parts.join("\n");
}

export function buildTemplates(): Record<TemplateKey, GeneratedTemplate> {
  const out = {} as Record<TemplateKey, GeneratedTemplate>;
  for (const key of TEMPLATE_KEYS) {
    const def = emailManifest[key];
    const content = CONTENT[key];
    out[key] = {
      subject: def.subject,
      previewText: def.previewText,
      html: renderHtml(def, content),
      text: renderText(def, content),
    };
  }
  return out;
}

export const GENERATED_PATH = "src/generated/templates.ts";

/** The generated module's contents, keyed by path relative to packages/email. */
export function renderAll(): Map<string, string> {
  const templates = buildTemplates();
  const entries = TEMPLATE_KEYS.map((key) => {
    const t = templates[key];
    return [
      `  ${key}: {`,
      `    subject: ${JSON.stringify(t.subject)},`,
      `    previewText: ${JSON.stringify(t.previewText)},`,
      `    html: ${JSON.stringify(t.html)},`,
      `    text: ${JSON.stringify(t.text)},`,
      `  },`,
    ].join("\n");
  });
  const module = `// GENERATED by packages/email/scripts/build-templates.ts. Do not edit.
// Regenerate with: pnpm --filter @folevi/email templates
// Placeholders: {{variable}} (filled and escaped by renderEmail), {{@brand}} (logo base URL).

import type { GeneratedTemplate, TemplateKey } from "../types";

export const GENERATED_TEMPLATES: Readonly<Record<TemplateKey, GeneratedTemplate>> = {
${entries.join("\n")}
};
`;
  return new Map([[GENERATED_PATH, module]]);
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
      `Stale generated email templates (run: pnpm --filter @folevi/email templates):\n  ${stale.join("\n  ")}`,
    );
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
