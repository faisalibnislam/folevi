// Foli AI conversations in local mode (convex aiConversations and aiMessages): kept on this device only, in
// its copy of the library (`local:` meta keys never reach the library folder, store/policy.ts isDeviceMeta).
// Conversations are personal working state, like the server's, and some are long: writing them into the
// library's shared index would make every device read them. The list is one row (`local:aiChats`), each
// conversation's messages another (`local:aiChat:<id>`), so the list doesn't re-run while an answer settles.
// While an answer is written its text lives in a stream (streams.ts), not in the messages.
import type { AiContext } from "@folevi/ai-prompts/chat";
import type { AiAction } from "@folevi/ai-prompts/actions";
import type { MemoryKind } from "@folevi/ai-prompts/memory";
import type { LocalReader, LocalWriter } from "../registry";

export interface LocalConversation {
  id: string;
  title: string;
  titled: boolean;
  pinned: boolean;
  context: AiContext;
  model: string | null;
  ephemeral: boolean;
  searchText: string;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
}

export interface LocalCitation {
  n: number;
  noteId: string;
  title: string;
  blockId?: string;
  quote?: string;
}

export type LocalOutcome = { kind: "dismissed" } | { kind: "applied"; folders: { id: string; name: string }[]; notes: { id: string; title: string }[]; moved: number };

export interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: LocalCitation[];
  actions?: AiAction[];
  actionsOutcome?: LocalOutcome;
  suggestions?: string[];
  status: "streaming" | "done" | "stopped" | "error";
  phase?: string;
  error?: { code: string; message: string; action?: string; reason?: string };
  memory?: { kind: MemoryKind; text: string; status: "proposed" | "saved" | "dismissed" };
  /** The stream holding the text while it's written. */
  streamId?: string;
  createdAt: number;
  updatedAt: number;
}

export const CHATS_KEY = "local:aiChats";
export const messagesKey = (id: string) => `local:aiChat:${id}`;
/** Where a message's conversation is found from its id: `<conversation id>~<ulid>`. */
export const conversationOfMessage = (messageId: string) => {
  const i = messageId.indexOf("~");
  return i > 0 ? messageId.slice(0, i) : "";
};

export async function conversations(db: LocalReader): Promise<LocalConversation[]> {
  return ((await db.get("meta", CHATS_KEY)) as LocalConversation[] | undefined) ?? [];
}

export async function conversation(db: LocalReader, id: string): Promise<LocalConversation | null> {
  return (await conversations(db)).find((c) => c.id === id) ?? null;
}

export async function messagesOf(db: LocalReader, id: string): Promise<LocalMessage[]> {
  return ((await db.get("meta", messagesKey(id))) as LocalMessage[] | undefined) ?? [];
}

/** Writes one conversation's row (inserting it when new). */
export async function putConversation(db: LocalWriter, c: LocalConversation): Promise<void> {
  const list = await conversations(db);
  const at = list.findIndex((x) => x.id === c.id);
  const next = at < 0 ? [...list, c] : list.map((x, i) => (i === at ? c : x));
  db.put("meta", CHATS_KEY, next);
}

export function putMessages(db: LocalWriter, id: string, messages: LocalMessage[]): void {
  db.put("meta", messagesKey(id), messages);
}

export async function deleteConversation(db: LocalWriter, id: string): Promise<void> {
  db.put(
    "meta",
    CHATS_KEY,
    (await conversations(db)).filter((c) => c.id !== id),
  );
  db.remove("meta", messagesKey(id));
}
