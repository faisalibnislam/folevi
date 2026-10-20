"use client";

import { useEffect } from "react";
import { isShell } from "@/lib/shell";

/**
 * Registers the offline service worker (production builds only; never caches private data). Never in the
 * bundled app shell: its files are already on the device, it has no /sw.js, and app://folevi does offer
 * navigator.serviceWorker (docs/LOCAL_MODE.md S1).
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (isShell()) return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_SW !== "1") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
