"use client";

/** The frame's height: Google's chip is one scrollable row of suggestions (a scrollbar shows if it grows). */
export const SUGGESTIONS_HEIGHT = 60;

/**
 * The page a chip is shown in: Google's HTML and CSS exactly as sent, with links opening in a new tab and
 * the page following light and dark (Google's CSS uses prefers-color-scheme).
 */
export function suggestionsDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><base target="_blank"><style>html,body{margin:0;padding:0;background:transparent}</style></head><body>${html}</body></html>`;
}

/**
 * Google's Search Suggestions for a grounded answer, which Google's terms ask to show with it, unchanged.
 * Their markup is untrusted, so each chip lives in a sandboxed frame: no scripts, no access to the app
 * (not same-origin), only links that open in a new tab.
 */
export function SearchSuggestions({ entryPoints }: { entryPoints: string[] }) {
  if (!entryPoints.length) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {entryPoints.map((html, i) => (
        <iframe
          key={i}
          title="Google Search suggestions"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={suggestionsDocument(html)}
          height={SUGGESTIONS_HEIGHT}
          className="block w-full border-0 bg-transparent"
          style={{ height: SUGGESTIONS_HEIGHT }}
        />
      ))}
    </div>
  );
}
