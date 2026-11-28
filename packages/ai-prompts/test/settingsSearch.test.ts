import { describe, expect, test } from "vitest";
import { parseSettingsSearch, settingsSearchRequest } from "../src/settingsSearch";

const options = [
  { key: "appearance/Theme", title: "Theme", section: "Appearance" },
  { key: "notifications/Email delivery", title: "Email delivery", section: "Notifications" },
];

describe("settings search with Foli AI", () => {
  test("the request lists every setting and asks for JSON from the fast model", () => {
    const r = settingsSearchRequest({ query: "make it <dark>", options });
    expect(r.prompt).toContain("appearance/Theme | Appearance > Theme");
    expect(r.prompt).toContain("make it  dark ");
    expect(r.fast).toBe(true);
    expect(r.json).toBe(true);
  });
  test("only ids from the list come back, at most three, and the sentence", () => {
    const known = new Set(options.map((o) => o.key));
    expect(parseSettingsSearch('{"keys":["appearance/Theme","made/up","appearance/Theme"],"answer":"Go to **Appearance** > Theme."}', known)).toEqual({ keys: ["appearance/Theme"], answer: "Go to Appearance > Theme." });
    expect(parseSettingsSearch("not json", known)).toEqual({ keys: [], answer: "" });
    expect(parseSettingsSearch('```json\n{"keys":[],"answer":"Nothing fits."}\n```', known)).toEqual({ keys: [], answer: "Nothing fits." });
  });
});
