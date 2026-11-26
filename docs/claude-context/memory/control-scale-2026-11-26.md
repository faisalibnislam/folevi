---
name: control-scale-2026-11-26
description: "Owner's 2026-11-26 rule: one control scale (36 px row controls, 44 on touch) for every field, button, dropdown and switch, on every platform"
metadata:
  type: project
---

On 2026-11-26 the owner asked for one consistent set of UI rules: "some elements are thicker (example: the filter
bar), some are thinner (example: buttons); use consistent rules/size/space for all UI elements, applied to everything
where applicable. Consistency is very important."

- Reference: All notes' toolbar (Filter notes, Sort, the three-way view switch) is "good": its 36 px is the height of
  every control that sits in a row, on the Mac, Windows, Linux and the web; 44 pt on touch (iPhone layout, Android).
- The Folders toolbar matches it: the filter as a field, Sort and the view switch as quiet controls, one filled button
  only for the main action. Every other toolbar follows (Drafts, Tasks, Calendar, Vault, Templates, Trash, dialogs).
- Scope: sizes and spacing, one border width and colour, one weight per role, one icon stroke; enforced by an ESLint
  rule and a Playwright audit.

**Why:** consistency across every screen matters more to the owner than per-screen tuning (it overrides the Mac
look's 28 pt buttons and the Folders page's tinted tray of 6 November).

**How to apply:** size controls only from docs/DESIGN_SYSTEM.md "Controls" (`h-control`, `h-control-sm`,
`size-control`, Button `md`/`compact`); keep `folevi/control-scale` and `e2e/control-scale.spec.ts` passing.
