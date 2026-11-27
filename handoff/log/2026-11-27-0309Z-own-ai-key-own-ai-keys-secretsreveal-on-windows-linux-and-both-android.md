# Own AI keys: secretsReveal on Windows, Linux and both Android apps

- Date: 2026-11-27 03:09 UTC
- Area: windows
- Branch: claude/own-ai-key

Follow-up to the own AI key work (docs/AI_ASSISTANT.md, Your own AI key). PR 172 put `reveal` in the shared shell-bridge.js, which Windows and Linux also inject, so without a host handler they kept the key in the credential store and couldn't read it back for Folevi Cloud requests. Now:

- Windows and Linux: `secretsReveal` in apps/desktop/src-tauri/src/lib.rs, `SecretStore::reveal` in secrets.rs (only ai.openai, ai.anthropic, ai.google; never session tokens or library keys). Rust tests: 193 passed (a placeholder apps/desktop/web was made for the run and removed).
- Android: `reveal` in SecretsPlugin.kt and folevi-bridge.js in both apps/android (native) and apps/mobile/android (Capacitor). Both compile (`:app:compileDebugKotlin`); nothing was run on a device or emulator.
- iOS Capacitor uses the shared shell-bridge.js and FoleviShellPlugin, already updated in PR 172.

Not checked: the running Windows, Linux and Android apps.
