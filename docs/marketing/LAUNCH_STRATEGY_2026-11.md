# Folevi marketing strategy: the Apple apps launch (November 2026)

Owner decisions (2026-11-06): full revamp of the landing and marketing pages in the current design language;
speak first to people choosing a private notes app on Apple devices; the promise is "free forever, no account"
(the apps' "Keep notes on my devices" mode); the Mac app stays a direct DMG download; the iPhone and iPad app is
on the public App Store (link to follow, `APP_STORE_URL` in `apps/web/src/components/marketing/site.ts`);
comparisons focus on Craft, Obsidian, Notion and Evernote; preview first, release only on the owner's OK.

## 1. Positioning

> For people who want a beautiful, private notes app on their Mac, iPhone and iPad, Folevi is the native notes
> app that is free forever with no account, because your notes are files in a folder you pick (iCloud Drive,
> Dropbox, Google Drive or any folder) and nothing goes through our servers. Folevi Cloud adds the web app,
> sharing and teams when you want them.

- **One line:** Beautiful notes for Mac, iPhone and iPad. Free forever, no account.
- **Category:** a notes app (not a "workspace", not a "second brain"). Plain words people search for.
- **Two differentiators only:** (1) native Apple apps that are free with no account; (2) your notes are files in
  your own cloud. Everything else (themes, Foli DNA, tasks, Foli AI) is proof that it's a good notes app.
- **Villain:** subscriptions and lock-in: block limits, one-device free plans, AI bundled into price rises.
- **Hero:** the person and their notes. The product stays quiet.

## 2. Competitive brief (researched 2026-11-06)

| | Folevi | Craft | Obsidian | Notion | Evernote |
|---|---|---|---|---|---|
| Promise | Beautiful notes, free, your files | A beautiful space for notes and tasks | Private, lasting thinking | Teams and AI agents | A second brain |
| Native Apple apps | Yes | Yes | No | No | No |
| Use without an account | Yes, free forever | Not stated (sync needs one) | Yes | No | No |
| Notes as files you own | Yes, in your cloud | No | Yes (Markdown) | No | No |
| Free plan limits | None in the apps | 1,500 blocks, 1 GB | None | Solo unlimited, small uploads | 50 notes, 1 device |
| AI privacy | On-device (Mac) or your own key | Not stated | No built-in AI | Zero retention only on Enterprise | Not stated |
| Tone | Calm, warm, plain | Warm, aesthetic | Principled, technical | Corporate, AI-first | Salesy |

**Gaps Folevi can own:** beautiful and native and free with your own files (Craft has the looks without the
files, Obsidian the files without the polish); no account on Apple devices; bring your own cloud; private AI;
calm (Notion sells agents, Evernote sells upgrades); a friendly map of linked notes (Foli DNA).

**Threats:** Apple Notes is free and already installed; Craft's design reputation; Obsidian's community and
plugins; Notion's templates and brand. Answer each with a sourced compare page, not with claims on the home page.

**Per-competitor angle**
- *Craft:* "The same care for design, without the block limit, and your notes stay your files."
- *Obsidian:* "Linked notes that are files you own, in a native app that's ready the moment you open it."
- *Notion:* "A calm notes app for one person, native on Apple devices, that works fully offline."
- *Evernote:* "No 50-note limit, no one-device rule. Bring your notes and keep them free."

## 3. SEO audit (live site, 2026-11-06)

**Biggest strength:** clean technical base: canonical URLs, sitemap, robots, FAQPage, Breadcrumb and
SoftwareApplication data, sourced compare pages of 2,000+ words.

| Page | Issue | Severity | Fix |
|---|---|---|---|
| All | iPhone and iPad apps are not mentioned on Home, Pricing, Mac, Features; compare pages say "no iPhone app yet" | Critical (now false) | New copy everywhere; facts in `content/compare.tsx` |
| Home | H1 text reads "a digital workspace for notes, documentation, collaboration…" plus a duplicated typed copy; no target keyword | High | H1 "Folevi is a free notes app for Mac, iPhone and iPad"; keep the typed line hidden from assistive tech |
| Home | Title and description say "web and Mac" | High | Title "Folevi: free notes app for Mac, iPhone and iPad"; description with "no account" |
| Home | No FAQ | Medium | Add a FAQ with FAQPage data |
| /mac | Description 187 characters | Medium | Under 160 |
| /foli-ai | Description 218 characters | Medium | Under 160 |
| Site | No page for the iPhone and iPad apps | High | New `/apps` hub (nav "Apps"), `/mac` kept for "notes app for mac" |
| Site | `softwareLd` says operatingSystem "Web" | Medium | "macOS 15, iOS 18, iPadOS 18, Web" |
| Sitemap | `updated` dates from September | Low | Bump on the pages changed |
| /security | No structured data | Low | Leave for later |

**Keyword targets (no SEO tool connected; intent judged from search results)**

| Keyword | Opportunity | Intent | Page |
|---|---|---|---|
| free notes app for mac | High | Transactional | /, /mac |
| notes app for iphone and ipad | High | Transactional | /apps |
| notes app no subscription / no account | High | Transactional | /, /apps, /pricing |
| evernote alternative (free) | High | Switching | /compare/evernote |
| notion alternative for mac | High | Switching | /compare/notion |
| craft alternative free | Medium | Switching | /compare/craft |
| obsidian alternative native mac | Medium | Switching | /compare/obsidian |
| notes app that syncs with icloud / dropbox / google drive | Medium | Feature | /apps |
| private notes app | Medium | Feature | /, /security |
| beautiful notes app mac | Medium | Aesthetic | / |
| notes app with on-device ai | Rising | Feature | /foli-ai |
| local-first notes app iphone | Medium | Feature | /apps |

**Content plan (after launch):** a launch post ("Folevi is on iPhone and iPad, free with no account"); switch
guides from Evernote and Notion; "How Folevi keeps notes as files in iCloud" explainer; App Store screenshots
and a press kit.

## 4. Page plan

**Home (/)**
1. Hero note (kept: the live, editable note with the theme picker). Title: "Folevi is a free notes app for
   [your Mac / your iPhone / your iPad / your ideas / planning your week]". Body: free forever, no account, your
   folder; first things to try.
2. Get the apps: three tiles (Mac, iPhone and iPad, web) with real buttons and requirements. "New" sticker.
3. Your notes, your files: the places a library can live, what that means (servers never see them, Face ID lock,
   private Foli AI), with a folder replica.
4. Everything is in the free app (the current feature grid, reworded).
5. Note themes, the / menu, Foli AI, Find it again (kept, light copy edits).
6. Why people switch: a short, fair table against Craft, Obsidian, Notion and Evernote, linking each compare page.
7. Pricing: "Free forever on your devices. Folevi Cloud when you want it." The free app first, then the cloud plans.
8. FAQ (FAQPage data).
9. Final call to action: Download for Mac, App Store, Open the web app.

**Apps (/apps, new; nav "Mac app" becomes "Apps")**: every app on one page, the no-account promise, where notes
live, sync, requirements, FAQ, SoftwareApplication data.

**Mac (/mac)**: kept for search; adds the free no-account mode and links to iPhone and iPad.

**Pricing**: the free app card first, then the cloud plans; FAQ answers for the apps.

**Compare**: hub and six pages corrected (iPhone and iPad apps, no-account mode); the four focus pages get the
angles above and a "Use it without an account" row.

**Features, Foli AI, docs**: the apps and private AI where they are mentioned.

## 5. Voice (brand review checklist)

Plain, warm, short sentences. Say what it does, not what it "empowers". No em dashes. No hype words
("revolutionary", "seamless", "supercharge"). The assistant is "Foli AI". Claims we can prove from the product
or a source; competitor facts only with a source on the compare pages. "Free forever. No account." is the one
phrase we repeat.

## 6. Launch checklist

- [ ] Owner sends the App Store link; set `APP_STORE_URL` in `site.ts`.
- [ ] Release the site (owner's OK).
- [ ] App Store listing text matches the site's promise (owner edits metadata in App Store Connect).
- [ ] Launch post and social posts.
- [ ] Submit the new sitemap in Search Console.
