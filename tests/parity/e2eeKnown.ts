// Parity scenarios that differ over an encrypted Personal, and why (tests/parity/e2ee.test.ts). Each entry
// names the reason and who it waits on; remove it when that lands.
export const E2EE_KNOWN: Record<string, string> = {
  "ai.ts: Foli AI: writing help, flowcharts (drawn, from text, extended, explained, relabelled, arranged), tables, sticky notes, charts, to-dos and translation send the same prompts and return the same checked results":
    "by design: Foli AI is off at Fully encrypted (§7.1); with it on, per-request context is WP8's aiRoute",
  "ai.ts: Foli AI: refusals before anything is sent read the same": "by design: Foli AI is off at Fully encrypted, so it refuses before the server's own checks",
  "collections.ts: collections: create in a note, rename, list for charts, the seeded shelf":
    "WP8: the seeded Reading Shelf is sealed by the seal migration (collections become records); the driver encrypts after seeding, so it stays in server tables",
  "users.ts: onboarding: starter notes once each, the Welcome note's theme, choices on the wrong step":
    "WP8: styling the seeded Welcome note needs it sealed first (the seal migration); the starter notes themselves are composed here",
  "history.ts: restore a version, undo the restore, and make a copy of a version":
    "WP3: a device can't make a before_restore version (createSnapshot takes idle, close or manual), and a sealed version's own title is inside its sealed content (the list shows the note's current title)",
};

/** Scenarios that differ only in the encrypted team workspace run, and why. */
export const E2EE_WORKSPACE_KNOWN: Record<string, string> = {};
