# Folevi Web Clipper: store listing

Everything the Chrome Web Store and Microsoft Edge Add-ons ask for, ready to paste. Upload `release/folevi-clipper-<version>.zip` (from `pnpm package`) to both stores; the same package works in Chrome and Edge.

## Listing

**Name:** Folevi Web Clipper

**Category:** Productivity (Chrome: Productivity > Tools; Edge: Productivity)

**Language:** English

**Short description** (Chrome summary, 132 characters at most):

> Save the article you're reading, or the part you selected, as a clean note in your Folevi Inbox.

**Detailed description:**

> Folevi Web Clipper saves what you read on the web into Folevi, the notes app.
>
> Open the clipper on an article and it keeps what matters: the text, headings, lists, quotes, tables, links and images. Menus, ads and comment threads stay behind. You get a tidy note in your Inbox, with a line at the top saying where it came from and when, so you can always find the original.
>
> What you can do:
> - Clip article: the clipper finds the article on the page and saves it as a clean note.
> - Clip selection: select a passage first and save just that.
> - Right-click anywhere and choose "Clip to Folevi" for the page, your selection or a link.
> - Change the title before you save.
> - Choose which place a clip goes to, if you use Folevi workspaces.
> - Open the new note in Folevi straight from the clipper.
>
> Private by design. The clipper asks Folevi for one permission: adding notes. It can't read, search or change anything you've already written. It reads a page only when you clip it, and sends the clip to your Folevi account and nowhere else. You can disconnect it at any time in Folevi under Settings > Connected apps.
>
> You need a Folevi account to use the clipper. Folevi has a free plan: https://folevi.com

**Homepage / support URL:** https://folevi.com/docs/web-clipper

**Privacy policy URL:** https://folevi.com/privacy (see "Before submitting" below)

**Support email:** support@folevi.com

## Single purpose

> Folevi Web Clipper saves the web page, selection or link the user chooses as a note in the user's Folevi account.

## Permission justifications

| Permission | Why the clipper needs it |
| --- | --- |
| `activeTab` | To read the page the user is on, and only when they open the clipper or choose "Clip to Folevi" on it. The clipper has no access to any other tab and never reads pages in the background. |
| `scripting` | To run the clipper's own bundled reader (Mozilla Readability and a Markdown converter) in that tab when the user clips, to turn the article or selection into a clean note. No code is fetched from anywhere. |
| `storage` | To keep the user signed in: the clipper's registration with Folevi and its OAuth tokens, plus the place they last clipped to. Stored in the browser's extension storage only. |
| `identity` | To sign in to Folevi with `chrome.identity.launchWebAuthFlow`: Folevi's own sign-in and consent page opens in a browser window, and the clipper receives an OAuth authorization code. The clipper never sees the user's password. |
| `contextMenus` | To add one item, "Clip to Folevi", to the right-click menu on pages, selections and links. |
| Host permission `https://app.folevi.com/*` | The clipper's only server: Folevi's sign-in (OAuth) endpoints and the endpoint that saves the note. It doesn't request access to any website. |

**Remote code:** No. Every script the extension runs is in the package.

## Privacy practices (Chrome "Privacy" tab and Edge "Properties")

**Data the extension handles:**

- **Website content.** When the user clips, the text of the article or selection (converted to Markdown, with image and link addresses), the page title, the author and site name if the page gives them, and the page's address. Sent once, to Folevi (app.folevi.com), to create the note. Nothing is sent when the user doesn't clip.
- **Authentication information.** OAuth tokens issued by Folevi so the clipper can add notes for the user. Kept in the browser's extension storage (the short-lived access token in memory-only session storage) and sent only to app.folevi.com. Signing out deletes them.

**Data the extension does not collect:** personally identifiable information, health, financial, payment or location data, personal communications, browsing history (it never sees pages the user doesn't clip), or user activity such as clicks and keystrokes. No analytics, no advertising, no third-party services.

**Certifications** (tick all three):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy note

Folevi Web Clipper reads a web page only when you clip it. What you clip (its text, title and address) goes straight to your own Folevi account at app.folevi.com, over HTTPS, and becomes a note that only you can see until you share it. The clipper has permission to add notes, not to read them. It keeps its sign-in in your browser's extension storage and never sees your Folevi password. Folevi doesn't sell your data or use it for advertising. To disconnect the clipper, sign out in it, or remove it in Folevi under Settings > Connected apps.

## Assets to prepare

- Store icon: `icons/icon-128.png` (128 x 128, artwork inside the 16 px transparent margin).
- Screenshots: at least one, 1280 x 800 (or 640 x 400). Suggested: the popup on an article; the clipped note in Folevi under Inbox; the consent screen showing "Only add new things".
- Chrome small promo tile: 440 x 280.
- Edge: the same screenshots; a 300 x 300 logo is optional.

## Before submitting

1. Developer accounts: a Chrome Web Store developer account (one-time registration fee) and a Microsoft Partner Center account for Edge Add-ons. Use the same publisher name, Folevi.
2. Deploy the web app with the server changes this extension relies on (write-only grants, `create_note` with `inInbox`, extension origins accepted at `/mcp`), so the listing's homepage and the sign-in work.
3. Add a short "Folevi Web Clipper" section to the privacy policy at folevi.com/privacy (the privacy note above is ready to adapt). Both stores check that the policy covers the extension.
4. Run `pnpm package` and upload `release/folevi-clipper-<version>.zip`. Bump `version` in `package.json` for every new upload.
