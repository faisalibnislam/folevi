// What a scanned QR code says about a Folevi server ("Your own server", components/server/OwnServerSignIn.tsx). A
// server's Connect page shows its address as a QR code (ConnectApps.tsx); an invite's link is `<origin>/join/<token>`.
// Either way the address is what the sign-in screen needs: it then goes through checkServerAddress and the
// server's own /.well-known/folevi.json like a typed one, and the app checks it again (places.addServerPlace).

export type ServerCode = { address: string; invite: string | null };

/** The server address in a QR code's text (a link on the server, or a bare address), or null when it has none. */
export function readServerCode(text: string): ServerCode | null {
  const raw = text.trim();
  if (!raw || raw.length > 2048 || /\s/.test(raw)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    const join = /^\/join\/([A-Za-z0-9_-]{8,256})\/?$/.exec(url.pathname);
    return { address: url.origin, invite: join?.[1] ?? null };
  }
  // A bare address ("notes.example.com", "192.168.1.20:8460"): no path, query or user name.
  if (/[/?#@]/.test(raw)) return null;
  return { address: raw, invite: null };
}
