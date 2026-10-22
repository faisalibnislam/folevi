// Folevi for Android: what the built-in interface gets from the app (docs/ANDROID_PLAN.md).
//
// The app injects this at document start, only into its own origin (https://localhost, ShellPlugin.kt), wrapped
// as `(function (boot) { ... })({...})` with the values the page must know before its first render (the mode,
// the app's version, this device's name, the WebView's safe-area support). It defines, frozen:
//   window.foleviShell   the bridge contract of the built-in interface (apps/web/src/lib/shell/types.ts,
//                        docs/LOCAL_MODE_PLAN.md §4.1), with platform "android";
//   window.foleviNative  the phone extras the iPhone app also has (apps/web/src/lib/nativeApp.ts), with
//                        platform "android": haptics, the system bars, links out, the lock, folevi:// links,
//                        shares, the scanner, notifications, text in images.
// Every call goes to the app's Kotlin plugins through Capacitor's bridge, which only answers this origin.
// Bytes cross as base64. Secrets (the session, provider tokens, Foli AI keys, device keys) never come here.
//
// It also marks <html data-native="android">, keeps the system bars' icons in step with the page's theme,
// lays the page out under the system bars (safe areas), tells the page about the keyboard, and runs the back
// gesture: sheets, menus and full canvas close first, then the page goes back, then Android leaves the app.
(function (boot, kit) {
  "use strict";
  if (window.foleviShell || location.origin !== boot.origin) return;

  // ---------------------------------------------------------------- calls to the app

  var cap = function () {
    return window.Capacitor;
  };

  /** A plain object for the page: Capacitor's exceptions carry `code` and `message`. */
  function failure(e, name, fallbackCode) {
    var code = (e && (e.code || (e.data && e.data.code))) || fallbackCode || "failed";
    var message = (e && e.message) || "Folevi couldn't do that on this device.";
    var out = { name: name || "FoleviError", code: String(code), message: String(message) };
    if (e && e.data && e.data.path) out.path = e.data.path;
    return out;
  }

  function call(plugin, method, args, errorName, fallbackCode) {
    var c = cap();
    if (!c || typeof c.nativePromise !== "function")
      return Promise.reject(failure({ code: "unavailable", message: "Folevi's app bridge isn't ready." }, errorName));
    return c.nativePromise(plugin, method, args || {}).catch(function (e) {
      throw failure(e, errorName, fallbackCode);
    });
  }

  /** A call whose native side answers more than once (streams, watches); returns the callback id. */
  function stream(plugin, method, args, onData) {
    var c = cap();
    if (!c || typeof c.nativeCallback !== "function") return null;
    return c.nativeCallback(plugin, method, args || {}, function (data, error) {
      onData(data || null, error || null);
    });
  }

  function ready(fn) {
    if (cap()) fn();
    else
      document.addEventListener(
        "DOMContentLoaded",
        function () {
          if (cap()) fn();
        },
        { once: true },
      );
  }

  /** Events from the app arrive as window events "folevi-android:<name>" (Bridge.triggerWindowJSEvent). */
  function onNative(name, fn) {
    var listener = function (e) {
      try {
        fn(e);
      } catch (err) {
        console.error(err);
      }
    };
    window.addEventListener("folevi-android:" + name, listener);
    return function () {
      window.removeEventListener("folevi-android:" + name, listener);
    };
  }

  // ---------------------------------------------------------------- bytes

  function toBase64(bytes) {
    var u8 = bytesOf(bytes);
    if (!u8) throw failure({ code: "invalid_argument", message: "Expected bytes." }, "TypeError");
    var out = "";
    for (var i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(out);
  }

  function fromBase64(text) {
    var bin = atob(text || "");
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesOf(v) {
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return null;
  }

  /** Large files cross in pieces (Capacitor's messages are strings; a few MB each keeps memory flat). */
  var CHUNK = 3 * 1024 * 1024;

  function writeBytes(plugin, method, args, bytes, errorName) {
    var u8 = bytesOf(bytes);
    if (!u8) return Promise.reject(failure({ code: "invalid_argument", message: "Expected bytes." }, errorName));
    if (u8.length <= CHUNK) return call(plugin, method, Object.assign({}, args, { data: toBase64(u8) }), errorName);
    var upload = Math.random().toString(36).slice(2) + Date.now().toString(36);
    var chain = Promise.resolve();
    for (var off = 0; off < u8.length; off += CHUNK) {
      (function (start) {
        chain = chain.then(function () {
          return call(plugin, "chunk", { upload: upload, offset: start, data: toBase64(u8.subarray(start, start + CHUNK)) }, errorName);
        });
      })(off);
    }
    return chain.then(function () {
      return call(plugin, method, Object.assign({}, args, { upload: upload, size: u8.length }), errorName);
    });
  }

  function readBytes(answer) {
    if (answer && typeof answer.data === "string") return fromBase64(answer.data);
    return null;
  }

  // ---------------------------------------------------------------- foleviShell (docs/LOCAL_MODE_PLAN.md §4.1)

  var LIB = "FoleviLibrary";
  var lib = function (method, args) {
    return call(LIB, method, args, "LocalFsError", "io");
  };
  var bytesApi = { toBase64: toBase64, fromBase64: fromBase64 };

  // A library on Dropbox or Google Drive runs here, in the shared provider code (packages/cloud-folders through
  // bridge/cloud.ts); a library on this phone runs in Kotlin (LibraryPlugin.kt). Which one is open is the
  // library's kind, read from the app and kept here.
  var cloudKit = kit && typeof kit.createCloudKit === "function" ? kit.createCloudKit(function (plugin, method, args) {
    return call(plugin, method, args, "CloudError", "io");
  }, bytesApi, function (m) {
    console.info("[Folevi cloud] " + m);
  }) : null;
  var kindNow = null;
  function currentKind() {
    if (!kindNow) kindNow = lib("info").then(function (i) {
      return i && i.configured !== false ? i.kind : null;
    }, function (e) {
      kindNow = null;
      throw e;
    });
    return kindNow;
  }
  function isCloud(kind) {
    return kind === "dropbox" || kind === "gdrive";
  }
  function localFsError(e) {
    if (e && e.name === "LocalFsError") return e;
    var code = (e && e.code) || "io";
    if (e && e.name === "CloudError" && e.kind) code = "io";
    return failure({ code: code, message: e && e.message, data: e && e.path ? { path: e.path } : null }, "LocalFsError", "io");
  }
  /** Runs `onCloud(fs)` for a cloud library, else `onPhone()`. */
  function route(onCloud, onPhone) {
    return currentKind().then(function (k) {
      if (isCloud(k) && cloudKit) return cloudKit.fs(k).then(onCloud).catch(function (e) {
        throw localFsError(e);
      });
      return onPhone();
    });
  }
  /** The phone's own library folder, as a file layer for copying. */
  var phoneFiles = {
    list: function (dir) { return lib("list", { dir: dir, root: "device" }).then(function (r) { return r.entries || []; }); },
    read: function (path) { return lib("read", { path: path, root: "device" }).then(function (r) { return r.notDownloaded ? { notDownloaded: true } : { bytes: readBytes(r), etag: r.etag }; }); },
    write: function (path, bytes, o) {
      var args = { path: path, root: "device", hasIfMatch: !!(o && "ifMatch" in o) };
      if (o && "ifMatch" in o) args.ifMatch = o.ifMatch === null ? null : String(o.ifMatch);
      return writeBytes(LIB, "write", args, bytes, "LocalFsError").then(function (r) { return r.mismatch ? { mismatch: true, etag: r.etag } : { etag: r.etag }; });
    },
    remove: function (path, o) { return lib("remove", Object.assign({ path: path, root: "device" }, o && o.ifMatch ? { ifMatch: o.ifMatch } : {})); },
  };
  function filesFor(kind) {
    if (isCloud(kind)) return cloudKit.fs(kind);
    return Promise.resolve(phoneFiles);
  }

  var library = {
    setup: function (o) {
      var kind = o && o.kind;
      if (isCloud(kind)) {
        if (!cloudKit) return Promise.reject(failure({ code: "unavailable", message: "Dropbox and Google Drive aren't in this build of Folevi." }, "LocalFsError"));
        return cloudKit.prepare(kind).then(function (m) {
          return lib("setState", { kind: kind, libraryId: m.libraryId });
        }).then(function () {
          kindNow = Promise.resolve(kind);
          return cloudKit.info(kind);
        }).catch(function (e) {
          throw localFsError(e);
        });
      }
      return lib("setup", { kind: kind }).then(function (r) {
        kindNow = null;
        return r && r.info ? r.info : null;
      });
    },
    info: function () {
      return lib("info").then(function (i) {
        kindNow = Promise.resolve(i && i.configured !== false ? i.kind : null);
        if (i && isCloud(i.kind) && cloudKit) return cloudKit.info(i.kind);
        return i;
      });
    },
    list: function (dir) {
      var d = String(dir == null ? "" : dir);
      return route(function (fs) { return fs.list(d); }, function () {
        return lib("list", { dir: d }).then(function (r) {
          return r.entries || [];
        });
      });
    },
    read: function (path) {
      var p = String(path);
      return route(function (fs) { return fs.read(p); }, function () {
        return lib("read", { path: p }).then(function (r) {
          if (r.notDownloaded) return { notDownloaded: true };
          return { bytes: readBytes(r), etag: r.etag };
        });
      });
    },
    write: function (path, bytes, o) {
      var p = String(path);
      return route(function (fs) {
        var u8 = bytesOf(bytes);
        if (!u8) throw failure({ code: "invalid_argument", message: "Expected bytes." }, "LocalFsError");
        return fs.write(p, u8, o && "ifMatch" in o ? { ifMatch: o.ifMatch === null ? null : String(o.ifMatch) } : {});
      }, function () {
        var args = { path: p, hasIfMatch: !!(o && "ifMatch" in o) };
        if (o && "ifMatch" in o) args.ifMatch = o.ifMatch === null ? null : String(o.ifMatch);
        return writeBytes(LIB, "write", args, bytes, "LocalFsError").then(function (r) {
          return r.mismatch ? { mismatch: true, etag: r.etag } : { etag: r.etag };
        });
      });
    },
    remove: function (path, o) {
      var p = String(path);
      return route(function (fs) { return fs.remove(p, o && "ifMatch" in o ? { ifMatch: String(o.ifMatch) } : {}); }, function () {
        var args = { path: p };
        if (o && "ifMatch" in o) args.ifMatch = String(o.ifMatch);
        return lib("remove", args);
      }).then(function () {});
    },
    conflictVersions: function (path) {
      var p = String(path);
      return route(function (fs) { return fs.conflictVersions(p); }, function () {
        return lib("conflictVersions", { path: p }).then(function (r) {
          return (r.versions || []).map(function (v) {
            return { id: v.id, bytes: fromBase64(v.data) };
          });
        });
      });
    },
    resolveConflicts: function (path, ids) {
      var p = String(path);
      var list = Array.isArray(ids) ? ids.map(String) : [];
      return route(function (fs) { return fs.resolveConflicts(p, list); }, function () {
        return lib("resolveConflicts", { path: p, ids: list });
      }).then(function () {});
    },
    startDownload: function (paths) {
      var list = Array.isArray(paths) ? paths.map(String) : [];
      return route(function (fs) { return fs.startDownload(list); }, function () {
        return lib("startDownload", { paths: list });
      }).then(function () {});
    },
    watch: function (cb) {
      var deliver = function (changes) {
        if (changes && changes.length) {
          try {
            cb(changes);
          } catch (e) {
            console.error(e);
          }
        }
      };
      var stop = null;
      var on = true;
      currentKind().then(function (k) {
        if (!on) return;
        if (isCloud(k) && cloudKit) stop = cloudKit.watch(k, deliver);
        else {
          var id = stream(LIB, "watch", {}, function (data) {
            if (data && Array.isArray(data.changes)) deliver(data.changes);
          });
          stop = function () {
            if (id) call(LIB, "unwatch", { callbackId: id }).catch(function () {});
          };
        }
      }, function () {});
      return function () {
        if (!on) return;
        on = false;
        if (stop) stop();
      };
    },
    journal: {
      append: function (record) {
        return writeBytes(LIB, "journalAppend", {}, record, "LocalFsError").then(function () {});
      },
      readAll: function () {
        return lib("journalRead").then(function (r) {
          return (r.records || []).map(fromBase64);
        });
      },
      truncate: function (n) {
        return lib("journalTruncate", { count: Number(n) || 0 }).then(function () {});
      },
    },
    unlock: function (passphrase) {
      return lib("unlock", { passphrase: String(passphrase) }).then(function (r) {
        return r.ok === true;
      });
    },
    setPassphrase: function (p) {
      return lib("setPassphrase", { passphrase: p == null ? null : String(p) }).then(function () {});
    },
    changePassphrase: function (o, n) {
      return lib("changePassphrase", { oldPassphrase: String(o), newPassphrase: String(n) }).then(function (r) {
        return r.ok === true;
      });
    },
    /** Served by the app from the library (or a cloud library's copy here), on this origin (LibraryFiles.kt). */
    fileUrl: function (sha256, mime) {
      var sha = String(sha256).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("Not a SHA-256 file name.");
      return boot.origin + "/_files/" + sha + (mime ? "?type=" + encodeURIComponent(String(mime)) : "");
    },
    /** Copies the library to the other place (files already there are kept and merged), then opens it there. */
    move: function (to) {
      var target = to && to.kind;
      return currentKind().then(function (from) {
        if (from === target) return library.info();
        // A cloud place gets its library file first (or keeps the one there); the phone's folder takes the copied one.
        var prepared = isCloud(target) ? cloudKit.prepare(target) : null;
        return Promise.resolve(prepared)
          .then(function () {
            return Promise.all([filesFor(from), filesFor(target)]);
          })
          .then(function (pair) {
            return kit.copyLibrary(pair[0], pair[1]);
          })
          .then(function () {
            return isCloud(target) ? cloudKit.prepare(target).then(function (m) { return lib("setState", { kind: target, libraryId: m.libraryId }); }) : lib("setup", { kind: "device" });
          })
          .then(function () {
            kindNow = Promise.resolve(target);
            return library.info();
          });
      }).catch(function (e) {
        throw localFsError(e);
      });
    },
  };

  // Sync with Dropbox and Google Drive: status and sign-in only; the tokens stay in the app (CloudPlugin.kt).
  var CLOUD = "FoleviCloud";
  var cloud = {
    status: function () {
      return call(CLOUD, "status", {}, "CloudError", "io");
    },
    connect: function (provider) {
      return call(CLOUD, "connect", { provider: String(provider) }, "CloudError", "io");
    },
    cancel: function () {
      return call(CLOUD, "cancel", {}, "CloudError", "io").then(function () {});
    },
    signOut: function () {
      return call(CLOUD, "signOut", {}, "CloudError", "io");
    },
    onStatus: function (cb) {
      var off = onNative("cloud-status", function (e) {
        cb(e.status);
      });
      cloud.status().then(cb, function () {});
      return off;
    },
  };
  library.cloud = cloud;

  var secrets = {
    has: function (name) {
      return call("FoleviSecrets", "has", { name: String(name) }).then(function (r) {
        return r.value === true;
      });
    },
    set: function (name, value) {
      return call("FoleviSecrets", "set", { name: String(name), value: typeof value === "string" ? value : "" }).then(function () {});
    },
    delete: function (name) {
      return call("FoleviSecrets", "delete", { name: String(name) }).then(function () {});
    },
  };

  var auth = {
    /** Signs in in a Custom Tab (the website's /connect); true once the app holds a session. */
    signIn: function () {
      return call("FoleviAuth", "signIn").then(function (r) {
        return r.value === true;
      });
    },
    signOut: function () {
      return call("FoleviAuth", "signOut").then(function () {});
    },
    /** Only the website's /api/auth/*; the app adds the session and scrubs it from the answer. */
    fetch: function (path, init) {
      init = init || {};
      var headers = {};
      if (init.headers && typeof init.headers === "object") {
        if (typeof init.headers.forEach === "function" && !Array.isArray(init.headers))
          init.headers.forEach(function (v, k) {
            headers[k] = v;
          });
        else
          Object.keys(init.headers).forEach(function (k) {
            headers[k] = String(init.headers[k]);
          });
      }
      return call("FoleviAuth", "fetch", {
        path: String(path),
        method: init.method ? String(init.method) : "GET",
        headers: headers,
        body: typeof init.body === "string" ? init.body : null,
      });
    },
    convexToken: function () {
      return call("FoleviAuth", "convexToken").then(function (r) {
        return typeof r.token === "string" && r.token ? r.token : null;
      });
    },
  };

  var aiRequests = 0;
  var ai = {
    capabilities: function () {
      return call("FoleviAi", "capabilities");
    },
    generate: function (req, onChunk) {
      aiRequests += 1;
      var id = "g" + aiRequests + Math.random().toString(36).slice(2, 10);
      var plain;
      try {
        plain = JSON.parse(JSON.stringify(req == null ? null : req));
      } catch (e) {
        plain = null;
      }
      var finish;
      var done = new Promise(function (resolve) {
        finish = resolve;
      });
      var settled = false;
      var cbId = stream("FoleviAi", "generate", { id: id, request: plain }, function (data, error) {
        if (settled) return;
        if (error) {
          settled = true;
          finish({ text: "", stopReason: "error", error: error.message || "Folevi couldn't reach Foli AI.", errorCode: error.code || "unavailable" });
          return;
        }
        if (!data) return;
        if (typeof data.chunk === "string" && data.chunk) {
          try {
            onChunk(data.chunk);
          } catch (e) {
            /* The page's own callback failing doesn't stop the answer. */
          }
        }
        if (data.result) {
          settled = true;
          finish(data.result);
        }
      });
      if (!cbId) {
        settled = true;
        finish({ text: "", stopReason: "error", error: "Folevi couldn't reach Foli AI.", errorCode: "unavailable" });
      }
      return {
        done: done,
        cancel: function () {
          call("FoleviAi", "cancel", { id: id }).catch(function () {});
        },
      };
    },
    testKey: function (provider) {
      return call("FoleviAi", "testKey", { provider: String(provider) });
    },
  };

  var lock = {
    getSettings: function () {
      return call("FoleviLock", "getSettings", {}, "LockError", "unavailable");
    },
    setSettings: function (patch) {
      return call("FoleviLock", "setSettings", { lock: patch && patch.lock, lockAfter: patch && patch.lockAfter }, "LockError", "io");
    },
  };

  var notify = {
    schedule: function (n) {
      n = n || {};
      return call("FoleviNotify", "schedule", { id: String(n.id), at: Number(n.at), title: String(n.title || ""), body: String(n.body || ""), path: String(n.path || "/") }).then(function () {});
    },
    cancel: function (id) {
      return call("FoleviNotify", "cancel", { id: String(id) }).then(function () {});
    },
  };

  var files = {
    /** Saves a file the page made where the person picks (the system's "Save to" screen); false when cancelled. */
    save: function (name, bytes) {
      return writeBytes("FoleviFiles", "save", { name: String(name) }, bytes, "FilesError").then(function (r) {
        return r.saved === true;
      });
    },
  };

  var http = {
    preview: function (url) {
      return call("FoleviHttp", "preview", { url: String(url) }).then(function (r) {
        return typeof r.html === "string" ? r.html : null;
      });
    },
    calendar: function (url, previous) {
      previous = previous || {};
      return call("FoleviHttp", "calendar", { url: String(url), etag: previous.etag || null, lastModified: previous.lastModified || null });
    },
  };

  // End-to-end encryption: this device's keys, kept by the app in the Android Keystore (E2eePlugin.kt,
  // docs/E2EE_DESIGN.md §6.2): the page gets the public halves, what a box sealed to this device holds, and
  // signatures. The same shape as the Mac's foleviShell.e2ee.
  var e2ee = {
    deviceKeys: function () {
      return call("FoleviE2ee", "deviceKeys", {}, "E2eeBridgeError", "unavailable").then(function (r) {
        return { deviceId: r.deviceId, x25519Pub: fromBase64(r.x25519Pub), ed25519Pub: fromBase64(r.ed25519Pub) };
      });
    },
    open: function (box, context) {
      var b = bytesOf(box);
      if (!b) return Promise.reject({ name: "E2eeBridgeError", code: "invalid_argument", message: "Not a sealed Folevi box." });
      return call("FoleviE2ee", "open", { box: toBase64(b), context: String(context) }, "E2eeBridgeError", "failed").then(function (r) {
        return fromBase64(r.data);
      });
    },
    sign: function (kind, body) {
      return call("FoleviE2ee", "sign", { kind: String(kind), body: String(body) }, "E2eeBridgeError", "failed").then(function (r) {
        return r.signature;
      });
    },
    reset: function () {
      return call("FoleviE2ee", "reset", {}, "E2eeBridgeError", "failed").then(function () {});
    },
    /** "Ask for your fingerprint or face to unlock encrypted notes". */
    settings: function () {
      return call("FoleviE2ee", "settings", {}, "E2eeBridgeError", "unavailable").then(function (r) {
        return { touchId: r.touchId === true, available: r.available === true };
      });
    },
    setTouchId: function (on) {
      return call("FoleviE2ee", "setTouchId", { on: on === true }, "E2eeBridgeError", "failed").then(function (r) {
        return { touchId: r.touchId === true, available: r.available === true };
      });
    },
  };

  var shellBridge = {
    platform: "android",
    shellVersion: boot.version,
    deviceName: boot.deviceName,
    /** "tablet" on a big screen (600 dp or more on its short side), else "phone". */
    deviceFamily: boot.deviceFamily,
    initialMode: boot.mode,
    /** Saves the choice; the app then reloads the page in that mode. */
    setMode: function (mode) {
      return call("FoleviShell", "setMode", { mode: String(mode) }).then(function (r) {
        if (!r || r.ok !== true) throw new Error("Folevi couldn't switch to " + String(mode) + ".");
      });
    },
    library: library,
    secrets: secrets,
    auth: auth,
    ai: ai,
    lock: lock,
    notify: notify,
    files: files,
    http: http,
    e2ee: e2ee,
  };

  // ---------------------------------------------------------------- foleviNative (the phone extras)

  var commandListeners = [];
  var pendingCommands = [];
  function deliverCommand(command) {
    if (!commandListeners.length) {
      pendingCommands.push(command);
      return;
    }
    commandListeners.slice().forEach(function (l) {
      try {
        l(command);
      } catch (e) {
        console.error(e);
      }
    });
  }
  // The app back in front: the page takes what was shared meanwhile (components/app/NativeBridge.tsx).
  onNative("app-active", function () {
    window.dispatchEvent(new Event("folevi:app-active"));
  });
  onNative("command", function (e) {
    if (e && e.command) deliverCommand(e.command);
  });

  var NATIVE = "FoleviNative";
  var nativeBridge = {
    platform: "android",
    version: boot.version,
    haptic: function (kind) {
      call("FoleviShell", "haptic", { kind: String(kind || "light") }).catch(function () {});
    },
    setStatusBar: function (theme) {
      setBars(theme === "dark" ? "dark" : "light");
    },
    openExternal: function (url) {
      return call("FoleviShell", "openExternal", { url: String(url) }).then(function (r) {
        return r.value === true;
      });
    },
    getSettings: function () {
      return call("FoleviLock", "getSettings").catch(function () {
        return null;
      });
    },
    setSettings: function (patch) {
      return call("FoleviLock", "setSettings", { lock: patch && patch.lock, lockAfter: patch && patch.lockAfter }, "LockError", "io");
    },
    onCommand: function (listener) {
      commandListeners.push(listener);
      if (pendingCommands.length) {
        var queued = pendingCommands.splice(0);
        setTimeout(function () {
          queued.forEach(deliverCommand);
        }, 0);
      }
      return function () {
        var i = commandListeners.indexOf(listener);
        if (i >= 0) commandListeners.splice(i, 1);
      };
    },
    device: function () {
      return call(NATIVE, "device").then(function (r) {
        return r && r.device ? r.device : null;
      });
    },
    setCredential: function (c) {
      return call(NATIVE, "setCredential", { token: c && c.token, tokenId: c && c.tokenId, accountId: c && c.accountId }).then(function (r) {
        return r.value === true;
      });
    },
    clearCredential: function () {
      return call(NATIVE, "clearCredential").then(function () {});
    },
    takeShares: function () {
      return call(NATIVE, "takeShares").then(function (r) {
        return r.shares || [];
      });
    },
    finishShare: function (id) {
      return call(NATIVE, "finishShare", { id: String(id) }).then(function () {});
    },
    scanDocument: function (source) {
      return call(NATIVE, "scanDocument", { source: source === "photos" ? "photos" : "camera" }).then(function (r) {
        return r && r.scan ? r.scan : null;
      });
    },
    pushStatus: function () {
      return call(NATIVE, "pushStatus").then(function (r) {
        return r && r.status ? r.status : null;
      });
    },
    enablePush: function () {
      return call(NATIVE, "enablePush").then(function (r) {
        return r && r.status ? r.status : null;
      });
    },
    disablePush: function () {
      return call(NATIVE, "disablePush").then(function () {});
    },
    setBadge: function (count) {
      call(NATIVE, "setBadge", { count: Math.max(0, Number(count) || 0) }).catch(function () {});
    },
    openNotificationSettings: function () {
      return call(NATIVE, "openNotificationSettings").then(function () {});
    },
    recognizeText: function (image) {
      image = image || {};
      return call(NATIVE, "recognizeText", { data: String(image.data || ""), type: String(image.type || ""), handwriting: image.handwriting === true }).then(
        function (r) {
          return r && typeof r.text === "string" ? { text: r.text } : null;
        },
        function () {
          return null;
        },
      );
    },
    /** What this app adds beyond the iPhone app's list: which of its own extras this build has. */
    android: Object.freeze({ webViewVersion: boot.webViewVersion }),
  };

  function deepFreeze(o) {
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v);
    });
    return Object.freeze(o);
  }

  Object.defineProperty(window, "foleviShell", { value: deepFreeze(shellBridge), writable: false, configurable: false, enumerable: true });
  Object.defineProperty(window, "foleviNative", { value: deepFreeze(nativeBridge), writable: false, configurable: false, enumerable: true });

  // ---------------------------------------------------------------- the page's look in the app

  var root = document.documentElement;
  function mark() {
    root = document.documentElement;
    if (!root) return;
    root.setAttribute("data-native", "android");
    if (boot.insets) applyInsets(boot.insets);
  }

  /** The system bars, the gesture bar, a display cutout and the keyboard, in CSS pixels (MainActivity.kt). */
  function applyInsets(i) {
    if (!root || !i) return;
    var s = root.style;
    s.setProperty("--android-inset-top", i.top + "px");
    s.setProperty("--android-inset-right", i.right + "px");
    s.setProperty("--android-inset-bottom", i.bottom + "px");
    s.setProperty("--android-inset-left", i.left + "px");
    s.setProperty("--android-keyboard", (i.keyboard || 0) + "px");
  }
  onNative("insets", function (e) {
    boot.insets = e.insets;
    applyInsets(e.insets);
  });

  // WebView reports the system bars to env(safe-area-inset-*) only from version 140 (older ones give 0 for
  // everything but a display cutout). There, every env(safe-area-inset-X) in the page's styles and inline
  // styles reads the app's own value instead: var(--android-inset-X). Newer WebViews keep env() as it is.
  var major = parseInt(String(boot.webViewVersion || "0").split(".")[0], 10) || 0;
  var polyfill = major < 140;
  var ENV_RE = /env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;
  function rewrite(text) {
    return text.replace(ENV_RE, function (_, side, fallback) {
      return "var(--android-inset-" + side + ", " + (fallback && fallback.trim() ? fallback.trim() : "0px") + ")";
    });
  }
  function rewriteRules(rules) {
    if (!rules) return;
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.style && r.style.cssText.indexOf("safe-area-inset") >= 0) {
        try {
          r.style.cssText = rewrite(r.style.cssText);
        } catch (e) {
          /* A rule the browser won't let us change: it keeps env(). */
        }
      }
      var inner = null;
      try {
        inner = r.cssRules;
      } catch (e) {
        inner = null;
      }
      if (inner && inner.length) rewriteRules(inner);
    }
  }
  var doneSheets = typeof WeakSet === "function" ? new WeakSet() : null;
  function rewriteSheets() {
    if (!polyfill) return;
    for (var i = 0; i < document.styleSheets.length; i++) {
      var sheet = document.styleSheets[i];
      if (doneSheets && doneSheets.has(sheet)) continue;
      try {
        rewriteRules(sheet.cssRules);
        if (doneSheets) doneSheets.add(sheet);
      } catch (e) {
        /* Not loaded yet, or another origin's: tried again when it loads. */
      }
    }
  }
  function rewriteInline(el) {
    var css = el.getAttribute && el.getAttribute("style");
    if (css && css.indexOf("env(safe-area-inset") >= 0) el.setAttribute("style", rewrite(css));
  }
  function startPolyfill() {
    if (!polyfill) return;
    rewriteSheets();
    document.querySelectorAll("[style*='safe-area-inset']").forEach(rewriteInline);
    document.addEventListener(
      "load",
      function (e) {
        var t = e.target;
        if (t && (t.tagName === "LINK" || t.tagName === "STYLE")) rewriteSheets();
      },
      true,
    );
    new MutationObserver(function (records) {
      var sheets = false;
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (rec.type === "attributes") rewriteInline(rec.target);
        else
          for (var j = 0; j < rec.addedNodes.length; j++) {
            var n = rec.addedNodes[j];
            if (n.nodeType !== 1) continue;
            if (n.tagName === "STYLE" || n.tagName === "LINK") sheets = true;
            rewriteInline(n);
            if (n.querySelectorAll) n.querySelectorAll("[style*='safe-area-inset']").forEach(rewriteInline);
          }
      }
      if (sheets) setTimeout(rewriteSheets, 0);
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
  }

  var lastBars = "";
  function setBars(theme) {
    if (theme === lastBars) return;
    lastBars = theme;
    call("FoleviShell", "setSystemBars", { theme: theme }).catch(function () {
      lastBars = "";
    });
  }
  function followTheme() {
    var t = root && root.dataset ? root.dataset.theme : null;
    setBars(t === "dark" ? "dark" : "light");
  }

  // The keyboard (the web view ends above it): the same window events the iPhone app's Keyboard plugin sends,
  // which the phone interface listens for (apps/web/src/components/iphone/chrome.tsx).
  onNative("keyboard", function (e) {
    var name = e.visible ? (e.phase === "end" ? "keyboardDidShow" : "keyboardWillShow") : e.phase === "end" ? "keyboardDidHide" : "keyboardWillHide";
    var ev = new Event(name);
    ev.keyboardHeight = e.height || 0;
    window.dispatchEvent(ev);
  });

  // ---------------------------------------------------------------- back

  // What can close before the page goes back: a modal dialog or sheet, a menu or popover in the top layer,
  // a block in full canvas. A page can also take a back press itself: `folevi:back` is a cancelable window
  // event fired first (preventDefault() when handled).
  function overlays() {
    var found = [];
    document.querySelectorAll("dialog[open]").forEach(function (d) {
      found.push({ kind: "dialog", el: d });
    });
    document.querySelectorAll("[popover]").forEach(function (p) {
      var open = false;
      try {
        open = p.matches(":popover-open");
      } catch (e) {
        open = false;
      }
      if (open) found.push({ kind: p.hasAttribute("data-full") ? "canvas" : "popover", el: p });
    });
    document.querySelectorAll('[role="menu"], [role="listbox"][data-state="open"]').forEach(function (m) {
      if (m.offsetParent !== null || getComputedStyle(m).position === "fixed") found.push({ kind: "menu", el: m });
    });
    return found;
  }

  function escapeOn(target) {
    var t = target || document.activeElement || document.body;
    var init = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true };
    t.dispatchEvent(new KeyboardEvent("keydown", init));
    t.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  function closeTop(list) {
    var top = list[list.length - 1];
    if (top.kind === "dialog") {
      var ev = new Event("cancel", { cancelable: true });
      top.el.dispatchEvent(ev);
      return;
    }
    var inside = document.activeElement && top.el.contains(document.activeElement) ? document.activeElement : null;
    if (top.kind === "canvas") escapeOn(inside || top.el.querySelector(".fb-canvas-body") || top.el);
    else escapeOn(inside || document.activeElement || top.el);
  }

  function visible(el) {
    if (!el || el.closest('[aria-hidden="true"], [inert]')) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }

  // The phone interface (apps/web/src/components/iphone) has its own stack per tab: a screen that isn't a tab's
  // first one shows Back, which knows where back is (the tab's stack, or the screen's parent). Back from another
  // tab's first screen goes Home, as Android's bottom navigation does; Home's first screen leaves the app.
  function phoneBack() {
    if (!root || !root.hasAttribute("data-iphone")) return null;
    var buttons = Array.prototype.filter.call(document.querySelectorAll('button[aria-label="Back"]'), visible);
    if (buttons.length) return buttons[buttons.length - 1];
    if (!/^\/documents\/?$/.test(location.pathname)) {
      var home = document.querySelector('nav[aria-label="Tabs"] button[aria-label="Home"], nav[aria-label="Tabs"] a[aria-label="Home"]');
      if (home && visible(home)) return home;
    }
    return null;
  }

  function canGoBack() {
    if (root && root.hasAttribute("data-iphone")) return phoneBack() !== null;
    var nav = window.navigation;
    if (nav && typeof nav.canGoBack === "boolean") return nav.canGoBack;
    return history.length > 1;
  }

  function historyBack() {
    var b = phoneBack();
    if (b) b.click();
    else history.back();
  }

  var handled = null;
  function handlesBack() {
    return overlays().length > 0 || canGoBack() || backListeners() > 0;
  }
  function backListeners() {
    return Number(root && root.getAttribute("data-back-handlers")) || 0;
  }
  function reportBack() {
    var now = handlesBack();
    if (now === handled) return;
    handled = now;
    call("FoleviShell", "setBackEnabled", { enabled: now }).catch(function () {
      handled = null;
    });
  }

  function goBack() {
    var e = new CustomEvent("folevi:back", { cancelable: true });
    window.dispatchEvent(e);
    if (e.defaultPrevented) return Promise.resolve(true);
    var before = overlays();
    if (before.length) {
      closeTop(before);
      return new Promise(function (resolve) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            var after = overlays();
            if (after.length < before.length || after[after.length - 1] !== before[before.length - 1]) return resolve(true);
            // Nothing answered Escape: close it ourselves (a dialog), else go back in the page.
            var top = before[before.length - 1];
            if (top.kind === "dialog" && top.el.open) {
              top.el.close();
              return resolve(true);
            }
            if (canGoBack()) {
              historyBack();
              return resolve(true);
            }
            resolve(false);
          });
        });
      });
    }
    if (canGoBack()) {
      historyBack();
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  // Predictive back: while the gesture is held the page eases back (smaller, toward the edge it came from),
  // and springs back if the gesture is cancelled.
  var peekTarget = null;
  function peek(progress, edge) {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    var list = overlays();
    var el = list.length ? list[list.length - 1].el : document.body;
    if (peekTarget && peekTarget !== el) unpeek();
    peekTarget = el;
    var p = Math.max(0, Math.min(1, progress));
    var eased = 1 - Math.pow(1 - p, 2);
    var dir = edge === "right" ? -1 : 1;
    el.style.transition = "none";
    el.style.transformOrigin = edge === "right" ? "left center" : "right center";
    el.style.transform = "translateX(" + dir * eased * 24 + "px) scale(" + (1 - eased * 0.08) + ")";
    if (el === document.body) el.style.borderRadius = eased * 28 + "px";
  }
  function unpeek(animate) {
    var el = peekTarget;
    peekTarget = null;
    if (!el) return;
    el.style.transition = animate ? "transform 180ms cubic-bezier(0.2, 0, 0, 1), border-radius 180ms" : "none";
    el.style.transform = "";
    el.style.borderRadius = "";
    setTimeout(function () {
      el.style.transition = "";
      el.style.transformOrigin = "";
    }, animate ? 200 : 0);
  }

  onNative("back", function (e) {
    if (e.phase === "progress") return peek(e.progress, e.edge);
    if (e.phase === "cancel") return unpeek(true);
    unpeek(false);
    goBack().then(function (ok) {
      if (!ok) call("FoleviShell", "leave").catch(function () {});
      setTimeout(reportBack, 50);
    });
  });

  // ---------------------------------------------------------------- start

  mark();
  if (!root) document.addEventListener("readystatechange", mark, { once: true });

  function watchPage() {
    mark();
    startPolyfill();
    followTheme();
    reportBack();
    new MutationObserver(function () {
      followTheme();
      reportBack();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-back-handlers"] });
    new MutationObserver(reportBack).observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "popover", "data-full", "role", "data-state"],
    });
    document.addEventListener("toggle", reportBack, true);
    window.addEventListener("popstate", reportBack);
    if (window.navigation) window.navigation.addEventListener("currententrychange", reportBack);
    var push = history.pushState;
    var replace = history.replaceState;
    history.pushState = function () {
      var r = push.apply(history, arguments);
      setTimeout(reportBack, 0);
      return r;
    };
    history.replaceState = function () {
      var r = replace.apply(history, arguments);
      setTimeout(reportBack, 0);
      return r;
    };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchPage, { once: true });
  else watchPage();

  ready(function () {
    call("FoleviShell", "pageReady").catch(function () {});
  });
})
