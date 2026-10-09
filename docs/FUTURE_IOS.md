# Future iOS client (intentionally not built)

iOS, iPadOS, Android and Windows apps are out of scope for this delivery. Nothing in the repository
targets them, and the marketing site doesn't mention them. This note records how an iOS client would be
added without changing the backend or the other clients.

## What already carries over

Folevi for Mac is now the web app in Electron (`docs/DESKTOP.md`). The native Swift Mac app, with the
Swift layers and generators mentioned below, is archived on the git tag `native-mac-archive`; an iOS client
would start from there.

- **Backend API**: the native data path is platform-neutral and consists of `users:me`, `users:bootstrap`,
  `users:registerSession({client})` (add `"ios"` to the validator), `sync:head`, `sync:pullJson`,
  `sync:pushJson`, and the task/document/search/comment functions the native Mac app used.
- **Identity**: Authorization Code + PKCE against Folevi's own accounts (Better Auth in Convex,
  `convex/lib/nativeAuth.ts`, `docs/AUTH_DECISION.md`), with an iOS callback, so the backend keeps
  trusting a single issuer and the same session-revocation checks apply.
- **Schema**: the archived `BlockSchema.swift` generator (plain Foundation, no AppKit) from the same spec.
- **Domain / Sync / Data**: the archived Mac app's `Domain/`, `Sync/` (reducer + engine) and `Data/` (SQLite
  store, Convex service, Keychain) layers are written against Foundation and the Convex Swift client
  (which supports iOS), so an iOS target could reuse them as a Swift package (`FoleviKit`).
- **Design tokens**: bring back the archived Swift generator with a `UIColor` variant.
- **Golden fixtures**: the same ranks, document and sync-scenario fixtures must pass on iOS.

## What would be new

- A UIKit/SwiftUI editor (UITextView per block, touch reordering, iPad keyboard shortcuts).
- iOS navigation (split view on iPad, stack on iPhone), share extension for quick capture, widgets.
- Push notifications (APNs) for mentions and reminders. Needs a push token table and a sender action.
- App Store review items: account deletion in-app (already supported by the API), privacy labels.

## Constraints to keep

- Never use Resource Owner Password Grant; Authorization Code + PKCE only.
- Tokens only in the Keychain; offline data in the app container.
- Same sync protocol and the same “Saved only after acknowledgement” rule.
