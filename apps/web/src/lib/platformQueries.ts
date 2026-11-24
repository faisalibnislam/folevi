// The media queries behind lib/platform.ts, and the same answers as a script for before the first paint
// (lib/theme/bootScript.ts). Plain values, so the server's root layout can inline them.

/** Narrower than this, the sidebar and a note don't both fit: the phone layout. */
export const PHONE_MAX_WIDTH = 699;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;
/** A screen used by touch: its main pointer is a finger and it can't hover (phones, tablets; not a laptop's touch screen). */
export const TOUCH_QUERY = "(pointer: coarse) and (hover: none)";

/** The same answers as a script run before the first paint (bootScript.ts), so CSS has them from the start. */
export const PLATFORM_BOOT_SNIPPET = `var r=document.documentElement,m=function(q){return window.matchMedia&&window.matchMedia(q).matches},n=window.foleviNative&&window.foleviNative.platform,d=r.getAttribute("data-desktop"),t=n==="ios"||n==="android"||r.dataset.native==="ios"||r.dataset.native==="android"||(!d&&m(${JSON.stringify(TOUCH_QUERY)}));r.setAttribute("data-form",m(${JSON.stringify(PHONE_QUERY)})?"phone":t?"tablet":"desktop");if(t)r.setAttribute("data-touch","");`;
