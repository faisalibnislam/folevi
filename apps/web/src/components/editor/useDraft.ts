import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Text that a block's own field (a caption, a table cell, a formula) edits. The field shows a local draft
 * that updates on every keystroke and saves each change to the block. A block view re-renders a moment
 * after its attributes change, so binding the field straight to them would let React reset the value and
 * throw the caret to the end. Changes that arrive from elsewhere (undo, another device) replace the draft.
 */
export function useDraft(value: string, commit: (next: string) => void): [string, (next: string) => void] {
  const [draft, setDraft] = useState(value);
  // Values this field saved itself, so their echo doesn't overwrite newer typing.
  const own = useRef(new Set<string>());
  const latest = useRef(value);
  useEffect(() => {
    if (value === latest.current) {
      own.current.clear();
      return;
    }
    if (own.current.has(value)) return;
    own.current.clear();
    latest.current = value;
    setDraft(value);
  }, [value]);
  const change = useCallback(
    (next: string) => {
      latest.current = next;
      own.current.add(next);
      setDraft(next);
      commit(next);
    },
    [commit],
  );
  return [draft, change];
}
