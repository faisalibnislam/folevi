"use client";
// The one note local mode shows where a server-only feature would be (docs/LOCAL_MODE_PLAN.md §5.2): the
// Share button's place, the Comments tab, the workspace switcher's place, and the pages that only an
// account has (Shared with me, Changes, an invitation). It never offers a plan or a price.
import { Users } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export const SIGN_IN_TO_COLLABORATE = "Sign in to Folevi to share and collaborate";
const WHY = "Your notes are kept on your devices. Sharing, comments and workspaces need a Folevi account.";

/**
 * "page": a view's whole content (an account-only page opened in local mode). "panel": inside a panel or a
 * popover (the Comments tab, the Share button's popover). "inline": one quiet line (the sidebar's foot).
 */
export function SignInToCollaborate({ variant = "inline", className = "" }: { variant?: "page" | "panel" | "inline"; className?: string }) {
  if (variant === "page") return <EmptyState icon={Users} title={SIGN_IN_TO_COLLABORATE} body={WHY} className={className} />;
  if (variant === "panel") return <EmptyState icon={Users} size="inline" title={SIGN_IN_TO_COLLABORATE} body={WHY} className={className} />;
  return (
    <p data-sign-in-to-collaborate="" className={`flex items-center gap-2 px-2 text-[12px] leading-snug text-muted ${className}`}>
      <Users size={13} aria-hidden className="flex-none text-faint" />
      <span>{SIGN_IN_TO_COLLABORATE}</span>
    </p>
  );
}
