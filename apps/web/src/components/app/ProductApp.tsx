"use client";

import { Suspense } from "react";
import { ConvexClientProvider } from "@/lib/convex/provider";
import { AppRouterProvider } from "@/lib/app/router";
import { ToastProvider } from "@/components/ui/Toast";
import { AccountGate } from "./AccountGate";
import { ServiceWorkerRegistration } from "./ServiceWorkerRegistration";
import { ThemesSync } from "./ThemesSync";
import { FullPageMessage } from "@/lib/app/state";

export function ProductApp() {
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
