import { describe, expect, test } from "vitest";
import { authErrorMessage } from "@/lib/auth/client";

describe("breached passwords", () => {
  test("the server's PASSWORD_COMPROMISED reads as plain advice", () => {
    expect(authErrorMessage({ code: "PASSWORD_COMPROMISED", status: 400, message: "This password has appeared in a data breach. Choose a different one." })).toBe(
      "This password has appeared in a data breach. Choose a different one.",
    );
    // Even if the server's own wording changes, the forms say the same thing.
    expect(authErrorMessage({ code: "PASSWORD_COMPROMISED", message: "compromised" })).toBe("This password has appeared in a data breach. Choose a different one.");
  });
});
