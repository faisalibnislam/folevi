"use client";

import { Suspense } from "react";
import { ConvexClientProvider } from "@/lib/convex/provider";
import { AppRouterProvider } from "@/lib/app/router";
import { ToastProvider } from "@/components/ui/Toast";
import { AccountGate } from "./AccountGate";
import { ServiceWorkerRegistration } from "./ServiceWorkerRegistration";
import { ThemesSync } from "./ThemesSync";
import { FullPageMessage } from "@/lib/app/state";
import type { Backend } from "@/lib/shell";

/**
 * The product. `backend` says where the notes live: "account" (Folevi's servers, the website and the default)
 * or "local" (a library on this device, only in the bundled shell: components/app/ShellRoot.tsx).
 * TODO(WP5): the local branch; until the data seam lands every backend talks to the account.
 */
export function ProductApp({ backend = "account" }: { backend?: Backend } = {}) {
  void backend;
  return (
    <ConvexClientProvider>
      <Suspense fallback={<FullPageMessage title="Opening your folio…" busy />}>
        <AppRouterProvider>
          <ToastProvider>
            <ServiceWorkerRegistration />
            <ThemesSync />
            <AccountGate />
          </ToastProvider>
        </AppRouterProvider>
      </Suspense>
    </ConvexClientProvider>
  );
}
