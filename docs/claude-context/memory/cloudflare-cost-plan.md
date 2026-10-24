---
name: cloudflare-cost-plan
description: 2026-10-23 owner decisions on moving costs to Cloudflare: files to private R2 with signed links, AI Gateway + Workers AI embeddings, compressed covers in apps; DNS, email and site images stay
metadata:
  type: project
---

2026-10-23 decisions (after the 1.0.00 release):
- **DNS stays at Namecheap** (so no Cloudflare email routing, no image resizing on folevi.com, no updates.folevi.com).
- **Files to R2:** private bucket (folevi-files), Convex checks access then hands out short-lived signed links; uploads go device to R2 the same way; Convex keeps records, permissions, E2EE metadata. Existing files copied in the background with hash checks; Convex copies deleted only after 30 days with no problems.
- **Foli AI behind Cloudflare AI Gateway:** spend and rate limits with prompt/answer logging OFF; cache repeated requests (never for encrypted spaces); search-by-meaning embeddings move to Workers AI (one-time reindex of every note).
- **Covers:** apps carry small compressed versions of every cover (~8 MB, so local mode/offline still work) and fetch full-size ones online.
- **Stays:** site images on Vercel; email-to-note on Amazon SES; sending on Resend; web app on Vercel; Convex backend.

**Why:** zero-egress storage and cheaper AI as plans promise 10 to 50 GB per person.
**How to apply:** R2 S3 API keys and the Cloudflare API token are secrets the owner creates and sets with `npx convex env set ... --from-file`; never enter them myself. Related: [[mac-downloads-hosting]], [[e2ee-decisions]].
