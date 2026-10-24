---
name: no-em-dashes
description: Never write the em dash (—) anywhere; write copy with the human-writer skill
metadata:
  node_type: memory
  type: feedback
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-09-29T14:04:00.190Z
---

Never use the em dash character "—" in any text: UI copy, emails, docs, comments, commit messages, chat replies. Use a comma, colon, parentheses, a full stop, or "-" for an empty value. Write product copy per the human-writer skill (plain verbs, no puffery, no "not X but Y", no participle tails).

**Why:** the user (2026-09-29) sees the em dash as an AI-writing tell and had every copy in the website and app rewritten without it.

**How to apply:** check new copy for "—" before committing; `grep -rn '—'` should stay empty outside third-party files. Related: [[no-os-default-controls]].
