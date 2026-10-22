// Driving what's on an emulator's screen the way a person would, through UI Automator's view of it: find a
// control by its text (or the label above a field), tap it, type. Used for what the app's own web view can't
// reach from a script: Chrome's Custom Tab during sign-in, the share sheet, Quick Settings, widgets.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const adbPath = join(process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk"), "platform-tools/adb");
export const adb = (serial, ...a) => execFileSync(adbPath, ["-s", serial, ...a], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every node on screen: its text, content description, resource id, class and centre. */
export function dump(serial) {
  adb(serial, "shell", "uiautomator", "dump", "/sdcard/folevi-ui.xml");
  const xml = adb(serial, "shell", "cat", "/sdcard/folevi-ui.xml");
  const nodes = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const attr = (k) => new RegExp(`${k}="([^"]*)"`).exec(m[1])?.[1] ?? "";
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr("bounds"));
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    nodes.push({
      text: decode(attr("text")),
      desc: decode(attr("content-desc")),
      id: attr("resource-id"),
      cls: attr("class"),
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      top: y1,
      bottom: y2,
    });
  }
  return nodes;
}

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const matches = (n, text) => (text instanceof RegExp ? text.test(n.text) || text.test(n.desc) : n.text === text || n.desc === text);

/** Waits for a node with this text (or content description) and returns it. */
export async function find(serial, text, timeout = 20_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const hit = dump(serial).find((n) => matches(n, text));
    if (hit) return hit;
    await sleep(700);
  }
  throw new Error(`nothing on screen says ${text}`);
}

export async function has(serial, text) {
  return dump(serial).some((n) => matches(n, text));
}

export async function tapText(serial, text, timeout) {
  const n = await find(serial, text, timeout);
  adb(serial, "shell", "input", "tap", String(n.x), String(n.y));
  return n;
}

export function tap(serial, x, y) {
  adb(serial, "shell", "input", "tap", String(x), String(y));
}

/** Types into whatever has focus (spaces and shell characters escaped for `input text`). */
export function type(serial, text) {
  const escaped = text.replace(/([\\'"`$&|;<>()*?#~!{}[\]])/g, "\\$1").replace(/ /g, "%s");
  adb(serial, "shell", "input", "text", escaped);
}

/** The text field under a label ("Email"): tapped, then typed into. */
export async function fill(serial, label, value) {
  const l = await find(serial, label);
  const field = dump(serial)
    .filter((n) => n.cls === "android.widget.EditText" && n.top >= l.top)
    .sort((a, b) => a.top - b.top)[0];
  if (!field) throw new Error(`no field under ${label}`);
  tap(serial, field.x, field.y);
  await sleep(400);
  type(serial, value);
  await sleep(300);
}

export function key(serial, name) {
  adb(serial, "shell", "input", "keyevent", name);
}
