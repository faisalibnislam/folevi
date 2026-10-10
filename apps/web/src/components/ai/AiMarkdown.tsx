"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { Check, Copy } from "lucide-react";
import { markdownToBlocks, type WireBlock } from "@folevi/editor-schema";
import { ReadOnlyBlocks } from "@/components/doc/ReadOnlyBlocks";

/** Inline citations ([2]) become links to "#cite-2", which the answer's click handler opens. */
export function linkCitations(markdown: string, cited: ReadonlySet<number>): string {
  if (!cited.size) return markdown;
  // Not inside code (fenced blocks or inline code), and not a Markdown link's text ("[2](…)").
  return markdown
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(/\[(\d{1,2})\](?!\()/g, (m, n: string) => (cited.has(Number(n)) ? `[${n}](#cite-${n})` : m))))
    .join("");
}

/** The answer's blocks in runs: plain blocks together, each top-level code block on its own (it gets a Copy button). */
export function answerSegments(blocks: WireBlock[]): ({ kind: "blocks"; blocks: WireBlock[] } | { kind: "code"; block: WireBlock })[] {
  const out: ({ kind: "blocks"; blocks: WireBlock[] } | { kind: "code"; block: WireBlock })[] = [];
  for (const b of blocks) {
    if (b.type === "code" && !b.parentId && (b.props as { language?: string }).language !== "mermaid") {
      out.push({ kind: "code", block: b });
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === "blocks") last.blocks.push(b);
    else out.push({ kind: "blocks", blocks: [b] });
  }
  return out;
}

function CodeBlock({ block }: { block: WireBlock }) {
  const [copied, setCopied] = useState(false);
  const p = block.props as { code?: string; language?: string };
  const code = String(p.code ?? "");
  const language = p.language && p.language !== "plaintext" ? p.language : "";
  return (
    <div className="fb-editor group/code relative">
      <pre className="fb fb-code" data-language={language || undefined}>
        <code>{code}</code>
      </pre>
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy code"}
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute right-1.5 top-1.5 inline-flex h-7 items-center gap-1 rounded-chip bg-[var(--glass-active)] px-2 text-[11.5px] text-muted opacity-0 shadow-[var(--glass-edge)] transition-opacity hover:text-heading focus-visible:opacity-100 group-hover/code:opacity-100 pointer-coarse:opacity-100"
      >
        {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
        {language ? <span className="font-mono">{language}</span> : null}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}

/**
 * Renders an AI answer (Markdown) with the same typography as notes: lists, tables, headings and code
 * blocks (with a Copy button). With `cited`, inline citations ([n]) are links that call `onCite`; links to
 * app pages call `onNavigate` (staying in the app), and other links open in a new tab.
 */
export function AiMarkdown({
  markdown,
  className = "",
  cited,
  onCite,
  onNavigate,
}: {
  markdown: string;
  className?: string;
  cited?: ReadonlySet<number>;
  onCite?: (n: number) => void;
  onNavigate?: (href: string) => void;
}) {
  const segments = useMemo(() => {
    const source = cited ? linkCitations(markdown, cited) : markdown;
    return answerSegments(markdownToBlocks(source, { titleFromHeading: false }).blocks);
  }, [markdown, cited]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!a || !href || e.defaultPrevented) return;
    const cite = /^#cite-(\d{1,2})$/.exec(href);
    if (cite) {
      e.preventDefault();
      onCite?.(Number(cite[1]));
    } else if (href.startsWith("/") && onNavigate && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      onNavigate(href);
    } else if (/^https?:/i.test(href)) {
      e.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };
  return (
    <div
      onClick={onClick}
      className={`fb-ai-answer text-[14px] leading-[1.6] [&>.fb-editor]:!pb-0 ${className}`}
      style={{ ["--doc-accent" as string]: "var(--color-heading)", ["--doc-accent-soft" as string]: "var(--glass-hover)" }}
    >
      {segments.map((s, i) => (s.kind === "code" ? <CodeBlock key={s.block.id} block={s.block} /> : <ReadOnlyBlocks key={i} blocks={s.blocks} fileUrls={{}} />))}
    </div>
  );
}

/** Text still being written: the Markdown so far, with a soft caret after the last word. */
export function StreamingText({ text, className = "", cited }: { text: string; className?: string; cited?: ReadonlySet<number> }) {
  return (
    <div className={`fb-ai-streaming ${className}`}>
      <AiMarkdown markdown={text} cited={cited} />
    </div>
  );
}
