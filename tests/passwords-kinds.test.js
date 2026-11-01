// Passwords entry types (passwords/pmkinds.js, PW-K1): cards,
// identities, addresses and secure notes as reserved fields, the
// card checks, label conversion, the Bitwarden mapping, and that an
// OLDER orOS (pmcore.js of 4.96.00, kept below) carries every typed
// value through its normalise and merge untouched.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const DIR = path.join(__dirname, "..", "passwords");
const K = require(path.join(DIR, "pmkinds.js"));
const PC = require(path.join(DIR, "pmcore.js"));

// pmcore.js as shipped before PW-K1 (4.96.00): its normEntry drops
// unknown keys, so typed values must live in `fields`. Loaded from the
// fixture so the test keeps checking the old behaviour for ever.
function oldCore() {
  const src = fs.readFileSync(path.join(__dirname, "fixtures", "pmcore-4.96.00.js"), "utf8");
  const sandbox = { module: { exports: {} }, globalThis: { crypto: globalThis.crypto }, Uint8Array, Math, JSON, Date, String, Number, Object, Array, isFinite, parseInt, Promise };
  sandbox.globalThis = sandbox; sandbox.crypto = globalThis.crypto;
  vm.runInNewContext(src, sandbox);
  return sandbox.module.exports;
}

const NOW = Date.UTC(2026, 10, 1, 12);

function card() {
  const e = PC.blankEntry(NOW);
  e.title = "Visa salary";
  e.urls = ["https://bank.example"];
  e.notes = "call 210 0000000 if lost";
  return K.withData(e, "card", { holder: "Maria P", num: "4111 1111 1111 1111", exp: "8/27", cvv: "123", pin: "0000", bank: "Bank" },
                    [{ h: 0, n: "Limit", v: "2000" }]);
}

test("a card keeps its values as reserved fields, in the type's order, hidden where secret", () => {
  const e = PC.normEntry(card());
  assert.equal(K.kindOf(e), "card");
  assert.deepEqual(e.fields.map((f) => [f.n, f.v, f.h]), [
    ["oros:k", "card", 0], ["oros:cc.holder", "Maria P", 0], ["oros:cc.num", "4111 1111 1111 1111", 1],
    ["oros:cc.exp", "08/2027", 0], ["oros:cc.cvv", "123", 1], ["oros:cc.pin", "0000", 1], ["oros:cc.bank", "Bank", 0],
    ["Limit", "2000", 0]]);
  assert.deepEqual(K.dataOf(e), { holder: "Maria P", num: "4111 1111 1111 1111", exp: "08/2027", cvv: "123", pin: "0000", bank: "Bank" });
  assert.deepEqual(K.visibleFields(e), [{ h: 0, n: "Limit", v: "2000" }]);
  assert.deepEqual(e.urls, ["https://bank.example"]);
  assert.equal(e.user, ""); assert.equal(e.pw, "");
  assert.equal(K.summary(e), "Visa · •••• 1111 · 08/27");
  assert.ok(K.hasContent(e));
});

test("other types drop login values; a login stays a login", () => {
  const base = PC.blankEntry(NOW);
  base.user = "u"; base.pw = "p"; base.totp = "JBSWY3DPEHPK3PXP"; base.urls = ["https://x.example"];
  const a = K.withData(base, "address", { street: "Odos 1", city: "Athina", zip: "10558", country: "Greece" });
  assert.equal(a.user + a.pw + a.totp, "");
  assert.deepEqual(a.urls, []);
  assert.equal(K.dataOf(a).country, "GR");
  assert.deepEqual(K.addressLines(K.dataOf(a), (c) => ({ GR: "Ελλάδα" })[c]), ["Odos 1", "10558 Athina", "Ελλάδα"]);
  const l = K.withData(base, "login", {});
  assert.equal(K.kindOf(l), "login");
  assert.deepEqual(l.fields, []);
  assert.equal(l.pw, "p");
  const n = K.withData(PC.blankEntry(NOW), "note", {});
  assert.equal(K.kindOf(n), "note");
  assert.equal(K.hasContent(n), false);
});

test("an unknown kind marker reads as a login, and reserved fields of another type are kept on save", () => {
  const e = PC.blankEntry(NOW);
  e.fields = [{ h: 0, n: "oros:k", v: "passkey" }, { h: 1, n: "oros:pk.key", v: "secret" }, { h: 0, n: "Own", v: "1" }];
  assert.equal(K.kindOf(e), "login");
  // the unknown marker is not a user field, but the other reserved values are
  assert.deepEqual(K.userFields(e).map((f) => f.n), ["oros:pk.key", "Own"]);
  assert.deepEqual(K.visibleFields(e).map((f) => f.n), ["Own"]);
  const saved = K.withData(e, "login", {});
  assert.ok(saved.fields.some((f) => f.n === "oros:pk.key" && f.v === "secret"));
});

test("cards: Luhn, network, grouping, expiry", () => {
  assert.equal(K.luhn("4111 1111 1111 1111"), true);
  assert.equal(K.luhn("4111 1111 1111 1112"), false);
  assert.equal(K.luhn("1234"), false);
  const cases = { "4111111111111111": "visa", "5555555555554444": "mastercard", "2223003122003222": "mastercard",
    "378282246310005": "amex", "6011111111111117": "discover", "3530111333300000": "jcb", "36227206271667": "diners",
    "6200000000000005": "unionpay", "6759649826438453": "maestro", "": "" };
  Object.keys(cases).forEach((n) => assert.equal(K.brand(n), cases[n], n));
  assert.equal(K.groupNum("378282246310005"), "3782 822463 10005");
  assert.equal(K.groupNum("4111111111111111"), "4111 1111 1111 1111");
  assert.deepEqual(K.parseExp("08/27"), { m: 8, y: 2027 });
  assert.deepEqual(K.parseExp("2027-08"), { m: 8, y: 2027 });
  assert.deepEqual(K.parseExp("0827"), { m: 8, y: 2027 });
  assert.equal(K.parseExp("13/27"), null);
  assert.equal(K.expShort("08/2027"), "08/27");
  assert.equal(K.expStatus("10/2026", NOW), "expired");
  assert.equal(K.expStatus("11/2026", NOW), "soon");     // valid to the end of November
  assert.equal(K.expStatus("01/2027", NOW), "ok");
  assert.equal(K.expStatus("06/2027", NOW), "ok");
  assert.equal(K.expStatus("", NOW), "");
});

test("identities: dates, document expiry, countries", () => {
  assert.equal(K.normDate("2026-11-01"), "2026-11-01");
  assert.equal(K.normDate("1/11/2026"), "2026-11-01");
  assert.equal(K.normDate("31.02.2026"), "");
  assert.equal(K.dateStatus("2026-11-01", NOW), "soon");
  assert.equal(K.dateStatus("2026-10-31", NOW), "expired");
  assert.equal(K.dateStatus("2030-01-01", NOW), "ok");
  assert.equal(K.countryCode("gr"), "GR");
  assert.equal(K.countryCode("Ελλάδα"), "GR");
  assert.equal(K.countryCode("Atlantis"), "");
  assert.equal(K.COUNTRIES.length, 250);
});

test("labelled fields from other managers become types; an identity with an address gives two entries", () => {
  const e = PC.blankEntry(NOW);
  e.id = "aaaaaaaaaaaaaaaa";
  e.title = "Me";
  e.fields = [{ h: 0, n: "Full name", v: "Maria Papadopoulou" }, { h: 0, n: "Email", v: "m@example.gr" },
              { h: 1, n: "Passport number", v: "AB123" }, { h: 0, n: "Address 1", v: "Odos 1" },
              { h: 0, n: "Address 2", v: "Flat 2" }, { h: 0, n: "Address 3", v: "Back" },
              { h: 0, n: "City", v: "Athina" }, { h: 0, n: "Postal code", v: "10558" },
              { h: 0, n: "Country", v: "GR" }, { h: 0, n: "Favourite colour", v: "blue" }];
  const [id, ad] = K.fromLabels(e, "identity", () => "bbbbbbbbbbbbbbbb");
  assert.equal(K.kindOf(id), "identity");
  assert.deepEqual(K.dataOf(id), { first: "Maria", last: "Papadopoulou", email: "m@example.gr", pass: "AB123" });
  assert.deepEqual(K.visibleFields(id), [{ h: 0, n: "Favourite colour", v: "blue" }]);
  assert.equal(ad.id, "bbbbbbbbbbbbbbbb");
  assert.equal(K.kindOf(ad), "address");
  assert.deepEqual(K.dataOf(ad), { name: "Maria Papadopoulou", street: "Odos 1", line2: "Flat 2, Back", city: "Athina", zip: "10558", country: "GR" });
  assert.equal(K.legacyKind(e), "identity");

  const c = PC.blankEntry(NOW);
  c.fields = [{ h: 0, n: "Cardholder name", v: "M" }, { h: 0, n: "Brand", v: "Visa" }, { h: 1, n: "Number", v: "4111111111111111" },
              { h: 0, n: "Expiry month", v: "1" }, { h: 0, n: "Expiry year", v: "2030" }, { h: 1, n: "Security code", v: "123" }];
  assert.equal(K.legacyKind(c), "card");
  const [cc] = K.fromLabels(c, "card");
  assert.deepEqual(K.dataOf(cc), { holder: "M", num: "4111111111111111", exp: "01/2030", cvv: "123" });
  assert.deepEqual(K.visibleFields(cc), []);           // the brand comes from the number
  // a login with a user name is never taken for a card
  c.user = "x";
  assert.equal(K.legacyKind(c), null);
  // an entry that is already typed is left alone
  assert.deepEqual(K.fromLabels(cc, "identity"), [cc]);
});

test("Bitwarden: typed entries export as cards, identities and notes and import back the same", () => {
  const e1 = PC.normEntry(card());
  const e2 = PC.normEntry(K.withData(Object.assign(PC.blankEntry(NOW), { title: "Me" }), "identity",
    { first: "Maria", last: "P", birth: "1990-05-04", tax: "123456789", idno: "AK 123456", idexp: "2031-01-01" }));
  const e3 = PC.normEntry(K.withData(Object.assign(PC.blankEntry(NOW), { title: "Home" }), "address",
    { name: "Maria P", street: "Odos 1", floor: "3rd", city: "Athina", zip: "10558", country: "GR" }));
  const e4 = PC.normEntry(K.withData(Object.assign(PC.blankEntry(NOW), { title: "Wi-Fi", notes: "pw: x" }), "note", {}));
  const j = JSON.parse(PC.toBitwarden([e1, e2, e3, e4]));
  assert.deepEqual(j.items.map((i) => i.type), [3, 4, 4, 2]);
  assert.deepEqual(j.items[0].card, { cardholderName: "Maria P", brand: "Visa", number: "4111111111111111",
                                      expMonth: "8", expYear: "2027", code: "123" });
  assert.ok(j.items.every((i) => !i.fields.some((f) => /^oros:/.test(f.name))));
  const back = PC.fromBitwarden(JSON.stringify(j), NOW).entries;
  assert.equal(back.length, 4);
  const d = (e) => K.dataOf(e);
  const num = (o) => Object.assign({}, o, o.num ? { num: K.digits(o.num) } : {});
  assert.deepEqual(num(d(back[0])), num(d(e1)));
  assert.deepEqual(K.visibleFields(back[0]), K.visibleFields(e1));
  assert.deepEqual(d(back[1]), d(e2));
  assert.deepEqual(d(back[2]), d(e3));
  assert.equal(K.kindOf(back[3]), "note");
  assert.equal(back[3].notes, "pw: x");
});

test("dedupe tells two cards with the same title apart", () => {
  const a = PC.normEntry(card());
  const b = PC.normEntry(K.withData(Object.assign({}, a, { id: PC.newId() }), "card", { num: "5555555555554444" }, []));
  assert.equal(PC.dedupe([a], [b]).entries.length, 1);
  assert.equal(PC.dedupe([a], [Object.assign({}, a, { id: PC.newId() })]).entries.length, 0);
});

test("search finds typed values but never hidden ones or reserved names", () => {
  const e = PC.normEntry(card());
  assert.ok(PC.matches(e, "maria"));
  assert.ok(PC.matches(e, "limit"));
  assert.equal(PC.matches(e, "4111"), false);
  assert.equal(PC.matches(e, "holder"), false);
});

test("`x` (room for newer fields) is kept when small and plain, dropped otherwise, absent by default", () => {
  const e = PC.blankEntry(NOW);
  assert.equal("x" in PC.normEntry(e), false);
  assert.deepEqual(PC.normEntry(Object.assign({}, e, { x: { b: 1, a: "s" } })).x, { a: "s", b: 1 });
  assert.equal("x" in PC.normEntry(Object.assign({}, e, { x: { a: { deep: 1 } } })), false);
  assert.equal("x" in PC.normEntry(Object.assign({}, e, { x: [1] })), false);
  assert.equal("x" in PC.normEntry(Object.assign({}, e, { x: { a: "y".repeat(9000) } })), false);
});

test("an older orOS (4.96.00) keeps every typed value through its normalise and merge", () => {
  const OLD = oldCore();
  const entries = [
    PC.normEntry(card()),
    PC.normEntry(K.withData(Object.assign(PC.blankEntry(NOW), { title: "Me" }), "identity", { first: "M", ssn: "01019012345" })),
    PC.normEntry(K.withData(Object.assign(PC.blankEntry(NOW), { title: "Home" }), "address", { street: "Odos 1", country: "GR" })),
    PC.normEntry(K.withData(Object.assign(PC.blankEntry(NOW), { title: "Note", notes: "secret" }), "note", {}))
  ];
  const snap = PC.normSnap({ d: {}, e: entries, v: 1 });
  const viaOld = OLD.normSnap(JSON.parse(JSON.stringify(snap)));
  assert.equal(OLD.canon(viaOld), PC.canon(snap), "byte for byte the same snapshot");
  // an old device edits the card's title (as a login, it knows no types)
  const edited = JSON.parse(JSON.stringify(viaOld.e.find((e) => e.title === "Visa salary")));
  edited.title = "Visa"; edited.m = NOW + 10;
  const merged = PC.mergeSnap(snap, OLD.upsert(viaOld, edited));
  const c = merged.e.find((e) => e.id === edited.id);
  assert.equal(c.title, "Visa");
  assert.equal(K.kindOf(c), "card");
  assert.equal(K.dataOf(c).num, "4111 1111 1111 1111");
  // and the merge is the same whichever side runs it
  assert.equal(PC.canon(OLD.mergeSnap(OLD.upsert(viaOld, edited), snap)), PC.canon(merged));
});
