# Android native: Compose UI, all but the writing area

- Date: 2026-11-26 05:20 UTC
- Area: android
- Branch: claude/android-native-compose

Moved here from this branch's additions to `HANDOFF.md` when the handoff became a folder (PR 142). The lines are as the branch wrote them, from its current state, next steps and change log.

| Android | The Capacitor app on branch `claude/android-capacitor-197cf4` (PR 69); `apps/android` on `main` still holds the native Compose app (Gradle root `apps/android`, modules `engine`, `app`) | **Active** (owner, 2026-11-25: "we need Android"): 1.5.74 (build 89) on Play internal testing, PR 69 not merged yet. Ships until the native app replaces it in one switch; only serious bug fixes meanwhile (owner, 2026-11-25) |
| Android | `apps/android`: a native Compose app (Gradle root `apps/android`, modules `engine`, `app`); the Capacitor app is gone | **Resumed again 2026-11-25** (owner: rebuild the UI natively in Compose, everything but the writing area, "Today's UI, Material 3 native", one big switch). Work on branch `claude/android-native-compose`; plan section 6 of `docs/ANDROID_NATIVE_PLAN.md` |

- 2026-11-25 (late night): Android native, the last two web-side gaps fixed (PR 112), and `main` merged in.
  - Onboarding greets by first name: `OnboardingGateInfo.firstName`, contract revision 36, regenerated in Swift and Kotlin.
  - In dark mode a plain note's paper now runs up under the native top bar.

- 2026-11-25 (late): Android native onboarding and polish pass (PR 112).
  - Every gate is native, including the six onboarding steps, tested with fresh accounts.
  - Polish pass: accessibility, large text, motion scheme and reduced motion, palette tokens, landscape, short windows.
  - 115 app tests and 5 engine tests pass.

- 2026-11-25 (night): Android native, remaining screens done (PR 112).
  - New: native Insert sheet (catalogue generated with iOS's), Foli AI chat, Vault, Shared and Changes restyled, the web's tablet sidebar and tab strip, and the note bar's fold on scroll.
  - Checked: Cloud sign-in tested end to end on the emulator; 101 app tests and 5 engine tests pass.
  - What's left is in `docs/ANDROID_NATIVE_PLAN.md` section 6, "Finished".

- 2026-11-25 (evening): Android native, the whole phone UI except the writing area is built in Compose (PR 112, branch `claude/android-native-compose`):
  - Home and lists, the note page chrome, Tasks, Calendar, Search, the account sheet, New folder and Settings.
  - Checked with real data on the emulator in local mode; 92 unit tests pass.
  - Open items are in `docs/ANDROID_NATIVE_PLAN.md` section 6, "Where it stands".
  - How to test locally: an account-free Convex on ports 3310 and 3311 (`CONVEX_AGENT_MODE=anonymous npx convex dev --local-cloud-port 3310 --local-site-port 3311`), web on 3002, `adb reverse` for 3000→3002, 3002, 3310 and 3311.

- 2026-11-25: Android native: "Your own server" ported from the Capacitor app.
  - What moved: the server code, places, per-site sign-in, CSP, cleartext to home addresses, and the bridge.
  - A native block under the sign-in gate, like the web's (`ui/OwnServer.kt`).
  - The phone bar restyled with Folevi's glass and shadows (`design/Glass.kt`, `design/AiMark.kt`; owner: Capacitor app's UX, Folevi styling, Android ripple).
  - Robolectric 4.18.1 Compose UI tests (headless).
  - Results: 68 app tests pass; the sign-in gate is not yet checked on an emulator (it needs the dev server).
- 2026-11-25: Android native Compose resumed (owner, relayed by the iOS session). `apps/android` on `main` builds and its 59 unit tests pass; the phone bar now matches the web's (Home, Tasks, Calendar capsule plus Foli AI and + capsule, `ui/PhoneBar.kt`); gap plan in `docs/ANDROID_NATIVE_PLAN.md` section 6. Branch `claude/android-native-compose`.
