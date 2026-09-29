# Billing: plans, AI credits and Polar

How Folevi charges for plans and AI, and how to set it up. The code: `convex/lib/plans.ts` (the one
catalog: every price and limit), `convex/lib/entitlements.ts` (storage), `convex/lib/credits.ts` (AI credits
and metering), `convex/lib/polar.ts` (Polar requests and webhook signatures), `convex/billing.ts` (Personal
billing, credit packs, the webhook), `convex/workspaceBilling.ts` (Team plans and seats),
`convex/adminBilling.ts` (admin tools), `convex/billingSetup.ts` and `convex/lib/billingProducts.ts` (Admin →
Billing setup: the Polar products), `convex/migrations.ts` (`migratePlanTiers`).

## Plans

The same four plans exist for Personal and for Team (a workspace). Team prices are per member seat. A
personal plan covers the person's Personal only; a team plan covers that workspace only. Each has its own
storage and its own AI credits, and neither ever changes the other.

|                       | Free                  | Core                     | Pro                      | Pro AI                                   |
| --------------------- | --------------------- | ------------------------ | ------------------------ | ---------------------------------------- |
| Personal price        | $0                    | $1.99 a month or $19 a year | $4.99 a month or $49 a year | $12.99 a month or $149 a year        |
| Team price, per member | $0                   | $1.99 a month or $19 a year | $4.99 a month or $49 a year | $12.99 a month or $149 a year        |
| Storage               | 1 GB in total, shared (below) | 20 GB per person | 20 GB per person         | 50 GB per person                         |
| AI credits a month    | 25 per person         | none: Core has no AI     | 180 per person           | 550 per person ("Unlimited AI, fair use") |
| Credit packs          | no                    | no                       | 500 for $7.99, 1,000 for $14.99 | same                              |
| Devices (Personal)    | 2                     | unlimited                | unlimited                | unlimited                                |
| Members               | unlimited, nobody billed | unlimited, each billed | unlimited, each billed | unlimited, each billed                 |
| Guests                | free                  | free                     | free                     | free                                     |

- **Trial:** every new account gets a 7-day Pro AI trial with 100 AI credits for the whole trial (a fixed
  allowance, not prorated: 100 credits is at most $1 of AI cost). No card. When it ends the account is on
  Free unless they chose a plan; choosing a plan ends the trial.
- **Core** is the plan without AI, and says so plainly: nothing is sent to an AI model. The server refuses
  every AI request in a Core Personal or a Core workspace, for everyone there (the owner, members and
  guests), and never sends a Core scope's pages to AI from anywhere else either. A person on Core Personal
  has no personal credits, so they have no AI in free workspaces or as a guest either. The app hides every
  AI entry point in a Core scope; the server check is what enforces it.
- **Members** have no plan limit. (An admin-set `memberLimit` on each workspace row still exists as an abuse
  control; new workspaces get 50. Raise it in the admin console when a team needs more.)
- **Devices:** Free Personal allows 2 signed-in devices; every other plan has no limit
  (`convex/lib/devices.ts`). Workspace plans never change a person's device limit.

### Storage

- **Free pool:** an owner's Personal (while it's on Free, not trialing or paid) and every free workspace
  they own share one 1 GB limit. Every upload in those workspaces, by anyone, counts against the owner's
  pool. When the owner's Personal is on a paid plan (or the trial), their Personal has its own room and
  their free workspaces share a 1 GB pool among themselves.
- **Paid workspaces (Core, Pro, Pro AI):** each member has the plan's storage for themselves in that
  workspace (20 or 50 GB), not pooled. Their uploads count against their own quota there
  (`workspaceStorage` rows; each file records `chargedTo`).
- **Guests' uploads** count against the workspace scope they're in: in a free workspace, the owner's pool;
  in a paid workspace, the quota of the page's creator (or, if that person is no longer a member, the
  workspace owner's). A guest's own storage is never used.
- **Admin overrides:** a workspace with a storage override has that one total limit (no pool, no
  per-member quota). A person's override replaces their Personal limit (on Free, the pool's).
- Over a limit, only growth is refused: everything stored stays readable, and deleting frees room.

## AI credits

- **1 credit = $0.01 of what Gemini charges Folevi**, so no plan can cost more in AI than it earns. The
  rates live in one place, `GEMINI_PRICES` in `convex/lib/credits.ts` (January 2027 list prices):
  Gemini 3.8 Flash $1.50 per 1M input tokens and $7.50 per 1M output tokens; Flash-Lite $0.30 and $2.50.
  Thinking tokens bill as output. A model not listed is priced as Flash.
- **Metering:** every Gemini call reports `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`,
  `thoughtsTokenCount`). A request's calls are priced in whole nano-dollars and charged
  `ceil(cost / $0.01)` credits, at least 1. Streamed answers use the last usage metadata in the stream
  (it's cumulative). A stream stopped before any usage arrived is estimated from the characters sent and
  received. A reply that fails after Gemini answered is still charged (Gemini billed it); a refused request
  costs nothing.
- **Before a request** (`ai.begin`), the server holds a conservative estimate: every planned call at its
  full input (characters / 4) and its maximum output. If there aren't enough credits it refuses with
  `out_of_credits` ("You've used this month's AI credits. They reset on October 1." plus "Buy more" on Pro
  and Pro AI, "Upgrade" on Free). The hold keeps parallel requests from spending the same credits. When the
  request ends (`ai.settle`, however it ends) the hold is released and the real cost charged. If the real
  cost is more than what's left, the balance goes to zero and the difference is recorded (`overrun` on the
  period row), never charged later.
- **Whose credits:** a member's seat in a paid workspace uses that workspace's monthly credits (180 or
  550) plus packs bought for that seat. Everything else uses the person's own personal credits: their
  Personal, free workspaces (so a Free person has 25 a month there), and pages they're a guest on.
- **Periods:** monthly credits reset each month of the billing period (anchored on the period's start, so
  yearly plans also reset monthly); Free resets each calendar month (UTC); the trial has one allowance
  for the whole trial. A new period is a new `aiCreditPeriods` row.
- **Packs** (`aiCreditPacks`): 500 for $7.99 or 1,000 for $14.99, one-time, Pro and Pro AI only. A pack is
  bought by and belongs to one person in one scope (their Personal, or their seat in one workspace), so
  heavy users pay for themselves; packs aren't pooled for a workspace. They last 12 months from purchase
  and are used after the monthly credits, soonest-expiring first. If a workspace drops to Free, packs
  bought for a seat there wait (still expiring) until it's paid again. Admin grants are packs with source
  "admin" and the length the admin chose.
- **Abuse limit:** the hourly `ai` (150 requests) and `aiHigh` (300, Pro AI) rules in
  `convex/lib/rateLimit.ts` still apply per person per scope. The credits are the real limit.
- **Cheap tasks** (a title, fixing spelling, rewrites of up to 1,500 characters) use Flash-Lite. Ask AI
  and longer writing use the main model.
- **Usage records** (`aiUsage`, per person per scope per day): requests, credits, tokens in and out. Never
  prompts, notes or answers.

Typical costs: a rewrite about 1 credit, Ask AI about 2 to 4, a flowchart 3 to 5, "Catch me up" about 2.

## Payments: Polar

Polar is the merchant of record: it runs checkout, charges the card, handles sales tax and VAT, sends
receipts and runs the customer portal. Folevi keeps no card data.

- **Customers:** one Polar customer per person, with `external_id` = their Folevi profile id. A Team
  subscription is paid by the person who started it (their own customer), with the workspace in its
  metadata. Only that person can open the portal for it; any billing manager can change, cancel or resume
  the plan from Folevi (server-side subscription updates).
- **Checkout** (`billing.checkout`, `billing.buyCredits`, `workspaceBilling.checkout`): an authenticated
  action picks the product on the server from the tier and interval the client names; seats are counted
  on the server (billable members; guests and pending invitations never count); metadata carries the
  internal ids (`kind`, `profileId`, `workspaceId`, `pack`). The client never sends a price, product id,
  seat count or owner. Returning from checkout grants nothing: access and credits come only from webhooks.
- **Webhook:** `POST https://<deployment>.convex.site/webhooks/polar`. Standard Webhooks signature
  (`webhook-id`, `webhook-timestamp` within 5 minutes, `webhook-signature` HMAC-SHA256 under the secret:
  the base64 part after `whsec_`, or, for Polar secrets made before September 2026, the whole string; both
  are tried). Each delivery id is applied once (`billingEvents`); payments and packs are keyed by order id;
  a subscription event older than the last one applied is ignored; an event about an old subscription never
  ends a newer one. Handled: `subscription.*` (created, active, updated, canceled, uncanceled, past_due,
  revoked...), `order.paid` (plan payments and credit packs), `order.refunded` / `order.updated` (refunds:
  a full refund marks the payment refunded; any refund of a pack removes that share of its unused credits).
- **Seats:** when members join or leave a paid workspace (or an account is suspended), a scheduled action
  sets the Polar subscription's `seats` to the current count (Polar prorates). Bursts are gathered into
  one update; failures are retried 4 more times with a growing delay.
- **API version:** every request sends `Polar-Version: 2026-10`.
- **Test mode:** without Polar settings, non-production deployments offer test purchases
  (`billing.testPurchase`, `billing.testBuyCredits`, `workspaceBilling.testPurchase`); production refuses
  them.

## Owner setup checklist (sandbox first)

Do everything in the Polar **sandbox** (sandbox.polar.sh) and a non-production Convex deployment first,
then repeat in production.

1. **Create the organization** and turn on seat-based pricing if Polar asks (Settings; the seat pricing
   guide lists it as a prerequisite).
2. **Create an Organization Access Token** (Settings → Developers) with the scopes products:read,
   products:write, checkouts:write, customer_sessions:write, subscriptions:read, subscriptions:write and
   customers:read. organizations:read is optional: with it, Billing setup links each product to its page
   in the Polar dashboard.
3. **Add the webhook endpoint** (Settings → Webhooks): URL `https://<deployment>.convex.site/webhooks/polar`
   (production: `https://fastidious-clownfish-123.convex.site/webhooks/polar`), format Raw, API version
   2026-10. Events: `subscription.created`, `subscription.active`, `subscription.updated`,
   `subscription.canceled`, `subscription.uncanceled`, `subscription.past_due`, `subscription.revoked`,
   `order.paid`, `order.updated`, `order.refunded`. Copy the secret (`whsec_...`).
4. **Set the Convex environment** (never in Vercel, never `NEXT_PUBLIC_`):

   ```sh
   npx convex env set POLAR_SERVER sandbox            # production: production
   npx convex env set POLAR_ACCESS_TOKEN polar_oat_...
   npx convex env set POLAR_WEBHOOK_SECRET whsec_...
   ```

   Add `--deployment <prod-deployment>` for production (never `--prod`: in a checkout whose `.env.local` points at a local backend it runs against that instead). `scripts/check-prod-env.mjs` warns (doesn't fail) while
   the token or webhook secret is missing or the server isn't production, and flags any leftover `STRIPE_*`
   variables and any Polar variable in the web app's environment. It doesn't check product ids (they live
   in the database); Admin → Billing setup shows which are missing.
5. **Create the 14 products from Admin → Billing setup** (owners only; the page needs `POLAR_SERVER` and
   `POLAR_ACCESS_TOKEN` from step 4). **Check Polar** lists the organization's products and finds each one: by the id already recorded, then the `POLAR_PRODUCT_*` env
   var, then the `folevi_key` metadata Billing setup puts on every product it makes (for example
   `{"folevi_key": "personal_core_monthly"}`), then the exact name. Products that match the catalog have
   their ids recorded (the `billingProducts` table, per Polar server); products that differ are shown with
   what differs. **Create missing products** does the same check, then creates only the products with
   nothing found and records their ids, so running it twice never makes a duplicate. Names, prices and
   intervals come from `convex/lib/plans.ts`, never from the page:

   | Product key               | Env var (fallback)                      | Product name                  | Type      | Price                          | Interval |
   | ------------------------- | --------------------------------------- | ----------------------------- | --------- | ------------------------------ | -------- |
   | `personal_core_monthly`   | `POLAR_PRODUCT_PERSONAL_CORE_MONTHLY`   | Folevi Core (monthly)         | Recurring | $1.99 fixed                    | Month    |
   | `personal_core_yearly`    | `POLAR_PRODUCT_PERSONAL_CORE_YEARLY`    | Folevi Core (yearly)          | Recurring | $19 fixed                      | Year     |
   | `personal_pro_monthly`    | `POLAR_PRODUCT_PERSONAL_PRO_MONTHLY`    | Folevi Pro (monthly)          | Recurring | $4.99 fixed                    | Month    |
   | `personal_pro_yearly`     | `POLAR_PRODUCT_PERSONAL_PRO_YEARLY`     | Folevi Pro (yearly)           | Recurring | $49 fixed                      | Year     |
   | `personal_pro_ai_monthly` | `POLAR_PRODUCT_PERSONAL_PRO_AI_MONTHLY` | Folevi Pro AI (monthly)       | Recurring | $12.99 fixed                   | Month    |
   | `personal_pro_ai_yearly`  | `POLAR_PRODUCT_PERSONAL_PRO_AI_YEARLY`  | Folevi Pro AI (yearly)        | Recurring | $149 fixed                     | Year     |
   | `workspace_core_monthly`  | `POLAR_PRODUCT_TEAM_CORE_MONTHLY`       | Folevi Team Core (monthly)    | Recurring | Seat-based, $1.99 per seat     | Month    |
   | `workspace_core_yearly`   | `POLAR_PRODUCT_TEAM_CORE_YEARLY`        | Folevi Team Core (yearly)     | Recurring | Seat-based, $19 per seat       | Year     |
   | `workspace_pro_monthly`   | `POLAR_PRODUCT_TEAM_PRO_MONTHLY`        | Folevi Team Pro (monthly)     | Recurring | Seat-based, $4.99 per seat     | Month    |
   | `workspace_pro_yearly`    | `POLAR_PRODUCT_TEAM_PRO_YEARLY`         | Folevi Team Pro (yearly)      | Recurring | Seat-based, $49 per seat       | Year     |
   | `workspace_pro_ai_monthly`| `POLAR_PRODUCT_TEAM_PRO_AI_MONTHLY`     | Folevi Team Pro AI (monthly)  | Recurring | Seat-based, $12.99 per seat    | Month    |
   | `workspace_pro_ai_yearly` | `POLAR_PRODUCT_TEAM_PRO_AI_YEARLY`      | Folevi Team Pro AI (yearly)   | Recurring | Seat-based, $149 per seat      | Year     |
   | `credits_500`             | `POLAR_PRODUCT_CREDITS_500`             | Folevi AI credits: 500        | One-time  | $7.99 fixed                    |          |
   | `credits_1000`            | `POLAR_PRODUCT_CREDITS_1000`            | Folevi AI credits: 1,000      | One-time  | $14.99 fixed                   |          |

   All in USD, taxes on Polar's default, no trial on Polar's side (Folevi runs its own). Team products use
   seat-based pricing with one volume tier from 1 seat up (the per-seat price); Folevi sets the seat
   count, so don't let customers change seats in the portal if Polar offers that option. Credit products
   say the credits last 12 months and are used after the monthly ones.

   - **Seat-based pricing** may need turning on for the organization first (Settings; the seat pricing
     guide lists it as a prerequisite). If it's off, creating the Team products fails and the page shows
     Polar's message; the products created before that are kept, so run it again once it's on.
   - **A product that differs** (a price, interval, name or type changed in Polar) is never edited or
     archived from Folevi. Fix it in Polar and check again, or use **Use this product anyway** (audited)
     to sell it as it is. A recorded product that Polar no longer lists (archived or deleted) is forgotten
     on the next check.
   - **Manual creation still works:** create a product by hand with the name, price and interval above
     (and the `folevi_key` metadata if you like), then Check Polar; or set its `POLAR_PRODUCT_*` env var.
     The id recorded by Billing setup takes precedence over the env var, and webhooks accept either, so a
     subscription started under an env var's id keeps working.
6. **Run the plan migration once on production** (after deploying this code): rows from before these
   plans read correctly without it, but it rewrites them for good. A dry run first shows what changes:

   ```sh
   npx convex run --deployment <prod-deployment> migrations:migratePlanTiers '{"dryRun": true}'
   npx convex run --deployment <prod-deployment> migrations:migratePlanTiers '{}'
   npx convex run --deployment <prod-deployment> migrations:planTierReport '{}'     # { subscriptions: 0, payments: 0 } when done
   ```

   It maps Personal Basic → Core, Personal Pro → Pro AI, Workspace Team → Pro, Workspace Business → Pro AI,
   is batched (100 rows a run, continuing itself) and idempotent (`catalogVersion: 2` marks done rows).
7. **Remove the old Stripe variables** from Convex (`npx convex env remove STRIPE_...`): they're unused.

## Testing in the Polar sandbox

1. Point a non-production Convex deployment at the sandbox (step 4 with `POLAR_SERVER=sandbox`), add the
   sandbox webhook endpoint for that deployment's `.convex.site` URL, and create the sandbox products from
   Admin → Billing setup (step 5). Product ids are recorded per Polar server, so sandbox ids are never
   used once `POLAR_SERVER` is production.
2. In the app, Settings → Plan & billing → Upgrade. Pay with Polar's test card (4242 4242 4242 4242, any
   future date, any CVC). Back in the app the plan changes within seconds, once the webhook arrives. Check
   the Convex logs for `billing.webhook` lines.
3. Buy a credit pack (Settings → Plan & billing → AI credits → Buy credits) on Pro: the purchased credits
   appear after `order.paid`.
4. Open "Manage billing": the Polar customer portal. Cancel there and watch the plan show "Ends ...";
   uncancel and it renews again.
5. Team: create a workspace, choose Pro in Settings → Workspace billing; the checkout shows one seat per
   member. Invite and accept a member: within a few seconds the subscription's seats go up (Polar shows the
   proration). Remove them: it goes down.
6. Refund an order from the Polar dashboard: the payment shows Refunded; a refunded pack's unused credits
   disappear.
7. Replays: Polar's dashboard can redeliver a webhook; it's answered 202 and changes nothing.

Local development without Polar: leave `POLAR_*` unset; Settings shows test purchases (plans and packs),
and `npx convex run testSupport:exhaustCredits '{"email": "you@example.com"}'` uses up a person's monthly
credits to see the out-of-credits state.
