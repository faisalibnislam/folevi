"use client";

import { Component, createContext, useContext, useEffect, type ErrorInfo, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { ConvexClientProvider, useAuthPhase } from "@/lib/convex/provider";
import { ToastProvider } from "@/components/ui/Toast";
import { can, type AdminRole, type Capability } from "./permissions";
import { AdminShell } from "./AdminShell";

export interface AdminIdentity {
  id: string;
  displayName: string;
  role: AdminRole;
}

const AdminContext = createContext<AdminIdentity | null>(null);

export function useAdmin(): AdminIdentity & { can: (capability: Capability) => boolean } {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin outside AdminApp");
  return { ...ctx, can: (capability: Capability) => can(ctx.role, capability) };
}

/**
 * Plain 404, visually the same as any unknown URL. Rendered whenever `admin.whoami` is rejected so
 * nothing hints that an admin area exists. (The server layout already returns a real 404 for
 * non-admins; this covers roles revoked mid-session and backend errors.)
 */
export function AdminNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6 text-ink">
      <title>404: This page could not be found.</title>
      <div className="flex items-center gap-5">
        <h1 className="border-r border-line-strong pr-5 text-2xl font-medium leading-[49px]">404</h1>
        <p className="text-sm">This page could not be found.</p>
      </div>
    </main>
  );
}

/** Catches errors thrown by the identity query and renders the neutral 404. */
class GateBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(_error: unknown, _info: ErrorInfo) {
    /* deliberately silent: no hint that anything exists here */
  }
  override render() {
    return this.state.failed ? <AdminNotFound /> : this.props.children;
  }
}

function Gate({ children }: { children: ReactNode }) {
  const phase = useAuthPhase();
  const { isAuthenticated } = useConvexAuth();
  // Ask for the admin identity only once the Convex connection carries the session token; asking
  // earlier would be rejected as unauthenticated and render the 404.
  const me = useQuery(api.admin.whoami, isAuthenticated ? {} : "skip");
  if (phase === "signed_out") return <AdminNotFound />;
  if (me === undefined) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas" aria-busy="true">
        <span className="sr-only">Loading…</span>
        <div className="h-1 w-40 overflow-hidden rounded-[4px] bg-sunken" aria-hidden>
          <div className="h-full w-1/3 animate-[folio-progress_1.2s_ease-in-out_infinite] rounded-[6px] bg-heading" />
        </div>
      </div>
    );
  }
  const identity: AdminIdentity = { id: me.id, displayName: me.displayName, role: me.role };
  return (
    <AdminContext.Provider value={identity}>
      <AdminShell>{children}</AdminShell>
    </AdminContext.Provider>
  );
}

export function AdminApp({ children }: { children: ReactNode }) {
  // The console wears the app's neutral chrome (globals.css, data-chrome), like AccountGate does for the app.
  useEffect(() => {
    document.documentElement.dataset.chrome = "neutral";
    return () => {
      delete document.documentElement.dataset.chrome;
    };
  }, []);
  return (
    <ConvexClientProvider>
      <ToastProvider>
        <GateBoundary>
          <Gate>{children}</Gate>
        </GateBoundary>
      </ToastProvider>
    </ConvexClientProvider>
  );
}
