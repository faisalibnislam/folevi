// Made by apps/desktop/scripts/handover-kit.mjs from apps/desktop/src/handoffKit.ts (as tsc compiles it): edit
// that file and run the script, never this one. HandoverImport.swift calls (<this function>)()[fn](storage, ...args).
function handoffKit() {
    const toB64 = (bytes) => {
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x8000)
            s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
    };
    const fromB64 = (b64) => {
        const s = atob(b64);
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++)
            out[i] = s.charCodeAt(i);
        return out;
    };
    const TYPED = {
        Int8Array,
        Uint8Array,
        Uint8ClampedArray,
        Int16Array,
        Uint16Array,
        Int32Array,
        Uint32Array,
        Float32Array,
        Float64Array,
        BigInt64Array,
        BigUint64Array,
    };
    /** A structured-clone value as JSON-safe data; objects that happen to have a "$t" key are wrapped. */
    async function encode(v) {
        if (v === undefined)
            return { $t: "u" };
        if (v === null || typeof v === "boolean" || typeof v === "string")
            return v;
        if (typeof v === "number")
            return Number.isFinite(v) ? v : { $t: "n", v: String(v) };
        if (typeof v === "bigint")
            return { $t: "big", v: v.toString() };
        if (Array.isArray(v)) {
            const out = [];
            for (const x of v)
                out.push(await encode(x));
            return out;
        }
        if (v instanceof Date)
            return { $t: "date", v: v.getTime() };
        if (typeof Blob !== "undefined" && v instanceof Blob) {
            const bytes = new Uint8Array(await v.arrayBuffer());
            const name = typeof File !== "undefined" && v instanceof File ? v.name : null;
            return { $t: "blob", type: v.type, name, lastModified: name !== null ? v.lastModified : null, b64: toB64(bytes) };
        }
        if (v instanceof ArrayBuffer)
            return { $t: "ab", b64: toB64(new Uint8Array(v)) };
        if (ArrayBuffer.isView(v)) {
            const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
            return { $t: v instanceof DataView ? "dv" : "ta", k: v.constructor.name, b64: toB64(bytes.slice()) };
        }
        if (v instanceof Map) {
            const out = [];
            for (const [k, x] of v)
                out.push([await encode(k), await encode(x)]);
            return { $t: "map", v: out };
        }
        if (v instanceof Set) {
            const out = [];
            for (const x of v)
                out.push(await encode(x));
            return { $t: "set", v: out };
        }
        if (v instanceof RegExp)
            return { $t: "re", source: v.source, flags: v.flags };
        if (typeof v === "object") {
            const out = {};
            for (const [k, x] of Object.entries(v))
                out[k] = await encode(x);
            return Object.prototype.hasOwnProperty.call(v, "$t") ? { $t: "obj", v: out } : out;
        }
        // Functions and symbols can't be in IndexedDB.
        return null;
    }
    function decode(v) {
        if (v === null || typeof v !== "object")
            return v;
        if (Array.isArray(v))
            return v.map(decode);
        const o = v;
        if (typeof o.$t !== "string") {
            const out = {};
            for (const [k, x] of Object.entries(o))
                out[k] = decode(x);
            return out;
        }
        switch (o.$t) {
            case "u":
                return undefined;
            case "n":
                return Number(o.v);
            case "big":
                return BigInt(o.v);
            case "date":
                return new Date(o.v);
            case "blob": {
                const bytes = fromB64(o.b64);
                const opts = { type: o.type || "" };
                return typeof o.name === "string" && typeof File !== "undefined"
                    ? new File([bytes], o.name, { ...opts, lastModified: o.lastModified ?? Date.now() })
                    : new Blob([bytes], opts);
            }
            case "ab":
                return fromB64(o.b64).buffer;
            case "ta": {
                const Ctor = TYPED[o.k] ?? Uint8Array;
                return new Ctor(fromB64(o.b64).buffer);
            }
            case "dv":
                return new DataView(fromB64(o.b64).buffer);
            case "map":
                return new Map(o.v.map(([k, x]) => [decode(k), decode(x)]));
            case "set":
                return new Set(o.v.map(decode));
            case "re":
                return new RegExp(o.source, o.flags);
            case "obj": {
                const out = {};
                for (const [k, x] of Object.entries(o.v))
                    out[k] = decode(x);
                return out;
            }
            default:
                return null;
        }
    }
    const done = (r) => new Promise((res, rej) => {
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
    const finished = (tx) => new Promise((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error ?? new Error("aborted"));
    });
    /** Opens a database only if it exists (never creates one). */
    function openExisting(g, name) {
        return new Promise((res) => {
            const r = g.indexedDB.open(name);
            r.onupgradeneeded = () => r.transaction?.abort();
            r.onsuccess = () => res(r.result);
            r.onerror = () => res(null);
            r.onblocked = () => res(null);
        });
    }
    async function dbNames(g, prefix) {
        const list = (await g.indexedDB.databases?.()) ?? [];
        return list.map((d) => d.name ?? "").filter((n) => n.startsWith(prefix)).sort();
    }
    async function inventoryOf(g, db) {
        const names = Array.from(db.objectStoreNames);
        const stores = [];
        const pending = { sync: 0, outbox: 0, uploads: 0 };
        if (names.length) {
            const tx = db.transaction(names, "readonly");
            for (const name of names) {
                const store = tx.objectStore(name);
                const indexes = Array.from(store.indexNames).map((i) => {
                    const idx = store.index(i);
                    return { name: i, keyPath: idx.keyPath, unique: idx.unique, multiEntry: idx.multiEntry };
                });
                stores.push({ name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes, count: await done(store.count()) });
                // apps/web/src/lib/sync/db.ts: the sync state (one record per account, or per workspace in older
                // builds), outbox entries in `meta` as "outbox:<id>", and attachments waiting in `uploads`.
                if (name === "syncState") {
                    for (const s of (await done(store.getAll()))) {
                        pending.sync += (Array.isArray(s?.pending) ? s.pending.length : 0) + (Array.isArray(s?.inflight) ? s.inflight.length : 0);
                    }
                }
                if (name === "meta")
                    pending.outbox += await done(store.count(g.IDBKeyRange.bound("outbox:", "outbox:￿")));
                if (name === "uploads")
                    pending.uploads += await done(store.count());
            }
            await finished(tx);
        }
        return { name: db.name, version: db.version, stores, pending };
    }
    return {
        encode,
        decode,
        /** What the origin holds: every folevi-* database (its schema, record counts and waiting work) and localStorage. */
        async inventory(g, prefix = "folevi-") {
            const databases = [];
            for (const name of await dbNames(g, prefix)) {
                const db = await openExisting(g, name);
                if (!db)
                    continue;
                try {
                    databases.push(await inventoryOf(g, db));
                }
                finally {
                    db.close();
                }
            }
            const storage = [];
            for (let i = 0; i < g.localStorage.length; i++) {
                const key = g.localStorage.key(i);
                if (key?.startsWith("folevi"))
                    storage.push([key, g.localStorage.getItem(key) ?? ""]);
            }
            storage.sort((a, b) => (a[0] < b[0] ? -1 : 1));
            return JSON.stringify({ databases, storage });
        },
        /** Up to about `budget` characters of records from one store, after the (tagged) key `after`. */
        async readChunk(g, name, storeName, after, budget = 4_000_000) {
            const db = await openExisting(g, name);
            if (!db)
                throw new Error(`No database ${name}`);
            try {
                const tx = db.transaction(storeName, "readonly");
                const store = tx.objectStore(storeName);
                const range = after === null || after === undefined ? null : g.IDBKeyRange.lowerBound(decode(after), true);
                const raw = [];
                let size = 0;
                let more = false;
                await new Promise((res, rej) => {
                    const r = store.openCursor(range);
                    r.onerror = () => rej(r.error);
                    r.onsuccess = () => {
                        const cursor = r.result;
                        if (!cursor)
                            return res();
                        if (raw.length && size >= budget) {
                            more = true;
                            return res();
                        }
                        raw.push([cursor.primaryKey, cursor.value]);
                        // A rough size (Blobs counted by their bytes): only to keep each chunk reasonable.
                        size += JSON.stringify(cursor.value, (_k, x) => (typeof Blob !== "undefined" && x instanceof Blob ? "x".repeat(Math.ceil(x.size * 1.4)) : typeof x === "bigint" ? String(x) : x))?.length ?? 0;
                        cursor.continue();
                    };
                });
                await finished(tx);
                const records = [];
                for (const [k, v] of raw)
                    records.push([await encode(k), await encode(v)]);
                return JSON.stringify({ records, next: more && records.length ? records[records.length - 1][0] : null });
            }
            finally {
                db.close();
            }
        },
        /**
         * Creates a database with the same schema on this origin. "exists" when it's already here with records
         * (or at another version): the handoff then leaves it alone, so nothing on this origin is overwritten.
         */
        async prepare(g, schemaJson) {
            const schema = JSON.parse(schemaJson);
            const result = await new Promise((res, rej) => {
                let created = false;
                const r = g.indexedDB.open(schema.name, schema.version);
                r.onupgradeneeded = (e) => {
                    const db = r.result;
                    if (e.oldVersion !== 0) {
                        r.transaction?.abort();
                        return;
                    }
                    created = true;
                    for (const s of schema.stores) {
                        const store = db.createObjectStore(s.name, { keyPath: s.keyPath ?? undefined, autoIncrement: s.autoIncrement });
                        for (const i of s.indexes)
                            store.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
                    }
                };
                r.onsuccess = () => {
                    r.result.close();
                    res(created ? "created" : "check");
                };
                // A newer version here, or an existing database we refused to upgrade.
                r.onerror = (e) => {
                    e.preventDefault();
                    if (r.error?.name === "VersionError" || r.error?.name === "AbortError")
                        res("exists");
                    else
                        rej(r.error);
                };
                r.onblocked = () => rej(new Error(`${schema.name} is open elsewhere`));
            });
            if (result !== "check")
                return result;
            // Already here at the same version: only an empty one (same stores) may be filled.
            const db = await openExisting(g, schema.name);
            if (!db)
                return "exists";
            try {
                const names = Array.from(db.objectStoreNames).sort();
                if (names.join("\n") !== schema.stores.map((s) => s.name).sort().join("\n"))
                    return "exists";
                const tx = db.transaction(names, "readonly");
                let total = 0;
                for (const n of names)
                    total += await done(tx.objectStore(n).count());
                await finished(tx);
                return total === 0 ? "empty" : "exists";
            }
            finally {
                db.close();
            }
        },
        /** Writes a chunk (from readChunk) into one store; answers how many records it wrote. */
        async writeChunk(g, name, storeName, chunkJson) {
            const chunk = JSON.parse(chunkJson);
            const db = await openExisting(g, name);
            if (!db)
                throw new Error(`No database ${name}`);
            try {
                const tx = db.transaction(storeName, "readwrite");
                const store = tx.objectStore(storeName);
                for (const [k, v] of chunk.records) {
                    if (store.keyPath === null)
                        store.put(decode(v), decode(k));
                    else
                        store.put(decode(v));
                }
                await finished(tx);
                return chunk.records.length;
            }
            finally {
                db.close();
            }
        },
        /** Record counts per store, to check a copy. */
        async counts(g, name) {
            const db = await openExisting(g, name);
            if (!db)
                return JSON.stringify(null);
            try {
                const names = Array.from(db.objectStoreNames);
                const out = {};
                if (names.length) {
                    const tx = db.transaction(names, "readonly");
                    for (const n of names)
                        out[n] = await done(tx.objectStore(n).count());
                    await finished(tx);
                }
                return JSON.stringify(out);
            }
            finally {
                db.close();
            }
        },
        /** Sets the localStorage entries this origin doesn't have yet; answers how many it set. */
        writeStorage(g, entriesJson) {
            let n = 0;
            for (const [k, v] of JSON.parse(entriesJson)) {
                if (typeof k !== "string" || !k.startsWith("folevi") || g.localStorage.getItem(k) !== null)
                    continue;
                g.localStorage.setItem(k, v);
                n++;
            }
            return n;
        },
    };
}
