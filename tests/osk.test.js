// On-screen keyboard (osk.js): layouts, Greek accents, which devices
// get it and how, prefs, and the shell/Settings wiring.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const O = require(path.join(ROOT, "osk.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const chars = (rows) => rows.map((r) => r.map((k) => k.k === "ch" ? k.v : k.k === "dead" ? "#" + k.v : "[" + k.k + "]").join(" "));

const UA = {
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  tablet: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  cros: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
};

test("letter rows: English, Greek and German", () => {
  assert.deepEqual(chars(O.keyRows("en", "abc", 0)).slice(0, 3), [
    "q w e r t y u i o p", "a s d f g h j k l", "[shift] z x c v b n m [back]"]);
  assert.deepEqual(chars(O.keyRows("el", "abc", 0)).slice(0, 3), [
    "; ς ε ρ τ υ θ ι ο π", "α σ δ φ γ η ξ κ λ #tonos", "[shift] ζ χ ψ ω β ν μ [back]"]);
  assert.deepEqual(chars(O.keyRows("de", "abc", 0)).slice(0, 3), [
    "q w e r t z u i o p ü", "a s d f g h j k l ö ä", "[shift] y x c v b n m ß [back]"]);
  assert.equal(chars(O.keyRows("en", "abc", 0))[3], "[sym] [lang] , [space] . [left] [right] [enter] [hide]");
});

test("shift: capitals, ς becomes Σ, ; becomes :, the accent key becomes the diaeresis", () => {
  assert.equal(chars(O.keyRows("el", "abc", 1))[0], ": Σ Ε Ρ Τ Υ Θ Ι Ο Π");
  assert.equal(chars(O.keyRows("el", "abc", 2))[1], "Α Σ Δ Φ Γ Η Ξ Κ Λ #dia");
  assert.equal(chars(O.keyRows("de", "abc", 1))[2], "[shift] Y X C V B N M ß [back]");
  assert.equal(O.shiftChar("ü"), "Ü");
});

test("symbol pages switch to each other and back to letters", () => {
  const sym = O.keyRows("en", "sym", 0), more = O.keyRows("en", "more", 0);
  assert.equal(chars(sym)[0], "1 2 3 4 5 6 7 8 9 0");
  assert.equal(sym[2][0].k, "more");
  assert.equal(more[2][0].k, "sym");
  assert.equal(sym[3][0].k, "abc");
  assert.equal(more[3][0].k, "abc");
  // Shift does not touch symbols.
  assert.deepEqual(chars(O.keyRows("en", "sym", 1)), chars(sym));
  // Every page has the same bottom row size, so nothing jumps.
  for (const id of O.LAYOUT_IDS) for (const l of ["abc", "sym", "more"]) assert.equal(O.keyRows(id, l, 0).length, 4);
});

test("Greek accents: tonos, diaeresis, both, and a dead key before other keys", () => {
  assert.equal(O.combine("tonos", "α"), "ά");
  assert.equal(O.combine("tonos", "Ω"), "Ώ");
  assert.equal(O.combine("tonos", "ϊ"), "ΐ");
  assert.equal(O.combine("dia", "ι"), "ϊ");
  assert.equal(O.combine("dia", "Υ"), "Ϋ");
  assert.equal(O.combine("dia", "ύ"), "ΰ");
  assert.equal(O.combine("tonos", " "), "΄");
  assert.equal(O.combine("tonos", "κ"), "΄κ");
  for (const [k, v] of Object.entries({ α: "ά", ε: "έ", η: "ή", ι: "ί", ο: "ό", υ: "ύ", ω: "ώ" })) {
    assert.equal(O.combine("tonos", k), v);
    assert.equal(v.normalize("NFD")[0], k);
  }
});

test("never on phones; touch Linux and the USB kiosk open it by themselves; others from the button", () => {
  const env = (o) => Object.assign({ ua: UA.linux, coarse: false, anyCoarse: false, touchPoints: 0, screenMin: 1080, kiosk: false }, o);
  assert.equal(O.isPhone(env({ ua: UA.android, coarse: true, anyCoarse: true, touchPoints: 5, screenMin: 412 })), true);
  assert.equal(O.isPhone(env({ ua: UA.iphone })), true);
  assert.equal(O.isPhone(env({ mobile: true })), true);
  assert.equal(O.isPhone(env({ ua: UA.linux, coarse: true, anyCoarse: true, touchPoints: 10, screenMin: 400 })), true);
  assert.equal(O.isPhone(env({ ua: UA.tablet, coarse: true, anyCoarse: true, touchPoints: 10, screenMin: 800 })), false);
  assert.equal(O.defaultMode(env({ ua: UA.android, coarse: true, anyCoarse: true, touchPoints: 5, screenMin: 412 })), "off");

  assert.equal(O.defaultMode(env({ kiosk: true })), "auto");                       // orOS USB, even before a touch
  assert.equal(O.defaultMode(env({ anyCoarse: true, touchPoints: 10 })), "auto");  // touch laptop on Linux
  assert.equal(O.defaultMode(env({ ua: UA.win, anyCoarse: true, touchPoints: 10 })), "button");
  assert.equal(O.defaultMode(env({ ua: UA.cros, anyCoarse: true, touchPoints: 10 })), "button");
  assert.equal(O.defaultMode(env({ ua: UA.tablet, coarse: true, anyCoarse: true, touchPoints: 10, screenMin: 800 })), "button");
  assert.equal(O.defaultMode(env({})), "off");                                       // a PC with no touch screen
  assert.equal(O.defaultMode(env({ ua: UA.win })), "off");

  // A stored choice wins, except on a phone.
  assert.equal(O.modeOf({ mode: "button" }, env({})), "button");
  assert.equal(O.modeOf({ mode: "auto" }, env({ ua: UA.android, coarse: true, screenMin: 412 })), "off");
  assert.equal(O.modeOf({ mode: "nope" }, env({ kiosk: true })), "auto");
});

test("prefs: only known values survive; layouts keep their order; one stays on", () => {
  assert.deepEqual(O.normPrefs(null), { v: 1 });
  assert.deepEqual(O.normPrefs({ mode: "x", layouts: ["fr", "de", "en", "de"], last: "fr", junk: 1 }), { v: 1, layouts: ["en", "de"] });
  assert.deepEqual(O.normPrefs({ mode: "off", layouts: [], last: "el" }), { v: 1, mode: "off", last: "el" });

  assert.deepEqual(O.defaultLayouts("el"), ["en", "el"]);
  assert.deepEqual(O.defaultLayouts("de"), ["en", "de"]);
  assert.deepEqual(O.layoutsOf({ v: 1 }, "en"), ["en", "el"]);

  let p = O.withLayout({ v: 1 }, "el", "de", true);
  assert.deepEqual(p.layouts, ["en", "el", "de"]);
  p = O.withLayout(p, "el", "en", false);
  assert.deepEqual(p.layouts, ["el", "de"]);
  p = O.withLayout(p, "el", "el", false);
  p = O.withLayout(p, "el", "de", false);                 // the last one stays
  assert.deepEqual(p.layouts, ["de"]);
  assert.deepEqual(O.withLayout({ v: 1, layouts: ["el"], last: "el" }, "el", "en", true), { v: 1, layouts: ["en", "el"], last: "el" });
  assert.deepEqual(O.withLayout({ v: 1, layouts: ["en", "el"], last: "el" }, "el", "el", false), { v: 1, layouts: ["en"] });
  assert.deepEqual(O.withLayout({ v: 1 }, "el", "fr", true), { v: 1 });
});

test("start layout: the last one picked, else the orOS language, else the first; the key goes round", () => {
  assert.equal(O.startLayout({ v: 1 }, "el"), "el");
  assert.equal(O.startLayout({ v: 1 }, "en"), "en");
  assert.equal(O.startLayout({ v: 1, last: "el" }, "en"), "el");
  assert.equal(O.startLayout({ v: 1, layouts: ["de"], last: "el" }, "el"), "de");
  assert.equal(O.nextLayout(["en", "el", "de"], "en"), "el");
  assert.equal(O.nextLayout(["en", "el", "de"], "de"), "en");
  assert.equal(O.nextLayout(["en"], "en"), "en");
  assert.equal(O.nextLayout(["en", "el"], "de"), "en");
});

test("which elements take text", () => {
  const input = (type, o) => Object.assign({ tagName: "INPUT", getAttribute: (n) => n === "type" ? type : null }, o);
  for (const t of [null, "", "text", "search", "url", "email", "tel", "password", "number", "TEXT"]) assert.equal(O.editable(input(t)), true, String(t));
  for (const t of ["checkbox", "radio", "range", "color", "file", "date", "button", "submit"]) assert.equal(O.editable(input(t)), false, t);
  assert.equal(O.editable(input("text", { disabled: true })), false);
  assert.equal(O.editable(input("text", { readOnly: true })), false);
  assert.equal(O.editable({ tagName: "TEXTAREA" }), true);
  assert.equal(O.editable({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(O.editable({ tagName: "DIV" }), false);
  assert.equal(O.editable(null), false);
});

test("strings: every osk.* key in EN, EL and German; Settings strings in all three", () => {
  const tr = read("translations.js");
  const keys = [...new Set([...read("osk.js").matchAll(/tr\("([a-zA-Z]+)"/g)].map((m) => "osk." + m[1]))];
  const all = keys.concat(["osk.tonos", "osk.dia", "osk.caps", "osk.shift"]);   // through tr(key.v) and tr(st.shift …)
  const en = tr.slice(tr.indexOf("  en: {"), tr.indexOf("  el: {")), el = tr.slice(tr.indexOf("  el: {"));
  const de = read("i18n/de/shell.js");
  for (const k of all) {
    assert.ok(en.includes('"' + k + '":'), "EN " + k);
    assert.ok(el.includes('"' + k + '":'), "EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  }
  const core = read("settings/core.js"), sde = read("i18n/de/settings.js");
  for (const k of ["o.title", "o.mode", "o.mode.auto", "o.mode.button", "o.mode.off", "o.hint.auto", "o.hint.button", "o.hint.off", "o.notouch", "o.layouts", "o.layouts.hint"]) {
    assert.equal(core.split('"' + k + '":').length, 3, "settings EN+EL " + k);
    assert.ok(sde.includes('"' + k + '":'), "settings DE " + k);
  }
});

test("wiring: the shell loads it before shell.js, attaches it, and Settings reads and sets it", () => {
  const html = read("index.html"), sh = read("shell.js");
  assert.ok(html.indexOf('src="osk.js') > 0 && html.indexOf('src="osk.js') < html.indexOf('src="shell.js'));
  assert.match(sh, /window\.orosOsk\.attach\(/);
  assert.match(sh, /osk: settingsOsk\(\)/);
  assert.match(sh, /\/\^osk:\/\.test\(name\)/);
  assert.match(read("settings/settings.js"), /if \(s\.osk\) secOsk\(host, s\.osk\)/);
  assert.match(read("settings/core.js"), /osk: "device"/);
  // The keyboard's own key events are never taken for a real keyboard.
  assert.match(read("osk.js"), /if \(!e\.isTrusted\) return;/);
  // Labels are text; only the fixed icons go through innerHTML.
  const inner = read("osk.js").match(/\.innerHTML = [^;]+;/g) || [];
  for (const s of inner) assert.match(s, /= (lab\.svg|SVG\.kbd)/);
});
