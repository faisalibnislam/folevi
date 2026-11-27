"use client";

// A Foli AI action that runs on the person's own key when they turned one on (Settings, Foli AI, Your own AI
// key; lib/ai/ownKey.ts): the key, provider and model go with the request, and the server uses them for that
// request only. Without one, the action runs as before, on credits.
import { useCallback, useSyncExternalStore } from "react";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { onOwnKeyChange, ownKeyArgs, ownKeyChoice, type OwnKeyChoice } from "@/lib/ai/ownKey";

export function useAiAction<F extends FunctionReference<"action">>(ref: F): (args: Omit<FunctionArgs<F>, "ownKey">) => Promise<FunctionReturnType<F>> {
  const run = useAction(ref);
  return useCallback(async (args: Omit<FunctionArgs<F>, "ownKey">) => await run({ ...args, ...(await ownKeyArgs()) } as FunctionArgs<F>), [run]);
}

/** The own-key choice on this device (null: Foli AI uses credits), kept current as Settings changes it. */
export function useOwnKeyChoice(): OwnKeyChoice | null {
  const raw = useSyncExternalStore(
    onOwnKeyChange,
    () => JSON.stringify(ownKeyChoice()),
    () => "null",
  );
  return JSON.parse(raw) as OwnKeyChoice | null;
}
