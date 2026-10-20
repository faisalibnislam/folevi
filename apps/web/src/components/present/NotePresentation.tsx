"use client";

// Presenting a note in the app: its blocks as they are now, with signed addresses for its images and files.
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { blocksFileIds, type DocumentCover, type DocumentStyle, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import type { StyleColors } from "@/lib/cover";
import { Presentation } from "./Presentation";

export default function NotePresentation(props: { title: string; blocks: readonly WireBlock[]; style: DocumentStyle; cover: DocumentCover; coverPalette?: StyleColors | null; onClose: () => void }) {
  // Images in flowchart shapes too.
  const fileIds = useMemo(() => blocksFileIds(props.blocks), [props.blocks]);
  const [now] = useState(() => Date.now());
  const files = useQuery(api.files.urls, fileIds.length ? { fileIds, now } : "skip");
  const fileUrls = useMemo(() => Object.fromEntries(Object.entries(files ?? {}).map(([id, f]) => [id, f.url])), [files]);
  return <Presentation {...props} fileUrls={fileUrls} />;
}
