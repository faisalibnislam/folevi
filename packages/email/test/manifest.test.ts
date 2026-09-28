import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TEMPLATE_KEYS,
  emailManifest,
  validateDataVariables,
  type TemplateKey,
} from "../src/index";
import { renderAll } from "../scripts/build-templates.ts";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLACEHOLDER_RE = /\{DATA_VARIABLE:([A-Za-z0-9_]+)\}/g;
const ANY_LOOPS_TOKEN_RE = /\{[A-Z_]+:?[^}]*\}/g;

function read(rel: string): string {
  return readFileSync(join(PKG_ROOT, rel), "utf8");
}
function sources(key: TemplateKey): { mjml: string; txt: string } {
  const path = emailManifest[key].source.path;
  return { mjml: read(path), txt: read(path.replace(/\.mjml$/, ".txt")) };
}
function placeholders(s: string): Set<string> {
  return new Set(Array.from(s.matchAll(PLACEHOLDER_RE), (m) => m[1]!));
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
  it("covers exactly the TemplateKey union", () => {
    expect([...TEMPLATE_KEYS].sort()).toEqual([...ALL_KEYS].sort());
    for (const key of TEMPLATE_KEYS) expect(emailManifest[key].key).toBe(key);
  });

  it("is deeply frozen", () => {
    expect(Object.isFrozen(emailManifest)).toBe(true);
    expect(Object.isFrozen(emailManifest.auth_verify_email.variables)).toBe(true);
  });

  it("env var names are unique and well-formed", () => {
    const names = TEMPLATE_KEYS.map((k) => emailManifest[k].envVar);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^LOOPS_TRANSACTIONAL_[A-Z0-9_]+_ID$/);
    for (const k of TEMPLATE_KEYS) {
      expect(emailManifest[k].envVar).toBe(`LOOPS_TRANSACTIONAL_${k.toUpperCase()}_ID`);
    }
  });

  it.each(ALL_KEYS)("%s has MJML + txt sources", (key) => {
    const def = emailManifest[key];
    expect(def.source.kind).toBe("mjml");
    expect(existsSync(join(PKG_ROOT, def.source.path))).toBe(true);
    expect(existsSync(join(PKG_ROOT, def.source.path.replace(/\.mjml$/, ".txt")))).toBe(true);
  });

  it.each(ALL_KEYS)("%s placeholders are declared, and required variables are used", (key) => {
    const def = emailManifest[key];
    const { mjml, txt } = sources(key);
    for (const file of [mjml, txt]) {
      const used = placeholders(file);
      for (const name of used) expect(Object.keys(def.variables)).toContain(name);
      for (const [name, spec] of Object.entries(def.variables)) {
        if (spec.required) expect(used.has(name), `${key}: ${name} unused`).toBe(true);
      }
      // No other Loops merge syntax (contact properties, {unsubscribe_link}, typos).
      const stray = (file.match(ANY_LOOPS_TOKEN_RE) ?? []).filter(
        (t) => !t.startsWith("{DATA_VARIABLE:"),
      );
      expect(stray).toEqual([]);
    }
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

  it.each(ALL_KEYS)(
    "%s: subject/preview in MJML match the manifest; accessibility basics",
    (key) => {
      const def = emailManifest[key];
      const { mjml } = sources(key);
      expect(mjml).toContain('<mjml lang="en"');
      expect(mjml).toContain(`<mj-title>${def.subject}</mj-title>`);
      expect(mjml).toContain(`<mj-preview>${def.previewText}</mj-preview>`);
      expect(mjml).not.toMatch(/<img\b|<mj-image\b/i); // no tracking pixels / text-in-images
      expect(mjml.toLowerCase()).not.toContain("click here");
      // Every button has a visible fallback URL line.
      for (const m of mjml.matchAll(/<mj-button href="([^"]+)"/g)) {
        expect(mjml).toContain(`Paste this link into your browser:<br /><a href="${m[1]}"`);
      }
      // Body copy is at least 14px.
      for (const m of mjml.matchAll(/font-size[=:]"?(\d+)px/g)) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(14);
      }
    },
  );

  it.each(ALL_KEYS)("%s: category rules (sender, unsubscribe, preferences)", (key) => {
    const def = emailManifest[key];
    const { mjml, txt } = sources(key);
    expect(def.sender.name).toBe("Folevi");
    if (def.category === "product") {
      expect(def.unsubscribable).toBe(true);
      expect(def.preferenceKey).toBeDefined();
      expect(def.sender.localPart).toBe("hello");
      expect(def.variables.preferencesUrl?.required).toBe(true);
      expect(mjml).toContain("Manage notification preferences");
      expect(txt).toContain("Manage notification preferences");
    } else {
      expect(def.unsubscribable).toBe(false);
      expect(def.preferenceKey).toBeUndefined();
      expect(def.sender.localPart).toBe("security");
      for (const file of [mjml, txt]) {
        expect(file.toLowerCase()).not.toContain("unsubscribe");
        expect(file).not.toContain("preferencesUrl");
      }
    }
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

  it("generated template files are up to date", () => {
    for (const [rel, contents] of renderAll()) expect(read(rel), rel).toBe(contents);
  });

});
