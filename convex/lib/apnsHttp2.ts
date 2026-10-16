"use node";
// The wire to Apple: HTTP/2 (APNs only speaks HTTP/2) with Node's http2 module, one connection per host for
// the length of a send, closed after. Tests replace this module, so they never open a socket.
import http2 from "node:http2";

export interface ApnsRequest {
  host: string;
  /** The device token (hex). Never logged. */
  token: string;
  headers: Record<string, string>;
  body: string;
}

export interface ApnsResponse {
  /** The HTTP status, or 0 when there was no answer (no connection, a timeout). */
  status: number;
  /** Apple's reason for a refusal ("BadDeviceToken", "Unregistered", "TooManyRequests"...). */
  reason?: string;
}

export interface ApnsClient {
  send(request: ApnsRequest): Promise<ApnsResponse>;
  close(): void;
}

const TIMEOUT_MS = 10_000;

export function createApnsClient(): ApnsClient {
  const sessions = new Map<string, http2.ClientHttp2Session>();
  const session = (host: string) => {
    const open = sessions.get(host);
    if (open && !open.closed && !open.destroyed) return open;
    const s = http2.connect(`https://${host}:443`);
    // A failed connection answers each request with status 0 (below); nothing else to do with it here.
    s.on("error", () => sessions.delete(host));
    s.on("close", () => sessions.delete(host));
    sessions.set(host, s);
    return s;
  };
  return {
    send(request) {
      return new Promise<ApnsResponse>((resolve) => {
        let done = false;
        const finish = (r: ApnsResponse) => {
          if (done) return;
          done = true;
          resolve(r);
        };
        let stream: http2.ClientHttp2Stream;
        try {
          stream = session(request.host).request({
            ":method": "POST",
            ":path": `/3/device/${request.token}`,
            "content-type": "application/json",
            ...request.headers,
          });
        } catch {
          return finish({ status: 0 });
        }
        let status = 0;
        let data = "";
        stream.setEncoding("utf8");
        stream.setTimeout(TIMEOUT_MS, () => {
          stream.close(http2.constants.NGHTTP2_CANCEL);
          finish({ status: 0 });
        });
        stream.on("response", (headers) => (status = Number(headers[":status"] ?? 0)));
        stream.on("data", (chunk: string) => (data += chunk));
        stream.on("error", () => finish({ status: 0 }));
        stream.on("end", () => {
          let reason: string | undefined;
          if (data) {
            try {
              reason = (JSON.parse(data) as { reason?: string }).reason;
            } catch {
              reason = undefined;
            }
          }
          finish({ status, reason });
        });
        stream.end(request.body);
      });
    },
    close() {
      for (const s of sessions.values()) s.close();
      sessions.clear();
    },
  };
}
