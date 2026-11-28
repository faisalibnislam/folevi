# Menu bar note: the … button is round, as in Notlet

- Date: 2026-11-28 05:09 UTC
- Area: mac
- Branch: menu-bar-note

The panel's "…" button was a 34 by 30 pill beside the round-ended groups; it's now a 30 pt glass circle as tall as the groups, as Notlet's (the owner's design for the panel), with its hover highlight filling the circle (TopBar.swift, CapsuleItemButtonStyle's size). Snapshots re-recorded.

Also looked at, headless in WebKit and Chromium at the panel's size: before cfda843b and b453a6a8 the empty page lost keys typed while it switched to the editor ("Trip ideas" came out "Tip ideas") and its title sat 24 pt lower than the note's. The note now being made at once (b453a6a8) removes both, so no fix was needed for them. FoleviMenuBarNoteTests: 17 pass. Not tried in the real app.
