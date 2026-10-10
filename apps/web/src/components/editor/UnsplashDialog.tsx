"use client";

import { useAction } from "convex/react";
import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import type { UnsplashPhoto } from "../../../../../convex/unsplash";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unconfigured" }
  | { kind: "error"; message: string }
  | { kind: "results"; query: string; photos: UnsplashPhoto[]; page: number; totalPages: number };

/**
 * Image from Unsplash: search, pick, and the photo is inserted hotlinked with a credit caption. The
 * search runs on the Folevi server (the access key never reaches the browser).
 */
export function UnsplashDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (photo: UnsplashPhoto) => void }) {
  const search = useAction(api.unsplash.search);
  const track = useAction(api.unsplash.trackDownload);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const formId = useId();
  const seq = useRef(0);

  const run = async (q: string, page = 1) => {
    const mine = ++seq.current;
    if (page === 1) setState({ kind: "loading" });
    try {
      const r = await search({ query: q, page });
      if (mine !== seq.current) return;
      if (!r.configured) {
        setState({ kind: "unconfigured" });
        return;
      }
      setState((prev) =>
        page > 1 && prev.kind === "results"
          ? { ...prev, photos: [...prev.photos, ...r.photos], page, totalPages: r.totalPages }
          : { kind: "results", query: q, photos: r.photos, page, totalPages: r.totalPages },
      );
    } catch (e) {
      if (mine === seq.current) setState({ kind: "error", message: errorMessage(e) });
    }
  };

  useEffect(() => {
    if (!open) return;
    setQuery("");
    void run("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (photo: UnsplashPhoto) => {
    // Unsplash asks apps to report each use of a photo; failures don't block inserting it.
    void track({ photoId: photo.id }).catch(() => undefined);
    onPick(photo);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Image from Unsplash" description="Free photos from Unsplash, credited to the photographer." size="lg">
      {state.kind === "unconfigured" ? (
        <div className="rounded-chip bg-sunken px-4 py-5 text-sm" role="status">
          <p className="font-medium text-heading">Unsplash isn’t set up for this Folevi server yet</p>
          <p className="mt-1 text-muted">An administrator can turn it on by adding an Unsplash access key (UNSPLASH_ACCESS_KEY) to the server’s settings.</p>
        </div>
      ) : (
        <>
          <form
            id={formId}
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              void run(query.trim());
            }}
            className="flex gap-2"
          >
            <label className="ui-well flex h-10 min-w-0 flex-1 items-center gap-2 rounded-chip px-3.5 text-sm text-muted focus-within:shadow-[0_0_0_2px_var(--color-focus)]">
              <Search size={15} aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search photos"
                aria-label="Search Unsplash photos"
                className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-[var(--color-ink-faint)]"
              />
            </label>
            <Button type="submit" variant="primary">
              Search
            </Button>
          </form>
          <div className="mt-4 min-h-[12rem]" aria-live="polite">
            {state.kind === "loading" ? <p className="py-10 text-center text-sm text-muted">Searching…</p> : null}
            {state.kind === "error" ? (
              <p className="py-10 text-center text-sm text-danger" role="alert">
                {state.message}
              </p>
            ) : null}
            {state.kind === "results" && !state.photos.length ? <p className="py-10 text-center text-sm text-muted">No photos found for “{state.query}”.</p> : null}
            {state.kind === "results" && state.photos.length ? (
              <>
                <p className="sr-only">{state.photos.length} photos</p>
                <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" aria-label="Photos">
                  {state.photos.map((p) => (
                    <li key={p.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => choose(p)}
                        className="group block w-full overflow-hidden rounded-chip outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"
                        style={{ background: p.color ?? "var(--color-surface-sunken)", aspectRatio: "3 / 2" }}
                        aria-label={`Insert photo by ${p.photographer}${p.alt ? `: ${p.alt}` : ""}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
                      </button>
                      <p className="mt-1 truncate text-[11.5px] text-muted">
                        <a href={p.photographerUrl} target="_blank" rel="noopener noreferrer" className="hover:text-ink hover:underline">
                          {p.photographer}
                        </a>
                      </p>
                    </li>
                  ))}
                </ul>
                {state.page < state.totalPages ? (
                  <div className="mt-3 text-center">
                    <Button variant="quiet" onClick={() => void run(state.query, state.page + 1)}>
                      More photos
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          <p className="mt-3 text-[11.5px] text-muted">
            Photos from{" "}
            <a href="https://unsplash.com/?utm_source=folevi&utm_medium=referral" target="_blank" rel="noopener noreferrer" className="underline">
              Unsplash
            </a>
            . Inserted photos are credited in their caption.
          </p>
        </>
      )}
    </Dialog>
  );
}

/** Caption crediting an Unsplash photo, per the Unsplash guidelines. */
export function unsplashCredit(photo: Pick<UnsplashPhoto, "photographer">): string {
  return `Photo by ${photo.photographer} on Unsplash`;
}
