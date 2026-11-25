"use client";

// "Connect your apps" (docs/SELF_HOSTING_PLAN.md §8): the server's address as a QR code and as text, with the few
// steps to add it in Folevi for Mac, iPhone, iPad and Android. Shown at the end of setup, on the admin Overview and
// People, and to a member who just joined.
import { useEffect, useState } from "react";
import { House, Laptop, Smartphone, Tablet } from "lucide-react";
import { QrCode } from "./QrCode";
import { ShareLink } from "./ShareLink";

/** True for an address that only works on the home network (a private IP, a .local name, a name with no dots). */
export function isHomeOnlyAddress(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".local") || !host.includes(".")) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}

/** The address people use for this server: the one in `/.well-known/folevi.json`, else this page's own. */
export function useServerAddress(preferred?: string | null): string {
  const [origin, setOrigin] = useState(preferred ?? "");
  useEffect(() => {
    if (preferred) {
      setOrigin(preferred);
      return;
    }
    setOrigin(window.location.origin);
    let live = true;
    fetch("/.well-known/folevi.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { urls?: { app?: string } } | null) => live && j?.urls?.app && setOrigin(j.urls.app))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [preferred]);
  return origin;
}

const APPS = [
  { icon: Laptop, name: "Mac" },
  { icon: Smartphone, name: "iPhone" },
  { icon: Tablet, name: "iPad" },
  { icon: Smartphone, name: "Android" },
];

export function ConnectApps({ address, serverName, remoteHref }: { address?: string | null; serverName?: string; /** Where an admin sets up remote access; members get plain words instead. */ remoteHref?: string }) {
  const origin = useServerAddress(address);
  const homeOnly = origin ? isHomeOnlyAddress(origin) : false;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2 self-center sm:self-start">
          {origin ? <QrCode value={origin} label={`QR code of the address of ${serverName ?? "this server"}`} /> : <span className="block size-[184px] rounded-control bg-[var(--glass-hover)]" aria-hidden />}
          <span className="text-footnote text-muted">Scan with the phone&apos;s camera</span>
        </div>
        <div className="min-w-0 flex-1 space-y-3 text-subheadline">
          <ul className="flex flex-wrap gap-1.5" aria-label="Folevi apps">
            {APPS.map((a) => (
              <li key={a.name} className="inline-flex items-center gap-1.5 rounded-chip bg-[var(--glass-hover)] px-2.5 py-1 text-footnote font-medium text-heading">
                <a.icon size={13} aria-hidden /> {a.name}
              </li>
            ))}
          </ul>
          <ol className="list-decimal space-y-1.5 pl-5 text-ink marker:text-muted">
            <li>Open Folevi on the device. New to Folevi? Get it from the App Store, Google Play or folevi.com/download.</li>
            <li>
              On the sign-in screen, choose <span className="font-semibold text-heading">Your own server</span>.
            </li>
            <li>Scan this code, or type the address below. Then sign in with your account here.</li>
          </ol>
          {origin ? <ShareLink value={origin} label="This server's address" shareTitle={serverName ?? "Folevi"} shareText={`Add ${serverName ?? "this Folevi server"} in the Folevi app: Your own server, then this address.`} /> : null}
        </div>
      </div>
      {homeOnly ? (
        <p className="flex items-start gap-2 rounded-control bg-[var(--glass-hover)] p-3 text-subheadline text-ink">
          <House size={16} className="mt-0.5 flex-none text-muted" aria-hidden />
          <span>
            This address works on your home network. {remoteHref ? (
              <>
                To use the apps away from home too,{" "}
                <a href={remoteHref} className="font-medium text-heading underline underline-offset-2 hover:decoration-2">
                  set up remote access
                </a>
                .
              </>
            ) : (
              "Away from home, the apps reach it once the person who runs this server sets up remote access."
            )}
          </span>
        </p>
      ) : null}
    </div>
  );
}
