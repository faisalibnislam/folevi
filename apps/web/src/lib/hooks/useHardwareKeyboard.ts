"use client";
// Whether this device has a keyboard to use shortcuts with: a computer (a fine pointer), or a touch screen
// (an iPad, a phone) once a key a software keyboard doesn't send is pressed (arrows, Tab, Escape: a keyboard
// case or a Bluetooth keyboard). Keyboard hints ("Arrow keys move between days", "⌘K") show only then.
import { useEffect, useState } from "react";

const HARDWARE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Escape", "PageUp", "PageDown", "Home", "End"]);
let seen = false;
const listeners = new Set<() => void>();

function computer(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(any-pointer: fine)").matches;
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (e) => {
      if (seen || !HARDWARE_KEYS.has(e.key)) return;
      seen = true;
      for (const l of listeners) l();
    },
    true,
  );
}

export function useHardwareKeyboard(): boolean {
  const [has, setHas] = useState(() => seen || computer());
  useEffect(() => {
    if (has) return;
    const on = () => setHas(true);
    listeners.add(on);
    if (seen || computer()) on();
    return () => void listeners.delete(on);
  }, [has]);
  return has;
}
