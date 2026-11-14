// RS-PF / RS-PROD: Revenue Splitter 1.18.0 in CRM. The allowlist for the
// Author Portal's creator requests and the production list (app and
// relay copies agree), the relay's larger cap for the production list,
// and crm/rs.js: parsing, ids, import plan, the answer the creator reads
// (pfOutcome / pfCloseList) and the note's text.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const C = require("../crm/core.js");
const RS = require("../crm/rs.js");

let X;
test.before(async () => { X = await import("../relay/ext.js"); });

const RK = "rsc_" + "k".repeat(32), CK = "ck_" + "a".repeat(40), CS = "cs_" + "b".repeat(40);
const work = (o) => Object.assign({ id: "mw811723ezycw", ben: "Άννα Π.", title: "Άνθρωποι που αξίζει να περιμένεις", phase: 5,
  since: "2026-11-10", release: "2026-12-01", note: "Σου στέλνουμε τις σελίδες.\nΔες τις ως την Παρασκευή." }, o);
const prod = (works, o) => ({ m: "POST", path: "/rs/production", body: Object.assign({ v: 1, sent: "2026-11-13", works }, o) });

const CASES = [
  [{ m: "GET", path: "/rs/profile-requests" }, ""],
  [{ m: "GET", path: "/rs/profile-requests?state=new" }, ""],
  [{ m: "GET", path: "/rs/profile-requests?state=oros" }, ""],
  [{ m: "GET", path: "/rs/profile-requests?state=all" }, ""],
  [{ m: "GET", path: "/rs/profile-requests?state=done" }, "query"],
  [{ m: "GET", path: "/rs/profile-requests?ben=Anna" }, "query"],
  [{ m: "POST", path: "/rs/profile-requests/17", body: { state: "oros" } }, ""],
  [{ m: "POST", path: "/rs/profile-requests/17", body: { state: "done", reply: "Η σελίδα σου ενημερώθηκε. Ευχαριστούμε!" } }, ""],
  [{ m: "POST", path: "/rs/profile-requests/17", body: { state: "done", reply: "Η σελίδα\nσου" } }, "body"],
  [{ m: "POST", path: "/rs/profile-requests/17", body: { state: "done", reply: "<b>x</b>" } }, "body"],
  [{ m: "POST", path: "/rs/profile-requests/17", body: { state: "done", reply: " x" } }, "body"],
  [{ m: "POST", path: "/rs/profile-requests/rq_A-9", body: { state: "declined", reply: "" } }, "body"],
  [{ m: "GET", path: "/rs/profile-requests?state=new&state=oros" }, "query"],
  [{ m: "POST", path: "/rs/profile-requests/17", body: { state: "declined" } }, ""],
  [{ m: "POST", path: "/rs/profile-requests/17", body: { state: "oros", reply: "x" } }, "body"],
  [{ m: "POST", path: "/rs/profile-requests/17", body: { reply: "x" } }, "body"],
  [{ m: "POST", path: "/rs/profile-requests/17", body: { state: "closed" } }, "body"],
  [{ m: "POST", path: "/rs/profile-requests/17", body: { state: "done", reply: "x".repeat(501) } }, "body"],
  [{ m: "POST", path: "/rs/profile-requests/17", body: { state: "done", reply: "a\u0007b" } }, "body"],
  [{ m: "POST", path: "/rs/profile-requests/17", body: { state: "done", note: "x" } }, "body"],
  [{ m: "POST", path: "/rs/profile-requests/" + "x".repeat(65), body: { state: "oros" } }, "path"],
  [{ m: "POST", path: "/rs/profile-requests", body: { state: "oros" } }, "path"],
  // W2: the creator's photo, GET only, no query or body
  [{ m: "GET", path: "/rs/profile-requests/17/photo" }, ""],
  [{ m: "GET", path: "/rs/profile-requests/17/photo?size=big" }, "query"],
  [{ m: "POST", path: "/rs/profile-requests/17/photo", body: { state: "oros" } }, "path"],
  [{ m: "GET", path: "/rs/profile-requests/17/photo/x" }, "path"],
  [{ m: "GET", path: "/rs/profile-requests/" + "x".repeat(65) + "/photo" }, "path"],
  [{ m: "GET", path: "/rs/production" }, ""],
  [{ m: "GET", path: "/rs/production?ben=Anna" }, "query"],
  [prod([work()]), ""],
  [prod([]), ""],
  [prod([work({ since: "", release: "", note: "" })]), "body"],
  [prod([work({ since: "2026-11-13", release: "", note: "" })]), ""],
  [prod([work({ since: undefined })]), "body"],
  [prod([work({ release: undefined })]), "body"],
  [prod([work({ note: undefined })]), "body"],
  [prod([work({ note: "a <b> c" })]), "body"],
  [prod([work({ id: "card-1", ben: "Άννα Π." }), work({ id: "card-2", ben: "Νίκος Κ." })]), ""],
  [prod([work(), work()]), "body"],
  [prod([work({ phase: 0 })]), "body"],
  [prod([work({ phase: 8 })]), "body"],
  [prod([work({ phase: "5" })]), "body"],
  [prod([work({ phase: 2.5 })]), "body"],
  [prod([work({ id: "a/b" })]), "body"],
  [prod([work({ ben: "" })]), "body"],
  [prod([work({ ben: " Άννα" })]), "body"],
  [prod([work({ title: "<b>x</b>" })]), "body"],
  [prod([work({ since: "13/11/2026" })]), "body"],
  [prod([work({ release: "soon" })]), "body"],
  [prod([work({ note: "x".repeat(1001) })]), "body"],
  [prod([work({ comments: "internal" })]), "body"],
  [prod([work()], { v: 2 }), "body"],
  [prod([work()], { sent: "today" }), "body"],
  [{ m: "POST", path: "/rs/production", body: { v: 1, works: [work()] } }, "body"],
  [prod(Array.from({ length: 501 }, (_, i) => work({ id: "w" + i }))), "body"],
  [{ m: "PUT", path: "/rs/production", body: { v: 1 } }, "path"]
];

test("allowlist: links/core.js and relay/ext.js agree on every creator-request and production case", () => {
  for (const [r, want] of CASES) {
    assert.equal(L.checkReq("woo", r), want, "app " + r.m + " " + r.path + " " + JSON.stringify(r.body || "").slice(0, 80));
    assert.equal(X.checkExtReq("woo", r), want, "relay " + r.m + " " + r.path + " " + JSON.stringify(r.body || "").slice(0, 80));
  }
});

test("routes: the 1.18 routes go to rs/v1 with the contracts key only", () => {
  for (const path of ["/rs/profile-requests?state=new", "/rs/profile-requests/17", "/rs/production"]) {
    assert.equal(L.rsCall("woo", [{ m: "GET", path }]), "all", path);
    assert.deepEqual(L.keysFor("woo", { ck: CK, cs: CS, rsk: RK }, [{ m: "GET", path }]), { rsk: RK });
  }
  assert.equal(L.rsCall("woo", [{ m: "GET", path: "/rs/profile-requests" }, { m: "GET", path: "/products" }]), "mixed");
  const ext = { op: "ext", p: "woo", host: "shop.example.gr", base: "", rsk: RK,
                reqs: [RS.REQ_RQ_NEW, RS.REQ_RQ_OROS, RS.REQ_PF_NEW, RS.REQ_PF_OROS] };
  assert.equal(X.validExt(ext), "");
  assert.equal(X.validExt(Object.assign({}, ext, { rsk: undefined, ck: CK, cs: CS })), "key");
});

test("relay: a production list up to 256 KB goes alone through the relay, larger ones go direct", () => {
  const ext = (reqs) => ({ op: "ext", p: "woo", host: "shop.example.gr", base: "", rsk: RK, reqs });
  const rows = (n, note) => prod(Array.from({ length: n }, (_, i) => work({ id: "w" + i, note: note || "Σημείωση " + i }))).body;
  const mid = { m: "POST", path: "/rs/production", body: JSON.stringify(rows(300)) };
  assert.ok(mid.body.length > 16 * 1024 && mid.body.length <= X.RS_RELAY_BYTES);
  assert.equal(X.validExt(ext([mid])), "");
  const big = rows(500, "Ω".repeat(900));
  assert.equal(L.relayTooBig("woo", [{ m: "POST", path: "/rs/production", body: big }]), true);
  assert.equal(X.validExt(ext([{ m: "POST", path: "/rs/production", body: JSON.stringify(big) }])), "body");
  assert.equal(L.relayTooBig("woo", [{ m: "POST", path: "/rs/production", body: rows(300) }]), false);
  // the larger cap only alone in its call
  assert.equal(X.validExt(ext([mid, { m: "GET", path: "/rs/production" }])), "body");
});

// RS-PF W2: the creator's photo through the relay
const JPG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const WEBP = [...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WEBPVP8 ")];
const bytes = (head, n) => { const u = new Uint8Array(n || 64); u.set(head); return u; };
function fakeShop(status, body, type) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response(status === 204 ? null : body, { status, headers: { "Content-Type": type || "image/jpeg" } }); };
  f.calls = calls;
  return f;
}
const photoExt = (reqs) => ({ op: "ext", p: "woo", host: "shop.example.gr", base: "", rsk: RK, reqs: reqs || [{ m: "GET", path: "/rs/profile-requests/17/photo" }] });

test("photo: the type comes from the first bytes only (both copies agree)", () => {
  const cases = [[bytes(JPG), "image/jpeg"], [bytes(PNG), "image/png"], [bytes(WEBP), "image/webp"],
    [bytes([...Buffer.from("GIF89a")]), ""], [bytes([...Buffer.from("<svg xmlns")]), ""], [bytes([...Buffer.from("<html>")]), ""],
    [bytes(PNG.slice(0, 7)), ""], [bytes([...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WAVE")]), ""],
    [new Uint8Array(JPG.slice(0, 11)), ""], [new Uint8Array(0), ""]];
  for (const [u8, want] of cases) {
    assert.equal(X.photoType(u8), want, "relay " + Buffer.from(u8.slice(0, 8)).toString("hex"));
    assert.equal(L.photoType(u8), want, "app " + Buffer.from(u8.slice(0, 8)).toString("hex"));
  }
});

test("photo: alone in its call, the contracts key only", () => {
  assert.equal(X.validExt(photoExt()), "");
  assert.equal(X.validExt(photoExt([{ m: "GET", path: "/rs/profile-requests/17/photo" }, { m: "GET", path: "/rs/profile-requests?state=new" }])), "reqs");
  assert.equal(X.validExt(photoExt([{ m: "GET", path: "/rs/profile-requests/17/photo" }, { m: "GET", path: "/rs/profile-requests/18/photo" }])), "reqs");
  assert.equal(X.validExt(Object.assign(photoExt(), { rsk: undefined, ck: CK, cs: CS })), "key");
  assert.deepEqual(L.keysFor("woo", { ck: CK, cs: CS, rsk: RK }, [{ m: "GET", path: "/rs/profile-requests/17/photo" }]), { rsk: RK });
});

test("photo: the relay sends back only the bytes and the type they show", async () => {
  const img = bytes(PNG, 2000);
  const f = fakeShop(200, img, "text/html");
  const out = await X.runExt(photoExt(), f);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://shop.example.gr/wp-json/rs/v1/profile-requests/17/photo");
  assert.equal(f.calls[0].init.redirect, "manual");
  assert.equal(f.calls[0].init.headers["X-RS-Key"], RK);
  assert.deepEqual(out.res, [{ status: 200, type: "image/png", b64: Buffer.from(img).toString("base64") }]);
});

test("photo: over 512 KB → photo-big, a GIF or SVG with a jpeg Content-Type → photo-type, a non-2xx → only its status", async () => {
  const max = 512 * 1024;
  let out = await X.runExt(photoExt(), fakeShop(200, bytes(JPG, max + 1)));
  assert.deepEqual(out.res, [{ status: 200, err: "photo-big" }]);
  out = await X.runExt(photoExt(), fakeShop(200, bytes(JPG, max)));
  assert.equal(out.res[0].type, "image/jpeg");
  out = await X.runExt(photoExt(), fakeShop(200, bytes([...Buffer.from("GIF89a")]), "image/jpeg"));
  assert.deepEqual(out.res, [{ status: 200, err: "photo-type" }]);
  out = await X.runExt(photoExt(), fakeShop(200, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image/jpeg"));
  assert.deepEqual(out.res, [{ status: 200, err: "photo-type" }]);
  out = await X.runExt(photoExt(), fakeShop(404, '{"code":"rest_no_route","message":"secret detail"}', "application/json"));
  assert.deepEqual(out.res, [{ status: 404 }]);
  out = await X.runExt(photoExt(), fakeShop(302, "", "text/html"));
  assert.deepEqual(out.res, [{ status: 302 }]);
});

// ---------- crm/rs.js ----------
const BIO = { id: 17, type: "bio", ben: "Άννα Π.", at: "2026-11-13T09:00:00+00:00", state: "new", note: "Βάλε και τη νέα φωτογραφία.",
              bio: "Η Άννα γράφει ιστορίες.", was: "Η Άννα γράφει.", links: ["https://anna.example/", "javascript:alert(1)", "ftp://x"], has_photo: true };
const COPIES = { id: "18", type: "copies", ben: "Άννα Π.", at: "2026-11-13T10:00:00Z", state: "new", note: "", product_id: 812, title: "Το νησί", qty: 5 };

test("parsePfRequests keeps the fields of each kind and drops what it cannot trust", () => {
  const got = RS.parsePfRequests({ requests: [BIO, COPIES, { id: 19, type: "other" }, { id: "a b", type: "bio" }, null,
    { id: 20, type: "copies", ben: "Β", state: "done", reply: "Στάλθηκαν.", qty: -1 }] });
  assert.equal(got.length, 3);
  assert.deepEqual(got[0], { id: "17", type: "bio", ben: "Άννα Π.", at: Date.parse(BIO.at), state: "new", note: BIO.note,
    bio: BIO.bio, was: BIO.was, links: ["https://anna.example/"], photo: true });
  assert.deepEqual(got[1], { id: "18", type: "copies", ben: "Άννα Π.", at: Date.parse(COPIES.at), state: "new", note: "",
    pid: 812, title: "Το νησί", qty: 5 });
  assert.equal(got[2].qty, 0);
  assert.equal(got[2].reply, "Στάλθηκαν.");
  assert.equal(RS.parsePfRequests({ nope: [] }), null);
  assert.equal(RS.parsePfRequests(null), null);
});

test("pfIds: the same ids on every device, the follow-up tells the kind, all four match CRM's id rule", () => {
  const a = RS.pfIds("shop1", { id: "17", type: "bio" }), b = RS.pfIds("shop1", { id: "17", type: "copies" });
  assert.deepEqual(RS.pfIds("shop1", { id: "17", type: "bio" }), a);
  assert.match(a.fup, /^pff/);
  assert.match(b.fup, /^pfg/);
  assert.equal(a.act, b.act);
  for (const id of [a.fup, a.act, a.done, a.decl, b.fup]) assert.match(id, /^[a-z0-9]{6,40}$/);
  assert.deepEqual(RS.pfIdsOf(a.fup), a);
  assert.deepEqual(RS.pfIdsOf(b.fup), b);
  assert.equal(RS.pfIdsOf(a.act), null);
  assert.notEqual(RS.pfIds("shop2", { id: "17" }).fup, a.fup);
  assert.notEqual(RS.pfIds("shop1", { id: "17" }).fup, RS.rqIds("shop1", "17").fup);
  assert.equal(RS.pfKind(a.fup), "fup");
  assert.equal(RS.pfKind(b.fup), "fup");
  assert.equal(RS.pfKind(a.act), "act");
  assert.equal(RS.pfKind(a.done), "done");
  assert.equal(RS.pfKind(a.decl), "decl");
  assert.equal(RS.pfKind("rqf123456"), "");
  assert.equal(RS.pfKind("abc123456"), "");
});

function crm() {
  const d = C.norm({ cust: [{ id: "cust000001", m: 1, name: "Άννα Παππά", kind: "person", st: "active" },
                            { id: "cust000002", m: 1, name: "Νίκος", kind: "person", st: "active" }],
                     rsl: [{ id: "cust000001", m: 1, n: ["Άννα Π."] }] });
  return d;
}

test("pfImportPlan: found by the beneficiary's name on the shop it belongs to; the rest is left", () => {
  const data = crm(), reqs = RS.parsePfRequests({ requests: [BIO, COPIES, Object.assign({}, COPIES, { id: 21, ben: "Κανείς" })] });
  const x = RS.pfImportPlan(data, "shop1", "shop1", reqs);
  assert.equal(x.plan.length, 2);
  assert.equal(x.plan[0].cust.id, "cust000001");
  assert.equal(x.plan[0].have, false);
  assert.deepEqual(x.left.map((q) => q.id), ["21"]);
  // another shop: the link says no shop = the first one
  assert.equal(RS.pfImportPlan(data, "shop2", "shop1", reqs).plan.length, 0);
  // already in CRM (or deleted there): have
  data.fups = [{ id: x.plan[0].ids.fup, m: 2, cust: "cust000001", d: "2026-11-13", text: "x" }];
  data.tombs[x.plan[1].ids.act] = 5;
  const y = RS.pfImportPlan(data, "shop1", "shop1", reqs);
  assert.deepEqual(y.plan.map((p) => p.have), [true, true]);
});

test("pfOutcome / pfCloseList: an answer note wins, else a done follow-up sends the default, a deleted one declines", () => {
  const data = crm(), q1 = { id: "17", type: "bio", state: "oros" }, q2 = { id: "18", type: "copies", state: "oros" };
  const q3 = { id: "19", type: "bio", state: "oros" }, q4 = { id: "20", type: "bio", state: "new" };
  const i1 = RS.pfIds("s", q1), i2 = RS.pfIds("s", q2), i3 = RS.pfIds("s", q3), i4 = RS.pfIds("s", q4);
  data.fups = [{ id: i1.fup, m: 2, cust: "cust000001", d: "2026-11-13", text: "x", done: "2026-11-13" },
               { id: i2.fup, m: 2, cust: "cust000001", d: "2026-11-13", text: "x", done: "2026-11-13" },
               { id: i4.fup, m: 2, cust: "cust000001", d: "2026-11-13", text: "x", done: "2026-11-13" }];
  data.acts = [{ id: i2.decl, m: 5, cust: "cust000001", k: "note", at: 5, text: "Απάντηση (απορρίφθηκε):\nΔεν έχουμε άλλα αντίτυπα.\nΣυγγνώμη." },
               { id: i2.done, m: 4, cust: "cust000001", k: "note", at: 4, text: "Απάντηση (έγινε):\nΣτάλθηκαν." }];
  data.tombs[i3.fup] = 9;
  const def = (q) => (q.type === "copies" ? "Έρχονται." : "Ενημερώθηκε.");
  assert.deepEqual(RS.pfOutcome(data, "s", q1, "Ενημερώθηκε."), { state: "done", reply: "Ενημερώθηκε.", at: 2 });
  assert.deepEqual(RS.pfOutcome(data, "s", q2, "x"), { state: "declined", reply: "Δεν έχουμε άλλα αντίτυπα. Συγγνώμη.", at: 5 });
  assert.deepEqual(RS.pfOutcome(data, "s", q3, "x"), { state: "declined", reply: "", at: 9 });
  assert.equal(RS.pfOutcome(data, "s", { id: "99", type: "bio" }, "x"), null);
  // only the requests orOS took ("oros") are closed
  assert.deepEqual(RS.pfCloseList(data, "s", [q1, q2, q3, q4], def), [
    { id: "17", state: "done", reply: "Ενημερώθηκε." },
    { id: "18", state: "declined", reply: "Δεν έχουμε άλλα αντίτυπα. Συγγνώμη." },
    { id: "19", state: "declined", reply: "" }]);
  // the newer answer wins when two devices wrote both
  data.acts[1].m = 6;
  assert.equal(RS.pfOutcome(data, "s", q2, "x").state, "done");
  // the answer survives a merge with an older device's copy
  const merged = C.merge(data, crm());
  assert.equal(RS.pfOutcome(merged, "s", q2, "x").reply, "Στάλθηκαν.");
});

test("reqPfMark: 'oros' alone, a reply only with done / declined: one line ≤ 500, no <>, left out when empty", () => {
  assert.deepEqual(RS.reqPfMark("17", "oros", "x"), { m: "POST", path: "/rs/profile-requests/17", body: { state: "oros" } });
  const r = RS.reqPfMark("17", "done", "  " + "α".repeat(499) + " β  ");
  assert.equal(r.body.reply.length, 499);
  assert.equal(L.checkReq("woo", r), "");
  const m = RS.reqPfMark("17", "declined", "a\r\nb\u0007c <i>d</i>");
  assert.equal(m.body.reply, "a b c id/i");
  assert.equal(L.checkReq("woo", m), "");
  assert.equal(X.checkExtReq("woo", m), "");
  assert.deepEqual(RS.reqPfMark("17", "declined", "  ").body, { state: "declined" });
  assert.equal(L.checkReq("woo", RS.reqPfMark("17", "declined", "")), "");
});

test("pfActText: the ask, the new page text cut to fit 2000, links, photo and the creator's note", () => {
  const words = { bio: "Ζητήθηκε νέο κείμενο:", copies: "Ζητήθηκαν {q} αντίτυπα του «{t}».", links: "Σύνδεσμοι:", photo: "Έχει φωτογραφία.", note: "Σημείωση:" };
  const [bio, copies] = RS.parsePfRequests({ requests: [BIO, COPIES] });
  const tx = RS.pfActText(bio, words);
  assert.equal(tx, "Ζητήθηκε νέο κείμενο:\n\nΗ Άννα γράφει ιστορίες.\n\nΣύνδεσμοι:\nhttps://anna.example/\n\nΈχει φωτογραφία.\n\nΣημείωση: Βάλε και τη νέα φωτογραφία.");
  assert.equal(RS.pfActText(copies, words), "Ζητήθηκαν 5 αντίτυπα του «Το νησί».");
  const long = Object.assign({}, bio, { bio: "λέξη ".repeat(1000).trim() });
  const cut = RS.pfActText(long, words);
  assert.ok(cut.length <= 2000);
  assert.match(cut, /…\n\nΣύνδεσμοι:/);
  assert.match(cut, /Σημείωση: Βάλε/);
  assert.equal(C.cleanText(cut, 2000, true).length, cut.length);
});
