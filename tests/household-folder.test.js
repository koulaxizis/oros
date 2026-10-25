// Household wave 7g: a household in a shared WebDAV / Nextcloud folder
// (household/folder.js) instead of the orOS relay.
// 1. The whole engine suite runs again against an in-memory WebDAV
//    server (OROS_HH=folder): create, invite, approval, shared lists,
//    removal with key rotation, leaving, a second device, delete.
// 2. The folder's own rules: two writers of one revision cannot both
//    win, the probe refuses a server that ignores If-None-Match, codes
//    carry the folder and a password hides it.
// Run: node --test tests/

"use strict";

process.env.OROS_HH = "folder";

const test = require("node:test");
const assert = require("node:assert/strict");

test.describe("folder: household-engine", () => { require("./household-engine.test.js"); });

const F = require("../household/folder.js");
const X = require("../household/crypto.js");
const { FakeWebDAV } = require("./harness");
const CONF = { url: "https://dav.test/remote.php/dav/files/u/orOS", user: "u", pass: "app-pass" };
const BOX = "AAAAAAAAAAAAAAAAAAAAAA";

test("two writers of one revision: one wins, the other is told to read again", async () => {
  const dav = new FakeWebDAV();
  const f = F.make({ fetch: dav.fetchFor("x") });
  assert.equal((await f.request(CONF, "POST", BOX, "", {})).status, 200);
  assert.equal((await f.request(CONF, "POST", BOX, "", {})).status, 409, "made once");
  const put = (rev, t) => f.request(CONF, "PUT", BOX, "/d/k1", { rev, bytes: Buffer.from(t) });
  assert.deepEqual((await (await put(0, "a")).json()).data, { rev: 1 });
  assert.equal((await put(1, "b")).status, 200);
  assert.equal((await put(1, "c")).status, 412, "the second writer of rev 1 reads again");
  // between the two steps of another writer (rev 2 made, rev 1 not yet
  // deleted): rev 2 counts, a writer of rev 2 cannot make it again
  dav.put("/oros-hh-" + BOX + "/d/k1.1", "left behind");
  assert.equal((await put(1, "d")).status, 412);
  const info = await (await f.request(CONF, "GET", BOX, "", { epoch: 1 })).json();
  assert.deepEqual(info.data.revs, { k1: 2 });
  const g = await f.request(CONF, "GET", BOX, "/d/k1", {});
  assert.equal(g.headers.get("X-Rev"), "2");
  assert.equal([...dav.files.keys()].filter((k) => k.includes("/d/")).length, 1, "the old revision is gone");
  // a newer key epoch in the folder: "moved"
  assert.deepEqual((await (await f.request(CONF, "GET", BOX, "", { epoch: 0.5 })).json()).data.moved, true);
});

test("the probe refuses a server that ignores conditions, and wrong sign-ins", async () => {
  const dav = new FakeWebDAV();
  const f = F.make({ fetch: dav.fetchFor("x") });
  assert.equal(await f.probe(CONF), "");
  assert.ok(![...dav.files.keys()].some((k) => /probe/.test(k)), "the probe file is gone");
  dav.ignoreConditions = true;
  assert.equal(await f.probe(CONF), "dav-cond");
  dav.ignoreConditions = false;
  assert.equal(await f.probe(Object.assign({}, CONF, { pass: "nope" })), "dav-auth");
  assert.equal(await f.probe({ url: "http://dav.test/x" }), "dav-url");
});

test("through the orOS relay: the same requests with X-Oros-Target", async () => {
  const dav = new FakeWebDAV();
  const f = F.make({ fetch: dav.fetchFor("x") });
  assert.equal(await f.probe(Object.assign({ relay: true }, CONF)), "");
  assert.ok(dav.log.some((e) => e.op === "relay"));
});

test("codes carry the folder; a password hides it", async () => {
  X._setIter(1000);
  const I = X.rand(32);
  const open = await X.makeCode(BOX, I, "", CONF);
  assert.match(open, /^h3\./);
  assert.deepEqual(X.parseCode("https://useoros.online/share/#" + open), { box: BOX, secret: I, locked: false, dav: Object.assign({ relay: false }, CONF) });
  const locked = await X.makeCode(BOX, I, "pw", CONF);
  assert.match(locked, /^h4\./);
  assert.ok(!locked.includes("dav.test") && !Buffer.from(locked.split(".")[3].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1").includes("dav.test"));
  const p = X.parseCode(locked);
  assert.equal(p.locked, true);
  const u = await X.unlock(p, "pw");
  assert.equal(u.secret, I);
  assert.equal(u.dav.url, CONF.url);
  // the relay codes are as before
  assert.match(await X.makeCode(BOX, I, ""), /^h1\./);
  assert.deepEqual(await X.unlock(X.parseCode(await X.makeCode(BOX, I, "pw")), "pw"), { box: BOX, secret: I, locked: false });
  X._setIter(600000);
});
