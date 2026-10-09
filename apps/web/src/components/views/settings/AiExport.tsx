"use client";

import { useState } from "react";
import { useConvex } from "convex/react";
import { strToU8, zipSync, type Zippable } from "fflate";
import { Download, Loader2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { download } from "@/components/ai/chat/ConversationActions";
import { Card } from "./Card";

// Settings > AI "Export all conversations": every conversation you keep, as Markdown files in a .zip, one
// folder per place (Personal, each workspace). The server hands them over a page at a time
// (aiChat.exportAll, which leaves out history-off conversations); the zip is made here with fflate, the
// way a note's export is (components/doc/export.ts).

/** A conversation as exported: its place's folder, a file name and the Markdown. */
export interface ExportedConversation {
  folder: string;
  name: string;
  markdown: string;
}

const safe = (s: string) => s.replace(/[\u0000-\u001F\u007F/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";

/** The zip's files: "Folder/Name.md", numbered when two would share a name. */
export function zipEntries(files: ExportedConversation[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const f of files) {
    const dir = safe(f.folder);
    const base = safe(f.name);
    let path = `${dir}/${base}.md`;
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `${dir}/${base} (${n}).md`;
    used.add(path.toLowerCase());
    out[path] = f.markdown;
  }
  return out;
}

export function AiExportCard() {
  const convex = useConvex();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const files: ExportedConversation[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 500; i++) {
        const page: { page: ExportedConversation[]; isDone: boolean; continueCursor: string } = await convex.query(api.aiChat.exportAll, { paginationOpts: { numItems: 10, cursor } });
        files.push(...page.page);
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      if (!files.length) {
        toast.show("You don't have any saved conversations yet.");
        return;
      }
      const zip: Zippable = {};
      for (const [path, md] of Object.entries(zipEntries(files))) zip[path] = strToU8(md);
      download(zipSync(zip) as Uint8Array<ArrayBuffer>, `foli-conversations-${new Date().toISOString().slice(0, 10)}.zip`, "application/zip");
      toast.show(`Exported ${files.length} ${files.length === 1 ? "conversation" : "conversations"}`, { tone: "success" });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Export" description="Download every conversation you keep as Markdown files in a .zip, in a folder for Personal and each workspace. Conversations aren't kept while history is off, so those aren't included.">
      <Button onClick={() => void run()} disabled={busy}>
        {busy ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Download size={14} aria-hidden />}
        {busy ? "Exporting…" : "Export all conversations"}
      </Button>
    </Card>
  );
}
