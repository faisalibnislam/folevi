"use client";

// Not on any page while the app is paused (owner, 2026-11-28): kept, with its tests, for when it comes back.

import { useEffect, useState } from "react";
import { ButtonLink } from "./ui";
import { WINDOWS_DOWNLOAD_ARM64_URL, WINDOWS_DOWNLOAD_X64_URL } from "./site";

/** What Chromium browsers say about the PC (navigator.userAgentData); other browsers have none. */
interface UaData {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
}

/** Which installer fits this PC: "arm64" or "x64", or null when the browser can't tell (Firefox, Safari, another system). */
export async function windowsBuild(ua: UaData | undefined): Promise<"arm64" | "x64" | null> {
  if (!ua?.getHighEntropyValues || ua.platform !== "Windows") return null;
  try {
    const { architecture } = await ua.getHighEntropyValues(["architecture"]);
    return architecture === "arm" ? "arm64" : architecture === "x86" ? "x64" : null;
  } catch {
    return null;
  }
}

/**
 * Download for Windows: one button for this PC when the browser says which kind it is, else both installers.
 * The page is drawn on the server, which can't know, so it starts with both and settles once it runs.
 */
export function WindowsDownload({ size }: { size?: "md" | "lg" }) {
  const [build, setBuild] = useState<"arm64" | "x64" | null>(null);
  useEffect(() => {
    let live = true;
    void windowsBuild((navigator as Navigator & { userAgentData?: UaData }).userAgentData).then((b) => live && setBuild(b));
    return () => {
      live = false;
    };
  }, []);
  if (build)
    return (
      <ButtonLink href={build === "arm64" ? WINDOWS_DOWNLOAD_ARM64_URL : WINDOWS_DOWNLOAD_X64_URL} size={size}>
        Download for Windows
      </ButtonLink>
    );
  return (
    <>
      <ButtonLink href={WINDOWS_DOWNLOAD_X64_URL} size={size}>
        For Intel and AMD PCs
      </ButtonLink>
      <ButtonLink href={WINDOWS_DOWNLOAD_ARM64_URL} size={size} variant="secondary">
        For Arm PCs
      </ButtonLink>
    </>
  );
}
