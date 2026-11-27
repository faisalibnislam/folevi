// Every email Folevi Cloud sends names its operator, Space Cherries LLC, with the postal address in the footer
// (the owner, 2026-11-27). A Folevi Server's emails leave it out: the person who runs the server operates it.
import { describe, expect, test } from "vitest";
import { emailManifest, renderEmail, TEMPLATE_KEYS } from "../src";
import { EMAIL_OPERATOR, OPERATOR_LINE } from "../src/operator";

const ADDRESS = "5242 Elbetee Lane, Alexandria, VA 22312, USA";

describe("the operator in the email footer", () => {
  test("is Space Cherries LLC at its address", () => {
    expect(EMAIL_OPERATOR).toEqual({ name: "Space Cherries LLC", url: "https://www.spacecherries.com", address: ADDRESS });
    expect(OPERATOR_LINE).toBe(`Folevi is operated by Space Cherries LLC, ${ADDRESS}.`);
  });

  test.each(TEMPLATE_KEYS)("%s names it in HTML and plain text", (key) => {
    const email = renderEmail(key, emailManifest[key].fixture);
    expect(email.html).toContain('Folevi is operated by <a href="https://www.spacecherries.com"');
    expect(email.html).toContain(`Space Cherries LLC</a>, ${ADDRESS}.`);
    expect(email.text.replace(/\s+/g, " ")).toContain(OPERATOR_LINE);
    // The markers never reach a reader.
    expect(email.html).not.toContain("fv-operator");
    expect(email.text).not.toContain("fv-operator");
  });

  test.each(TEMPLATE_KEYS)("%s on a Folevi Server leaves it out", (key) => {
    const email = renderEmail(key, emailManifest[key].fixture, { operator: false });
    expect(email.html).not.toContain("Space Cherries");
    expect(email.text).not.toContain("Space Cherries");
    expect(email.html).not.toContain("fv-operator");
    expect(email.text).not.toContain("fv-operator");
    expect(email.text).toMatch(/A quieter place for ideas that keep growing\.\n$/);
  });
});
