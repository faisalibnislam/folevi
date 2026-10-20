/**
 * What a double-click on a canvas landed on. The canvases capture the pointer on press (to drag), so a
 * double-click (a trackpad tap that moved a pixel, say) can arrive at the canvas itself rather than the shape,
 * idea or part under it: look at what is under the pointer instead, as long as it is inside this canvas.
 */
export function targetUnder(e: { clientX: number; clientY: number; target: EventTarget; currentTarget: EventTarget }): Element {
  const under = document.elementFromPoint(e.clientX, e.clientY);
  return under && (e.currentTarget as Node).contains(under) ? under : (e.target as Element);
}
