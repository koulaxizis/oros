// Public Domain Calculator: the country rules engine (pubdomain/rules.js)
// and the Wikidata parsing of pubdomain.js, against hand-made fixtures
// (no network). Run: node --test tests/
//
// rules.js attaches orosPD to the global object it is given. The app is
// a browser IIFE with no exports, so its parsing sections are cut out
// of the source and evaluated on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const rulesSrc = fs.readFileSync(path.join(ROOT, "pubdomain/rules.js"), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, "pubdomain/pubdomain.js"), "utf8");

function loadRules() {
  const ctx = { window: {} };
  vm.runInNewContext(rulesSrc, ctx);
  return ctx.window.orosPD;
}
const PD = loadRules();
const TODAY = { y: 2026, m: 10, d: 8 };

function block(from, to) {
  const i = appSrc.indexOf(from), j = appSrc.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return appSrc.slice(i, j);
}
function buildApp(lang) {
  return new Function("window",
    "var LANG = " + JSON.stringify(lang) + ";\n" +
    block("  var PREFS_KEY", "  // ---------- 1.") +
    block("  function clip(", "  // BOOT MARKER") +
    block("  // ---------- 3. Wikidata: parsing", "  // ---------- 5. Storage") +
    "\nreturn { parseSearch, parseTime, timeOf, personFrom, workFrom, creatorIds, isHuman, wikiLink, inputOf, clip };")({ orosPD: PD });
}
const A = buildApp("el");
const AEN = buildApp("en");

function one(death, cid, extra) {
  return PD.compute(Object.assign({ authors: [{ death }] }, extra || {}), cid, TODAY);
}
const Y = (y, m, d) => ({ y, m: m || 0, d: d || 0 });

// ---------- Rules ----------

test("every country row is complete and unique", () => {
  const ids = new Set();
  assert.ok(PD.COUNTRIES.length >= 20);
  assert.equal(PD.COUNTRIES[0].id, "GR");
  PD.COUNTRIES.forEach((c) => {
    assert.match(c.id, /^[A-Z]{2}$/);
    assert.ok(!ids.has(c.id), c.id);
    ids.add(c.id);
    assert.ok(c.n.en && c.n.el, c.id);
    assert.ok(c.law.en && c.law.el, c.id);
    assert.match(c.src, /^https:\/\//, c.id);
    assert.ok([50, 60, 70, 80, 100].includes(c.term), c.id);
    assert.ok(Number.isInteger(c.anon), c.id);
    (c.notes || []).forEach((n) => assert.ok(PD.NOTES[n] && PD.NOTES[n].en && PD.NOTES[n].el, c.id + " " + n));
    (c.old || []).forEach((o) => assert.match(o.before, /^\d{4}-\d{2}-\d{2}$/, c.id));
  });
});

test("Greece: life + 70, free on 1 January of death + 71", () => {
  const kaz = one(Y(1957, 10, 26), "GR");
  assert.equal(kaz.status, "protected");
  assert.equal(kaz.from, 2028);
  assert.equal(kaz.basis, "life");
  assert.equal(kaz.term, 70);
  const cavafy = one(Y(1933, 4, 29), "GR");
  assert.equal(cavafy.status, "pd");
  assert.equal(cavafy.from, 2004);
  // the edge: died 1955 → free on 1/1/2026, already today
  assert.equal(one(Y(1955), "GR").status, "pd");
  assert.equal(one(Y(1956), "GR").status, "protected");
  assert.equal(one(Y(1956), "GR").from, 2027);
});

test("a living author is protected; a missing date cannot be computed", () => {
  const r = PD.compute({ authors: [{ alive: true }] }, "GR", TODAY);
  assert.equal(r.status, "protected");
  assert.equal(r.basis, "alive");
  assert.equal(r.from, null);
  assert.equal(PD.compute({ authors: [{ death: null }] }, "GR", TODAY).status, "unknown");
  assert.equal(PD.compute({ authors: [] }, "GR", TODAY).reason, "needDeath");
  assert.equal(PD.compute({ authors: [] }, "XX", TODAY).reason, "country");
});

test("joint works: the last author to die decides; one living author protects", () => {
  const r = PD.compute({ authors: [{ death: Y(1930) }, { death: Y(1960) }] }, "GR", TODAY);
  assert.equal(r.from, 2031);
  assert.equal(r.status, "protected");
  const alive = PD.compute({ authors: [{ death: Y(1900) }, { alive: true }] }, "GR", TODAY);
  assert.equal(alive.basis, "alive");
  const gap = PD.compute({ authors: [{ death: Y(1900) }, { death: null }] }, "GR", TODAY);
  assert.equal(gap.status, "unknown");
});

test("anonymous works count from publication", () => {
  assert.equal(PD.compute({ anonymous: true, pub: 1950 }, "GR", TODAY).from, 2021);
  assert.equal(PD.compute({ anonymous: true, pub: 1950 }, "GR", TODAY).basis, "anon");
  assert.equal(PD.compute({ anonymous: true, pub: 1960 }, "GR", TODAY).status, "protected");
  assert.equal(PD.compute({ anonymous: true, pub: null }, "GR", TODAY).reason, "needPub");
});

test("Spain: deaths before 7 Dec 1987 get 80 years; a year-only 1987 is a range", () => {
  const a = one(Y(1980), "ES");
  assert.equal(a.from, 2061);
  assert.equal(a.basis, "old");
  assert.equal(a.term, 80);
  assert.equal(one(Y(1990), "ES").from, 2061);
  assert.equal(one(Y(1987, 12, 6), "ES").from, 2068);
  assert.equal(one(Y(1987, 12, 7), "ES").from, 2058);
  assert.equal(one(Y(1987, 11), "ES").from, 2068);   // month known, before December
  const y = one(Y(1987), "ES");
  assert.equal(y.from, 2058);
  assert.equal(y.fromMax, 2068);
  assert.equal(y.status, "protected");
});

test("non-retroactive extensions: Canada, Australia, Japan, Russia", () => {
  assert.equal(one(Y(1971), "CA").status, "pd");
  assert.equal(one(Y(1971), "CA").basis, "old");
  assert.equal(one(Y(1972), "CA").from, 2043);
  assert.equal(one(Y(1954), "AU").status, "pd");
  assert.equal(one(Y(1955), "AU").from, 2026);
  assert.equal(one(Y(1967), "JP").status, "pd");
  assert.equal(one(Y(1968), "JP").from, 2039);
  assert.equal(one(Y(1942), "RU").status, "pd");
  assert.equal(one(Y(1943), "RU").from, 2014);
});

test("other terms: Mexico 100, India 60, China 50", () => {
  assert.equal(one(Y(1957), "MX").from, 2058);
  assert.equal(one(Y(1951), "MX").status, "pd");          // extensions not retroactive
  assert.equal(one(Y(1952), "MX").from, 2053);
  assert.equal(one(Y(1957), "IN").from, 2018);
  assert.equal(one(Y(1957), "CN").from, 2008);
});

test("United States: publication before 1978 counts, else life + 70", () => {
  assert.equal(one(Y(1990), "US", { pub: 1930 }).status, "pd");
  const p31 = one(Y(1990), "US", { pub: 1931 });
  assert.equal(p31.status, "protected");
  assert.equal(p31.from, 2027);
  assert.equal(p31.basis, "uspub");
  assert.equal(one(Y(1990), "US", { pub: 1980 }).from, 2061);
  // no publication year: a long-dead author is sure, else "depends"
  const old = one(Y(1920), "US");
  assert.equal(old.status, "pd");
  assert.equal(old.basis, "usall");
  const dep = one(Y(1957), "US");
  assert.equal(dep.status, "maybe");
  assert.equal(dep.basis, "usdepends");
  assert.equal(dep.from, 2028);
  // anonymous: 95 years from publication
  assert.equal(PD.compute({ anonymous: true, pub: 1990 }, "US", TODAY).from, 2086);
});

test("uncertain dates give a range and 'maybe' when today falls inside it", () => {
  const r = PD.compute({ authors: [{ death: Y(1950), deathMax: Y(1959) }] }, "GR", TODAY);
  assert.equal(r.from, 2021);
  assert.equal(r.fromMax, 2030);
  assert.equal(r.status, "maybe");
  const all = PD.compute({ authors: [{ death: Y(1900), deathMax: Y(1909) }] }, "GR", TODAY);
  assert.equal(all.status, "pd");
});

test("before(): cutoff dates against partial dates", () => {
  assert.equal(PD.before(Y(1971), "1972-01-01"), true);
  assert.equal(PD.before(Y(1972), "1972-01-01"), false);
  assert.equal(PD.before(Y(1987), "1987-12-07"), null);
  assert.equal(PD.before(Y(1987, 12), "1987-12-07"), null);
  assert.equal(PD.before(Y(1987, 12, 6), "1987-12-07"), true);
});

// ---------- Wikidata parsing ----------

function claim(time, prec, rank, snaktype) {
  return {
    rank: rank || "normal",
    mainsnak: snaktype && snaktype !== "value" ? { snaktype } :
      { snaktype: "value", datavalue: { value: { time, precision: prec } } }
  };
}
function item(id, prop) {
  return { rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { id } } } };
}
function person(id, born, died, extra) {
  return Object.assign({
    id,
    labels: { el: { value: "Νίκος Καζαντζάκης" }, en: { value: "Nikos Kazantzakis" } },
    descriptions: { el: { value: "Έλληνας συγγραφέας" }, en: { value: "Greek writer" } },
    claims: Object.assign({ P31: [item("Q5")] },
      born ? { P569: [claim(born, 11)] } : {},
      died ? { P570: [claim(died, 11)] } : {}),
    sitelinks: { elwiki: { title: "Νίκος Καζαντζάκης" }, enwiki: { title: "Nikos Kazantzakis" } }
  }, extra || {});
}

test("search results: valid ids only, text clipped and control chars removed", () => {
  const list = A.parseSearch({ search: [
    { id: "Q1", label: "A\u0000B", description: "x".repeat(400) },
    { id: "javascript:alert(1)", label: "bad" },
    { id: "Q2", label: "" },
    null
  ] });
  assert.equal(list.length, 2);
  assert.equal(list[0].label, "A B");
  assert.equal(list[0].desc.length, 300);
  assert.equal(list[1].label, "Q2");
  assert.deepEqual(A.parseSearch({}), []);
  assert.deepEqual(A.parseSearch(null), []);
});

test("Wikidata times: precision day, year, decade, BCE", () => {
  assert.deepEqual(A.parseTime({ time: "+1957-10-26T00:00:00Z", precision: 11 }), { y: 1957, m: 10, d: 26, prec: 11 });
  assert.deepEqual(A.parseTime({ time: "+1957-00-00T00:00:00Z", precision: 9 }), { y: 1957, m: 0, d: 0, prec: 9 });
  assert.equal(A.parseTime({ time: "-0399-00-00T00:00:00Z", precision: 9 }).y, -399);
  assert.equal(A.parseTime({ time: "garbage" }), null);
  assert.equal(A.parseTime(null), null);
});

test("a person: name, dates, Wikipedia link in the UI language", () => {
  const p = A.personFrom(person("Q192207", "+1883-02-18T00:00:00Z", "+1957-10-26T00:00:00Z"), TODAY);
  assert.equal(p.kind, "person");
  assert.equal(p.name, "Νίκος Καζαντζάκης");
  assert.equal(p.bornY, 1883);
  assert.equal(p.alive, false);
  assert.deepEqual(p.death.min, { y: 1957, m: 10, d: 26 });
  assert.equal(p.wiki, "https://el.wikipedia.org/wiki/" + encodeURIComponent("Νίκος_Καζαντζάκης"));
  const en = AEN.personFrom(person("Q192207", null, "+1957-10-26T00:00:00Z"), TODAY);
  assert.equal(en.name, "Nikos Kazantzakis");
  assert.equal(en.wiki, "https://en.wikipedia.org/wiki/Nikos_Kazantzakis");
  const input = A.inputOf(p);
  assert.equal(PD.compute(input, "GR", TODAY).from, 2028);
});

test("ranks: deprecated ignored, preferred wins; several dates become a range", () => {
  const ent = person("Q1", null, null);
  ent.claims.P570 = [claim("+1900-00-00T00:00:00Z", 9, "deprecated"), claim("+1950-05-01T00:00:00Z", 11)];
  assert.equal(A.timeOf(ent, "P570").min.y, 1950);
  ent.claims.P570.push(claim("+1951-01-01T00:00:00Z", 11, "preferred"));
  assert.equal(A.timeOf(ent, "P570").min.y, 1951);
  ent.claims.P570 = [claim("+1950-00-00T00:00:00Z", 9), claim("+1952-00-00T00:00:00Z", 9)];
  const t = A.timeOf(ent, "P570");
  assert.equal(t.many, true);
  assert.equal(t.max.y, 1952);
});

test("decade precision is a 10-year range; unknown value and centuries are unknown", () => {
  const ent = person("Q1", null, null);
  ent.claims.P570 = [claim("+1950-00-00T00:00:00Z", 8)];
  const t = A.timeOf(ent, "P570");
  assert.equal(t.decade, true);
  assert.equal(t.min.y, 1950);
  assert.equal(t.max.y, 1959);
  ent.claims.P570 = [claim(null, null, "normal", "somevalue")];
  assert.equal(A.timeOf(ent, "P570").state, "unknown");
  ent.claims.P570 = [claim("+1801-00-00T00:00:00Z", 7)];
  assert.equal(A.timeOf(ent, "P570").state, "unknown");
  delete ent.claims.P570;
  assert.equal(A.timeOf(ent, "P570").state, "none");
});

test("no date of death: living when born recently, else unknown", () => {
  const young = A.personFrom(person("Q1", "+1970-01-01T00:00:00Z", null), TODAY);
  assert.equal(young.alive, true);
  assert.equal(PD.compute(A.inputOf(young), "GR", TODAY).basis, "alive");
  const old = A.personFrom(person("Q1", "+1850-01-01T00:00:00Z", null), TODAY);
  assert.equal(old.alive, false);
  assert.equal(PD.compute(A.inputOf(old), "GR", TODAY).status, "unknown");
});

test("a work: creators from P50/P86/…, publication year, last death counts", () => {
  const work = {
    id: "Q100",
    labels: { en: { value: "Zorba the Greek" } },
    descriptions: {},
    claims: {
      P31: [item("Q7725634")],
      P50: [item("Q192207")],
      P86: [item("Q200"), item("Q192207")],
      P577: [claim("+1946-00-00T00:00:00Z", 9)]
    },
    sitelinks: {}
  };
  assert.equal(A.isHuman(work), false);
  assert.deepEqual(A.creatorIds(work), ["Q192207", "Q200"]);
  const comp = person("Q200", "+1925-07-29T00:00:00Z", "+2021-09-02T00:00:00Z");
  comp.labels = { en: { value: "Composer" } };
  const w = A.workFrom(work, {
    Q192207: person("Q192207", null, "+1957-10-26T00:00:00Z"),
    Q200: comp
  }, TODAY);
  assert.equal(w.kind, "work");
  assert.equal(w.name, "Zorba the Greek");
  assert.equal(w.pub, 1946);
  assert.equal(w.creators.length, 2);
  assert.equal(w.wiki, null);
  const r = PD.compute(A.inputOf(w), "GR", TODAY);
  assert.equal(r.from, 2092);
  assert.equal(PD.compute(A.inputOf(w), "US", TODAY).from, 2042);   // pub 1946 + 95 + 1
});

test("hostile text stays text: labels, ids and sitelink titles", () => {
  const ent = person("Q1", null, "+1900-01-01T00:00:00Z");
  ent.labels = { el: { value: "<img src=x onerror=alert(1)>" } };
  ent.sitelinks = { elwiki: { title: "a/../../evil?x=<script>" } };
  const p = A.personFrom(ent, TODAY);
  assert.equal(p.name, "<img src=x onerror=alert(1)>");       // rendered with textContent
  assert.ok(p.wiki.startsWith("https://el.wikipedia.org/wiki/"));
  assert.ok(!/[<>?]/.test(p.wiki.slice("https://el.wikipedia.org/wiki/".length)));
  // creator ids that are not Q-ids are ignored
  const work = { id: "Q9", claims: { P50: [item("Q1"), item("javascript:x"), item("Q9")] } };
  assert.deepEqual(A.creatorIds(work), ["Q1"]);
});

test("the app never writes API text as HTML", () => {
  // innerHTML is only ever cleared or set from the UI icon constants
  const uses = appSrc.match(/\.innerHTML\s*=\s*[^;]+;/g) || [];
  uses.forEach((u) => assert.match(u, /innerHTML\s*=\s*(""|UI\.\w+);/, u));
  assert.ok(!/insertAdjacentHTML|outerHTML\s*=|document\.write/.test(appSrc));
});
