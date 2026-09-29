import { emailManifest } from "./manifest";
import type { TemplateKey, ValidationResult, VariableSpec } from "./types";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// C0 controls except tab/newline, plus DEL and C1 controls.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const EMAIL_RE =
  /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const CODE_RE = /^[A-Za-z0-9-]{4,12}$/;

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}

/** https everywhere; http only for localhost / *.localhost (e.g. app.localhost:3000 in dev). */
export function isAllowedUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === "https:") return parsed.hostname.length > 0;
  if (parsed.protocol === "http:") return isLocalHost(parsed.hostname);
  return false;
}

export function isPlausibleEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

function codePointLength(value: string): number {
  let n = 0;
  for (const _ of value) n++;
  return n;
}

function checkString(name: string, spec: VariableSpec, raw: string, errors: string[]): string {
  const value = raw.trim();
  if (spec.required && value.length === 0) {
    errors.push(`${name}: required variable is empty`);
    return value;
  }
  if (spec.maxLength !== undefined && codePointLength(value) > spec.maxLength) {
    errors.push(`${name}: exceeds maxLength ${spec.maxLength}`);
  }
  if (CONTROL_CHARS.test(value)) {
    errors.push(`${name}: contains control characters`);
  }
  if (value.length === 0) return value;
  switch (spec.format) {
    case "url":
      if (!isAllowedUrl(value)) {
        errors.push(`${name}: must be an https URL (http only for localhost)`);
        break;
      }
      // Send the WHATWG-serialised form: quotes, spaces and angle brackets are percent-encoded,
      // so a URL can never break out of an href attribute.
      return new URL(value).href;
    case "email":
      if (!isPlausibleEmail(value)) errors.push(`${name}: must be an email address`);
      break;
    case "code":
      if (!CODE_RE.test(value)) errors.push(`${name}: must be 4-12 letters, digits or dashes`);
      break;
    default:
      // renderEmail HTML-escapes every value; as defence in depth markup is also neutralised at the
      // source: "<"/">" become single guillemets, which read naturally and cannot open a tag.
      return value.replace(/</g, "\u2039").replace(/>/g, "\u203A");
  }
  return value;
}

/**
 * Validates and normalises the data variables for a template.
 * - Names are case-sensitive; unknown names are rejected.
 * - Only strings and finite numbers are accepted (no booleans or null).
 * - Strings are trimmed; missing optional variables are sent as "" so that templates
 *   never render a raw placeholder.
 */
export function validateDataVariables(
  key: TemplateKey,
  vars: Record<string, unknown>,
): ValidationResult {
  const def = emailManifest[key];
  if (!def) return { ok: false, errors: [`unknown template "${String(key)}"`] };
  if (vars === null || typeof vars !== "object" || Array.isArray(vars)) {
    return { ok: false, errors: ["dataVariables must be a plain object"] };
  }

  const errors: string[] = [];
  const out: Record<string, string | number> = {};
  const declared = Object.keys(def.variables);

  for (const name of Object.keys(vars)) {
    if (!Object.prototype.hasOwnProperty.call(def.variables, name)) {
      const near = declared.find((d) => d.toLowerCase() === name.toLowerCase());
      errors.push(
        near
          ? `${name}: unknown variable (names are case-sensitive; did you mean "${near}"?)`
          : `${name}: unknown variable`,
      );
    }
  }

  for (const [name, spec] of Object.entries(def.variables)) {
    const has = Object.prototype.hasOwnProperty.call(vars, name);
    const raw = has ? vars[name] : undefined;

    if (raw === undefined) {
      if (spec.required) errors.push(`${name}: missing required variable`);
      else out[name] = "";
      continue;
    }
    if (raw === null) {
      errors.push(`${name}: null is not allowed`);
      continue;
    }
    if (typeof raw === "boolean") {
      errors.push(`${name}: booleans are not allowed`);
      continue;
    }

    if (spec.type === "number") {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        errors.push(`${name}: must be a finite number`);
        continue;
      }
      out[name] = raw;
      continue;
    }

    if (typeof raw !== "string") {
      errors.push(`${name}: must be a string`);
      continue;
    }
    out[name] = checkString(name, spec, raw, errors);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, dataVariables: out };
}
