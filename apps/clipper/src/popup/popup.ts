// The toolbar popup. Signed out, it offers to sign in (the service worker runs the sign-in window, so it
// finishes even when the popup closes). Signed in, it reads the page (Readability, through the injected
// extractor), shows the title to edit, a place picker when the connection may use more than one place,
// and Clip article / Clip selection. Saving happens in the service worker; the popup shows the result with
// a link to the new note. Everything is built with DOM calls, never from HTML strings.
import { CantReadPage, extractFromTab } from "../lib/extract";
import type { Place } from "../lib/mcp";
import type { Extracted, LastClip, PlacesResponse, Request, Response, SaveResponse, StateResponse } from "../lib/messages";
import type { Clip, ClipKind } from "../lib/note";

const app = document.getElementById("app")!;

type Child = Node | string | null | false | undefined;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string | boolean | ((e: Event) => void)>> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "function") el.addEventListener(key.replace(/^on/, "").toLowerCase(), value as EventListener);
    else if (value === true) el.setAttribute(key, "");
    else if (typeof value === "string") el.setAttribute(key, value);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

function check(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "check");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3.5 8.5l3 3 6-7");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function show(...children: Child[]) {
  app.replaceChildren(...children.filter((c): c is Node | string => !!c));
}

async function send<T>(request: Request): Promise<Response<T>> {
  try {
    return (await chrome.runtime.sendMessage(request)) as Response<T>;
  } catch {
    return { ok: false, error: "The clipper stopped unexpectedly. Close this and try again." };
  }
}

// ---------------------------------------------------------------- signed out

function signedOutView(error?: string) {
  const button = h("button", { class: "btn primary", type: "button" }, "Sign in to Folevi");
  const status = h("p", { class: `status small ${error ? "error" : "muted"}`, role: "status" }, error ?? "");
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.className = "status small muted";
    status.textContent = "Finish signing in in the window that opened.";
    const res = await send<null>({ type: "signIn" });
    if (res.ok) void start();
    else {
      button.disabled = false;
      status.className = "status small error";
      status.textContent = res.error;
    }
  });
  show(
    h("h1", {}, "Save pages to Folevi"),
    h("p", { class: "muted" }, "Clip the article you’re reading, or the part you selected, as a clean note in your Folevi Inbox."),
    h("div", { class: "actions" }, button),
    status,
    h("p", { class: "small muted" }, "Folevi asks you to allow the clipper. It can only add new notes; it can’t read what you’ve written."),
  );
}

// ---------------------------------------------------------------- signed in

interface View {
  tabId: number;
  page: Extracted | null;
  pageError: string | null;
  places: Place[];
  place: string | null;
}

function placePicker(view: View): HTMLElement | null {
  if (view.places.length < 2) return null;
  const group = h("div", { class: "places", role: "radiogroup", "aria-labelledby": "place-label" });
  const select = (id: string) => {
    view.place = id;
    for (const b of group.querySelectorAll<HTMLButtonElement>(".place")) {
      const on = b.dataset.id === id;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  for (const p of view.places) {
    const b = h("button", { class: "place", type: "button", role: "radio", "aria-checked": String(p.id === view.place), "data-id": p.id }, h("span", {}, p.name), check());
    b.tabIndex = p.id === view.place ? 0 : -1;
    b.addEventListener("click", () => select(p.id));
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const i = view.places.findIndex((x) => x.id === view.place);
      const next = view.places[(i + (e.key === "ArrowDown" ? 1 : view.places.length - 1)) % view.places.length]!;
      select(next.id);
      group.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(next.id)}"]`)?.focus();
    });
    group.append(b);
  }
  return h("div", { class: "field" }, h("span", { class: "label", id: "place-label" }, "Save to"), group);
}

function footer(): HTMLElement {
  const out = h("button", { class: "link small", type: "button" }, "Sign out");
  out.addEventListener("click", async () => {
    await send<null>({ type: "signOut" });
    signedOutView();
  });
  return h("div", { class: "foot" }, h("p", { class: "small muted" }, "To remove the clipper’s access, open Settings > Connected apps in Folevi."), out);
}

function doneView(view: View, saved: { title: string; url: string; place: string }) {
  const inPlace = saved.place && saved.place !== "Personal" ? ` in ${saved.place}` : "";
  const open = h("a", { href: saved.url, target: "_blank", rel: "noopener" }, "Open in Folevi");
  show(
    h("div", { class: "done" }, h("h1", {}, `Saved to your Inbox${inPlace}`), h("p", { class: "muted" }, saved.title), open),
    h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => mainView(view) }, "Clip again")),
    footer(),
  );
}

function mainView(view: View, error?: string) {
  const page = view.page;
  const title = h("input", { type: "text", id: "title", maxlength: "200", spellcheck: "true" }) as HTMLInputElement;
  title.value = page?.title ?? "";
  const status = h("p", { class: `status small ${error || view.pageError ? "error" : "muted"}`, role: "status" }, error ?? view.pageError ?? "");
  const article = h("button", { class: "btn primary", type: "button" }, "Clip article");
  const selection = page?.hasSelection ? h("button", { class: "btn", type: "button" }, "Clip selection") : null;
  if (!page) article.disabled = true;

  const clip = async (kind: ClipKind) => {
    if (!page) return;
    for (const b of [article, selection]) if (b) b.disabled = true;
    status.className = "status small muted";
    status.textContent = "Saving to Folevi…";
    let source: Extracted = page;
    if (kind === "selection") {
      try {
        source = await extractFromTab(view.tabId, "selection");
      } catch (e) {
        source = { ...page, markdown: "" };
        status.textContent = e instanceof Error ? e.message : "Couldn't read the selection.";
      }
    }
    if (!source.markdown.trim() && kind !== "link") {
      status.className = "status small error";
      status.textContent = kind === "selection" ? "Select some text on the page first." : "There’s no text on this page to clip.";
      for (const b of [article, selection]) if (b) b.disabled = false;
      return;
    }
    const payload: Clip = { kind, title: title.value.trim() || page.title, pageTitle: page.title, pageUrl: source.url, markdown: source.markdown, byline: kind === "article" ? page.byline : null, siteName: kind === "article" ? page.siteName : null };
    const res = await send<SaveResponse>({ type: "save", clip: payload, ...(view.place ? { place: view.place } : {}) });
    if (res.ok) return doneView(view, res.value);
    if (res.signedOut) return signedOutView(res.error);
    status.className = "status small error";
    status.textContent = res.error;
    for (const b of [article, selection]) if (b) b.disabled = false;
  };
  article.addEventListener("click", () => void clip("article"));
  selection?.addEventListener("click", () => void clip("selection"));

  show(
    page ? h("div", { class: "field" }, h("label", { for: "title" }, "Title"), title) : null,
    page ? placePicker(view) : null,
    h("div", { class: "actions" }, article, selection),
    status,
    page && !page.readable ? h("p", { class: "small muted" }, "This page doesn’t look like an article, so its main text will be clipped.") : null,
    footer(),
  );
}

async function signedInView(state: StateResponse) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const view: View = { tabId: tab?.id ?? -1, page: null, pageError: null, places: [], place: state.lastPlace };
  show(h("p", { class: "muted" }, "Reading this page…"));
  const [page, places] = await Promise.all([
    tab?.id !== undefined ? extractFromTab(tab.id, "article").catch((e: unknown) => (e instanceof CantReadPage ? e : new CantReadPage())) : Promise.resolve(new CantReadPage()),
    send<PlacesResponse>({ type: "places" }),
  ]);
  if (!places.ok && places.signedOut) return signedOutView(places.error);
  if (page instanceof CantReadPage) view.pageError = page.message;
  else view.page = page;
  view.places = places.ok ? places.value : [];
  if (!view.places.some((p) => p.id === view.place)) view.place = view.places.find((p) => p.id === "personal")?.id ?? view.places[0]?.id ?? null;
  const last: LastClip | null = state.lastClip && Date.now() - state.lastClip.at < 60_000 ? state.lastClip : null;
  if (last?.ok && last.url) return doneView(view, { title: last.title, url: last.url, place: last.place ?? "" });
  mainView(view, last && !last.ok ? last.error : places.ok ? undefined : places.error);
}

async function start() {
  const state = await send<StateResponse>({ type: "state" });
  if (!state.ok) return show(h("p", { class: "error" }, state.error));
  if (!state.value.signedIn) return signedOutView();
  await signedInView(state.value);
}

void start();
