// Sending through the owner's own SMTP server (Folevi Server, docs/self-hosting/CONTRACT.md §8 email.mode
// "smtp"). This file is the protocol only (RFC 5321: EHLO, STARTTLS, AUTH PLAIN or LOGIN, MAIL, RCPT, DATA)
// and the MIME message (multipart/alternative, UTF-8, base64 bodies). The socket comes from the caller
// (convex/smtpSend.ts opens it with Node's net and tls), so this stays free of runtime dependencies and
// is tested with a scripted server.
//
// Never logs, and never returns the password, the recipient or the message in an outcome.
import type { SendOutcome } from "../types";

/** A line-oriented connection to an SMTP server. */
export interface SmtpSocket {
  write(data: string): Promise<void>;
  /** The next line from the server, without its CRLF. Rejects when the connection closes or times out. */
  readLine(): Promise<string>;
  /** Upgrades the connection to TLS in place (after STARTTLS), checking the certificate for `servername`. */
  startTls(servername: string): Promise<void>;
  close(): void;
}

export interface SmtpConnectOptions {
  host: string;
  port: number;
  /** TLS from the first byte (port 465, "tls"); otherwise plain, maybe upgraded with STARTTLS. */
  tls: boolean;
}

export type SmtpConnect = (opts: SmtpConnectOptions) => Promise<SmtpSocket>;

export interface SmtpConfig {
  host: string;
  port: number;
  security: "tls" | "starttls" | "none";
  username?: string;
  password?: string;
  /** The name sent with EHLO (the server's own host name); "localhost" when unknown. */
  heloName?: string;
}

export interface SmtpMessage {
  from: { email: string; name: string };
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, already validated (threading headers only). */
  headers?: Record<string, string>;
}

const enc = new TextEncoder();

/** Base64 of a string's UTF-8 bytes. */
export function base64Utf8(value: string): string {
  const bytes = enc.encode(value);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A header value with no line breaks (nothing can be injected into the header block). */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

/** An RFC 2047 encoded word for a header value that isn't plain ASCII. */
export function encodeHeaderValue(value: string): string {
  const clean = oneLine(value);
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${base64Utf8(clean)}?=`;
}

/** `"Name" <a@b.c>`, the name encoded when it needs to be. */
export function formatAddress(addr: { email: string; name?: string }): string {
  const email = oneLine(addr.email).replace(/[<>"]/g, "");
  const name = addr.name ? oneLine(addr.name).replace(/["\\<>]/g, "") : "";
  if (!name) return `<${email}>`;
  return /^[\x20-\x7e]*$/.test(name) ? `"${name}" <${email}>` : `${encodeHeaderValue(name)} <${email}>`;
}

const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n");

/** The whole message, headers and both bodies, with CRLF line ends (before dot-stuffing). */
export function buildMimeMessage(m: SmtpMessage, opts: { messageId: string; date: Date; boundary: string }): string {
  const headers: string[] = [
    `From: ${formatAddress(m.from)}`,
    `To: <${oneLine(m.to).replace(/[<>"]/g, "")}>`,
    ...(m.replyTo ? [`Reply-To: <${oneLine(m.replyTo).replace(/[<>"]/g, "")}>`] : []),
    `Subject: ${encodeHeaderValue(m.subject)}`,
    `Date: ${opts.date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${oneLine(opts.messageId).replace(/[<>]/g, "")}>`,
    ...Object.entries(m.headers ?? {})
      .filter(([k]) => /^[A-Za-z][A-Za-z0-9-]{0,40}$/.test(k))
      .map(([k, value]) => `${k}: ${oneLine(value)}`),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${opts.boundary}"`,
  ];
  const part = (type: string, body: string) => [`--${opts.boundary}`, `Content-Type: ${type}; charset=utf-8`, "Content-Transfer-Encoding: base64", "", wrap76(base64Utf8(body))].join("\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${part("text/plain", m.text)}${part("text/html", m.html)}--${opts.boundary}--\r\n`;
}

/** Dot-stuffing (RFC 5321 §4.5.2) and the end-of-data marker. */
export function dataBlock(message: string): string {
  const body = message.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
  return `${body.endsWith("\r\n") ? body : `${body}\r\n`}.\r\n`;
}

interface Reply {
  code: number;
  lines: string[];
}

class SmtpError extends Error {
  constructor(
    readonly code: number,
    readonly step: string,
  ) {
    super(`smtp ${step} ${code}`);
  }
}

async function readReply(socket: SmtpSocket): Promise<Reply> {
  const lines: string[] = [];
  for (let i = 0; i < 200; i++) {
    const line = await socket.readLine();
    const m = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!m) throw new SmtpError(0, "reply");
    lines.push(m[3]!);
    if (m[2] === " ") return { code: Number(m[1]), lines };
  }
  throw new SmtpError(0, "reply");
}

async function command(socket: SmtpSocket, line: string, step: string, ok: (code: number) => boolean): Promise<Reply> {
  await socket.write(`${line}\r\n`);
  const reply = await readReply(socket);
  if (!ok(reply.code)) throw new SmtpError(reply.code, step);
  return reply;
}

const is2xx = (c: number) => c >= 200 && c < 300;

/** Why a send failed, as the outcome's errorCode, and whether trying again later can help. */
function outcomeOf(error: unknown): SendOutcome {
  if (error instanceof SmtpError) {
    if (error.step === "auth" && error.code >= 500) return { status: "failed", errorCode: "unauthorized", retryable: false, attempts: 1, provider: "smtp", providerError: `SMTP ${error.code} at ${error.step}` };
    if (error.step === "starttls_missing") return { status: "failed", errorCode: "tls_unavailable", retryable: false, attempts: 1, provider: "smtp", providerError: "The server doesn't offer STARTTLS" };
    if (error.code >= 400 && error.code < 500) return { status: "failed", errorCode: "provider_server_error", retryable: true, attempts: 1, provider: "smtp", providerError: `SMTP ${error.code} at ${error.step}` };
    if (error.code >= 500) return { status: "failed", errorCode: "provider_rejected", retryable: false, attempts: 1, provider: "smtp", providerError: `SMTP ${error.code} at ${error.step}` };
    return { status: "failed", errorCode: "protocol_error", retryable: true, attempts: 1, provider: "smtp" };
  }
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown; code?: unknown }) : {};
  const timeout = name.name === "TimeoutError" || name.code === "ETIMEDOUT";
  return { status: "failed", errorCode: timeout ? "timeout" : "network_error", retryable: true, attempts: 1, provider: "smtp" };
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Sends one message. `accepted` means the SMTP server took it (250 after DATA), not that it was delivered. One
 * try per call: the caller's attempt row decides about trying again.
 */
export async function sendSmtp(message: SmtpMessage, config: SmtpConfig, connect: SmtpConnect, opts: { messageIdDomain?: string; now?: Date } = {}): Promise<SendOutcome> {
  let socket: SmtpSocket | null = null;
  try {
    socket = await connect({ host: config.host, port: config.port, tls: config.security === "tls" });
    const greeting = await readReply(socket);
    if (greeting.code !== 220) throw new SmtpError(greeting.code, "greeting");
    const helo = (config.heloName ?? "localhost").replace(/[^A-Za-z0-9.-]/g, "") || "localhost";
    let ehlo = await command(socket, `EHLO ${helo}`, "ehlo", is2xx);
    if (config.security === "starttls") {
      if (!ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) throw new SmtpError(0, "starttls_missing");
      await command(socket, "STARTTLS", "starttls", (c) => c === 220);
      await socket.startTls(config.host);
      ehlo = await command(socket, `EHLO ${helo}`, "ehlo", is2xx);
    }
    if (config.username) {
      const auth = ehlo.lines.find((l) => /^AUTH[ =]/i.test(l))?.toUpperCase() ?? "";
      const password = config.password ?? "";
      if (/\bPLAIN\b/.test(auth) || !/\bLOGIN\b/.test(auth)) {
        await command(socket, `AUTH PLAIN ${base64Utf8(`\u0000${config.username}\u0000${password}`)}`, "auth", (c) => c === 235);
      } else {
        await command(socket, "AUTH LOGIN", "auth", (c) => c === 334);
        await command(socket, base64Utf8(config.username), "auth", (c) => c === 334);
        await command(socket, base64Utf8(password), "auth", (c) => c === 235);
      }
    }
    const from = message.from.email.replace(/[<>\s]/g, "");
    const to = message.to.replace(/[<>\s]/g, "");
    await command(socket, `MAIL FROM:<${from}>`, "mail_from", is2xx);
    await command(socket, `RCPT TO:<${to}>`, "rcpt_to", is2xx);
    await command(socket, "DATA", "data", (c) => c === 354);
    const id = `${randomId()}@${(opts.messageIdDomain ?? from.split("@")[1] ?? "folevi.local").replace(/[^A-Za-z0-9.-]/g, "")}`;
    const mime = buildMimeMessage(message, { messageId: id, date: opts.now ?? new Date(), boundary: `folevi-${randomId()}` });
    await socket.write(dataBlock(mime));
    const done = await readReply(socket);
    if (!is2xx(done.code)) throw new SmtpError(done.code, "data_end");
    try {
      await socket.write("QUIT\r\n");
    } catch {
      /* already accepted */
    }
    return { status: "accepted", retryable: false, attempts: 1, provider: "smtp", providerMessageId: id };
  } catch (error) {
    return outcomeOf(error);
  } finally {
    socket?.close();
  }
}
