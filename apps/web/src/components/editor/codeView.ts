// Node view for code blocks. It renders exactly what Code.renderHTML does (pre > code). Mermaid blocks
// become a diagram card instead: the rendered diagram in a clean frame, with the source folded away
// behind "Edit diagram" and shown while the caret is in it (mermaidFocusPlugin marks that block), and
// "Convert to flowchart" for flowchart diagrams. The card chrome is outside the editable text.
import type { NodeViewRenderer } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { LIMITS, flowchartBounds, mermaidToFlowchart, serializeFlowchart, ulid } from "@folevi/editor-schema";
import { onThemeChange, renderMermaid, svgDataUrl } from "./richRender";
import { neighbourIndex } from "./blockSelectionState";

const PREVIEW_DELAY = 350;

/** Marks the Mermaid block holding the caret, so its node view shows the source. */
export const mermaidFocusPlugin = new Plugin({
  key: new PluginKey("mermaidFocus"),
  props: {
    // Its source is folded away, so the caret can't move through a Mermaid block line by line: ↑/↓ from the
    // block next to it select the whole block instead.
    handleKeyDown(view, event) {
      if ((event.key !== "ArrowUp" && event.key !== "ArrowDown") || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
      const { state } = view;
      const dir = event.key === "ArrowDown" ? 1 : -1;
      const sel = state.selection;
      if (!(sel instanceof NodeSelection) && !view.endOfTextblock(dir > 0 ? "down" : "up")) return false;
      const $pos = dir > 0 ? state.doc.resolve(sel.to) : state.doc.resolve(sel.from);
      const here = $pos.depth === 0 ? (dir > 0 ? $pos.index(0) - 1 : $pos.index(0)) : $pos.index(0);
      // The next visible block (blocks hidden in a collapsed toggle are skipped).
      const index = neighbourIndex(state, here, dir);
      if (index === null) {
        // A selected diagram at the very end of the note: ↓ opens a new line below it (rather than the
        // browser jumping the caret back up); at the very start, ↑ stays put.
        if (sel instanceof NodeSelection && sel.node.type.name === "codeBlock") {
          if (dir > 0) {
            const tr = state.tr.insert(sel.to, state.schema.nodes.paragraph!.create({ id: null, depth: sel.node.attrs.depth }));
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, sel.to + 1)).scrollIntoView());
          }
          return true;
        }
        return false;
      }
      const target = state.doc.maybeChild(index);
      if (!target || target.type.name !== "codeBlock" || target.attrs.language !== "mermaid" || !target.textContent.trim()) return false;
      let at = 0;
      for (let i = 0; i < index; i++) at += state.doc.child(i).nodeSize;
      view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, at)).scrollIntoView());
      return true;
    },
    decorations(state) {
      const { $from, $to } = state.selection;
      const parent = $from.parent;
      if (parent !== $to.parent || parent.type.name !== "codeBlock" || parent.attrs.language !== "mermaid" || $from.depth < 1) return null;
      const pos = $from.before();
      return DecorationSet.create(state.doc, [Decoration.node(pos, pos + parent.nodeSize, {}, { mermaidActive: true })]);
    },
  },
});

const isFlowchartSource = (s: string) => /^\s*(?:%%[^\n]*\n\s*)*(flowchart|graph)\b/i.test(s);

export const codeBlockNodeView: NodeViewRenderer = ({ node, getPos, editor, decorations }) => {
  let current: PMNode = node;
  const dom = document.createElement("pre");
  dom.className = "fb fb-code";
  dom.dataset.block = "code";
  const content = document.createElement("code");
  dom.append(content);
  const view = (): EditorView => editor.view;
  const pos = () => (typeof getPos === "function" ? getPos() : undefined);

  let bar: HTMLElement | null = null;
  let editBtn: HTMLButtonElement | null = null;
  let convertBtn: HTMLButtonElement | null = null;
  let note: HTMLElement | null = null;
  let preview: HTMLElement | null = null;
  let lastImage: HTMLImageElement | null = null;
  let timer: number | null = null;
  let renderedSource: string | null = null;
  let token = 0;
  let focused = (decorations ?? []).some((d) => (d as unknown as { spec?: { mermaidActive?: boolean } }).spec?.mermaidActive);
  let stopTheme: (() => void) | null = null;

  const renderPreview = () => {
    if (!preview) return;
    const source = current.textContent;
    if (source === renderedSource) return;
    renderedSource = source;
    const mine = ++token;
    if (!source.trim()) {
      lastImage = null;
      preview.replaceChildren(status("Write a Mermaid diagram above to see it here."));
      return;
    }
    if (!preview.firstChild) preview.replaceChildren(status("Rendering diagram…"));
    void renderMermaid(source, preview).then((result) => {
      if (mine !== token || !preview) return;
      if ("error" in result) {
        // Keep the last good drawing (faded) above the message, so the card doesn't jump while typing.
        const p = status(`Couldn’t draw this diagram. ${result.error}`);
        p.className = "fb-mermaid-error";
        preview.dataset.stale = lastImage ? "true" : "false";
        preview.replaceChildren(...(lastImage ? [lastImage, p] : [p]));
        return;
      }
      const img = document.createElement("img");
      img.className = "fb-mermaid-svg";
      img.alt = "Mermaid diagram";
      img.width = result.width;
      img.height = result.height;
      img.draggable = false;
      img.src = svgDataUrl(result.svg);
      lastImage = img;
      delete preview.dataset.stale;
      preview.replaceChildren(img);
    });
  };

  const schedule = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      renderPreview();
    }, renderedSource === null ? 0 : PREVIEW_DELAY);
  };

  /** Puts the caret at the end of the source (showing it). */
  const edit = () => {
    const p = pos();
    if (typeof p !== "number" || !editor.isEditable) return;
    const v = view();
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, p + 1 + current.content.size)));
    v.focus();
  };
  /** Folds the source away by selecting the whole block. */
  const done = () => {
    const p = pos();
    if (typeof p !== "number") return;
    const v = view();
    v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, p)));
    v.focus();
  };
  const convert = () => {
    const p = pos();
    if (typeof p !== "number" || !editor.isEditable || !note) return;
    const res = mermaidToFlowchart(current.textContent);
    if (!res.ok) {
      note.textContent = res.error;
      note.hidden = false;
      return;
    }
    const v = view();
    const type = v.state.schema.nodes.flowchart;
    if (!type) return;
    const b = flowchartBounds(res.data);
    const height = Math.round(Math.max(LIMITS.minFlowchartHeight, Math.min(720, (b?.h ?? 300) + 140)));
    const replacement = type.create({ id: ulid(), depth: current.attrs.depth ?? 0, data: serializeFlowchart(res.data), height });
    const tr = v.state.tr.replaceWith(p, p + current.nodeSize, replacement);
    tr.setSelection(NodeSelection.create(tr.doc, p));
    v.dispatch(tr.scrollIntoView());
    v.focus();
  };

  const button = (label: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fb-mermaid-btn";
    b.textContent = label;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", onClick);
    return b;
  };

  const buildCard = () => {
    bar = document.createElement("div");
    bar.className = "fb-mermaid-bar";
    bar.contentEditable = "false";
    const label = document.createElement("span");
    label.className = "fb-mermaid-label";
    label.textContent = "Mermaid";
    note = document.createElement("span");
    note.className = "fb-mermaid-note";
    note.setAttribute("role", "status");
    note.hidden = true;
    convertBtn = button("Convert to flowchart", convert);
    convertBtn.title = "Turn this diagram into an editable flowchart";
    editBtn = button("Edit diagram", () => (editing() ? done() : edit()));
    bar.append(label, note, convertBtn, editBtn);
    preview = document.createElement("div");
    preview.className = "fb-mermaid-preview";
    preview.contentEditable = "false";
    preview.setAttribute("aria-label", "Diagram preview");
    preview.setAttribute("role", "group");
    preview.addEventListener("dblclick", edit);
    // A click on the diagram selects the block (Enter then edits it, Backspace removes it).
    preview.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || (e.target instanceof Element && e.target.closest("button, a"))) return;
      const p = pos();
      if (p === undefined) return;
      e.preventDefault();
      const v = view();
      v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, p)));
      v.focus();
    });
    dom.prepend(bar);
    dom.append(preview);
    renderedSource = null;
    stopTheme = onThemeChange(() => {
      renderedSource = null;
      schedule();
    }, dom);
  };

  const dropCard = () => {
    bar?.remove();
    preview?.remove();
    stopTheme?.();
    bar = preview = note = editBtn = convertBtn = lastImage = null;
    stopTheme = null;
    token++;
    delete dom.dataset.editing;
  };

  const editing = () => focused || !current.textContent.trim();

  const sync = () => {
    const a = current.attrs;
    dom.dataset.blockId = a.id ?? "";
    dom.dataset.depth = String(a.depth ?? 0);
    dom.style.setProperty("--depth", String(a.depth ?? 0));
    dom.dataset.language = a.language ?? "plaintext";
    const mermaid = a.language === "mermaid";
    dom.classList.toggle("fb-code-mermaid", mermaid);
    if (mermaid && !preview) buildCard();
    else if (!mermaid && preview) dropCard();
    if (!preview) return;
    const on = editing();
    dom.dataset.editing = on ? "true" : "false";
    if (editBtn) {
      editBtn.textContent = on ? "Done" : "Edit diagram";
      editBtn.setAttribute("aria-expanded", on ? "true" : "false");
      editBtn.hidden = !editor.isEditable;
    }
    if (convertBtn) convertBtn.hidden = !editor.isEditable || !isFlowchartSource(current.textContent);
    if (note && !on) note.hidden = true;
    schedule();
  };
  sync();

  const inCard = (t: EventTarget | null) => t instanceof Node && Boolean((preview && preview.contains(t)) || (bar && bar.contains(t)));

  return {
    dom,
    contentDOM: content,
    update(updated, decos) {
      if (updated.type !== current.type) return false;
      current = updated;
      focused = decos.some((d) => (d as unknown as { spec?: { mermaidActive?: boolean } }).spec?.mermaidActive);
      sync();
      return true;
    },
    ignoreMutation: (m) => inCard(m.target) || (m.type === "attributes" && m.target === dom),
    stopEvent: (e) => inCard(e.target),
    destroy() {
      stopTheme?.();
      if (timer !== null) window.clearTimeout(timer);
      token++;
    },
  };
};

function status(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "fb-mermaid-status";
  p.setAttribute("role", "status");
  p.textContent = text;
  return p;
}
