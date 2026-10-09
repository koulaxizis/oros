// ============================================================
// orOS Public Domain Calculator — App logic (v1.0.0)
// "Is this work free to use in my country?"
//   - look up an author or a work on Wikidata (online): dates of
//     birth / death, publication year, the creators of a work
//   - or enter the dates by hand (always works offline)
//   - status in "my country" (default Greece) and in 20 more, with
//     the rule, the statute and its source (rules.js, offline)
// Network: www.wikidata.org/w/api.php (anonymous CORS, origin=*).
//   Nothing from the API is ever parsed as HTML: text goes through
//   textContent, Wikipedia links are built from a fixed host.
// Data (device-local only, R10; no sync slice):
//   - oros-pubdomain-prefs  { home, sort, manual }
//   - oros-pubdomain-recent [ { id, label, desc } ] newest first, ≤ 10
// Sections:
//   1. Constants, i18n, helpers
//   2. Wikidata: requests
//   3. Wikidata: parsing (pure)
//   4. Subjects → engine input
//   5. Storage: prefs + recents
//   6. Search flow
//   7. Manual entry
//   8. Result rendering
//   9. Toasts
//  10. Keyboard (Contract Β)
//  11. Palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var PREFS_KEY   = "oros-pubdomain-prefs";
  var RECENT_KEY  = "oros-pubdomain-recent";
  var MAX_RECENT  = 10;
  var API         = "https://www.wikidata.org/w/api.php";
  var TIMEOUT_MS  = 12000;
  var DEBOUNCE_MS = 350;
  var LABEL_LEN   = 200;
  var DESC_LEN    = 300;
  var MAX_CREATORS = 8;
  var MAX_AUTHORS = 8;
  var ALIVE_YEARS = 110;            // no death date + born later than this → living
  var PD = window.orosPD;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "title": "Public Domain Calculator", "subtitle": "Copyright status by country",
      "search.ph": "Author or work, e.g. Kazantzakis",
      "search.loading": "Searching Wikidata…", "search.none": "Nothing found on Wikidata.",
      "search.offline": "You are offline. Enter the dates yourself with the pencil button.",
      "search.error": "Wikidata did not answer. Try again, or enter the dates yourself.",
      "search.loadingItem": "Reading dates from Wikidata…",
      "search.notWork": "This is neither a person nor a creative work with known creators.",
      "recent": "Recent", "recent.clear": "Clear",
      "btn.manual": "Enter dates yourself",
      "manual.title": "Enter the dates yourself",
      "kind.one": "One author", "kind.joint": "Several authors", "kind.anon": "Anonymous",
      "manual.death": "Year of death", "manual.alive": "Still alive", "manual.author": "Author {n}",
      "manual.add": "+ Add author", "manual.remove": "Remove author {n}",
      "manual.pub": "Year of first publication (optional)",
      "manual.pubAnon": "Year of first publication",
      "manual.film": "For a film, add the director, the screenwriter, the dialogue writer and the composer of its music: the last of them to die counts.",
      "manual.subject": "Your dates",
      "others": "In other countries", "sort.az": "A–Z", "sort.free": "Free first",
      "home.country": "My country",
      "empty": "Search for an author or a work to see when it enters the public domain, in Greece and in 20 more countries. With no connection, enter the dates yourself.",
      "disclaimer": "Information, not legal advice. The result is about the original work: translations, new editions with notes, arrangements, recordings and photographs of a work have rights of their own.",
      "st.pd": "Public domain", "st.protected": "Protected", "st.maybe": "Possibly free", "st.unknown": "Cannot tell",
      "since": "since {d}", "until": "until {d}", "inYears": "free in {n} years", "inYear1": "free next year",
      "between": "free from {a} or {b}: the exact date decides",
      "alive": "The author is alive: free {n} years after their death",
      "usdepends": "Depends on the work: published before {y0} free; {y1}–1977, 95 years from publication; from 1978, free on {d}",
      "why.needDeath": "The date of death is missing.",
      "why.needPub": "An anonymous work counts from its publication year, which is missing.",
      "why.country": "Unknown country.",
      "rule.life": "Rule: {n} years after death", "rule.old": "Rule: {n} years after death (an extension that is not retroactive)",
      "rule.anon": "Rule: {n} years from publication (anonymous work)",
      "rule.uspub": "Rule: 95 years from publication (published before 1978)",
      "rule.usall": "Rule: everything published in the author's lifetime is over 95 years old",
      "rule.usdepends": "Rule: by publication year before 1978, else {n} years after death",
      "rule.alive": "Rule: {n} years after death",
      "source": "Source", "unverified": "This rule has not yet been checked at its source.",
      "born": "b. {y}", "died": "d. {y}", "living": "living", "deathUnknown": "date of death unknown",
      "by": "by {names}", "published": "published {y}",
      "prec.decade": "Wikidata gives only the decade of death ({a}–{b}).",
      "prec.many": "Wikidata gives more than one date of death ({a} – {b}).",
      "noDeath": "Wikidata lists no date of death.",
      "wiki": "Wikipedia", "wikidata": "Wikidata",
      "toast.clear": "Recent searches cleared"
    },
    el: {
      "title": "Υπολογιστής Κοινού Κτήματος", "subtitle": "Πνευματικά δικαιώματα ανά χώρα",
      "search.ph": "Δημιουργός ή έργο, π.χ. Καζαντζάκης",
      "search.loading": "Αναζήτηση στη Wikidata…", "search.none": "Δεν βρέθηκε τίποτα στη Wikidata.",
      "search.offline": "Είσαι εκτός σύνδεσης. Βάλε τις χρονιές με το χέρι από το μολύβι.",
      "search.error": "Η Wikidata δεν απάντησε. Δοκίμασε ξανά ή βάλε τις χρονιές με το χέρι.",
      "search.loadingItem": "Διαβάζω ημερομηνίες από τη Wikidata…",
      "search.notWork": "Δεν είναι ούτε πρόσωπο ούτε έργο με γνωστούς δημιουργούς.",
      "recent": "Πρόσφατα", "recent.clear": "Καθαρισμός",
      "btn.manual": "Χρονιές με το χέρι",
      "manual.title": "Βάλε τις χρονιές με το χέρι",
      "kind.one": "Ένας δημιουργός", "kind.joint": "Πολλοί δημιουργοί", "kind.anon": "Ανώνυμο",
      "manual.death": "Χρονιά θανάτου", "manual.alive": "Ζει ακόμα", "manual.author": "Δημιουργός {n}",
      "manual.add": "+ Προσθήκη δημιουργού", "manual.remove": "Αφαίρεση δημιουργού {n}",
      "manual.pub": "Χρονιά πρώτης δημοσίευσης (προαιρετικά)",
      "manual.pubAnon": "Χρονιά πρώτης δημοσίευσης",
      "manual.film": "Για ταινία, πρόσθεσε σκηνοθέτη, σεναριογράφο, διαλογογράφο και συνθέτη της μουσικής: μετράει όποιος πέθανε τελευταίος.",
      "manual.subject": "Οι χρονιές σου",
      "others": "Σε άλλες χώρες", "sort.az": "Α–Ω", "sort.free": "Πρώτα τα ελεύθερα",
      "home.country": "Η χώρα μου",
      "empty": "Ψάξε έναν δημιουργό ή ένα έργο για να δεις πότε γίνεται κοινό κτήμα, στην Ελλάδα και σε 20 ακόμα χώρες. Χωρίς σύνδεση, βάλε τις χρονιές με το χέρι.",
      "disclaimer": "Πληροφορία, όχι νομική συμβουλή. Το αποτέλεσμα αφορά το πρωτότυπο έργο: μεταφράσεις, νέες εκδόσεις με σχόλια, διασκευές, ηχογραφήσεις και φωτογραφίες ενός έργου έχουν δικά τους δικαιώματα.",
      "st.pd": "Κοινό κτήμα", "st.protected": "Προστατεύεται", "st.maybe": "Ίσως ελεύθερο", "st.unknown": "Δεν υπολογίζεται",
      "since": "από {d}", "until": "έως {d}", "inYears": "ελεύθερο σε {n} χρόνια", "inYear1": "ελεύθερο του χρόνου",
      "between": "ελεύθερο από {a} ή {b}: κρίνει η ακριβής ημερομηνία",
      "alive": "Ο δημιουργός ζει: ελεύθερο {n} χρόνια μετά τον θάνατό του",
      "usdepends": "Εξαρτάται από το έργο: δημοσίευση πριν το {y0} ελεύθερο· {y1}–1977, 95 χρόνια από τη δημοσίευση· από το 1978, ελεύθερο στις {d}",
      "why.needDeath": "Λείπει η ημερομηνία θανάτου.",
      "why.needPub": "Το ανώνυμο έργο μετράει από τη χρονιά δημοσίευσης, που λείπει.",
      "why.country": "Άγνωστη χώρα.",
      "rule.life": "Κανόνας: {n} χρόνια μετά τον θάνατο", "rule.old": "Κανόνας: {n} χρόνια μετά τον θάνατο (παράταση που δεν είναι αναδρομική)",
      "rule.anon": "Κανόνας: {n} χρόνια από τη δημοσίευση (ανώνυμο έργο)",
      "rule.uspub": "Κανόνας: 95 χρόνια από τη δημοσίευση (έργα πριν το 1978)",
      "rule.usall": "Κανόνας: ό,τι δημοσιεύτηκε όσο ζούσε ο δημιουργός είναι πάνω από 95 ετών",
      "rule.usdepends": "Κανόνας: πριν το 1978 μετράει η δημοσίευση, αλλιώς {n} χρόνια μετά τον θάνατο",
      "rule.alive": "Κανόνας: {n} χρόνια μετά τον θάνατο",
      "source": "Πηγή", "unverified": "Ο κανόνας δεν έχει ελεγχθεί ακόμα στην πηγή του.",
      "born": "γ. {y}", "died": "π. {y}", "living": "ζει", "deathUnknown": "άγνωστη ημερομηνία θανάτου",
      "by": "των {names}", "published": "δημοσίευση {y}",
      "prec.decade": "Η Wikidata δίνει μόνο τη δεκαετία θανάτου ({a}–{b}).",
      "prec.many": "Η Wikidata δίνει περισσότερες από μία ημερομηνίες θανάτου ({a} – {b}).",
      "noDeath": "Η Wikidata δεν έχει ημερομηνία θανάτου.",
      "wiki": "Wikipedia", "wikidata": "Wikidata",
      "toast.clear": "Τα πρόσφατα καθαρίστηκαν"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function clip(s, n) {
    s = typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() : "";
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function todayDate() { var d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; }
  var MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtJan1(y) { return LANG === "el" ? "01/01/" + y : "1 Jan " + y; }
  function fmtDec31(y) { return LANG === "el" ? "31/12/" + y : "31 Dec " + y; }
  function yearText(y) { return y < 0 ? (-y) + (LANG === "el" ? " π.Χ." : " BC") : String(y); }
  function cmpName(a, b) { return a.localeCompare(b, LANG === "el" ? "el" : "en"); }
  function isYear(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v > -5000 && v < 10000; }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("pubdomain.js v" + (m ? m[1] : "?") + " boot");
  })();

  var UI = {
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>'
  };

  // ---------- 2. Wikidata: requests ----------
  // One flight per stage; a newer request aborts the older one, and a
  // sequence number drops any answer that still arrives late.
  var flights = { search: null, item: null };
  var seq = { search: 0, item: 0 };

  function apiGet(stage, params) {
    if (flights[stage]) { try { flights[stage].abort(); } catch (e) {} }
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    flights[stage] = ctl;
    var q = ["format=json", "origin=*"];
    Object.keys(params).forEach(function (k) {
      q.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
    });
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
    return fetch(API + "?" + q.join("&"), {
      signal: ctl ? ctl.signal : undefined,
      credentials: "omit",
      referrerPolicy: "no-referrer"
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || typeof j !== "object" || j.error) throw new Error("api");
      return j;
    }).finally(function () {
      clearTimeout(timer);
      if (flights[stage] === ctl) flights[stage] = null;
    });
  }

  function hasGreek(s) { return /[Ͱ-Ͽἀ-῿]/.test(s); }

  function searchEntities(q) {
    return apiGet("search", {
      action: "wbsearchentities", search: q, type: "item", limit: "8",
      language: hasGreek(q) ? "el" : "en", uselang: LANG
    }).then(function (j) { return parseSearch(j); });
  }

  function getEntities(ids) {
    return apiGet("item", {
      action: "wbgetentities", ids: ids.join("|"),
      props: "labels|descriptions|claims|sitelinks",
      languages: "el|en", sitefilter: "elwiki|enwiki"
    }).then(function (j) { return (j && j.entities && typeof j.entities === "object") ? j.entities : {}; });
  }

  // ---------- 3. Wikidata: parsing (pure) ----------
  var QID = /^Q[1-9]\d{0,11}$/;
  var HUMAN = "Q5";
  var CREATOR_PROPS = ["P50", "P170", "P86", "P57", "P58", "P87", "P676"];

  function parseSearch(j) {
    var out = [];
    var list = j && Array.isArray(j.search) ? j.search : [];
    list.forEach(function (r) {
      if (!r || typeof r.id !== "string" || !QID.test(r.id)) return;
      var label = clip(r.label || (r.display && r.display.label && r.display.label.value) || "", LABEL_LEN);
      var desc = clip(r.description || (r.display && r.display.description && r.display.description.value) || "", DESC_LEN);
      out.push({ id: r.id, label: label || r.id, desc: desc });
    });
    return out;
  }

  function langText(map) {
    if (!map || typeof map !== "object") return "";
    var order = LANG === "el" ? ["el", "en"] : ["en", "el"];
    for (var i = 0; i < order.length; i++) {
      var v = map[order[i]];
      if (v && typeof v.value === "string" && v.value) return v.value;
    }
    return "";
  }

  // Statements of one property, rank-filtered: deprecated never counts;
  // when any is "preferred", only the preferred ones count.
  function statements(ent, prop) {
    var list = ent && ent.claims && Array.isArray(ent.claims[prop]) ? ent.claims[prop] : [];
    list = list.filter(function (c) { return c && c.mainsnak && c.rank !== "deprecated"; });
    var pref = list.filter(function (c) { return c.rank === "preferred"; });
    return pref.length ? pref : list;
  }

  // Wikidata time → { y, m, d, prec } or null. "+1957-10-26T00:00:00Z",
  // precision 11 = day, 10 = month, 9 = year, 8 = decade, ≤ 7 vaguer.
  function parseTime(v) {
    if (!v || typeof v.time !== "string") return null;
    var m = /^([+-])(\d{1,16})-(\d{2})-(\d{2})T/.exec(v.time);
    if (!m) return null;
    var y = parseInt(m[2], 10) * (m[1] === "-" ? -1 : 1);
    if (!isYear(y)) return null;
    var prec = typeof v.precision === "number" ? v.precision : 9;
    return {
      y: y,
      m: prec >= 10 ? parseInt(m[3], 10) || 0 : 0,
      d: prec >= 11 ? parseInt(m[4], 10) || 0 : 0,
      prec: prec
    };
  }

  function cmpDate(a, b) { return (a.y - b.y) || (a.m - b.m) || (a.d - b.d); }

  // Dates of one time property: { state, min, max, decade, many }.
  // state: "none" (no statement), "unknown" (only "unknown value" or a
  // date vaguer than a decade), "known".
  function timeOf(ent, prop) {
    var st = statements(ent, prop);
    if (!st.length) return { state: "none" };
    var dates = [], vague = false;
    st.forEach(function (c) {
      var s = c.mainsnak;
      if (s.snaktype !== "value" || !s.datavalue) { vague = true; return; }
      var d = parseTime(s.datavalue.value);
      if (!d || d.prec < 8) { vague = true; return; }
      if (d.prec === 8) {
        var y0 = Math.floor(d.y / 10) * 10;
        dates.push({ y: y0, m: 0, d: 0, decade: true });
        dates.push({ y: y0 + 9, m: 0, d: 0, decade: true });
      } else {
        dates.push({ y: d.y, m: d.m, d: d.d });
      }
    });
    if (!dates.length) return { state: vague ? "unknown" : "none" };
    dates.sort(cmpDate);
    var min = dates[0], max = dates[dates.length - 1];
    return {
      state: "known", min: { y: min.y, m: min.m, d: min.d }, max: { y: max.y, m: max.m, d: max.d },
      decade: dates.some(function (x) { return x.decade; }),
      many: st.length > 1 && cmpDate(min, max) !== 0
    };
  }

  function entityIds(ent, prop) {
    var out = [];
    statements(ent, prop).forEach(function (c) {
      var s = c.mainsnak, v = s && s.datavalue && s.datavalue.value;
      if (s.snaktype === "value" && v && typeof v.id === "string" && QID.test(v.id) && out.indexOf(v.id) < 0) out.push(v.id);
    });
    return out;
  }

  function wikiLink(ent) {
    var sl = ent && ent.sitelinks;
    if (!sl || typeof sl !== "object") return null;
    var order = LANG === "el" ? ["el", "en"] : ["en", "el"];
    for (var i = 0; i < order.length; i++) {
      var s = sl[order[i] + "wiki"];
      if (s && typeof s.title === "string" && s.title && s.title.length < 300) {
        return "https://" + order[i] + ".wikipedia.org/wiki/" +
          encodeURIComponent(s.title.replace(/ /g, "_"));
      }
    }
    return null;
  }

  // A person: { kind: "person", id, name, desc, born, death, alive, wiki }.
  function personFrom(ent, today) {
    var born = timeOf(ent, "P569"), death = timeOf(ent, "P570");
    var bornY = born.state === "known" ? born.min.y : null;
    var alive = death.state === "none" && bornY !== null && bornY > today.y - ALIVE_YEARS;
    return {
      kind: "person", id: ent.id, name: clip(langText(ent.labels), LABEL_LEN) || ent.id,
      desc: clip(langText(ent.descriptions), DESC_LEN), bornY: bornY,
      death: death, alive: alive, wiki: wikiLink(ent)
    };
  }

  function isHuman(ent) { return entityIds(ent, "P31").indexOf(HUMAN) >= 0; }

  function creatorIds(ent) {
    var out = [];
    CREATOR_PROPS.forEach(function (p) {
      entityIds(ent, p).forEach(function (id) { if (out.indexOf(id) < 0 && id !== ent.id) out.push(id); });
    });
    return out.slice(0, MAX_CREATORS);
  }

  // A work: { kind: "work", id, name, desc, pub, creators: [person], wiki }.
  function workFrom(ent, creatorEnts, today) {
    var pub = timeOf(ent, "P577");
    var creators = [];
    creatorIds(ent).forEach(function (id) {
      var c = creatorEnts[id];
      if (c && !c.missing && c.id === id) creators.push(personFrom(c, today));
    });
    return {
      kind: "work", id: ent.id, name: clip(langText(ent.labels), LABEL_LEN) || ent.id,
      desc: clip(langText(ent.descriptions), DESC_LEN),
      pub: pub.state === "known" ? pub.min.y : null,
      creators: creators, wiki: wikiLink(ent)
    };
  }

  // ---------- 4. Subjects → engine input ----------
  function authorInput(p) {
    if (p.alive) return { alive: true };
    if (p.death.state !== "known") return { death: null };
    var same = cmpDate(p.death.min, p.death.max) === 0;
    return { death: p.death.min, deathMax: same ? null : p.death.max };
  }

  function inputOf(subject) {
    if (subject.kind === "person") return { authors: [authorInput(subject)], anonymous: false, pub: null };
    if (subject.kind === "work") {
      return { authors: subject.creators.map(authorInput), anonymous: false, pub: subject.pub };
    }
    return subject.input;                      // manual
  }

  // ---------- 5. Storage: prefs + recents ----------
  var prefs = { home: "GR", sort: "az", manual: 0 };
  var recents = [];

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (typeof p.home === "string" && PD.country(p.home)) prefs.home = p.home;
        if (p.sort === "az" || p.sort === "free") prefs.sort = p.sort;
        prefs.manual = p.manual ? 1 : 0;
      }
    } catch (e) {}
    try {
      var r = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      if (Array.isArray(r)) {
        recents = r.filter(function (x) {
          return x && typeof x.id === "string" && QID.test(x.id) && typeof x.label === "string";
        }).slice(0, MAX_RECENT).map(function (x) {
          return { id: x.id, label: clip(x.label, LABEL_LEN), desc: clip(x.desc || "", DESC_LEN) };
        });
      }
    } catch (e) { recents = []; }
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }
  function saveRecents() { try { localStorage.setItem(RECENT_KEY, JSON.stringify(recents)); } catch (e) {} }

  function addRecent(item) {
    recents = recents.filter(function (x) { return x.id !== item.id; });
    recents.unshift({ id: item.id, label: item.label, desc: item.desc || "" });
    if (recents.length > MAX_RECENT) recents.length = MAX_RECENT;
    saveRecents();
  }

  // ---------- 6. Search flow ----------
  var subject = null;          // what the result shows
  var searchTimer = null;

  function online() { return navigator.onLine !== false; }

  function setMsg(text) {
    var m = $("search-msg");
    m.textContent = text || "";
    m.hidden = !text;
  }

  function onQuery() {
    clearTimeout(searchTimer);
    var q = $("q").value.trim();
    if (q.length < 2) {
      seq.search++;
      if (flights.search) { try { flights.search.abort(); } catch (e) {} }
      $("results").hidden = true;
      setMsg("");
      renderRecents();
      return;
    }
    $("recents").hidden = true;
    searchTimer = setTimeout(function () { runSearch(q); }, DEBOUNCE_MS);
  }

  function runSearch(q) {
    if (!online()) { setMsg(t("search.offline")); $("results").hidden = true; return; }
    var my = ++seq.search;
    setMsg(t("search.loading"));
    searchEntities(q).then(function (list) {
      if (my !== seq.search) return;
      renderResults(list);
      setMsg(list.length ? "" : t("search.none"));
    }).catch(function (e) {
      if (my !== seq.search) return;
      $("results").hidden = true;
      setMsg(online() ? t("search.error") : t("search.offline"));
    });
  }

  function renderResults(list) {
    var ul = $("results");
    ul.innerHTML = "";
    list.forEach(function (r) {
      var li = el("li");
      var b = el("button", "result");
      b.type = "button";
      b.appendChild(el("span", "r-label", r.label));
      if (r.desc) b.appendChild(el("span", "r-desc", r.desc));
      b.addEventListener("click", function () { pick(r); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    ul.hidden = !list.length;
  }

  function renderRecents() {
    var box = $("recents"), list = $("recents-list");
    list.innerHTML = "";
    recents.forEach(function (r) {
      var b = el("button", "chip", r.label);
      b.type = "button";
      if (r.desc) b.title = r.desc;
      b.addEventListener("click", function () { pick(r); });
      list.appendChild(b);
    });
    box.hidden = !recents.length || $("q").value.trim().length >= 2;
  }

  function pick(r) {
    if (!online()) { setMsg(t("search.offline")); return; }
    var my = ++seq.item;
    seq.search++;
    $("results").hidden = true;
    $("recents").hidden = true;
    setMsg(t("search.loadingItem"));
    var today = todayDate();
    getEntities([r.id]).then(function (ents) {
      if (my !== seq.item) return null;
      var ent = ents[r.id];
      if (!ent || ent.missing !== undefined || ent.id !== r.id) throw new Error("missing");
      if (isHuman(ent)) return personFrom(ent, today);
      var ids = creatorIds(ent);
      if (!ids.length) return { kind: "none" };
      return getEntities(ids).then(function (cents) {
        if (my !== seq.item) return null;
        return workFrom(ent, cents, today);
      });
    }).then(function (s) {
      if (!s || my !== seq.item) return;
      if (s.kind === "none" || (s.kind === "work" && !s.creators.length)) {
        setMsg(t("search.notWork"));
        renderRecents();
        return;
      }
      setMsg("");
      addRecent(r);
      $("q").value = "";
      renderRecents();
      showSubject(s);
    }).catch(function () {
      if (my !== seq.item) return;
      setMsg(online() ? t("search.error") : t("search.offline"));
    });
  }

  // ---------- 7. Manual entry ----------
  var manual = { kind: "one", authors: [{ y: "", alive: false }], pub: "" };

  function buildKinds() {
    var box = $("kinds");
    box.innerHTML = "";
    ["one", "joint", "anon"].forEach(function (k) {
      var b = el("button", "chip", t("kind." + k));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.kind = k;
      b.addEventListener("click", function () {
        manual.kind = k;
        if (k === "one") manual.authors = manual.authors.slice(0, 1);
        if (k === "joint" && manual.authors.length < 2) manual.authors.push({ y: "", alive: false });
        buildAuthors();
        manualChanged();
      });
      box.appendChild(b);
    });
  }

  function buildAuthors() {
    var box = $("authors");
    box.innerHTML = "";
    var anon = manual.kind === "anon";
    [].forEach.call($("kinds").children, function (b) {
      var on = b.dataset.kind === manual.kind;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    box.hidden = anon;
    $("add-author").hidden = manual.kind !== "joint" || manual.authors.length >= MAX_AUTHORS;
    $("joint-hint").hidden = manual.kind !== "joint";
    $("pub").previousElementSibling.textContent = t(anon ? "manual.pubAnon" : "manual.pub");
    if (anon) return;
    manual.authors.forEach(function (a, i) {
      var row = el("div", "author-row");
      var lab = el("label", "field");
      lab.appendChild(el("span", "", manual.kind === "joint" ? t("manual.author", { n: i + 1 }) + " · " + t("manual.death") : t("manual.death")));
      var inp = el("input");
      inp.type = "number"; inp.inputMode = "numeric"; inp.min = "1"; inp.max = "9999"; inp.step = "1";
      inp.value = a.y;
      inp.disabled = a.alive;
      inp.addEventListener("input", function () { a.y = inp.value; manualChanged(); });
      lab.appendChild(inp);
      row.appendChild(lab);
      var chk = el("label", "check");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = a.alive;
      cb.addEventListener("change", function () { a.alive = cb.checked; inp.disabled = a.alive; manualChanged(); });
      chk.appendChild(cb);
      chk.appendChild(el("span", "", t("manual.alive")));
      row.appendChild(chk);
      if (manual.kind === "joint" && manual.authors.length > 2) {
        var rm = el("button", "icon-btn small");
        rm.type = "button";
        rm.innerHTML = UI.close;
        rm.setAttribute("aria-label", t("manual.remove", { n: i + 1 }));
        rm.title = t("manual.remove", { n: i + 1 });
        rm.addEventListener("click", function () {
          manual.authors.splice(i, 1);
          buildAuthors();
          manualChanged();
        });
        row.appendChild(rm);
      }
      box.appendChild(row);
    });
  }

  function intOrNull(v) {
    if (v === "" || v === null || v === undefined) return null;
    var n = Number(v);
    return isYear(n) && n > 0 ? n : null;
  }

  // Manual form → subject (null until there is something to compute).
  function manualSubject() {
    var pub = intOrNull(manual.pub);
    var input = { authors: [], anonymous: manual.kind === "anon", pub: pub };
    var touched = pub !== null;
    if (!input.anonymous) {
      manual.authors.forEach(function (a) {
        var y = intOrNull(a.y);
        if (a.alive || y !== null) touched = true;
        input.authors.push(a.alive ? { alive: true } : { death: y !== null ? { y: y, m: 0, d: 0 } : null });
      });
    }
    if (!touched) return null;
    return { kind: "manual", name: t("manual.subject"), input: input };
  }

  function manualChanged() {
    var s = manualSubject();
    if (s) showSubject(s);
    else if (subject && subject.kind === "manual") showSubject(null);
  }

  function toggleManual(on) {
    prefs.manual = on ? 1 : 0;
    savePrefs();
    $("manual").hidden = !on;
    var b = $("manual-btn");
    b.classList.toggle("on", !!on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) {
      buildAuthors();
      manualChanged();
    } else if (subject && subject.kind === "manual") {
      showSubject(null);
    }
  }

  // ---------- 8. Result rendering ----------
  function showSubject(s) {
    subject = s;
    render();
    if (s) live(s.name);
  }

  function render() {
    var has = !!subject;
    $("result").hidden = !has;
    $("empty").hidden = has;
    if (!has) return;
    renderSubject();
    renderHome();
    renderOthers();
  }

  function lifeText(p) {
    var parts = [];
    if (p.bornY !== null && p.bornY !== undefined) parts.push(t("born", { y: yearText(p.bornY) }));
    if (p.alive) parts.push(t("living"));
    else if (p.death.state === "known") {
      var a = p.death.min.y, b = p.death.max.y;
      parts.push(t("died", { y: a === b ? yearText(a) : yearText(a) + "–" + yearText(b) }));
    } else if (p.death.state === "unknown") parts.push(t("deathUnknown"));
    return parts.join(" · ");
  }

  function deathWarnings(p, out) {
    if (p.alive) return;
    if (p.death.state === "none") { out.push(p.name + ": " + t("noDeath")); return; }
    if (p.death.state !== "known") return;
    var a = yearText(p.death.min.y), b = yearText(p.death.max.y);
    if (p.death.decade) out.push(p.name + ": " + t("prec.decade", { a: a, b: b }));
    else if (p.death.many) out.push(p.name + ": " + t("prec.many", { a: a, b: b }));
  }

  function linkRow(urls) {
    var row = el("div", "links");
    urls.forEach(function (u) {
      if (!u.href) return;
      var a = el("a", "ext", u.text);
      a.href = u.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      row.appendChild(a);
    });
    return row;
  }

  function renderSubject() {
    var box = $("subject"), s = subject;
    box.innerHTML = "";
    box.appendChild(el("div", "s-name", s.name));
    var warns = [];
    if (s.kind === "person") {
      var lt = lifeText(s);
      if (lt) box.appendChild(el("div", "s-life", lt));
      if (s.desc) box.appendChild(el("div", "s-desc", s.desc));
      deathWarnings(s, warns);
    } else if (s.kind === "work") {
      var meta = [];
      if (s.creators.length) meta.push(t("by", { names: s.creators.map(function (c) { return c.name; }).join(", ") }));
      if (s.pub !== null) meta.push(t("published", { y: yearText(s.pub) }));
      if (meta.length) box.appendChild(el("div", "s-life", meta.join(" · ")));
      if (s.desc) box.appendChild(el("div", "s-desc", s.desc));
      if (s.creators.length) {
        var ul = el("ul", "creators");
        s.creators.forEach(function (c) {
          var li = el("li");
          li.appendChild(el("span", "c-name", c.name));
          var lt2 = lifeText(c);
          if (lt2) li.appendChild(el("span", "c-life", lt2));
          ul.appendChild(li);
          deathWarnings(c, warns);
        });
        box.appendChild(ul);
      }
    }
    warns.forEach(function (w) { box.appendChild(el("p", "warn", w)); });
    if (s.kind !== "manual") {
      box.appendChild(linkRow([
        { text: t("wiki"), href: s.wiki },
        { text: t("wikidata"), href: "https://www.wikidata.org/wiki/" + (QID.test(s.id) ? s.id : "") }
      ]));
    }
  }

  function statusLine(r) {
    var today = todayDate();
    switch (r.status) {
      case "pd":
        return r.basis === "usall" ? "" : t("since", { d: fmtJan1(r.from) });
      case "protected":
        if (r.basis === "alive") return t("alive", { n: r.term });
        var n = r.from - today.y;
        return t("until", { d: fmtDec31(r.from - 1) }) + " · " + (n === 1 ? t("inYear1") : t("inYears", { n: n }));
      case "maybe":
        if (r.basis === "usdepends") {
          return t("usdepends", { y0: today.y - 95, y1: today.y - 95, d: fmtJan1(r.from) + (r.fromMax ? "–" + r.fromMax : "") });
        }
        return t("between", { a: r.from, b: r.fromMax });
      default:
        return t("why." + (r.reason || "needDeath"));
    }
  }

  function ruleLine(r) {
    if (!r.basis) return "";
    return t("rule." + r.basis, { n: r.term });
  }

  var STATUS_ICON = { pd: "✓", protected: "©", maybe: "?", unknown: "–" };

  function pill(status) {
    var p = el("span", "pill " + status);
    p.appendChild(el("span", "pill-ic", STATUS_ICON[status]));
    p.appendChild(el("span", "", t("st." + status)));
    return p;
  }

  function detailBlock(c, r) {
    var box = el("div", "detail");
    var rl = ruleLine(r);
    if (rl) box.appendChild(el("div", "rule", rl));
    box.appendChild(el("div", "law", c.law[LANG] || c.law.en));
    r.notes.forEach(function (id) {
      var n = PD.NOTES[id];
      if (n) box.appendChild(el("p", "note", n[LANG] || n.en));
    });
    if (!c.v) box.appendChild(el("p", "note caution", t("unverified")));
    box.appendChild(linkRow([{ text: t("source"), href: /^https:\/\//.test(c.src) ? c.src : null }]));
    return box;
  }

  function renderHome() {
    var box = $("home");
    box.innerHTML = "";
    var c = PD.country(prefs.home);
    var r = PD.compute(inputOf(subject), c.id, todayDate());
    var head = el("div", "home-head");
    var lab = el("label", "home-sel");
    lab.appendChild(el("span", "sec-lbl", t("home.country")));
    var sel = el("select");
    // Greece first, then A–Z
    sortedCountries("az").sort(function (a, b) { return (b.id === "GR") - (a.id === "GR"); }).forEach(function (x) {
      var o = el("option", "", x.n[LANG] || x.n.en);
      o.value = x.id;
      if (x.id === c.id) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      prefs.home = sel.value;
      savePrefs();
      render();
      var s = $("home").querySelector("select");
      if (s) s.focus();
    });
    lab.appendChild(sel);
    head.appendChild(lab);
    box.appendChild(head);
    box.className = "card home st-" + r.status;
    var big = el("div", "home-status");
    big.appendChild(pill(r.status));
    var line = statusLine(r);
    if (line) big.appendChild(el("div", "home-line", line));
    box.appendChild(big);
    box.appendChild(detailBlock(c, r));
  }

  function sortedCountries(mode, results) {
    var list = PD.COUNTRIES.slice();
    var rank = { pd: 0, maybe: 1, protected: 2, unknown: 3 };
    list.sort(function (a, b) {
      if (mode === "free" && results) {
        var d = rank[results[a.id].status] - rank[results[b.id].status];
        if (d) return d;
      }
      return cmpName(a.n[LANG] || a.n.en, b.n[LANG] || b.n.en);
    });
    return list;
  }

  function buildSorts() {
    var box = $("sorts");
    box.innerHTML = "";
    ["az", "free"].forEach(function (k) {
      var b = el("button", "chip", t("sort." + k));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.sort = k;
      b.addEventListener("click", function () {
        prefs.sort = k;
        savePrefs();
        renderOthers();
      });
      box.appendChild(b);
    });
  }

  function renderOthers() {
    [].forEach.call($("sorts").children, function (b) {
      var on = b.dataset.sort === prefs.sort;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    var input = inputOf(subject), today = todayDate(), results = {};
    PD.COUNTRIES.forEach(function (c) { results[c.id] = PD.compute(input, c.id, today); });
    var ul = $("others");
    ul.innerHTML = "";
    sortedCountries(prefs.sort, results).forEach(function (c) {
      if (c.id === prefs.home) return;
      var r = results[c.id];
      var li = el("li");
      var det = el("details", "row st-" + r.status);
      var sum = el("summary");
      sum.appendChild(el("span", "cc", c.id));
      sum.appendChild(el("span", "cn", c.n[LANG] || c.n.en));
      sum.appendChild(pill(r.status));
      det.appendChild(sum);
      var line = statusLine(r);
      if (line) det.appendChild(el("div", "row-line", line));
      det.appendChild(detailBlock(c, r));
      li.appendChild(det);
      ul.appendChild(li);
    });
  }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "pubdomain", title: String(text) })) return;
    } catch (e) {}
    var box = $("toast");
    if (!box) return;
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { box.classList.remove("show"); }, 4000);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 10. Keyboard ----------
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // "/" focuses the search; Esc in the search clears it
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = e.target && e.target.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") {
        e.preventDefault();
        $("q").focus();
      } else if (e.key === "Escape" && e.target === $("q") && $("q").value) {
        e.preventDefault();
        $("q").value = "";
        onQuery();
      }
    });
    // Arrow down from the search box into the results
    $("q").addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" && !$("results").hidden) {
        var f = $("results").querySelector("button");
        if (f) { e.preventDefault(); f.focus(); }
      }
    });
    $("results").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      var btns = [].slice.call($("results").querySelectorAll("button"));
      var i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      if (e.key === "ArrowDown" && i < btns.length - 1) btns[i + 1].focus();
      else if (e.key === "ArrowUp") (i > 0 ? btns[i - 1] : $("q")).focus();
    });
  }

  // ---------- 11. Palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("title") + " · orOS";
    var q = $("q");
    q.placeholder = t("search.ph");
    q.setAttribute("aria-label", t("search.ph"));
    var mb = $("manual-btn");
    mb.innerHTML = UI.pencil;
    mb.setAttribute("aria-label", t("btn.manual"));
    mb.title = t("btn.manual");
  }

  function wire() {
    $("q").addEventListener("input", onQuery);
    $("manual-btn").addEventListener("click", function () { toggleManual(!prefs.manual); });
    $("add-author").addEventListener("click", function () {
      if (manual.authors.length >= MAX_AUTHORS) return;
      manual.authors.push({ y: "", alive: false });
      buildAuthors();
      var ins = $("authors").querySelectorAll("input[type=number]");
      if (ins.length) ins[ins.length - 1].focus();
    });
    $("pub").addEventListener("input", function () { manual.pub = $("pub").value; manualChanged(); });
    $("recents-clear").addEventListener("click", function () {
      recents = [];
      saveRecents();
      renderRecents();
      showToast(t("toast.clear"));
    });
    window.addEventListener("offline", function () {
      if ($("q").value.trim().length >= 2) setMsg(t("search.offline"));
    });
    window.addEventListener("online", function () {
      if ($("q").value.trim().length >= 2) onQuery();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && subject) render();   // a new year may have started
    });
    wireKeyboard();
  }

  function boot() {
    loadPrefs();
    applyI18n();
    buildKinds();
    buildSorts();
    wire();
    inheritPalette();
    watchPalette();
    renderRecents();
    toggleManual(prefs.manual);
    render();
  }

  boot();
})();
