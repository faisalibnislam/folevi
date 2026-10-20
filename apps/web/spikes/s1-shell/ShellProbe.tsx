"use client";
// SPIKE S1/S2/S3 (docs/LOCAL_MODE.md): reports what the shell build sees, for the hosts' test scripts to read
// from window.__shellProbe: usePathname() (does a deep link hydrate at the right route?), whether React
// hydrated, and the web platform APIs local mode needs on this origin.
import { usePathname } from "next/navigation";
import { useEffect } from "react";

type Probe = Record<string, unknown>;
declare global {
  interface Window {
    __shellProbe?: Probe;
    __shellProbeRun?: () => Promise<Probe>;
  }
}

async function apis(): Promise<Probe> {
  const out: Probe = { origin: location.origin, href: location.href, isSecureContext: window.isSecureContext };
  try {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("shell-probe", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(Date.now(), "last");
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    const value = await new Promise((res) => {
      const g = db.transaction("kv").objectStore("kv").get("last");
      g.onsuccess = () => res(g.result);
    });
    out.indexedDB = typeof value === "number" ? "ok" : `odd:${String(value)}`;
    db.close();
  } catch (e) {
    out.indexedDB = `error:${String(e)}`;
  }
  try {
    out.webLocks = navigator.locks ? await navigator.locks.request("folevi-local-library", { ifAvailable: true }, async (l) => (l ? "ok:granted" : "ok:busy")) : "missing";
  } catch (e) {
    out.webLocks = `error:${String(e)}`;
  }
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("folevi"));
    const pt = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc")))).map((b) => b.toString(16).padStart(2, "0")).join("");
    out.cryptoSubtle = pt === "folevi" && digest.startsWith("ba7816bf") ? "ok" : "mismatch";
  } catch (e) {
    out.cryptoSubtle = `error:${String(e)}`;
  }
  try {
    out.broadcastChannel = typeof BroadcastChannel === "function" ? "ok" : "missing";
    new BroadcastChannel("folevi-probe").close();
  } catch (e) {
    out.broadcastChannel = `error:${String(e)}`;
  }
  try {
    const est = await navigator.storage?.estimate?.();
    out.storageEstimate = est ? { quota: est.quota, usage: est.usage } : "missing";
    out.storagePersisted = (await navigator.storage?.persisted?.()) ?? "missing";
  } catch (e) {
    out.storageEstimate = `error:${String(e)}`;
  }
  out.opfs = typeof navigator.storage?.getDirectory === "function" ? await navigator.storage.getDirectory().then(() => "ok", (e: unknown) => `error:${String(e)}`) : "missing";
  out.serviceWorker = "serviceWorker" in navigator ? "present" : "absent";
  out.fontVar = getComputedStyle(document.documentElement).getPropertyValue("--font-instrument-sans").trim().slice(0, 60);
  out.bodyFont = getComputedStyle(document.body).fontFamily.slice(0, 80);
  out.fontsLoaded = await document.fonts.ready.then(() => Array.from(document.fonts).filter((f) => f.status === "loaded").map((f) => f.family).slice(0, 5));
  out.tailwind = document.styleSheets.length > 0 && Array.from(document.styleSheets).some((s) => {
    try {
      return Array.from(s.cssRules).some((r) => r.cssText.includes("--radius") || r.cssText.includes("tw-"));
    } catch {
      return false;
    }
  });
  return out;
}

export function ShellProbe() {
  const pathname = usePathname();
  useEffect(() => {
    window.__shellProbe = { ...(window.__shellProbe ?? {}), hydrated: true, pathname, locationPath: location.pathname, at: Date.now() };
    window.__shellProbeRun = async () => (window.__shellProbe = { ...window.__shellProbe, ...(await apis()) });
  }, [pathname]);
  return null;
}
