# Website names Space Cherries LLC as Folevi's operator

- Date: 2026-11-27 02:01 UTC
- Area: web
- Branch: claude/space-cherries-operator

Owner, 2026-11-27: Folevi is operated by Space Cherries LLC (www.spacecherries.com), 5242 Elbetee Lane, Alexandria, VA 22312, USA. The owner asked for it in the footer, Terms and Privacy, the support page, and the search data.

- components/marketing/site.ts: OPERATOR and OPERATOR_ADDRESS, the one place the name and address are written.
- Footer (every marketing page): "© <year> Space Cherries LLC. Folevi is operated by Space Cherries LLC." with a link.
- Terms: the agreement is with Space Cherries LLC ("we" and "us"); the contact section gives the postal address. Date now November 27, 2026.
- Privacy: Space Cherries LLC is named as the operator and the controller; the contact section gives the postal address. Date now November 27, 2026.
- Support: "By mail" in Other ways to get help.
- seo.tsx organizationLd: parentOrganization with the name, URL and PostalAddress (home page only).
- test/operator.test.tsx.

Checked: vitest, tsc, eslint; in the browser: support, footer, terms at 375 px, and the home page JSON-LD.

Not done: the share image (opengraph-image.tsx) does not name the company; its art has no place for a company line. The Terms and Privacy still show their draft notice: a lawyer should review naming the controller and the governing law (Virginia) before the draft notice comes off.
