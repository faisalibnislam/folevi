/**
 * Apple App Site Association for app.folevi.com (docs/IOS.md, "Links into the app"): which app may open the
 * site's links (universal links) and use its saved passwords and passkeys (webcredentials). Apple's CDN
 * fetches it straight from this address, so it is JSON at a fixed path with no redirect.
 *
 * Only the pages the iPhone and iPad app opens from a link are claimed: a note (/d/<id>) and the app pages
 * lib/deepLink.ts accepts. Sign-in, /connect, share pages (/s/), the API and admin stay in the browser.
 */
const TEAM_ID = "7K32QQ2FX8";
const APP_IDS = [`${TEAM_ID}.com.folevi.ios`];

/** The same pages as lib/deepLink.ts's PAGES, plus notes. */
const PAGES = ["documents", "tasks", "calendar", "inbox", "settings", "foli-ai", "trash", "templates", "help"];

export function GET() {
  return Response.json(
    {
      applinks: {
        details: [
          {
            appIDs: APP_IDS,
            components: [
              { "/": "/d/*", comment: "A note" },
              ...PAGES.flatMap((p) => [{ "/": `/${p}` }, { "/": `/${p}/*` }]),
            ],
          },
        ],
      },
      webcredentials: { apps: APP_IDS },
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
