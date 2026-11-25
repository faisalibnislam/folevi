// Folevi Server's email providers: SMTP (protocol against a scripted server, and the MIME message) and Folevi
// Mail (Connect's relay), plus sendEmail choosing them when the caller passes a provider.
import { describe, expect, test, vi } from "vitest";
import { buildMimeMessage, dataBlock, emailManifest, encodeHeaderValue, foleviMailBody, postToFoleviMail, sendEmail, sendSmtp, type SmtpSocket } from "../src/index";

/** A scripted SMTP server: answers each command the client writes, records the conversation. */
function scripted(opts: { starttls?: boolean; auth?: string; rejectAuth?: boolean } = {}) {
  const written: string[] = [];
  const queue: string[] = ["220 mail.example.com ESMTP"];
  let tls = false;
  let inData = false;
  const ehlo = () => ["250-mail.example.com", ...(opts.starttls && !tls ? ["250-STARTTLS"] : []), `250-AUTH ${opts.auth ?? "PLAIN LOGIN"}`, "250 8BITMIME"];
  const socket: SmtpSocket = {
    async write(data) {
      written.push(data);
      if (inData) {
        inData = false;
        queue.push("250 2.0.0 queued");
        return;
      }
      const cmd = data.trim();
      if (cmd.startsWith("EHLO")) queue.push(...ehlo());
      else if (cmd === "STARTTLS") queue.push("220 go ahead");
      else if (cmd.startsWith("AUTH PLAIN")) queue.push(opts.rejectAuth ? "535 5.7.8 bad credentials" : "235 ok");
      else if (cmd.startsWith("MAIL FROM") || cmd.startsWith("RCPT TO")) queue.push("250 ok");
      else if (cmd === "DATA") {
        inData = true;
        queue.push("354 go");
      } else if (cmd === "QUIT") queue.push("221 bye");
      else queue.push("500 unknown command");
    },
    async readLine() {
      const line = queue.shift();
      if (line === undefined) throw new Error("no reply");
      return line;
    },
    async startTls() {
      tls = true;
    },
    close: vi.fn(),
  };
  return { socket, written, tlsUsed: () => tls };
}

const message = { from: { email: "folevi@example.com", name: "Smith family" }, to: "kid@example.com", subject: "Hello", text: "Hi.\n.dot line", html: "<p>Hi</p>" };

describe("SMTP", () => {
  test("STARTTLS, AUTH PLAIN, one message, QUIT", async () => {
    const s = scripted({ starttls: true });
    const out = await sendSmtp(message, { host: "mail.example.com", port: 587, security: "starttls", username: "me", password: "pw" }, async (o) => {
      expect(o).toEqual({ host: "mail.example.com", port: 587, tls: false });
      return s.socket;
    });
    expect(out).toMatchObject({ status: "accepted", provider: "smtp" });
    expect(s.tlsUsed()).toBe(true);
    const cmds = s.written.map((w) => w.split("\r\n")[0]);
    expect(cmds.slice(0, 4)).toEqual(["EHLO localhost", "STARTTLS", "EHLO localhost", `AUTH PLAIN ${btoa("\u0000me\u0000pw")}`]);
    expect(cmds).toContain("MAIL FROM:<folevi@example.com>");
    expect(cmds).toContain("RCPT TO:<kid@example.com>");
    expect(s.written.at(-1)).toBe("QUIT\r\n");
    expect(s.socket.close).toHaveBeenCalled();
  });

  test("refuses to send in the clear when STARTTLS was asked for but isn't offered", async () => {
    const s = scripted({ starttls: false });
    const out = await sendSmtp(message, { host: "h", port: 587, security: "starttls" }, async () => s.socket);
    expect(out).toMatchObject({ status: "failed", errorCode: "tls_unavailable", retryable: false });
    expect(s.written.some((w) => w.startsWith("MAIL"))).toBe(false);
  });

  test("a refused login is unauthorized; a dropped connection is retryable", async () => {
    const s = scripted({ rejectAuth: true });
    expect(await sendSmtp(message, { host: "h", port: 465, security: "tls", username: "me", password: "bad" }, async () => s.socket)).toMatchObject({ errorCode: "unauthorized", retryable: false });
    expect(await sendSmtp(message, { host: "h", port: 25, security: "none" }, async () => Promise.reject(new Error("ECONNREFUSED")))).toMatchObject({ errorCode: "network_error", retryable: true });
  });

  test("the MIME message: encoded headers, base64 bodies, no header injection, dot-stuffing", () => {
    const mime = buildMimeMessage(
      { ...message, from: { email: "a@b.c", name: "Zoë" }, subject: "Hello\r\nBcc: evil@example.com", headers: { "In-Reply-To": "<x@y>" } },
      { messageId: "id@b.c", date: new Date(Date.UTC(2026, 10, 25, 10, 0, 0)), boundary: "BOUND" },
    );
    expect(mime).toContain(`From: ${encodeHeaderValue("Zoë")} <a@b.c>`);
    expect(mime).toContain("Subject: Hello Bcc: evil@example.com");
    expect(mime).not.toMatch(/^Bcc:/m);
    expect(mime).toContain("In-Reply-To: <x@y>");
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="BOUND"');
    expect(mime).toContain("Date: Wed, 25 Nov 2026 10:00:00 +0000");
    expect(dataBlock("a\r\n.b\r\n")).toBe("a\r\n..b\r\n.\r\n");
  });
});

describe("Folevi Mail", () => {
  test("posts {to, subject, html, text, replyTo, tag} with the Connect token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "m1" }), { status: 202 }));
    const out = await postToFoleviMail({ to: "a@example.com", subject: "s", html: "<p>h</p>", text: "t", replyTo: "owner@example.com", tag: "auth_verify_email" }, { baseUrl: "https://connect.test/", token: "tok", idempotencyKey: "k", fetchImpl: fetchMock as typeof fetch });
    expect(out).toMatchObject({ status: "accepted", provider: "folevi", providerMessageId: "m1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://connect.test/v1/mail");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({ to: "a@example.com", subject: "s", html: "<p>h</p>", text: "t", replyTo: "owner@example.com", tag: "auth_verify_email" });
    expect(foleviMailBody({ to: "a", subject: "", html: "", text: "", tag: "bad tag!" }).tag).toBe("badtag");
  });

  test("401 is not retried; 503 is", async () => {
    const no = vi.fn(async () => new Response("{}", { status: 401 }));
    expect(await postToFoleviMail({ to: "a@example.com", subject: "s", html: "h", text: "t", tag: "x" }, { baseUrl: "https://c", token: "t", idempotencyKey: "k", fetchImpl: no as typeof fetch, sleep: async () => {} })).toMatchObject({ errorCode: "unauthorized" });
    expect(no).toHaveBeenCalledTimes(1);
    const busy = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response("{}", { status: 202 }));
    expect(await postToFoleviMail({ to: "a@example.com", subject: "s", html: "h", text: "t", tag: "x" }, { baseUrl: "https://c", token: "t", idempotencyKey: "k", fetchImpl: busy as unknown as typeof fetch, sleep: async () => {} })).toMatchObject({ status: "accepted" });
  });
});

describe("sendEmail with a server provider", () => {
  const input = { key: "auth_verify_email" as const, to: "a@example.com", dataVariables: { ...emailManifest.auth_verify_email.fixture }, attemptId: "att1" };
  const policy = { environment: "production" as const };

  test("smtp: hands the rendered message to the transport", async () => {
    const smtp = vi.fn(async () => ({ status: "accepted" as const, retryable: false, attempts: 1 }));
    const out = await sendEmail(input, { env: {}, policy, provider: { kind: "smtp", from: { email: "f@example.com", name: "Home" } }, smtp });
    expect(out).toMatchObject({ status: "accepted", provider: "smtp" });
    const [sent] = smtp.mock.calls[0] as unknown as [{ from: unknown; to: string; html: string }];
    expect(sent.from).toEqual({ email: "f@example.com", name: "Home" });
    expect(sent.to).toBe("a@example.com");
    expect(sent.html.length).toBeGreaterThan(0);
  });

  test("smtp without a transport, or no provider, is not configured", async () => {
    expect(await sendEmail(input, { env: {}, policy, provider: { kind: "smtp", from: { email: "f@example.com" } } })).toMatchObject({ errorCode: "provider_not_configured" });
    expect(await sendEmail(input, { env: { RESEND_API_KEY: "re" }, policy, provider: { kind: "none" } })).toMatchObject({ errorCode: "provider_not_configured" });
  });
});
