// Pad developer tools (wave D1): the pure functions in pad/devtools.js
// against known vectors (RFC 1321, FIPS 180, RFC 9562), the YAML rules
// (comments and number spellings kept), and the app's contracts
// (lazy loading, precache, no innerHTML from results, strings in EN/EL/DE).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");
const D = require("../pad/devtools.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
globalThis.self = globalThis;
require("../vendor/yaml/yaml.min.js");
const Y = globalThis.OrosYAML;

test("MD5 matches the RFC 1321 test suite", () => {
  const v = {
    "": "d41d8cd98f00b204e9800998ecf8427e",
    "a": "0cc175b9c0f1b6a831c399e269772661",
    "abc": "900150983cd24fb0d6963f7d28e17f72",
    "message digest": "f96b697d7cb7938d525a2f31aaf161d0",
    "abcdefghijklmnopqrstuvwxyz": "c3fcd3d76192e4007dfb496cca67e13b",
    "12345678901234567890123456789012345678901234567890123456789012345678901234567890": "57edf4a22be3c955ac49da2e2107b67a"
  };
  for (const [s, h] of Object.entries(v)) assert.equal(D.toHex(D.md5(D.utf8(s))), h, s);
  // Greek text is hashed as its UTF-8 bytes.
  assert.equal(D.toHex(D.md5(D.utf8("Καλημέρα"))), require("crypto").createHash("md5").update("Καλημέρα", "utf8").digest("hex"));
});

test("hashAll gives MD5 and SHA-1/256/384/512 in hex and Base64", async () => {
  const rows = await D.hashAll(D.utf8("abc"), webcrypto.subtle);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(rows.map((r) => r.id), ["md5", "sha1", "sha256", "sha384", "sha512"]);
  assert.equal(by.sha1.hex, "a9993e364706816aba3e25717850c26c9cd0d89d");
  assert.equal(by.sha256.hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(by.sha256.b64, "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
  assert.equal(by.sha512.hex.slice(0, 16), "ddaf35a193617aba");
  // Bytes, not text: a Windows-1253 file hashes what is on disk.
  const bytes = new Uint8Array([0xC1, 0xE8, 0xDE, 0xED, 0xE1, 0x0D, 0x0A]);
  const r2 = await D.hashAll(bytes, webcrypto.subtle);
  assert.equal(r2[2].hex, require("crypto").createHash("sha256").update(Buffer.from(bytes)).digest("hex"));
  // Without WebCrypto only MD5 is given, never a wrong SHA.
  const r3 = await D.hashAll(D.utf8("abc"), null);
  assert.deepEqual(r3.map((r) => r.id), ["md5"]);
});

test("Compare with finds the pasted checksum in a .sha256 line, any case, or Base64", async () => {
  const rows = await D.hashAll(D.utf8("abc"), webcrypto.subtle);
  assert.equal(D.matchHash(rows, "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD  orOS-Portable.zip").id, "sha256");
  assert.equal(D.matchHash(rows, "SHA1 (abc.txt) = a9993e364706816aba3e25717850c26c9cd0d89d").id, "sha1");
  assert.equal(D.matchHash(rows, "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=").id, "sha256");
  assert.equal(D.matchHash(rows, "0".repeat(64)), null);
  assert.equal(D.matchHash(rows, "hello"), "");
  assert.equal(D.matchHash(rows, ""), "");
});

test("UUID v4 and v7 have the RFC 9562 layout; v7 starts with the time", () => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-([47])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const zero = (b) => b.fill(0);
  assert.equal(D.uuid4(zero), "00000000-0000-4000-8000-000000000000");
  assert.match(D.uuid4(), re);
  // RFC 9562 appendix A.6: 2022-02-22T19:22:22Z = 0x017F22E279B0.
  assert.equal(D.uuid7(0x017F22E279B0, zero), "017f22e2-79b0-7000-8000-000000000000");
  const a = D.uuid7(1000), b = D.uuid7(2000);
  assert.match(a, re); assert.equal(a.charAt(14), "7");
  assert.ok(a < b, "v7 sorts by time");
  const many = new Set(Array.from({ length: 200 }, () => D.uuid4()));
  assert.equal(many.size, 200);
});

test("time stamps: the unit comes from the number of digits; dates parse; junk does not", () => {
  assert.deepEqual(D.parseStamp("1700000000"), { ms: 1700000000000, unit: "s" });
  assert.deepEqual(D.parseStamp("1700000000.5"), { ms: 1700000000500, unit: "s" });
  assert.deepEqual(D.parseStamp("1700000000123"), { ms: 1700000000123, unit: "ms" });
  assert.deepEqual(D.parseStamp("1700000000123456"), { ms: 1700000000123, unit: "us" });
  assert.deepEqual(D.parseStamp("1700000000123456789"), { ms: 1700000000123, unit: "ns" });
  assert.deepEqual(D.parseStamp("-86400"), { ms: -86400000, unit: "s" });
  assert.deepEqual(D.parseStamp("2026-11-13T07:30:00Z"), { ms: Date.UTC(2026, 10, 13, 7, 30), unit: "date" });
  assert.equal(D.parseStamp("2026-11-13").unit, "date");
  for (const bad of ["", "hello", "12:30", "1e9", "99999999999999999999", "2026-13-45x"]) assert.equal(D.parseStamp(bad), null, bad);
  const rows = D.stampRows(Date.UTC(2023, 10, 14, 22, 13, 20), Date.UTC(2023, 10, 15, 22, 13, 20), "en-GB");
  const by = Object.fromEntries(rows.map((r) => [r.k, r.v]));
  assert.equal(by.isoUtc, "2023-11-14T22:13:20.000Z");
  assert.equal(by.unixS, "1700000000");
  assert.equal(by.unixMs, "1700000000000");
  assert.equal(by.rel, "yesterday");
  assert.match(by.isoLocal, /^2023-11-1[45]T\d\d:\d\d:20[+-]\d\d:\d\d$/);
});

test("number bases: every spelling in, exact out (also beyond 2^53)", () => {
  const rows = (s, e) => Object.fromEntries(D.baseRows(D.parseNumber(s), e).map((r) => [r.k, r.v]));
  assert.deepEqual(rows("255"), { dec: "255", hex: "0xFF", bin: "0b11111111", oct: "0o377" });
  assert.deepEqual(rows("0xff"), rows("255"));
  assert.deepEqual(rows("0b1111_1111"), rows("255"));
  assert.deepEqual(rows("0o377"), rows("255"));
  assert.equal(rows("$xFF", true).eel2, "$xFF");
  assert.equal(rows("-10").hex, "-0xA");
  assert.equal(rows("18446744073709551615").hex, "0xFFFFFFFFFFFFFFFF");
  for (const bad of ["", "12.5", "0b102", "0o8", "0xG", "abc", "1e3"]) assert.equal(D.parseNumber(bad), null, bad);
});

test("CSS colours: hex, rgb() and hsl() in every syntax, alpha kept", () => {
  const rows = (s) => Object.fromEntries(D.colorRows(D.parseColor(s)).map((r) => [r.k, r.v]));
  assert.deepEqual(rows("#f80"), { hex: "#ff8800", rgb: "rgb(255, 136, 0)", hsl: "hsl(32, 100%, 50%)" });
  assert.deepEqual(rows("rgb(255, 136, 0)"), rows("#ff8800"));
  assert.deepEqual(rows("rgb(255 136 0)"), rows("#ff8800"));
  assert.equal(rows("hsl(120, 100%, 25%)").hex, "#008000");
  assert.equal(rows("hsl(120deg 100% 25%)").hex, "#008000");
  assert.equal(rows("hsl(0.5turn 100% 50%)").hex, "#00ffff");
  assert.deepEqual(rows("rgb(255 0 0 / 50%)"), { hex: "#ff000080", rgb: "rgba(255, 0, 0, 0.5)", hsl: "hsla(0, 100%, 50%, 0.5)" });
  assert.equal(rows("#ff000080").rgb, "rgba(255, 0, 0, 0.502)");
  assert.equal(rows("rgba(0,0,0,0)").hex, "#00000000");
  for (const bad of ["", "red", "#ggg", "#12345", "rgb(1,2)", "rgb(1,2,3,4,5)", "url(x)", "hsl(a, b, c)"]) assert.equal(D.parseColor(bad), null, bad);
  // The sample is painted from the hex row only: always # and hex digits.
  for (const s of ["#abc", "rgb(1 2 3)", "hsla(10, 20%, 30%, .4)"]) assert.match(D.colorRows(D.parseColor(s))[0].v, /^#[0-9a-f]{6}([0-9a-f]{2})?$/);
});

test("JSON check and sort keys keep numbers and strings exactly as written", () => {
  assert.deepEqual(D.jsonCheck('{"a": [1, 2]}'), { ok: true });
  assert.deepEqual(D.jsonCheck('{"a": [1, 2}'), { error: { line: 1, col: 12 } });
  assert.deepEqual(D.jsonCheck('{\n  "a": 1,\n}'), { error: { line: 3, col: 1 } });
  const src = '{"b": 1.50, "a": {"z": 12345678901234567890, "y": "\\u00e9"}, "10": 0, "2": 1, "a": 2}';
  assert.equal(D.jsonSortKeys(src, "").text, '{"10":0,"2":1,"a":{"y":"\\u00e9","z":12345678901234567890},"a":2,"b":1.50}');
  assert.equal(D.jsonSortKeys('{"b":[{"d":1,"c":2}],"a":[]}', "  ").text, '{\n  "a": [],\n  "b": [\n    {\n      "c": 2,\n      "d": 1\n    }\n  ]\n}\n');
  assert.ok(D.jsonSortKeys('{"a":', "").error);
});

test("JSON → YAML: valid YAML that reads back as the same data", () => {
  const src = '{"name": "orOS", "ver": 6.30, "big": 12345678901234567890, "yes": "yes", "num": "123", "e": "", "gr": "Καλή μέρα",' +
    ' "colon": "a: b", "hash": "x #y", "nl": "two\\nlines", "n": null, "t": true, "list": [1, [2, 3], {"k": "v", "w": [] }, {}], "obj": {"deep": {"x": -1e-7}}}';
  const y = D.jsonToYaml(src, 2);
  assert.ok(!y.error, JSON.stringify(y));
  const back = Y.parse(y.text, { intAsBigInt: true });
  assert.equal(back.name, "orOS");
  assert.equal(back.yes, "yes", "YAML 1.1 booleans stay strings");
  assert.equal(back.num, "123");
  assert.equal(back.big, 12345678901234567890n);
  assert.equal(back.gr, "Καλή μέρα");
  assert.equal(back.colon, "a: b");
  assert.equal(back.hash, "x #y");
  assert.equal(back.nl, "two\nlines");
  assert.equal(back.n, null);
  assert.deepEqual(back.list, [1n, [2n, 3n], { k: "v", w: [] }, {}]);
  assert.equal(back.obj.deep.x, -1e-7);
  assert.match(y.text, /^ver: 6\.30$/m, "numbers as written");
  assert.match(y.text, /^gr: Καλή μέρα$/m, "Greek stays plain");
  assert.equal(D.jsonToYaml("[]", 2).text, "[]\n");
  assert.equal(D.jsonToYaml('"x"', 2).text, "x\n");
  assert.deepEqual(D.jsonToYaml('{"a":[1,', 2), { error: { line: 1, col: 9 } });
});

test("Format YAML keeps comments, anchors, quotes and number spellings", () => {
  const src = "# settings\nname:   'orOS'   # the name\nhex: 0x1F\nexp: 1e3\npi: 3.14159265358979323846\nbig: 12345678901234567890\n" +
    "base: &b {x: 1, y: \"q\"}\nuse: *b\nlist:\n    - a\n\n    - b  # second\n";
  const out = D.yamlFormat(Y, src, 2);
  assert.equal(out.text, "# settings\nname: 'orOS' # the name\nhex: 0x1F\nexp: 1e3\npi: 3.14159265358979323846\nbig: 12345678901234567890\n" +
    "base: &b {x: 1, y: \"q\"}\nuse: *b\nlist:\n  - a\n\n  - b # second\n");
  // Several documents stay several documents.
  assert.equal(D.yamlFormat(Y, "a: 1\n---\nb: 2\n", 2).text, "a: 1\n---\nb: 2\n");
  assert.deepEqual(D.yamlCheck(Y, "a: 1\n---\nb: 2\n"), { ok: true, docs: 2 });
  const bad = D.yamlCheck(Y, "a: 1\nb: [1, 2\nc: 3\n");
  assert.ok(bad.error && bad.error.line >= 2, JSON.stringify(bad));
  assert.ok(D.yamlFormat(Y, "a: b: c\n", 2).error, "invalid YAML is never rewritten");
  assert.ok(D.yamlCheck(Y, "key: value\n\tbad: tab\n").error, "tabs as indentation are an error");
});

test("YAML → JSON: numbers as written, aliases followed, comments and documents reported", () => {
  const r = D.yamlToJson(Y, "# c\nbase: &b {x: 1.50}\nuse: *b\nbig: 12345678901234567890\nhex: 0x1F\ninf: .inf\nyes: yes\n1: one\nlist: [a, null, true]\n", "  ");
  assert.equal(r.text, '{\n  "base": {\n    "x": 1.50\n  },\n  "use": {\n    "x": 1.50\n  },\n  "big": 12345678901234567890,\n  "hex": 31,\n  "inf": null,\n  "yes": "yes",\n  "1": "one",\n  "list": [\n    "a",\n    null,\n    true\n  ]\n}\n');
  assert.deepEqual(r.notes, { comments: true, docs: 1, inf: 1, keys: 0 });
  const two = D.yamlToJson(Y, "a: 1\n---\nb: 2\n", "");
  assert.equal(two.text, '[{"a":1},{"b":2}]\n');
  assert.equal(two.notes.docs, 2);
  assert.ok(D.yamlToJson(Y, "a: [\n", "").error);
  // An alias bomb stops instead of freezing the page.
  const bomb = "a: &a [x,x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\nd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]\n" +
    "e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]\nf: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e,*e]\ng: [*f,*f,*f,*f,*f,*f,*f,*f,*f,*f]\n";
  assert.ok(D.yamlToJson(Y, bomb, "").error);
});

test("the YAML library never builds objects from tags (no code, no class)", () => {
  const r = D.yamlToJson(Y, "a: !!js/function 'function(){}'\nb: !custom x\n", "");
  // Unknown tags stay plain values (with a warning in yaml), never code.
  assert.ok(r.error || /"a":"function\(\)\{\}"/.test(r.text), JSON.stringify(r));
  assert.ok(!Object.prototype.polluted);
  D.yamlToJson(Y, "__proto__: {polluted: 1}\n", "");
  assert.equal({}.polluted, undefined);
});

test("sniff suggests the tool for a colour, a time stamp or a number", () => {
  assert.equal(D.sniff("#ff8800"), "color");
  assert.equal(D.sniff("rgb(1 2 3)"), "color");
  assert.equal(D.sniff("1700000000"), "time");
  assert.equal(D.sniff("2026-11-13"), "time");
  assert.equal(D.sniff("0xFF"), "base");
  assert.equal(D.sniff("255"), "base");
  assert.equal(D.sniff("hello"), "");
  assert.equal(D.sniff("a\nb"), "");
});

// ----- Wave D2 -----
const JWT_IO = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const RFC7519 = "eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const seg = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

test("JWT decode: the jwt.io and RFC 7519 examples, times, Bearer and quotes", () => {
  const r = D.jwtDecode(JWT_IO, Date.UTC(2026, 10, 13));
  assert.equal(r.alg, "HS256");
  assert.equal(r.typ, "JWT");
  assert.equal(r.signed, true);
  assert.deepEqual(JSON.parse(r.payload), { sub: "1234567890", name: "John Doe", iat: 1516239022 });
  assert.match(r.header, /\n  "alg": "HS256"/, "formatted with two spaces");
  assert.deepEqual(r.times, [{ k: "iat", ms: 1516239022000 }]);
  assert.equal(r.expired, false);
  assert.equal(r.early, false);
  const x = D.jwtDecode(RFC7519, Date.UTC(2026, 0, 1));
  assert.equal(JSON.parse(x.payload)["http://example.com/is_root"], true);
  assert.equal(x.expired, true, "exp 1300819380 is in 2011");
  assert.equal(D.jwtDecode(RFC7519, 1300819379000).expired, false);
  assert.equal(D.jwtDecode("Bearer " + JWT_IO).alg, "HS256");
  assert.equal(D.jwtDecode('"' + JWT_IO + '"').alg, "HS256");
  const early = D.jwtDecode(seg({ alg: "none" }) + "." + seg({ nbf: 4102444800 }) + ".", Date.UTC(2026, 0, 1));
  assert.equal(early.early, true);
  assert.equal(early.signed, false, "alg none has an empty third part");
  const greek = D.jwtDecode(seg({ alg: "HS256" }) + "." + seg({ name: "Χρήστος" }) + ".x");
  assert.equal(JSON.parse(greek.payload).name, "Χρήστος", "UTF-8 payloads read right");
});

test("JWT decode refuses what is not a readable token, and never checks a signature", () => {
  assert.deepEqual(D.jwtDecode("hello"), { error: "parts" });
  assert.deepEqual(D.jwtDecode("a.b.c.d.e"), { error: "jwe" });
  assert.deepEqual(D.jwtDecode("!!.e30.x"), { error: "header" });
  assert.deepEqual(D.jwtDecode(seg({ alg: "HS256" }) + ".bm90IGpzb24.x"), { error: "payload" });
  assert.deepEqual(D.jwtDecode(seg([1, 2]) + "." + seg({}) + ".x"), { error: "header" }, "header must be an object");
  assert.deepEqual(D.jwtDecode(Buffer.from([0xff, 0xfe]).toString("base64url") + "." + seg({}) + ".x"), { error: "header" }, "bad UTF-8");
  const r = D.jwtDecode(seg({ alg: "HS256" }) + "." + seg({ exp: "tomorrow", iat: 1e15 }) + ".sig");
  assert.deepEqual(r.times, [], "times that are not plain seconds are left out");
  const src = read("pad/devtools.js") + read("pad/devui.js");
  assert.ok(!/subtle\.(verify|importKey)/.test(src), "decode only: no keys, no verification");
  assert.equal(D.sniff(JWT_IO), "jwt");
  assert.equal(D.sniff("Bearer " + JWT_IO), "jwt");
  assert.equal(D.looksJwt("eyJ.not"), false);
});

test("regexRun: matches, groups, named groups, flags, replace and limits", () => {
  const text = "2026-11-13 and 1999-01-02\nfoo";
  const r = D.regexRun("(\\d{4})-(?<m>\\d{2})-\\d{2}", "", text, undefined, 10000);
  assert.equal(r.count, 2);
  assert.deepEqual(r.matches[0], { i: 0, len: 10, text: "2026-11-13", groups: ["2026", "11"], named: { m: "11" } });
  assert.deepEqual(r.pos, [0, 10, 15, 10]);
  assert.equal(r.more, false);
  assert.equal(r.replaced, undefined);
  assert.equal(D.regexRun("(\\d{4})-(\\d{2})-(\\d{2})", "", text, "$3/$2/$1").replaced, "13/11/2026 and 02/01/1999\nfoo");
  assert.equal(D.regexRun("(?<y>\\d{4})", "", "x 2026", "[$<y>]").replaced, "x [2026]");
  assert.equal(D.regexRun("FOO", "", text).count, 0);
  assert.equal(D.regexRun("FOO", "i", text).count, 1);
  assert.equal(D.regexRun("^foo", "", text).count, 0);
  assert.equal(D.regexRun("^foo", "m", text).count, 1);
  assert.equal(D.regexRun("13.and", "", "13\nand").count, 0);
  assert.equal(D.regexRun("13.and", "s", "13\nand").count, 1);
  assert.equal(D.regexRun("^.$", "u", "😀").count, 1);
  assert.equal(D.regexFlags("gimsuyd"), "gimsu", "always global, only i m s u");
  assert.equal(D.regexRun("(a)|b", "", "b").matches[0].groups[0], null, "a group that took no part is null");
  // Empty matches move on (also past a surrogate pair with u) and end.
  assert.equal(D.regexRun("", "", "abc").count, 4);
  assert.equal(D.regexRun("", "u", "😀x").count, 3);
  assert.equal(D.regexRun("x*", "", "aaa").count, 4);
  const many = D.regexRun("a", "", "a".repeat(20000), undefined, 10000);
  assert.equal(many.count, 10000);
  assert.equal(many.more, true);
  assert.equal(many.matches.length, 200, "the list stops at 200");
  assert.equal(many.pos.length, 20000, "every match can still be selected");
  assert.ok(D.regexRun("(", "", "x").error, "a broken pattern is an error, not a throw");
});

test("the regex runs in a Worker that is stopped after a second", () => {
  const w = read("pad/regex-worker.js"), ui = read("pad/devui.js");
  assert.match(w, /^importScripts\("devtools\.js"\);/m);
  assert.match(w, /regexRun\(d\.pattern, d\.flags, d\.text, d\.replace, 10000\)/);
  assert.ok(!/fetch|XMLHttpRequest|importScripts\([^)]*http/.test(w), "the worker loads nothing else");
  assert.match(read("sw.js"), /"pad\/regex-worker\.js"/, "precached for offline use");
  assert.match(ui, /RX_MS = 1000/);
  assert.match(ui, /new Worker\("regex-worker\.js"/);
  assert.match(ui, /rxWorker\.terminate\(\)/);
  assert.match(ui, /closeDev[\s\S]{0,400}rxStop\(\)/, "closing the panel stops a run");
  assert.ok(!/new RegExp/.test(ui), "no pattern is ever run on the page itself");
});

test("Pad loads the tools lazily, precaches them, and shows results as text only", () => {
  const app = read("pad/app.js"), html = read("pad/index.html"), ui = read("pad/devui.js");
  assert.ok(!/devtools\.js|devui\.js|yaml\.min\.js/.test(html), "not on the first-open path");
  assert.match(app, /sc\.src = "devui\.js"/);
  assert.match(ui, /loadScript\("devtools\.js"/);
  assert.match(ui, /"\.\.\/vendor\/yaml\/yaml\.min\.js"/);
  const sw = read("sw.js"); assert.match(sw, /"pad\/devui\.js"/); assert.match(sw, /"pad\/devtools\.js"/); assert.match(sw, /"vendor\/yaml\/yaml\.min\.js"/);
  assert.ok(!/innerHTML/.test(ui), "results never go through innerHTML");
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|indexedDB/.test(ui + read("pad/devtools.js")), "nothing is sent or kept");
  assert.match(app, /e\.code === "KeyT"/, "Alt+T opens the tools");
  assert.match(app, /function basicTools\(\)/, "the old list still works if devui.js cannot load");
  assert.ok(fs.existsSync(path.join(ROOT, "vendor/yaml/LICENSE")));
  assert.match(read("CREDITS.md"), /\[yaml\]\(https:\/\/eemeli\.org\/yaml\/\)/);
});

test("every new string is in English, Greek and German", () => {
  const ui = read("pad/devui.js"), de = read("i18n/de/pad.js"), app = read("pad/app.js");
  const body = ui.slice(ui.indexOf("window.PadDevUI"));
  const keys = [...new Set([...body.matchAll(/[^\w.]t\("([a-zA-Z0-9.]+)"/g)].map((m) => m[1]).filter((k) => !k.endsWith(".")))];
  const extra = ["ts.u.s", "ts.u.ms", "ts.u.us", "ts.u.ns", "ts.u.date", "ts.local", "ts.isoLocal", "ts.isoUtc", "ts.unixS", "ts.unixMs", "ts.rel",
    "nb.dec", "nb.hex", "nb.bin", "nb.oct", "nb.eel2",
    "jwt.jwe", "jwt.bad", "jwt.early", "jwt.valid", "jwt.noTimes", "jwt.unchecked", "jwt.unsigned", "jwt.iat", "jwt.nbf", "jwt.exp",
    "rx.countMore", "rx.fi", "rx.fm", "rx.fs", "rx.fu"];
  const en = ui.slice(ui.indexOf("en: {"), ui.indexOf("el: {")), el = ui.slice(ui.indexOf("el: {"), ui.indexOf("window.PadDevUI"));
  const appEn = app.slice(app.indexOf("en: {"), app.indexOf("el: {")), appEl = app.slice(app.indexOf("el: {"));
  assert.ok(keys.length > 40);
  for (const k of keys.concat(extra)) {
    const q = '"' + k + '":';
    assert.ok(en.includes(q) || appEn.includes(q), "en " + k);
    assert.ok(el.includes(q) || appEl.includes(q), "el " + k);
    assert.ok(de.includes(q), "de " + k);
  }
  for (const k of ["aria.dev"]) for (const part of [appEn, appEl, de]) assert.ok(part.includes('"' + k + '":'), k);
});
