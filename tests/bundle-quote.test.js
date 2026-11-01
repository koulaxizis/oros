// The .orosquote file (Quote): every quote, client and template
// through the shared kit (recordpkg.js) and bundle.js; opening adds
// only what is missing, with its ids; "Open as copy" adds quotes and
// templates under fresh ids as drafts with new numbers. Plus the app
// wiring (Save, Open, Open as copy, unzipped folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "quote/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const YEAR = new Date().getFullYear();

function offer(id, num, extra) {
  return Object.assign({
    id, num, clientId: "c1", status: "sent", date: "2026-10-01", dueDate: "2026-10-30", currency: "EUR",
    items: [{ id: id + "-i1", code: "A1", desc: "Design | layout", qty: 2, price: 100, disc: 10, vat: 24 }],
    gDisc: 0, payment: "50% upfront", notes: "=HYPERLINK(\"x\")", instalments: [{ id: id + "-n1", date: "2026-11-01", amount: 223.2 }],
    mtime: NOW - 500, pos: 0
  }, extra || {});
}
function slice() {
  return {
    ver: 1, om: 5, activeQuoteId: "q1",
    deleted: { "q-gone": NOW - 100 },
    quotes: [offer("q1", "OFF-" + YEAR + "-001", {
      share: { tok: "secret-token", h: "a".repeat(64), at: NOW - 400, f: "Me", fe: "me@x" },
      acc: { n: "Client Person", at: NOW - 300, h: "a".repeat(64) } })],
    clients: [{ id: "c1", name: "ACME", email: "a@acme", phone: "", address: "Street 1", taxId: "123", mtime: NOW - 900, pos: 0 }],
    templates: [Object.assign(offer("t1", ""), { name: "Website", status: "draft" })],
    payMethods: [{ id: "pm-bank", method: "bank", text: "IBAN: GR00", mtime: 0, pos: 0 }]
  };
}
function fresh() {
  return { ver: 1, om: 0, deleted: {}, quotes: [], clients: [], templates: [],
           payMethods: [{ id: "pm-bank", method: "bank", text: "mine", mtime: 0, pos: 0 }] };
}

test("quote: round trip through bundle.js; no tombstones, presets, share token or device fields", async () => {
  const o = K.pack(D, slice(), { title: "Quote", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-quote");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["clients", "quotes", "templates", "ver"]);
  assert.equal(o.content.data.quotes[0].share, undefined);
  assert.deepEqual(o.content.data.quotes[0].acc, slice().quotes[0].acc);
  assert.ok(!JSON.stringify(o.content).includes("secret-token"));
  assert.ok(!JSON.stringify(o.content).includes("GR00"));
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-quote");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-quote-package");
  // preview: Markdown with the lines, totals and escaped pipes
  const md = o.preview.find((p) => p.name === "quotes.md").data;
  assert.match(md, /^# Quotes\n\n## OFF-\d{4}-001 — ACME\n/);
  assert.match(md, /\| A1 \| Design \\\| layout \| 2 \| 100\.00 EUR \| 10 \| 24 \|/);
  assert.match(md, /\*\*Total \(with VAT\): 223\.20 EUR\*\*/);
  assert.match(md, /# Templates\n\n## Website/);
  assert.match(K.pack(D, slice(), { lang: "el", now: NOW }).preview[0].data, /^# Προσφορές/);
  // into an empty device
  const res = K.open(D, fresh(), r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 3, skipped: 0, updated: 0 });
  assert.deepEqual(res.addedIds.slice().sort(), ["c1", "q1", "t1"]);
  assert.equal(res.next.quotes[0].items[0].desc, "Design | layout");
  assert.equal(res.next.payMethods[0].text, "mine");                     // presets stay
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(again.next, res.next);
});

test("quote: a clash keeps the local record; deleted stays deleted; update takes newer", () => {
  const theirs = slice();
  theirs.quotes[0].notes = "from the file"; theirs.quotes[0].mtime = NOW - 1;
  theirs.quotes.push(offer("q-gone", "OFF-2026-009", { mtime: NOW - 1 }));
  theirs.quotes.push(offer("q2", "OFF-2026-010"));
  const mine = slice();
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["q2"]);
  assert.equal(res.next.quotes.find((q) => q.id === "q1").notes, mine.quotes[0].notes);
  assert.equal(res.next.quotes.find((q) => q.id === "q1").share.tok, "secret-token");   // the local one keeps its token
  assert.ok(!res.next.quotes.some((q) => q.id === "q-gone"));
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, ["q1"]);
  assert.equal(upd.next.quotes.find((q) => q.id === "q1").notes, "from the file");
  assert.deepEqual(upd.next.deleted, mine.deleted);
  assert.equal(P.kindOf("q2", res.next), "quote");
  assert.equal(P.kindOf("c1", res.next), "client");
  assert.equal(P.kindOf("t1", res.next), "template");
  assert.equal(P.kindOf("nope", res.next), "");
});

test("quote: Open as copy adds quotes and templates under fresh ids, as drafts with new numbers", async () => {
  const bytes = await B.write(K.pack(D, slice(), { now: NOW }));
  const r = await B.read(bytes, { mime: D.mime });
  const mine = slice();
  let n = 0;
  const cd = P.asCopy(() => mine, () => "copy" + String(++n).padStart(3, "0"));
  // A copy is stamped with the real clock (as in the app), so the kit is given
  // the real clock too: with the fixed NOW the stamp would be clamped to
  // NOW + 5 min and the check below would fail once that date has passed.
  const live = Date.now();
  const res = K.open(cd, mine, r.content, { now: live });
  assert.deepEqual(res.report, { added: 2, skipped: 1, updated: 0 });       // copy of q1, copy of t1 | c1 kept
  assert.equal(res.next.quotes.length, 2);
  const q = res.next.quotes[1];
  assert.equal(q.id, "copy001");
  assert.equal(q.num, "OFF-" + YEAR + "-002");
  assert.equal(q.status, "draft");
  assert.equal(q.acc, undefined);
  assert.equal(q.share, undefined);
  assert.equal(q.clientId, "c1");
  assert.ok(q.items[0].id !== "q1-i1" && q.instalments[0].id !== "q1-n1");
  assert.ok(q.mtime >= live && q.mtime <= Date.now());                      // stamped now: a new record
  assert.equal(res.next.templates[1].name, "Website");
  assert.equal(res.next.quotes[0].id, "q1");                                 // the original untouched
  // a taken or malformed id is never used
  assert.equal(K.open(P.asCopy(() => mine, () => "q1"), mine, r.content, { now: NOW }).report.added, 0);
  assert.equal(K.open(P.asCopy(() => mine, () => "bad id"), mine, r.content, { now: NOW }).report.added, 0);
  // the default ids, and clients the device lacks come in as usual
  const def = K.open(P.asCopy(fresh), fresh(), r.content, { now: NOW });
  assert.equal(def.report.added, 3);
  assert.ok(def.addedIds.includes("c1"));
  assert.equal(def.next.quotes[0].num, "OFF-" + YEAR + "-001");
  // twice in a row: two more copies (a copy is always new)
  assert.equal(K.open(cd, res.next, r.content, { now: NOW }).report.added, 2);
  assert.equal(P.nextNum(["OFF-" + YEAR + "-007", "OFF-1999-050", "x"], YEAR), "OFF-" + YEAR + "-008");
});

test("quote: hostile content is cut down", () => {
  const far = Date.now() + 365 * 864e5;
  const n = D.norm({
    quotes: [
      { id: "q-evil", num: "a\u0000b", status: "hacked", date: "tomorrow", currency: "eur", clientId: "../x", mtime: far,
        items: [{ id: "i", qty: "9", price: Infinity, disc: 500, vat: -3, desc: { x: 1 }, onclick: "x" }, "junk"],
        instalments: [null, { amount: "1" }], share: { tok: "t" }, acc: { n: "<b>x</b>", h: "zz", m: 5 }, evil: "<script>" },
      { id: "BAD ID" }, { id: "__proto__" }, { id: "q-evil", num: "dup" }
    ],
    clients: [{ id: "c", name: 5, address: "a\u0007b\nc" }, "x"],
    templates: [{ id: "t", name: "T\u0000", share: { tok: "t" } }],
    payMethods: [{ id: "pm-bank", text: "x" }]
  });
  assert.deepEqual(n.quotes.map((x) => x.id), ["q-evil"]);
  const q = n.quotes[0];
  assert.deepEqual([q.num, q.status, q.date, q.currency, q.clientId, q.evil, q.share], ["a b", "draft", "", "EUR", null, undefined, undefined]);
  assert.deepEqual(q.items, [{ id: "i", code: "", desc: "", qty: 0, price: 0, disc: 100, vat: 0 }]);
  assert.deepEqual(q.instalments, [{ id: "in1", date: "", amount: 0 }]);
  assert.deepEqual(q.acc, { n: "<b>x</b>", at: 0, h: "" });
  assert.deepEqual([n.clients[0].name, n.clients[0].address], ["", "a b\nc"]);
  assert.deepEqual([n.templates[0].name, n.templates[0].share], ["T ", undefined]);
  assert.equal(n.payMethods, undefined);
  // stamps clamped by the kit
  const res = K.open(D, fresh(), { kind: "oros-quote-package", ver: 1, data: { quotes: [{ id: "q-far", mtime: far }] } });
  assert.ok(res.next.quotes[0].mtime <= Date.now() + K.FUTURE);
  assert.equal(D.norm("x"), null);
  assert.throws(() => K.open(D, fresh(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, fresh(), { kind: "oros-quote-package", ver: 9, data: {} }), /newer/);
});

test("quote: wiring (scripts, buttons, Open with, help, file types)", () => {
  const html = read("quote/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "quote.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="quote.js'));
  ["ofile-btn", "dlg-ofile", "of-save", "of-open", "of-copy", "of-folder"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  const js = read("quote/quote.js");
  assert.match(js, /RP\.ui\(QPK\.DESC,/);
  assert.match(js, /RP\.ui\(QPK\.asCopy\(/);
  assert.match(js, /if \(tg && tg\.openFile\) \{ if \(recFile\) recFile\.openTarget\(tg\.openFile\); return; \}/);
  assert.match(js, /__orosTakeFile\(/);
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  assert.match(js, /__orosTakeTarget\("quote"\)/);
  ["file.save", "file.open", "file.copy", "file.folder", "file.title", "file.hint", "file.copyHint", "undo"].forEach((k) =>
    assert.equal((js.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k));   // EN and EL
  for (const f of ["quote/help.en.txt", "quote/help.el.txt"]) assert.ok(read(f).includes(".orosquote"), f);
  assert.deepEqual(F.appsFor(".orosquote"), ["quote"]);
  assert.deepEqual(B.TYPES[".orosquote"], { app: "quote", mime: "application/x-oros-quote" });
});
