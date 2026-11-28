// orOS Transfer TR-UNL (unlimited sharing): holds of 7, 14 and 30 days
// and "until I delete it" through the sender's own Dropbox, Links in my
// Dropbox (every page of the listing, every device), 100,000 files, and
// the one-press Dropbox way when no direct link opens.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const C = require("../transfer/core.js");
const X = require("../transfer/cloud.js");
const TODAY = require("../transfer/today.js");

const H = 3600000;
function fakeDropbox() {
  const store = new Map(), links = new Map(), log = { links: 0, shares: 0 };
  const drop = {
    put(name, blob) { return blob.arrayBuffer().then((b) => { store.set(name, new Uint8Array(b)); return true; }); },
    link(name) { const u = "https://uc.dl.dropboxusercontent.com/cd/0/get/" + crypto.randomBytes(9).toString("hex") + "/file"; links.set(u, name); log.links++; return Promise.resolve(u); },
    share(name) {
      const u = "https://dl.dropboxusercontent.com/scl/fi/" + crypto.randomBytes(9).toString("hex") + "/" + name.split("/")[1] + "?rlkey=" + crypto.randomBytes(6).toString("hex");
      links.set(u, name); log.shares++;
      return Promise.resolve(u);
    },
    remove(id) { for (const k of [...store.keys()]) if (k.startsWith(id + "/")) store.delete(k); return Promise.resolve(true); },
    list() { return Promise.resolve([...new Set([...store.keys()].map((k) => k.split("/")[0]))].map((id) => ({ id }))); }
  };
  function fetch(url) {
    const name = links.get(url);
    if (!name || !store.has(name)) return Promise.resolve(new Response("gone", { status: 410 }));
    return Promise.resolve(new Response(store.get(name), { status: 200 }));
  }
  return { drop, fetch, store, log };
}
function memTemp() {
  const parts = [];
  return Promise.resolve({ write(b) { parts.push(b.slice()); return Promise.resolve(); }, close() { return Promise.resolve(); },
    file() { return Promise.resolve(new Blob(parts)); }, remove() { parts.length = 0; return Promise.resolve(); } });
}
function until(fn, ms = 20000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function poll() { if (fn()) return res(); if (Date.now() - t0 > ms) return rej(new Error("timeout")); setTimeout(poll, 5); })();
  });
}
async function sendAll(dbx, files, extra = {}) {
  const code = C.newCode();
  const r = await X.send(Object.assign({ code, files: files.map(({ p, s, m }) => ({ p, s, m })), drop: dbx.drop, temp: memTemp,
    read: (i, a, b) => Promise.resolve(new Uint8Array(files[i].bytes.subarray(a, b))) }, extra));
  return Object.assign({ code }, r);
}
function filesOf(spec) { return spec.map(([p, size]) => ({ p, s: size, m: 1731400000000, bytes: crypto.randomBytes(size) })); }

test("holds: 7, 14 and 30 days and 'until I delete it' are offered; forever only when asked for by name", () => {
  for (const h of [168, 336, 720, 0]) assert.ok(X.HOLDS.includes(h), String(h));
  assert.equal(X.FOREVER, 0);
  assert.equal(X.okHold(0), 0);
  assert.equal(X.okHold("0"), 0);
  assert.equal(X.okHold("720"), 720);
  for (const v of [undefined, null, "", NaN, -1, 5, "x"]) assert.equal(X.okHold(v), 4, String(v));
  // the days count like the hours: T = start + (hold - 4 h) + allowance
  assert.equal(X.idTime(X.newId(1731400000000, 720)), 1731400000000 + 716 * H + X.UPLOAD_ALLOW);
  assert.equal(X.newId(Date.now(), 720).length, 20);
  // forever: the largest 8-character time, 20 characters like every id
  const id = X.newId(Date.now(), 0);
  assert.equal(id.slice(0, 8), "zzzzzzzz");
  assert.equal(id.length, 20);
  assert.equal(X.idTime(id), X.FOREVER_T);
  assert.equal(X.expiry(id, Date.now(), 0, true), 0);
});

test("sweeps: a forever folder is never removed (this build, sync.js and the 4-hour builds); a 30-day one on time", async () => {
  const dbx = fakeDropbox(), now = Date.now();
  const forever = X.newId(now - 400 * 24 * H, 0), month = X.newId(now - 29 * 24 * H, 720), past = X.newId(now - 31 * 24 * H, 720);
  for (const id of [forever, month, past]) await dbx.drop.put(id + "/index", new Blob(["x"]));
  assert.equal(await X.sweep(dbx.drop, now), 1);
  assert.deepEqual([...dbx.store.keys()].sort(), [forever + "/index", month + "/index"].sort());
  const old = (id) => { const t = parseInt(id.slice(0, 8), 36); return !(t > 0) || now - t > 4 * H + 15 * 60000; };
  assert.equal(old(forever), false);
  assert.equal(old(month), false);
  assert.equal(old(past), true);
  // sync.js's hourly sweep has the same rule
  const sync = fs.readFileSync(path.join(__dirname, "../sync.js"), "utf8");
  assert.ok(sync.includes("return !(t > 0) || now - t > DROP_SWEEP_MS;"));
});

test("a send kept until deleted: shared links, exp 0, any number of receivers, at any later time", async () => {
  const dbx = fakeDropbox();
  const files = filesOf([["big/a.bin", 200000], ["big/b.txt", 7]]);
  const r = await sendAll(dbx, files, { hold: 0 });
  assert.equal(r.exp, 0);
  assert.equal(r.hold, 0);
  assert.equal(dbx.log.links, 0);
  assert.ok(dbx.log.shares >= 2);
  assert.equal(r.id.slice(0, 8), "zzzzzzzz");
  // three people open the same link; each gets every file whole
  for (let k = 0; k < 3; k++) {
    const f = X.parseFragment(r.frag), states = [];
    const rx = new X.Receiver({ code: f.code, link: f.link, fetch: dbx.fetch, onState: (p, i) => states.push(Object.assign({ p }, i)) });
    rx.start();
    await until(() => states.length && states[states.length - 1].p === "offer");
    assert.equal(states[states.length - 1].exp, 0);
    const out = {};
    rx.accept({ open(i) { out[i] = []; }, write(i, b) { out[i].push(Buffer.from(b)); }, close() {} });
    await until(() => states[states.length - 1].p === "done");
    files.forEach((x, i) => assert.ok(Buffer.concat(out[i]).equals(x.bytes)));
  }
  // deleting it ends the link
  await dbx.drop.remove(r.id);
  const f = X.parseFragment(r.frag), states = [];
  new X.Receiver({ code: f.code, link: f.link, fetch: dbx.fetch, onState: (p, i) => states.push(Object.assign({ p }, i)) }).start();
  await until(() => states.length && states[states.length - 1].p === "error");
  assert.equal(states[states.length - 1].e, "expired");
});

test("a scheduled email with a link kept until deleted", async () => {
  const dbx = fakeDropbox();
  const r = await sendAll(dbx, filesOf([["a.bin", 10]]), { hold: 0, start: Date.now() + 3 * H });
  assert.equal(r.exp, 0);
  assert.equal(r.id.slice(0, 8), "zzzzzzzz");
});

test("100,000 files: the list is accepted, a longer one is not; the index and pack bounds grew with it", () => {
  assert.equal(C.MAX_FILES, 100000);
  const many = Array.from({ length: 100000 }, (_, i) => ({ p: "f/" + i + ".txt", s: 1, m: 1 }));
  assert.ok(C.checkManifest(many));
  assert.equal(C.checkManifest(many.concat([{ p: "x.txt", s: 1, m: 1 }])), null);
  // a sealed index of 100,000 files with hashes fits
  const json = JSON.stringify({ v: 1, files: many.map((f, i) => ({ p: f.p, s: 1, m: 1731400000000, h: "0".repeat(64), k: i % 400 })) });
  assert.ok(json.length + C.BG_MAX * 2 < X.INDEX_MAX, json.length + " bytes");
  assert.ok(X.PACKS_MAX * X.PACK_MAX >= 10 * 1e12, "about 10 TB of packs");
});

test("links of this device: exp 0 is kept (never dropped by time), the link is kept only when it is a receive link", () => {
  const now = Date.now();
  const l = C.cleanLinks({ items: [
    { id: "zzzzzzzzaaaaaaaaaaaa", exp: 0, what: "Kept", n: 2, at: now - H, bytes: 900, url: "https://useoros.online/transfer/receive.html#d=7K2M9QXH4RTB.aHR0cHM6" },
    { id: "abc12345bbbbbbbbbbbb", exp: now + H, what: "Soon", n: 1, url: "javascript:alert(1)" },
    { id: "abc12345cccccccccccc", exp: now - 1, what: "Gone" },
    { id: "abc12345dddddddddddd", exp: -5, what: "Bad" }
  ] }, now);
  assert.deepEqual(l.items.map((x) => x.id), ["abc12345bbbbbbbbbbbb", "zzzzzzzzaaaaaaaaaaaa"], "ending ones first, kept ones last");
  assert.equal(l.items[0].url, undefined);
  assert.match(l.items[1].url, /#d=/);
  assert.equal(l.items[1].bytes, 900);
  assert.equal(C.LINKS_MAX, 1000);
  // Today never shows a link that does not end
  const rows = TODAY.collect({ now, today: new Date(now).toISOString().slice(0, 10), horizon: 400, lang: "en", strict: false,
    addDays: (d) => "9999-12-31", readJSON: (k) => (k === C.LINKS_KEY ? l : null) });
  assert.deepEqual(rows.map((r) => r.id), ["end-abc12345bbbbbbbbbbbb"]);
});

test("sync.js: the listing follows every page (a sweep and Links see all folders); details add up sizes per folder", async () => {
  const src = fs.readFileSync(path.join(__dirname, "../sync.js"), "utf8");
  const m = /  function dropPages\(recursive\) \{[\s\S]*?\n  \}\n/.exec(src);
  assert.ok(m);
  const calls = [];
  const pages = [
    { entries: [{ ".tag": "folder", name: "aaaaaaaa1111", path_lower: "/transfer/aaaaaaaa1111" }], has_more: true, cursor: "c1" },
    { entries: [{ ".tag": "file", name: "p0", path_lower: "/transfer/aaaaaaaa1111/p0", size: 100, server_modified: "2026-11-28T10:00:00Z" },
                { ".tag": "file", name: "index", path_lower: "/transfer/aaaaaaaa1111/index", size: 5, server_modified: "2026-11-28T10:05:00Z" }], has_more: true, cursor: "c2" },
    { entries: [{ ".tag": "folder", name: "zzzzzzzz2222", path_lower: "/transfer/zzzzzzzz2222" },
                { ".tag": "file", name: "index", path_lower: "/transfer/zzzzzzzz2222/index", size: 7, server_modified: "2026-11-27T09:00:00Z" }], has_more: false }
  ];
  const rpc = (ep, args) => { calls.push([ep, args]); const j = pages[calls.length - 1]; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j) }); };
  const dropPages = new Function("rpc", "dropReady", "DROP_ROOT", m[0] + "; return dropPages;")(rpc, () => Promise.resolve(), "/transfer");
  const all = await dropPages(true);
  assert.equal(all.length, 5);
  assert.deepEqual(calls.map((c) => c[0]), ["files/list_folder", "files/list_folder/continue", "files/list_folder/continue"]);
  assert.equal(calls[0][1].recursive, true);
  assert.equal(calls[1][1].cursor, "c1");
  // details: sizes per folder, the oldest time, done once the sealed index is there
  const det = /    details: function \(\) \{[\s\S]*?\n    \},\n/.exec(src);
  assert.ok(det);
  calls.length = 0;
  const details = new Function("dropPages", "return {" + det[0] + "}.details;")(dropPages);
  const rows = (await details()).sort((a, b) => (a.id < b.id ? -1 : 1));
  assert.deepEqual(rows, [
    { id: "aaaaaaaa1111", bytes: 105, at: Date.parse("2026-11-28T10:00:00Z"), done: true },
    { id: "zzzzzzzz2222", bytes: 7, at: Date.parse("2026-11-27T09:00:00Z"), done: true }
  ]);
  // the cloudDrop wiring uses it for list (sweeps) and details (Links)
  assert.ok(/list: function \(\) \{\s*return dropPages\(false\)/.test(src));
  assert.ok(/details: function \(\) \{\s*return dropPages\(true\)/.test(src));
  // an empty Dropbox (no /transfer yet) is an empty list
  const none = new Function("rpc", "dropReady", "DROP_ROOT", m[0] + "; return dropPages;")(() => Promise.resolve({ ok: false, status: 409 }), () => Promise.resolve(), "/transfer");
  assert.deepEqual(await none(false), []);
});

test("wiring: hold labels, Links in my Dropbox, the Dropbox way after a failed direct link; EN/EL/DE strings", () => {
  const app = fs.readFileSync(path.join(__dirname, "../transfer/app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../transfer/index.html"), "utf8");
  const de = fs.readFileSync(path.join(__dirname, "../i18n/de/transfer.js"), "utf8");
  for (const id of ["links-box", "links-list", "links-sum", "links-status", "links-refresh", "to-cloud"]) assert.ok(html.includes('id="' + id + '"'), id);
  assert.ok(app.includes('if (which === "hist") renderLinks(false);'));
  assert.ok(app.includes('info.e === "nodirect" && !!cloudApi()'));
  assert.ok(app.includes("if (r.exp) setTimeout("), "no timed delete for a link kept until deleted");
  assert.ok(app.includes("drop.details()"));
  const keys = ["hold.d", "hold.forever", "later.bodyKeep", "later.readyKeep", "cloud.readyKeep", "cloud.keepKeep", "offer.cloudKeep",
    "btn.toCloud", "nodirect.cloud", "links.head", "links.loading", "links.none", "links.sum", "links.sum1", "links.other", "links.made",
    "links.until", "links.keep", "links.partial", "links.copy", "links.del", "links.sure", "links.gone", "links.err", "links.refresh"];
  for (const k of keys) {
    const n = app.split('"' + k + '":').length - 1;
    assert.equal(n, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  }
});
