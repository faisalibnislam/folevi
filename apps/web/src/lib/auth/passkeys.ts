// Passkeys in the browser (Better Auth's passkey plugin, convex/auth.ts). Signing in with one and adding one
// both need WebAuthn; the Mac app's window only offers it when macOS lets it use this Mac's passkeys. The
// iPhone and iPad app's web view can't until the app is linked to app.folevi.com (Associated Domains, which
// needs Apple's Developer Program; docs/IOS.md), so it doesn't offer them yet.

/**
 * Whether this page can use passkeys. In a browser, WebAuthn is enough (this device, a phone nearby or a
 * security key). The Mac app (`window.foleviDesktop`) has no browser passkey entitlement, so it shows
 * passkeys only if a platform authenticator actually answers.
 */
export async function passkeysAvailable(win: (Window & typeof globalThis) | undefined = typeof window !== "undefined" ? window : undefined): Promise<boolean> {
  if (!win || typeof win.PublicKeyCredential !== "function" || !win.navigator?.credentials) return false;
  if (win.foleviNative) return false;
  if (!win.foleviDesktop) return true;
  try {
    return (await win.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()) === true;
  } catch {
    return false;
  }
}

/** Whether the browser can offer passkeys in the email field's autofill (WebAuthn conditional mediation). */
export async function passkeyAutofillAvailable(win: (Window & typeof globalThis) | undefined = typeof window !== "undefined" ? window : undefined): Promise<boolean> {
  if (!(await passkeysAvailable(win))) return false;
  try {
    return (await win!.PublicKeyCredential.isConditionalMediationAvailable?.()) === true;
  } catch {
    return false;
  }
}

/** A starting name for a new passkey, from the browser and system it's added on: "Chrome on Mac". */
export function defaultPasskeyName(userAgent: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  const ua = userAgent;
  // (Folevi for Mac's WebKit adds FoleviDesktop/ to Safari's words.)
  const browser = /FoleviDesktop\//.test(ua)
    ? "Folevi app"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Passkey";
}
