// Notes Markdown wave (notes/md.js): the sanitising renderer (every
// character escaped, only allow-listed tags, only http/https/mailto
// links), task checkboxes toggled in the text, the formatting
// toolbar, wiki links across notebooks, templates and the .md file.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const M = require(path.join(__dirname, "..", "notes/md.js"));

const ALLOWED = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "strong", "em", "del", "code", "pre",
  "blockquote", "ul", "ol", "li", "input", "table", "thead", "tbody", "tr", "th", "td", "hr", "a", "span", "div"]);
const ATTRS = new Set(["href", "target", "rel", "class", "role", "tabindex", "data-wiki", "type", "data-line", "checked", "start"]);

// A tiny tag scanner: every tag in the output is allow-listed, every
// attribute too, and hrefs are http/https/mailto.
function audit(html) {
  const re = /<\/?([a-zA-Z0-9]+)([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    assert.ok(ALLOWED.has(m[1].toLowerCase()), "tag " + m[1]);
    const attrs = m[2].match(/([a-zA-Z-]+)(?:="[^"]*")?/g) || [];
    for (const a of attrs) {
      const name = a.split("=")[0].toLowerCase();
      assert.ok(ATTRS.has(name), "attr " + name + " in " + m[0]);
      if (name === "href") assert.match(a, /^href="(https?:\/\/|mailto:)/i);
    }
  }
  // nothing that looks like markup survives outside built tags
  assert.ok(!/<(script|img|iframe|svg|style|object)/i.test(html));
  assert.ok(!/javascript:/i.test(html.replace(/&[a-z#0-9]+;/gi, "")) || !/href="javascript/i.test(html));
}

test("blocks: headings, lists, quote, code, table, rule", () => {
  const h = M.render("# T\n## Two\n\n- a\n  - b\n1. x\n\n> q\n\n```\n<b>\n```\n\n| A | B |\n|:-|-:|\n| 1 | 2 |\n\n---");
  assert.match(h, /<h1>T<\/h1>/);
  assert.match(h, /<h2>Two<\/h2>/);
  assert.match(h, /<ul><li>a<ul><li>b<\/li><\/ul>/);
  assert.match(h, /<ol><li>x<\/li><\/ol>/);
  assert.match(h, /<blockquote><p>q<\/p>/);
  assert.match(h, /<pre><code>&lt;b&gt;<\/code><\/pre>/);
  assert.match(h, /<th class="al-l">A<\/th><th class="al-r">B<\/th>/);
  assert.match(h, /<hr>/);
  audit(h);
});

test("inline: bold, italic, strike, code, snake_case untouched", () => {
  const h = M.render("**b** *i* _u_ ~~s~~ `c<d>` snake_case_name 2 * 3 * 4 ***bi***");
  assert.match(h, /<strong>b<\/strong> <em>i<\/em> <em>u<\/em> <del>s<\/del> <code>c&lt;d&gt;<\/code> snake_case_name 2 \* 3 \* 4 <strong><em>bi<\/em><\/strong>/);
});

test("hostile text never becomes markup", () => {
  const evil = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](data:text/html,<b>)",
    "[x](https://a.b/\"onmouseover=\"alert(1))",
    "[[\"><img src=x>]]",
    "| <b> | x |\n|---|---|\n| <i> | y |",
    "`<script>`",
    "> <iframe>",
    "- [ ] <svg onload=1>",
    "https://x.y/<script>",
    "[a](vbscript:x) [b](file:///etc/passwd) [c](//evil.com)"
  ].join("\n\n");
  const h = M.render(evil, { wiki: () => "ok" });
  audit(h);
  assert.ok(!/href="(javascript|data|vbscript|file|\/\/)/i.test(h));
  assert.match(h, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(h, /data-wiki="&quot;&gt;&lt;img src=x&gt;"/);
});

test("links: http, https, mailto open in a new tab with noopener; bare URLs too", () => {
  const h = M.render("[site](https://example.org/a?b=1&c=2) [m](mailto:a@b.c) see http://x.org/p.");
  assert.match(h, /<a href="https:\/\/example.org\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">site<\/a>/);
  assert.match(h, /<a href="mailto:a@b.c" target="_blank" rel="noopener noreferrer">m<\/a>/);
  assert.match(h, /<a href="http:\/\/x.org\/p" [^>]*>http:\/\/x.org\/p<\/a>\./);
  assert.equal(M.safeUrl("javascript:alert(1)"), null);
  assert.equal(M.safeUrl(" https://ok.example "), "https://ok.example");
});

test("wiki links: label, status class from the app", () => {
  const h = M.render("[[Home]] [[Work/Plan|the plan]] [[Gone]]", {
    wiki: (t) => (t === "Home" ? "ok" : t === "Gone" ? "new" : "amb")
  });
  assert.match(h, /<a class="md-wiki ok" role="link" tabindex="0" data-wiki="Home">Home<\/a>/);
  assert.match(h, /data-wiki="Work\/Plan">the plan<\/a>/);
  assert.match(h, /md-wiki new/);
  assert.deepEqual(M.wikiTargets("[[A]] [[a]] [[B|x]] [[Nb/C]]"), ["A", "B", "Nb/C"]);
});

test("task checkboxes carry their source line and toggle in the text", () => {
  const src = "intro\n- [ ] one\n- [x] two\n> - [ ] quoted\n```\n- [ ] in code\n```";
  const h = M.render(src);
  assert.match(h, /<input type="checkbox" data-line="1">/);
  assert.match(h, /<input type="checkbox" data-line="2" checked>/);
  assert.match(h, /data-line="3"/);
  assert.ok(!/data-line="5"/.test(h), "code is not a task");
  assert.equal(M.toggleTask(src, 1).split("\n")[1], "- [x] one");
  assert.equal(M.toggleTask(src, 2).split("\n")[2], "- [ ] two");
  assert.equal(M.toggleTask(src, 3).split("\n")[3], "> - [x] quoted");
  assert.equal(M.toggleTask(src, 0), null);
  assert.equal(M.toggleTask(src, 99), null);
});

test("toolbar: wrap, unwrap, heading cycle, list and task toggles, link, code block", () => {
  let r = M.format("hello world", 0, 5, "bold");
  assert.deepEqual(r, { text: "**hello** world", a: 2, b: 7 });
  r = M.format(r.text, r.a, r.b, "bold");
  assert.deepEqual(r, { text: "hello world", a: 0, b: 5 });
  r = M.format("ab", 1, 1, "italic");
  assert.deepEqual(r, { text: "a**b", a: 2, b: 2 });
  r = M.format("x", 0, 0, "heading");
  assert.equal(r.text, "# x");
  assert.equal(M.format("# x", 0, 0, "heading").text, "## x");
  assert.equal(M.format("### x", 0, 0, "heading").text, "x");
  assert.equal(M.format("a\nb", 0, 3, "list").text, "- a\n- b");
  assert.equal(M.format("- a\n- b", 0, 7, "list").text, "a\nb");
  assert.equal(M.format("- a", 0, 0, "task").text, "- [ ] a");
  assert.equal(M.format("- [ ] a", 0, 0, "task").text, "a");
  r = M.format("see", 0, 3, "link");
  assert.equal(r.text, "[see](https://)");
  assert.equal(r.text.slice(r.a, r.b), "https://");
  assert.equal(M.format("a\nb", 0, 3, "code").text, "```\na\nb\n```\n");
  assert.equal(M.format("f(x)", 0, 4, "code").text, "`f(x)`");
});

test("wiki resolution across notebooks (documented rule)", () => {
  const nbs = [{ id: "n1", name: "Home" }, { id: "n2", name: "Work" }, { id: "n3", name: "Twin" }, { id: "n4", name: "Twin" }];
  const pages = [
    { id: "a", nb: "n1", title: "Shopping" },
    { id: "b", nb: "n2", title: "Plan" },
    { id: "c", nb: "n2", title: "Shopping" },
    { id: "d", nb: "n2", title: "Ideas" },
    { id: "e", nb: "n3", title: "Ideas" },
    { id: "f", nb: "n1", title: "2024/Goals" }
  ];
  const idx = M.buildIndex(nbs, pages);
  assert.equal(M.resolve("shopping", "n1", idx).page.id, "a");          // same notebook first
  assert.equal(M.resolve("Shopping", "n2", idx).page.id, "c");
  assert.equal(M.resolve("Plan", "n1", idx).page.id, "b");              // unique elsewhere
  assert.equal(M.resolve("Ideas", "n1", idx).ambiguous.length, 2);      // two elsewhere
  assert.equal(M.resolve("Work/Shopping", "n1", idx).page.id, "c");     // notebook named
  assert.equal(M.resolve(" work / plan ", "n1", idx).page.id, "b");
  const miss = M.resolve("Work/New one", "n1", idx);
  assert.deepEqual([miss.missing, miss.nb, miss.title], [true, "n2", "New one"]);
  assert.equal(M.resolve("2024/Goals", "n2", idx).page.id, "f");        // a title with "/"
  const twin = M.resolve("Twin/Ideas", "n1", idx);                      // two notebooks named Twin → plain title
  assert.deepEqual([twin.missing, twin.nb, twin.title], [true, "n1", "Twin/Ideas"]);
  const none = M.resolve("Nothing", "n1", idx);
  assert.deepEqual([none.missing, none.nb], [true, "n1"]);
});

test("templates and the .md file", () => {
  const d = new Date(2026, 0, 5, 9, 7);
  assert.equal(M.ymd(d), "2026-01-05");
  assert.equal(M.hm(d), "09:07");
  assert.equal(M.fillTemplate("# {{title}} {{ date }} {{TIME}} {{other}}", { title: "T", date: "D", time: "H" }), "# T D H {{other}}");
  assert.equal(M.pageMarkdown("My page", "text\n\n"), "# My page\n\ntext\n\n---\n\nMade with orOS | useoros.online\n");
});

test("big and pathological input stays fast", () => {
  const big = ("*a _b `c [d](e ~~f **g\n").repeat(5000) + "*".repeat(20000) + "_".repeat(20000);
  const t0 = Date.now();
  const h = M.render(big);
  assert.ok(Date.now() - t0 < 3000, "render took " + (Date.now() - t0) + " ms");
  audit(h.slice(0, 20000));
});
