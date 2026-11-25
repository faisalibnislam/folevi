"use client";

// A QR code drawn here from a link (the `qrcode` package the repo already uses), for someone holding a phone next
// to the screen: an invite, or the server's address for the apps. Always dark on white, in both themes, so every
// phone camera reads it.
import { useEffect, useState } from "react";

export function useQrDataUrl(value: string, size = 200): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#FFFFFF" } }))
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return src;
}

export function QrCode({ value, label, size = 168 }: { value: string; label: string; size?: number }) {
  const src = useQrDataUrl(value, size);
  return (
    <span className="inline-grid flex-none place-items-center rounded-control bg-white p-2 shadow-[0_0_0_1px_var(--color-line)]" style={{ width: size + 16, height: size + 16 }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data: URL made here, nothing to optimize
        <img src={src} alt={label} width={size} height={size} />
      ) : (
        <span className="block animate-pulse rounded-chip bg-[#f1f1f1] motion-reduce:animate-none" style={{ width: size, height: size }} aria-hidden />
      )}
    </span>
  );
}

/** Saves a QR code as a PNG, to print or send. */
export async function downloadQr(value: string, fileName: string): Promise<void> {
  const { default: QRCode } = await import("qrcode");
  const url = await QRCode.toDataURL(value, { margin: 2, width: 800, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#FFFFFF" } });
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
}
