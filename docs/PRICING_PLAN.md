# Pricing and marketing plan

Status: approved 2026-11-27; being built on branch `claude/pricing-2026-11-27` (own AI key on its own branch).

## The idea in one paragraph

Folevi is free on every platform, with every feature. People can keep notes on their own devices, sync them
through iCloud Drive, Dropbox, Google Drive or any folder, or run their own Folevi Server, and none of that
costs anything. Foli AI is free too when they add their own Anthropic, OpenAI or Google Gemini key. The only
thing we charge for is Folevi Cloud: our storage, our sync and our AI credits. Folevi Cloud has a free tier
of its own (500 MB and 30 AI credits a month), so a person can try all of it without paying.

## Decisions so far

These came from the owner on 2026-11-27.

| Question | Decision |
| --- | --- |
| Plan shape | Keep one ladder: Free, Core, Pro, Pro AI |
| Free AI | A small monthly allowance: 30 credits a month |
| Own AI key | Everyone can use one, on any plan or with no account, free and without credits |
| Providers at launch | Anthropic (Claude), OpenAI, Google Gemini |
| Where the key lives | On the device; synced end-to-end encrypted for Folevi Cloud accounts |
| Prices | Lower, rounded to whole dollars, with less storage (below) |
| Free device limit | Removed |
| Trial | Keep the 7-day Pro AI trial |
| Teams | Keep, on a Personal / Teams toggle on the pricing page |
| Deliverable | This plan first, then the build |
| Pages | Home, Pricing, Foli AI, Server, Downloads, Features, Compare, Docs |

## Proposed Folevi Cloud plans

| | Free | Core | Pro | Pro AI |
| --- | --- | --- | --- | --- |
| Monthly | $0 | $2 | $4 | $10 |
| Yearly | $0 | $20 | $40 | $100 |
| Storage | 500 MB, shared with free workspaces | 5 GB | 10 GB | 25 GB |
| AI credits a month | 30 | none included | 150 | 450 |
| Credit packs | yes | yes | yes | yes |
| Own AI key | yes | yes | yes | yes |
| Devices | unlimited | unlimited | unlimited | unlimited |

Team prices are the same numbers per member seat. Guests stay free.

Today's plans, for comparison: Core $1.99 (10 GB, no AI), Pro $4.99 (10 GB, 180 credits), Pro AI $13.99
(50 GB, 550 credits). Yearly today is $19, $49 and $159.

Why these numbers:

- Round prices, all lower than today: $2, $4 and $10 a month. The page reads as "free, or a few dollars".
- Storage is smaller than today (owner's call, 2026-11-27): 5 GB, 10 GB and 25 GB. Notes are small; 5 GB
  holds years of text and a good number of images. People with large files can use their own cloud for free.
- Yearly is 10 months of the monthly price on every tier ($20, $40, $100). Today the discount is uneven:
  Pro AI yearly ($159) is a smaller saving than Core or Pro.
- Credits drop in line with the price: Pro 150 (from 180), Pro AI 450 (from 550). One credit is $0.01 of
  model cost (`docs/AI_ASSISTANT.md`), so the most AI a Pro AI person can use in a month is $4.50 on a $10
  plan, and Pro is $1.50 on $4. Most people use far less than their allowance. Free is at most $0.30 per
  active free person a month.
- Polar takes a fee on each payment, which matters more on a $2 plan. Yearly billing keeps that fee to one
  charge a year, so the pricing page should default to yearly.
- Credit packs round to 500 for $8 and 1,000 for $15, valid 12 months, and open to every plan. That
  gives people a way to get more AI without moving up a storage tier. Today only Pro and Pro AI can buy
  them.

### What changes for Core

Core today blocks Foli AI completely, and the billing doc promises "nothing is sent to an AI model". With own
keys allowed everywhere, Core becomes the plan with no included credits: a Core person can still use Foli AI
with their own key or a credit pack.

The privacy promise moves to a setting every plan gets: Settings, Foli AI, "Turn off Foli AI". When it is
off, the server refuses every AI request for that person's Personal, as Core does today. Workspace owners
get the same switch for a workspace. This keeps the guarantee for the people who chose Core for that reason,
and makes it available on Free too.

### Existing subscribers

Folevi has no paying users yet (owner, 2026-11-27), so there is nothing to carry over: everyone gets the new
plans.

### Trial

Every new Folevi Cloud account still gets Pro AI for 7 days with 100 credits and no card. When the trial
ends the account moves to Free, which now keeps 30 credits a month. The "trial ended" message changes from
"Foli AI comes with Pro and Pro AI" to telling people they still have 30 credits a month and can add their
own key.

## Bring your own AI

Foli AI works with a person's own key from Anthropic, OpenAI or Google Gemini. It is free, it uses no
credits, and it is not limited by plan. The hourly abuse limit still applies on Folevi Cloud, because our
server does the work.

Where the key is used:

| Library | Who calls the AI provider | Where the key is stored |
| --- | --- | --- |
| On this device, or synced through iCloud Drive, Dropbox, Google Drive or a folder | The app, directly | The device keychain (Windows Credential Manager, Linux Secret Service, Android Keystore) |
| Folevi Server (self-hosted) | The person's server | Server settings for a server-wide key, or each person's own key as below |
| Folevi Cloud | Our server, for that one request | The device keychain, synced end-to-end encrypted to the person's other devices |

On Folevi Cloud, Foli AI's tools (search notes, edit pages, make flowcharts) run on our server, so the server
has to make the model call. The app decrypts the key on the device and sends it with each request over TLS.
The server uses it for that request and never writes it to the database or to logs. The privacy and security
pages must say exactly that, and not claim the key never reaches our server.

Open technical points for the build:

- Find out which apps run Foli AI in local libraries today. `FoliChatModel` in `apps/native-kit` is the Mac
  and iPhone chat; the Windows, Linux and Android apps need checking. Local libraries with no AI at all need
  an on-device path that calls the provider straight from the app.
- `convex/lib/ai/provider.ts` already routes Gemini and OpenAI-compatible calls with an `apiKey` for Folevi
  Server. The per-request own key reuses that route and adds Anthropic through `convex/lib/ai/anthropic.ts`.
- `metered()` in `convex/lib/credits.ts` must skip the credit hold and charge when the request carries the
  person's own key, and the usage view should show those requests as "Your key" with no credits.
- Each provider needs a model picker with a sensible default, and a "Test key" button that makes one cheap
  call.

Later candidates, not at launch: Mistral, OpenRouter, Ollama and LM Studio for fully local models, and any
OpenAI-compatible URL.

## Pricing page

The page leads with what is free, then the Folevi Cloud plans. Proposed order:

1. Heading and short intro.
2. A "Free on every device" block: the list of what costs nothing.
3. Folevi Cloud plans: Personal / Teams toggle, monthly / yearly toggle, four cards.
4. A "Use your own AI" strip with the three provider names.
5. What a credit buys (today's examples: about 1 credit to rewrite a paragraph, about 2 to ask about your
   notes, 3 to 5 for a flowchart).
6. Full comparison table.
7. FAQ.

Draft copy for the top of the page:

> # Folevi is free. Pay only if you want our cloud.
>
> Every Folevi app is free on Mac, iPhone, iPad, Android, Windows, Linux and the web, with every feature.
> Keep your notes on your devices, sync them through iCloud Drive or Dropbox, or run your own Folevi Server.
> Add your own Claude, ChatGPT or Gemini key and Foli AI is free too. Folevi Cloud is for when you want us
> to store your notes, sync them and run Foli AI for you.

Draft "Free on every device" list:

- The apps for Mac, iPhone, iPad, Android, Windows and Linux (Beta), and the web app
- Unlimited notes, docs, tasks and databases
- Sync through iCloud Drive, Dropbox, Google Drive or any folder you choose
- Folevi Server (Beta) on your own computer, NAS or cloud server
- Foli AI with your own Anthropic, OpenAI or Gemini key
- End-to-end encryption and export to Markdown, HTML, PDF or ZIP

Card blurbs:

- Free: "Try Folevi Cloud. 500 MB and 30 AI credits a month."
- Core: "More room in Folevi Cloud. Use AI with your own key or a credit pack."
- Pro: "Room for files and images, and Foli AI most days."
- Pro AI: "For people who use Foli AI all day."

### FAQ changes

Rewrite or add:

- Are the apps free? Yes, all of them, with every feature. Lists every platform.
- What do I pay for? Only Folevi Cloud storage, sync and AI credits.
- Can I use Foli AI without paying? Yes: 30 credits a month on Free, or your own key on any plan, or with no
  account.
- Which AI providers can I use? Anthropic, OpenAI, Google Gemini.
- Where is my key stored? The answer from the table above, including the Folevi Cloud request path.
- Does my own key use credits? No.
- How does the trial work? Ends on Free with 30 credits a month.
- Can I turn Foli AI off? Yes, on every plan.
- Can I self-host? Yes, free, Folevi Server is in Beta.

Remove: "Why does Core have no AI?" and "What counts as a device?" (no device limit anywhere now). The
answers about storage, packs, resets, teams, guests, cancelling, taxes and downgrading stay, updated to the
new numbers.

## Other pages

Home (`apps/web/src/app/(marketing)/page.tsx` and `components/marketing/home/`): the hero says the apps are
free on every platform. `YourFiles.tsx` becomes the "your notes, your storage" section with iCloud Drive,
Dropbox, Google Drive, a folder and Folevi Server. `PricingSection()` in `Closing.tsx` shows Free first,
then a single line "Folevi Cloud from $2 a month" linking to /pricing.

Foli AI (`/foli-ai`): a section near the top on the three ways to run it: 30 free credits on Folevi Cloud,
a paid plan, or your own key. Provider logos are text names only unless we have permission to use the marks.

Server (`/server`): "Free to run yourself." Add own AI keys (server-wide or per person) and the Beta label.

Downloads (`/downloads`): one line under the heading that every app is free with every feature, and no
account is needed.

Features (`/features`): remove plan badges on features that are free everywhere. Keep plan notes only on
storage and AI credits.

Compare (`/compare`): add rows for "Free apps on every platform", "Sync with your own cloud", "Self-host" and
"Bring your own AI key".

Docs: every help article that mentions plans, credits, the device limit or Core having no AI.

In the apps: Settings, Plan and billing on web, Mac, iPhone, Android, Windows and Linux; the upgrade prompts
when credits or storage run out; onboarding; the trial-ended message; App Store, Play Store and Microsoft
Store descriptions.

## Build steps

1. Catalog. Update `convex/lib/plans.ts`: `PRICES`, `STORAGE_BYTES`, `MONTHLY_CREDITS.free = 30`, Free
   `devices: null`, `creditPacks` on every tier, `AVAILABILITY`, and the card blurbs and feature lists. Then
   `docs/BILLING.md` and the billing tests in `tests/convex/`.
2. Core and the AI off switch. Replace the Core block (`tierHasAi`) with a per-person and per-workspace
   setting, enforced on the server where the Core check is today.
3. Device limit. Remove the Free limit in the server check and every "sign out of another device" prompt.
4. Polar. Change the prices on the existing Polar products (Admin, Billing setup shows mismatches until
   they match). The owner does this in Polar, then moves existing subscriptions to the new prices.
5. Own AI key. Settings screen on every app, keychain storage, encrypted sync for Folevi Cloud accounts, the
   per-request route in `provider.ts`, Anthropic support, `metered()` skipping credits, usage view, and the
   direct-call path for local libraries.
6. Marketing pages and FAQ, then help docs.
7. In-app copy, onboarding, store listings.
8. Parity. Windows and Linux get the own-key settings and new billing screens in the same work, or the gap
   goes in `docs/DESKTOP_PARITY.md`.

Steps 1 to 4 can ship as one change. Step 5 is the largest and should be its own branch. Steps 6 and 7
depend on the final prices but not on step 5 being finished, as long as the own-key copy waits for step 5 to
land.

## Questions still open

- Do existing subscribers keep today's storage and credits after moving to the lower price (recommended)?
- Should Folevi Server be able to buy Foli AI credits through Folevi Connect, as it can use Folevi AI today
  with a Connect token? If so, at what price?
- Is the name "Folevi Cloud" right for our hosted service on the marketing pages?
