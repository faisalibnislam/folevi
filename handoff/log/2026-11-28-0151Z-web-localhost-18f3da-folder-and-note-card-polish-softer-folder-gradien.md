# Folder and note card polish: softer folder gradient and shadow, bigger subfolder cards, wider note spine, round spiral holes

- Date: 2026-11-28 01:51 UTC
- Area: web
- Branch: claude/web-localhost-18f3da

Owner feedback on 28 November 2026, made on the web and in the shared native card code (apps/native-kit, Mac and iPhone/iPad):

- Folder card front: the top-to-bottom gradient is a fifth of its old strength (globals.css --fc-f1/--fc-f2 now mix the old ends toward the middle) and the top-left highlight is 80% weaker. WebNoteCard.swift front() matches.
- Folder card drop shadow at half its opacity (light 0.03/0.21, dark 0.45).
- No pale box beside the folder tab: the shadow layer started at 21% of the card but the back's body beside the tab starts at about 30% (BACK_PATH's 16 of 100), so the shadow's top edge showed through the gap. It now starts where the body does (BACK_BODY_TOP), on web and Mac.
- A folder page's subfolder cards are 25% bigger (web --subfolder-card 114 to 143 px; Mac MacCards.s(152) to s(190)). Their name is 20% smaller than their other labels (--fc-name, SUBFOLDER_NAME = 0.8) and takes one line, cut by character, because at the 234/152 label scale two lines, the counts and the Edited date never fit and the date was cut off. FolderCardArt also drops to one line on any card under 144 px wide (a container query), as the Mac's nameLines does.
- Note card spine 25% wider (6% to 7.5% of the cover; the folder card's small notes too) with the spiral holes centred in it. The web's holes are now one radial gradient each (dot and ring), so they are true circles; the old 2.6cqw box with a box-shadow ring rendered squashed at fractional pixel sizes.
- /dev/folder-states shows the subfolder row as a folder page draws it (143 px, labels scaled, one-line name).

Not changed: the owner saw New folder in a folder close without making the folder (screen recording, right after signing in again). It did not reproduce from a fresh load on the dev deployment: short names and the parent's own name both made the folder at once, and nothing from the recorded attempts reached the server. Worth watching for after a session-ended sign-in.

Not run: native snapshot tests (FoleviScreensTests); their reference images for folder and note cards will need refreshing.
