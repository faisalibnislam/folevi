"use client";

import { ExternalLink } from "lucide-react";
import { EMBED_PROVIDER_LABEL, embedFor, sanitizeHref } from "@folevi/editor-schema";

// An embed block's frame (the editor and shared pages): the provider's player built from the stored page
// address (packages/editor-schema/src/embeds.ts), never the address itself. The frame is sandboxed to
// what players need, loads lazily, and sends only its origin as the referrer; the bar under it names the
// provider and opens the original.

export function EmbedFrame({ url, children }: { url: string; children?: React.ReactNode }) {
  const embed = embedFor(url);
  const href = sanitizeHref(url) ?? "#";
  const label = embed ? EMBED_PROVIDER_LABEL[embed.provider] : "Embed";
  return (
    <div className="my-2 overflow-hidden ui-card rounded-control" data-embed="">
      {embed ? (
        <div className="relative w-full bg-sunken" style={{ aspectRatio: String(embed.aspect) }}>
          <iframe
            src={embed.src}
            title={`${label} embed`}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
        </div>
      ) : (
        <p className="p-4 text-sm text-muted">This embed can&apos;t be shown.</p>
      )}
      <div className="flex min-h-9 items-center gap-2 border-t border-line px-3 text-xs text-muted">
        <span className="font-medium text-heading">{label}</span>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={(e) => {
            e.preventDefault();
            if (href !== "#") window.open(href, "_blank", "noopener,noreferrer");
          }}
          className="ml-auto flex min-w-0 items-center gap-1 rounded-tiny text-muted hover:text-heading focus-visible:shadow-[0_0_0_2px_var(--color-focus)] focus-visible:outline-none"
        >
          <span className="truncate">Open</span>
          <ExternalLink size={12} aria-hidden className="flex-none" />
        </a>
        {children}
      </div>
    </div>
  );
}
