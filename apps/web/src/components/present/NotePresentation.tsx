"use client";

// Presenting a note in the app: its blocks as they are now, with signed addresses for its images and files.
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import type { DocumentCover, DocumentStyle, WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import type { StyleColors } from "@/lib/cover";
import { Presentation } from "./Presentation";

export default function NotePresentation(props: { title: string; blocks: readonly WireBlock[]; style: DocumentStyle; cover: DocumentCover; coverPalette?: StyleColors | null; onClose: () => void }) {
  const fileIds = useMemo(() => [...new Set(props.blocks.map((b) => (b.props as { fileId?: unknown }).fileId).filter((x): x is string => typeof x === "string"))], [props.blocks]);
  const [now] = useState(() => Date.now());
  const files = useQuery(api.files.urls, fileIds.length ? { fileIds, now } : "skip");
  const fileUrls = useMemo(() => Object.fromEntries(Object.entries(files ?? {}).map(([id, f]) => [id, f.url])), [files]);
  return <Presentation {...props} fileUrls={fileUrls} />;
}
