// Folevi's MCP endpoint (https://app.folevi.com/mcp) as the clipper uses it: JSON-RPC over HTTP with the
// access token. It says hello once (initialize, protocol 2025-06-18), then calls two tools: list_places
// (for the place picker) and create_note with inInbox, which files the clip under the Inbox page. Each
// call has its own random id, so clipping the same page twice makes two notes, while a retried request
// (same id) can't make a second one.
import { CLIPPER_VERSION } from "../config";
import type { Session } from "./session";

export const PROTOCOL_VERSION = "2025-06-18";

export interface Place {
  id: string;
  name: string;
}

export interface CreatedNote {
  noteId: string;
  title: string;
  place: string;
  url: string;
}

export class McpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpError";
  }
}

type RpcResponse = { result?: Record<string, unknown>; error?: { message?: string } };

export class FoleviMcp {
  private initialized = false;

  constructor(
    private readonly session: Session,
    private readonly origin: string,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  private async rpc(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (method !== "initialize") headers["mcp-protocol-version"] = PROTOCOL_VERSION;
    let res: Response;
    try {
      res = await this.session.fetch(`${this.origin}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: this.newId(), method, params }) });
    } catch (e) {
      if (e instanceof TypeError) throw new McpError("Couldn't reach Folevi. Check your connection and try again.");
      throw e;
    }
    const body = (await res.json().catch(() => ({}))) as RpcResponse;
    if (res.status === 403) throw new McpError(body.error?.message ?? "This connection isn't allowed to do that. Sign out and sign in again.");
    if (!res.ok) throw new McpError(body.error?.message ?? `Folevi answered with an error (${res.status}). Try again in a moment.`);
    if (body.error) throw new McpError(body.error.message ?? "Folevi couldn't do that.");
    return body.result ?? {};
  }

  private async hello(): Promise<void> {
    if (this.initialized) return;
    await this.rpc("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "folevi-web-clipper", version: CLIPPER_VERSION } });
    this.initialized = true;
  }

  /** A tool's structured answer; a tool error (isError) becomes an McpError with Folevi's message. */
  async callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.hello();
    const result = await this.rpc("tools/call", { name, arguments: args });
    if (result.isError === true) {
      const text = (result.content as { text?: string }[] | undefined)?.[0]?.text;
      throw new McpError(text ?? "Folevi couldn't do that.");
    }
    return (result.structuredContent as Record<string, unknown> | undefined) ?? {};
  }

  async listPlaces(): Promise<Place[]> {
    const out = await this.callTool("list_places", {});
    const places = Array.isArray(out.places) ? (out.places as Place[]) : [];
    return places.filter((p) => typeof p?.id === "string" && typeof p?.name === "string");
  }

  async createNote(note: { title: string; markdown: string; place?: string }): Promise<CreatedNote> {
    const out = await this.callTool("create_note", { title: note.title, markdown: note.markdown, inInbox: true, ...(note.place ? { place: note.place } : {}) });
    if (typeof out.noteId !== "string" || typeof out.url !== "string") throw new McpError("Folevi saved the note but didn't say where. Look in your Inbox.");
    return { noteId: out.noteId, title: String(out.title ?? note.title), place: String(out.place ?? ""), url: out.url };
  }
}
