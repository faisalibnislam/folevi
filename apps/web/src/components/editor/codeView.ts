// Node view for code blocks. It renders exactly what Code.renderHTML does (pre > code), and for
// `mermaid` blocks adds a live diagram preview under the source (read-only area outside the text).
import type { NodeViewRenderer } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { onThemeChange, renderMermaid, svgDataUrl } from "./richRender";

const PREVIEW_DELAY = 350;

export const codeBlockNodeView: NodeViewRenderer = ({ node }) => {
  let current: PMNode = node;
  const dom = document.createElement("pre");
  dom.className = "fb fb-code";
  dom.dataset.block = "code";
  const content = document.createElement("code");
  dom.append(content);

  let preview: HTMLElement | null = null;
  let timer: number | null = null;
  let renderedSource: string | null = null;
  let token = 0;

  const renderPreview = () => {
    if (!preview) return;
    const source = current.textContent;
    if (source === renderedSource) return;
    renderedSource = source;
    const mine = ++token;
    if (!source.trim()) {
      preview.replaceChildren(status("Write a Mermaid diagram above to see it here."));
      return;
    }
    if (!preview.firstChild) preview.replaceChildren(status("Rendering diagram…"));
    void renderMermaid(source).then((result) => {
      if (mine !== token || !preview) return;
      if ("error" in result) {
        const p = status(`Couldn’t draw this diagram. ${result.error}`);
        p.className = "fb-mermaid-error";
        preview.replaceChildren(p);
        return;
      }
      const img = document.createElement("img");
      img.className = "fb-mermaid-svg";
      img.alt = "Mermaid diagram preview";
      img.width = result.width;
      img.height = result.height;
      img.draggable = false;
      img.src = svgDataUrl(result.svg);
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

  const sync = () => {
    const a = current.attrs;
    dom.dataset.blockId = a.id ?? "";
    dom.dataset.depth = String(a.depth ?? 0);
    dom.style.setProperty("--depth", String(a.depth ?? 0));
    dom.dataset.language = a.language ?? "plaintext";
    const mermaid = a.language === "mermaid";
    dom.classList.toggle("fb-code-mermaid", mermaid);
    if (mermaid && !preview) {
      preview = document.createElement("div");
      preview.className = "fb-mermaid-preview";
      preview.contentEditable = "false";
      preview.setAttribute("aria-label", "Diagram preview");
      preview.setAttribute("role", "group");
      dom.append(preview);
      renderedSource = null;
    } else if (!mermaid && preview) {
      preview.remove();
      preview = null;
      token++;
    }
    if (preview) schedule();
  };
  sync();
  const stopTheme = onThemeChange(() => {
    renderedSource = null;
    if (preview) schedule();
  });

  return {
    dom,
    contentDOM: content,
    update(updated) {
      if (updated.type !== current.type) return false;
      current = updated;
      sync();
      return true;
    },
    ignoreMutation: (m) => Boolean(preview && (m.target === preview || preview.contains(m.target as Node))),
    stopEvent: (e) => Boolean(preview && e.target instanceof Node && preview.contains(e.target)),
    destroy() {
      stopTheme();
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
