// Text replacements (textrepl.js, TEXTREPL-1): the model (codes, limits,
// merge, matching at a delimiter, placeholders, the fields that are
// never touched) and the wiring in the shell, Settings and the strings.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const R = require(path.join(ROOT, "textrepl.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const one = (id, k, t, m, d) => (d ? { id, k: "", t: "", m, d: 1 } : { id, k, t, m, d: 0 });

test("codes: 2 to 32 characters, no white space; texts need something to say", () => {
  assert.equal(R.cleanCode(";δνση"), ";δνση");
  assert.equal(R.cleanCode(";"), "");
  assert.equal(R.cleanCode(";a b"), "");
  assert.equal(R.cleanCode("x".repeat(33)), "");
  assert.equal(R.cleanCode(7), "");
  assert.equal(R.cleanText("  \n "), "");
  assert.equal(R.cleanText("a\r\nb"), "a\nb");
  assert.equal(R.cleanText("y".repeat(5000)).length, R.MAX_TEXT);
});

test("normalize: bad items out, sorted by id, merge(x, null) == x", () => {
  const d = R.normalize({ items: [one("b", ";b", "B", 2), { id: "BAD", k: ";x", t: "x", m: 1 }, one("a", ";a", "A", 1),
    { id: "c", k: "no", t: "", m: 1 }, { id: "e", d: 1, k: "kept?", t: "gone", m: 4 }] });
  assert.deepEqual(d.items.map((i) => i.id), ["a", "b", "e"]);
  assert.deepEqual(d.items[2], { id: "e", k: "", t: "", m: 4, d: 1 }, "a tombstone keeps no text");
  assert.deepEqual(R.merge(d, null), d);
  assert.deepEqual(R.merge(null, d), d);
  assert.deepEqual(R.normalize(R.normalize(d)), d);
});

test("merge: union by id, newest m wins, tombstones win over older edits, order-free", () => {
  const a = { ver: 1, items: [one("x", ";x", "old", 1), one("y", ";y", "Y", 5)] };
  const b = { ver: 1, items: [one("x", ";x", "new", 3), one("y", "", "", 6, 1), one("z", ";z", "Z", 2)] };
  const ab = R.merge(a, b), ba = R.merge(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual(ab.items, [one("x", ";x", "new", 3), one("y", "", "", 6, 1), one("z", ";z", "Z", 2)]);
  const tie1 = { items: [one("q", ";q", "aaa", 7)] }, tie2 = { items: [one("q", ";q", "bbb", 7)] };
  assert.deepEqual(R.merge(tie1, tie2), R.merge(tie2, tie1), "a tie is decided the same way everywhere");
  assert.deepEqual(R.merge(ab, ab), ab, "idempotent: no endless uploads");
});

test("limits: 500 live, 500 tombstones, the newest kept, deterministic", () => {
  const items = [];
  for (let i = 0; i < 520; i++) items.push(one("l" + String(i).padStart(4, "0"), ";c" + i, "t", i));
  for (let i = 0; i < 510; i++) items.push(one("d" + String(i).padStart(4, "0"), "", "", i, 1));
  const d = R.normalize({ items });
  assert.equal(d.items.filter((i) => !i.d).length, 500);
  assert.equal(d.items.filter((i) => i.d).length, 500);
  assert.ok(!d.items.some((i) => i.id === "l0000"), "the oldest live item went first");
  assert.ok(d.items.some((i) => i.id === "l0519"));
  assert.deepEqual(R.normalize({ items: items.slice().reverse() }), d);
  const big = [one("a1", ";a", "x".repeat(4000), 1)];
  for (let i = 2; i < 60; i++) big.push(one("a" + i, ";a" + i, "x".repeat(4000), i));
  const total = R.normalize({ items: big }).items.reduce((s, i) => s + i.t.length, 0);
  assert.ok(total <= R.MAX_TOTAL);
});

test("put / remove: a new item, an edit bumps m, a removal is a tombstone", () => {
  let d = R.put(null, { k: " ;addr ", t: "12 Long Street" }, 1000);
  assert.equal(d.items.length, 1);
  const id = d.items[0].id;
  assert.equal(d.items[0].k, ";addr");
  assert.equal(d.items[0].m, 1000);
  assert.deepEqual(R.put(d, { id, k: ";addr", t: "12 Long Street" }, 2000), d, "nothing changed: same data");
  d = R.put(d, { id, k: ";addr", t: "14 Long Street" }, 500);
  assert.equal(d.items[0].m, 1001, "a clock behind still moves m on");
  assert.equal(R.invalid(d, { k: ";a b", t: "x" }), "space");
  assert.equal(R.invalid(d, { k: ";", t: "x" }), "code");
  assert.equal(R.invalid(d, { k: ";ok", t: " " }), "text");
  assert.equal(R.invalid(d, { k: ";ok", t: "x" }), "");
  assert.deepEqual(R.put(d, { k: ";", t: "x" }, 3000), d, "an invalid entry changes nothing");
  d = R.remove(d, id, 3000);
  assert.deepEqual(d.items, [{ id, k: "", t: "", m: 3000, d: 1 }]);
  assert.deepEqual(R.list(d), []);
});

test("list, search and duplicate codes from two devices", () => {
  const d = { items: [one("a", ";sig", "Best, Chris", 1), one("b", ";δνση", "Οδός Παπαδιαμάντη 12", 2),
    one("c", ";sig", "Kind regards", 3), one("e", "", "", 4, 1)] };
  assert.deepEqual(R.list(d).map((i) => i.id), ["c", "a", "b"]);
  assert.deepEqual(R.list(d, "παπαδιαμαντη").map((i) => i.id), ["b"], "accents ignored");
  assert.deepEqual(R.list(d, "SIG kind").map((i) => i.id), ["c"]);
  assert.deepEqual(R.dupes(d), { ";sig": 2 });
  assert.equal(R.table(d)[";sig"], "Kind regards", "the newest one is used");
});

test("matchAt: only at the start of a word, right before a space or punctuation", () => {
  const map = { ";δνση": "A", ";tel": "T", ";tel2": "T2", "brb": "be right back" };
  assert.deepEqual(R.matchAt("γεια ;δνση ", 11, map), { start: 5, code: ";δνση", delim: " " });
  assert.deepEqual(R.matchAt(";tel,", 5, map), { start: 0, code: ";tel", delim: "," });
  assert.deepEqual(R.matchAt(";tel2.", 6, map), { start: 0, code: ";tel2", delim: "." });
  assert.equal(R.matchAt(";tel", 4, map), null, "no delimiter typed yet");
  assert.equal(R.matchAt("x;tel ", 6, map), null, "not in the middle of a word");
  assert.deepEqual(R.matchAt("(brb)", 5, map), { start: 1, code: "brb", delim: ")" }, "an opening bracket may come first");
  assert.deepEqual(R.matchAt("brb\n", 4, map), { start: 0, code: "brb", delim: "\n" });
  assert.deepEqual(R.matchAt("brb;", 4, map), { start: 0, code: "brb", delim: ";" }, "the Greek question mark people type");
  assert.equal(R.matchAt("ok brb x", 8, map), null);
  assert.equal(R.matchAt("brb ", 2, map), null, "the caret must be right after the delimiter");
});

test("placeholders: {date}, {time}, {cursor}; the space after {cursor} is dropped", () => {
  const fmt = { date: "17/11/2026", time: "23:40" };
  assert.deepEqual(R.expansion("Today {date} {time}", " ", fmt), { text: "Today 17/11/2026 23:40 ", caret: 23 });
  assert.deepEqual(R.expansion("Dear {cursor},", " ", fmt), { text: "Dear ,", caret: 5 });
  assert.deepEqual(R.expansion("Dear {cursor}", ".", fmt), { text: "Dear .", caret: 5 });
  assert.deepEqual(R.expansion("a{cursor}b{cursor}c", " ", fmt), { text: "abc", caret: 1 }, "only the first {cursor} counts");
  assert.deepEqual(R.expansion("{unknown}", " ", fmt), { text: "{unknown} ", caret: 10 });
  const s = R.stamp(Date.UTC(2026, 10, 17, 12, 5), "el");
  assert.match(s.date, /2026/);
  assert.match(s.time, /^\d{2}:\d{2}$/, "24-hour time");
});

test("never: Passwords, Settings, secret and search fields, code editors, opt-out marks", () => {
  assert.equal(R.appOk("passwords"), false);
  assert.equal(R.appOk("settings"), false);
  assert.equal(R.appOk(""), false);
  assert.equal(R.appOk("notes"), true);
  assert.equal(R.appOfPath("/notes/index.html"), "notes");
  const el = (tag, attrs, inside) => ({
    nodeType: 1, tagName: tag, readOnly: false, disabled: false,
    getAttribute: (n) => (attrs && n in attrs ? attrs[n] : null),
    closest: (sel) => (inside && sel.split(",").some((x) => inside.includes(x.trim())) ? {} : null)
  });
  assert.equal(R.fieldOk(el("TEXTAREA")), true);
  assert.equal(R.fieldOk(el("INPUT")), true, "no type = text");
  assert.equal(R.fieldOk(el("INPUT", { type: "email" })), true);
  for (const type of ["password", "hidden", "search", "number", "date"]) assert.equal(R.fieldOk(el("INPUT", { type })), false, type);
  assert.equal(R.fieldOk(el("INPUT", { autocomplete: "one-time-code" })), false);
  assert.equal(R.fieldOk(el("INPUT", { role: "searchbox" })), false);
  assert.equal(R.fieldOk(el("TEXTAREA", null, ["[data-oros-noexpand]"])), false);
  assert.equal(R.fieldOk(el("TEXTAREA", null, ["[data-oros-noclip]"])), false);
  assert.equal(R.fieldOk(el("TEXTAREA", null, [".cm-editor"])), false);
  assert.equal(R.fieldOk(el("DIV")), false, "rich text editors come in W2");
  const src = read("textrepl.js");
  assert.match(src, /strictOn\(\) \|\| locked\(\)/, "paused under Sensitive work and the screen lock");
  assert.match(src, /e\.isComposing/, "never during IME composition");
});

test("wiring: start-up script, sync slice with a merge, frames, Settings › Language, strings", () => {
  const html = read("index.html"), shell = read("shell.js"), src = read("textrepl.js");
  // The script line, its preload and the sw.js precache line come in the
  // stamp commit (merge queue rule 14, /mnt/project-files/textrepl/stamp-notes-w1.md).
  if (html.includes("textrepl.js")) {
    assert.match(html, /<script src="textrepl\.js\?v=[^"]+"><\/script>/);
    assert.match(html, /<link rel="preload" as="script" href="textrepl\.js\?v=/);
    assert.ok(html.indexOf('<script src="textrepl.js') < html.indexOf('<script src="shell.js'), "before shell.js");
    assert.match(read("sw.js"), /"\.\/textrepl\.js",/);
  }
  assert.match(src, /api\.registerSlice\(SLICE, sliceGet, sliceSet, KEY, merge\)/, "merge is the fifth argument (Part V)");
  assert.match(shell, /appFrames\(\)\.forEach\(window\.orosTextRepl\.wire\)/);
  assert.match(shell, /window\.orosTextRepl\.wire\(f\)/);
  assert.match(shell, /window\.orosTextRepl\.onChange\(settingsNotify\)/);
  const set = read("settings/settings.js"), core = read("settings/core.js");
  assert.match(set, /if \(textRepl\(\)\) secTextRepl\(host\);/);
  assert.match(set, /c\.setAttribute\("data-oros-noexpand", ""\)/);
  assert.match(core, /\["textrepl", "language", "rp\.title", null, null, "textrepl"\]/);
  assert.match(core, /textrepl: "all"/);
  const C = require(path.join(ROOT, "settings/core.js"));
  const keys = ["rp.title", "rp.hint", "rp.hint.ph", "rp.never", "rp.paused", "rp.code", "rp.code.ph", "rp.text", "rp.text.ph",
    "rp.add", "rp.save", "rp.cancel", "rp.edit", "rp.del", "rp.del.confirm", "rp.err.code", "rp.err.space", "rp.err.text",
    "rp.err.full", "rp.err.store", "rp.empty", "rp.search", "rp.nomatch", "rp.count", "rp.dupe", "w.textrepl"];
  const de = read("i18n/de/settings.js");
  for (const k of keys) {
    assert.ok(C.STRINGS.en[k], "en " + k);
    assert.ok(C.STRINGS.el[k], "el " + k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  }
  for (const f of ["translations.js", "i18n/de/shell.js"]) assert.ok(read(f).includes('"trp.full":'), f);
  // Card 6: neither the Assistant nor orOS Gate reads the list.
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.js$/.test(e.name) ? [path.join(dir, e.name)] : []);
  for (const dir of ["assistant", "gate"].filter((d) => fs.existsSync(path.join(ROOT, d)))) {
    for (const f of walk(dir)) assert.ok(!/orosTextRepl|oros-textrepl/.test(read(f)), f);
  }
});
