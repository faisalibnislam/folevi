"use client";

// Linking a shape to a Folevi page: search the pages (recent ones before anything is typed), pick one, and
// the shape shows a link badge that opens it. Works in an account and in local mode (both answer the same
// queries); the site's demo note has no pages to link to.
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { ExternalLink, FileText, Search, Unlink } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { FlowPanel } from "./FlowPanel";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function PageLinkPicker({
  current,
  documentId,
  onPick,
  onRemove,
  onOpen,
  onClose,
}: {
  /** The shape's link, when it has one. */
  current: { documentId: string; title?: string } | null;
  /** The note this flowchart is in (not offered). */
  documentId: string | undefined;
  onPick: (page: { documentId: string; title: string }) => void;
  onRemove: () => void;
  onOpen: (documentId: string) => void;
  onClose: () => void;
}) {
  const { scope } = useAppState();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 120);
  const found = useQuery(api.search.documents, debounced ? { scope, query: debounced, limit: 8 } : "skip");
  const recent = useQuery(api.documents.recent, debounced ? "skip" : { scope, limit: 8 });
  const docs = ((debounced ? found : recent) ?? []).filter((d) => d.id !== documentId);
  const loading = (debounced ? found : recent) === undefined;
  return (
    <FlowPanel title="Link to a page" onClose={onClose} className="fc-panel-link">
      {current ? (
        <div className="fc-link-current">
          <FileText size={14} aria-hidden />
          <span className="fc-link-title">{current.title || "Untitled"}</span>
          <button type="button" className="fc-btn" aria-label="Open the linked page" title="Open page" onClick={() => onOpen(current.documentId)}>
            <ExternalLink size={14} aria-hidden />
          </button>
          <button type="button" className="fc-btn" aria-label="Remove the link" title="Remove link" onClick={onRemove}>
            <Unlink size={14} aria-hidden />
          </button>
        </div>
      ) : null}
      <label className="fc-panel-search">
        <Search size={14} aria-hidden />
        <input
          data-autofocus
          className="fc-input"
          type="text"
          role="searchbox"
          aria-label="Search pages"
          placeholder="Search pages"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && docs[0] && debounced === query.trim()) {
              e.preventDefault();
              onPick({ documentId: docs[0].id, title: docs[0].title || "Untitled" });
            }
          }}
        />
      </label>
      <div className="fc-panel-scroll">
        <h4 className="fc-panel-heading">{debounced ? "Pages" : "Recent"}</h4>
        {docs.length ? (
          <ul className="fc-page-list" aria-label={debounced ? "Matching pages" : "Recent pages"}>
            {docs.map((d) => (
              <li key={d.id}>
                <button type="button" className="fc-page-item" aria-pressed={current?.documentId === d.id} onClick={() => onPick({ documentId: d.id, title: d.title || "Untitled" })}>
                  <FileText size={14} aria-hidden />
                  <span>{d.title || "Untitled"}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="fc-panel-empty">{loading ? "Looking…" : debounced ? "No page matches." : "Pages you open show here."}</p>
        )}
      </div>
    </FlowPanel>
  );
}
