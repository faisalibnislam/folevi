import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { openGrant, sealGrant, GRANT_TTL_MS } = await import("@/app/s/[token]/grant");

const SECRET = "s".repeat(64);
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWx123";

describe("share unlock grant", () => {
  test("round-trips for the same link, never contains the password in the clear", () => {
    const sealed = sealGrant(TOKEN, "correct horse battery", SECRET, 1_000);
    expect(sealed).not.toContain("correct");
    expect(Buffer.from(sealed, "base64url").toString("utf8")).not.toContain("correct horse");
    expect(openGrant(sealed, TOKEN, SECRET, 2_000)).toBe("correct horse battery");
  });

  test("is bound to the link, the secret and its expiry", () => {
    const sealed = sealGrant(TOKEN, "pw-123456", SECRET, 0);
    expect(openGrant(sealed, `${TOKEN}x`, SECRET, 1)).toBeNull();
    expect(openGrant(sealed, TOKEN, "t".repeat(64), 1)).toBeNull();
    expect(openGrant(sealed, TOKEN, SECRET, GRANT_TTL_MS + 1)).toBeNull();
  });

  test("rejects tampered or junk values", () => {
    const sealed = sealGrant(TOKEN, "pw-123456", SECRET, 0);
    const bytes = Buffer.from(sealed, "base64url");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    expect(openGrant(bytes.toString("base64url"), TOKEN, SECRET, 1)).toBeNull();
    expect(openGrant("correct horse", TOKEN, SECRET, 1)).toBeNull();
    expect(openGrant(undefined, TOKEN, SECRET, 1)).toBeNull();
    expect(openGrant("x".repeat(5000), TOKEN, SECRET, 1)).toBeNull();
  });
});
