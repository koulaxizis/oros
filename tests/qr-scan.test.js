// QR Generator wave 19: styled codes (dot / corner styles, logo), what a
// scanned code says (qr/qr-scan.js), recent scans, and many codes from
// a CSV (qr/qr-bulk.js). Run: node --test tests/
//
// Styled codes are read back by jsQR (the copy the app loads on
// browsers without BarcodeDetector, vendor/jsqr/, Apache-2.0).

"use strict";

process.env.TZ = "Europe/Athens";     // UTC event times become local ones

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const Q = require(path.join(root, "qr/qr-encode.js"));
const P = require(path.join(root, "qr/qr-payload.js"));
const S = require(path.join(root, "qr/qr-scan.js"));
const B = require(path.join(root, "qr/qr-bulk.js"));

const jsQR = (() => {
  const m = { exports: {} };
  new Function("module", "exports", fs.readFileSync(path.join(root, "vendor/jsqr/jsQR.js"), "utf8"))(m, m.exports);
  return m.exports;
})();

// Same rasteriser as tests/qr.test.js; `blot` paints a dark pattern
// over the logo square (a worst-case dark logo).
function raster(sh, px, blot) {
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
  if (blot && sh.logo) {
    const L = sh.logo;
    for (let y = Math.floor((L.y + 0.5) * px); y < (L.y + L.h - 0.5) * px; y++)
      for (let x = Math.floor((L.x + 0.5) * px); x < (L.x + L.w - 0.5) * px; x++)
        if ((x + y) % 7 < 3) set(x, y, 0);
  }
  return { d, W, H };
}
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

// ---------- Encoder v1.1 ----------

test("encoder v1.0 calls give exactly the v1.0 drawing (Health, Certificates, Invoices… unchanged)", () => {
  // hashes taken from qr-encode.js v1.0.0 before the styles were added
  const cases = [
    ["https://oros.example/x", {}, "6be94f9a2c9aaadb", "322c571b8e1fb3c4"],
    ["https://oros.example/x", { round: true }, "d796c38ca68c7854", "8fd79f05c3c7e9c5"],
    ["WIFI:T:WPA;S:Home;P:12345678;;", { round: true, margin: 2, fg: "#112233", caption: "Home" }, "5a2a710083614c80", "e398aa1456ae5a88"],
    ["Γειά σου κόσμε 123", { ecl: "H", margin: 0 }, "069fae7c55276495", "f1e5dd06d5cf4088"],
    ["X".repeat(300), { ecl: "Q", round: true }, "133f334f1c9515f5", "ccea09fb3c2bb22c"]
  ];
  for (const [text, o, svgHash, opsHash] of cases) {
    const qr = Q.encode(text, { ecl: o.ecl || "M" });
    assert.equal(sha(Q.svg(qr, o)), svgHash, "svg " + JSON.stringify(o));
    assert.equal(sha(JSON.stringify(Q.shapes(qr, o))), opsHash, "ops " + JSON.stringify(o));
  }
  // explicit styles equal to the v1.0 meaning give the same ops
  const qr = Q.encode("same", { ecl: "M" });
  assert.deepEqual(Q.shapes(qr, { dot: "square", eye: "square" }), Q.shapes(qr, {}));
  assert.deepEqual(Q.shapes(qr, { dot: "rounded", eye: "rounded" }), Q.shapes(qr, { round: true }));
  assert.equal(Q.shapes(qr, {}).logo, undefined);
});

test("every dot × corner style, with and without a logo, reads back (versions 1–40)", () => {
  for (const dot of Q.DOT_STYLES) for (const eye of Q.EYE_STYLES) for (const logo of [0, 0.22, 0.25])
    for (const v of [1, 2, 4, 7, 12, 20, 27, 40]) {
      const ecl = logo ? "H" : "M";
      const cap = Q._internal.dataCodewords(v, "LMQH".indexOf(ecl));
      const n = cap - 2 - (v > 9 ? 1 : 0);
      const text = Array.from({ length: n }, (_, i) => String.fromCharCode(97 + (i * 5 + v) % 26)).join("");
      const qr = Q.encode(text, { ecl });
      assert.equal(qr.version, v);
      const { d, W, H } = raster(Q.shapes(qr, { dot, eye, logo }), v > 20 ? 3 : 4, true);
      const r = jsQR(d, W, H);
      assert.equal(r && r.data, text, `${dot}/${eye}/logo ${logo} v${v}`);
    }
});

test("logo box: centred, odd, capped at 25%, its modules left out", () => {
  assert.equal(Q.logoBox(21, 0), null);
  assert.equal(Q.logoBox(21, "x"), null);
  for (let v = 1; v <= 40; v++) {
    const s = v * 4 + 17, b = Q.logoBox(s, 0.22);
    assert.equal(b.n % 2, 1);
    assert.equal(b.x * 2 + b.n, s);
    assert.ok(b.n <= Math.round(s * 0.25) + 1);
    assert.deepEqual(Q.logoBox(s, 0.9), Q.logoBox(s, 0.25));
  }
  const qr = Q.encode("logo test", { ecl: "H" });
  const sh = Q.shapes(qr, { logo: 0.22, margin: 2 }), L = sh.logo;
  for (const r of sh.rects) {
    if (r[2] === 7 || r[2] === 5 || r[2] === 3) continue;                       // eyes
    assert.ok(r[0] + r[2] <= L.x || r[0] >= L.x + L.w || r[1] + r[3] <= L.y || r[1] >= L.y + L.h, "rect under the logo");
  }
  const dots = Q.shapes(qr, { logo: 0.22, dot: "dots" });
  for (const [cx, cy] of dots.dots) {
    assert.ok(!(cx > dots.logo.x && cx < dots.logo.x + dots.logo.w && cy > dots.logo.y && cy < dots.logo.y + dots.logo.h));
  }
});

test("SVG: logo only as a base64 PNG/JPEG/WebP/GIF data URL; non-square styles not crisp", () => {
  const qr = Q.encode("https://useoros.online/", { ecl: "H" });
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const s = Q.svg(qr, { logo: 0.22, logoSrc: png });
  assert.equal((s.match(/<image /g) || []).length, 1);
  assert.ok(s.includes('href="' + png + '"'));
  for (const bad of ["data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", 'data:image/png;base64,AA"/><script>',
                     "https://evil.example/x.png", "data:image/png,raw", "data:image/png;base64," + "A".repeat(400001)]) {
    assert.ok(!Q.svg(qr, { logo: 0.22, logoSrc: bad }).includes("<image"), bad.slice(0, 40));
    assert.equal(Q.logoSrcOk(bad), false);
  }
  assert.ok(!Q.svg(qr, { logoSrc: png }).includes("<image"), "no box, no picture");
  assert.ok(!Q.svg(qr, { dot: "dots" }).includes("crispEdges"));
  assert.ok(!Q.svg(qr, { eye: "circle" }).includes("crispEdges"));
  assert.ok(Q.svg(qr, { dot: "square", eye: "square" }).includes("crispEdges"));
});

// ---------- What a scanned code says ----------

test("scan: links are http/https only, shown with their host", () => {
  const u = S.parse("https://Example.COM/a?b=1#c");
  assert.equal(u.kind, "url");
  assert.equal(u.url, "https://Example.COM/a?b=1#c");
  assert.equal(u.host, "example.com");
  assert.deepEqual(u.gen, { type: "url", fields: { url: "https://Example.COM/a?b=1#c" } });
  assert.equal(S.parse("http://user@host.example:8080/x").host, "host.example");
  for (const t of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>", "file:///etc/passwd",
                   "ftp://a.b/c", "intent://x#Intent;end", "https://", "https://a b.com", "vbscript:x"]) {
    assert.equal(S.parse(t).kind, "text", t);
  }
  assert.equal(S.parse("  https://a.example/x \n").kind, "url");
});

test("scan: WiFi with escapes, open networks, hidden flag", () => {
  const w = S.parse("WIFI:T:WPA;S:My\\;Net\\:1;P:pa\\\\ss\\,w;H:true;;");
  assert.deepEqual([w.kind, w.ssid, w.pass, w.sec, w.hidden], ["wifi", "My;Net:1", "pa\\ss,w", "WPA", true]);
  const o = S.parse("WIFI:S:Cafe;T:nopass;P:;;");
  assert.deepEqual([o.sec, o.pass], ["nopass", ""]);
  assert.equal(S.parse("WIFI:S:Old;T:WEP;P:abcde;;").sec, "WEP");
  assert.equal(S.parse("WIFI:T:WPA;P:x;;").kind, "text");                    // no network name
  // what our own generator writes reads back the same
  const f = { ssid: 'Σπίτι "5G"; a,b', pass: "p;a:s,s\\w0rd", sec: "WPA", hidden: true };
  const back = S.parse(P.build("wifi", f).text);
  assert.deepEqual(back.gen.fields, f);
});

test("scan: vCard and MECARD become a vCard for Contacts", () => {
  const made = P.build("vcard", { first: "Γιώργος", last: "Παπάς", org: "Acme, Inc.", mobile: "+30 690 000 0000",
                                  email: "g@p.gr", street: "Οδός 1", city: "Αθήνα", zip: "10558", country: "GR", note: "a;b\nc" }).text;
  const v = S.parse(made);
  assert.equal(v.kind, "vcard");
  assert.equal(v.vcf, made);
  assert.equal(v.name, "Γιώργος Παπάς");
  assert.equal(v.org, "Acme, Inc.");
  assert.deepEqual(v.phones, ["+30 690 000 0000"]);
  assert.equal(v.gen.fields.city, "Αθήνα");
  assert.equal(v.gen.fields.note, "a;b\nc");
  // folded lines, item. prefixes, several numbers
  const folded = S.parse("BEGIN:VCARD\nVERSION:3.0\nFN:Jane\n  Doe\nitem1.TEL;TYPE=WORK:+1 555\nTEL;TYPE=CELL:+1 777\nEND:VCARD");
  assert.equal(folded.name, "Jane Doe");
  assert.deepEqual(folded.phones, ["+1 555", "+1 777"]);
  assert.equal(folded.gen.fields.mobile, "+1 777");
  const m = S.parse("MECARD:N:Doe,John;TEL:+301234;TEL:+305678;EMAIL:j@d.com;ORG:Acme\\;Co;URL:https://d.example;;");
  assert.equal(m.kind, "vcard");
  assert.match(m.vcf, /^BEGIN:VCARD\r\nVERSION:3\.0\r\nN:Doe;John;;;\r\nFN:John Doe\r\nORG:Acme\\;Co\r\n/);
  assert.deepEqual(m.phones, ["+301234", "+305678"]);
  assert.equal(S.parse("MECARD:;;").kind, "text");
});

test("scan: VEVENT (and VCALENDAR) -> Calendar's New event payload", () => {
  const timed = S.parse(P.build("event", { title: "Meet, now", date: "2026-10-20", start: "10:00", end: "11:30",
                                            location: "Office; 2nd floor", note: "Bring\nlaptop" }).text);
  assert.deepEqual(S.calendarPayload(timed), { date: "2026-10-20", title: "Meet, now", location: "Office; 2nd floor",
                                               note: "Bring\nlaptop", start: "10:00", end: "11:30" });
  const allDay = S.parse("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Trip\r\nDTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261023\r\nEND:VEVENT\r\nEND:VCALENDAR");
  assert.deepEqual(S.calendarPayload(allDay), { date: "2026-10-20", title: "Trip", dateEnd: "2026-10-22" });
  const oneDay = S.parse("BEGIN:VEVENT\nSUMMARY:Day\nDTSTART;VALUE=DATE:20261020\nDTEND;VALUE=DATE:20261021\nEND:VEVENT");
  assert.deepEqual(S.calendarPayload(oneDay), { date: "2026-10-20", title: "Day" });
  const utc = S.parse("BEGIN:VEVENT\nSUMMARY:UTC\nDTSTART:20261020T220000Z\nDTEND:20261020T230000Z\nEND:VEVENT");
  assert.deepEqual([utc.date, utc.start, utc.end], ["2026-10-21", "01:00", "02:00"]);          // Athens, UTC+3
  const night = S.parse("BEGIN:VEVENT\nSUMMARY:N\nDTSTART;TZID=Europe/Athens:20261020T230000\nDTEND:20261021T010000\nEND:VEVENT");
  assert.deepEqual(S.calendarPayload(night), { date: "2026-10-20", title: "N", start: "23:00", end: "01:00", dateEnd: "2026-10-21" });
  assert.equal(S.parse("BEGIN:VEVENT\nSUMMARY:x\nDTSTART:20261340\nEND:VEVENT").kind, "text");  // no such date
  assert.equal(S.parse("BEGIN:VEVENT\nSUMMARY:x\nEND:VEVENT").kind, "text");
  // long values are cut to Calendar's limits
  const long = S.calendarPayload({ date: "2026-01-01", title: "t".repeat(200), allDay: true, location: "", note: "" });
  assert.equal(long.title.length, 80);
});

test("scan: email, phone, SMS, location, text", () => {
  assert.deepEqual(S.parse("mailto:a@b.example?subject=Hi%20there&body=Line%0A2").gen,
    { type: "email", fields: { to: "a@b.example", subject: "Hi there", body: "Line\n2" } });
  assert.equal(S.parse("MATMSG:TO:a@b.example;SUB:Hi;BODY:Yo\\;!;;").body, "Yo;!");
  assert.equal(S.parse("mailto:%zz@b").to, "%zz@b");                              // bad escape kept
  assert.equal(S.parse("tel:+30 210 1234").number, "+30 210 1234");
  assert.deepEqual([S.parse("SMSTO:+3069:hello: there").number, S.parse("SMSTO:+3069:hello: there").message], ["+3069", "hello: there"]);
  assert.equal(S.parse("sms:+3069?body=hi%20you").message, "hi you");
  assert.deepEqual(S.parse("geo:37.97,-23.72?z=3").gen.fields, { lat: "37.97", lon: "-23.72" });
  assert.equal(S.parse("geo:97,0").kind, "text");
  const t = S.parse("Hello\nworld");
  assert.deepEqual([t.kind, t.text, t.gen.type], ["text", "Hello\nworld", "text"]);
  assert.equal(S.parse("   ").gen, null);
  assert.equal(S.parse("x".repeat(9000)).text.length, S.MAX_TEXT);
  // everything the generator makes is recognised as its own kind
  const kinds = { url: { url: "a.example" }, text: { text: "x" }, wifi: { ssid: "n", pass: "12345678", sec: "WPA" },
    vcard: { first: "A" }, event: { title: "E", date: "2026-01-01", allDay: true }, email: { to: "a@b.example" },
    phone: { number: "+30210" }, sms: { number: "+30210", message: "m" }, geo: { lat: "1", lon: "2" } };
  for (const ty of Object.keys(kinds)) assert.equal(S.parse(P.build(ty, kinds[ty]).text).kind, ty, ty);
});

test("scan history: newest first, one entry per text, at most 50, bad rows dropped", () => {
  let h = [];
  for (let i = 0; i < 60; i++) h = S.addHistory(h, "code " + i, 1000 + i, "id" + i);
  assert.equal(h.length, S.HISTORY_MAX);
  assert.equal(h[0].text, "code 59");
  h = S.addHistory(h, "code 30", 5000, "again");
  assert.equal(h[0].id, "again");
  assert.equal(h.filter((x) => x.text === "code 30").length, 1);
  assert.deepEqual(S.addHistory(h, "  ", 9000, "blank"), h);
  assert.deepEqual(S.normHistory([null, { id: "BAD ID", at: 1, text: "x" }, { id: "abcd", at: -1, text: "x" },
                                  { id: "abcd", at: 1, text: "" }, { id: "abcd", at: 2, text: "ok" }, "x"]),
                   [{ id: "abcd", at: 2, text: "ok" }]);
  assert.deepEqual(S.normHistory("nope"), []);
});

// ---------- Many codes ----------

test("CSV: quotes, separators, blank lines, BOM, header guess", () => {
  const a = B.parseCsv('﻿url;label\r\n"https://a.b/?x=1;2";"Door ""A"""\r\n\r\nhttps://c.d;Back\n');
  assert.equal(a.delim, ";");
  assert.deepEqual(a.rows, [["url", "label"], ["https://a.b/?x=1;2", 'Door "A"'], ["https://c.d", "Back"]]);
  assert.deepEqual(B.parseCsv("a\tb\n1\t2").rows, [["a", "b"], ["1", "2"]]);
  assert.deepEqual(B.parseCsv('x,"multi\nline"\n').rows, [["x", "multi\nline"]]);
  assert.deepEqual(B.parseCsv("just one column\nsecond").rows, [["just one column"], ["second"]]);
  assert.deepEqual(B.parseCsv("").rows, []);
  assert.equal(B.columns([["a"], ["a", "b", "c"]]), 3);
  assert.equal(B.guessHeader(a.rows), true);
  assert.equal(B.guessHeader([["https://a.b", "x"], ["https://c.d", "y"]]), false);
  assert.equal(B.guessHeader([["Name", "Phone"], ["Ann", "+30 210 1234"]]), true);
  assert.equal(B.guessHeader([["only"]]), false);
});

test("bulk items: column, label, empty rows, 500 at most", () => {
  const rows = [["url", "name"], ["https://a.example/1", "  Front   door "], ["", "skip"], ["https://a.example/2"]];
  assert.deepEqual(B.items(rows, { header: true, col: 0, label: 1 }),
    { items: [{ row: 2, text: "https://a.example/1", label: "Front door" }, { row: 4, text: "https://a.example/2", label: "" }], empty: 1, more: 0 });
  assert.equal(B.items(rows, { header: false, col: 0 }).items.length, 3);
  const many = Array.from({ length: 520 }, (_, i) => ["r" + i]);
  const r = B.items(many, { col: 0 });
  assert.equal(r.items.length, B.MAX_ITEMS);
  assert.equal(r.more, 20);
});

test("bulk file names: numbered, safe, unique", () => {
  const n = B.fileNames([{ label: "Front/door" }, { label: "Πίσω πόρτα" }, { label: "../../etc" }, {}, { label: "a:b*c?" }]);
  assert.deepEqual(n, ["001 Front-door.png", "002 Πίσω πόρτα.png", "003 etc.png", "004.png", "005 a-b-c.png"]);
  for (const x of n) assert.ok(!/[\/\\:*?"<>|]/.test(x));
  assert.equal(B.fileNames(Array.from({ length: 1200 }, () => ({})))[0], "0001.png");
});

test("label sheet: A4, inside the margins, codes square and paged", () => {
  for (const g of Object.keys(B.GRIDS)) {
    const [c, r] = B.GRIDS[g], lay = B.sheet(c * r + 1, g, true);
    assert.equal(lay.pages, 2);
    assert.equal(lay.cells[c * r].page, 1);
    for (const cell of lay.cells) {
      assert.ok(cell.x >= B.PAGE.margin - 1e-9 && cell.x + cell.w <= B.PAGE.w - B.PAGE.margin + 1e-9);
      assert.ok(cell.y >= B.PAGE.margin - 1e-9 && cell.y + cell.h <= B.PAGE.h - B.PAGE.margin + 1e-9);
      assert.ok(cell.code > 10 && cell.code <= cell.w && cell.code + cell.label <= cell.h);
    }
  }
  assert.equal(B.sheet(3, "nope").cols, 3);
  assert.equal(B.sheet(1, "3x4", false).cells[0].label, 0);
});

// ---------- The look (sync slice "qr") ----------

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
  "\nreturn { normStyle, normSaved, mergeQR, dotStyle, eyeStyle, effEcl, drawOpts };")({ orosQR: Q, orosQRPayload: P });

test("look v1.1: new keys only when set, rd kept for older devices, logo validated", () => {
  const old = { ecl: "Q", fg: "#000000", bg: "#ffffff", mg: 4, rd: true, cap: false, ct: "" };
  assert.deepEqual(A.normStyle(old), old);                                          // v1.0 JSON unchanged
  assert.equal(A.dotStyle(old), "rounded");
  assert.equal(A.eyeStyle(old), "rounded");
  const dots = A.normStyle({ sd: "dots", se: "circle", rd: false, ecl: "L" });
  assert.deepEqual(Object.keys(dots), ["sd", "se", "ecl", "fg", "bg", "mg", "rd", "cap", "ct"]);
  assert.equal(dots.rd, true);                                                      // an older device draws round dots
  assert.equal(A.dotStyle(dots), "dots");
  assert.deepEqual(A.normStyle({ sd: "stars", se: "hearts" }), A.normStyle({}));
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const lg = A.normStyle({ sl: png, ecl: "L" });
  assert.equal(lg.sl, png);
  assert.equal(A.effEcl(lg), "H");                                                  // a logo forces level H
  assert.equal(A.drawOpts(lg).logo > 0, true);
  assert.equal(A.effEcl(A.normStyle({ ecl: "L" })), "L");
  for (const bad of ["data:image/svg+xml;base64,AAAA", "https://x.example/l.png", "data:image/png;base64," + "A".repeat(90000)])
    assert.equal(A.normStyle({ sl: bad }).sl, undefined);
});

test("look v1.1 merge: at equal mtime the copy with the new keys wins over a stripped one", () => {
  const id = "abc123def";
  const full = { id, m: 50, name: "N", type: "url", f: { url: "a.example" }, st: { sd: "dots", se: "circle", rd: true } };
  const stripped = { id, m: 50, name: "N", type: "url", f: { url: "a.example" }, st: { rd: true } };   // what v1.0 keeps
  const d = (c) => ({ ver: 1, codes: [c], tombs: {} });
  const ab = A.mergeQR(d(full), d(stripped)), ba = A.mergeQR(d(stripped), d(full));
  assert.deepEqual(ab, ba);
  assert.equal(ab.codes[0].st.sd, "dots");
  assert.equal(ab.codes[0].st.se, "circle");
  // a newer edit still wins as before
  const newer = Object.assign({}, stripped, { m: 51 });
  assert.equal(A.mergeQR(d(full), d(newer)).codes[0].st.sd, undefined);
});

test("app wiring: decoder loaded on demand, links opened only as http(s), shell bridges, no id clash", () => {
  const html = fs.readFileSync(path.join(root, "qr/index.html"), "utf8");
  assert.ok(!/id="(exports|module|define)"/.test(html), "jsQR's UMD would write into such an element");
  assert.ok(!html.includes("jsQR"), "jsQR is not loaded up front");
  assert.match(appSrc, /"\.\.\/vendor\/jsqr\/jsQR\.js"/);
  assert.match(appSrc, /if \(\/\^https\?:\\\/\\\/\/i\.test\(r\.url\)\) window\.open\(r\.url, "_blank", "noopener,noreferrer"\)/);
  assert.equal((appSrc.match(/window\.open\(/g) || []).length, 1);
  assert.match(appSrc, /__orosOpenAt\("contacts", \{ importVcf: \{ name: vname, text: r\.vcf \} \}\)/);
  assert.match(appSrc, /__orosOpenCalendarNew\(S\.calendarPayload\(r\)\)/);
  assert.ok(fs.existsSync(path.join(root, "vendor/jsqr/LICENSE")));
  // scanned text reaches the page as text only
  const scanUi = block("  // ---------- 8c. Scanner", "  // ---------- 8d.");
  assert.ok(!/innerHTML\s*=\s*(?!\s|"")/.test(scanUi), "no innerHTML with data in the scanner");
});
