"use client";
// React hooks over the key session (docs/E2EE_DESIGN.md §12 WP6): the lock state and the ways to unlock, and
// the approval requests a trusted device shows. A Standard account reads { state: "none", methods: [] }.
import { useSyncExternalStore } from "react";
import { sessionImpl, type IncomingApproval, type LockState, type MethodSummary } from "./session";

const NONE: { state: LockState; methods: MethodSummary[] } = { state: "none", methods: [] };
const NO_APPROVALS: IncomingApproval[] = [];
let snapshot = NONE;

function read(): { state: LockState; methods: MethodSummary[] } {
  const s = sessionImpl();
  const state = s.state();
  if (snapshot.state !== state || snapshot.methods !== s.methods) snapshot = { state, methods: s.methods };
  return snapshot;
}

export function useKeySession(): { state: LockState; methods: MethodSummary[] } {
  return useSyncExternalStore(sessionImpl().subscribe, read, () => NONE);
}

/** The ways to unlock (Settings > Privacy). */
export function useRecoveryMethods(): MethodSummary[] {
  return useKeySession().methods;
}

/** Requests from new devices, on a trusted device or browser that is unlocked (never a public session). */
export function useApprovals(): IncomingApproval[] {
  return useSyncExternalStore(
    sessionImpl().subscribe,
    () => sessionImpl().approvals,
    () => NO_APPROVALS,
  );
}
