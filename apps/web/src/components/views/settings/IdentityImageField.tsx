"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { IDENTITY_IMAGE_ACCEPT, identityImageProblem } from "@/lib/app/identityImages";

/**
 * A profile picture or workspace logo: a preview (the image, or the initial on a neutral tile) with
 * "Upload…" and "Remove". Round for people, a rounded square for workspaces.
 */
export function IdentityImageField({
  label,
  shape,
  src,
  initial,
  onUpload,
  onRemove,
}: {
  label: string;
  shape: "circle" | "square";
  src: string | null;
  initial: string;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const inputId = useId();
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  // A signed URL can expire (e.g. an offline start from an old snapshot): fall back to the initial.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const shown = src && src !== failedSrc ? src : null;
  const radius = shape === "circle" ? "rounded-chip" : "rounded-chip";

  const run = async (kind: "upload" | "remove", fn: () => Promise<void>, done: string) => {
    setBusy(kind);
    try {
      await fn();
      toast.show(done, { tone: "success" });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div role="group" aria-label={label} className="flex items-center gap-4">
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small signed storage URL, not an optimisable asset
        <img src={shown} alt="" width={56} height={56} onError={() => setFailedSrc(shown)} className={`size-14 flex-none object-cover ${radius} border border-line`} />
      ) : (
        <span aria-hidden className={`grid size-14 flex-none place-items-center bg-heading text-xl font-semibold text-canvas ${radius}`}>
          {initial.trim().slice(0, 1).toUpperCase() || "·"}
        </span>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={IDENTITY_IMAGE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label={`Upload ${label.toLowerCase()}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const problem = identityImageProblem(file);
              if (problem) {
                toast.show(problem, { tone: "error" });
                return;
              }
              void run("upload", () => onUpload(file), `${label} updated`);
            }}
          />
          <Button size="sm" aria-describedby={hintId} disabled={busy !== null} onClick={() => inputRef.current?.click()}>
            {busy === "upload" ? "Uploading…" : "Upload…"}
          </Button>
          {src ? (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run("remove", onRemove, `${label} removed`)}>
              {busy === "remove" ? "Removing…" : "Remove"}
            </Button>
          ) : null}
        </div>
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          PNG, JPEG, WebP or GIF, up to 2 MB. A square image works best.
        </p>
      </div>
    </div>
  );
}
