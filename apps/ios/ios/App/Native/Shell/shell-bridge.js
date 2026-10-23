// window.foleviShell for the interface built into the apps (docs/LOCAL_MODE_PLAN.md §4.1; the page's types are
// apps/web/src/lib/shell/types.ts), shared by the iPhone and iPad app and the native Mac app
// (docs/MAC_WEBKIT_PLAN.md §3.1). Each app places this file inside its own bridge script's function (never on the
// page's window) and calls foleviShellBridge(SHELL, host) with what the page starts with (SHELL: the mode, this
// device's name, the places, where to open) and the host:
//   call(plugin, method, options): a promise of the native answer; a failure rejects with { code, message, data }
//   listen(plugin, event, cb): native events for this page; returns the function that stops listening
//   platform, version, deviceName (when the app gave none), deviceFamily (iOS only), fileBase (library.fileUrl's
//   start: "folevi-file://lib/" on iOS, "app://folevi/_files/" on the Mac), cloudKit (FoleviCloudKit, or null)
// The native side is Native/Shell/FoleviShellPlugin.swift on iOS and apps/mac/Folevi/Bridge/ShellRouter.swift on
// the Mac, with the same method names and options. Bytes cross as base64 (a Uint8Array can't be posted).
// eslint-disable-next-line no-unused-vars
var foleviShellBridge = function (SHELL, host) {
  "use strict";
  var call = host.call;
  var listen = function (event, cb) {
    return host.listen("FoleviShell", event, cb);
  };
  // The app starts at index.html ("/"); the product's start page is /documents (as on the website, where "/"
  // is a redirect). Set before the page's router reads the address.
  // (After a switch to another place, where the switch asked to open: SHELL.start.)
  var START = typeof SHELL.start === "string" && SHELL.start.charAt(0) === "/" && SHELL.start.charAt(1) !== "/" ? SHELL.start : "/documents";
  if (location.pathname === "/" || location.pathname === "/index.html") history.replaceState(history.state, "", START + (START === "/documents" ? location.search + location.hash : ""));
  var toB64 = function (bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
    if (!u8) throw { name: "LocalFsError", code: "invalid_argument", message: "Bytes are needed." };
    var out = "";
    for (var i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(out);
  };
  var fromB64 = function (text) {
    var bin = atob(String(text || ""));
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };
  // A rejection the page can read: { name, code, message, path } (local-store's isNotFound reads `code`).
  var plainError = function (name) {
    return function (e) {
      var data = (e && e.data) || {};
      var err = { name: name, code: (e && e.code) || "io", message: (e && e.message) || "Folevi couldn't do that." };
      if (typeof data.path === "string") err.path = data.path;
      throw err;
    };
  };
  var shellCall = function (method, options, errorName) {
    return call("FoleviShell", method, options).catch(plainError(errorName || "LocalFsError"));
  };
  var value = function (r) {
    return r ? r.value : null;
  };
  var nothing = function () {};
  // signIn's options: only a provider the sign-in sheet can open straight on (ShellAuth.signInStart).
  var signInOptions = function (o) {
    return o && (o.provider === "google" || o.provider === "apple") ? { provider: o.provider } : {};
  };
  var libraryWatchers = 0;
  var aiRequests = 0;

  // ---- the library: on this device, in iCloud or a folder (Swift), or on Dropbox or Google Drive (the shared
  // provider code, packages/cloud-folders, bundled here as folevi-cloud.js; requests and tokens stay in Swift).
  var KIT = host.cloudKit && typeof host.cloudKit === "object" ? host.cloudKit : null;
  var NATIVE_CALL = { request: "cloudRequest", status: "cloudStatus" };
  var cloudKit = KIT
    ? KIT.createCloudKit(function (plugin, method, args) {
        var name = plugin === "FoleviCloud" ? NATIVE_CALL[method] : method;
        return call("FoleviShell", name, args || {}).catch(function (e) {
          throw { name: "CloudError", code: (e && e.code) || "io", message: (e && e.message) || "Folevi couldn't reach its cloud connection." };
        });
      }, { toBase64: toB64, fromBase64: fromB64 }, function (m) {
        console.info("[Folevi cloud] " + m);
      })
    : null;
  var isCloud = function (k) {
    return k === "dropbox" || k === "gdrive";
  };
  var kindNow = null;
  var currentKind = function () {
    if (!kindNow)
      kindNow = shellCall("libInfo").then(
        function (i) {
          return i && i.configured !== false ? i.kind : null;
        },
        function (e) {
          kindNow = null;
          throw e;
        },
      );
    return kindNow;
  };
  var asFsError = function (e) {
    if (e && e.name === "LocalFsError") return e;
    var err = { name: "LocalFsError", code: (e && e.code) || "io", message: (e && e.message) || "Folevi couldn't reach its library." };
    if (e && e.path) err.path = e.path;
    return err;
  };
  /** Runs `cloud(fs)` for a Dropbox or Google Drive library, else `here()` (Swift). */
  var route = function (cloud, here) {
    return currentKind().then(function (k) {
      if (isCloud(k) && cloudKit)
        return cloudKit.fs(k).then(cloud).catch(function (e) {
          throw asFsError(e);
        });
      return here();
    });
  };
  var nativeFiles = function (root) {
    var extra = root ? { root: root } : {};
    return {
      list: function (dir) {
        return shellCall("libList", Object.assign({ dir: String(dir) }, extra)).then(function (r) {
          return (r && r.entries) || [];
        });
      },
      read: function (path) {
        return shellCall("libRead", Object.assign({ path: String(path) }, extra)).then(function (r) {
          return r.notDownloaded ? { notDownloaded: true } : { bytes: fromB64(r.bytes), etag: r.etag };
        });
      },
      write: function (path, bytes, o) {
        var has = o && Object.prototype.hasOwnProperty.call(o, "ifMatch") && o.ifMatch !== undefined;
        var mode = !has ? "any" : o.ifMatch === null ? "create" : "match";
        var opts = Object.assign({ path: String(path), bytes: toB64(bytes), mode: mode }, extra);
        if (mode === "match") opts.ifMatch = String(o.ifMatch);
        return shellCall("libWrite", opts).then(function (r) {
          return r.mismatch ? { mismatch: true, etag: r.etag } : { etag: r.etag };
        });
      },
      remove: function (path, o) {
        var opts = { path: String(path) };
        if (o && typeof o.ifMatch === "string") opts.ifMatch = o.ifMatch;
        return shellCall("libRemove", opts).then(nothing);
      },
    };
  };
  var here = nativeFiles(null);
  // A cloud library's attachment the app's file handler wants on this device: fetched into its copy.
  listen("cloudWant", function (event) {
    if (!event || typeof event.path !== "string") return;
    currentKind().then(function (k) {
      if (isCloud(k) && cloudKit) return cloudKit.fs(k).then(function (fs) {
        return fs.startDownload([event.path]);
      });
    }).catch(nothing);
  });

  var library = Object.freeze({
    setup: function (o) {
      var kind = String((o && o.kind) || "");
      if (isCloud(kind)) {
        if (!cloudKit) return Promise.reject({ name: "LocalFsError", code: "unavailable", message: "Dropbox and Google Drive aren't in this build of Folevi." });
        return cloudKit
          .prepare(kind)
          .then(function (m) {
            return shellCall("libSetCloud", { kind: kind, libraryId: m.libraryId });
          })
          .then(function () {
            kindNow = Promise.resolve(kind);
            return cloudKit.info(kind);
          })
          .catch(function (e) {
            throw asFsError(e);
          });
      }
      return shellCall("libSetup", { kind: kind }).then(function (r) {
        kindNow = null;
        return r && r.value === null ? null : r;
      });
    },
    info: function () {
      return shellCall("libInfo").then(function (i) {
        kindNow = Promise.resolve(i && i.configured !== false ? i.kind : null);
        if (i && isCloud(i.kind) && cloudKit) return cloudKit.info(i.kind);
        return i;
      });
    },
    list: function (dir) {
      return route(function (fs) { return fs.list(String(dir)); }, function () { return here.list(dir); });
    },
    read: function (path) {
      return route(function (fs) { return fs.read(String(path)); }, function () { return here.read(path); });
    },
    write: function (path, bytes, o) {
      return route(function (fs) {
        var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        return fs.write(String(path), u8, o && "ifMatch" in o ? { ifMatch: o.ifMatch === null ? null : String(o.ifMatch) } : {});
      }, function () { return here.write(path, bytes, o); });
    },
    remove: function (path, o) {
      return route(function (fs) { return fs.remove(String(path), o && typeof o.ifMatch === "string" ? { ifMatch: o.ifMatch } : {}); }, function () { return here.remove(path, o); }).then(nothing);
    },
    conflictVersions: function (path) {
      return route(function (fs) { return fs.conflictVersions(String(path)); }, function () {
        return shellCall("libConflictVersions", { path: String(path) }).then(function (r) {
          return ((r && r.versions) || []).map(function (v) {
            return { id: v.id, bytes: fromB64(v.bytes) };
          });
        });
      });
    },
    resolveConflicts: function (path, ids) {
      var list = Array.isArray(ids) ? ids.map(String) : [];
      return route(function (fs) { return fs.resolveConflicts(String(path), list); }, function () {
        return shellCall("libResolveConflicts", { path: String(path), ids: list });
      }).then(nothing);
    },
    startDownload: function (paths) {
      var list = Array.isArray(paths) ? paths.map(String) : [];
      return route(function (fs) { return fs.startDownload(list); }, function () {
        return shellCall("libStartDownload", { paths: list });
      }).then(nothing);
    },
    /** Change batches from the app's watcher (or the provider's change feed); returns the unsubscribe function. */
    watch: function (cb) {
      var on = true;
      var stop = null;
      currentKind().then(function (k) {
        if (!on) return;
        if (isCloud(k) && cloudKit) {
          stop = cloudKit.watch(k, function (changes) {
            if (changes && changes.length) cb(changes);
          });
          return;
        }
        var unlisten = listen("libraryChanges", function (event) {
          if (event && Array.isArray(event.changes)) cb(event.changes);
        });
        if (libraryWatchers++ === 0) void shellCall("libWatch").catch(nothing);
        stop = function () {
          unlisten();
          if (--libraryWatchers === 0) void shellCall("libUnwatch").catch(nothing);
        };
      }, nothing);
      return function () {
        if (!on) return;
        on = false;
        if (stop) stop();
      };
    },
    journal: Object.freeze({
      append: function (record) {
        return shellCall("journalAppend", { record: toB64(record) }).then(nothing);
      },
      readAll: function () {
        return shellCall("journalRead").then(function (r) {
          return ((r && r.records) || []).map(fromB64);
        });
      },
      truncate: function (n) {
        return shellCall("journalTruncate", { n: Number(n) }).then(nothing);
      },
    }),
    unlock: function (passphrase) {
      return shellCall("libUnlock", { passphrase: String(passphrase) }).then(value);
    },
    setPassphrase: function (passphrase) {
      return shellCall("libSetPassphrase", passphrase === null ? {} : { passphrase: String(passphrase) }).then(nothing);
    },
    changePassphrase: function (oldPassphrase, newPassphrase) {
      return shellCall("libChangePassphrase", { old: String(oldPassphrase), new: String(newPassphrase) }).then(value);
    },
    /** Served by the app (Native/Shell/LibraryFileHandler.swift) from the library, or a cloud library's copy here. */
    fileUrl: function (sha256, mime) {
      var sha = String(sha256).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("Not a SHA-256 file name.");
      return host.fileBase + sha + (mime ? "?type=" + encodeURIComponent(String(mime)) : "");
    },
    /** Another place. To or from Dropbox and Google Drive the files are copied here (merged, never replaced). */
    move: function (to) {
      var target = String((to && to.kind) || "");
      return currentKind().then(function (from) {
        if (!isCloud(from) && !isCloud(target)) {
          return shellCall("libMove", { kind: target }).then(function (r) {
            kindNow = null;
            return r;
          });
        }
        if (from === target) return library.info();
        if (!cloudKit || !KIT) throw { name: "LocalFsError", code: "unavailable", message: "Dropbox and Google Drive aren't in this build of Folevi." };
        if (target === "folder") throw { name: "LocalFsError", code: "unavailable", message: "Move the library to this device first, then to a folder.", path: "unsupported" };
        var source = isCloud(from) ? cloudKit.fs(from) : Promise.resolve(here);
        var dest = isCloud(target) ? cloudKit.prepare(target).then(function () { return cloudKit.fs(target); }) : Promise.resolve(nativeFiles(target));
        return Promise.all([source, dest])
          .then(function (pair) {
            return KIT.copyLibrary(pair[0], pair[1]);
          })
          .then(function () {
            if (isCloud(target)) return cloudKit.prepare(target).then(function (m) { return shellCall("libSetCloud", { kind: target, libraryId: m.libraryId }); });
            return shellCall("libSetup", { kind: target });
          })
          .then(function () {
            kindNow = null;
            return library.info();
          });
      }).catch(function (e) {
        throw asFsError(e);
      });
    },
    // Sync with Dropbox and Google Drive: status and sign-in only; the tokens stay in Swift (ShellCloud.swift).
    cloud: Object.freeze({
      status: function () {
        return shellCall("cloudStatus", {}, "CloudError");
      },
      connect: function (provider) {
        return shellCall("cloudConnect", { provider: String(provider) }, "CloudError");
      },
      cancel: function () {
        return shellCall("cloudCancel", {}, "CloudError").then(nothing);
      },
      signOut: function () {
        return shellCall("cloudSignOut", {}, "CloudError").then(function (s) {
          if (cloudKit) cloudKit.reset();
          return s;
        });
      },
      onStatus: function (cb) {
        var unlisten = listen("cloudStatus", function (event) {
          if (event && event.status) cb(event.status);
        });
        shellCall("cloudStatus", {}, "CloudError").then(cb, nothing);
        return unlisten;
      },
    }),
  });

  // ---- several places (Native/Shell/ShellPlaces.swift, docs/MULTI_ACCOUNT_PLAN.md §2.2): the library and any
  // number of accounts; the page is the open place's (one web view), and never names another for its session or keys.
  var placeList = function (r) {
    return r && Array.isArray(r.places) ? r.places : [];
  };
  var places = SHELL.places && typeof SHELL.places === "object"
    ? Object.freeze({
        current: typeof SHELL.places.current === "string" ? SHELL.places.current : null,
        background: SHELL.places.background === true,
        list: function () {
          return shellCall("placesList", {}, "Error").then(placeList);
        },
        onChange: function (cb) {
          var unlisten = listen("placesChanged", function (event) {
            try {
              cb(placeList(event));
            } catch (e) {
              /* the page's own callback failing changes nothing here */
            }
          });
          return unlisten;
        },
        switchTo: function (id, o) {
          return shellCall("placesSwitch", { id: String(id), path: o && typeof o.path === "string" ? o.path : "/documents" }, "Error").then(nothing);
        },
        signIn: function (o) {
          return shellCall("placesSignIn", signInOptions(o), "Error").then(value);
        },
        describe: function (d) {
          var plain = {};
          try {
            plain = JSON.parse(JSON.stringify(d || {}));
          } catch (e) {
            plain = {};
          }
          return shellCall("placesDescribe", plain, "Error").then(nothing);
        },
        signOut: function (id, o) {
          var opts = { id: String(id) };
          if (o && typeof o.next === "string") opts.next = o.next;
          return shellCall("placesSignOut", opts, "Error").then(nothing);
        },
        forgetLibrary: function () {
          return shellCall("placesForgetLibrary", {}, "Error").then(nothing);
        },
        convexToken: function (id) {
          return shellCall("placesConvexToken", { id: String(id) }, "Error").then(value);
        },
        quickAddPlace: function () {
          return shellCall("placesQuickAdd", {}, "Error").then(value);
        },
        setQuickAddPlace: function (id) {
          return shellCall("placesSetQuickAdd", { id: String(id) }, "Error").then(nothing);
        },
      })
    : undefined;

  var shellBridge = {
    platform: host.platform,
    places: places,
    shellVersion: host.version,
    deviceName: String(SHELL.deviceName || host.deviceName),
    initialMode: SHELL.mode === "local" || SHELL.mode === "account" ? SHELL.mode : "unset",
    setMode: function (mode) {
      return shellCall("setMode", { mode: String(mode) }).then(nothing);
    },
    library: library,
    // The person's Foli AI keys, kept in the Keychain: stored and removed, never read back.
    secrets: Object.freeze({
      has: function (name) {
        return shellCall("secretsHas", { name: String(name) }).then(function (r) {
          return Boolean(r && r.value);
        });
      },
      set: function (name, v) {
        return shellCall("secretsSet", { name: String(name), value: typeof v === "string" ? v : "" }, "Error").then(nothing);
      },
      delete: function (name) {
        return shellCall("secretsDelete", { name: String(name) }, "Error").then(nothing);
      },
    }),
    // The account session lives in the app (Native/Shell/ShellAuth.swift) and never comes here.
    auth: Object.freeze({
      signIn: function (o) {
        return shellCall("authSignIn", signInOptions(o), "Error").then(function (r) {
          return Boolean(r && r.value);
        });
      },
      signOut: function () {
        return shellCall("authSignOut", {}, "Error").then(nothing);
      },
      fetch: function (path, init) {
        var i = init || {};
        var headers = {};
        if (i.headers && typeof i.headers === "object") {
          if (typeof i.headers.forEach === "function" && !Array.isArray(i.headers)) i.headers.forEach(function (v, k) { headers[k] = String(v); });
          else Object.keys(i.headers).forEach(function (k) { headers[k] = String(i.headers[k]); });
        }
        var opts = { path: String(path), method: typeof i.method === "string" ? i.method : "GET", headers: headers };
        if (typeof i.body === "string") opts.body = i.body;
        return shellCall("authFetch", opts, "Error");
      },
      convexToken: function () {
        return shellCall("authConvexToken", {}, "Error").then(value);
      },
    }),
    // Foli AI on this device (Native/Shell/ShellAI.swift): Apple's on-device model or the person's own keys.
    ai: Object.freeze({
      capabilities: function () {
        return shellCall("aiCapabilities", {}, "Error");
      },
      generate: function (req, onChunk) {
        aiRequests += 1;
        var id = "g" + aiRequests + Math.random().toString(36).slice(2, 10);
        var unlisten = listen("aiChunk", function (event) {
          if (!event || event.id !== id || typeof event.text !== "string") return;
          try {
            onChunk(event.text);
          } catch (e) {
            /* The page's own callback failing doesn't stop the answer. */
          }
        });
        var plain;
        try {
          plain = JSON.parse(JSON.stringify(req || null));
        } catch (e) {
          plain = null;
        }
        var done = call("FoleviShell", "aiGenerate", { id: id, req: plain })
          .catch(function () {
            return { text: "", stopReason: "error", error: "Folevi couldn't reach Foli AI.", errorCode: "unavailable" };
          })
          .then(function (r) {
            unlisten();
            return r;
          });
        return {
          done: done,
          cancel: function () {
            void call("FoleviShell", "aiCancel", { id: id }).catch(nothing);
          },
        };
      },
      testKey: function (provider) {
        return shellCall("aiTestKey", { provider: String(provider) }, "Error");
      },
    }),
    // The app lock (Face ID on iOS, Touch ID on the Mac): its settings; turning it on asks to unlock first.
    lock: Object.freeze({
      getSettings: function () {
        return shellCall("lockGet", {}, "LockError");
      },
      setSettings: function (patch) {
        var p = patch || {};
        var opts = {};
        if (typeof p.lock === "boolean") opts.lock = p.lock;
        if (typeof p.lockAfter === "number") opts.lockAfter = p.lockAfter;
        return shellCall("lockSet", opts, "LockError");
      },
    }),
    /** Reminders as the system's notifications (Native/Shell/ShellServices.swift). */
    notify: Object.freeze({
      schedule: function (n) {
        var r = n || {};
        return shellCall("notifySchedule", { id: String(r.id), at: Number(r.at), title: String(r.title || ""), body: String(r.body || ""), path: String(r.path || "/tasks") }, "Error").then(function (x) {
          if (!x || !x.value) throw new Error("Folevi couldn't schedule that reminder.");
        });
      },
      cancel: function (id) {
        return shellCall("notifyCancel", { id: String(id) }, "Error").then(nothing);
      },
    }),
    files: Object.freeze({
      /** Saves a file the page made where the person picks (the Files app, a save panel on the Mac); false when cancelled. */
      save: function (name, bytes) {
        return shellCall("filesSave", { name: String(name), bytes: toB64(bytes) }, "Error").then(function (r) {
          return Boolean(r && r.value);
        });
      },
    }),
    http: Object.freeze({
      preview: function (url) {
        return shellCall("httpPreview", { url: String(url) }, "Error").then(value);
      },
      calendar: function (url, previous) {
        var p = previous || {};
        return shellCall("httpCalendar", { url: String(url), previous: { etag: p.etag || null, lastModified: p.lastModified || null } }, "Error");
      },
    }),
    // This device's end-to-end encryption keys (Native/Shell/E2eeKeys.swift): the private halves stay in
    // the app; the page gets the public halves, what a box sealed to this device holds, and signatures.
    e2ee: Object.freeze({
      deviceKeys: function () {
        return shellCall("e2eeDeviceKeys", {}, "E2eeBridgeError").then(function (r) {
          return { deviceId: r.deviceId, x25519Pub: fromB64(r.x25519Pub), ed25519Pub: fromB64(r.ed25519Pub) };
        });
      },
      open: function (sealedBox, context) {
        return shellCall("e2eeOpen", { box: toB64(sealedBox), context: String(context) }, "E2eeBridgeError").then(function (r) {
          return fromB64(r.bytes);
        });
      },
      sign: function (kind, body) {
        return shellCall("e2eeSign", { kind: String(kind), body: String(body) }, "E2eeBridgeError").then(value);
      },
      reset: function () {
        return shellCall("e2eeReset", {}, "E2eeBridgeError").then(nothing);
      },
      /** "Ask for Face ID (Touch ID) to unlock encrypted notes" (Settings > This device): { touchId, available }. */
      settings: function () {
        return shellCall("e2eeSettings", {}, "E2eeBridgeError");
      },
      setTouchId: function (on) {
        return shellCall("e2eeSetTouchId", { on: on === true }, "E2eeBridgeError");
      },
    }),
  };
  // "iPhone" or "iPad" on iOS (lib/shell/words.ts); the Mac has none.
  if (host.deviceFamily) shellBridge.deviceFamily = host.deviceFamily;
  return Object.freeze(shellBridge);
};
