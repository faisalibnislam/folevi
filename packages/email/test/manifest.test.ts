import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EMAIL_BRAND_BASE_URL,
  EMAIL_LOGO,
  TEMPLATE_KEYS,
  emailManifest,
  renderEmail,
  validateDataVariables,
  type TemplateKey,
} from "../src/index";
import { GENERATED_TEMPLATES } from "../src/generated/templates";
import { renderAll } from "../scripts/build-templates.ts";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLACEHOLDER_RE = /\{\{(@?[A-Za-z0-9_]+)\}\}/g;

function read(rel: string): string {
  return readFileSync(join(PKG_ROOT, rel), "utf8");
}
function placeholders(s: string): Set<string> {
  return new Set(Array.from(s.matchAll(PLACEHOLDER_RE), (m) => m[1]!).filter((n) => !n.startsWith("@")));
}

const ALL_KEYS: TemplateKey[] = [
  "auth_verify_email",
  "auth_password_reset",
  "security_new_device",
  "account_deletion_scheduled",
  "account_deletion_completed",
  "workspace_invite",
  "mention_notification",
  "comment_notification",
  "comment_digest",
  "share_notification",
  "access_changed",
];

describe("manifest contract", () => {
  it("covers exactly the TemplateKey union, with a generated template each", () => {
    expect([...TEMPLATE_KEYS].sort()).toEqual([...ALL_KEYS].sort());
    for (const key of TEMPLATE_KEYS) expect(emailManifest[key].key).toBe(key);
    expect(Object.keys(GENERATED_TEMPLATES).sort()).toEqual([...ALL_KEYS].sort());
  });

  it("is deeply frozen", () => {
    expect(Object.isFrozen(emailManifest)).toBe(true);
    expect(Object.isFrozen(emailManifest.auth_verify_email.variables)).toBe(true);
  });

  it("no longer needs a per-template provider id", () => {
    for (const key of TEMPLATE_KEYS) expect(emailManifest[key]).not.toHaveProperty("envVar");
  });

  it.each(ALL_KEYS)("%s placeholders are declared, and required variables are used (HTML and text)", (key) => {
    const def = emailManifest[key];
    const { html, text } = GENERATED_TEMPLATES[key];
    for (const file of [html, text]) {
      const used = placeholders(file);
      for (const name of used) expect(Object.keys(def.variables)).toContain(name);
      for (const [name, spec] of Object.entries(def.variables)) {
        if (spec.required) expect(used.has(name), `${key}: ${name} unused`).toBe(true);
      }
      // No provider merge syntax left over (Loops' {DATA_VARIABLE:x}, Mailtrap/Handlebars helpers).
      expect(file).not.toMatch(/\{[A-Z_]+:[^}]*\}|\{\{[#/^>!]/);
    }
    // The only reserved placeholder is the logo base, and only in HTML.
    expect(Array.from(html.matchAll(/\{\{@(\w+)\}\}/g), (m) => m[1])).toEqual(["brand", "brand"]);
    expect(text).not.toContain("{{@");
  });

  it.each(ALL_KEYS)("%s fixture validates and uses only @example.com addresses", (key) => {
    const def = emailManifest[key];
    const result = validateDataVariables(key, def.fixture);
    expect(result).toMatchObject({ ok: true });
    const json = JSON.stringify(def.fixture);
    for (const m of json.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+)/g)) {
      expect(m[1]).toBe("example.com");
    }
  });

  it.each(ALL_KEYS)("%s: subject/preview match the manifest; accessibility and layout basics", (key) => {
    const def = emailManifest[key];
    const { html, subject, previewText } = GENERATED_TEMPLATES[key];
    expect(subject).toBe(def.subject);
    expect(previewText).toBe(def.previewText);
    expect(html).toMatch(/^<!DOCTYPE html>\n<html lang="en" dir="ltr"/);
    expect(html).toContain(`<title>${def.subject.replace(/'/g, "&#39;")}</title>`);
    expect(html).toContain(def.previewText.replace(/'/g, "&#39;"));
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html.toLowerCase()).not.toContain("click here");
    // Layout tables are presentational; no scripts, forms, iframes or external styles/fonts.
    for (const m of html.matchAll(/<table\b[^>]*>/g)) expect(m[0]).toContain('role="presentation"');
    expect(html).not.toMatch(/<script\b|<form\b|<iframe\b|<link\b|@import|url\(/i);
    // Every button has a visible fallback URL line with the same link.
    const buttons = Array.from(html.matchAll(/<a href="([^"]+)"[^>]*class="fv-btn-a"/g), (m) => m[1]);
    for (const href of buttons) {
      expect(html).toContain(`Paste this link into your browser:<br><a href="${href}"`);
      expect(html).toContain(`>${href}</a>`);
    }
    expect(buttons.length).toBeLessThanOrEqual(1);
    // Copy is at least 14px.
    for (const m of html.matchAll(/font-size:\s*(\d+)px/g)) {
      if (m[1] === "1") continue; // the hidden preheader
      expect(Number(m[1])).toBeGreaterThanOrEqual(14);
    }
  });

  it.each(ALL_KEYS)("%s: images only from the brand path (the logo), never tracking pixels or text-in-images", (key) => {
    const { html } = GENERATED_TEMPLATES[key];
    const imgs = Array.from(html.matchAll(/<img\b[^>]*>/gi), (m) => m[0]);
    expect(imgs).toHaveLength(2); // light + dark logo
    for (const img of imgs) {
      expect(img).toMatch(new RegExp(`src="\\{\\{@brand\\}\\}/(${EMAIL_LOGO.light}|${EMAIL_LOGO.dark})"`.replace(/\./g, "\\.")));
      expect(img).toContain('alt="Folevi"');
      expect(img).toContain(`width="${EMAIL_LOGO.width}"`);
      expect(img).toContain(`height="${EMAIL_LOGO.height}"`);
      expect(img).toContain('border="0"');
      expect(img).toContain("display:block");
    }
    // No background images or other remote resources.
    expect(html).not.toMatch(/background=|background-image|<video|<audio|<object|<embed|<picture|srcset/i);
    // Rendered: the logo resolves to the brand base, and nothing else is an image.
    const rendered = renderEmail(key, emailManifest[key].fixture).html;
    const srcs = Array.from(rendered.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/gi), (m) => m[1]!);
    for (const src of srcs) expect(src.startsWith(`${EMAIL_BRAND_BASE_URL}/`)).toBe(true);
  });

  it.each(ALL_KEYS)("%s: category rules (sender, unsubscribe, preferences)", (key) => {
    const def = emailManifest[key];
    const { html, text } = GENERATED_TEMPLATES[key];
    expect(def.sender.name).toBe("Folevi");
    expect(text).toContain("Folevi · A quieter place for ideas that keep growing.");
    expect(html).toContain("Folevi · A quieter place for ideas that keep growing.");
    if (def.category === "product") {
      expect(def.unsubscribable).toBe(true);
      expect(def.preferenceKey).toBeDefined();
      expect(def.sender.localPart).toBe("hello");
      expect(def.variables.preferencesUrl?.required).toBe(true);
      expect(html).toContain("Manage notification preferences");
      expect(text).toContain("Manage notification preferences: {{preferencesUrl}}");
    } else {
      expect(def.unsubscribable).toBe(false);
      expect(def.preferenceKey).toBeUndefined();
      expect(def.sender.localPart).toBe("security");
      for (const file of [html, text]) {
        expect(file.toLowerCase()).not.toContain("unsubscribe");
        expect(file).not.toContain("preferencesUrl");
        expect(file).toContain("required email about the security of your Folevi account");
      }
    }
  });

  it.each(ALL_KEYS)("%s: text version is present and readable", (key) => {
    const { text } = GENERATED_TEMPLATES[key];
    expect(text.startsWith("Folevi\n\n")).toBe(true);
    expect(text).not.toMatch(/<[a-z/][^>]*>/i);
    for (const line of text.split("\n")) {
      if (!line.includes("{{")) expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it("copy uses the account model's words (pages, Personal, workspace roles)", () => {
    const share = GENERATED_TEMPLATES.share_notification.text.replace(/\s+/g, " ");
    expect(share).toContain("No Folevi account yet?");
    expect(share).toContain("someone shared a page in Folevi with this email address");
    expect(share).not.toContain("turned on for your Folevi account");
    const invite = GENERATED_TEMPLATES.workspace_invite.text.replace(/\s+/g, " ");
    expect(invite).toContain("as {{role}}");
    expect(invite).toContain("Personal");
    for (const key of ALL_KEYS) expect(GENERATED_TEMPLATES[key].text.toLowerCase()).not.toContain("loops");
  });

  it("uses only uppercase-free camelCase variable names", () => {
    for (const key of TEMPLATE_KEYS) {
      for (const name of Object.keys(emailManifest[key].variables)) {
        expect(name).toMatch(/^[a-z][A-Za-z0-9]*$/);
      }
    }
  });

  it("never declares secret-bearing variables", () => {
    const banned = /password|secret|token|totp|backup|recovery|body|content/i;
    for (const key of TEMPLATE_KEYS) {
      for (const name of Object.keys(emailManifest[key].variables))
        expect(name).not.toMatch(banned);
    }
  });

  it("the generated module is up to date", () => {
    for (const [rel, contents] of renderAll()) expect(read(rel), `${rel} is stale: pnpm --filter @folevi/email templates`).toBe(contents);
  });
});
