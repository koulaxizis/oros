// QR Generator: the encoder (qr/qr-encode.js), the content formats
// (qr/qr-payload.js) and the saved-code merge (sync slice "qr").
// Run: node --test tests/
//
// Every code the encoder makes is read back by an independent
// decoder, jsQR 1.4.0 (Apache-2.0, tests/vendor/, never shipped with
// the app). jsQR's table has one known error: the alignment pattern
// centres of version 23 read 74 where ISO/IEC 18004 Annex E says 78.
// The copy loaded here gets that one number corrected; the encoder is
// checked against the full Annex E table below.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const Q = require(path.join(root, "qr/qr-encode.js"));
const P = require(path.join(root, "qr/qr-payload.js"));

const jsQR = (() => {
  const src = fs.readFileSync(path.join(__dirname, "vendor/jsQR.js"), "utf8");
  const fixed = src.replace("[6, 30, 54, 74, 102]", "[6, 30, 54, 78, 102]");
  assert.notEqual(fixed, src, "jsQR version-23 patch point not found");
  const m = { exports: {} };
  new Function("module", "exports", fixed)(m, m.exports);
  return m.exports;
})();

// Rasterise the drawing ops (the same ones the SVG and canvas use)
// to an RGBA bitmap, `px` pixels per module.
function raster(sh, px) {
  const W = Math.ceil(sh.w * px), H = Math.ceil(sh.h * px);
  const d = new Uint8ClampedArray(W * H * 4).fill(255);
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) { const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = c; } };
  const inRect = (u, v, r) => {
    const [x, y, w, h, rr] = r;
    if (u < x || u > x + w || v < y || v > y + h) return false;
    if (!rr) return true;
    const cx = Math.min(Math.max(u, x + rr), x + w - rr), cy = Math.min(Math.max(v, y + rr), y + h - rr);
    return (u - cx) ** 2 + (v - cy) ** 2 <= rr * rr + 1e-9;
  };
  for (const r of sh.rects) {
    const c = r[5] === "bg" ? 255 : 0;
    for (let y = Math.floor(r[1] * px); y < Math.ceil((r[1] + r[3]) * px); y++)
      for (let x = Math.floor(r[0] * px); x < Math.ceil((r[0] + r[2]) * px); x++)
        if (inRect((x + 0.5) / px, (y + 0.5) / px, r)) set(x, y, c);
  }
  for (const [cx, cy, rr] of sh.dots) {
    for (let y = Math.floor((cy - rr) * px); y < (cy + rr) * px; y++)
      for (let x = Math.floor((cx - rr) * px); x < (cx + rr) * px; x++)
        if (((x + 0.5) / px - cx) ** 2 + ((y + 0.5) / px - cy) ** 2 <= rr * rr) set(x, y, 0);
  }
  return { d, W, H };
}
function decode(qr, opts, px) {
  const { d, W, H } = raster(Q.shapes(qr, opts || {}), px || 4);
  const r = jsQR(d, W, H);
  return r ? r.data : null;
}
function roundTrip(text, ecl, opts, px) {
  const qr = Q.encode(text, { ecl });
  assert.equal(decode(qr, opts, px), text, `${ecl} v${qr.version} ${JSON.stringify(text).slice(0, 40)}`);
  return qr;
}

// ---------- Encoder ----------

test("every version 1–40 at every level reads back (independent decoder)", () => {
  const ints = Q._internal;
  for (const ecl of "LMQH") {
    for (let v = 1; v <= 40; v++) {
      // The longest byte text that still fits version v.
      const cap = ints.dataCodewords(v, "LMQH".indexOf(ecl));
      const n = cap - 2 - (v > 9 ? 1 : 0);
      const text = Array.from({ length: n }, (_, i) => String.fromCharCode(97 + (i * 7 + v) % 26)).join("");
      const qr = roundTrip(text, ecl, null, v > 20 ? 2 : 3);
      assert.equal(qr.version, v, `${ecl} ${n} bytes`);
      assert.equal(qr.size, v * 4 + 17);
      if (v < 40) assert.equal(Q.encode(text + "x", { ecl }).version, v + 1);
      else assert.throws(() => Q.encode(text + "x", { ecl }), (e) => e.code === "TOO_LONG");
    }
  }
});

test("capacities match ISO/IEC 18004 (byte, numeric, alphanumeric)", () => {
  const fits = (text, ecl, v) => Q.measure(text, ecl).version === v;
  // [mode char, ecl, version, max characters]
  const rows = [["a", "L", 1, 17], ["a", "M", 1, 14], ["a", "Q", 1, 11], ["a", "H", 1, 7],
                ["a", "M", 10, 213], ["a", "L", 40, 2953], ["a", "H", 40, 1273],
                ["7", "L", 1, 41], ["7", "L", 40, 7089], ["7", "H", 40, 3057],
                ["A", "L", 1, 25], ["A", "L", 40, 4296], ["A", "Q", 40, 2420]];
  for (const [ch, ecl, v, max] of rows) {
    assert.ok(fits(ch.repeat(max), ecl, v), `${ch} ${ecl} v${v} holds ${max}`);
    const next = Q.measure(ch.repeat(max + 1), ecl).version;
    assert.ok(next === null || next > v, `${ch} ${ecl} v${v} overflows at ${max + 1}`);
  }
  assert.throws(() => Q.encode("a".repeat(2954), { ecl: "L" }), (e) => e.code === "TOO_LONG");
  assert.equal(Q.measure("a".repeat(2954), "L").version, null);
});

test("alignment pattern centres follow Annex E for all 40 versions", () => {
  const E = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42],
    9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66],
    15: [6, 26, 48, 70], 16: [6, 26, 50, 74], 17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86],
    20: [6, 34, 62, 90], 21: [6, 28, 50, 72, 94], 22: [6, 26, 50, 74, 98], 23: [6, 30, 54, 78, 102],
    24: [6, 28, 54, 80, 106], 25: [6, 32, 58, 84, 110], 26: [6, 30, 58, 86, 114], 27: [6, 34, 62, 90, 118],
    28: [6, 26, 50, 74, 98, 122], 29: [6, 30, 54, 78, 102, 126], 30: [6, 26, 52, 78, 104, 130],
    31: [6, 30, 56, 82, 108, 134], 32: [6, 34, 60, 86, 112, 138], 33: [6, 30, 58, 86, 114, 142],
    34: [6, 34, 62, 90, 118, 146], 35: [6, 30, 54, 78, 102, 126, 150], 36: [6, 24, 50, 76, 102, 128, 154],
    37: [6, 28, 54, 80, 106, 132, 158], 38: [6, 32, 58, 84, 110, 136, 162], 39: [6, 26, 54, 82, 110, 138, 166],
    40: [6, 30, 58, 86, 114, 142, 170] };
  for (let v = 1; v <= 40; v++) assert.deepEqual(Q._internal.alignPositions(v, v * 4 + 17), E[v], `v${v}`);
});

test("modes: numeric, alphanumeric and UTF-8 bytes (Greek, emoji)", () => {
  assert.equal(Q.encode("0123456789").mode, "numeric");
  assert.equal(Q.encode("HELLO WORLD $%*+-./:").mode, "alnum");
  assert.equal(Q.encode("hello").mode, "byte");
  for (const t of ["0", "01234567890123456789", "A", "HTTPS://USEOROS.ONLINE", "Καλημέρα κόσμε",
                   "👋 emoji 🇬🇷", "mixed ΑΒΓ abc 123", "\u0000\u007fÿ"]) roundTrip(t, "M");
  assert.deepEqual(Q._internal.utf8("é€😀"), [0xC3, 0xA9, 0xE2, 0x82, 0xAC, 0xF0, 0x9F, 0x98, 0x80]);
  assert.deepEqual(Q._internal.utf8("\uD800x"), [0xEF, 0xBF, 0xBD, 0x78]);     // lone surrogate → U+FFFD
});

test("round dots, margins and pixel sizes still read back", () => {
  const texts = ["https://useoros.online/", "WIFI:T:WPA;S:Home;P:password1;;", "x".repeat(300),
                 "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;John;;;\r\nFN:John Doe\r\nEND:VCARD"];
  for (const t of texts) for (const ecl of "LMQH") for (const px of [3, 4, 5, 6, 7.5, 8, 10, 12]) {
    roundTrip(t, ecl, { round: true }, px);
  }
  for (const mg of [1, 4, 10]) roundTrip("margin " + mg, "M", { margin: mg }, 4);
  const sh = Q.shapes(Q.encode("x"), { margin: 99 });
  assert.equal(sh.margin, 10);
});

test("encoding is deterministic and picks the lowest-penalty mask", () => {
  const a = Q.encode("https://useoros.online/", { ecl: "Q" }), b = Q.encode("https://useoros.online/", { ecl: "Q" });
  assert.deepEqual(a.modules, b.modules);
  assert.ok(a.mask >= 0 && a.mask < 8);
  assert.equal(Q.encode("x", { ecl: "nope" }).ecl, "M");
});

test("SVG: numbers only, caption escaped, colours validated", () => {
  const qr = Q.encode("https://useoros.online/");
  const svg = Q.svg(qr, { caption: '<script>alert(1)</script> & "x"', fg: "#123456", bg: "javascript:x" });
  assert.ok(!svg.includes("<script"));
  assert.ok(svg.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;"));
  assert.ok(svg.includes('fill="#123456"'));
  assert.ok(svg.includes('fill="#ffffff"'));                                  // bad colour → default
  // Outside the caption every attribute value is a number, a colour or a fixed keyword.
  const body = svg.replace(/<text[\s\S]*<\/text>/, "");
  for (const [, v] of body.matchAll(/="([^"]*)"/g)) {
    assert.match(v, /^([-\d. MhvzaA]+|#[0-9a-f]{6}|100%|crispEdges|middle|1\.0|UTF-8|http:\/\/www\.w3\.org\/2000\/svg|1\.1)$/, v);
  }
  const round = Q.svg(qr, { round: true });
  assert.equal((round.match(/<path /g) || []).length, 2);                    // runs and dots apart (no winding holes)
  assert.ok(!round.includes("crispEdges"));
});

// ---------- Content formats ----------

const build = (type, f) => P.build(type, f);

test("URL: https added, only http/https, no spaces", () => {
  assert.deepEqual(build("url", { url: "useoros.online/apps" }), { text: "https://useoros.online/apps" });
  assert.deepEqual(build("url", { url: "  HTTP://a.b/c?d=1#e " }), { text: "HTTP://a.b/c?d=1#e" });
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://a.b", "http://", "a b.com", "https://nodot", "file:///etc"]) {
    assert.ok(build("url", { url: bad }).error, bad);
  }
  assert.equal(build("url", {}).error, "need.url");
  assert.ok(build("url", { url: "http://localhost:8080/x" }).text);
  assert.deepEqual(build("url", { url: "useoros.online:8080/x" }), { text: "https://useoros.online:8080/x" });
});

test("WiFi: escaping, security types, hidden flag", () => {
  assert.equal(build("wifi", { ssid: 'My;Net,"1":\\', pass: "p;a:s,s\"w\\rd", sec: "WPA", hidden: true }).text,
    'WIFI:T:WPA;S:My\\;Net\\,\\"1\\"\\:\\\\;P:p\\;a\\:s\\,s\\"w\\\\rd;H:true;;');
  assert.equal(build("wifi", { ssid: "Cafe", sec: "nopass", pass: "ignored" }).text, "WIFI:T:nopass;S:Cafe;;");
  assert.equal(build("wifi", { ssid: "Old", sec: "WEP", pass: "12345" }).text, "WIFI:T:WEP;S:Old;P:12345;;");
  assert.equal(build("wifi", { ssid: "", pass: "12345678" }).error, "need.ssid");
  assert.equal(build("wifi", { ssid: "a", pass: "" }).error, "need.pass");
  assert.equal(build("wifi", { ssid: "a", pass: "short" }).error, "bad.pass");
  assert.equal(build("wifi", { ssid: "a", pass: "12345678", sec: "EVIL" }).text, "WIFI:T:WPA;S:a;P:12345678;;");
});

test("vCard 3.0: fields, escaping, a name or company is required", () => {
  const t = build("vcard", { first: "Μαρία", last: "Π.", org: "Acme; Ltd", title: "CEO, CTO", mobile: "+30 69",
    email: "m@x.gr", web: "acme.gr", street: "Ερμού 1", city: "Αθήνα", zip: "10563", country: "Ελλάδα",
    note: "a\nb\\c" }).text;
  assert.equal(t, ["BEGIN:VCARD", "VERSION:3.0", "N:Π.;Μαρία;;;", "FN:Μαρία Π.", "ORG:Acme\\; Ltd",
    "TITLE:CEO\\, CTO", "TEL;TYPE=CELL:+30 69", "EMAIL;TYPE=INTERNET:m@x.gr", "ADR:;;Ερμού 1;Αθήνα;;10563;Ελλάδα",
    "URL:https://acme.gr", "NOTE:a\\nb\\\\c", "END:VCARD"].join("\r\n"));
  assert.equal(build("vcard", { org: "Only Co" }).text.split("\r\n")[3], "FN:Only Co");
  assert.equal(build("vcard", { note: "x" }).error, "need.name");
  roundTrip(t, "M");
});

test("event: timed, all-day, multi-day, validation", () => {
  assert.equal(build("event", { title: "Meet, now", date: "2026-10-09", start: "10:00", end: "11:30", location: "A;B", note: "x\ny" }).text,
    ["BEGIN:VEVENT", "SUMMARY:Meet\\, now", "DTSTART:20261009T100000", "DTEND:20261009T113000",
     "LOCATION:A\\;B", "DESCRIPTION:x\\ny", "END:VEVENT"].join("\r\n"));
  assert.equal(build("event", { title: "Trip", date: "2026-12-30", dateEnd: "2027-01-02", allDay: true }).text,
    ["BEGIN:VEVENT", "SUMMARY:Trip", "DTSTART;VALUE=DATE:20261230", "DTEND;VALUE=DATE:20270103", "END:VEVENT"].join("\r\n"));
  assert.ok(!build("event", { title: "x", date: "2026-10-09", start: "09:00" }).text.includes("DTEND"));
  assert.equal(build("event", { title: "x", date: "2026-10-09", start: "10:00", end: "09:00" }).error, "bad.end");
  assert.equal(build("event", { title: "x", date: "2026-10-09", start: "23:00", dateEnd: "2026-10-10", end: "01:00" }).text.split("\r\n")[3],
    "DTEND:20261010T010000");
  assert.equal(build("event", { title: "x", date: "2026-10-09", dateEnd: "2026-10-08", allDay: true }).error, "bad.end");
  assert.equal(build("event", { title: "x", date: "2026-02-30", allDay: true }).error, "need.date");
  assert.equal(build("event", { title: "x", date: "2026-10-09" }).error, "need.time");
  assert.equal(build("event", { title: "x", date: "2026-10-09", start: "24:00" }).error, "need.time");
  assert.equal(build("event", { date: "2026-10-09", allDay: true }).error, "need.title");
});

test("email, phone, SMS, location, text", () => {
  assert.equal(build("email", { to: "a@b.co", subject: "Γεια & χαρά", body: "1\n2" }).text,
    "mailto:a@b.co?subject=" + encodeURIComponent("Γεια & χαρά") + "&body=1%0A2");
  assert.equal(build("email", { to: "a@b.co" }).text, "mailto:a@b.co");
  for (const bad of ["a@b", "a b@c.d", "a@b.c?x=1&y", "<a@b.c>"]) assert.equal(build("email", { to: bad }).error, "bad.email", bad);
  assert.equal(build("phone", { number: "+30 (210) 555-12.34" }).text, "tel:+302105551234");
  assert.equal(build("phone", { number: "call me" }).error, "bad.number");
  assert.equal(build("phone", { number: "+30;ext" }).error, "bad.number");
  assert.equal(build("sms", { number: "6900000000", message: " Hi \n there " }).text, "SMSTO:6900000000:Hi \n there");
  assert.equal(build("geo", { lat: "37,9715", lon: "-23.7257" }).text, "geo:37.9715,-23.7257");
  assert.equal(build("geo", { lat: "91", lon: "0" }).error, "bad.geo");
  assert.equal(build("geo", { lat: "1e3", lon: "0" }).error, "bad.geo");
  assert.equal(build("geo", {}).error, "need.geo");
  assert.deepEqual(build("text", { text: "  keep  spaces " }), { text: "  keep  spaces " });
  assert.equal(build("text", { text: "   " }).error, "need.text");
  assert.equal(build("nope", {}).error, "bad.type");
});

test("normFields: known keys only, capped, coerced", () => {
  const f = P.normFields("wifi", { ssid: "x".repeat(50), pass: 5, sec: "SAE", hidden: "true", evil: "<b>" });
  assert.deepEqual(f, { ssid: "x".repeat(32), pass: "", sec: "WPA", hidden: false });
  assert.deepEqual(P.normFields("event", { date: "2026-13-01", start: "7:00", allDay: true }).date, "");
  assert.equal(P.normFields("text", { text: "a\r\nb" }).text, "a\nb");
  assert.equal(P.normFields("bad", {}), null);
  for (const ty of P.TYPES) assert.deepEqual(Object.keys(P.normFields(ty, {})), Object.keys(P.FIELDS[ty]), ty);
});

test("captions, file names, contrast", () => {
  assert.equal(P.caption("wifi", { ssid: "Home" }), "Home");
  assert.equal(P.caption("url", { url: "https://www.useoros.online/x" }), "useoros.online");
  assert.equal(P.caption("vcard", { org: "Acme" }), "Acme");
  assert.equal(P.fileStem("wifi", { ssid: "Σπίτι / 5G" }), "qr-wifi-Σπίτι-5G");
  assert.equal(P.fileStem("text", { text: "x" }), "qr-text");
  assert.equal(P.fileStem("url", { url: "../../etc/passwd" }), "qr-url");
  assert.equal(P.contrast("#000000", "#ffffff"), "ok");
  assert.equal(P.contrast("#ffffff", "#000000"), "inverted");
  assert.equal(P.contrast("#777777", "#999999"), "low");
});

// ---------- Saved codes (sync slice "qr") ----------
// The app is a browser IIFE: the constants and section 2 are cut out
// of the source and evaluated with the two modules as `window`.
const appSrc = fs.readFileSync(path.join(root, "qr/qr.js"), "utf8");
function block(from, to) {
  const i = appSrc.indexOf(from), j = appSrc.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return appSrc.slice(i, j);
}
const A = new Function("window",
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Look", "  // ---------- 3. Storage") +
  "\nreturn { normStyle, normSaved, mergeQR, DEFAULT_STYLE };")({ orosQR: Q, orosQRPayload: P });

const ID = "abc123def";
const code = (id, m, name, extra) => Object.assign({ id, m, name, type: "url", f: { url: "a.b" }, st: {} }, extra || {});
const data = (codes, tombs) => ({ ver: 1, codes: codes || [], tombs: tombs || {} });

test("normSaved / normStyle: bad codes dropped, look clamped", () => {
  assert.equal(A.normSaved(code("x", 1, "A")), null);
  assert.equal(A.normSaved(code(ID, 1, " ")), null);
  assert.equal(A.normSaved(code(ID, 1, "A", { type: "evil" })), null);
  const x = A.normSaved(code(ID, 1, "  Site  " + "x".repeat(60), { f: { url: "a.b", js: "x" }, st: { ecl: "Z", fg: "#ABCDEF", bg: "red", mg: 50, rd: 1, ct: "c".repeat(80) } }));
  assert.equal(x.name.length, 40);
  assert.deepEqual(x.f, { url: "a.b" });
  assert.deepEqual(x.st, { ecl: "M", fg: "#abcdef", bg: "#ffffff", mg: 4, rd: false, cap: false, ct: "c".repeat(40) });
  assert.deepEqual(A.normStyle(null), A.DEFAULT_STYLE);
});

test("mergeQR: symmetric, associative, idempotent, canonical, inputs untouched", () => {
  const X = data([code("aaaaaa1", 10, "One"), code("bbbbbb2", 20, "Two")]);
  const Y = data([code("aaaaaa1", 15, "One", { type: "wifi", f: { ssid: "N", pass: "12345678" } }), code("cccccc3", 5, "Three")], { bbbbbb2: 19 });
  const Z = data([code("dddddd4", 7, "Four")], { cccccc3: 6 });
  const sx = JSON.stringify(X), sy = JSON.stringify(Y);
  const xy = A.mergeQR(X, Y);
  assert.deepEqual(xy, A.mergeQR(Y, X));
  assert.deepEqual(A.mergeQR(A.mergeQR(X, Y), Z), A.mergeQR(X, A.mergeQR(Y, Z)));
  assert.deepEqual(A.mergeQR(xy, xy), xy);
  assert.equal(JSON.stringify(X), sx);
  assert.equal(JSON.stringify(Y), sy);
  assert.deepEqual(xy.codes.map((c) => c.id), ["aaaaaa1", "bbbbbb2", "cccccc3"]);
  assert.equal(xy.codes[0].type, "wifi");                                     // newer m wins
  assert.equal(xy.codes[0].f.pass, "12345678");                               // WiFi passwords sync (Chris, 2026-10-08)
});

test("mergeQR: tombstones win ties, a newer edit resurrects, equal mtime agrees", () => {
  const live = data([code(ID, 100, "Site")]);
  assert.deepEqual(A.mergeQR(live, data([], { [ID]: 100 })).codes, []);
  assert.equal(A.mergeQR(live, data([], { [ID]: 99 })).codes.length, 1);
  const X = data([code(ID, 10, "Alpha")]), Y = data([code(ID, 10, "Beta")]);
  assert.deepEqual(A.mergeQR(X, Y), A.mergeQR(Y, X));
  assert.deepEqual(A.mergeQR({ codes: [null, 3, { id: ID }], tombs: { "BAD ID": 1, [ID]: -2 } }, undefined),
    { ver: 1, codes: [], tombs: {} });
});
