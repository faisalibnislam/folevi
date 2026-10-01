// The public site (the marketing host) is always light; light and dark are an app setting only.
const SITE_HOST = new URL(process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com").host;

// Applies the saved appearance before first paint to avoid a flash of the wrong theme. Inlined in the
// root layout; its SHA-256 is allowed by the nonce CSP (proxy.ts) because the layout has no nonce.
export const THEME_BOOT_SCRIPT = `(function(){try{if(location.host===${JSON.stringify(SITE_HOST)}){document.documentElement.dataset.theme="light";return;}var t=localStorage.getItem("folevi:appearance");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}else if(window.matchMedia("(prefers-color-scheme: dark)").matches){document.documentElement.dataset.theme="dark";}else{document.documentElement.dataset.theme="light";}}catch(e){}})();`;

let cached: Promise<string> | null = null;
/** `'sha256-…'` source expression for THEME_BOOT_SCRIPT. */
export function themeBootScriptHash(): Promise<string> {
  cached ??= crypto.subtle.digest("SHA-256", new TextEncoder().encode(THEME_BOOT_SCRIPT)).then((buf) => {
    let bin = "";
    for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
    return `'sha256-${btoa(bin)}'`;
  });
  return cached;
}
