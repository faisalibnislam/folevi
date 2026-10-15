"use client";

import { useEffect, useState } from "react";

/** The clock to the minute, for queries that judge expiry (a new minute is a new query, not one per render). */
export function useMinute(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 60_000) * 60_000), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
