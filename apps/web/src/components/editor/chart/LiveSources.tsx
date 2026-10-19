"use client";

// Live chart sources. A table in the same note: the chart reads it whenever the note changes and keeps its
// own copy of the rows up to date. A collection: the chart subscribes to it and keeps its grouped rows up to
// date. Copies are written without an undo step (undoing the table's edit undoes the chart's too), and only
// by people who can edit the note. The rows saved with the chart are what share pages and exports show.
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import type { Editor } from "@tiptap/react";
import type { ChartSource } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { aggregateCollection, tableBlockRows, type ChartRows, type CollectionLike } from "./sources";

/** A table in the note: its attributes, and its place among the note's tables ("Table 2"), or null when it's gone. */
export function findTable(editor: Editor, blockId: string): { attrs: Record<string, unknown>; n: number } | null {
  let found: { attrs: Record<string, unknown>; n: number } | null = null;
  let n = 0;
  editor.state.doc.forEach((node) => {
    if (found || node.type.name !== "table") return;
    n++;
    if (node.attrs.id === blockId) found = { attrs: node.attrs, n };
  });
  return found;
}

/**
 * Follows a table block in the note: `onRows` hears its rows now and after every change (a short pause
 * after typing), `missing` says when it's gone.
 */
export function useTableSource(editor: Editor, source: ChartSource | null, onRows: (rows: ChartRows) => void): { missing: boolean; n: number } {
  const blockId = source?.type === "table" ? source.blockId : null;
  const [state, setState] = useState({ missing: false, n: 0 });
  const onRowsRef = useRef(onRows);
  useEffect(() => {
    onRowsRef.current = onRows;
  });
  useEffect(() => {
    if (!blockId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: unknown = undefined;
    const read = () => {
      timer = null;
      if (editor.isDestroyed) return;
      const t = findTable(editor, blockId);
      setState((s) => (s.missing === !t && s.n === (t?.n ?? 0) ? s : { missing: !t, n: t?.n ?? 0 }));
      if (!t || t.attrs === last) return;
      last = t.attrs;
      onRowsRef.current(tableBlockRows(t.attrs));
    };
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, 250);
    };
    read();
    editor.on("update", soon);
    return () => {
      editor.off("update", soon);
      if (timer) clearTimeout(timer);
    };
  }, [editor, blockId]);
  return blockId ? state : { missing: false, n: 0 };
}

class Boundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onError();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function CollectionReader({ source, onRows }: { source: Extract<ChartSource, { type: "collection" }>; onRows: (rows: ChartRows) => void }) {
  const data = useQuery(api.collections.get, { collectionId: source.collectionId }) as CollectionLike | undefined;
  const onRowsRef = useRef(onRows);
  useEffect(() => {
    onRowsRef.current = onRows;
  });
  useEffect(() => {
    if (data) onRowsRef.current(aggregateCollection(data, source.groupBy, source.aggregate, source.field));
  }, [data, source.groupBy, source.aggregate, source.field]);
  return null;
}

/**
 * Follows a collection (renders nothing): `onRows` hears its grouped rows whenever it changes, `onMissing`
 * when it can't be read (deleted, or no longer shared with this person).
 */
export function CollectionFeed({ source, onRows, onMissing }: { source: ChartSource | null; onRows: (rows: ChartRows) => void; onMissing: () => void }) {
  if (source?.type !== "collection") return null;
  return (
    <Boundary key={source.collectionId} onError={onMissing}>
      <CollectionReader source={source} onRows={onRows} />
    </Boundary>
  );
}
