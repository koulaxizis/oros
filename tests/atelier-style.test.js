// Atelier My style (atelier/style.js, wave AC4): the kind of a page
// shape, the profile of a library (fonts by role, own fonts by name,
// colours, backgrounds, sizes, alignment, capitals), the summary the
// Assistant reads, the look of a new text; the copy in commands.js,
// the outline's style and new texts taking the style; the wiring in
// Atelier (brand.js, assist.js, index.html) and its strings.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const ST = require(path.join(ROOT, "atelier/style.js"));
const CMD = require(path.join(ROOT, "atelier/commands.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const OWN = "uf_" + "0123456789abcdef";
// A square post: a title in an own font, a subtitle and a body text,
// a dark background; the design names its own font.
function post(fc, now) {
  const d = AX.newDesign({ name: "Post", w: 1080, h: 1080, unit: "px", pages: 1 }, now || 1000);
  const p = M.pagesInOrder(d)[0].id;
  const add = (spec) => AX.addItem(d, p, spec, 1000);
  d.items.find((it) => it.ax.bg).ax.fc = "#102030";
  add({ k: "text", tx: "BIG NEWS", size: 108, font: "serif", fc: fc || "#ffffff", al: "c", caps: 1, x: 40, y: 40, w: 1000, ext: { fam: OWN } });
  add({ k: "text", tx: "Out on Friday", size: 54, font: "sans", fc: "#f0c000", al: "c", x: 40, y: 300, w: 1000 });
  add({ k: "text", tx: "A longer line of body text that tells the rest.", size: 27, font: "mono", fc: "#ffffff", al: "c", x: 40, y: 600, w: 1000 });
  d.setup.ext = { fonts: [{ id: OWN, name: "My Display" }] };
  return d;
}

test("kinds by page shape, and the copy in commands.js matches", () => {
  const cases = [[1080, 1080, "square"], [1080, 1350, "4:5"], [1080, 1920, "9:16"], [1920, 1080, "16:9"],
    [595, 842, "A portrait"], [200, 600, "bookmark"], [1500, 500, "banner"], [0, 0, "square"]];
  cases.forEach(([w, h, k]) => assert.equal(ST.kindOf(w, h), k, w + "×" + h));
  for (let r = 0.2; r < 4; r += 0.01) assert.equal(CMD.styleKind(r * 1000, 1000), ST.kindOf(r * 1000, 1000), "ratio " + r);
  ST.KINDS.forEach((k) => assert.ok(read("atelier/core.js").includes('"br.kind.' + k + '"'), k));
});

test("a profile: fonts by role (own fonts by name), colours, backgrounds, sizes, alignment, capitals", () => {
  const p = ST.profile([post(), post("#eeeeee")], 7000, (id) => "name of " + id);
  assert.equal(p.v, 1);
  assert.equal(p.at, 7000);
  assert.deepEqual(Object.keys(p.kinds), ["square"]);
  const e = p.kinds.square;
  assert.equal(e.n, 2);
  assert.equal(e.pages, 2);
  assert.deepEqual(e.fonts.title, [{ id: OWN, fb: "serif", share: 1, name: "My Display" }]);
  assert.equal(e.fonts.subtitle[0].id, "sans");
  assert.equal(e.fonts.body[0].id, "mono");
  assert.equal(e.colours[0], "#ffffff");
  assert.ok(e.colours.includes("#f0c000") && e.colours.includes("#eeeeee"));
  assert.deepEqual(e.backgrounds, ["#102030"]);
  assert.deepEqual(e.sizes, { title: 10, subtitle: 5, body: 2.5 });
  assert.equal(e.align, "c");
  assert.equal(e.caps, 0.33);
  // the summary the Assistant reads: names, not ids
  assert.deepEqual(e.sum, { kind: "square", designs: 2, title_font: "My Display", subtitle_font: "name of sans", body_font: "name of mono",
    colours: e.colours.slice(0, 5), backgrounds: ["#102030"], size_pct_of_short_side: e.sizes, align: "c" });
  // nothing to learn from: no kinds; broken designs are skipped
  assert.deepEqual(ST.profile([], 1).kinds, {});
  assert.deepEqual(ST.profile([null, { setup: { w: 0, h: 0 }, items: [], pages: [] }], 1).kinds, {});
});

test("the look of a new text: own font with its stand-in, size for the page, the main colour", () => {
  const p = ST.profile([post()], 1);
  assert.deepEqual(ST.look(p, "square", "title", 2000), { font: "serif", fam: OWN, size: 200, fc: "#ffffff" });
  assert.deepEqual(ST.look(p, "square", "body", 1080), { font: "mono", size: 27, fc: "#ffffff" });
  assert.equal(ST.look(p, "banner", "title", 1080), null);
  assert.equal(ST.look(p, "square", "caption", 1080), null);
  assert.equal(ST.look(null, "square", "title", 1080), null);
});

test("the outline carries the style of the design's kind; a broken profile adds nothing", () => {
  const p = ST.profile([post()], 1);
  const d = post();
  assert.deepEqual(CMD.outline(d, p).style, p.kinds.square.sum);
  assert.equal(CMD.outline(d).style, undefined);
  assert.equal(CMD.outline(d, { kinds: { square: { sum: "x" } } }).style, undefined);
  assert.equal(CMD.outline(d, { kinds: Object.create({ square: { sum: {} } }) }).style, undefined);
  const wide = AX.newDesign({ name: "Slide", w: 1920, h: 1080, unit: "px", pages: 1 }, 1);
  assert.equal(CMD.outline(wide, p).style, undefined);
});

test("a new text takes the style where the command leaves it out", () => {
  const p = ST.profile([post()], 1);
  const d = AX.newDesign({ name: "New", w: 1080, h: 1080, unit: "px", pages: 1 }, 1);
  const env = { now: 5000, newId: M.newId, normItem: M.normItem, notes: [], addItem: AX.addItem,
    look: (doc, role) => ST.look(p, ST.kindOf(doc.setup.w, doc.setup.h), role, Math.min(doc.setup.w, doc.setup.h)) };
  const r = CMD.check([{ op: "add", what: "text", text: "Hello" },
    { op: "add", what: "text", text: "A body text that is long enough to count as body text here.", font: "sans", size: 40, c: "#000000" }]);
  assert.ok(r.ok, r.err);
  r.steps.forEach((st) => CMD.apply(d, st, env));
  const [a, b] = d.items.filter((it) => it.ax.k === "text").sort((x, y) => x.z - y.z);
  assert.equal(a.ax.font, "serif");
  assert.equal(a.ext.fam, OWN);
  assert.equal(a.ax.size, 108);
  assert.equal(a.ax.fc, "#ffffff");
  // the command's own choices win
  assert.equal(b.ax.font, "sans");
  assert.equal(b.ext, undefined);
  assert.equal(b.ax.size, 40);
  assert.equal(b.ax.fc, "#000000");
  // without a look (other apps) nothing changes
  const d2 = AX.newDesign({ name: "New", w: 1080, h: 1080, unit: "px", pages: 1 }, 1);
  CMD.apply(d2, r.steps[0], { now: 5000, newId: M.newId, normItem: M.normItem, notes: [], addItem: AX.addItem });
  assert.equal(d2.items.find((it) => it.ax.k === "text").ext, undefined);
});

test("wiring: style.js loads before brand.js; brand.js keeps the profile; assist.js passes look; strings EN/EL/DE", () => {
  const html = read("atelier/index.html");
  assert.ok(html.indexOf('src="style.js') > 0 && html.indexOf('src="style.js') < html.indexOf('src="brand.js'));
  const br = read("atelier/brand.js");
  assert.match(br, /STYLE_KEY = "oros-atelier-style"/);
  assert.match(br, /AT\.style = \{/);
  assert.match(br, /AT\.on\("change", styleLater\)/);
  assert.match(read("atelier/assist.js"), /look: function \(doc, role\) \{ return AT\.style \? AT\.style\.look\(doc, role\) : null; \}/);
  const core = read("atelier/core.js"), de = read("i18n/de/atelier.js");
  ["br.style", "br.styleNone", "br.styleOf", "br.styleHint"].concat(ST.KINDS.map((k) => "br.kind." + k)).forEach((k) => {
    assert.equal(core.split('"' + k + '"').length - 1, 2, "EN+EL " + k);
    assert.ok(de.includes('"' + k + '"'), "DE " + k);
  });
});
