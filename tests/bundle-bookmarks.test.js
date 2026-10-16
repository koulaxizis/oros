// The .orosbookmarks file (Bookmarks, phase 4b wave 2): every bookmark
// and folder through the shared kit (recordpkg.js) and bundle.js;
// opening adds only what is missing, with its ids. No tombstones,
// settings, root folder or saved-copy records in the file. Plus the
// app wiring (Save, Open, unzipped folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "bookmarks/package.js"));
const C = require(path.join(ROOT, "bookmarks/core.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));

function item(id, url, folderId, m, extra) {
  return Object.assign({ id: id, url: url, title: id.toUpperCase(), note: "", folderId: folderId, tags: [], status: "ok",
    visits: 0, lastVisit: 0, fav: false, pos: 0, added: m, modified: m }, extra || {});
}
function slice() {
  return {
    ver: 1,
    deleted: { gone: NOW - 100 },
    settings: { x: 1 },
    folders: {
      unsorted: { id: "unsorted", name: "unsorted", pos: 0, modified: 0 },
      work: { id: "work", name: "Work", pos: 1, modified: NOW - 900 },
      docs: { id: "docs", name: "Docs", pos: 0, parent: "work", modified: NOW - 800 }
    },
    items: {
      a: item("a", "https://a.example/x", "docs", NOW - 700, { title: "Alpha <b>", note: "line1\nline2", tags: ["t1", "t2"],
        fav: true, visits: 3, lastVisit: NOW - 10, chk: { s: "ok", at: NOW - 50, code: 200 },
        arch: { at: NOW - 40, f: "a.html", n: 900 } }),
      b: item("b", "https://b.example", "unsorted", NOW - 600)
    }
  };
}
function fresh() {
  return { ver: 1, deleted: {}, settings: {}, items: {},
    folders: { unsorted: { id: "unsorted", name: "unsorted", pos: 0, modified: 0 } } };
}

test("bookmarks: round trip through bundle.js; no tombstones, settings, root folder or saved copies in the file", async () => {
  const o = K.pack(D, slice(), { title: "Bookmarks", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-bookmarks");
  assert.equal(o.generator, "orOS Bookmarks");
  const data = o.content.data;
  assert.deepEqual(Object.keys(data).sort(), ["folders", "items", "ver"]);
  assert.deepEqual(Object.keys(data.folders).sort(), ["docs", "work"]);
  assert.equal(data.items.a.arch, undefined);
  assert.deepEqual(data.items.a.chk, { s: "ok", at: NOW - 50, code: 200 });
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-bookmarks");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-bookmarks-package");
  assert.deepEqual(r.content.data, data);
  // preview: the app's Netscape export, nested, escaped, Unsorted at the top level
  const html = o.preview.find((p) => p.name === "bookmarks.html").data;
  assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
  assert.match(html, /<DT><H3>Work<\/H3>\n    <DL><p>\n        <DT><H3>Docs<\/H3>\n        <DL><p>\n            <DT><A HREF="https:\/\/a.example\/x"[^>]* TAGS="t1,t2">Alpha &lt;b&gt;<\/A>\n            <DD>line1<br>line2/);
  assert.match(html, /\n    <DT><A HREF="https:\/\/b.example"[^>]*>B<\/A>\n<\/DL><p>\n$/);
  const back = C.parseNetscape(html);
  assert.equal(back.length, 2);
  // into a device with nothing but its root folder
  const res = K.open(D, fresh(), r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 4, skipped: 0, updated: 0 });
  assert.deepEqual(res.addedIds.slice().sort(), ["a", "b", "docs", "work"]);
  assert.equal(res.next.folders.docs.parent, "work");
  assert.equal(res.next.items.a.folderId, "docs");
  assert.equal(res.next.items.a.title, "Alpha <b>");
  assert.deepEqual(res.next.folders.unsorted, fresh().folders.unsorted);
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.skipped, 4);
  assert.deepEqual(again.next, res.next);
});

test("bookmarks: a clash keeps the local record, a deleted one stays deleted, update takes newer and keeps the local copy", () => {
  const theirs = slice();
  theirs.items.gone = item("gone", "https://gone.example", "unsorted", NOW - 1);
  theirs.items.a.title = "changed later"; theirs.items.a.modified = NOW - 1;
  theirs.items.a.visits = 1;
  theirs.items.c = item("c", "https://c.example", "work", NOW - 5);
  theirs.folders.work.name = "Work (theirs)"; theirs.folders.work.modified = NOW - 2;
  const mine = slice();
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["c"]);
  assert.equal(res.next.items.a.title, "Alpha <b>");
  assert.equal(res.next.folders.work.name, "Work");
  assert.equal(res.next.items.gone, undefined);
  assert.equal(res.next.items.c.folderId, "work");
  assert.deepEqual(res.next.deleted, mine.deleted);
  assert.deepEqual(res.next.settings, mine.settings);
  // "Update with newer versions"
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds.slice().sort(), ["a", "work"]);
  assert.equal(upd.next.items.a.title, "changed later");
  assert.equal(upd.next.items.a.arch, undefined);                         // the file has none…
  const s = P.settle(mine, clone(upd.next), upd.addedIds, upd.updatedIds, NOW);
  assert.deepEqual(s.items.a.arch, mine.items.a.arch);                    // …settle keeps this device's
  assert.equal(s.items.a.visits, 3);
  assert.equal(s.items.a.lastVisit, NOW - 10);
  assert.equal(P.kindOf("a", s), "item");
  assert.equal(P.kindOf("work", s), "folder");
  assert.equal(P.kindOf("nope", s), "");
});

test("bookmarks: hostile content is cut down (addresses, ids, stamps, fields, sizes)", () => {
  const big = "x".repeat(5000);
  const bad = {
    kind: "oros-bookmarks-package", ver: 1,
    data: {
      deleted: { b: 1 },
      folders: {
        unsorted: { id: "unsorted", name: "Evil root", pos: 0, modified: NOW + 1e9 },
        f1: { id: "f1", name: "a\u0000b" + big, pos: "x", parent: "f1", modified: NOW + 1e9, evil: 1 },
        "bad id": { id: "bad id", name: "x" },
        f2: { id: "other", name: "mismatch" },
        __proto__x: { id: "__proto__x", name: "" }
      },
      items: {
        js: item("js", "javascript:alert(1)", "f1", 1),
        data: item("data", "data:text/html,<script>", "f1", 1),
        rel: item("rel", "example.com", "f1", 1),
        b: item("b", "https://b.example", "f1", 1),
        ok: { id: "ok", url: "https://ok.example/" + big, title: { x: 1 }, note: big + "\u0007", folderId: "../x",
              tags: Array(40).fill("tag\u0000" + big), status: "pwned", visits: -5, lastVisit: NOW + 1e12,
              fav: "yes", pos: Infinity, added: NOW + 1e12, modified: NOW + 1e12, onclick: "x",
              chk: { s: "moved", at: NOW + 1e12, to: "javascript:x" }, arch: { at: 1, f: "../../etc.html" } }
      }
    }
  };
  const res = K.open(D, fresh(), bad, { now: NOW });
  assert.deepEqual(Object.keys(res.next.items).sort(), ["b", "ok"]);      // only http(s) addresses; the file's tombstones are ignored
  assert.deepEqual(res.next.deleted, {});
  assert.deepEqual(Object.keys(res.next.folders).sort(), ["f1", "unsorted"]);
  assert.equal(res.next.folders.unsorted.name, "unsorted");               // the root is never taken from a file
  const f1 = res.next.folders.f1;
  assert.equal(f1.name.length, 64);
  assert.ok(f1.name.startsWith("a b"));
  assert.equal(f1.parent, undefined);
  assert.equal(f1.pos, 1000);
  assert.equal(f1.evil, undefined);
  assert.equal(f1.modified, NOW + K.FUTURE);
  const it = res.next.items.ok;
  assert.equal(it.url.length, 2048);
  assert.equal(it.title, it.url);
  assert.equal(it.note.length, 1024);
  assert.equal(it.folderId, "unsorted");
  assert.equal(it.tags.length, 12);
  assert.ok(it.tags.every((tg) => tg.length <= 32 && !/\u0000/.test(tg)));
  assert.deepEqual([it.status, it.visits, it.fav, it.pos, it.onclick, it.arch], ["ok", 0, false, null, undefined, undefined]);
  assert.equal(it.modified, NOW + K.FUTURE);
  assert.deepEqual(it.chk, { s: "ok", at: NOW + K.FUTURE });               // a "moved" without a web address is just ok
  const s = P.settle(fresh(), clone(res.next), res.addedIds, [], NOW);
  assert.equal(s.items.ok.added, NOW + K.FUTURE);
  assert.equal(s.items.ok.lastVisit, NOW + K.FUTURE);
  assert.equal(D.norm("x"), null);
  assert.throws(() => K.open(D, fresh(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
});

test("bookmarks: wiring (scripts, menus, Open with, Undo, help, file types)", () => {
  const html = read("bookmarks/index.html");
  ["../bundle.js?v=2.50.00", "../recordpkg.js?v=2.50.00", "package.js?v=2.50.00", "bookmarks.js?v=2.50.00"].forEach((s) =>
    assert.ok(html.includes('src="' + s + '"'), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="bookmarks.js'));
  const js = read("bookmarks/bookmarks.js");
  assert.match(js, /RP\.ui\(BPK\.DESC,/);
  assert.match(js, /if \(t && t\.openFile\) \{ if \(recFile\) recFile\.openTarget\(t\.openFile\); return; \}/);
  assert.match(js, /__orosTakeFile\(/);
  assert.match(js, /platformUndo\(back\)/);
  assert.match(js, /BPK\.settle\(/);
  ["file.save", "file.open", "file.folder", "imp.menu.app", "exp.menu.html"].forEach((k) =>
    assert.equal(js.split('"' + k + '":').length, 3, k));                  // EN and EL
  assert.ok(js.includes('"orOS file (.orosbookmarks)"') && js.includes('"Αρχείο orOS (.orosbookmarks)"'));
  for (const f of ["bookmarks/help.en.txt", "bookmarks/help.el.txt"]) {
    const h = read(f);
    assert.ok(h.includes(".orosbookmarks"), f);
    assert.ok(h.includes("Archive"), f);
  }
  assert.deepEqual(F.appsFor(".orosbookmarks"), ["bookmarks"]);
  assert.deepEqual(B.TYPES[".orosbookmarks"], { app: "bookmarks", mime: "application/x-oros-bookmarks" });
});
