// The editor's text size applies on every page (Shell), not only while Settings > Appearance is open.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EDITOR_ZOOM_KEY, useEditorZoom } from "@/lib/editorZoom";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  useEditorZoom();
  return null;
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty("--editor-zoom");
});

describe("useEditorZoom", () => {
  it("applies the kept size at once and follows changes", () => {
    localStorage.setItem(EDITOR_ZOOM_KEY, "1.2");
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Probe />));
    expect(document.documentElement.style.getPropertyValue("--editor-zoom")).toBe("1.2");
    localStorage.setItem(EDITOR_ZOOM_KEY, "0.9");
    act(() => void window.dispatchEvent(new Event(`folevi-ls:${EDITOR_ZOOM_KEY}`)));
    expect(document.documentElement.style.getPropertyValue("--editor-zoom")).toBe("0.9");
    localStorage.setItem(EDITOR_ZOOM_KEY, "1.1");
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: EDITOR_ZOOM_KEY })));
    expect(document.documentElement.style.getPropertyValue("--editor-zoom")).toBe("1.1");
    act(() => root.unmount());
  });

  it("falls back to 100 % for a bad value", () => {
    localStorage.setItem(EDITOR_ZOOM_KEY, "\"big\"");
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Probe />));
    expect(document.documentElement.style.getPropertyValue("--editor-zoom")).toBe("1");
    act(() => root.unmount());
  });
});
