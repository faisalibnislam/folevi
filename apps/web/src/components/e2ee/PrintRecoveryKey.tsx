"use client";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The printable recovery key page (§4.7.1): the key, the account's email and the date, no app chrome. */
export function recoveryKeyPage({ text, email, date }: { text: string; email: string; date: string }): string {
  const groups = text.split("-");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Folevi recovery key</title>
<style>
  @page { margin: 24mm; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p { margin: 0 0 12px; color: #333; }
  .key { display: grid; grid-template-columns: repeat(3, auto); gap: 10px 18px; justify-content: start; margin: 24px 0; font: 600 22px/1.2 ui-monospace, "JetBrains Mono", Menlo, monospace; letter-spacing: 0.08em; }
  .meta { margin-top: 28px; font-size: 12px; color: #555; }
</style></head><body>
<h1>Folevi recovery key</h1>
<p>Keep this somewhere safe, away from your devices. Anyone with it can unlock your encrypted notes.</p>
<div class="key">${groups.map((g) => `<span>${escape(g)}</span>`).join("")}</div>
<p>To use it, choose Enter recovery key when Folevi asks you to unlock.</p>
<p class="meta">Account: ${escape(email)}<br>Made on ${escape(date)}</p>
</body></html>`;
}

/** Prints the recovery key page from a hidden frame, so nothing of the app is printed with it. */
export function printRecoveryKey(input: { text: string; email: string; date: string }) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
  frame.srcdoc = recoveryKeyPage(input);
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    // Removed after the print dialog closes (afterprint), or after a minute at most.
    const done = () => frame.remove();
    frame.contentWindow?.addEventListener("afterprint", done);
    setTimeout(done, 60_000);
  };
  document.body.appendChild(frame);
}
