// A scripted walk through Folevi for scripts/smoke.mjs (development builds only, FOLEVI_PROBE_SCRIPT): first launch
// -> Keep notes on my devices -> This device only -> Open Folevi -> the library's info -> Settings > Desktop app,
// reporting what it finds at each step through `report` (the terminal). Runs in every main page (a place switch
// makes a new page), so each part checks where it is first.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => (document.body ? document.body.innerText : "");
const click = (label) => {
  const el = [...document.querySelectorAll("button, a, [role=button]")].find((b) => (b.innerText || b.getAttribute("aria-label") || "").trim().startsWith(label));
  if (el) el.click();
  return !!el;
};
(async () => {
  if (location.pathname === "/settings/desktop") {
    for (let i = 0; i < 40 && !/On this PC|On this computer|On this Mac/.test(text()); i++) await wait(500);
    return report({ step: "settings", hasPC: /On this PC/.test(text()), shortcut: /Ctrl\+Alt\+Space/.test(text()), tray: /Notification area icon/.test(text()) });
  }
  for (let i = 0; i < 60 && !/Where should your notes live|This device only|Your library is ready/.test(text()) && !document.querySelector(".ui-tabbar"); i++) await wait(500);
  if (/Where should your notes live/.test(text())) report({ step: "first-launch", ok: click("Keep notes on my devices") });
  for (let i = 0; i < 20 && !/This device only/.test(text()) && !/Your library is ready/.test(text()) && !document.querySelector(".ui-tabbar"); i++) await wait(500);
  if (/This device only/.test(text()) && !document.querySelector(".ui-tabbar")) {
    report({ step: "library-setup", ok: click("This device only") });
    for (let i = 0; i < 30 && !/Your library is ready/.test(text()) && !document.querySelector(".ui-tabbar"); i++) await wait(500);
    if (!/Your library is ready/.test(text()) && !document.querySelector(".ui-tabbar")) report({ step: "after-setup", text: text().replace(/\s+/g, " ").slice(0, 300) });
  }
  if (/Your library is ready/.test(text())) {
    report({ step: "library-ready", where: (text().match(/files in ([^.]+)\./) || [])[1] || "", ok: click("Open Folevi") });
    for (let i = 0; i < 40 && !document.querySelector(".ui-tabbar"); i++) await wait(500);
  }
  if (!document.querySelector(".ui-tabbar")) return report({ step: "no-app", text: text().slice(0, 200) });
  await wait(1500);
  report({ step: "app", tabbarRight: getComputedStyle(document.querySelector(".ui-tabbar")).right, recent: /Recent notes/.test(text()) });
  const info = await window.foleviShell.library.info();
  report({ step: "library-info", configured: info.configured, kind: info.kind, displayPath: info.displayPath });
  let notes = [];
  for (let i = 0; i < 40 && !notes.length; i++) {
    notes = await window.foleviShell.library.list("notes");
    if (!notes.length) await wait(500);
  }
  report({ step: "library-list", notes: notes.length });
  location.assign("/settings/desktop");
})().catch((e) => report({ step: "error", error: String(e && (e.message || e.code || e)) }));
