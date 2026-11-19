// a11yfx.js: colour filters (daltonize matrices, smart invert), the
// large pointer and overlays; and its wiring in the shell, Quick
// settings and Settings › Accessibility.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const FX = require("../a11yfx.js");
const P = FX._;

// A tiny DOM, enough for apply()/mark()/overlay().
function fakeDoc() {
  function node(tag) {
    return {
      tagName: tag, id: "", children: [], attrs: {}, style: {
        _p: {}, setProperty(k, v) { this._p[k] = v; }, removeProperty(k) { delete this._p[k]; if (k === "filter") this.filter = ""; if (k === "transition") this.transition = ""; }
      },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; }, hasAttribute(k) { return k in this.attrs; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      querySelector(sel) {
        const m = /#(\S+) feColorMatrix/.exec(sel);
        const f = m && this.children.find((c) => c.id === m[1]);
        return f ? f.children[0] : null;
      }
    };
  }
  const html = node("html"), body = node("body");
  html.appendChild(body);
  return {
    documentElement: html, body,
    createElementNS: (ns, tag) => node(tag), createElement: (tag) => node(tag),
    getElementById(id) { return body.children.find((c) => c.id === id) || null; }
  };
}
function loadInPage(fine) {
  const doc = fakeDoc();
  const win = { document: doc, matchMedia: (q) => ({ matches: q === "(any-pointer: fine)" ? fine : false }) };
  win.window = win;
  const ctx = vm.createContext({ window: win, setTimeout, clearTimeout, Math, String, encodeURIComponent });
  vm.runInContext(read("a11yfx.js"), ctx);
  return { fx: win.orosA11yFx, doc };
}

// Distance in sRGB (0-1), as a stand-in for "can be told apart".
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// The screen clamps every channel to 0-1.
const clamp = (v) => v.map((x) => Math.min(1, Math.max(0, x)));
const on = (m, c) => clamp(P.apply3(m, c));
const RED = [0.84, 0.16, 0.16], GREEN = [0.16, 0.62, 0.24], ORANGE = [0.9, 0.5, 0.1], LIME = [0.5, 0.7, 0.1];
const BLUE = [0.11, 0.44, 0.82], YELLOW = [0.95, 0.9, 0.2], PINK = [0.9, 0.7, 0.8];

test("each correction moves the colours it confuses apart for the eyes it is for", () => {
  const pairs = { protan: [[RED, GREEN], [ORANGE, LIME]], deutan: [[RED, GREEN], [ORANGE, LIME]],
                  tritan: [[BLUE, GREEN], [YELLOW, PINK]] };
  for (const k of ["protan", "deutan", "tritan"]) {
    const S = P.SIM[k], D = P.matrix3(k, 100);
    for (const [a, b] of pairs[k]) {
      const before = dist(on(S, a), on(S, b));
      const after = dist(on(S, on(D, a)), on(S, on(D, b)));
      assert.ok(after > before * 1.3, k + ": " + before.toFixed(3) + " → " + after.toFixed(3));
    }
  }
});

test("corrections keep grey grey enough and strength mixes with identity", () => {
  for (const k of ["protan", "deutan", "tritan"]) {
    const g = P.apply3(P.matrix3(k, 100), [0.5, 0.5, 0.5]);
    g.forEach((v) => assert.ok(Math.abs(v - 0.5) < 0.12, k + " grey " + v));
    const half = P.matrix3(k, 50), full = P.matrix3(k, 100);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const id = i === j ? 1 : 0;
      assert.ok(Math.abs(half[i][j] - (id + (full[i][j] - id) / 2)) < 1e-9);
    }
  }
  assert.deepEqual(P.matrix3("grey", 100), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  const v = P.matrixValues("deutan", 100).split(" ");
  assert.equal(v.length, 20);
  assert.deepEqual(v.slice(15), ["0", "0", "0", "1", "0"]);           // alpha untouched
  v.forEach((x) => assert.ok(Number.isFinite(Number(x))));
});

test("filter strings: own filter first, overlays after, unknown values off", () => {
  assert.equal(P.filterCss({ filter: "off" }, []), "");
  assert.equal(P.filterCss({ filter: "grey", strength: 50 }, []), "grayscale(0.5)");
  assert.equal(P.filterCss({ filter: "invert", strength: 25 }, []), "invert(1) hue-rotate(180deg)");
  assert.equal(P.filterCss({ filter: "protan" }, []), "url(#oros-cf-protan)");
  assert.equal(P.filterCss({ filter: "tritan" }, [{ name: "bedtime", kind: "grey" }]), "url(#oros-cf-tritan) grayscale(1)");
  assert.equal(P.filterCss({ filter: "off" }, [{ name: "bedtime", kind: "grey" }]), "grayscale(1)");
  assert.equal(P.filterCss({ filter: "evil);x" }, [{ kind: "blur" }]), "");
  assert.equal(P.cleanStrength(30), 100);
  assert.equal(P.cleanPointer("huge"), "normal");
});

test("smart invert turns pictures back; pointer CSS only under the attribute", () => {
  const inv = P.invertCss();
  for (const s of ["img", "video", "canvas"]) assert.match(inv, new RegExp("html\\[data-oros-invert\\] " + s + "\\b"));
  assert.match(inv, /invert\(1\) hue-rotate\(180deg\)/);
  const pc = P.pointerCss();
  pc.split("\n").filter(Boolean).forEach((line) => {
    const sel = line.slice(0, line.indexOf("{"));
    sel.split(",").forEach((s) => assert.match(s.trim(), /^html\[data-oros-pointer="(large|xl)"\]/, s));
  });
  assert.match(P.cursorUrl("arrow", 48), /^url\("data:image\/svg\+xml,.+"\) 6 3$/);
  assert.match(P.cursorUrl("hand", 32), /width%3D%2232%22/);
  assert.ok(!/[<>]/.test(P.pointerCss()), "cursor SVGs are URL-encoded");
});

test("apply paints the shell root, marks documents and overlays never store", () => {
  const { fx, doc } = loadInPage(true);
  const r = doc.documentElement;
  fx.apply({ filter: "deutan", strength: 75, pointer: "xl" });
  assert.equal(r.style.filter, "url(#oros-cf-deutan)");
  const svg = doc.getElementById("oros-cf-svg");
  assert.ok(svg);
  const m = svg.children.find((c) => c.id === "oros-cf-deutan").children[0];
  assert.equal(m.attrs.values, P.matrixValues("deutan", 75));
  assert.equal(r.getAttribute("data-oros-pointer"), "xl");
  assert.equal(r.getAttribute("data-oros-invert"), null);
  assert.equal(fx.overlay("bedtime", "grey", { fadeMs: 2000 }), true);
  assert.equal(r.style.filter, "url(#oros-cf-deutan) grayscale(1)");
  assert.equal(r.style.transition, "filter 2000ms linear");
  assert.equal(fx.overlay("bedtime", "sepia"), false);
  assert.equal(JSON.stringify(fx.overlays()), '["bedtime:grey"]');
  fx.apply({ filter: "invert" });                                  // the person's change keeps the overlay
  assert.equal(r.style.filter, "invert(1) hue-rotate(180deg) grayscale(1)");
  assert.equal(r.getAttribute("data-oros-invert"), "on");
  assert.equal(r.getAttribute("data-oros-pointer"), null);
  fx.overlay("bedtime", null);
  assert.equal(r.style.filter, "invert(1) hue-rotate(180deg)");
  fx.apply({ filter: "off" });
  assert.equal(r.style.filter, "");
  assert.equal(r.getAttribute("data-oros-invert"), null);
});

test("no large pointer without a mouse", () => {
  const { fx, doc } = loadInPage(false);
  fx.apply({ filter: "off", pointer: "large" });
  assert.equal(doc.documentElement.getAttribute("data-oros-pointer"), null);
  assert.equal(fx.finePointer(), false);
});

test("shell: oros-a11y fields, setters, snapshot, overlay API, script order", () => {
  const s = read("shell.js");
  assert.match(s, /filter: A11Y_FILTERS\.indexOf\(v\.filter\) !== -1 \? v\.filter : "off"/);
  assert.match(s, /pointer: A11Y_POINTERS\.indexOf\(v\.pointer\) !== -1 \? v\.pointer : "normal"/);
  assert.match(s, /if \(value === "toggle"\) value = a11y\.filter === "off" \? a11y\.last : "off";/);
  assert.match(s, /case "colourFilter":\s+case "filterStrength":\s+case "pointerSize":\s+(?:case "\w+":\s+)*a11ySetUser\(name, value\); return;/);
  assert.match(s, /var css = A11Y_CSS \+ \(window\.orosA11yFx \? window\.orosA11yFx\.css\(\) : ""\);\s+if \(s\.textContent !== css\) s\.textContent = css;/);
  assert.match(s, /window\.orosA11y = \{\s+overlayFilter: function/);
  // Loaded on demand only (start-up script budget): never a <script> in index.html.
  assert.ok(!read("index.html").includes("a11yfx.js"));
  assert.match(s, /sc\.src = "a11yfx\.js\?v=" \+ APP_VERSION;/);
  assert.match(s, /if \(!window\.orosA11yFx && a11yFxWanted\(\)\) a11yFxLoad\(\)\.then\(a11yApply, function \(\) \{\}\);/);
});

test("Quick settings and Settings wiring, strings in EN, EL and DE", () => {
  const q = read("qsettings.js");
  assert.match(q, /host\.a11y\.set\("colourFilter", "toggle"\)/);
  assert.match(q, /parts\.filter\.box\.hidden = !a\.fx;/);
  const st = read("settings/settings.js");
  assert.match(st, /set\("colourFilter", v\)/);
  assert.match(st, /set\("pointerSize", v\)/);
  assert.match(st, /if \(a\.fine\) \{/);
  const core = require("../settings/core.js");
  assert.ok(core.findItem("colourfilter") && core.findItem("pointer"));
  const keys = ["ac.filter", "ac.filter.pick", "ac.filter.off", "ac.filter.grey", "ac.filter.protan", "ac.filter.deutan",
    "ac.filter.tritan", "ac.filter.invert", "ac.filter.strength", "ac.filter.sample", "ac.filter.hint",
    "ac.pointer", "ac.pointer.normal", "ac.pointer.large", "ac.pointer.xl", "ac.pointer.hint", "w.colourfilter", "w.pointer"];
  const de = read("i18n/de/settings.js"), cs = read("settings/core.js");
  for (const k of keys) {
    assert.equal(cs.split('"' + k + '":').length - 1, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
  const tr = read("translations.js"), ds = read("i18n/de/shell.js");
  for (const k of ["qs.filter", "qs.filter.more", "qs.filter.grey", "qs.filter.protan", "qs.filter.deutan", "qs.filter.tritan", "qs.filter.invert"]) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, k + " EN + EL");
    assert.ok(ds.includes('"' + k + '":'), k + " DE");
  }
});
