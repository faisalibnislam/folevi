import { afterEach, describe, expect, test } from "vitest";
import { en } from "@/i18n/messages/en";
import { formatCalendarDate, formatDate, formatMessage, formatNumber, localeFromAcceptLanguage, setLocale, t, tFor } from "@/i18n";
import { parseMessage } from "@/i18n/icu";

afterEach(() => setLocale(undefined));

describe("ICU-style messages", () => {
  test("plural categories come from Intl.PluralRules", () => {
    const m = "{n, plural, =0 {none} one {# item} few {# items (few)} many {# items (many)} other {# items}}";
    expect(formatMessage(m, { n: 0 })).toBe("none");
    expect(formatMessage(m, { n: 1 })).toBe("1 item");
    expect(formatMessage(m, { n: 2 })).toBe("2 items");
    expect(formatMessage(m, { n: 1234 })).toBe("1,234 items");
    // Polish uses "few" for 2–4 and "many" for 5+.
    expect(formatMessage(m, { n: 3 }, "pl")).toBe("3 items (few)");
    expect(formatMessage(m, { n: 5 }, "pl")).toBe("5 items (many)");
  });

  test("select, nested arguments, numbers and quoting", () => {
    const m = "{role, select, editor {{name} can edit} other {{name} can view}} '{'literal'}' it''s {size, number}";
    expect(formatMessage(m, { role: "editor", name: "Maya", size: 1500 })).toBe("Maya can edit {literal} it's 1,500");
    expect(formatMessage(m, { role: "guest", name: "Jo", size: 2 })).toBe("Jo can view {literal} it's 2");
  });

  test("malformed patterns throw instead of rendering garbage", () => {
    expect(() => parseMessage("{n, plural, one {x}}")).toThrow(/other/);
    expect(() => parseMessage("{n, date}")).toThrow(/unsupported/);
    expect(() => parseMessage("oops }")).toThrow();
  });

  test("every catalog message parses", () => {
    for (const [key, pattern] of Object.entries(en)) expect(() => parseMessage(pattern), key).not.toThrow();
  });
});

describe("catalog", () => {
  test("t formats English plurals", () => {
    expect(t("sync.pending.changes", { count: 1 })).toBe("1 change");
    expect(t("sync.pending.changes", { count: 3 })).toBe("3 changes");
    expect(t("sync.button.label", { status: "Offline", pending: 0 })).toBe("Sync status: Offline");
    expect(t("sync.button.label", { status: "Offline", pending: 2 })).toBe("Sync status: Offline, 2 changes waiting");
    expect(t("notifications.button.label", { count: 0 })).toBe("Notifications");
    expect(t("notifications.button.label", { count: 4 })).toBe("Notifications, 4 unread");
    expect(t("admin.workspace.members", { count: 1 })).toBe("1 person");
  });

  test("an unknown language falls back to English with English plural rules", () => {
    setLocale("pl-PL");
    expect(t("sync.pending.changes", { count: 3 })).toBe("3 changes");
    expect(tFor("fr", "admin.workspace.members", { count: 0 })).toBe("0 people");
  });

  test("dates and numbers follow the formatting locale", () => {
    const ts = Date.UTC(2026, 8, 25, 12);
    expect(formatDate(ts, { dateStyle: "medium", timeZone: "UTC" }, "en-US")).toBe("Sep 25, 2026");
    expect(formatDate(ts, { dateStyle: "medium", timeZone: "UTC" }, "de-DE")).toBe("25.09.2026");
    expect(formatCalendarDate("2026-01-02", { month: "short", day: "numeric" }, "en-GB")).toBe("2 Jan");
    setLocale("de-DE");
    expect(formatNumber(1234.5)).toBe("1.234,5");
  });

  test("Accept-Language picks the highest-ranked valid tag", () => {
    expect(localeFromAcceptLanguage("fr-CH, fr;q=0.9, en;q=0.8, *;q=0.5")).toBe("fr-CH");
    expect(localeFromAcceptLanguage("en;q=0.2, de;q=0.9")).toBe("de");
    expect(localeFromAcceptLanguage("*")).toBeUndefined();
    expect(localeFromAcceptLanguage(undefined)).toBeUndefined();
  });
});
