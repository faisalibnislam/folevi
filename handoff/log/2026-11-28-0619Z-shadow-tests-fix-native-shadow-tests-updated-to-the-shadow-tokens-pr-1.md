# Native shadow tests updated to the shadow tokens (PR 196 broke the Swift test build)

- Date: 2026-11-28 06:19 UTC
- Area: mac
- Branch: claude/shadow-tests-fix

PR 196 (one shadow hierarchy) left `swift test` unable to compile: `CardShadowTests` read `WebNoteCard.hoverShadows`
(now a function of the colour scheme) and `NativeShadowTests` read `NativeShadow.opacity/radius/y` (now `.pair`,
from the tokens). Both tests keep their checks on the new API: the card's shadow meets it through the hover (resting
to lifted), and the native levels go up in order (raised, card, lifted, floating, overlay) with the overlay still
light (at most 20% black, 22 pt).

Re-recorded 10 snapshots that PR 196's shadows changed (each passed on the commit before it): note-cards light and
dark, folder-cards light, phone-folder-cards light, home-picture light, dna-timeline-mac light and dark,
dna-note-iphone light, dna-iphone light and dark. The other images the recording rewrote were restored.

Checked: `swift build --build-tests`; `swift test --filter FoleviMacTests` (266 pass) and `--filter
FoleviDesignTests` (36 pass); the Mac app and the iOS Simulator app build. The app-hosted FoleviTests were not run.
