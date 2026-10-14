// Contacts: the import review plan (contacts/importplan.js) and the
// one-time account import mappers (contacts/accounts.js): matching by
// e-mail / phone / name, skip identical, merge with "keep mine" or
// "use imported", nothing removed, duplicates inside an import folded,
// Google People and Microsoft Graph records mapped to the parser shape.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const P = require("../contacts/importplan.js");
const A = require("../contacts/accounts.js");

function inc(o) {
  return Object.assign({
    given: "", middle: "", family: "", nickname: "", org: "", jobTitle: "",
    phones: [], emails: [], addresses: [], websites: [], im: [],
    events: [], cats: [], note: "", photo: null, starred: false
  }, o);
}
function loc(id, o) { return Object.assign(inc(o), { id, labelIds: [], relations: [], mtime: 1 }); }

const maria = loc("a1", {
  given: "Μαρία", family: "Παπαδοπούλου", org: "Acme",
  phones: [{ v: "+30 210 123 4567", type: "work" }],
  emails: [{ v: "maria@example.com", type: "work" }],
  events: [{ day: "05-14", year: null, type: "birthday", label: "" }]
});
const nikos = loc("a2", { given: "Νίκος", family: "Γεωργίου", phones: [{ v: "6900000001", type: "mobile" }] });

test("samePhone: country code and spacing ignored, short numbers exact", () => {
  assert.ok(P.samePhone("+30 210 123 4567", "2101234567"));
  assert.ok(P.samePhone("0030 6900000001", "6900000001"));
  assert.ok(!P.samePhone("112", "0112"));
  assert.ok(!P.samePhone("2101234567", "2101234568"));
});

test("identical contact is skipped, accents and case do not count", () => {
  const pl = P.plan([maria], [inc({ given: "ΜΑΡΙΑ", family: "Παπαδοπουλου", emails: [{ v: "MARIA@example.com", type: "home" }] })], []);
  assert.equal(pl.items[0].kind, "same");
  assert.equal(pl.items[0].act, "skip");
  assert.equal(pl.items[0].by, "email");
  assert.deepEqual(pl.counts, { "new": 0, same: 1, diff: 0 });
});

test("new contact is added", () => {
  const pl = P.plan([maria, nikos], [inc({ given: "Ελένη", phones: [{ v: "6977777777", type: "mobile" }] })], []);
  assert.equal(pl.items[0].kind, "new");
  assert.equal(pl.items[0].act, "add");
  assert.equal(pl.items[0].match, null);
});

test("differing details: additions and conflicts listed, merge keeps mine by default", () => {
  const i = inc({
    given: "Maria", family: "Papadopoulou", org: "Acme Ltd", jobTitle: "CEO",
    phones: [{ v: "2101234567", type: "work" }, { v: "6911111111", type: "mobile" }],
    events: [{ day: "05-15", year: 1980, type: "birthday", label: "" }],
    cats: ["Family"]
  });
  const pl = P.plan([maria], [i], []);
  const it = pl.items[0];
  assert.equal(it.kind, "diff");
  assert.equal(it.by, "phone");
  assert.equal(it.act, "merge");
  assert.equal(it.add.jobTitle, 1);
  assert.equal(it.add.phones, 1);
  assert.equal(it.add.labels, 1);
  const fields = it.conflicts.map((c) => c.f).sort();
  assert.deepEqual(fields, ["birthday", "family", "given", "org"]);

  const mine = P.apply(maria, i, "mine", ["lbl-x"]);
  assert.ok(mine.changed);
  assert.equal(mine.c.given, "Μαρία");
  assert.equal(mine.c.org, "Acme");
  assert.equal(mine.c.jobTitle, "CEO");
  assert.equal(mine.c.phones.length, 2);
  assert.deepEqual(mine.c.labelIds, ["lbl-x"]);
  assert.equal(mine.c.events.filter((e) => e.type === "birthday").length, 1);
  assert.equal(mine.c.events[0].day, "05-14");
  // the original is untouched
  assert.equal(maria.phones.length, 1);

  const theirs = P.apply(maria, i, "theirs", []);
  assert.equal(theirs.c.given, "Maria");
  assert.equal(theirs.c.org, "Acme Ltd");
  assert.equal(theirs.c.events.filter((e) => e.type === "birthday")[0].day, "05-15");
  assert.equal(theirs.c.emails.length, 1, "nothing removed");
});

test("name-only match: merged when nothing contradicts, flagged when ids differ", () => {
  const a = P.plan([nikos], [inc({ given: "Νίκος", family: "Γεωργίου", org: "Beta" })], []);
  assert.equal(a.items[0].by, "name");
  assert.equal(a.items[0].act, "merge");
  assert.equal(a.items[0].nameOnly, false);
  const b = P.plan([nikos], [inc({ given: "Νίκος", family: "Γεωργίου", phones: [{ v: "6955555555", type: "mobile" }] })], []);
  assert.equal(b.items[0].nameOnly, true);
  assert.equal(b.items[0].act, "add");
});

test("event year fills a year-less local event", () => {
  const i = inc({ emails: [{ v: "maria@example.com" }], events: [{ day: "05-14", year: 1980, type: "birthday", label: "" }] });
  const pl = P.plan([maria], [i], []);
  assert.equal(pl.items[0].kind, "diff");
  const r = P.apply(maria, i, "mine", null);
  assert.equal(r.c.events[0].year, 1980);
});

test("existing labels are matched by name", () => {
  const m = Object.assign({}, maria, { labelIds: ["lbl-fam"] });
  const pl = P.plan([m], [inc({ emails: [{ v: "maria@example.com" }], cats: ["family"] })], [{ id: "lbl-fam", name: "Family" }]);
  assert.equal(pl.items[0].kind, "same");
});

test("duplicates inside one import are folded first", () => {
  const pl = P.plan([], [
    inc({ given: "Ann", emails: [{ v: "ann@x.org" }] }),
    inc({ given: "Ann", family: "Lee", emails: [{ v: "ANN@x.org" }], phones: [{ v: "123456789" }], cats: ["Work"] })
  ], []);
  assert.equal(pl.items.length, 1);
  assert.equal(pl.items[0].inc.family, "Lee");
  assert.equal(pl.items[0].inc.phones.length, 1);
  assert.deepEqual(pl.items[0].inc.cats, ["Work"]);
});

test("one local contact is not claimed by two incoming ones", () => {
  const pl = P.plan([nikos], [
    inc({ given: "Νίκος", phones: [{ v: "6900000001" }] }),
    inc({ given: "Άλλος", phones: [{ v: "6900000001" }], emails: [{ v: "x@y.z" }] })
  ], []);
  // a shared phone with another name is another person: not folded
  assert.equal(pl.items.length, 2);
  assert.equal(pl.folded, 0);
  assert.equal(pl.items[0].match, "a2");
  assert.equal(pl.items[1].kind, "new");
});

test("import duplicates: folded only when names agree, counted in `folded`", () => {
  const pl = P.plan([], [
    inc({ given: "Γιώργος", phones: [{ v: "6900000010" }] }),
    inc({ given: "Γιώργος", phones: [{ v: "6900000011" }] }),          // same first name, other phone
    inc({ given: "Μαμά", phones: [{ v: "2100000000" }] }),
    inc({ given: "Μπαμπάς", phones: [{ v: "2100000000" }] }),          // shared landline
    inc({ given: "Γιώργος", family: "Π.", phones: [{ v: "+30 6900000010" }] }),  // real duplicate
    inc({ given: "Ελένη" }),
    inc({ given: "Ελένη", emails: [{ v: "e@x.gr" }] })                 // same name, one side bare
  ], []);
  assert.equal(pl.items.length, 5);
  assert.equal(pl.folded, 2);
  assert.equal(pl.items[0].inc.family, "Π.");
});

test("Google People person → parser shape", () => {
  const c = A.fromGoogle({
    names: [{ givenName: "Ada", familyName: "Lovelace", metadata: { primary: true } }],
    nicknames: [{ value: "Countess" }],
    organizations: [{ name: "Analytical", title: "Mathematician" }],
    phoneNumbers: [{ value: "+44 20 7946 0000", type: "work" }, { value: "+44 20 7946 0000", type: "home" }, { value: "07700 900000", type: "homeFax" }],
    emailAddresses: [{ value: "ada@example.org", type: "home" }],
    addresses: [{ streetAddress: "1 St James's Sq", city: "London", postalCode: "SW1", country: "UK", type: "home" }],
    urls: [{ value: "https://ada.example", type: "homePage" }],
    birthdays: [{ date: { month: 12, day: 10, year: 1815 } }, { date: { month: 1, day: 1 } }],
    events: [{ date: { month: 7, day: 8, year: 1985 }, type: "anniversary" }],
    biographies: [{ value: "First programmer" }],
    memberships: [
      { contactGroupMembership: { contactGroupResourceName: "contactGroups/starred" } },
      { contactGroupMembership: { contactGroupResourceName: "contactGroups/abc" } },
      { contactGroupMembership: { contactGroupResourceName: "contactGroups/myContacts" } }
    ]
  }, { "contactGroups/abc": "Science" });
  assert.equal(c.given, "Ada");
  assert.equal(c.family, "Lovelace");
  assert.equal(c.nickname, "Countess");
  assert.equal(c.org, "Analytical");
  assert.equal(c.jobTitle, "Mathematician");
  assert.equal(c.phones.length, 2);
  assert.equal(c.phones[0].type, "work");
  assert.equal(c.phones[1].type, "other");
  assert.equal(c.websites[0].type, "home");
  assert.deepEqual(c.events[0], { day: "12-10", year: null, type: "birthday", label: "" });
  assert.equal(c.events[1].type, "anniversary");
  assert.equal(c.events[1].year, 1985);
  assert.equal(c.note, "First programmer");
  assert.equal(c.starred, true);
  assert.deepEqual(c.cats, ["Science"]);
});

test("Google: a person with only an e-mail is named by it", () => {
  const c = A.fromGoogle({ emailAddresses: [{ value: "x@y.org" }] }, {});
  assert.equal(c.given, "x@y.org");
});

test("Microsoft Graph contact → parser shape", () => {
  const c = A.fromGraph({
    givenName: "Grace", surname: "Hopper", companyName: "Navy", jobTitle: "Rear Admiral",
    mobilePhone: "+1 555 0100", homePhones: ["+1 555 0101"], businessPhones: ["+1 555 0102", "+1 555 0100"],
    emailAddresses: [{ address: "grace@example.org", name: "Grace" }],
    homeAddress: { street: "1 Main", city: "Arlington", state: "VA", postalCode: "22201", countryOrRegion: "USA" },
    businessAddress: {},
    birthday: "1604-12-09T00:00:00Z",
    personalNotes: "COBOL", businessHomePage: "https://navy.example",
    imAddresses: ["grace@im"], categories: ["Heroes"]
  });
  assert.equal(c.given, "Grace");
  assert.equal(c.family, "Hopper");
  assert.equal(c.phones.length, 3);
  assert.equal(c.phones[0].type, "mobile");
  assert.equal(c.addresses.length, 1);
  assert.equal(c.addresses[0].region, "VA");
  assert.deepEqual(c.events[0], { day: "12-09", year: null, type: "birthday", label: "" });
  assert.equal(c.websites[0].type, "work");
  assert.deepEqual(c.cats, ["Heroes"]);
});

test("accounts.js keeps no token: no storage writes of tokens, revoke for Google, no offline scope", () => {
  const src = fs.readFileSync(path.join(__dirname, "../contacts/accounts.js"), "utf8");
  assert.ok(!/offline_access|access_type=offline|refresh_token/.test(src.replace(/\/\/.*$/gm, "")));
  assert.ok(/oauth2\.googleapis\.com\/revoke/.test(src));
  assert.ok(!/localStorage\.setItem\([^)]*token/i.test(src));
  const cb = fs.readFileSync(path.join(__dirname, "../contacts/oauth-callback.js"), "utf8");
  assert.ok(/history\.replaceState/.test(cb), "callback clears the address bar");
  assert.ok(!/fetch\(/.test(cb), "callback never talks to the network");
});
