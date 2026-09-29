import { describe, expect, it, vi } from "vitest";
import {
  automatedReason,
  emailManifest,
  fetchInboundMessage,
  htmlToText,
  mailtrapRequestBody,
  parseAddress,
  parseMailtrapInboundWebhook,
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
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, message_ids: ["m1"] }), { status: 200 }));
    await sendEmail(
      {
        key: "support_reply",
        to: "reader@example.com",
        dataVariables: { ...emailManifest.support_reply.fixture },
        attemptId: "a1",
        thread: { inReplyTo: "CAB123@mail.example.com", references: ["<first@mail.example.com>", "not an id"] },
      },
      { env: { MAILTRAP_API_TOKEN: "t", EMAIL_REPLY_TO: "other@example.com" }, policy: { environment: "production" }, fetchImpl },
    );
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.from).toEqual({ email: "support@mail.folevi.com", name: "Folevi Support" });
    expect(body.reply_to).toEqual({ email: "support@folevi.com" });
    expect(body.headers).toEqual({ "In-Reply-To": "<CAB123@mail.example.com>", References: "<first@mail.example.com> <CAB123@mail.example.com>" });
  });

  it("staff notices have no Reply-To at all, even with EMAIL_REPLY_TO set", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, message_ids: ["m1"] }), { status: 200 }));
    await sendEmail(
      { key: "support_staff_notice", to: "team@example.com", dataVariables: { ...emailManifest.support_staff_notice.fixture }, attemptId: "a2" },
      { env: { MAILTRAP_API_TOKEN: "t", EMAIL_REPLY_TO: "support@folevi.com" }, policy: { environment: "production" }, fetchImpl },
    );
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.from.email).toBe("support@mail.folevi.com");
    expect(body.reply_to).toBeUndefined();
  });

  it("threadHeaders ignores anything that isn't a message id (no header injection)", () => {
    expect(threadHeaders({ inReplyTo: "x@y\r\nBcc: evil@example.com" })).toEqual({});
    expect(threadHeaders(undefined)).toEqual({});
    expect(mailtrapRequestBody({ from: { email: "a@b.co", name: "A" }, to: "c@d.co", subject: "s", text: "t", html: "h", category: "c", customVariables: {} })).not.toHaveProperty("headers");
  });
});

describe("inbound webhook parsing", () => {
  const event = (o: Record<string, unknown> = {}) => ({ event: "inbound.message_received", event_id: "evt_1", timestamp: 1790000000, inbox_id: 15, message_id: "1866872391602282496", sender: "Ivan", ...o });

  it("reads {events}, arrays and JSON Lines, and counts other events as ignored", () => {
    expect(parseMailtrapInboundWebhook(JSON.stringify({ events: [event()] }))).toEqual({ events: [{ eventId: "evt_1", inboxId: "15", messageId: "1866872391602282496" }], ignored: 0 });
    expect(parseMailtrapInboundWebhook(`${JSON.stringify(event())}\n${JSON.stringify(event({ event_id: "evt_2" }))}`)?.events).toHaveLength(2);
    expect(parseMailtrapInboundWebhook(JSON.stringify([event(), { event: "delivery", event_id: "x" }]))).toMatchObject({ ignored: 1 });
  });

  it("refuses malformed bodies and ids", () => {
    expect(parseMailtrapInboundWebhook("not json")).toBeNull();
    expect(parseMailtrapInboundWebhook(JSON.stringify({ events: [] }))).toBeNull();
    expect(parseMailtrapInboundWebhook(JSON.stringify({ events: [event({ inbox_id: "../1" })] }))).toBeNull();
    expect(parseMailtrapInboundWebhook(JSON.stringify({ events: [event({ message_id: "a/b" })] }))).toBeNull();
  });

  it("fetches the message with the token and never retries a missing one", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "1" }), { status: 200 }));
    expect(await fetchInboundMessage({ token: "tok", inboxId: "15", messageId: "1", fetchImpl })).toEqual({ ok: true, message: { id: "1" } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mailtrap.io/api/inbound/inboxes/15/messages/1");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const gone = vi.fn(async () => new Response("", { status: 404 }));
    expect(await fetchInboundMessage({ token: "tok", inboxId: "15", messageId: "1", fetchImpl: gone })).toEqual({ ok: false, status: 404, retryable: false });
    const down = vi.fn(async () => new Response("", { status: 503 }));
    expect(await fetchInboundMessage({ token: "tok", inboxId: "15", messageId: "1", fetchImpl: down })).toMatchObject({ retryable: true });
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

  it("reads the Messages API shape, preferring text and falling back to HTML", () => {
    const m = readInboundMessage({
      id: "1",
      from: "Jane <Jane@Example.com>",
      to: ["support@folevi.com"],
      cc: [],
      subject: "Re: [Folevi #12] Reply from Folevi support",
      rfc_message_id: "<abc@mail.example.com>",
      in_reply_to: "<x@folevi.com>",
      references: ["<x@folevi.com>"],
      headers: { "Auto-Submitted": "no" },
      text_body: null,
      html_body: "<p>Still broken</p><div class=\"gmail_quote\">On Mon wrote: old</div>",
    });
    expect(m).toMatchObject({ fromAddress: "jane@example.com", fromName: "Jane", to: ["support@folevi.com"], text: "Still broken", rfcMessageId: "abc@mail.example.com", inReplyTo: "x@folevi.com", automated: null });
    expect(readInboundMessage({ from: "no address" })).toBeNull();
  });
});
