# Sharing

How people other than a note's owner get to it: a whole place (a workspace's members), one page (people
and roles, invitations, public links), and a whole folder. Access is decided in one place on the server,
`convex/lib/auth.ts` (`documentAccess`, `folderAccessInfo`); everything else asks it.

## Roles and access

A grant has a role: **viewer** (Can view), **commenter** (Can comment) or **editor** (Can edit). Roles
become access levels (`roleToAccess`): read, comment, write. Above write is **manage**: a Personal's owner,
and a workspace's owners and admins.

When someone has several ways to a note, the **highest wins**: their membership, a grant on the page (or a
page above it), and a grant on its folder (or a folder above it). A lower grant never takes access away.

## Places, members and guests

- A **Personal** has no members: only its owner, plus the people its pages or folders are shared with.
- A **workspace**'s members see its pages by their role. A page set to **Only invited people**
  (`accessMode: "restricted"`) is for owners, admins, its creator and the people added to it.
- Someone who isn't a member of the place but was given a page or a folder is a **guest** there: they see
  only what was shared, take no seat and aren't billed (docs/ACCOUNT_MODEL_PLAN.md, Phase D).

## Sharing a page

The note's Share dialog (`components/doc/ShareDialog.tsx`, server `convex/sharing.ts`):

- Add people by email with a role. A verified account gets access at once; any other address gets an
  invitation by email (`/share-invite/<token>`) that grants nothing until that person signs in with the
  address and accepts. The invitation can be declined (nobody is told) or revoked.
- A grant reaches the pages nested inside the page.
- **Public links** are for single pages: optional expiry and password, off for search engines unless
  allowed, revocable at once. An end-to-end encrypted note's link carries its key after `#`
  (docs/E2EE_DESIGN.md §9).
- The dialog also lists **From folders**: people who have the note through a folder it's in. That access
  is changed in the folder's Share dialog, not here.

## Sharing a folder

A folder can be shared with people and roles, like a page. What it reaches:

- every note in the folder **and in its subfolders**, and notes added to any of them **later**;
- nested pages under those notes, as a page grant would.

What it never reaches:

- a page set to **Only invited people** (restricted), or a note under one;
- an end-to-end encrypted or locked note, and synced content (`folderGrantsReach`). An encrypted space, or
  an always fully encrypted folder, can't be shared as a folder at all: its notes are shared one by one,
  each with its key (docs/E2EE_DESIGN.md §8.4). The Share dialog says why.

### Who can share a folder

Its **managers**: a Personal's owner, a workspace's owners and admins. Other members see who has access
but can't change it; a guest sees only their own access and who gave it, and can **Leave**. (A folder can
hold restricted pages and other people's notes that a member couldn't hand out one by one.)

### The Share dialog

`components/app/FolderShareDialog.tsx`, opened from **Share…** in the folder's "…" menu (sidebar rows,
folder cards) and from **People** on a shared folder's page. It shows:

- what sharing reaches ("its 12 notes, in its subfolders too, and notes added later");
- the people with access, guests marked, with role pickers and Remove for managers;
- **From folders above**: grants on parent folders reach this one too, shown read only;
- **Invited by email**: pending invitations, with Revoke.

Sharing with an existing verified account grants at once and tells them (the bell, and the share email
when they allow it). Any other address gets a folder invitation by email (`/share-invite/folder/<token>`,
valid 14 days); on sign-up the invitation also waits in their bell with **Accept and open** and
**Decline**. Limits: 200 people per folder, 50 pending invitations.

### Moving notes in and out

Access follows the folder the note is in **now**. Moving a note into a shared folder gives its people the
note; moving it out takes it away (unless they also have it some other way). Before a move that changes who
can see a note, the app asks (`folderSharing.moveCheck`, `confirmMoveWarning`): "Move and stop sharing?"
names who loses it, "Move and change who can see it?" who gains it. Every note move goes through
`useNoteActions().moveTo`, so the Move dialog, multi-select and drag to a folder all ask. Offline, the move
goes ahead without asking. Moving a whole folder keeps its own grants with it.

### What the person it's shared with sees

- **Shared with Me** lists shared folders above shared pages: who shared it, where it lives, their role,
  how many notes. A folder inside another folder shared with them is left out (it opens from there).
- `/shared/<folderId>` opens it like a folder: the way up as far as they can go, its subfolders, and the
  notes in it they can open, each with its own access.
- A note they have through a folder shows **Shared with Me** at the start of its path, and its Share
  dialog says the access comes from the folder.
- The **device copy** (Settings > Offline & sync, `convex/sync.ts`) includes notes shared through folders
  and drops them when the folder is unshared, or the note moves out.

## Where things are

| Piece | Files |
| --- | --- |
| Access rules | `convex/lib/auth.ts` (`documentAccess`, `folderAccessInfo`, `folderChainGrant`, `folderGrantsReach`) |
| Page sharing | `convex/sharing.ts`, `components/doc/ShareDialog.tsx`, `views/ShareInviteView.tsx` |
| Folder sharing | `convex/folderSharing.ts`, `components/app/FolderShareDialog.tsx`, `views/SharedFolderView.tsx`, `views/FolderInviteView.tsx`, `lib/app/folderSharing.ts` (the words), `components/app/MoveWarning.tsx` |
| Shared with Me | `components/views/SharedView.tsx` (`sharing.sharedWithMe`, `folderSharing.sharedFolders`) |
| Notifications | `convex/lib/notify.ts` (`notifyFolderShare`, `notifyAccessChange`), `components/app/NotificationsButton.tsx` |
| Schema | `folderPermissions`, `folderInvites` (additive; no migration) |
| Tests | `tests/convex/folder-sharing.test.ts`, `tests/convex/decline-invites.test.ts`, `apps/web/test/folder-sharing.test.ts`, `apps/web/e2e/folder-sharing.spec.ts`, `e2e/guests.spec.ts`, `e2e/sharing.spec.ts` |

Not yet: the native app's bridge views and commands for folder people, invite, role, remove and invitation
accept and decline (docs/NATIVE_CONTRACT_REQUESTS.md on the native branch).
