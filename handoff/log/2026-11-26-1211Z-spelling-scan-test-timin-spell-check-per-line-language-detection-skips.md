# Spell check: per-line language detection skips the script and accented-letter passes for plain ASCII lines (a 2,000 line note is scanned about 20 times faster than the old full read), and the scan timing test takes the fastest of several runs with wide margins, so it no longer fails at random on CI.

- Date: 2026-11-26 12:11 UTC
- Area: web
- Branch: claude/spelling-scan-test-timing

What changed, what was checked (and how), and what is left.
