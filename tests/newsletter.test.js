// Newsletter: the shared core (newsletter/core.js) — normalize, the
// sync merge (slice "newsletter") with subscriber event times, ids
// and tokens, imports, CSV export, the pre-send check, Inbox requests
// and delivery-failure reports, backup — the e-mail renderer
// (newsletter/render.js) with Mail's compose.js, the search provider,
// EN/EL string parity, plus a two-device round trip through the real
// sync engine (tests/harness.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const C = require("../newsletter/core.js");
const R = require("../newsletter/render.js");
const M = require("../mail/compose.js");
const { FakeDropbox, createDevice, readKey, writeKey } = require("./harness");

const ROOT = path.join(__dirname, "..");
const json = (x) => JSON.stringify(x);
const LIST = { id: "list-1", m: 1, name: "Friends", chan: "chan-1", from: "me@example.com", reply: "", lang: "en",
  addr: "1 Main St, Athens", why: "You signed up on my site.", theme: "classic", color: "#2f6fde", salt: "abcdefgh12" };
const CHAN = { id: "chan-1", m: 1, name: "Brevo", kind: "smtp", preset: "brevo", host: "smtp-relay.brevo.com", port: 587, user: "u", rate: 60, cap: 300 };
function sub(email, extra) {
  return Object.assign({ id: C.subId("list-1", email), m: 5, list: "list-1", email, name: "", tags: [], src: "manual",
    basis: "consent", at: 10, conf: 10, off: 0 }, extra || {});
}
function issue(id, extra) {
  return Object.assign({ id, m: 3, list: "list-1", subj: "Hello {first|friend}", pre: "News", fmt: "blocks",
    blocks: [{ k: "h", t: "Hi" }, { k: "p", t: "Some **news**." }], tags: [], st: "draft" }, extra || {});
}
function model(o) {
  return C.normalize(Object.assign({ chans: [CHAN], lists: [LIST], subs: [], issues: [] }, o || {}));
}

// ---------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------

test("normalize: bad rows dropped, orphans go with their list, idempotent", () => {
  const d = C.normalize({
    chans: [CHAN, { id: "chan-2", kind: "smtp", host: "bad host!", port: 25, m: 1 }],
    lists: [LIST, { id: "BAD", name: "x" }],
    subs: [sub("A@Example.com"), sub("b@example.com", { list: "nope" }), { id: "s-x", list: "list-1", email: "not-an-address", m: 1 }],
    issues: [issue("iss-1", { st: "weird", lock: { dev: "abcdef", at: 5 } }), issue("iss-2", { list: "gone" })],
    sent: { "iss-1": ["x"] }, supp: ["xbad", "x" + "0".repeat(11)]
  });
  assert.deepEqual(d.lists.map((l) => l.id), ["list-1"]);
  assert.deepEqual(d.subs.map((s) => s.email), ["A@Example.com"]);
  assert.equal(d.chans[1].host, "");
  assert.equal(d.chans[1].port, 587);
  assert.equal(d.chans[1].sec, "starttls");
  assert.equal(d.issues.length, 1);
  assert.equal(d.issues[0].st, "draft");
  assert.equal(d.issues[0].lock, null);
  assert.deepEqual(d.sent, {});                          // only sending / paused issues keep a sent set
  assert.deepEqual(d.supp, ["x" + "0".repeat(11)]);
  assert.equal(json(C.normalize(d)), json(d));
});

test("normalize: blocks are cleaned, unsafe links dropped, image paths fenced", () => {
  const d = model({ issues: [issue("iss-1", { blocks: [
    { k: "btn", t: "Go", href: "javascript:alert(1)" },
    { k: "img", f: "/internal/Other/x.jpg", alt: "a" },
    { k: "img", f: "/internal/Newsletter/img-1.jpg", alt: "b", href: "https://example.com" },
    { k: "script", t: "x" }
  ] })] });
  const b = d.issues[0].blocks;
  assert.equal(b.length, 3);
  assert.equal(b[0].href, "");
  assert.equal(b[1].f, "");
  assert.equal(b[2].f, "/internal/Newsletter/img-1.jpg");
  assert.equal(b[2].href, "https://example.com");
});

test("ids and tokens are deterministic; the list code and tokens are told apart", () => {
  const l = C.normalize({ lists: [LIST] }).lists[0];
  assert.equal(C.subId("list-1", "A@Example.COM "), C.subId("list-1", "a@example.com"));
  assert.notEqual(C.subId("list-1", "a@example.com"), C.subId("list-2", "a@example.com"));
  const sid = C.subId("list-1", "a@example.com");
  assert.equal(C.token(l, sid), C.token(l, sid));
  assert.match(C.token(l, sid), /^nl-[0-9a-z]{11}$/);
  assert.equal(C.listCode(l), "nl-abcdef");
  assert.deepEqual(C.classify("Re: unsubscribe " + C.token(l, sid)), { act: "unsub", tok: C.token(l, sid) });
  assert.deepEqual(C.classify("CONFIRM " + C.token(l, sid)), { act: "confirm", tok: C.token(l, sid) });
  assert.deepEqual(C.classify("subscribe nl-abcdef"), { act: "sub", code: "nl-abcdef" });
  assert.equal(C.classify("subscribe " + C.token(l, sid)), null);
  assert.equal(C.classify("Hello there"), null);
  const d = model({ subs: [sub("a@example.com")] });
  assert.equal(C.byToken(d)[C.token(d.lists[0], sid)].email, "a@example.com");
  assert.equal(C.byCode(d)["nl-abcdef"].id, "list-1");
});

// ---------------------------------------------------------------
// Status + merge
// ---------------------------------------------------------------

test("status follows the latest event", () => {
  assert.equal(C.status(sub("a@x.gr", { at: 10, conf: 0 })), "pend");
  assert.equal(C.status(sub("a@x.gr", { at: 10, conf: 12 })), "on");
  assert.equal(C.status(sub("a@x.gr", { at: 10, conf: 12, off: 20, offSt: "bounce" })), "bounce");
  assert.equal(C.status(C.normSub(sub("a@x.gr", { at: 30, conf: 30, off: 20, offSt: "off" }))), "on");   // came back
});

test("merge: symmetric, idempotent, unsubscribe on one device survives an edit on the other", () => {
  const base = sub("a@example.com", { name: "Ann" });
  const A = model({ subs: [Object.assign({}, base, { m: 50, off: 40, offSt: "off" })], issues: [issue("iss-a")] });
  const B = model({ subs: [Object.assign({}, base, { m: 60, name: "Anna", tags: ["vip"] })], issues: [issue("iss-b")],
                    supp: [C.suppHash("gone@example.com")] });
  const ab = C.mergeNewsletter(A, B), ba = C.mergeNewsletter(B, A);
  assert.equal(json(ab), json(ba));
  assert.equal(json(C.mergeNewsletter(ab, ab)), json(ab));
  const s = ab.subs[0];
  assert.equal(s.name, "Anna");                          // newer edit wins the fields
  assert.equal(C.status(s), "off");                      // the unsubscribe is kept
  assert.deepEqual(ab.issues.map((x) => x.id), ["iss-a", "iss-b"]);
  assert.deepEqual(ab.supp, [C.suppHash("gone@example.com")]);
});

test("merge: tombstone wins a tie; sent sets are unions while sending", () => {
  const x = issue("iss-1", { st: "sending", m: 9 });
  const A = model({ issues: [x], subs: [sub("a@x.gr")], sent: { "iss-1": [C.subId("list-1", "a@x.gr")] } });
  const B = model({ issues: [x], subs: [sub("b@x.gr")], sent: { "iss-1": [C.subId("list-1", "b@x.gr")] } });
  const m = C.mergeNewsletter(A, B);
  assert.equal(m.sent["iss-1"].length, 2);
  const T = model({ issues: [{ id: "iss-1", m: 9, del: 1 }] });
  assert.equal(C.mergeNewsletter(A, T).issues[0].del, 1);
  assert.equal(C.mergeNewsletter(T, A).issues[0].del, 1);
});

// ---------------------------------------------------------------
// Audience, progress, lock
// ---------------------------------------------------------------

test("audience: active only, tags any-of; progress counts sent and failures", () => {
  const a = sub("a@x.gr", { tags: ["vip"] }), b = sub("b@x.gr"), c = sub("c@x.gr", { conf: 0 }), e = sub("e@x.gr", { off: 99 });
  const x = issue("iss-1", { st: "sending", tags: ["VIP"], fail: {} });
  let d = model({ subs: [a, b, c, e], issues: [x] });
  assert.deepEqual(C.audience(d, d.issues[0]).map((s) => s.email), ["a@x.gr"]);
  const all = issue("iss-2", { st: "sending" });
  d = model({ subs: [a, b, c, e], issues: [all], sent: { "iss-2": [a.id] } });
  const p = C.progress(d, d.issues[0]);
  assert.equal(p.total, 2);
  assert.equal(p.sent, 1);
  assert.equal(p.left, 1);
  assert.equal(p.next.email, "b@x.gr");
  assert.equal(C.canSend({ st: "sending", lock: { dev: "dev111", at: 0 } }, "dev222", C.LOCK_STALE + 1), true);
  assert.equal(C.canSend({ st: "sending", lock: { dev: "dev111", at: 100 } }, "dev222", 200), false);
  assert.equal(C.canSend({ st: "paused", lock: null }, "dev222", 0), false);
  assert.equal(C.invitesDue(model({ subs: [c] }), "list-1").length, 1);
  assert.equal(C.usedToday({ "chan-1": { d: "2026-10-12", n: 7 } }, "chan-1", "2026-10-12"), 7);
  assert.equal(C.usedToday({ "chan-1": { d: "2026-10-11", n: 7 } }, "chan-1", "2026-10-12"), 0);
});

// ---------------------------------------------------------------
// Imports + export
// ---------------------------------------------------------------

test("CSV: header detection (EN and EL), quotes, semicolons, BOM", () => {
  const rows = C.parseCsv("﻿Όνομα;Email;Ετικέτες\n\"Ann; A.\";ann@x.gr;vip, gr\nBob;not-an-address;\n;bob@x.gr;\n");
  const r = C.peopleFromRows(rows);
  assert.equal(r.bad, 1);
  assert.deepEqual(r.people.map((p) => [p.email, p.name, p.tags.join("|")]), [["ann@x.gr", "Ann; A.", "gr|vip"], ["bob@x.gr", "", ""]]);
  const nohead = C.peopleFromRows(C.parseCsv("x,ann@x.gr\ny,bob@x.gr\n"));
  assert.equal(nohead.people.length, 2);
  const first = C.peopleFromRows(C.parseCsv("first name,last name,e-mail\nAnn,Lee,ann@x.gr\n"));
  assert.equal(first.people[0].name, "Ann Lee");
  const t = C.peopleFromText("Ann <ann@x.gr>, bob@x.gr\nnope");
  assert.deepEqual(t.people.map((p) => p.email), ["ann@x.gr", "bob@x.gr"]);
  assert.equal(t.bad, 1);
});

test("planImport: duplicates, unsubscribed and deleted-for-good are never added", () => {
  const d = model({ subs: [sub("on@x.gr"), sub("left@x.gr", { off: 50 })], supp: [C.suppHash("gone@x.gr")] });
  const people = ["on@x.gr", "left@x.gr", "gone@x.gr", "new@x.gr", "NEW@x.gr"].map((email) => ({ email, name: "", tags: [] }));
  const p = C.planImport(d, "list-1", people, { now: 1000, basis: "optin", tags: ["csv"] });
  assert.deepEqual(p.add.map((s) => s.email), ["new@x.gr"]);
  assert.equal(p.add[0].conf, 0);                         // double opt-in: pending
  assert.deepEqual(p.add[0].tags, ["csv"]);
  assert.equal(p.dup, 2);
  assert.equal(p.left, 1);
  assert.equal(p.supp, 1);
  const q = C.planImport(d, "list-1", [{ email: "c@x.gr" }], { now: 1000, basis: "consent" });
  assert.equal(C.status(q.add[0]), "on");
});

test("CSV export guards against formulas", () => {
  assert.equal(C.csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(C.csvCell("a;b"), "\"a;b\"");
  const d = model({ subs: [sub("a@x.gr", { name: "+30 Ann" })] });
  const csv = C.subsCsv(d, "list-1", ["email", "name", "lang", "tags", "status", "src", "basis", "at", "conf", "off"], (s) => s, (b) => b);
  assert.ok(csv.startsWith("﻿email;name"));
  assert.ok(csv.includes("a@x.gr;'+30 Ann;"));
  assert.equal(C.personData(d, "A@x.gr").subscriptions[0].status, "on");
});

// ---------------------------------------------------------------
// Pre-send check
// ---------------------------------------------------------------

test("preflight: errors and warnings", () => {
  const d = model();
  const keys = (x, info) => C.preflight(d, C.normIssue(x), info).map((r) => r.lvl + ":" + r.k).sort();
  assert.deepEqual(keys(issue("iss-1"), { chan: CHAN, inbox: true, aud: 3 }), []);
  assert.deepEqual(keys(issue("iss-1", { subj: "", blocks: [{ k: "hr" }] }), { chan: null, aud: 0 }),
    ["err:noAudience", "err:noBody", "err:noChan", "err:noSubj"]);
  assert.deepEqual(keys(issue("iss-1", { subj: "BIG NEWS TODAY!!", blocks: [{ k: "p", t: "Hi {nmae}" }, { k: "btn", t: "Go", href: "" }] }),
    { chan: CHAN, inbox: false, aud: 1, imgBytes: C.LIM.imgBytes + 1 }),
    ["err:badBlock", "warn:bigImgs", "warn:noInbox", "warn:placeholder", "warn:shouty"]);
  assert.equal(C.badPlaceholders("{name} {first|φίλε} {name|}"), false);
  assert.equal(C.badPlaceholders("{email}"), true);
});

// ---------------------------------------------------------------
// Delivery-failure reports
// ---------------------------------------------------------------

test("parseDsn: hard and soft failures, delayed ignored", () => {
  const raw = [
    "Content-Type: message/delivery-status", "",
    "Reporting-MTA: dns; mx.example.com", "",
    "Final-Recipient: rfc822; <Hard@Example.com>", "Action: failed", "Status: 5.1.1", "",
    "Final-Recipient: rfc822; soft@example.com", "Action: failed", "Status: 4.2.2", "",
    "Final-Recipient: rfc822; later@example.com", "Action: delayed", "Status: 4.4.1", ""
  ].join("\r\n");
  assert.deepEqual(C.parseDsn(raw), [{ addr: "Hard@Example.com", hard: true }, { addr: "soft@example.com", hard: false }]);
  assert.deepEqual(C.parseDsn("X-Failed-Recipients: a@x.gr, b@x.gr\n"), [{ addr: "a@x.gr", hard: true }, { addr: "b@x.gr", hard: true }]);
  assert.equal(C.isBounceFrom("MAILER-DAEMON@mx.example.com", ""), true);
  assert.equal(C.isBounceFrom("ann@x.gr", "Mail Delivery Subsystem"), true);
  assert.equal(C.isBounceFrom("ann@x.gr", "Ann"), false);
});

test("backup round trip; other apps' files refused", () => {
  const d = model({ subs: [sub("a@x.gr")], issues: [issue("iss-1")] });
  assert.equal(json(C.fromBackup(C.toBackup(d))), json(d));
  assert.equal(C.fromBackup(JSON.stringify({ app: "invoices", data: {} })), null);
  assert.equal(C.fromBackup("{nope"), null);
  assert.equal(C.slug("Τεύχος #3: Νέα!"), "τευχος-3-νεα");
});

// ---------------------------------------------------------------
// The e-mail
// ---------------------------------------------------------------

test("render: user text is escaped, links are safe, greeting falls back", () => {
  const d = model();
  const x = C.normIssue(issue("iss-1", { subj: "Hi {first|friend}", blocks: [
    { k: "p", t: "<script>alert(1)</script> [site](javascript:alert(1)) [ok](https://example.com) {first|friend}" },
    { k: "btn", t: "<b>Go</b>", href: "https://example.com/?a=1&b=2" }
  ] }));
  const e = R.email({ issue: x, list: d.lists[0], sub: { name: "Ann Lee", email: "a@x.gr" }, lang: "en",
                      img: () => "", unsub: R.mailto("me@example.com", "unsubscribe nl-abc"), tok: "nl-abc", mailbox: "me@example.com" });
  assert.equal(e.subject, "Hi Ann");
  assert.ok(!e.html.includes("<script>"));
  assert.ok(e.html.includes("&lt;script&gt;"));
  assert.ok(!/href="javascript:/i.test(e.html));
  assert.ok(e.html.includes("href=\"https://example.com\""));
  assert.ok(e.html.includes("&lt;b&gt;Go&lt;/b&gt;"));
  assert.ok(e.html.includes("mailto:me@example.com?subject=unsubscribe%20nl-abc"));
  assert.ok(e.text.includes("Ann"));
  assert.ok(e.text.includes("unsubscribe nl-abc"));
  const anon = R.email({ issue: x, list: d.lists[0], sub: null, lang: "el", img: () => "", unsub: "" });
  assert.equal(anon.subject, "Hi friend");
  assert.ok(anon.html.includes("1 Main St, Athens"));
});

test("render: Markdown becomes blocks", () => {
  const b = R.mdToBlocks("# Title\n\nLine one\nline two\n\n---\n![cat](https://e.com/c.jpg)\n[[Read](https://e.com)]\n");
  assert.deepEqual(b.map((x) => x.k), ["h", "p", "hr", "img", "btn"]);
  assert.equal(b[1].t, "Line one\nline two");
  assert.equal(b[4].href, "https://e.com");
});

test("render: confirmation request has no footer reason and carries the confirm token", () => {
  const d = model();
  const c = R.confirmEmail({ list: d.lists[0], sub: { name: "Ann Lee" }, lang: "el", mailbox: "me@example.com", tok: "nl-12345678901",
                             confirm: R.mailto("me@example.com", "confirm nl-12345678901") });
  assert.equal(c.subject, "Επιβεβαίωσε την εγγραφή: Friends");
  assert.ok(c.text.includes("confirm nl-12345678901"));
  assert.ok(!c.html.includes("You signed up on my site."));
  assert.ok(c.html.includes("mailto:me@example.com?subject=confirm%20nl-12345678901"));
});

test("message: List-Unsubscribe, List-Id, Reply-To and the provider header on top of Mail's builder", () => {
  const m = R.message(M, { from: { name: "Me", addr: "me@example.com" }, to: { name: "Ann", addr: "a@x.gr" },
    reply: "reply@example.com", subject: "Γεια σου", text: "Hi", html: "<p>Hi</p>",
    listId: "list-1", listName: "Friends", unsub: "mailto:me@example.com?subject=unsubscribe%20nl-abc", tag: "iss-1",
    hdr: ["X-PM-Message-Stream", "broadcast"] });
  const head = m.bin.split("\r\n\r\n")[0];
  assert.match(head, /^Reply-To: reply@example\.com\r\n/);
  assert.match(head, /\r\nList-Id: Friends <list-1\.newsletter\.example\.com>\r\n/);
  assert.match(head, /\r\nList-Unsubscribe: <mailto:me@example\.com\?subject=unsubscribe%20nl-abc>\r\n/);
  assert.match(head, /\r\nX-Oros-Newsletter: iss-1\r\n/);
  assert.match(head, /\r\nX-PM-Message-Stream: broadcast\r\n/);
  assert.match(head, /\r\nSubject: =\?UTF-8\?/);
  const bad = R.message(M, { from: { name: "", addr: "me@example.com" }, to: { name: "", addr: "a@x.gr" }, subject: "x", text: "x",
    hdr: ["Bad Header", "x\r\nBcc: evil@x.gr"] });
  assert.ok(!bad.bin.includes("evil@x.gr"));
});

// ---------------------------------------------------------------
// Search provider
// ---------------------------------------------------------------

test("search provider: issues and lists only, never subscribers, read-only", () => {
  const S = require("../search.js");
  const P = require("../newsletter/search.js");
  const data = {
    lists: [LIST, { id: "list-2", m: 9, del: 1 }],
    subs: [sub("secret@x.gr", { name: "Secret Person" })],
    issues: [issue("iss-1", { st: "sent", done: 777, subj: "October news" }), issue("iss-2", { fmt: "md", md: "# Big\nhello", subj: "" }),
             { id: "iss-3", m: 5, del: 1 }]
  };
  const m = new Map([[P.keys[0], JSON.stringify(data)]]);
  const ctx = (lang) => ({ q: "news", words: S.parseQuery("news"), fold: S.fold, lang, limit: 50,
    readJSON: S.makeReader({ getItem: (k) => (m.has(k) ? m.get(k) : null) }) });
  const hits = Object.fromEntries(P.search(ctx("en")).map((h) => [h.id, h]));
  assert.deepEqual(Object.keys(hits).sort(), ["i:iss-1", "i:iss-2", "l:list-1"]);
  assert.equal(hits["i:iss-1"].title, "October news · Friends");
  assert.equal(hits["i:iss-1"].when, 777);
  assert.deepEqual(hits["i:iss-1"].target, { issue: "iss-1" });
  assert.deepEqual(hits["l:list-1"].target, { list: "list-1" });
  assert.ok(hits["i:iss-2"].text.includes("hello"));
  assert.equal(P.search(ctx("el")).find((h) => h.id === "i:iss-2").title, "Τεύχος χωρίς θέμα · Friends");
  assert.ok(!JSON.stringify(P.search(ctx("en"))).includes("secret"));
  assert.deepEqual(P.search({ readJSON: () => null, lang: "en" }), []);
  assert.ok(!/setItem|removeItem|registerSlice|innerHTML/.test(fs.readFileSync(require.resolve("../newsletter/search.js"), "utf8")));
});

// ---------------------------------------------------------------
// The app: strings, palette contract, files
// ---------------------------------------------------------------

test("app: EN and EL strings have the same keys and every used key exists", () => {
  const js = fs.readFileSync(path.join(ROOT, "newsletter/newsletter.js"), "utf8");
  const start = js.indexOf("var STRINGS = {");
  const end = js.indexOf("\n  };\n", start);
  assert.ok(start > 0 && end > start);
  const S = vm.runInNewContext("(" + js.slice(start + "var STRINGS = ".length, end + 4) + ")");
  assert.deepEqual(Object.keys(S.el).sort(), Object.keys(S.en).sort());
  const used = new Set();
  for (const m of js.matchAll(/\bt\("([a-zA-Z]+(?:\.[A-Za-z0-9]+)*)"/g)) used.add(m[1]);
  const html = fs.readFileSync(path.join(ROOT, "newsletter/index.html"), "utf8");
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
  // keys built at run time: t("p." + preset), t("st." + status)…
  const dyn = [].concat(
    Object.keys(C.PRESETS).map((k) => "p." + k), C.THEMES.map((k) => "th." + k),
    C.BASES.map((k) => "basis." + k), C.BASES.map((k) => "basis." + k + "Hint"),
    ["manual", "paste", "csv", "contacts", "mail", "crm", "platform"].map((k) => "src." + k),
    ["h", "p", "img", "btn", "hr", "cols"].map((k) => "bk." + k),
    ["draft", "sched", "sending", "paused", "sent"].map((k) => "st." + k),
    ["lead", "active", "past"].map((k) => "crm." + k), ["en", "el"].map((k) => "lang." + k),
    ["on", "pend", "off", "bounce", "spam"].map((k) => "sst." + k),
    ["noSubj", "longSubj", "shouty", "noBody", "noAddr", "noFrom", "noChan", "noInbox", "bigImgs", "badBlock", "placeholder", "noAudience", "segGone"].map((k) => "ck." + k),
    ["issues", "subs", "lists"].map((k) => "tab." + k));
  for (const k of dyn) used.add(k);
  for (const k of used) assert.ok(S.en[k] !== undefined, "missing string " + k);
});

test("app: palette contract, sync slice and no eval", () => {
  const js = fs.readFileSync(path.join(ROOT, "newsletter/newsletter.js"), "utf8");
  assert.ok(js.includes("inheritPalette") && js.includes("watchPalette"));
  assert.match(js, /registerSlice\(\s*"newsletter"/);
  assert.match(fs.readFileSync(path.join(ROOT, "newsletter/runner.js"), "utf8"), /registerSlice\(\s*"newsletter"/);
  assert.ok(!/\beval\(|new Function\(/.test(js));
  const html = fs.readFileSync(path.join(ROOT, "newsletter/index.html"), "utf8");
  for (const m of html.matchAll(/(?:src|href)="([^"?]+)/g)) assert.ok(fs.existsSync(path.join(ROOT, "newsletter", m[1])), m[1]);
});

// ---------------------------------------------------------------
// Two devices through the real sync engine
// ---------------------------------------------------------------

test("sync: subscribers and sends from two devices merge, unsubscribe wins", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const B = await createDevice(db, "B");
  const reg = (dev) => dev.sync.registerSlice("newsletter",
    () => C.normalize(readKey(dev, C.STORAGE_KEY) || {}),
    (data) => writeKey(dev, C.STORAGE_KEY, C.mergeNewsletter(readKey(dev, C.STORAGE_KEY) || {}, data)),
    C.STORAGE_KEY, C.mergeNewsletter);
  reg(A); reg(B);

  writeKey(A, C.STORAGE_KEY, model({ subs: [sub("a@x.gr"), sub("b@x.gr")], issues: [issue("iss-1", { st: "sending", m: 20 })] }));
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();

  const edit = (dev, fn) => {
    const cur = readKey(dev, C.STORAGE_KEY);
    fn(cur);
    writeKey(dev, C.STORAGE_KEY, C.normalize(cur));
    dev.sync.markDirty();
  };
  const ida = C.subId("list-1", "a@x.gr"), idb = C.subId("list-1", "b@x.gr");
  edit(A, (d) => { d.sent["iss-1"] = [ida]; d.subs.find((s) => s.id === idb).name = "Bee"; d.subs.find((s) => s.id === idb).m = 30; });
  edit(B, (d) => { d.sent["iss-1"] = [idb]; const s = d.subs.find((x) => x.id === idb); s.off = 40; s.offSt = "off"; s.m = 25; });
  await A.sync.push();
  await B.sync.push();
  await A.sync.pull();
  await B.sync.pull();

  const a = readKey(A, C.STORAGE_KEY), b = readKey(B, C.STORAGE_KEY);
  assert.equal(json(C.normalize(a)), json(C.normalize(b)));
  assert.deepEqual(a.sent["iss-1"].slice().sort(), [ida, idb].sort());
  const bee = C.sub(a, idb);
  assert.equal(bee.name, "Bee");
  assert.equal(C.status(bee), "off");
});
