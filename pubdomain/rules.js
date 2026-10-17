// ============================================================
// orOS Public Domain Calculator — copyright term rules (v1.0.0)
// Pure data + engine, no DOM, no network: works offline and in node.
//   - COUNTRIES: one row per country (term, transitional rules,
//     anonymous term, statute + source URL, notes EN/EL)
//   - compute(input, country, today): status for one country
// Exposed as window.orosPD (browser) / globalThis.orosPD (tests).
//
// Every rule is "life + N": a work enters the public domain on
// 1 January of (death year + N + 1). Rows marked v:0 were not read
// at their source; the app shows them as "check the source".
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Countries ----------
  // id        ISO 3166 code
  // n         names { en, el, … } (from TEXT, filled below)
  // term      years after death (general rule)
  // anon      years after publication for anonymous / pseudonymous works
  // old       transitional rules: deaths BEFORE `before` (ISO date) use
  //           `term` instead (e.g. a non-retroactive extension)
  // us        true = United States publication-based rules (pre-1978)
  // law       statute + article(s) { en, el, … } (from TEXT)
  // src       URL of the text the row was checked against
  // v         1 = checked at the source, 0 = not yet (shown as a caution)
  // notes     note ids, explained in NOTES { id: { en, el, … } }
  var COUNTRIES = [
    { id: "GR", term: 70, anon: 70,
      src: "https://www.wipo.int/wipolex/en/text/480564", v: 1,
      notes: ["official"] },
    { id: "CY", term: 70, anon: 70,
      src: "https://library.ucy.ac.cy/research-support/copyright/?lang=en", v: 0, notes: [] },
    { id: "DE", term: 70, anon: 70,
      src: "https://dejure.org/gesetze/UrhG/64.html", v: 1, notes: ["photo"] },
    { id: "FR", term: 70, anon: 70,
      src: "https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069414/LEGISCTA000006161637/", v: 0,
      notes: ["frwar"] },
    { id: "IT", term: 70, anon: 70,
      src: "https://brocardi.it/legge-diritto-autore/titolo-i/capo-iii/sezione-iii/art25.html", v: 1, notes: ["photo"] },
    { id: "ES", term: 70, anon: 70,
      old: [{ before: "1987-12-07", term: 80 }],
      src: "https://www.ecija.com/actualidad-insights/la-proteccion-en-espana-de-las-obras-de-autores-europeos-fallecidos-antes-de-1987/", v: 1, notes: ["photo"] },
    { id: "GB", term: 70, anon: 70,
      src: "https://www.legislation.gov.uk/ukpga/1988/48/section/12", v: 1, notes: ["uk2039"] },
    { id: "CH", term: 70, anon: 70,
      src: "https://lawbrary.ch/law/art/URG-v2022.01-en-art-29", v: 1, notes: [] },
    { id: "TR", term: 70, anon: 70,
      src: "https://www.lexpera.com.tr/mevzuat/kanunlar/fikir-ve-sanat-eserleri-kanunu-5846", v: 1, notes: [] },
    { id: "RU", term: 70, anon: 70,
      old: [{ before: "1943-01-01", term: 50 }],
      src: "https://www.zakonrf.info/gk/1281/", v: 1, notes: ["ruwar"] },
    { id: "US", term: 70, anon: 95, us: true,
      src: "https://www.copyright.gov/circs/circ15a.pdf", v: 1, notes: ["usform"] },
    { id: "CA", term: 70, anon: 75,
      old: [{ before: "1972-01-01", term: 50 }],
      src: "https://www.carl-abrc.ca/influencing-policy/copyright/faq-term-extension-for-authored-works/", v: 1,
      notes: [] },
    { id: "AU", term: 70, anon: 70,
      old: [{ before: "1955-01-01", term: 50 }],
      src: "https://www.library.gov.au/research/access-collection/copyright-library-collections/how-long-does-copyright-last", v: 1, notes: [] },
    { id: "JP", term: 70, anon: 70,
      old: [{ before: "1968-01-01", term: 50 }],
      src: "https://www.bunka.go.jp/seisaku/chosakuken/hokaisei/kantaiheiyo_chosakuken/1411890.html", v: 1, notes: ["jpwar"] },
    { id: "BR", term: 70, anon: 70,
      src: "https://www.planalto.gov.br/ccivil_03/leis/l9610.htm", v: 1, notes: [] },
    { id: "AR", term: 70, anon: 50,
      src: "https://servicios.infoleg.gob.ar/infolegInternet/anexos/40000-44999/42755/texact.htm", v: 1, notes: [] },
    { id: "MX", term: 100, anon: 100,
      old: [{ before: "1952-01-01", term: 50 }],
      src: "https://www.wipo.int/wipolex/en/legislation/details/21088", v: 0, notes: ["mxold"] },
    { id: "IN", term: 60, anon: 60,
      src: "https://future.indiankanoon.org/doc/366035", v: 1, notes: [] },
    { id: "CN", term: 50, anon: 50,
      src: "https://www.wipo.int/wipolex/en/legislation/details/21156", v: 0, notes: [] },
    { id: "ZA", term: 50, anon: 50,
      src: "https://www.saflii.org/za/legis/consol_act/ca1978133/", v: 1, notes: [] },
    { id: "NZ", term: 50, anon: 50,
      src: "https://www.nzlii.org/nz/legis/consol_act/ca1994133/s22.html", v: 1, notes: ["nz70"] }
  ];

  // ---------- 2. Texts ----------
  // Country names ("country.<id>"), statutes ("law.<id>") and notes
  // ("note.<id>"), shown by the app. Pack "pubdomain".
  var TEXT = {
    en: {
      "country.GR": "Greece",
      "law.GR": "Law 2121/1993, art. 29–31",
      "country.CY": "Cyprus",
      "law.CY": "Law 59/1976 as amended, s. 4",
      "country.DE": "Germany",
      "law.DE": "UrhG §§ 64–66",
      "country.FR": "France",
      "law.FR": "CPI L123-1, L123-3, L123-8 to L123-10",
      "country.IT": "Italy",
      "law.IT": "Law 633/1941, art. 25–27",
      "country.ES": "Spain",
      "law.ES": "TRLPI art. 26–27; transitional provision 4",
      "country.GB": "United Kingdom",
      "law.GB": "CDPA 1988, s. 12",
      "country.CH": "Switzerland",
      "law.CH": "URG art. 29–31",
      "country.TR": "Turkey",
      "law.TR": "Law 5846, art. 27",
      "country.RU": "Russia",
      "law.RU": "Civil Code art. 1281; Introductory Law art. 6",
      "country.US": "United States",
      "law.US": "17 U.S.C. §§ 302–304",
      "country.CA": "Canada",
      "law.CA": "Copyright Act, s. 6 (as amended 30 Dec 2022)",
      "country.AU": "Australia",
      "law.AU": "Copyright Act 1968, s. 33",
      "country.JP": "Japan",
      "law.JP": "Copyright Act, art. 51–52 (as amended 30 Dec 2018)",
      "country.BR": "Brazil",
      "law.BR": "Law 9.610/1998, art. 41",
      "country.AR": "Argentina",
      "law.AR": "Law 11.723, art. 5",
      "country.MX": "Mexico",
      "law.MX": "Federal Copyright Law, art. 29",
      "country.IN": "India",
      "law.IN": "Copyright Act 1957, s. 22–23",
      "country.CN": "China",
      "law.CN": "Copyright Law (2020), art. 23",
      "country.ZA": "South Africa",
      "law.ZA": "Copyright Act 1978, s. 3",
      "country.NZ": "New Zealand",
      "law.NZ": "Copyright Act 1994, s. 22",
      "note.official": "Official texts (laws, court rulings, administrative acts) are not protected at all.",
      "note.photo": "Simple photographs (not original works) get a shorter related right of 50 years from publication.",
      "note.frwar": "France adds wartime extensions for some works and 30 more years for authors who \"died for France\". Not counted here.",
      "note.uk2039": "Some works left unpublished at the author's death stay protected until the end of 2039.",
      "note.ruwar": "Authors who fought or worked in the Second World War get 4 more years; for authors rehabilitated after death the 70 years run from the rehabilitation. Not counted here.",
      "note.usform": "Before 1978 the US term runs from publication. A work published before 1989 without a copyright notice, or before 1964 without renewal, may already be free.",
      "note.jpwar": "Works by Allied nationals get a wartime extension of about 10 years. Not counted here.",
      "note.nz70": "New Zealand has committed to move to life + 70 by 2028; no law or start date yet.",
      "note.mxold": "Each extension (up to life + 100 in 2003) was not retroactive: authors who died before 1952 are free."
    },
    el: {
      "country.GR": "Ελλάδα",
      "law.GR": "Ν. 2121/1993, άρθρα 29–31",
      "country.CY": "Κύπρος",
      "law.CY": "Ν. 59/1976 όπως τροποποιήθηκε, άρθρο 4",
      "country.DE": "Γερμανία",
      "law.DE": "UrhG §§ 64–66",
      "country.FR": "Γαλλία",
      "law.FR": "CPI L123-1, L123-3, L123-8 έως L123-10",
      "country.IT": "Ιταλία",
      "law.IT": "Ν. 633/1941, άρθρα 25–27",
      "country.ES": "Ισπανία",
      "law.ES": "TRLPI άρθρα 26–27· μεταβατική διάταξη 4",
      "country.GB": "Ηνωμένο Βασίλειο",
      "law.GB": "CDPA 1988, άρθρο 12",
      "country.CH": "Ελβετία",
      "law.CH": "URG άρθρα 29–31",
      "country.TR": "Τουρκία",
      "law.TR": "Νόμος 5846, άρθρο 27",
      "country.RU": "Ρωσία",
      "law.RU": "Αστικός Κώδικας άρθρο 1281· εισαγωγικός νόμος άρθρο 6",
      "country.US": "ΗΠΑ",
      "law.US": "17 U.S.C. §§ 302–304",
      "country.CA": "Καναδάς",
      "law.CA": "Copyright Act, άρθρο 6 (τροπ. 30/12/2022)",
      "country.AU": "Αυστραλία",
      "law.AU": "Copyright Act 1968, άρθρο 33",
      "country.JP": "Ιαπωνία",
      "law.JP": "Νόμος πνευματικών δικαιωμάτων, άρθρα 51–52 (τροπ. 30/12/2018)",
      "country.BR": "Βραζιλία",
      "law.BR": "Νόμος 9.610/1998, άρθρο 41",
      "country.AR": "Αργεντινή",
      "law.AR": "Νόμος 11.723, άρθρο 5",
      "country.MX": "Μεξικό",
      "law.MX": "Ομοσπονδιακός νόμος, άρθρο 29",
      "country.IN": "Ινδία",
      "law.IN": "Copyright Act 1957, άρθρα 22–23",
      "country.CN": "Κίνα",
      "law.CN": "Νόμος πνευματικών δικαιωμάτων (2020), άρθρο 23",
      "country.ZA": "Νότια Αφρική",
      "law.ZA": "Copyright Act 1978, άρθρο 3",
      "country.NZ": "Νέα Ζηλανδία",
      "law.NZ": "Copyright Act 1994, άρθρο 22",
      "note.official": "Τα επίσημα κείμενα (νόμοι, δικαστικές αποφάσεις, διοικητικές πράξεις) δεν προστατεύονται καθόλου.",
      "note.photo": "Οι απλές φωτογραφίες (χωρίς πρωτοτυπία) έχουν μικρότερο συγγενικό δικαίωμα, 50 χρόνια από τη δημοσίευση.",
      "note.frwar": "Η Γαλλία προσθέτει πολεμικές παρατάσεις για ορισμένα έργα και 30 χρόνια για όσους «πέθαναν για τη Γαλλία». Δεν υπολογίζονται εδώ.",
      "note.uk2039": "Ορισμένα έργα αδημοσίευτα στον θάνατο του δημιουργού προστατεύονται έως το τέλος του 2039.",
      "note.ruwar": "Όσοι πολέμησαν ή εργάστηκαν στον Β' Παγκόσμιο Πόλεμο έχουν 4 χρόνια επιπλέον· για όσους αποκαταστάθηκαν μετά θάνατον, τα 70 χρόνια μετράνε από την αποκατάσταση. Δεν υπολογίζονται εδώ.",
      "note.usform": "Πριν το 1978 η διάρκεια στις ΗΠΑ μετράει από τη δημοσίευση. Έργο δημοσιευμένο πριν το 1989 χωρίς σημείωση ©, ή πριν το 1964 χωρίς ανανέωση, μπορεί να είναι ήδη ελεύθερο.",
      "note.jpwar": "Τα έργα πολιτών των Συμμάχων έχουν πολεμική παράταση περίπου 10 ετών. Δεν υπολογίζεται εδώ.",
      "note.nz70": "Η Νέα Ζηλανδία έχει δεσμευτεί να περάσει σε ζωή + 70 έως το 2028· δεν υπάρχει ακόμα νόμος ή ημερομηνία.",
      "note.mxold": "Καμία παράταση (έως ζωή + 100 το 2003) δεν ήταν αναδρομική: όσοι πέθαναν πριν το 1952 είναι ελεύθεροι."
    }
  };

  var BY_ID = {};
  var NOTES = {};
  COUNTRIES.forEach(function (c) { BY_ID[c.id] = c; c.n = {}; c.law = {}; });
  Object.keys(TEXT.en).forEach(function (k) { if (k.indexOf("note.") === 0) NOTES[k.slice(5)] = {}; });
  // Fills n / law / NOTES for one language from TEXT[code].
  function fill(code) {
    var t = TEXT[code] || TEXT.en;
    COUNTRIES.forEach(function (c) {
      c.n[code] = t["country." + c.id] || TEXT.en["country." + c.id];
      c.law[code] = t["law." + c.id] || TEXT.en["law." + c.id];
    });
    Object.keys(NOTES).forEach(function (id) { NOTES[id][code] = t["note." + id] || TEXT.en["note." + id]; });
  }
  fill("en"); fill("el");
  // A pack language (German…): TEXT[code] from the "pubdomain" pack.
  function useLang(code) {
    if (!code || code === "en" || code === "el") return;
    if (root.orosI18n) { try { root.orosI18n.table(TEXT, "pubdomain", code); } catch (e) {} }
    fill(code);
  }

  // ---------- 3. Dates ----------
  // A date is { y, m, d } with m / d = 0 when unknown. A known date
  // compares as itself; a year-only date is a whole year.
  function isYear(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v > -5000 && v < 10000; }

  function parseIso(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }

  // Is date `a` before ISO `iso`? true | false | null (cannot tell).
  function before(a, iso) {
    var b = parseIso(iso);
    if (a.y !== b.y) return a.y < b.y;
    if (b.m === 1 && b.d === 1) return false;          // same year, cutoff on 1 Jan
    if (!a.m) return null;                             // year only, cutoff inside it
    if (a.m !== b.m) return a.m < b.m;
    if (!a.d) return null;
    return a.d < b.d;
  }

  // ---------- 4. Engine ----------
  // input = {
  //   authors: [ { alive: bool, death: { y, m, d } | null, deathMax: { y, m, d } | null } ],
  //   anonymous: bool,          // anonymous or pseudonymous, identity unknown
  //   pub: year | null          // first publication
  // }
  // today = { y, m, d }
  // result = {
  //   status: "pd" | "protected" | "maybe" | "unknown",
  //   from: year | null,        // first public-domain year (1 Jan)
  //   fromMax: year | null,     // when the year is a range
  //   basis: "life" | "old" | "anon" | "uspub" | "alive",
  //   term: N, reason: id (for "unknown"), notes: [ids]
  // }

  // First PD year for one known death date in one country:
  // [{ year, basis, term }] (two entries when a cutoff falls inside
  // a year-only date).
  function deathYears(c, d) {
    var out = [];
    var olds = c.old || [];
    for (var i = 0; i < olds.length; i++) {
      var b = before(d, olds[i].before);
      if (b === true) return [{ year: d.y + olds[i].term + 1, basis: "old", term: olds[i].term }];
      if (b === null) out.push({ year: d.y + olds[i].term + 1, basis: "old", term: olds[i].term });
    }
    out.push({ year: d.y + c.term + 1, basis: "life", term: c.term });
    return out;
  }

  function verdict(years, today, basis, term, notes) {
    var lo = Math.min.apply(null, years), hi = Math.max.apply(null, years);
    var r = { status: "", from: lo, fromMax: hi !== lo ? hi : null, basis: basis, term: term, notes: notes };
    if (hi <= today.y) r.status = "pd";
    else if (lo > today.y) r.status = "protected";
    else r.status = "maybe";
    return r;
  }

  function unknown(reason, notes) {
    return { status: "unknown", from: null, fromMax: null, basis: null, term: null, reason: reason, notes: notes };
  }

  function compute(input, cid, today) {
    var c = BY_ID[cid];
    if (!c) return unknown("country", []);
    var notes = c.notes.slice();
    var pub = isYear(input && input.pub) ? input.pub : null;
    var authors = (input && input.authors) || [];

    // US works published before 1978 count from publication (95 years).
    if (c.us && pub !== null && pub < 1978) {
      return verdict([pub + 96], today, "uspub", 95, notes);
    }

    if (input && input.anonymous) {
      if (pub === null) return unknown("needPub", notes);
      return verdict([pub + c.anon + 1], today, "anon", c.anon, notes);
    }

    if (!authors.length) return unknown("needDeath", notes);
    if (authors.some(function (a) { return a && a.alive; })) {
      return { status: "protected", from: null, fromMax: null, basis: "alive", term: c.term, notes: notes };
    }

    // Joint work: the last author to die decides. Each author gives a
    // range (a cutoff inside a year-only date, an uncertain date); the
    // work's range runs from the max of the lows to the max of the highs.
    var lo = -Infinity, hi = -Infinity, top = null;
    for (var i = 0; i < authors.length; i++) {
      var a = authors[i];
      if (!a || !a.death || !isYear(a.death.y)) return unknown("needDeath", notes);
      var ends = [a.death];
      if (a.deathMax && isYear(a.deathMax.y)) ends.push(a.deathMax);
      var xs = [];
      ends.forEach(function (d) { xs = xs.concat(deathYears(c, d)); });
      var aLo = Infinity, aHi = -Infinity;
      xs.forEach(function (x) {
        if (x.year < aLo) aLo = x.year;
        if (x.year > aHi) { aHi = x.year; if (aHi >= hi) top = x; }
      });
      if (aLo > lo) lo = aLo;
      if (aHi > hi) hi = aHi;
    }
    // One clear rule when the range collapsed; else the general term.
    var basis = lo === hi ? top.basis : "life", term = lo === hi ? top.term : c.term;
    // US, publication year unknown: works published before 1978 count
    // from publication, so only a long-dead author gives a sure answer
    // (everything published in their lifetime is over 95 years old).
    if (c.us && pub === null) {
      var lastY = -Infinity;
      authors.forEach(function (a) {
        lastY = Math.max(lastY, a.death.y, a.deathMax && isYear(a.deathMax.y) ? a.deathMax.y : -Infinity);
      });
      if (lastY + 96 <= today.y) return verdict([lastY + 96], today, "usall", 95, notes);
      // Else it depends on the work: `from` is the year for works
      // published from 1978 on (life + 70).
      return { status: "maybe", from: lo, fromMax: hi !== lo ? hi : null, basis: "usdepends", term: c.term, notes: notes };
    }
    return verdict(lo === hi ? [lo] : [lo, hi], today, basis, term, notes);
  }

  root.orosPD = {
    VERSION: "1.0.0",
    COUNTRIES: COUNTRIES,
    NOTES: NOTES,
    TEXT: TEXT,
    useLang: useLang,
    country: function (id) { return BY_ID[id] || null; },
    compute: compute,
    before: before
  };
})(typeof window !== "undefined" ? window : globalThis);
