import { describe, expect, test } from "vitest";
import { safeReturnTo } from "@/lib/auth/returnTo";

describe("safeReturnTo", () => {
  test("keeps same-site paths", () => {
    expect(safeReturnTo("/d/abc?x=1#block-2")).toBe("/d/abc?x=1#block-2");
  });
  test("refuses other hosts, however they're spelled", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "https://evil.com", "evil.com"]) {
      expect(safeReturnTo(bad)).toBe("/documents");
    }
  });
  test("never sends people back to an auth page", () => {
    expect(safeReturnTo("/signin?x")).toBe("/documents");
  });
});
