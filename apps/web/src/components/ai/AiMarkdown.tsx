"use client";

import { useMemo } from "react";
import { markdownToBlocks } from "@folevi/editor-schema";
import { ReadOnlyBlocks } from "@/components/doc/ReadOnlyBlocks";

/** Renders an AI answer (Markdown) with the same typography as notes. */
export function AiMarkdown({ markdown, className = "" }: { markdown: string; className?: string }) {
  const blocks = useMemo(() => markdownToBlocks(markdown, { titleFromHeading: false }).blocks, [markdown]);
  return (
    <div
      className={`fb-ai-answer text-[14px] leading-[1.6] [&>.fb-editor]:!pb-0 ${className}`}
      style={{ ["--doc-accent" as string]: "var(--color-heading)", ["--doc-accent-soft" as string]: "var(--glass-hover)" }}
    >
      <ReadOnlyBlocks blocks={blocks} fileUrls={{}} />
    </div>
  );
}

/** Text still being written: the Markdown so far, with a soft caret after the last word. */
export function StreamingText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`fb-ai-streaming ${className}`}>
      <AiMarkdown markdown={text} />
    </div>
  );
}
