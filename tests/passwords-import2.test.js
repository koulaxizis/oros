// Passwords: the extra import sources of passwords/import.js (Proton
// Pass, 1Password .1pux, LastPass, Dashlane, NordPass, Enpass, Apple
// Passwords, Aegis, 2FAS, Google Authenticator transfer QR) and the
// merge into the vault (stable ids, dedupe, two-factor codes attached
// to the one matching entry, Undo with newer stamps). Fixtures follow
// the documented export shapes; zips are built with atelier/zip.js.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PC = require(path.join(ROOT, "passwords/pmcore.js"));
const I = require(path.join(ROOT, "passwords/import.js"));
const Z = require(path.join(ROOT, "atelier/zip.js"));

const enc = (s) => new TextEncoder().encode(s);
const NOW = Date.UTC(2026, 9, 1);
const SECRET = "JBSWY3DPEHPK3PXP";        // "Hello!\xde\xad\xbe\xef"
const SECRET2 = "GEZDGNBVGY3TQOJQGEZDGNBV";

function vault(entries) {
  return PC.normSnap({ v: 1, d: {}, e: entries.map((e, i) => Object.assign({ id: "a00000000000000" + i, m: 1000 }, e)) });
}

// ---------- Proton Pass ----------
const PROTON = {
  version: "1.21.0", userId: "u", encrypted: false,
  vaults: {
    v1: { name: "Personal", items: [
      { itemId: "i1", shareId: "v1", state: 1, pinned: true, createTime: 1700000000, modifyTime: 1700000500,
        data: { metadata: { name: "GitHub", note: "work", itemUuid: "x1" }, type: "login",
                content: { itemEmail: "me@example.org", itemUsername: "octo", password: "pw-gh", urls: ["https://github.com/login"], totpUri: "" },
                extraFields: [{ fieldName: "Recovery", type: "hidden", data: { content: "r-123" } },
                              { fieldName: "2FA", type: "totp", data: { content: "otpauth://totp/GitHub:octo?secret=" + SECRET } }] } },
      { itemId: "i2", state: 1, data: { metadata: { name: "Wifi", note: "pass: abc" }, type: "note", content: {}, extraFields: [] } },
      { itemId: "i3", state: 1, data: { metadata: { name: "Visa", note: "" }, type: "creditCard",
        content: { cardholderName: "A B", number: "4111111111111111", verificationNumber: "123", expirationDate: "2027-01" } } },
      { itemId: "i4", state: 1, aliasEmail: "alias.x@passmail.net", data: { metadata: { name: "Alias", note: "" }, type: "alias", content: {} } },
      { itemId: "i5", state: 2, data: { metadata: { name: "Old" }, type: "login", content: { password: "z" } } }
    ] },
    v2: { name: "Work", items: [
      { itemId: "j1", state: 1, data: { metadata: { name: "Me", note: "" }, type: "identity",
        content: { fullName: "Alex Doe", email: "alex@example.org", phoneNumber: "+30 210", passportNumber: "P123" } } }
    ] }
  }
};

test("Proton Pass ZIP: logins, notes, cards, aliases, identities; trash left out; vault names become tags", async () => {
  const zip = Z.write([{ name: "Proton Pass/data.json", data: JSON.stringify(PROTON) }]);
  const r = await I.parse({ name: "Proton Pass_export_2026.zip", bytes: zip }, NOW);
  assert.equal(r.source, "proton");
  assert.equal(r.entries.length, 5);
  assert.equal(r.trashed, 1);
  assert.deepEqual(r.types, { login: 1, note: 1, card: 1, alias: 1, identity: 1 });
  const gh = r.entries.find((e) => e.title === "GitHub");
  assert.equal(gh.user, "octo");
  assert.equal(gh.pw, "pw-gh");
  assert.equal(gh.fav, 1);
  assert.deepEqual(gh.tags, ["Personal"]);
  assert.deepEqual(gh.urls, ["https://github.com/login"]);
  assert.ok(/^otpauth:\/\/totp\//.test(gh.totp));
  assert.deepEqual(gh.fields.map((f) => [f.n, f.h]), [["Email", 0], ["Recovery", 1]]);
  const card = r.entries.find((e) => e.title === "Visa");
  assert.equal(card.fields.find((f) => f.n === "Number").h, 1);
  assert.equal(r.entries.find((e) => e.title === "Alias").user, "alias.x@passmail.net");
  const me = r.entries.find((e) => e.title === "Me");
  assert.equal(me.fields.find((f) => f.n === "Passport Number").h, 1);
  assert.equal(me.fields.find((f) => f.n === "Phone Number").h, 0);
  assert.ok(r.entries.every((e) => /^[0-9a-f]{16}$/.test(e.id)));
  assert.equal(zip.every((b) => b === 0), true, "file bytes wiped after parsing");
  // the same file again gives the same ids
  const r2 = await I.parse({ name: "x.zip", bytes: Z.write([{ name: "Proton Pass/data.json", data: JSON.stringify(PROTON) }]) }, NOW + 5);
  assert.deepEqual(r2.entries.map((e) => e.id), r.entries.map((e) => e.id));
});

test("Proton Pass: CSV, and encrypted (PGP) exports are refused", async () => {
  const csv = "name,url,email,username,password,note,totp,createTime,modifyTime,vault\n" +
              "Shop,https://shop.example,me@x.org,,pw1,,,1700000000,1700000000,Personal\n" +
              "Two,\"https://a.example, https://b.example\",,bob,pw2,n,otpauth://totp/x?secret=" + SECRET + ",,,Work\n";
  const r = I.parseText(csv, "export.csv", NOW);
  assert.equal(r.source, "proton");
  assert.equal(r.entries[0].user, "me@x.org");
  assert.deepEqual(r.entries[1].urls, ["https://a.example", "https://b.example"]);
  assert.deepEqual(r.entries[1].tags, ["Work"]);
  assert.equal(I.parseText("-----BEGIN PGP MESSAGE-----\n\nwcFMA...", "x.pgp").error, "encrypted-proton");
  const pz = await I.parse({ name: "a.zip", bytes: Z.write([{ name: "Proton Pass/data.pgp", data: "x" }]) });
  assert.equal(pz.error, "encrypted-proton");
});

// ---------- 1Password ----------
test("1Password .1pux: login fields, sections (TOTP, concealed, dates), notes, archived left out", async () => {
  const data = { accounts: [{ attrs: { name: "Me" }, vaults: [{ attrs: { uuid: "v", name: "Shared" }, items: [
    { uuid: "u1", favIndex: 1, createdAt: 1600000000, updatedAt: 1600000100, state: "active", categoryUuid: "001",
      overview: { title: "Mail", url: "https://mail.example", urls: [{ label: "", url: "https://mail.example" }, { url: "https://m2.example" }], tags: ["work"] },
      details: { loginFields: [{ value: "ann", name: "user", fieldType: "T", designation: "username" },
                               { value: "pw-m", name: "pass", fieldType: "P", designation: "password" },
                               { value: "✓", name: "remember", fieldType: "C" }],
                 notesPlain: "hello",
                 sections: [{ title: "", fields: [{ title: "one-time password", id: "TOTP_1", value: { totp: "otpauth://totp/Mail:ann?secret=" + SECRET } },
                                                  { title: "PIN", id: "p", value: { concealed: "9876" } },
                                                  { title: "Since", id: "d", value: { date: 1600000000 } },
                                                  { title: "Expires", id: "e", value: { monthYear: 202712 } }] }],
                 passwordHistory: [{ value: "old-pw", time: 1500000000 }] } },
    { uuid: "u2", state: "active", categoryUuid: "003", overview: { title: "Secret note" }, details: { notesPlain: "n" } },
    { uuid: "u3", state: "archived", categoryUuid: "001", overview: { title: "Gone" }, details: {} },
    { uuid: "u4", state: "active", categoryUuid: "005", overview: { title: "Router" }, details: { password: "r-pw" } }
  ] }] }] };
  const zip = Z.write([{ name: "export.attributes", data: "{}" }, { name: "export.data", data: JSON.stringify(data) }]);
  const r = await I.parse({ name: "1PasswordExport.1pux", bytes: zip }, NOW);
  assert.equal(r.source, "1pux");
  assert.equal(r.entries.length, 3);
  assert.equal(r.trashed, 1);
  const m = r.entries.find((e) => e.title === "Mail");
  assert.equal(m.user, "ann"); assert.equal(m.pw, "pw-m"); assert.equal(m.notes, "hello"); assert.equal(m.fav, 1);
  assert.deepEqual(m.urls, ["https://mail.example", "https://m2.example"]);
  assert.deepEqual(m.tags, ["Shared", "work"]);
  assert.ok(m.totp.indexOf(SECRET) > 0);
  assert.deepEqual(m.fields, [{ h: 1, n: "PIN", v: "9876" }, { h: 0, n: "Since", v: "2020-09-13" }, { h: 0, n: "Expires", v: "12/2027" }]);
  assert.equal(m.hist[0].pw, "old-pw");
  assert.equal(r.entries.find((e) => e.title === "Router").pw, "r-pw");
});

// ---------- CSV sources ----------
test("LastPass CSV: secure notes (http://sn), folders, favourites, TOTP", () => {
  const csv = "url,username,password,totp,extra,name,grouping,fav\n" +
              "https://a.example/login,al,pa," + SECRET + ",,A site,Social,1\n" +
              "http://sn,,,,\"NoteType:Server\nHostname:x\",Server note,Infra,0\n";
  const r = I.parseText(csv, "lastpass_export.csv", NOW);
  assert.equal(r.source, "lastpass");
  assert.deepEqual(r.types, { login: 1, note: 1 });
  assert.equal(r.entries[0].totp, SECRET);
  assert.equal(r.entries[0].fav, 1);
  assert.deepEqual(r.entries[0].tags, ["Social"]);
  assert.deepEqual(r.entries[1].urls, []);
  assert.ok(/Hostname:x/.test(r.entries[1].notes));
});

test("Dashlane: CSV zip with credentials and secure notes, or credentials.csv alone", async () => {
  const cred = "username,username2,username3,title,password,note,url,category,otpSecret\n" +
               "dan,dan2,,Shop,pw,,https://shop.example,Shopping," + SECRET + "\n";
  const notes = "title,note\nDoor code,1234\n";
  const r = await I.parse({ name: "dashlane.zip", bytes: Z.write([{ name: "credentials.csv", data: cred }, { name: "securenotes.csv", data: notes }]) }, NOW);
  assert.equal(r.source, "dashlane");
  assert.deepEqual(r.types, { login: 1, note: 1 });
  assert.equal(r.entries[0].user, "dan");
  assert.equal(r.entries[0].totp, SECRET);
  assert.deepEqual(r.entries[0].fields, [{ h: 0, n: "Username", v: "dan2" }]);
  assert.equal(I.parseText(cred, "credentials.csv", NOW).entries.length, 1);
  assert.equal((await I.parse({ name: "x.dash", bytes: enc("DASH....") })).error, "encrypted-dashlane");
});

test("NordPass CSV: logins, cards, folder rows skipped; Apple Passwords CSV with OTPAuth", () => {
  const csv = "name,url,additional_urls,username,password,note,cardholdername,cardnumber,cvc,pin,expirydate,zipcode,folder,full_name,phone_number,email,address1,address2,city,country,state,type,custom_fields\n" +
              "Mail,https://mail.example,\"[\"\"https://m2.example\"\"]\",nina,pw,,,,,,,,Work,,,,,,,,,password,\n" +
              "Visa,,,,,,N N,4111,321,1111,01/28,,,,,,,,,,,credit_card,\n" +
              "Work,,,,,,,,,,,,,,,,,,,,,folder,\n";
  const r = I.parseText(csv, "nordpass.csv", NOW);
  assert.equal(r.source, "nordpass");
  assert.equal(r.entries.length, 2);
  assert.deepEqual(r.entries[0].urls, ["https://mail.example", "https://m2.example"]);
  assert.deepEqual(r.entries[0].tags, ["Work"]);
  assert.equal(r.types.card, 1);
  assert.equal(r.entries[1].fields.find((f) => f.n === "Number").h, 1);
  const apple = "Title,URL,Username,Password,Notes,OTPAuth\nexample.com (me),https://example.com/,me,pw,,otpauth://totp/x?secret=" + SECRET + "\n";
  const a = I.parseText(apple, "Passwords.csv", NOW);
  assert.equal(a.source, "apple");
  assert.ok(a.entries[0].totp.indexOf(SECRET) > 0);
});

test("other CSVs still use pmcore's mapper (Chrome, Firefox, Bitwarden), with a source name", () => {
  const r = I.parseText("name,url,username,password,note\nx.org,https://x.org/,u,p,\n", "Chrome Passwords.csv", NOW);
  assert.equal(r.source, "chrome");
  assert.equal(r.entries[0].user, "u");
  const f = I.parseText("url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged\nhttps://y.org,u,p,,https://y.org,{1},1,1,1\n", "logins.csv", NOW);
  assert.equal(f.source, "firefox");
  assert.equal(f.entries[0].title, "y.org");
});

test("Enpass JSON: fields by type, folders, trash", () => {
  const j = { folders: [{ uuid: "f1", title: "Home" }], items: [
    { uuid: "e1", title: "Bank", note: "n", favorite: 1, category: "login", folders: ["f1"], fields: [
      { label: "Username", type: "username", value: "bob", sensitive: 0 },
      { label: "E-mail", type: "email", value: "bob@x.org", sensitive: 0 },
      { label: "Password", type: "password", value: "pw", sensitive: 1 },
      { label: "Website", type: "url", value: "https://bank.example", sensitive: 0 },
      { label: "One-time code", type: "totp", value: SECRET, sensitive: 1 },
      { label: "Security question", type: "text", value: "pet?", sensitive: 1 },
      { label: "Extra", type: "section", value: "" }] },
    { uuid: "e2", title: "Old", trashed: 1, fields: [{ label: "Password", type: "password", value: "x" }] }
  ] };
  const r = I.parseText(JSON.stringify(j), "enpass.json", NOW);
  assert.equal(r.source, "enpass");
  assert.equal(r.trashed, 1);
  const e = r.entries[0];
  assert.equal(e.user, "bob"); assert.equal(e.pw, "pw"); assert.equal(e.totp, SECRET);
  assert.deepEqual(e.tags, ["Home"]);
  assert.deepEqual(e.fields, [{ h: 0, n: "E-mail", v: "bob@x.org" }, { h: 1, n: "Security question", v: "pet?" }]);
});

test("Bitwarden JSON still goes through pmcore (and an encrypted one is refused)", () => {
  const bw = { encrypted: false, folders: [], items: [{ type: 1, name: "B", login: { username: "u", password: "p", uris: [{ uri: "https://b.example" }] } }] };
  const r = I.parseText(JSON.stringify(bw), "bitwarden.json", NOW);
  assert.equal(r.source, "bitwarden");
  assert.equal(r.entries[0].pw, "p");
  assert.equal(I.parseText(JSON.stringify({ encrypted: true, passwordProtected: true, data: "x" })).error, "encrypted");
});

// ---------- two-factor apps ----------
test("Aegis: plain export → codes (HOTP / Steam counted as unsupported); encrypted waits for its password", () => {
  const j = { version: 1, header: { slots: null, params: null }, db: { version: 3, entries: [
    { type: "totp", uuid: "a", name: "ann@example.org", issuer: "GitHub", note: "", info: { secret: SECRET, algo: "SHA1", digits: 6, period: 30 } },
    { type: "totp", uuid: "b", name: "x", issuer: "Bank", info: { secret: SECRET2, algo: "SHA256", digits: 8, period: 60 } },
    { type: "hotp", uuid: "c", name: "h", issuer: "H", info: { secret: SECRET, algo: "SHA1", digits: 6, counter: 3 } },
    { type: "steam", uuid: "d", name: "s", issuer: "Steam", info: { secret: SECRET, algo: "SHA1", digits: 5, period: 30 } }
  ] } };
  const r = I.parseText(JSON.stringify(j), "aegis-export.json", NOW);
  assert.equal(r.source, "aegis");
  assert.equal(r.codes.length, 2);
  assert.equal(r.unsupported, 2);
  assert.equal(r.codes[0].uri, "otpauth://totp/GitHub:ann%40example.org?secret=" + SECRET + "&issuer=GitHub");
  assert.equal(r.codes[1].uri, "otpauth://totp/Bank:x?secret=" + SECRET2 + "&issuer=Bank&algorithm=SHA256&digits=8&period=60");
  const p = PC.parseOtp(r.codes[1].uri);
  assert.equal(p.algo, "SHA-256"); assert.equal(p.digits, 8); assert.equal(p.period, 60);
  const encd = { version: 1, header: { slots: [{ type: 1 }], params: { nonce: "x" } }, db: "base64..." };
  // encrypted with a password slot: opened by unlock() (passwords-import3.test.js)
  assert.equal(I.parseText(JSON.stringify(encd)).locked, "aegis");
  assert.equal(I.parseText(JSON.stringify({ version: 1, header: { slots: [{ type: 2 }], params: { nonce: "x" } }, db: "x" })).error, "encrypted-aegis");
});

test("2FAS backup → codes; a backup with a password waits for it", () => {
  const j = { schemaVersion: 4, services: [
    { name: "Dropbox", secret: SECRET, otp: { account: "me@x.org", issuer: "Dropbox", digits: 6, period: 30, algorithm: "SHA1", tokenType: "TOTP" } },
    { name: "Ctr", secret: SECRET, otp: { tokenType: "HOTP", counter: 1 } }
  ], groups: [] };
  const r = I.parseText(JSON.stringify(j), "backup.2fas", NOW);
  assert.equal(r.source, "2fas");
  assert.equal(r.codes.length, 1);
  assert.equal(r.unsupported, 1);
  assert.equal(r.codes[0].account, "me@x.org");
  assert.equal(I.parseText(JSON.stringify({ schemaVersion: 4, services: [], servicesEncrypted: "abc:def:ghi" })).locked, "2fas");
  assert.equal(I.parseText(JSON.stringify({ schemaVersion: 4, services: [], servicesEncrypted: "abc" })).error, "encrypted-2fas");
});

// Protobuf encoder for test fixtures only.
function varint(n) { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; o.push(b); } while (n); return o; }
function fld(no, bytes) { return [...varint(no * 8 + 2), ...varint(bytes.length), ...bytes]; }
function num(no, v) { return [...varint(no * 8), ...varint(v)]; }
function otpParam(o) {
  return [...fld(1, [...o.secret]), ...fld(2, [...enc(o.name)]), ...fld(3, [...enc(o.issuer)]), ...num(4, o.algo), ...num(5, o.digits), ...num(6, o.type)];
}
function migration(params, batch) {
  const b = [];
  params.forEach((p) => b.push(...fld(1, otpParam(p))));
  b.push(...num(2, 1), ...num(3, batch[1]), ...num(4, batch[0]), ...num(5, 777));
  return "otpauth-migration://offline?data=" + encodeURIComponent(Buffer.from(b).toString("base64"));
}

test("Google Authenticator: the documented example link, batches, HOTP left out, merging batches", () => {
  // independent example (secret "Hello!\xde\xad\xbe\xef", Example:alice@google.com)
  const ex = I.parseText("otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8SGEV4YW1wbGU6YWxpY2VAZ29vZ2xlLmNvbRoHRXhhbXBsZTAC");
  assert.equal(ex.source, "gauth");
  assert.equal(ex.codes.length, 1);
  assert.equal(ex.codes[0].secret, SECRET);
  assert.equal(ex.codes[0].issuer, "Example");
  assert.equal(ex.codes[0].account, "alice@google.com");
  const s2 = PC.base32Decode(SECRET2);
  const b1 = I.parseText(migration([{ secret: s2, name: "Bank:me", issuer: "Bank", algo: 2, digits: 2, type: 2 },
                                    { secret: s2, name: "ctr", issuer: "C", algo: 1, digits: 1, type: 1 }], [0, 2]));
  assert.deepEqual(b1.batch, { size: 2, index: 0, id: 777 });
  assert.equal(b1.codes.length, 1);
  assert.equal(b1.unsupported, 1);
  assert.ok(/algorithm=SHA256&digits=8/.test(b1.codes[0].uri));
  const b2 = I.parseText(migration([{ secret: PC.base32Decode(SECRET), name: "u@x", issuer: "Site", algo: 1, digits: 1, type: 2 }], [1, 2]));
  const all = I.mergeResults(b1, b2);
  assert.equal(all.codes.length, 2);
  assert.equal(all.batches.length, 2);
  assert.equal(I.mergeResults(all, b2).codes.length, 2, "the same batch twice adds nothing");
  assert.equal(I.parseText("otpauth-migration://offline?data=%%%").error, "format");
  assert.equal(I.parseText("otpauth-migration://offline?data=CgQKAgE=").error, "format", "truncated protobuf");
  // a single otpauth link works too
  assert.equal(I.parseText("otpauth://totp/Site:u?secret=" + SECRET + "&issuer=Site").codes.length, 1);
});

// ---------- merge ----------
test("apply: dedupe, codes attach to exactly one matching entry, else code-only entries; nothing of the user's changes", () => {
  const snap = vault([
    { title: "GitHub", user: "ann@example.org", pw: "x", urls: ["https://github.com"] },
    { title: "Bank", user: "x", pw: "y", urls: ["https://bank.example"], totp: "" },
    { title: "Bank 2", user: "x", pw: "z", urls: ["https://www.bank.example"] },
    { title: "Has code", user: "q", pw: "w", totp: "otpauth://totp/Q?secret=" + SECRET2 }
  ]);
  const aegis = I.parseText(JSON.stringify({ header: { slots: null }, db: { entries: [
    { type: "totp", name: "ann@example.org", issuer: "GitHub", info: { secret: SECRET, algo: "SHA1", digits: 6, period: 30 } },
    { type: "totp", name: "x", issuer: "Bank", info: { secret: "MFRGGZDFMZTWQ2LKNNWG23TP", algo: "SHA1", digits: 6, period: 30 } },
    { type: "totp", name: "dup", issuer: "Q", info: { secret: SECRET2, algo: "SHA1", digits: 6, period: 30 } }
  ] } }), "", NOW);
  const out = I.apply(snap, aegis, { now: NOW });
  assert.equal(out.attached, 1);           // GitHub: one match
  assert.equal(out.codesNew, 1);           // Bank: two matches → code-only entry
  assert.equal(out.duplicates, 1);         // secret already in the vault
  const gh = out.snap.e.find((e) => e.title === "GitHub");
  assert.ok(gh.totp.indexOf(SECRET) > 0);
  assert.equal(gh.m, NOW);
  assert.equal(gh.pw, "x");
  const only = out.snap.e.find((e) => e.title === "Bank" && !e.pw);
  assert.ok(only && only.totp && only.user === "x");
  assert.equal(out.snap.e.find((e) => e.title === "Bank" && e.pw).totp, "", "two matches: neither gets the code");
  // again: nothing new
  const again = I.apply(out.snap, aegis, { now: NOW + 10 });
  assert.equal(again.added + again.codesNew + again.attached, 0);
  assert.equal(again.duplicates, 3);
  // undo: the code-only entry is gone (newer tomb), GitHub loses the code with a newer stamp
  const back = I.undo(out.snap, out.undo, NOW + 20);
  assert.equal(back.e.length, 4);
  const gh2 = back.e.find((e) => e.title === "GitHub");
  assert.equal(gh2.totp, ""); assert.equal(gh2.m, NOW + 20);
  // sync-safe: merging the imported snapshot back in does not resurrect anything
  const merged = PC.mergeSnap(back, out.snap);
  assert.equal(merged.e.length, 4);
  assert.equal(merged.e.find((e) => e.title === "GitHub").totp, "");
});

test("apply: entries and a re-import after Undo; same content with another id is a duplicate", async () => {
  const r = I.parseText("url,username,password,totp,extra,name,grouping,fav\nhttps://a.example,al,pa,,,A,,0\nhttps://b.example,bo,pb,,,B,,0\n", "", NOW);
  const snap = vault([{ title: "A", user: "al", pw: "pa", urls: ["https://a.example"] }]);
  const out = I.apply(snap, r, { now: NOW });
  assert.equal(out.added, 1);
  assert.equal(out.duplicates, 1);
  assert.equal(out.snap.e.length, 2);
  const back = I.undo(out.snap, out.undo, NOW + 1);
  assert.equal(back.e.length, 1);
  const tomb = back.d[out.undo.added[0].id];
  assert.ok(tomb > NOW);
  // importing again after Undo brings it back (stamped after the tomb)
  const re = I.apply(back, r, { now: NOW + 1 });
  assert.equal(re.added, 1);
  assert.equal(re.snap.e.length, 2);
  // an import's own entry gets a code from the same file batch? (code → entry of this import)
  const both = I.mergeResults(I.parseText("Title,URL,Username,Password,Notes,OTPAuth\nSite,https://site.example,u@x,pw,,\n", "", NOW),
                              I.parseText("otpauth://totp/Site:u%40x?secret=" + SECRET + "&issuer=Site"));
  const o2 = I.apply(PC.emptySnap(), both, { now: NOW });
  assert.equal(o2.attached, 1);
  assert.equal(o2.snap.e.length, 1);
  assert.ok(o2.snap.e[0].totp);
});

test("caps, junk and source rules", async () => {
  assert.equal(I.parseText("").error, "empty");
  assert.equal(I.parseText("{bad").error, "json");
  assert.equal(I.parseText(JSON.stringify({ hello: 1 })).error, "format");
  assert.equal((await I.parse({ name: "x.zip", bytes: Z.write([{ name: "a.txt", data: "hi" }]) })).error, "format");
  assert.deepEqual(await I.parse({ name: "db.kdbx", bytes: new Uint8Array([3, 0xd9, 0xa2, 0x9a, 0x67, 0xfb, 0x4b, 0xb5]) }), { kdbx: true });
  let big = "url,username,password,totp,extra,name,grouping,fav\n";
  for (let i = 0; i < I.MAX_ITEMS + 5; i++) big += "https://h" + i + ".example,u,p,,,n" + i + ",,0\n";
  const r = I.parseText(big, "", NOW);
  assert.equal(r.entries.length, I.MAX_ITEMS);
  assert.equal(r.skipped, 5);
  const src = fs.readFileSync(path.join(ROOT, "passwords/import.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/console\.|Math\.random|innerHTML|eval\(|new Function|localStorage|fetch\(|XMLHttpRequest/.test(src));
});
