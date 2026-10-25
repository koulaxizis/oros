// Review copies and reviews in Publishing (wave P8): the rc rows on a
// title, follow-ups due after 3 weeks, quotes into Newsletter blocks,
// the press list across titles.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const P = require(path.join(__dirname, "..", "publish/core.js"));

function title(rc) { return P.normalize({ titles: [{ id: "t1", m: 1, t: "Sea Wolves", ppl: [{ r: "a", n: "Anna" }], blurb: "A story.", rc }] }); }

test("cleanRc: needs a name or outlet; https links only; quote bounded", () => {
  assert.equal(P.cleanRc({ id: "r1" }), null);
  const r = P.cleanRc({ id: "r1", n: "Maria", out: "Daily Books", email: "x", d: "2026-10-01", st: "zz", url: "http://x.example", q: "q".repeat(700) });
  assert.equal(r.st, "sent");
  assert.equal(r.email, "");
  assert.equal(r.url, "");
  assert.equal(r.q.length, 600);
  assert.equal(P.cleanRc({ id: "r2", out: "Blog", url: "https://blog.example/review", st: "rev" }).url, "https://blog.example/review");
  assert.equal(P.cleanRc({ id: "r3", out: "Blog", url: "javascript:alert(1)" }).url, "");
});

test("rcDue: sent, no review, 21 days since sending or the last follow-up", () => {
  const d = title([
    { id: "a", n: "A", d: "2026-09-01", st: "sent" },
    { id: "b", n: "B", d: "2026-09-01", st: "sent", fu: "2026-10-20" },     // followed up lately
    { id: "c", n: "C", d: "2026-09-01", st: "rev", q: "Great" },
    { id: "e", n: "E", d: "2026-10-10", st: "sent" },                      // too recent
    { id: "f", n: "F", d: "2026-08-01", st: "sent", fu: "2026-09-01" }
  ]);
  assert.deepEqual(P.rcDue(d, "2026-10-25").map((x) => x.rc.id), ["f", "a"]);
  assert.deepEqual(P.rcDue(d, "2026-10-25", 10).map((x) => x.rc.id), ["f", "a", "e"]);
});

test("quotes go into the Newsletter blocks, newest two", () => {
  const d = title([
    { id: "a", out: "Paper", st: "rev", q: "Wonderful", rd: "2026-10-01" },
    { id: "b", n: "Blogger", st: "rev", q: "A must", rd: "2026-10-10" },
    { id: "c", out: "Radio", st: "rev", q: "Brave", rd: "2026-09-01" },
    { id: "e", out: "TV", st: "rev", q: "", rd: "2026-10-20" }
  ]);
  const t = d.titles[0];
  assert.deepEqual(P.quotes(t).map((x) => x.who), ["Blogger", "Paper", "Radio"]);
  const blocks = P.newsBlocks(t, {});
  assert.equal(blocks[2].t, "“A must” — Blogger\n\n“Wonderful” — Paper");
  // no reviews: blocks as before
  assert.equal(P.newsBlocks(title([]).titles[0], {}).length, 2);
});

test("pressList: one row per name across titles, newest details", () => {
  const d = P.normalize({ titles: [
    { id: "t1", m: 1, t: "One", rc: [{ id: "a", n: "Maria", out: "Old Paper", email: "m@old.example", d: "2026-01-01" }] },
    { id: "t2", m: 1, t: "Two", rc: [{ id: "b", n: "maria", out: "New Paper", email: "m@new.example", d: "2026-06-01" }, { id: "c", out: "Radio X", d: "2026-02-01" }] }
  ] });
  assert.deepEqual(P.pressList(d).map((x) => x.out + " " + x.email), ["New Paper m@new.example", "Radio X "]);
});
