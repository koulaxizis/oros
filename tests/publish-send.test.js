// Publishing wave P2: a title to the other apps. The shop draft must
// pass the Connected services allowlist (links/core.js checkReq, the
// same list the relay keeps), and nothing carries the title's HTML.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../publish/core.js");
const L = require("../links/core.js");

function title(extra) {
  return C.normalize(C.put(C.empty(), "titles", Object.assign({
    id: "t1", t: "People <b>worth</b> waiting for", sub: "A novel",
    ppl: [{ r: "a", n: "Ann Writer" }, { r: "t", n: "Tom Translator" }],
    fmts: [
      { id: "f1", k: "pb", isbn: "9786185321000", price: 14.4, pages: 248, w: 140, h: 210, sp: 15.5, wt: 320 },
      { id: "f2", k: "eb", isbn: "978-618-5321-01-7", price: 6.99 }
    ],
    blurb: "First paragraph & more.\nSame paragraph.\n\nSecond <script>x</script>.", bio: "Ann lives by the sea."
  }, extra || {}), 100)).titles[0];
}

test("a printed format becomes a draft the allowlist accepts, in the shop's units", () => {
  const t = title();
  const b = C.shopDraft(t, t.fmts[0], { label: "Paperback", about: "About the author", wu: "kg", du: "cm" });
  assert.equal(b.status, "draft");
  assert.equal(b.type, "simple");
  assert.equal(b.name, "People <b>worth</b> waiting for (Paperback)");
  assert.equal(b.sku, "9786185321000");
  assert.equal(b.regular_price, "14.40");
  assert.equal(b.weight, "0.32");
  assert.deepEqual(b.dimensions, { length: "21", width: "14", height: "1.55" });
  assert.equal(b.short_description, "<p>Ann Writer</p>");
  assert.equal(b.description, "<p>First paragraph &amp; more.<br>Same paragraph.</p><p>Second &lt;script&gt;x&lt;/script&gt;.</p><h3>About the author</h3><p>Ann lives by the sea.</p>");
  assert.equal(b.virtual, undefined);
  assert.equal(L.checkReq("woo", { m: "POST", path: "/products", body: b }), "");
  // grams and millimetres, unknown units, another currency
  const g = C.shopDraft(t, t.fmts[0], { wu: "g", du: "mm", price: false });
  assert.equal(g.weight, "320");
  assert.deepEqual(g.dimensions, { length: "210", width: "140", height: "15.5" });
  assert.equal(g.regular_price, undefined);
  const u = C.shopDraft(t, t.fmts[0], {});
  assert.equal(u.weight, undefined);
  assert.equal(u.dimensions, undefined);
  assert.equal(L.checkReq("woo", { m: "POST", path: "/products", body: u }), "");
});

test("an e-book is virtual, and a long text still fits the relay", () => {
  const t = title();
  const e = C.shopDraft(t, t.fmts[1], { label: "E-book" });
  assert.equal(e.virtual, true);
  assert.equal(e.weight, undefined);
  assert.equal(e.sku, "9786185321017");
  assert.equal(L.checkReq("woo", { m: "POST", path: "/products", body: e }), "");
  const long = title({ blurb: "Α&Β<Γ> ".repeat(570), bio: "Δέλτα ".repeat(500) });
  const b = C.shopDraft(long, long.fmts[0], { about: "Για τον συγγραφέα" });
  assert.ok(new TextEncoder().encode(JSON.stringify(b)).length <= 15000);
  assert.ok(b.description.length <= 8000);
  assert.equal(b.description.indexOf("Για τον συγγραφέα"), -1);       // the biography went first
  assert.ok(b.description.endsWith("…</p>"));
  assert.equal(L.checkReq("woo", { m: "POST", path: "/products", body: b }), "");
  // no ISBN, no price, no people: still a valid draft
  const bare = C.normalize(C.put(C.empty(), "titles", { id: "t2", t: "Bare", fmts: [{ id: "f", k: "ot" }] }, 1)).titles[0];
  const d = C.shopDraft(bare, bare.fmts[0], {});
  assert.deepEqual(d, { name: "Bare", type: "simple", status: "draft" });
  assert.equal(L.checkReq("woo", { m: "POST", path: "/products", body: d }), "");
});

test("the shop link is kept on the format only when it is valid", () => {
  const t = title({ fmts: [{ id: "f1", k: "pb", wp: { a: "acct1234", id: 77 } }, { id: "f2", k: "eb", wp: { a: "not an id", id: 5 } }, { id: "f3", k: "ab", wp: { a: "acct1234", id: -1 } }] });
  assert.deepEqual(t.fmts[0].wp, { a: "acct1234", id: 77 });
  assert.equal("wp" in t.fmts[1], false);
  assert.equal("wp" in t.fmts[2], false);
});

test("Stock, Newsletter and Writer prefills", () => {
  const t = title();
  assert.deepEqual(C.stockPrefill(t, t.fmts[0], "Paperback"), {
    name: "People <b>worth</b> waiting for (Paperback)", note: "Ann Writer", sku: "9786185321000", bc: "9786185321000", price: 1440
  });
  const nb = C.newsBlocks(t, { btn: "Buy", href: "https://shop.example/book" });
  assert.deepEqual(nb.map((b) => b.k), ["h", "p", "btn"]);
  assert.equal(nb[1].t.split("\n\n")[0], "A novel\nAnn Writer");
  assert.deepEqual(C.newsBlocks(t, { btn: "Buy", href: "javascript:alert(1)" }).map((b) => b.k), ["h", "p"]);
  const S = { head: "PRESS RELEASE", lead: "«{t}» by {a} is out.", leadNoA: "«{t}» is out.", leadImp: "{imp} presents «{t}» by {a}.",
    leadImpNoA: "{imp} presents «{t}».", rel: "Release date: {d}.", about: "About the author", details: "Details",
    pages: "{n} pages", contact: "Contact", docTitle: "Press release: {t}" };
  const pr = C.pressRelease(t, [{ label: "Paperback", isbn: "978-618-5321-00-0", pages: 248, price: "€14.40" }], S, { imp: "Small Press", rel: "1 Dec 2026" });
  assert.equal(pr.title, "Press release: People <b>worth</b> waiting for");
  const paras = pr.text.split("\n\n");
  assert.equal(paras[0], "PRESS RELEASE");
  assert.equal(paras[1], "Small Press presents «People <b>worth</b> waiting for» by Ann Writer. Release date: 1 Dec 2026.");
  assert.ok(pr.text.indexOf("Details\nPaperback · ISBN 978-618-5321-00-0 · 248 pages · €14.40") > 0);
  assert.ok(pr.text.endsWith("Contact\nSmall Press"));
  assert.equal(C.pressRelease(t, [], S, {}).text.split("\n\n")[1], "«People <b>worth</b> waiting for» by Ann Writer is out.");
});
