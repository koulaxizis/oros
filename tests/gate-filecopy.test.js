// GATE-FILES F2 (2026-11-14): the sealed copy of Claude's folders. The
// device side (gate/filecopy.js) seals pieces exactly as the relay
// (relay/gate.js openPiece) opens them; files_list / files_read answer
// from the sealed index with orOS closed; files_link gives one download
// of 15 minutes; a device can drop the copy at once.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const FC = require("../gate/filecopy.js");
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
  const h = Object.assign({ "CF-Connecting-IP": "10.2.0." + (++ipn % 250) }, opts.headers || {});
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
function dropbox() {
  const m = new Map();
  let n = 0;
  return {
    m,
    put(bytes) { const u = "https://dl.dropboxusercontent.com/scl/fi/p" + (++n) + "/x?rlkey=k" + n; m.set(u, Buffer.from(bytes)); return u; },
    fetch: async (u) => (m.has(u) ? new Response(m.get(u)) : new Response("no", { status: 404 }))
  };
}
async function sealedParts(K, h, part, bytes, D) {
  const links = [];
  for (let i = 0; i < FC.count(bytes.length); i++) links.push(D.put(await FC.seal(K, h, part, i, bytes.slice(i * FC.PIECE, (i + 1) * FC.PIECE))));
  return links;
}

test("a piece sealed on the device opens on the relay, and only as itself", async () => {
  const K = crypto.randomBytes(32), h = hex("hello");
  const s = await FC.seal(K, h, "c", 0, Buffer.from("hello"));
  assert.equal(Buffer.from(await G.openPiece(K, h, "c", 0, s)).toString(), "hello");
  await assert.rejects(G.openPiece(K, h, "c", 1, s), "another piece number fails");
  await assert.rejects(G.openPiece(K, h, "t", 0, s), "another part fails");
  await assert.rejects(G.openPiece(K, hex("other"), "c", 0, s), "another file fails");
  await assert.rejects(G.openPiece(crypto.randomBytes(32), h, "c", 0, s), "another gate key fails");
  assert.match(await FC.pieceName(K, h, "c", 0), /^[0-9a-f]{32}$/);
  assert.equal(await FC.pieceName(K, h, "c", 0), await FC.pieceName(K, h, "c", 0), "the same content has the same name (stored once)");
  assert.notEqual(await FC.pieceName(K, h, "c", 0), await FC.pieceName(K, h, "c", 1));
  await assert.rejects(G.fetchPiece("https://evil.example/x"), /bad-link/, "only Dropbox's download host");
});

test("the plan keeps text first, leaves media and big files out, and holds the quota", () => {
  const MB = 1 << 20;
  const rows = [
    { p: "/internal/A/notes.txt", s: 10, kind: "text" },
    { p: "/internal/A/book.pdf", s: 48 * MB, kind: "pdf" },
    { p: "/internal/A/huge.pdf", s: 60 * MB, kind: "pdf" },
    { p: "/internal/A/song.wav", s: 5 * MB, kind: "media" },
    { p: "/internal/A/photo.jpg", s: 3 * MB, kind: "image" },
    { p: "/internal/A/scan.docx", s: 1 * MB, kind: "document" }
  ];
  let pl = FC.plan(rows, 250 * MB);
  assert.deepEqual(pl.take["/internal/A/notes.txt"], { c: true, t: false });
  assert.deepEqual(pl.take["/internal/A/book.pdf"], { c: true, t: true });
  assert.equal(pl.out["/internal/A/huge.pdf"], "big");
  assert.equal(pl.out["/internal/A/song.wav"], "media");
  assert.ok(pl.take["/internal/A/photo.jpg"]);
  pl = FC.plan(rows, 50 * MB);
  assert.ok(pl.take["/internal/A/notes.txt"] && pl.take["/internal/A/scan.docx"], "text and documents first");
  assert.equal(pl.out["/internal/A/book.pdf"], "quota", "the big PDF leaves before the small ones");
  assert.ok(pl.used <= 50 * MB);
  assert.equal(FC.quotaOf(0), 250 * MB);
  assert.equal(FC.quotaOf(1), 250 * MB, "under 50 MB is not a quota");
});

test("orOS closed: files_list and files_read from the sealed index, files_link once, then drop", async () => {
  const w = world();
  assert.equal((await dev(w, { act: "new", th: hex(TOK) })).status, 200);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32), KS = b64u(K);
  const sock = { sent: [], closed: false, __g: { th: hex(TOK), v: 1, at: 1 }, send(x) { this.sent.push(x); const q = JSON.parse(x); if (q.q && q.n === "_key") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: KS })), 1); }, close() {} };
  b.socks.push(sock);
  const t = await tokens(w);
  const D = dropbox();
  b.box.fetchFn = D.fetch;
  global.__realFetch = global.fetch;
  const F = "/internal/Drive/pc/Invoices";
  const pdfBytes = Buffer.from("%PDF-1.4 fake"), pdfH = hex(pdfBytes), pdfText = "Invoice 42\nTotal 100 EUR";
  const noteBytes = Buffer.from("x".repeat(150000)), noteH = hex(noteBytes);
  const idx = { v: 1, at: 1.7e12, f: [F], q: FC.QUOTA_DEF, used: 10, files: [
    { p: F + "/2026/inv-42.pdf", s: pdfBytes.length, m: 1.7e12, k: "pdf", v: pdfH.slice(0, 16), h: pdfH,
      c: await sealedParts(K, pdfH, "c", pdfBytes, D), t: await sealedParts(K, pdfH, "t", Buffer.from(pdfText), D) },
    { p: F + "/notes.txt", s: noteBytes.length, m: 1.7e12, k: "text", v: noteH.slice(0, 16), h: noteH, c: await sealedParts(K, noteH, "c", noteBytes, D) },
    { p: F + "/master.wav", s: 6e8, m: 1.7e12, k: "media", v: "0123456789abcdef", x: "media" }
  ] };
  await b.box.webSocketMessage(sock, JSON.stringify({ fidx: await G.sealText(K, JSON.stringify(idx)) }));
  assert.match(sock.sent[sock.sent.length - 1], /fidxok/);
  assert.doesNotMatch(JSON.stringify([...b.st.kv.entries()]), /inv-42|dropboxusercontent/, "the index is stored sealed");
  sock.closed = true;                                          // orOS closes
  const tc = async (name, args) => (await (await call(w, "POST", "/mcp", { bearer: t.access_token, json: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } } })).json()).result;
  // files_list and files_read are the device's tools: the box knows them from its last tool list
  await b.st.storage.put("devtools", [
    { name: "files_list", description: "x", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    { name: "files_read", description: "x", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    { name: "files_write", description: "x", inputSchema: { type: "object" }, annotations: { readOnlyHint: false, destructiveHint: true } }
  ]);
  let r = await tc("files_list");
  assert.equal(r.isError, false);
  assert.deepEqual(JSON.parse(r.content[0].text).folders, ["Drive/pc/Invoices"]);
  r = JSON.parse((await tc("files_list", { path: "Drive/pc/Invoices", depth: 2 })).content[0].text);
  assert.deepEqual(r.entries.map((e) => e.name), ["2026", "2026/inv-42.pdf", "master.wav", "notes.txt"]);
  assert.equal(r.entries.find((e) => e.name === "master.wav").not_in_copy, "media");
  assert.equal(r.entries.find((e) => e.name === "notes.txt").version, noteH.slice(0, 16));
  assert.equal((await tc("files_list", { path: "Drive/pc/Other" })).isError, true, "outside Claude's folders");
  r = await tc("files_read", { path: F + "/2026/inv-42.pdf" });
  assert.equal(r.isError, false);
  let o = JSON.parse(r.content[0].text.split("\n").slice(1).join("\n"));
  assert.equal(o.text, pdfText, "a PDF answers with its text sidecar");
  r = JSON.parse((await tc("files_read", { path: "Drive/pc/Invoices/notes.txt", offset: 100000 })).content[0].text.split("\n").slice(1).join("\n"));
  assert.equal(r.text.length, 50000);
  assert.equal(r.total, 150000);
  assert.equal(r.next_offset, null);
  r = JSON.parse((await tc("files_read", { path: F + "/master.wav" })).content[0].text.split("\n").slice(1).join("\n"));
  assert.equal(r.text, undefined);
  assert.match(r.note, /not in the copy/);
  const wr = await tc("files_write", { path: F + "/a.txt", text: "x" });
  assert.equal(wr.isError, true, "Files is not «May change» in this index: " + wr.content[0].text);
  assert.match(wr.content[0].text, /may not change files/);
  // a tampered piece is refused
  const first = idx.files[1].c[0], keep = D.m.get(first);
  D.m.set(first, Buffer.from(keep).fill(1, 20, 30));
  assert.match((await tc("files_read", { path: F + "/notes.txt" })).content[0].text, /did not pass the check|could not be read/);
  D.m.set(first, keep);
  // files_link: one download within 15 minutes
  r = await tc("files_link", { path: F + "/2026/inv-42.pdf" });
  assert.equal(r.isError, false);
  o = JSON.parse(r.content[0].text);
  assert.match(o.url, /^https:\/\/relay\.example\/gate\/f\/GaTeBoX0123456789_-abc\/[A-Za-z0-9_-]{43}$/);
  assert.equal(o.size, pdfBytes.length);
  const path = new URL(o.url).pathname;
  // opening the link (a preview, a mail scanner) only shows the button
  let dl = await call(w, "GET", path);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get("Content-Type"), /text\/html/);
  assert.match(await dl.text(), /<form method="post">/);
  assert.equal((await call(w, "HEAD", path)).status, 200);
  dl = await call(w, "POST", path);
  assert.equal(dl.status, 200);
  assert.equal(Buffer.from(await dl.arrayBuffer()).toString(), pdfBytes.toString());
  assert.match(dl.headers.get("Content-Disposition"), /inv-42\.pdf/);
  dl = await call(w, "POST", path);
  assert.equal(dl.status, 410, "one download only");
  assert.equal((await tc("files_link", { path: F + "/master.wav" })).isError, true, "a file not in the copy has no link");
  assert.doesNotMatch(JSON.stringify([...b.st.kv.entries()]), new RegExp(KS), "the gate key is never stored as it is");
  // an expired link
  o = JSON.parse((await tc("files_link", { path: F + "/notes.txt" })).content[0].text);
  const lk = [...(await b.st.storage.list({ prefix: "lk:" })).keys()][0];
  const row = await b.st.storage.get(lk); row.exp = 1; await b.st.storage.put(lk, row);
  assert.equal((await call(w, "POST", new URL(o.url).pathname)).status, 410);
  // the device drops the copy (Sensitive work, the owner)
  sock.closed = false;
  await b.box.webSocketMessage(sock, JSON.stringify({ fdrop: 1 }));
  assert.match(sock.sent[sock.sent.length - 1], /fdropok/);
  assert.equal(await b.st.storage.get("fidx"), undefined);
  assert.equal((await b.st.storage.list({ prefix: "x:" })).size, 0);
  sock.closed = true;
  assert.match((await tc("files_list")).content[0].text, /no copy of Claude's folders/);
});

test("a stranger's socket cannot replace or drop the index", async () => {
  const w = world();
  await dev(w, { act: "new", th: hex(TOK) });
  const b = w.boxes.get(ID);
  const odd = { sent: [], __g: { th: hex("x"), v: 1, at: 1 }, send(x) { this.sent.push(x); }, close() {} };
  await b.box.webSocketMessage(odd, JSON.stringify({ fidx: "aaaa.bbbb" }));
  assert.equal(await b.st.storage.get("fidx"), undefined);
  await b.box.webSocketMessage(odd, JSON.stringify({ fdrop: 1 }));
  assert.equal(odd.sent.length, 0);
});

test("F3: orOS closed: files_write / move / delete are checked against the index and wait in the queue", async () => {
  const w = world();
  assert.equal((await dev(w, { act: "new", th: hex(TOK) })).status, 200);
  const b = w.boxes.get(ID);
  const K = crypto.randomBytes(32), KS = b64u(K);
  const sock = { sent: [], closed: false, __g: { th: hex(TOK), v: 1, at: 1 }, send(x) { this.sent.push(x); const q = JSON.parse(x); if (q.q && q.n === "_key") setTimeout(() => b.box.webSocketMessage(sock, JSON.stringify({ r: q.q, ok: true, c: KS })), 1); }, close() {} };
  b.socks.push(sock);
  const t = await tokens(w);
  const F = "/internal/Drive/pc/Manuscripts";
  const V = "0123456789abcdef";
  const idx = { v: 1, at: 1.7e12, f: [F], q: FC.QUOTA_DEF, used: 0, w: 1, files: [
    { p: F + "/book.txt", s: 10, m: 1.7e12, k: "text", v: V, x: "quota" },
    { p: F + "/old/draft.txt", s: 10, m: 1.7e12, k: "text", v: "fedcba9876543210", x: "quota" }
  ] };
  const putIdx = async (o) => { sock.closed = false; await b.box.webSocketMessage(sock, JSON.stringify({ fidx: await G.sealText(K, JSON.stringify(o)) })); sock.closed = true; };
  await putIdx(idx);
  const tc = async (name, args) => (await (await call(w, "POST", "/mcp", { bearer: t.access_token, json: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } } })).json()).result;
  await b.st.storage.put("devtools", ["files_list", "files_read", "files_write", "files_move", "files_delete"].map((n) => ({ name: n, description: "x", inputSchema: { type: "object" }, annotations: { readOnlyHint: /list|read/.test(n) } })));
  const queued = async () => [...(await b.st.storage.list({ prefix: "q:" })).values()];
  const bad = async (name, args, re) => { const r = await tc(name, args); assert.equal(r.isError, true, name + " " + JSON.stringify(args)); if (re) assert.match(r.content[0].text, re); };
  // refused before anything waits
  await bad("files_write", { path: "Drive/pc/Other/a.txt", text: "x" }, /outside the folders/);
  await bad("files_write", { path: F, text: "x" }, /Claude's folders itself/);
  await bad("files_write", { path: F + "/book.txt", text: "x" }, /already exists/);
  await bad("files_write", { path: F + "/old", text: "x" }, /already exists/);
  await bad("files_write", { path: F + "/book.txt", text: "x", mode: "replace", if_version: "aaaaaaaaaaaaaaaa" }, /Read it again/);
  await bad("files_write", { path: F + "/book.txt", text: "x", mode: "replace" }, /if_version/);
  await bad("files_move", { from: F + "/book.txt", to: F + "/old/draft.txt", if_version: V }, /already exists/);
  await bad("files_delete", { paths: [{ path: F + "/book.txt", if_version: V }, { path: F + "/gone.txt", if_version: V }] }, /not in the copy/);
  await bad("files_delete", { paths: [] });
  assert.equal((await queued()).length, 0, "nothing waits after a refusal");
  // accepted: they wait, sealed
  let r = await tc("files_write", { path: F + "/ch-12.txt", text: "Κεφάλαιο 12" });
  assert.equal(r.isError, false, r.content[0].text);
  assert.match(JSON.parse(r.content[0].text).note, /conflict copy/);
  r = await tc("files_write", { path: "Drive/pc/Manuscripts/book.txt", text: "new", mode: "replace", if_version: V.toUpperCase() });
  assert.equal(r.isError, false, r.content[0].text);
  r = await tc("files_move", { from: F + "/book.txt", to: F + "/old/book.txt", if_version: V });
  assert.equal(r.isError, false, r.content[0].text);
  r = await tc("files_delete", { paths: [{ path: F + "/old/draft.txt", if_version: "fedcba9876543210" }] });
  assert.equal(r.isError, false, r.content[0].text);
  assert.match(JSON.parse(r.content[0].text).note, /taps Delete on the device/);
  const q = await queued();
  assert.equal(q.length, 4);
  assert.doesNotMatch(JSON.stringify(q), /Κεφάλαιο|ch-12|draft/, "queued changes are sealed");
  const names = [];
  for (const row of q) names.push(JSON.parse(await G.openText(K, row.c)).n);
  assert.deepEqual(names.sort(), ["files_delete", "files_move", "files_write", "files_write"]);
  // the owner's switch and pause, as the device last sent them
  await putIdx(Object.assign({}, idx, { w: 0 }));
  await bad("files_write", { path: F + "/b.txt", text: "x" }, /may not change files/);
  await putIdx(Object.assign({}, idx, { hold: Date.now() + 3600000 }));
  await bad("files_write", { path: F + "/b.txt", text: "x" }, /paused/);
  // the copy of the apps says Files is read only now: refused too
  await putIdx(idx);
  sock.closed = false;
  await b.box.webSocketMessage(sock, JSON.stringify({ snap: await G.sealText(K, JSON.stringify({ at: Date.now(), lv: { files: "read" }, ans: {} })) }));
  sock.closed = true;
  await bad("files_write", { path: F + "/b.txt", text: "x" }, /may not change files/);
  // the device takes the queue on connect, deletions included
  assert.equal(G.queueFor(await b.st.storage.list({ prefix: "q:" }), Date.now()).length, 4);
  // no index at all (dropping the copy drops what waits too)
  sock.closed = false;
  await b.box.webSocketMessage(sock, JSON.stringify({ fdrop: 1 }));
  sock.closed = true;
  await bad("files_write", { path: F + "/b.txt", text: "x" }, /no copy of Claude's folders/);
  assert.equal((await queued()).length, 0);
});

test("a piece comes only from Dropbox's content host, and a too-big piece is refused unread", async () => {
  const u = "https://dl.dropboxusercontent.com/scl/fi/p1/x?rlkey=k1";
  const fake = (url, len) => async () => ({ ok: true, url, headers: new Headers(len ? { "Content-Length": String(len) } : {}), arrayBuffer: async () => new ArrayBuffer(64) });
  assert.equal((await G.fetchPiece(u, fake(u))).byteLength, 64);
  await assert.rejects(G.fetchPiece(u, fake("https://evil.example/x")), /piece host/);
  await assert.rejects(G.fetchPiece(u, fake(u, 1e9)), /piece size/);
});
