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
import { E2eeWorkers } from "@/components/e2ee/E2eeGate";
import { MacPolish } from "./MacPolish";
import { MoveWarningHost } from "./MoveWarning";

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
            {/* Folevi for Mac: keyboard-only focus rings, the key window, tooltips (nothing on the website). */}
            <MacPolish />
            {/* Local mode reads the note themes bundled with the app (lib/shell/snapshot.ts). */}
            {backend === "account" ? <ThemesSync /> : null}
            {/* End-to-end encryption's background work (migration, feature mirrors), only once a device is unlocked. */}
            {backend === "account" ? <E2eeWorkers /> : null}
            {/* The warning before a move changes who can see notes through a shared folder. */}
            {backend === "account" ? <MoveWarningHost /> : null}
            {backend === "local" ? <LocalGate /> : <AccountGate />}
          </ToastProvider>
        </AppRouterProvider>
      </Suspense>
    </BackendProvider>
  );
}
