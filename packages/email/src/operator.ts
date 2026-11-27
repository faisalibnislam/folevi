// The company that operates Folevi (the owner, 2026-11-27). Every email Folevi sends names it with its postal
// address in the footer. The website keeps the same details in apps/web/src/components/marketing/site.ts
// (OPERATOR); tests/convex/static/operator.test.ts fails if the two ever differ.
export const EMAIL_OPERATOR = {
  name: "Space Cherries LLC",
  url: "https://www.spacecherries.com",
  address: "5242 Elbetee Lane, Alexandria, VA 22312, USA",
} as const;

/** The footer's last line, as plain text. */
export const OPERATOR_LINE = `Folevi is operated by ${EMAIL_OPERATOR.name}, ${EMAIL_OPERATOR.address}.`;

// The operator line sits between these markers in the generated templates. renderEmail keeps the line (dropping
// the markers) on Folevi Cloud and removes it on a Folevi Server, which the person who runs it operates.
export const OPERATOR_HTML_START = "<!--fv-operator-->";
export const OPERATOR_HTML_END = "<!--/fv-operator-->";
export const OPERATOR_TEXT_START = "[fv-operator]";
export const OPERATOR_TEXT_END = "[/fv-operator]";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Keeps the operator line (without its markers) or removes it, with the newline that follows each marker. */
export function applyOperatorLine(body: string, start: string, end: string, keep: boolean): string {
  const block = new RegExp(`${escapeRe(start)}\\n?([\\s\\S]*?)${escapeRe(end)}\\n?`, "g");
  return body.replace(block, (_m, inner: string) => (keep ? inner : ""));
}
