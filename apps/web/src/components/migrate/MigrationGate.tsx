"use client";
// The gate for a move between modes (docs/LOCAL_MODE_PLAN.md §6): only the apps' built-in interface (a shell) moves a
// library, so the screens and the copying (MigrationMove.tsx) load there, from the start; the website never does.
import { lazy, Suspense, useSyncExternalStore, type ReactNode } from "react";
import { shell } from "@/lib/shell";
import { pendingMove, subscribePendingMove } from "@/lib/migrate/session";

const loadMove = () => import("./MigrationMove").then((m) => ({ default: m.MigrationMove }));
if (typeof window !== "undefined" && shell()) void loadMove();
const MigrationMove = lazy(loadMove);

/** Shows the move under way instead of the app, and the app once there's none. */
export function MigrationGate({ children }: { children: ReactNode }) {
  const move = useSyncExternalStore(subscribePendingMove, pendingMove, () => null);
  if (!move || !shell()) return <>{children}</>;
  return (
    <Suspense fallback={null}>
      <MigrationMove move={move} />
    </Suspense>
  );
}
