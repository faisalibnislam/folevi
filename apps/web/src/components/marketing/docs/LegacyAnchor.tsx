"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * The docs used to be one page with in-page anchors (/docs#sync). Fragments never reach the server, so an
 * old link is forwarded here, in the browser, to the article that now holds that section. Without scripting,
 * the index still shows the anchor's card with a link to the article.
 */
export function LegacyAnchor({ anchors }: { anchors: Record<string, string> }) {
  const router = useRouter();
  useEffect(() => {
    const forward = () => {
      const target = anchors[decodeURIComponent(window.location.hash.slice(1))];
      if (target) router.replace(target);
    };
    forward();
    window.addEventListener("hashchange", forward);
    return () => window.removeEventListener("hashchange", forward);
  }, [anchors, router]);
  return null;
}
