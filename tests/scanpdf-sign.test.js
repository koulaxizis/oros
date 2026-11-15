// Scanner & PDF signature requests (scanpdf/sign-core.js, pdfops.stamp):
// fields from the page list, request and reply checks, the signed PDF
// with its certificate and attached record, the list of requests
// (sync slice laws) and a whole round trip through the real relay code
// on an in-memory D1.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "scanpdf/core.js"));
const OPS = require(path.join(ROOT, "scanpdf/pdfops.js"));
const S = require(path.join(ROOT, "scanpdf/sign-core.js"));
const R = require(path.join(ROOT, "share/relay.js"));
const L = require(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"));
const fontkit = require(path.join(ROOT, "vendor/pdf-lib/fontkit.umd.min.js"));
const FONT = { fontkit, bytes: new Uint8Array(fs.readFileSync(path.join(ROOT, "vendor/noto/NotoSans-Regular.ttf"))) };
const DAY = 86400000;
const ORIGIN = "https://useoros.online";

// ---------- helpers ----------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// A small see-through PNG (w × h, a dark line in the middle).
function png(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) if (y === h >> 1) { row[1 + x * 4 + 3] = 255; }
    rows.push(row);
  }
  const raw = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
  return "data:image/png;base64," + raw.toString("base64");
}
async function pdfOf(sizes, rot) {
  const doc = await L.PDFDocument.create();
  sizes.forEach((s, i) => { const p = doc.addPage(s); if (rot && rot[i]) p.setRotation(L.degrees(rot[i])); });
  return doc.save();
}
const SIG = { src: png(40, 10), w: 40, h: 10 };
function request(over) {
  return Object.assign({ v: 1, n: "Contract", h: "a".repeat(64), pages: 2, by: "Chris", to: "Maria", te: "maria@example.org",
    lang: "el", fields: [{ id: "f1", pg: 1, fx: 0.7, fy: 0.85, w: 0.3, h: 0.06, k: "sig", req: true },
                         { id: "f2", pg: 1, fx: 0.3, fy: 0.85, w: 0.3, h: 0.04, k: "date", req: true },
                         { id: "f3", pg: 0, fx: 0.9, fy: 0.95, w: 0.08, h: 0.03, k: "init", req: false }] }, over || {});
}

// ---------- fields ----------
test("core keeps a field addition and never draws it", async () => {
  const f = C.cleanOv({ t: "field", k: "init", w: 0.1, h: 0.04, cx: 0.5, cy: 0.5, req: false });
  assert.equal(f.t, "field"); assert.equal(f.k, "init"); assert.equal(f.req, false);
  assert.equal(C.cleanOv({ t: "field", k: "nope" }).k, "sig");
  assert.equal(C.cleanOv({ t: "text", text: "x", mw: 0.2 }).mw, 0.2);
  const doc = await L.PDFDocument.create(); doc.addPage([595.28, 841.89]);
  const src = { a: { kind: "pdf", doc: (await OPS.load(L, await doc.save())).doc } };
  const out = await OPS.build(L, src, [{ src: "a", idx: 0, rot: 0, ov: [Object.assign({ id: "x" }, f)] }], {}, {});
  const plain = await OPS.build(L, src, [{ src: "a", idx: 0, rot: 0, ov: [] }], {}, {});
  assert.ok(Math.abs(out.length - plain.length) < 40, "a field adds nothing to the page");
});

test("fieldsOf: page as it shows, upright, also on a turned page", () => {
  const g0 = { W: 600, H: 800, R: 0 }, g90 = { W: 600, H: 800, R: 90 };
  const o = { t: "field", k: "sig", id: "o1", cx: 0.5, cy: 0.25, A: 0, w: 0.5, h: 0.1 };
  const [a] = S.fieldsOf([{ ov: [o], g: g0 }]);
  assert.deepEqual([a.pg, a.fx, a.fy, a.w, a.h, a.k, a.req], [0, 0.5, 0.25, 0.5, 0.075, "sig", true]);
  // turned page, field put on while upright there (A = 90)
  const o2 = Object.assign({}, o, C.ovAt(0.5, 0.25, 600, 800, 90), { A: 90 });
  const [b] = S.fieldsOf([{ ov: [], g: g0 }, { ov: [o2], g: g90 }]);
  assert.equal(b.pg, 1);
  assert.ok(Math.abs(b.fx - 0.5) < 1e-3 && Math.abs(b.fy - 0.25) < 1e-3);
  assert.ok(Math.abs(b.w - 300 / 800) < 1e-3 && Math.abs(b.h - 60 / 600) < 1e-3, "box measured on the page as it shows");
  // the page was turned after the field went on: the box turns with it
  const [c] = S.fieldsOf([{ ov: [o], g: g90 }]);
  assert.ok(Math.abs(c.w - 60 / 800) < 1e-3 && Math.abs(c.h - 300 / 600) < 1e-3);
});

// ---------- request / reply ----------
test("cleanRequest: needs a signature field, names, a hash; drops what is unknown", () => {
  const r = S.cleanRequest(request({ x: "<b>", msg: "Hi\u0000 there\n\n\n\nbye", be: "not an email" }));
  assert.equal(r.msg, "Hi there\n\nbye");
  assert.equal(r.be, undefined); assert.equal(r.x, undefined); assert.equal(r.te, "maria@example.org");
  assert.equal(S.cleanRequest(request({ fields: [{ id: "f2", pg: 0, fx: 0.5, fy: 0.5, w: 0.1, h: 0.1, k: "date" }] })), null);
  assert.equal(S.cleanRequest(request({ by: " " })), null);
  assert.equal(S.cleanRequest(request({ h: "zz" })), null);
  const bad = S.cleanRequest(request({ fields: request().fields.concat([{ id: "f9", pg: 7, fx: 0, fy: 0, w: 0.1, h: 0.1 }]) }));
  assert.equal(bad.fields.length, 3, "a field on a page that is not there is dropped");
});

test("cleanReply: only the request's fields, right kinds, required ones filled", () => {
  const req = S.cleanRequest(request());
  const base = { v: 1, rq: "A".repeat(22), h: req.h, st: "signed", nm: "Maria P.", at: 1e12, op: 1e12 - 5000, ca: 1e12 - 1000 };
  const ok = S.cleanReply(Object.assign({}, base, { vals: { f1: SIG, f2: "13/11/2026", f9: "x", f3: { src: "javascript:1", w: 1, h: 1 } } }), req);
  assert.deepEqual(Object.keys(ok.vals).sort(), ["f1", "f2"]);
  assert.equal(S.cleanReply(Object.assign({}, base, { vals: { f2: "13/11/2026" } }), req), null, "signature missing");
  assert.equal(S.cleanReply(Object.assign({}, base, { ca: 0, vals: { f1: SIG, f2: "x" } }), req), null, "no consent");
  assert.equal(S.cleanReply(Object.assign({}, base, { h: "b".repeat(64), vals: { f1: SIG, f2: "x" } }), req), null, "other PDF");
  const no = S.cleanReply({ v: 1, rq: base.rq, h: req.h, st: "declined", why: "Wrong amount", at: 5 }, req);
  assert.equal(no.st, "declined"); assert.equal(no.why, "Wrong amount");
  assert.deepEqual(S.missing(req, {}), ["f1", "f2"]);
});

// ---------- the signed PDF ----------
test("stamp: values on their pages, a certificate page, the record attached; same input, same bytes", async () => {
  const bytes = await pdfOf([[595.28, 841.89], [841.89, 595.28]], [0, 90]);
  const h = await S.sha256(bytes);
  const req = S.cleanRequest(request({ h }));
  const reply = S.cleanReply({ v: 1, rq: "B".repeat(22), h, st: "signed", nm: "Μαρία Π.", at: 1.7e12, op: 1.7e12 - 9000, ca: 1.7e12 - 2000,
    tz: "Europe/Athens", ua: "Firefox 140 · Linux", lang: "el", vals: { f1: SIG, f2: "13/11/2026", f3: SIG } }, req);
  const doc = (await OPS.load(L, bytes)).doc;
  const geoms = OPS.pageGeoms(L, doc);
  assert.equal(geoms[1].R, 90);
  const items = S.stampItems(req, reply, geoms);
  assert.deepEqual(items.map((i) => i.pg), [0, 1]);
  const sig = items[1].ov.find((o) => o.t === "img");
  assert.equal(sig.A, 90, "upright on the turned page");
  const out = await S.record("B".repeat(22), req, reply, { sent: 1.7e12 - DAY });
  assert.equal(out.rec.reply.values.f1.sha256.length, 64);
  assert.equal(out.rec.reply.values.f1.src, undefined, "no picture in the record, its hash instead");
  const meta = { font: FONT, cert: S.cert(out), attach: { name: "signing-record.json", bytes: new TextEncoder().encode(out.json), at: reply.at } };
  const a = await OPS.stamp(L, bytes, items, meta), b = await OPS.stamp(L, bytes, items, meta);
  assert.equal(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0, "the sender rebuilds the same PDF");
  const signed = await L.PDFDocument.load(a);
  assert.equal(signed.getPageCount(), 3, "two pages + the certificate");
  const names = signed.catalog.lookup(L.PDFName.of("Names"));
  const ef = names && names.lookup(L.PDFName.of("EmbeddedFiles"));
  assert.ok(ef, "the record is attached");
  assert.equal(ef.lookup(L.PDFName.of("Names")).lookup(0).decodeText(), "signing-record.json");
  await assert.rejects(OPS.stamp(L, bytes, [{ pg: 5, ov: [] }], meta));
});

// ---------- the list (sync slice) ----------
function item(id, over) {
  return Object.assign({ id, a: 1000, q: request({ h: "c".repeat(64) }), x: 1000 + 7 * DAY,
    c: "r1." + "A".repeat(22) + "." + "B".repeat(43) + ".1", d: "D".repeat(43), p: "/internal/PDF/Signatures/Contract (to sign).pdf" }, over || {});
}
const I1 = "a".repeat(21) + "1", I2 = "a".repeat(21) + "2", I3 = "a".repeat(21) + "3";
test("store: add, receive, take back, remove; the revoke secret leaves once closed", () => {
  let s = S.addItem(null, item(I1));
  s = S.addItem(s, item(I2, { a: 2000 }));
  assert.deepEqual(S.list(s, 5000).map((i) => [i.id, i.status]), [[I2, "waiting"], [I1, "waiting"]]);
  assert.equal(S.list(s, 1000 + 8 * DAY)[0].status, "expired");
  s = S.setGot(s, I1, { at: 3000, st: "signed", nm: "Maria", hf: "e".repeat(64), pf: "/internal/PDF/Signatures/Contract (signed).pdf" });
  assert.equal(s.items[I1].d, undefined);
  assert.equal(S.status(s.items[I1], 5000), "signed");
  s = S.setRevoked(s, I2, 4000);
  assert.equal(S.status(s.items[I2], 5000), "revoked"); assert.equal(s.items[I2].d, undefined);
  s = S.remove(s, I2, 4500);
  assert.deepEqual(s.items[I2], { id: I2, a: 2000, gone: 4500 });
  assert.equal(S.list(s, 5000).length, 1);
  assert.equal(S.readStore({ v: 1, items: { bad: item("bad"), [I3]: item(I3, { c: "javascript:alert(1)" }) } }).items[I3], undefined);
});

test("store merge: commutative, associative, idempotent, canonical (R26)", () => {
  const A = S.addItem(S.addItem(null, item(I1)), item(I2, { a: 2000 }));
  const B = S.setGot(S.addItem(null, item(I1)), I1, { at: 3000, st: "declined", nm: "", why: "No" });
  const Cc = S.remove(S.addItem(A, item(I3, { a: 3000 })), I2, 3500);
  const B2 = S.setGot(S.addItem(null, item(I1)), I1, { at: 2500, st: "signed", nm: "M" });
  const J = (x) => JSON.stringify(x);
  for (const [x, y] of [[A, B], [B, Cc], [A, Cc], [B, B2]]) assert.equal(J(S.merge(x, y)), J(S.merge(y, x)));
  assert.equal(J(S.merge(S.merge(A, B), Cc)), J(S.merge(A, S.merge(B, Cc))));
  assert.equal(J(S.merge(S.merge(B, B2), Cc)), J(S.merge(B, S.merge(B2, Cc))));
  const m = S.merge(A, Cc);
  assert.equal(J(S.merge(m, m)), J(m));
  assert.equal(S.merge(B, B2).items[I1].got.at, 2500, "the earlier reply wins");
  assert.equal(S.merge(A, Cc).items[I2].gone, 3500, "a removal wins");
  assert.equal(S.merge(A, B).items[I1].d, undefined, "no secret once received anywhere");
  // at most MAX_ITEMS, newest kept, in the merge too
  const many = { v: 1, items: {} };
  for (let i = 0; i < S.MAX_ITEMS + 5; i++) { const id = ("x" + i).padStart(22, "0"); many.items[id] = item(id, { a: 10 + i }); }
  const capped = S.merge(many, null);
  assert.equal(Object.keys(capped.items).length, S.MAX_ITEMS);
  assert.ok(!capped.items[("x0").padStart(22, "0")]);
});

test("links: request and reply codes", () => {
  const code = "r1." + "A".repeat(22) + "." + "B".repeat(43) + ".2";
  assert.equal(S.signLink(ORIGIN + "/", code), ORIGIN + "/scanpdf/sign.html#" + code);
  assert.equal(S.replyCode(S.replyLink(ORIGIN, code)), code);
  assert.equal(S.replyCode("  " + code + " "), code);
  assert.equal(S.replyCode("https://evil.example/#signed=<script>"), "");
  assert.equal(S.requestCode("#" + code), code);
  assert.equal(S.signedName("a/b:c"), C.cleanName("a/b:c") + " (signed).pdf");
});

// ---------- round trip through the relay ----------
let handle, SR;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  SR = await import("../relay/share.js");
  R._setIter(1000);
});
// relay/share.js on an in-memory D1 (tests/shr-fake.js)
function fakeD1() { return require("./shr-fake.js").fakeD1(SR.SHR_SQL); }
function relayFetch(env, clock) {
  let n = 0;
  return async (url, init) => {
    init = init || {};
    const h = Object.assign({}, init.headers || {}, { Origin: ORIGIN, "CF-Connecting-IP": "10.60." + (n >> 8 & 255) + "." + (n++ & 255) });
    return handle(new Request(url, { method: init.method || "GET", headers: h, body: init.body }), env, null, clock.now);
  };
}

test("round trip: request with an access code, reply, the sender's copy matches the signer's", async () => {
  const D = fakeD1(), env = { SHR_DB: D }, clock = { now: Date.now() }, fetch = relayFetch(env, clock);
  const opts = { fetch, relay: "https://relay.test", now: clock.now };
  const bytes = await pdfOf([[595.28, 841.89], [595.28, 841.89]]);
  const h = await S.sha256(bytes);
  const req = S.cleanRequest(request({ h, lk: 1 }));
  const sent = await R.create({ v: 1, k: "sign", d: req }, Object.assign({ days: 7, password: "1234-abcd", bin: bytes }, opts));
  assert.match(sent.code, /^q1\./);
  // the signer opens it
  assert.equal((await R.open(sent.code, opts)).error, "pass");
  const got = await R.open(sent.code, Object.assign({ password: "1234-abcd" }, opts));
  assert.equal(got.e.k, "sign");
  const r2 = S.cleanRequest(got.e.d);
  assert.equal(await S.sha256(got.bin), r2.h, "the PDF is the one that was hashed");
  const reply = S.cleanReply({ v: 1, rq: R.parse(sent.code).id, h: r2.h, st: "signed", nm: "Maria", at: clock.now + 60000,
    op: clock.now + 1000, ca: clock.now + 50000, vals: { f1: SIG, f2: "13/11/2026" } }, r2);
  const back = await R.create({ v: 1, k: "signed", d: reply }, Object.assign({ days: 30 }, opts));
  const link = S.replyLink(ORIGIN, back.code);
  // the signer's copy
  async function signedCopy(pdf, rq, rp) {
    const doc = (await OPS.load(L, pdf)).doc;
    const out = await S.record(R.parse(sent.code).id, rq, rp, {});
    return OPS.stamp(L, pdf, S.stampItems(rq, rp, OPS.pageGeoms(L, doc)),
      { font: FONT, cert: S.cert(out), attach: { name: "signing-record.json", bytes: new TextEncoder().encode(out.json), at: rp.at } });
  }
  const mine = await signedCopy(got.bin, r2, reply);
  // the sender takes the reply link
  const ans = await R.open(S.replyCode(link), opts);
  assert.equal(ans.e.k, "signed");
  const rp = S.cleanReply(ans.e.d, req);
  assert.ok(rp, "the reply fits the request");
  assert.equal(rp.rq, R.parse(sent.code).id);
  const theirs = await signedCopy(bytes, req, rp);
  assert.equal(await S.sha256(theirs), await S.sha256(mine), "both copies are the same PDF");
  // taking the request back after the reply
  await R.revoke(sent.id, sent.del, opts);
  assert.equal((await R.open(sent.code, Object.assign({ password: "1234-abcd" }, opts))).error, "gone");
});

test("wave 4: the answer comes back on its own through a reply box; too big falls back to a link", async () => {
  const D = fakeD1(), env = { SHR_DB: D }, clock = { now: Date.now() }, fetch = relayFetch(env, clock);
  const opts = { fetch, relay: "https://relay.test", now: clock.now };
  const bytes = await pdfOf([[595.28, 841.89]]);
  const req = S.cleanRequest(request({ h: await S.sha256(bytes) }));
  // the sender: a box, then the request carrying its id, key and write token
  const [box] = await R.boxes(1, Object.assign({ exp: clock.now + 37 * DAY }, opts));
  assert.match(box.rt, /^[A-Za-z0-9_-]{43}$/);
  const sent = await R.create({ v: 1, k: "sign", d: Object.assign({}, req, { bx: { id: box.id, k: box.key, w: box.wt } }) },
    Object.assign({ days: 7, bin: bytes }, opts));
  let store = S.addItem(S.readStore(null), { id: sent.id, a: clock.now, q: req, x: sent.exp, c: sent.code, d: sent.del,
                                             b: { id: box.id, k: box.key, r: box.rt } });
  assert.deepEqual(store.items[sent.id].b, { id: box.id, k: box.key, r: box.rt });
  assert.ok(!("bx" in S.cleanRequest(Object.assign({}, req, { bx: { id: box.id, k: box.key, w: box.wt } }))), "the write token never goes into the list");
  // only hashes of the tokens are on the relay
  const row = D.objs.get(box.id);
  assert.equal(row.n, -1);
  assert.notEqual(row.delh, box.rt);
  assert.ok(!JSON.stringify([...D.objs.values()]).includes(box.wt));
  // the signer's page finds the box in the request and answers into it
  const got = await R.open(sent.code, opts);
  const rbox = S.cleanBox(got.e.d.bx, "w");
  assert.deepEqual(rbox, { id: box.id, k: box.key, w: box.wt });
  assert.equal(S.cleanBox(got.e.d.bx, "r"), null);
  const reply = S.cleanReply({ v: 1, rq: sent.id, h: req.h, st: "signed", nm: "Maria", at: clock.now + 6e4, op: clock.now + 1e3,
    ca: clock.now + 5e4, vals: { f1: SIG, f2: "13/11/2026" } }, req);
  const wbox = { id: rbox.id, key: rbox.k, wt: rbox.w };
  assert.equal(await R.putBox(wbox, { v: 1, k: "signed", d: reply }, Object.assign({ exp: clock.now + 30 * DAY }, opts)), true);
  await assert.rejects(R.putBox(wbox, { v: 1, k: "signed", d: reply }, opts), /used/);
  // the sender asks once for every waiting request, then takes the ready one
  const want = S.boxesToPoll(store, clock.now);
  assert.deepEqual(want, [{ item: sent.id, id: box.id, key: box.key, rt: box.rt }]);
  assert.deepEqual(await R.poll(want, opts), { [box.id]: "ready" });
  const ans = await R.takeBox(want[0], opts);
  assert.equal(ans.e.k, "signed");
  assert.deepEqual(S.cleanReply(ans.e.d, req), reply);
  // the write token reads nothing; a closed item drops its box; the box goes
  assert.equal((await R.takeBox({ id: box.id, key: box.key, rt: box.wt }, opts)).error, "gone");
  store = S.setGot(store, sent.id, { at: clock.now + 7e4, st: "signed", nm: "Maria" });
  assert.equal(store.items[sent.id].b, undefined);
  assert.deepEqual(S.boxesToPoll(store, clock.now), []);
  await R.revoke(box.id, box.rt, opts);
  assert.deepEqual(await R.poll(want, opts), { [box.id]: "gone" });
  // an answer too big for a box is refused before it is sent (the page then sends a link)
  const [b2] = await R.boxes(1, opts);
  const big = Object.assign({}, reply, { why: undefined, vals: { f1: { src: "data:image/png;base64," + zlib.deflateSync(Buffer.alloc(1)).toString("base64") } } });
  const noise = Buffer.from(require("crypto").randomBytes(120000)).toString("base64");
  await assert.rejects(R.putBox({ id: b2.id, key: b2.key, wt: b2.wt }, { v: 1, k: "signed", d: Object.assign({}, big, { pad: noise }) }, opts), /big/);
  assert.deepEqual(await R.poll([{ id: b2.id, rt: b2.rt }], opts), { [b2.id]: "wait" });
});

test("wave 4 store: the box is a fixed part of an open item; merges keep it; a tombstone has none", () => {
  const q = S.cleanRequest(request({ h: "a".repeat(64) }));
  const b = { id: "B".repeat(22), k: "k".repeat(43), r: "r".repeat(43) };
  const base = { id: "I".repeat(22), a: 5, q, x: 10 * DAY, c: "r1." + "x".repeat(22) + "." + "y".repeat(43) + ".1", d: "d".repeat(43) };
  const withBox = S.addItem(S.readStore(null), Object.assign({ b }, base));
  const without = S.addItem(S.readStore(null), base);
  assert.deepEqual(S.merge(withBox, without).items[base.id].b, b, "a device that has the box wins it");
  assert.deepEqual(S.merge(without, withBox), S.merge(withBox, without));
  assert.equal(S.addItem(S.readStore(null), Object.assign({ b: { id: "bad", k: b.k, r: b.r } }, base)).items[base.id].b, undefined);
  const gone = S.remove(withBox, base.id, 9);
  assert.deepEqual(gone.items[base.id], { id: base.id, a: 5, gone: 9 });
  const rv = S.setRevoked(withBox, base.id, 7);
  assert.equal(rv.items[base.id].b, undefined);
  assert.equal(S.boxesToPoll(withBox, 11 * DAY).length, 0, "an expired request is not asked about");
});
