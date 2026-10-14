import { describe, expect, it, vi } from "vitest";
import {
  automatedReason,
  emailManifest,
  fetchReceivedEmail,
  htmlToText,
  parseAddress,
  resendRequestBody,
  readInboundMessage,
  renderEmail,
  sendEmail,
  stripQuotedReply,
  threadHeaders,
  ticketNumberFromSubject,
} from "../src/index";

describe("support templates", () => {
  it("put the ticket number in the subject and escape the quoted message", () => {
    const out = renderEmail("support_ticket_received", { ticketNumber: 1042, topicLabel: "Billing and plans", quotedMessage: "<b>hi</b>\nsecond line" });
    expect(out.subject).toBe("[Folevi #1042] We got your message");
    // Markup can't survive: angle brackets become guillemets, and newlines become <br> in HTML.
    expect(out.html).toContain("\u2039b\u203Ahi\u2039/b\u203A<br>second line");
    expect(out.html).not.toContain("<b>hi</b>");
    expect(out.text).toContain("\u2039b\u203Ahi\u2039/b\u203A\nsecond line");
    expect(renderEmail("support_reply", { ticketNumber: 7, replyText: "Thanks" }).subject).toBe("[Folevi #7] Reply from Folevi support");
  });

  it("are sent from support@ on the sending domain with Reply-To support@folevi.com and threading headers", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "m1" }), { status: 200 }));
    await sendEmail(
      {
        key: "support_reply",
        to: "reader@example.com",
        dataVariables: { ...emailManifest.support_reply.fixture },
        attemptId: "a1",
        thread: { inReplyTo: "CAB123@mail.example.com", references: ["<first@mail.example.com>", "not an id"] },
      },
      { env: { RESEND_API_KEY: "t", EMAIL_REPLY_TO: "other@example.com" }, policy: { environment: "production" }, fetchImpl },
    );
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.from).toBe("Folevi Support <support@folevi.com>");
    expect(body.reply_to).toBe("support@folevi.com");
    expect(body.headers).toEqual({ "In-Reply-To": "<CAB123@mail.example.com>", References: "<first@mail.example.com> <CAB123@mail.example.com>" });
  });

  it("staff notices have no Reply-To at all, even with EMAIL_REPLY_TO set", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "m1" }), { status: 200 }));
    await sendEmail(
      { key: "support_staff_notice", to: "team@example.com", dataVariables: { ...emailManifest.support_staff_notice.fixture }, attemptId: "a2" },
      { env: { RESEND_API_KEY: "t", EMAIL_REPLY_TO: "support@folevi.com" }, policy: { environment: "production" }, fetchImpl },
    );
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.from).toBe("Folevi <support@folevi.com>");
    expect(body.reply_to).toBeUndefined();
  });

  it("threadHeaders ignores anything that isn't a message id (no header injection)", () => {
    expect(threadHeaders({ inReplyTo: "x@y\r\nBcc: evil@example.com" })).toEqual({});
    expect(threadHeaders(undefined)).toEqual({});
    expect(resendRequestBody({ from: { email: "a@b.co", name: "A" }, to: "c@d.co", subject: "s", text: "t", html: "h", tags: { template: "c", attempt: "a" } })).not.toHaveProperty("headers");
  });
});

describe("reading a received email", () => {
  it("fetches it with the API key and never retries a missing one", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "1" }), { status: 200 }));
    expect(await fetchReceivedEmail({ apiKey: "key", emailId: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c", fetchImpl })).toEqual({ ok: true, message: { id: "1" } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails/receiving/4ef9a417-02e9-4d39-ad75-9611e0fcc33c");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key");
    const gone = vi.fn(async () => new Response("", { status: 404 }));
    expect(await fetchReceivedEmail({ apiKey: "key", emailId: "1", fetchImpl: gone })).toEqual({ ok: false, status: 404, retryable: false });
    const down = vi.fn(async () => new Response("", { status: 503 }));
    expect(await fetchReceivedEmail({ apiKey: "key", emailId: "1", fetchImpl: down })).toMatchObject({ retryable: true });
    // Ids are checked before anything is requested (no path tricks).
    const never = vi.fn();
    expect(await fetchReceivedEmail({ apiKey: "key", emailId: "../domains", fetchImpl: never as unknown as typeof fetch })).toEqual({ ok: false, status: 400, retryable: false });
    expect(never).not.toHaveBeenCalled();
  });
});

describe("reading an inbound message", () => {
  it("parses addresses in the usual forms", () => {
    expect(parseAddress("Ivan Djuric <Demo.Eth@Gmail.com>")).toEqual({ address: "demo.eth@gmail.com", name: "Ivan Djuric" });
    expect(parseAddress('"Doe, Jane" <jane@example.com>')).toEqual({ address: "jane@example.com", name: "Doe, Jane" });
    expect(parseAddress("jane@example.com")).toEqual({ address: "jane@example.com", name: "" });
    expect(parseAddress({ name: "Sarah", email: "sarah@acme.co" })).toEqual({ address: "sarah@acme.co", name: "Sarah" });
    expect(parseAddress("nobody")).toBeNull();
  });

  it("strips quoted replies", () => {
    const reply = "Thanks, that worked.\n\nOn Tue, 3 Sep 2026 at 10:00, Folevi Support <support@folevi.com> wrote:\n> Try this\n> more";
    expect(stripQuotedReply(reply)).toBe("Thanks, that worked.");
    expect(stripQuotedReply("Yes please\nOn Tue, 3 Sep 2026 at 10:00 Folevi Support\n<support@folevi.com> wrote:\n> old")).toBe("Yes please");
    expect(stripQuotedReply("Top\n> quoted\nBottom")).toBe("Top\nBottom");
    expect(stripQuotedReply("New text\n\n-----Original Message-----\nFrom: x")).toBe("New text");
    expect(stripQuotedReply("> only quoted")).toBe("> only quoted");
  });

  it("turns HTML into text without quoted blocks", () => {
    expect(htmlToText('<html><head><style>p{}</style></head><body><p>Hello &amp; welcome</p><div>Line<br>two</div><blockquote>old</blockquote></body></html>')).toBe("Hello & welcome\nLine\ntwo");
  });

  it("finds the ticket number in the subject", () => {
    expect(ticketNumberFromSubject("Re: [Folevi #1042] We got your message")).toBe(1042);
    expect(ticketNumberFromSubject("Re: Folevi 1042")).toBeNull();
  });

  it("recognises auto-replies and bounces", () => {
    const base = { headers: {}, fromAddress: "jane@example.com", subject: "Question" };
    expect(automatedReason(base)).toBeNull();
    expect(automatedReason({ ...base, headers: { "auto-submitted": "auto-replied" } })).toBe("auto_submitted");
    expect(automatedReason({ ...base, headers: { "auto-submitted": "no" } })).toBeNull();
    expect(automatedReason({ ...base, headers: { precedence: "bulk" } })).toBe("precedence");
    expect(automatedReason({ ...base, fromAddress: "MAILER-DAEMON@mx.example.com".toLowerCase() })).toBe("mailer_daemon");
    expect(automatedReason({ ...base, subject: "Out of Office: back Monday" })).toBe("auto_reply_subject");
  });

  it("reads the Received emails API shape, preferring text and falling back to HTML", () => {
    const m = readInboundMessage({
      id: "1",
      from: "Jane <Jane@Example.com>",
      to: ["support@folevi.com"],
      cc: [],
      subject: "Re: [Folevi #12] Reply from Folevi support",
      message_id: "<abc@mail.example.com>",
      headers: { "Auto-Submitted": "no", "In-Reply-To": "<x@folevi.com>", References: "<first@folevi.com> <x@folevi.com>" },
      text: null,
      html: "<p>Still broken</p><div class=\"gmail_quote\">On Mon wrote: old</div>",
    });
    expect(m).toMatchObject({ fromAddress: "jane@example.com", fromName: "Jane", to: ["support@folevi.com"], text: "Still broken", rfcMessageId: "abc@mail.example.com", inReplyTo: "x@folevi.com", references: ["first@folevi.com", "x@folevi.com"], automated: null });
    expect(readInboundMessage({ from: "no address" })).toBeNull();
  });
});
