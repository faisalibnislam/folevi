---
name: version-releases
description: "2026-10-29 owner's version rules: MAJOR.UPDATE.PATCH, no limits or rollover, Big update keeps PATCH, Major only on explicit word, version changes only in a requested release"
metadata:
  type: project
---

2026-10-29 owner: Folevi's version is MAJOR.UPDATE.PATCH (scripts/version.mjs, version.json, CHANGELOG.json).

- No limit on any number; PATCH at least two digits (1.0.00, 1.0.09, 1.0.10, 1.10.100, 1.100.1000); no other
  leading zeros (1.0.1, 1.0.001, 1.01.00 are invalid). No rollover anywhere.
- Small update: PATCH+1 (1.0.99 to 1.0.100). Big update: UPDATE+1, PATCH kept (1.0.05 to 1.1.05, 1.9.99 to
  1.10.99). Major release: MAJOR+1, then .0.00, only when the owner explicitly asks for a major release
  (`release major --authorize-major <v>`); never inferred from how big the changes are.
- The version never changes during ordinary work (fixes, features, finished tasks). Only when the owner asks for a
  release. "Release a big/small update" means exactly that kind. "Prepare a release" with no kind: run
  `node scripts/version.mjs prepare`, read the changes, choose Big (significant new features or capabilities) or
  Small (fixes, refinements, performance, maintenance), defaulting to Small when unclear, say why in a line, and
  never choose Major. The explicit kind always wins over a suggestion.
- Each release records summary, added, improved, fixed and breaking changes from the real changes only (nothing
  invented), its time, build and tag (`v<version>`, `node scripts/version.mjs tag`, never moved). History is never
  rewritten or deleted.
- Publishing or deploying a release still needs the owner's explicit OK (see [[push-after-changes]]).

**Why:** a predictable version the owner controls; Major milestones are the owner's call alone.
**How to apply:** use the release command only on request; report the kind chosen and the version it gives.
