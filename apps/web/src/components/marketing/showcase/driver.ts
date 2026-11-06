// What the showcase's chapters are made of: a pointer that moves and clicks like a person's, text typed letter by
// letter into the app's own editor, and waiting for the app to show something. It runs inside the frame, on the
// app's real elements. The frame never takes the page's focus (the visitor's keyboard stays where it was): the
// editor is typed into through its own commands rather than the keyboard, and told it has focus so its menus
// open as they would for a person.
import type { Editor } from "@tiptap/core";
import { revealInFrame } from "./contain";

export class Stopped extends Error {
  constructor() {
    super("The chapter was stopped.");
    this.name = "Stopped";
  }
}

export interface Ctx {
  signal: AbortSignal;
  /** How fast this run goes (1 is a person's pace; reduced motion never plays). */
  speed: number;
}

export function check(ctx: Ctx): void {
  if (ctx.signal.aborted) throw new Stopped();
}

export function sleep(ctx: Ctx, ms: number): Promise<void> {
  check(ctx);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ctx.signal.removeEventListener("abort", stop);
      resolve();
    }, ms / ctx.speed);
    const stop = () => {
      clearTimeout(t);
      reject(new Stopped());
    };
    ctx.signal.addEventListener("abort", stop, { once: true });
  });
}

/** Waits for `find` to return something (checked every frame), up to `timeout` ms. */
export async function waitFor<T>(ctx: Ctx, find: () => T | null | undefined | false, timeout = 5000): Promise<T> {
  const until = performance.now() + timeout;
  for (;;) {
    check(ctx);
    const found = find();
    if (found) return found;
    if (performance.now() > until) throw new Error("The showcase waited for something that didn't appear.");
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** The first visible element matching `selector` whose text (or label) matches `text`. */
export function byText(selector: string, text: string | RegExp, root: ParentNode = document): HTMLElement | null {
  const want = (s: string) => (typeof text === "string" ? s.trim() === text : text.test(s.trim()));
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    if (!visible(el)) continue;
    if (want(el.getAttribute("aria-label") ?? "") || want(el.innerText ?? "")) return el;
  }
  return null;
}

// ---- the pointer ------------------------------------------------------------------------------------------

const ARROW = `<svg width="22" height="26" viewBox="0 0 22 26" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.2 1.6 19 14.3l-7.4 1.1 4.3 8.1-3.2 1.6-4.2-8.2L3 22.1Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

/** A mouse pointer on the Mac, a fingertip on the iPhone: drawn over the app, never in its way. */
export class Pointer {
  private el: HTMLDivElement;
  private x: number;
  private y: number;
  constructor(private touch: boolean) {
    this.el = document.createElement("div");
    this.el.setAttribute("aria-hidden", "true");
    this.el.dataset.showcasePointer = "";
    Object.assign(this.el.style, {
      position: "fixed",
      left: "0",
      top: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 250ms ease",
      willChange: "transform",
    });
    if (touch) {
      Object.assign(this.el.style, { width: "38px", height: "38px", marginLeft: "-19px", marginTop: "-19px", background: "radial-gradient(circle, rgb(120 120 128 / 0.35) 0 18px, rgb(255 255 255 / 0.6) 18px 19px, transparent 19.5px)" });
    } else this.el.innerHTML = ARROW;
    document.body.appendChild(this.el);
    this.x = innerWidth * 0.62;
    this.y = innerHeight * 0.7;
    this.place();
  }
  private place(scale = 1) {
    this.el.style.transform = `translate(${this.x}px, ${this.y}px) scale(${scale})`;
  }
  show(on = true) {
    this.el.style.opacity = on ? "1" : "0";
  }
  /** Glides to (x, y), quicker over short distances, as a hand does. */
  async moveTo(ctx: Ctx, x: number, y: number): Promise<void> {
    check(ctx);
    this.show();
    const d = Math.hypot(x - this.x, y - this.y);
    const ms = Math.min(700, 220 + d * 0.9) / ctx.speed;
    const from = `translate(${this.x}px, ${this.y}px)`;
    this.x = x;
    this.y = y;
    const anim = this.el.animate([{ transform: from }, { transform: `translate(${x}px, ${y}px)` }], { duration: ms, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)", fill: "forwards" });
    const stop = () => anim.cancel();
    ctx.signal.addEventListener("abort", stop, { once: true });
    await anim.finished.catch(() => undefined);
    ctx.signal.removeEventListener("abort", stop);
    this.place();
    anim.cancel();
    check(ctx);
  }
  async press(ctx: Ctx): Promise<void> {
    this.place(this.touch ? 0.8 : 0.86);
    await sleep(ctx, 110);
    this.place();
  }
  remove() {
    this.el.remove();
  }
}

/** Where on an element a click lands: its middle, or `at` (fractions of its box). */
function pointOf(el: Element, at?: [number, number]): [number, number] {
  const r = el.getBoundingClientRect();
  const [fx, fy] = at ?? [0.5, 0.5];
  return [r.left + r.width * fx, r.top + r.height * fy];
}

/** The events a click makes, on whatever is under (x, y) inside `el` (the real target, as for a person). */
export function fireClick(el: Element, x: number, y: number): void {
  const hit = document.elementFromPoint(x, y);
  const target = hit && el.contains(hit) ? hit : el;
  const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 1, view: window, detail: 1 };
  const p = { ...o, pointerId: 1, pointerType: "mouse", isPrimary: true };
  target.dispatchEvent(new PointerEvent("pointerover", p));
  target.dispatchEvent(new PointerEvent("pointerenter", { ...p, bubbles: false }));
  target.dispatchEvent(new MouseEvent("mouseover", o));
  target.dispatchEvent(new PointerEvent("pointerdown", p));
  target.dispatchEvent(new MouseEvent("mousedown", o));
  target.dispatchEvent(new PointerEvent("pointerup", { ...p, buttons: 0 }));
  target.dispatchEvent(new MouseEvent("mouseup", { ...o, buttons: 0 }));
  target.dispatchEvent(new MouseEvent("click", { ...o, buttons: 0 }));
}

/** Moves to the element and clicks it. */
export async function click(ctx: Ctx, pointer: Pointer, el: Element, at?: [number, number]): Promise<void> {
  revealInFrame(el);
  const [x, y] = pointOf(el, at);
  await pointer.moveTo(ctx, x, y);
  await pointer.press(ctx);
  fireClick(el, x, y);
  await sleep(ctx, 120);
}

/** Moves to the element without clicking (a hover). */
export async function hover(ctx: Ctx, pointer: Pointer, el: Element, at?: [number, number]): Promise<void> {
  const [x, y] = pointOf(el, at);
  await pointer.moveTo(ctx, x, y);
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, clientX: x, clientY: y, pointerType: "mouse" }));
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }));
}

// ---- typing -----------------------------------------------------------------------------------------------

/** The note's editor (Tiptap keeps itself on its element). */
export function noteEditor(): Editor | null {
  const el = document.querySelector<HTMLElement & { editor?: Editor }>(".ProseMirror.fb-editor");
  return el?.editor ?? null;
}

/** Tells the editor it has focus, as a click into it would (its "/" and "@" menus only open then). */
export function pretendFocus(editor: Editor): void {
  editor.emit("focus", { editor, event: new FocusEvent("focus"), transaction: editor.state.tr });
}

const pause = (ch: string) => (ch === " " ? 70 : /[.,!?]/.test(ch) ? 160 : 38 + Math.random() * 40);

/** Types into the editor at its selection, a letter at a time. */
export async function typeInEditor(ctx: Ctx, editor: Editor, text: string): Promise<void> {
  for (const ch of text) {
    check(ctx);
    editor.view.dispatch(editor.state.tr.insertText(ch));
    await sleep(ctx, pause(ch));
  }
}

/** A key in the editor (Enter, Tab, Escape…), through its own key handling. */
export function editorKey(editor: Editor, key: string): void {
  editor.commands.keyboardShortcut(key);
}

/** Types into a text field or text area the way input does (React hears each letter). */
export async function typeInField(ctx: Ctx, field: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  for (const ch of text) {
    check(ctx);
    set.call(field, field.value + ch);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
    await sleep(ctx, pause(ch));
  }
}

/** A key on an element (a field, a dialog), as keydown and keyup. */
export function pressKey(el: Element, key: string, opts: KeyboardEventInit = {}): void {
  const init = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true, ...opts };
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
}

// ---- a blinking caret where the editor's selection is (the frame never has focus, so the browser draws none) ----

export class Caret {
  private el: HTMLDivElement;
  private raf = 0;
  constructor() {
    this.el = document.createElement("div");
    this.el.setAttribute("aria-hidden", "true");
    Object.assign(this.el.style, { position: "fixed", left: "0", top: "0", width: "2px", background: "currentColor", zIndex: "2147483646", pointerEvents: "none", display: "none", animation: "showcase-caret 1s steps(1) infinite" });
    const style = document.createElement("style");
    style.textContent = "@keyframes showcase-caret { 0%, 55% { opacity: 1 } 56%, 100% { opacity: 0 } }";
    document.head.appendChild(style);
    document.body.appendChild(this.el);
  }
  follow(editor: Editor | null): void {
    cancelAnimationFrame(this.raf);
    if (!editor) {
      this.el.style.display = "none";
      return;
    }
    const tick = () => {
      try {
        const { head } = editor.state.selection;
        const c = editor.view.coordsAtPos(head);
        const color = getComputedStyle(editor.view.dom).color;
        Object.assign(this.el.style, { display: "block", transform: `translate(${c.left}px, ${c.top}px)`, height: `${Math.max(14, c.bottom - c.top)}px`, color });
      } catch {
        this.el.style.display = "none";
      }
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }
}
