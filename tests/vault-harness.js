// Test harness for vault.js (Vault Drive) — no build step.
//
// Each device is a vm context running the real sync.js and vault.js,
// with an in-memory localStorage, an in-memory orosFS (the disk) and a
// fetch() that talks to ONE shared in-memory Dropbox holding binary
// files. Timers are captured, never fired: every sync in a test
// happens because the test asked for it.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");

const SYNC_SRC = fs.readFileSync(path.join(__dirname, "..", "sync.js"), "utf8");
const VAULT_SRC = fs.readFileSync(path.join(__dirname, "..", "vault.js"), "utf8");
const PASSPHRASE = "test-passphrase";

function response(status, body, headers) {
  const h = new Map(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => (h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null) },
    text: async () => buf.toString("utf8"),
    json: async () => JSON.parse(buf.toString("utf8")),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)
  };
}

async function bodyBytes(b) {
  if (b == null) return Buffer.alloc(0);
  if (typeof b === "string") return Buffer.from(b);
  if (b instanceof ArrayBuffer) return Buffer.from(b);
  if (ArrayBuffer.isView(b)) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (typeof b.arrayBuffer === "function") return Buffer.from(await b.arrayBuffer());
  throw new Error("unknown body");
}

// ---------- In-memory Dropbox (binary) ----------
class BinDropbox {
  constructor() { this.files = new Map(); this.rev = 0; this.log = []; }
  fetchFor(device) {
    return async (url, opts) => {
      opts = opts || {};
      const headers = opts.headers || {};
      const ep = String(url).replace(/^https:\/\/[^/]+\/2\//, "");
      const arg = headers["Dropbox-API-Arg"] ? JSON.parse(headers["Dropbox-API-Arg"]) : null;
      if (ep === "files/download") {
        const f = this.files.get(arg.path);
        this.log.push({ device, op: "download", path: arg.path });
        if (!f) return response(409, { error_summary: "path/not_found/" });
        return response(200, f.data, { "dropbox-api-result": JSON.stringify({ rev: f.rev }) });
      }
      if (ep === "files/upload") {
        const cur = this.files.get(arg.path), mode = arg.mode;
        let conflict = false;
        if (mode === "add") conflict = !!cur;
        else if (mode && mode[".tag"] === "update") conflict = !cur || cur.rev !== mode.update;
        if (conflict) return response(409, { error_summary: "path/conflict/file/.." });
        const rev = "r" + (++this.rev);
        this.files.set(arg.path, { data: await bodyBytes(opts.body), rev });
        this.log.push({ device, op: "upload", path: arg.path });
        return response(200, { rev });
      }
      const args = opts.body ? JSON.parse(opts.body) : {};
      if (ep === "files/get_metadata") {
        const f = this.files.get(args.path);
        if (!f) return response(409, { error_summary: "path/not_found/" });
        return response(200, { rev: f.rev });
      }
      if (ep === "files/delete_v2") { this.files.delete(args.path); return response(200, {}); }
      if (ep === "files/list_folder") {
        return response(200, { entries: [...this.files.keys()].map((p) => ({ path_lower: p.toLowerCase() })), has_more: false });
      }
      return response(409, { error_summary: "unhandled/" + ep });
    };
  }
  downloads(device, prefix) {
    return this.log.filter((e) => e.op === "download" && e.device === device && e.path.startsWith(prefix || "")).length;
  }
}

// ---------- In-memory disk (the orosFS surface vault.js uses) ----------
function memoryDisk(ctx) {
  const disk = new Map();   // path -> Blob
  function enoent(p) { const e = new Error("ENOENT " + p); e.code = "ENOENT"; return e; }
  function isDir(p) { const pre = p + "/"; for (const k of disk.keys()) if (k.startsWith(pre)) return true; return false; }
  // Like fs.js: every write / removal is reported to the vault.
  function vault() { return ctx.orosVault; }
  return {
    disk,
    ready: async () => {},
    stat: async (p) => {
      if (disk.has(p)) return { dir: false, size: disk.get(p).size };
      if (p === "/internal" || isDir(p)) return { dir: true, size: 0 };
      throw enoent(p);
    },
    ls: async (p) => {
      const pre = p + "/", seen = new Map();
      for (const k of disk.keys()) {
        if (!k.startsWith(pre)) continue;
        const rest = k.slice(pre.length), i = rest.indexOf("/");
        seen.set(i < 0 ? rest : rest.slice(0, i), i >= 0);
      }
      if (!seen.size && p !== "/internal") throw enoent(p);
      return [...seen].map(([name, dir]) => ({ name, dir }));
    },
    read: async (p) => {
      if (disk.has(p)) return disk.get(p);
      if (isDir(p)) { const e = new Error("EISDIR"); e.code = "EISDIR"; throw e; }
      throw enoent(p);
    },
    write: async (p, blob) => { disk.set(p, blob); if (vault()) vault().fileChanged(p); },
    rm: async (p) => { if (!disk.delete(p)) throw enoent(p); if (vault()) vault().touchTree(p); }
  };
}

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  key(i) { return [...this.map.keys()][i] || null; }
  get length() { return this.map.size; }
}

async function vaultDevice(dropbox, name) {
  const localStorage = new MemoryStorage();
  if (dropbox.kind === "webdav") {
    for (const [k, v] of Object.entries(dropbox.seed(name))) localStorage.setItem(k, v);
  } else {
    localStorage.setItem("oros-db-access", "token-" + name);
    localStorage.setItem("oros-db-refresh", "refresh-" + name);
    localStorage.setItem("oros-db-expiry", String(Date.now() + 864e5));
  }
  localStorage.setItem("oros-sync-interval", "0");
  const noop = () => {};
  const timers = [];
  const ctx = {
    localStorage, sessionStorage: new MemoryStorage(),
    document: { getElementById: () => null, addEventListener: noop, visibilityState: "visible" },
    navigator: { onLine: true, userAgent: "oros-test/" + name },
    location: { search: "", origin: "https://test.invalid", href: "" },
    history: { replaceState: noop },
    crypto: webcrypto,
    fetch: dropbox.fetchFor(name),
    console: { log: noop, info: noop, warn: noop, error: noop },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
    addEventListener: noop,
    TextEncoder, TextDecoder, URL, URLSearchParams, Uint8Array, ArrayBuffer, Blob,
    btoa, atob, Promise, JSON, Date, Math, Error, TypeError, Object, Array
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SYNC_SRC, ctx, { filename: "sync.js" });
  await ctx.orosSync.vaultUnlocked;
  ctx.orosSync.setPassphrase(PASSPHRASE, false);
  const fsApi = memoryDisk(ctx);
  ctx.orosFS = fsApi;
  vm.runInContext(VAULT_SRC, ctx, { filename: "vault.js" });
  const dev = {
    name, ctx, localStorage, timers,
    vault: ctx.orosVault,
    disk: fsApi.disk,
    write: (p, text) => fsApi.write(p, new Blob([text])),
    rm: (p) => fsApi.rm(p),
    read: async (p) => (fsApi.disk.has(p) ? Buffer.from(await fsApi.disk.get(p).arrayBuffer()).toString("utf8") : null),
    sync: () => ctx.orosVault.sync("test")
  };
  return dev;
}

// The cloud manifest as a device with the passphrase reads it.
async function cloudPaths(dev) {
  const st = dev.ctx.orosSync.storage;
  // A fresh device keeps nothing locally: ask the vault on the device
  // itself through a throwaway sync-free read.
  const buf = await st.getObject("manifest.json");
  if (!buf) return [];
  const keyBuf = await st.getObject("key.json");
  const doc = JSON.parse(Buffer.from(keyBuf).toString("utf8"));
  const sealed = await dev.ctx.orosSync.vaultCrypto.decryptJson(doc.wraps[0]);
  const raw = Buffer.from(sealed.k, "base64");
  const enc = webcrypto.subtle.digest("SHA-256", Buffer.concat([Buffer.from("orOS-vault-enc:"), raw]));
  const key = await webcrypto.subtle.importKey("raw", await enc, { name: "AES-GCM" }, false, ["decrypt"]);
  const env = new Uint8Array(buf);
  const plain = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: env.slice(1, 13) }, key, env.slice(13));
  return Object.keys(JSON.parse(Buffer.from(plain).toString("utf8")).files).sort();
}

// OROS_CLOUD=webdav: the same tests against the WebDAV provider.
const BinCloud = process.env.OROS_CLOUD === "webdav" ? require("./harness").FakeWebDAV : BinDropbox;

module.exports = { BinDropbox: BinCloud, vaultDevice, cloudPaths };
