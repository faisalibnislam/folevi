// Settings > Import & export: the email-to-note card (convex/emailNotes.ts). Before an address exists it
// offers to make one; after, it shows the address, where notes go, who can send, and asks before ending it.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EmailToNoteView, type EmailNoteStatus } from "@/components/views/settings/EmailToNote";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const button = (host: HTMLElement, name: string) => [...host.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name);

const handlers = () => ({
  onCreate: vi.fn(async () => null),
  onRotate: vi.fn(async () => null),
  onRemove: vi.fn(async () => null),
  onSetPlace: vi.fn(async () => null),
  onAddSender: vi.fn(async () => null),
  onRemoveSender: vi.fn(async () => null),
  onCopy: vi.fn(),
});

const status = (o: Partial<EmailNoteStatus> = {}): EmailNoteStatus => ({
  address: "n-abcdefghijkmnpqrstuvwxyz@folevi.com",
  place: { kind: "personal" },
  ownAddress: "ada@example.com",
  extraSenders: ["ada.work@example.org"],
  count: 0,
  lastReceivedAt: null,
  rejectedCount: 0,
  lastRejectedAt: null,
  ...o,
});

describe("the email to Folevi card", () => {
  test("without an address it offers to make one", async () => {
    const h = handlers();
    const { host } = render(<EmailToNoteView status={null} places={[]} {...h} />);
    expect(host.textContent).toContain("Send or forward email to this address and it becomes a note in your Inbox.");
    await act(async () => button(host, "Create my address")!.click());
    expect(h.onCreate).toHaveBeenCalledTimes(1);
  });

  test("shows the address with Copy, the senders, and adds and removes one", async () => {
    const h = handlers();
    const { host } = render(<EmailToNoteView status={status()} places={[{ id: "W1", name: "Studio" }]} {...h} />);
    expect(host.querySelector<HTMLInputElement>("input[readonly]")!.value).toBe("n-abcdefghijkmnpqrstuvwxyz@folevi.com");
    act(() => button(host, "Copy")!.click());
    expect(h.onCopy).toHaveBeenCalledWith("n-abcdefghijkmnpqrstuvwxyz@folevi.com");
    expect(host.textContent).toContain("No email has arrived yet.");
    const list = host.querySelector('[aria-label="Who can send"]')!;
    expect(list.textContent).toContain("ada@example.com");
    // The account's own address has no Remove button; the other one does.
    expect(button(host, "Remove ada@example.com")).toBeUndefined();
    await act(async () => button(host, "Remove ada.work@example.org")!.click());
    expect(h.onRemoveSender).toHaveBeenCalledWith("ada.work@example.org");
    typeInto(host.querySelector<HTMLInputElement>('input[type="email"]')!, "ada.home@example.net");
    await act(async () => host.querySelector("form")!.requestSubmit());
    expect(h.onAddSender).toHaveBeenCalledWith("ada.home@example.net");
    // No native select anywhere.
    expect(host.querySelector("select")).toBeNull();
  });

  test("a new address and turning off both ask first", async () => {
    const h = handlers();
    const { host } = render(<EmailToNoteView status={status({ count: 3, lastReceivedAt: Date.now() - 60_000, rejectedCount: 2 })} places={[]} {...h} />);
    expect(host.textContent).toMatch(/3 notes so far/);
    expect(host.textContent).toContain("2 emails from other senders ignored.");
    act(() => button(host, "Get a new address…")!.click());
    expect(host.textContent).toContain("Your current address stops working at once.");
    act(() => button(host, "Keep")!.click());
    expect(h.onRotate).not.toHaveBeenCalled();
    act(() => button(host, "Get a new address…")!.click());
    await act(async () => button(host, "Get a new address")!.click());
    expect(h.onRotate).toHaveBeenCalledTimes(1);
    act(() => button(host, "Turn off…")!.click());
    await act(async () => button(host, "Turn off")!.click());
    expect(h.onRemove).toHaveBeenCalledTimes(1);
  });

  test("with five other senders there's no field to add another", () => {
    const { host } = render(<EmailToNoteView status={status({ extraSenders: ["a@x.org", "b@x.org", "c@x.org", "d@x.org", "e@x.org"] })} places={[]} {...handlers()} />);
    expect(host.querySelector('input[type="email"]')).toBeNull();
    expect(host.textContent).toContain("You can add up to 5 other addresses.");
  });
});
