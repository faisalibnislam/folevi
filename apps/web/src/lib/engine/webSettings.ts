// What the page needs to know about the native apps' Settings without the bridge host (host.ts re-exports it).

/** The Settings sections the native app shows as web pages (everything else in Settings is native). */
export const WEB_SETTINGS_SECTIONS = new Set(["connected-apps", "workspace-data", "data", "ai", "security", "privacy", "workspace", "members", "workspace-guests", "workspace-billing", "workspace-privacy", "account"]);
