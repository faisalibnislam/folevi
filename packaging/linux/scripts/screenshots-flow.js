// The software-center screenshots' walk (development builds only, FOLEVI_PROBE_SCRIPT; run by screenshots.sh): sets up
// a library on this device with the starter notes, then reports a "shot" step on Home, on a note and on Tasks > Today;
// screenshots.sh captures the window at each.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => (document.body ? document.body.innerText : "");
const click = (label) => {
  const el = [...document.querySelectorAll("button, a, [role=button]")].find((b) => (b.innerText || b.getAttribute("aria-label") || "").trim().startsWith(label));
  if (el) el.click();
  return !!el;
};
const shot = async (name) => { report({ step: "shot", name, path: location.pathname, text: text().replace(/\s+/g, " ").slice(0, 200) }); await wait(2500); };
(async () => {
  const stage = sessionStorage.getItem("shots") || "setup";
  if (stage === "setup") {
    for (let i = 0; i < 60 && !/Where should your notes live|This device only|Your library is ready/.test(text()) && !document.querySelector(".ui-tabbar"); i++) await wait(500);
    if (/Where should your notes live/.test(text())) click("Keep notes on my devices");
    for (let i = 0; i < 20 && !/This device only/.test(text()) && !/Your library is ready/.test(text()) && !document.querySelector(".ui-tabbar"); i++) await wait(500);
    if (/This device only/.test(text()) && !document.querySelector(".ui-tabbar")) { click("This device only"); for (let i = 0; i < 30 && !/Your library is ready/.test(text()) && !document.querySelector(".ui-tabbar"); i++) await wait(500); }
    if (/Your library is ready/.test(text())) { click("Open Folevi"); for (let i = 0; i < 40 && !document.querySelector(".ui-tabbar"); i++) await wait(500); }
    await wait(3000);
    await shot("home");
    const links = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/"));
    report({ step: "links", links: [...new Set(links)].slice(0, 40) });
    const trip = [...document.querySelectorAll("a[href^='/d/']")].find((a) => /Trip Sketch/.test(a.innerText));
    sessionStorage.setItem("shots", "note");
    location.assign(trip ? trip.getAttribute("href") : "/notes");
    return;
  }
  if (stage === "note") {
    for (let i = 0; i < 30 && !/Before we go/.test(text()); i++) await wait(500);
    await wait(2500);
    await shot("note");
    sessionStorage.setItem("shots", "today");
    location.assign("/tasks/today");
    return;
  }
  if (stage === "today") {
    await wait(4000);
    await shot("today");
    sessionStorage.setItem("shots", "done");
    report({ step: "done" });
  }
})().catch((e) => report({ step: "error", error: String(e && (e.message || e)) }));
