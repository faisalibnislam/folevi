"use node";
// Folevi Server: sends one rendered message through the owner's SMTP server (settings email.mode "smtp").
// The protocol lives in @folevi/email (providers/smtp.ts); this file only opens the socket with Node's net and
// tls, and reads the SMTP settings (password included) inside the backend, so the password never travels in
// function arguments. Never logs an address, the message or a credential.
import { v } from "convex/values";
import net from "node:net";
import tls from "node:tls";
import { sendSmtp, type SendOutcome, type SmtpConnectOptions, type SmtpSocket } from "@folevi/email";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/** No answer from the server for this long: the connection is given up. */
const SOCKET_TIMEOUT_MS = 20_000;

/** A line reader over a Node socket that can be upgraded to TLS in place (STARTTLS). */
function lineSocket(initial: net.Socket): SmtpSocket {
  let sock: net.Socket = initial;
  let buffer = "";
  const lines: string[] = [];
  const waiting: { resolve: (line: string) => void; reject: (e: Error) => void }[] = [];
  let closed: Error | null = null;

  const onData = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let cut: number;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).replace(/\r$/, "");
      buffer = buffer.slice(cut + 1);
      const w = waiting.shift();
      if (w) w.resolve(line);
      else lines.push(line);
    }
  };
  const onEnd = (error?: Error) => {
    closed = error ?? new Error("connection closed");
    for (const w of waiting.splice(0)) w.reject(closed);
  };
  const attach = (s: net.Socket) => {
    s.setTimeout(SOCKET_TIMEOUT_MS, () => {
      const e = new Error("timeout");
      e.name = "TimeoutError";
      s.destroy(e);
    });
    s.on("data", onData);
    s.on("error", onEnd);
    s.on("close", () => onEnd());
  };
  attach(sock);

  return {
    write: (data) =>
      new Promise((resolve, reject) => {
        if (closed) return reject(closed);
        sock.write(data, (e) => (e ? reject(e) : resolve()));
      }),
    readLine: () =>
      new Promise((resolve, reject) => {
        const line = lines.shift();
        if (line !== undefined) return resolve(line);
        if (closed) return reject(closed);
        waiting.push({ resolve, reject });
      }),
    startTls: (servername) =>
      new Promise((resolve, reject) => {
        const plain = sock;
        plain.removeAllListeners("data");
        plain.removeAllListeners("close");
        plain.removeAllListeners("error");
        plain.setTimeout(0);
        const secure = tls.connect({ socket: plain, servername, minVersion: "TLSv1.2" }, () => resolve());
        secure.once("error", reject);
        sock = secure;
        attach(secure);
      }),
    close: () => {
      sock.destroy();
    },
  };
}

function connect(opts: SmtpConnectOptions): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const s = opts.tls ? tls.connect({ host: opts.host, port: opts.port, servername: opts.host, minVersion: "TLSv1.2" }) : net.connect({ host: opts.host, port: opts.port });
    const ready = opts.tls ? "secureConnect" : "connect";
    const timer = setTimeout(() => {
      const e = new Error("timeout");
      e.name = "TimeoutError";
      s.destroy(e);
      reject(e);
    }, SOCKET_TIMEOUT_MS);
    s.once(ready, () => {
      clearTimeout(timer);
      resolve(lineSocket(s));
    });
    s.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const vMessage = v.object({
  from: v.object({ email: v.string(), name: v.string() }),
  to: v.string(),
  replyTo: v.optional(v.string()),
  subject: v.string(),
  text: v.string(),
  html: v.string(),
  headers: v.optional(v.record(v.string(), v.string())),
});

export const deliver = internalAction({
  args: { message: vMessage },
  handler: async (ctx, args): Promise<SendOutcome> => {
    const transport = await ctx.runQuery(internal.server.emailTransport, {});
    const smtp = transport?.mode === "smtp" ? transport.smtp : null;
    if (!smtp) return { status: "failed", errorCode: "provider_not_configured", retryable: false, attempts: 0, provider: "smtp" };
    let heloName = "localhost";
    try {
      heloName = new URL(process.env.SITE_URL ?? process.env.FOLEVI_APP_URL ?? "http://localhost").hostname || "localhost";
    } catch {
      /* keep localhost */
    }
    return await sendSmtp(args.message, { host: smtp.host, port: smtp.port, security: smtp.security, username: smtp.username, password: smtp.password, heloName }, connect);
  },
});
