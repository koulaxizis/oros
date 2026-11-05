// Start page (startpage/, SP-1) and ME v1 (Settings › Appearance › Your name).
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SP = require("../startpage/startpage.js");

test("search field: web search, addresses, orOS search", () => {
  assert.equal(SP.target("  "), null);
  assert.deepEqual(SP.target("weather athens"), { kind: "web", url: "https://duckduckgo.com/?q=weather%20athens" });
  assert.deepEqual(SP.target("wikipedia.org"), { kind: "url", url: "https://wikipedia.org/" });
  assert.deepEqual(SP.target("https://example.com/a?b=1"), { kind: "url", url: "https://example.com/a?b=1" });
  assert.deepEqual(SP.target("http://localhost:47800/"), { kind: "url", url: "http://localhost:47800/" });
  assert.deepEqual(SP.target("oros dentist tuesday"), { kind: "oros", url: "../?search=dentist%20tuesday" });
  // never a script or another scheme, never a bare word or number
  assert.equal(SP.target("javascript:alert(1)").kind, "web");
  assert.equal(SP.target("data:text/html,x").kind, "web");
  assert.equal(SP.target("hello").kind, "web");
  assert.equal(SP.target("3.14").kind, "web");
  assert.equal(SP.target("καφές").kind, "web");
});

test("favourites: starred http(s) bookmarks, newest change first, no tombstones", () => {
  const data = {
    items: {
      a: { id: "a", url: "https://a.example/", title: "A", fav: true, modified: 10 },
      b: { id: "b", url: "https://b.example/", title: "B", fav: true, modified: 30 },
      c: { id: "c", url: "https://c.example/", title: "C", fav: false, modified: 50 },
      d: { id: "d", url: "javascript:alert(1)", title: "D", fav: true, modified: 60 },
      e: { id: "e", url: "https://e.example/", title: "E", fav: true, modified: 70 },
      f: { id: "f", url: "ftp://f.example/", title: "F", fav: true, modified: 80 }
    },
    deleted: { e: 99 }
  };
  assert.deepEqual(SP.favourites(data).map((x) => x.id), ["b", "a"]);
  assert.deepEqual(SP.favourites(null), []);
  const many = { items: {} };
  for (let i = 0; i < 40; i++) many.items["x" + i] = { id: "x" + i, url: "https://x" + i + ".example/", fav: true, modified: i };
  assert.equal(SP.favourites(many).length, 24);
});

test("greeting: morning, afternoon, evening", () => {
  assert.equal(SP.greeting(4), "evening");
  assert.equal(SP.greeting(5), "morning");
  assert.equal(SP.greeting(11), "morning");
  assert.equal(SP.greeting(12), "afternoon");
  assert.equal(SP.greeting(17), "afternoon");
  assert.equal(SP.greeting(18), "evening");
});

test("strings: EN, EL and DE carry the same keys", () => {
  const en = Object.keys(SP.STR.en).sort();
  ["el", "de"].forEach((l) => assert.deepEqual(Object.keys(SP.STR[l]).sort(), en, l));
});

test("page: titles and addresses only through textContent / http(s) href; reads, never writes", () => {
  const js = read("startpage/startpage.js");
  assert.ok(!/setItem|removeItem/.test(js), "the start page never writes storage");
  assert.ok(!/innerHTML = (?!SVG_)/.test(js), "innerHTML only for the static icons");
  assert.ok(/nm\.textContent = /.test(js) && /a\.href = it\.url/.test(js));
  const html = read("startpage/index.html");
  assert.ok(/http-equiv="Content-Security-Policy"/.test(html));
  assert.ok(!/<script>(?!<\/script>)/.test(html), "no inline script");
  assert.ok(/href="\.\.\/\?open=bookmarks"/.test(html));
  // Tor only through the System extension's attribute and event
  assert.ok(/data-oros-sys-tor/.test(js) && /new CustomEvent\("oros-sys-tor"\)/.test(js));
});

// ---------- ME v1 in shell.js ----------
function meModel() {
  const src = read("shell.js");
  const a = src.indexOf("  var ME_KEY = ");
  const b = src.indexOf("  function meRead()");
  assert.ok(a > 0 && b > a);
  const ctx = {};
  vm.runInNewContext(src.slice(a, b) + "\nthis.meNorm = meNorm; this.meMerge = meMerge; this.meClean = meClean;", ctx);
  return ctx;
}

test("ME v1: clean name, canonical form", () => {
  const M = meModel();
  assert.equal(M.meClean("  Chris \n K  "), "Chris K");
  assert.equal(M.meClean("x".repeat(60)).length, 40);
  assert.equal(M.meClean(7), "");
  assert.equal(JSON.stringify(M.meNorm(null)), '{"ver":1,"f":{}}');
  // an unclean name is refused, a newer bundle's small field is kept
  assert.equal(JSON.stringify(M.meNorm({ f: { name: { v: " a ", t: 1 }, zz: { v: true, t: 2 }, Bad: { v: 1, t: 1 } } })),
    '{"ver":1,"f":{"zz":{"v":true,"t":2}}}');
});

test("ME v1: merge is symmetric, idempotent, newest wins, tie by JSON", () => {
  const M = meModel();
  const A = { ver: 1, f: { name: { v: "Chris", t: 10 } } };
  const B = { ver: 1, f: { name: { v: "Christos", t: 20 }, x: { v: 1, t: 5 } } };
  const C = { ver: 1, f: { name: { v: "Zed", t: 10 } } };
  const j = JSON.stringify;
  assert.equal(j(M.meMerge(A, B)), j(M.meMerge(B, A)));
  assert.equal(M.meMerge(A, B).f.name.v, "Christos");
  assert.equal(M.meMerge(A, C).f.name.v, "Zed");
  assert.equal(j(M.meMerge(A, C)), j(M.meMerge(C, A)));
  const m = M.meMerge(A, B);
  assert.equal(j(M.meMerge(m, m)), j(m));
  assert.equal(j(M.meMerge(M.meMerge(A, B), C)), j(M.meMerge(A, M.meMerge(B, C))));
  // an emptied name (newer) wins over an old one
  assert.equal(M.meMerge(A, { f: { name: { v: "", t: 11 } } }).f.name.v, "");
});

test("ME v1: wiring (slice, Settings, Today), never the Assistant", () => {
  const shell = read("shell.js");
  assert.ok(/registerSlice\("me", meSliceGet, meSliceSet, ME_KEY, meMerge\)/.test(shell));
  assert.ok(/registerMeSlice\(\);/.test(shell));
  assert.ok(/case "me:name":\s+meSetName\(value\)/.test(shell));
  assert.ok(/me: \{ name: meName\(\), max: ME_MAX \}/.test(shell));
  assert.ok(/function secMe\(/.test(read("settings/settings.js")));
  const core = read("settings/core.js");
  assert.ok(/\["me", "appearance", "a\.me"\]/.test(core) && /me: "all"/.test(core));
  assert.ok(/"a\.me":/.test(read("i18n/de/settings.js")));
  assert.ok(/P\.orosMe\.name\(\)/.test(read("today/today.js")));
  fs.readdirSync(path.join(ROOT, "assistant")).filter((f) => f.endsWith(".js")).forEach((f) => {
    const s = read("assistant/" + f);
    assert.ok(!/oros-me\b|orosMe/.test(s), "assistant/" + f + " must not read the name");
  });
});
