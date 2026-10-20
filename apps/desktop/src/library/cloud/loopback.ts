// The end of a Dropbox or Google sign-in in the browser: a one-shot HTTP listener on 127.0.0.1 that takes the
// authorization code (RFC 8252 loopback redirect), checks `state`, answers with a short page, and closes.
// It listens on the loopback interface only. Google accepts any port for desktop clients; Dropbox matches
// redirect URIs exactly, so it gets a few fixed ports, each registered in the App Console. Node only.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface RedirectResult {
  code: string;
}

export class SignInCancelled extends Error {
  override name = "SignInCancelled";
}

export interface LoopbackOptions {
  /** Ports to try in order; 0 means any free port. */
  ports: number[];
  /** The state the redirect must carry. */
  state: string;
  /** For the page the browser shows ("Dropbox", "Google Drive"). */
  providerName: string;
  timeoutMs?: number;
}

export interface LoopbackListener {
  /** Exactly what goes in `redirect_uri`. */
  redirectUri: string;
  result: Promise<RedirectResult>;
  close(): void;
}

function page(title: string, body: string): string {
  // Neutral, no scripts, no external resources.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
:root{color-scheme:light dark}body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;background:#fff;color:#1d1d1f;display:grid;place-items:center;min-height:100vh}
@media (prefers-color-scheme:dark){body{background:#161616;color:#f2f2f2}}main{max-width:28rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;opacity:.75}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error) => {
      server.off("listening", onListening);
      reject(e);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export async function startLoopback(o: LoopbackOptions): Promise<LoopbackListener> {
  let settle: { resolve(r: RedirectResult): void; reject(e: Error): void } | null = null;
  const result = new Promise<RedirectResult>((resolve, reject) => {
    settle = { resolve, reject };
  });
  result.catch(() => undefined);
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const reply = (status: number, title: string, body: string) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(page(title, body));
    };
    if (req.method !== "GET" || url.pathname !== "/" || done) return reply(404, "Not here", "This address only finishes a sign-in to Folevi.");
    const params = url.searchParams;
    // Anything without our state is someone else's request: ignored, the sign-in keeps waiting.
    if (params.get("state") !== o.state) return reply(400, "Not this sign-in", "This link isn't from the sign-in Folevi started. Go back to Folevi and try again.");
    const error = params.get("error");
    const code = params.get("code");
    if (error || !code) {
      reply(200, "Not connected", `Folevi wasn't connected to ${o.providerName}. You can close this tab.`);
      finish(new SignInCancelled(error === "access_denied" ? "You cancelled the sign-in." : `${o.providerName} answered: ${error ?? "no code"}.`));
      return;
    }
    reply(200, `Folevi is connected to ${o.providerName}`, "You can close this tab and go back to Folevi.");
    finish(null, { code });
  });
  server.keepAliveTimeout = 1000;

  const finish = (error: Error | null, value?: RedirectResult) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    // Let the answer page go out first.
    setTimeout(() => {
      server.close();
      server.closeAllConnections?.();
    }, 50);
    if (error) settle!.reject(error);
    else settle!.resolve(value!);
  };

  let port: number | null = null;
  let lastError: unknown = null;
  for (const candidate of o.ports) {
    try {
      port = await listen(server, candidate);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (port === null) throw new Error(`Folevi couldn't listen for the sign-in on this Mac (${(lastError as Error)?.message ?? "no port"}).`);
  timer = setTimeout(() => finish(new SignInCancelled("The sign-in took too long.")), o.timeoutMs ?? 10 * 60_000);
  return {
    redirectUri: `http://127.0.0.1:${port}/`,
    result,
    close: () => finish(new SignInCancelled("The sign-in was stopped.")),
  };
}

/** Dropbox needs registered, fixed ports: these three, in the App Console as http://127.0.0.1:<port>/. */
export const DROPBOX_PORTS = [41753, 41754, 41755];
