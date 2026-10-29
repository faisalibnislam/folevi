import { useState } from "react";

/**
 * Whether a dialog has been opened yet: false until it first opens, true from then on. Rows that each carry their
 * own dialogs (a note card's Move and Delete, a folder's Rename) draw them once one opens and keep them after, so
 * a list doesn't mount a closed dialog per row; opening, closing and opening again behave exactly as before.
 */
export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open;
}
