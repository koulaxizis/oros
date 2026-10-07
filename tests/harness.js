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
        this.files.delete(args.path);
        return jsonResponse(200, {});
      }
      throw new Error("FakeDropbox: unhandled endpoint " + endpoint);
    };
  }

  uploads(device) {
    return this.log.filter((e) => e.op === "upload" && (!device || e.device === device));
  }
}

function textResponse(status, text, headers) {
  const h = new Map(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => (h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null) },
    text: async () => text,
    json: async () => JSON.parse(text)
  };
}
function jsonResponse(status, obj) {
  return textResponse(status, JSON.stringify(obj), { "content-type": "application/json" });
}

// ---------- Browser-ish globals ----------
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
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
async function createDevice(dropbox, name, seed) {
  const localStorage = new MemoryStorage();
  for (const [k, v] of Object.entries(seed || {})) {
    localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  localStorage.setItem("oros-db-access", "token-" + name);
  localStorage.setItem("oros-db-refresh", "refresh-" + name);
  localStorage.setItem("oros-db-expiry", String(Date.now() + 365 * 24 * 3600 * 1000));
  localStorage.setItem("oros-sync-interval", "0");

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
    fetch: dropbox.fetchFor(name),
    console: { log: quiet("log"), info: quiet("info"), warn: quiet("warn"), error: quiet("error") },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: () => {},
    TextEncoder, TextDecoder, URLSearchParams, Uint8Array, ArrayBuffer,
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

module.exports = {
  FakeDropbox, createDevice, reboot, registerLive, readKey, writeKey, edit,
  lwwRecordMerge, cloudPayload
};
