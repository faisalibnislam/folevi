// A fake model host for local Foli AI tests: the shape the Mac app's bridge has (shell().ai and shell().secrets),
// answering each request with what `answer` says and recording every request, so tests can check that the
// prompts are the shared builders' and that replies go through the shared checks.
import type { AiCaps, AiRequest, AiResult, SecretName, ShellAi, ShellSecrets } from "@/lib/shell/types";

export type Answer = string | { text: string; stopReason?: AiResult["stopReason"]; errorCode?: AiResult["errorCode"]; error?: string; chunks?: number; hold?: Promise<void> };

export interface FakeHost {
  ai: ShellAi;
  secrets: ShellSecrets;
  requests: AiRequest[];
  /** Set what the next requests answer (by request). */
  answer: (fn: (req: AiRequest) => Answer) => void;
  caps: AiCaps;
  /** The values stored (the test's view only: the page never gets them back). */
  stored: Map<SecretName, string>;
  cancelled: number;
}

export function fakeHost(opts: { onDevice?: boolean; keys?: SecretName[]; context?: number } = {}): FakeHost {
  const stored = new Map<SecretName, string>((opts.keys ?? []).map((k) => [k, `sk-test-${k}-0123456789abcdef`]));
  const requests: AiRequest[] = [];
  let respond: (req: AiRequest) => Answer = () => "ok";
  const host: FakeHost = {
    requests,
    stored,
    cancelled: 0,
    caps: { onDevice: opts.onDevice ?? false, onDeviceStatus: opts.onDevice ? "available" : "notEnabled", onDeviceContext: opts.context ?? 4096, keys: {} },
    answer: (fn) => {
      respond = fn;
    },
    secrets: {
      has: async (name) => stored.has(name),
      set: async (name, value) => void stored.set(name, value),
      delete: async (name) => void stored.delete(name),
    },
    ai: {
      capabilities: async () => ({ ...host.caps, keys: { "ai.openai": stored.has("ai.openai"), "ai.anthropic": stored.has("ai.anthropic"), "ai.google": stored.has("ai.google") } }),
      testKey: async (provider) => (stored.has(`ai.${provider}` as SecretName) ? { ok: true } : { ok: false, error: "No key." }),
      generate: (req, onChunk) => {
        requests.push(structuredClone(req));
        let cancel = false;
        let release: (() => void) | null = null;
        const done = (async (): Promise<AiResult> => {
          const a = respond(req);
          const spec = typeof a === "string" ? { text: a } : a;
          if (spec.stopReason === "error") return { text: "", stopReason: "error", errorCode: spec.errorCode, error: spec.error };
          const parts = Math.max(1, spec.chunks ?? 3);
          const size = Math.ceil(spec.text.length / parts) || 1;
          let sent = "";
          for (let i = 0; i < spec.text.length; i += size) {
            if (cancel) return { text: sent, stopReason: "cancelled" };
            const piece = spec.text.slice(i, i + size);
            sent += piece;
            onChunk(piece);
            await Promise.resolve();
            if (spec.hold && i === 0) {
              await Promise.race([spec.hold, new Promise<void>((r) => (release = r))]);
            }
          }
          if (cancel) return { text: sent, stopReason: "cancelled" };
          return { text: spec.text, stopReason: spec.stopReason ?? "end" };
        })();
        return {
          done,
          cancel: () => {
            cancel = true;
            host.cancelled++;
            release?.();
          },
        };
      },
    },
  };
  return host;
}
