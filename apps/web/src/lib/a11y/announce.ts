/**
 * One polite live region for the whole app, made on first use, so short confirmations of what a key did
 * ("Moved up", "Done") reach screen readers without each feature mounting its own.
 */
let region: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function liveRegion(): HTMLElement {
  if (region?.isConnected) return region;
  region = document.createElement("div");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  region.className = "sr-only";
  document.body.append(region);
  return region;
}

/** Reads `message` out politely. A newer message replaces one not yet read. */
export function announce(message: string) {
  if (typeof document === "undefined") return;
  const el = liveRegion();
  clearTimeout(timer);
  // Emptied first, so the same message twice in a row ("Moved up", "Moved up") is read both times.
  el.textContent = "";
  timer = setTimeout(() => {
    el.textContent = message;
  }, 50);
}
