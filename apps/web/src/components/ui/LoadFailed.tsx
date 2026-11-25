import { CloudOff, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/** What a failed list says: what couldn't load (`loadFailedCopy("your notes")`), and that Folevi keeps trying. */
export const loadFailedCopy = (what: string) => ({
  icon: CloudOff,
  title: `Couldn’t load ${what}`,
  body: "Folevi will keep trying. Check your connection, or try again now.",
});

/**
 * A list whose query failed (lib/convex/queries.ts `failed`), in place of its loading placeholder: it says so,
 * with Try again, while the query retries on its own. The page around it carries on.
 */
export function LoadFailed({ what, onRetry, size = "page", className }: { what: string; onRetry: () => void; size?: "page" | "inline"; className?: string }) {
  const copy = loadFailedCopy(what);
  return (
    <div role="alert" data-load-failed="">
      <EmptyState
        {...copy}
        size={size}
        className={className}
        action={
          <Button variant="secondary" size={size === "page" ? "md" : "sm"} onClick={onRetry}>
            <RotateCw size={14} aria-hidden /> Try again
          </Button>
        }
      />
    </div>
  );
}
