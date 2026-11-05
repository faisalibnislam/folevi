// A published page's Foli DNA (the link's "Show Foli DNA" option): the note in the middle and the notes it links to
// around it, read only. Only the page's own links, with the labels the server already gave every reader of this
// page (convex/sharing.ts sharedLabels: a page they may not see has no title here), and never what links to it.
/** What the server calls a page this page's readers can't open (convex/lib/linkLabels.ts HIDDEN_PAGE_LABEL). */
const HIDDEN_PAGE_LABEL = "Page you can't open";

type Inline = { type: string; documentId?: string; label?: string };
type Block = { type?: string; text?: unknown; props?: unknown };

/** The notes this page links to, once each, with the labels its readers may see. */
export function publishedLinks(blocks: readonly Block[]): { id: string; label: string }[] {
  const out = new Map<string, string>();
  const add = (id: unknown, label: unknown) => {
    const name = typeof label === "string" ? label.trim() : "";
    // A page this page's readers can't open is left out (not even a dot for it).
    if (typeof id === "string" && name && name !== HIDDEN_PAGE_LABEL && !out.has(id)) out.set(id, name);
  };
  for (const b of blocks) {
    const props = (b.props ?? {}) as Record<string, unknown>;
    if (b.type === "page") add(props.documentId, props.titleCache);
    if (Array.isArray(b.text)) for (const n of b.text as Inline[]) if (n?.type === "pageLink") add(n.documentId, n.label);
  }
  return [...out].slice(0, 24).map(([id, label]) => ({ id, label }));
}

export function PublishedDna({ title, blocks }: { title: string; blocks: readonly Block[] }) {
  const links = publishedLinks(blocks);
  if (!links.length) return null;
  const R = links.length <= 6 ? 110 : 140;
  const W = 520;
  const H = 2 * R + 80;
  const cx = W / 2;
  const cy = H / 2;
  return (
    <section aria-label="Foli DNA" className="mt-10 border-t border-line pt-6">
      <h2 className="ui-caps mb-3">Foli DNA</h2>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title || "Untitled"} links to ${links.map((l) => l.label).join(", ")}.`} className="mx-auto block w-full max-w-[520px]">
        {links.map((l, i) => {
          const a = (i / links.length) * 2 * Math.PI - Math.PI / 2;
          return <line key={`l${l.id}`} x1={cx} y1={cy} x2={cx + Math.cos(a) * R} y2={cy + Math.sin(a) * R} stroke="var(--color-line-strong)" strokeWidth={1.2} />;
        })}
        <circle cx={cx} cy={cy} r={12} fill="var(--color-heading)" />
        <text x={cx} y={cy + 28} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--color-heading)" style={{ paintOrder: "stroke", stroke: "var(--color-canvas)", strokeWidth: 4 }}>
          {(title || "Untitled").slice(0, 40)}
        </text>
        {links.map((l, i) => {
          const a = (i / links.length) * 2 * Math.PI - Math.PI / 2;
          const x = cx + Math.cos(a) * R;
          const y = cy + Math.sin(a) * R;
          return (
            <g key={l.id}>
              <circle cx={x} cy={y} r={7} fill="var(--color-ink-muted)" stroke="var(--color-canvas)" strokeWidth={1.5} />
              <text x={x} y={y + 20} textAnchor="middle" fontSize={11.5} fill="var(--color-ink)" style={{ paintOrder: "stroke", stroke: "var(--color-canvas)", strokeWidth: 3 }}>
                {l.label.slice(0, 32)}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
