# Downloads: Vercel's CDN no longer stores /download files

- Date: 2026-11-28 00:30 UTC
- Area: web
- Branch: claude/download-no-cdn-cache

What changed: `apps/web/next.config.ts` sends `CDN-Cache-Control: no-store` for every `/download/*` file (the
versioned Mac files included), so Vercel's CDN passes each request to the R2 bucket and never keeps a copy.
Browsers still cache by `Cache-Control` as before.

Why: while testing the Linux auto-update (1.7.78 to 1.8.78, aarch64 AppImage, in the Lima VM), the update failed
with "Folevi couldn't download the update". Vercel's CDN had cached the answer to one range request (`206`,
bytes 0-99, 100 bytes) for `linux/Folevi_1.8.78_aarch64.AppImage`, whose R2 object is `immutable`, and served
those 100 bytes to every later download of that URL, the updater's included. Any download manager or resumed
download could do the same to any versioned file.

Checked: purged the folevi project's CDN cache (`vercel cache purge --type cdn`) on 2026-11-28; the file then
came back whole (200, 166066696 bytes) and the update completed: the AppImage was replaced with the 1.8.78 file
(SHA-256 `d113aa11...`, as in `SHA256SUMS.txt`) and Folevi restarted as 1.8.78. `appcast.xml`, which already had
`CDN-Cache-Control: no-store`, is a MISS on every request, so the header works on these proxied files.
`tsc --noEmit` passes and `headers()` returns the new rules.

Left: after this deploys, confirm `x-vercel-cache: MISS` on a versioned file twice in a row, including after a
range request.
