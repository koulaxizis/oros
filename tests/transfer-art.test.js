// orOS Transfer: generated artwork (transfer/art.js, TRANSFER-ART) and
// the landing page transfer/about/ (TRANSFER-LAND, wave D2).
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

const ROOT = path.join(__dirname, "..");
const A = require("../transfer/art.js");
const C = require("../transfer/core.js");

test("art: same seed, accent and size give the same picture", () => {
  for (const style of A.STYLES) {
    const a = A.toString(A.draw(12345, { style, accent: "#d4af37", w: 640, h: 400 }));
    const b = A.toString(A.draw(12345, { style, accent: "#d4af37", w: 640, h: 400 }));
    assert.strictEqual(a, b, style);
    const c = A.toString(A.draw(12346, { style, accent: "#d4af37", w: 640, h: 400 }));
    assert.notStrictEqual(a, c, style + ": another seed draws another picture");
    assert.ok(a.startsWith("<svg ") && a.endsWith("</svg>"), style);
    assert.ok(a.length < 200000, style + " size " + a.length);
  }
});

test("art: the style comes from the seed unless asked, all four occur", () => {
  const seen = new Set();
  for (let s = 0; s < 40; s++) { const st = A.draw(s, { w: 100, h: 100 }).style; assert.strictEqual(st, A.pickStyle(s)); seen.add(st); }
  assert.deepStrictEqual([...seen].sort(), [...A.STYLES].sort());
  assert.strictEqual(A.draw(1, { style: "nope", w: 100, h: 100 }).style, A.pickStyle(1));
});

test("art: the hue follows the skin accent; bad input falls back to orOS gold", () => {
  assert.deepStrictEqual(A.hexHsl("#d4af37"), A.hexHsl("not a colour"));
  assert.strictEqual(A.hexHsl("#3584e4")[0], 213);
  const gold = A.toString(A.draw(7, { style: "dunes", accent: "#d4af37", w: 300, h: 200 }));
  const blue = A.toString(A.draw(7, { style: "dunes", accent: "#3584e4", w: 300, h: 200 }));
  assert.notStrictEqual(gold, blue);
  const light = A.toString(A.draw(7, { style: "dunes", accent: "#d4af37", w: 300, h: 200, light: true }));
  assert.notStrictEqual(gold, light);
});

test("art: sizes are clamped, numbers are finite, nothing unescaped", () => {
  const art = A.draw(99, { style: "prism", w: 1e9, h: -5 });
  assert.strictEqual(art.w, 4096); assert.strictEqual(art.h, 16);
  for (const style of A.STYLES) {
    const s = A.toString(A.draw(3, { style, w: 360, h: 780 }));
    assert.ok(!/NaN|Infinity|undefined/.test(s), style);
    assert.ok(!/<script|on\w+=/i.test(s), style);
  }
  assert.strictEqual(A.rng(0)(), A.rng(0)());
  const r = A.rng(42); for (let i = 0; i < 1000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); }
});

test("art: the seed from a secret is stable and 32 bits", async () => {
  const a = await A.seedFrom("K7QM2XPA9DRT", webcrypto.subtle);
  const b = await A.seedFrom("K7QM2XPA9DRT", webcrypto.subtle);
  const c = await A.seedFrom("K7QM2XPA9DRU", webcrypto.subtle);
  assert.strictEqual(a, b); assert.notStrictEqual(a, c);
  assert.ok(Number.isInteger(a) && a >= 0 && a < 2 ** 32);
});

// ---------- landing page ----------
const PAGE = fs.readFileSync(path.join(ROOT, "transfer/about/index.html"), "utf8");
const JS = fs.readFileSync(path.join(ROOT, "transfer/about/about.js"), "utf8");
const HEAD = PAGE.slice(0, PAGE.indexOf("</head>"));
const URL = "https://useoros.online/transfer/about/";
const IMG = URL + "og-image.png";

test("landing: CSP first, canonical and link preview with its own 1200x630 image", () => {
  assert.ok(/^<!DOCTYPE html>\s*<html lang="en">\s*<head>\s*<meta charset="utf-8">\s*<meta http-equiv="Content-Security-Policy"/.test(PAGE));
  assert.ok(HEAD.includes('<link rel="canonical" href="' + URL + '">'));
  assert.ok(HEAD.includes('<meta property="og:url" content="' + URL + '">'));
  assert.ok(HEAD.includes('<meta property="og:image" content="' + IMG + '">'));
  assert.ok(HEAD.includes('<meta name="twitter:image" content="' + IMG + '">'));
  assert.ok(HEAD.includes('<meta name="twitter:card" content="summary_large_image">'));
  const png = fs.readFileSync(path.join(ROOT, "transfer/about/og-image.png"));
  assert.strictEqual(png.toString("ascii", 1, 4), "PNG");
  assert.strictEqual(png.readUInt32BE(16), 1200);
  assert.strictEqual(png.readUInt32BE(20), 630);
  assert.ok(png.length < 1024 * 1024);
});

test("landing: three languages, each with the credit line, no outside scripts, no sign-up", () => {
  for (const l of ["en", "el", "de"]) {
    const m = new RegExp('<article lang="' + l + '" id="' + l + '"[^>]*>([\\s\\S]*?)</article>').exec(PAGE);
    assert.ok(m, l);
    assert.ok(m[1].includes("Designed with &lt;3 by Christos Koulaxizis (koulaxizis.gr). Assisted by Lumo. Audited by Claude."), l + " credit");
    assert.ok(m[1].includes('href="/?open=transfer"'), l + " start link");
    assert.ok(/<form class="codein" data-code>/.test(m[1]), l + " code box");
  }
  const scripts = [...PAGE.matchAll(/<script\b([^>]*)>/g)].map((x) => x[1]);
  assert.deepStrictEqual(scripts, [' src="../art.js"', ' src="about.js"'], "only local scripts, no inline script");
  assert.ok(!/<link rel="(stylesheet|preload|preconnect)"[^>]+href="https?:/i.test(PAGE), "no outside stylesheet or font");
  assert.ok(!/newsletter|mailerlite|subscribe|googleapis|gstatic/i.test(PAGE + JS));
  assert.ok(!/\binnerHTML\b|\bfetch\(|XMLHttpRequest/.test(JS), "the page script builds nodes and makes no request");
});

test("landing: the code box accepts what the receive page accepts", () => {
  assert.ok(JS.includes("/^[0-9A-HJKMNP-TV-Z]{12}$/"), "same code alphabet as core.js");
  assert.strictEqual(String(C.CODE_RE), "/^[0-9A-HJKMNP-TV-Z]{12}$/");
  // what the landing page sends on is what the receive page reads back
  assert.strictEqual(C.normCode("K7QM-2XPA-9DRT"), "K7QM2XPA9DRT");
  assert.ok(JS.includes('"../receive.html#"'));
});
