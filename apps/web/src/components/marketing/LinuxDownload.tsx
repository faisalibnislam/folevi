"use client";

import { useEffect, useState } from "react";
import { ButtonLink } from "./ui";
import { LINUX_CHECKSUMS_URL, LINUX_DOWNLOADS } from "./site";

export type LinuxFormat = keyof typeof LINUX_DOWNLOADS;
export type LinuxArch = "x64" | "arm64";

const FORMATS: { format: LinuxFormat; label: string; for: string }[] = [
  { format: "appimage", label: "AppImage", for: "most distributions" },
  { format: "deb", label: ".deb", for: "Ubuntu, Debian and Mint" },
  { format: "rpm", label: ".rpm", for: "Fedora and openSUSE" },
];
const ARCHES: { arch: LinuxArch; label: string }[] = [
  { arch: "x64", label: "Intel and AMD" },
  { arch: "arm64", label: "ARM" },
];

/** What Chromium browsers say about the computer (navigator.userAgentData); other browsers have none. */
interface UaData {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
}

/**
 * The package to suggest on this computer, or null when it isn't Linux or the kind of PC can't be told. The
 * format comes from the distribution the browser names (Firefox names Ubuntu or Fedora), else the AppImage,
 * which runs on most.
 */
export async function linuxSuggestion(ua: string, data: UaData | undefined): Promise<{ format: LinuxFormat; arch: LinuxArch } | null> {
  const linux = /\bLinux\b/.test(ua) && !/\bAndroid\b/.test(ua) && !/\bCrOS\b/.test(ua);
  if (!linux && data?.platform !== "Linux") return null;
  const format: LinuxFormat = /\b(Ubuntu|Debian|Mint)\b/i.test(ua) ? "deb" : /\b(Fedora|openSUSE|SUSE|Red Hat)\b/i.test(ua) ? "rpm" : "appimage";
  let arch: LinuxArch | null = /\b(aarch64|arm64|armv8)\b/i.test(ua) ? "arm64" : /\b(x86_64|amd64)\b/i.test(ua) ? "x64" : null;
  if (!arch && data?.getHighEntropyValues) {
    try {
      const { architecture } = await data.getHighEntropyValues(["architecture"]);
      arch = architecture === "arm" ? "arm64" : architecture === "x86" ? "x64" : null;
    } catch {
      arch = null;
    }
  }
  return arch ? { format, arch } : null;
}

/**
 * Download for Linux: the package this computer most likely wants, when the browser says enough, and every
 * package below it either way. The page is drawn on the server, which can't know, so the suggestion comes once
 * it runs.
 */
export function LinuxDownload() {
  const [suggestion, setSuggestion] = useState<{ format: LinuxFormat; arch: LinuxArch } | null>(null);
  useEffect(() => {
    let live = true;
    void linuxSuggestion(navigator.userAgent, (navigator as Navigator & { userAgentData?: UaData }).userAgentData).then((s) => live && setSuggestion(s));
    return () => {
      live = false;
    };
  }, []);
  const suggested = suggestion ? FORMATS.find((f) => f.format === suggestion.format)! : null;
  return (
    <div className="w-full">
      {suggestion && suggested ? (
        <ButtonLink href={LINUX_DOWNLOADS[suggestion.format][suggestion.arch]}>
          Download for Linux ({suggested.label})
        </ButtonLink>
      ) : null}
      <table className={`${suggestion ? "mt-5" : ""} w-full max-w-[520px] border-collapse text-left text-[14px]`}>
        <caption className="sr-only">Folevi for Linux packages</caption>
        <thead>
          <tr className="text-muted">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Package
            </th>
            {ARCHES.map((a) => (
              <th key={a.arch} scope="col" className="py-1.5 pr-3 font-medium">
                {a.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FORMATS.map((f) => (
            <tr key={f.format} className="border-t mk-hair">
              <th scope="row" className="py-2 pr-3 font-medium text-(--color-heading)">
                {f.label} <span className="font-normal text-muted">for {f.for}</span>
              </th>
              {ARCHES.map((a) => (
                <td key={a.arch} className="py-2 pr-3">
                  <a href={LINUX_DOWNLOADS[f.format][a.arch]} className="underline underline-offset-2">
                    Download<span className="sr-only">
                      {" "}
                      {f.label} for {a.label}
                    </span>
                  </a>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[13px]">
        <a href={LINUX_CHECKSUMS_URL} className="text-muted underline underline-offset-2">
          SHA-256 checksums
        </a>
      </p>
    </div>
  );
}
