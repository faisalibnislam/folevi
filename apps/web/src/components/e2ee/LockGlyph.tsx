import { LockKeyhole } from "lucide-react";
import { copy } from "@/lib/e2ee/copy";

/** The small lock after the name of a folder or note marked Always fully encrypted (§10.8): 12 px, muted. */
export function LockGlyph({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex flex-none text-muted ${className}`} title={copy.lock.glyph}>
      <LockKeyhole size={12} aria-hidden />
      <span className="sr-only">{copy.lock.glyph}</span>
    </span>
  );
}
