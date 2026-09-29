// English source catalog. Keys are namespaced by surface ("sync.*", "admin.*"); values are ICU-style
// messages (see ../icu.ts). Never build sentences by concatenating translated fragments. Put the
// whole sentence, with its plural/select branches, in one message. See docs/LOCALIZATION.md.
export const en = {
  // Sync status (components/app/SyncStatus.tsx)
  "sync.button.label": "Sync status: {status}{pending, plural, =0 {} one {, # change waiting} other {, # changes waiting}}",
  "sync.offline.detail":
    "You can keep writing. {count, plural, =0 {Changes are} one {# change is} other {# changes are}} stored on this device and will sync when you reconnect.",
  "sync.conflict.detail":
    "{count, plural, one {# block} other {# blocks}} changed in two places. Both versions are kept. Choose which to keep in the document.",
  "sync.pending.heading": "Waiting to sync",
  "sync.pending.changes": "{count, plural, one {# change} other {# changes}}",
  "sync.pending.more": "{count, plural, one {…and # more page} other {…and # more pages}}",
  "sync.pending.untitled": "Untitled",
  "sync.pending.newPage": "New page",
  "sync.pending.uploads": "{count, plural, one {# file waiting to upload} other {# files waiting to upload}}",

  // Notifications (components/app/NotificationsButton.tsx)
  "notifications.button.label": "{count, plural, =0 {Notifications} other {Notifications, # unread}}",

  // Admin console
  "admin.workspace.members": "{count, plural, one {# person} other {# people}}",
  "admin.user.sessions": "{active, plural, other {# active}} of {total, plural, other {# recorded}}",

  // Organization: document lists, command palette, calendar, collections, sync settings
  "documents.count": "{count, plural, one {# document} other {# documents}}{more, select, true {+} other {}}",
  "documents.trash.scheduled": "{count, plural, one {# document} other {# documents}} will be permanently deleted.",
  "palette.results": "{count, plural, =0 {No results} one {# result} other {# results}}",
  "calendar.day.label": "{date}, {count, plural, =0 {no tasks} one {# task} other {# tasks}}",
  "calendar.unscheduled.more": "{count, plural, one {# more undated task in Tasks} other {# more undated tasks in Tasks}}",
  "collection.filters": "{count, plural, one {# filter} other {# filters}}",
  "collection.rowsShown": "{shown, number} of {total, plural, one {# row} other {# rows}} shown",
  "collection.board.column": "{name}, {count, plural, one {# card} other {# cards}}",
  "collection.linkedPages": "{count, plural, one {# linked page} other {# linked pages}}",
  "settings.sync.unsent":
    "{count, plural, one {# change hasn’t synced yet and will be lost. Reconnect first if you want to keep it.} other {# changes haven’t synced yet and will be lost. Reconnect first if you want to keep them.}}",

  // Public share page (app/s/[token])
  "share.lastUpdated": "Last updated {date}",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
