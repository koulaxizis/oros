// Email Signature (signature/core.js): the model and its merge (sync
// slice "signature"), the HTML builder (escaping, safe links, every
// layout, orOS Mail and plain-text versions), checks, vCard, filling
// from Invoices / Contacts / Atelier, team CSV + ZIP, the search
// provider and the app's wiring (palette, help, Mail BR-MAIL-SIG).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "signature/core.js"));
const P = require(path.join(ROOT, "signature/search.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const ID = "sabc123def";
function sample(over) {
  return C.normSig(Object.assign({
    id: ID, m: 1000, nm: "Work", lang: "en", tpl: "classic",
    f: { name: "Maria Papadopoulou", title: "Sales Manager", company: "Glaros Ltd", phone: "+30 210 123 4567",
         mobile: "+30 690 000 0000", email: "maria@example.gr", web: "example.gr", addr: "1 Odos St\nAthens", vat: "EL123456789" },
    so: [{ k: "linkedin", u: "linkedin.com/in/maria" }], cta: { t: "", u: "https://cal.example.gr" },
    st: {}, im: {}, qr: 0
  }, over || {}));
}

test("normSig: ids, limits, colours, fonts, unknown keys and bad links dropped", () => {
  assert.equal(C.normSig({ id: "bad", m: 1 }), null);
  assert.equal(C.normSig({ id: ID, m: 0 }), null);
  const s = C.normSig({ id: ID, m: 5, tpl: "nope", lang: "fr", evil: 1,
    f: { name: "  A\u0000  B  ", legal: "x\n\n\n\ny", email: "a@b.gr" },
    st: { acc: "red", txt: "#ABCDEF", font: "comic", size: 99, logoW: 1 },
    so: [{ k: "linkedin", u: "javascript:alert(1)" }, { k: "nope", u: "https://a.gr" }, { k: "x", u: "x.com/me" }],
    im: { logo: { a: "../../etc", u: "http://not-https.gr/a.png" }, photo: { u: "https://cdn.example.gr/p.jpg", w: 10, h: 10 } } });
  assert.equal(s.tpl, "classic");
  assert.equal(s.lang, "en");
  assert.equal("evil" in s, false);
  assert.equal(s.f.name, "A B");
  assert.equal(s.f.legal, "x\n\ny");
  assert.equal(s.st.acc, C.DEFAULT_ST.acc);
  assert.equal(s.st.txt, "#abcdef");
  assert.equal(s.st.font, "arial");
  assert.equal(s.st.size, 16);
  assert.equal(s.st.logoW, 40);
  assert.deepEqual(s.so, [{ k: "x", u: "https://x.com/me" }]);
  assert.equal(s.im.logo, undefined, "an http picture and a bad asset id are both dropped");
  assert.equal(s.im.photo.u, "https://cdn.example.gr/p.jpg");
});

test("links: http(s), mailto, tel only", () => {
  assert.equal(C.webUrl("example.gr"), "https://example.gr");
  assert.equal(C.webUrl("http://a.gr/x?y=1"), "http://a.gr/x?y=1");
  assert.equal(C.webUrl("javascript:alert(1)"), "");
  assert.equal(C.webUrl("data:text/html,<b>"), "");
  assert.equal(C.webUrl('https://a.gr/"onmouseover="x'), "");
  assert.equal(C.webUrl("vbscript:x"), "");
  assert.equal(C.httpsUrl("http://a.gr/l.png"), "");
  assert.equal(C.mailUrl("a@b.gr"), "mailto:a@b.gr");
  assert.equal(C.mailUrl("a@b.gr?cc=x"), "");
  assert.equal(C.mailUrl("not an email"), "");
  assert.equal(C.telUrl("+30 (210) 123-4567"), "tel:+302101234567");
  assert.equal(C.telUrl("call me"), "");
  assert.equal(C.imgSrc("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  assert.equal(C.imgSrc("data:image/svg+xml;base64,AAAA"), "");
  assert.equal(C.imgSrc("https://a.gr/l.png"), "https://a.gr/l.png");
});

test("merge: newer wins, equal stamps agree, tombstones, canonical order (R5, R17, R26)", () => {
  const a = { sigs: [sample({ m: 10, nm: "A" })], tombs: {} };
  const b = { sigs: [sample({ m: 20, nm: "B" })], tombs: {} };
  assert.equal(C.merge(a, b).sigs[0].nm, "B");
  assert.equal(C.merge(b, a).sigs[0].nm, "B");
  const x = { sigs: [sample({ m: 10, nm: "X" })] }, y = { sigs: [sample({ m: 10, nm: "Y" })] };
  assert.deepEqual(C.merge(x, y), C.merge(y, x), "same m: both devices pick the same copy");
  const del = { sigs: [], tombs: { [ID]: 20 } };
  assert.equal(C.merge(b, del).sigs.length, 0, "delete wins a tie");
  assert.equal(C.merge({ sigs: [sample({ m: 21 })] }, del).sigs.length, 1, "a newer edit comes back");
  const two = C.merge({ sigs: [sample({ id: "szzzzzz1" }), sample({ id: "saaaaaa1" })] });
  assert.deepEqual(two.sigs.map((s) => s.id), ["saaaaaa1", "szzzzzz1"]);
  const once = C.merge(a, b);
  assert.deepEqual(C.merge(once, once), once, "idempotent");
  assert.deepEqual(C.parse(JSON.stringify(once)), once);
  assert.deepEqual(C.parse("{oops"), C.empty());
});

test("put / remove / duplicate: stamps move forward, 30 at most", () => {
  let d = C.empty();
  let r = C.put(d, sample({ m: 1 }), 500);
  assert.ok(r.ok);
  assert.equal(r.sig.m, 500);
  r = C.put(r.data, Object.assign({}, r.sig, { nm: "Changed" }), 100);
  assert.equal(r.sig.m, 501, "a clock behind still wins over the old copy");
  d = C.remove(r.data, ID, 50);
  assert.equal(d.sigs.length, 0);
  assert.equal(d.tombs[ID], 501);
  r = C.put(d, sample(), 10);
  assert.equal(r.sig.m, 502, "re-adding after delete beats the tombstone");
  let full = C.empty();
  for (let i = 0; i < C.MAX_SIGS; i++) full = C.put(full, sample({ id: "s" + String(i).padStart(8, "0") }), 1).data;
  assert.equal(C.put(full, sample({ id: "sffffffff" }), 1).why, "full");
  const dup = C.duplicate(sample(), "snew12345", 99, "(copy)");
  assert.equal(dup.id, "snew12345");
  assert.equal(dup.nm, "Work (copy)");
});

test("build: hostile text is escaped in every layout and every version", () => {
  const evil = '<script>alert(1)</script>"\' onerror=x';
  const s = sample({ f: { name: evil, title: evil, company: evil, addr: evil, line: evil, legal: evil, pron: evil, dept: evil,
    phone: evil, email: "a@b.gr", web: 'javascript:alert(1)' }, cta: { t: evil, u: "https://x.gr" } });
  for (const tpl of C.TEMPLATES) {
    for (const target of ["embed", "web", "mail"]) {
      const h = C.build(Object.assign({}, s, { tpl }), { target, src: { logo: 'x" onerror="y' } }).html;
      assert.ok(!/<script/i.test(h), tpl + "/" + target);
      assert.ok(!/javascript:/i.test(h), tpl + "/" + target);
      assert.ok(!/<[^>]*\son\w+=/i.test(h), "no event attribute in any tag: " + tpl + "/" + target);
      assert.ok(!/<style|class=|<svg/i.test(h), "inline styles only: " + tpl);
    }
  }
});

test("build: tables + inline styles, links, labels in the signature's language", () => {
  const h = C.build(sample(), { target: "embed" }).html;
  assert.ok(h.startsWith('<div style="font-family:Arial'));
  assert.ok(h.includes('<table cellpadding="0" cellspacing="0" border="0" role="presentation"'));
  assert.ok(h.includes('href="tel:+302101234567"'));
  assert.ok(h.includes('href="mailto:maria@example.gr"'));
  assert.ok(h.includes('href="https://example.gr"'));
  assert.ok(h.includes('bgcolor="#2b6cb0"'), "the button is a table cell (Outlook)");
  assert.ok(h.includes(">Book a meeting<"));
  assert.ok(h.includes(">T<") && h.includes(">M<"));
  const el = C.build(sample({ lang: "el" }), { target: "embed" }).html;
  assert.ok(el.includes(">Τ<") && el.includes(">Κ<") && el.includes("Κλείστε ραντεβού") && el.includes("ΑΦΜ EL123456789"));
  const words = C.build(sample({ st: { lab: "w" } }), { target: "embed" }).html;
  assert.ok(words.includes(">Phone<"));
  const none = C.build(sample({ st: { lab: "n" } }), { target: "embed" }).html;
  assert.ok(!none.includes(">T<"));
});

test("build: pictures follow the target (web = hosted only), photos square, banner dates", () => {
  const data = "data:image/png;base64,iVBORw0KGgo=";
  const s = sample({ tpl: "side", im: { logo: { a: "a".repeat(64) + ".png", w: 300, h: 100 },
    photo: { a: "b".repeat(64) + ".jpg", u: "https://example.gr/me.jpg", w: 400, h: 300 },
    ban: { u: "https://example.gr/b.png", w: 800, h: 200, link: "example.gr/offer", from: "2026-10-01", to: "2026-10-31" } } });
  const emb = C.build(s, { target: "embed", today: "2026-10-13", src: { logo: data, photo: data } }).html;
  assert.ok(emb.includes('src="' + data + '"'));
  assert.ok(emb.includes('width="72" height="72"'), "photo is square");
  assert.ok(emb.includes('src="https://example.gr/b.png"') && emb.includes('href="https://example.gr/offer"'));
  const web = C.build(s, { target: "web", today: "2026-10-13", src: { logo: data, photo: data } }).html;
  assert.ok(!web.includes("data:"), "web mail apps get no embedded picture");
  assert.ok(web.includes('src="https://example.gr/me.jpg"'));
  const late = C.build(s, { target: "embed", today: "2026-11-01", src: {} }).html;
  assert.ok(!late.includes("b.png"), "banner gone after its end date");
  assert.equal(C.bannerOn(s, "2026-09-30"), false);
  assert.equal(C.bannerOn(s, "2026-10-01"), true);
});

test("build: short version, plain text, orOS Mail version, .html file", () => {
  const s = sample({ f: Object.assign({}, sample().f, { legal: "Confidential." }) });
  const short = C.build(s, { target: "embed", short: true }).html;
  assert.ok(!short.includes("Confidential") && !short.includes("linkedin"));
  const txt = C.toText(s);
  assert.equal(txt.split("\n")[0], "Maria Papadopoulou");
  assert.ok(txt.includes("T: +30 210 123 4567") && txt.includes("W: example.gr") && txt.includes("LinkedIn: https://linkedin.com/in/maria"));
  assert.ok(txt.endsWith("Confidential."));
  const m = C.build(s, { target: "mail", src: { logo: "data:image/png;base64,AAAA" } }).html;
  assert.ok(!/<table|<td/.test(m), "orOS Mail keeps only simple formatting");
  assert.ok(m.includes("<b>Maria Papadopoulou</b>") && m.includes('<a href="mailto:maria@example.gr">'));
  const file = C.htmlFile(s, "<p>x</p>");
  assert.ok(file.startsWith("<!DOCTYPE html>") && file.includes('<meta charset="utf-8">') && file.includes("<title>Work</title>"));
  const tplPlain = C.build(Object.assign({}, s, { tpl: "plain", im: { logo: { u: "https://a.gr/l.png" } } }), { target: "embed" }).html;
  assert.ok(!tplPlain.includes("<img"), "Text only has no pictures");
});

test("checks: links, contrast, web pictures, Gmail limit", () => {
  const codes = (s, o) => C.checks(s, o).map((c) => c.code + (c.n && typeof c.n === "string" ? ":" + c.n : ""));
  assert.deepEqual(codes(sample(), { target: "embed" }), []);
  assert.ok(codes(sample({ f: { email: "nope" } }), {}).includes("noname"));
  assert.ok(codes(sample({ f: { name: "x", email: "nope" } }), {}).includes("bademail"));
  assert.ok(codes(sample({ st: { acc: "#ffff00" } }), {}).includes("lowacc"));
  assert.ok(codes(sample({ im: { logo: { a: "a".repeat(64) + ".png" } } }), { target: "web" }).includes("needurl:logo"));
  const big = C.checks(sample(), { target: "web", html: "x".repeat(10001) });
  assert.ok(big.some((c) => c.code === "gmail" && c.n === 10001));
});

test("vCard for the QR code", () => {
  const v = C.vcard(sample());
  assert.ok(v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\nN:Papadopoulou;Maria;;;"));
  assert.ok(v.includes("TEL;TYPE=CELL:+306900000000") && v.includes("EMAIL;TYPE=INTERNET:maria@example.gr") && v.endsWith("END:VCARD"));
  assert.ok(C.vcard(sample({ f: { name: "A;B", company: "x,y" } })).includes("FN:A\\;B"));
});

test("fill from Invoices, Contacts and the Atelier brand kit", () => {
  assert.deepEqual(C.fromInvoices({ name: "Glaros IKE", trade: "Glaros", afm: "123456789", phone: "210", email: "a@b.gr", web: "g.gr", addr: "Odos 1", country: "GR" }),
    { company: "Glaros", vat: "123456789", phone: "210", email: "a@b.gr", web: "g.gr", addr: "Odos 1, GR" });
  const c = C.fromContact({ given: "Nikos", family: "Georgiou", org: "ACME", jobTitle: "CTO",
    phones: [{ v: "+30 690", type: "mobile" }, { v: "+30 210", type: "work" }], emails: [{ v: "n@a.gr" }],
    addresses: [{ street: "Odos 2", city: "Athens", zip: "10558", country: "Greece" }] });
  assert.equal(c.name, "Nikos Georgiou");
  assert.equal(c.mobile, "+30 690");
  assert.equal(c.phone, "+30 210");
  assert.equal(c.addr, "Odos 2, 10558 Athens, Greece");
  const b = C.fromBrand({ colors: [{ c: "#fafafa" }, { c: "#c0392b" }, { c: "#111111" }], fonts: { t: { f: "serif" } },
    logos: [{ a: "c".repeat(64) + ".png", w: 10, h: 5, pos: 2 }, { a: "d".repeat(64) + ".png", w: 1, h: 1, pos: 1 }, { a: "bad" }] });
  assert.equal(b.acc, "#c0392b", "a pale colour is skipped for the accent");
  assert.equal(b.txt, "#111111");
  assert.equal(b.font, "georgia");
  assert.deepEqual(b.logos.map((l) => l.a[0]), ["d", "c"]);
});

test("team: CSV (comma, semicolon, quotes, Greek headers) → one signature each", () => {
  const r = C.teamRows('﻿όνομα;θέση;email;φωτογραφία\n"Παπάς, Γιώργος";CEO;g@a.gr;https://a.gr/g.jpg\n;;;\nΕλένη;"Line ""1""";e@a.gr;http://insecure/x.jpg\n');
  assert.deepEqual(r.cols, ["name", "title", "email", "photo"]);
  assert.equal(r.people.length, 2);
  assert.equal(r.people[0].name, "Παπάς, Γιώργος");
  assert.equal(r.people[1].title, 'Line "1"');
  assert.equal(C.teamRows("title,email\nx,y").error, "noname");
  const base = sample({ im: { photo: { a: "e".repeat(64) + ".jpg" }, logo: { a: "a".repeat(64) + ".png" } } });
  const p0 = C.forPerson(base, r.people[0]), p1 = C.forPerson(base, r.people[1]);
  assert.equal(p0.f.name, "Παπάς, Γιώργος");
  assert.equal(p0.f.company, "Glaros Ltd", "company details come from the template");
  assert.equal(p0.im.photo.u, "https://a.gr/g.jpg");
  assert.equal(p1.im.photo, undefined, "never the template's own photo; http dropped");
  assert.ok(p1.im.logo);
  assert.equal(C.fileStem("Παπάς, Γιώργος"), "Παπάς,-Γιώργος");
  assert.equal(C.fileStem('a/b:c*?"'), "a-b-c");
});

test("zip: a valid archive the Atelier reader opens, UTF-8 names, CRC", async () => {
  assert.equal(C.crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
  const Z = require(path.join(ROOT, "atelier/zip.js"));
  const bytes = C.zip([{ name: "Μαρία.html", text: "<p>Γεια</p>" }, { name: "Μαρία.html", text: "two" }, { name: "b.html", text: "" }], new Date(2026, 9, 13, 12, 0, 0));
  const z = Z.open(bytes);
  assert.deepEqual(z.names, ["Μαρία.html", "Μαρία-2.html", "b.html"]);
  assert.equal(await z.text("Μαρία.html"), "<p>Γεια</p>");
  assert.equal(await z.text("Μαρία-2.html"), "two");
});

test("search provider: one hit per live signature, opens by id", () => {
  const d = C.merge({ sigs: [sample(), sample({ id: "sgone1234", m: 5 })], tombs: { sgone1234: 9 } });
  const hits = P.search({ lang: "en", readJSON: () => d });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, "Work");
  assert.ok(hits[0].text.includes("Glaros Ltd") && hits[0].text.includes("maria@example.gr"));
  assert.deepEqual(hits[0].target, { id: ID });
  assert.deepEqual(P.search({ lang: "el", readJSON: () => null }), []);
  let opened = null;
  P.open({ id: ID }, { __orosOpenAt: (app, t) => { opened = [app, t]; } });
  assert.deepEqual(opened, ["signature", { id: ID }]);
  assert.deepEqual(P.keys, [C.DATA_KEY]);
});

test("wiring: palette guards, sync slice, deep link, help pages, scripts", () => {
  const js = read("signature/signature.js"), html = read("signature/index.html");
  assert.ok(js.includes("function inheritPalette") && js.includes("function watchPalette"));
  assert.ok(js.includes('api.registerSlice("signature", sliceGet, sliceSet, C.DATA_KEY, C.merge)'));
  assert.ok(js.includes("window.__orosOpenAt = openTarget;"));
  assert.ok(js.includes('__orosTakeTarget("signature")'));
  ["../designkit/assets.js", "../qr/qr-encode.js", "core.js", "signature.js"].forEach((f) => assert.ok(html.includes('src="' + f + "?v="), f));
  assert.ok(/<iframe id="pv"[^>]*sandbox="allow-same-origin"/.test(html), "the preview runs no script");
  ["en", "el"].forEach((l) => assert.ok(fs.existsSync(path.join(ROOT, "signature/help." + l + ".txt"))));
  // every string key exists in both languages
  const block = js.slice(js.indexOf("var STRINGS = {"), js.indexOf("function t(k, vars)"));
  const en = block.slice(0, block.indexOf("\n    el: {")), el = block.slice(block.indexOf("\n    el: {"));
  const keys = (s) => (s.match(/"([a-zA-Z.]+)":/g) || []).map((k) => k.slice(1, -2)).sort();
  assert.deepEqual(keys(el), keys(en));
});

test("Mail: BR-MAIL-SIG receiver asks for the account and cleans the HTML", () => {
  const src = read("mail/mail.js");
  assert.ok(src.includes("if (sg && typeof sg === \"object\") { signatureDialog(sg); return true; }"));
  const fn = src.slice(src.indexOf("function signatureDialog(sg)"), src.indexOf("// Drops this device's password"));
  assert.ok(fn.includes("RT.clean(html, { cid: false })"), "goes through rich.js clean()");
  assert.ok(fn.includes('form.addEventListener("submit"'), "nothing changes before Use");
  assert.ok(fn.includes("normAccount(next)") && fn.includes("saveData()"));
  ["sigIn.title", "sigIn.text", "sigIn.acct", "sigIn.ok", "sigIn.none", "sigIn.done"].forEach((k) => {
    assert.equal(src.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
  });
});
