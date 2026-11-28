import { describe, expect, it } from "vitest";
import { searchSettings } from "@/lib/app/settingsSearch";

const labels: Record<string, string> = { account: "Account", appearance: "Appearance", security: "Security", billing: "Plan & billing", data: "Import & export", ai: "Foli AI" };
const label = (id: string) => labels[id];
const first = (q: string) => searchSettings(q, label)[0]?.title;

describe("settings search", () => {
  it("answers everyday questions", () => {
    expect(first("how do I turn on dark mode")).toBe("Theme");
    expect(first("change my password")).toBe("Password");
    expect(first("cancel subscription")).toBe("Your plan");
    expect(first("export")).toBe("Import & export");
    expect(first("2fa")).toBe("Two-step verification");
  });
  it("leaves out sections this person doesn't have", () => {
    expect(searchSettings("members", label)).toEqual([]);
  });
  it("finds nothing for an empty query", () => {
    expect(searchSettings("  ", label)).toEqual([]);
  });
});

describe("settings search, forgiving", () => {
  it("finds a setting when most of the words match", () => {
    expect(searchSettings("stop emails about comments", (id) => ({ notifications: "Notifications" })[id])[0]?.title).toBe("Email delivery");
  });
});
