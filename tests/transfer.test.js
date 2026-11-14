// orOS Transfer (TRANSFER-1): codes, sealing, the streaming SHA-256 and
// ZIP writer, cleaned names, and whole transfers between a sender and a
// receiver through a fake relay room and a fake WebRTC data channel.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const C = require("../transfer/core.js");
const E = require("../transfer/engine.js");

// ---------- A relay room that behaves like relay/remote.js ----------
class FakeRelay {
  constructor() { this.rooms = new Map(); this.frames = []; this.times = []; this.full = 0; }
  WebSocket() {
    const relay = this;
    return class FakeSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        const room = relay.rooms.get(url) || [];
        relay.rooms.set(url, room);
        setTimeout(() => {
          if (room.length >= 2) { relay.full++; this.readyState = 3; this.onclose && this.onclose({ code: 1006 }); return; }
          room.push(this);
          this.readyState = 1;
          this.onopen && this.onopen();
          if (room.length === 2) room.forEach((s) => s._recv(JSON.stringify({ sys: "peer" })));
          else this._recv(JSON.stringify({ sys: "wait" }));
        }, 1);
      }
      _recv(data) { setTimeout(() => { if (this.readyState === 1 && this.onmessage) this.onmessage({ data }); }, 1); }
      send(data) {
        if (this.readyState !== 1) return;
        if (typeof data !== "string") throw new Error("text frames only");
        if (data === "ping") { this._recv("pong"); return; }
        relay.frames.push(data);
        relay.times.push(Date.now());
        for (const o of relay.rooms.get(this.url)) if (o !== this) o._recv(data);
      }
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        const room = relay.rooms.get(this.url) || [];
        const i = room.indexOf(this);
        if (i !== -1) room.splice(i, 1);
        room.forEach((o) => o._recv(JSON.stringify({ sys: "left" })));
        setTimeout(() => this.onclose && this.onclose({ code: 1000 }), 1);
      }
    };
  }
}

// ---------- A WebRTC stand-in: offer/answer pair two data channels ----------
function fakeRtc(opts = {}) {
  const pcs = new Map();
  let next = 1;
  const log = { binary: 0, bytes: 0, maxBuffered: 0 };
  class Chan {
    constructor() { this.readyState = "connecting"; this.bufferedAmount = 0; this.peer = null; }
    send(d) {
      if (this.readyState !== "open") throw new Error("not open");
      let data = d;
      if (typeof d !== "string") {
        const u8 = d instanceof Uint8Array ? d : new Uint8Array(d);
        data = u8.slice().buffer;
        log.binary++; log.bytes += u8.length;
        if (u8.length > 65536) throw new Error("message too big for a data channel");
      }
      if (opts.dropAfter && log.binary > opts.dropAfter && !log.dropped) { log.dropped = 1; this.close(); return; }
      const peer = this.peer, len = typeof data === "string" ? data.length : data.byteLength;
      this.bufferedAmount += len;
      log.maxBuffered = Math.max(log.maxBuffered, this.bufferedAmount);
      setImmediate(() => {
        this.bufferedAmount -= len;
        if (this.bufferedAmount <= (this.bufferedAmountLowThreshold || 0) && this.onbufferedamountlow) this.onbufferedamountlow();
        if (peer.readyState === "open" && peer.onmessage) peer.onmessage({ data });
      });
    }
    close() {
      if (this.readyState === "closed") return;
      this.readyState = "closed";
      setImmediate(() => { this.onclose && this.onclose(); if (this.peer && this.peer.readyState !== "closed") this.peer.close(); });
    }
  }
  class PC {
    constructor() { this.id = next++; pcs.set(this.id, this); this.connectionState = "new"; }
    createDataChannel() { this.chan = new Chan(); return this.chan; }
    createOffer() { return Promise.resolve({ type: "offer", sdp: "fake:" + this.id }); }
    createAnswer() { return Promise.resolve({ type: "answer", sdp: "fake:" + this.id }); }
    setLocalDescription(d) { this.localDescription = d; if (d.type === "offer") setTimeout(() => this.onicecandidate && this.onicecandidate({ candidate: { candidate: "c", sdpMid: "0" } }), 1); return Promise.resolve(); }
    setRemoteDescription(d) {
      const peer = pcs.get(+String(d.sdp).split(":")[1]);
      this.remote = peer;
      if (d.type === "answer" && !opts.noDirect && !(opts.noReturn && log.dropped)) {
        const a = this.chan, b = new Chan();
        a.peer = b; b.peer = a;
        setTimeout(() => {
          a.readyState = "open"; b.readyState = "open";
          peer.ondatachannel && peer.ondatachannel({ channel: b });
          setTimeout(() => { b.onopen && b.onopen(); a.onopen && a.onopen(); }, 1);
        }, 2);
      }
      return Promise.resolve();
    }
    addIceCandidate() { return Promise.resolve(); }
    close() { this.connectionState = "closed"; }
  }
  return { PC, log };
}

function until(fn, ms = 8000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function poll() {
      let v;
      try { v = fn(); } catch (e) { v = false; }
      if (v) return res(v);
      if (Date.now() - t0 > ms) return rej(new Error("timeout"));
      setTimeout(poll, 5);
    })();
  });
}

function randomFiles(spec) {
  return spec.map(([p, size]) => ({ path: p, size, mtime: 1731400000000, bytes: crypto.randomBytes(size) }));
}

function memSink() {
  const out = {}, events = [];
  return {
    out, events,
    open(i, f) { events.push(["open", i, f.p]); out[i] = { p: f.p, parts: [], ok: null }; },
    write(i, b) { out[i].parts.push(Buffer.from(b)); },
    close(i, ok) { events.push(["close", i, ok]); out[i].ok = ok; out[i].data = Buffer.concat(out[i].parts); }
  };
}

function pair(files, o = {}) {
  const relay = o.relay || new FakeRelay(), rtc = o.rtc || fakeRtc(o.rtcOpts);
  const code = o.code || C.newCode();
  const manifest = C.buildManifest(files);
  const sLog = [], rLog = [], sProg = [];
  const sender = new E.Transfer({
    role: "sender", code, relay: "https://relay.test", dev: "Chrome · Linux", files: manifest, meta: o.meta,
    WebSocket: relay.WebSocket(), RTCPeerConnection: rtc.PC,
    read: o.read || ((i, a, b) => Promise.resolve(new Uint8Array(files[i].bytes.subarray(a, b)))),
    onState: (p, i) => sLog.push(Object.assign({ p }, i)),
    onProgress: (p) => sProg.push(p)
  });
  const receiver = new E.Transfer({
    role: "receiver", code: o.rcode || code, relay: "https://relay.test", dev: "Firefox · Android",
    WebSocket: relay.WebSocket(), RTCPeerConnection: rtc.PC,
    onState: (p, i) => rLog.push(Object.assign({ p }, i))
  });
  return { relay, rtc, code, manifest, sender, receiver, sLog, rLog, sProg,
    sLast: () => sLog[sLog.length - 1] || {}, rLast: () => rLog[rLog.length - 1] || {},
    get sStates() { return sLog.map((x) => x.p); }, get rStates() { return rLog.map((x) => x.p); } };
}

// ---------- 1. Codes and links ----------
test("codes: 12 Crockford characters; typed, pasted or as a whole link", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const c = C.newCode(); assert.match(c, C.CODE_RE); seen.add(c); }
  assert.ok(seen.size > 195);
  const c = "7K2M9QXH4RTB";
  assert.equal(C.fmtCode(c), "7K2M-9QXH-4RTB");
  assert.equal(C.normCode(" 7k2m-9qxh-4rtb "), c);
  assert.equal(C.normCode("https://useoros.online/transfer/receive.html#7K2M-9QXH-4RTB"), c);
  assert.equal(C.normCode("#t=7K2M9QXH4RTB"), c);
  assert.equal(C.normCode("ABCD-EFGH-IJLO"), "ABCDEFGH1J10");
  assert.equal(C.normCode("7K2M9QXH4RT"), "");
  assert.equal(C.normCode("https://evil.test/?x=1"), "");
});

test("links: this origin when public, useoros.online for a local copy", () => {
  const c = "7K2M9QXH4RTB";
  assert.equal(C.linkFor(c, "https://useoros.online"), "https://useoros.online/transfer/receive.html#7K2M-9QXH-4RTB");
  assert.equal(C.linkFor(c, "https://my.example.org/"), "https://my.example.org/transfer/receive.html#7K2M-9QXH-4RTB");
  for (const o of ["http://127.0.0.1:47800", "https://localhost:3000", "https://192.168.1.4", "https://nas.local", ""]) {
    assert.equal(C.linkFor(c, o), "https://useoros.online/transfer/receive.html#7K2M-9QXH-4RTB", o);
  }
});

// ---------- 2. Sealing ----------
test("control messages are sealed per role; pieces are bound to their file and place", async () => {
  const a = await C.derive("7K2M9QXH4RTB"), b = await C.derive("7K2M9QXH4RTC");
  assert.match(a.room, /^[0-9a-f]{64}$/);
  assert.notEqual(a.room, b.room);
  const f = await C.seal(a.key, "sender", { t: "man" });
  assert.deepEqual(await C.unseal(a.key, "sender", f), { t: "man" });
  assert.equal(await C.unseal(a.key, "receiver", f), null, "not reflected");
  assert.equal(await C.unseal(b.key, "sender", f), null, "another code");
  assert.equal(await C.unseal(a.key, "sender", "!!"), null);

  const bytes = crypto.randomBytes(C.PIECE);
  const p = await C.sealPiece(a.key, 3, 7, bytes);
  assert.ok(p.length <= 65536, "fits a data channel message");
  const got = await C.openPiece(a.key, p.buffer);
  assert.equal(got.file, 3); assert.equal(got.n, 7);
  assert.ok(Buffer.from(got.bytes).equals(bytes));
  const moved = p.slice(); moved[11] = 8;                 // claims to be piece 8
  assert.equal(await C.openPiece(a.key, moved), null);
  const other = p.slice(); other[7] = 4;                  // claims another file
  assert.equal(await C.openPiece(a.key, other), null);
  assert.equal(await C.openPiece(b.key, p), null);
  assert.equal(await C.openPiece(a.key, new Uint8Array(10)), null);
});

// ---------- 3. SHA-256 ----------
test("streaming SHA-256 equals Node's for any length and any split", () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 65536 + 7, 300001]) {
    const buf = crypto.randomBytes(n);
    const want = crypto.createHash("sha256").update(buf).digest("hex");
    assert.equal(new C.Sha256().update(new Uint8Array(buf)).hex(), want, "one go " + n);
    const h = new C.Sha256();
    for (let i = 0; i < n;) { const k = Math.min(n - i, 1 + ((i * 7919) % 97)); h.update(new Uint8Array(buf.subarray(i, i + k))); i += k; }
    assert.equal(h.hex(), want, "pieces " + n);
  }
});

// ---------- 4. ZIP ----------
function writeZip(entries, opts) {
  const z = new C.ZipWriter(opts), parts = [];
  for (const e of entries) {
    parts.push(Buffer.from(z.begin(e.name, e.data.length, e.mtime || 1731400000000)));
    for (let i = 0; i < e.data.length; i += 5000) parts.push(Buffer.from(z.data(new Uint8Array(e.data.subarray(i, i + 5000)))));
    parts.push(Buffer.from(z.end()));
  }
  parts.push(Buffer.from(z.finish()));
  return Buffer.concat(parts);
}
function pyCheck(zip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oros-zip-"));
  const f = path.join(dir, "t.zip");
  fs.writeFileSync(f, zip);
  const py = spawnSync("python3", ["-I", "-c",
    "import zipfile,sys,hashlib,json\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\n" +
    "print(json.dumps([[i.filename,i.file_size,hashlib.sha256(z.read(i)).hexdigest()] for i in z.infolist()]))", f], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return py;
}

test("the ZIP writer makes archives other tools read (CRC, UTF-8 names, folders)", (t) => {
  const entries = [
    { name: "Φωτογραφίες/θάλασσα.jpg", data: crypto.randomBytes(70000) },
    { name: "notes/empty.txt", data: Buffer.alloc(0) },
    { name: "a.bin", data: crypto.randomBytes(12345) }
  ];
  const zip = writeZip(entries);
  // our own reader opens it too
  const AZ = require("../atelier/zip.js");
  const r = AZ.open(new Uint8Array(zip));
  assert.deepEqual(r.names.slice().sort(), entries.map((e) => e.name).sort());
  const py = pyCheck(zip);
  if (py.error || py.status === null) { t.skip("python3 not available"); return; }
  assert.equal(py.status, 0, py.stderr);
  const got = JSON.parse(py.stdout);
  assert.deepEqual(got, entries.map((e) => [e.name, e.data.length, crypto.createHash("sha256").update(e.data).digest("hex")]));
});

test("ZIP64 fields where sizes or offsets pass 4 GB (forced low threshold)", (t) => {
  const entries = [
    { name: "one.bin", data: crypto.randomBytes(3000) },
    { name: "two.bin", data: crypto.randomBytes(9000) },
    { name: "three.bin", data: crypto.randomBytes(10) }
  ];
  const zip = writeZip(entries, { big: 4096 });
  assert.ok(zip.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06])) > 0, "ZIP64 end record");
  const py = pyCheck(zip);
  if (py.error || py.status === null) { t.skip("python3 not available"); return; }
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout).map((x) => x[1]), [3000, 9000, 10]);
});

// ---------- 5. Names ----------
test("received names cannot climb out, hide, or take reserved names", () => {
  assert.equal(C.cleanPath("../../etc/passwd"), "etc/passwd");
  assert.equal(C.cleanPath("/abs/a.txt"), "abs/a.txt");
  assert.equal(C.cleanPath("a\\..\\b.txt"), "a/b.txt");
  assert.equal(C.cleanPath("C:\\Users\\x.txt"), "C_/Users/x.txt");
  assert.equal(C.cleanPath(".trash/x"), "_trash/x");
  assert.equal(C.cleanPath("con.txt"), "_con.txt");
  assert.equal(C.cleanPath("a\u0000b\u202e.txt"), "ab.txt");
  assert.equal(C.cleanPath("ends with dot. "), "ends with dot");
  assert.equal(C.cleanPath(".."), "");
  assert.equal(C.cleanName("x".repeat(300) + ".jpeg").length, 255);
  assert.ok(C.cleanName("x".repeat(300) + ".jpeg").endsWith(".jpeg"));
});

test("manifests: duplicates made unique, bad input refused as a whole", () => {
  const m = C.buildManifest([{ path: "A/x.txt", size: 3 }, { path: "a/X.txt", size: 4 }, { path: "", size: 1 }]);
  assert.deepEqual(m.map((f) => f.p), ["A/x.txt", "a/X (2).txt"]);
  const ok = C.checkManifest([{ p: "../x", s: 5, m: 1 }, { p: "x", s: 0 }]);
  assert.deepEqual(ok.files.map((f) => f.p), ["x", "x (2)"]);
  assert.equal(ok.total, 5);
  assert.equal(C.checkManifest([{ p: "x", s: -1 }]), null);
  assert.equal(C.checkManifest([{ p: "x", s: 1.5 }]), null);
  assert.equal(C.checkManifest([{ p: "..", s: 1 }]), null);
  assert.equal(C.checkManifest([]), null);
  assert.equal(C.checkManifest("x"), null);
  assert.equal(C.freeName("a.txt", (n) => n === "a.txt" || n === "a (2).txt"), "a (3).txt");
  const big = C.buildManifest(Array.from({ length: 3000 }, (_, i) => ({ path: "dir/file-" + i + ".txt", size: i })));
  const parts = C.splitManifest(big);
  assert.ok(parts.length > 1);
  assert.equal([].concat.apply([], parts).length, 3000);
});

// ---------- 6. Whole transfers ----------
test("a folder goes from sender to receiver, every file whole, in order", async () => {
  const files = randomFiles([["Photos/a.jpg", 200000], ["Photos/sub/b.txt", 5], ["empty.txt", 0], ["c.bin", C.PIECE * 3]]);
  const t = pair(files);
  t.sender.start();
  await until(() => t.sLast().p === "wait");
  t.receiver.start();
  await until(() => t.rLast().p === "offer");
  const offer = t.rLast();
  assert.deepEqual(offer.files.map((f) => f.p), ["Photos/a.jpg", "Photos/sub/b.txt", "empty.txt", "c.bin"]);
  assert.equal(offer.total, 200005 + C.PIECE * 3);
  assert.equal(t.sLast().p, "offered");
  const sink = memSink();
  assert.ok(t.receiver.accept(sink));
  await until(() => t.rLast().p === "done" && t.sLast().p === "done");
  assert.deepEqual(t.rLast().bad, []);
  assert.deepEqual(t.sLast().bad, []);
  files.forEach((f, i) => {
    assert.ok(sink.out[i].data.equals(f.bytes), f.path);
    assert.equal(sink.out[i].ok, true);
  });
  assert.deepEqual(sink.events.filter((e) => e[0] === "open").map((e) => e[1]), [0, 1, 2, 3]);
  // The relay saw only sealed frames and no file bytes.
  const plain = t.relay.frames.join("");
  assert.ok(!/Photos|a\.jpg/.test(plain), "names never reach the relay");
  assert.ok(t.relay.frames.every((f) => f.length < 16384), "every room frame fits the relay's limit");
  assert.ok(t.sProg.length && t.sProg[t.sProg.length - 1].bytes === offer.total);
});

test("the sender never runs far ahead of what the receiver has written", async () => {
  const files = randomFiles([["big.bin", C.PIECE * 700]]);
  const t = pair(files);
  let maxAhead = 0, slow = 0;
  const sink = memSink(), w = sink.write;
  sink.write = (i, b) => new Promise((res) => {
    maxAhead = Math.max(maxAhead, t.rtc.log.binary - (++slow));
    setTimeout(() => { w(i, b); res(); }, slow % 50 === 0 ? 5 : 0);
  });
  t.sender.start(); t.receiver.start();
  await until(() => t.rLast().p === "offer");
  t.receiver.accept(sink);
  await until(() => t.rLast().p === "done", 20000);
  assert.ok(sink.out[0].data.equals(files[0].bytes));
  assert.ok(maxAhead <= E.WINDOW + 1, "at most WINDOW pieces in flight, saw " + maxAhead);
});

test("a file that does not match its hash is reported, never passed off as whole", async () => {
  const files = randomFiles([["good.txt", 1000], ["bad.txt", 1000]]);
  // The sender's disk changes under it: it reads other bytes than it hashed? No:
  // here the sink corrupts nothing, the sender lies about one file's hash.
  const t = pair(files);
  const real = C.seal;
  t.sender.start(); t.receiver.start();
  await until(() => t.rLast().p === "offer");
  C.seal = function (key, from, obj) {
    if (from === "sender" && obj.t === "end" && obj.i === 1) obj = Object.assign({}, obj, { h: "0".repeat(64) });
    return real.call(this, key, from, obj);
  };
  const sink = memSink();
  t.receiver.accept(sink);
  try { await until(() => t.rLast().p === "done" && t.sLast().p === "done"); } finally { C.seal = real; }
  assert.deepEqual(t.rLast().bad, [1]);
  assert.deepEqual(t.sLast().bad, [1]);
  assert.equal(sink.out[0].ok, true);
  assert.equal(sink.out[1].ok, false, "the sink is told to drop it");
});

test("declining and cancelling end both sides", async () => {
  {
    const t = pair(randomFiles([["a", 10]]));
    t.sender.start(); t.receiver.start();
    await until(() => t.rLast().p === "offer");
    t.receiver.decline();
    await until(() => t.sLast().p === "error" && t.rLast().p === "error");
    assert.equal(t.sLast().e, "declined");
  }
  {
    const t = pair(randomFiles([["a", C.PIECE * 400]]));
    t.sender.start(); t.receiver.start();
    await until(() => t.rLast().p === "offer");
    t.receiver.accept(memSink());
    await until(() => t.rtc.log.binary > 20);
    t.sender.cancel();
    await until(() => t.rLast().p === "error");
    assert.equal(t.rLast().e, "cancelled");
    assert.equal(t.sLast().e, "cancelled");
  }
});

for (const at of [120, 299, 301]) {
  test("a dropped direct link comes back and the transfer goes on from where it stopped (drop after " + at + " pieces)", async () => {
    const files = randomFiles([["a.bin", C.PIECE * 300], ["b.bin", C.PIECE * 50 + 7]]);
    const t = pair(files, { rtcOpts: { dropAfter: at } });
    t.sender.start(); t.receiver.start();
    await until(() => t.rLast().p === "offer");
    const sink = memSink();
    t.receiver.accept(sink);
    await until(() => t.rLast().p === "done" && t.sLast().p === "done", 20000);
    assert.ok(t.rtc.log.dropped, "the link really dropped");
    assert.ok(t.rStates.includes("reconnecting") && t.sStates.includes("reconnecting"));
    assert.deepEqual(t.rLast().bad, []);
    assert.deepEqual(t.sLast().bad, []);
    files.forEach((f, i) => assert.ok(sink.out[i].data.equals(f.bytes), f.path));
    assert.ok(t.rtc.log.binary < 301 + 51 + E.WINDOW + 2, "resumed, not started over: " + t.rtc.log.binary + " pieces");
  });
}

test("a wrong code never meets the sender; a third browser cannot join", async () => {
  const files = randomFiles([["a", 10]]);
  const t = pair(files, { rcode: "7K2M9QXH4RTB", code: "7K2M9QXH4RTC" });
  t.sender.start(); t.receiver.start();
  await until(() => t.rLast().p === "wait" && t.sLast().p === "wait");
  t.sender.cancel(); t.receiver.cancel();

  const u = pair(files);
  u.sender.start(); u.receiver.start();
  await until(() => u.rLast().p === "offer");
  const third = new E.Transfer({ role: "receiver", code: u.code, relay: "https://relay.test", WebSocket: u.relay.WebSocket(), RTCPeerConnection: u.rtc.PC, onState: (p, i) => { third.last = Object.assign({ p }, i); } });
  third.start();
  await until(() => third.last && third.last.p === "error", 20000);
  assert.equal(third.last.e, "noroom");
  assert.ok(u.relay.full >= 1);
  u.receiver.accept(memSink());
  await until(() => u.rLast().p === "done");
});

test("a link that does not come back ends both sides as lost", async () => {
  const t = pair(randomFiles([["a", C.PIECE * 400]]), { rtcOpts: { dropAfter: 30, noReturn: true } });
  const real = global.setTimeout;
  global.setTimeout = (f, ms, ...a) => real(f, ms >= 25000 ? 30 : ms, ...a);
  try {
    t.sender.start(); t.receiver.start();
    await until(() => t.rLast().p === "offer");
    t.receiver.accept(memSink());
    await until(() => t.rLast().p === "error" && t.sLast().p === "error");
  } finally { global.setTimeout = real; }
  assert.ok(t.rStates.includes("reconnecting"));
  assert.equal(t.rLast().e, "lost");
  assert.equal(t.sLast().e, "lost");
});

test("no direct link, small transfer: it goes through the relay, sealed, in small frames", async () => {
  const files = randomFiles([["notes/a.txt", 20000], ["b.bin", 30000], ["empty", 0]]);
  const t = pair(files, { rtcOpts: { noDirect: true } });
  const real = global.setTimeout;
  global.setTimeout = (f, ms, ...a) => real(f, ms >= 25000 ? 30 : ms, ...a);
  const sink = memSink();
  try {
    t.sender.start(); t.receiver.start();
    await until(() => t.rLast().p === "offer");
    assert.equal(t.rLast().mode, "relay");
    t.receiver.accept(sink);
    await until(() => t.rLast().p === "done" && t.sLast().p === "done", 20000);
  } finally { global.setTimeout = real; }
  assert.deepEqual(t.rLast().bad, []);
  files.forEach((f, i) => assert.ok(sink.out[i].data.equals(f.bytes), f.path));
  assert.equal(t.rtc.log.binary, 0, "nothing went over a data channel");
  assert.ok(t.relay.frames.every((f) => f.length < 16384), "every room frame fits the relay's limit");
  const plain = t.relay.frames.join("");
  assert.ok(!/notes|a\.txt/.test(plain), "names never reach the relay");
  assert.ok(!plain.includes(files[0].bytes.subarray(0, 64).toString("base64")), "file bytes never reach the relay in the clear");
  const pieceAt = t.relay.times.filter((_, k) => t.relay.frames[k].charAt(0) === "~");
  assert.ok(pieceAt.length >= 6, "pieces of " + E.RELAY_PIECE + " bytes");
  for (let k = 1; k < pieceAt.length; k++) assert.ok(pieceAt[k] - pieceAt[k - 1] >= 25, "pieces are paced under the relay's frame limit");
});

// ---------- D1: the sender's title and message (TRANSFER-META) ----------
test("meta: plain text only, trimmed to size, control and bidi characters dropped", () => {
  assert.equal(C.cleanMeta(null), null);
  assert.equal(C.cleanMeta({ t: "  ", m: "\u0000" }), null);
  assert.equal(C.cleanMeta({ t: 5, m: {} }), null);
  assert.deepEqual(C.cleanMeta({ t: "Wedding\nphotos‮", m: "Hi Eleni,\r\n\r\n\r\n\r\nall of them.​" }), { t: "Wedding photos", m: "Hi Eleni,\n\nall of them." });
  const long = C.cleanMeta({ t: "α".repeat(200), m: ("line\n").repeat(40) + "x".repeat(900) });
  assert.equal(long.t.length, C.META_T);
  assert.ok(long.m.length <= C.META_M);
  assert.ok(long.m.split("\n").length <= 12);
  assert.deepEqual(C.cleanMeta({ t: "<b>hi</b>" }), { t: "<b>hi</b>", m: "" }, "kept as text: the page shows it with textContent");
});

test("meta: the title and message arrive with the offer, sealed; none means null", async () => {
  const files = randomFiles([["a.txt", 1000], ["b.txt", 2000]]);
  const meta = { t: "Οι φωτογραφίες του γάμου", m: "Ελένη, όλες σε πλήρη ανάλυση." };
  const t = pair(files, { meta });
  t.sender.start(); t.receiver.start();
  await until(() => t.rLast().p === "offer");
  assert.deepEqual(t.rLast().meta, meta);
  assert.ok(!t.relay.frames.join("").includes("Ελένη"), "the message never reaches the relay in the clear");
  t.receiver.decline();
  const u = pair(files);
  u.sender.start(); u.receiver.start();
  await until(() => u.rLast().p === "offer");
  assert.equal(u.rLast().meta, null);
  u.receiver.decline();
});

test("meta: through the relay too, with a long list of Greek names, frames under the limit", async () => {
  const spec = []; for (let i = 0; i < 160; i++) spec.push(["φάκελος με μεγάλο όνομα/αρχείο αριθμός " + i + ".txt", 10]);
  const files = randomFiles(spec);
  const meta = { t: "Τ".repeat(80), m: "Μ".repeat(500) };
  const t = pair(files, { meta, rtcOpts: { noDirect: true } });
  const real = global.setTimeout;
  global.setTimeout = (f, ms, ...a) => real(f, ms >= 25000 ? 30 : ms, ...a);
  try {
    t.sender.start(); t.receiver.start();
    await until(() => t.rLast().p === "offer", 20000);
  } finally { global.setTimeout = real; }
  assert.equal(t.rLast().mode, "relay");
  assert.deepEqual(t.rLast().meta, meta);
  assert.equal(t.rLast().files.length, 160);
  assert.ok(t.relay.frames.every((f) => f.length < 16384), "every room frame fits the relay's limit");
  t.receiver.decline();
});

test("no direct link, more than 50 MB: the transfer says so", async () => {
  const size = E.RELAY_MAX + 1;
  const t = pair([{ path: "big.iso", size, mtime: 1 }], { rtcOpts: { noDirect: true }, read: () => Promise.reject(new Error("never read")) });
  const real = global.setTimeout;
  global.setTimeout = (f, ms, ...a) => real(f, ms >= 25000 ? 30 : ms, ...a);
  try {
    t.sender.start(); t.receiver.start();
    await until(() => t.sLast().p === "error" && t.rLast().p === "error");
  } finally { global.setTimeout = real; }
  assert.equal(t.sLast().e, "nodirect");
  assert.equal(t.rLast().e, "nodirect");
});

// ---------- 7. History (synced slice "transfer") ----------
test("history: union by id, tombstones remove, canonical and order-free, nothing private", () => {
  const now = Date.now();
  const a = C.historyItem({ id: "t0000000000000001", at: now - 5000, dir: "sent", files: [{ p: "Photos/a.jpg", s: 10 }, { p: "Photos/b.jpg", s: 5 }, { p: "x.txt", s: 1 }], dev: "Chrome · Linux", bad: [2], mode: "relay", end: "done" });
  const b = C.historyItem({ id: "t0000000000000002", at: now - 1000, dir: "recv", files: [{ p: "song.flac", s: 99 }], dev: "Firefox · Android", dest: "disk", folder: "/internal/Transfers/2026-11-13 05.30", end: "done" });
  assert.deepEqual([a.what, a.n, a.bytes, a.bad, a.mode], ["Photos, x.txt", 3, 16, 1, "relay"]);
  assert.ok(!JSON.stringify(a).includes("a.jpg"), "only top names are kept");
  const left = C.mergeHistory({ items: [a] }, null), right = C.mergeHistory({ items: [b] }, null);
  const m1 = C.mergeHistory(left, right), m2 = C.mergeHistory(right, left);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2), "commutative");
  assert.equal(JSON.stringify(C.mergeHistory(m1, m1)), JSON.stringify(m1), "idempotent");
  assert.deepEqual(m1.items.map((x) => x.id), [b.id, a.id], "newest first");
  const cleared = C.mergeHistory(m1, { tombs: { [a.id]: now } });
  assert.deepEqual(cleared.items.map((x) => x.id), [b.id]);
  assert.deepEqual(C.mergeHistory(cleared, left).items.map((x) => x.id), [b.id], "a cleared entry does not come back from an old copy");
  // bad input is dropped, not trusted
  const bad = C.mergeHistory({ items: [{ id: "../x", at: 1 }, { id: "tok123", at: -1 }, { id: "tok456", at: 5, folder: "/internal/Notes/../x", what: "a\u0000b" }], tombs: { "<x>": 5 } }, null);
  assert.deepEqual(bad.items.map((x) => [x.id, x.folder, x.what]), [["tok456", "", "ab"]]);
  assert.deepEqual(bad.tombs, {});
  const many = { items: Array.from({ length: 250 }, (_, i) => ({ id: "t" + String(i).padStart(6, "0"), at: 1000 + i })) };
  assert.equal(C.mergeHistory(many, null).items.length, C.HIST_MAX);
});

test("wiring: History slice, Files hand-off, relay and reconnecting texts", () => {
  const app = fs.readFileSync(path.join(__dirname, "../transfer/app.js"), "utf8");
  assert.ok(app.includes("api.registerSlice(APP_ID, sliceGet, sliceSet, C.HIST_KEY, C.mergeHistory)"));
  assert.ok(app.includes("Array.isArray(target.send)"));
  for (const k of ["st.reconnecting", "st.sendingRelay", "st.receivingRelay", "offer.relay", "tab.hist", "hist.clear"]) {
    assert.equal(app.split('"' + k + '": ').length - 1, 2, k + " in EN and EL");
  }
  const files = fs.readFileSync(path.join(__dirname, "../files/files.js"), "utf8");
  assert.ok(files.includes('__orosOpenAt("transfer", { send: paths })'));
  assert.equal(files.split('"menu.transfer"').length - 1, 4, "EN, EL, context menu, selection bar");
  for (const f of ["index.html", "receive.html"]) assert.ok(fs.readFileSync(path.join(__dirname, "../transfer", f), "utf8").includes('id="offer-relay"'), f);
});
