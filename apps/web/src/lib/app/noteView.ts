// The note page's code (the editor and everything around it), loaded on its own so other screens open
// without it. One promise for the whole app: RouteView renders from it, and creating a note waits on it.
type NoteViewModule = typeof import("@/components/doc/DocumentView");

let loading: Promise<NoteViewModule> | null = null;
let loaded: NoteViewModule | null = null;

export function loadDocumentView(): Promise<NoteViewModule> {
  loading ??= import("@/components/doc/DocumentView").then(
    (m) => (loaded = m),
    (e: unknown) => {
      // A failed download (offline, a new deploy) may succeed on the next try.
      loading = null;
      throw e;
    },
  );
  return loading;
}

/**
 * The note view, once its code is here. Rendering it directly (rather than through React.lazy, which
 * shows its placeholder for a frame even when the code has arrived) puts the caret in a new note at once.
 */
export function loadedDocumentView(): NoteViewModule["DocumentView"] | null {
  return loaded?.DocumentView ?? null;
}
