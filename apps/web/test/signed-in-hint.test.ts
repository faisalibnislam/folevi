import { describe, expect, it } from "vitest";
import { SIGNED_IN_HINT, hintCookie, hintDomain, sessionChange } from "@/lib/auth/signedInHint";

describe("signed-in hint", () => {
  it("is shared with the marketing host only when the app lives under it", () => {
    expect(hintDomain("app.folevi.com", "folevi.com")).toBe("folevi.com");
    expect(hintDomain("folevi.com", "folevi.com")).toBe("folevi.com");
    expect(hintDomain("app.localhost:3002", "localhost:3002")).toBeNull();
    expect(hintDomain("app.example.org", "folevi.com")).toBeNull();
  });

  it("carries no secret and can be cleared", () => {
    expect(hintCookie(true, "folevi.com", true)).toBe(`${SIGNED_IN_HINT}=1; Path=/; Max-Age=31536000; SameSite=Lax; Domain=folevi.com; Secure`);
    expect(hintCookie(false, null, false)).toBe(`${SIGNED_IN_HINT}=; Path=/; Max-Age=0; SameSite=Lax`);
  });

  it("follows what Better Auth did to the session cookie", () => {
    expect(sessionChange(["__Secure-folevi.session_token=abc.def; Path=/; HttpOnly; Secure; Max-Age=604800"])).toBe("set");
    expect(sessionChange(["folevi.session_token=; Path=/; Max-Age=0"])).toBe("cleared");
    expect(sessionChange(["folevi.session_token=x; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"])).toBe("cleared");
    expect(sessionChange(["folevi.session_data=abc; Path=/"])).toBeNull();
    expect(sessionChange([])).toBeNull();
  });
});
