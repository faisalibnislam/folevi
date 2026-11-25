import { afterEach, expect, test } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useExitingList } from "@/components/iphone/exit";

// Rows leaving a phone list: kept in place (marked leaving) after the person acted on them, until finished.
let root: Root;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

let api: { expect: (id: string) => void; finish: (key: string) => void };
function List({ items, reset = "a" }: { items: string[]; reset?: string }) {
  const { entries, expect, finish } = useExitingList(items, (t) => t, (t) => t, reset);
  api = { expect, finish };
  return <ul>{entries.map((e) => <li key={e.key} data-leaving={e.leaving ? "" : undefined}>{e.item}</li>)}</ul>;
}

async function setup(items: string[]) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<List items={items} />));
  const shown = () => [...host.querySelectorAll("li")].map((li) => li.textContent + (li.hasAttribute("data-leaving") ? "*" : ""));
  return { host, shown };
}

test("a row the person acted on stays where it was, leaving, until its fold finishes", async () => {
  const { shown } = await setup(["a", "b", "c"]);
  await act(async () => api.expect("b"));
  await act(async () => root.render(<List items={["a", "c"]} />));
  expect(shown()).toEqual(["a", "b*", "c"]);
  await act(async () => api.finish("b"));
  expect(shown()).toEqual(["a", "c"]);
});

test("rows that go for other reasons (a filter, another device) go at once", async () => {
  const { shown } = await setup(["a", "b", "c"]);
  await act(async () => root.render(<List items={["a"]} />));
  expect(shown()).toEqual(["a"]);
});

test("a row brought back (Undo) before its fold finishes is an ordinary row again", async () => {
  const { shown } = await setup(["a", "b"]);
  await act(async () => api.expect("a"));
  await act(async () => root.render(<List items={["b"]} />));
  expect(shown()).toEqual(["a*", "b"]);
  await act(async () => root.render(<List items={["a", "b"]} />));
  expect(shown()).toEqual(["a", "b"]);
});

test("another view starts over: nothing lingers", async () => {
  const { shown } = await setup(["a", "b"]);
  await act(async () => api.expect("a"));
  await act(async () => root.render(<List items={["b"]} reset="other" />));
  expect(shown()).toEqual(["b"]);
});
