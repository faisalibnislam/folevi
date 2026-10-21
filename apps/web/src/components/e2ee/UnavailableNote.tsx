import { LockKeyhole } from "lucide-react";
import { AppLink } from "@/lib/app/router";
import { copy } from "@/lib/e2ee/copy";

export type UnavailableFeature = Exclude<keyof typeof copy.unavailable, "downloading" | "openSettings">;

/**
 * Where a feature's button would be, in an encrypted space: a short note that says why it isn't there
 * (§10.12), never a raw error. `link` adds the way to the setting that turns it on.
 */
export function UnavailableNote({ feature, text, link = false, className = "" }: { feature?: UnavailableFeature; text?: string; link?: boolean; className?: string }) {
  const body = text ?? (feature ? copy.unavailable[feature] : "");
  return (
    <p role="note" className={`flex items-start gap-2 rounded-control bg-[var(--glass-hover)] px-3 py-2.5 text-[13px] leading-snug text-muted ${className}`}>
      <LockKeyhole size={14} aria-hidden className="mt-0.5 flex-none" />
      <span className="min-w-0">
        {body}
        {link ? (
          <>
            {" "}
            <AppLink href="/settings/privacy" className="font-medium text-heading underline decoration-line-strong underline-offset-2 hover:decoration-heading">
              {copy.unavailable.openSettings}
            </AppLink>
          </>
        ) : null}
      </span>
    </p>
  );
}
