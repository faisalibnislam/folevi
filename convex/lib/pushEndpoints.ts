// Which addresses a web push subscription may name (convex/push.ts subscribe, convex/pushSend.ts). A browser's
// subscription says where its notifications are sent: an address at the browser maker's own push service. The
// server POSTs there, so anything else is refused: otherwise a signed-in person could make the server send
// requests to any https address they like (security audit 2026-11-26, L5). Pure, no imports: used by a mutation
// and by a Node action.

/** Hosts by exact name. */
const HOSTS = new Set([
  // Chrome, Edge, Brave, Opera, Vivaldi, Samsung Internet and other Chromium browsers (Firebase Cloud Messaging).
  "fcm.googleapis.com",
  // Chrome's older names for the same service, still handed out to subscriptions made long ago.
  "android.googleapis.com",
  "jmt17.google.com",
  // Firefox.
  "updates.push.services.mozilla.com",
]);

/** Hosts by suffix: every name under these belongs to the service. */
const SUFFIXES = [
  // Safari on the Mac, iPhone and iPad (web.push.apple.com and its regional names).
  ".push.apple.com",
  // Edge on Windows (Windows Notification Service: wns2-by3p.notify.windows.com and the like).
  ".notify.windows.com",
  // Firefox's other names for its push service.
  ".push.services.mozilla.com",
];

/** Whether `endpoint` is an https address, on the standard port, at a browser's push service. */
export function isPushServiceEndpoint(endpoint: string): boolean {
  if (endpoint.length > 2000 || /\s/.test(endpoint)) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return HOSTS.has(host) || SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}
