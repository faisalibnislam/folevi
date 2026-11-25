---
name: foli-ai-multi-provider-decisions
description: 2026-11-25 owner decisions for Foli AI on Gemini, OpenAI and Anthropic: encrypted admin keys, provider per feature, 3 model slots, no fallback, real-cost credits
metadata:
  type: project
---

Owner decisions on 2026-11-25 (server-side Foli AI, not local mode):
- **Keys:** entered in the admin panel, stored encrypted in Convex (server-only encryption secret env var); shown only as set + last 4. Env vars (GEMINI_API_KEY etc.) still work as a fallback. Gemini gets the same field.
- **Provider per feature:** one picker per usage-card feature: chat, agent, writing (incl. diagrams, tables, stickies, mind maps), research, attachments, digests, routines, knowledge graph, other.
- **Stay on Gemini always:** search embeddings and audio transcription. Web research uses the chosen provider's own web search tool.
- **No fallback** to another provider when a feature's provider fails or has no key: the person sees the error.
- **Credits follow real cost** per provider list price (30% margin rule stays automatic).
- **Three model slots per provider**, all editable in the admin panel: Fast (plumbing), Main (normal answers), Heavy (agent tool loop, web research, reading files/images, very long notes over ~50k tokens), chosen by request type before the call.
- **Defaults ("cheap first everywhere")**: Gemini Flash-Lite / Flash-Lite / 3.8 Flash; Claude Haiku 5.5 / Haiku 5.5 / Sonnet 5.5; OpenAI GPT-6 Luna / Luna / GPT-6.1 Sol.

**Why:** owner wants OpenAI and Anthropic as first-class options without losing cost control.
**How to apply:** don't add cross-provider fallback or flat pricing without asking. Related: [[pricing-2026-09-29]], [[assistant-named-foli]].
