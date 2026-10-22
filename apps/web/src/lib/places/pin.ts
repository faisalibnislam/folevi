// Which account this tab is (docs/MULTI_ACCOUNT_PLAN.md §2.1). Every /api/auth request a product page makes
// names it (`x-folevi-account`), and the proxy answers as that account whatever session the browser's active
// cookie holds, so switching in one tab never changes what another tab is signed in as.
//
// Decided once, synchronously, before the first request (the token fetch starts at module load): the
// background runner's URL (/place-sync?place=), else this tab's own pin (sessionStorage), else nothing right
// after "Sign in to another account" (the tab adopts whoever just signed in), else the place this browser opened
// last, else nothing (the active session decides, and the tab pins to it once it's known). A page keeps its pin
// for its whole life: switching reloads it. The sign-in pages never pin.
import { PIN_HEADER } from "@/lib/auth/placesCookies";
import { isShell } from "@/lib/shell";
import { accountPlaceId, lastPlace, userIdOf, type PlaceId } from "./registry";

const TAB_KEY = "folevi:place";
/** Set just before "Sign in to another account": the tab takes whichever account signs in next. */
const ADOPT = "adopt";

/** Pages that sign people in (and the connected-app consent page) use the browser's own session, never a pin. */
const UNPINNED = /^\/(signin|signup|two-factor|verify-email|forgot-password|reset-password|connect|app-google|native|oauth)(\/|$)/;

let pin: string | null | undefined;

function readTab(): string | null {
  try {
    return sessionStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

function writeTab(value: string | null) {
  try {
    if (value) sessionStorage.setItem(TAB_KEY, value);
    else sessionStorage.removeItem(TAB_KEY);
  } catch {
    /* storage unavailable: the pin holds for this page only */
  }
}

/** The tab's pin as decided at load (exported for tests: `resolve` with a fake location and storage). */
export function resolvePin(o: { pathname: string; search: string; tab: string | null; last: PlaceId | null; shell: boolean }): string | null {
  if (o.shell) return null;
  if (o.pathname === "/place-sync") return userIdOf(new URLSearchParams(o.search).get("place"));
  if (UNPINNED.test(o.pathname)) return null;
  if (o.tab === ADOPT) return null;
  if (o.tab) return userIdOf(o.tab);
  return userIdOf(o.last);
}

/** The user id this page's auth requests name, or null (the browser's active session decides). */
export function pinnedUserId(): string | null {
  if (pin === undefined) {
    const tab = typeof window === "undefined" ? null : readTab();
    pin = typeof window === "undefined" ? null : resolvePin({ pathname: location.pathname, search: location.search, tab, last: lastPlace(), shell: isShell() });
    // A tab that took the browser's last place keeps it from now on: another tab switching later doesn't move it.
    if (pin && !tab && !isPlaceRunner()) writeTab(accountPlaceId(pin));
  }
  return pin;
}

/** Whether this page is the hidden runner of another account (/place-sync). */
export function isPlaceRunner(): boolean {
  return typeof window !== "undefined" && location.pathname === "/place-sync";
}

/**
 * An unpinned tab has learned whose session it has: it pins to it (for this tab's later loads too). Never
 * changes a pin this page already has. The runner keeps its URL's.
 */
export function adoptSession(userId: string): void {
  if (pinnedUserId() || isPlaceRunner() || typeof window === "undefined") return;
  if (UNPINNED.test(location.pathname)) return;
  pin = userId;
  writeTab(accountPlaceId(userId));
}

/** Sets this tab's place for its next load (a switch reloads right after). */
export function setTabPlace(place: PlaceId | null): void {
  writeTab(place);
}

/** Before "Sign in to another account": this tab opens whoever signs in next. */
export function adoptNextSignIn(): void {
  writeTab(ADOPT);
}

/** Better Auth's fetch on the website: every request names this tab's account. */
export function pinnedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const user = pinnedUserId();
  if (!user) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set(PIN_HEADER, user);
  return fetch(input, { ...init, headers });
}

/** Tests only. */
export function resetPinForTests(value?: string | null): void {
  pin = value;
}
