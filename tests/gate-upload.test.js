// GATE-FILES F2 (2026-11-14): the sealed copy of Claude's folders. The
// device side (gate/filecopy.js) seals pieces exactly as the relay
// (relay/gate.js openPiece) opens them; files_list / files_read answer
// from the sealed index with orOS closed; files_link gives one download
// of 15 minutes; a device can drop the copy at once.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const CF = require("../assistant/claudefiles.js");
let handle, G;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  G = await import("../relay/gate.js");
});

const ORIGIN = "https://useoros.online";
const BASE = "https://relay.example";
const ID = "GaTeBoX0123456789_-abc";
const TOK = "T".repeat(43);
const CB = "https://claude.ai/api/mcp/auth_callback";
const hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const VERIFIER = "v".repeat(50);
const CHALLENGE = b64u(crypto.createHash("sha256").update(VERIFIER).digest());

function fakeStorage() {
  const kv = new Map();
  return { kv, storage: {
    get: async (k) => (kv.has(k) ? JSON.parse(JSON.stringify(kv.get(k))) : undefined),
    put: async (k, v) => { kv.set(k, JSON.parse(JSON.stringify(v))); },
    delete: async (k) => { (Array.isArray(k) ? k : [k]).forEach((x) => kv.delete(x)); },
    list: async (o) => { const m = new Map(); kv.forEach((v, k) => { if (!o || !o.prefix || k.indexOf(o.prefix) === 0) m.set(k, v); }); return m; },
    setAlarm: async () => {}, deleteAlarm: async () => {}, deleteAll: async () => { kv.clear(); }
  } };
}
function world() {
  const boxes = new Map();
  const env = { ALLOWED_ORIGINS: ORIGIN };
  env.GATE = {
    idFromName: (n) => n,
    get(id) {
      if (!boxes.has(id)) {
        const st = fakeStorage(), socks = [];
        const state = { storage: st.storage, getWebSockets: () => socks.filter((s) => !s.closed), getWebSocketAutoResponseTimestamp: () => new Date(8.64e15) };
        boxes.set(id, { st, socks, box: new G.GateBox(state, env) });
      }
      const b = boxes.get(id);
      return { fetch: (r) => b.box.fetch(r) };
    }
  };
  return { env, boxes };
}
let ipn = 0;
function call(w, method, path, opts) {
  opts = opts || {};
  const h = Object.assign({ "CF-Connecting-IP": "10.3.0." + (++ipn % 250) }, opts.headers || {});
  if (opts.origin) h.Origin = opts.origin;
  if (opts.bearer) h.Authorization = "Bearer " + opts.bearer;
  let body = opts.body;
  if (opts.json) { body = JSON.stringify(opts.json); h["Content-Type"] = "application/json"; }
  if (opts.form) { body = new URLSearchParams(opts.form).toString(); h["Content-Type"] = "application/x-www-form-urlencoded"; }
  return handle(new Request(BASE + path, { method, headers: h, body, redirect: "manual" }), w.env, null, opts.now || Date.now());
}
const dev = (w, json) => call(w, "POST", "/gate/dev", { origin: ORIGIN, json: Object.assign({ id: ID }, json) });
async function tokens(w) {
  const r = await dev(w, { act: "code", tok: TOK, c: CHALLENGE, r: CB });
  const code = ID + "." + (await r.json()).data.code;
  return (await call(w, "POST", "/gate/token", { form: { grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: CB } })).json();
}

// A fake Dropbox: link → sealed bytes

function closedGate() {
  return (async () => {
    const w = world();
    assert.equal((await dev(w, { act: "new", th: hex(TOK) })).status, 200);
    const b = w.boxes.get(ID);
    const K = crypto.randomBytes(32), KS = b64u(K);
    const sock = { sent: [], closed: false, __g: { th: hex(TOK), v: 1, at: 1 }, send(x) { this.sent.push(x); const q = JSON.parse(x); if (q.q && q.n === "_key") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: KS })), 1); }, close() {} };
    b.socks.push(sock);
    const t = await tokens(w);
    sock.closed = true;                                        // orOS closes
    await b.st.storage.put("devtools", [{ name: "files_write", description: "x", inputSchema: { type: "object" }, annotations: { readOnlyHint: false, destructiveHint: true } }]);
    const tc = async (name, args) => { const j = await (await call(w, "POST", "/mcp", { bearer: t.access_token, json: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } } })).json(); return j.result; };
    return { w, b, K, tc };
  })();
}
const put = (w, path, tok, bytes) => call(w, "PUT", path, { headers: { Authorization: "Bearer " + tok, "Content-Length": String(bytes.length) }, body: bytes });

test("GL-8: files_upload with orOS closed → one PUT, sealed in pieces, a device opens them with K", async () => {
  const { w, b, K, tc } = await closedGate();
  const bytes = crypto.randomBytes(200000);
  let r = await tc("files_upload", { name: "kolaz-1.jpg", size: bytes.length, sha256: hex(bytes) });
  assert.equal(r.isError, false, r.content[0].text);
  const o = JSON.parse(r.content[0].text);
  assert.match(o.url, /^https:\/\/relay\.example\/gate\/up\/GaTeBoX0123456789_-abc\/[A-Za-z0-9_-]{22}$/);
  const tok = o.authorization.slice(7), path = new URL(o.url).pathname;
  assert.equal((await tc("files_write", { path: "Drive/pc/Book/kolaz-1.jpg", upload: o.upload })).content[0].text.indexOf("no file yet") > 0, true, "not before its PUT");
  assert.equal((await put(w, path, "x".repeat(43), bytes)).status, 404, "another token");
  assert.equal((await put(w, path, tok, bytes.subarray(1))).status, 400, "a short file");
  const ok = await put(w, path, tok, bytes);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).pieces, 3);
  assert.equal((await put(w, path, tok, bytes)).status, 409, "once");
  const row = b.st.kv.get("up:" + o.upload);
  assert.equal(row.w, undefined, "the wrapped key is gone after the PUT");
  // the device's side: dev "up" pieces → FK from K → the same bytes
  const d = (await (await dev(w, { act: "up", tok: TOK, up: o.upload, from: 0 })).json()).data;
  assert.equal(d.n, 3);
  assert.equal(d.h, hex(bytes));
  const fk = await crypto.subtle.importKey("raw", await G.upKeyRaw(K, o.upload), { name: "AES-GCM" }, false, ["decrypt"]);
  const un = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const parts = [];
  for (let i = 0; i < d.p.length; i++) {
    const [iv, ct] = d.p[i].split(".");
    parts.push(Buffer.from(await crypto.subtle.decrypt({ name: "AES-GCM", iv: un(iv), additionalData: Buffer.from("orOS-gate-up|" + o.upload + "|" + i) }, fk, un(ct))));
  }
  assert.ok(Buffer.concat(parts).equals(bytes));
  const [iv1, ct1] = d.p[1].split(".");
  await assert.rejects(crypto.subtle.decrypt({ name: "AES-GCM", iv: un(iv1), additionalData: Buffer.from("orOS-gate-up|" + o.upload + "|0") }, fk, un(ct1)), "a piece opens only as itself");
  assert.equal((await dev(w, { act: "up", tok: TOK, up: o.upload, from: 0, del: true })).status, 200);
  assert.ok(![...b.st.kv.keys()].some((k) => k.indexOf(o.upload) >= 0), "dropped after the write");
  assert.equal((await dev(w, { act: "up", tok: TOK, up: o.upload, from: 0 })).status, 404);
});

test("GL-8: files_upload refuses a wrong size, a wrong checksum and an unknown upload", async () => {
  const { w, tc } = await closedGate();
  assert.equal((await tc("files_upload", { size: 26 * 1048576, sha256: "0".repeat(64) })).isError, true);
  assert.equal((await tc("files_upload", { size: 10, sha256: "nope" })).isError, true);
  const bytes = Buffer.from("0123456789");
  const o = JSON.parse((await tc("files_upload", { size: 10, sha256: hex("other") })).content[0].text);
  const r = await put(w, new URL(o.url).pathname, o.authorization.slice(7), bytes);
  assert.equal(r.status, 400);
  assert.match(await r.text(), /SHA-256/);
  assert.match((await tc("files_write", { path: "A/x.jpg", upload: "Q".repeat(22) })).content[0].text, /unknown or has expired/);
  assert.equal((await call(w, "GET", new URL(o.url).pathname)).status, 405);
});

test("GL-8: Claude's folders write an uploaded file as a new file, never over one", async () => {
  const blob = new Blob([Buffer.from("JPEGDATA")]);
  const F = ["/internal/Drive/pc/Book"];
  let r = CF.planWrite({ path: "Drive/pc/Book/kolaz-1.jpg", blob }, { st: null, v: "" }, F, 1);
  assert.equal(r.ok, true);
  assert.equal(r.step.blob, blob);
  assert.equal(CF.planWrite({ path: "Drive/pc/Book/kolaz-1.jpg", blob, mode: "replace" }, { st: null }, F, 1).ok, false);
  assert.equal(CF.planWrite({ path: "Drive/pc/Book/kolaz-1.jpg", blob }, { st: { size: 3 }, v: "ab" }, F, 1).ok, false);
  assert.equal(CF.planWrite({ path: "Drive/pc/Other/x.jpg", blob }, { st: null }, F, 1).ok, false, "outside Claude's folders");
  const disk = new Map();
  const fs = { stat: async (p) => (disk.has(p) ? { size: disk.get(p).size, mtime: 1 } : null), write: async (p, b) => { disk.set(p, b); }, writeText: async () => { throw new Error("text"); }, mkdir: async () => {}, mv: async () => {}, rm: async () => {}, ls: async () => [] };
  const out = await CF.run(fs, [r.step], async () => "v1");
  assert.equal(out.fail, "");
  assert.equal(disk.get("/internal/Drive/pc/Book/kolaz-1.jpg"), blob);
});

test("GL-8: the device fetches, checks and drops an upload; files_write takes upload instead of text", () => {
  const fsr = require("fs"), pth = require("path");
  const g = fsr.readFileSync(pth.join(__dirname, "..", "gate/gate.js"), "utf8");
  assert.match(g, /var upId = name === "files_write" && typeof args\.upload === "string" \? args\.upload : "";/);
  assert.match(g, /if \(hex !== head\.h\) throw new Error\("checksum"\);/);
  assert.match(g, /if \(upId && r && r\.ok\) upDrop\(upId\);/);
  const core = fsr.readFileSync(pth.join(__dirname, "..", "assistant/core.js"), "utf8");
  assert.match(core, /upload: \{ type: "string", description: "Through orOS Gate, instead of text/);
});
