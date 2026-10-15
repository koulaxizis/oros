// Slides: Markdown decks (slides/mdimport.js) — Marp, reveal.js
// Markdown and plain Markdown with "---" separators become the plan
// OrosSlidesPPTX.build() turns into a NEW deck: titles from headings,
// bullets / numbering with levels, inline bold / italic, tables,
// speaker notes (Marp comments, reveal.js "Note:"), backgrounds,
// pictures inside the file (data:), pictures that are links left out
// and written in the notes, directives, HTML never kept as markup.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const ctx = { TextEncoder, TextDecoder, DecompressionStream, atob };
vm.createContext(ctx);
["slides/core.js", "slides/dk.js", "atelier/zip.js", "slides/pptx.js", "slides/mdimport.js"].forEach((f) =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx));
const C = ctx.OrosSlidesCore, X = ctx.OrosSlidesPPTX, M = ctx.OrosSlidesMd;
const j = (x) => JSON.parse(JSON.stringify(x));
const PNG64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const IMG = "a".repeat(64) + ".png";
const txt = (it) => it.paras.map((p) => p.r.map((r) => r.t).join("")).join("\n");
const ph = (s, role) => s.items.find((x) => x.ph === role);
function ids(prefix) {
  let n = 0;
  return () => prefix + String(++n).padStart(4, "0");
}

const MARP = `---
marp: true
theme: gaia
class: invert
paginate: true
---

# Ετήσια **αναφορά**

Ομάδα · 2026

---

<!-- _backgroundColor: #ffffff -->

## Σημεία

- Πρώτο **έντονο** και *πλάγιο*
  - δεύτερο επίπεδο
    - τρίτο
1. αριθμός
- [x] έγινε

<!--
Σημειώσεις ομιλητή
σε δύο γραμμές
-->

---

![bg](data:image/png;base64,${PNG64})

# Με φόντο

---

![bg right](https://example.com/photo.jpg)
![w:300 Ακρόπολη](data:image/png;base64,${PNG64})

## Εικόνα

Κείμενο δίπλα
`;

test("md: detects Marp, reveal.js and plain Markdown", () => {
  assert.equal(M.detect(MARP), "marp");
  assert.equal(M.detect("<!-- marp: true -->\n# A"), "marp");
  assert.equal(M.detect("# A\n\n---\n\n# B"), "md");
  assert.equal(M.detect("# A\n\n--\n\n# B"), "reveal");
  assert.equal(M.detect("# A\n\nNote: hi"), "reveal");
  assert.equal(M.detect("---\ntitle: x\nrevealOptions:\n  transition: fade\n---\n# A"), "reveal");
  assert.equal(M.detect('<html><section data-markdown><textarea data-template>\n# A\n</textarea></section></html>'), "reveal");
});

test("md: Marp deck → title slide, bullets with levels, notes, directives, theme", () => {
  const p = M.parse(MARP, { name: "deck.md" });
  assert.equal(p.source, "marp");
  assert.equal(p.title, "Ετήσια αναφορά");
  assert.equal(p.th, "dark");                       // class: invert
  assert.equal(p.slides.length, 4);
  const [s1, s2, s3, s4] = p.slides;
  assert.equal(s1.ly, "title");
  assert.equal(txt(ph(s1, "title")), "Ετήσια αναφορά");
  assert.ok(ph(s1, "title").paras[0].r.every((r) => !r.b), "a title is bold anyway");
  assert.equal(txt(ph(s1, "sub")), "Ομάδα · 2026");
  assert.equal(s2.ly, "content");
  assert.equal(s2.bg, "#ffffff");                   // _backgroundColor: this slide only
  assert.equal(s3.bg, null);
  assert.equal(s2.n, "Σημειώσεις ομιλητή\nσε δύο γραμμές");
  assert.deepEqual(j(ph(s2, "body").paras), [
    { l: 0, ls: "b", r: [{ t: "Πρώτο " }, { t: "έντονο", b: true }, { t: " και " }, { t: "πλάγιο", i: true }] },
    { l: 1, ls: "b", r: [{ t: "δεύτερο επίπεδο" }] },
    { l: 2, ls: "b", r: [{ t: "τρίτο" }] },
    { l: 0, ls: "n", r: [{ t: "αριθμός" }] },
    { l: 0, ls: "b", r: [{ t: "☑ έγινε" }] }
  ]);
  // ![bg](data:…) → a locked picture under everything
  assert.equal(s3.items[0].k, "image");
  assert.equal(s3.items[0].lk, true);
  assert.equal(s3.items[0].w, C.widthOf("16:9"));
  assert.equal(s3.ly, "section");
  // a picture that is a link: not loaded, its address in the notes
  assert.equal(p.count.remote, 1);
  assert.match(s4.n, /https:\/\/example\.com\/photo\.jpg/);
  assert.equal(s4.ly, "imgtext");
  const pic = ph(s4, "img");
  assert.equal(pic.alt, "Ακρόπολη");                // Marp size keywords dropped
  assert.equal(txt(ph(s4, "body")), "Κείμενο δίπλα");
  assert.deepEqual(Object.keys(p.media), ["md:0", "md:1"]);
});

test("md: pictures inside the file come out as bytes; build makes a new deck", async () => {
  const p = M.parse(MARP);
  const bytes = await p.get("md:0");
  assert.deepEqual(Array.from(bytes), Array.from(Buffer.from(PNG64, "base64")));
  assert.equal(await p.get("md:9"), null);
  const r = M.tidy(p, X.build(p, { "md:0": { id: IMG, w: 1, h: 1 }, "md:1": { id: IMG, w: 1, h: 1 } }, 7000, ids("md")));
  assert.equal(r.deck.t, "Ετήσια αναφορά");
  assert.equal(r.deck.th, "dark");
  assert.deepEqual(j(r.slides.map((s) => s.ly)), ["title", "content", "section", "imgtext"]);
  assert.equal(r.missing, 0);
  r.items.forEach((it) => assert.deepEqual(j(C.normItem(it)), j(it)));
  const d = C.emptyData();
  d.decks[r.deck.id] = r.deck;
  r.slides.forEach((s) => { d.slides[s.id] = s; });
  r.items.forEach((it) => { d.items[it.id] = it; });
  const out = C.formatOutline(d, r.deck.id);
  assert.match(out, /^# Ετήσια αναφορά\nΟμάδα · 2026\n\n# Σημεία\n- Πρώτο έντονο και πλάγιο\n  - δεύτερο επίπεδο/);
  assert.match(out, /> Σημειώσεις ομιλητή/);
});

test("md: reveal.js — vertical slides flattened, Note: and <aside> notes, HTML page", () => {
  const md = "# Ένα\n\nκείμενο\n\n--\n\n## Ένα.β\n\n- x\n\nNote: πες κάτι\nκαι άλλο\n\n---\n\n## Δύο\n\n<aside class=\"notes\">κρυφό <b>σημείωμα</b></aside>\n\n<p>ορατό <b>κείμενο</b></p>";
  const p = M.parse(md);
  assert.equal(p.source, "reveal");
  assert.deepEqual(j(p.slides.map((s) => txt(ph(s, "title")))), ["Ένα", "Ένα.β", "Δύο"]);
  assert.equal(p.slides[1].n, "πες κάτι\nκαι άλλο");
  assert.equal(p.slides[2].n, "κρυφό σημείωμα");
  assert.equal(txt(ph(p.slides[2], "body")), "ορατό κείμενο");
  const page = '<!doctype html><div class="reveal"><div class="slides"><section data-markdown><textarea data-template>\n## Α &amp; Β\n---\n## Γ\n</textarea></section></div></div>';
  const q = M.parse(page);
  assert.equal(q.source, "reveal");
  assert.deepEqual(j(q.slides.map((s) => txt(ph(s, "title")))), ["Α & Β", "Γ"]);
});

test("md: plain Markdown — separators, setext headings, code, tables, joined lines", () => {
  const md = "Τίτλος\n===\n\nΜία γραμμή\nπου συνεχίζει\n\n---\n\nΥπότιτλος\n---\n\n```js\nvar a = 1;\n  b();\n```\n\n***\n\n## Πίνακας\n\n| Όνομα | Τιμή |\n|---|--:|\n| α \\| β | **1** |\n";
  const p = M.parse(md, { name: "notes.md" });
  assert.equal(p.source, "md");
  assert.equal(p.slides.length, 3);
  assert.equal(txt(ph(p.slides[0], "title")), "Τίτλος");   // setext headings
  assert.equal(txt(ph(p.slides[1], "title")), "Υπότιτλος");
  assert.equal(ph(p.slides[1], "body").ff, "mono");
  assert.deepEqual(j(ph(p.slides[1], "body").paras.map((x) => x.r.map((r) => r.t).join(""))), ["var a = 1;", "  b();"]);
  const tb = p.slides[2].items.find((x) => x.k === "table");
  assert.deepEqual(j(tb.tb.rows), [["Όνομα", "Τιμή"], ["α | β", "1"]]);
  assert.equal(p.slides[2].noBody, true);
  const r = M.tidy(p, X.build(p, {}, 1, ids("pl")));
  const s3 = r.slides[2].id;
  assert.equal(r.items.filter((x) => x.s === s3 && x.ph === "body").length, 0, "no empty body under the table");
  // continuation lines join (Markdown), the first slide's text
  assert.equal(txt(ph(p.slides[0], "sub")), "Μία γραμμή που συνεχίζει");
});

test("md: plain Markdown without separators splits at its top headings", () => {
  const p = M.parse("# Α\n\n- ένα\n\n## Α.1\n\nκείμενο\n\n# Β\n\n- δύο\n");
  assert.deepEqual(j(p.slides.map((s) => txt(ph(s, "title")))), ["Α", "Β"]);
  assert.match(txt(ph(p.slides[0], "body")), /Α\.1/);
  const q = M.parse("## Α\n\nx\n\n## Β\n\ny\n");
  assert.equal(q.slides.length, 2);
  const marp = M.parse("---\nmarp: true\nheadingDivider: 2\n---\n# Α\n\n## Β\n\nx\n\n### γ\n\ny");
  assert.deepEqual(j(marp.slides.map((s) => txt(ph(s, "title")))), ["Α", "Β"]);
});

test("md: pictures that are files or links are noted, never fetched; HTML stays text", () => {
  const p = M.parse("# Α\n\n![σχέδιο](img/plan.png)\n\n![](https://x.example/a.png)\n\n<script>alert(1)</script> <img src=x onerror=alert(1)>κείμενο", { labels: { pic: "Εικόνα:" } });
  assert.equal(p.count.local, 1);
  assert.equal(p.count.remote, 1);
  assert.deepEqual(Object.keys(p.media), []);
  assert.equal(p.slides[0].n, "Εικόνα: σχέδιο img/plan.png\nΕικόνα: https://x.example/a.png");
  const body = txt(ph(p.slides[0], "sub"));          // first slide, one plain line: a title slide
  assert.ok(!/</.test(body), body);
  assert.match(body, /alert\(1\) κείμενο/);
});

test("md: inline formatting", () => {
  assert.deepEqual(j(M.inline("a **b** _c_ `d*e` [f](https://g) snake_case_name ~~h~~ \\*i\\*")), [
    { t: "a " }, { t: "b", b: true }, { t: " " }, { t: "c", i: true }, { t: " d*e f snake_case_name h *i*" }
  ]);
});

test("md: caps and odd input", () => {
  assert.equal(M.parse("").slides.length, 0);
  const many = Array.from({ length: 400 }, (_, i) => "# S" + i).join("\n\n---\n\n");
  const p = M.parse(many);
  assert.equal(p.slides.length, C.LIM.slides);
  assert.equal(p.count.slides, 400);
  assert.ok(p.count.skipped >= 100);
  const sized = M.parse("---\nmarp: true\nsize: 4:3\n---\n# A");
  assert.equal(sized.as, "4:3");
  assert.equal(M.parse("---\ntheme: forest\n---\n# A").th, "forest");
  assert.equal(M.looks("just some words"), false);
  assert.equal(M.looks("# Heading\n\n- item"), true);
});
