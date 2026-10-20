"use client";

// The tab strip of a tabs block (tabs/tabsExtension.ts): a tablist of the block's tabs. Click or arrow keys
// open a tab (each viewer's own choice); in an editable note, + adds one, a double-click or F2 renames, a drag
// or Option+Shift+arrows reorders, and the tab's menu (right-click, a long press, or the … button) renames,
// moves and deletes. Many tabs scroll sideways.
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { ContextMenu, MenuButton, type MenuItem } from "@/components/ui/Menu";
import { haptic } from "@/lib/nativeApp";
import { useEditable } from "../useEditable";
import { layoutOf, type TabsGroup } from "./tabsState";
import { addTab, deleteTab, moveTab, openTab, renameTab, writeInTab } from "./tabsExtension";
import "./tabs.css";

interface StripState {
  tabs: { id: string; name: string; empty: boolean }[];
  open: string | null;
}

const NONE: StripState = { tabs: [], open: null };

function stripOf(group: TabsGroup | undefined): StripState {
  if (!group) return NONE;
  return { tabs: group.tabs.map((t) => ({ id: t.id, name: t.name, empty: t.end === t.index + 1 })), open: group.open };
}

/** The block's tabs and the open one, kept current (an atom's view isn't redrawn when the lines after it change). */
function useStrip(editor: ReactNodeViewProps["editor"], tabsId: string): StripState {
  const last = useRef<{ key: string; value: StripState }>({ key: "", value: NONE });
  const subscribe = useCallback(
    (onChange: () => void) => {
      editor.on("transaction", onChange);
      return () => {
        editor.off("transaction", onChange);
      };
    },
    [editor],
  );
  const read = useCallback(() => {
    if (editor.isDestroyed) return last.current.value;
    const value = stripOf(layoutOf(editor.state).byId.get(tabsId));
    const key = JSON.stringify(value);
    if (key !== last.current.key) last.current = { key, value };
    return last.current.value;
  }, [editor, tabsId]);
  return useSyncExternalStore(subscribe, read, () => NONE);
}

export function TabsView({ node, editor, selected }: ReactNodeViewProps) {
  const tabsId = String(node.attrs.id ?? "");
  const strip = useStrip(editor, tabsId);
  const editable = useEditable(editor);
  const listRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  // A tab being dragged along the strip: where it would go.
  const [drag, setDrag] = useState<{ tabId: string; to: number; dx: number } | null>(null);
  const view = editor.view;

  const open = useCallback(
    (tabId: string, focus = true) => {
      if (tabId !== strip.open) haptic("light");
      openTab(view, tabsId, tabId);
      if (focus) requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tabId)}"]`)?.focus());
    },
    [view, tabsId, strip.open],
  );

  // The open tab stays in sight in a strip that scrolls.
  useLayoutEffect(() => {
    if (!strip.open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(strip.open)}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [strip.open]);

  // The strip's own menu, never the note's block menu (and before the editor sees the right-click).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onContext = (e: MouseEvent) => {
      const tab = (e.target as Element | null)?.closest?.<HTMLElement>("[data-tab-id]");
      e.stopPropagation();
      if (!tab || !editable) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, tabId: tab.dataset.tabId! });
    };
    list.addEventListener("contextmenu", onContext);
    return () => list.removeEventListener("contextmenu", onContext);
  }, [editable]);

  const itemsFor = (tabId: string): MenuItem[] => {
    const i = strip.tabs.findIndex((t) => t.id === tabId);
    return [
      { label: "Rename", icon: <Pencil size={14} />, shortcut: "F2", onSelect: () => setRenaming(tabId) },
      { label: "Move left", icon: <ArrowLeft size={14} />, shortcut: "⌥⇧←", disabled: i <= 0, onSelect: () => moveTab(view, tabsId, tabId, i - 1) },
      { label: "Move right", icon: <ArrowRight size={14} />, shortcut: "⌥⇧→", disabled: i < 0 || i >= strip.tabs.length - 1, onSelect: () => moveTab(view, tabsId, tabId, i + 1) },
      { label: strip.tabs.length === 1 ? "Delete tabs" : "Delete tab", icon: <Trash2 size={14} />, danger: true, onSelect: () => deleteTab(view, tabsId, tabId) },
    ];
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, tabId: string) => {
    if (renaming) return;
    const i = strip.tabs.findIndex((t) => t.id === tabId);
    const go = (k: number) => {
      const t = strip.tabs[(k + strip.tabs.length) % strip.tabs.length];
      if (t) open(t.id);
    };
    if (e.altKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && editable) {
      e.preventDefault();
      moveTab(view, tabsId, tabId, i + (e.key === "ArrowLeft" ? -1 : 1));
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tabId)}"]`)?.focus());
      return;
    }
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        go(i - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        go(i + 1);
        break;
      case "Home":
        e.preventDefault();
        go(0);
        break;
      case "End":
        e.preventDefault();
        go(strip.tabs.length - 1);
        break;
      case "ArrowDown":
      case "Enter":
        // Into the tab's text (an empty tab gets a line to write on).
        e.preventDefault();
        if (strip.tabs[i]?.empty && editable) writeInTab(view, tabsId, tabId);
        else openTab(view, tabsId, tabId, true);
        break;
      case "Escape":
        e.preventDefault();
        view.focus();
        break;
      case "F2":
        if (editable) {
          e.preventDefault();
          setRenaming(tabId);
        }
        break;
      default:
        if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
          if (!editable) return;
          e.preventDefault();
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom, tabId });
        }
    }
  };

  // Dragging a tab along the strip (mouse and pen; on a touch screen the strip scrolls, and the menu moves tabs).
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>, tabId: string) => {
    if (!editable || e.button !== 0 || e.pointerType === "touch" || renaming) return;
    const startX = e.clientX;
    const button = e.currentTarget;
    const others = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [])];
    const mids = others.map((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    const from = strip.tabs.findIndex((t) => t.id === tabId);
    let moving = false;
    let to = from;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moving && Math.abs(dx) < 6) return;
      moving = true;
      const x = mids[from]! + dx;
      to = mids.filter((m, k) => k !== from && m < x).length;
      setDrag({ tabId, to, dx });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      setDrag(null);
      if (moving && to !== from) moveTab(view, tabsId, tabId, to);
      if (moving) {
        // The click that ends a drag doesn't also open the tab.
        button.addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true });
      }
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  };

  const openTabInfo = strip.tabs.find((t) => t.id === strip.open);

  return (
    <NodeViewWrapper className={`fb-tabs ${selected ? "fb-tabs-selected" : ""}`} contentEditable={false} data-tabs-id={tabsId}>
      <div className="fb-tabs-bar">
        <div ref={listRef} role="tablist" aria-label="Tabs" aria-orientation="horizontal" className="fb-tabs-list">
          {strip.tabs.map((t, i) => {
            const isOpen = t.id === strip.open;
            const shift = drag && drag.tabId !== t.id ? (() => {
              const from = strip.tabs.findIndex((x) => x.id === drag.tabId);
              if (from < i && drag.to >= i) return "fb-tab-shift-left";
              if (from > i && drag.to <= i) return "fb-tab-shift-right";
              return "";
            })() : "";
            if (renaming === t.id) {
              return (
                <span key={t.id} className="fb-tab-button is-open is-renaming">
                  <RenameField
                    name={t.name}
                    onDone={(name) => {
                      setRenaming(null);
                      if (name !== null) renameTab(view, tabsId, t.id, name);
                      requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(t.id)}"]`)?.focus());
                    }}
                  />
                </span>
              );
            }
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`fb-tab-${t.id}`}
                data-tab-id={t.id}
                aria-selected={isOpen}
                tabIndex={isOpen ? 0 : -1}
                // Enter on the selected block comes here (see the block keymap's Enter).
                data-enter-focus={isOpen ? "" : undefined}
                className={`fb-tab-button ${isOpen ? "is-open" : ""} ${drag?.tabId === t.id ? "is-dragging" : ""} ${shift}`}
                style={drag?.tabId === t.id ? { transform: `translateX(${drag.dx}px)` } : undefined}
                // Keep the note's caret where it is until a tab is chosen.
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={(e) => onPointerDown(e, t.id)}
                // A click opens the tab and leaves the caret where it was (arrow keys move focus along the strip).
                onClick={() => open(t.id, false)}
                onDoubleClick={() => editable && setRenaming(t.id)}
                onKeyDown={(e) => onKeyDown(e, t.id)}
              >
                <span className="fb-tab-name">{t.name}</span>
              </button>
            );
          })}
        </div>
        {editable ? (
          <div className="fb-tabs-tools">
            <button
              type="button"
              className="fb-tabs-tool"
              aria-label="Add a tab"
              title="Add a tab"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const id = addTab(view, tabsId);
                if (id) setRenaming(id);
              }}
            >
              <Plus size={15} aria-hidden />
            </button>
            {openTabInfo ? (
              <MenuButton
                label={`${openTabInfo.name} tab options`}
                trigger={<MoreHorizontal size={15} aria-hidden />}
                triggerClassName="fb-tabs-tool"
                items={itemsFor(openTabInfo.id)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {!strip.tabs.length ? (
        editable ? (
          <button type="button" className="fb-tabs-empty" onMouseDown={(e) => e.preventDefault()} onClick={() => addTab(view, tabsId)}>
            Add a tab
          </button>
        ) : null
      ) : openTabInfo?.empty ? (
        editable ? (
          <button type="button" className="fb-tabs-empty" onMouseDown={(e) => e.preventDefault()} onClick={() => writeInTab(view, tabsId, openTabInfo.id)}>
            Empty tab. Click to write.
          </button>
        ) : (
          <p className="fb-tabs-empty">This tab is empty.</p>
        )
      ) : null}
      {menu ? <ContextMenu at={{ x: menu.x, y: menu.y }} label="Tab" items={itemsFor(menu.tabId)} onClose={() => setMenu(null)} /> : null}
    </NodeViewWrapper>
  );
}

/** The tab's name being edited in place: Enter or leaving keeps it, Escape keeps the old one. */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      ref={ref}
      className="fb-tab-rename"
      aria-label="Tab name"
      value={value}
      maxLength={60}
      size={Math.max(4, value.length + 1)}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          finish(value.trim() ? value : null);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(value.trim() ? value : null)}
    />
  );
}
