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
