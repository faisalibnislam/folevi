import { Fragment } from "react";
import { flattenTree, sanitizeHref, type InlineNode, type WireBlock } from "@folevi/editor-schema";
import { formatCalendarDate } from "@/i18n";
import { ReadOnlyCollection, type ReadOnlyCollectionData } from "@/components/views/ReadOnlyCollection";
import { FormulaRender, MermaidDiagram, WhiteboardStatic } from "@/components/editor/RichBlocks";

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === "mention") return <span key={i} className="fb-mention">@{n.label}</span>;
        if (n.type === "date") return <time key={i} className="fb-date" dateTime={n.date}>{formatCalendarDate(n.date)}</time>;
        if (n.type === "pageLink") return <span key={i} className="fb-page-link">{n.label}</span>;
        let el: React.ReactNode = n.text.split("\n").map((part, j, arr) => (
          <Fragment key={j}>
            {part}
            {j < arr.length - 1 ? <br /> : null}
          </Fragment>
        ));
        for (const m of n.marks ?? []) {
          if (m.type === "bold") el = <strong>{el}</strong>;
          else if (m.type === "italic") el = <em>{el}</em>;
          else if (m.type === "underline") el = <u>{el}</u>;
          else if (m.type === "strike") el = <s>{el}</s>;
          else if (m.type === "code") el = <code className="fb-inline-code">{el}</code>;
          else if (m.type === "color") el = <span className={`fb-color-${m.value}`}>{el}</span>;
          else if (m.type === "highlight") el = <mark className={`fb-hl-${m.value}`}>{el}</mark>;
          else if (m.type === "link") {
            const href = sanitizeHref(m.href);
            el = href ? <a className="fb-link" href={href} rel="noopener noreferrer nofollow">{el}</a> : el;
          }
        }
        return <Fragment key={i}>{el}</Fragment>;
      })}
    </>
  );
}

/** Server-rendered read-only document body (public share pages). Uses the editor stylesheet classes. */
export function ReadOnlyBlocks({
  blocks,
  fileUrls,
  collections,
}: {
  blocks: WireBlock[];
  fileUrls: Record<string, string>;
  /** Read-only data for collection blocks, keyed by collection id (from the share-link response). */
  collections?: Record<string, ReadOnlyCollectionData>;
}) {
  const flat = flattenTree(blocks);
  const counters: number[] = [];
  let hideBelow: number | null = null;
  return (
    <div className="fb-editor" style={{ paddingBottom: 48 }}>
      {flat.map(({ block, depth }) => {
        if (hideBelow !== null && depth <= hideBelow) hideBelow = null;
        if (hideBelow !== null) return null;
        const p = block.props as Record<string, unknown>;
        const style = { ["--depth" as string]: depth } as React.CSSProperties;
        // Format panel styling (decoration, colour, alignment, font, group, text style) — see editor.css.
        const fa: Record<string, string> = {};
        for (const [prop, attr] of [["decoration", "data-decoration"], ["color", "data-color"], ["align", "data-align"], ["font", "data-font"], ["group", "data-group"], ["textStyle", "data-text-style"]] as const) {
          if (typeof p[prop] === "string") fa[attr] = p[prop] as string;
        }
        if (block.type === "numbered") {
          counters.length = depth + 1;
          counters[depth] = (counters[depth] ?? 0) + 1;
        } else counters.length = depth;
        switch (block.type) {
          case "heading": {
            const level = Math.min(3, Number(p.level) || 1);
            const Tag = (["h2", "h3", "h4"] as const)[level - 1]!;
            return <Tag key={block.id} className={`fb fb-heading fb-h${level}`} style={style} {...fa}><Inline nodes={block.text} /></Tag>;
          }
          case "paragraph":
            return <p key={block.id} className="fb fb-paragraph" style={style} {...fa}><Inline nodes={block.text} /></p>;
          case "bulleted":
            return <div key={block.id} className="fb fb-bulleted" data-depth={depth} style={style} {...fa}><Inline nodes={block.text} /></div>;
          case "numbered":
            return <div key={block.id} className="fb fb-numbered" data-index={counters[depth]} style={style} {...fa}><Inline nodes={block.text} /></div>;
          case "todo":
            return (
              <div key={block.id} className="fb fb-todo" data-checked={p.checked ? "true" : "false"} style={style} {...fa}>
                <span className="fb-check" role="img" aria-label={p.checked ? "Done" : "Not done"} />
                <div className="fb-content"><Inline nodes={block.text} /></div>
              </div>
            );
          case "toggle":
            if (p.collapsed) hideBelow = depth;
            return (
              <details key={block.id} className="fb" style={style} {...fa} open={!p.collapsed}>
                <summary className="font-medium"><Inline nodes={block.text} /></summary>
              </details>
            );
          case "quote":
            return <blockquote key={block.id} className="fb fb-quote" style={style} {...fa}><Inline nodes={block.text} /></blockquote>;
          case "callout":
            return (
              <div key={block.id} role="note" className={`fb fb-callout fb-tone-${String(p.tone ?? "note")}`} style={style} {...fa}>
                <span className="fb-callout-icon" aria-hidden>{String(p.icon ?? "✳︎")}</span>
                <div className="fb-content"><Inline nodes={block.text} /></div>
              </div>
            );
          case "code":
            if (p.language === "mermaid" && String(p.code ?? "").trim()) {
              return (
                <figure key={block.id} className="fb-readonly-mermaid" style={{ marginLeft: `${depth * 1.6}em` }}>
                  <MermaidDiagram code={String(p.code)} label="Mermaid diagram" />
                  <details>
                    <summary>Diagram source</summary>
                    <pre><code>{String(p.code)}</code></pre>
                  </details>
                </figure>
              );
            }
            return <pre key={block.id} className="fb fb-code" data-language={String(p.language)} style={style} {...fa}><code>{String(p.code ?? "")}</code></pre>;
          case "divider":
            return <div key={block.id} className="fb fb-divider" data-style={p.style ? String(p.style) : undefined} role="separator"><hr /></div>;
          case "pageBreak":
            return (
              <div key={block.id} className="fb fb-page-break" role="separator" aria-label="Page break">
                <span className="fb-page-break-label" aria-hidden>Page break</span>
              </div>
            );
          case "formula":
            return (
              <div key={block.id} className="fb-readonly-formula" style={{ marginLeft: `${depth * 1.6}em` }}>
                <FormulaRender latex={String(p.latex ?? "")} />
              </div>
            );
          case "whiteboard":
            return (
              <div key={block.id} className="fb-readonly-whiteboard" style={{ marginLeft: `${depth * 1.6}em` }}>
                <WhiteboardStatic data={String(p.data ?? "")} height={Number(p.height)} />
              </div>
            );
          case "image": {
            const src = p.fileId ? fileUrls[String(p.fileId)] : sanitizeHref(String(p.url ?? ""));
            return src ? (
              <figure key={block.id} className="my-3" style={{ width: `${Math.round(Number(p.width ?? 1) * 100)}%` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={String(p.alt ?? "")} className="w-full rounded-[6px] border border-line" />
                {p.caption ? <figcaption className="mt-1 text-center text-sm text-muted">{String(p.caption)}</figcaption> : null}
              </figure>
            ) : null;
          }
          case "file": {
            const href = fileUrls[String(p.fileId)];
            return (
              <p key={block.id} className="fb">
                {href ? <a className="fb-link" href={href} download>{String(p.name ?? "Attachment")}</a> : String(p.name ?? "Attachment")}
              </p>
            );
          }
          case "table": {
            const rows = (p.rows as InlineNode[][][]) ?? [];
            return (
              <div key={block.id} className="my-3 overflow-x-auto">
                <table className="fb-table w-full border-collapse text-sm">
                  <tbody>
                    {rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) =>
                          r === 0 && p.headerRow ? (
                            <th key={c} scope="col" className="border border-line px-2.5 py-1.5 text-left"><Inline nodes={cell} /></th>
                          ) : (
                            <td key={c} className="border border-line px-2.5 py-1.5"><Inline nodes={cell} /></td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          case "page":
            return <p key={block.id} className="fb text-muted">📄 {String(p.titleCache ?? "Nested page")} <span className="text-xs">(not included in this shared page)</span></p>;
          case "collection":
            return <ReadOnlyCollection key={block.id} data={collections?.[String(p.collectionId)]} />;
          case "bookmark": {
            const href = sanitizeHref(String(p.url ?? ""));
            return (
              <p key={block.id} className="fb">
                <a className="fb-link" href={href ?? "#"} rel="noopener noreferrer nofollow">{String(p.title ?? p.url)}</a>
              </p>
            );
          }
          default:
            return null;
        }
      })}
    </div>
  );
}
