"use client";

// The server's clock, as seen from this device, for the sticky notes workshop timer: a timer starts at a
// server time and every viewer counts down from server time, so a phone whose clock is a minute out still
// shows what everyone else sees. Once per session (and kept in sessionStorage across reloads) the device asks
// the server for its time (convex/clock.ts `now`), times the round trip and takes the server's answer as the
// middle of it. Until then, or when it can't ask (offline, the demo, signed out), the device clock is used.
import { useConvex } from "convex/react";
import { useEffect } from "react";
import { api } from "@/lib/convex/api";

const KEY = "folevi:server-clock";
/** A round trip slower than this says too little about when the server answered: try again next session. */
const MAX_TRIP_MS = 4000;

let offset: number | null = null;
let asking: Promise<void> | null = null;

function stored(): number | null {
  try {
    const n = Number(sessionStorage.getItem(KEY));
    return sessionStorage.getItem(KEY) !== null && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** How far the server's clock is ahead of this device's (ms; 0 until it's known). */
export function serverOffset(): number {
  if (offset === null) offset = stored();
  return offset ?? 0;
}

/** The server's time now, as best this device knows it (epoch ms). */
export const serverNow = () => Date.now() + serverOffset();

/** Works out the offset from one round trip: `sent` and `got` on the device's clock, `server` in between. */
export function offsetFrom(sent: number, server: number, got: number): number | null {
  const trip = got - sent;
  if (!Number.isFinite(server) || trip < 0 || trip > MAX_TRIP_MS) return null;
  return Math.round(server - (sent + got) / 2);
}

/** For tests: forget what's known. */
export function resetServerClock() {
  offset = null;
  asking = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* no storage */
  }
}

/** Asks the server for its time once per session (a no-op once known or while asking). */
export function useServerClock(enabled: boolean) {
  const convex = useConvex();
  useEffect(() => {
    if (!enabled || asking) return;
    serverOffset();
    if (offset !== null) return;
    asking = (async () => {
      try {
        const sent = Date.now();
        const server = await convex.mutation(api.clock.now, {});
        const next = offsetFrom(sent, server, Date.now());
        if (next === null) return;
        offset = next;
        try {
          sessionStorage.setItem(KEY, String(next));
        } catch {
          /* no storage: asked again after a reload */
        }
      } catch {
        // Offline or signed out: the device's clock for now; a board opened later asks again.
        asking = null;
      }
    })();
  }, [convex, enabled]);
}
