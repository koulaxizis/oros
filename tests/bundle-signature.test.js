// The .orossignature file (Email Signature, a record app): every
// signature through the shared kit (recordpkg.js) and bundle.js, its
// pictures (orOS disk assets) in media/; opening adds only what is
// missing, with its ids. Plus the app wiring (Save, Open, unzipped
// folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "signature/core.js"));
const P = require(path.join(ROOT, "signature/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = Date.now();

// a real 1x1 PNG; its asset id is its own hash
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const LOGO = crypto.createHash("sha256").update(PNG).digest("hex") + ".png";

function sig(id, o) {
  return C.normSig(Object.assign({
    id, m: NOW - 1000, nm: "Work " + id, lang: "en", tpl: "classic",
    f: { name: "Maria Smith", title: "Sales", company: "Acme", email: "maria@example.com", phone: "+30 210 0000000", web: "acme.example" },
    so: [{ k: "linkedin", u: "https://linkedin.com/in/maria" }], cta: { t: "Book", u: "https://acme.example/book" },
    st: {}, im: { logo: { a: LOGO, u: "https://acme.example/logo.png", w: 1, h: 1 }, photo: { u: "https://acme.example/me.jpg", w: 10, h: 10 } }, qr: 1
  }, o || {}));
}
function slice() {
  return C.merge({ ver: 1,
    sigs: [sig("saaaaaa01"), sig("saaaaaa02", { nm: "Greek", lang: "el", im: {} }), sig("sgone0001", { m: NOW - 9000 })],
    tombs: { sgone0001: NOW - 500 } }, null);
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }

test("signature: round trip through bundle.js with the logo in media/; no tombstones, no prefs", async () => {
  const s = slice();
  assert.deepEqual(s.sigs.map((x) => x.id), ["saaaaaa01", "saaaaaa02"]);
  assert.deepEqual(P.assetIds(s), [LOGO]);
  const o = K.pack(D, s, { title: "Email Signature", lang: "en", now: NOW, files: [{ key: LOGO, bytes: new Uint8Array(PNG), type: "image/png" }] });
  assert.equal(o.mime, "application/x-oros-signature");
  assert.equal(o.generator, "orOS Email Signature");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["sigs", "ver"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-signature");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-signature-package");
  assert.deepEqual(r.content.data.sigs, s.sigs);
  assert.deepEqual(Object.keys(r.media), [LOGO]);
  assert.equal(r.media[LOGO].type, "image/png");
  assert.deepEqual(Object.keys(r.rekeyed), []);
  assert.ok(!JSON.stringify(r.content).includes("target"));       // prefs stay on the device
  // previews
  const names = o.preview.map((p) => p.name).sort();
  assert.deepEqual(names, ["signatures.html", "signatures.md"]);
  const md = o.preview.find((p) => p.name === "signatures.md").data;
  assert.match(md, /^# Email signatures\n\n## Work saaaaaa01\n\nLayout: classic · Language: en\n/);
  assert.ok(md.includes("## Greek\n"));
  assert.ok(md.includes("Maria Smith  \nSales  \nAcme  \n"));
  const html = o.preview.find((p) => p.name === "signatures.html").data;
  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(html.includes("https://acme.example/logo.png"));        // hosted picture only
  assert.ok(!html.includes("data:"));
  assert.match(K.pack(D, s, { lang: "el", now: NOW }).preview.find((p) => p.name === "signatures.md").data, /^# Υπογραφές email/);
  // into a device with other data
  const other = C.merge({ sigs: [sig("sbbbbbb01", { nm: "Mine" })], tombs: {} }, null);
  const res = K.open(D, other, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 2, skipped: 0, updated: 0 });
  assert.deepEqual(res.addedIds.slice().sort(), ["saaaaaa01", "saaaaaa02"]);
  assert.deepEqual(res.next.sigs.map((x) => x.id), ["saaaaaa01", "saaaaaa02", "sbbbbbb01"]);
  assert.deepEqual(res.next, C.merge(res.next, null));              // canonical, as the slice wants
  assert.deepEqual(P.assetIds(res.next, res.addedIds), [LOGO]);
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.skipped, 2);
  assert.deepEqual(again.next, res.next);
  // an empty slice gives no previews
  assert.deepEqual(K.pack(D, C.empty(), { now: NOW }).preview, []);
});

test("signature: a clash keeps the local signature; deleted stays deleted; update takes newer", () => {
  const mine = slice();
  const theirs = clone(mine);
  theirs.sigs[0].f.name = "Renamed"; theirs.sigs[0].m = NOW - 1;
  theirs.sigs.push(sig("sgone0001", { nm: "Back?", m: NOW - 1 }));
  theirs.sigs.push(sig("sccccccc1", { m: NOW - 1 }));
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["sccccccc1"]);
  assert.deepEqual(res.report, { added: 1, skipped: 3, updated: 0 });
  assert.equal(C.byId(res.next, "saaaaaa01").f.name, "Maria Smith");
  assert.equal(C.byId(res.next, "sgone0001"), null);
  assert.ok(res.next.tombs.sgone0001);
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, ["saaaaaa01"]);
  assert.equal(C.byId(upd.next, "saaaaaa01").f.name, "Renamed");
  assert.equal(C.byId(upd.next, "sgone0001"), null);
  // an older copy never wins, even with update
  const old = clone(mine); old.sigs[0].f.name = "Old"; old.sigs[0].m = NOW - 99999;
  const u2 = K.open(D, mine, K.pack(D, old, { now: NOW }).content, { update: true, now: NOW });
  assert.equal(C.byId(u2.next, "saaaaaa01").f.name, "Maria Smith");
  // Undo goes the app's own way (core remove → a tombstone that syncs)
  const undone = C.remove(res.next, "sccccccc1", NOW);
  assert.equal(C.byId(undone, "sccccccc1"), null);
  assert.ok(undone.tombs.sccccccc1 >= NOW - 1);
});

test("signature: hostile content is cut down; bad pictures dropped; stamps clamped; wrong kinds refused", () => {
  const evil = {
    kind: "oros-signature-package", ver: 1,
    data: {
      ver: 1, tombs: { saaaaaa01: 1, "BAD ID": 1 }, cur: "x", target: "gmail", apiKey: "secret",
      sigs: [
        { id: "sokay0001", m: NOW * 2, nm: "<b>Ok</b>\u0000\n", lang: "xx", tpl: "evil", onclick: "x",
          f: { name: "<script>alert(1)</script>", email: "a@b.c", web: "javascript:alert(1)", legal: "x".repeat(5000) },
          so: [{ k: "evil", u: "https://x.example" }, { k: "x", u: "javascript:alert(1)" }, { k: "github", u: "github.com/me" }],
          cta: { t: "Go", u: "data:text/html,<script>" },
          st: { acc: "red;background:url(x)", font: "comic", size: 99 },
          im: { logo: { a: "../../etc/passwd", u: "http://insecure.example/a.png" }, photo: { a: LOGO }, ban: { u: "https://x.example/b.png", link: "javascript:x" } },
          qr: 7 },
        { id: "BAD ID", m: 5 }, { id: "short", m: 5 }, { id: "__proto__", m: 5 }, { id: "snostamp1" }, { id: "sfrac0001", m: 1.5 },
        { id: "saaaaaa01", m: 3 },                         // a file's tombstones are ignored
        { id: "sokay0001", m: 9, nm: "dupe" },
        "junk", null, 7
      ]
    }
  };
  const res = K.open(D, C.empty(), evil, { now: NOW });
  assert.deepEqual(res.addedIds.slice().sort(), ["saaaaaa01", "sokay0001"]);
  const s = C.byId(res.next, "sokay0001");
  assert.equal(s.nm, "<b>Ok</b>");                        // plain text: core.build escapes it
  assert.equal(s.lang, "en");
  assert.equal(s.tpl, "classic");
  assert.equal(s.onclick, undefined);
  assert.equal(s.f.web, "javascript:alert(1)");           // kept as typed text, but never a link:
  assert.equal(C.webUrl(s.f.web), "");
  assert.ok(!C.build(s, { target: "embed" }).html.includes("<script"));
  assert.ok(!C.build(s, { target: "embed" }).html.includes("javascript:"));
  assert.equal(s.f.legal.length, C.LIM.legal);
  assert.deepEqual(s.so, [{ k: "github", u: "https://github.com/me" }]);
  assert.equal(s.cta.u, "");
  assert.equal(s.st.acc, C.DEFAULT_ST.acc);
  assert.equal(s.st.font, "arial");
  assert.equal(s.st.size, 16);
  assert.equal(s.im.logo, undefined);                     // bad asset id, http only: gone
  assert.deepEqual(s.im.photo, { a: LOGO, w: 0, h: 0 });
  assert.equal(s.im.ban.link, "");
  assert.equal(s.qr, 0);
  assert.equal(s.m, NOW + K.FUTURE);
  assert.deepEqual(res.next.tombs, {});                   // a file never brings tombstones
  ["cur", "target", "apiKey"].forEach((k) => assert.equal(res.next[k], undefined));
  // a picture whose bytes failed the checks leaves the signature (a web address stays)
  const st = clone(res.next);
  C.byId(st, "sokay0001").im.logo = { a: LOGO, u: "https://x.example/l.png", w: 1, h: 1 };
  P.dropAssets(st, ["sokay0001"], [LOGO]);
  assert.equal(C.byId(st, "sokay0001").im.photo, undefined);
  assert.deepEqual(C.byId(st, "sokay0001").im.logo, { u: "https://x.example/l.png", w: 1, h: 1 });
  assert.deepEqual(P.dropAssets(clone(res.next), ["saaaaaa01"], [LOGO]), res.next);   // only the ids given
  // norm
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm([1, 2]), null);
  assert.deepEqual(D.norm({}), { ver: 1, sigs: [], tombs: {} });
  assert.throws(() => K.open(D, slice(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, slice(), { kind: "oros-signature-package", ver: 9, data: {} }), /newer/);
  const many = { sigs: [] };
  for (let i = 0; i < P.LIM.sigs + 5; i++) many.sigs.push({ id: "s" + String(i).padStart(8, "0"), m: 5 });
  assert.equal(D.norm(many).sigs.length, P.LIM.sigs);
  // previews escape what they show
  const h = K.pack(D, res.next, { now: NOW }).preview.find((p) => p.name === "signatures.html").data;
  assert.ok(!h.includes("<script>alert"));
  assert.ok(h.includes("&lt;b&gt;Ok&lt;/b&gt;"));
});

test("signature: wiring (scripts, buttons, Open with, Undo, media, help, file types)", () => {
  const html = read("signature/index.html");
  ["core.js?v=", "../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "signature.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="signature.js'));
  ["osave-btn", "oopen-btn", "ofolder-btn", "oopen-first", "ofolder-first"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  const js = read("signature/signature.js");
  assert.match(js, /RP\.ui\(SPK\.DESC,/);
  assert.match(js, /if \(recFile\) recFile\.openTarget\(target\.openFile\);/);
  ["openFile", "__orosTakeFile(", "window.__orosOpenAt =", '__orosTakeTarget("signature")', "deleteIds:", "C.remove(data, id, now)",
   "files: function (state)", "media: function (read, res)", "AS.put(a, blob)"].forEach((s) => assert.ok(js.includes(s), s));
  assert.equal(js.split("window.__orosOpenAt =").length, 2);
  ["osave-btn", "oopen-btn", "ofolder-btn", "oopen-first", "ofolder-first"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.ok(js.includes('"btn.osave": "orOS file (.orossignature)"'));
  assert.ok(js.includes('"btn.osave": "Αρχείο orOS (.orossignature)"'));
  assert.ok(js.includes('"btn.oopen": "Άνοιγμα αρχείου orOS…"'));
  assert.ok(js.includes('"btn.ofolder": "Αποσυμπιεσμένος φάκελος orOS…"'));
  for (const f of ["signature/help.en.txt", "signature/help.el.txt"]) assert.ok(read(f).includes(".orossignature"), f);
  assert.deepEqual(F.appsFor(".orossignature"), ["signature"]);
  assert.deepEqual(B.TYPES[".orossignature"], { app: "signature", mime: "application/x-oros-signature" });
});
