---
name: tab-back-and-overview-2026-11-21
description: "Owner's 2026-11-21 rules: Back in a tab opened from a page returns to the opener and closes the tab (Safari); Home's Show All Tabs picture is a drawn mini Home; screenshots fit whole"
metadata:
  type: project
---

Decided by the owner on 2026-11-21 (AskUserQuestion), for 1.5.60:
- **Back always works when needed.** A tab opened from a page (Home's See all and cards, folder cards, a note from a
  list, search and palette results, links) remembers the tab it came from. Back with nothing left in the tab's own
  history **closes the tab and shows the opener**, Safari's rule. The sidebar, "+" / New note (toolbar, menu,
  palette) open **fresh tabs with no way back**. A folder page's own New note keeps the way back. Mac, iPad and web
  (native `FrameTab.opener` / `TabsModel.canGoBack`; web `DocTab.opener`, `openNextFresh()`).
- **Show All Tabs, Home's picture:** drawn from data, a "Recent notes" row and a "Recent folders" row of cards
  (`HomePicture`), never a cropped window screenshot. Any tab still pictured by a screenshot is **fitted whole**.
  The web's overview still shows Home as its icon (no crop there).

- **Breathing room in Home's picture:** 32 pt between the notes' row and the folders' heading, laid out at 960 by 600
  and scaled; same on the web's overview now (`HomePicture.tsx`), so Mac, iPad and web match.
- **iPhone Home strips:** note and folder cards both **176 pt** wide, 12 pt apart, 12 pt under the folder row (the
  old 142 pt folder card cut its Edited date off and left a blank band before Tags). Every folder card drops its
  name to one line when two lines, the counts and the date can't all fit (`WebFolderCard.nameLines`).

**Why:** the owner hit a dead Back after Home's See all, and saw Home's picture cut off.
**How to apply:** new ways to open pages default to remembering their opener; mark sidebar-like entry points fresh.
Related: [[note-page-and-tabs-rules-2026-11-18]], [[frosted-folders-decision-2026-11-20]].
