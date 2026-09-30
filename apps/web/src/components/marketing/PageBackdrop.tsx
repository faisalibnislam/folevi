"use client";

import { useState } from "react";
import { useSiteAmbient, useSiteAmbientImage } from "./SiteShell";

/**
 * A page's backdrop: an artwork, heavily blurred, held still behind the page while its cards scroll over it
 * (the Style panel's Blur background, for the page as a whole). A page names its artwork (`image`), which
 * also lights the sidebar; without one (Home) it follows the canvas light, which the hero's style picker sets.
 * A new image fades in over the last one once it has loaded.
 */
export function PageBackdrop({ image: own }: { image?: string }) {
  useSiteAmbient(own ?? null);
  const lit = useSiteAmbientImage();
  const image = own ?? lit;
  const [layers, setLayers] = useState<Array<{ src: string; first: boolean }>>(image ? [{ src: image, first: true }] : []);
  const [shown, setShown] = useState(image);
  if (shown !== image) {
    setShown(image);
    if (image) setLayers((current) => [...current.filter((l) => l.src !== image).slice(-1), { src: image, first: false }]);
  }
  return (
    <div aria-hidden="true" className="mk-home-art">
      {layers.map((layer) => (
        <Layer key={layer.src} src={layer.src} first={layer.first} />
      ))}
    </div>
  );
}

function Layer({ src, first }: { src: string; first: boolean }) {
  const [ready, setReady] = useState(first);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a 200 px image, blurred; cross-faded by hand
    <img
      src={src}
      alt=""
      decoding="async"
      ref={(node) => {
        if (!ready && node?.complete && node.naturalWidth) setReady(true);
      }}
      onLoad={() => setReady(true)}
      data-ready={ready ? "true" : undefined}
      className="mk-home-art-layer"
    />
  );
}
