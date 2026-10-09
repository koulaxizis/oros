// Atelier (graphic design) on the designkit core: the item extras
// (`ax`, atelier/ax.js) and the model.js hook that keeps them through
// normalization and merge (canonical, idempotent, symmetric,
// tombstones), text layout (straight + curved), the starter templates
// in English and Greek, the app's EN/EL strings, and a static check
// that no user text ever reaches innerHTML.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const FX = require(path.join(ROOT, "designkit/fx.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));          // registers the hook
const TPL = require(path.join(ROOT, "atelier/templates.js"));
const ICONS = require(path.join(ROOT, "atelier/library/icons.js"));

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const J = (x) => JSON.stringify(x);
const clone = (x) => JSON.parse(J(x));

function design(now) {
  const d = AX.newDesign({ name: "Test", w: 1080, h: 1080 }, now || 1000);
  const pg = d.pages[0].id;
  AX.addItem(d, pg, { k: "text", tx: "Καλημέρα κόσμε", size: 60, x: 40, y: 40, w: 600, fc: "#112233", tfx: { type: "shadow" } }, 1000);
  AX.addItem(d, pg, { k: "shape", shp: "star", fc: "#ff0000", x: 300, y: 300, w: 200, h: 200 }, 1000);
  AX.addItem(d, pg, { k: "icon", ico: "heart", sc: "#000000", x: 10, y: 10, w: 80, h: 80, sw: 2 }, 1000);
  AX.addItem(d, pg, { k: "line", sc: "#000000", ae: "arrow", x: 100, y: 900, w: 500, h: 0, sw: 4 }, 1000);
  AX.addItem(d, pg, { k: "photo", a: "a".repeat(64) + ".jpg", iw: 800, ih: 600, x: 500, y: 500, w: 400, h: 300, flt: "noir", adj: { bright: 20 } }, 1000);
  return M.normDoc(d);
}
const byKind = (d, k) => d.items.find((it) => it.ax && it.ax.k === k);

// ---------- normalizer ----------
test("ax: kinds must match the base item type, defaults are omitted", () => {
  assert.equal(AX.normAx({ k: "text" }, { t: "img" }), null);
  assert.equal(AX.normAx({ k: "photo" }, { t: "rect" }), null);
  assert.equal(AX.normAx({ k: "nope" }, { t: "rect" }), null);
  assert.equal(AX.normAx(null, { t: "rect" }), null);
  assert.deepEqual(AX.normAx({ k: "shape" }, { t: "rect" }), { k: "shape", shp: "rect" });
  assert.deepEqual(AX.normAx({ k: "text", tx: "A", al: "l", lh: 120, tr: 0, tfx: { type: "none" }, cv: 0 }, { t: "rect" }),
    { k: "text", tx: "A", font: "sans", size: 48 });
  assert.deepEqual(AX.normAx({ k: "photo", shp: "rect", adj: { bright: 0 }, flt: "none" }, { t: "img" }), { k: "photo" });
});

test("ax: hostile and out-of-range values are cleaned", () => {
  const a = AX.normAx({
    k: "text", tx: "a\u0000b\r\nc" + "x".repeat(9000), font: "<script>", size: 1e9, al: "q", lh: 5, tr: 99999,
    fc: "red; background:url(x)", tfx: { type: "neon", color: "javascript:alert(1)", blur: 900 }, cv: -500, evil: "<img onerror=1>"
  }, { t: "rect" });
  assert.equal(a.tx.length, AX.MAX_TX);
  assert.ok(a.tx.startsWith("ab\nc"));
  assert.equal(a.font, "sans");
  assert.equal(a.size, 2000);
  assert.equal(a.lh, 70);
  assert.equal(a.tr, 1000);
  assert.equal(a.fc, undefined, "a non-hex colour is dropped");
  assert.equal(a.tfx.color, "#000000");
  assert.equal(a.tfx.blur, 100);
  assert.equal(a.cv, -100);
  assert.equal(a.evil, undefined);
  assert.equal(a.al, undefined);
  const ic = AX.normAx({ k: "icon", ico: "../../x\"/><script>" }, { t: "rect" });
  assert.equal(ic.ico, "square");
  const g = AX.normAx({ k: "shape", g: { a: "#fff", b: "nope", ang: 45 } }, { t: "rect" });
  assert.equal(g.g, undefined, "a gradient needs two colours");
  const cr = AX.normAx({ k: "photo", cr: { src: "openverse", id: "evil" } }, { t: "img" });
  assert.equal(cr.cr, undefined, "credits go through media.normCredit");
});

test("ax: normalizing is idempotent and keys come in a fixed order", () => {
  const d = design();
  d.items.forEach((it) => {
    assert.ok(it.ax, it.id);
    assert.equal(J(AX.normAx(it.ax, it)), J(it.ax));
    const shuffled = {};
    Object.keys(it.ax).reverse().forEach((k) => { shuffled[k] = it.ax[k]; });
    assert.equal(J(AX.normAx(shuffled, it)), J(it.ax), "same JSON whatever the input order");
  });
});

// ---------- the model.js hook ----------
test("model hook: extras survive normDoc, normData and merge", () => {
  const d = design();
  const again = M.normDoc(clone(d));
  assert.equal(J(again), J(d));
  assert.equal(byKind(again, "photo").ax.flt, "noir");
  const data = M.normData({ ver: 1, docs: [d], dt: {} });
  assert.equal(J(M.normData(clone(data))), J(data));
});

test("model hook: Layout's model without a registered extension drops ax (unchanged behaviour)", () => {
  // a fresh copy of model.js in a sandbox, as Layout loads it
  const src = fs.readFileSync(path.join(ROOT, "designkit/model.js"), "utf8");
  const mod = { exports: {} };
  new Function("module", "exports", "require", src)(mod, mod.exports, require);
  const L = mod.exports;
  const it = L.normItem({ id: "it-a1", m: 1, t: "rect", pg: "pg-a1", ax: { k: "shape" } });
  assert.ok(it);
  assert.equal(it.ax, undefined);
});

test("merge: two devices change different elements, both changes kept", () => {
  const base = design();
  const a = clone(base), b = clone(base);
  const sa = byKind(a, "shape"); sa.ax.fc = "#00ff00"; M.touch(sa, 2000);
  const tb = byKind(b, "text"); tb.ax.tx = "Γεια"; M.touch(tb, 2100);
  const m1 = M.mergeDoc(a, b), m2 = M.mergeDoc(b, a);
  assert.equal(J(m1), J(m2), "symmetric");
  assert.equal(byKind(m1, "shape").ax.fc, "#00ff00");
  assert.equal(byKind(m1, "text").ax.tx, "Γεια");
  assert.equal(J(M.mergeDoc(m1, m1)), J(m1), "idempotent");
});

test("merge: the newer edit of the same element wins; a delete is a tombstone", () => {
  const base = design();
  const a = clone(base), b = clone(base);
  const pa = byKind(a, "photo"); pa.ax.flt = "vivid"; M.touch(pa, 3000);
  const pb = byKind(b, "photo"); pb.ax.flt = "sepia"; M.touch(pb, 3500);
  assert.equal(byKind(M.mergeDoc(a, b), "photo").ax.flt, "sepia");
  const c = clone(base);
  const icon = byKind(c, "icon");
  c.items = c.items.filter((it) => it !== icon);
  c.tombs[icon.id] = 4000;
  const m = M.mergeDoc(base, c);
  assert.equal(byKind(m, "icon"), undefined, "deleted on one device stays deleted");
  assert.equal(J(M.mergeDoc(c, base)), J(m));
});

// ---------- designs + text ----------
test("newDesign: one page with a locked background, no masters or styles", () => {
  const d = AX.newDesign({ name: "x", w: 1080, h: 1920, bg: "#123456" }, 5);
  assert.equal(d.pages.length, 1);
  assert.equal(d.masters.length + d.pstyles.length + d.cstyles.length + d.swatches.length, 0);
  assert.equal(d.setup.unit, "pt");
  assert.equal(d.setup.bleed, 0);
  const bg = AX.background(d, d.pages[0].id);
  assert.ok(bg && bg.ax.bg && bg.lock);
  assert.equal(bg.ax.fc, "#123456");
  assert.deepEqual([bg.x, bg.y, bg.w, bg.h], [0, 0, 1080, 1920]);
  const p = AX.newDesign({ w: M.fromUnit(210, "mm"), h: M.fromUnit(297, "mm"), unit: "mm" }, 5);
  assert.equal(p.setup.unit, "mm");
  assert.ok(Math.abs(p.setup.bleed - M.fromUnit(3, "mm")) < 0.01);
});

test("text: height follows the text, wraps inside the width", () => {
  const d = design();
  const t = byKind(d, "text");
  const lay = AX.textLayout(t);
  assert.equal(lay.lines.length, 1);
  assert.ok(Math.abs(t.h - AX.textHeight(t)) < 0.01);
  const narrow = clone(t); narrow.w = 150;
  const l2 = AX.textLayout(narrow);
  assert.ok(l2.lines.length >= 2);
  l2.lines.forEach((ln) => ln.runs.forEach((r) => assert.ok(r.x + r.w <= 150.01)));
  const two = clone(t); two.ax.tx = "α\nβ\n\nγ";
  assert.equal(AX.textLayout(two).lines.length, 4, "empty lines count");
  assert.ok(AX.textWidth({ tx: "Hello", size: 20 }) > AX.textWidth({ tx: "Hi", size: 20 }));
});

test("text: curved text stays inside its box and keeps glyph order", () => {
  const d = design();
  const t = clone(byKind(d, "text"));
  t.ax.cv = 40;                       // under half a circle: x keeps growing
  const c = AX.curveLayout(t);
  assert.equal(c.glyphs.length, Array.from("Καλημέρα κόσμε").length);
  c.glyphs.forEach((g) => {
    assert.ok(Math.abs(g.x) <= c.w / 2 + 0.01 && Math.abs(g.y) <= c.h / 2 + 0.01);
  });
  for (let i = 1; i < c.glyphs.length; i++) assert.ok(c.glyphs[i].x > c.glyphs[i - 1].x);
  assert.ok(c.glyphs[0].y > c.glyphs[6].y, "arches up (y grows down)");
  t.ax.cv = 0;
  const flat = AX.curveLayout(t);
  assert.ok(flat.glyphs.every((g) => Math.abs(g.y - flat.glyphs[0].y) < 1e-9));
});

test("credits + assets of a design", () => {
  const d = design();
  assert.deepEqual(AX.assetIds(d), ["a".repeat(64) + ".jpg"]);
  assert.deepEqual(AX.credits(d), []);
  const p = byKind(d, "photo");
  p.ax.cr = { src: "openverse", id: "openverse:1234", kind: "photo", title: "Sea", author: "Ann", lic: "by", licVer: "2.0" };
  const n = M.normDoc(d);
  const cr = AX.credits(n);
  assert.equal(cr.length, 1);
  assert.equal(cr[0].author, "Ann");
});

// ---------- templates ----------
test("templates: every template builds in English and Greek, valid and in bounds", () => {
  const icons = new Set(ICONS.list.map((e) => e[0]));
  const shapes = new Set(FX.SHAPES.map((s) => s.id));
  const ids = TPL.list.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  const presets = require(path.join(ROOT, "atelier/presets.js")).list.map((p) => p[0]);
  TPL.list.forEach((tpl) => {
    assert.ok(tpl.en && tpl.el, tpl.id);
    assert.ok(presets.includes(tpl.preset), tpl.id + " preset");
    const specs = tpl.pages.flatMap((p) => p.items);
    specs.forEach((s) => {
      if (s.k === "icon") assert.ok(icons.has(s.ico), tpl.id + " icon " + s.ico);
      if (s.k === "shape") assert.ok(shapes.has(s.shp), tpl.id + " shape " + s.shp);
      if (s.k === "text") assert.ok(s.tx.en && s.tx.el, tpl.id + " text");
    });
    ["en", "el"].forEach((lang) => {
      const d = AX.fromTemplate(tpl, lang, 1);
      assert.equal(d.pages.length, tpl.pages.length, tpl.id);
      const items = d.items.filter((it) => !it.ax.bg);
      assert.equal(items.length, specs.length, tpl.id + " " + lang + ": no element dropped");
      assert.equal(J(M.normDoc(clone(d))), J(d), tpl.id + " canonical");
      items.forEach((it) => {
        const b = { x0: Math.min(it.x, it.x + it.w), x1: Math.max(it.x, it.x + it.w), y0: Math.min(it.y, it.y + it.h), y1: Math.max(it.y, it.y + it.h) };
        assert.ok(b.x1 > 0 && b.y1 > 0 && b.x0 < d.setup.w && b.y0 < d.setup.h, tpl.id + " " + lang + " element on the page");
      });
    });
  });
});

test("templates: Greek text keeps the English layout (no extra lines, words fit)", () => {
  TPL.list.forEach((tpl) => {
    const en = AX.fromTemplate(tpl, "en", 1), el = AX.fromTemplate(tpl, "el", 1);
    const texts = (d) => d.items.filter((it) => it.ax.k === "text" && !it.ax.cv).sort((a, b) => a.y - b.y || a.x - b.x);
    const A = texts(en), B = texts(el);
    assert.equal(A.length, B.length);
    A.forEach((a, i) => {
      const b = B[i];
      const la = AX.textLayout(a).lines.length, lb = AX.textLayout(b).lines.length;
      if (b.ax.size > a.ax.size * 0.61) assert.ok(lb <= la, `${tpl.id}: "${b.ax.tx}" ${lb} lines vs ${la}`);
      AX.textLayout(b).lines.forEach((ln) => ln.runs.forEach((r) => assert.ok(r.x + r.w <= b.w + 0.5, `${tpl.id}: "${r.t}" fits`)));
    });
  });
});

// ---------- strings ----------
test("i18n: every key the app uses exists in English and Greek", () => {
  const src = fs.readFileSync(path.join(ROOT, "atelier/core.js"), "utf8");
  const i = src.indexOf("  var STRINGS = {"), j = src.indexOf("\n  };\n", i);
  const STRINGS = new Function("return " + src.slice(i + "  var STRINGS = ".length, j + 4).replace(/;\s*$/, ""))();
  const en = Object.keys(STRINGS.en).sort(), el = Object.keys(STRINGS.el).sort();
  assert.deepEqual(el, en, "same keys in both languages");
  const used = new Set();
  ["core.js", "editor.js", "panels.js", "io.js", "draw.js"].forEach((f) => {
    const s = fs.readFileSync(path.join(ROOT, "atelier", f), "utf8");
    for (const m of s.matchAll(/\bt\("([a-zA-Z0-9.]+)"\s*[,)]/g)) used.add(m[1]);
  });
  const html = fs.readFileSync(path.join(ROOT, "atelier/index.html"), "utf8");
  for (const m of html.matchAll(/data-i18n="([a-zA-Z0-9.]+)"/g)) used.add(m[1]);
  // keys built at run time
  ["templates", "elements", "text", "uploads", "background", "colour", "effects", "filters", "adjust", "mask", "position"].forEach((k) => used.add("tab." + k));
  ["line", "arrow", "dashed"].forEach((k) => used.add("el." + k));
  ["heading", "sub", "body", "headingT", "subT", "bodyT", "neon", "outline", "curved", "shadow", "label"].forEach((k) => used.add("txt." + k));
  FX.ADJUST.forEach((a) => used.add("adj." + a.id));
  ["off", "dir", "blur", "alpha", "color", "thick", "pad", "round"].forEach((k) => used.add("fx." + k));
  ["front", "fwd", "bwd", "back", "al", "ac", "ar", "at", "am", "ab"].forEach((k) => used.add("pos." + k));
  ["none", "arrow", "dot"].forEach((k) => used.add("ctx.head." + k));
  ["png", "jpg", "pdf", "pngHint", "jpgHint", "pdfHint", "scale1", "scale2", "scale3", "dpi150", "dpi300", "all", "cur"].forEach((k) => used.add("exp." + k));
  ["px", "mm"].forEach((k) => used.add("custom." + k));
  const missing = [...used].filter((k) => !k.endsWith(".") && !(k in STRINGS.en));
  assert.deepEqual(missing, []);
});

// ---------- security ----------
test("no user text reaches innerHTML (only static icons or empty strings)", () => {
  ["core.js", "editor.js", "panels.js", "io.js", "draw.js"].forEach((f) => {
    const s = fs.readFileSync(path.join(ROOT, "atelier", f), "utf8");
    for (const m of s.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)) {
      const rhs = m[1].trim();
      const ok = rhs === '""' || /^icon\(/.test(rhs) || /^AT\.icon\(/.test(rhs) ||
        /^'<svg viewBox="0 0 24 24"[^']*' \+ \(ICONS\[name\] \|\| ""\) \+ "<\/svg>"$/.test(rhs);
      assert.ok(ok, f + ": innerHTML = " + rhs);
    }
    assert.ok(!/insertAdjacentHTML|outerHTML\s*=|document\.write|\beval\(|new Function/.test(s), f + ": no other HTML / code sinks");
  });
});
