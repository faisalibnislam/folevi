"use client";
// Inside a floating note's window (components/app/FloatNote.tsx, lib/app/float.ts): the note page draws only its
// title and text, and the window's slim bar is told the note's name.
import { createContext, useContext } from "react";

export interface FloatingValue {
  id: string;
  /** The note's name as the page shows it (the bar and the window take it). */
  onTitle: (title: string) => void;
}

export const FloatingContext = createContext<FloatingValue | null>(null);

/** The floating note's window this page is in, or null in every other window. */
export function useFloating(): FloatingValue | null {
  return useContext(FloatingContext);
}
