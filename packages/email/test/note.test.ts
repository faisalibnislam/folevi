import { describe, expect, it } from "vitest";
import { htmlToNoteText, MAX_NOTE_TEXT, readNoteEmail } from "../src/index";

describe("email to note", () => {
  it("turns HTML into Markdown-style text, keeping links, lists and forwarded parts", () => {
    const html = `<html><head><title>x</title><style>p{color:red}</style></head><body>
      <p>Hi,<br>see <a href="https://example.com/a?x=1&amp;y=2">the [plan]</a> and <a href="javascript:alert(1)">this</a>.</p>
      <ul><li>One</li><li><a href="mailto:ada@example.com">ada@example.com</a></li></ul>
      <div class="gmail_quote">---------- Forwarded message ---------<br>From: Bob</div>
      <img src="https://tracker.example/p.gif"><script>steal()</script></body></html>`;
    const text = htmlToNoteText(html);
    expect(text).toContain("Hi,\nsee [the \\[plan\\]](https://example.com/a?x=1&y=2) and this.");
    expect(text).toContain("- One\n- [ada@example.com](mailto:ada@example.com)");
    expect(text).toContain("Forwarded message");
    expect(text).not.toMatch(/tracker|steal|color:red|javascript/);
  });

  it("reads From (never Reply-To), the text, attachments and Resend's authentication results", () => {
    const note = readNoteEmail({
      from: "Ada Reader <ADA@example.com>",
      reply_to: "other@example.com",
      subject: "  Trip\nideas ",
      text: "Hello\r\n\r\n> quoted stays\n\nOn Mon, Bob wrote:\n> also stays",
      created_at: "2026-10-14T09:12:00.000Z",
      message_id: "<m1@mail.example.com>",
      attachments: [
        { filename: "plan.pdf", content_disposition: "attachment" },
        { filename: "logo.png", content_disposition: "inline", content_id: "logo" },
        { filename: "" },
      ],
      authentication: { spf: "PASS", dkim: "fail", dmarc: "pass", extra: "x" },
    })!;
    expect(note).toMatchObject({ fromAddress: "ada@example.com", fromName: "Ada Reader", subject: "Trip ideas", rfcMessageId: "m1@mail.example.com", receivedAt: Date.parse("2026-10-14T09:12:00.000Z"), truncated: false });
    expect(note.text).toBe("Hello\n\n> quoted stays\n\nOn Mon, Bob wrote:\n> also stays");
    expect(note.attachments).toEqual(["plan.pdf", "unnamed file"]);
    expect(note.authentication).toEqual({ spf: "pass", dkim: "fail", dmarc: "pass" });
    expect(readNoteEmail({ reply_to: "a@example.com", text: "x" })).toBeNull();
    expect(readNoteEmail({ from: "a@example.com", text: "x" })!.authentication).toBeNull();
    expect(readNoteEmail({ from: "a@example.com", authentication: { dmarc: "maybe" } })!.authentication!.dmarc).toBe("unknown");
  });

  it("caps the text", () => {
    const note = readNoteEmail({ from: "a@example.com", text: "a".repeat(MAX_NOTE_TEXT + 10) })!;
    expect(note.text).toHaveLength(MAX_NOTE_TEXT);
    expect(note.truncated).toBe(true);
  });
});
