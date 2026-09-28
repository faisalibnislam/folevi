// Folevi web localization.
//
// - `t(key, values)` looks a message up in the catalog for the active *language* and formats it with
//   ICU-style plurals/selects (./icu.ts). Plural rules follow the catalog's language, so an English
//   sentence always gets English plural forms even when dates use another locale.
// - `formatDate`, `formatDateTime`, `formatNumber`, `formatList` use Intl with the active *formatting
//   locale* (the person's locale when known, otherwise the runtime default). Never hard-code "en-US".
//
// Only English ships today; adding a language means adding messages/<lang>.ts with the same keys and
// registering it in CATALOGS. Missing keys fall back to English. See docs/LOCALIZATION.md.
import { formatMessage, type MessageValues } from "./icu";
import { en, type MessageKey, type Messages } from "./messages/en";

export type { MessageKey, MessageValues };
export { formatMessage };

const CATALOGS: Record<string, Partial<Messages>> = { en };
const FALLBACK_LANGUAGE = "en";

let formattingLocale: string | undefined;
let language = FALLBACK_LANGUAGE;

/** Canonicalizes a BCP 47 tag; returns undefined for anything Intl doesn't accept. */
export function canonicalLocale(tag: string | null | undefined): string | undefined {
  if (!tag) return undefined;
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

/** Picks the catalog language for a locale ("pt-BR" → "pt-BR" or "pt" if shipped, else English). */
export function languageFor(locale: string | undefined): string {
  if (!locale) return FALLBACK_LANGUAGE;
  if (CATALOGS[locale]) return locale;
  const base = locale.split("-")[0]!;
  return CATALOGS[base] ? base : FALLBACK_LANGUAGE;
}

/** Sets the person's locale (e.g. from their profile). Invalid tags are ignored. */
export function setLocale(tag: string | null | undefined): void {
  const locale = canonicalLocale(tag);
  formattingLocale = locale;
  language = languageFor(locale);
}

/** The formatting locale in effect (undefined = runtime default). */
export function getLocale(): string | undefined {
  return formattingLocale;
}

/** Formats a catalog message. */
export function t(key: MessageKey, values?: MessageValues): string {
  const pattern = CATALOGS[language]?.[key] ?? en[key];
  return formatMessage(pattern, values, language);
}

/** Formats a catalog message for an explicit locale (server components, emails). */
export function tFor(locale: string | undefined, key: MessageKey, values?: MessageValues): string {
  const lang = languageFor(canonicalLocale(locale));
  const pattern = CATALOGS[lang]?.[key] ?? en[key];
  return formatMessage(pattern, values, lang);
}

const toDate = (value: Date | number | string) => (value instanceof Date ? value : new Date(value));

export function formatDate(value: Date | number | string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }, locale = formattingLocale): string {
  return new Intl.DateTimeFormat(locale, options).format(toDate(value));
}

export function formatDateTime(value: Date | number | string, locale = formattingLocale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(toDate(value));
}

/** A calendar date ("2026-09-25") shown without time-zone drift. */
export function formatCalendarDate(isoDate: string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }, locale = formattingLocale): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions, locale = formattingLocale): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatList(items: string[], type: Intl.ListFormatType = "conjunction", locale = formattingLocale): string {
  return new Intl.ListFormat(locale, { style: "long", type }).format(items);
}

/**
 * Best locale from an Accept-Language header (server components). Returns undefined when nothing
 * usable is offered, so callers fall back to the runtime default.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag!.trim(), q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((x) => x.tag && x.tag !== "*" && Number.isFinite(x.q) && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const locale = canonicalLocale(tag);
    if (locale) return locale;
  }
  return undefined;
}
