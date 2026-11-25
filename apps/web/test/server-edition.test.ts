import { afterEach, describe, expect, test, vi } from "vitest";
import { checkServerAddress, isPrivateHost, connectOrigin } from "@/lib/server-edition/address";
import { compareVersions, parseServerInfo, serverUrlsFor } from "@/lib/server-edition/info";
import { cloudRuntimeConfig, runtimeConfig, serializeRuntimeConfig, serverRuntimeConfig, setBrowserRuntimeConfig } from "@/lib/runtime/config";
import { buildContentSecurityPolicy } from "@/lib/security/csp";
import { isServerEdition } from "@/lib/edition";

afterEach(() => {
  vi.unstubAllEnvs();
  setBrowserRuntimeConfig(null);
});

describe("edition", () => {
  test("Folevi Cloud unless the build says server", () => {
    expect(isServerEdition()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_FOLEVI_EDITION", "server");
    expect(isServerEdition()).toBe(true);
  });
});

describe("runtime addresses", () => {
  test("the cloud reads the build-time values, as before", () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://happy-otter-123.convex.cloud");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.folevi.com");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://folevi.com");
    const c = runtimeConfig();
    expect(c).toEqual(cloudRuntimeConfig());
    expect(c.convexUrl).toBe("https://happy-otter-123.convex.cloud");
    expect(c.shareOrigin).toBe("https://folevi.com");
  });

  test("a server derives every address from its one public origin", () => {
    const c = serverRuntimeConfig("https://notes.example.com/");
    expect(c.appUrl).toBe("https://notes.example.com");
    expect(c.convexUrl).toBe("https://notes.example.com/convex");
    expect(c.convexSiteUrl).toBe("https://notes.example.com/convex-site");
    expect(c.shareOrigin).toBe("https://notes.example.com");
    expect(serverRuntimeConfig("not a url").appUrl).toBe("http://127.0.0.1:8460");
    expect(serverUrlsFor("http://192.168.1.20:8460")).toEqual({ app: "http://192.168.1.20:8460", convex: "http://192.168.1.20:8460/convex", convexSite: "http://192.168.1.20:8460/convex-site" });
  });

  test("the browser reads what the root layout handed over", () => {
    vi.stubEnv("NEXT_PUBLIC_FOLEVI_EDITION", "server");
    const handed = serverRuntimeConfig("https://abcdefghij.folevi.app", { features: { ai: false, email: false, push: true, publicLinks: true }, serverName: "Smith family" });
    const el = document.createElement("script");
    el.id = "folevi-runtime";
    el.type = "application/json";
    el.textContent = serializeRuntimeConfig(handed);
    document.body.append(el);
    expect(runtimeConfig()).toEqual(handed);
    el.remove();
  });

  test("the handed-over JSON can't close its script tag", () => {
    const text = serializeRuntimeConfig({ ...serverRuntimeConfig("https://x.example"), serverName: "</script><script>alert(1)</script>" });
    expect(text).not.toContain("</script");
    expect(JSON.parse(text).serverName).toBe("</script><script>alert(1)</script>");
  });
});

describe("content security policy on a server", () => {
  const env = { convexUrl: "http://192.168.1.20:8460/convex", convexSiteUrl: "http://192.168.1.20:8460/convex-site", appUrl: "http://192.168.1.20:8460" };
  test("no upgrade-insecure-requests over plain http", () => {
    expect(buildContentSecurityPolicy({ ...env, dev: false, upgradeInsecure: false })).not.toContain("upgrade-insecure-requests");
    expect(buildContentSecurityPolicy({ ...env, dev: false })).toContain("upgrade-insecure-requests");
  });
  test("the sign-in page may look up other servers", () => {
    const connect = (o: Parameters<typeof buildContentSecurityPolicy>[0]) => buildContentSecurityPolicy(o).split("; ").find((d) => d.startsWith("connect-src"))!;
    expect(connect({ ...env, dev: false })).not.toContain(" https:");
    expect(connect({ ...env, dev: false, connectToServers: true })).toContain(" https:");
    expect(connect({ ...env, dev: false, connectToServers: true }).split(" ")).not.toContain("http:");
    expect(connect({ ...env, dev: false, connectToServers: true, upgradeInsecure: false }).split(" ")).toContain("http:");
  });
});

describe("Your own server: the address", () => {
  test("home-network addresses get http, everything else https", () => {
    expect(checkServerAddress("192.168.1.20:8460")).toEqual({ ok: true, origin: "http://192.168.1.20:8460" });
    expect(checkServerAddress("nas.local:8460")).toEqual({ ok: true, origin: "http://nas.local:8460" });
    expect(checkServerAddress("notes.example.com")).toEqual({ ok: true, origin: "https://notes.example.com" });
    expect(checkServerAddress("https://abcdefghij.folevi.app/signin")).toEqual({ ok: true, origin: "https://abcdefghij.folevi.app" });
  });
  test("plain http is refused outside localhost and private ranges", () => {
    expect(checkServerAddress("http://notes.example.com").ok).toBe(false);
    expect(checkServerAddress("http://8.8.8.8").ok).toBe(false);
    expect(checkServerAddress("http://localhost:8460").ok).toBe(true);
    expect(checkServerAddress("http://10.0.0.5").ok).toBe(true);
    expect(checkServerAddress("http://172.20.1.1").ok).toBe(true);
    expect(checkServerAddress("http://172.32.1.1").ok).toBe(false);
    expect(checkServerAddress("http://[fd12::1]:8460").ok).toBe(true);
    expect(checkServerAddress("ftp://nas.local").ok).toBe(false);
    expect(checkServerAddress("https://user:pw@notes.example.com").ok).toBe(false);
    expect(checkServerAddress("").ok).toBe(false);
  });
  test("private hosts", () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("100.101.102.103")).toBe(true);
    expect(isPrivateHost("example.com")).toBe(false);
    expect(isPrivateHost("::1")).toBe(true);
    expect(isPrivateHost("2001:db8::1")).toBe(false);
  });
  test("a linked server's Connect name", () => {
    expect(connectOrigin("abcdefghij.folevi.app")).toBe("https://abcdefghij.folevi.app");
  });
});

describe("the well-known document", () => {
  const doc = {
    kind: "folevi-server",
    apiVersion: 1,
    name: "Smith family",
    version: "1.6.10",
    minAppVersion: "1.6.0",
    urls: { app: "https://x", convex: "https://x/convex", convexSite: "https://x/convex-site" },
    signIn: { password: true, passkey: true, folevi: false, google: false, apple: false, signUp: "invite" },
    features: { ai: false, email: false, push: false, publicLinks: true },
    connect: { serverId: null, hostnames: [] },
    needsSetup: false,
  };
  test("reads a server's answer", () => {
    expect(parseServerInfo(doc)).toEqual(doc);
  });
  test("refuses anything else", () => {
    expect(parseServerInfo(null)).toBeNull();
    expect(parseServerInfo({ ...doc, kind: "plex" })).toBeNull();
    expect(parseServerInfo({ ...doc, urls: undefined })).toBeNull();
  });
  test("versions compare as numbers", () => {
    expect(compareVersions("1.10.0", "1.6.0")).toBe(1);
    expect(compareVersions("1.6.0", "1.6.00")).toBe(0);
    expect(compareVersions("1.5.99", "1.6.0")).toBe(-1);
  });
});
