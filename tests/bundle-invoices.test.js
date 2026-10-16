// The .orosinvoices file (Invoices, phase 4b wave 3): every document,
// payment, client, series, template and profile through the shared kit
// (recordpkg.js) and bundle.js, the official PDFs of /internal/Invoices/
// in media/; opening adds only what is missing, with its ids; issued
// documents and their numbers never change. Plus the app wiring (Save,
// Open, unzipped folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "invoices/core.js"));
const P = require(path.join(ROOT, "invoices/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const SHA = "a".repeat(64);

function party(name, afm) { return { name: name, afm: afm || "", job: "", addr: "", country: "", doy: "", email: "", phone: "" }; }
function slice() {
  return C.normalize({
    ver: 1,
    prof: { name: "Acme", afm: "123456789", iban: "GR16 0110 1250 0000 0001 2300 695", cur: "EUR", vat: 24, m: NOW - 9000, paylink: "https://buy.stripe.com/x" },
    series: [{ id: "ser-inv", kind: "inv", prefix: "INV", year: 1, digits: 4, m: NOW - 8000 }],
    clients: [
      { id: "cli-alpha", name: "=HYPERLINK(\"x\")", afm: "999999999", m: NOW - 7000, apikey: "sk_live_123" },
      { id: "cli-gone1", m: NOW - 10, del: 1 }
    ],
    docs: [
      { id: "doc-issued1", kind: "inv", st: "issued", ser: "ser-inv", seq: 1, num: "INV-2026-0001", date: "2026-03-01", due: "2026-03-31",
        cur: "EUR", cli: "cli-alpha", c: party("Alpha SA", "999999999"), lines: [{ d: "Design", q: 2, p: 10000, vat: 24 }],
        file: "/internal/Invoices/INV-2026-0001.pdf", mark: "400001", mds: "ok", mdx: "acc1", m: NOW - 6000 },
      { id: "doc-draft1", kind: "inv", st: "draft", cur: "EUR", c: party("Beta"), lines: [{ d: "Hosting", q: 1, p: 5000, vat: 24 }], m: NOW - 5000 },
      { id: "doc-ext001", kind: "ext", st: "issued", num: "A-77", date: "2026-02-01", cur: "EUR", c: party("Gamma", "111111111"),
        xnet: 10000, xvat: 2400, m: NOW - 4000 },
      { id: "doc-gone01", m: NOW - 5, del: 1 }
    ],
    pays: [{ id: "pay-one001", doc: "doc-issued1", date: "2026-03-10", amt: 12400, how: "bank", note: "+cmd", m: NOW - 3000 }],
    tpls: [{ id: "tpl-month1", name: "Monthly", kind: "inv", lines: [{ d: "Retainer", q: 1, p: 100000, vat: 24 }], m: NOW - 2000 }]
  });
}
function withMedia(s) { s = clone(s); s.media = { "/internal/Invoices/INV-2026-0001.pdf": SHA + ".pdf" }; return s; }

test("invoices: round trip through bundle.js; no tombstones, no secrets; previews are the app's CSV", async () => {
  const o = K.pack(D, withMedia(slice()), { title: "Invoices", lang: "en", now: NOW,
    files: [{ key: SHA + ".pdf", bytes: new TextEncoder().encode("%PDF-1.4 test"), type: "application/pdf" }] });
  assert.equal(o.mime, "application/x-oros-invoices");
  assert.equal(o.generator, "orOS Invoices");
  const data = o.content.data;
  assert.deepEqual(Object.keys(data).sort(), ["clients", "docs", "media", "pays", "prof", "series", "tpls", "ver"]);
  assert.ok(!data.docs.some((d) => d.del) && !data.clients.some((c) => c.del));
  assert.equal(data.clients[0].apikey, undefined);                          // a key-looking field never leaves
  assert.equal(data.prof.paylink, "https://buy.stripe.com/x");             // a public pay link is not a key
  assert.equal(data.docs.find((d) => d.id === "doc-issued1").mdx, "acc1");  // myDATA ids stay with the document
  assert.deepEqual(data.media, { "/internal/Invoices/INV-2026-0001.pdf": SHA + ".pdf" });
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-invoices");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-invoices-package");
  // the PDF got its real hash as key, and content.json follows it
  const realKey = Object.keys(r.media)[0];
  assert.equal(r.media[realKey].type, "application/pdf");
  assert.equal(r.content.data.media["/internal/Invoices/INV-2026-0001.pdf"], realKey);
  // previews: documents.csv (no drafts, formula guard) and payments.csv
  const docs = o.preview.find((p) => p.name === "documents.csv").data;
  assert.match(docs, /^﻿Number;Kind;Status;Date;/);
  assert.match(docs, /INV-2026-0001;Invoice;Overdue;01\/03\/2026;31\/03\/2026;Alpha SA;999999999;EUR;200\.00;48\.00;248\.00/);
  assert.match(docs, /A-77;Recorded invoice;Unpaid/);
  assert.ok(!/Hosting|Beta/.test(docs));
  const pays = o.preview.find((p) => p.name === "payments.csv").data;
  assert.match(pays, /10\/03\/2026;INV-2026-0001;Alpha SA;124\.00;EUR;Bank transfer;'\+cmd/);
  const el = K.pack(D, slice(), { lang: "el", now: NOW }).preview.find((p) => p.name === "documents.csv").data;
  assert.match(el, /^﻿Αριθμός;Είδος;Κατάσταση;/);
  assert.match(el, /248,00/);

  // into an empty device: everything, with its ids and numbers
  const res = K.open(D, C.empty(), r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 7, skipped: 0, updated: 0 });
  const d1 = res.next.docs.find((d) => d.id === "doc-issued1");
  assert.equal(d1.num, "INV-2026-0001");
  assert.equal(d1.seq, 1);
  assert.equal(res.next.media, undefined);                                  // the map never lands in the data
  assert.deepEqual(Object.keys(res.next).sort(), ["clients", "docs", "pays", "prof", "series", "tpls", "ver"]);
  assert.equal(res.next.prof.name, "");                                     // this device's own business details
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.updated, 0);
  assert.deepEqual(again.next, res.next);
});

test("invoices: a clash keeps the local record; issued documents never take a newer copy", () => {
  const mine = slice();
  const theirs = clone(slice());
  const later = (id, f) => { const d = theirs.docs.find((x) => x.id === id); f(d); d.m = NOW - 1; };
  later("doc-issued1", (d) => { d.num = "INV-2026-0099"; d.seq = 99; d.lines[0].p = 1; });
  later("doc-ext001", (d) => { d.xnet = 1; });
  later("doc-draft1", (d) => { d.notes = "changed later"; });
  theirs.clients[0].name = "Alpha renamed"; theirs.clients[0].m = NOW - 1;
  theirs.docs.push({ id: "doc-gone01", kind: "inv", st: "draft", cur: "EUR", c: party("x"), lines: [], m: NOW - 1 });
  const file = { kind: "oros-invoices-package", ver: 1, data: D.strip(theirs) };
  const add = K.open(D, mine, file, { now: NOW });
  assert.deepEqual(add.report, { added: 0, skipped: 8, updated: 0 });
  assert.deepEqual(add.next, C.normalize(mine));
  const upd = K.open(D, mine, file, { now: NOW, update: true });
  assert.deepEqual(upd.updatedIds.sort(), ["cli-alpha", "doc-draft1"]);
  const d1 = upd.next.docs.find((d) => d.id === "doc-issued1");
  assert.equal(d1.num, "INV-2026-0001");                                    // issued: never renumbered, never changed
  assert.equal(d1.lines[0].p, 10000);
  assert.equal(upd.next.docs.find((d) => d.id === "doc-ext001").xnet, 10000);
  assert.equal(upd.next.docs.find((d) => d.id === "doc-draft1").notes, "changed later");
  assert.ok(upd.next.docs.find((d) => d.id === "doc-gone01").del);          // deleted here stays deleted
  assert.equal(upd.next.clients.find((c) => c.id === "cli-alpha").name, "Alpha renamed");
});

test("invoices: forLocal keeps numbers unique; orphan payments stay out", () => {
  const mine = slice();
  const theirs = clone(slice());
  theirs.docs = [
    // another device issued the same number: stays out
    { id: "doc-other01", kind: "inv", st: "issued", ser: "ser-inv", seq: 1, num: "INV-2026-0001", date: "2026-05-01", cur: "EUR", c: party("Z"), lines: [], m: NOW - 1 },
    // a free number: added as it is
    { id: "doc-other02", kind: "inv", st: "issued", ser: "ser-inv", seq: 2, num: "INV-2026-0002", date: "2026-05-02", cur: "EUR", c: party("Z"), lines: [], m: NOW - 1 },
    // the same number in another year: free
    { id: "doc-other03", kind: "inv", st: "issued", ser: "ser-inv", seq: 1, num: "INV-2025-0001", date: "2025-05-02", cur: "EUR", c: party("Z"), lines: [], m: NOW - 1 },
    // a recorded invoice already recorded here
    { id: "doc-other04", kind: "ext", st: "issued", num: "a-77 ", date: "2026-02-01", cur: "EUR", c: party("G", "111111111"), m: NOW - 1 },
    // the local draft, issued on the other device with a taken number
    { id: "doc-draft1", kind: "inv", st: "issued", ser: "ser-inv", seq: 1, num: "INV-2026-0001", date: "2026-06-01", cur: "EUR", c: party("Beta"), lines: [], m: NOW - 1 }
  ];
  theirs.pays = [
    { id: "pay-orphan1", doc: "doc-other01", date: "2026-05-03", amt: 100, how: "cash", m: NOW - 1 },
    { id: "pay-ok00001", doc: "doc-other02", date: "2026-05-03", amt: 100, how: "cash", m: NOW - 1 },
    { id: "pay-ok00002", doc: "doc-issued1", date: "2026-05-04", amt: 100, how: "cash", m: NOW - 1 },
    { id: "pay-nodoc01", doc: "doc-nowhere", date: "2026-05-04", amt: 100, how: "cash", m: NOW - 1 }
  ];
  const DL = P.forLocal(() => mine);
  const res = K.open(DL, mine, { kind: "oros-invoices-package", ver: 1, data: theirs }, { now: NOW, update: true });
  assert.deepEqual(res.addedIds.filter((x) => /^doc-/.test(x)).sort(), ["doc-other02", "doc-other03"]);
  assert.deepEqual(res.addedIds.filter((x) => /^pay-/.test(x)).sort(), ["pay-ok00001", "pay-ok00002"]);
  assert.equal(res.next.docs.find((d) => d.id === "doc-draft1").st, "draft");
  assert.deepEqual(C.clashes(res.next), []);
  assert.equal(P.kindOf("doc-other02", res.next), "doc");
  assert.equal(P.kindOf("pay-ok00001", res.next), "pay");
  assert.equal(P.kindOf("tpl-month1", res.next), "tpl");
  assert.equal(P.kindOf("nope", res.next), "");
});

test("invoices: hostile content is cut down; stamps are clamped; wrong kinds refused", () => {
  const evil = {
    kind: "oros-invoices-package", ver: 1,
    data: {
      prof: { name: "<b>x</b>", m: NOW * 9, token: "t" },
      clients: [
        { id: "cli-future", name: "Future", m: NOW * 2, secret: "s", password: "p", onclick: "x" },
        { id: "BAD ID", name: "x", m: 1 },
        { id: "__proto__", name: "x", m: 1 },
        { id: "cli-noname", name: "", m: 1 },
        "junk", null, 7
      ],
      docs: [
        { id: "doc-evil01", kind: "inv", st: "issued", ser: "ser-inv", seq: 5, num: "INV-1", date: "2026-01-01", cur: "EUR",
          c: party("x"), lines: [], file: "/internal/Passwords/vault.json", m: 1 },
        { id: "doc-evil02", kind: "ext", num: "X", date: "2026-01-01", file: "/internal/Invoices/../Mail/a.pdf", m: 1 },
        { id: "doc-evil03", kind: "hack", m: 1 },
        { id: "doc-evil04", kind: "inv", st: "draft", lines: [{ d: "a\u0000b", q: 1e12, p: 1e15, vat: 900 }], m: 1 }
      ],
      pays: [{ id: "pay-evil01", doc: "doc-evil01", date: "2026-13-01", amt: 5, m: 1 }],
      media: { "/internal/Mail/secret.txt": SHA + ".pdf", "/internal/Invoices/x.pdf": "../../etc", "/internal/Invoices/y.pdf": SHA + ".pdf" }
    }
  };
  const res = K.open(D, C.empty(), evil, { now: NOW });
  assert.deepEqual(res.addedIds.sort(), ["cli-future", "doc-evil01", "doc-evil02", "doc-evil04"]);
  const cf = res.next.clients[0];
  assert.equal(cf.m, NOW + K.FUTURE);
  assert.equal(cf.secret, undefined);
  assert.equal(cf.password, undefined);
  assert.equal(cf.onclick, "x");                                            // a flat extra rides as text (core.js withExtras), never run
  assert.equal(res.next.docs.find((d) => d.id === "doc-evil01").file, "");  // never a path outside /internal/Invoices/
  assert.equal(res.next.docs.find((d) => d.id === "doc-evil02").file, "");
  const l = res.next.docs.find((d) => d.id === "doc-evil04").lines[0];
  assert.equal(l.d, "a b"); assert.equal(l.q, 1); assert.equal(l.p, 0); assert.equal(l.vat, 0);
  assert.equal(res.next.prof.name, "");                                     // a file never sets the profile
  const n = D.norm(evil.data);
  assert.equal(n.media, undefined);                                          // only paths of its documents, only hash keys
  assert.equal(n.prof.token, undefined);
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm([1, 2]), null);
  assert.throws(() => K.open(D, C.empty(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, C.empty(), { kind: "oros-invoices-package", ver: 9, data: {} }), /newer/);
  assert.equal(P.safePath("/internal/Invoices/INV-1.pdf"), true);
  assert.equal(P.safePath("/internal/Invoices/sub/INV-1.pdf"), false);
  assert.equal(P.safePath("/internal/Invoices/..pdf"), false);
  assert.equal(P.safePath("/internal/Invoices/a.exe"), false);
  // caps
  const many = { clients: [] };
  for (let i = 0; i < P.LIM.clients + 5; i++) many.clients.push({ id: "cli-" + String(i).padStart(6, "0"), name: "c", m: 1 });
  assert.equal(D.norm(many).clients.length, P.LIM.clients);
});

test("invoices: wiring (scripts, buttons, Open with, help, file types)", () => {
  const html = read("invoices/index.html");
  ["core.js?v=", "../bundle.js?v=2.51.00", "../recordpkg.js?v=2.51.00", "package.js?v=2.51.00", "invoices.js?v=2.51.00"].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="invoices.js'));
  const js = read("invoices/invoices.js");
  assert.match(js, /RP\.ui\(IPK\.forLocal\(/);
  assert.match(js, /if \(tg && tg\.openFile\) \{ if \(recFile\) recFile\.openTarget\(tg\.openFile\); return; \}/);
  ["openFile", "__orosTakeFile(", "window.__orosOpenAt =", '__orosTakeTarget("invoices")'].forEach((s) => assert.ok(js.includes(s), s));
  assert.equal(js.split("window.__orosOpenAt =").length, 2);
  ["inv-osave", "inv-oopen", "inv-ofolder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.ok(js.includes('"set.osave": "orOS file (.orosinvoices)"'));
  assert.ok(js.includes('"set.osave": "Αρχείο orOS (.orosinvoices)"'));
  for (const f of ["invoices/help.en.txt", "invoices/help.el.txt"]) assert.ok(read(f).includes(".orosinvoices"), f);
  assert.deepEqual(F.appsFor(".orosinvoices"), ["invoices"]);
  assert.deepEqual(B.TYPES[".orosinvoices"], { app: "invoices", mime: "application/x-oros-invoices" });
});
