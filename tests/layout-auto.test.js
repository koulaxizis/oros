// orOS Layout — automatic layout in a house style (layout/autolay.js,
// LY-AUTO): a manuscript's paragraphs (layout/wordin.js) become a new
// book from a house style learned from earlier books. Synthetic books
// and manuscripts only.
// Run: node --test tests/layout-auto.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { book, words } = require("./layout-books.js");
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const H = require(path.join(ROOT, "layout/house.js"));
const A = require(path.join(ROOT, "layout/autolay.js"));
const W = require(path.join(ROOT, "layout/wordin.js"));

const text = (p) => p.runs.map((r) => r.t).join("");

function house() {
  return H.learn([book("Ένα", 3, 11, { isbn: true, toc: true }), book("Δύο", 3, 11, { isbn: true, toc: true })], { now: 5, name: "Prose" });
}
// a manuscript as Writer's reader gives it: headings, an empty line,
// a bold title without a heading style, straight quotes, a dialogue
function manuscript(n) {
  let html = "";
  for (let c = 0; c < n; c++) {
    html += c === 2 ? "<p></p><p><strong>Τρίτο διήγημα</strong></p>" : "<h1>Διήγημα " + (c + 1) + "</h1><p></p>";
    html += "<p>" + words(80, c) + "</p><p>- Ναι, είπε \"ναι\"...</p>";
    for (let k = 0; k < 6; k++) html += "<p>" + words(90, c + k) + "</p>";
  }
  return W.parse(html);
}

test("house: the template marks its contents, ISBN and title as fields", () => {
  const res = house(), d = res.doc;
  assert.equal(res.report.toc, true);
  assert.equal(res.report.isbn, 1);
  assert.equal(res.report.title, true);
  const all = d.stories.map((s) => s.paras.map(text).join("\n")).join("\n");
  assert.ok(all.includes("{isbn}") && all.includes("{title}"));
  assert.ok(d.stories.some((s) => s.ext && s.ext.hs === "toc"));
});

test("build: a new book in the house style, titles on odd pages, contents and fields filled", () => {
  const hs = house().doc, list = manuscript(4);
  const res = A.build(hs, list, { title: "Νέο βιβλίο", isbn: "978-618-00-1111-2", author: "Κάποιος" }, { now: 9, pictures: 2 });
  const d = res.doc, rep = res.report, h = H.houseOf(d);
  assert.equal(d.name, "Νέο βιβλίο");
  assert.equal(rep.titles, 4);
  assert.equal(rep.guessed, 1);
  assert.equal(rep.fields, 2);
  assert.equal(rep.toc, 4);
  assert.equal(rep.pictures, 2);
  assert.deepEqual(rep.check, []);
  assert.equal(rep.fixes.quotes, 8);
  assert.equal(rep.fixes.dash, 4);
  assert.equal(rep.fixes.ellipsis, 4);
  // the fields are filled
  const all = d.stories.map((s) => s.paras.map(text).join("\n")).join("\n");
  assert.ok(all.includes("Νέο βιβλίο") && all.includes("978-618-00-1111-2") && !all.includes("{isbn}"));
  // every title on an odd page, at its top
  const L = R.computeLayout(d), order = M.pagesInOrder(d), first = M.firstNumber(d);
  const body = d.stories.find((s) => s.paras.some((p) => p.ps === h.roles.title && text(p).startsWith("Διήγημα")));
  const at = {};
  M.chain(d, body.id).forEach((f) => (L.frames[f.id] || { lines: [] }).lines.forEach((ln, k) => { if (at[ln.p] === undefined) at[ln.p] = { no: order.findIndex((p) => p.id === f.pg) + first, top: k === 0 }; }));
  const titles = body.paras.map((p, i) => [p, i]).filter(([p]) => p.ps === h.roles.title);
  assert.equal(titles.length, 4);
  titles.forEach(([p, i]) => { assert.equal(at[i].no % 2, 1, text(p)); assert.ok(at[i].top, text(p)); });
  // the paragraph after each title is the first paragraph, the dialogue has its dash and quotes
  titles.forEach(([, i]) => assert.equal(body.paras[i + 1].ps, h.roles.first));
  assert.ok(body.paras.some((p) => text(p) === "— Ναι, είπε «ναι»…"));
  // the contents list the titles with those pages
  const toc = d.stories.find((s) => s.ext && s.ext.hs === "toc");
  assert.deepEqual(toc.paras.slice(1).map(text), titles.map(([p, i]) => text(p) + "\t" + at[i].no));
  // no empty body page at the end; the back matter follows the text
  const pages = M.pagesInOrder(d);
  assert.equal(pages[pages.length - 1].ext.hs, "back");
  const lastBody = pages.filter((p) => p.ext && p.ext.hs === "body").pop();
  const f = d.items.find((it) => it.pg === lastBody.id && it.story === body.id);
  assert.ok(L.frames[f.id].lines.length > 0);
  assert.ok(!L.overset[body.id]);
  // a document Layout keeps as it is
  assert.deepEqual(M.normDoc(JSON.parse(JSON.stringify(d))), d);
  // the words are the manuscript's
  const letters = (s) => s.replace(/[^\p{L}]/gu, "");
  assert.equal(letters(body.paras.map(text).join("")), letters(list.map(text).join("")));
});

test("house: a colophon all in one size: the quoted line is the title, quotes kept; no quoted line, no guess", () => {
  const colophon = (lines) => {
    const b = book("Ένα", 2, 11);
    b.stories.find((st) => st.id === "st-front").paras = lines.map((t) => ({ ps: "ps-nt", runs: [{ t }] }));
    return M.normDoc(b);
  };
  const front = (res) => res.doc.stories.find((st) => st.paras.some((p) => text(p) === "Ο συγγραφέας")).paras.map(text);
  const a = H.learn([colophon(["Ο συγγραφέας", "«Ένα»", "Εκδόσεις"])], { now: 5 });
  assert.equal(a.report.title, true);
  assert.deepEqual(front(a), ["Ο συγγραφέας", "«{title}»", "Εκδόσεις"]);
  const b = H.learn([colophon(["Ο συγγραφέας", "Ένα", "Εκδόσεις"])], { now: 5 });
  assert.equal(b.report.title, false);
  assert.deepEqual(front(b), ["Ο συγγραφέας", "Ένα", "Εκδόσεις"]);
});

test("structure: short opening paragraphs are the book, not front matter; a line of stars is never a title", () => {
  const short = "<p>" + words(12, 1) + "</p>";
  const html = "<p><b>ΜΕΡΟΣ ΠΡΩΤΟ</b></p>" + short + short + short + "<p></p><p></p><p></p><p style=\"text-align:center\">***</p>" + short +
    "<p></p><p><b>ΜΕΡΟΣ ΔΕΥΤΕΡΟ</b></p><p>" + words(60, 2) + "</p>";
  const s = A.structure(W.parse(html));
  assert.equal(s.front, 0);
  assert.deepEqual(s.list.filter((p) => /^h/.test(p.role)).map(text), ["ΜΕΡΟΣ ΠΡΩΤΟ", "ΜΕΡΟΣ ΔΕΥΤΕΡΟ"]);
  assert.equal(s.list.filter((p) => p.role === "center").length, 1);
  // a title page and a dedication before the first title still go
  const t = A.structure(W.parse("<p><b>Τίτλος</b></p><p>Για τη Μαρία</p><p></p><p><b>Πρώτο</b></p><p>" + words(60, 3) + "</p>"));
  assert.equal(t.front, 2);
  assert.equal(text(t.list[0]), "Πρώτο");
  // running text before the first title is never left out
  const u = A.structure(W.parse("<p>" + words(90, 4) + "</p><p></p><p><b>Πρώτο</b></p><p>" + words(60, 3) + "</p>"));
  assert.equal(u.front, 0);
  assert.deepEqual(u.list.map((p) => p.role), ["p1", "h1", "p1"]);
});

test("structure: titles guessed only from short bold lines after an empty one; empty lines by titles go", () => {
  const s = A.structure(W.parse("<p><b>Τίτλος</b></p><p>κείμενο</p><p></p><p></p><p>πιο κάτω</p><p></p><p><b>Όχι τίτλος γιατί είναι στο τέλος</b></p>"));
  assert.deepEqual(s.list.map((p) => p.role), ["h1", "p1", "p", "p1", "p", "p1"]);
  assert.equal(s.guessed, 1);
  assert.equal(s.dropped, 1);
});

test("toc: Update contents follows the pages after a change", () => {
  const d = A.build(house().doc, manuscript(3), { title: "Χ" }, { now: 9 }).doc;
  const toc = () => d.stories.find((s) => s.ext && s.ext.hs === "toc").paras.slice(1).map(text);
  const before = toc();
  // a shorter first story brings the others forward
  const body = d.stories.find((s) => s.paras.length > 20);
  body.paras.splice(2, 6);
  const n = A.toc(d);
  assert.equal(n, 3);
  assert.notDeepEqual(toc(), before);
  assert.equal(toc()[0], before[0]);
});

test("build: no house style gives nothing", () => {
  assert.equal(A.build(M.newDoc({ name: "x", pages: 1 }, 1), [], {}, { now: 1 }), null);
});

test("wiring: More › Automatic layout and Update contents; autolay.js loads after house.js and is cached offline", () => {
  const html = fs.readFileSync(path.join(ROOT, "layout/index.html"), "utf8");
  assert.ok(html.indexOf('src="autolay.js') > html.indexOf('src="house.js') && html.indexOf('src="houseui.js') > html.indexOf('src="autolay.js'));
  assert.ok(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").includes('"layout/autolay.js",'));
  const pn = fs.readFileSync(path.join(ROOT, "layout/panels.js"), "utf8");
  assert.match(pn, /t\("more\.auto"\), fn: function \(\) \{ LY\.house\.auto\(\); \}/);
  assert.match(pn, /t\("more\.toc"\), disabled: !LY\.house\.hasToc\(doc\)/);
  // the manuscript is read by the same reader as Place text
  assert.match(fs.readFileSync(path.join(ROOT, "layout/houseui.js"), "utf8"), /LY\.io\.readDoc\(file\)/);
});
