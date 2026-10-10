// Password Generator engine (passwords/pwcore.js): fair randomness,
// exact entropy, Diceware lists and dice lookup, and the strength
// auditor. Run: node --test tests/
//
// pwcore.js and the data files are UMD-style: in Node they export
// through module.exports, in the app they set window globals.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "passwords");
const P = require(path.join(DIR, "pwcore.js"));
const WORDS = require(path.join(DIR, "words-eff.js"));
const COMMON = require(path.join(DIR, "common.js"));
P.setLists(WORDS);
P.setCommon(COMMON);

const ALL = { length: 20, lower: 1, upper: 1, digits: 1, symbols: 1 };

// Chi-square goodness of fit for n uniform bins. With n - 1 degrees of
// freedom the 99.99th percentile is below df + 6·sqrt(2·df) + 20.
function chiSquareOk(counts, total) {
  const n = counts.length, exp = total / n;
  let x2 = 0;
  counts.forEach((c) => { x2 += (c - exp) * (c - exp) / exp; });
  const df = n - 1;
  return { ok: x2 < df + 6 * Math.sqrt(2 * df) + 20, x2, df };
}

test("randBelow: in range, uniform for sizes that are not powers of two", () => {
  [62, 94, 7776].forEach((n) => {
    const draws = n === 7776 ? 400000 : 100000;
    const counts = new Array(n).fill(0);
    for (let i = 0; i < draws; i++) {
      const v = P.randBelow(n);
      assert.ok(Number.isInteger(v) && v >= 0 && v < n);
      counts[v]++;
    }
    const r = chiSquareOk(counts, draws);
    assert.ok(r.ok, `n=${n} chi2=${r.x2.toFixed(1)} df=${r.df}`);
  });
  assert.equal(P.randBelow(1), 0);
  assert.throws(() => P.randBelow(0));
  assert.throws(() => P.randBelow(2.5));
});

test("no Math.random anywhere in the app", () => {
  ["pwcore.js", "passwords.js"].forEach((f) => {
    const src = fs.readFileSync(path.join(DIR, f), "utf8")
      .replace(/\/\/.*$/gm, "");          // comments may mention it
    assert.ok(!/Math\.random/.test(src), f);
  });
});

test("passwords: length, chosen sets present, excluded sets absent", () => {
  for (let i = 0; i < 300; i++) {
    const p = P.genPassword(ALL).value;
    assert.equal(p.length, 20);
    assert.ok(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^a-zA-Z0-9]/.test(p), p);
  }
  for (let i = 0; i < 200; i++) {
    const p = P.genPassword({ length: 12, lower: 1, digits: 1 }).value;
    assert.ok(/^[a-z0-9]{12}$/.test(p), p);
    assert.ok(/[a-z]/.test(p) && /[0-9]/.test(p), p);
  }
  for (let i = 0; i < 200; i++) {
    const p = P.genPassword({ length: 30, lower: 1, upper: 1, digits: 1, symbols: 1, noAmbig: 1 }).value;
    for (const c of P.AMBIG) assert.ok(!p.includes(c), p);
  }
  for (let i = 0; i < 200; i++) {
    const p = P.genPassword({ length: 16, lower: 1, symbols: 1, custom: "!@#" }).value;
    assert.ok(/^[a-z!@#]+$/.test(p), p);
  }
  assert.throws(() => P.genPassword({ length: 10 }), /no-sets/);
  // Length is clamped to 4–128.
  assert.equal(P.genPassword({ length: 1, lower: 1 }).value.length, P.LEN_MIN);
  assert.equal(P.genPassword({ length: 999, lower: 1 }).value.length, P.LEN_MAX);
  // Every character of a 4-set, length-4 password is from a different set.
  for (let i = 0; i < 50; i++) {
    const p = P.genPassword({ length: 4, lower: 1, upper: 1, digits: 1, symbols: 1 }).value;
    assert.ok(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^a-zA-Z0-9]/.test(p), p);
  }
});

test("custom symbols: only ASCII punctuation, no duplicates", () => {
  assert.equal(P.normSymbols("abc!!@ é#"), "!@#");
  assert.equal(P.normSymbols(null), "");
  assert.equal(P.SYMBOLS.length, 32);
});

test("exact entropy", () => {
  // Inclusion-exclusion, checked by brute force on a tiny case:
  // length 3 over {a,b} ∪ {0}: strings with at least one letter and one digit.
  let n = 0;
  for (const a of "ab0") for (const b of "ab0") for (const c of "ab0") {
    const s = a + b + c;
    if (/[ab]/.test(s) && /0/.test(s)) n++;
  }
  assert.equal(P.countValid([2, 1], 3), BigInt(n));
  // 20 chars from 94, minus the strings missing a set: just under 20·log2(94).
  const bits = P.passwordBits(ALL);
  assert.ok(bits > 130.8 && bits < 20 * Math.log2(94), bits);
  // One set: exactly L·log2(size).
  assert.ok(Math.abs(P.passwordBits({ length: 16, lower: 1 }) - 16 * Math.log2(26)) < 1e-9);
  assert.ok(Math.abs(P.genPin(6).bits - 6 * Math.log2(10)) < 1e-9);
  assert.ok(Math.abs(P.log2Big(2n ** 200n) - 200) < 1e-9);
});

test("PIN: digits only, clamped length", () => {
  for (let i = 0; i < 100; i++) assert.ok(/^[0-9]{6}$/.test(P.genPin(6).value));
  assert.equal(P.genPin(1).value.length, P.PIN_MIN);
  assert.equal(P.genPin(50).value.length, P.PIN_MAX);
});

test("EFF lists: exact sizes, unique, lowercase", () => {
  const large = P.list("large"), short = P.list("short");
  assert.equal(large.length, 7776);
  assert.equal(short.length, 1296);
  assert.equal(new Set(large).size, 7776);
  assert.equal(new Set(short).size, 1296);
  [large, short].forEach((l) => l.forEach((w) => assert.ok(/^[a-z]+(-[a-z]+)?$/.test(w), w)));
  assert.equal(large[0], "abacus");
  assert.equal(large[7775], "zoom");
});

test("Diceware passphrases: word count, separators, exact bits", () => {
  const large = new Set(P.list("large"));
  const r = P.genPassphrase({ list: "large", words: 6, sep: "space" });
  assert.equal(r.words.length, 6);
  r.words.forEach((w) => assert.ok(large.has(w), w));
  assert.equal(r.value, r.words.join(" "));
  assert.ok(Math.abs(r.bits - 77.548875) < 1e-5, r.bits);    // 6 × log2(7776)

  const s = P.genPassphrase({ list: "short", words: 5, sep: "dash", caps: 1 });
  assert.ok(Math.abs(s.bits - 5 * Math.log2(1296)) < 1e-9);
  // Compare the whole value: short-list words can contain "-" ("yo-yo").
  assert.equal(s.value, s.words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("-"));

  for (let i = 0; i < 50; i++) {
    const e = P.genPassphrase({ list: "large", words: 4, sep: "dot", extra: 1 });
    assert.ok(Math.abs(e.bits - (4 * Math.log2(7776) + Math.log2(P.EXTRA.length * 4))) < 1e-9);
    const parts = e.value.split(".");
    const withExtra = parts.filter((w, k) => w !== e.words[k]);
    assert.equal(withExtra.length, 1, e.value);
    assert.ok(P.EXTRA.includes(withExtra[0].slice(-1)), e.value);
  }
  // Out-of-range word counts are clamped, unknown separators fall back to a space.
  assert.equal(P.genPassphrase({ words: 1 }).words.length, P.WORDS_MIN);
  assert.equal(P.genPassphrase({ words: 40 }).words.length, P.WORDS_MAX);
  assert.equal(P.genPassphrase({ words: 3, sep: "<b>" }).value.split(" ").length >= 3, true);
});

test("real dice: codes map to the right words, bad codes are refused", () => {
  assert.equal(P.diceWord("11111", "large"), "abacus");
  assert.equal(P.diceWord("11112", "large"), "abdomen");
  assert.equal(P.diceWord("66666", "large"), "zoom");
  assert.equal(P.diceWord(" 1111 ", "short"), "acid");
  assert.equal(P.diceWord("6666", "short"), P.list("short")[1295]);
  ["", "1111", "111111", "71111", "01111", "1a111", null].forEach((c) => {
    assert.equal(P.diceWord(c, "large"), null, String(c));
  });
  assert.equal(P.diceWord("11111", "short"), null);
});

test("auditor: weak passwords score 0–1 with the right findings", () => {
  const cases = {
    "password": "common", "123456": "common", "P@ssw0rd1": "common", "qwerty123": "common",
    "19871987": "repeat", "ςερτυθιοπ": "keyboard", "lmnopqrs": "sequence",
    "aaaaaaaaaaaa": "repeat", "12/05/1990": "date", "poiuytlkjhg": "keyboard", "1qaz2wsx3edc": "keyboard"
  };
  Object.keys(cases).forEach((pw) => {
    const a = P.audit(pw);
    assert.ok(a.score <= 1, `${pw}: score ${a.score}, ${a.bits.toFixed(1)} bits`);
    assert.ok(a.findings.includes(cases[pw]), `${pw}: ${a.findings}`);
  });
  assert.equal(P.audit("password").score, 0);
  assert.equal(P.audit("password").times.fast.unit, "instant");
  assert.ok(P.audit("Chris1987!").findings.includes("date"));
});

test("auditor: generated passwords and 6-word phrases score 4", () => {
  for (let i = 0; i < 40; i++) {
    const p = P.genPassword(ALL).value;
    assert.equal(P.audit(p).score, 4, p);
  }
  assert.equal(P.audit("abacus shrank zipper mumble canyon dwelling").score, 4);
  // Random phrases: the estimate sits near the exact 77.5 bits; with very
  // short words it can dip toward the 70-bit line, so allow "strong" too.
  for (let i = 0; i < 40; i++) {
    const p = P.genPassphrase({ list: "large", words: 6, sep: "space" }).value;
    const a = P.audit(p);
    assert.ok(a.score >= 3 && a.bits >= 60, `${p}: ${a.bits.toFixed(1)}`);
    assert.ok(a.findings.includes("word"), p);
    // the estimate never claims more than the brute-force bound
    assert.ok(a.bits <= p.length * Math.log2(26 + 33) + 1, p);
  }
});

test("auditor: empty input, long input, odd input", () => {
  assert.equal(P.audit(""), null);
  assert.equal(P.audit(null), null);
  const t0 = Date.now();
  const long = P.audit("a".repeat(1000));
  assert.equal(long.length, 256);
  assert.ok(long.score === 0, long.bits);
  assert.ok(Date.now() - t0 < 5000);
  const odd = P.audit("<img src=x onerror=alert(1)>🙂");
  assert.ok(odd.bits > 0 && Array.isArray(odd.findings));
});

test("time formatting", () => {
  assert.deepEqual(P.humanTime(0.2), { unit: "instant", n: 0 });
  assert.deepEqual(P.humanTime(45), { unit: "seconds", n: 45 });
  assert.deepEqual(P.humanTime(3600 * 5), { unit: "hours", n: 5 });
  assert.equal(P.humanTime(86400 * 365.25 * 500).unit, "centuries");
  assert.equal(P.scoreOf(24.9), 0);
  assert.equal(P.scoreOf(70), 4);
});
