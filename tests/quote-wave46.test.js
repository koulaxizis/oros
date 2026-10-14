// Quote wave 46: any ISO currency (quote/core.js), acceptance by link
// (quote/accept-core.js: snapshot, link codec, the answer and its
// check), and the wiring in quote.js / accept.html.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const QC = require(path.join(ROOT, "quote/core.js"));
const A = require(path.join(ROOT, "quote/accept-core.js"));

function quote(extra) {
  return Object.assign({
    id: "q1abc", num: "OFF-2026-007", status: "sent", date: "2026-10-01", dueDate: "2026-10-31",
    currency: "GBP", gDisc: 10, payment: "Bank transfer\nIBAN: GB00", notes: "Thanks",
    items: [
      { id: "i1", code: "W1", desc: "Website", qty: 1, price: 1200, disc: 0, vat: 20 },
      { id: "i2", code: "", desc: "Hosting (year)", qty: 2, price: 99.99, disc: 5, vat: 20 }
    ],
    instalments: [{ id: "n1", date: "2026-11-01", amount: 600 }],
    clientId: "c1", mtime: 1, pos: 0
  }, extra || {});
}
const client = { id: "c1", name: "Acme Ltd", address: "1 High St\nLondon", taxId: "GB123", email: "a@acme.test" };

test("currencies: any ISO code, formatted with its own decimals", () => {
  assert.equal(QC.curOk("GBP"), true);
  assert.equal(QC.curOk("gbp"), false);
  assert.equal(QC.curOk("EURO"), false);
  const list = QC.currencyList();
  assert.ok(list.indexOf("EUR") === 0 && list.indexOf("USD") === 1);
  assert.ok(list.indexOf("JPY") > 0 && list.indexOf("INR") > 0);
  assert.equal(new Set(list).size, list.length);
  assert.match(QC.fmtMoney(1234.5, "JPY", "en"), /¥1,235|¥1,234/);       // no decimals
  assert.match(QC.fmtMoney(1234.5, "EUR", "el"), /1\.234,50\s€/);
  assert.match(QC.fmtMoney(12, "CHF", "en", true), /CHF\s?12\.00/);
  assert.equal(QC.curDigits("JPY"), 0);
  assert.equal(QC.curDigits("BHD"), 3);
  assert.equal(QC.convert(100, 1.5, "USD"), 150);
  assert.equal(QC.convert(100, 161.2345, "JPY"), 16123);
  assert.equal(QC.convert(100, 0, "USD"), null);
  assert.equal(QC.convert(100, null, "USD"), null);
});

test("forClient keeps the quote's own currency (CRM read)", () => {
  const data = { quotes: [quote()], clients: [client] };
  const rows = QC.forClient(data, { name: "acme ltd", afm: "" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cur, "GBP");
  data.quotes[0].currency = "x";
  assert.equal(QC.forClient(data, { name: "Acme Ltd" })[0].cur, "EUR");
});

test("snapshot: normalized, idempotent, totals match Quote's own sums", () => {
  const q = quote();
  const tok = A.newToken();
  assert.match(tok, /^[A-Za-z0-9_-]{22}$/);
  const s = A.snapshot(q, client, { tok, f: "My Studio", fe: "me@studio.test" });
  assert.equal(s.id, "q1abc");
  assert.equal(s.c, "GBP");
  assert.equal(s.cl.n, "Acme Ltd");
  assert.equal(s.it.length, 2);
  assert.deepEqual(A.norm(JSON.parse(JSON.stringify(s))), s, "norm is idempotent");
  assert.equal(A.canon(A.norm(s)), A.canon(s));
  const tt = A.totals(s);
  assert.equal(tt.total, QC.total(q), "same total as quote/core.js");
  assert.equal(tt.lines.length, 2);
  // no token → no snapshot
  assert.equal(A.snapshot(quote(), client, {}), null);
});

test("norm: hostile input is capped, cleaned or refused", () => {
  assert.equal(A.norm(null), null);
  assert.equal(A.norm({ v: 2, id: "a", tok: "x".repeat(22) }), null);
  assert.equal(A.norm({ v: 1, id: "../x", tok: "x".repeat(22) }), null);
  assert.equal(A.norm({ v: 1, id: "a", tok: "short" }), null);
  const s = A.norm({
    v: 1, id: "a", tok: "abcdefghijklmnopqrstuv", c: "<b>", n: "N\u0000o" + "x".repeat(100), fe: "not-an-email",
    cl: { n: "C", a: "a\r\nb", t: 5 }, g: 500,
    it: Array.from({ length: 150 }, () => ({ d: "x", q: -1, p: 1e20, x: 10, v: 24 })), ins: "nope", extra: "<script>"
  });
  assert.equal(s.c, "EUR");
  assert.equal(s.n.length, 60);
  assert.equal(s.n.indexOf("\u0000"), -1);
  assert.equal(s.fe, "");
  assert.equal(s.cl.a, "a\nb");
  assert.equal(s.cl.t, "");
  assert.equal(s.g, 0);
  assert.equal(s.it.length, 100);
  assert.equal(s.it[0].q, 0);
  assert.equal(s.it[0].p, 0);
  assert.deepEqual(s.ins, []);
  assert.equal("extra" in s, false);
});

test("offer link round trip; damaged and oversized links refused", async () => {
  const s = A.snapshot(quote(), client, { tok: A.newToken(), f: "Me", fe: "" });
  const code = await A.encodeOffer(s);
  assert.match(code, /^q1\.[A-Za-z0-9_-]+$/);
  assert.equal(A.offerCodeFromHash("#" + code), code);
  assert.equal(A.offerCodeFromHash("#1.abc"), "");
  const back = await A.decodeOffer(code);
  assert.deepEqual(back.snap, s);
  assert.equal(await A.digest(back.snap), await A.digest(s), "same fingerprint on both sides");
  assert.deepEqual(await A.decodeOffer("q1.!!!"), { error: "bad" });
  assert.deepEqual(await A.decodeOffer("q1." + code.slice(3, 20)), { error: "bad" });
  assert.deepEqual(await A.decodeOffer("q0." + "A".repeat(40000)), { error: "big" });
  // plain (q0) form
  const plain = "q0." + Buffer.from(JSON.stringify(s)).toString("base64url");
  assert.deepEqual((await A.decodeOffer(plain)).snap, s);
  // decompression bomb stops at the cap
  const zeros = new Uint8Array(400000);
  const z = new Uint8Array(await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  assert.deepEqual(await A.decodeOffer("q1." + Buffer.from(z).toString("base64url")), { error: "big" });
});

test("answer: made, read back from a code or a whole link, checked", async () => {
  const q = quote();
  const s = A.snapshot(q, client, { tok: A.newToken(), f: "Me", fe: "me@x.test" });
  const h = await A.digest(s);
  q.share = { tok: s.tok, h, at: 1, f: "Me", fe: "me@x.test" };
  const at = Date.UTC(2026, 9, 14, 10, 0);
  const code = A.makeReply({ i: q.id, t: s.tok, h, n: "  Jane   Doe ", at, m: "See you" });
  assert.match(code, /^a1\./);
  const r = A.readReply("https://useoros.online/quote/#acc=" + code);
  assert.deepEqual(r, { i: q.id, t: s.tok, h, n: "Jane Doe", at, m: "See you" });
  assert.deepEqual(A.readReply("Hi, here it is:\n" + code + "\nJane"), r);
  assert.deepEqual(A.readReply(code), r);
  assert.equal(A.verify(q, r), "ok");
  // the link was edited before accepting → a different fingerprint
  const edited = JSON.parse(JSON.stringify(s));
  edited.it[0].p = 1;
  const r2 = A.readReply(A.makeReply({ i: q.id, t: s.tok, h: await A.digest(edited), n: "Jane", at }));
  assert.equal(A.verify(q, r2), "tampered");
  // sent again since (new token) → the old answer is stale
  const r3 = A.readReply(A.makeReply({ i: q.id, t: A.newToken(), h, n: "Jane", at }));
  assert.equal(A.verify(q, r3), "stale");
  assert.equal(A.verify(Object.assign({}, q, { id: "other" }), r), "stale");
  assert.equal(A.verify(quote(), r), "none");
  // junk
  assert.equal(A.readReply(""), null);
  assert.equal(A.readReply("a1.bm90IGpzb24"), null);
  assert.equal(A.makeReply({ i: q.id, t: s.tok, h, n: "", at }), "", "a name is required");
  assert.equal(A.makeReply({ i: q.id, t: s.tok, h: "xyz", n: "J", at }), "");
  assert.equal(A.makeReply({ i: q.id, t: s.tok, h, n: "J", at: 5 }), "");
});

test("a quote edited after sending: the stored fingerprint no longer matches it", async () => {
  const q = quote();
  const s = A.snapshot(q, client, { tok: A.newToken(), f: "", fe: "" });
  q.share = { tok: s.tok, h: await A.digest(s), at: 1, f: "", fe: "" };
  assert.equal(await A.digest(A.snapshot(q, client, null)), q.share.h, "unchanged → same");
  q.items[0].price = 1300;
  assert.notEqual(await A.digest(A.snapshot(q, client, null)), q.share.h, "edited → different");
});

test("wiring: scripts loaded, any currency accepted by the shell bridge, no innerHTML with data on the page", () => {
  const html = fs.readFileSync(path.join(ROOT, "quote/index.html"), "utf8");
  ["core.js", "accept-core.js", "../units/core.js"].forEach((f) => assert.ok(html.indexOf('src="' + f) > 0, f));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="quote.js'));
  const page = fs.readFileSync(path.join(ROOT, "quote/accept.html"), "utf8");
  assert.ok(page.indexOf("accept-core.js") > 0 && page.indexOf("accept.js") > 0);
  const js = fs.readFileSync(path.join(ROOT, "quote/accept.js"), "utf8");
  assert.equal(/innerHTML/.test(js), false);
  assert.ok(/inheritPalette/.test(js) && /watchPalette/.test(js));
  const shell = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
  assert.ok(shell.indexOf('/^[A-Z]{3}$/.test(p.cur)) q.cur = p.cur;') > 0);
  const qjs = fs.readFileSync(path.join(ROOT, "quote/quote.js"), "utf8");
  assert.equal(/q\.currency !== "USD"/.test(qjs), false, "old EUR/USD-only migrate is gone");
  assert.ok(/attach = \[\{ name: fname \|\| "quote\.pdf", type: "application\/pdf", b64: b64 \}\]/.test(qjs));
});
