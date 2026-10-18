// Newsletter editor wave E1: the new blocks (quote, space, list,
// styled lines, button rows), per-block alignment / padding /
// background, the list's look (font, heading size, button shape, link
// colour, background), and forward compatibility (blocks and fields a
// newer orOS writes are kept, never drawn, never sent).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../newsletter/core.js");
const R = require("../newsletter/render.js");

const LIST = { id: "list-1", m: 1, name: "Friends", chan: "chan-1", from: "me@example.com", reply: "", lang: "en",
  addr: "1 Main St, Athens", why: "", theme: "classic", color: "#2f6fde", salt: "abcdefgh12" };
const CHAN = { id: "chan-1", m: 1, name: "Brevo", kind: "smtp", preset: "brevo", host: "smtp-relay.brevo.com", port: 587, user: "u", rate: 60, cap: 300 };
function model(issues, list) {
  return C.normalize({ chans: [CHAN], lists: [Object.assign({}, LIST, list || {})], subs: [], issues: issues || [] });
}
function issue(blocks) {
  return { id: "iss-1", m: 3, list: "list-1", subj: "Hello", pre: "", fmt: "blocks", blocks, tags: [], st: "draft" };
}
function render(blocks, list) {
  const d = model([issue(blocks)], list);
  return R.email({ issue: d.issues[0], list: d.lists[0], sub: { name: "Ann Lee", email: "a@x.gr" }, lang: "en", img: () => "", unsub: "" });
}

test("new blocks normalize with limits; defaults are left out", () => {
  const n = (b) => C.normBlock(b);
  assert.deepEqual(n({ k: "quote", t: "Be kind", by: " Ann ", junk: { a: 1 } }), { k: "quote", t: "Be kind", by: "Ann" });
  assert.deepEqual(n({ k: "sp", h: 999 }), { k: "sp", h: 24 });
  assert.deepEqual(n({ k: "sp", h: 48 }), { k: "sp", h: 48 });
  assert.deepEqual(n({ k: "list", t: "a\nb", ord: 1 }), { k: "list", t: "a\nb", ord: 1 });
  assert.deepEqual(n({ k: "list", t: "a", ord: "1" }), { k: "list", t: "a" });
  assert.deepEqual(n({ k: "h", t: "T", lv: 1 }), { k: "h", t: "T", lv: 1 });
  assert.deepEqual(n({ k: "h", t: "T", lv: 2 }), { k: "h", t: "T" });
  assert.deepEqual(n({ k: "h", t: "T", lv: 9 }), { k: "h", t: "T" });
  assert.deepEqual(n({ k: "hr", st: "dotted", w: 4, c: "#AABBCC", wd: 50 }), { k: "hr", st: "dotted", w: 4, c: "#aabbcc", wd: 50 });
  assert.deepEqual(n({ k: "hr", st: "solid", w: 1, c: "red", wd: 100 }), { k: "hr" });
  assert.deepEqual(n({ k: "hr", st: "groove;x", w: 99, wd: 5 }), { k: "hr" });
  // look: alignment, padding, background
  assert.deepEqual(n({ k: "p", t: "x", al: "center", pad: 16, bg: "#FFEE00" }), { k: "p", t: "x", al: "center", pad: 16, bg: "#ffee00" });
  assert.deepEqual(n({ k: "p", t: "x", al: "left", pad: 0, bg: "url(x)" }), { k: "p", t: "x" });
  assert.deepEqual(n({ k: "p", t: "x", al: "justify", pad: 500, bg: "#fff" }), { k: "p", t: "x" });
});

test("button rows: up to three buttons, links fenced, full width only for one", () => {
  const b = C.normBlock({ k: "btn", t: "A", href: "https://a.gr", st: "line", full: 1,
    more: [{ t: "B", href: "https://b.gr" }, { t: "C", href: "javascript:alert(1)" }, { t: "D", href: "https://d.gr" }] });
  assert.deepEqual(b, { k: "btn", t: "A", href: "https://a.gr", st: "line",
    more: [{ t: "B", href: "https://b.gr" }, { t: "C", href: "" }] });
  assert.deepEqual(C.normBlock({ k: "btn", t: "A", href: "https://a.gr", full: 1, more: [] }), { k: "btn", t: "A", href: "https://a.gr", full: 1 });
  assert.equal(C.buttonsOf(b).length, 3);
  // a second button without a link is caught before sending
  const d = model([issue([{ k: "p", t: "x" }, b])]);
  const keys = C.preflight(d, d.issues[0], { chan: CHAN, inbox: true, aud: 1 }).map((r) => r.k);
  assert.ok(keys.includes("badBlock"));
});

test("render: quote, list, space, styled line, heading levels", () => {
  const e = render([
    { k: "h", t: "Big", lv: 1 }, { k: "h", t: "Small", lv: 3 },
    { k: "quote", t: "Hello {first}\nline two", by: "Ann" },
    { k: "list", t: "- one\n2. two\n\nthree", ord: 1 },
    { k: "sp", h: 40 },
    { k: "hr", st: "dashed", w: 3, c: "#ff0000", wd: 50 }
  ]);
  assert.match(e.html, /<h1 style="[^"]*font-size:28px/);
  assert.match(e.html, /<h3 style="[^"]*font-size:18px/);
  assert.match(e.html, /<blockquote[^>]*border-left:4px solid #2f6fde/);
  assert.match(e.html, /Hello Ann<br>line two/);
  assert.match(e.html, /— Ann/);
  assert.match(e.html, /<ol[^>]*><li[^>]*>one<\/li><li[^>]*>two<\/li><li[^>]*>three<\/li><\/ol>/);
  assert.match(e.html, /height:40px/);
  assert.match(e.html, /border-top:3px dashed #ff0000;margin:24px auto;width:50%/);
  assert.match(e.text, /> Hello Ann\n> line two\n— Ann/);
  assert.match(e.text, /1\. one\n2\. two\n3\. three/);
});

test("render: button row, outline, full width, alignment", () => {
  const e = render([
    { k: "btn", t: "One", href: "https://a.gr", more: [{ t: "Two", href: "https://b.gr" }], st: "line", al: "center" },
    { k: "btn", t: "Wide", href: "https://c.gr", full: 1 }
  ]);
  assert.equal((e.html.match(/<a href="https:\/\/[abc]\.gr"/g) || []).length, 3);
  assert.match(e.html, /border:2px solid #2f6fde/);
  assert.match(e.html, /<table role="presentation" align="center"/);
  assert.match(e.html, /width="100%" style="margin:8px 0 20px"><tr><td align="center" style="border-radius:8px;background:#2f6fde"><a href="https:\/\/c\.gr" style="display:block/);
  assert.match(e.text, /One: https:\/\/a\.gr\nTwo: https:\/\/b\.gr/);
});

test("render: a block's own background switches the text to a readable colour", () => {
  const e = render([{ k: "p", t: "On dark", bg: "#111111", pad: 24, al: "center" }]);
  assert.match(e.html, /bgcolor="#111111"/);
  assert.match(e.html, /<td align="center" style="text-align:center;padding:24px 16px">/);
  assert.match(e.html, /color:#ffffff">On dark/);
  const light = render([{ k: "p", t: "On light", bg: "#ffee00" }]);
  assert.match(light.html, /color:#111111">On light/);
});

test("the list's look: font, heading size, button shape, link colour, background", () => {
  const d = model([], { sty: { font: "serif", hs: "l", btn: "pill", link: "#AA0000", bg: "#123456", junk: "x" } });
  assert.deepEqual(d.lists[0].sty, { font: "serif", hs: "l", btn: "pill", link: "#aa0000", bg: "#123456" });
  assert.equal(model([], { sty: { font: "sans", hs: "m", btn: "round" } }).lists[0].sty, undefined);
  assert.equal(model([], { sty: { font: "comic", link: "blue" } }).lists[0].sty, undefined);
  const e = render([{ k: "h", t: "T" }, { k: "p", t: "see [here](https://x.gr)" }, { k: "btn", t: "B", href: "https://b.gr" }],
    { sty: { font: "serif", hs: "l", btn: "pill", link: "#aa0000", bg: "#123456" } });
  assert.match(e.html, /font-family:Georgia/);
  assert.match(e.html, /<h2 style="[^"]*font-size:26px/);
  assert.match(e.html, /border-radius:999px/);
  assert.match(e.html, /<a href="https:\/\/x\.gr" style="color:#aa0000/);
  assert.match(e.html, /^<table role="presentation" width="100%"[^>]*style="background:#123456"/);
  // without a look: exactly the old defaults
  const plain = render([{ k: "btn", t: "B", href: "https://b.gr" }]);
  assert.match(plain.html, /border-radius:8px;background:#2f6fde/);
  assert.match(plain.html, /background:#f2f3f5/);
});

test("hostile text in the new blocks is escaped", () => {
  const e = render([{ k: "quote", t: "<img src=x onerror=alert(1)>", by: "<script>x</script>" },
                    { k: "list", t: "- <b>x</b>" }, { k: "h", t: "\"><svg onload=1>", lv: 1 }]);
  assert.doesNotMatch(e.html, /<img src=x|<script>|<svg|<b>x/);
  assert.match(e.html, /&lt;script&gt;/);
});

test("forward compatibility: a newer orOS's blocks and fields are kept, never drawn or sent", () => {
  const future = { k: "gallery", items: [{ f: "/internal/Newsletter/a.jpg" }], cols: 3, constructor: "x" };
  const d = model([issue([{ k: "p", t: "Hi", glow: "soft", deep: { no: 1 } }, future])], { m: 2, tagline: "Weekly", nested: { a: 1 } });
  const x = d.issues[0];
  assert.deepEqual(x.blocks[0], { k: "p", t: "Hi", glow: "soft" });
  assert.deepEqual(x.blocks[1], { k: "gallery", items: [{ f: "/internal/Newsletter/a.jpg" }], cols: 3 });
  assert.equal(d.lists[0].tagline, "Weekly");
  assert.equal(d.lists[0].nested, undefined);
  // the merge keeps them too
  const m = C.mergeNewsletter(d, model());
  assert.equal(C.issue(m, "iss-1").blocks[1].k, "gallery");
  assert.equal(m.lists[0].tagline, "Weekly");
  // not drawn, and the issue can't go out from this version
  const e = R.email({ issue: x, list: d.lists[0], sub: null, lang: "en", img: () => "", unsub: "" });
  assert.doesNotMatch(e.html, /gallery/);
  const keys = C.preflight(d, x, { chan: CHAN, inbox: true, aud: 1 }).map((r) => r.lvl + ":" + r.k);
  assert.ok(keys.includes("err:newerBlock"));
  // hostile unknown kinds: bad names or too big are dropped
  assert.equal(C.normBlock({ k: "Bad Kind" }), null);
  assert.equal(C.normBlock({ k: "big", t: "x".repeat(30000) }), null);
});

test("an issue made only of spaces and lines has no body", () => {
  const d = model([issue([{ k: "sp", h: 24 }, { k: "hr" }])]);
  const keys = C.preflight(d, d.issues[0], { chan: CHAN, inbox: true, aud: 1 }).map((r) => r.k);
  assert.ok(keys.includes("noBody"));
  const d2 = model([issue([{ k: "quote", t: "Words" }])]);
  assert.ok(!C.preflight(d2, d2.issues[0], { chan: CHAN, inbox: true, aud: 1 }).some((r) => r.k === "noBody"));
});
