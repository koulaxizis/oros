// Household wave 8: a copy of every shared document on the person's
// own orOS disk (household/backup.js + household/engine.js), so that
// nothing is lost when a box is gone and a device lost its copy too.
// Covers: one file per household and device, written after a pass that
// reached the box, never twice with the same content, no invite
// secrets in it; a gone box brings the documents back on a fresh
// device; "Start again" moves everything into a new box (old copies
// and files dropped, the new box has its own file); a household that
// is only in a backup goes to the archive as private copies; files of
// two devices merge field by field.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../household/engine.js");
const Core = require("../household/core.js");
const X = require("../household/crypto.js");
const Bk = require("../household/backup.js");
const fake = require("./house-fake.js");

let handle;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  await fake.load();
  X._setIter(1000);
});
test.after(() => X._setIter(600000));

let clock = 1.76e12;
function relayWorld() {
  const w = fake.world();
  w.calls = [];
  w.fetch = async (url, init) => {
    clock += 10;
    const h = Object.assign({ Origin: fake.ORIGIN, "CF-Connecting-IP": "10.2.1." + (w.calls.length % 200) }, init.headers || {});
    w.calls.push(init.method + " " + url.replace(/^https:\/\/[^/]+/, ""));
    return handle(new Request(url, Object.assign({}, init, { headers: h })), w.env, null, clock);
  };
  return w;
}
// The person's orOS disk (the same files on all their devices, as the
// vault carries them) and one device of theirs.
function disk() {
  const files = new Map();
  return { files, writes: [] };
}
function device(w, d, dev, memBox) {
  const rows = new Map();
  const pendBox = { v: null };
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
    later: () => 0,
    log: () => {},
    backup: {
      dev: () => dev,
      list: async () => Array.from(d.files.keys()),
      read: async (n) => { if (!d.files.has(n)) throw new Error("ENOENT"); return d.files.get(n); },
      write: async (n, t) => { d.files.set(n, t); d.writes.push(n); },
      remove: async (n) => { d.files.delete(n); }
    }
  });
  return { eng, rows };
}

async function home() {
  const w = relayWorld();
  const anaDisk = disk(), nikDisk = disk();
  const ana = device(w, anaDisk, "anaPC001", { v: null });
  const nikMem = { v: null };
  const nik = device(w, nikDisk, "nikPC001", nikMem);
  await ana.eng.ready(); await nik.eng.ready();
  const box = await ana.eng.create("Home", "Ana");
  const inv = await ana.eng.invite(box, { days: 2, uses: 20 });
  await nik.eng.join(inv.link, "Nikos");
  await ana.eng.sync(box);
  const rq = await ana.eng.requests(box);
  await ana.eng.accept(box, rq[0].rid);
  await nik.eng.checkJoins();
  const id = await ana.eng.share(box, "todo", "Shopping", { set: { milk: { text: "Milk", done: false, o: 0 } } });
  await ana.eng.sync(box);
  await nik.eng.sync(box);
  return { w, ana, nik, box, id, anaDisk, nikDisk, nikMem };
}

test("one file per household and device, never twice the same, no invite secrets", async () => {
  const { ana, nik, box, id, nikDisk } = await home();
  assert.equal(await nik.eng.backupNow(true).then(() => nikDisk.writes.length), 1);
  const name = Bk.fileName(box, "nikPC001");
  assert.deepEqual([...nikDisk.files.keys()], [name]);
  const p = Bk.parse(nikDisk.files.get(name));
  assert.equal(p.box, box);
  assert.equal(p.name, "Home");
  assert.deepEqual(Core.view(p.docs[id]).items.map((i) => i.text), ["Milk"]);
  assert.ok(!Object.keys(p.docs.r.it).some((k) => k.startsWith("i:")), "invites are left out");
  assert.ok(!nikDisk.files.get(name).includes('"s":['), "no invite secret");
  // nothing changed: nothing written
  await nik.eng.sync(box);
  await nik.eng.backupNow(true);
  assert.equal(nikDisk.writes.length, 1);
  // a change from the other side: written once more
  await ana.eng.change(box, id, { set: { eggs: { text: "Eggs", done: false, o: 1 } } });
  await ana.eng.sync(box);
  await nik.eng.sync(box);
  await nik.eng.backupNow(true);
  assert.equal(nikDisk.writes.length, 2);
  assert.deepEqual(Core.view(Bk.parse(nikDisk.files.get(name)).docs[id]).items.map((i) => i.text).sort(), ["Eggs", "Milk"]);
});

test("a box gone and a device without its copy: the backup brings everything back, then Start again", async () => {
  const { w, ana, nik, box, id, nikDisk, nikMem } = await home();
  await nik.eng.backupNow(true);
  await ana.eng.remove(box);                         // the box is gone for everyone
  // Nikos opens orOS on a new phone: membership from his cloud, an
  // empty IndexedDB, his disk files from the vault
  const phone = device(w, nikDisk, "nikPhone1", nikMem);
  await phone.eng.ready();
  assert.equal(phone.eng.get(box, id), null, "nothing on the phone yet");
  await phone.eng.sync(box);
  const hh = phone.eng.list()[0];
  assert.equal(hh.status, "gone");
  assert.deepEqual(phone.eng.view(box, id).items.map((i) => i.text), ["Milk"], "back from the backup");
  assert.deepEqual(phone.eng.docs("todo").map((d) => d.title), ["Shopping"]);
  await phone.eng.backupNow(true);
  assert.ok(!nikDisk.files.has(Bk.fileName(box, "nikPhone1")), "never written while the box is gone");
  const bl = await phone.eng.backups();
  assert.equal(bl.length, 1);
  assert.equal(bl[0].gone, true);
  assert.equal(bl[0].docs, 1);
  // Start again: a new box with the list in it, Nikos its admin
  const nb = await phone.eng.restart(box);
  assert.notEqual(nb, box);
  const l = phone.eng.list();
  assert.deepEqual(l.map((x) => [x.name, x.admin, x.status]), [["Home", true, "ok"]]);
  assert.deepEqual(l[0].members.map((m) => m.name), ["Nikos"]);
  const d = phone.eng.docs("todo");
  assert.deepEqual(d.map((x) => [x.box, x.title]), [[nb, "Shopping"]]);
  assert.deepEqual(phone.eng.view(nb, d[0].id).items.map((i) => i.text), ["Milk"]);
  assert.deepEqual(phone.eng.archived(), [], "no private copies: it is all in the new box");
  assert.deepEqual([...nikDisk.files.keys()], [Bk.fileName(nb, "nikPhone1")], "old files dropped, the new box has its own");
  // the others can be invited again
  const inv = await phone.eng.invite(nb, { days: 2, uses: 20 });
  assert.match(inv.link, /#h1\./);
});

test("a household only in a backup: to the archive as private copies, and removable", async () => {
  const { ana, nik, box, id, nikDisk } = await home();
  await nik.eng.backupNow(true);
  await ana.eng.remove(box);
  await nik.eng.sync(box);
  nik.eng.forget(box);                                 // "Remove from this device"
  nik.eng.archived().forEach((a) => nik.eng.dropArchived(a.box, a.id));   // the apps took their copies
  const bl = await nik.eng.backups();
  assert.deepEqual(bl.map((b) => [b.name, b.live, b.gone, b.docs]), [["Home", false, false, 1]]);
  assert.equal(await nik.eng.takeBackup(box), 1);
  const a = nik.eng.archived("todo");
  assert.deepEqual(a.map((x) => [x.title, x.take, x.hh, x.why]), [["Shopping", true, "Home", "backup"]]);
  assert.deepEqual(Core.view(a[0].doc).items.map((i) => i.text), ["Milk"]);
  assert.equal(a[0].id, id);
  // a live household's backup is not taken apart
  await assert.rejects(ana.eng.takeBackup(await ana.eng.create("Other", "Ana")), /live/);
  assert.equal(await nik.eng.dropBackup(box), 1);
  assert.deepEqual(await nik.eng.backups(), []);
  assert.equal(nikDisk.files.size, 0);
});

test("files of two devices merge field by field; broken files are skipped", () => {
  const box = "BBBBBBBBBBBBBBBBBBBBBB";
  const a = Core.apply(Core.empty("todo"), { set: { x: { text: "Old", o: 0 } } }, 100, "m1");
  const b = Core.apply(a, { set: { x: { text: "New" }, y: { text: "Two", o: 1 } } }, 200, "m2");
  const c = Core.apply(a, { m: { t: "List" } }, 150, "m1");
  const f1 = Bk.parse(Bk.wrap(Bk.body(box, "Home", { k1: c }), 10, "devA0001"));
  const f2 = Bk.parse(Bk.wrap(Bk.body(box, "Our home", { k1: b }), 20, "devB0001"));
  const all = Bk.collect([f1, f2, Bk.parse("not json"), Bk.parse('{"kind":"x"}')]);
  const v = Core.view(all[box].docs.k1);
  assert.deepEqual(v.items.map((i) => i.text).sort(), ["New", "Two"]);
  assert.equal(v.m.t, "List");
  assert.equal(all[box].name, "Our home", "the newest file names it");
  assert.equal(all[box].files, 2);
  assert.equal(Bk.boxOf(Bk.fileName(box, "devA0001")), box);
  assert.equal(Bk.boxOf("../x.json"), "");
  assert.ok(Bk.same(Bk.bodyOf(f1), Bk.body(box, "Home", { k1: c })), "a file reads back as the body it was written from");
});
