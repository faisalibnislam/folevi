import "server-only";

import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import type { ReactNode } from "react";
import { BrowserBar, MacWindows, WebWindow } from "./mac/MacMiniature";
import { cx } from "./ui";

/*
 * Real product screenshots, when present, replace the live HTML miniatures.
 *
 * Drop PNGs into apps/web/public/marketing/screenshots/:
 *   mac-light.png, mac-dark.png, web-light.png, web-dark.png
 * The check runs on the server at render/build time. If only the light file exists it is used for
 * both themes. Without any file, the HTML miniature renders instead — never a stock image.
 */

export type ShotName = "mac" | "web";

const SCREENSHOT_DIR = path.join(process.cwd(), "public", "marketing", "screenshots");

type Shot = { src: string; width: number; height: number };

/** Reads width/height from a PNG's IHDR chunk so the image reserves its space (no layout shift). */
function readPng(file: string): Shot | null {
  const full = path.join(SCREENSHOT_DIR, file);
  if (!fs.existsSync(full)) return null;
  try {
    const fd = fs.openSync(full, "r");
    const header = Buffer.alloc(24);
    fs.readSync(fd, header, 0, 24, 0);
    fs.closeSync(fd);
    if (header.toString("ascii", 1, 4) !== "PNG") return null;
    return { src: `/marketing/screenshots/${file}`, width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } catch {
    return null;
  }
}

const ALT: Record<ShotName, string> = {
  mac: "The Folevi Mac app with the sidebar, a page open in the editor and the inspector.",
  web: "Folevi in a web browser, showing the sidebar and a page in the editor.",
};

export function ProductShot({ name, alt, fallback, className }: { name: ShotName; alt?: string; fallback?: ReactNode; className?: string }) {
  const light = readPng(`${name}-light.png`);
  const dark = readPng(`${name}-dark.png`) ?? light;

  if (!light && !dark) {
    return <div className={className}>{fallback ?? (name === "mac" ? <MacWindows /> : <WebWindow />)}</div>;
  }

  const label = alt ?? ALT[name];
  const sizes = "(min-width: 1200px) 1100px, 100vw";
  const images = (imgClass: string) => (
    <>
      {light ? (
        <Image src={light.src} width={light.width} height={light.height} alt={label} sizes={sizes} className={cx(imgClass, dark !== light && "dark:hidden")} />
      ) : null}
      {dark && dark !== light ? (
        <Image src={dark.src} width={dark.width} height={dark.height} alt={label} sizes={sizes} className={cx(imgClass, light ? "hidden dark:block" : "")} />
      ) : null}
    </>
  );

  // Web captures are the page only, so they get a quiet browser bar. Mac captures already include the window.
  if (name === "web") {
    return (
      <div className={className}>
        <div className="mk-window">
          <BrowserBar />
          {images("block h-auto w-full")}
        </div>
      </div>
    );
  }
  return <div className={className}>{images("mk-shot h-auto w-full")}</div>;
}
