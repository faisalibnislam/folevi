// Loaded into Folevi for Mac's main process ahead of the app (`electron -r <this> apps/desktop`, as
// e2e/desktop-shell.spec.ts does) so the app starts with no network at all: every http, https and WebSocket
// request in its session is cancelled from the first one. The one exception is the blank page of the
// one-time handoff (/_folevi-handoff), which the app serves itself and never fetches.
/* global require, URL */
"use strict";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a CommonJS file for `electron -r`
const { app } = require("electron");

app.on("session-created", (ses) => {
  ses.webRequest.onBeforeRequest((details, callback) => {
    let url;
    try {
      url = new URL(details.url);
    } catch {
      return callback({});
    }
    const network = ["http:", "https:", "ws:", "wss:"].includes(url.protocol);
    callback({ cancel: network && url.pathname !== "/_folevi-handoff" });
  });
});
