// The picture a dragged card or row carries under the pointer.
//
// Handing the card on the page straight to setDragImage made the browser photograph its rectangle: its shadow was
// cut off at the edges and the hover or selection wash behind it came along as a square (the owner, 28 November
// 2026). The picture is a copy now, in a transparent holder with room for the shadow, without the hover-only
// buttons and selection marks, placed off screen for the moment the browser takes it and removed straight after.

/** Room round the card for its shadow. */
const PAD = 32;

/**
 * Sets the drag's picture to a copy of `el` as it looks at rest, with `badgeText` (a count such as "3 notes") in its
 * top-left corner, held where the pointer took it.
 */
export function setCardDragImage(e: { dataTransfer: DataTransfer | null; clientX: number; clientY: number }, el: HTMLElement, badgeText: string | null = null) {
  if (!e.dataTransfer) return;
  const box = el.getBoundingClientRect();
  const holder = document.createElement("div");
  Object.assign(holder.style, { position: "fixed", left: "-10000px", top: "0", padding: `${PAD}px`, background: "transparent", pointerEvents: "none" });
  // The card's own size, and the container its cqw sizes are measured against (a note card's is its list item).
  const frame = document.createElement("div");
  Object.assign(frame.style, { position: "relative", width: `${box.width}px`, height: `${box.height}px`, containerType: "inline-size" });
  const copy = el.cloneNode(true) as HTMLElement;
  // At rest: no hover-only buttons, selection marks or drop hints in the picture.
  copy.querySelectorAll('[data-card-menu], [data-selected-mark], [class*="group-hover:opacity-100"]').forEach((n) => n.remove());
  copy.style.transform = "none";
  frame.appendChild(copy);
  if (badgeText) frame.appendChild(countBadge(badgeText));
  holder.appendChild(frame);
  document.body.appendChild(holder);
  const x = Math.min(Math.max(e.clientX - box.left, 0), box.width) + PAD;
  const y = Math.min(Math.max(e.clientY - box.top, 0), box.height) + PAD;
  e.dataTransfer.setDragImage(holder, x, y);
  setTimeout(() => holder.remove(), 0);
}

/** The count painted in the picture's corner when several things go along. */
function countBadge(text: string): HTMLElement {
  const badge = document.createElement("span");
  badge.textContent = text;
  const root = document.documentElement;
  const dark = root.dataset.theme === "dark" || (root.dataset.theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  Object.assign(badge.style, {
    position: "absolute",
    top: "8px",
    left: "8px",
    zIndex: "30",
    padding: "3px 9px",
    borderRadius: "var(--radius-chip)",
    font: "600 12px system-ui, sans-serif",
    background: dark ? "#f4f4f5" : "#18181b",
    color: dark ? "#18181b" : "#ffffff",
    boxShadow: "0 2px 8px rgb(0 0 0 / 0.2)",
  });
  return badge;
}
