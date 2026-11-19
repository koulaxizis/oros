// orOS Transfer TR-LATER: the link emailed at a set day and time.
// The files go up now through the sender's Dropbox with the hold counted
// from the email's time (cloud.js send({ start })); orOS Mail sends the
// email from its Outbox after the person presses Send (deep link sendAt).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const C = require("../transfer/core.js");
const X = require("../transfer/cloud.js");
const H = 3600000;

function fakeDropbox() {
  const store = new Map(), links = new Map(), log = { links: 0, shares: 0, removed: [] };
  const drop = {
    available: () => true,
    put(name, blob) { return blob.arrayBuffer().then((b) => { store.set(name, new Uint8Array(b)); return true; }); },
    link(name) {
      const u = "https://uc1.dl.dropboxusercontent.com/cd/0/get/" + crypto.randomBytes(9).toString("hex") + "/file";
      links.set(u, name); log.links++; return Promise.resolve(u);
    },
    share(name) {
      const u = "https://dl.dropboxusercontent.com/scl/fi/" + crypto.randomBytes(9).toString("hex") + "/" + name.split("/")[1] + "?rlkey=" + crypto.randomBytes(6).toString("hex");
      links.set(u, name); log.shares++; return Promise.resolve(u);
    },
    remove(id) { for (const k of [...store.keys()]) if (k.startsWith(id + "/")) store.delete(k); log.removed.push(id); return Promise.resolve(true); },
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
async function sendAll(dbx, extra) {
  const bytes = crypto.randomBytes(5000), code = C.newCode();
  const r = await X.send(Object.assign({ code, files: [{ p: "a.bin", s: bytes.length, m: 1731400000000 }], drop: dbx.drop, temp: memTemp,
    read: (i, a, b) => Promise.resolve(new Uint8Array(bytes.subarray(a, b))) }, extra));
  return Object.assign({ code, bytes }, r);
}
function until(fn, ms = 20000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function poll() { if (fn()) return res(); if (Date.now() - t0 > ms) return rej(new Error("timeout")); setTimeout(poll, 5); })();
  });
}

test("okEmail takes one plain address only", () => {
  for (const ok of ["a@b.gr", "x.y+z@mail.example.com", "Name.Surname@sub.domain.eu"]) assert.ok(C.okEmail(ok), ok);
  for (const bad of ["", "a@b", "a b@c.d", "<a@b.c>", "a@b.c,d@e.f", "a@b..c", "a@b.c\n", "\"x\"@b.c", "a@b.c; c@d.e", "x".repeat(250) + "@b.cd"]) assert.ok(!C.okEmail(bad), JSON.stringify(bad));
});

test("a scheduled email: the hold counts from its time and the links are shared, also for 4 hours", async () => {
  const dbx = fakeDropbox(), now = Date.now(), start = now + 2 * 24 * H;
  const r = await sendAll(dbx, { hold: 4, start });
  assert.equal(dbx.log.links, 0, "no temporary links: they would end before the email goes out");
  assert.equal(dbx.log.shares, 2);
  assert.ok(Math.abs(r.exp - (start + 4 * H)) < 5, "4 hours from the email, not from now");
  assert.equal(X.idTime(r.id), start + X.UPLOAD_ALLOW);
  // nothing is swept before its time; it is swept after it
  assert.equal(await X.sweep(dbx.drop, now + 2 * 24 * H), 0);
  assert.equal(await X.sweep(dbx.drop, start + 6 * H + 20 * 60000), 1);
});

test("a scheduled email with a longer hold; the receiver can open it at once", async () => {
  const dbx = fakeDropbox(), start = Date.now() + 3 * H;
  const r = await sendAll(dbx, { hold: 48, start });
  assert.ok(Math.abs(r.exp - (start + 48 * H)) < 5);
  assert.ok(r.exp < X.idTime(r.id) + X.SWEEP_MS, "the promise never outlives the sweep");
  const f = X.parseFragment(r.frag), states = [];
  const rx = new X.Receiver({ code: f.code, link: f.link, fetch: dbx.fetch, onState: (p, i) => states.push(Object.assign({ p }, i)) });
  rx.start();
  await until(() => states.length && states[states.length - 1].p === "offer");
  assert.ok(Math.abs(states[states.length - 1].exp - r.exp) < 2);
});

test("a start in the past is ignored; one too far ahead is held to 14 days", async () => {
  const dbx = fakeDropbox();
  const r = await sendAll(dbx, { hold: 4, start: Date.now() - H });
  assert.equal(dbx.log.links, 2, "an ordinary 4-hour send");
  assert.ok(r.exp < Date.now() + 4 * H);
  const far = await sendAll(fakeDropbox(), { hold: 12, start: Date.now() + 60 * 24 * H });
  assert.ok(far.exp <= Date.now() + X.LATER_MAX + 12 * H + 1000);
  assert.equal(X.LATER_MAX, 14 * 24 * H);
});

test("wiring: Transfer hands Mail a draft with a time; Mail never sends it without the press", () => {
  const app = fs.readFileSync(path.join(__dirname, "../transfer/app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../transfer/index.html"), "utf8");
  const mail = fs.readFileSync(path.join(__dirname, "../mail/mail.js"), "utf8");
  const de = fs.readFileSync(path.join(__dirname, "../i18n/de/transfer.js"), "utf8");
  for (const id of ["later-field", "later-on", "later-box", "later-to", "later-at", "later-copy", "later-err", "later-mail", "later-out"]) assert.ok(html.includes('id="' + id + '"'), id);
  assert.ok(/start: lt \? lt\.at : 0/.test(app));
  assert.ok(/sendAt: lt\.at, bccSelf: lt\.copy/.test(app));
  assert.ok(app.includes('__orosOpenAt("mail", { outbox: true })'));
  // every new string in EN, EL and DE
  const keys = ["later.lab", "later.to", "later.at", "later.copy", "later.hint", "btn.makeLater", "btn.laterMail", "btn.laterOut", "later.badTo", "later.badAt", "later.subj", "later.body", "later.ready"];
  for (const k of keys) {
    assert.ok(app.split('"' + k + '": "').length - 1 === 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '"'), k + " in DE");
  }
  // Mail: sendAt only in the future and at most a year ahead; it changes the Send button, which queues it
  assert.ok(/typeof c\.sendAt === "number" && c\.sendAt > now0 \+ 30000 && c\.sendAt < now0 \+ 366 \* 86400000/.test(mail));
  assert.ok(/if \(init\.sendAt\) \{[\s\S]{0,200}queueAt\(planned\(\)\)/.test(mail));
  assert.ok(/if \(target\.outbox === true\)/.test(mail));
  // the confirmation: Send later raises a notice when it went out, also with Mail open
  assert.ok(/if \(note\) job\.note = 1;/.test(mail) && /if \(rec\.job\.note\) sentNotice\(rec\);/.test(mail));
  for (const k of ["snd.onBtn", "snd.planned"]) assert.equal(mail.split('"' + k + '": "').length - 1, 2, k + " EN + EL");
  assert.ok(fs.readFileSync(path.join(__dirname, "../i18n/de/mail.js"), "utf8").includes('"snd.onBtn"'));
});
