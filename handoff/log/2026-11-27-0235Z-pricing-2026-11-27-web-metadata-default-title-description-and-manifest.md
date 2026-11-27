# Web metadata: default title, description and manifest now say digital workspace, not quiet notes app

- Date: 2026-11-27 02:35 UTC
- Area: web
- Branch: claude/pricing-2026-11-27

The owner never wants Folevi called a "quiet notes app". It is "a digital workspace", as the landing page says.

- `apps/web/src/app/layout.tsx`: default title is now "Folevi: a free digital workspace for every device" (same as the landing page). The default description uses the footer wording: notes, docs, tasks and databases, free on all seven platforms.
- `apps/web/src/app/manifest.ts`: the install description is "A digital workspace for notes, docs, tasks and databases."

Checked: `tsc --noEmit` in apps/web passes. Nothing committed.

Left: the related line "a quiet(er) place for ideas that keep growing" is still in the welcome note (`packages/editor-schema/src/seed.ts`), onboarding preview, and email sign-off (`packages/email`, with a test). I didn't change these because the owner only asked about "quiet notes app".
