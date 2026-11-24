// Folevi Server's own pages (scripts/self-host/server/supervisor.mjs): setup, status, setup key, starting, and
// diagnostics. Plain HTML with a little inline script, no dependencies. Copy follows the web copy rules: plain,
// calm, US English, sentence case, no em dashes.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const css = `
:root{color-scheme:light dark;--bg:#f6f5f2;--card:#fff;--ink:#1d1c1a;--muted:#6b6862;--line:#e3e0da;--accent:#2f6f5e;--accent-ink:#fff;--bad:#a33a2b;--good:#2f6f5e}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#1f1f1d;--ink:#ecebe7;--muted:#a19e97;--line:#34332f;--accent:#6fbfa6;--accent-ink:#0f1f1a;--bad:#e0806f;--good:#6fbfa6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:640px;margin:0 auto;padding:40px 16px 64px}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}
p{margin:6px 0}.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-top:20px}
label{display:block;font-weight:600;margin:16px 0 4px}input,textarea{width:100%;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:9px 11px}
textarea{min-height:64px}.help{font-size:13px;color:var(--muted);margin-top:4px}
button,.button{display:inline-block;font:inherit;font-weight:600;border:0;border-radius:8px;padding:9px 16px;background:var(--accent);color:var(--accent-ink);cursor:pointer;text-decoration:none;margin:16px 8px 0 0}
.button.quiet,button.quiet{background:transparent;color:var(--ink);border:1px solid var(--line)}
.error{color:var(--bad);margin-top:12px}.ok{color:var(--good)}.key{font:600 22px/1.2 ui-monospace,Menlo,monospace;letter-spacing:2px;padding:12px;border:1px dashed var(--line);border-radius:8px;text-align:center;margin:12px 0}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:6px 0;border-bottom:1px solid var(--line);vertical-align:top}td:first-child{color:var(--muted);width:38%;padding-right:12px}
pre{white-space:pre-wrap;word-break:break-word;font:12px/1.45 ui-monospace,Menlo,monospace;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;max-height:420px;overflow:auto}
.brand{display:flex;gap:10px;align-items:center;margin-bottom:20px;color:var(--muted);font-weight:600}.dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}
`;

function layout(title, body, script = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>${css}</style></head><body><main><div class="brand"><span class="dot"></span>Folevi Server</div>${body}</main>
<script>${script}</script></body></html>`;
}

const postJson = `async function post(url, body){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});let j={};try{j=await r.json()}catch{}if(!r.ok)throw new Error(j.error||("HTTP "+r.status));return j}`;

function settingsFields(settings, suggested) {
  return `
<label for="name">Server name</label>
<input id="name" name="name" value="${esc(settings.name || "Folevi Server")}" maxlength="60" autocomplete="off">
<p class="help">People see it when they sign in.</p>
<label for="address">Address people use</label>
<input id="address" name="address" value="${esc(settings.address || suggested)}" autocomplete="off" spellcheck="false">
<p class="help">The address in your browser's address bar right now usually works. Links to notes and images use it.</p>
<label for="extra">Other addresses (optional)</label>
<textarea id="extra" name="extra" spellcheck="false" placeholder="https://folevi.example.synology.me">${esc((settings.extraAddresses ?? []).join("\n"))}</textarea>
<p class="help">Another way you reach this server, such as a Tailscale or synology.me address. One per line.</p>
<label for="ai">Foli AI key (optional)</label>
<input id="ai" name="ai" type="password" value="${settings.aiKey ? "••••••••" : ""}" autocomplete="off" spellcheck="false" placeholder="A Google Gemini API key">
<p class="help">Without a key, Foli AI stays hidden. You can add one later.</p>
<label>Email</label>
<p class="help">Not in this test build. People can sign up without confirming their email address.</p>`;
}

const saveScript = `${postJson}
const v=(id)=>document.getElementById(id).value;
document.getElementById("form").addEventListener("submit",async(e)=>{e.preventDefault();const out=document.getElementById("out");out.textContent="Saving…";out.className="help";
try{const j=await post("/folevi-server/api/settings",{name:v("name"),address:v("address"),extraAddresses:v("extra"),aiKey:v("ai")});
if(j.setupKey){document.getElementById("form").hidden=true;document.getElementById("done").hidden=false;document.getElementById("key").textContent=j.setupKey}
else{out.textContent="Saved.";out.className="ok"}}catch(err){out.textContent=err.message;out.className="error"}});`;

export function setupPage({ settings, suggested, guess, phase, error }) {
  const status = phase === "ready" ? "" : phase === "failed" ? `<p class="error">The server couldn't finish starting: ${esc(error)}. <a href="/folevi-server/diagnostics">See diagnostics</a>.</p>` : `<p class="muted">Still getting ready: ${esc(phase)}. You can fill this in meanwhile.</p>`;
  return layout(
    "Set up Folevi Server",
    `<h1>Set up Folevi Server</h1><p class="muted">A few details, then you create your account. Everything stays on this server.</p>${status}
<form id="form" class="card">${settingsFields(settings, suggested || guess)}<button type="submit">Save and continue</button><p id="out" class="help"></p></form>
<div id="done" class="card" hidden><h2>Your setup key</h2><p>Write this down. You need it to change these settings or see diagnostics from another browser.</p>
<div class="key" id="key"></div><p class="help">It's also saved on the server, in the data folder's secrets.</p>
<a class="button" href="/signup">Create your account</a></div>`,
    saveScript,
  );
}

export function statusPage({ settings, phase, version, backup }) {
  const state = phase === "ready" ? `<span class="ok">Running</span>` : esc(phase);
  return layout(
    settings.name || "Folevi Server",
    `<h1>${esc(settings.name || "Folevi Server")}</h1><p class="muted">Folevi Server ${esc(version)}</p>
<div class="card"><table>
<tr><td>Status</td><td>${state}</td></tr>
<tr><td>Address</td><td>${esc(settings.address)}</td></tr>
<tr><td>Foli AI</td><td>${settings.aiKey ? "On" : "Off (no key)"}</td></tr>
<tr><td>Last backup</td><td>${backup ? `${esc(backup.at)} (${esc(backup.file)})` : "None yet. Backups run every night at 3:30."}</td></tr>
</table>
<a class="button" href="/documents">Open Folevi</a><a class="button quiet" href="/folevi-server/diagnostics">Diagnostics</a><button class="quiet" id="backup" type="button">Back up now</button><p id="bout" class="help"></p></div>
<h2>Settings</h2><form id="form" class="card">${settingsFields(settings, settings.address)}<button type="submit">Save</button><p id="out" class="help"></p></form>`,
    `${saveScript}
document.getElementById("backup").addEventListener("click",async()=>{const o=document.getElementById("bout");o.className="help";o.textContent="Starting a backup…";try{await post("/folevi-server/api/backup");o.textContent="Backing up. It appears in the data folder's backups folder when it's done.";o.className="ok"}catch(err){o.textContent=err.message;o.className="error"}});`,
  );
}

export function keyPage({ name, next = "/folevi-server/" }) {
  return layout(
    name || "Folevi Server",
    `<h1>${esc(name || "Folevi Server")}</h1><p class="muted">Enter the setup key you were given when this server was set up.</p>
<form id="form" class="card"><label for="k">Setup key</label><input id="k" autocomplete="off" spellcheck="false" autocapitalize="characters"><button type="submit">Continue</button><p id="out" class="help"></p></form>`,
    `${postJson}
document.getElementById("form").addEventListener("submit",async(e)=>{e.preventDefault();const o=document.getElementById("out");try{await post("/folevi-server/api/unlock",{key:document.getElementById("k").value});location.href=${JSON.stringify(next)}}catch(err){o.textContent=err.message;o.className="error"}});`,
  );
}

export function startingPage({ phase, error }) {
  const failed = phase === "failed";
  return layout(
    "Folevi Server",
    `<h1>${failed ? "Folevi Server couldn't start" : "Folevi Server is starting"}</h1>
<div class="card">${failed ? `<p class="error">${esc(error)}</p>` : `<p>${esc(phase)}…</p><p class="help">This page reloads by itself. The first start can take a few minutes.</p>`}
<a class="button quiet" href="/folevi-server/diagnostics">Diagnostics</a></div>`,
    failed ? "" : `setTimeout(()=>location.reload(),5000)`,
  );
}

const mb = (n) => (typeof n === "number" ? `${(n / 1024 / 1024).toFixed(0)} MB` : "?");
const gb = (n) => (typeof n === "number" ? `${(n / 1024 ** 3).toFixed(1)} GB` : "?");

/** The diagnostics as plain text, for copying into a message. */
export function diagnosticsText(d) {
  const lines = [
    `Folevi Server diagnostics, ${d.generatedAt}`,
    `Version: ${d.server.version} (built ${d.server.builtAt ?? "?"}, ${d.server.commit ?? "?"})`,
    `Status: ${d.phase}${d.phaseError ? ` (${d.phaseError})` : ""}`,
    `NAS: ${d.system.nas}, DSM ${d.system.dsm}`,
    `System: ${d.system.platform}, ${d.system.cpus} CPUs, ${gb(d.system.memory.totalBytes)} memory (${gb(d.system.memory.freeBytes)} free), load ${d.system.memory.loadavg.join(" ")}`,
    `glibc: ${d.system.ldd} / runtime ${d.system.glibcRuntime ?? "?"} / mode ${d.system.runtimeMode}`,
    `Node ${d.system.node}, Convex backend ${d.system.convexBackend}`,
    `Data: ${d.system.dataFolder} (${d.system.disk ? `${gb(d.system.disk.freeBytes)} free of ${gb(d.system.disk.totalBytes)}` : "?"}), runs as ${d.system.user}`,
    `Address: ${d.server.address}${d.server.extraAddresses?.length ? ` + ${d.server.extraAddresses.join(", ")}` : ""}; setup ${d.server.setupDone ? "done" : "not done"}; Foli AI ${d.server.foliAi ? "on" : "off"}`,
    `Functions deployed: ${d.deploy.deployedVersion ?? "never"} at ${d.deploy.deployedAt ?? "-"}`,
    `Backup: ${d.backup.running ? "running; " : ""}last ${d.backup.last ? `${d.backup.last.at} ${d.backup.last.file} ${mb(d.backup.last.bytes)}` : "none"}${d.backup.lastError ? `; last error ${d.backup.lastError.at}: ${d.backup.lastError.message}` : ""}`,
    "",
    "Processes:",
    ...Object.entries(d.processes).map(([k, p]) => `  ${k}: ${p.status ?? "running"}, pid ${p.pid ?? "-"}, ${mb(p.rssBytes)}${p.restarts ? `, ${p.restarts} restarts` : ""}${p.lastExit ? `, last exit ${p.lastExit.code ?? p.lastExit.signal} at ${p.lastExit.at}` : ""}`),
    "",
    `Recent errors (${d.recentErrors.length}):`,
    ...(d.recentErrors.length ? d.recentErrors.map((e) => `  ${e}`) : ["  none"]),
  ];
  for (const [name, list] of Object.entries(d.logs)) {
    lines.push("", `Last lines of the ${name} log:`, ...(list.length ? list.map((l) => `  ${l}`) : ["  (empty)"]));
  }
  return lines.join("\n");
}

export function diagnosticsPage(d) {
  const text = diagnosticsText(d);
  return layout(
    "Folevi Server diagnostics",
    `<h1>Diagnostics</h1><p class="muted">Send this to Folevi when something doesn't work. Secrets are left out.</p>
<div class="card"><table>
<tr><td>Status</td><td>${d.phase === "ready" ? `<span class="ok">Running</span>` : `<span class="error">${esc(d.phase)}</span>`}${d.phaseError ? `<br><span class="error">${esc(d.phaseError)}</span>` : ""}</td></tr>
<tr><td>Folevi Server</td><td>${esc(d.server.version)}</td></tr>
<tr><td>NAS and DSM</td><td>${esc(d.system.nas)}, DSM ${esc(d.system.dsm)}</td></tr>
<tr><td>System</td><td>${esc(d.system.platform)}, ${gb(d.system.memory.totalBytes)} memory, ${gb(d.system.memory.freeBytes)} free</td></tr>
<tr><td>glibc</td><td>${esc(d.system.ldd)} (mode ${esc(d.system.runtimeMode)})</td></tr>
<tr><td>Memory used</td><td>${Object.entries(d.processes).map(([k, p]) => `${esc(k)} ${mb(p.rssBytes)}`).join(", ")}</td></tr>
<tr><td>Recent errors</td><td>${d.recentErrors.length}</td></tr>
</table>
<button type="button" id="copy">Copy diagnostics</button><a class="button quiet" href="/folevi-server/api/diagnostics" download="folevi-diagnostics.json">Download as a file</a><a class="button quiet" href="/folevi-server/">Back</a>
<p id="out" class="help"></p></div>
<h2>Everything</h2><textarea id="all" readonly style="min-height:420px;font:12px/1.45 ui-monospace,Menlo,monospace">${esc(text)}</textarea>`,
    `document.getElementById("copy").addEventListener("click",async()=>{const t=document.getElementById("all");const o=document.getElementById("out");
try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(t.value)}else{t.focus();t.select();document.execCommand("copy")}o.textContent="Copied. Paste it into your message.";o.className="ok"}catch{o.textContent="Select the text below and copy it.";o.className="help"}});`,
  );
}
