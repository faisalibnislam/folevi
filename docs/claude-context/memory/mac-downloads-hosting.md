---
name: mac-downloads-hosting
description: Mac downloads and update feed live in Cloudflare R2 bucket folevi-updates, served through folevi.com/download/... (Vercel proxy), not updates.folevi.com
metadata:
  type: reference
---

2026-10-23: wrangler signed in (OAuth, account faisalibnislam@gmail.com, id ce348fe614cecd2e1ad1bd7dac387538); R2 enabled by the owner; bucket **folevi-updates** created; public r2.dev address https://pub-e55d5e1b47314fcbbbe3664ed7aed1c2.r2.dev. folevi.com DNS is at Namecheap (registrar-servers), so no R2 custom domain; the owner chose to serve files **through folevi.com/download/...** (Vercel rewrite to the r2.dev address). Mac download link and Sparkle feed use folevi.com/download/mac/... Related: [[mac-webkit-shell]], [[unified-version]].
