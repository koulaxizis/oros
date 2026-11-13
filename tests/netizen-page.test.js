// Netizen ID link-in-bio page (NETIZEN-PAGE v1): page normalize + merge,
// safe links, the exported HTML (no script, escaped, CSP), the #p= payload.
// Run: node --test tests/
//
// Like tests/netizen.test.js, the pure functions are cut out of the app's
// source by name and evaluated on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "netizen", "netizen.js"), "utf8");
const HTML = fs.readFileSync(path.join(__dirname, "..", "netizen", "index.html"), "utf8");

function cutFunction(name) {
  const i = SRC.indexOf("  function " + name + "(");
  if (i < 0) throw new Error("missing function " + name);
  let depth = 0, j = SRC.indexOf("{", i);
  for (; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) break;
  }
  return SRC.slice(i, j + 1);
}
function cutBlock(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

function load(lang) {
  return new Function(
    ["var LANG = " + JSON.stringify(lang || "en") + ";",
     "var SANS = 'sans-serif', MONO = 'monospace', SERIF = 'serif', AV = 12;",
     "function cssVar(n, fb) { return fb; }",
     cutBlock("  var DATA_VER", "  // ---------- 1."),
     cutBlock("  var STRINGS", "  if (window.orosI18n)"),
     cutBlock("  var AV_BG", "  function genAvatar("),
     ...["t", "cmpStr", "isInt", "str", "esc", "hash32", "prng", "normCard", "normCols", "shown",
         "normPage", "mergePages", "defaultPage", "pageCard",
         "genAvatar", "avatarOf", "avatarRects", "theme", "vEsc", "vFold", "buildVCard", "fileBase",
         "sharePayload", "cardFromPayload",
         "safeHref", "prettyUrl", "rgbOf", "lum", "contrast", "inkFor", "cssColor", "pageTheme", "pageColors",
         "buildPageHtml", "pagePayload", "pageFromPayload"].map(cutFunction)].join("\n") +
    "\nreturn { normCard, normPage, mergePages, defaultPage, pageCard, safeHref, inkFor, contrast, rgbOf," +
    " pageColors, buildPageHtml, pagePayload, pageFromPayload };")();
}
const NZ = load("en");

function card(over) {
  return NZ.normCard(Object.assign({
    id: "abc123", m: 100, user: "ada", disp: "Ada L.", bio: "Hello", email: "ada@example.org",
    phone: "+30 210 1234567", web: "example.org", av: { s: "seed1" },
    links: [{ l: "Blog", u: "blog.example.org" }]
  }, over));
}
function page(over) { return NZ.normPage(Object.assign({ id: "abc123", m: 200 }, over)); }
const J = (x) => JSON.stringify(x);

test("normPage drops bad pages and clips fields", () => {
  assert.equal(NZ.normPage(null), null);
  assert.equal(NZ.normPage({ id: "BAD!", m: 1 }), null);
  assert.equal(NZ.normPage({ id: "abc123", m: -1 }), null);
  const x = [];
  for (let i = 0; i < 20; i++) x.push({ k: "l", e: "★★★★★★★★★★", l: "L".repeat(60), u: "https://a.b/" + i, f: i === 0 ? 1 : 7 });
  for (let i = 0; i < 10; i++) x.push({ k: "h", l: "H" + i });
  x.push({ k: "bogus" }, null, "x");
  const p = NZ.normPage({ id: "abc123", m: 5, hide: ["phone", "nope", "email", "phone"], th: "neon", ac: "#ABCDEF",
    bt: "blob", x, vc: 2, ti: "T".repeat(99), url: "u".repeat(300) });
  assert.deepEqual(p.hide, ["email", "phone"]);
  assert.equal(p.th, "oros");
  assert.equal(p.ac, "#abcdef");
  assert.equal(p.bt, "round");
  assert.equal(p.x.filter((it) => it.k === "l").length, 16);
  assert.equal(p.x.filter((it) => it.k === "h").length, 8);
  assert.equal(p.x[0].l.length, 40);
  assert.equal(p.x[0].e.length, 8);
  assert.equal(p.x[0].f, 1);
  assert.equal(p.x[1].f, 0);
  assert.equal(p.vc, 0);
  assert.equal(p.ti.length, 60);
  assert.equal(p.url.length, 200);
  assert.equal(NZ.normPage({ id: "abc123", m: 1, ac: "red" }).ac, "");
  assert.equal(J(NZ.normPage(p)), J(p), "idempotent");
});

test("a new page hides email and phone and takes the card's style", () => {
  const p = NZ.defaultPage(card({ st: "mint" }));
  assert.deepEqual(p.hide, ["email", "phone"]);
  assert.equal(p.th, "mint");
  assert.equal(p.m, 0);
});

test("mergePages is symmetric, associative, idempotent and leaves its inputs alone", () => {
  const A = { pages: [page({ m: 300, th: "dark" }), page({ id: "def456", m: 10 })], tombs: {} };
  const B = { pages: [page({ m: 250, th: "rose" })], tombs: { zzz999: 5 } };
  const C = { pages: [page({ id: "def456", m: 20, vc: 1 })], tombs: {} };
  const a0 = J(A), b0 = J(B);
  assert.equal(J(NZ.mergePages(A, B)), J(NZ.mergePages(B, A)));
  assert.equal(J(NZ.mergePages(NZ.mergePages(A, B), C)), J(NZ.mergePages(A, NZ.mergePages(B, C))));
  const m = NZ.mergePages(A, B);
  assert.equal(J(NZ.mergePages(m, m)), J(m));
  assert.equal(J(A), a0); assert.equal(J(B), b0);
  assert.equal(m.pages.find((p) => p.id === "abc123").th, "dark", "newer m wins");
  // equal m: the larger canonical JSON, whatever the order
  const X = { pages: [page({ m: 9, th: "dark" })] }, Y = { pages: [page({ m: 9, th: "rose" })] };
  assert.equal(J(NZ.mergePages(X, Y)), J(NZ.mergePages(Y, X)));
});

test("page tombstones: delete wins ties, a newer edit resurrects", () => {
  const P = { pages: [page({ m: 500 })] };
  assert.equal(NZ.mergePages(P, { tombs: { abc123: 500 } }).pages.length, 0);
  assert.equal(NZ.mergePages(P, { tombs: { abc123: 499 } }).pages.length, 1);
  const m = NZ.mergePages({ tombs: { abc123: 10 } }, { tombs: { abc123: 40, BAD: 3 } });
  assert.deepEqual(m.tombs, { abc123: 40 });
});

test("an older client's card data never carries page fields (separate slice)", () => {
  // normCard keeps only the card's own keys: page settings must not live there
  const c = NZ.normCard(Object.assign({}, card(), { th: "dark", x: [{ k: "l" }] }));
  assert.equal("x" in c, false);
  assert.match(SRC, /registerSlice\("netizenPage", pageSliceGet, pageSliceSet, PAGE_KEY, mergePages\)/);
  assert.match(SRC, /var PAGE_KEY = "oros-netizen-page-data";/);
});

test("safeHref keeps http(s), mailto and tel, adds https to bare domains, refuses the rest", () => {
  assert.equal(NZ.safeHref("https://a.example/x"), "https://a.example/x");
  assert.equal(NZ.safeHref(" example.org/me "), "https://example.org/me");
  assert.equal(NZ.safeHref("mailto:a@b.c"), "mailto:a@b.c");
  assert.equal(NZ.safeHref("tel:+30210"), "tel:+30210");
  ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd",
   "a b.com", "", "nodot", "https://", "//evil.example", "a@b.com", "localhost:8080"].forEach((u) => {
    assert.equal(NZ.safeHref(u), "", u);
  });
});

test("inkFor picks the readable text colour", () => {
  assert.equal(NZ.inkFor("#ffffff"), "#000000");
  assert.equal(NZ.inkFor("#111111"), "#ffffff");
  assert.equal(NZ.inkFor("#d4af37"), "#000000");
  assert.equal(NZ.inkFor("nonsense"), "#ffffff");
  // a light accent on a light page is not used as text
  const C = NZ.pageColors(page({ th: "minimal", ac: "#f4f4f4", bt: "outline" }));
  assert.equal(C.accText, "#111111");
  assert.equal(C.btn.bg, "transparent");
  assert.equal(C.ft.bg, "#f4f4f4");
  assert.equal(C.ft.fg, "#000000");
});

test("the page HTML has no script, a closed CSP and escaped text", () => {
  const evil = "<img src=x onerror=alert(1)>\"'";
  const c = card({ disp: evil, bio: evil, motto: evil, tags: [evil], links: [{ l: evil, u: "https://ok.example" }] });
  const p = page({ hide: [], x: [{ k: "h", l: evil }, { k: "l", e: evil, l: evil, u: "https://x.example/?a=1&b=\"2\"" }],
    ti: evil, url: "https://me.example/" });
  const html = NZ.buildPageHtml(NZ.pageCard(c, p), p, {});
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html.replace(/"[^"]*"/g, "\"\""), /<[^>]*\son[a-z]+=/i, "no event handler attribute");
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;/);
  assert.match(html, /href="https:\/\/x\.example\/\?a=1&amp;b=&quot;2&quot;"/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/me\.example\/">/);
  assert.match(html, /rel="me noopener"/);
  assert.doesNotMatch(html, /target="_blank"/, "the exported file opens links in place");
  // no outside resource of any kind
  assert.doesNotMatch(html, /(src|href)="\/\//);
  assert.doesNotMatch(html, /url\(/);
  assert.doesNotMatch(html, /@import/);
});

test("unsafe links are left out; card links come first, then the page's", () => {
  const c = card({ links: [{ l: "Card", u: "card.example" }, { l: "Evil", u: "javascript:alert(1)" }] });
  const p = page({ x: [{ k: "l", l: "Page", u: "https://page.example", f: 1 }, { k: "l", l: "Bad", u: "data:text/html,x" },
    { k: "h", l: "" }, { k: "l", l: "", u: "https://bare.example/" }] });
  const html = NZ.buildPageHtml(NZ.pageCard(c, p), p, {});
  assert.doesNotMatch(html, /javascript:|data:text\/html|Evil|>Bad</);
  assert.ok(html.indexOf("card.example") < html.indexOf("page.example"));
  assert.match(html, /class="b ft" href="https:\/\/page\.example"/);
  assert.match(html, /<span>bare\.example<\/span>/, "an empty label shows the address");
  assert.doesNotMatch(html, /<h2><\/h2>/, "an empty heading is left out");
});

test("what the page shows: card hides and page hides both apply; email and phone start hidden", () => {
  const c = card({ hide: ["bio"] });
  const p = NZ.defaultPage(c);
  const html = NZ.buildPageHtml(NZ.pageCard(c, p), p, {});
  assert.doesNotMatch(html, /mailto:|tel:|Hello/);
  assert.match(html, /href="https:\/\/example\.org"/, "website shown");
  const p2 = page({ hide: [] });
  const html2 = NZ.buildPageHtml(NZ.pageCard(c, p2), p2, {});
  assert.match(html2, /href="mailto:ada@example\.org"/);
  assert.match(html2, /href="tel:\+302101234567"/);
  assert.doesNotMatch(html2, /Hello/, "hidden on the card stays hidden");
  const p3 = page({ hide: ["avatar", "links", "web"] });
  const html3 = NZ.buildPageHtml(NZ.pageCard(card(), p3), p3, {});
  assert.doesNotMatch(html3, /<svg|blog\.example|https:\/\/example\.org/);
});

test("save contact: a vCard data link only when asked, with only what the page shows", () => {
  const c = card();
  assert.doesNotMatch(NZ.buildPageHtml(NZ.pageCard(c, page()), page(), {}), /text\/vcard/);
  const p = page({ vc: 1, hide: ["email", "phone"] });
  const html = NZ.buildPageHtml(NZ.pageCard(c, p), p, {});
  const m = /href="data:text\/vcard;charset=utf-8,([^"]+)" download="netizen-ada\.vcf"/.exec(html);
  assert.ok(m);
  const vcf = decodeURIComponent(m[1]);
  assert.match(vcf, /^BEGIN:VCARD\r\n/);
  assert.match(vcf, /NICKNAME:ada/);
  assert.doesNotMatch(vcf, /EMAIL|TEL/);
});

test("the preview opens links in a new tab; Greek labels in a Greek page", () => {
  const c = card(), p = page({ hide: [] });
  const html = NZ.buildPageHtml(NZ.pageCard(c, p), p, { blank: true });
  assert.match(html, /target="_blank" rel="me noopener noreferrer"/);
  const EL = load("el");
  const gr = EL.buildPageHtml(EL.pageCard(c, p), p, {});
  assert.match(gr, /<html lang="el">/);
  assert.match(gr, />Κλήση</);
});

test("#p= payload: only what the page shows travels, and it comes back the same page", () => {
  const c = card();
  const p = page({ hide: ["email", "phone"], th: "gradient", ac: "#ff0000", x: [{ k: "l", l: "A", u: "https://a.example" }, { k: "h", l: " " }],
    vc: 1, ti: "Me", url: "https://me.example" });
  const o = JSON.parse(J(NZ.pagePayload(c, p)));
  assert.equal("email" in o.c, false);
  assert.equal("phone" in o.c, false);
  assert.equal("id" in o.c, false);
  assert.equal(o.p.x.length, 1, "an empty heading does not travel");
  const back = NZ.pageFromPayload(o);
  assert.equal(back.page.th, "gradient");
  assert.equal(back.page.ac, "#ff0000");
  assert.equal(back.page.vc, 1);
  assert.equal(
    NZ.buildPageHtml(back.card, back.page, {}),
    NZ.buildPageHtml(NZ.pageCard(c, Object.assign({}, p, { x: o.p.x })), Object.assign({}, p, { x: o.p.x }), {}));
  assert.equal(NZ.pageFromPayload(null), null);
  assert.equal(NZ.pageFromPayload({ c: { user: "" }, p: {} }), null);
  assert.equal(NZ.pageFromPayload({ c: { user: "x" } }), null);
});

test("the page preview and viewer are sandboxed frames without same-origin or scripts", () => {
  const frames = HTML.match(/<iframe[^>]*>/g) || [];
  assert.equal(frames.length, 2);
  frames.forEach((f) => {
    assert.match(f, /sandbox="allow-popups allow-popups-to-escape-sandbox allow-downloads"/);
    assert.doesNotMatch(f, /allow-scripts|allow-same-origin/);
  });
});
