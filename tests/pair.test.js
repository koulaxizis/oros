// PAIR-1 — Add a browser: a new browser gets the cloud sign-in and the
// sync passphrase from a signed-in device, end-to-end encrypted through
// a relay room (pair.js), then adopts them (sync.js pairAdopt).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../pair.js");
const { FakeDropbox, FakeWebDAV, RealFakeDropbox, createDevice, reboot, writeKey, readKey } = require("./harness");

// ---------- A relay room that behaves like relay/remote.js ----------
// One room per path, at most two sockets, frames forwarded as they
// are, {"sys":"wait"|"peer"|"left"} control frames; a third socket is
// refused before it opens. `frames` keeps everything the relay saw.
class FakeRelay {
  constructor() { this.rooms = new Map(); this.frames = []; this.urls = []; }
  WebSocket() {
    const relay = this;
    return class FakeSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        relay.urls.push(url);
        const room = relay.rooms.get(url) || [];
        relay.rooms.set(url, room);
        setTimeout(() => {
          if (room.length >= 2) { this.readyState = 3; this.onclose && this.onclose({ code: 1006 }); return; }
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
        relay.frames.push(data);
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
      // The relay closes an idle room (REMOTE_LIMITS.idleMs).
      static expire(url) {
        for (const s of (relay.rooms.get(url) || []).slice()) {
          s.readyState = 3;
          setTimeout(() => s.onclose && s.onclose({ code: 1001 }), 1);
        }
        relay.rooms.set(url, []);
      }
    };
  }
}

function until(fn, ms = 4000) {
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

function session(relay, o) {
  const log = [];
  const s = new P.Session(Object.assign({ WebSocket: relay.WebSocket(), relay: "https://relay.test" }, o, {
    onState: (p, i) => log.push(Object.assign({ p }, i))
  }));
  s.log = log;
  s.last = () => log[log.length - 1] || {};
  return s;
}

// ---------- Codes ----------
test("codes: 12 Crockford characters, typed in any form", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = P.newCode();
    assert.match(c, P.CODE_RE);
    seen.add(c);
  }
  assert.ok(seen.size > 195, "random");
  const c = "7K2M9QXH4RTB";
  assert.equal(P.fmtCode(c), "7K2M-9QXH-4RTB");
  assert.equal(P.normCode(" 7k2m-9qxh-4rtb "), c);
  assert.equal(P.normCode("ABCD-EFGH-IJLO"), "ABCD-EFGH-1J10".replace(/-/g, ""), "I, L → 1 and O → 0");
  assert.equal(P.normCode("7K2M9QXH4RT"), "", "too short");
  assert.equal(P.normCode("7K2M9QXH4RTU"), "", "U is not in the alphabet");
  assert.equal(P.codeFromText("https://useoros.online/#pair=7K2M-9QXH-4RTB"), c);
  assert.equal(P.codeFromText("7k2m 9qxh 4rtb"), c);
  assert.equal(P.codeFromText("https://evil.test/?x=1"), "");
});

test("the QR address: this origin when public, useoros.online for a local copy", () => {
  const c = "7K2M9QXH4RTB";
  assert.equal(P.qrText(c, "https://useoros.online"), "https://useoros.online/#pair=7K2M-9QXH-4RTB");
  assert.equal(P.qrText(c, "https://my.example.org/"), "https://my.example.org/#pair=7K2M-9QXH-4RTB");
  for (const o of ["http://127.0.0.1:8085", "https://localhost:3000", "https://192.168.1.4", "https://nas.local", "file://", ""]) {
    assert.equal(P.qrText(c, o), "https://useoros.online/#pair=7K2M-9QXH-4RTB", o);
  }
});

test("browser labels tell browsers apart without the whole user agent", () => {
  assert.equal(P.browserLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"), "Chrome · Windows");
  assert.equal(P.browserLabel("Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0"), "Firefox · Linux");
  assert.equal(P.browserLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36 EdgA/131 Edg/131"), "Edge · Android");
  assert.equal(P.browserLabel(""), "Browser");
});

// ---------- Frames ----------
test("frames: sealed per sender role, wrong key or role gives null", async () => {
  const a = await P.derive("7K2M9QXH4RTB"), b = await P.derive("7K2M9QXH4RTC");
  assert.match(a.room, /^[0-9a-f]{64}$/);
  assert.notEqual(a.room, b.room);
  const f = await P.seal(a.key, "old", { t: "hi", n: "x" });
  assert.deepEqual(await P.unseal(a.key, "old", f), { t: "hi", n: "x" });
  assert.equal(await P.unseal(a.key, "new", f), null, "a frame cannot be reflected to its sender");
  assert.equal(await P.unseal(b.key, "old", f), null, "another code");
  assert.equal(await P.unseal(a.key, "old", "not base64 !"), null);
  assert.equal(await P.unseal(a.key, "old", f.slice(0, -4) + "AAAA"), null, "tampered");
  const n1 = await P.checkNumber("7K2M9QXH4RTB", "a".repeat(32), "b".repeat(32));
  assert.match(n1, /^\d{4}$/);
  assert.equal(n1, await P.checkNumber("7K2M9QXH4RTB", "a".repeat(32), "b".repeat(32)));
  assert.notEqual(await P.checkNumber("7K2M9QXH4RTB", "a".repeat(32), "c".repeat(32)) + n1, n1 + n1);
});

// ---------- Sessions ----------
test("a whole pairing: same number on both sides, bundle only after approval, relay sees ciphertext", async () => {
  const relay = new FakeRelay(), code = P.newCode();
  let got = null;
  const N = session(relay, { role: "new", code, dev: "Firefox · Linux", onBundle: (b) => { got = b; return Promise.resolve(); } });
  N.start();
  await until(() => N.phase === "wait");
  const secret = { v: 1, p: "dropbox", r: "refresh-SECRET-123", pw: "passphrase-SECRET" };
  let asked = 0;
  const O = session(relay, { role: "old", code, dev: "Chrome · Android", bundle: () => { asked++; return Promise.resolve(secret); } });
  O.start();
  await until(() => O.phase === "approve" && N.phase === "peer");
  assert.equal(O.last().check, N.last().check, "the same confirmation number");
  assert.equal(O.last().dev, "Firefox · Linux");
  assert.equal(N.last().dev, "Chrome · Android");
  assert.equal(asked, 0, "nothing is sent before the approval");
  assert.equal(got, null);
  await O.approve();
  await until(() => O.phase === "done" && N.phase === "done");
  assert.deepEqual(got, secret);
  assert.equal(asked, 1);
  const seen = relay.frames.join("\n") + relay.urls.join("\n");
  assert.ok(!seen.includes("SECRET"), "the relay never sees the bundle");
  assert.ok(!seen.includes(code), "nor the code");
  assert.equal(await O.approve(), false, "one bundle per code");
});

test("a code nobody waits with ends at once; a third device is refused", async () => {
  const relay = new FakeRelay();
  const O = session(relay, { role: "old", code: P.newCode(), bundle: () => Promise.reject(new Error("never")) });
  O.start();
  await until(() => O.phase === "error");
  assert.equal(O.last().e, "nocode");

  const code = P.newCode();
  const N = session(relay, { role: "new", code, onBundle: () => Promise.resolve() });
  N.start();
  await until(() => N.phase === "wait");
  const O1 = session(relay, { role: "old", code, bundle: () => Promise.resolve({}) });
  O1.start();
  await until(() => O1.phase === "approve");
  const O2 = session(relay, { role: "old", code, bundle: () => Promise.resolve({}) });
  O2.start();
  await until(() => O2.phase === "error");
  assert.equal(O2.last().e, "busy");
  O1.cancel();
  await until(() => N.phase === "error");
  assert.equal(N.last().e, "left");
});

test("an idle room closes: the code expired", async () => {
  const relay = new FakeRelay(), WS = relay.WebSocket();
  const N = new P.Session({ role: "new", code: P.newCode(), WebSocket: WS, relay: "https://relay.test", onBundle: () => Promise.resolve(), onState: () => {} });
  N.start();
  await until(() => N.phase === "wait");
  WS.expire(relay.urls[0]);
  await until(() => N.phase === "error");
});

test("a bundle the new browser cannot use is reported back to the signed-in device", async () => {
  const relay = new FakeRelay(), code = P.newCode();
  const N = session(relay, { role: "new", code, onBundle: () => Promise.reject(new Error("pair-connected")) });
  N.start();
  await until(() => N.phase === "wait");
  const O = session(relay, { role: "old", code, bundle: () => Promise.resolve({ v: 1 }) });
  O.start();
  await until(() => O.phase === "approve");
  await O.approve();
  await until(() => O.phase === "error" && N.phase === "error");
  assert.equal(O.last().e, "refused");
  assert.equal(O.last().why, "pair-connected");
  assert.equal(N.last().e, "refused");
});

test("a bad code never opens a room", async () => {
  const relay = new FakeRelay();
  const O = session(relay, { role: "old", code: "nope", bundle: () => Promise.resolve({}) });
  O.start();
  await until(() => O.phase === "error");
  assert.equal(O.last().e, "bad");
  assert.equal(relay.urls.length, 0);
});

// ---------- sync.js: bundle and adopt ----------
const SLICES = { "oros-slices": { notes: "app-notes" } };

test("Dropbox: the new browser adopts the sign-in, syncs, and signs out only itself", async () => {
  const db = new RealFakeDropbox();
  const A = await createDevice(db, "A", SLICES);
  writeKey(A, "app-notes", { items: { a: { v: "from A", t: 1 } } });
  A.sync.markDirty();
  await A.sync.push();

  const b = await A.sync.pairBundle();
  assert.equal(b.p, "dropbox");
  assert.equal(b.r, "refresh-A");
  assert.equal(typeof b.pw, "string");

  const B = await createDevice(db, "B", SLICES, { connect: false });
  B.sync.forgetPassphrase();
  assert.equal(B.sync.isConnected(), false);
  const r = await B.sync.pairAdopt(JSON.parse(JSON.stringify(b)), { session: false });
  assert.equal(r.provider, "dropbox");
  assert.equal(B.sync.isConnected(), true);
  assert.equal(B.sync.isPaired(), true);
  assert.equal(B.localStorage.getItem("oros-db-refresh"), "refresh-A");
  B.sync.setPassphrase(r.pw, false);
  await B.sync.pull();
  assert.deepEqual(readKey(B, "app-notes"), { items: { a: { v: "from A", t: 1 } } });

  await assert.rejects(B.sync.pairAdopt(b, {}), /pair-connected/, "a signed-in browser adopts nothing");

  const res = await B.sync.disconnectRevoke(1000);
  assert.equal(res.paired, true);
  assert.equal(res.revoked, false);
  assert.equal(db.log.filter((e) => e.op === "revoke").length, 0, "the shared token was not revoked");
  assert.equal(B.sync.isConnected(), false);
  assert.equal(B.sync.isPaired(), false);

  assert.equal(A.sync.isPaired(), true, "the device that let it in shares its sign-in now");
  const resA = await A.sync.disconnectRevoke(1000);
  assert.equal(resA.paired, true);
  assert.equal(resA.revoked, false, "its Disconnect does not sign the new browser out either");
  assert.equal(db.log.filter((e) => e.op === "revoke").length, 0);

  const C = await createDevice(db, "C", SLICES);
  const resC = await C.sync.disconnectRevoke(1000);
  assert.equal(resC.paired, false);
  assert.equal(resC.revoked, true, "a sign-in nobody shares is still revoked");
});

test("only for this session: a later visit (new tab) forgets the sign-in; a locked device hands out nothing", async () => {
  const db = new RealFakeDropbox();
  const A = await createDevice(db, "A", SLICES);
  const b = await A.sync.pairBundle();
  const B = await createDevice(db, "B", SLICES, { connect: false });
  await B.sync.pairAdopt(b, { session: true });
  assert.equal(B.localStorage.getItem("oros-sync-session"), "1");
  assert.equal(B.ctx.sessionStorage.getItem("oros-sync-session"), "1");
  const B2 = await reboot(db, B);            // fresh sessionStorage = the tab was closed
  assert.equal(B2.sync.isConnected(), false);
  assert.equal(B2.localStorage.getItem("oros-db-refresh"), null);
  assert.equal(B2.localStorage.getItem("oros-sync-session"), null);

  A.sync.forgetPassphrase();
  await assert.rejects(A.sync.pairBundle(), /pair-locked/);
});

test("adopt refuses bundles of the wrong shape and leaves nothing behind", async () => {
  const db = new RealFakeDropbox();
  const B = await createDevice(db, "B", SLICES, { connect: false });
  const bad = [null, {}, { v: 2, p: "dropbox", r: "refresh-xxxxxxxx", pw: "x" }, { v: 1, p: "dropbox", r: "short", pw: "x" },
    { v: 1, p: "dropbox", r: "refresh-xxxxxxxx" }, { v: 1, p: "ftp", pw: "x" },
    { v: 1, p: "dropbox", r: "refresh with spaces", pw: "x" },
    { v: 1, p: "webdav", c: { url: "javascript:alert(1)", user: "u" }, s: "p", pw: "x" }];
  for (const b of bad) {
    await assert.rejects(B.sync.pairAdopt(b, {}), /pair-bad|storage-full/, JSON.stringify(b));
    assert.equal(B.sync.isConnected(), false);
    assert.equal(B.localStorage.getItem("oros-sync-paired"), null);
  }
});

test("WebDAV: the app password travels and Disconnect keeps it on the server", async () => {
  const dav = new FakeWebDAV();
  const A = await createDevice(dav, "A", SLICES);
  writeKey(A, "app-notes", { items: { a: { v: "dav", t: 1 } } });
  A.sync.markDirty();
  await A.sync.push();
  const b = await A.sync.pairBundle();
  assert.equal(b.p, "webdav");
  const B = await createDevice(dav, "B", SLICES, { connect: false });
  B.sync.forgetPassphrase();
  const r = await B.sync.pairAdopt(b, {});
  assert.equal(r.provider, "webdav");
  assert.equal(B.sync.getProvider(), "webdav");
  B.sync.setPassphrase(r.pw, false);
  await B.sync.pull();
  assert.deepEqual(readKey(B, "app-notes"), { items: { a: { v: "dav", t: 1 } } });
  const res = await B.sync.disconnectRevoke(1000);
  assert.equal(res.paired, true);
  assert.equal(dav.log.filter((e) => e.op === "revoke").length, 0);
});

void FakeDropbox;
