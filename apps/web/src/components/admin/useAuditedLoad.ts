"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestMeta } from "./request";

/**
 * Runs an audited read (a Convex *mutation* such as `admin.viewUser`) once per `key`, passing the
 * request id and client hint recorded in the audit entry. Each call is
 * one audit entry, so the hook deliberately de-duplicates React's development double effects and
 * only re-runs when the key changes or `refresh()` is called (e.g. after an action).
 */
export function useAuditedLoad<T>(key: string | null, run: (meta: { requestId: string; clientHash?: string }) => Promise<T>) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const lastKey = useRef<string | null>(null);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await runRef.current(await requestMeta());
      if (mine === seq.current) setData(result);
    } catch (err) {
      if (mine === seq.current) setError(err);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (key === null || lastKey.current === key) return;
    const keyChanged = lastKey.current !== null;
    lastKey.current = key;
    if (keyChanged) setData(undefined);
    void load();
  }, [key, load]);

  return { data, error, loading, refresh: load };
}
