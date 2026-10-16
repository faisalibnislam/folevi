"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { IDENTITY_IMAGE_ACCEPT, identityImageProblem } from "@/lib/app/identityImages";
import { ActionRow, DestructiveRow, IosSection } from "@/components/iphone/SettingsKit";

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

/**
 * The same, as rows of the iPhone app's Settings: the picture (or initial) beside who it is, then Choose a
 * picture and Remove (asked first), with the formats under them.
 */
export function IdentityImageRows({
  label,
  shape,
  src,
  initial,
  name,
  detail,
  onUpload,
  onRemove,
  disabled,
}: {
  label: string;
  shape: "circle" | "square";
  src: string | null;
  initial: string;
  /** Beside the picture: who or what it is (the name, and an email or a plan under it). */
  name: string;
  detail?: string;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
  disabled?: boolean;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const shown = src && src !== failedSrc ? src : null;
  const radius = shape === "circle" ? "rounded-capsule" : "rounded-control";
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
    <IosSection footer="PNG, JPEG, WebP or GIF, up to 2 MB. A square image works best." label={label}>
      <div className="flex items-center gap-4 px-4 py-4">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- a small signed storage URL, not an optimisable asset
          <img src={shown} alt={label} width={64} height={64} onError={() => setFailedSrc(shown)} className={`size-16 flex-none object-cover ${radius}`} />
        ) : (
          <span role="img" aria-label={`${label}: none yet`} className={`grid size-16 flex-none place-items-center bg-heading text-[26px] font-semibold text-canvas ${radius}`}>
            {initial.trim().slice(0, 1).toUpperCase() || "·"}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[20px] font-semibold leading-tight text-heading [overflow-wrap:anywhere]">{name}</span>
          {detail ? <span className="mt-0.5 block text-[15px] text-muted [overflow-wrap:anywhere]">{detail}</span> : null}
        </span>
      </div>
      <input
        ref={inputRef}
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
      <ActionRow label={src ? `Change ${label.toLowerCase()}` : `Choose ${label.toLowerCase()}`} busy={busy === "upload" ? "Uploading…" : null} disabled={disabled || busy !== null} onClick={() => inputRef.current?.click()} />
      {src ? <DestructiveRow label={busy === "remove" ? "Removing…" : `Remove ${label.toLowerCase()}`} disabled={disabled || busy !== null} onConfirm={() => void run("remove", onRemove, `${label} removed`)} /> : null}
    </IosSection>
  );
}
