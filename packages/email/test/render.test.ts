import { describe, expect, it } from "vitest";
import { EmailRenderError, TEMPLATE_KEYS, emailManifest, escapeHtml, renderEmail } from "../src/index";

const mention = () => ({ ...emailManifest.mention_notification.fixture });

function renderError(fn: () => unknown): EmailRenderError {
  try {
    fn();
  } catch (e) {
    if (e instanceof EmailRenderError) return e;
    throw e;
  }
  throw new Error("expected renderEmail to throw");
}

describe("renderEmail", () => {
  it.each([...TEMPLATE_KEYS])("%s renders its fixture completely (HTML + text, no placeholders left)", (key) => {
    const email = renderEmail(key, emailManifest[key].fixture);
    // Support subjects carry the ticket number; every other subject is static.
    const fixture = emailManifest[key].fixture;
    expect(email.subject).toBe(emailManifest[key].subject.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(fixture[name])));
    for (const part of [email.html, email.text, email.subject, email.previewText]) {
      expect(part).not.toMatch(/\{\{|\}\}/);
    }
    expect(email.text.length).toBeGreaterThan(100);
    expect(email.html).toContain("https://folevi.com/brand/email/folevi-logo@2x.png");
    expect(email.html).toContain("https://folevi.com/brand/email/folevi-logo-dark@2x.png");
    // Every URL variable shows up as a link.
    for (const [name, spec] of Object.entries(emailManifest[key].variables)) {
      if (spec.format === "url") expect(email.html).toContain(`href="${escapeHtml(new URL(String(emailManifest[key].fixture[name])).href)}"`);
    }
  });

  it("HTML-escapes every value; the text part keeps the plain value", () => {
    const email = renderEmail("mention_notification", {
      ...mention(),
      actorName: `Eve "the" O'Brien & co`,
      documentTitle: "<img src=x onerror=alert(1)> plan",
    });
    expect(email.html).toContain("Eve &quot;the&quot; O&#39;Brien &amp; co");
    expect(email.html).not.toContain("<img src=x");
    // Angle brackets are neutralised at validation (guillemets) and anything else is escaped.
    expect(email.html).toContain("‹img src=x onerror=alert(1)› plan");
    expect(email.text).toContain(`Eve "the" O'Brien & co`);
  });

  it("turns newlines in text variables into <br> (the digest), not in the text part", () => {
    const email = renderEmail("comment_digest", {
      ...emailManifest.comment_digest.fixture,
      summary: "• One\n• Two",
    });
    expect(email.html).toContain("• One<br>• Two");
    expect(email.text).toContain("• One\n• Two");
  });

  it("throws on missing required variables, naming them but never their values", () => {
    const vars = mention() as Record<string, unknown>;
    delete vars.documentUrl;
    const e = renderError(() => renderEmail("mention_notification", vars));
    expect(e.errors).toContain("documentUrl: missing required variable");
    expect(e.message).not.toContain("Maya");
  });

  it("throws on unknown variables", () => {
    const e = renderError(() => renderEmail("mention_notification", { ...mention(), excerpt: "secret note text" }));
    expect(e.errors.join()).toContain("excerpt: unknown variable");
    expect(e.message).not.toContain("secret note text");
  });

  it("throws for an unknown template", () => {
    expect(() => renderEmail("nope" as never, {})).toThrow(EmailRenderError);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://evil.example.com/",
    "//evil.example.com/path",
    "vbscript:msgbox",
    "https://user:pass@app.folevi.com/",
  ])("refuses the URL %s", (bad) => {
    expect(() => renderEmail("mention_notification", { ...mention(), documentUrl: bad })).toThrow(EmailRenderError);
  });

  it("accepts app-relative URLs only when an app URL is given", () => {
    expect(() => renderEmail("mention_notification", { ...mention(), documentUrl: "/d/abc" })).toThrow(EmailRenderError);
    const email = renderEmail("mention_notification", { ...mention(), documentUrl: "/d/abc" }, { appUrl: "https://app.folevi.com" });
    expect(email.html).toContain('href="https://app.folevi.com/d/abc"');
    // Protocol-relative is never treated as app-relative.
    expect(() =>
      renderEmail("mention_notification", { ...mention(), documentUrl: "//evil.example.com/x" }, { appUrl: "https://app.folevi.com" }),
    ).toThrow(EmailRenderError);
  });

  it("serialises URLs so they cannot break out of the href", () => {
    const email = renderEmail("mention_notification", { ...mention(), documentUrl: 'https://app.folevi.com/d/x" onmouseover="alert(1)' });
    expect(email.html).not.toContain('" onmouseover="');
    expect(email.html).toContain("%22%20onmouseover=%22alert(1)");
  });

  it("uses a configurable logo base: https or a relative preview path only", () => {
    const a = renderEmail("auth_verify_email", emailManifest.auth_verify_email.fixture, { brandBaseUrl: "https://staging.folevi.com/brand/email/" });
    expect(a.html).toContain('src="https://staging.folevi.com/brand/email/folevi-logo@2x.png"');
    const b = renderEmail("auth_verify_email", emailManifest.auth_verify_email.fixture, { brandBaseUrl: "../../apps/web/public/brand/email" });
    expect(b.html).toContain('src="../../apps/web/public/brand/email/folevi-logo@2x.png"');
    const c = renderEmail("auth_verify_email", emailManifest.auth_verify_email.fixture, { brandBaseUrl: 'https://x.com/"><script>' });
    expect(c.html).not.toContain('"><script>');
    for (const bad of ["http://folevi.com/brand", "javascript:alert(1)", "https://folevi.com/brand?x=1", "//evil.example.com/brand"]) {
      expect(() => renderEmail("auth_verify_email", emailManifest.auth_verify_email.fixture, { brandBaseUrl: bad })).toThrow(EmailRenderError);
    }
  });
});

describe("plural units", () => {
  const reset = (expiresInHours: number) =>
    renderEmail("auth_password_reset", { actionUrl: "https://app.folevi.com/reset?token=t", expiresInHours });
  it("says 1 hour, not 1 hours or hour(s)", () => {
    const one = reset(1);
    expect(one.text).toContain("expires in 1 hour and");
    expect(one.html).toContain("expires in 1 hour and");
    expect(one.text).not.toMatch(/hour\(s\)|1 hours/);
  });
  it("says 24 hours", () => {
    expect(reset(24).text).toContain("expires in 24 hours");
  });
});
