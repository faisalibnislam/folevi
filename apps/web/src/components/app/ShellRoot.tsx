"use client";
// The bundled app shell's root (src/app/page.shell.tsx, docs/LOCAL_MODE_PLAN.md §1): reads the mode the host
// set before the page loaded and opens the first-launch choice, the product on a local library, or the product
// on a Folevi account. Only the shell build renders it; the website keeps rendering <ProductApp/> directly.
import { useState, useSyncExternalStore } from "react";
import { FullPageMessage } from "@/lib/app/state";
import { initialShellMode, setShellMode, type Backend, type ShellMode } from "@/lib/shell";
import { ModeChoice } from "./ModeChoice";
import { ProductApp } from "./ProductApp";

// The host's mode never changes under a loaded page (a switch reloads it), so there's nothing to subscribe to.
const noSubscription = () => () => {};
// index.html is prerendered without a host; hydration starts from the same null and then reads the bridge.
const serverMode = () => null;

export function ShellRoot() {
  const hostMode = useSyncExternalStore<ShellMode | null>(noSubscription, initialShellMode, serverMode);
  const [chosen, setChosen] = useState<Backend | null>(null);
  const mode = chosen ?? hostMode;

  if (mode === null) return <FullPageMessage title="Opening your folio…" busy />;
  if (mode === "unset") {
    return (
      <ModeChoice
        onChoose={async (next) => {
          await setShellMode(next);
          setChosen(next);
        }}
      />
    );
  }
  return <ProductApp backend={mode} />;
}
