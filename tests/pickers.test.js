// PICK-1: themed pickers (pickers.js + pickers.css, Bible Part VII).
// Pure helpers of the list, and the page contract: every page the
// release stamp reaches loads pickers.js with the right relative path,
// so no app falls back to the browser's grey list.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const P = require(path.join(ROOT, "pickers.js"));

test("fold drops case and accents, Greek final sigma too", () => {
  assert.equal(P.fold("Ελλάδα"), "ελλαδα");
  assert.equal(P.fold("ΪΣΟΣ"), "ισοσ");
  assert.equal(P.fold("Café"), "cafe");
  assert.equal(P.fold(null), "");
});

test("matches needs every word, in any order", () => {
  assert.ok(P.matches("Ηνωμένο Βασίλειο", "βασιλ ηνωμ"));
  assert.ok(P.matches("Anything", ""));
  assert.ok(!P.matches("Γαλλία", "ισπ"));
  assert.ok(P.matches("Ισπανία", "ισπ"));
});

test("nextIndex skips disabled rows and stays inside the list", () => {
  const rows = [{ disabled: true }, {}, { disabled: true }, {}, {}];
  assert.equal(P.nextIndex(rows, -1, 1), 1);
  assert.equal(P.nextIndex(rows, 1, 1), 3);
  assert.equal(P.nextIndex(rows, 3, -1), 1);
  assert.equal(P.nextIndex(rows, 1, -1), 1, "first pickable row stays put");
  assert.equal(P.nextIndex(rows, 4, 1), 4);
  assert.equal(P.nextIndex(rows, 1, 8), 4, "page down clamps to the last row");
  assert.equal(P.nextIndex(rows, rows.length, -1), 4, "End");
  assert.equal(P.nextIndex([{ disabled: true }], -1, 1), -1);
  assert.equal(P.nextIndex([], -1, 1), -1);
});

test("jumpIndex finds the next row by its first letters, wrapping", () => {
  const rows = [{ label: "Άλφα" }, { label: "Βήτα" }, { label: "Αλάτι", disabled: true }, { label: "αλεύρι" }];
  assert.equal(P.jumpIndex(rows, 0, "α"), 3);
  assert.equal(P.jumpIndex(rows, 3, "α"), 0);
  assert.equal(P.jumpIndex(rows, 0, "αλε"), 3);
  assert.equal(P.jumpIndex(rows, 0, "ω"), -1);
  assert.equal(P.jumpIndex(rows, 0, ""), -1);
});

test("strings in English, Greek and German, English for the rest", () => {
  for (const code of ["en", "el", "de"]) {
    const s = P.strings(code);
    for (const k of ["search", "none", "close", "list"]) assert.ok(s[k] && s[k].length, code + "." + k);
  }
  assert.equal(P.strings("fr"), P.STR.en);
});

// The same page list as .github/scripts/stamp-assets.js (minus the shell,
// which draws no <select>).
function pages() {
  const SKIP = new Set(["icons", "fonts", "vendor"]);
  const out = [];
  for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || SKIP.has(d.name) || d.name.startsWith(".")) continue;
    if (fs.existsSync(path.join(ROOT, d.name, "index.html"))) out.push(d.name + "/index.html");
  }
  for (const f of ["forms/f/index.html", "calendar/rsvp.html"]) if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  return out;
}

test("every page loads pickers.js from the root, deferred, after its own scripts", () => {
  const list = pages();
  assert.ok(list.length > 100, "page scan found " + list.length);
  const bad = [];
  for (const f of list) {
    const html = fs.readFileSync(path.join(ROOT, f), "utf8");
    // A forward-only page (an alias folder) loads no script at all.
    if (!/<script src="(?![^"]*pickers\.js)/.test(html)) { assert.ok(!html.includes("<select"), f + " has a <select> but no scripts"); continue; }
    const pre = "../".repeat(f.split("/").length - 1);
    const re = new RegExp('<script src="' + pre.replace(/\./g, "\\.") + 'pickers\\.js(\\?v=[^"]*)?" defer></script>');
    const m = re.exec(html);
    // Last line of <body>: after i18n.js and every script of the app.
    if (!m || !/^\s*<\/body>/.test(html.slice(m.index + m[0].length))) bad.push(f);
  }
  assert.deepEqual(bad, [], "add <script src=\"../pickers.js\" defer></script> as the last line of <body>");
});

test("the app-kit template and check-app carry the line", () => {
  const tpl = fs.readFileSync(path.join(ROOT, "docs/app-kit/template/index.html"), "utf8");
  assert.ok(tpl.includes('<script src="../pickers.js" defer></script>'));
  const chk = fs.readFileSync(path.join(ROOT, ".github/app-kit/check-app.js"), "utf8");
  assert.ok(chk.includes('"pickers"'));
});

test("pickers.css keeps the browser list shut only under html.opk-on, and lets data-native through", () => {
  const css = fs.readFileSync(path.join(ROOT, "pickers.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = css.match(/([^{}]+)\{\s*pointer-events:\s*none;\s*\}/);
  assert.ok(rule, "pointer-events rule");
  for (const sel of rule[1].split(",")) {
    assert.match(sel.trim(), /^html\.opk-on select/);
    assert.match(sel, /:not\(\[multiple\]\)/);
    assert.match(sel, /:not\(\[data-native\]\)/);
  }
  assert.match(css, /html\.opk-on \[data-native\] select \{ pointer-events: auto; \}/);
  for (const v of ["--panel-bg", "--text", "--accent", "--border"]) assert.ok(css.includes("var(" + v), v);
});

test("pickers.js writes no page data as HTML", () => {
  const js = fs.readFileSync(path.join(ROOT, "pickers.js"), "utf8");
  const html = [...js.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  for (const h of html) assert.match(h, /^('<svg [^']*'|svg)$/, "innerHTML only for fixed icons: " + h);
  // iconBtn(…, svg) is only ever called with the ICON_ constants, which are literal SVG
  for (const m of js.matchAll(/iconBtn\([^)]*,\s*([A-Za-z_]+)\)/g)) if (m[1] !== "svg") assert.match(m[1], /^ICON_[A-Z]+$/);
  for (const m of js.matchAll(/var (ICON_[A-Z]+) = ([^;]+);/g)) assert.match(m[2], /^'<svg [^']*'$/, m[1]);
});

// ---------- T2: date and time ----------
test("parseDate / parseTime read the input formats and refuse the rest", () => {
  assert.deepEqual(P.parseDate("2024-02-29"), { y: 2024, m: 2, d: 29 });
  assert.equal(P.parseDate("2023-02-29"), null);
  assert.equal(P.parseDate("2026-13-01"), null);
  assert.equal(P.parseDate(""), null);
  assert.deepEqual(P.parseDate("2026-11-16T09:30"), { y: 2026, m: 11, d: 16 });
  assert.deepEqual(P.parseTime("09:05"), { h: 9, mi: 5, s: 0 });
  assert.deepEqual(P.parseTime("2026-11-16T23:59:30"), { h: 23, mi: 59, s: 30 });
  assert.equal(P.parseTime("24:00"), null);
  assert.equal(P.isoDate({ y: 33, m: 1, d: 5 }), "0033-01-05");
  assert.equal(P.isoTime({ h: 7, mi: 3, s: 9 }, true), "07:03:09");
  assert.equal(P.isoTime({ h: 7, mi: 3, s: 9 }, false), "07:03");
});

test("monthGrid starts on the Monday on or before the 1st, six weeks", () => {
  const g = P.monthGrid(2026, 11);   // 1 Nov 2026 is a Sunday
  assert.equal(g.length, 42);
  assert.deepEqual([g[0].y, g[0].m, g[0].d, g[0].out], [2026, 10, 26, true]);
  assert.deepEqual([g[6].m, g[6].d, g[6].out], [11, 1, false]);
  const j = P.monthGrid(2024, 1);    // 1 Jan 2024 is a Monday
  assert.deepEqual([j[0].m, j[0].d, j[0].out], [1, 1, false]);
  assert.equal(P.weekday({ y: 2026, m: 11, d: 16 }), 0);
  assert.equal(P.daysIn(2024, 2), 29);
  assert.equal(P.daysIn(1900, 2), 28);
  assert.equal(P.daysIn(2000, 2), 29);
});

test("addMonths keeps the day inside the month, addDays crosses years", () => {
  assert.deepEqual(P.addMonths({ y: 2026, m: 1, d: 31 }, 1), { y: 2026, m: 2, d: 28 });
  assert.deepEqual(P.addMonths({ y: 2026, m: 1, d: 15 }, -1), { y: 2025, m: 12, d: 15 });
  assert.deepEqual(P.addMonths({ y: 2026, m: 12, d: 1 }, 13), { y: 2028, m: 1, d: 1 });
  assert.deepEqual(P.addDays({ y: 2026, m: 12, d: 31 }, 1), { y: 2027, m: 1, d: 1 });
  assert.deepEqual(P.addDays({ y: 2024, m: 3, d: 1 }, -1), { y: 2024, m: 2, d: 29 });
});

test("min / max bound the days and the final value", () => {
  assert.ok(P.dayAllowed({ y: 2026, m: 11, d: 5 }, "2026-11-05", "2026-12-20"));
  assert.ok(!P.dayAllowed({ y: 2026, m: 11, d: 4 }, "2026-11-05", ""));
  assert.ok(!P.dayAllowed({ y: 2026, m: 12, d: 21 }, "", "2026-12-20T10:00"));
  assert.ok(P.dayAllowed({ y: 1, m: 1, d: 1 }, "", ""));
  assert.equal(P.clampValue("08:00", "09:00", "17:00"), "09:00");
  assert.equal(P.clampValue("2026-11-20T18:00", "", "2026-11-20T17:30"), "2026-11-20T17:30");
  assert.equal(P.clampValue("12:00", "09:00", "17:00"), "12:00");
  assert.equal(P.clampValue("", "09:00", ""), "", "a cleared field stays empty");
});

test("timeSteps follows the step attribute", () => {
  assert.deepEqual(P.timeSteps(null), { secs: false, miStep: 1, sStep: 1 });
  assert.deepEqual(P.timeSteps("300"), { secs: false, miStep: 5, sStep: 1 });
  assert.deepEqual(P.timeSteps("900"), { secs: false, miStep: 15, sStep: 1 });
  assert.deepEqual(P.timeSteps("420"), { secs: false, miStep: 1, sStep: 1 }, "7 minutes does not divide the hour");
  assert.deepEqual(P.timeSteps("1"), { secs: true, miStep: 1, sStep: 1 });
  assert.deepEqual(P.timeSteps("15"), { secs: true, miStep: 1, sStep: 15 });
});

test("pickers.css also keeps date and time fields to the orOS calendar", () => {
  const css = fs.readFileSync(path.join(ROOT, "pickers.css"), "utf8");
  assert.match(css, /html\.opk-on input:is\(\[type="date"\], \[type="time"\], \[type="datetime-local"\]\):not\(\[disabled\]\):not\(\[readonly\]\):not\(\[data-native\]\) \{ pointer-events: none; \}/);
  assert.match(css, /html\.opk-on \[data-native\] input \{ pointer-events: auto; \}/);
});

test("month and weekday names come from Intl in the three languages", () => {
  const f = (loc) => new Intl.DateTimeFormat(loc, { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(2024, 4, 1));
  assert.equal(f("el-GR").replace(/[\s,]*2024[\s.]*/, "").trim(), "Μάιος", "standalone Greek month (not Μαΐου)");
  assert.equal(f("de-DE").replace(/[\s,]*2024[\s.]*/, "").trim(), "Mai");
});

// ---------- T3: colour ----------
test("colour helpers: codes, RGB and HSV round trips", () => {
  assert.equal(P.normHex("#ABC"), "#aabbcc");
  assert.equal(P.normHex("d4af37"), "#d4af37");
  assert.equal(P.normHex("#12345"), null);
  assert.equal(P.normHex("red"), null);
  assert.deepEqual(P.hexToRgb("#d4af37"), { r: 212, g: 175, b: 55 });
  assert.equal(P.rgbToHex({ r: 255.4, g: -3, b: 16 }), "#ff0010");
  for (const h of ["#000000", "#ffffff", "#d4af37", "#3366cc", "#e53935", "#00897b", "#8e24aa", "#7f7f7f"]) {
    assert.equal(P.rgbToHex(P.hsvToRgb(P.rgbToHsv(P.hexToRgb(h)))), h, h);
  }
  const red = P.rgbToHsv({ r: 255, g: 0, b: 0 });
  assert.deepEqual([red.h, red.s, red.v], [0, 1, 1]);
  assert.equal(P.rgbToHex(P.hsvToRgb({ h: 240, s: 1, v: 1 })), "#0000ff");
  assert.equal(P.rgbToHex(P.hsvToRgb({ h: 360, s: 1, v: 1 })), "#ff0000", "360° wraps to red");
});

test("pickers.css keeps colour fields to the orOS picker", () => {
  const css = fs.readFileSync(path.join(ROOT, "pickers.css"), "utf8");
  assert.match(css, /html\.opk-on input\[type="color"\]:not\(\[disabled\]\):not\(\[readonly\]\):not\(\[data-native\]\) \{ pointer-events: none; \}/);
});

// ---------- T4: no native questions (R14) ----------
test("no app calls the browser's alert / confirm / prompt (R14: OrosPick.ask)", () => {
  const SKIP = new Set(["vendor", "tests", "docs", "node_modules", "fonts", "icons", "android", "extension"]);
  const bad = [];
  const walk = (dir) => {
    for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (d.name.startsWith(".")) continue;
      const rel = dir ? dir + "/" + d.name : d.name;
      if (d.isDirectory()) { if (!SKIP.has(d.name)) walk(rel); continue; }
      if (!/\.js$/.test(d.name)) continue;
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      // local helpers named confirm/prompt (recordpkg.js, cast.js) are fine
      const own = new Set([...src.matchAll(/function\s+(alert|confirm|prompt)\s*\(/g)].map((m) => m[1]));
      src.split("\n").forEach((line, i) => {
        const code = line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");
        for (const m of code.matchAll(/(^|[^.\w$])(window\.)?(alert|confirm|prompt)\s*\(/g)) {
          if (!m[2] && own.has(m[3])) continue;
          bad.push(rel + ":" + (i + 1) + " " + line.trim().slice(0, 80));
        }
      });
    }
  };
  walk("");
  assert.deepEqual(bad, []);
});

test("OrosPick.ask is exported and sign.html (its only user outside the stamp) loads pickers.js", () => {
  const js = fs.readFileSync(path.join(ROOT, "pickers.js"), "utf8");
  assert.match(js, /open: openAny, ask: ask,/);
  const sign = fs.readFileSync(path.join(ROOT, "scanpdf/sign.html"), "utf8");
  assert.match(sign, /<script src="\.\.\/pickers\.js\?v=[^"]+" defer><\/script>/);
});
