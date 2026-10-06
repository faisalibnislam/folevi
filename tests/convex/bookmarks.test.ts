import { describe, expect, test } from "vitest";
import { isPrivateHost, previewFromHtml } from "../../convex/bookmarks";

describe("bookmark previews", () => {
  test("reads Open Graph, title and icon, resolving relative addresses", () => {
    const html = `<html><head>
      <title>Fallback &amp; title</title>
      <meta property="og:title" content="Free time tracking &amp; invoicing · Involets">
      <meta name="description" content="Track hours, make invoices.">
      <meta property="og:site_name" content="Involets">
      <meta property="og:image" content="/og.png">
      <link rel="icon" href="/favicon.ico">
      <link rel="apple-touch-icon" href="https://cdn.example.com/touch.png">
    </head><body><p>body</p></body></html>`;
    expect(previewFromHtml(html, "https://involets.com/page")).toEqual({
      title: "Free time tracking & invoicing · Involets",
      description: "Track hours, make invoices.",
      siteName: "Involets",
      image: "https://involets.com/og.png",
      icon: "https://cdn.example.com/touch.png",
    });
  });

  test("falls back to <title> and /favicon.ico; ignores non-web image addresses", () => {
    const p = previewFromHtml(`<head><title> Plain page </title><meta property="og:image" content="javascript:alert(1)"></head>`, "https://example.com/a");
    expect(p).toEqual({ title: "Plain page", description: null, siteName: null, image: null, icon: "https://example.com/favicon.ico" });
  });

  test("private and local hosts are never fetched", () => {
    for (const h of ["localhost", "app.localhost", "127.0.0.1", "10.1.2.3", "192.168.0.10", "172.20.0.1", "169.254.169.254", "[::1]", "fd00::1", "printer.local", "intranet"]) {
      expect(isPrivateHost(h), h).toBe(true);
    }
    for (const h of ["involets.com", "www.example.org", "8.8.8.8", "172.32.0.1", "[2606:4700::1]"]) expect(isPrivateHost(h), h).toBe(false);
    // Benchmarking and IETF ranges, and IPv6 forms that carry an IPv4 address or translate to one.
    for (const h of ["198.18.0.1", "198.19.255.255", "192.0.0.8", "[::7f00:1]", "[::127.0.0.1]", "[64:ff9b::a00:1]"]) expect(isPrivateHost(h), h).toBe(true);
  });
});
