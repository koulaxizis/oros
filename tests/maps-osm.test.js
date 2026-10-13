// Pure logic of the Maps OpenStreetMap core (maps/osm.js): PKCE and
// the authorize URL, note parsing (text only, no html), link
// splitting, dates, the duplicate check, and the sync merge of the
// "mapsosm" slice (drafts + tombstones + upload comment).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const O = require(path.join(__dirname, "..", "maps/osm.js"));

function feature(id, extra) {
  return Object.assign({
    type: "Feature",
    geometry: { type: "Point", coordinates: [23.7275, 37.9838] },
    properties: {
      id, status: "open", date_created: "2026-10-12 08:00:00 UTC",
      comments: [{ date: "2026-10-12 08:00:00 UTC", uid: 7, user: "ann", action: "opened",
        text: "Bakery closed", html: "<p>Bakery closed</p>" }]
    }
  }, extra || {});
}

test("PKCE: verifier is URL-safe, S256 challenge matches RFC 7636", async () => {
  const v = O.randomString(64);
  assert.equal(v.length, 64);
  assert.match(v, /^[A-Za-z0-9_-]+$/);
  // RFC 7636 appendix B example
  const ch = await O.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.equal(ch, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const ours = await O.pkceChallenge(v);
  assert.equal(ours, crypto.createHash("sha256").update(v).digest("base64url"));
});

test("authorize URL carries client, scopes, state, S256, exact redirect", () => {
  const u = new URL(O.authorizeUrl("dev", { client: "abc", state: "st8", challenge: "chal",
    redirect: "https://useoros.online/maps/osm-callback.html" }));
  assert.equal(u.origin, "https://master.apis.dev.openstreetmap.org");
  assert.equal(u.pathname, "/oauth2/authorize");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), "abc");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("redirect_uri"), "https://useoros.online/maps/osm-callback.html");
  assert.deepEqual(u.searchParams.get("scope").split(" "), O.SCOPES);
  assert.ok(O.SCOPES.includes("write_notes") && O.SCOPES.includes("write_api"));
  assert.equal(new URL(O.authorizeUrl("live", { client: "x", state: "s", challenge: "c", redirect: "r" })).origin,
    "https://www.openstreetmap.org");
});

test("servers: secrets never in code, default comment as asked", () => {
  assert.equal(O.DEFAULT_COMMENT, "Uploaded using orOS Maps");
  const src = fs.readFileSync(path.join(__dirname, "..", "maps/osm.js"), "utf8") +
              fs.readFileSync(path.join(__dirname, "..", "maps/osm-api.js"), "utf8");
  assert.ok(!/client_secret/.test(src), "public client: no secret anywhere");
});

test("parseNote: strict, text only, html ignored, bad rows dropped", () => {
  const n = O.parseNote(feature(42));
  assert.equal(n.id, 42);
  assert.equal(n.lat, 37.9838);
  assert.equal(n.status, "open");
  assert.equal(n.comments[0].text, "Bakery closed");
  assert.ok(!("html" in n.comments[0]));
  assert.equal(O.parseNote(feature("17")).id, 17);
  assert.equal(O.parseNote(feature(-1)), null);
  assert.equal(O.parseNote(feature(1.5)), null);
  assert.equal(O.parseNote(feature(3, { geometry: { coordinates: [200, 10] } })), null);
  assert.equal(O.parseNote({}), null);
  const odd = O.parseNote(feature(5, { properties: { id: 5, status: "weird",
    comments: [{ action: "<script>", user: { x: 1 }, text: 12, uid: "9" }, null] } }));
  assert.equal(odd.status, "open");
  assert.equal(odd.comments.length, 1);
  assert.equal(odd.comments[0].action, "commented");
  assert.equal(odd.comments[0].user, "");
  assert.equal(odd.comments[0].text, "");
  assert.equal(odd.comments[0].uid, 0);
  const c = O.parseNote(feature(6, { properties: { id: 6, status: "closed", comments: [] } }));
  assert.equal(c.status, "closed");
});

test("parseNotes: collection, single feature, dedupe, garbage", () => {
  const list = O.parseNotes({ type: "FeatureCollection", features: [feature(1), feature(2), feature(1), { bad: 1 }] });
  assert.deepEqual(list.map(n => n.id), [1, 2]);
  assert.equal(O.parseNotes(feature(9))[0].id, 9);
  assert.deepEqual(O.parseNotes(null), []);
  assert.deepEqual(O.parseNotes({ type: "FeatureCollection", features: "x" }), []);
});

test("splitLinks: only http(s), punctuation stays text, XSS text stays text", () => {
  assert.deepEqual(O.splitLinks("see https://osm.org/x, and http://a.b."), [
    { t: "text", v: "see " }, { t: "link", v: "https://osm.org/x" },
    { t: "text", v: ", and " }, { t: "link", v: "http://a.b" }, { t: "text", v: "." }]);
  const evil = O.splitLinks('javascript:alert(1) <img src=x onerror=alert(1)> data:text/html,x');
  assert.ok(evil.every(p => p.t === "text"));
  assert.deepEqual(O.splitLinks('https://x.org/"onmouseover=1'), [
    { t: "link", v: "https://x.org/" }, { t: "text", v: '"onmouseover=1' }]);
  assert.deepEqual(O.splitLinks(""), []);
});

test("dates and replies by others", () => {
  assert.equal(O.osmDate("2026-10-13 06:00:00 UTC"), Date.UTC(2026, 9, 13, 6, 0, 0));
  assert.equal(O.osmDate("2026-10-13T06:00:00Z"), Date.UTC(2026, 9, 13, 6, 0, 0));
  assert.equal(O.osmDate("yesterday"), 0);
  const n = O.parseNote(feature(1, { properties: { id: 1, status: "open", comments: [
    { date: "2026-10-12 08:00:00 UTC", uid: 7, action: "opened", text: "a" },
    { date: "2026-10-12 09:00:00 UTC", uid: 8, action: "commented", text: "b" },
    { date: "2026-10-12 10:00:00 UTC", uid: 7, action: "commented", text: "c" }] } }));
  assert.equal(O.lastOtherDate(n, 7), Date.UTC(2026, 9, 12, 9, 0, 0));
  assert.equal(O.lastOtherDate(n, 8), Date.UTC(2026, 9, 12, 10, 0, 0));
});

test("nearNotes: open only, within radius, nearest first", () => {
  const base = { comments: [], created: "", closedAt: "" };
  const notes = [
    Object.assign({ id: 1, lat: 37.98380, lon: 23.72750, status: "open" }, base),
    Object.assign({ id: 2, lat: 37.98400, lon: 23.72750, status: "open" }, base),    // ~22 m
    Object.assign({ id: 3, lat: 37.98380, lon: 23.72750, status: "closed" }, base),
    Object.assign({ id: 4, lat: 37.99000, lon: 23.72750, status: "open" }, base)     // ~690 m
  ];
  assert.deepEqual(O.nearNotes(notes, 37.9838, 23.7275, 50).map(n => n.id), [1, 2]);
  assert.ok(Math.abs(O.distM(37.9838, 23.7275, 37.9840, 23.7275) - 22.2) < 0.5);
});

// ---------- slice "mapsosm" ----------
const DEV = "dabc1234";
function nd(id, m, extra) { return Object.assign({ id, m, dev: DEV, kind: "note", srv: "live", lat: 37.9, lon: 23.7, text: "t " + id }, extra || {}); }

test("normDraft: strict per kind", () => {
  assert.equal(O.normDraft(nd("abcdef1", 5)).kind, "note");
  assert.equal(O.normDraft(nd("ab", 5)), null);                                   // short id
  assert.equal(O.normDraft(nd("abcdef1", 5, { text: "  " })), null);              // note needs text
  assert.equal(O.normDraft(nd("abcdef1", 5, { lat: 91 })), null);
  assert.equal(O.normDraft(nd("abcdef1", 5, { kind: "delete" })), null);
  assert.equal(O.normDraft(nd("abcdef1", 5, { dev: "X!" })), null);
  assert.equal(O.normDraft(nd("abcdef1", 5, { srv: "evil" })).srv, "live");
  const c = O.normDraft({ id: "abcdef2", m: 1, dev: DEV, kind: "close", note: 99, text: "" });
  assert.equal(c.note, 99);
  assert.equal(O.normDraft({ id: "abcdef2", m: 1, dev: DEV, kind: "comment", note: 99, text: "" }), null);
  assert.equal(O.normDraft({ id: "abcdef2", m: 1, dev: DEV, kind: "reopen", note: 0 }), null);
  const long = O.normDraft(nd("abcdef3", 1, { text: "x".repeat(5000), extra: 1 }));
  assert.equal(long.text.length, O.LIM.noteText);
  assert.ok(!("extra" in long));
  assert.equal(O.normDraft(nd("abcdef4", 1, { text: "a\u0000b\r\nc" })).text, "ab\nc");
});

test("normalize: canonical, tomb drops older or equal draft, caps", () => {
  const d = O.normalize({ drafts: { abcdef1: nd("abcdef1", 5), zzzzzz9: nd("zzzzzz9", 3), wrongk: nd("abcdef7", 1) },
    tombs: { zzzzzz9: 3, BAD: 1 }, set: { m: 2, comment: "  my  edits " } });
  assert.deepEqual(Object.keys(d.drafts), ["abcdef1"]);
  assert.deepEqual(Object.keys(d.tombs), ["zzzzzz9"]);
  assert.equal(d.set.comment, "my edits");
  assert.equal(JSON.stringify(O.normalize(d)), JSON.stringify(d));
  assert.equal(JSON.stringify(O.normalize(null)), JSON.stringify({ ver: 1, set: { m: 0, comment: "" }, drafts: {}, tombs: {} }));
  // newer edit resurrects
  assert.ok(O.normalize({ drafts: { abcdef1: nd("abcdef1", 9) }, tombs: { abcdef1: 8 } }).drafts.abcdef1);
});

test("uploadComment: default unless the user set one", () => {
  assert.equal(O.uploadComment(O.normalize(null)), "Uploaded using orOS Maps");
  assert.equal(O.uploadComment(O.normalize({ set: { m: 1, comment: "Survey" } })), "Survey");
});

test("merge: symmetric, idempotent, associative (fuzz), sent draft never comes back", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ids = ["aaaaaa1", "bbbbbb2", "cccccc3", "dddddd4"];
  function randState() {
    const s = { drafts: {}, tombs: {}, set: { m: Math.floor(rnd() * 5), comment: rnd() < 0.5 ? "" : "c" + Math.floor(rnd() * 3) } };
    ids.forEach(id => {
      const r = rnd();
      if (r < 0.4) s.drafts[id] = nd(id, Math.floor(rnd() * 6), { text: "v" + Math.floor(rnd() * 3), err: rnd() < 0.2 ? "409" : undefined });
      else if (r < 0.6) s.tombs[id] = Math.floor(rnd() * 6);
    });
    return s;
  }
  const J = x => JSON.stringify(x);
  for (let i = 0; i < 3000; i++) {
    const a = randState(), b = randState(), c = randState();
    assert.equal(J(O.merge(a, b)), J(O.merge(b, a)), "symmetric");
    assert.equal(J(O.merge(a, a)), J(O.normalize(a)), "idempotent");
    assert.equal(J(O.merge(O.merge(a, b), c)), J(O.merge(a, O.merge(b, c))), "associative");
    const g = O.merge(a, b);
    assert.equal(J(O.merge(g, g)), J(g));
  }
  // device A sent the draft (tomb), device B still has the old copy
  const sentA = { drafts: {}, tombs: { aaaaaa1: 11 } };
  const oldB = { drafts: { aaaaaa1: nd("aaaaaa1", 10) }, tombs: {} };
  assert.deepEqual(O.merge(sentA, oldB).drafts, {});
  assert.deepEqual(O.merge(oldB, sentA).drafts, {});
});

test("Maps page loads the OSM scripts after maps.js, callback page exists", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "maps/index.html"), "utf8");
  const i = name => html.indexOf('src="' + name);
  assert.ok(i("maps.js") > 0 && i("maps.js") < i("osm.js") && i("osm.js") < i("osm-api.js") && i("osm-api.js") < i("notes.js"));
  const cb = fs.readFileSync(path.join(__dirname, "..", "maps/osm-callback.html"), "utf8");
  assert.ok(cb.includes('src="osm-callback.js"'));
  assert.ok(!/<script>(?!<)/.test(cb), "no inline script");
});
