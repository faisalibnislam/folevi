"use client";

import { useState } from "react";
import { ProductApp } from "@/components/app/ProductApp";
import { configureLocalLibrary, MemoryStore } from "@/lib/local";
import { setLocalSeeder } from "@/lib/local/setup";
import { fakePhone } from "./phone";
import { containFrame } from "./contain";
import { markShowcaseFrame } from "@/lib/showcaseFrame";
import { seedStudio } from "./seed";
import { registerShowcaseCollab } from "./collab";
import { startShowcaseAi } from "./ai";
import { startShowcaseFrame } from "./script";
import { setLocalCapabilityExtras } from "@/lib/backendMode";
import { enableLocalVaultForDemo } from "@/lib/local/vault/enabled";

/**
 * Folevi for Mac shows the window's traffic lights where the web app has its logo (Sidebar.tsx), and so does the
 * showcase's Mac window (12 px buttons, 8 px apart).
 */
const MAC_LIGHTS = `
a[aria-label="Folevi"].ui-browser-only > svg { visibility: hidden; }
a[aria-label="Folevi"].ui-browser-only { position: relative; }
a[aria-label="Folevi"].ui-browser-only::before {
  content: ""; position: absolute; left: 6px; top: 50%; width: 52px; height: 12px; margin-top: -6px;
  background:
    radial-gradient(circle at 6px 6px, #ff5f57 5.5px, #e0443e 5.6px, #e0443e 6px, transparent 6.2px),
    radial-gradient(circle at 26px 6px, #febc2e 5.5px, #dea123 5.6px, #dea123 6px, transparent 6.2px),
    radial-gradient(circle at 46px 6px, #28c840 5.5px, #1aab29 5.6px, #1aab29 6px, transparent 6.2px);
}
nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button] { display: none !important; }
`;

function macWindow(): void {
  const style = document.createElement("style");
  style.textContent = MAC_LIGHTS;
  document.head.appendChild(style);
}

/**
 * One device of the showcase: the product in local mode on a demo library in memory. The Mac window and the
 * iPhone are two frames of this page with the same `s`, so they elect one host for the library and share it
 * (lib/local/host.ts), the way two windows of the Mac app do: what changes on one shows on the other.
 */
function boot(): void {
  const params = new URLSearchParams(location.search);
  const s = (params.get("s") ?? "solo").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "solo";
  const device = params.get("device") === "phone" ? "phone" : "mac";
  markShowcaseFrame();
  containFrame();
  if (device === "phone") fakePhone();
  else macWindow();
  // The frame's history is the visitor's page's too: moving around the app never adds a Back step there.
  history.pushState = history.replaceState.bind(history);
  const name = `folevi-showcase-${s}`;
  setLocalSeeder(seedStudio);
  registerShowcaseCollab();
  startShowcaseAi();
  enableLocalVaultForDemo();
  setLocalCapabilityExtras({ comments: true, presence: true });
  configureLocalLibrary({
    openStore: async () => new MemoryStore(),
    host: { lockName: name, channel: () => new BroadcastChannel(name) as never },
  });
  history.replaceState(history.state, "", "/documents");
  startShowcaseFrame(device);
}

export function ShowcaseApp() {
  useState(() => {
    boot();
    return true;
  });
  return <ProductApp backend="local" />;
}
