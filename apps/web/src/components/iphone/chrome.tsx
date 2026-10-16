"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * What the iPhone app's floating chrome needs to know: whether the on-screen keyboard is up, and which
 * screens want the tab bar out of the way (a note being edited, Select mode with its own bar).
 */
interface IphoneChrome {
  keyboard: boolean;
  /** Hides the tab bar while `key` asks for it (several screens can ask at once). */
  hideTabBar: (key: string, hidden: boolean) => void;
  tabBarHidden: boolean;
}

const Ctx = createContext<IphoneChrome | null>(null);

/** Whether something that raises the keyboard has focus (a field, the editor). */
function editableFocused(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) return !el.readOnly && !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color"].includes(el.type);
  return false;
}

/**
 * The keyboard: Capacitor's Keyboard plugin tells the page when it shows and hides (window events); focus on
 * a text field is the same signal a moment earlier, and the only one in a browser (the e2e tests).
 */
function useKeyboardOpen(): boolean {
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState<boolean | null>(null);
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setFocused(editableFocused()));
    };
    const show = () => setShown(true);
    const hide = () => setShown(false);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    window.addEventListener("keyboardWillShow", show);
    window.addEventListener("keyboardWillHide", hide);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
      window.removeEventListener("keyboardWillShow", show);
      window.removeEventListener("keyboardWillHide", hide);
    };
  }, []);
  // A hardware keyboard keeps the on-screen one away: the plugin says hidden while a field has focus.
  return focused && shown !== false;
}

export function IphoneChromeProvider({ children }: { children: ReactNode }) {
  const keyboard = useKeyboardOpen();
  const [hiders, setHiders] = useState<ReadonlySet<string>>(() => new Set());
  const hideTabBar = useCallback((key: string, hidden: boolean) => {
    setHiders((prev) => {
      if (prev.has(key) === hidden) return prev;
      const next = new Set(prev);
      if (hidden) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  // A field with focus: the bars step aside for the keyboard (and CSS knows, for toasts).
  useEffect(() => {
    const root = document.documentElement;
    if (keyboard) root.dataset.iphoneKeyboard = "";
    else delete root.dataset.iphoneKeyboard;
    return () => {
      delete root.dataset.iphoneKeyboard;
    };
  }, [keyboard]);
  const value = useMemo(() => ({ keyboard, hideTabBar, tabBarHidden: hiders.size > 0 }), [keyboard, hideTabBar, hiders]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIphoneChrome(): IphoneChrome {
  const ctx = useContext(Ctx);
  if (!ctx) return { keyboard: false, hideTabBar: () => undefined, tabBarHidden: false };
  return ctx;
}

/** Keeps the tab bar hidden while `hidden` (and while the component is on screen). */
export function useHideTabBar(key: string, hidden: boolean) {
  const { hideTabBar } = useIphoneChrome();
  useEffect(() => {
    hideTabBar(key, hidden);
    return () => hideTabBar(key, false);
  }, [key, hidden, hideTabBar]);
}

/** Asks the current screen to scroll back to its top (tapping the tab you're on, as on iOS). */
export const SCROLL_TOP_EVENT = "folevi:iphone-scroll-top";
