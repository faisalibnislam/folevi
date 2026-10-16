import { describe, expect, it } from "vitest";
import { authPhaseOf } from "@/lib/convex/provider";

// Only a definite answer from the auth server signs anyone out; a failing network never does.
const base = { hasSession: false, isPending: false, error: null as unknown, online: true, slow: false };

describe("authPhaseOf", () => {
  it("is signed in with a session, whatever else is going on", () => {
    expect(authPhaseOf({ ...base, hasSession: true })).toBe("signed_in");
    expect(authPhaseOf({ ...base, hasSession: true, online: false, error: new TypeError("Load failed") })).toBe("signed_in");
  });

  it("signs out only when the server answered with no session, or 401/403", () => {
    expect(authPhaseOf(base)).toBe("signed_out");
    expect(authPhaseOf({ ...base, error: { status: 401 } })).toBe("signed_out");
    expect(authPhaseOf({ ...base, error: { status: 403 } })).toBe("signed_out");
  });

  it("is offline when the device is offline", () => {
    expect(authPhaseOf({ ...base, online: false })).toBe("offline");
    expect(authPhaseOf({ ...base, online: false, isPending: true })).toBe("offline");
  });

  it("is offline when the server can't be reached while the device thinks it's online", () => {
    expect(authPhaseOf({ ...base, error: new TypeError("Load failed") })).toBe("offline");
    expect(authPhaseOf({ ...base, error: { status: 0 } })).toBe("offline");
    for (const status of [408, 429, 500, 502, 503, 504]) expect(authPhaseOf({ ...base, error: { status } })).toBe("offline");
  });

  it("waits for the first check, then stops waiting when it hangs", () => {
    expect(authPhaseOf({ ...base, isPending: true })).toBe("loading");
    expect(authPhaseOf({ ...base, isPending: true, slow: true })).toBe("offline");
  });
});
