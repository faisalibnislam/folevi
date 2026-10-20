"use client";

import { Suspense } from "react";
import { BackendProvider } from "@/lib/convex/provider";
import { AppRouterProvider } from "@/lib/app/router";
import { ToastProvider } from "@/components/ui/Toast";
import { AccountGate } from "./AccountGate";
import { LocalGate } from "./LocalGate";
import { ServiceWorkerRegistration } from "./ServiceWorkerRegistration";
import { ThemesSync } from "./ThemesSync";
import { FullPageMessage } from "@/lib/app/state";
import type { Backend } from "@/lib/shell";

/**
 * The product. `backend` says where the notes live: "account" (Folevi's servers, the website and the default)
 * or "local" (a library on this device, only in the bundled shell: components/app/ShellRoot.tsx). In local
 * mode every query and mutation runs against the library (lib/local) and nothing reaches Folevi.
 */
export function ProductApp({ backend = "account" }: { backend?: Backend } = {}) {
  return (
    <BackendProvider backend={backend}>
      <Suspense fallback={<FullPageMessage title="Opening your folio…" busy />}>
        <AppRouterProvider>
          <ToastProvider>
            <ServiceWorkerRegistration />
            {/* Local mode reads the note themes bundled with the app (lib/shell/snapshot.ts). */}
            {backend === "account" ? <ThemesSync /> : null}
            {backend === "local" ? <LocalGate /> : <AccountGate />}
          </ToastProvider>
        </AppRouterProvider>
      </Suspense>
    </BackendProvider>
  );
}
