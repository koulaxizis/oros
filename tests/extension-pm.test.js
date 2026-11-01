// orOS add-on 2.0, Passwords (PW-AF1): the vault code is a byte-for-byte
// copy of orOS's, site matching never fills a look-alike or an http
// page, the fill payload holds only the chosen entry, and the add-on's
// copy + unlock (pmvault.js) keeps only ciphertext and, in session
// memory, the vault key with a lock time; never the master password.
// The real fill in a page is checked with Playwright (Bible PW-AF1).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "extension");
const F = require(path.join(DIR, "pmfill.js"));
const PV = require(path.join(ROOT, "passwords/pmcrypto.js"));
const PC = require(path.join(ROOT, "passwords/pmcore.js"));
const K = require(path.join(ROOT, "passwords/pmkinds.js"));

const COPIES = [
  ["passwords/pmcrypto.js", "extension/pm/pmcrypto.js"],
  ["passwords/pmcore.js", "extension/pm/pmcore.js"],
  ["passwords/pmkinds.js", "extension/pm/pmkinds.js"],
  ["vendor/hash-wasm/argon2.umd.min.js", "extension/pm/argon2.umd.min.js"],
  ["vendor/hash-wasm/LICENSE", "extension/pm/LICENSE-hash-wasm"]
];

test("extension/pm/ is a byte-for-byte copy of orOS's vault code (run .github/scripts/ext-pm.js)", () => {
  for (const [a, b] of COPIES) {
    assert.ok(fs.readFileSync(path.join(ROOT, a)).equals(fs.readFileSync(path.join(ROOT, b))), b + " differs from " + a);
  }
  const m = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
  ["pm/pmcrypto.js", "pm/pmcore.js", "pm/pmkinds.js", "pmvault.js"].forEach((f) => assert.ok(m.background.scripts.includes(f), f));
  assert.match(fs.readFileSync(path.join(DIR, "background.js"), "utf8"), /importScripts\("core\.js", "pm\/pmcrypto\.js", "pm\/pmcore\.js", "pm\/pmkinds\.js", "pmvault\.js"\)/);
  assert.match(m.content_security_policy.extension_pages, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.ok(!/unsafe-inline|unsafe-eval'/.test(m.content_security_policy.extension_pages.replace("'wasm-unsafe-eval'", "")));
  assert.equal(m.browser_specific_settings.gecko.id, "send-to-oros@useoros.online");   // released id never changes
  assert.equal(m.commands._execute_action.suggested_key.default, "Ctrl+Shift+L");
  assert.equal(m.commands["send-page"].suggested_key.default, "Alt+Shift+O");
  // extension pages: no inline script, no innerHTML
  for (const f of ["popup.html", "options.html"]) assert.ok(!/<script>(?!<\/script>)|<script(?![^>]*src=)[^>]*>/i.test(fs.readFileSync(path.join(DIR, f), "utf8")), f);
  for (const f of ["popup.js", "options.js", "pmfill.js", "pmvault.js", "background.js"]) {
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(fs.readFileSync(path.join(DIR, f), "utf8")), f);
  }
});

test("fits: same host or a sub-domain, https never to http, no suffix or look-alike", () => {
  const yes = [
    ["https://example.com", "https://example.com/login"],
    ["example.com", "https://www.example.com/a"],
    ["https://accounts.example.com/x", "https://accounts.example.com/signin?y"],
    ["http://intranet.local.example", "http://intranet.local.example/"],
    ["http://example.com", "https://example.com/"],
    ["https://192.168.1.1:8443", "https://192.168.1.1:8443/cgi"],
    ["http://localhost:3000", "http://localhost:3000/login"]
  ];
  const no = [
    ["https://example.com", "http://example.com/"],
    ["https://example.com", "https://example.com.evil.net/"],
    ["https://example.com", "https://notexample.com/"],
    ["https://example.com", "https://evil-example.com/"],
    ["https://login.example.com", "https://example.com/"],
    ["https://a.github.io", "https://b.github.io/"],
    ["com", "https://example.com/"],
    ["https://192.168.1.1", "https://192.168.1.10/"],
    ["https://192.168.1.1:8443", "https://192.168.1.1:9443/"],
    ["https://example.com", "file:///etc/passwd"],
    ["https://example.com", "chrome://settings"],
    ["javascript:alert(1)", "https://example.com/"],
    ["", "https://example.com/"]
  ];
  yes.forEach(([a, b]) => assert.ok(F.fits(a, b), a + " → " + b));
  no.forEach(([a, b]) => assert.ok(!F.fits(a, b), a + " ↛ " + b));
});

function entry(o) { return PC.normEntry(Object.assign(PC.blankEntry(1), { id: PC.newId() }, o), 1); }

test("matches: logins and 2FA codes of this site only, exact host first, then favourites", () => {
  const list = [
    entry({ title: "Shop (www)", user: "w", pw: "1", urls: ["https://www.shop.example"] }),
    entry({ title: "Shop", user: "a", pw: "2", urls: ["shop.example"] }),
    entry({ title: "Fav shop", user: "f", pw: "3", fav: 1, urls: ["https://shop.example"] }),
    entry({ title: "Other", user: "o", pw: "4", urls: ["https://other.example"] }),
    entry({ title: "Plain http", user: "h", pw: "5", urls: ["http://shop.example"] }),
    K.withData(entry({ title: "Card", urls: ["https://www.shop.example"] }), "card", { num: "4111111111111111" }),
    PC.normEntry(K.withData(entry({ title: "Code", user: "c", totp: "JBSWY3DPEHPK3PXP", urls: ["https://www.shop.example"] }), "otp", {}), 1)
  ];
  const m = F.matches(list, "https://www.shop.example/login", K).map((e) => e.title);
  assert.deepEqual(m, ["Code", "Shop (www)", "Fav shop", "Plain http", "Shop"]);
  // a page on http gets only what was saved for http (a bare host counts as https)
  assert.deepEqual(F.matches(list, "http://www.shop.example/", K).map((e) => e.title), ["Plain http"]);
});

test("payload: only the chosen entry's values; a 2FA-only entry never carries a password", () => {
  const login = entry({ title: "L", user: "maria", pw: "s3cret", totp: "JBSWY3DPEHPK3PXP", notes: "do not send" });
  assert.deepEqual(F.payload(login, K, "123456"), { kind: "login", user: "maria", pw: "s3cret", otp: "123456" });
  const card = K.withData(entry({ title: "C" }), "card", { holder: "MARIA P", num: "4111 1111 1111 1111", exp: "8/27", cvv: "123", pin: "0000" });
  const pc = F.payload(card, K);
  assert.deepEqual(pc, { kind: "card", name: "MARIA P", num: "4111111111111111", mm: "08", yyyy: "2027", cvv: "123" });
  assert.ok(!JSON.stringify(pc).includes("0000"), "the PIN never goes to a page");
  const addr = K.withData(entry({ title: "Home" }), "address", { name: "Maria Papadopoulou", street: "Ermou 10", floor: "3", city: "Athina", zip: "10563", country: "GR" });
  const pa = F.payload(addr, K);
  assert.equal(pa.first, "Maria"); assert.equal(pa.last, "Papadopoulou"); assert.equal(pa.line2, "3"); assert.equal(pa.country, "GR");
  const id = K.withData(entry({ title: "Me" }), "identity", { first: "Maria", last: "P", tax: "123456789", pass: "AB1" });
  const pi = F.payload(id, K);
  assert.ok(!JSON.stringify(pi).includes("123456789") && !JSON.stringify(pi).includes("AB1"), "document numbers never go to a page");
  assert.equal(F.payload(K.withData(entry({ title: "N" }), "note", {}), K), null);
});

// ---------- pmvault.js with a fake browser API ----------
function fakeBrowser() {
  const areas = { local: {}, session: {}, sync: {} };
  function area(name) {
    const st = areas[name];
    return {
      get: async (k) => {
        if (typeof k === "string") return k in st ? { [k]: JSON.parse(JSON.stringify(st[k])) } : {};
        const out = {};
        Object.keys(k).forEach((n) => { out[n] = n in st ? st[n] : k[n]; });
        return out;
      },
      set: async (o) => { Object.keys(o).forEach((n) => { st[n] = JSON.parse(JSON.stringify(o[n])); }); },
      remove: async (k) => { delete st[k]; }
    };
  }
  const alarms = [];
  return {
    areas, alarms,
    api: { storage: { local: area("local"), session: area("session"), sync: area("sync") },
           alarms: { create: (n, o) => alarms.push([n, o]) } }
  };
}

async function makeVault(password, entries) {
  const v = await PV.create(password, { kdf: { alg: "pbkdf2-sha256", i: 600000 } });
  const snap = PC.normSnap({ v: 1, d: {}, e: entries });
  const sealed = await PV.seal(v.session, v.vault, snap, { ids: [] });
  return PV.withVault(PV.empty(), v.kid, v.vault, sealed.id, sealed.blob);
}

test("pmvault: copy merged (never replaced), unlock keeps only the key with a lock time, wrong password refused", async () => {
  const fb = fakeBrowser();
  global.chrome = fb.api;
  const factory = require(path.join(DIR, "pmvault.js"));
  const V = factory({ PmVault: PV, PmCore: PC });
  const e1 = entry({ title: "Bank", user: "m", pw: "pw-1", urls: ["https://bank.example"] });
  const slice = await makeVault("master pass 1", [e1]);
  assert.equal(await V.absorbText(JSON.stringify(slice)), true);
  const stored = JSON.stringify(fb.areas.local);
  assert.ok(!stored.includes("pw-1") && !stored.includes("Bank"), "the copy is ciphertext only");
  // an older, empty slice does not drop the vault
  await V.absorbText(JSON.stringify(PV.empty()));
  assert.ok(PV.primaryKid((await V.getCopy()).slice));
  // locked → open() is null
  assert.equal(await V.open(), null);
  await assert.rejects(V.unlock("wrong"), /wrong-password/);
  assert.deepEqual(fb.areas.session, {});
  await V.unlock("master pass 1");
  const key = fb.areas.session.pmKey;
  assert.deepEqual(Object.keys(key).sort(), ["kid", "until", "vk"]);
  assert.ok(!JSON.stringify(fb.areas).includes("master pass 1"), "the master password is never stored");
  assert.ok(key.until > Date.now() + 14 * 60000 && key.until <= Date.now() + 15 * 60000 + 1000, "default lock 15 min");
  assert.equal(fb.alarms[fb.alarms.length - 1][0], "pm-lock");
  const d = await V.open();
  assert.deepEqual(d.entries.map((e) => [e.title, e.pw]), [["Bank", "pw-1"]]);
  // lock time from the options
  fb.areas.sync.pmLockMin = 1;
  await V.open();
  assert.ok(fb.areas.session.pmKey.until <= Date.now() + 60000 + 1000);
  // past the lock time → locked and the key is gone
  fb.areas.session.pmKey.until = Date.now() - 1;
  assert.equal(await V.open(), null);
  assert.equal(fb.areas.session.pmKey, undefined);
  // a vault from a newer orOS is kept whole and never opened
  await V.absorbText(JSON.stringify({ v: 99, vaults: {} }));
  await assert.rejects(V.unlock("master pass 1"), /future/);
  await V.forget();
  assert.equal(await V.getCopy(), null);
  delete global.chrome;
});
