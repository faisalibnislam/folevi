import { describe, expect, it } from "vitest";
import { checkServerAddress } from "@/lib/server-edition/address";
import { readServerCode } from "@/lib/server-edition/scan";

describe("a scanned server QR code", () => {
  it("reads a server's address", () => {
    expect(readServerCode("https://notes.example.com")).toEqual({
      address: "https://notes.example.com",
      invite: null,
    });
    expect(readServerCode("  http://192.168.1.20:8460/  ")).toEqual({
      address: "http://192.168.1.20:8460",
      invite: null,
    });
    expect(readServerCode("https://abc1234567.folevi.app/signin?next=/")).toEqual({
      address: "https://abc1234567.folevi.app",
      invite: null,
    });
  });

  it("reads an invite link's server and token", () => {
    const token = "inv_0123456789abcdef"; // gitleaks:allow (a made-up invite token)
    expect(readServerCode(`https://notes.example.com/join/${token}`)).toEqual({
      address: "https://notes.example.com",
      invite: token,
    });
  });

  it("takes a bare address as typed", () => {
    expect(readServerCode("notes.example.com")).toEqual({
      address: "notes.example.com",
      invite: null,
    });
    expect(readServerCode("192.168.1.20:8460")).toEqual({
      address: "192.168.1.20:8460",
      invite: null,
    });
  });

  it("refuses what isn't a server address", () => {
    expect(readServerCode("")).toBeNull();
    expect(readServerCode("hello world")).toBeNull();
    expect(readServerCode("mailto:someone@example.com")).toBeNull();
    expect(readServerCode("ftp://notes.example.com")).toBeNull();
    expect(readServerCode("https://user:pw@notes.example.com")).toBeNull();
    expect(readServerCode("notes.example.com/path")).toBeNull();
    expect(readServerCode("x".repeat(3000))).toBeNull();
  });

  it("still goes through the address rules", () => {
    const plainHttp = readServerCode("http://notes.example.com");
    expect(plainHttp).not.toBeNull();
    expect(checkServerAddress(plainHttp!.address).ok).toBe(false);
    expect(checkServerAddress(readServerCode("http://localhost:8460")!.address).ok).toBe(true);
  });
});
