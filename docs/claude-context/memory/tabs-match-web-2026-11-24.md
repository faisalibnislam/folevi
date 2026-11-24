---
name: tabs-match-web-2026-11-24
description: "Owner's 2026-11-24 rule: Mac, iPad and Android tablets/Googlebooks open pages in new tabs exactly like the web app; system tabs on Mac/iPad, a web-like strip on Android"
metadata:
  type: project
---

Decided by the owner on 2026-11-24 (AskUserQuestion), for every platform with tabs:
- **Which actions open a new tab: exactly the web's rule.** A note from a list or card, See all, a folder card,
  a search or palette result, or a link opens a new tab that remembers its opener; Back with no history left in
  that tab closes it and returns to the opener. The sidebar and New Note open a fresh tab with no way back
  (same as [[tab-back-and-overview-2026-11-21]]). Mac, iPad, Android tablets and Googlebooks, anywhere it applies.
- **Look:** Mac uses the system tab bar under the toolbar (Finder, Safari); iPad keeps its tabs strip. Only the
  behavior copies the web.
- **Android tablets and Googlebooks:** a tab strip at the top on large screens with the same rules; phones stay
  single-page with Back.

**Why:** the owner wants tab behavior identical to the web app everywhere.
**How to apply:** when a native screen opens a page, check what the web does for that action (`DocTab.opener`,
`openNextFresh()`) and do the same.
