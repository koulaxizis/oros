// Pure logic of Netizen ID: card normalize + merge, the seeded pixel
// avatar, vCard building, the share payload.
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the pure functions are
// cut out of the source by name (brace matching) and evaluated on their
// own. A renamed function fails here loudly ("missing function …").

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "netizen", "netizen.js"), "utf8");

function cutFunction(name) {
  const i = SRC.indexOf("  function " + name + "(");
  if (i < 0) throw new Error("missing function " + name);
  let depth = 0, j = SRC.indexOf("{", i);
  for (; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) break;
  }
  return SRC.slice(i, j + 1);
}
function cutBlock(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

const NZ = new Function(
  [cutBlock("  var DATA_VER", "  // ---------- 1."),
   cutBlock("  var AV_BG", "  function genAvatar("),
   ...["cmpStr", "isInt", "str", "hash32", "prng", "normCard", "mergeNetizen", "shown",
       "genAvatar", "vEsc", "vFold", "buildVCard", "sharePayload", "cardFromPayload",
       "b64urlFromBytes", "bytesFromB64url"].map(cutFunction)].join("\n") +
  "\nreturn { normCard, mergeNetizen, genAvatar, buildVCard, vFold, sharePayload, cardFromPayload," +
  " b64urlFromBytes, bytesFromB64url };")();

function card(over) {
  return NZ.normCard(Object.assign({ id: "abc123", m: 100, user: "ada", av: { s: "seed1" } }, over));
}
const J = (x) => JSON.stringify(x);

test("normCard drops bad cards and clips fields", () => {
  assert.equal(NZ.normCard(null), null);
  assert.equal(NZ.normCard({ id: "X!", m: 1 }), null);
  assert.equal(NZ.normCard({ id: "abc123", m: -1 }), null);
  const c = NZ.normCard({
    id: "abc123", m: 5, user: "x".repeat(50), st: "bogus",
    links: Array.from({ length: 12 }, (_, i) => ({ l: "L" + i, u: "u" + i })),
    tags: ["a", "a", "b", 7], hide: ["bio", "nope", "bio", "avatar"],
    av: { s: "BAD SEED", px: "123", t: 1 }
  });
  assert.equal(c.user.length, 32);
  assert.equal(c.st, "oros");
  assert.equal(c.links.length, 8);
  assert.deepEqual(c.tags, ["a", "b"]);
  assert.deepEqual(c.hide, ["avatar", "bio"]);
  assert.deepEqual(c.av, { s: "netizen", px: "", t: 1 });
  assert.equal(J(NZ.normCard(c)), J(c), "idempotent");
});

test("merge: LWW per card, symmetric, associative, idempotent, inputs untouched", () => {
  const A = { cards: [card({ id: "aaaaaa", m: 10, user: "a1" }), card({ id: "bbbbbb", m: 20, user: "b-old" })], tombs: {} };
  const B = { cards: [card({ id: "bbbbbb", m: 30, user: "b-new" }), card({ id: "cccccc", m: 5 })], tombs: { dddddd: 7 } };
  const C = { cards: [card({ id: "aaaaaa", m: 10, user: "a2" })], tombs: { cccccc: 4 } };
  const before = J([A, B, C]);
  const ab = NZ.mergeNetizen(A, B);
  assert.equal(J(ab), J(NZ.mergeNetizen(B, A)));
  assert.equal(J(NZ.mergeNetizen(NZ.mergeNetizen(A, B), C)), J(NZ.mergeNetizen(A, NZ.mergeNetizen(B, C))));
  assert.equal(J(NZ.mergeNetizen(ab, ab)), J(ab));
  assert.equal(J([A, B, C]), before);
  assert.deepEqual(ab.cards.map((c) => c.id), ["aaaaaa", "bbbbbb", "cccccc"]);
  assert.equal(ab.cards[1].user, "b-new");
  // equal mtime: the same winner from either side
  assert.equal(J(NZ.mergeNetizen(A, C)), J(NZ.mergeNetizen(C, A)));
});

test("merge: tombstones (delete wins ties, a newer edit resurrects)", () => {
  const c = card({ id: "aaaaaa", m: 50 });
  assert.equal(NZ.mergeNetizen({ cards: [c] }, { tombs: { aaaaaa: 50 } }).cards.length, 0);
  assert.equal(NZ.mergeNetizen({ cards: [c] }, { tombs: { aaaaaa: 49 } }).cards.length, 1);
  const m = NZ.mergeNetizen({ cards: [c], tombs: { aaaaaa: 10 } }, { tombs: { aaaaaa: 60, "bad id": 3 } });
  assert.deepEqual(m.tombs, { aaaaaa: 60 });
  assert.equal(m.cards.length, 0);
});

test("avatar: deterministic, mirrored, 12×12 in 7 colours", () => {
  const a = NZ.genAvatar("hello"), b = NZ.genAvatar("hello");
  assert.equal(J(a), J(b));
  assert.notEqual(NZ.genAvatar("hello").px, NZ.genAvatar("world").px);
  for (let s = 0; s < 300; s++) {
    const g = NZ.genAvatar("s" + s);
    assert.match(g.px, /^[0-6]{144}$/);
    assert.equal(g.pal.length, 7);
    for (let y = 0; y < 12; y++) {
      const row = g.px.slice(y * 12, y * 12 + 12);
      assert.equal(row, row.split("").reverse().join(""), "row " + y + " mirrored");
    }
    assert.ok(g.px.indexOf("3") >= 0, "has eyes");
    assert.ok(g.px.indexOf("1") >= 0, "has skin");
  }
});

test("vCard: escaping, hidden fields stay out, CRLF, 75-octet folding", () => {
  const c = card({
    user: "ada", disp: "Ada; Lovelace, Countess", email: "ada@example.org", phone: "+30 123",
    bio: "Line one\nΓραμμή δύο με πολλά ελληνικά γράμματα που κάνουν τη γραμμή πολύ μακριά για ένα vCard",
    motto: "Hello", tags: ["math", "a,b"], loc: "London", hide: ["phone"],
    links: [{ l: "Site", u: "https://ada.example" }, { l: "", u: "" }]
  });
  const v = NZ.buildVCard(c, "");
  assert.ok(v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n"));
  assert.ok(v.endsWith("END:VCARD\r\n"));
  assert.ok(v.includes("FN:Ada\\; Lovelace\\, Countess\r\n"));
  assert.ok(v.includes("NICKNAME:ada\r\n"));
  assert.ok(!v.includes("TEL"), "hidden phone stays out");
  assert.ok(v.includes("item1.URL:https://ada.example\r\nitem1.X-ABLabel:Site\r\n"));
  assert.ok(!v.includes("item2"), "empty link skipped");
  assert.ok(v.includes("CATEGORIES:math,a\\,b\r\n"));
  assert.ok(v.includes("ADR:;;;London;;;\r\n"));
  for (const line of v.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75, "line ≤ 75 octets: " + line);
  // unfolding gives the original NOTE back, multi-byte characters intact
  const unfolded = v.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("Γραμμή δύο με πολλά ελληνικά γράμματα"));
  assert.ok(unfolded.includes("Line one\\nΓραμμή"));
});

test("share payload: only what the card shows, round trip through base64url", () => {
  const c = card({ user: " ada ", email: "secret@example.org", hide: ["email", "avatar"], tags: ["x"], st: "mint" });
  const p = NZ.sharePayload(c);
  assert.equal(p.user, "ada");
  assert.ok(!("email" in p), "hidden email stays out");
  assert.ok(!("av" in p), "hidden avatar stays out");
  assert.ok(!("id" in p) && !("m" in p) && !("hide" in p));
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  const code = NZ.b64urlFromBytes(bytes);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const back = NZ.cardFromPayload(JSON.parse(new TextDecoder().decode(NZ.bytesFromB64url(code))));
  assert.equal(back.user, "ada");
  assert.equal(back.st, "mint");
  assert.deepEqual(back.tags, ["x"]);
  assert.deepEqual(back.hide, ["avatar"]);
  assert.equal(back.email, "");
  // no username / not an object → refused
  assert.equal(NZ.cardFromPayload({ user: "  " }), null);
  assert.equal(NZ.cardFromPayload("x"), null);
});
