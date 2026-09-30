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

/** The Travel folder's page with the Folders section open in the sidebar (1440 × 900 window). */
export const FOLDERS_SCREENSHOT: Screenshot = {
  light: "/marketing/screenshots/folders-light.webp",
  dark: "/marketing/screenshots/folders-dark.webp",
  width: 2400,
  height: 1500,
  alt: "The Folevi app with five coloured folders in the sidebar: Projects, Personal, Clients, Reading and Travel. The Travel folder is open and shows its eight notes as cards, such as Lisbon in April, Packing list and Train times, each in its own note style.",
};

/** The Move to folder dialog over Drafts, with the sidebar's folders beside it. */
export const MOVE_TO_FOLDER_SCREENSHOT: Screenshot = {
  light: "/marketing/screenshots/folders-move-light.webp",
  dark: "/marketing/screenshots/folders-move-dark.webp",
  width: 1440,
  height: 960,
  alt: "The Move to folder dialog for a draft called Ideas for the balcony. It has a search field and lists No folder (Drafts), marked as current, then the folders Projects, Personal, Clients, Reading and Travel.",
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
