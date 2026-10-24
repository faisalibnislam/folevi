// E2EE_ROUTES: what the router does with every server function the app calls (docs/E2EE_DESIGN.md §6.4,
// WP7). A route applies only to a call about an e2ee-active space or a sealed note (spaces.ts); every other
// call is `pass`, so Standard spaces run exactly as without the router. tests/e2ee/route-coverage.test.ts fails
// when a function the app calls has no entry here.
//
// Keys are "module:function"; "module:*" covers the rest of a module.
import { COMPOSERS } from "../compose";
import { changesNote, fileUrls, generic, notifications, snapshotContent, versions } from "./decoders";
import { append, info, overlay } from "./merge";
import { content } from "./refs";
import { SEALERS } from "./sealed";
import type { Route } from "./types";

const pass: Route = { kind: "pass" };
const decode: Route = { kind: "decode", open: generic };
/** Lists, trees, counts: the replica answers in encrypted spaces; with locks, the server's list is filled in. */
const device: Route = { kind: "device", locks: "overlay", merge: overlay };
/** Searches, tasks, backlinks: the replica answers; with locks, its hits are added to the server's. */
const deviceAppend: Route = { kind: "device", locks: "append", merge: append };
const ai: Route = { kind: "ai" };
const captured: Route = { kind: "compose", run: COMPOSERS.captured() };
const records: Route = { kind: "sealed", to: content.putRecord, seal: SEALERS.records };

/** Entries for several functions of one module ("fnA fnB"). */
function each(route: Route, mod: string, names: string): Record<string, Route> {
  return Object.fromEntries(names.split(/\s+/).filter(Boolean).map((n) => [`${mod}:${n}`, route]));
}

export const E2EE_ROUTES: Record<string, Route> = {
  // ---- no content -----------------------------------------------------------------------------------------
  "users:*": pass,
  // Starter notes in an encrypted Personal are written on the device.
  "users:completeOnboardingStep": { kind: "compose", run: COMPOSERS.onboardingStep, personal: true },
  "workspaces:*": pass,
  "billing:*": pass,
  "workspaceBilling:*": pass,
  "settings:*": pass,
  "themes:*": pass,
  "presence:*": pass,
  "push:*": pass,
  "apiTokens:*": pass,
  "mcp:*": pass,
  "webhooks:*": pass,
  "authEmails:*": pass,
  "signInOptions:*": pass,
  "passkeyUsage:*": pass,
  "support:*": pass,
  "clock:*": pass,
  "unsplash:*": pass,
  "externalCalendars:*": pass,
  "calendarFeeds:*": pass,
  "emailNotes:*": pass,
  "aiDigest:*": pass,
  "routines:*": pass,
  "proposals:*": pass,
  "e2ee:*": pass,
  // Content modules are listed function by function, so a new function there has to be classified.
  ...each(pass, "documents", "bulkUpdate emptyTrash hideFromRecent move moveToTrash recordView reorder restoreFromTrash setArchived setStarred showInRecent purgeSnapshots seenMark"),
  ...each(pass, "comments", "deleteThread markThreadRead markThreadUnread mentionable react remove setResolved unreadCount"),
  ...each(pass, "sharing", "acceptPageInvite createPublicLink grant revoke revokePageInvite revokePublicLink setAccessMode setPublicLinkTheme"),
  ...each(pass, "organization", "deleteFolder deleteTag moveFolder setFolderColor"),
  ...each(pass, "notifications", "markRead markUnread noteSubscription remove setNoteSubscription unreadCount"),
  "blocks:rebalance": pass,
  // Sealed per op by the router itself (client.ts pushSealed, §6.6), not through a route.
  "sync:push": pass,
  // The device copy (lib/sync/deviceCopy.ts): sealed or locked notes never come with content (the server keeps
  // them back), and the copy leaves encrypted spaces to their replica.
  "sync:head": pass,
  "sync:manifest": pass,
  "sync:pullDocs": pass,
  "sync:pullAll": pass,
  "files:generateUploadUrl": pass,
  "files:finalize": pass,
  "migration:preflight": pass,
  "search:meaningAvailable": pass,
  // The person's setting, kept by the server; the replica's study queue is told too.
  "study:setNewPerDay": { kind: "compose", run: COMPOSERS.newPerDay },
  "ai:cancelStream": pass,
  "ai:stream": pass,
  "aiChat:capabilities": pass,
  "changes:dismissAway": pass,
  "changes:markSeen": pass,

  // ---- Convex, opened ---------------------------------------------------------------------------------------
  "documents:get": decode,
  "blocks:list": decode,
  "blocks:changes": decode,
  "blocks:deleted": decode,
  "documents:snapshots": { kind: "decode", open: versions },
  "documents:versions": { kind: "decode", open: versions },
  "documents:snapshotContent": { kind: "decode", open: snapshotContent },
  "documents:blockAuthors": decode,
  "comments:threads": decode,
  "changes:list": decode,
  "changes:note": { kind: "decode", open: changesNote },
  "changes:away": decode,
  "synced:info": decode,
  "notifications:list": { kind: "decode", open: notifications },
  "sharing:sharedWithMe": decode,
  "sharing:previewPageInvite": decode,
  "sharing:get": decode,
  "files:urls": { kind: "decode", open: fileUrls },
  "workspaces:guests": decode,
  "migration:documents": decode,
  "migration:fileTexts": decode,
  "documents:trashSummary": decode,
  // Not called by the app today (no local handler); the server's answer carries sealed fields, opened here.
  "documents:daily": decode,
  "documents:dailyDates": pass,

  // ---- the replica ------------------------------------------------------------------------------------------
  "documents:list": device,
  "documents:titles": device,
  "documents:children": device,
  "documents:pageTree": device,
  "documents:info": { kind: "device", locks: "overlay", merge: info, serverToo: true },
  "documents:recent": device,
  "documents:recentNotes": device,
  "documents:backlinks": deviceAppend,
  "organization:sidebar": device,
  "organization:index": device,
  "organization:recentFolders": device,
  "organization:draftCount": device,
  "search:documents": deviceAppend,
  "search:everywhere": deviceAppend,
  "tasks:list": deviceAppend,
  "tasks:counts": deviceAppend,
  "tasks:range": deviceAppend,
  "collections:get": device,
  "collections:rowForDocument": device,
  "charts:collections": deviceAppend,
  "study:queue": deviceAppend,
  "study:summary": deviceAppend,
  "fileText:forDocument": device,
  "synced:home": device,
  "exports:exportScope": device,

  // ---- sealed variants ----------------------------------------------------------------------------------------
  "organization:createFolder": { kind: "sealed", to: content.createFolder, seal: SEALERS.createFolder },
  "organization:renameFolder": { kind: "sealed", to: content.renameFolder, seal: SEALERS.renameFolder },
  "organization:createTag": { kind: "sealed", to: content.createTag, seal: SEALERS.createTag },
  "organization:updateTag": { kind: "sealed", to: content.updateTag, seal: SEALERS.updateTag },
  "organization:setDocumentTags": { kind: "sealed", to: content.setDocumentTags, seal: SEALERS.setDocumentTags },
  "comments:create": { kind: "sealed", to: content.createComment, seal: SEALERS.commentCreate },
  "comments:reply": { kind: "sealed", to: content.replyComment, seal: SEALERS.commentReply },
  "comments:edit": { kind: "sealed", to: content.editComment, seal: SEALERS.commentEdit },
  "documents:nameVersion": { kind: "sealed", to: content.nameVersion, seal: SEALERS.nameVersion },
  "documents:importSnapshot": { kind: "sealed", to: content.importVersion, seal: SEALERS.importSnapshot },
  "documents:deletePermanently": { kind: "sealed", to: null, seal: SEALERS.deletePermanently },
  "files:setPalette": { kind: "sealed", to: null, seal: SEALERS.setPalette },
  "files:shareForPaste": { kind: "sealed", to: null, seal: SEALERS.shareForPaste },
  "documents:createSnapshot": { kind: "sealed", to: content.nameVersion, seal: SEALERS.createSnapshot },
  "collections:create": records,
  "collections:rename": records,
  "collections:addProperty": records,
  "collections:updateProperty": records,
  "collections:deleteProperty": records,
  "collections:addRow": records,
  "collections:setValue": records,
  "collections:moveRow": records,
  "collections:renameRow": records,
  "collections:deleteRow": records,
  "collections:addViewToCollection": records,
  "collections:updateView": records,
  "collections:deleteView": records,
  "fileText:save": records,
  "study:review": records,

  // ---- on the device ------------------------------------------------------------------------------------------
  "documents:duplicate": captured,
  "documents:copyVersion": { kind: "compose", run: COMPOSERS.copyVersion },
  "documents:restoreSnapshot": { kind: "compose", run: COMPOSERS.restoreSnapshot },
  "documents:restoreVersion": { kind: "compose", run: COMPOSERS.restoreSnapshot },
  "changes:undo": { kind: "compose", run: COMPOSERS.undoChanges },
  "tasks:update": captured,
  "tasks:quickAdd": captured,
  "tasks:inbox": captured,
  "tasks:moveToDocument": captured,
  "imports:importText": captured,
  "copies:copyTo": { kind: "compose", run: COMPOSERS.copyTo },
  "aiChat:saveAsNote": { kind: "compose", run: COMPOSERS.chatAsNote },
  "aiResearch:saveAsNote": { kind: "compose", run: COMPOSERS.researchAsNote },
  "aiWriting:saveDraft": captured,
  "aiActions:apply": captured,
  "aiGraph:linkNote": { kind: "compose", run: COMPOSERS.linkNote },

  // ---- Foli AI (WP8 decides per request) -------------------------------------------------------------------
  "ai:*": ai,
  "aiChat:*": ai,
  "aiResearch:*": ai,
  "aiStudy:*": ai,
  "aiTodos:*": ai,
  "aiAttachments:*": ai,
  "aiSuggestions:*": ai,
  "aiGraph:*": ai,
  "aiMemory:*": ai,
  "aiSharing:*": ai,
  "chartAi:*": ai,
  "flowchartAi:*": ai,
  "mindmapAi:*": ai,
  "stickiesAi:*": ai,
  "tableAi:*": ai,
  "wireframeAi:*": ai,
  "fileText:readImage": ai,
  "search:byMeaning": ai,

  // ---- not in encrypted spaces (v1) --------------------------------------------------------------------------
  "aiAgent:*": { kind: "off", feature: "agent" },
  "bookmarks:preview": { kind: "off", feature: "bookmarkPreview" },
};

/** `documents:list` from either spelling ("documents.list"; e2ee modules as "e2ee/keys:status"). */
export function routeName(name: string): string {
  if (name.includes(":")) return name;
  return name.replace(/\.(?=[^.]*$)/, ":");
}

/** The route of a function: its own entry, else its module's `*`, else pass. */
export function routeOf(name: string): Route {
  const n = routeName(name);
  const own = E2EE_ROUTES[n];
  if (own) return own;
  const mod = n.slice(0, n.indexOf(":"));
  if (mod.startsWith("e2ee/")) return pass;
  return E2EE_ROUTES[`${mod}:*`] ?? pass;
}

/** Whether a function has an entry of its own or through its module (the coverage test). */
export function hasRoute(name: string): boolean {
  const n = routeName(name);
  const mod = n.slice(0, n.indexOf(":"));
  return n in E2EE_ROUTES || `${mod}:*` in E2EE_ROUTES || mod.startsWith("e2ee/") || mod === "e2ee";
}
