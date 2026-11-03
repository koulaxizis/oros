// Newsletter W2 (2026-11): HTML issues — the allowlist cleaner, the
// plain text made from HTML, {{SLOTS}}, rendering with the unsubscribe
// link and names, the pre-send check, templates and the sync merge
// (newsletter/core.js, newsletter/render.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../newsletter/core.js");
const R = require("../newsletter/render.js");

const LIST = { id: "list-1", m: 1, name: "News", chan: "chan-1", from: "me@example.com", lang: "el", addr: "Street 1, Athens",
  why: "You signed up.", theme: "classic", color: "#2f6fde", salt: "abcdefgh12" };
const TEMPLATE = fs.readFileSync(path.join(__dirname, "fixtures", "newsletter-template.html"), "utf8");
function iss(extra) {
  return C.normIssue(Object.assign({ id: "iss-1", m: 2, list: "list-1", subj: "Hi {first|friend}", pre: "", fmt: "html",
    html: "<p>Hello {first|friend}</p><p><a href=\"{$unsubscribe}\">Leave</a></p>", txt: "", st: "draft" }, extra || {}));
}

test("sanitizeHtml: scripts, handlers, bad links, styles and tracking pixels go", () => {
  const cases = [
    ["<script>alert(1)</script>ok", "ok"],
    ["<img src=x onerror=alert(1)>a", "a"],
    ["<img src=\"http://x.y/a.png\">h", "h"],
    ["<img src=\"https://t.co/p.gif\" width=\"1\" height=\"1\">b", "b"],
    ["<a href=\"javascript:alert(1)\">j</a>", "<a>j</a>"],
    ["<a href=\"&#106;avascript:1\">j</a>", "<a>j</a>"],
    ["<a href=\"data:text/html,x\">d</a>", "<a>d</a>"],
    ["<p style=\"background:url(https://t.co/x);color:red\">s</p>", "<p style=\"color:red\">s</p>"],
    ["<div style=\"width:expression(alert(1))\">e</div>", "<div>e</div>"],
    ["<iframe src=\"https://x\">in</iframe>after", "after"],
    ["<form><input name=a></form>f", "f"],
    ["<style>p{color:red}</style><p>x</p>", "<p>x</p>"],
    ["<p onclick=\"x\" class=\"c\" id=\"i\">p</p>", "<p>p</p>"],
    ["<p title=\"a&quot; onmouseover=&quot;x\">t</p>", "<p title=\"a&quot; onmouseover=&quot;x\">t</p>"],
    ["<svg><a href=\"https://x\">s</a></svg>tail", "tail"],
    ["x < y & z &amp; &copy;", "x &lt; y &amp; z &amp; &copy;"],
    ["<b>x<i>y</b>z", "<b>x<i>y</i></b>z"],
    ["<!-- <script>alert(1)</script> -->c", "c"],
    ["<a href=\"{$unsubscribe}\">u</a>", "<a href=\"{{UNSUBSCRIBE}}\">u</a>"],
    ["<a href=\"{{MAIN_URL}}\">m</a>", "<a href=\"{{MAIN_URL}}\">m</a>"],
    ["<td bgcolor=\"red\" onx=\"1\">c</td>", "<td bgcolor=\"red\">c</td>"]
  ];
  for (const [inp, out] of cases) assert.equal(C.sanitizeHtml(inp), out, inp);
});

test("sanitizeHtml is stable: cleaning twice changes nothing (the template too)", () => {
  for (const s of [TEMPLATE, "<p>a & b</p><a href=\"https://a.b/?x=1&amp;y=2\">q</a>", "<table><tr><td>x</table>"]) {
    const a = C.sanitizeHtml(s);
    assert.equal(C.sanitizeHtml(a), a);
  }
  const t = C.sanitizeHtml(TEMPLATE);
  assert.ok(!/<(head|title|meta|style|script)/i.test(t));
  assert.ok(t.includes("href=\"{{UNSUBSCRIBE}}\""));
  assert.ok(t.includes("max-width:600px"));
});

test("htmlSlots and htmlToText", () => {
  const t = C.sanitizeHtml(TEMPLATE);
  const slots = C.htmlSlots(t);
  assert.ok(slots.includes("MAIN_TITLE") && slots.includes("ITEM_URL"));
  assert.ok(!slots.includes("UNSUBSCRIBE"));
  const txt = C.htmlToText("<h1>Title</h1><p>One<br>two <a href=\"https://x.gr/a\">link</a></p><ul><li>a</li><li>b</li></ul><img src=\"https://x/y.png\" alt=\"Cover\">");
  assert.equal(txt, "Title\n\nOne\ntwo link (https://x.gr/a)\n\n- a\n- b\n\nCover");
});

test("normIssue keeps html/txt only for HTML issues; templates and l2 too", () => {
  const x = iss({ html: "<p onclick=x>Hi</p>", txt: "Hi" });
  assert.equal(x.html, "<p>Hi</p>");
  assert.equal(x.txt, "Hi");
  const b = C.normIssue({ id: "iss-2", m: 1, list: "list-1", subj: "S", fmt: "blocks", blocks: [], html: "<p>x</p>", st: "draft" });
  assert.equal("html" in b, false);
  const tpl = C.normTpl({ id: "tpl-1", m: 1, name: "T", subj: "S", fmt: "html", html: TEMPLATE });
  assert.equal(tpl.fmt, "html");
  assert.equal(tpl.html, C.sanitizeHtml(TEMPLATE));
  const two = iss({ l2: { lang: "en", subj: "EN", fmt: "html", html: "<p>English</p>", txt: "" } });
  assert.equal(two.l2.html, "<p>English</p>");
  assert.equal(C.contentFor(two, "en").html, "<p>English</p>");
  assert.equal(C.contentFor(two, "el").html, two.html);
  // too big → empty (the check then says the issue is empty)
  assert.equal(iss({ html: "<p>" + "x".repeat(C.LIM.html + 10) + "</p>" }).html, "");
});

test("render: names escaped, unsubscribe filled, footer only without the link", () => {
  const sub = { id: "s1", email: "a@b.gr", name: "<Ann> Lee" };
  const e = R.email({ issue: iss(), list: LIST, sub, lang: "el", unsub: "mailto:me@example.com?subject=unsubscribe%20x", unsubWeb: "https://relay.example/nl/u/k/t" });
  assert.ok(e.html.includes("Hello &lt;Ann&gt;"));
  assert.ok(e.html.includes("href=\"https://relay.example/nl/u/k/t\""));
  assert.ok(!e.html.includes("{{UNSUBSCRIBE}}"));
  assert.ok(!e.html.includes(LIST.addr), "no list footer when the HTML has its own unsubscribe link");
  assert.equal(e.subject, "Hi <Ann>");
  assert.ok(e.text.startsWith("Hello <Ann>"));
  assert.ok(e.text.includes("https://relay.example/nl/u/k/t"), "the text footer carries the link");
  // without the placeholder the list's footer (address + unsubscribe) is added
  const f = R.email({ issue: iss({ html: "<p>Only text</p>" }), list: LIST, sub, lang: "el", unsub: "mailto:me@example.com?subject=x" });
  assert.ok(f.html.includes("Street 1, Athens"));
  assert.ok(f.html.includes("mailto:me@example.com?subject=x"));
  // own plain text wins
  const g = R.email({ issue: iss({ txt: "Γεια {first}" }), list: LIST, sub: { name: "Ann" }, lang: "el", unsub: "" });
  assert.ok(g.text.startsWith("Γεια Ann"));
  // the web page has no live unsubscribe link
  const w = R.webPage({ issue: iss(), list: LIST, lang: "el", img: () => "" });
  assert.ok(w.includes("href=\"#\""));
});

test("check: empty HTML, open slots, web pictures", () => {
  const info = { chan: { id: "chan-1", kind: "smtp" }, aud: 3, inbox: true };
  const d = C.normalize({ ver: 1, chans: [], lists: [LIST], subs: [], issues: [], supp: [] });
  const ks = (x) => C.preflight(d, x, info).map((r) => r.lvl + ":" + r.k);
  assert.ok(ks(iss({ html: "" })).includes("err:noBody"));
  const t = ks(iss({ html: TEMPLATE }));
  assert.ok(t.includes("err:slots"));
  assert.ok(ks(iss({ html: "<p>x</p><img src=\"https://example.com/a.png\" alt=\"A\">" })).includes("warn:webImgs"));
  assert.deepEqual(ks(iss({ txt: "Hi {{NAME_HERE}}" })), ["err:slots"]);
  assert.deepEqual(ks(iss()).filter((k) => k.startsWith("err")), []);
});

test("sync: an older device's copy (fmt read as blocks) never wins a tie", () => {
  const x = iss();
  const old = Object.assign({}, x, { fmt: "blocks" });
  delete old.html; delete old.txt;
  const a = C.normalize({ ver: 1, chans: [], lists: [LIST], subs: [], issues: [x], supp: [] });
  const b = C.normalize({ ver: 1, chans: [], lists: [LIST], subs: [], issues: [old], supp: [] });
  assert.equal(C.mergeNewsletter(a, b).issues[0].html, x.html);
  assert.equal(C.mergeNewsletter(b, a).issues[0].html, x.html);
});
