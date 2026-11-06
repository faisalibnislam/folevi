"use client";

import dynamic from "next/dynamic";

// The app is client-only (it reads the window, history and the in-memory library), so it isn't prerendered.
const ShowcaseApp = dynamic(() => import("./ShowcaseApp").then((m) => m.ShowcaseApp), { ssr: false });

export function ShowcaseAppLoader() {
  return <ShowcaseApp />;
}
