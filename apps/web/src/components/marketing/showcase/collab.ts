// Comments and presence for the showcase only. Local mode has neither (they need other people, so an account),
// but the "Write together" chapter shows them: Sam Okafor is in the Spring launch page with Maya, edits it, and
// answers her comment. These stand-ins answer the same functions in the showcase's demo library, keeping their
// state in its `meta` table (so queries re-run when it changes), and write as Sam inside `asSam`.
import { plainText, ulid, type InlineNode } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import type { Id } from "@convex/_generated/dataModel";
import { defineLocal } from "@/lib/local/registry";
import { getProfile } from "@/lib/local/functions/shared";
import type { LocalReader, LocalWriter } from "@/lib/local/registry";
import { MAYA_AVATAR, SAM_AVATAR } from "./seed";

export const SAM = { id: "sam_showcase", name: "Sam Okafor", avatarUrl: SAM_AVATAR, color: "coral" as const };

interface DemoComment {
  id: string;
  authorId: string;
  body: InlineNode[];
  createdAt: number;
}
interface DemoThread {
  id: string;
  documentId: string;
  blockId: string | null;
  status: "open" | "resolved";
  createdBy: string;
  createdAt: number;
  lastActivityAt: number;
  resolvedBy: string | null;
  resolvedAt: number | null;
  comments: DemoComment[];
}
interface DemoPresence {
  documentId: string;
  cursor: { anchor: { blockId: string; offset: number }; head: { blockId: string; offset: number } } | null;
  updatedAt: number;
}

const THREADS = "showcase:threads";
const PRESENCE = "showcase:presence";

let actor: "maya" | "sam" = "maya";
/** Runs `fn` with Sam as the one writing (his comments and replies). */
export async function asSam<T>(fn: () => Promise<T>): Promise<T> {
  actor = "sam";
  try {
    return await fn();
  } finally {
    actor = "maya";
  }
}

const threadsOf = async (db: LocalReader) => ((await db.get("meta", THREADS)) as DemoThread[] | undefined) ?? [];
const saveThreads = (db: LocalWriter, all: DemoThread[]) => db.put("meta", THREADS, all);

async function who(db: LocalReader): Promise<{ id: string; name: string; avatarUrl: string | null }> {
  if (actor === "sam") return SAM;
  const me = await getProfile(db);
  return { id: me?.id ?? "me", name: me?.displayName ?? "Maya Patel", avatarUrl: me?.avatarUrl ?? MAYA_AVATAR };
}

/** The session the driver speaks for Sam with: its heartbeat, caret and leave are his (presence.* below). */
export const SAM_SESSION = "showcase-sam";

let registered = false;
export function registerShowcaseCollab(): void {
  if (registered) return;
  registered = true;

  defineLocal(api.comments.threads, "query", async (ctx, args) => {
    // Always as Maya sees it (whoever is writing at the moment).
    const profile = await getProfile(ctx.db);
    const me = { id: profile?.id ?? "me", name: profile?.displayName ?? "Maya Patel", avatarUrl: profile?.avatarUrl ?? MAYA_AVATAR };
    const all = (await threadsOf(ctx.db)).filter((t) => t.documentId === args.documentId).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    const blocks = new Map((await ctx.db.list("blocks", args.documentId)).filter((b) => b.deletedAt === null).map((b) => [b.id, b]));
    const person = (id: string) => (id === SAM.id ? { name: SAM.name, avatarUrl: SAM.avatarUrl } : { name: me.name, avatarUrl: me.avatarUrl });
    const byBlock = new Map<string, { blockId: string; threads: number; comments: number; lastActivityAt: number; unread: boolean; authors: { name: string; avatarUrl: string | null }[] }>();
    const threads = all.map((t) => {
      const block = t.blockId ? blocks.get(t.blockId) : undefined;
      if (t.status === "open" && t.blockId && block) {
        const e = byBlock.get(t.blockId) ?? { blockId: t.blockId, threads: 0, comments: 0, lastActivityAt: 0, unread: false, authors: [] };
        e.threads++;
        e.comments += t.comments.length;
        e.lastActivityAt = Math.max(e.lastActivityAt, t.lastActivityAt);
        for (const c of [...t.comments].reverse()) if (e.authors.length < 3 && !e.authors.some((a) => a.name === person(c.authorId).name)) e.authors.push(person(c.authorId));
        byBlock.set(t.blockId, e);
      }
      return {
        id: t.id,
        blockId: t.blockId,
        blockExists: t.blockId ? Boolean(block) : null,
        blockText: block ? plainText(block.text as InlineNode[]).trim().slice(0, 140) : null,
        status: t.status,
        createdAt: t.createdAt,
        lastActivityAt: t.lastActivityAt,
        resolvedBy: t.resolvedBy ? person(t.resolvedBy).name : null,
        resolvedAt: t.resolvedAt,
        unread: false,
        canResolve: true,
        canDelete: true,
        comments: t.comments.map((c) => ({
          id: c.id,
          authorId: c.authorId,
          authorName: person(c.authorId).name,
          authorAvatarUrl: person(c.authorId).avatarUrl,
          body: c.body,
          deleted: false,
          createdAt: c.createdAt,
          editedAt: null,
          mine: c.authorId !== SAM.id,
          canEdit: c.authorId !== SAM.id,
          canDelete: true,
          reactions: [],
        })),
      };
    });
    return { threads, blocks: [...byBlock.values()], canComment: true, canManage: true };
  });

  defineLocal(api.comments.mentionable, "query", async (ctx) => {
    const profile = await getProfile(ctx.db);
    const me = { id: profile?.id ?? "me", name: profile?.displayName ?? "Maya Patel" };
    return [
      { profileId: me.id, displayName: me.name, isYou: true, guest: false },
      { profileId: SAM.id, displayName: SAM.name, isYou: false, guest: false },
    ];
  });

  defineLocal(api.comments.unreadCount, "query", async () => ({ unread: 0, open: 0 }));

  defineLocal(api.comments.create, "mutation", async (ctx, args) => {
    const me = await who(ctx.db);
    const all = await threadsOf(ctx.db);
    const now = ctx.now();
    const thread: DemoThread = {
      id: args.threadId ?? ulid(),
      documentId: args.documentId,
      blockId: args.blockId ?? null,
      status: "open",
      createdBy: me.id,
      createdAt: now,
      lastActivityAt: now,
      resolvedBy: null,
      resolvedAt: null,
      comments: [{ id: args.commentId ?? ulid(), authorId: me.id, body: args.body as InlineNode[], createdAt: now }],
    };
    saveThreads(ctx.db, [...all, thread]);
    return { threadId: thread.id, commentId: thread.comments[0]!.id };
  });

  defineLocal(api.comments.reply, "mutation", async (ctx, args) => {
    const me = await who(ctx.db);
    const now = ctx.now();
    const id = args.commentId ?? ulid();
    saveThreads(
      ctx.db,
      (await threadsOf(ctx.db)).map((t) => (t.id === args.threadId ? { ...t, lastActivityAt: now, comments: [...t.comments, { id, authorId: me.id, body: args.body as InlineNode[], createdAt: now }] } : t)),
    );
    return { commentId: id };
  });

  defineLocal(api.comments.setResolved, "mutation", async (ctx, args) => {
    const me = await who(ctx.db);
    const now = ctx.now();
    saveThreads(
      ctx.db,
      (await threadsOf(ctx.db)).map((t) => (t.id === args.threadId ? { ...t, status: args.resolved ? "resolved" : "open", resolvedBy: args.resolved ? me.id : null, resolvedAt: args.resolved ? now : null, lastActivityAt: now } : t)),
    );
    return null;
  });

  defineLocal(api.comments.deleteThread, "mutation", async (ctx, args) => {
    saveThreads(ctx.db, (await threadsOf(ctx.db)).filter((t) => t.id !== args.threadId));
    return null;
  });
  // Following a note's comments (the comments panel asks): the default, and nothing to change.
  defineLocal(api.notifications.noteSubscription, "query", async () => ({ mode: "default" as const, isAuthor: true }));
  defineLocal(api.notifications.setNoteSubscription, "mutation", async () => null);
  defineLocal(api.comments.markThreadRead, "mutation", async () => null);
  defineLocal(api.comments.markThreadUnread, "mutation", async () => null);

  // Presence: Sam, when the driver speaks for him (SAM_SESSION). Maya's own heartbeats and caret go nowhere.
  defineLocal(api.presence.heartbeat, "mutation", async (ctx, args) => {
    if (args.sessionId !== SAM_SESSION) return null;
    const p = (await ctx.db.get("meta", PRESENCE)) as DemoPresence | null | undefined;
    ctx.db.put("meta", PRESENCE, { documentId: args.documentId, cursor: p?.documentId === args.documentId ? p.cursor : null, updatedAt: ctx.now() } satisfies DemoPresence);
    return null;
  });
  defineLocal(api.presence.leave, "mutation", async (ctx, args) => {
    if (args.sessionId === SAM_SESSION) ctx.db.put("meta", PRESENCE, null);
    return null;
  });
  defineLocal(api.presence.setCursor, "mutation", async (ctx, args) => {
    if (args.sessionId !== SAM_SESSION) return null;
    ctx.db.put("meta", PRESENCE, { documentId: args.documentId, cursor: args.cursor ? { anchor: args.cursor.anchor, head: args.cursor.head } : null, updatedAt: ctx.now() } satisfies DemoPresence);
    return null;
  });
  defineLocal(api.presence.list, "query", async (ctx, args) => {
    const p = (await ctx.db.get("meta", PRESENCE)) as DemoPresence | null | undefined;
    if (!p || p.documentId !== args.documentId) return [];
    return [{ profileId: SAM.id, name: SAM.name, color: SAM.color, avatarUrl: SAM.avatarUrl, focusedBlockId: p.cursor?.head.blockId ?? null }];
  });
  defineLocal(api.presence.cursors, "query", async (ctx, args) => {
    const p = (await ctx.db.get("meta", PRESENCE)) as DemoPresence | null | undefined;
    if (!p || p.documentId !== args.documentId || !p.cursor) return [];
    return [{ key: "sam", profileId: SAM.id as Id<"profiles">, name: SAM.name, color: SAM.color, anchor: p.cursor.anchor, head: p.cursor.head, block: false, updatedAt: p.updatedAt }];
  });
}
