import Image from "next/image";
import { cx } from "../ui";

/*
 * Real screenshots of the app, in a light and a dark version. Both are in the page and the site's theme
 * shows one ([data-shot] in marketing.css), so the picture follows the theme toggle without a flash.
 * The hidden one is display: none, so its lazy image isn't downloaded.
 *
 * The files are made by apps/web/scripts/capture-folder-screenshots.ts from a demo account in the running
 * app. They're saved at the size they're shown at 2x, so they're served as they are.
 */

export type Screenshot = {
  light: string;
  dark: string;
  width: number;
  height: number;
  alt: string;
};

/** The Folders page with every folder as a card (1440 × 1100 window). */
export const FOLDERS_SCREENSHOT: Screenshot = {
  light: "/marketing/screenshots/folders-light.webp",
  dark: "/marketing/screenshots/folders-dark.webp",
  width: 2400,
  height: 1833,
  alt: "The Folders page in Folevi, listing twelve folders as cards in their own colours: Clients, Finance, Garden, Health, Ideas, Meetings, Personal, Projects, Reading, Recipes, Research and Travel. Each card shows how many notes it holds, when it last changed and its newest notes showing through the cover. The sidebar lists the first five folders and 7 more.",
};

export function ThemedScreenshot({ shot, className }: { shot: Screenshot; className?: string }) {
  const common = {
    width: shot.width,
    height: shot.height,
    unoptimized: true,
    loading: "lazy" as const,
    className: cx("h-auto w-full", className),
  };
  return (
    <>
      <Image {...common} src={shot.light} alt={shot.alt} data-shot="light" />
      <Image {...common} src={shot.dark} alt={shot.alt} data-shot="dark" />
    </>
  );
}
