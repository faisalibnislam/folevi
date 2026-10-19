// The sticky notes drawn without editing: read-only notes, share pages, version history. For now each group
// with its notes as small coloured cards; the sticky notes build draws the board itself here.
import { parseStickies, stickiesByGroup } from "@folevi/editor-schema";

export function StickiesStatic({ data }: { data: string; height?: number }) {
  const groups = stickiesByGroup(parseStickies(data));
  if (!groups.length) return <p className="fb-vc-static-empty">Empty board</p>;
  return (
    <div className="fb-stickies-list">
      {groups.map(({ group, notes }, i) => (
        <section key={group?.id ?? `loose-${i}`} aria-label={group?.label || "Notes"}>
          {group?.label ? <h4>{group.label}</h4> : null}
          <ul>
            {notes.map((n) => (
              <li key={n.id} data-color={n.color}>
                {n.text.trim() || "Empty note"}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
