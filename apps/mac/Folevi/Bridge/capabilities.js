// The page's half of the Mac capabilities (Bridge/DesktopRouter+Capabilities.swift, docs/MAC_WEBKIT_PLAN.md §10
// WM5), placed inside mac-bridge.js's function by WebViewFactory (extraScripts), with call, listen, desk, fire,
// quietly, send, toB64, has, desktop and BOOT in reach. Each member is there only once the app lists it in
// BOOT.desktop. The page's types are apps/web/src/lib/desktop.ts.
(function () {
  var plain = function (v) {
    try {
      return JSON.parse(JSON.stringify(v === undefined ? null : v));
    } catch (e) {
      return null;
    }
  };
  var str = function (v, max) {
    return typeof v === "string" ? v.slice(0, max) : "";
  };
  var bytesOf = function (b) {
    return b instanceof Uint8Array || ArrayBuffer.isView(b) || b instanceof ArrayBuffer ? toB64(b) : "";
  };

  // A page that loads again leaves no call recording of its own running (the recorder that started it is gone).
  if (has.recordCall) fire("callCancel");

  /** Recording a call natively (lib/callCapture.ts): this Mac's sound and the microphone, mixed by the app. */
  if (has.recordCall)
    desktop.recordCall = {
      start: function () {
        return desk("callStart").then(function () {
          return true;
        });
      },
      pause: function () {
        fire("callPause");
      },
      resume: function () {
        fire("callResume");
      },
      /** The recording as a Blob (audio/mp4) and its length, or null when there's none. */
      stop: function () {
        return quietly(desk("callStop")).then(function (r) {
          if (!r || typeof r.file !== "string") return null;
          var type = typeof r.mime === "string" ? r.mime : "audio/mp4";
          return send("app://folevi/_bridge/" + r.file)
            .then(function (res) {
              if (!res.ok) return null;
              return res.arrayBuffer();
            })
            .then(function (buf) {
              return buf ? { blob: new Blob([buf], { type: type }), seconds: Number(r.seconds) || 0 } : null;
            })
            .catch(function () {
              return null;
            });
        });
      },
      cancel: function () {
        fire("callCancel");
      },
      onLevel: function (cb) {
        return listen("FoleviDesktop", "callLevel", function (d) {
          var level = Number(d && d.level);
          if (isFinite(level)) cb(Math.max(0, Math.min(1, level)));
        });
      },
      onEnded: function (cb) {
        return listen("FoleviDesktop", "callEnded", function (d) {
          cb(str(d && d.reason, 40) || "ended");
        });
      },
    };

  // Notes dragged out of the app: the page's drag says which notes it carries; the app asks for each one's
  // Markdown (and attachments) only when it's dropped outside Folevi.
  if (has.dragNotes) {
    var providers = [];
    desktop.dragNotes = function (notes, fileOf) {
      if (typeof fileOf !== "function") return;
      var list = (Array.isArray(notes) ? notes : []).slice(0, 50).map(function (n) {
        return { id: str(n && n.id, 64), title: str(n && n.title, 200) };
      });
      if (!list.length) return;
      var token = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      providers.push({ token: token, fileOf: fileOf });
      if (providers.length > 8) providers.shift();
      fire("dragNotes", { notes: list, token: token });
    };
    listen("FoleviDesktop", "noteFile", function (r) {
      var request = str(r && r.request, 64);
      var entry = providers.filter(function (p) {
        return p.token === (r && r.token);
      })[0];
      var reply = function (o) {
        o.request = request;
        fire("dragNoteReply", o);
      };
      if (!entry) return reply({ error: "gone" });
      Promise.resolve()
        .then(function () {
          return entry.fileOf(str(r.id, 64), str(r.folder, 200));
        })
        .then(
          function (f) {
            if (!f || typeof f.text !== "string") return reply({ error: "none" });
            reply({
              text: f.text,
              files: (Array.isArray(f.files) ? f.files : []).slice(0, 500).map(function (x) {
                return { path: str(x && x.path, 1000), data: bytesOf(x && x.bytes) };
              }),
            });
          },
          function () {
            reply({ error: "failed" });
          },
        );
    });
  }

  /** The page as it is, in the print panel (File > Print with no note open). */
  if (has.print)
    desktop.print = function () {
      fire("print");
    };

  /** The Share picker for a link, text or a note's Markdown (as a file named fileName), next to rect or x, y. */
  if (has.share)
    desktop.share = function (item) {
      var o = item || {};
      var out = { title: str(o.title, 300) };
      if (typeof o.text === "string") out.text = o.text.slice(0, 1000000);
      if (typeof o.url === "string") out.url = o.url.slice(0, 4000);
      if (typeof o.fileName === "string") out.fileName = o.fileName.slice(0, 200);
      var r = o.rect;
      if (r && typeof r === "object") out.rect = { x: Number(r.x), y: Number(r.y), width: Number(r.width), height: Number(r.height) };
      if (typeof o.x === "number" && typeof o.y === "number") {
        out.x = o.x;
        out.y = o.y;
      }
      return quietly(desk("share", out)).then(function (a) {
        return !!(a && a.shared);
      });
    };

  /** What File > Share sends from this page now: the open note ({ title, url? }), or null. */
  if (has.setShareTarget)
    desktop.setShareTarget = function (target) {
      var t = target && typeof target === "object" ? { title: str(target.title, 300) } : null;
      if (t && typeof target.url === "string") t.url = target.url.slice(0, 4000);
      fire("setShareTarget", { target: t });
    };

  /** Spotlight holds exactly these notes of this page's place afterwards. */
  if (has.indexSpotlight)
    desktop.indexSpotlight = function (items) {
      return quietly(desk("indexSpotlight", { items: plain(Array.isArray(items) ? items.slice(0, 200) : []) })).then(function () {});
    };

  /** The clipboard for Folevi's own menus (no "Paste" bubble): text, HTML and a PNG image (bytes). */
  if (has.clipboard)
    desktop.clipboard = {
      read: function () {
        return quietly(desk("clipboardRead")).then(function (r) {
          if (!r) return null;
          var out = {};
          if (typeof r.text === "string") out.text = r.text;
          if (typeof r.html === "string") out.html = r.html;
          if (typeof r.image === "string") {
            var bin = atob(r.image);
            var u8 = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            out.image = u8;
          }
          return out;
        });
      },
      write: function (data) {
        var d = data || {};
        var out = {};
        if (typeof d.text === "string") out.text = d.text;
        if (typeof d.html === "string") out.html = d.html;
        if (d.image) out.image = bytesOf(d.image);
        return quietly(desk("clipboardWrite", out)).then(function (r) {
          return r !== null;
        });
      },
    };

  /** Quick Look on files of a note: [{ name, bytes }]. */
  if (has.quickLook)
    desktop.quickLook = function (files) {
      var list = (Array.isArray(files) ? files : []).slice(0, 20).map(function (f) {
        return { name: str(f && f.name, 200) || "File", data: bytesOf(f && f.bytes) };
      });
      return quietly(desk("quickLook", { files: list })).then(function (r) {
        return r !== null;
      });
    };

  /** The page's answer to a command that carried an id (Shortcuts, the services, File > Share and Print). */
  if (has.commandDone)
    desktop.commandDone = function (id, value) {
      if (typeof id !== "string" || !id) return;
      fire("commandDone", { id: id.slice(0, 64), value: plain(value || {}) });
    };
})();
