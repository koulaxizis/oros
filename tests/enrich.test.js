// Update from online sources (enrich.js): page reading, name and
// phone cross-checks, confidence, and a full lookup with the network
// replaced by fixtures.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../enrich.js");

test("phones meet with or without the country code", () => {
  assert.ok(E.samePhone("+30 697 123 4567", "6971234567"));
  assert.ok(E.samePhone("0030 6971234567", "+306971234567"));
  assert.ok(!E.samePhone("6971234567", "6971234568"));
  assert.equal(E.normPhone("12"), "");
});

test("closed networks are links only, link pages are read", () => {
  assert.equal(E.classify("https://www.instagram.com/someone").fetch, false);
  assert.equal(E.classify("https://facebook.com/someone").fetch, false);
  assert.equal(E.classify("https://linkedin.com/in/someone").fetch, false);
  assert.equal(E.classify("https://linktr.ee/someone").kind, "links");
  assert.equal(E.classify("https://mastodon.social/@someone").net, "fediverse");
  assert.equal(E.classify("https://example.gr/about").kind, "site");
  assert.ok(E.isNoise("https://facebook.com/sharer/sharer.php?u=x"));
  assert.ok(E.isNoise("https://linktr.ee"));
});

test("Greek and Latin spellings of a name agree", () => {
  assert.equal(E.skeleton("Χρήστος"), E.skeleton("Christos"));
  assert.equal(E.skeleton("Κουλαξίζης"), E.skeleton("Koulaxizis"));
  assert.equal(E.nameAgree(["Χρήστος Κουλαξίζης"], "Christos Koulaxizis"), 1);
  assert.equal(E.nameAgree(["Γιώργος Παπαδόπουλος"], "Maria Smith"), -1);
  assert.equal(E.nameAgree(["Γιώργος"], ""), 0);
});

test("parsePage reads links, rel=me, tel, mailto, wa.me, og and JSON-LD", () => {
  const html = `<html><head><title>Old</title>
    <meta property="og:title" content="Maria K &amp; Co">
    <meta property="og:image" content="/me.jpg">
    <link rel="me" href="https://mastodon.social/@maria">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"Maria Kosta",
      "birthDate":"1990-04-12","jobTitle":"Designer","telephone":"+30 210 1234567",
      "address":{"@type":"PostalAddress","streetAddress":"Odos 1","addressLocality":"Athens","postalCode":"10558"},
      "sameAs":["https://www.instagram.com/mariak/"]}</script>
    </head><body>
    <a href="tel:+306971234567">call</a> <a href="mailto:Maria@Example.gr?subject=hi">mail</a>
    <a href="https://wa.me/306971112233">wa</a>
    <a href="https://facebook.com/sharer/sharer.php?u=x">share</a>
    <a href="/contact">same site</a>
    <a href="https://github.com/mariak">gh</a>
    </body></html>`;
  const p = E.parsePage(html, "https://maria.gr/");
  assert.equal(p.title, "Maria K & Co");
  assert.equal(p.image, "https://maria.gr/me.jpg");
  assert.deepEqual(p.relMe, ["https://mastodon.social/@maria"]);
  assert.ok(p.phones.includes("+306971234567"));
  assert.ok(p.phones.includes("+306971112233"));
  assert.deepEqual(p.emails, ["maria@example.gr"]);
  assert.ok(p.links.includes("https://github.com/mariak"));
  assert.ok(!p.links.some(u => /sharer|maria\.gr/.test(u)));
  assert.equal(p.people[0].name, "Maria Kosta");
  assert.deepEqual(p.people[0].birth, { day: "04-12", year: 1990 });
  assert.equal(p.people[0].address, "Odos 1, 10558 Athens");
});

test("a page showing the record's own phone is sure; another name makes it 'check'", () => {
  const rec = { names: ["Μαρία Κώστα"], emails: [], phones: ["6971234567"], sites: ["https://maria.gr"], has: {} };
  const p = E.parsePage(`<a href="tel:+306971234567">x</a><a href="https://github.com/mk">g</a>`, "https://maria.gr/");
  const f = E.fromPage(p, "https://maria.gr/", { rec });
  f.base = "likely";
  let s = E.propose(rec, [f]);
  assert.equal(s.find(x => x.k === "link").conf, "sure");
  assert.ok(!s.some(x => x.k === "phone"), "known phone not suggested again");

  const q = E.parsePage(`<script type="application/ld+json">{"@type":"Person","name":"John Doe","telephone":"+302101111111"}</script>`, "https://other.gr/");
  const g = E.fromPage(q, "https://other.gr/", { rec });
  g.base = "likely";
  s = E.propose(rec, [g]);
  assert.equal(s.find(x => x.k === "phone").conf, "check");
});

test("Gravatar profile becomes sure suggestions; hidden accounts are skipped", () => {
  const f = E.fromGravatar({ display_name: "Christos Koulaxizis", avatar_url: "https://gravatar.com/avatar/abc",
    job_title: "Developer", company: "orOS", verified_accounts: [
      { url: "https://github.com/koulaxizis", is_hidden: false }, { url: "https://x.com/hidden", is_hidden: true }] });
  f.base = "sure"; f.via = "c@example.gr";
  const rec = { names: ["Χρήστος Κουλαξίζης"], emails: ["c@example.gr"], phones: [], sites: [], has: { name: true } };
  const s = E.propose(rec, [f]);
  assert.equal(s.find(x => x.k === "photo").v, "https://gravatar.com/avatar/abc?s=256&d=404");
  assert.equal(s.find(x => x.k === "link").v, "https://github.com/koulaxizis");
  assert.ok(!s.some(x => x.v === "https://x.com/hidden"));
  assert.equal(s.find(x => x.k === "job").conf, "sure");
  assert.ok(!s.some(x => x.k === "name"), "a record with a name gets no name");
});

test("lookup: Gravatar, the record's page, one hop to a link page; shared e-mails skipped", async () => {
  const pages = {
    "https://api.gravatar.com/v3/profiles/H(a@x.gr)": { status: 200, type: "application/json", text: JSON.stringify({
      display_name: "Anna P", verified_accounts: [{ url: "https://linktr.ee/annap" }] }) },
    "https://anna.gr": { status: 200, type: "text/html", text: `<a href="tel:6971234567">t</a><a href="https://instagram.com/annap">i</a>` },
    "https://linktr.ee/annap": { status: 200, type: "text/html", text: `<a href="https://annashop.gr">shop</a><a href="https://instagram.com/annap">i</a>` }
  };
  const asked = [];
  const opts = {
    sha256: (m) => Promise.resolve("H(" + m + ")"),
    getText: (u) => { asked.push(u); return Promise.resolve(pages[u] || { status: 404, text: "" }); }
  };
  const rec = { names: ["Άννα Παππά"], emails: ["a@x.gr", "office@x.gr"], phones: ["+30 697 123 4567"],
    sites: ["anna.gr"], shared: { "office@x.gr": 1 }, has: { name: true } };
  const s = await E.lookup(rec, opts);
  assert.ok(!asked.some(u => u.includes("office@x.gr")), "shared address never looked up");
  assert.ok(!asked.some(u => /instagram/.test(u)), "closed network never read");
  assert.ok(asked.includes("https://linktr.ee/annap"));
  const insta = s.find(x => x.v === "https://instagram.com/annap");
  assert.equal(insta.conf, "sure");
  assert.ok(insta.src.length >= 2);
  assert.ok(s.some(x => x.v === "https://annashop.gr"));
});

test("names for a record without one, only from its own e-mail", () => {
  const f = E.fromGravatar({ display_name: "Eleni" });
  f.base = "sure"; f.via = "e@x.gr";
  const s = E.propose({ names: [], emails: ["e@x.gr"], has: { name: false } }, [f]);
  assert.equal(s.find(x => x.k === "name").v, "Eleni");
});

test("wave 2: profile links map to their public APIs", () => {
  assert.equal(E.profileApi("https://github.com/koulaxizis").api, "https://api.github.com/users/koulaxizis");
  assert.equal(E.profileApi("https://github.com/orgs"), null);
  assert.equal(E.profileApi("https://github.com/a/b"), null);
  assert.equal(E.profileApi("https://bsky.app/profile/anna.gr").api,
    "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=anna.gr");
  assert.equal(E.profileApi("https://mastodon.social/@maria").api, "https://mastodon.social/api/v1/accounts/lookup?acct=maria");
  assert.equal(E.profileApi("https://instagram.com/maria"), null);
  assert.equal(E.profileApi("https://anna.gr"), null);
});

test("wave 2: GitHub, Bluesky and Mastodon answers become findings", () => {
  const g = E.fromGitHub({ login: "mk", name: "Maria K", blog: "maria.gr", twitter_username: "mariak", company: "@acme",
    email: "M@maria.gr", bio: "see https://linktr.ee/mariak." });
  assert.deepEqual(g.links.map(l => l.url), ["https://maria.gr", "https://x.com/mariak", "https://linktr.ee/mariak"]);
  assert.deepEqual(g.emails, ["m@maria.gr"]);
  assert.equal(g.org, "acme");
  const b = E.fromBluesky({ handle: "maria.gr", displayName: "Maria", description: "shop https://shop.gr" });
  assert.ok(b.links.some(l => l.url === "https://maria.gr" && l.verified));
  assert.ok(b.links.some(l => l.url === "https://shop.gr" && !l.verified));
  assert.ok(!E.fromBluesky({ handle: "x.bsky.social" }).links.length);
  const m = E.fromMastodon({ acct: "maria", display_name: "Maria :blob:", note: '<p>Hi <a href="https://maria.gr/blog">blog</a></p>',
    fields: [{ name: "Web", value: '<a href="https://maria.gr" rel="me">maria.gr</a>', verified_at: "2024-01-01" },
             { name: "Mail", value: "maria@maria.gr" }] }, "https://mastodon.social/@maria");
  assert.equal(m.name, "Maria");
  assert.ok(m.links.some(l => l.url === "https://maria.gr" && l.verified));
  assert.ok(m.links.some(l => l.url === "https://maria.gr/blog"));
});

test("wave 2: lookup reads the open profile a record links to, never a closed one", async () => {
  const asked = [];
  const pages = {
    "https://api.github.com/users/annap": { status: 200, text: JSON.stringify({ login: "annap", name: "Anna Pappa", blog: "https://anna.gr", email: "anna@x.gr" }) },
    "https://mastodon.social/api/v1/accounts/lookup?acct=anna": { status: 200, text: JSON.stringify({ acct: "anna", display_name: "Someone Else",
      fields: [{ value: '<a href="https://other.example">o</a>' }] }) }
  };
  const opts = { sha256: () => Promise.resolve("h"), getText: (u) => { asked.push(u); return Promise.resolve(pages[u] || { status: 404, text: "" }); } };
  const rec = { names: ["Άννα Παππά"], emails: ["anna@x.gr"], phones: [], has: { name: true },
    sites: ["https://github.com/annap", "https://mastodon.social/@anna", "https://instagram.com/annap"] };
  const s = await E.lookup(rec, opts);
  assert.ok(asked.includes("https://api.github.com/users/annap"));
  assert.ok(!asked.some(u => /instagram/.test(u)));
  assert.ok(!asked.includes("https://github.com/annap"), "profile pages are read through the API only");
  assert.equal(s.find(x => x.v === "https://anna.gr").conf, "sure");      // own e-mail on the profile
  assert.equal(s.find(x => x.v === "https://other.example").conf, "check"); // another name
});

test("wave 3: OSM tags become a business finding", () => {
  const f = E.fromOsm({ name: "Φούρνος Νίκος", phone: "+30 210 555 5555;+30 6971234567", website: "nikos.gr",
    "contact:facebook": "nikosbakery", "addr:street": "Ερμού", "addr:housenumber": "5", "addr:postcode": "10563", "addr:city": "Αθήνα" });
  assert.equal(f.phones.length, 2);
  assert.ok(f.links.some(l => l.url === "https://nikos.gr"));
  assert.ok(f.links.some(l => l.url === "https://facebook.com/nikosbakery"));
  assert.equal(f.address, "Ερμού 5, 10563 Αθήνα");
  assert.equal(E.phoneRegex("+30 210 5555555"), "2[^0-9]*1[^0-9]*0[^0-9]*5[^0-9]*5[^0-9]*5[^0-9]*5[^0-9]*5[^0-9]*5[^0-9]*5");
});

test("wave 3: business lookup keeps only candidates sharing the phone or the name", async () => {
  const asked = [];
  const opts = { sha256: () => Promise.resolve("h"), getText: (u) => {
    asked.push(u);
    if (u.startsWith("https://photon.komoot.io/")) return Promise.resolve({ status: 200, text: JSON.stringify({ features: [
      { properties: { osm_type: "N", osm_id: 11, name: "Nikos Bakery" } },
      { properties: { osm_type: "W", osm_id: 22, name: "Totally Different" } }] }) });
    if (u.startsWith("https://overpass-api.de/")) {
      assert.ok(decodeURIComponent(u).includes("node(id:11)"));
      assert.ok(!decodeURIComponent(u).includes("22"));
      return Promise.resolve({ status: 200, text: JSON.stringify({ elements: [{ tags: { name: "Nikos Bakery", phone: "+30 210 5555555", website: "https://nikos.gr" } }] }) });
    }
    return Promise.resolve({ status: 404, text: "" });
  } };
  const s = await E.lookup({ names: ["Φούρνος Νίκος", "Nikos Bakery"], phones: ["2105555555"], kind: "org", place: "Αθήνα",
    has: { name: true, address: true } }, opts);
  assert.equal(s.find(x => x.v === "https://nikos.gr").conf, "sure");
  assert.ok(asked.some(u => u.startsWith("https://photon.komoot.io/")));
  // a person record never goes to OSM
  asked.length = 0;
  await E.lookup({ names: ["Μαρία"], phones: ["2105555555"], kind: "person", place: "Αθήνα", has: {} }, opts);
  assert.ok(!asked.some(u => /photon|overpass/.test(u)));
});

test("wave 3: Wikidata is asked by the record's own website and profile ids, never by name", () => {
  const k = E.wdKeys(["https://anna.gr", "https://github.com/annap", "https://instagram.com/annap"]);
  assert.ok(k.webs.includes("<https://www.anna.gr/>"));
  assert.deepEqual(k.ids, [{ p: "P2037", v: "annap" }, { p: "P2003", v: "annap" }]);
  const q = E.wdQuery(k);
  assert.ok(q.includes("wdt:P856"));
  assert.ok(!/Anna|Άννα/.test(q));
  assert.equal(E.wdQuery({ webs: [], ids: [] }), "");
  assert.deepEqual(E.wdKeys(["https://bad.gr/a b>"]).webs, []);
  const f = E.fromWikidata({ results: { bindings: [
    { item: { value: "http://www.wikidata.org/entity/Q1" }, itemLabel: { value: "Anna Pappa" }, human: { value: "true" },
      birth: { value: "1980-02-29T00:00:00Z" }, P2002: { value: "annap" }, web: { value: "https://anna.gr/" } },
    { item: { value: "http://www.wikidata.org/entity/Q1" }, itemLabel: { value: "Anna Pappa" }, human: { value: "true" },
      P2037: { value: "annap" } }] } });
  assert.equal(f.length, 1);
  assert.deepEqual(f[0].birthday, { day: "02-29", year: 1980 });
  assert.deepEqual(f[0].links.map(l => l.url).sort(), ["https://anna.gr", "https://github.com/annap", "https://x.com/annap"]);
});
