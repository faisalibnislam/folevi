"use client";

// Hands the server edition's runtime addresses to the browser (lib/runtime/config.ts). The root layout renders it
// with the values read from the environment on this request; it writes them into a JSON script tag (inert data,
// so the content policy needs no nonce or hash for it) and keeps them for runtimeConfig() before anything below
// it renders. Folevi Cloud doesn't render it: its addresses are inlined at build time.
import { createContext, useContext, type ReactNode } from "react";
import { RUNTIME_CONFIG_ELEMENT_ID, serializeRuntimeConfig, setBrowserRuntimeConfig, type RuntimeConfig } from "@/lib/runtime/config";

const RuntimeConfigContext = createContext<RuntimeConfig | null>(null);

/** The runtime addresses and server features, or null in Folevi Cloud. */
export function useRuntimeConfig(): RuntimeConfig | null {
  return useContext(RuntimeConfigContext);
}

export function RuntimeConfigProvider({ value, children }: { value: RuntimeConfig; children: ReactNode }) {
  if (typeof window !== "undefined") setBrowserRuntimeConfig(value);
  return (
    <RuntimeConfigContext.Provider value={value}>
      <script id={RUNTIME_CONFIG_ELEMENT_ID} type="application/json" dangerouslySetInnerHTML={{ __html: serializeRuntimeConfig(value) }} />
      {children}
    </RuntimeConfigContext.Provider>
  );
}
