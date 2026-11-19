# Pricing and storage proposal

Status: approved 2026-11-19. The owner chose every proposed default (section 8). Nothing here is built yet; work
follows the order in section 7. Today's plans are in docs/BILLING.md and `convex/lib/plans.ts`.

The goal: no plan can lose money, even for its heaviest user, with no outside funding to absorb a bad month.

## 1. What things cost today

| Item | Price | Source |
|---|---|---|
| Convex Professional | $25 a month per developer | convex.dev/plans |
| Convex function calls | 25M a month included, then $2 per 1M | convex.dev/plans |
| Convex file storage | 100 GB included, then $0.03 per GB a month | convex.dev/plans |
| Convex file downloads | 50 GB a month included, then $0.30 per GB, no cap | convex.dev/plans |
| Convex database storage and bandwidth | about $0.20 per GB over the included amounts | from memory: check the dashboard |
| Cloudflare R2 | $0.015 per GB a month, downloads free, 10 GB free | cloudflare.com (R2 pricing) |
| Polar (Starter) | 5% + 50¢ per payment, +1.5% for cards outside the US | polar.sh/docs/merchant-of-record/fees |
| Gemini | metered: 1 AI credit = $0.01 of real cost | `convex/lib/credits.ts` |
| Vercel | about $20 a month if on Pro | owner to confirm |

Fixed costs are roughly $45 to $60 a month before anyone pays.

Function calls include every save, every live update pushed to an open page and every file access, so a
notes app that syncs as you type uses many. Foli AI also writes a streamed answer to the database every
90 ms (`FLUSH_MS` in `convex/ai.ts`), so one 20-second answer is a few hundred mutations plus a live update
for each.

## 2. What each plan earns after Polar

Monthly, US card:

| Plan | Price | Polar fee | Left |
|---|---|---|---|
| Core | $1.99 | $0.60 (30%) | $1.39 |
| Pro | $4.99 | $0.75 | $4.24 |
| Pro AI | $13.99 | $1.20 | $12.79 |

Yearly, per month: Core $1.46, Pro $3.84, Pro AI $12.55. A yearly plan pays the 50¢ once instead of 12 times.

## 3. Where a plan loses money today

The worst case is a person who fills their storage and downloads all of it once a month, after the
included Convex allowances are used up by others.

| Plan | Left after Polar | Storage | Downloads | AI (max) | Result |
|---|---|---|---|---|---|
| Core (10 GB) | $1.39 | $0.30 | $3.00 | none | **-$1.91** |
| Pro (10 GB) | $4.24 | $0.30 | $3.00 | $1.80 | **-$0.86** |
| Pro AI (50 GB) | $12.79 | $1.50 | $15.00 | $5.50 | **-$9.21** |

- Storage itself is cheap. **Downloads are the risk**: they're billed per GB with no upper limit, and our
  storage allowances are large (Obsidian Sync charges about $4 a month for 1 GB and $8 for 10 GB).
- AI can't lose money: credits are real Gemini cost, and every plan's credits are below its price.
- Core's monthly price is too small for a fixed 50¢ fee.

A typical person stores and downloads far less, so today's plans make money on average. But one heavy
account can wipe out the profit from many light ones, and nothing stops it.

## 4. Proposed plans

| | Free | Pro | Pro AI |
|---|---|---|---|
| Price | $0 | $5 a month or $48 a year | $15 a month or $144 a year |
| Storage | 500 MB (unchanged) | 10 GB | 50 GB |
| AI credits a month | trial only (unchanged) | 150 | 550 |
| Credit packs | no | yes (unchanged) | yes (unchanged) |
| Devices | 2 | unlimited | unlimited |

- **Core:** drop the monthly plan. If a plan without AI is worth keeping for privacy, sell it yearly only
  at $24 (10 GB, no AI). Owner's choice; see section 8.
- **Teams:** the same prices per member seat. A team pays in one charge, so the 50¢ isn't paid per seat.
- **Trial:** unchanged (7 days of Pro AI, 100 credits, at most $1 of AI).
- **Existing subscribers:** the 2026-09-30 report found none, so nobody needs grandfathering. Check again
  in Admin before switching.

Worst case per month with files on R2 (section 5), US card:

| Plan | Left after Polar | Storage | AI (max) | Result |
|---|---|---|---|---|
| Pro monthly | $4.25 | $0.15 | $1.50 | **+$2.60** |
| Pro yearly | $3.76 | $0.15 | $1.50 | **+$2.11** |
| Pro AI monthly | $13.75 | $0.75 | $5.50 | **+$7.50** |
| Pro AI yearly | $11.36 | $0.75 | $5.50 | **+$5.11** |
| Core yearly ($24) | $1.86 | $0.15 | none | **+$1.71** |
| Credit pack 500 ($7.99) | $7.09 | | $5.00 | **+$2.09** |
| Credit pack 1,000 ($14.99) | $13.74 | | $10.00 | **+$3.74** |

A card from outside the US takes 1.5% more (under 25¢ on any of these). About 20 Pro subscribers at the
worst case cover the fixed costs; at typical use, fewer.

## 5. Files on Cloudflare R2

Keep Convex for the database. Move file bytes to R2, which has free downloads and half the storage price.
That removes the one cost with no upper limit, and lets the 50 MB limit go (it exists because
`files.finalize` reads the whole file inside a 64 MB Convex action).

How it would work:

- **Uploads:** a Convex action checks the person, the scope and the quota, then returns a short-lived
  presigned R2 `PUT` URL. The browser uploads straight to R2. `files.finalize` checks the size with a
  `HEAD` and the type from the first bytes (a ranged `GET`), never the whole file.
- **Downloads:** the signed `/files/` route in `convex/http.ts` keeps every access check, then redirects
  to a presigned `GET` URL that lasts a few minutes, instead of streaming the bytes through Convex.
- **Encrypted files** (encrypted spaces, the Vault) are already encrypted in the browser, so R2 only ever
  holds ciphertext. Vault previews stay decrypted in memory, as today.
- **Existing files:** a background job copies each one from Convex storage to R2 and records the R2 key;
  reads use R2 once a file has a key and Convex storage until then. Convex copies are deleted only after
  a check that every file has been copied.
- **Code to change:** every `ctx.storage` caller (`convex/files.ts`, `convex/http.ts`, `convex/fileText.ts`,
  `convex/vaultFiles.ts`, `convex/e2ee/files.ts`, `convex/e2ee/links.ts`, `convex/exports.ts`,
  `convex/aiAttachments.ts`, `convex/lib/ai/attachmentFiles.ts`, `convex/lib/fileCopies.ts`,
  `convex/lib/identityImages.ts`, `convex/themes.ts`, `convex/adminThemes.ts`, `convex/mindmapAi.ts`,
  `convex/maintenance.ts`, `convex/e2ee/migrate.ts`), behind one storage module so callers don't know
  where bytes live. Evaluate the Convex R2 component (`@convex-dev/r2`) before writing our own signing.
- **Setup by the owner:** an R2 bucket for production and one for dev (separate from the backup and Mac
  update buckets), with API tokens limited to that bucket, set as Convex environment variables. CORS on
  the bucket for the web origins.
- **Backups:** `.github/workflows/backup.yml` exports Convex; the R2 file bucket needs its own backup
  plan (R2 to another bucket or provider).

## 6. Protection until R2 is live

- **A fair-use download cap:** count the bytes the `/files/` route serves per person per month, and refuse
  beyond 3 times the plan's storage (at least 2 GB), with a plain message and the date it resets. Shown in
  Terms as fair use.
- **Convex usage alerts:** turn on any usage alert or spending limit the Convex dashboard offers.
- **Fewer function calls:** write streamed AI text every 400 ms instead of 90 ms (`convex/ai.ts` and
  `apps/web/src/lib/local/ai/answer.ts`), then look at Convex's usage page for the functions called most
  and batch or slow those down.

## 7. Order of work

1. Fair-use download cap and the slower AI stream writes (small, protects us now).
2. New plans: `convex/lib/plans.ts`, docs/BILLING.md, the pricing page and Settings → Plan & billing,
   Terms, then new products from Admin → Billing setup in the Polar sandbox, then production. Old products
   are archived in Polar by hand.
3. Files on R2: the storage module, uploads and downloads, the copy job for existing files, then removing
   the 50 MB limit.
4. Later: Polar's Pro plan ($20 a month, 3.8% + 40¢) once revenue passes roughly $1,000 a month.

Each step is released separately, with the owner's OK to push.

## 8. Owner's decisions (2026-11-19: "go with the defaults")

1. Prices: Pro $5 a month or $48 a year; Pro AI $15 a month or $144 a year.
2. Core: dropped. The table in section 4 (Free, Pro, Pro AI) is the plan set; no yearly-only Core.
3. Storage: 10 GB for Pro and 50 GB for Pro AI, kept once files are on R2.
4. Pro's monthly credits: 150 (down from 180).
5. Download cap: 3 times the plan's storage, at least 2 GB a month.
6. Order: as in section 7. The download cap and slower AI stream writes first, then the new plans, then R2.
