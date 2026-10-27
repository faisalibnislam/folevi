import { describe, expect, test } from "vitest";
import { readDecline, visibleSoFar } from "../src/safety";

describe("the refusal marker", () => {
  test("is read and taken out, the first kind winning; unknown kinds are 'other'", () => {
    expect(readDecline("I can't help with that.\n[[declined:harmful]]")).toEqual({ text: "I can't help with that.", declined: "harmful" });
    expect(readDecline("Please reach out.\n[[declined:crisis]]\n[[declined:other]]")).toEqual({ text: "Please reach out.", declined: "crisis" });
    expect(readDecline("No.\n[[declined:weird]]")).toEqual({ text: "No.", declined: "other" });
    expect(readDecline("A normal answer with [[brackets]].")).toEqual({ text: "A normal answer with [[brackets]].", declined: null });
  });

  test("never shows while it streams in, even half-arrived", () => {
    expect(visibleSoFar("I can't help.\n[")).toBe("I can't help.");
    expect(visibleSoFar("I can't help.\n[[decl")).toBe("I can't help.");
    expect(visibleSoFar("I can't help.\n[[declined:harm")).toBe("I can't help.");
    expect(visibleSoFar("I can't help.\n[[declined:harmful]")).toBe("I can't help.");
    expect(visibleSoFar("I can't help.\n[[declined:harmful]]")).toBe("I can't help.");
    expect(visibleSoFar("A list [[1]] and more")).toBe("A list [[1]] and more");
    expect(visibleSoFar("Plain text")).toBe("Plain text");
  });
});
