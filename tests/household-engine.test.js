// Household engine (household/engine.js) end to end: several people,
// each with their own engine, against the real relay code
// (relay/core.js + relay/house.js, storage stand-ins from house-fake.js).
// Covers: create, invite, join with approval, shared documents, offline
// edits from two sides (no loss, no endless uploads, 412 path), removal
// with key rotation (the removed person is locked out, a later member
// reads older documents), leaving, unsharing, the archive, and a second
// device of the same person through the membership slice.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../household/engine.js");
const Core = require("../household/core.js");
const X = require("../household/crypto.js");
const fake = require("./house-fake.js");
let handle;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  await fake.load();
  X._setIter(1000);
});
test.after(() => X._setIter(600000));

let clock = 1.75e12;
// OROS_HH=folder (tests/household-folder.test.js): the same suite against
// a household in a shared WebDAV folder (household/folder.js, wave 7g).
const FOLDER = process.env.OROS_HH === "folder";
const DAV = FOLDER ? { url: "https://dav.test/remote.php/dav/files/u/orOS", user: "u", pass: "app-pass" } : undefined;
function folderWorld() {
  const { FakeWebDAV } = require("./harness");
  const dav = new FakeWebDAV();
  const w = { dav, calls: [] };
  const f = dav.fetchFor("x");
  w.fetch = async (url, init) => {
    clock += 10;
    w.calls.push(init.method + " " + String(url).replace(/^https:\/\/[^/]+/, ""));
    return f(url, init);
  };
  return w;
}
function stored(w, box) {
  if (FOLDER) return Array.from(w.dav.files.entries()).filter(([k]) => k.includes("/oros-hh-" + box + "/d/")).map(([, f]) => f.data.toString("latin1")).join("");
  return Array.from(w.boxes.get(box).st.docs.values()).map((d) => Buffer.from(d.data).toString("latin1")).join("");
}
function relayWorld() {
  if (FOLDER) return folderWorld();
  const w = fake.world();
  w.calls = [];
  w.fetch = async (url, init) => {
    clock += 10;
    const h = Object.assign({ Origin: fake.ORIGIN, "CF-Connecting-IP": "10.1.1." + (w.calls.length % 200) }, init.headers || {});
    w.calls.push(init.method + " " + url.replace(/^https:\/\/[^/]+/, ""));
    return handle(new Request(url, Object.assign({}, init, { headers: h })), w.env, null, clock);
  };
  return w;
}
function person(w, name, sharedMem) {
  const rows = new Map();
  const memBox = sharedMem || { v: null };
  const pendBox = { v: null };
  const notes = [];
  const eng = E.create({
    fetch: w.fetch,
    store: {
      all: async () => Array.from(rows.values()).map((r) => JSON.parse(JSON.stringify(r))),
      put: async (r) => { rows.set(r.id, JSON.parse(JSON.stringify(r))); },
      del: async (id) => { rows.delete(id); }
    },
    membership: { load: () => memBox.v, save: (v) => { memBox.v = JSON.parse(JSON.stringify(v)); } },
    pending: { load: () => pendBox.v, save: (v) => { pendBox.v = JSON.parse(JSON.stringify(v)); } },
    now: () => (clock += 1),
    later: () => 0,                        // the tests call sync() themselves
    notify: (what, box, d) => notes.push(what),
    log: () => {}
  });
  return { eng, name, rows, memBox, notes };
}
const puts = (w) => w.calls.filter((c) => c.startsWith("PUT ") && c.includes("/d/")).length;

async function household() {
  const w = relayWorld();
  const ana = person(w, "Ana"), nik = person(w, "Nikos");
  await ana.eng.ready(); await nik.eng.ready();
  const box = await ana.eng.create("Home", "Ana", DAV);
  const inv = await ana.eng.invite(box, { days: 2, uses: 20 });
  assert.match(inv.link, FOLDER ? /\/share\/#h3\./ : /\/share\/#h1\./);
  const j = await nik.eng.join(inv.link, "Nikos");
  assert.deepEqual(j, { box, state: "wait" });
  await nik.eng.checkJoins();
  assert.equal(nik.eng.pending()[0].state, "wait");
  await ana.eng.sync(box);
  assert.ok(ana.notes.includes("req"));
  const rq = await ana.eng.requests(box);
  assert.equal(rq.length, 1);
  assert.equal(rq[0].name, "Nikos");
  await ana.eng.accept(box, rq[0].rid);
  await nik.eng.checkJoins();
  assert.deepEqual(nik.eng.pending(), []);
  assert.ok(nik.notes.includes("joined"));
  return { w, ana, nik, box };
}

test("create, invite, join with approval: both see the same roster", async () => {
  const { ana, nik, box } = await household();
  await ana.eng.sync(box);
  const a = ana.eng.list()[0], n = nik.eng.list()[0];
  assert.equal(n.name, "Home");
  assert.deepEqual(a.members.map((m) => m.name), ["Ana", "Nikos"]);
  assert.deepEqual(n.members.map((m) => m.name), ["Ana", "Nikos"]);
  assert.equal(a.members[0].admin, true);
  assert.equal(n.admin, false);
  assert.notEqual(a.members[0].color, a.members[1].color);
});

test("an invite with a password, a refused request, an expired code", async () => {
  const w = relayWorld();
  const ana = person(w, "Ana"), eva = person(w, "Eva");
  const box = await ana.eng.create("Flat", "Ana", DAV);
  const inv = await ana.eng.invite(box, { days: 1, uses: 1, password: "secret pass" });
  await assert.rejects(eva.eng.join(inv.link, "Eva"), /locked/);
  await assert.rejects(eva.eng.join(inv.link, "Eva", "wrong"), /password/);
  await eva.eng.join(inv.link, "Eva", "secret pass");
  await ana.eng.sync(box);
  const rq = await ana.eng.requests(box);
  await ana.eng.refuse(box, rq[0].rid);
  await eva.eng.checkJoins();
  assert.equal(eva.eng.pending()[0].state, "refused");
  eva.eng.dismissJoin(box);
  // one use only: a second request is refused by the relay
  await assert.rejects(eva.eng.join(inv.link, "Eva", "secret pass"), /expired/);
  await assert.rejects(eva.eng.join("not a code", "Eva"), /code/);
});

test("shared list: offline edits from both sides merge, then nothing more is uploaded", async () => {
  const { w, ana, nik, box } = await household();
  const id = await ana.eng.share(box, "todo", "Shopping", { set: { milk: { text: "Milk", done: false, o: 0 }, bread: { text: "Bread", done: false, o: 1 } } });
  await ana.eng.sync(box);
  await nik.eng.sync(box);
  assert.deepEqual(nik.eng.docs("todo").map((d) => [d.title, d.hh]), [["Shopping", "Home"]]);
  assert.deepEqual(nik.eng.view(box, id).items.map((i) => i.text), ["Milk", "Bread"]);
  // both offline: Ana ticks milk and adds eggs, Nikos renames bread and deletes nothing
  await ana.eng.change(box, id, { set: { milk: { done: true }, eggs: { text: "Eggs", o: 2 } } });
  await nik.eng.change(box, id, { set: { bread: { text: "Brown bread" } } });
  await ana.eng.sync(box);
  await nik.eng.sync(box);        // 412 → fetch, merge, upload again
  await ana.eng.sync(box);
  const va = ana.eng.view(box, id), vn = nik.eng.view(box, id);
  assert.deepEqual(va, vn);
  assert.deepEqual(va.items.map((i) => [i.text, !!i.done]), [["Milk", true], ["Brown bread", false], ["Eggs", false]]);
  assert.equal(va.items[1]._by, nik.eng.me(box));
  // converged: more passes upload nothing
  const before = puts(w);
  await ana.eng.sync(box); await nik.eng.sync(box); await ana.eng.sync(box);
  assert.equal(puts(w), before);
  // the relay only ever saw ciphertext
  const st = stored(w, box);
  assert.ok(st.length > 100);
  assert.ok(!st.includes("Milk") && !st.includes("Shopping") && !st.includes("Nikos"));
});

test("removing a member rotates the key: locked out, and a later member reads old documents", async () => {
  const { w, ana, nik, box } = await household();
  const id = await ana.eng.share(box, "todo", "Shopping", { set: { a: { text: "Soap" } } });
  await ana.eng.sync(box); await nik.eng.sync(box);
  const nikId = nik.eng.me(box);
  await ana.eng.removeMember(box, nikId);
  await ana.eng.sync(box);
  assert.equal(ana.eng.list()[0].epoch, 2);
  assert.deepEqual(ana.eng.list()[0].members.map((m) => m.name), ["Ana"]);
  // Nikos: his token is now a past one, his envelope is missing
  await ana.eng.change(box, id, { set: { b: { text: "Secret new item" } } });
  await ana.eng.sync(box);
  await nik.eng.sync(box);
  assert.equal(nik.eng.list()[0].status, "removed");
  assert.ok(nik.notes.includes("removed"));
  assert.equal(nik.eng.view(box, id).items.some((i) => i.text === "Secret new item"), false);
  // a new member after the rotation gets every key and reads the older parts too
  const eva = person(w, "Eva");
  const inv = await ana.eng.invite(box, { days: 2 });
  await eva.eng.join(inv.link, "Eva");
  await ana.eng.sync(box);
  const rq = await ana.eng.requests(box);
  await ana.eng.accept(box, rq[0].rid);
  await eva.eng.checkJoins();
  assert.deepEqual(eva.eng.view(box, id).items.map((i) => i.text).sort(), ["Secret new item", "Soap"]);
  // Nikos forgets the household: his copy waits in the archive for a private copy
  nik.eng.forget(box);
  assert.equal(nik.eng.list().length, 0);
  assert.deepEqual(nik.eng.archived("todo").map((a) => [a.title, a.take]), [["Shopping", true]]);
});

test("leaving: the admin's next pass rotates; unsharing archives for the others", async () => {
  const { ana, nik, box } = await household();
  const id = await ana.eng.share(box, "todo", "Chores", { set: { a: { text: "Dishes" } } });
  await ana.eng.sync(box); await nik.eng.sync(box);
  await assert.rejects(ana.eng.leave(box), /lastadmin/);
  await nik.eng.leave(box);
  assert.equal(nik.eng.list().length, 0);
  assert.equal(nik.eng.archived()[0].why, "left");
  await ana.eng.sync(box);
  assert.equal(ana.eng.list()[0].epoch, 2);
  // unshare: Ana keeps a private copy, the others only see it in the archive
  await ana.eng.unshare(box, id);
  assert.deepEqual(ana.eng.docs("todo"), []);
  assert.deepEqual(ana.eng.archived("todo").map((a) => [a.why, a.take]), [["mine", true]]);
});

test("unshared by someone else: archived without a private copy, and can be restored", async () => {
  const { ana, nik, box } = await household();
  const id = await ana.eng.share(box, "todo", "Plants", { set: { a: { text: "Water ficus" } } });
  await ana.eng.sync(box); await nik.eng.sync(box);
  await ana.eng.unshare(box, id);
  await ana.eng.sync(box);
  await nik.eng.sync(box);
  assert.deepEqual(nik.eng.docs("todo"), []);
  const a = nik.eng.archived("todo");
  assert.deepEqual(a.map((x) => [x.title, x.why, x.take]), [["Plants", "unshared", false]]);
  const back = await nik.eng.restore(box, id);
  await nik.eng.sync(box); await ana.eng.sync(box);
  assert.deepEqual(ana.eng.view(box, back).items.map((i) => i.text), ["Water ficus"]);
  assert.deepEqual(nik.eng.archived("todo"), []);
});

test("a second device of the same person joins through the membership slice", async () => {
  const { w, ana, box } = await household();
  const id = await ana.eng.share(box, "todo", "Shopping", { set: { a: { text: "Tea" } } });
  await ana.eng.sync(box);
  const phone = person(w, "Ana phone");
  await phone.eng.ready();
  phone.eng.sliceSet(ana.eng.sliceGet());
  await phone.eng.sync(box);
  assert.deepEqual(phone.eng.view(box, id).items.map((i) => i.text), ["Tea"]);
  assert.equal(phone.eng.list()[0].admin, true);
  // the merge of the slice is symmetric and idempotent
  const m = ana.eng.sliceGet();
  assert.deepEqual(ana.eng.merge(m, phone.eng.sliceGet()), ana.eng.merge(phone.eng.sliceGet(), m));
  // a document stays readable after a reload (IndexedDB stand-in)
  const again = E.create({ fetch: w.fetch, store: { all: async () => Array.from(phone.rows.values()), put: async () => {}, del: async () => {} },
    membership: { load: () => phone.memBox.v, save: () => {} }, pending: { load: () => null, save: () => {} }, later: () => 0, log: () => {} });
  await again.ready();
  assert.deepEqual(again.view(box, id).items.map((i) => i.text), ["Tea"]);
});

test("make admin: the other member gets the admin token from an envelope", async () => {
  const { ana, nik, box } = await household();
  await ana.eng.makeAdmin(box, nik.eng.me(box));
  await ana.eng.sync(box);
  await nik.eng.sync(box);
  assert.equal(nik.eng.list()[0].admin, true);
  await ana.eng.leave(box);       // another admin exists now
  await nik.eng.sync(box);
  assert.equal(nik.eng.list()[0].epoch, 2);
  assert.deepEqual(nik.eng.list()[0].members.map((m) => m.name), ["Nikos"]);
});

test("delete the household: gone for everyone", async () => {
  const { ana, nik, box } = await household();
  await assert.rejects(nik.eng.remove(box), /notadmin/);
  await ana.eng.remove(box);
  assert.equal(ana.eng.list().length, 0);
  await nik.eng.sync(box);
  assert.equal(nik.eng.list()[0].status, "gone");
});
