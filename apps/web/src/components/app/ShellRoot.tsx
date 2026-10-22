"use client";
// The bundled app shell's root (src/app/page.shell.tsx, docs/LOCAL_MODE_PLAN.md §1): reads the mode the host
// set before the page loaded and opens the first-launch choice, the product on a local library, or the product
// on a Folevi account. Only the shell build renders it; the website keeps rendering <ProductApp/> directly.
//
// Local mode needs a place for its library first: "Keep notes on my devices" goes on to LibrarySetup, and so
// does a launch in local mode whose host says nothing is set up yet (`library.info().configured === false`).
import { useEffect, useState, useSyncExternalStore } from "react";
import { FullPageMessage } from "@/lib/app/state";
import { initialShellMode, setShellMode, shell, type Backend, type ShellMode } from "@/lib/shell";
import { LibrarySetup } from "./LibrarySetup";
import { ModeChoice } from "./ModeChoice";
import { rememberSignInNext } from "./ShellSignIn";
import { ProductApp } from "./ProductApp";
import { MacPolish } from "./MacPolish";

// The host's mode never changes under a loaded page (a switch reloads it), so there's nothing to subscribe to.
const noSubscription = () => () => {};
// index.html is prerendered without a host; hydration starts from the same null and then reads the bridge.
const serverMode = () => null;

export function ShellRoot() {
  return (
    <>
      {/* Folevi for Mac's polish on the screens before the product too (the first-launch choice, the library). */}
      <MacPolish />
      <ShellScreens />
    </>
  );
}

function ShellScreens() {
  const hostMode = useSyncExternalStore<ShellMode | null>(noSubscription, initialShellMode, serverMode);
  const [chosen, setChosen] = useState<Backend | null>(null);
  const [setup, setSetup] = useState(false);
  // In local mode: whether the host has a library set up (null while it's asked).
  const [configured, setConfigured] = useState<boolean | null>(null);
  const mode = chosen ?? hostMode;
  const hostLibrary = mode === "local" ? (shell()?.library ?? null) : null;

  useEffect(() => {
    if (!hostLibrary || configured !== null) return;
    let live = true;
    hostLibrary.info().then(
      (info) => live && setConfigured(info.configured !== false),
      // The library itself says what's wrong once it opens.
      () => live && setConfigured(true),
    );
    return () => {
      live = false;
    };
  }, [hostLibrary, configured]);

  if (mode === null) return <FullPageMessage title="Opening your folio…" busy />;
  if (mode === "unset") {
    if (setup)
      return (
        <LibrarySetup
          onBack={() => setSetup(false)}
          onDone={async () => {
            // The Mac app reloads its windows in local mode here (its policy and network rules change).
            await setShellMode("local");
            setConfigured(true);
            setChosen("local");
          }}
        />
      );
    return (
      <ModeChoice
        onChoose={async (next) => {
          if (next === "local" && shell()?.library) {
            setSetup(true);
            return;
          }
          if (next === "account") rememberSignInNext();
          await setShellMode(next);
          setChosen(next);
        }}
      />
    );
  }
  if (hostLibrary && configured === null) return <FullPageMessage title="Opening your folio…" busy />;
  if (hostLibrary && configured === false) return <LibrarySetup onDone={async () => setConfigured(true)} />;
  return <ProductApp backend={mode} />;
}
