// Test doubles: an in-memory chrome.storage area and a scripted fetch that records what it was sent.
import type { Store } from "../src/lib/session";

export function memoryStore(initial: Record<string, unknown> = {}): Store & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    get: async (key) => data[key],
    set: async (key, value) => {
      data[key] = value;
    },
    remove: async (key) => {
      delete data[key];
    },
  };
}

export interface Sent {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

/** A fetch that answers each request with the next handler's response (a function of what was sent). */
export function scriptedFetch(...handlers: ((req: Sent) => Response | Promise<Response>)[]) {
  const sent: Sent[] = [];
  const fn = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const req: Sent = { url: String(input), method: init.method ?? "GET", headers: new Headers(init.headers), body: typeof init.body === "string" ? init.body : "" };
    sent.push(req);
    const handler = handlers.shift();
    if (!handler) throw new Error(`unexpected request to ${req.url}`);
    return await handler(req);
  };
  return Object.assign(fn as typeof fetch, { sent });
}

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
