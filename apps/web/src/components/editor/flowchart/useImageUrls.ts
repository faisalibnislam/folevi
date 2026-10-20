"use client";

// Addresses for the images in a chart's shapes: signed file addresses from the account (renewed every half
// hour), or the local library's own addresses in local mode (files.urls answers there too). Until an
// address arrives, and for a file that has gone, the shape shows its placeholder.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { flowchartFileIds, type FlowchartData } from "./schema";

const RENEW = 30 * 60_000;

function useNow(bucketMs: number): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / bucketMs) * bucketMs);
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / bucketMs) * bucketMs), bucketMs);
    return () => clearInterval(id);
  }, [bucketMs]);
  return now;
}

/** File id to address for every image the chart shows (stable while the answer is the same). */
export function useFlowImageUrls(fc: FlowchartData): Readonly<Record<string, string>> {
  const key = flowchartFileIds(fc).sort().join(",");
  const fileIds = useMemo(() => (key ? key.split(",") : []), [key]);
  const now = useNow(RENEW);
  const files = useQuery(api.files.urls, fileIds.length ? { fileIds, now } : "skip");
  // A renewal starts out unanswered: the last addresses stay until it answers, so images don't flash.
  const last = useRef<Record<string, string>>({});
  return useMemo(() => {
    if (!fileIds.length) return (last.current = {});
    if (!files) return last.current;
    const next = Object.fromEntries(Object.entries(files).map(([id, f]) => [id, f.url]));
    const prev = last.current;
    const same = Object.keys(next).length === Object.keys(prev).length && Object.entries(next).every(([id, url]) => prev[id] === url);
    return same ? prev : (last.current = next);
  }, [files, fileIds]);
}
