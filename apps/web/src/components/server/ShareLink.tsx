"use client";

// A link to hand to someone (an invite, a password reset, the server's address): shown in full, with Copy, Share
// (the phone's or computer's share sheet, where there is one) and, for links with a QR code, Save QR code.
import { useEffect, useState } from "react";
import { Check, Copy, Download, Share } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { downloadQr } from "./QrCode";

export function useCanShare(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => setCan(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
  return can;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function ShareLink({
  value,
  label,
  shareTitle,
  shareText,
  qrFileName,
  copyLabel = "Copy link",
}: {
  copyLabel?: string;
  value: string;
  label: string;
  /** For the share sheet. */
  shareTitle?: string;
  shareText?: string;
  /** Offer "Save QR code" with this file name. */
  qrFileName?: string;
}) {
  const [copied, setCopied] = useState<null | "ok" | "failed">(null);
  const canShare = useCanShare();
  return (
    <div className="space-y-2">
      <input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="ui-input h-10 w-full min-w-0 rounded-chip px-3 font-mono text-footnote text-ink"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            void copyText(value).then((ok) => {
              setCopied(ok ? "ok" : "failed");
              window.setTimeout(() => setCopied(null), 2000);
            })
          }
        >
          {copied === "ok" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copied === "ok" ? "Copied" : copyLabel}
        </Button>
        {canShare ? (
          <Button size="sm" onClick={() => void navigator.share({ title: shareTitle, text: shareText, url: value }).catch(() => undefined)}>
            <Share size={14} aria-hidden /> Share
          </Button>
        ) : null}
        {qrFileName ? (
          <Button size="sm" onClick={() => void downloadQr(value, qrFileName)}>
            <Download size={14} aria-hidden /> Save QR code
          </Button>
        ) : null}
      </div>
      <p className="text-footnote text-muted" role="status" aria-live="polite">
        {copied === "failed" ? "Your browser didn't allow copying. Select the link above and copy it yourself." : ""}
      </p>
    </div>
  );
}
