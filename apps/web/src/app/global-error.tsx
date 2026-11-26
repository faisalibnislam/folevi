"use client";

// What shows when something throws above every other boundary (the root layout, or a screen with no boundary
// of its own): Folevi's own page, with a way back, in place of Next's bare "Application error". It replaces the
// root layout while it shows, so it brings its own document and styles. A block in a note that can't be drawn
// never gets this far: each one is kept to its own card (BlockBoundary in components/editor/NodeViews.tsx).
// (The apps' bundled shell reads only *.shell.tsx files, next.config.ts: it needs a global-error.shell.tsx that
// exports this one.)
import "./globals.css";
import { useEffect, useState } from "react";
import { fontVariables } from "./fonts";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  // The theme the person chose is kept on the document by a script the root layout runs; that layout is gone
  // here, so what it last wrote is read back (and the system's light or dark is the fallback, in the styles).
  const [theme] = useState(() => (typeof document === "undefined" ? undefined : (document.documentElement.getAttribute("data-theme") ?? undefined)));
  useEffect(() => {
    // For whoever is looking into it (the browser's console, the apps' logs).
    console.error("Folevi couldn't show this page:", error);
  }, [error]);
  return (
    <html lang="en" className={fontVariables} data-theme={theme} suppressHydrationWarning>
      <body>
        <title>Something went wrong · Folevi</title>
        <div className="ui-neutral-chrome min-h-dvh bg-canvas">
          <main id="main" className="px-3 pb-16 sm:px-6">
            <div className="mx-auto max-w-md pt-32 text-center">
              <h1 className="ui-display text-large-title">Something went wrong</h1>
              <p className="mt-3 text-muted">Folevi couldn’t show this page. Try again, or reload Folevi.</p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={() => retry()} className="ui-btn ui-btn-primary h-control px-4 text-callout">
                  Try again
                </button>
                <button type="button" onClick={() => window.location.reload()} className="ui-btn ui-btn-secondary h-control px-4 text-callout">
                  Reload
                </button>
              </div>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
