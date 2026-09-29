import { GENERATED_TEMPLATES } from "./generated/templates";
import { EMAIL_BRAND_BASE_URL, emailManifest } from "./manifest";
import type { RenderedEmail, TemplateKey, VariableSpec } from "./types";
import { validateDataVariables } from "./validate";

/** Thrown when a template can't be rendered. `errors` name variables and rules only — never values. */
export class EmailRenderError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`email render failed: ${errors.join("; ")}`);
    this.name = "EmailRenderError";
    this.errors = errors;
  }
}

const PLACEHOLDER_RE = /\{\{(@?[A-Za-z][A-Za-z0-9]*)\}\}/g;
const BRAND = "@brand";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The logo base: an https URL (production, or EMAIL_BRAND_BASE_URL on a deployment) or, for local
 * previews only, a relative path. Anything else — other schemes, credentials, quotes — is refused.
 */
export function normaliseBrandBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (/^(\.{1,2}\/|\/(?!\/))[A-Za-z0-9._~@/-]*$/.test(`${trimmed}/`)) return trimmed;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new EmailRenderError(["brandBaseUrl: must be an https URL or a relative path"]);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new EmailRenderError(["brandBaseUrl: must be an https URL or a relative path"]);
  }
  return parsed.href.replace(/\/+$/, "");
}

/** App-relative links ("/settings/…") become absolute against `appUrl`; protocol-relative ones never do. */
function resolveRelativeUrls(
  variables: Record<string, VariableSpec>,
  vars: Record<string, unknown>,
  appUrl: string | undefined,
): Record<string, unknown> {
  if (!appUrl) return vars;
  const out: Record<string, unknown> = { ...vars };
  for (const [name, spec] of Object.entries(variables)) {
    const value = out[name];
    if (spec.format !== "url" || typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.startsWith("/\\")) {
      out[name] = new URL(trimmed, appUrl).href;
    }
  }
  return out;
}

function htmlValue(spec: VariableSpec | undefined, value: string | number): string {
  const escaped = escapeHtml(String(value));
  // Text variables may be multi-line (the digest summary); URLs never contain newlines once validated.
  return spec?.format === "url" ? escaped : escaped.replace(/\r?\n/g, "<br>");
}

/**
 * Renders a template with its variables.
 *
 * - Variables are validated against the manifest first: unknown or missing required ones, wrong types,
 *   over-long values and control characters throw `EmailRenderError`.
 * - URLs must be https (http only for localhost), or app-relative when `appUrl` is given; never
 *   `javascript:` or any other scheme.
 * - Every value is HTML-escaped in the HTML part; the text part gets the plain value.
 */
export function renderEmail(
  key: TemplateKey,
  vars: Record<string, unknown>,
  opts: { brandBaseUrl?: string; appUrl?: string } = {},
): RenderedEmail {
  const def = emailManifest[key];
  const template = GENERATED_TEMPLATES[key];
  if (!def || !template) throw new EmailRenderError([`unknown template "${String(key)}"`]);
  if (vars === null || typeof vars !== "object" || Array.isArray(vars)) {
    throw new EmailRenderError(["dataVariables must be a plain object"]);
  }

  const result = validateDataVariables(key, resolveRelativeUrls(def.variables, vars, opts.appUrl));
  if (!result.ok) throw new EmailRenderError(result.errors);
  const values = result.dataVariables;
  const brand = escapeHtml(normaliseBrandBaseUrl(opts.brandBaseUrl ?? EMAIL_BRAND_BASE_URL));

  const unresolved = new Set<string>();
  const lookup = (name: string): string | number | undefined =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;

  const html = template.html.replace(PLACEHOLDER_RE, (_m, name: string) => {
    if (name === BRAND) return brand;
    const value = lookup(name);
    if (value === undefined) {
      unresolved.add(name);
      return "";
    }
    return htmlValue(def.variables[name], value);
  });
  const fill = (s: string) =>
    s.replace(PLACEHOLDER_RE, (_m, name: string) => {
      const value = name === BRAND ? undefined : lookup(name);
      if (value === undefined) {
        unresolved.add(name);
        return "";
      }
      return String(value);
    });
  const text = fill(template.text);
  const subject = fill(template.subject);
  const previewText = fill(template.previewText);

  // A placeholder the manifest doesn't declare is a build/manifest mismatch: never send a half-filled email.
  if (unresolved.size > 0) {
    throw new EmailRenderError([...unresolved].map((n) => `${n}: placeholder has no declared variable`));
  }
  return { subject, previewText, html, text };
}
