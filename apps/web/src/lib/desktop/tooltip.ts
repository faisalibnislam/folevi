// One tooltip everywhere in Folevi, the website and the app in a browser as well as Folevi for Mac (docs/MAC_POLISH_PLAN.md
// §2.4, §3.7; never the browser's own, the owner's rule): what a control's `title` says,
// drawn by the page in Folevi's type after 700 ms of the pointer resting on it, at once while another has just
// shown (until a second passes with none), with a shortcut written in it ("New note (⌘⌥N)") in a keycap. The
// browser's own tooltip is held back while the page's shows (the title comes back as the pointer leaves), so
// Electron and WebKit show the same thing. Never for touch, never while a button is held or a menu is open.

const REST_MS = 700;
const WARM_MS = 1000;
const SHORTCUT = /^(.*?)\s*\(((?:[⌘⌃⌥⇧]+)[^\s()]+|[⌘⌃⌥⇧]*(?:Tab|Space|Return|Enter|Esc|F\d+))\)$/;

/** "New note (⌘⌥N)" as its words and its shortcut. */
export function splitTooltip(text: string): { text: string; shortcut: string | null } {
  const m = SHORTCUT.exec(text.trim());
  return m ? { text: m[1]!, shortcut: m[2]! } : { text: text.trim(), shortcut: null };
}

const plain = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/** Whether the control already shows the tooltip's words (its visible text holds them). */
function alreadyShown(el: HTMLElement, words: string): boolean {
  const seen = plain(el.innerText || "");
  const said = plain(words);
  return Boolean(seen && said && seen.includes(said));
}

/** Whether the control's text is cut off (it, or a part of it, is narrower than its text). */
function cutOff(el: HTMLElement): boolean {
  return [el, ...el.querySelectorAll<HTMLElement>("*")].some((x) => x.scrollWidth > x.clientWidth + 1 && (x.innerText || "").trim() !== "");
}

let installs = 0;
let uninstall: (() => void) | null = null;

/** Turns Folevi's tooltip on for the page (several callers may: it's installed once, and removed with the last). */
export function installMacTooltips(): () => void {
  installs += 1;
  if (installs === 1) uninstall = install();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    installs -= 1;
    if (installs === 0) {
      uninstall?.();
      uninstall = null;
    }
  };
}

function install(): () => void {
  let tip: HTMLDivElement | null = null;
  let owner: HTMLElement | null = null;
  let timer = 0;
  let lastHidden = 0;
  let pressed = false;

  const restore = () => {
    if (owner && owner.hasAttribute("data-mac-title")) {
      // (Unless the page changed it meanwhile.)
      if (!owner.hasAttribute("title")) owner.setAttribute("title", owner.getAttribute("data-mac-title") ?? "");
      owner.removeAttribute("data-mac-title");
    }
  };
  const hide = () => {
    window.clearTimeout(timer);
    if (tip) {
      tip.remove();
      tip = null;
      lastHidden = Date.now();
    }
    restore();
    owner = null;
  };
  const show = () => {
    if (!owner || !owner.isConnected || pressed || document.querySelector('[role="menu"]:popover-open, dialog[open] [role="menu"]')) return;
    const words = owner.getAttribute("data-mac-title") ?? "";
    if (!words.trim()) return;
    const split = splitTooltip(words);
    const { shortcut } = split;
    let text = split.text;
    // No tooltip that repeats what the control already shows (the owner's call): a name that fits shows nothing,
    // a cut-off one shows in full, and a labelled button with a shortcut shows the shortcut alone.
    if (alreadyShown(owner, text)) {
      if (cutOff(owner)) {
        /* the full name */
      } else if (shortcut) text = "";
      else return;
    }
    const el = document.createElement("div");
    el.setAttribute("role", "tooltip");
    el.setAttribute("data-mac-tooltip", "");
    el.setAttribute("popover", "manual");
    el.textContent = text;
    if (shortcut) {
      const kbd = document.createElement("kbd");
      kbd.className = "ui-kbd";
      kbd.textContent = shortcut;
      if (text) el.append(" ");
      else el.setAttribute("data-shortcut-only", "");
      el.append(kbd);
    }
    document.body.appendChild(el);
    try {
      el.showPopover();
    } catch {
      /* no Popover API: it's fixed in place */
    }
    // Under the control, or above it when there's no room; never off the window's edges.
    const r = owner.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = r.bottom + 6 + h <= window.innerHeight - 4;
    const left = Math.min(Math.max(4, r.left + r.width / 2 - w / 2), window.innerWidth - w - 4);
    el.style.left = `${left}px`;
    el.style.top = `${below ? r.bottom + 6 : Math.max(4, r.top - 6 - h)}px`;
    tip = el;
  };

  const over = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>("[title], [data-mac-title]") : null;
    if (target === owner) return;
    hide();
    // Every title shows as Folevi's tooltip (a link's address in a note, a field's hint too): never the browser's.
    // Only the frames of embeds keep their own.
    if (!target || target.closest("iframe")) return;
    owner = target;
    const words = target.getAttribute("title");
    if (words === null) return;
    target.setAttribute("data-mac-title", words);
    target.removeAttribute("title");
    timer = window.setTimeout(show, Date.now() - lastHidden < WARM_MS ? 0 : REST_MS);
  };
  const out = (e: PointerEvent) => {
    if (!owner) return;
    const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (to && owner.contains(to)) return;
    hide();
  };
  const down = () => {
    pressed = true;
    hide();
  };
  const up = () => {
    pressed = false;
  };

  document.addEventListener("pointerover", over, true);
  document.addEventListener("pointerout", out, true);
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("keydown", hide, true);
  document.addEventListener("wheel", hide, { capture: true, passive: true });
  window.addEventListener("blur", hide);
  return () => {
    hide();
    document.removeEventListener("pointerover", over, true);
    document.removeEventListener("pointerout", out, true);
    document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("pointerup", up, true);
    document.removeEventListener("keydown", hide, true);
    document.removeEventListener("wheel", hide, true);
    window.removeEventListener("blur", hide);
  };
}
