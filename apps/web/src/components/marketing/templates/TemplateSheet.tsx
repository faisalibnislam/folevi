import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Asterisk, ChevronDown } from "lucide-react";
import { parseInlineMarkdown, type InlineNode } from "@folevi/editor-schema";
import type { BlockSpec } from "@/lib/templates";
import { CheckMark } from "../product/Replica";
import { cx } from "../ui";

/*
 * A read-only rendering of a template's blocks (convex/lib/templates.ts), drawn like the site's note
 * replicas: a plain sheet (new notes start Plain), headings in Spectral, to-dos with the editor's
 * checkbox, callouts, toggles, tables and dividers. Server-rendered, so the gallery pages are static HTML.
 * Empty blocks (the lines you fill in) show as faint placeholders and are hidden from assistive tech.
 */

const CALLOUT_TONE: Record<string, string> = {
  note: "bg-(--color-surface-sunken)",
  info: "bg-(--color-highlight-blue)",
  success: "bg-moss-soft",
  warning: "bg-marigold-soft",
  danger: "bg-coral-soft",
};

function Inline({ md, nodes }: { md?: string; nodes?: InlineNode[] }) {
  const list = nodes ?? parseInlineMarkdown(md ?? "");
  return (
    <>
      {list.map((n, i) => {
        if (n.type !== "text") return null;
        let el: ReactNode = n.text;
        for (const m of n.marks ?? []) {
          if (m.type === "bold") el = <strong className="font-semibold text-(--n-heading)">{el}</strong>;
          else if (m.type === "italic") el = <em>{el}</em>;
          else if (m.type === "strike") el = <s>{el}</s>;
          else if (m.type === "code") el = <code className="rounded-[4px] bg-(--color-surface-sunken) px-1 font-mono text-[0.88em]">{el}</code>;
        }
        return <Fragment key={i}>{el}</Fragment>;
      })}
    </>
  );
}

const isEmpty = (b: BlockSpec) => !(b.md ?? "").trim() && !b.text?.length;

function Placeholder({ width = "w-40" }: { width?: string }) {
  return <span aria-hidden="true" className={cx("mt-[0.6em] block h-[3px] max-w-full rounded-[4px] bg-[color-mix(in_oklab,var(--n-ink)_12%,transparent)]", width)} />;
}

type Props = {
  blocks: BlockSpec[];
  /** Heading element for the template's top heading level; lower levels follow (h3 → h4). */
  topHeading?: 2 | 3;
  title?: string;
  className?: string;
  /** Compact: smaller type for gallery cards. */
  compact?: boolean;
};

export function TemplateSheet({ blocks, topHeading = 3, title, className, compact = false }: Props) {
  const levels = collectLevels(blocks);
  const top = levels.length ? Math.min(...levels) : 2;
  return (
    <article className={cx("mk-note overflow-hidden", className)} style={{ fontFamily: "var(--font-sans)" } as CSSProperties}>
      {title ? (
        <div className={cx(compact ? "px-5 pb-1 pt-5" : "px-5 pb-2 pt-7 sm:px-12 sm:pt-10")}>
          <p className={cx("mk-note-title text-(--n-heading)", compact ? "text-[22px]" : "text-[30px] sm:text-[38px]")}>{title}</p>
        </div>
      ) : null}
      <div className={cx("space-y-2", compact ? "px-5 pb-6 pt-2 text-[12.5px] leading-[1.55]" : "px-5 pb-10 pt-3 text-[14.5px] leading-[1.65] sm:px-12 sm:pb-14 sm:text-[15.5px]")}>
        <Blocks blocks={blocks} depth={0} top={top} topHeading={topHeading} compact={compact} />
      </div>
    </article>
  );
}

function collectLevels(blocks: BlockSpec[]): number[] {
  return blocks.flatMap((b) => [...(b.type === "heading" ? [Number(b.props?.level ?? 2)] : []), ...collectLevels(b.children ?? [])]);
}

function Blocks({ blocks, depth, top, topHeading, compact }: { blocks: BlockSpec[]; depth: number; top: number; topHeading: 2 | 3; compact: boolean }) {
  let counter = 0;
  return (
    <>
      {blocks.map((block, i) => {
        counter = block.type === "numbered" ? counter + 1 : 0;
        return <Block key={i} block={block} depth={depth} index={counter} top={top} topHeading={topHeading} compact={compact} />;
      })}
    </>
  );
}

function Block({ block, depth, index, top, topHeading, compact }: { block: BlockSpec; depth: number; index: number; top: number; topHeading: 2 | 3; compact: boolean }) {
  const indent = depth ? { marginLeft: `${depth * 1.5}em` } : undefined;
  const p = block.props ?? {};
  switch (block.type) {
    case "heading": {
      const level = Number(p.level ?? 2);
      const tag = Math.min(6, topHeading + (level - top));
      const Tag = `h${tag}` as "h2" | "h3" | "h4" | "h5";
      return (
        <Tag className={cx("mk-note-h", level <= top ? (compact ? "pt-2 text-[16px]" : "pt-4 text-[21px] sm:text-[23px]") : compact ? "pt-1.5 text-[14px]" : "pt-3 text-[17.5px]")} style={indent}>
          <Inline md={block.md} />
        </Tag>
      );
    }
    case "paragraph":
      return isEmpty(block) ? <Placeholder width="w-56" /> : <p style={indent}><Inline md={block.md} /></p>;
    case "bulleted":
    case "numbered":
      return (
        <div className="flex gap-2.5" style={indent} aria-hidden={isEmpty(block) || undefined}>
          <span aria-hidden="true" className="mk-note-muted w-4 flex-none text-right tabular-nums">
            {block.type === "numbered" ? `${index}.` : "•"}
          </span>
          {isEmpty(block) ? <Placeholder /> : <span className="min-w-0"><Inline md={block.md} /></span>}
        </div>
      );
    case "todo":
      return (
        <div className="flex items-start gap-2.5" style={indent} aria-hidden={isEmpty(block) || undefined}>
          <span className="mk-check mt-[0.2em]" role={isEmpty(block) ? undefined : "img"} aria-label={isEmpty(block) ? undefined : "To-do, not done"}>
            {p.checked ? <CheckMark /> : null}
          </span>
          {isEmpty(block) ? <Placeholder /> : <span className="min-w-0"><Inline md={block.md} /></span>}
        </div>
      );
    case "quote":
      return (
        <blockquote className="border-l-[3px] border-[color-mix(in_oklab,var(--n-ink)_25%,transparent)] pl-3.5 italic" style={indent}>
          {isEmpty(block) ? <Placeholder /> : <Inline md={block.md} />}
        </blockquote>
      );
    case "callout":
      return (
        <div role="note" className={cx("flex gap-2.5 rounded-[10px] px-3.5 py-2.5", CALLOUT_TONE[String(p.tone ?? "note")] ?? CALLOUT_TONE.note)} style={indent}>
          <Asterisk size={compact ? 13 : 15} aria-hidden="true" className="mk-note-accent mt-[0.25em] flex-none" />
          <span className="min-w-0"><Inline md={block.md} /></span>
        </div>
      );
    case "toggle":
      return (
        <div style={indent}>
          <p className="flex items-start gap-1.5 font-medium">
            <ChevronDown size={compact ? 13 : 15} aria-hidden="true" className="mk-note-muted mt-[0.3em] flex-none" />
            <span className="min-w-0"><Inline md={block.md} /></span>
          </p>
          {block.children?.length ? (
            <div className="mt-1.5 space-y-1.5 pl-5">
              <Blocks blocks={block.children} depth={0} top={top} topHeading={topHeading} compact={compact} />
            </div>
          ) : null}
        </div>
      );
    case "divider":
      return <hr className="my-3 border-0 border-t border-[color-mix(in_oklab,var(--n-ink)_16%,transparent)]" />;
    case "table": {
      const rows = (p.rows as InlineNode[][][] | undefined) ?? [];
      const header = p.headerRow ? rows[0] : undefined;
      const body = header ? rows.slice(1) : rows;
      return (
        <div className="my-2 overflow-x-auto" style={indent}>
          <table className={cx("w-full border-collapse", compact ? "text-[11.5px]" : "text-[13.5px]")}>
            {header ? (
              <thead>
                <tr>
                  {header.map((cell, c) => (
                    <th key={c} scope="col" className="border border-[color-mix(in_oklab,var(--n-ink)_16%,transparent)] bg-[color-mix(in_oklab,var(--n-ink)_4%,transparent)] px-2.5 py-1.5 text-left font-semibold">
                      <Inline nodes={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="h-8 border border-[color-mix(in_oklab,var(--n-ink)_16%,transparent)] px-2.5 py-1.5">
                      <Inline nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    default:
      return null;
  }
}
