"use client";

import { Children, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

/** The change "event" Select passes to onChange: shaped like a native select's, so handlers read e.target.value. */
export interface SelectChange {
  target: { value: string };
  currentTarget: { value: string };
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** Reads <option> children (possibly nested in fragments or arrays) into a flat option list. */
function readOptions(children: ReactNode): Option[] {
  const out: Option[] = [];
  const walk = (nodes: ReactNode) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      const el = child as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;
      if (el.type === "option") {
        const label = textOf(el.props.children);
        out.push({ value: el.props.value === undefined ? label : String(el.props.value), label, disabled: el.props.disabled });
      } else if (el.props.children) walk(el.props.children);
    });
  };
  walk(children);
  return out;
}

/**
 * Folevi's own dropdown, used everywhere instead of the OS select. It takes <option> children and a
 * native-style onChange (e.target.value), follows the WAI-ARIA select-only combobox pattern (focus stays on
 * the button; ↑/↓, Home/End, type-ahead, Enter/Space to choose, Escape to close), and opens its list in the
 * top layer (Popover API) so it works inside dialogs and clipped panels.
 */
export function Select({
  value,
  defaultValue,
  onChange,
  children,
  className = "",
  disabled,
  id,
  name,
  title,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (e: SelectChange) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  title?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const options = useMemo(() => readOptions(children), [children]);
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = value ?? inner;
  const selected = options.find((o) => o.value === current) ?? options[0];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  // The list renders at the end of the enclosing modal dialog (so it isn't inert) or <body> — never
  // inside a <label>, whose clicks would re-open it.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    if (!b) return;
    const below = window.innerHeight - b.bottom - 8;
    const above = b.top - 8;
    const wanted = Math.min(320, options.length * 36 + 12);
    const up = below < Math.min(wanted, 200) && above > below;
    const width = Math.max(b.width, 180);
    const left = Math.min(Math.max(8, b.left), window.innerWidth - width - 8);
    setPos(
      up
        ? { left, bottom: window.innerHeight - b.top + 6, width, maxHeight: Math.min(320, above - 6) }
        : { left, top: b.bottom + 6, width, maxHeight: Math.min(320, below - 6) },
    );
  }, [options.length]);

  const show = () => {
    if (disabled) return;
    const i = options.findIndex((o) => o.value === current);
    setActive(i >= 0 ? i : (enabled[0] ?? 0));
    place();
    setHost(button.current?.closest("dialog") ?? document.body);
    setOpen(true);
  };
  const hide = () => setOpen(false);

  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    hide();
    if (o.value === current) return;
    if (value === undefined) setInner(o.value);
    onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } });
  };

  // Show the list in the top layer so no dialog or overflow can hide it.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    try {
      if (open && !el.matches(":popover-open")) el.showPopover();
      if (!open && el.matches(":popover-open")) el.hidePopover();
    } catch {
      /* Popover API missing: the list still renders, positioned fixed. */
    }
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !button.current?.contains(t)) hide();
    };
    const onMove = (e: Event) => {
      if (e.target instanceof Node && list.current?.contains(e.target)) return;
      place();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, place]);

  const step = (from: number, dir: 1 | -1) => {
    const at = enabled.indexOf(from);
    if (at === -1) return enabled[0] ?? 0;
    return enabled[Math.min(enabled.length - 1, Math.max(0, at + dir))]!;
  };

  const typeahead = (key: string) => {
    const now = Date.now();
    typed.current = { text: (now - typed.current.at > 700 ? "" : typed.current.text) + key.toLowerCase(), at: now };
    const q = typed.current.text;
    const start = open ? active : options.findIndex((o) => o.value === current);
    const order = [...enabled.filter((i) => i > start), ...enabled.filter((i) => i <= start)];
    const hit = (q.length > 1 ? enabled : order).find((i) => options[i]!.label.toLowerCase().startsWith(q));
    if (hit === undefined) return;
    if (open) setActive(hit);
    else choose(hit);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const k = e.key;
    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " " || (k === "ArrowDown" && e.altKey)) {
        e.preventDefault();
        show();
      } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) typeahead(k);
      return;
    }
    if (k === "ArrowDown") {
      e.preventDefault();
      setActive((a) => step(a, 1));
    } else if (k === "ArrowUp") {
      e.preventDefault();
      if (e.altKey) choose(active);
      else setActive((a) => step(a, -1));
    } else if (k === "Home" || k === "PageUp") {
      e.preventDefault();
      setActive(enabled[0] ?? 0);
    } else if (k === "End" || k === "PageDown") {
      e.preventDefault();
      setActive(enabled[enabled.length - 1] ?? 0);
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      choose(active);
    } else if (k === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hide();
    } else if (k === "Tab") {
      choose(active);
    } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) typeahead(k);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        title={title}
        disabled={disabled}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (e.key === " ") e.preventDefault();
        }}
        className={`inline-flex min-w-0 items-center justify-between gap-1.5 text-left disabled:cursor-default disabled:opacity-50 ${className}`}
      >
        <span className="min-w-0 truncate">{selected?.label ?? ""}</span>
        <ChevronDown size={14} aria-hidden className={`flex-none opacity-60 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      {open && host ? createPortal(
      <ul
        ref={list}
        id={listId}
        role="listbox"
        popover="manual"
        tabIndex={-1}
        style={pos ? { position: "fixed", left: pos.left, top: pos.top ?? "auto", bottom: pos.bottom ?? "auto", minWidth: pos.width, maxHeight: pos.maxHeight, right: "auto", margin: 0 } : undefined}
        className="ui-pop z-[100] max-w-[min(420px,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-[10px] border-0 p-1.5 text-[13.5px] text-ink animate-[folio-rise_120ms_var(--ease-folio)] motion-reduce:animate-none"
        onMouseDown={(e) => e.preventDefault()}
      >
        {options.map((o, i) => {
          const isSelected = o.value === current;
          return (
            <li
              key={`${o.value}-${i}`}
              id={optionId(i)}
              role="option"
              aria-selected={isSelected}
              aria-disabled={o.disabled || undefined}
              onPointerMove={() => !o.disabled && active !== i && setActive(i)}
              onClick={() => choose(i)}
              className={`flex cursor-default items-center gap-2 rounded-[6px] px-2.5 py-[7px] ${i === active ? "bg-[var(--glass-hover)] text-heading" : ""} ${isSelected ? "font-semibold text-heading" : ""} ${o.disabled ? "opacity-40" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate">{o.label || " "}</span>
              {isSelected ? <Check size={14} strokeWidth={2.5} aria-hidden className="flex-none" /> : <span className="w-3.5 flex-none" aria-hidden />}
            </li>
          );
        })}
      </ul>,
      host,
      ) : null}
    </>
  );
}
