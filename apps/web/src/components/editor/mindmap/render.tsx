// The mind map drawn without editing: read-only notes, share pages, version history. For now its outline
// (the central idea, then each branch nested under it); the mind map build draws the map itself here.
import { mindmapOutline, parseMindmap } from "@folevi/editor-schema";

export function MindmapStatic({ data }: { data: string; height?: number }) {
  const outline = mindmapOutline(parseMindmap(data));
  if (!outline.length) return <p className="fb-vc-static-empty">Empty mind map</p>;
  return (
    <ul className="fb-mindmap-outline" aria-label="Mind map outline">
      {outline.map(({ node, depth }) => (
        <li key={node.id} style={{ paddingLeft: `${depth * 1.25}em` }} data-depth={depth}>
          {node.text.trim() || "Idea"}
        </li>
      ))}
    </ul>
  );
}
