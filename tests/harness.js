// Test harness for sync.js — no build step, no dependencies.
//
// sync.js is a browser IIFE. Each simulated device gets its own
// vm context with an in-memory localStorage, a stub document and
// navigator, Node's WebCrypto, and a fetch() that talks to ONE
// shared FakeDropbox. Timers are captured, never fired, so every
// pull/push in a test happens because the test asked for it.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");

const SYNC_SRC = fs.readFileSync(path.join(__dirname, "..", "sync.js"), "utf8");
const PASSPHRASE = "test-passphrase";

// ---------- In-memory Dropbox ----------
// Implements only what the blob engine touches: download (rev in the
// dropbox-api-result header), conditional upload (add / update +
// strict_conflict → 409 path/conflict), get_metadata, copy, list,
// delete. Hooks let a test act "between" a device's calls.
class FakeDropbox {
  constructor() {
    this.files = new Map();     // path -> { text, rev }
    this.revCounter = 0;
    this.log = [];              // { device, op, path, ok, status }
    this.beforeUpload = null;   // (device, path, arg) => void
  }

  nextRev() { return "rev" + (++this.revCounter); }

  // Write directly, as another device would (used to fake races).
  put(p, text) {
    const rev = this.nextRev();
    this.files.set(p, { text, rev });
    return rev;
  }

  fetchFor(device) {
    return async (url, opts) => {
      opts = opts || {};
      const headers = opts.headers || {};
      const endpoint = String(url).replace(/^https:\/\/[^/]+\/2\//, "");
      const apiArg = headers["Dropbox-API-Arg"] ? JSON.parse(headers["Dropbox-API-Arg"]) : null;
      const body = opts.body;

      if (endpoint === "files/download") {
        const f = this.files.get(apiArg.path);
        this.log.push({ device, op: "download", path: apiArg.path, status: f ? 200 : 409 });
        if (!f) return jsonResponse(409, { error_summary: "path/not_found/" });
        return textResponse(200, f.text, { "dropbox-api-result": JSON.stringify({ rev: f.rev }) });
      }

      if (endpoint === "files/upload") {
        if (this.beforeUpload) this.beforeUpload(device, apiArg.path, apiArg);
        const cur = this.files.get(apiArg.path);
        const mode = apiArg.mode;
        let conflict = false;
        if (mode === "add") conflict = !!cur;
        else if (mode && mode[".tag"] === "update") conflict = !cur || cur.rev !== mode.update;
        if (conflict) {
          this.log.push({ device, op: "upload", path: apiArg.path, status: 409 });
          return jsonResponse(409, { error_summary: "path/conflict/file/.." });
        }
        const rev = this.put(apiArg.path, body);
        this.log.push({ device, op: "upload", path: apiArg.path, status: 200, mode });
        return jsonResponse(200, { rev, path_display: apiArg.path });
      }

      const args = body ? JSON.parse(body) : {};
      if (endpoint === "files/get_metadata") {
        const f = this.files.get(args.path);
        if (!f) return jsonResponse(409, { error_summary: "path/not_found/" });
        return jsonResponse(200, { rev: f.rev });
      }
      if (endpoint === "files/copy_v2") {
        const f = this.files.get(args.from_path);
        if (!f) return jsonResponse(409, { error_summary: "from_lookup/not_found/" });
        this.put(args.to_path, f.text);
        return jsonResponse(200, {});
      }
      if (endpoint === "files/list_folder") {
        const entries = [...this.files.keys()].map((p) => ({
          name: p.replace(/^\//, ""), path_lower: p.toLowerCase()
        }));
        return jsonResponse(200, { entries, has_more: false });
      }
      if (endpoint === "files/delete_v2") {
        // A folder path removes everything under it; paths compare
        // case-insensitively (callers may pass path_lower), as Dropbox does.
        const target = args.path.toLowerCase();
        for (const k of [...this.files.keys()]) {
          const kl = k.toLowerCase();
          if (kl === target || kl.startsWith(target + "/")) this.files.delete(k);
        }
        this.log.push({ device, op: "delete", path: args.path, status: 200 });
        return jsonResponse(200, {});
      }
      if (endpoint === "auth/token/revoke") {
        this.log.push({ device, op: "revoke", status: 200 });
        return jsonResponse(200, null);
      }
      throw new Error("FakeDropbox: unhandled endpoint " + endpoint);
    };
  }

  uploads(device) {
    return this.log.filter((e) => e.op === "upload" && (!device || e.device === device));
  }
}

// ---------- In-memory WebDAV (WebDAV W2) ----------
// The same surface as FakeDropbox for the tests (files keyed by the
// path under the sync folder: "/orOS-data.json", "/vault/…"; put();
// log; uploads(); beforeUpload(device, path, arg)) behind the WebDAV
// wire protocol sync.js speaks: GET / HEAD with ETag, PUT with
// If-Match / If-None-Match (refused → 412; logged with Dropbox's 409
// so assertions read the same for both), 409 when the parent folder
// is missing, MKCOL, PROPFIND Depth 0/1, COPY, recursive DELETE, and
// Nextcloud's app-password delete (logged as "revoke").
const DAV_URL = "https://dav.test/remote.php/dav/files/u";
// Bytes as stored; .text for the sync tests, .data for the vault tests.
class DavFile {
  constructor(data, rev) { this.data = data; this.rev = rev; }
  get text() { return this.data.toString("utf8"); }
}
async function davBytes(b) {
  if (b == null) return Buffer.alloc(0);
  if (typeof b === "string") return Buffer.from(b);
  if (b instanceof ArrayBuffer) return Buffer.from(b);
  if (ArrayBuffer.isView(b)) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (typeof b.arrayBuffer === "function") return Buffer.from(await b.arrayBuffer());
  throw new Error("FakeWebDAV: unknown body");
}
const DAV_DIR = "/orOS";

class FakeWebDAV {
  constructor() {
    this.files = new Map();     // "/rel" -> { text, rev }
    this.dirs = new Set([""]);  // "" = the sync folder; "/vault", …
    this.revCounter = 0;
    this.log = [];
    this.beforeUpload = null;
    this.kind = "webdav";
    this.user = "u";
    this.pass = "app-pass";
    // Broken-server switches for the connect probe tests.
    this.ignoreConditions = false;  // If-Match / If-None-Match ignored
    this.weakEtags = false;         // W/"…" ETags
    this.hideEtag = false;          // ETag not readable (CORS without Expose-Headers)
    this.staleEtags = false;        // ETag unchanged by an overwrite (size + whole seconds)
  }

  nextRev() { return (this.weakEtags ? "W/" : "") + '"e' + (++this.revCounter) + '"'; }

  put(p, text) {
    const old = this.files.get(p);
    const rev = (this.staleEtags && old) ? old.rev : this.nextRev();
    this.files.set(p, new DavFile(Buffer.isBuffer(text) ? text : Buffer.from(String(text)), rev));
    const parts = p.split("/").slice(1, -1);
    for (let i = 1; i <= parts.length; i++) this.dirs.add("/" + parts.slice(0, i).join("/"));
    return rev;
  }

  seed(name) {
    return {
      "oros-sync-provider": "webdav",
      "oros-dav-conf": JSON.stringify({ url: DAV_URL, user: this.user, dir: DAV_DIR }),
      "oros-dav-pass": this.pass,
      "oros-sync-cloud-id": "webdav:" + this.user + "@" + DAV_URL + DAV_DIR
    };
  }

  fetchFor(device) {
    return async (url, opts) => {
      opts = opts || {};
      const method = opts.method || "GET";
      const h = opts.headers || {};
      const u = String(url);
      const want = "Basic " + Buffer.from(this.user + ":" + this.pass).toString("base64");
      if (h.Authorization !== want) return textResponse(401, "");
      if (u === "https://dav.test/ocs/v2.php/core/apppassword" && method === "DELETE") {
        this.log.push({ device, op: "revoke", status: 200 });
        return textResponse(200, "");
      }
      if (u.indexOf(DAV_URL) !== 0) throw new TypeError("Failed to fetch");
      let p = decodeURIComponent(u.slice(DAV_URL.length)).replace(/\/+$/, "");
      if (p === DAV_DIR.slice(0, p.length) && p.length < DAV_DIR.length) {      // the account root
        if (method === "PROPFIND") return textResponse(207, this.multistatus(null, ""));
        if (method === "MKCOL") return textResponse(405, "");
      }
      if (p !== DAV_DIR && p.indexOf(DAV_DIR + "/") !== 0) return textResponse(404, "");
      p = p.slice(DAV_DIR.length);                       // "" or "/rel"
      const parent = p.slice(0, p.lastIndexOf("/"));

      if (method === "GET" || method === "HEAD") {
        const f = this.files.get(p);
        this.log.push({ device, op: "download", path: p, status: f ? 200 : 404, head: method === "HEAD" });
        if (!f) return textResponse(404, "");
        return textResponse(200, method === "HEAD" ? "" : f.data, this.hideEtag ? {} : { ETag: f.rev });
      }
      if (method === "PUT") {
        const cur = this.files.get(p);
        const arg = { ifMatch: h["If-Match"], ifNoneMatch: h["If-None-Match"] };
        if (this.beforeUpload) this.beforeUpload(device, p, arg);
        const now = this.files.get(p);
        if (!this.dirs.has(parent)) return textResponse(409, "");
        let refused = false;
        if (this.ignoreConditions) refused = false;
        else if (arg.ifNoneMatch === "*") refused = !!now;
        else if (arg.ifMatch) refused = !now || now.rev !== arg.ifMatch;
        if (refused) {
          this.log.push({ device, op: "upload", path: p, status: 409, http: 412 });
          return textResponse(412, "");
        }
        const rev = this.put(p, await davBytes(opts.body));
        this.log.push({ device, op: "upload", path: p, status: 200, created: !cur });
        return textResponse(cur ? 204 : 201, "", this.hideEtag ? {} : { ETag: rev });
      }
      if (method === "MKCOL") {
        if (this.dirs.has(p) || this.files.has(p)) return textResponse(405, "");
        if (p === "") { this.dirs.add(""); return textResponse(201, ""); }   // the sync folder
        if (!this.dirs.has(parent)) return textResponse(409, "");
        this.dirs.add(p);
        return textResponse(201, "");
      }
      if (method === "PROPFIND") {
        if (!this.dirs.has(p)) {
          const f = this.files.get(p);
          if (!f) return textResponse(404, "");
        }
        return textResponse(207, this.multistatus(p, h.Depth));
      }
      if (method === "COPY") {
        const f = this.files.get(p);
        if (!f) return textResponse(404, "");
        const dest = decodeURIComponent(String(h.Destination).slice(DAV_URL.length + DAV_DIR.length));
        if (h.Overwrite === "F" && this.files.has(dest)) return textResponse(412, "");
        this.put(dest, f.data);
        return textResponse(201, "");
      }
      if (method === "DELETE") {
        let hit = false;
        for (const k of [...this.files.keys()]) {
          if (k === p || k.startsWith(p + "/")) { this.files.delete(k); hit = true; }
        }
        for (const d of [...this.dirs]) {
          if (d && (d === p || d.startsWith(p + "/"))) { this.dirs.delete(d); hit = true; }
        }
        this.log.push({ device, op: "delete", path: p, status: hit ? 204 : 404 });
        return textResponse(hit ? 204 : 404, "");
      }
      throw new Error("FakeWebDAV: unhandled " + method + " " + p);
    };
  }

  // p null = the account root; else "" (the sync folder) or "/rel".
  multistatus(p, depth) {
    const base = "/remote.php/dav/files/u" + DAV_DIR;
    const resp = (href, dir, f) => "<d:response><d:href>" + encodeURI(href) + (dir ? "/" : "") + "</d:href>" +
      "<d:propstat><d:prop><d:resourcetype>" + (dir ? "<d:collection/>" : "") + "</d:resourcetype>" +
      (f ? "<d:getcontentlength>" + f.data.length + "</d:getcontentlength>" +
           "<d:getetag>" + f.rev + "</d:getetag>" : "") +
      "</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>";
    let out = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">';
    if (p === null) out += resp("/remote.php/dav/files/u", true);
    else if (this.files.has(p)) out += resp(base + p, false, this.files.get(p));
    else {
      out += resp(base + p, true);
      if (depth === "1") {
        for (const d of this.dirs) {
          if (d && d.slice(0, d.lastIndexOf("/")) === p) out += resp(base + d, true);
        }
        for (const [k, f] of this.files) {
          if (k.slice(0, k.lastIndexOf("/")) === p) out += resp(base + k, false, f);
        }
      }
    }
    return out + "</d:multistatus>";
  }

  uploads(device) {
    return this.log.filter((e) => e.op === "upload" && (!device || e.device === device));
  }

  downloads(device, prefix) {
    return this.log.filter((e) => e.op === "download" && e.device === device &&
      e.path.startsWith(prefix || "") && e.status === 200 && !e.head).length;
  }
}

function textResponse(status, text, headers) {
  const h = new Map(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => (h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null) },
    text: async () => (Buffer.isBuffer(text) ? text.toString("utf8") : text),
    json: async () => JSON.parse(Buffer.isBuffer(text) ? text.toString("utf8") : text),
    arrayBuffer: async () => {
      const b = Buffer.isBuffer(text) ? text : Buffer.from(typeof text === "string" ? text : "");
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
  };
}
function jsonResponse(status, obj) {
  return textResponse(status, JSON.stringify(obj), { "content-type": "application/json" });
}

// ---------- Browser-ish globals ----------
class MemoryStorage {
  // full = true simulates a localStorage at its quota: any write that
  // would make it bigger (a new key, a longer value) throws the way
  // browsers do. Shrinking writes and removals still work.
  constructor() { this.map = new Map(); this.full = false; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    v = String(v);
    if (this.full && (!this.map.has(k) || v.length > this.map.get(k).length)) {
      const e = new Error("Setting the value of '" + k + "' exceeded the quota.");
      e.name = "QuotaExceededError";
      throw e;
    }
    this.map.set(k, v);
  }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i) { return [...this.map.keys()][i] || null; }
  get length() { return this.map.size; }
}

// ---------- Device ----------
// A booted sync.js instance, already connected (tokens seeded) and
// unlocked (passphrase set), auto interval off. `seed` pre-fills
// localStorage before boot (e.g. a persisted slice registry, which
// makes sync.js hydrate that slice as a closed-app proxy).
// opts0.fetch(realFetch) may wrap the device's fetch (e.g. to answer
// the OAuth token endpoint).
async function createDevice(dropbox, name, seed, opts0) {
  const localStorage = new MemoryStorage();
  const connect = !(opts0 && opts0.connect === false);      // false = nothing connected yet
  if (connect && dropbox.kind !== "webdav") {
    localStorage.setItem("oros-db-access", "token-" + name);
    localStorage.setItem("oros-db-refresh", "refresh-" + name);
    localStorage.setItem("oros-db-expiry", String(Date.now() + 365 * 24 * 3600 * 1000));
  }
  localStorage.setItem("oros-sync-interval", "0");
  if (connect && dropbox.kind === "webdav") {                // WebDAV W2: connected to the fake server
    for (const [k, v] of Object.entries(dropbox.seed(name))) localStorage.setItem(k, v);
  }
  for (const [k, v] of Object.entries(seed || {})) {        // a seed may override the defaults
    localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  }

  const timers = [];
  const consoleLog = [];
  const quiet = (level) => (...a) => consoleLog.push({ level, msg: a.map(String).join(" ") });

  const ctx = {
    localStorage,
    sessionStorage: new MemoryStorage(),
    document: {
      getElementById: () => null,
      addEventListener: () => {},
      visibilityState: "visible"
    },
    navigator: { onLine: true, userAgent: "oros-test/" + name },
    location: { search: "", origin: "https://test.invalid", href: "" },
    history: { replaceState: () => {} },
    crypto: webcrypto,
    fetch: (opts0 && opts0.fetch) ? opts0.fetch(dropbox.fetchFor(name)) : dropbox.fetchFor(name),
    console: { log: quiet("log"), info: quiet("info"), warn: quiet("warn"), error: quiet("error") },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: () => {},
    TextEncoder, TextDecoder, URL, URLSearchParams, Uint8Array, ArrayBuffer, Blob,
    btoa, atob, Promise, JSON, Date, Math, Error, TypeError, Object, Array
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SYNC_SRC, ctx, { filename: "sync.js" });

  const sync = ctx.orosSync;
  await sync.vaultUnlocked;
  sync.setPassphrase(PASSPHRASE, false);
  return { name, sync, localStorage, timers, consoleLog, ctx };
}

// Close every app and restart the tab: same storage, fresh sync.js.
// Slices registered with a storageKey come back as closed-app proxies.
function reboot(dropbox, dev) {
  return createDevice(dropbox, dev.name, Object.fromEntries(dev.localStorage.map));
}

// ---------- Slices ----------
// A live, merge-capable registration backed by the device's
// localStorage — the same shape apps use (get/set/storageKey/merge).
function registerLive(dev, name, mergeFn) {
  const key = "app-" + name;
  dev.sync.registerSlice(
    name,
    () => readKey(dev, key),
    (data) => dev.localStorage.setItem(key, JSON.stringify(data)),
    key,
    mergeFn
  );
}

function readKey(dev, key) {
  const raw = dev.localStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
}
function writeKey(dev, key, value) {
  dev.localStorage.setItem(key, JSON.stringify(value));
}

// A local edit the way an app makes one: write storage, mark dirty.
function edit(dev, name, mutate) {
  const key = "app-" + name;
  const cur = readKey(dev, key);
  const next = mutate(cur === null ? null : JSON.parse(JSON.stringify(cur)));
  writeKey(dev, key, next);
  dev.sync.markDirty();
}

// Record-map merge used by the tests: { items: { id: {v, t, del?} } },
// newest t wins per id, deletions are tombstones (del: true) so a
// delete beats an older edit and survives a merge with a copy that
// still has the item. Deterministic, as the engine requires.
function lwwRecordMerge(local, remote) {
  const out = { items: {} };
  const ids = new Set([
    ...Object.keys((local && local.items) || {}),
    ...Object.keys((remote && remote.items) || {})
  ]);
  for (const id of [...ids].sort()) {
    const a = local.items && local.items[id];
    const b = remote.items && remote.items[id];
    if (!a) out.items[id] = b;
    else if (!b) out.items[id] = a;
    else if (a.t !== b.t) out.items[id] = a.t > b.t ? a : b;
    else out.items[id] = JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  return out;
}

// Decrypt the cloud blob with the test passphrase (via a device's
// own decryptJson, so the format is whatever sync.js writes).
async function cloudPayload(dropbox, dev) {
  const f = dropbox.files.get("/orOS-data.json");
  if (!f) return null;
  return dev.sync.vaultCrypto.decryptJson(f.text);
}

// OROS_CLOUD=webdav runs every harness test against FakeWebDAV
// (tests/sync-webdav.test.js does that for the sync suites).
const FakeCloud = process.env.OROS_CLOUD === "webdav" ? FakeWebDAV : FakeDropbox;

module.exports = {
  FakeDropbox: FakeCloud, FakeWebDAV, RealFakeDropbox: FakeDropbox, createDevice, reboot, registerLive, readKey, writeKey, edit,
  lwwRecordMerge, cloudPayload
};
