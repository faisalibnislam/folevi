// The wireframe drawn without editing: read-only notes, share pages, version history. For now each screen
// with its parts listed top to bottom; the wireframe build draws the screens themselves here.
import { WIREFRAME_COMPONENT_LABEL, WIREFRAME_FRAME_LABEL, parseWireframe, wireframeScreenItems } from "@folevi/editor-schema";

export function WireframeStatic({ data }: { data: string; height?: number }) {
  const wf = parseWireframe(data);
  if (!wf.screens.length) return <p className="fb-vc-static-empty">Empty wireframe</p>;
  const items = wireframeScreenItems(wf);
  return (
    <div className="fb-wireframe-list">
      {wf.screens.map((s) => (
        <section key={s.id} aria-label={s.name || "Untitled screen"}>
          <h4>
            {s.name || "Untitled screen"} <span>{WIREFRAME_FRAME_LABEL[s.frame]}</span>
          </h4>
          <ul>
            {(items.get(s.id) ?? []).map((it) => (
              <li key={it.id}>
                {WIREFRAME_COMPONENT_LABEL[it.kind]}
                {it.text.trim() ? `: ${it.text.trim()}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
