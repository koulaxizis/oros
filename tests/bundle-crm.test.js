// The .oroscrm file (CRM): every customer, deal, history entry,
// follow-up, tag and own stage through the shared kit (recordpkg.js)
// and bundle.js; opening adds only what is missing, with its ids, and
// never carries the web form's keys or the prefs. Plus the app wiring
// (Save, Open, unzipped folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "crm/core.js"));
const P = require(path.join(ROOT, "crm/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;

// every entry of a ZIP, inflated, as one text (local headers walked)
function unzipAll(bytes) {
  const buf = Buffer.from(bytes), out = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18);
    const nl = buf.readUInt16LE(i + 26), xl = buf.readUInt16LE(i + 28);
    const name = buf.toString("utf8", i + 30, i + 30 + nl), at = i + 30 + nl + xl;
    const raw = buf.subarray(at, at + size);
    out.push(name + "\n" + (method === 8 ? zlib.inflateRawSync(raw) : raw).toString("utf8"));
    i = at + size;
  }
  assert.ok(out.length >= 3, "entries read");
  return out.join("\n");
}

function slice() {
  return C.norm({
    ver: 1,
    cust: [
      { id: "cust000001", m: NOW - 900, name: "Acme SA", kind: "co", st: "active", afm: "094014201", email: "a@acme.gr",
        tags: ["tag0000001"], people: [{ c: "", n: "Maria", role: "CEO", phone: "210" }] },
      { id: "cust000002", m: NOW - 800, name: "=HYPERLINK(\"x\")", kind: "person", st: "lead" }
    ],
    deals: [{ id: "deal000001", m: NOW - 700, cust: "cust000001", title: "Website", val: 150000, stage: "stage00001" }],
    acts: [{ id: "acts000001", m: NOW - 600, cust: "cust000001", k: "call", at: NOW - 600, text: "Called" }],
    fups: [{ id: "fups000001", m: NOW - 500, cust: "cust000001", d: "2027-01-10", text: "Send offer" }],
    tags: [{ id: "tag0000001", m: NOW - 950, name: "VIP", col: 2 }],
    stg: [{ id: "stage00001", m: NOW - 990, name: "Demo", pos: 15 }, { id: "new", m: NOW - 990, name: "Inbox" }],
    prefs: { pm: NOW - 1000, cur: "USD", forget: 60 },
    wf: { m: NOW - 400, k: "abcdefghij123456", sec: "A".repeat(32),
          priv: { kty: "RSA", n: "nn", e: "AQAB", d: "SECRETD", p: "pp", q: "qq", dp: "dp", dq: "dq", qi: "qi" } },
    tombs: { gone000001: NOW - 100 }
  });
}

test("crm: round trip through bundle.js; no tombs, prefs, web form keys or built-in stages in the file", async () => {
  const s = slice();
  assert.ok(s.wf && s.wf.priv.d === "SECRETD");
  const o = K.pack(D, s, { title: "CRM", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-crm");
  assert.equal(o.generator, "orOS CRM");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["acts", "cust", "deals", "fups", "stg", "tags", "ver"]);
  assert.deepEqual(o.content.data.stg.map((r) => r.id), ["stage00001"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-crm");
  const r = await B.read(bytes, { mime: D.mime });
  // everything the file holds, entries inflated: no key, secret or setting
  const flat = unzipAll(bytes);
  assert.ok(flat.includes("Acme SA") && flat.includes("customers.csv"));
  ["SECRETD", "abcdefghij123456", "AAAAAAAA", "\\\"wf\\\"", "\\\"prefs\\\"", "\\\"tombs\\\"", "USD", "Inbox", "gone000001"]
    .forEach((x) => assert.ok(!flat.includes(x), x));
  assert.ok(!JSON.stringify(r.content).match(/"(wf|prefs|tombs|priv|sec)"/));
  assert.equal(r.content.kind, "oros-crm-package");
  assert.deepEqual(r.content.data.cust, s.cust);
  // preview: the app's own CSV export (";", BOM, formula guard)
  const csv = o.preview.find((p) => p.name === "customers.csv").data;
  assert.ok(csv.startsWith("﻿Name;Trade name;Type;"));
  assert.match(csv, /\r\nAcme SA;;Company;Active;094014201;/);
  assert.match(csv, /\r\n"'=HYPERLINK\(""x""\)";;Person;Lead/);
  assert.equal(K.pack(D, C.empty(), { now: NOW }).preview.length, 0);

  // into a device with other data
  const other = C.norm({ ver: 1, cust: [{ id: "mine000001", m: NOW - 5, name: "Mine" }],
    prefs: { pm: NOW - 3, cur: "EUR", forget: 30 }, stg: [{ id: "new", m: NOW - 4, name: "Fresh" }], tombs: {} });
  const res = K.open(D, other, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 7, skipped: 0, updated: 0 });
  assert.deepEqual(res.addedIds.slice().sort(),
    ["acts000001", "cust000001", "cust000002", "deal000001", "fups000001", "stage00001", "tag0000001"]);
  const n = C.norm(res.next);
  assert.deepEqual(n.cust.map((c) => c.id), ["cust000001", "cust000002", "mine000001"]);
  assert.equal(n.deals[0].stage, "stage00001");
  assert.deepEqual(n.prefs, other.prefs);                     // this device's settings
  assert.equal(n.wf, undefined);
  assert.deepEqual(n.stg.find((x) => x.id === "new").name, "Fresh");
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(C.norm(again.next), n);
});

test("crm: a clash keeps the local record, a deleted one stays deleted, update takes newer", () => {
  const theirs = slice();
  theirs.cust[0].name = "Acme Theirs"; theirs.cust[0].m = NOW - 10;
  theirs.deals[0].val = 1; theirs.deals[0].m = NOW - 10;
  theirs.acts.push({ id: "acts000002", m: NOW - 9, cust: "cust000001", k: "mail", at: NOW - 9, text: "new mail" });
  const mine = slice();
  mine.tombs.cust000002 = NOW - 50;
  mine.cust = mine.cust.filter((c) => c.id !== "cust000002");
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["acts000002"]);
  const n = C.norm(res.next);
  assert.equal(n.cust.find((x) => x.id === "cust000001").name, "Acme SA");
  assert.equal(n.deals[0].val, 150000);
  assert.ok(!n.cust.some((x) => x.id === "cust000002"));
  assert.equal(n.tombs.cust000002, NOW - 50);
  assert.equal(n.wf.priv.d, "SECRETD");                       // the local form stays as it is
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds.slice().sort(), ["cust000001", "deal000001"]);
  const u = C.norm(upd.next);
  assert.equal(u.cust.find((x) => x.id === "cust000001").name, "Acme Theirs");
  assert.equal(u.deals[0].val, 1);
  assert.equal(P.kindOf("acts000002", n), "acts");
  assert.equal(P.kindOf("cust000001", n), "cust");
  assert.equal(P.kindOf("nope", n), "");
});

test("crm: hostile content is cut down", () => {
  const evil = { kind: "oros-crm-package", ver: 1, data: {
    cust: [
      { id: "evil000001", m: NOW * 10, name: "a\u0000b<script>" + "x".repeat(500), kind: "robot", st: "boss", onclick: "x",
        note: "n".repeat(9000), people: [{ c: "../x", n: "P" }, "junk"], tags: ["BAD ID", "tag0000009"] },
      { id: "BAD", m: 1, name: "bad id" }, { id: "nostamp001", name: "no m" }, { id: "noname0001", m: 5 },
      { id: "__proto__", m: 5, name: "proto" }
    ],
    deals: [{ id: "deal000009", m: 5, cust: "nocust0001", title: "orphan" },
            { id: "deal000010", m: 5, cust: "evil000001", title: "T", val: -5, stage: "<b>" }],
    fups: [{ id: "fups000009", m: 5, cust: "evil000001", d: "2027-02-31", text: "bad day" }],
    stg: [{ id: "nego", m: 5, name: "Hijack" }],
    wf: { m: 5, k: "abcdefghij123456", sec: "B".repeat(32), priv: { kty: "RSA" } },
    prefs: { pm: NOW * 10, cur: "XXX" },
    tombs: { cust000001: NOW * 10 }
  } };
  const local = slice();
  const res = K.open(D, local, evil, { now: NOW });
  assert.deepEqual(res.addedIds.slice().sort(), ["deal000010", "evil000001"]);
  const n = C.norm(res.next);
  const e = n.cust.find((x) => x.id === "evil000001");
  assert.equal(e.m, NOW + K.FUTURE);                          // clamped
  assert.equal(e.name.length, 120);
  assert.ok(!/[\u0000]/.test(e.name));
  assert.deepEqual([e.kind, e.st, e.onclick, e.note.length], ["co", "lead", undefined, 2000]);
  assert.deepEqual(e.people, [{ c: "", n: "P" }]);
  assert.deepEqual(e.tags, ["tag0000009"]);
  const d = n.deals.find((x) => x.id === "deal000010");
  assert.deepEqual([d.val, d.stage], [0, "new"]);
  assert.ok(n.cust.some((x) => x.id === "cust000001"));      // a file's tomb never deletes here
  assert.deepEqual(n.prefs, local.prefs);
  assert.deepEqual(n.wf, local.wf);
  assert.equal(n.stg.find((x) => x.id === "new").name, "Inbox");
  assert.ok(!n.stg.some((x) => x.id === "nego"));
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm([1]), null);
  assert.throws(() => K.open(D, local, { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, local, { kind: "oros-crm-package", ver: 9, data: {} }), /newer/);
});

test("crm: wiring (scripts, buttons, Open with, help, file types)", () => {
  const html = read("crm/index.html");
  ["core.js?v=", "../bundle.js?v=2.51.00", "../recordpkg.js?v=2.51.00", "package.js?v=2.51.00", "crm.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="crm.js'));
  const js = read("crm/crm.js");
  assert.match(js, /RP\.ui\(CPK\.DESC,/);
  assert.match(js, /if \(x && typeof x === "object" && x\.openFile\) \{ if \(recFile\) recFile\.openTarget\(x\.openFile\);/);
  ["openFile", "__orosTakeFile(", "window.__orosOpenAt =", '__orosTakeTarget("crm")'].forEach((s) => assert.ok(js.includes(s), s));
  assert.equal(js.split("window.__orosOpenAt =").length, 2);
  ["crm-osave", "crm-oopen", "crm-ofolder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.ok(js.includes('"set.osave": "orOS file (.oroscrm)"'));
  assert.ok(js.includes('"set.osave": "Αρχείο orOS (.oroscrm)"'));
  assert.ok(js.includes('"set.ofolder": "Αποσυμπιεσμένος φάκελος orOS…"'));
  const pkg = read("crm/package.js");
  ["hubspot", "pipedrive", "localStorage", "oros-crm-wf"].forEach((w) => assert.ok(!new RegExp('"' + w, "i").test(pkg), w));
  for (const f of ["crm/help.en.txt", "crm/help.el.txt"]) assert.ok(read(f).includes(".oroscrm"), f);
  assert.deepEqual(F.appsFor(".oroscrm"), ["crm"]);
  assert.deepEqual(B.TYPES[".oroscrm"], { app: "crm", mime: "application/x-oros-crm" });
});
