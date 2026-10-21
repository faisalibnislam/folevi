// STUB written by WP2 so `readableFor` (lib/e2ee/state.ts) compiles. WP3 owns this file
// (docs/E2EE_DESIGN.md §12 WP3) and replaces it with the real Standard path: the note's title and, per
// purpose, its searchText plus found text (search) or Markdown, folder path, tags and tasks (ai, apps).
// Keep the exported signature.
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import type { MirrorPurpose, MirrorTask } from "./validators";

export async function plainReadable(
  _ctx: QueryCtx,
  doc: Doc<"documents">,
  _purpose: MirrorPurpose,
): Promise<{ title: string; text: string; tasks?: MirrorTask[]; folderPath?: string; tags?: string[] }> {
  return { title: doc.title, text: doc.searchText };
}
