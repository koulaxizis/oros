// Layout W11 rest + N7 (LY-N7): named versions and compare
// (layout/versions.js), the `version` command for the Assistant and
// orOS Gate (commands.js, assist.js), strings in EN/EL/DE and the
// wiring. Synthetic documents only.
// Run: node --test tests/layout-n7.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const V = require(path.join(ROOT, "layout/versions.js"));
const M = require(path.join(ROOT, "designkit/model.js"));

function doc() {
  const d = M.newDoc({ name: "Ο φάρος", w: 400, h: 600, pages: 3, facing: 1 }, 1);
  d.stories.push({ id: "st-a", m: 1, paras: [
    { ps: "ps-body", runs: [{ t: "Το φως γύριζε πάνω από τη θάλασσα." }] },
    { ps: "ps-body", runs: [{ t: "Ο φύλακας " }, { t: "κοιμόταν", b: 1 }, { t: " νωρίς." }] },
    { ps: "ps-body", runs: [{ t: "Τέλος." }, { t: "*", ext: { fn: "n1", ft: "Υποσημείωση που δεν μετράει." } }] }] });
  d.items.push({ id: "it-a", m: 1, t: "text", pg: M.pagesInOrder(d)[0].id, x: 40, y: 40, w: 300, h: 400, story: "st-a", seq: 1, z: 1 });
  return d;
}

test("words and stats: runs joined, notes left out, pages and frames counted", () => {
  const d = doc(), s = V.stats(d);
  assert.equal(V.paraText(d.stories[0].paras[1]), "Ο φύλακας κοιμόταν νωρίς.");
  assert.equal(V.paraText(d.stories[0].paras[2]), "Τέλος.", "a note's text is not the paragraph's");
  assert.deepEqual(s, { pages: 3, words: 12, frames: 1, pictures: 0, stories: 1 });
});

test("diffWords: struck and added words, common ends kept whole", () => {
  assert.deepEqual(V.diffWords("ο φάρος γύριζε τη νύχτα", "ο φάρος έσβησε τη νύχτα"),
    [["=", "ο φάρος"], ["-", "γύριζε"], ["+", "έσβησε"], ["=", "τη νύχτα"]]);
  assert.deepEqual(V.diffWords("", "νέο"), [["+", "νέο"]]);
  assert.deepEqual(V.diffWords("ίδιο κείμενο", "ίδιο  κείμενο"), [["=", "ίδιο κείμενο"]], "spacing alone is no change");
  const long = Array.from({ length: 900 }, (_, i) => "w" + i).join(" ");
  const r = V.diffWords(long, long.replace("w450", "x450").replace("w10 ", "x10 "));
  assert.ok(r.some((x) => x[0] === "-") && r.some((x) => x[0] === "+") && r[0][0] === "=", "long paragraphs still diff");
});

test("diffParas: changed, added and removed paragraphs in order", () => {
  const P = (t) => ({ runs: [{ t }] });
  assert.deepEqual(V.diffParas([P("α"), P("β"), P("γ")], [P("α"), P("β2"), P("γ"), P("δ")]),
    [{ k: "chg", p: 1, a: "β", b: "β2" }, { k: "add", p: 3, a: "", b: "δ" }]);
  assert.deepEqual(V.diffParas([P("α"), P("β")], [P("β")]), [{ k: "del", p: 0, a: "α", b: "" }]);
  assert.deepEqual(V.diffParas([P("α")], [P("α")]), []);
});

test("diff: a version against now (text, frames, styles, setup, pages)", () => {
  const then = doc(), now = JSON.parse(JSON.stringify(then));
  now.stories[0].paras[1].runs[1].t = "ξύπνησε";
  now.stories[0].paras.push({ ps: "ps-body", runs: [{ t: "Νέα παράγραφος." }] });
  now.items.push({ id: "it-b", m: 2, t: "rect", pg: now.pages[0].id, x: 0, y: 0, w: 10, h: 10, z: 2 });
  now.items[0].x = 50;
  now.setup.ext = Object.assign({}, now.setup.ext, { lang: "el" });
  now.stories.push({ id: "st-b", m: 2, paras: [{ ps: "ps-body", runs: [{ t: "Άλλη ιστορία." }] }] });
  const d = V.diff(then, now);
  assert.equal(d.stats[0].words, 12); assert.equal(d.stats[1].words, 16);
  assert.deepEqual(d.paras.map((x) => [x.sid, x.k, x.p]), [["st-a", "chg", 1], ["st-a", "add", 3], ["st-b", "add", 0]]);
  assert.equal(d.paras[0].a, "Ο φύλακας κοιμόταν νωρίς."); assert.equal(d.paras[0].b, "Ο φύλακας ξύπνησε νωρίς.");
  assert.deepEqual(d.items, { add: 1, del: 0, chg: 1 });
  assert.equal(d.setup, true);
  assert.deepEqual(d.pages, { add: 0, del: 0 });
  // a story that is gone: its paragraphs removed
  const back = V.diff(now, then);
  assert.ok(back.paras.some((x) => x.sid === "st-b" && x.k === "del" && x.gone));
  assert.equal(V.diff(then, JSON.parse(JSON.stringify(then))).paras.length, 0);
  assert.equal(V.cleanName("  Στάλθηκε \n στον   επιμελητή "), "Στάλθηκε στον επιμελητή");
  assert.equal(V.cleanName("x".repeat(200)).length, 80);
});

test("version command: checked, changes nothing itself, previewed as a note; assist.js saves it first", () => {
  const C = require(path.join(ROOT, "layout/commands.js"));
  const ok = C.check([{ op: "version", name: "Πριν τις αλλαγές" }, { op: "rename", title: "Νέο" }]);
  assert.equal(ok.ok, true);
  assert.equal(C.check([{ op: "version" }]).ok, false, "a version needs a name");
  const d = doc();
  assert.equal(C.apply(d, ok.steps[0], { now: 5 }), 0);
  assert.ok(/\nversion: /.test(C.GUIDE) && /`name`/.test(C.GUIDE));
  const assist = read("layout/assist.js");
  assert.ok(/v\.op !== "version"/.test(assist) && /LY\.versions\.save\(LY\.findDoc\(id\), v\.name, "claude"\)/.test(assist));
  assert.ok(/return pre\.then\(function \(\) \{ return LY\.recipeGrey/.test(assist), "the version is kept before anything changes");
  assert.ok(/version saved first: /.test(read("layout/commands.js")));
});

test("wiring: menu, script, offline list, styles, strings and help in EN/EL/DE", () => {
  assert.ok(/t\("more\.versions"\)/.test(read("layout/panels.js")));
  assert.ok(/<script src="versions\.js\?v=[0-9.]+"><\/script>/.test(read("layout/index.html")));
  assert.ok(read("sw.js").includes('"layout/versions.js"'));
  assert.ok(/\.ver-txt del/.test(read("layout/layout.css")));
  const src = read("layout/versions.js"), lay = read("layout/layout.js"), de = read("i18n/de/layout.js");
  const keys = Array.from(new Set((src.match(/t\("(ver\.[a-zA-Z.]+)"/g) || []).map((m) => m.slice(3, -1)))).filter((k) => !/\.$/.test(k)).concat(["more.versions", "ver.k.chg", "ver.k.add", "ver.k.del"]);
  assert.ok(keys.length > 25);
  keys.forEach((k) => {
    assert.equal((lay.match(new RegExp('"' + k.replace(/\./g, "\\.") + '": "', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '": "'), k + " DE");
  });
  assert.ok(!/\bconfirm\(|\balert\(|\bprompt\(/.test(src), "no browser dialogs");
  assert.ok(read("layout/help.en.txt").includes("## Versions"));
  assert.ok(read("layout/help.el.txt").includes("## Εκδοχές"));
  assert.ok(read("i18n/de/help/layout.txt").includes("## Versionen"));
});
