"use client";
// What the iPhone and iPad app does with the page (lib/nativeApp.ts): the status bar's text follows the app's
// theme (light text on a dark page), drags are felt (haptics), and folevi:// links opened from other apps
// land where they point (a note, a page, a new note). In a browser and in the Mac app: nothing.
import { useEffect } from "react";
import { useAppRouter } from "@/lib/app/router";
import { parseDeepLink } from "@/lib/deepLink";
import { nativeApp } from "@/lib/nativeApp";
import { useCreateDocument } from "./useCreateDocument";

export function NativeBridge() {
  return nativeApp() ? <Bridge /> : null;
}

function Bridge() {
  const bridge = nativeApp()!;
  const { navigate } = useAppRouter();
  const createDocument = useCreateDocument();

  // The theme is on <html data-theme> (the boot script, then Appearance): the status bar follows it.
  useEffect(() => {
    const root = document.documentElement;
    let last = "";
    const sync = () => {
      const theme = root.dataset.theme === "dark" ? "dark" : "light";
      if (theme === last) return;
      last = theme;
      bridge.setStatusBar(theme);
    };
    sync();
    const watch = new MutationObserver(sync);
    watch.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, [bridge]);

  // Dragging is felt: a light tap when something lifts (a note, a block, a task), a firmer one when it lands.
  useEffect(() => {
    const lift = () => bridge.haptic("light");
    const land = () => bridge.haptic("medium");
    window.addEventListener("dragstart", lift, true);
    window.addEventListener("drop", land, true);
    return () => {
      window.removeEventListener("dragstart", lift, true);
      window.removeEventListener("drop", land, true);
    };
  }, [bridge]);

  useEffect(
    () =>
      bridge.onCommand((command) => {
        if (command.type !== "link") return;
        const link = parseDeepLink(command.url);
        if (!link) return;
        // Quick Add is the Mac's floating window; on iPhone and iPad it's a new note.
        if (link.type === "open") navigate(link.path);
        else void createDocument({});
      }),
    [bridge, navigate, createDocument],
  );
  return null;
}
