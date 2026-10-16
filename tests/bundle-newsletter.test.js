// The .orosnewsletter file (Newsletter, a record app): every list,
// subscriber, issue, segment, template, RSS feed and sending account
// through the shared kit (recordpkg.js) and bundle.js, the pictures in
// media/; opening adds only what is missing, with its ids. No secrets,
// no tokens, nothing device-only in the file. Plus the app wiring
// (Save, Open, unzipped folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "newsletter/core.js"));
const P = require(path.join(ROOT, "newsletter/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const SHA = require("crypto").createHash("sha256").update(JPG).digest("hex");

const FORM = {
  k: "abcdefghij012345", sec: "A".repeat(32), back: "https://example.org/thanks", dev: "dev123", at: NOW - 5000,
  priv: { kty: "RSA", n: "nnn", e: "AQAB", d: "secretd", p: "pp", q: "qq", dp: "dp", dq: "dq", qi: "qi" }
};
function slice() {
  const L = "lst-news", e1 = "ann@example.org", e2 = "bob@example.org";
  return C.normalize({
    ver: 1,
    chans: [{ id: "chn-smtp", m: NOW - 9000, name: "Postmark", kind: "smtp", preset: "postmark", host: "smtp.postmarkapp.com",
              port: 587, user: "server-token-secret", rate: 1, cap: 100 }],
    lists: [{ id: L, m: NOW - 8000, name: "Weekly", chan: "chn-smtp", from: "me@example.org", lang: "en",
              salt: "saltsalt12", form: FORM, why: "You asked." },
            { id: "lst-gone", m: NOW - 100, del: 1 }],
    subs: [{ id: C.subId(L, e1), m: NOW - 7000, list: L, email: e1, name: "=Ann", tags: ["vip"], at: NOW - 7000, conf: NOW - 7000 },
           { id: C.subId(L, e2), m: NOW - 6900, list: L, email: e2, name: "Bob", at: NOW - 6900, conf: 0, inv: NOW - 6800 },
           { id: "s-deleted01", m: NOW - 50, del: 1 }],
    issues: [{ id: "iss-sent", m: NOW - 6000, list: L, subj: "Hello", fmt: "blocks", st: "sent", done: NOW - 6000, n: 2,
               blocks: [{ k: "h", t: "Title" }, { k: "p", t: "Some <b>text</b>" },
                        { k: "img", f: "/internal/Newsletter/img-aaaa.jpg", alt: "A cat", w: 600, h: 400, b: 1000 },
                        { k: "btn", t: "Read", href: "https://example.org/a" }] },
             { id: "iss-going", m: NOW - 5000, list: L, subj: "Out now", fmt: "md", md: "# Hi\n\ntext", st: "sending",
               start: NOW - 5000, n: 1, lock: { dev: "dev123", at: NOW - 5000 }, fail: { [C.subId(L, e2)]: "refused" } },
             { id: "iss-sched", m: NOW - 4000, list: L, subj: "Later", st: "sched", when: NOW + 99999, lock: { dev: "dev123", at: NOW } }],
    segs: [{ id: "seg-vip", m: NOW - 3000, list: L, name: "VIPs", tags: ["vip"] }],
    tpls: [{ id: "tpl-base", m: NOW - 2000, name: "Base", blocks: [{ k: "img", f: "/internal/Newsletter/logo.png", w: 100, h: 50 }] }],
    rss: [{ id: "rss-blog", m: NOW - 1000, list: L, url: "https://example.org/feed", name: "Blog", mode: "send", dev: "dev123", on: 1 }],
    plinks: [{ id: "pl-x", m: NOW - 900, list: L, acct: "acct0001", p: "brevo", grp: "12", gname: "Group" }],
    sent: { "iss-going": [C.subId(L, e1)] },
    supp: [C.suppHash("gone@example.org")]
  });
}
// a device with other data of its own
function other() {
  return C.normalize({
    ver: 1,
    lists: [{ id: "lst-mine", m: NOW - 100, name: "Mine", lang: "el", salt: "mysalt9999" }],
    subs: [{ id: C.subId("lst-mine", "zoe@example.org"), m: NOW - 100, list: "lst-mine", email: "zoe@example.org", at: 1, conf: 1 }],
    supp: [C.suppHash("old@example.org")]
  });
}

test("newsletter: round trip through bundle.js; no secrets, tokens, tombstones or device-only fields", async () => {
  const st = slice();
  st.imgs = { "/internal/Newsletter/img-aaaa.jpg": SHA + ".jpg", "/internal/Newsletter/logo.png": "b".repeat(64) + ".png" };
  const o = K.pack(D, st, { title: "Newsletter", lang: "en", now: NOW,
    files: [{ key: SHA + ".jpg", bytes: JPG, type: "image/jpeg" }] });
  assert.equal(o.mime, "application/x-oros-newsletter");
  assert.equal(o.generator, "orOS Newsletter");
  const data = o.content.data;
  assert.deepEqual(Object.keys(data).sort(), ["chans", "imgs", "issues", "lists", "rss", "segs", "subs", "tpls", "ver"]);
  const txt = JSON.stringify(data);
  // never in the file: SMTP user (Postmark: the token), salt, web form keys, sending progress, platform links
  ["server-token-secret", "saltsalt12", "secretd", FORM.sec, FORM.k, "plinks", "supp", "dev123", "\"del\""].forEach((s) =>
    assert.ok(!txt.includes(s), s));
  assert.equal(data.chans[0].user, "");
  assert.equal(data.lists.length, 1);
  assert.equal(data.lists[0].salt, undefined);
  assert.equal(data.lists[0].form, undefined);
  assert.equal(data.subs.length, 2);
  const iss = Object.fromEntries(data.issues.map((x) => [x.id, x]));
  assert.equal(iss["iss-sent"].st, "sent");
  assert.deepEqual([iss["iss-going"].st, iss["iss-going"].lock, iss["iss-going"].fail, iss["iss-going"].n], ["draft", null, {}, 0]);
  assert.deepEqual([iss["iss-sched"].st, iss["iss-sched"].when], ["draft", 0]);
  assert.deepEqual([data.rss[0].on, data.rss[0].dev], [0, ""]);

  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-newsletter");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-newsletter-package");
  assert.deepEqual(r.content.data, data);
  assert.ok(r.media[SHA + ".jpg"]);
  // previews: the app's own subscribers CSV (formula guard), readable issues
  const csv = o.preview.find((p) => p.name === "subscribers-weekly.csv").data;
  assert.match(csv, /^﻿E-mail;Name;Language;Tags;Status;Source;Basis;Subscribed;Confirmed;Left\r\n/);
  assert.ok(csv.includes("ann@example.org;'=Ann;;vip;active;"));
  assert.ok(csv.includes("bob@example.org;Bob;;;pending;"));
  const md = o.preview.find((p) => p.name === "issues.md").data;
  assert.match(md, /^# Newsletter · Issues\n\n## Weekly\n/);
  assert.ok(md.includes("Some &lt;b&gt;text&lt;/b&gt;"));
  assert.ok(md.includes("[Read](https://example.org/a)"));
  const el = K.pack(D, st, { lang: "el", now: NOW }).preview.find((p) => p.name === "subscribers-weekly.csv").data;
  assert.match(el, /^﻿Email;Όνομα;/);

  // into a device with other data
  const mine = other();
  const res = K.open(D, mine, r.content, { now: NOW });
  // chan, list, 2 subs, 3 issues, seg, tpl, rss
  assert.deepEqual(res.report, { added: 10, skipped: 0, updated: 0 });
  assert.ok(res.next.lists.some((l) => l.id === "lst-mine" && l.salt === "mysalt9999"));
  assert.deepEqual(res.next.supp, mine.supp);
  assert.equal(res.next.imgs, undefined);
  // the app saves it through normalize: all of it survives
  const saved = C.normalize(res.next);
  assert.equal(C.live(saved.subs).length, 3);
  assert.equal(C.live(saved.issues).length, 3);
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(again.next, res.next);
});

test("newsletter: a clash keeps the local record, a deleted one stays deleted, update takes newer", () => {
  const theirs = slice();
  const L = "lst-news";
  theirs.subs.find((s) => s.email === "bob@example.org").name = "Robert (file)";
  theirs.subs.find((s) => s.email === "bob@example.org").m = NOW - 10;
  const tl = theirs.lists.find((l) => l.id === L);
  tl.name = "Weekly (file)"; tl.m = NOW - 10;
  theirs.chans[0].name = "Changed"; theirs.chans[0].m = NOW - 10;
  theirs.issues.push({ id: "iss-killed", m: NOW - 20, list: L, subj: "x", fmt: "blocks", blocks: [], md: "", tags: [], seg: "", l2: null,
                       st: "draft", when: 0, lock: null, start: 0, done: 0, n: 0, err: "", fail: {}, imp: 0 });
  const mine = slice();
  mine.issues.push({ id: "iss-killed", m: NOW - 5, del: 1 });
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.equal(res.report.added, 0);
  const bob = res.next.subs.find((s) => s.email === "bob@example.org");
  assert.equal(bob.name, "Bob");
  assert.equal(res.next.lists.find((l) => l.id === L).name, "Weekly");
  assert.equal(res.next.lists.find((l) => l.id === L).salt, "saltsalt12");
  assert.ok(res.next.issues.find((x) => x.id === "iss-killed").del);
  assert.deepEqual(res.next.sent, mine.sent);
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds.slice().sort(), ["chn-smtp", bob.id, L].sort());
  assert.equal(upd.next.subs.find((s) => s.id === bob.id).name, "Robert (file)");
  // the kit hands the app the file's copy (no salt, no form, no user):
  // newsletter.js set() puts this device's own back
  const ul = upd.next.lists.find((l) => l.id === L);
  assert.equal(ul.name, "Weekly (file)");
  assert.equal(ul.salt, undefined);
  assert.ok(upd.next.issues.find((x) => x.id === "iss-killed").del);
  assert.equal(P.kindOf(L, upd.next), "lists");
  assert.equal(P.kindOf(bob.id, upd.next), "subs");
  assert.equal(P.kindOf("iss-killed", upd.next), "");
  assert.equal(P.kindOf("nope", upd.next), "");
});

test("newsletter: hostile content is cut down", () => {
  const n = D.norm({
    lists: [{ id: "lst-evil", m: 1, name: "a\u0000<script>b", from: "not an email", color: "red", theme: "x",
              form: { k: "short", sec: "x", priv: {} }, salt: "!!" },
            { id: "BAD ID", name: "x" }, "junk"],
    subs: [{ id: "s-ok00001", m: 1, list: "lst-evil", email: "ok@example.org", tags: ["a", 5, "a"], src: "hack", at: 50, conf: 0, inv: 0, onclick: "x" },
           { id: "s-bad00001", m: 1, list: "lst-evil", email: "nope" },
           { id: "s-orphan01", m: 1, list: "lst-none", email: "o@example.org" }],
    issues: [{ id: "iss-evil", m: 1, list: "lst-evil", st: "sending", lock: { dev: "zz", at: 1 },
               blocks: [{ k: "script", t: "x" }, { k: "btn", t: "go", href: "javascript:alert(1)" },
                        { k: "img", f: "/etc/passwd" }, { k: "img", f: "/internal/Newsletter/../x.jpg" }] }],
    chans: [{ id: "chn-evil", kind: "smtp", host: "127.0.0.1", port: 25, user: "u" }],
    rss: [{ id: "rss-evil", list: "lst-evil", url: "file:///etc/passwd" }],
    imgs: { "/internal/Newsletter/a.jpg": "f".repeat(64) + ".jpg", "/internal/Newsletter/b.jpg": "f".repeat(64) + ".png",
            "/etc/x.jpg": "f".repeat(64) + ".jpg", "/internal/Newsletter/c.png": "../x.png" },
    sent: { "iss-evil": ["s-ok00001"] }
  });
  const l = n.lists[0];
  assert.equal(n.lists.length, 1);
  assert.equal(l.name, "a <script>b");      // one line; escaped where shown
  assert.deepEqual([l.from, l.color, l.theme, l.form], ["", "#2f6fde", "classic", null]);
  assert.deepEqual(n.subs.map((s) => s.id), ["s-ok00001"]);
  const s = n.subs[0];
  assert.deepEqual([s.tags, s.src, s.onclick], [["a"], "manual", undefined]);
  assert.equal(s.inv, 50);                   // pending: never e-mailed by the open
  const x = D.strip(n).issues[0];
  assert.equal(x.st, "draft");
  assert.equal(x.lock, null);
  assert.deepEqual(x.blocks, [{ k: "btn", t: "go", href: "" }, { k: "img", f: "", alt: "", href: "", w: 600, h: 400, b: 0 },
                              { k: "img", f: "", alt: "", href: "", w: 600, h: 400, b: 0 }]);
  assert.deepEqual([n.chans[0].host, n.chans[0].port], ["", 587]);
  assert.equal(D.strip(n).chans[0].user, "");
  assert.deepEqual(n.rss, []);
  assert.deepEqual(n.imgs, { "/internal/Newsletter/a.jpg": "f".repeat(64) + ".jpg" });
  assert.equal(D.strip(n).sent, undefined);
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm([1]), null);
  // the whole open: no tombstones from the file, nothing outside the slice
  const res = K.open(D, other(), { kind: "oros-newsletter-package", ver: 1, data: {
    lists: [{ id: "lst-mine", m: 1, del: 1 }], subs: [], evil: { x: 1 }, supp: ["x00000000000"], __proto__: { polluted: 1 } } }, { now: NOW });
  assert.equal(res.report.added, 0);
  assert.equal(res.next.evil, undefined);
  assert.ok(res.next.lists.some((q) => q.id === "lst-mine" && !q.del));
  assert.deepEqual(res.next.supp, other().supp);
  assert.equal({}.polluted, undefined);
  // stamps from the future are clamped
  const fut = slice();
  fut.subs.find((q) => q.email === "ann@example.org").m = NOW + 10 * 365 * 864e5;
  const r2 = K.open(D, C.empty(), K.pack(D, fut, { now: NOW }).content, { now: NOW });
  assert.equal(r2.next.subs.find((q) => q.email === "ann@example.org").m, NOW + K.FUTURE);
  assert.throws(() => K.open(D, other(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, other(), { kind: "oros-newsletter-package", ver: 9, data: {} }), /newer/);
  // the picture paths the issues and templates name
  assert.deepEqual(P.imgPaths(slice()), ["/internal/Newsletter/img-aaaa.jpg", "/internal/Newsletter/logo.png"]);
});

test("newsletter: wiring (scripts, buttons, Open with, Undo, help, file types)", () => {
  const html = read("newsletter/index.html");
  ["core.js?v=", "../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "newsletter.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="newsletter.js'));
  const js = read("newsletter/newsletter.js");
  assert.match(js, /RP\.ui\(NPK\.DESC,/);
  assert.match(js, /if \(tg && tg\.openFile\) \{ if \(recFile\) recFile\.openTarget\(tg\.openFile\); return; \}/);
  ["openFile", "__orosTakeFile(", "window.__orosOpenAt =", '__orosTakeTarget("newsletter")', "deleteIds:", "saveNow();"].forEach((s) =>
    assert.ok(js.includes(s), s));
  assert.equal(js.split("window.__orosOpenAt =").length, 2);
  ["nl-osave", "nl-oopen", "nl-ofolder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.ok(js.includes('"set.osave": "orOS file (.orosnewsletter)"'));
  assert.ok(js.includes('"set.oopen": "Open orOS file…"'));
  assert.ok(js.includes('"set.ofolder": "Unzipped orOS folder…"'));
  assert.ok(js.includes('"set.osave": "Αρχείο orOS (.orosnewsletter)"'));
  assert.ok(js.includes('"set.oopen": "Άνοιγμα αρχείου orOS…"'));
  assert.ok(js.includes('"set.ofolder": "Αποσυμπιεσμένος φάκελος orOS…"'));
  for (const f of ["newsletter/help.en.txt", "newsletter/help.el.txt"]) assert.ok(read(f).includes(".orosnewsletter"), f);
  assert.deepEqual(F.appsFor(".orosnewsletter"), ["newsletter"]);
  assert.deepEqual(B.TYPES[".orosnewsletter"], { app: "newsletter", mime: "application/x-oros-newsletter" });
});
