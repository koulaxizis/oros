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
  const future = { k: "carousel", items: [{ f: "/internal/Newsletter/a.jpg" }], cols: 3, constructor: "x" };
  const d = model([issue([{ k: "p", t: "Hi", glow: "soft", deep: { no: 1 } }, future])], { m: 2, tagline: "Weekly", nested: { a: 1 } });
  const x = d.issues[0];
  assert.deepEqual(x.blocks[0], { k: "p", t: "Hi", glow: "soft" });
  assert.deepEqual(x.blocks[1], { k: "carousel", items: [{ f: "/internal/Newsletter/a.jpg" }], cols: 3 });
  assert.equal(d.lists[0].tagline, "Weekly");
  assert.equal(d.lists[0].nested, undefined);
  // the merge keeps them too
  const m = C.mergeNewsletter(d, model());
  assert.equal(C.issue(m, "iss-1").blocks[1].k, "carousel");
  assert.equal(m.lists[0].tagline, "Weekly");
  // not drawn, and the issue can't go out from this version
  const e = R.email({ issue: x, list: d.lists[0], sub: null, lang: "en", img: () => "", unsub: "" });
  assert.doesNotMatch(e.html, /carousel/);
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

// ---------------------------------------------------------------
// Wave E2: header, footer, social icons, the list's own header/footer
const S = require("../newsletter/social.js");
function renderImg(blocks, list) {
  const d = model([issue(blocks)], list);
  return R.email({ issue: d.issues[0], list: d.lists[0], sub: null, lang: "en", img: (b) => "cid:" + b.f.replace(/[^a-z0-9]/gi, ""), unsub: "" });
}

test("E2: social items are one per known network, links fenced, e-mail becomes mailto", () => {
  const b = C.normBlock({ k: "social", st: "q", sz: 7, items: [
    { n: "x", href: "https://x.com/me" }, { n: "x", href: "https://x.com/two" }, { n: "myspace", href: "https://m.com" },
    { n: "email", href: "me@example.com" }, { n: "facebook", href: "mailto:a@b.gr" }, { n: "youtube", href: "javascript:alert(1)" }] });
  assert.deepEqual(b, { k: "social", items: [{ n: "x", href: "https://x.com/me" }, { n: "email", href: "mailto:me@example.com" },
    { n: "facebook", href: "" }, { n: "youtube", href: "" }], st: "c", sz: 32 });
  assert.deepEqual(C.picsOf([b]).map((p) => p.f), ["icon:x:c:32", "icon:email:c:32"]);
  assert.equal(S.parse("icon:x:c:32").n, "x");
  assert.equal(S.parse("icon:x:c:33"), null);
  assert.equal(S.parse("icon:evil:c:32"), null);
  assert.equal(S.ORDER.length, 14);
  S.ORDER.forEach((n) => assert.ok(S.NETS[n].d || S.NETS[n].s || S.NETS[n].txt, n));
});

test("E2: header, footer and social render centred, with icons as pictures and a text twin", () => {
  const e = renderImg([
    { k: "head", f: "/internal/Newsletter/logo.png", w: 400, h: 100, lw: 120, t: "Noxpress", sub: "Weekly news",
      links: [{ t: "Shop", href: "https://shop.gr" }, { t: "Blog", href: "https://shop.gr/blog" }] },
    { k: "p", t: "Body" },
    { k: "social", items: [{ n: "instagram", href: "https://instagram.com/n" }, { n: "mastodon", href: "" }], st: "d", sz: 40 },
    { k: "foot", t: "© 2026 Noxpress", items: [{ n: "facebook", href: "https://fb.com/n" }], st: "l" }
  ]);
  assert.match(e.html, /<img src="cid:internalNewsletterlogopng" alt="Noxpress" width="120" height="30"/);
  assert.match(e.html, /text-align:center[^"]*border-bottom/);
  assert.match(e.html, />Noxpress<\/p>/);
  assert.match(e.html, /<a href="https:\/\/shop\.gr"[^>]*>Shop<\/a>.*·.*<a href="https:\/\/shop\.gr\/blog"/);
  assert.match(e.html, /<a href="https:\/\/instagram\.com\/n"><img src="cid:iconinstagramd40" alt="Instagram"[^>]*width="40"/);
  assert.doesNotMatch(e.html, /mastodon/i);          // no link, no icon
  assert.match(e.html, /<img src="cid:iconfacebookl24" alt="Facebook"/);
  assert.match(e.html, /© 2026 Noxpress/);
  assert.match(e.text, /NOXPRESS\nWeekly news\nShop: https:\/\/shop\.gr/);
  assert.match(e.text, /Instagram: https:\/\/instagram\.com\/n/);
  assert.match(e.text, /Facebook: https:\/\/fb\.com\/n\n\n© 2026 Noxpress/);
});

test("E2: alignment defaults to centre for the frame blocks; left is kept", () => {
  assert.equal(C.normBlock({ k: "social", items: [], al: "center" }).al, undefined);
  assert.equal(C.normBlock({ k: "social", items: [], al: "left" }).al, "left");
  assert.equal(C.normBlock({ k: "p", t: "x", al: "left" }).al, undefined);
  assert.equal(C.alignOf({ k: "foot" }), "center");
  assert.equal(C.alignOf({ k: "p" }), "left");
  const e = renderImg([{ k: "social", items: [{ n: "x", href: "https://x.com" }], al: "left", sz: 24 }]);
  assert.doesNotMatch(e.html, /<table role="presentation" align="center" cellpadding/);
});

test("E2: preflight — frame blocks alone are no body; links without address are caught; API pictures", () => {
  const frame = [{ k: "head", t: "Shop" }, { k: "foot", t: "©" }];
  const d = model([issue(frame)]);
  assert.ok(C.preflight(d, d.issues[0], { chan: CHAN, inbox: true, aud: 1 }).some((r) => r.k === "noBody"));
  const d2 = model([issue([{ k: "p", t: "x" }, { k: "social", items: [{ n: "x", href: "" }] }])]);
  assert.ok(C.preflight(d2, d2.issues[0], { chan: CHAN, inbox: true, aud: 1 }).some((r) => r.k === "badBlock"));
  const d3 = model([issue([{ k: "p", t: "x" }, { k: "head", t: "S", links: [{ t: "Home", href: "" }] }])]);
  assert.ok(C.preflight(d3, d3.issues[0], { chan: CHAN, inbox: true, aud: 1 }).some((r) => r.k === "badBlock"));
  // Brevo's API can't carry inline pictures: social icons count
  const api = Object.assign({}, CHAN, { via: "api" });
  const d4 = model([issue([{ k: "p", t: "x" }, { k: "social", items: [{ n: "x", href: "https://x.com" }] }])]);
  assert.ok(C.preflight(d4, d4.issues[0], { chan: C.normChan ? C.normChan(api) : api, inbox: true, aud: 1 }).some((r) => r.k === "apiImg"));
});

test("E2: a list keeps its own header and footer; anything else there is dropped", () => {
  const d = model([], { m: 2, hf: { head: { k: "head", t: "Shop", links: [{ t: "A", href: "javascript:x" }] }, foot: { k: "p", t: "no" } } });
  assert.deepEqual(d.lists[0].hf, { head: { k: "head", f: "", w: 600, h: 200, b: 0, lw: 140, t: "Shop", sub: "", links: [{ t: "A", href: "" }] } });
  assert.equal(model([], { hf: { head: null, foot: "x" } }).lists[0].hf, undefined);
  const m = C.mergeNewsletter(d, model());
  assert.equal(m.lists[0].hf.head.t, "Shop");
});

test("E2: hostile text in header, footer and links is escaped", () => {
  const e = renderImg([{ k: "head", t: "<script>x</script>", sub: "\"><img src=x>", links: [{ t: "<b>", href: "https://a.gr\"onclick=1" }] },
                       { k: "foot", t: "<svg onload=1>" }]);
  assert.doesNotMatch(e.html, /<script>|<svg|<img src=x|<b>|onclick/);
});

// ---------------------------------------------------------------
// Wave E3: picture + text, 3 columns, gallery, video, table, event
// card (+ .ics), saved blocks
const P = (n) => "/internal/Newsletter/" + n + ".jpg";

test("E3: new blocks normalize with limits", () => {
  const n = (b) => C.normBlock(b);
  assert.deepEqual(n({ k: "imgtxt", f: P("a"), w: 800, h: 600, b: 10, hd: " Title ", t: "Body", bt: "Go", bh: "javascript:x", side: "x" }),
    { k: "imgtxt", f: P("a"), w: 800, h: 600, b: 10, alt: "", href: "", hd: "Title", t: "Body", bt: "Go", bh: "" });
  assert.equal(n({ k: "imgtxt", f: "../etc/passwd", side: "r" }).f, "");
  assert.equal(n({ k: "imgtxt", side: "r" }).side, "r");
  assert.deepEqual(n({ k: "cols3", a: "1", b: "2", c: "3" }), { k: "cols3", a: "1", b: "2", c: "3" });
  const g = n({ k: "gallery", per: 3, items: Array.from({ length: 12 }, (_, i) => ({ f: P("g" + i), href: "https://x.gr/" + i })).concat(["junk"]) });
  assert.equal(g.items.length, 9);
  assert.equal(g.per, 3);
  assert.equal(n({ k: "gallery", per: 4, items: [] }).per, undefined);
  assert.equal(n({ k: "video", url: "mailto:a@b.gr" }).url, "");
  assert.equal(n({ k: "video", url: "https://youtu.be/abc" }).url, "https://youtu.be/abc");
  const tb = n({ k: "table", hd: 1, rows: [["a", "b", "c", "d", "e", "f", "g"], ["1"], "nope"].concat(Array(30).fill(["x"])) });
  assert.equal(tb.rows[0].length, 6);
  assert.deepEqual(tb.rows[1], ["1", "", "", "", "", ""]);
  assert.equal(tb.rows.length, 20);
  const ev = n({ k: "event", t: "Launch", d: "2026-02-30", tm: "25:00", te: "21:00", ics: true });
  assert.deepEqual([ev.d, ev.tm, ev.te, ev.ics], ["", "", "", undefined]);
  const ev2 = n({ k: "event", t: "Launch", d: "2026-11-03", tm: "19:30", te: "21:00", ics: 1 });
  assert.deepEqual([ev2.d, ev2.tm, ev2.te, ev2.ics], ["2026-11-03", "19:30", "21:00", 1]);
});

test("E3: pictures of every block are found; a video's picture gets its play mark", () => {
  const bl = [{ k: "imgtxt", f: P("a"), b: 5 }, { k: "gallery", items: [{ f: P("b"), b: 6 }, { f: P("a"), b: 5 }] },
              { k: "video", f: P("v"), url: "https://youtu.be/x", b: 7 }].map(C.normBlock);
  assert.deepEqual(C.picsOf(bl).map((p) => p.f), [P("a"), P("b"), "play:" + P("v")]);
  assert.equal(C.picRefs(bl[1]).length, 2);
  assert.deepEqual(C.picRefs({ k: "p", t: "x" }), []);
  const NPK = require("../newsletter/package.js");
  const d = model([issue(bl)]);
  d.blks = [{ id: "blk-1", m: 1, name: "Logo", b: { k: "head", f: P("logo") } }];
  assert.deepEqual(NPK.imgPaths(d).sort(), [P("a"), P("b"), P("logo"), P("v")]);
});

test("E3: the new blocks render as e-mail HTML and plain text, escaped, on a phone too", () => {
  const e = renderImg([
    { k: "imgtxt", f: P("a"), hd: "<b>Big</b>", t: "Text", bt: "Buy", bh: "https://shop.gr/p", side: "r" },
    { k: "cols3", a: "One", b: "Two", c: "Three" },
    { k: "gallery", per: 3, items: [{ f: P("g1"), alt: "First" }, { f: P("g2"), href: "https://x.gr" }] },
    { k: "video", f: P("v"), url: "https://youtu.be/x", t: "Our clip" },
    { k: "video", url: "https://vimeo.com/1" },
    { k: "table", hd: 1, rows: [["Size", "Price"], ["S", "<i>9</i>"]] },
    { k: "event", t: "Opening", d: "2026-11-03", tm: "19:30", te: "21:00", loc: "Shop", ics: 1, bt: "Book", bh: "https://x.gr/b" }]);
  assert.match(e.html, /dir="rtl"/);
  assert.match(e.html, /&lt;b&gt;Big&lt;\/b&gt;/);
  assert.match(e.html, /cid:playinternalNewsletterv/);
  assert.match(e.html, /href="https:\/\/vimeo.com\/1"[^>]*>▶ Watch the video/);
  assert.match(e.html, /NOV/i);
  assert.match(e.html, /calendar file/);
  assert.doesNotMatch(e.html, /<i>9<\/i>|<b>Big/);
  // stacking columns are at most 270 px wide, so two fit side by side and a phone stacks them
  (e.html.match(/max-width:(\d+)px/g) || []).forEach((m) => assert.ok(+m.match(/\d+/)[0] <= 600, m));
  assert.match(e.text, /Our clip: https:\/\/youtu.be\/x/);
  assert.match(e.text, /Size \| Price/);
  assert.match(e.text, /OPENING\n2026-11-03 19:30–21:00\nShop/);
  const el = R.email({ issue: model([issue([{ k: "event", t: "Γιορτή", d: "2026-05-01" }])]).issues[0], list: model().lists[0], lang: "el", img: () => "", unsub: "" });
  assert.match(el.html, /ΜΑΪ/);
});

test("E3: preflight asks for the missing parts of the new blocks", () => {
  const bad = (blocks) => { const d = model([issue([{ k: "p", t: "x" }].concat(blocks))]); return C.preflight(d, d.issues[0], { chan: CHAN, inbox: true, aud: 1 }).some((r) => r.k === "badBlock"); };
  assert.ok(bad([{ k: "imgtxt", t: "no picture" }]));
  assert.ok(bad([{ k: "imgtxt", f: P("a"), bt: "Buy" }]));
  assert.ok(!bad([{ k: "imgtxt", f: P("a"), bt: "Buy", bh: "https://x.gr" }]));
  assert.ok(bad([{ k: "gallery", items: [] }]));
  assert.ok(bad([{ k: "video", f: P("v") }]));
  assert.ok(!bad([{ k: "video", url: "https://youtu.be/x" }]));
  assert.ok(bad([{ k: "event", t: "No day" }]));
  assert.ok(!bad([{ k: "event", t: "Day", d: "2026-11-03" }]));
  assert.ok(!bad([{ k: "table", rows: [["a"]] }, { k: "cols3", a: "x" }]));
  const d = model([issue([{ k: "table", rows: [["Only", "a table"]] }])]);
  assert.ok(!C.preflight(d, d.issues[0], { chan: CHAN, inbox: true, aud: 1 }).some((r) => r.k === "noBody"));
});

test("E3: an event's calendar file is valid iCalendar with escaped, folded lines", () => {
  const b = C.normBlock({ k: "event", t: "Launch, party; yes\\no", d: "2026-11-03", tm: "19:30", loc: "Shop", sub: "Line 1\nLine 2", bh: "https://x.gr", bt: "Go" });
  const ics = C.icsOf(b, "iss-1-4", Date.UTC(2026, 9, 18, 10));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nDTSTART:20261103T193000\r\nDURATION:PT1H\r\n/);
  assert.ok(ics.includes("SUMMARY:Launch\\, party\\; yes\\\\no\r\n"));
  assert.match(ics, /DESCRIPTION:Line 1\\nLine 2/);
  assert.match(ics, /UID:iss-1-4@oros/);
  assert.match(ics, /DTSTAMP:20261018T100000Z/);
  const day = C.icsOf(C.normBlock({ k: "event", t: "Π".repeat(80), d: "2026-12-31" }), "u", 0);
  assert.match(day, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  day.split("\r\n").forEach((line) => assert.ok(Buffer.byteLength(line, "utf8") <= 75, line));
  assert.equal(C.icsOf(C.normBlock({ k: "event", t: "", d: "2026-12-31" }), "u", 0), "");
});

test("E3: saved blocks are their own synced collection, left out while empty", () => {
  assert.equal(model().blks, undefined);
  const d = C.normalize({ lists: [LIST], blks: [{ id: "blk-1", m: 1, name: "Promo", b: { k: "btn", t: "Shop", href: "https://x.gr" } },
                                               { id: "blk-2", m: 1, name: "Bad", b: { k: "Bad Kind" } }, { id: "blk-3", m: 2, del: 1 }] });
  assert.deepEqual(d.blks.map((x) => x.id), ["blk-1", "blk-3"]);
  assert.equal(d.blks[0].b.t, "Shop");
  const other = C.normalize({ lists: [LIST], blks: [{ id: "blk-1", m: 5, name: "Promo 2", b: { k: "p", t: "x" } }] });
  const m = C.mergeNewsletter(d, other);
  assert.equal(C.live(m.blks)[0].name, "Promo 2");
  // a device that doesn't know saved blocks loses nothing in the union
  assert.equal(C.mergeNewsletter(model(), d).blks.length, 2);
});

test("E3: an event that asks for it goes out with its .ics attached (SMTP and provider APIs)", async () => {
  const { sandbox } = require("./newsletter-sandbox.js");
  const M = require("../mail/compose.js");
  const d = model([issue([{ k: "p", t: "Come!" }, { k: "event", t: "Opening night", d: "2026-11-03", tm: "19:30", ics: 1 },
                          { k: "event", t: "No file", d: "2026-11-04" }])]);
  const S = await sandbox(d);
  const sub = { id: "sub-1", m: 1, list: "list-1", email: "a@x.gr", name: "Ann" };
  const files = S.E.filesFor(d.issues[0], "en", Date.UTC(2026, 9, 18));
  assert.deepEqual(files.map((f) => [f.name, f.type]), [["opening-night.ics", "text/calendar"]]);
  const bin = S.E.buildFor(d.issues[0], d.lists[0], sub).bin;
  assert.match(bin, /Content-Type: multipart\/mixed/);
  assert.match(bin, /Content-Type: text\/calendar; name="opening-night.ics"/);
  const raw = S.E.buildFor(d.issues[0], d.lists[0], sub, { raw: true });
  const pm = JSON.parse(R.apiReq(M, "postmark", "", raw).body);
  assert.deepEqual(pm.Attachments.map((a) => [a.Name, a.ContentType]), [["opening-night.ics", "text/calendar"]]);
  const sg = JSON.parse(R.apiReq(M, "sendgrid", "", raw).body);
  assert.equal(sg.attachments[0].disposition, "attachment");
  const br = JSON.parse(R.apiReq(M, "brevo", "", raw).body);
  assert.equal(br.attachment[0].name, "opening-night.ics");
  assert.match(Buffer.from(br.attachment[0].content, "base64").toString("utf8"), /SUMMARY:Opening night/);
});
