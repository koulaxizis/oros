// orOS Transfer wave 4 (TRANSFER-1): sending through the sender's own
// Dropbox. A fake Dropbox (orosSync.cloudDrop's contract) and a fake
// fetch of its temporary links (Range, cut-off streams, expiry).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const C = require("../transfer/core.js");
const X = require("../transfer/cloud.js");

function fakeDropbox() {
  const store = new Map(), links = new Map(), log = { puts: [], links: 0, removed: [] };
  let n = 0;
  const drop = {
    available: () => true,
    put(name, blob) {
      assert.match(name, /^[a-z0-9]{8,40}\/[a-z0-9.-]{1,40}$/);
      return blob.arrayBuffer().then((b) => { store.set(name, new Uint8Array(b)); log.puts.push(name); return true; });
    },
    link(name) {
      if (!store.has(name)) return Promise.reject(new Error("link failed: 409"));
      const u = "https://uc" + (++n) + ".dl.dropboxusercontent.com/cd/0/get/" + crypto.randomBytes(9).toString("hex") + "/file";
      links.set(u, name); log.links++;
      return Promise.resolve(u);
    },
    // wave 5: a shared link on the direct host (sync.js cloudDrop.share after dropDirect)
    share(name) {
      if (drop.noScope) return Promise.reject(new Error("dropbox-scope"));
      if (!store.has(name)) return Promise.reject(new Error("share failed: 409"));
      const u = "https://dl.dropboxusercontent.com/scl/fi/" + crypto.randomBytes(9).toString("hex") + "/" + name.split("/")[1] + "?rlkey=" + crypto.randomBytes(6).toString("hex");
      links.set(u, name); log.shares = (log.shares || 0) + 1;
      return Promise.resolve(u);
    },
    remove(id) { for (const k of [...store.keys()]) if (k.startsWith(id + "/")) store.delete(k); log.removed.push(id); return Promise.resolve(true); },
    list() { return Promise.resolve([...new Set([...store.keys()].map((k) => k.split("/")[0]))].map((id) => ({ id }))); }
  };
  // fetch(url, { headers: { Range } }) → a streaming Response
  function fetch(url, opts = {}) {
    const name = links.get(url);
    if (!name || !store.has(name)) return Promise.resolve(new Response("gone", { status: 410 }));
    let bytes = store.get(name), status = 200;
    const r = opts.headers && opts.headers.Range;
    if (r) { const from = +/bytes=(\d+)-/.exec(r)[1]; bytes = bytes.subarray(from); status = 206; log.ranges = (log.ranges || 0) + 1; }
    const cut = fetch.cutAfter && !fetch.cutDone ? fetch.cutAfter : 0;
    let sent = 0;
    const body = new ReadableStream({
      pull(ctl) {
        if (sent >= bytes.length) { ctl.close(); return; }
        if (cut && sent >= cut) { fetch.cutDone = true; ctl.error(new TypeError("network error")); return; }
        const step = Math.min(bytes.length - sent, 50000 + (sent % 7));
        ctl.enqueue(bytes.slice(sent, sent + step)); sent += step;
      }
    });
    return Promise.resolve(new Response(body, { status }));
  }
  return { drop, fetch, store, log };
}
function memSink() {
  const out = {};
  return {
    out,
    open(i, f) { out[i] = { p: f.p, parts: [], ok: null }; },
    write(i, b) { out[i].parts.push(Buffer.from(b)); },
    close(i, ok) { out[i].ok = ok; out[i].data = Buffer.concat(out[i].parts); }
  };
}
function memTemp() {
  const parts = [];
  return Promise.resolve({ write(b) { parts.push(b.slice()); return Promise.resolve(); }, close() { return Promise.resolve(); },
    file() { return Promise.resolve(new Blob(parts)); }, remove() { parts.length = 0; return Promise.resolve(); } });
}
function filesOf(spec) { return spec.map(([p, size]) => ({ p, s: size, m: 1731400000000, bytes: crypto.randomBytes(size) })); }
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
function receive(dbx, frag, onOffer) {
  const f = X.parseFragment(frag);
  const states = [], bgs = [];
  const rx = new X.Receiver({ code: f.code, link: f.link, fetch: dbx.fetch, onState: (p, i) => states.push(Object.assign({ p }, i)), onBg: (b) => bgs.push(b) });
  rx.start();
  return { rx, states, bgs, last: () => states[states.length - 1] || {} };
}

test("links: the fragment carries the code and a Dropbox temporary link, nothing else", () => {
  const u = "https://uc1.dl.dropboxusercontent.com/cd/0/get/abc_DEF-1/file";
  const f = X.fragment("7k2m-9qxh-4rtb", u);
  assert.deepEqual(X.parseFragment("#" + f), { code: "7K2M9QXH4RTB", link: u });
  assert.equal(X.parseFragment("#d=7K2M9QXH4RTB." + Buffer.from("https://evil.example/x").toString("base64url")), null);
  assert.equal(X.parseFragment("#d=7K2M9QXH4RTB." + Buffer.from("http://uc1.dl.dropboxusercontent.com/x").toString("base64url")), null);
  assert.equal(X.parseFragment("#7K2M9QXH4RTB"), null);
  assert.equal(X.okLink("https://www.dropbox.com/s/x"), false);
  // the id's time is "start + (hold - 4 h) + UPLOAD_ALLOW", the time the sweep counts from
  assert.equal(X.idTime(X.newId(1731400000000)), 1731400000000 + X.UPLOAD_ALLOW);
  assert.equal(X.idTime(X.newId(1731400000000, 96)), 1731400000000 + 92 * 3600000 + X.UPLOAD_ALLOW);
  assert.equal(X.idTime(X.newId(1731400000000, 7)), 1731400000000 + X.UPLOAD_ALLOW, "an hour not offered counts as 4");
  assert.equal(X.newId(Date.now(), 96).length, 20);
});

test("packs end at file boundaries; lengths are exact", () => {
  assert.deepEqual(X.plan([{ s: 10 }, { s: 300e6 }, { s: 0 }, { s: 5 }]), [[0, 1], [2, 3]]);
  assert.deepEqual(X.plan([{ s: 10 }, { s: 10 }], 100), [[0, 1]]);
  assert.equal(X.packLen(0), 0);
  assert.equal(X.packLen(C.PIECE), C.PIECE + 40);
  assert.equal(X.packLen(C.PIECE + 1), C.PIECE + 1 + 80);
});

test("a folder goes up sealed and comes down whole, in several packs", async () => {
  const dbx = fakeDropbox();
  const files = filesOf([["Photos/a.jpg", 200000], ["Photos/sub/b.txt", 5], ["empty.txt", 0], ["c.bin", C.PIECE * 3], ["d.bin", 70000]]);
  const r = await sendAll(dbx, files, { packMax: C.PIECE * 2 });
  assert.ok(r.exp > Date.now() + 3.5 * 3600000 && r.exp < Date.now() + 4 * 3600000);
  const names = [...dbx.store.keys()].map((k) => k.split("/")[1]).sort();
  assert.deepEqual(names, ["index", "p0", "p1", "p2"]);
  // Dropbox holds no names and no plain bytes
  const all = Buffer.concat([...dbx.store.values()].map((b) => Buffer.from(b)));
  assert.ok(!all.includes(Buffer.from("Photos")) && !all.includes(files[0].bytes.subarray(0, 32)));
  const t = receive(dbx, r.frag);
  await until(() => t.last().p === "offer");
  assert.deepEqual(t.last().files.map((f) => f.p), files.map((f) => f.p));
  assert.equal(t.last().mode, "cloud");
  const sink = memSink();
  assert.ok(t.rx.accept(sink));
  await until(() => t.last().p === "done");
  assert.deepEqual(t.last().bad, []);
  files.forEach((f, i) => { assert.ok(sink.out[i].data.equals(f.bytes), f.p); assert.equal(sink.out[i].ok, true); });
});

test("the title and message travel sealed in the index (D1)", async () => {
  const dbx = fakeDropbox();
  const files = filesOf([["a.txt", 100]]);
  const r = await sendAll(dbx, files, { meta: { t: "For Eleni", m: "All of them." } });
  const all = Buffer.concat([...dbx.store.values()].map((b) => Buffer.from(b)));
  assert.ok(!all.includes(Buffer.from("Eleni")), "Dropbox never sees the message");
  const t = receive(dbx, r.frag);
  await until(() => t.last().p === "offer");
  assert.deepEqual(t.last().meta, { t: "For Eleni", m: "All of them." });
  const r2 = await sendAll(dbx, files);
  const t2 = receive(dbx, r2.frag);
  await until(() => t2.last().p === "offer");
  assert.equal(t2.last().meta, null);
});

test("the background picture travels sealed in the index (D3)", async () => {
  const dbx = fakeDropbox();
  const files = filesOf([["a.txt", 100]]);
  const pic = new Uint8Array(40000); for (let i = 0; i < pic.length; i++) pic[i] = (i * 31) & 255;
  pic.set([0xff, 0xd8, 0xff, 0xe0]); pic.set(Buffer.from("PIXELSECRET"), 900);
  const r = await sendAll(dbx, files, { bg: pic });
  const all = Buffer.concat([...dbx.store.values()].map((b) => Buffer.from(b)));
  assert.ok(!all.includes(Buffer.from("PIXELSECRET")), "Dropbox never sees the picture");
  const t = receive(dbx, r.frag);
  await until(() => t.last().p === "offer");
  assert.equal(t.bgs.length, 1);
  assert.equal(t.bgs[0].type, "image/jpeg");
  assert.ok(Buffer.from(t.bgs[0].bytes).equals(Buffer.from(pic)));
  const r2 = await sendAll(dbx, files, { bg: Buffer.from("<svg></svg>") });
  const t2 = receive(dbx, r2.frag);
  await until(() => t2.last().p === "offer");
  assert.equal(t2.bgs.length, 0, "only a real picture goes");
});

test("a download cut off mid-pack goes on with a Range request", async () => {
  const dbx = fakeDropbox();
  const files = filesOf([["big.bin", C.PIECE * 40 + 123]]);
  const r = await sendAll(dbx, files);
  dbx.fetch.cutAfter = C.PIECE * 17 + 999;
  const t = receive(dbx, r.frag);
  await until(() => t.last().p === "offer");
  const sink = memSink();
  t.rx.accept(sink);
  await until(() => t.last().p === "done");
  assert.equal(dbx.log.ranges, 1);
  assert.ok(sink.out[0].data.equals(files[0].bytes));
});

test("a changed byte, a wrong code or an expired link never passes", async () => {
  const dbx = fakeDropbox();
  const files = filesOf([["a.txt", 5000], ["b.txt", 9000]]);
  const r = await sendAll(dbx, files);
  // flip a byte in the pack: that piece fails to open → bad
  const pk = [...dbx.store.keys()].find((k) => k.endsWith("/p0"));
  dbx.store.get(pk)[C.HEAD + 12 + 10] ^= 1;
  const t = receive(dbx, r.frag);
  await until(() => t.last().p === "offer");
  t.rx.accept(memSink());
  await until(() => t.last().p === "error");
  assert.equal(t.last().e, "bad");
  // the right link with another code: the index does not open
  const f = X.parseFragment(r.frag);
  const w = new X.Receiver({ code: "7K2M9QXH4RTB", link: f.link, fetch: dbx.fetch, onState: (p, i) => { w.last = Object.assign({ p }, i); } });
  w.start();
  await until(() => w.last && w.last.p === "error");
  assert.equal(w.last.e, "bad");
  // the files are gone (deleted or 4 hours over)
  await dbx.drop.remove(r.id);
  const g = receive(dbx, r.frag);
  await until(() => g.last().p === "error");
  assert.equal(g.last().e, "expired");
});

test("the index is checked as a whole: bad paths, hashes or pack lengths refuse it", async () => {
  const k = await C.derive(C.newCode());
  const good = { v: 1, id: "x", exp: Date.now() + 1000, files: [{ p: "a", s: 3, m: 1, h: "0".repeat(64), k: 0 }], packs: [{ u: "https://u.dl.dropboxusercontent.com/f", n: X.packLen(3) }] };
  assert.ok(await X.openIndex(k.key, await X.sealIndex(k.key, good)));
  for (const bad of [
    Object.assign({}, good, { files: [{ p: "..", s: 3, m: 1, h: "0".repeat(64), k: 0 }] }),
    Object.assign({}, good, { files: [{ p: "a", s: 3, m: 1, h: "zz", k: 0 }] }),
    Object.assign({}, good, { packs: [{ u: "https://u.dl.dropboxusercontent.com/f", n: 99 }] }),
    Object.assign({}, good, { packs: [{ u: "https://evil.example/f", n: X.packLen(3) }] }),
    Object.assign({}, good, { files: [{ p: "a", s: 3, m: 1, h: "0".repeat(64), k: 1 }] })
  ]) assert.equal(await X.openIndex(k.key, await X.sealIndex(k.key, bad)), null);
  // a box sealed for something else (another additional data) does not open as an index
  assert.equal(await X.openIndex(k.key, C.unb64(await C.seal(k.key, "sender", good))), null);
});

test("a cancelled or failed upload leaves nothing in Dropbox", async () => {
  const dbx = fakeDropbox();
  const files = filesOf([["a.bin", C.PIECE * 30]]);
  let stop = false;
  const p = sendAll(dbx, files, { cancelled: () => stop, onProgress: (x) => { if (x.bytes > C.PIECE * 5) stop = true; } });
  await assert.rejects(p, (e) => e.code === "cancelled");
  assert.equal(dbx.store.size, 0);
  const full = fakeDropbox();
  full.drop.put = () => Promise.reject(new Error("dropbox-full"));
  await assert.rejects(sendAll(full, files), (e) => e.code === "full");
});

test("probe: a browser that cannot read the link says no; the probe is removed either way", async () => {
  const dbx = fakeDropbox();
  assert.equal(await X.probe(dbx.drop, dbx.fetch), true);
  assert.equal(dbx.store.size, 0);
  assert.equal(await X.probe(dbx.drop, () => Promise.reject(new TypeError("Failed to fetch (CORS)"))), false);
  assert.equal(dbx.store.size, 0);
});

test("sweep removes a folder once its hold (+ upload allowance + 15 min) has passed, keeps the rest", async () => {
  const dbx = fakeDropbox();
  const now = Date.now(), H = 3600000;
  const keep = [X.newId(now - 5 * H), X.newId(now - 50 * H, 96), X.newId(now - 13 * H, 12)];
  const gone = [X.newId(now - 7 * H), X.newId(now - 99 * H, 96), X.newId(now - 15 * H, 12)];
  for (const id of keep.concat(gone)) await dbx.drop.put(id + "/index", new Blob(["x"]));
  assert.equal(await X.sweep(dbx.drop, now), 3);
  assert.deepEqual([...dbx.store.keys()].sort(), keep.map((id) => id + "/index").sort());
  // a 4-hour build's rule (T + 4 h 15 min) gives the same answer for every hold
  const old = (id) => now - parseInt(id.slice(0, 8), 36) > 4 * H + 15 * 60000;
  assert.deepEqual(keep.map(old), [false, false, false]);
  assert.deepEqual(gone.map(old), [true, true, true]);
});

test("wave 5: a 24-hour send uses shared links and says until when; the promise never outlives the sweep", async () => {
  const dbx = fakeDropbox();
  const files = filesOf([["a.bin", 70000], ["b/c.txt", 9]]);
  const r = await sendAll(dbx, files, { hold: 24 });
  assert.equal(r.hold, 24);
  assert.ok(Math.abs(r.exp - (Date.now() + 24 * 3600000)) < 60000, "24 hours from the links");
  assert.equal(dbx.log.links, 0); assert.equal(dbx.log.shares, 2);
  const f = X.parseFragment(r.frag);
  assert.match(f.link, /^https:\/\/dl\.dropboxusercontent\.com\/scl\/fi\//);
  const t = receive(dbx, r.frag);
  await until(() => t.last().p === "offer");
  assert.ok(Math.abs(t.last().exp - r.exp) < 2);
  const sink = memSink();
  t.rx.accept(sink);
  await until(() => t.last().p === "done");
  files.forEach((x, i) => assert.ok(sink.out[i].data.equals(x.bytes)));
  // uploads that took longer than the allowance shorten what the link promises
  const start = 1731400000000, H = 3600000, id = X.newId(start, 48);
  assert.equal(X.expiry(id, start + H, 48), start + 49 * H);
  assert.equal(X.expiry(id, start + 5 * H, 48), start + 48 * H + X.UPLOAD_ALLOW);
  assert.equal(X.expiry(X.newId(start), start + H, 4), start + H + X.LINK_SAFE);
  assert.ok(X.expiry(id, start + 5 * H, 48) < X.idTime(id) + X.SWEEP_MS);
});

test("wave 5: a sign-in without sharing.write fails as 'scope' and leaves nothing; the shared probe says so too", async () => {
  const dbx = fakeDropbox();
  dbx.drop.noScope = true;
  await assert.rejects(sendAll(dbx, filesOf([["a.bin", 10]]), { hold: 12 }), (e) => e.code === "scope");
  assert.equal(dbx.store.size, 0);
  await assert.rejects(X.probe(dbx.drop, dbx.fetch, true), (e) => e.code === "scope");
  assert.equal(dbx.store.size, 0);
  dbx.drop.noScope = false;
  assert.equal(await X.probe(dbx.drop, dbx.fetch, true), true);
  assert.equal(dbx.log.links, 0);
  // 4 hours still works without the permission
  dbx.drop.noScope = true;
  const r = await sendAll(dbx, filesOf([["a.bin", 10]]));
  assert.ok(r.exp < Date.now() + 4 * 3600000);
});

test("wave 5: sync.js turns a shared link into its direct host, keeps only rlkey, refuses anything else", () => {
  const src = fs.readFileSync(path.join(__dirname, "../sync.js"), "utf8");
  const m = /  function dropDirect\(u\) \{[\s\S]*?\n  \}\n/.exec(src);
  assert.ok(m);
  const dropDirect = new Function(m[0] + "; return dropDirect;")();
  assert.equal(dropDirect("https://www.dropbox.com/scl/fi/ab12cd/p0?rlkey=xyz9&dl=0"), "https://dl.dropboxusercontent.com/scl/fi/ab12cd/p0?rlkey=xyz9");
  assert.equal(dropDirect("https://www.dropbox.com/s/ab12cd/index?dl=0"), "https://dl.dropboxusercontent.com/s/ab12cd/index");
  assert.equal(dropDirect("https://evil.example/scl/fi/x/p0"), "");
  assert.equal(dropDirect("https://www.dropbox.com.evil.example/scl/fi/x/p0"), "");
  assert.equal(dropDirect("https://www.dropbox.com/home/secret"), "");
  assert.ok(X.okLink(dropDirect("https://www.dropbox.com/scl/fi/ab12cd/p0?rlkey=xyz9&dl=0")));
  // every open orOS sweeps hourly with the same rule
  assert.ok(src.includes("var DROP_SWEEP_MS = 4 * 3600000 + 15 * 60000;"));
  assert.ok(/setTimeout\(dropSweep, 60000\)/.test(src));
  assert.ok(/sharing\/create_shared_link_with_settings/.test(src) && /missing_scope/.test(src));
});

test("wiring: sync.js keeps Transfer outside the vault; the pages load cloud.js", () => {
  const sync = fs.readFileSync(path.join(__dirname, "../sync.js"), "utf8");
  assert.ok(sync.includes('var DROP_ROOT = "/transfer";'));
  assert.ok(sync.includes("cloudDrop: cloudDrop,"));
  assert.ok(/if \(provider\.id !== "dropbox"\) return Promise\.reject/.test(sync));
  for (const f of ["index.html", "receive.html"]) assert.ok(fs.readFileSync(path.join(__dirname, "../transfer", f), "utf8").includes('src="cloud.js'), f);
  const sw = fs.readFileSync(path.join(__dirname, "../sw.js"), "utf8");
  assert.ok(sw.includes('"transfer/cloud.js"'));
});
