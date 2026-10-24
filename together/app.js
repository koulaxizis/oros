// ============================================================
// orOS Together — the app inside the shell frame
// A counter of the time together for one or more relationships, with
// the milestones ahead (months, years, every 100 days, every 50
// weeks, fun numbers). Inspired by the features of "Since Us"
// (DerDieDasLian, GPL-3.0); written from scratch for orOS.
// Boot order (OROS_BIBLE.md Part VI "Boot sequence"):
//   load → applyI18n → wire → registerSync → inheritPalette →
//   watchPalette → render → take a pending deep link → lock.
// Rules: R8 (shell APIs from window.parent, guarded), 5-arg
// registerSlice, a pulled slice never marks dirty (R6), user text
// through textContent only, photos are files on the orOS disk.
// Contacts are read only ("oros-contacts-data"), never written.
// ============================================================
(function () {
  "use strict";

  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("together/app.js v" + (SCRIPT_V || "?") + " boot");
  })();

  var APP_ID = "together";
  var STORAGE_KEY = "oros-together-data";
  var LOCAL_KEY = "oros-together-local";     // device-local: { active, arch }
  var CONTACTS_KEY = "oros-contacts-data";
  var PICS = "/internal/Pictures";
  var OWN_PICS = "/internal/Pictures/Together";
  var C = window.TogetherCore;

  // ---------- 1. Language ----------
  var STR = {
    en: {
      "app.name": "Together",
      "first.title": "Count your time together",
      "first.text": "Pick the person (or the people) from your Contacts, choose the day it all started, and orOS counts the days, weeks and years, and tells you when a round number is coming.",
      "first.go": "Start",
      "first.private": "Everything stays in orOS on your devices. Nobody else sees it.",
      "btn.add": "New relationship", "btn.settings": "Settings", "btn.edit": "Edit", "btn.save": "Save", "btn.cancel": "Cancel",
      "btn.delete": "Delete", "btn.close": "Close", "btn.done": "Done",
      "sec.coming": "Coming up", "sec.recent": "Recently",
      "rel.new": "New relationship", "rel.edit": "Edit the relationship",
      "rel.people": "Who", "rel.fromContacts": "From Contacts", "rel.namePh": "Or write a name", "rel.addName": "Add",
      "rel.peopleHint": "One person, or more for a relationship of several people.",
      "rel.linked": "In Contacts", "rel.unlink": "Remove {name}",
      "rel.title": "A name for the two of you (optional)", "rel.titlePh": "e.g. Anna & Chris",
      "rel.start": "Together since", "rel.time": "Time (optional)", "rel.kind": "What you are",
      "rel.pron": "Their pronouns (optional)", "rel.discreet": "Discreet: show initials only",
      "rel.photo": "Photo", "rel.archive": "Archived (kept, but not shown first)",
      "rel.needPerson": "Add at least one person.", "rel.needStart": "Choose the day it started.",
      "rel.maxPeople": "At most {n} people.",
      "rel.saved": "Saved", "rel.deleted": "Deleted",
      "rel.delAsk": "Delete “{name}” with everything in it? It is deleted on your other devices too. The photos stay in Files.",
      "kind.couple": "A couple", "kind.engaged": "Engaged", "kind.married": "Married", "kind.partners": "Partners",
      "kind.friends": "Friends", "kind.other": "Something else",
      "pron.she": "she/her", "pron.he": "he/him", "pron.they": "they/them",
      "photo.device": "From this device", "photo.files": "From orOS Files", "photo.remove": "Remove the photo",
      "photo.pos": "Framing (up / down)",
      "photo.hint": "The photo is kept as a file in Files › Pictures › Together, so it never fills the browser storage.",
      "photo.saving": "Saving the photo…", "photo.saved": "The photo is in Files › Pictures › Together",
      "photo.bad": "This file is not a picture orOS can read.", "photo.big": "The picture is larger than 40 MB.",
      "photo.noDisk": "The orOS disk is not available here, so photos cannot be kept.",
      "photo.fail": "The photo could not be saved.", "photo.missing": "The photo is not on this device (yet).",
      "ct.title": "Choose from Contacts", "ct.search": "Search", "ct.none": "No contacts yet. Add people in Contacts, or write a name instead.",
      "ct.noMatch": "No contact matches.", "ct.more": "Only the first {n} are shown. Search to find others.",
      "pic.title": "A picture from Files", "pic.none": "No pictures in Files › Pictures yet.",
      "set.title": "Settings", "set.me": "Your name (shown next to theirs, optional)",
      "set.live": "Live counter (seconds tick by)", "set.kinds": "Milestones to show",
      "set.about": "Together is inspired by Since Us, an Android app by DerDieDasLian (GPL-3.0), written from scratch for orOS.",
      "ms.month": "Months", "ms.year": "Anniversaries", "ms.d100": "Every 100 days", "ms.w50": "Every 50 weeks", "ms.fun": "Fun numbers",
      "since": "Together since {date}", "since.future": "Starts on {date}",
      "big.today": "Today is the first day",
      "unit.y.one": "{n} year", "unit.y.other": "{n} years",
      "unit.mo.one": "{n} month", "unit.mo.other": "{n} months",
      "unit.d.one": "{n} day", "unit.d.other": "{n} days",
      "unit.w.one": "{n} week", "unit.w.other": "{n} weeks",
      "unit.h.one": "{n} hour", "unit.h.other": "{n} hours",
      "unit.min.one": "{n} minute", "unit.min.other": "{n} minutes",
      "unit.s.one": "{n} second", "unit.s.other": "{n} seconds",
      "tile.days": "days", "tile.weeks": "weeks", "tile.months": "months", "tile.hours": "hours", "tile.minutes": "minutes",
      "live": "{s} seconds together",
      "future.in": "in {n}",
      "next.title": "Next milestone", "next.none": "No milestone in the next years. Switch more kinds on in Settings.",
      "next.today": "Today!", "next.tomorrow": "Tomorrow", "next.in.one": "In {n} day", "next.in.other": "In {n} days",
      "ago.yesterday": "Yesterday", "ago.one": "{n} day ago", "ago.other": "{n} days ago",
      "ms.yearN": "{n}. anniversary", "ms.yearN.1": "First anniversary",
      "ms.funTag": "fun number", "ms.at": "{date} at {time}",
      "empty.coming": "Nothing ahead with these settings.",
      "sec.lock": "PIN lock",
      "lock.status.on": "The PIN lock is on for this device.", "lock.status.off": "No PIN on this device.",
      "lock.set": "Set a PIN", "lock.lockNow": "Lock now", "lock.change": "Change the PIN", "lock.remove": "Remove the PIN",
      "lock.cur": "Current PIN", "lock.new": "New PIN (4–8 digits)", "lock.again": "The new PIN again", "lock.save": "Save the PIN",
      "lock.bad": "The PIN is 4 to 8 digits", "lock.mismatch": "The two PINs differ",
      "lock.on": "PIN lock on", "lock.off": "PIN lock removed",
      "lock.title": "Together is locked", "lock.pin": "PIN", "lock.go": "Unlock",
      "lock.wrong": "Wrong PIN", "lock.wait": "Too many tries. Wait {n} s", "lock.unsupported": "This browser cannot check a PIN here",
      "lock.hint": "A PIN screen when Together opens, and again after a minute away. It is a privacy screen on this device, not encryption.",
      "lock.note": "Forgot the PIN? It lives only on this device: clearing orOS's site data removes it; with sync on, your data comes back from the cloud.",
      "full": "This device is out of storage space. The change was not saved."
    },
    el: {
      "app.name": "Μαζί",
      "first.title": "Μέτρα τον χρόνο σας μαζί",
      "first.text": "Διάλεξε το πρόσωπο (ή τα πρόσωπα) από τις Επαφές, βάλε τη μέρα που ξεκίνησαν όλα, και το orOS μετρά τις μέρες, τις εβδομάδες και τα χρόνια, και σου λέει πότε έρχεται ένας στρογγυλός αριθμός.",
      "first.go": "Ξεκίνα",
      "first.private": "Όλα μένουν στο orOS, στις συσκευές σου. Κανείς άλλος δεν τα βλέπει.",
      "btn.add": "Νέα σχέση", "btn.settings": "Ρυθμίσεις", "btn.edit": "Επεξεργασία", "btn.save": "Αποθήκευση", "btn.cancel": "Άκυρο",
      "btn.delete": "Διαγραφή", "btn.close": "Κλείσιμο", "btn.done": "Έτοιμο",
      "sec.coming": "Έρχονται", "sec.recent": "Πρόσφατα",
      "rel.new": "Νέα σχέση", "rel.edit": "Επεξεργασία σχέσης",
      "rel.people": "Ποιος ή ποια", "rel.fromContacts": "Από τις Επαφές", "rel.namePh": "Ή γράψε ένα όνομα", "rel.addName": "Προσθήκη",
      "rel.peopleHint": "Ένα πρόσωπο, ή περισσότερα για σχέση πολλών ανθρώπων.",
      "rel.linked": "Στις Επαφές", "rel.unlink": "Αφαίρεση: {name}",
      "rel.title": "Ένα όνομα για εσάς (προαιρετικό)", "rel.titlePh": "π.χ. Άννα & Χρήστος",
      "rel.start": "Μαζί από", "rel.time": "Ώρα (προαιρετική)", "rel.kind": "Τι είστε",
      "rel.pron": "Οι αντωνυμίες του/της (προαιρετικό)", "rel.discreet": "Διακριτικά: μόνο αρχικά",
      "rel.photo": "Φωτογραφία", "rel.archive": "Στο αρχείο (μένει, αλλά δεν φαίνεται πρώτη)",
      "rel.needPerson": "Πρόσθεσε τουλάχιστον ένα πρόσωπο.", "rel.needStart": "Διάλεξε τη μέρα που ξεκίνησε.",
      "rel.maxPeople": "Το πολύ {n} πρόσωπα.",
      "rel.saved": "Αποθηκεύτηκε", "rel.deleted": "Διαγράφηκε",
      "rel.delAsk": "Να διαγραφεί το «{name}» με ό,τι έχει μέσα; Διαγράφεται και στις άλλες συσκευές σου. Οι φωτογραφίες μένουν στο Files.",
      "kind.couple": "Ζευγάρι", "kind.engaged": "Αρραβωνιασμένοι", "kind.married": "Παντρεμένοι", "kind.partners": "Σύντροφοι",
      "kind.friends": "Φίλοι", "kind.other": "Κάτι άλλο",
      "pron.she": "αυτή", "pron.he": "αυτός", "pron.they": "ουδέτερες",
      "photo.device": "Από αυτή τη συσκευή", "photo.files": "Από το Files του orOS", "photo.remove": "Αφαίρεση φωτογραφίας",
      "photo.pos": "Κάδρο (πάνω / κάτω)",
      "photo.hint": "Η φωτογραφία κρατιέται ως αρχείο στο Files › Pictures › Together, ώστε να μη γεμίζει ποτέ ο χώρος του προγράμματος περιήγησης.",
      "photo.saving": "Αποθήκευση φωτογραφίας…", "photo.saved": "Η φωτογραφία είναι στο Files › Pictures › Together",
      "photo.bad": "Αυτό το αρχείο δεν είναι εικόνα που διαβάζει το orOS.", "photo.big": "Η εικόνα είναι μεγαλύτερη από 40 MB.",
      "photo.noDisk": "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ, οπότε δεν κρατιούνται φωτογραφίες.",
      "photo.fail": "Η φωτογραφία δεν αποθηκεύτηκε.", "photo.missing": "Η φωτογραφία δεν είναι (ακόμα) σε αυτή τη συσκευή.",
      "ct.title": "Επιλογή από τις Επαφές", "ct.search": "Αναζήτηση", "ct.none": "Δεν υπάρχουν επαφές ακόμα. Πρόσθεσε ανθρώπους στις Επαφές ή γράψε ένα όνομα.",
      "ct.noMatch": "Καμία επαφή δεν ταιριάζει.", "ct.more": "Φαίνονται μόνο οι πρώτες {n}. Ψάξε για τις άλλες.",
      "pic.title": "Εικόνα από το Files", "pic.none": "Δεν υπάρχουν ακόμα εικόνες στο Files › Pictures.",
      "set.title": "Ρυθμίσεις", "set.me": "Το όνομά σου (δίπλα στο δικό του/της, προαιρετικό)",
      "set.live": "Ζωντανός μετρητής (τρέχουν τα δευτερόλεπτα)", "set.kinds": "Ορόσημα που φαίνονται",
      "set.about": "Το Μαζί είναι εμπνευσμένο από το Since Us, εφαρμογή Android του DerDieDasLian (GPL-3.0), γραμμένο από την αρχή για το orOS.",
      "ms.month": "Μήνες", "ms.year": "Επέτειοι", "ms.d100": "Κάθε 100 μέρες", "ms.w50": "Κάθε 50 εβδομάδες", "ms.fun": "Αστείοι αριθμοί",
      "since": "Μαζί από {date}", "since.future": "Ξεκινά στις {date}",
      "big.today": "Σήμερα είναι η πρώτη μέρα",
      "unit.y.one": "{n} χρόνος", "unit.y.other": "{n} χρόνια",
      "unit.mo.one": "{n} μήνας", "unit.mo.other": "{n} μήνες",
      "unit.d.one": "{n} μέρα", "unit.d.other": "{n} μέρες",
      "unit.w.one": "{n} εβδομάδα", "unit.w.other": "{n} εβδομάδες",
      "unit.h.one": "{n} ώρα", "unit.h.other": "{n} ώρες",
      "unit.min.one": "{n} λεπτό", "unit.min.other": "{n} λεπτά",
      "unit.s.one": "{n} δευτερόλεπτο", "unit.s.other": "{n} δευτερόλεπτα",
      "tile.days": "μέρες", "tile.weeks": "εβδομάδες", "tile.months": "μήνες", "tile.hours": "ώρες", "tile.minutes": "λεπτά",
      "live": "{s} δευτερόλεπτα μαζί",
      "future.in": "σε {n}",
      "next.title": "Επόμενο ορόσημο", "next.none": "Κανένα ορόσημο τα επόμενα χρόνια. Άνοιξε περισσότερα είδη στις Ρυθμίσεις.",
      "next.today": "Σήμερα!", "next.tomorrow": "Αύριο", "next.in.one": "Σε {n} μέρα", "next.in.other": "Σε {n} μέρες",
      "ago.yesterday": "Χθες", "ago.one": "Πριν από {n} μέρα", "ago.other": "Πριν από {n} μέρες",
      "ms.yearN": "{n}η επέτειος", "ms.yearN.1": "Πρώτη επέτειος",
      "ms.funTag": "αστείος αριθμός", "ms.at": "{date}, {time}",
      "empty.coming": "Τίποτα μπροστά με αυτές τις ρυθμίσεις.",
      "sec.lock": "Κλείδωμα με PIN",
      "lock.status.on": "Το κλείδωμα PIN είναι ενεργό σε αυτή τη συσκευή.", "lock.status.off": "Δεν υπάρχει PIN σε αυτή τη συσκευή.",
      "lock.set": "Ορισμός PIN", "lock.lockNow": "Κλείδωμα τώρα", "lock.change": "Αλλαγή PIN", "lock.remove": "Αφαίρεση PIN",
      "lock.cur": "Τρέχον PIN", "lock.new": "Νέο PIN (4–8 ψηφία)", "lock.again": "Το νέο PIN ξανά", "lock.save": "Αποθήκευση PIN",
      "lock.bad": "Το PIN έχει 4 έως 8 ψηφία", "lock.mismatch": "Τα δύο PIN διαφέρουν",
      "lock.on": "Το κλείδωμα PIN ενεργοποιήθηκε", "lock.off": "Το PIN αφαιρέθηκε",
      "lock.title": "Το Μαζί είναι κλειδωμένο", "lock.pin": "PIN", "lock.go": "Ξεκλείδωμα",
      "lock.wrong": "Λάθος PIN", "lock.wait": "Πολλές προσπάθειες. Περίμενε {n} δευτ.", "lock.unsupported": "Αυτό το πρόγραμμα περιήγησης δεν μπορεί να ελέγξει PIN εδώ",
      "lock.hint": "Μια οθόνη PIN όταν ανοίγει το Μαζί και ξανά μετά από ένα λεπτό μακριά. Είναι οθόνη ιδιωτικότητας σε αυτή τη συσκευή, όχι κρυπτογράφηση.",
      "lock.note": "Ξέχασες το PIN; Υπάρχει μόνο σε αυτή τη συσκευή: η διαγραφή των δεδομένων ιστότοπου του orOS το αφαιρεί· με ενεργό συγχρονισμό, τα δεδομένα σου επιστρέφουν από το cloud.",
      "full": "Ο χώρος αποθήκευσης της συσκευής γέμισε. Η αλλαγή δεν αποθηκεύτηκε."
    }
  };

  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  if (window.orosI18n) window.orosI18n.table(STR, APP_ID, LANG);
  var LOCALE = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");
  var TBL = STR[LANG] || STR.en;
  function t(k, vars) {
    var s = TBL[k] || STR.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function plural(key, n) {
    var form = "other";
    try { form = new Intl.PluralRules(LOCALE).select(n); } catch (e) { form = n === 1 ? "one" : "other"; }
    var k = TBL[key + "." + form] !== undefined ? key + "." + form : (n === 1 ? key + ".one" : key + ".other");
    return t(k, { n: num(n) });
  }
  function num(n) { try { return new Intl.NumberFormat(LOCALE).format(n); } catch (e) { return String(n); } }
  function fmtDate(ymd, opts) {
    var p = C.parseYmd(ymd);
    if (!p) return ymd;
    try {
      return new Intl.DateTimeFormat(LOCALE, opts || { weekday: "short", day: "numeric", month: "long", year: "numeric" })
        .format(new Date(p.y, p.mo - 1, p.d, 12));
    } catch (e) { return ymd; }
  }

  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) {
      n.placeholder = t(n.getAttribute("data-i18n-ph"));
      if (!n.getAttribute("aria-label")) n.setAttribute("aria-label", n.placeholder);
    });
    document.title = t("app.name") + " · orOS";
  }

  // ---------- 2. Data: local first, then sync ----------
  var data = C.empty();
  var local = { active: "" };

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function fsApi() {
    try { var f = window.parent && window.parent !== window && window.parent.orosFS; return f && typeof f.write === "function" ? f : null; }
    catch (e) { return null; }
  }
  function dialogApi() {
    try { return (window.parent && window.parent.orosDialog) || null; } catch (e) { return null; }
  }

  function load() {
    try { data = C.normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch (e) { data = C.empty(); }
    try {
      var l = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
      if (l && typeof l.active === "string") local.active = l.active.slice(0, 64);
    } catch (e) {}
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, C.serialize(data)); return true; }
    catch (e) { toast(t("full")); return false; }
  }
  function saveLocal() { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch (e) {} }

  function save(next) {
    if (C.serialize(next) === C.serialize(data)) { render(); return; }
    data = next;
    if (!persist()) return;
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
    render();
  }

  function sliceGet() { return C.normalize(data); }
  function sliceSet(incoming) {
    var merged = C.merge(data, incoming);
    if (C.serialize(merged) === C.serialize(data)) return;
    data = merged;
    persist();
    render();
  }
  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    try { api.registerSlice(APP_ID, sliceGet, sliceSet, STORAGE_KEY, C.merge); }
    catch (e) { /* engine busy: the next boot registers again */ }
  }

  function contacts() {
    try { return C.contactIndex(JSON.parse(localStorage.getItem(CONTACTS_KEY) || "null")); }
    catch (e) { return {}; }
  }

  // ---------- 3. Palette ----------
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--panel-bg", "--border", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }

  // ---------- 4. Helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function btn(label, cls, fn) {
    var b = el("button", cls || "chip", label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  var ICON = {
    add: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };
  function setIcon(b, svg, label) { b.innerHTML = svg; b.setAttribute("aria-label", label); b.title = label; }

  var toastTimer = 0;
  function toast(msg) {
    var box = $("toast");
    box.textContent = msg;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3200);
  }

  function ask(text, yesLabel) {
    return new Promise(function (resolve) {
      var dlg = $("ask-dlg");
      $("ask-t").textContent = text;
      $("ask-yes").textContent = yesLabel;
      function done(v) {
        $("ask-yes").onclick = $("ask-no").onclick = null;
        dlg.onclose = null;
        if (dlg.open) dlg.close();
        resolve(v);
      }
      $("ask-yes").onclick = function () { done(true); };
      $("ask-no").onclick = function () { done(false); };
      dlg.onclose = function () { done(false); };
      dlg.showModal();
    });
  }

  // ---------- 5. Photos (files on the orOS disk) ----------
  var urlCache = {};        // path → object URL (or "" while missing)
  function photoUrl(path) {
    if (!path) return Promise.resolve("");
    if (urlCache[path] !== undefined && urlCache[path] !== null) return Promise.resolve(urlCache[path]);
    var fs = fsApi();
    if (!fs) return Promise.resolve("");
    return fs.read(path).then(function (blob) {
      var u = URL.createObjectURL(blob);
      urlCache[path] = u;
      return u;
    }, function () { return ""; });
  }
  var IMG_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;

  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return loadImg(file); });
    }
    return loadImg(file);
  }
  function loadImg(file) {
    return new Promise(function (resolve, reject) {
      var u = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve(img); setTimeout(function () { URL.revokeObjectURL(u); }, 0); };
      img.onerror = function () { URL.revokeObjectURL(u); reject(new Error("img")); };
      img.src = u;
    });
  }
  // A picture → JPEG, long side ≤ 2048 px (no EXIF survives a canvas).
  function shrink(file) {
    return loadBitmap(file).then(function (bmp) {
      var w = bmp.width, h = bmp.height, k = Math.min(1, 2048 / Math.max(w, h));
      var cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(w * k));
      cv.height = Math.max(1, Math.round(h * k));
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      if (bmp.close) bmp.close();
      return new Promise(function (resolve, reject) {
        cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("blob")); }, "image/jpeg", 0.88);
      });
    });
  }
  function safeBase(name) {
    var s = String(name || "").replace(/\.[^.]*$/, "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
    return s.slice(0, 60) || "photo";
  }
  function uniquePath(fs, dir, base, ext) {
    function tryN(n) {
      var p = dir + "/" + (n ? base + " (" + (n + 1) + ")" : base) + ext;
      return fs.stat(p).then(function () { return n < 98 ? tryN(n + 1) : Promise.reject(new Error("name")); }, function () { return p; });
    }
    return tryN(0);
  }
  // From this device: pick → shrink → save in Pictures/Together → path.
  function photoFromDevice() {
    var fs = fsApi(), dlg = dialogApi();
    if (!fs) { toast(t("photo.noDisk")); return Promise.resolve(""); }
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile("image/*") : Promise.resolve(null);
    return pick.then(function (file) {
      if (!file) return "";
      if (file.size > 40 * 1024 * 1024) { toast(t("photo.big")); return ""; }
      if (file.type && !/^image\//.test(file.type) && !IMG_EXT.test(file.name || "")) { toast(t("photo.bad")); return ""; }
      toast(t("photo.saving"));
      return shrink(file).then(function (blob) {
        return uniquePath(fs, OWN_PICS, safeBase(file.name), ".jpg").then(function (p) {
          return fs.write(p, blob).then(function () { toast(t("photo.saved")); return p; });
        }, function () { toast(t("photo.fail")); return ""; });
      }, function () { toast(t("photo.bad")); return ""; });
    });
  }

  // From orOS Files: the pictures of Pictures and Pictures/Together.
  var picUrls = [];
  function closePics() {
    picUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    picUrls = [];
    $("pic-grid").textContent = "";
  }
  function photoFromFiles() {
    var fs = fsApi();
    if (!fs) { toast(t("photo.noDisk")); return Promise.resolve(""); }
    return new Promise(function (resolve) {
      var dlg = $("pic-dlg"), grid = $("pic-grid"), chosen = "";
      closePics();
      $("pic-empty").hidden = true;
      function listDir(dir) {
        return fs.ls(dir).then(function (rows) {
          return rows.filter(function (r) { return !r.dir && IMG_EXT.test(r.name); }).map(function (r) { return dir + "/" + r.name; });
        }, function () { return []; });
      }
      Promise.all([listDir(OWN_PICS), listDir(PICS)]).then(function (lists) {
        var paths = lists[0].concat(lists[1]).slice(0, 120);
        if (!paths.length) { $("pic-empty").textContent = t("pic.none"); $("pic-empty").hidden = false; return; }
        paths.forEach(function (p) {
          var b = btn("", "pic");
          b.setAttribute("aria-label", p.split("/").pop());
          b.title = p.split("/").pop();
          var img = el("img");
          img.alt = "";
          img.loading = "lazy";
          b.appendChild(img);
          b.addEventListener("click", function () { chosen = p; dlg.close(); });
          grid.appendChild(b);
          fs.read(p).then(function (blob) { var u = URL.createObjectURL(blob); picUrls.push(u); img.src = u; }, function () {});
        });
      });
      dlg.onclose = function () { dlg.onclose = null; closePics(); resolve(chosen); };
      dlg.showModal();
    });
  }

  // ---------- 6. Home ----------
  function today() { return C.todayYmd(Date.now()); }
  function activeRel() {
    var rels = C.liveRels(data, true);
    var r = rels.filter(function (x) { return x.id === local.active; })[0];
    return r || C.liveRels(data, false)[0] || rels[0] || null;
  }

  function msLabel(m) {
    if (m.kind === "year") return m.n === 1 ? t("ms.yearN.1") : t("ms.yearN", { n: m.n });
    if (m.kind === "month") return plural("unit.mo", m.n);
    if (m.kind === "d100") return plural("unit.d", m.n);
    if (m.kind === "w50") return plural("unit.w", m.n);
    var u = m.u === "h" ? "unit.h" : m.u === "min" ? "unit.min" : m.u === "s" ? "unit.s" : "unit.d";
    return plural(u, m.n);
  }
  function whenLabel(date) {
    var n = C.daysBetween(today(), date);
    if (n === 0) return t("next.today");
    if (n === 1) return t("next.tomorrow");
    if (n === -1) return t("ago.yesterday");
    if (n < 0) return plural("ago", -n);
    return plural("next.in", n);
  }
  function msRow(m) {
    var li = el("li", "ms ms-" + m.kind);
    var dot = el("span", "dot");
    dot.setAttribute("aria-hidden", "true");
    li.appendChild(dot);
    var body = el("div", "ms-body");
    var top = el("p", "ms-what", msLabel(m));
    if (m.kind === "fun") top.appendChild(el("span", "tag", t("ms.funTag")));
    body.appendChild(top);
    body.appendChild(el("p", "ms-when", m.time ? t("ms.at", { date: fmtDate(m.date), time: m.time }) : fmtDate(m.date)));
    li.appendChild(body);
    li.appendChild(el("span", "ms-in", whenLabel(m.date)));
    return li;
  }

  var shownDay = "";
  function render() {
    var rels = C.liveRels(data, true), rel = activeRel(), idx = contacts(), me = data.prefs.me;
    shownDay = today();
    $("first").hidden = !!rel;
    $("home").hidden = !rel;
    renderTabs(rels, rel, idx, me);
    if (!rel) { stopTick(); return; }

    $("names").textContent = C.relName(rel, idx, me);
    var pron = rel.pron && !rel.discreet ? " · " + rel.pron : "";
    $("since").textContent = t(shownDay < rel.start ? "since.future" : "since", { date: fmtDate(rel.start, { day: "numeric", month: "long", year: "numeric" }) }) + pron;

    var img = $("cover");
    $("hero").classList.toggle("has-photo", !!rel.cover);
    if (rel.cover) {
      img.style.objectPosition = "50% " + rel.pos + "%";
      photoUrl(rel.cover).then(function (u) {
        var cur = activeRel();
        if (!cur || cur.cover !== rel.cover) return;
        if (u) { img.src = u; img.hidden = false; }
        else { img.hidden = true; $("hero").classList.remove("has-photo"); }
      });
    } else { img.hidden = true; img.removeAttribute("src"); }

    renderCounter(rel);
    renderMilestones(rel);
    startTick();
  }

  function renderTabs(rels, rel, idx, me) {
    var host = $("rel-tabs");
    host.textContent = "";
    host.hidden = rels.length < 2;
    $("title").hidden = rels.length >= 2;
    if (rels.length < 2) return;
    rels.forEach(function (r) {
      var b = btn(C.relName(r, idx, ""), "tab" + (r.arch ? " arch" : ""), function () {
        local.active = r.id;
        saveLocal();
        render();
      });
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", rel && r.id === rel.id ? "true" : "false");
      host.appendChild(b);
    });
  }

  function tile(n, label) {
    var d = el("div", "tile");
    d.appendChild(el("b", "", num(n)));
    d.appendChild(el("span", "", label));
    return d;
  }
  function renderCounter(rel) {
    var now = Date.now(), e = C.elapsed(rel, shownDay, now);
    var parts = [];
    if (e.years) parts.push(plural("unit.y", e.years));
    if (e.months) parts.push(plural("unit.mo", e.months));
    if (e.days || !parts.length) parts.push(plural("unit.d", e.days));
    var big = $("cnt-big");
    if (!e.future && e.totalDays === 0) big.textContent = t("big.today");
    else big.textContent = e.future ? t("future.in", { n: parts.join(", ") }) : parts.join(", ");
    var tiles = $("cnt-tiles");
    tiles.textContent = "";
    tiles.appendChild(tile(e.totalDays, t("tile.days")));
    tiles.appendChild(tile(e.totalWeeks, t("tile.weeks")));
    tiles.appendChild(tile(e.totalMonths, t("tile.months")));
    tiles.appendChild(tile(e.totalHours, t("tile.hours")));
    tiles.appendChild(tile(e.totalMinutes, t("tile.minutes")));
    renderLive(rel, now);
  }
  function renderLive(rel, now) {
    var live = $("cnt-live");
    live.hidden = !data.prefs.live || shownDay < rel.start;
    if (live.hidden) return;
    live.textContent = t("live", { s: num(Math.max(0, Math.floor((now - C.startMs(rel)) / 1000))) });
  }

  function renderMilestones(rel) {
    var kinds = data.prefs.kinds, d = shownDay;
    var up = C.upcoming(rel, d, 9, kinds), next = up[0];
    var box = $("next");
    box.textContent = "";
    box.appendChild(el("p", "next-t", t("next.title")));
    if (!next) {
      box.appendChild(el("p", "hint", d < rel.start ? t("since.future", { date: fmtDate(rel.start) }) : t("next.none")));
    } else {
      box.classList.toggle("is-today", next.date === d);
      box.appendChild(el("p", "next-what", msLabel(next)));
      box.appendChild(el("p", "next-when", whenLabel(next.date) + " · " + (next.time ? t("ms.at", { date: fmtDate(next.date), time: next.time }) : fmtDate(next.date))));
    }
    var ul = $("up-list");
    ul.textContent = "";
    up.slice(1).forEach(function (m) { ul.appendChild(msRow(m)); });
    if (!up.length) ul.appendChild(el("li", "hint", t("empty.coming")));
    var rec = C.recent(rel, d, 3, kinds), rl = $("recent-list");
    rl.textContent = "";
    rec.forEach(function (m) { rl.appendChild(msRow(m)); });
    $("recent-h").hidden = rl.hidden = !rec.length;
  }

  // The live counter: one tick a second while visible; a new day
  // repaints everything.
  var tickTimer = 0;
  function startTick() {
    stopTick();
    if (document.hidden) return;
    tickTimer = setInterval(function () {
      var rel = activeRel();
      if (!rel) { stopTick(); return; }
      if (today() !== shownDay) { render(); return; }
      if (data.prefs.live) renderLive(rel, Date.now());
    }, 1000);
  }
  function stopTick() { if (tickTimer) clearInterval(tickTimer); tickTimer = 0; }

  // ---------- 7. Relationship editor ----------
  var draft = null;   // { id, isNew, people, cover }
  function openEditor(rel) {
    var idx = contacts();
    draft = {
      id: rel ? rel.id : C.uid(), isNew: !rel,
      people: rel ? rel.people.map(function (p) { return { c: p.c, n: C.personName(p, idx) }; }) : [],
      cover: rel ? rel.cover : ""
    };
    $("rel-dlg-t").textContent = t(rel ? "rel.edit" : "rel.new");
    $("rel-title").value = rel ? rel.title : "";
    $("rel-start").value = rel ? rel.start : "";
    $("rel-time").value = rel ? rel.time : "";
    $("rel-kind").value = rel ? rel.kind : "couple";
    $("rel-pron").value = rel ? rel.pron : "";
    $("rel-discreet").checked = !!(rel && rel.discreet);
    $("rel-pos").value = rel ? rel.pos : 50;
    $("rel-arch").checked = !!(rel && rel.arch);
    $("rel-arch-wrap").hidden = !rel;
    $("rel-del").hidden = !rel;
    $("rel-name").value = "";
    $("rel-msg").textContent = "";
    renderPeople();
    renderDraftPhoto();
    $("rel-dlg").showModal();
  }
  function renderPeople() {
    var ul = $("rel-people");
    ul.textContent = "";
    draft.people.forEach(function (p, i) {
      var li = el("li", "person");
      li.appendChild(el("span", "pname", p.n || "?"));
      if (p.c) li.appendChild(el("span", "tag", t("rel.linked")));
      var x = btn("", "icon-btn sm", function () { draft.people.splice(i, 1); renderPeople(); });
      setIcon(x, ICON.x, t("rel.unlink", { name: p.n || "?" }));
      li.appendChild(x);
      ul.appendChild(li);
    });
  }
  function addPerson(p) {
    if (draft.people.length >= C.MAX_PEOPLE) { $("rel-msg").textContent = t("rel.maxPeople", { n: C.MAX_PEOPLE }); return; }
    if (p.c && draft.people.some(function (x) { return x.c === p.c; })) return;
    draft.people.push(p);
    $("rel-msg").textContent = "";
    renderPeople();
  }
  function renderDraftPhoto() {
    var img = $("rel-photo-img");
    $("rel-photo-rm").hidden = !draft.cover;
    $("rel-pos-wrap").hidden = !draft.cover;
    img.style.objectPosition = "50% " + $("rel-pos").value + "%";
    if (!draft.cover) { img.hidden = true; img.removeAttribute("src"); return; }
    var want = draft.cover;
    photoUrl(want).then(function (u) {
      if (!draft || draft.cover !== want) return;
      if (u) { img.src = u; img.hidden = false; }
      else { img.hidden = true; toast(t("photo.missing")); }
    });
  }
  function saveEditor(ev) {
    ev.preventDefault();
    var start = $("rel-start").value;
    var typed = $("rel-name").value.trim();
    if (typed) { addPerson({ n: typed }); $("rel-name").value = ""; }
    if (!draft.people.length) { $("rel-msg").textContent = t("rel.needPerson"); $("rel-name").focus(); return; }
    if (!C.okYmd(start)) { $("rel-msg").textContent = t("rel.needStart"); $("rel-start").focus(); return; }
    var old = C.find(data, "rels", draft.id);
    var row = {
      id: draft.id, people: draft.people.map(function (p) { return p.c ? { c: p.c, n: p.n } : { n: p.n }; }),
      title: $("rel-title").value, start: start, time: $("rel-time").value, kind: $("rel-kind").value,
      pron: $("rel-pron").value, discreet: $("rel-discreet").checked, cover: draft.cover,
      pos: +$("rel-pos").value, arch: draft.isNew ? false : $("rel-arch").checked,
      ord: old ? old.ord : C.liveRels(data, true).reduce(function (mx, r) { return Math.max(mx, r.ord + 1); }, 0)
    };
    local.active = draft.id;
    saveLocal();
    draft = null;
    $("rel-dlg").close();
    save(C.put(data, "rels", row, Date.now()));
    toast(t("rel.saved"));
  }
  function deleteRel() {
    var rel = C.find(data, "rels", draft.id);
    if (!rel) return;
    ask(t("rel.delAsk", { name: C.relName(rel, contacts(), "") }), t("btn.delete")).then(function (yes) {
      if (!yes) return;
      draft = null;
      $("rel-dlg").close();
      local.active = "";
      saveLocal();
      save(C.remove(data, "rels", rel.id, Date.now()));
      toast(t("rel.deleted"));
    });
  }

  // Contact picker (read only).
  var CT_SHOW = 200;
  function openContacts() {
    var idx = contacts(), all = Object.keys(idx).map(function (k) { return idx[k]; });
    all.sort(function (a, b) { return a.name.localeCompare(b.name, LOCALE); });
    var q = $("ct-q");
    q.value = "";
    function fold(s) { return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
    function draw() {
      var f = fold(q.value.trim()), ul = $("ct-list"), msg = $("ct-empty");
      ul.textContent = "";
      var hits = all.filter(function (c) { return !f || fold(c.name).indexOf(f) >= 0; });
      hits.slice(0, CT_SHOW).forEach(function (c) {
        var li = el("li");
        li.appendChild(btn(c.name, "pick", function () { addPerson({ c: c.id, n: c.name }); $("ct-dlg").close(); }));
        ul.appendChild(li);
      });
      msg.hidden = all.length > 0 && hits.length > 0 && hits.length <= CT_SHOW;
      msg.textContent = !all.length ? t("ct.none") : !hits.length ? t("ct.noMatch") : t("ct.more", { n: CT_SHOW });
    }
    q.oninput = draw;
    draw();
    $("ct-dlg").showModal();
    q.focus();
  }

  // ---------- 8. Settings ----------
  function openSettings() {
    $("set-me").value = data.prefs.me;
    $("set-live").checked = data.prefs.live;
    var box = $("set-kinds");
    box.textContent = "";
    C.MS_KINDS.forEach(function (k) {
      var lab = el("label", "check");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = data.prefs.kinds[k] !== false;
      cb.addEventListener("change", function () {
        var p = {}; p[k] = cb.checked;
        save(C.setPrefs(data, { kinds: p }, Date.now()));
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(" " + t("ms." + k)));
      box.appendChild(lab);
    });
    $("set-about").textContent = t("set.about");
    pinMode = null;
    renderPinArea();
    $("set-dlg").showModal();
  }

  // ---------- 9. PIN lock (device-local privacy screen) ----------
  var FAILS_KEY = "oros-together-lock-fails", RELOCK_MS = 60000;
  var lockRec = null, locked = false, hiddenAt = 0, pinMode = null;
  function cryptoOk() { return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues && window.TextEncoder); }
  function loadLock() { try { lockRec = C.readLock(JSON.parse(localStorage.getItem(C.LOCK_KEY) || "null")); } catch (e) { lockRec = null; } }
  function readFails() {
    try { var f = JSON.parse(localStorage.getItem(FAILS_KEY) || "null"); return f && typeof f.n === "number" ? f : { n: 0, at: 0 }; }
    catch (e) { return { n: 0, at: 0 }; }
  }
  function writeFails(f) { try { if (f.n) localStorage.setItem(FAILS_KEY, JSON.stringify(f)); else localStorage.removeItem(FAILS_KEY); } catch (e) {} }
  function setInert(on) {
    ["toolbar", "main", "toast"].forEach(function (id) {
      var n = $(id);
      if (on) { n.setAttribute("inert", ""); n.setAttribute("aria-hidden", "true"); }
      else { n.removeAttribute("inert"); n.removeAttribute("aria-hidden"); }
    });
  }
  function showLock() {
    if (!lockRec) return;
    locked = true;
    [].forEach.call(document.querySelectorAll("dialog[open]"), function (d) { d.close(); });
    $("lock").hidden = false;
    document.body.classList.add("is-locked");
    setInert(true);
    $("lock-pin").value = "";
    $("lock-msg").textContent = "";
    setTimeout(function () { if (locked) $("lock-pin").focus(); }, 30);
  }
  function hideLock() {
    locked = false;
    $("lock").hidden = true;
    document.body.classList.remove("is-locked");
    setInert(false);
    runWaiting();
  }
  function tryUnlock(ev) {
    ev.preventDefault();
    var f = readFails(), wait = C.lockWait(f.n), left = Math.ceil((f.at + wait * 1000 - Date.now()) / 1000);
    if (wait && left > 0) { $("lock-msg").textContent = t("lock.wait", { n: left }); return; }
    $("lock-go").disabled = true;
    C.checkPin(window.crypto, lockRec, $("lock-pin").value.trim()).then(function (ok) {
      $("lock-go").disabled = false;
      if (ok) { writeFails({ n: 0, at: 0 }); hideLock(); return; }
      f.n++; f.at = Date.now(); writeFails(f);
      $("lock-pin").value = "";
      var w2 = C.lockWait(f.n);
      $("lock-msg").textContent = w2 ? t("lock.wait", { n: w2 }) : t("lock.wrong");
      $("lock-pin").focus();
    }, function () { $("lock-go").disabled = false; $("lock-msg").textContent = t("lock.unsupported"); });
  }
  function pinInput(id, label) {
    var inp = el("input", "pin-in");
    inp.type = "password";
    inp.id = id;
    inp.inputMode = "numeric";
    inp.setAttribute("pattern", "[0-9]*");
    inp.maxLength = 8;
    inp.autocomplete = "off";
    inp.placeholder = label;
    inp.setAttribute("aria-label", label);
    return inp;
  }
  function renderPinArea() {
    var host = $("pin-area");
    host.textContent = "";
    if (!cryptoOk()) { host.appendChild(el("p", "hint small", t("lock.unsupported"))); return; }
    host.appendChild(el("p", "hint small", lockRec ? t("lock.status.on") : t("lock.status.off")));
    var msg = el("p", "msg");
    msg.setAttribute("aria-live", "polite");
    if (!pinMode) {
      var acts = el("div", "row wrap");
      if (!lockRec) acts.appendChild(btn(t("lock.set"), "chip", function () { pinMode = "set"; renderPinArea(); }));
      else {
        acts.appendChild(btn(t("lock.lockNow"), "chip", function () { showLock(); }));
        acts.appendChild(btn(t("lock.change"), "chip", function () { pinMode = "change"; renderPinArea(); }));
        acts.appendChild(btn(t("lock.remove"), "link-btn danger", function () { pinMode = "remove"; renderPinArea(); }));
      }
      host.appendChild(acts);
      return;
    }
    var form = el("div", "pin-form");
    var cur = pinMode !== "set" ? pinInput("pin-cur", t("lock.cur")) : null;
    var n1 = pinMode !== "remove" ? pinInput("pin-new", t("lock.new")) : null;
    var n2 = pinMode !== "remove" ? pinInput("pin-again", t("lock.again")) : null;
    [cur, n1, n2].forEach(function (x) { if (x) form.appendChild(x); });
    var acts2 = el("div", "row wrap");
    acts2.appendChild(btn(pinMode === "remove" ? t("lock.remove") : t("lock.save"), "chip pri", function () {
      var check = cur ? C.checkPin(window.crypto, lockRec, cur.value.trim()) : Promise.resolve(true);
      check.then(function (ok) {
        if (!ok) { msg.textContent = t("lock.wrong"); cur.value = ""; cur.focus(); return; }
        if (pinMode === "remove") {
          try { localStorage.removeItem(C.LOCK_KEY); } catch (e) {}
          writeFails({ n: 0, at: 0 });
          lockRec = null; pinMode = null;
          renderPinArea();
          toast(t("lock.off"));
          return;
        }
        var a = n1.value.trim(), b = n2.value.trim();
        if (!C.pinOk(a)) { msg.textContent = t("lock.bad"); n1.focus(); return; }
        if (a !== b) { msg.textContent = t("lock.mismatch"); n2.value = ""; n2.focus(); return; }
        return C.makeLock(window.crypto, a).then(function (rec) {
          try { localStorage.setItem(C.LOCK_KEY, JSON.stringify(rec)); } catch (e) { msg.textContent = t("full"); return; }
          lockRec = rec; pinMode = null;
          writeFails({ n: 0, at: 0 });
          renderPinArea();
          toast(t("lock.on"));
        });
      }).catch(function () { msg.textContent = t("lock.unsupported"); });
    }));
    acts2.appendChild(btn(t("btn.cancel"), "chip", function () { pinMode = null; renderPinArea(); }));
    form.appendChild(acts2);
    form.appendChild(msg);
    host.appendChild(form);
    (cur || n1).focus();
  }

  // ---------- 10. Wiring ----------
  function wire() {
    setIcon($("add-btn"), ICON.add, t("btn.add"));
    setIcon($("set-btn"), ICON.gear, t("btn.settings"));
    $("add-btn").addEventListener("click", function () { openEditor(null); });
    $("first-go").addEventListener("click", function () { openEditor(null); });
    $("edit-btn").addEventListener("click", function () { var r = activeRel(); if (r) openEditor(r); });
    $("set-btn").addEventListener("click", openSettings);

    var kind = $("rel-kind");
    C.KINDS.forEach(function (k) { var o = el("option", "", t("kind." + k)); o.value = k; kind.appendChild(o); });
    ["she", "he", "they"].forEach(function (k) { var o = el("option"); o.value = t("pron." + k); $("pron-list").appendChild(o); });

    $("rel-form").addEventListener("submit", saveEditor);
    $("rel-cancel").addEventListener("click", function () { draft = null; $("rel-dlg").close(); });
    $("rel-dlg").addEventListener("close", function () { draft = null; });
    $("rel-del").addEventListener("click", deleteRel);
    $("rel-from-ct").addEventListener("click", openContacts);
    function addTyped() {
      var v = $("rel-name").value.trim();
      if (!v) { $("rel-name").focus(); return; }
      addPerson({ n: v });
      $("rel-name").value = "";
      $("rel-name").focus();
    }
    $("rel-name-add").addEventListener("click", addTyped);
    $("rel-name").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addTyped(); } });
    $("rel-photo-dev").addEventListener("click", function () {
      photoFromDevice().then(function (p) { if (p && draft) { draft.cover = p; renderDraftPhoto(); } });
    });
    $("rel-photo-files").addEventListener("click", function () {
      photoFromFiles().then(function (p) { if (p && draft) { draft.cover = p; renderDraftPhoto(); } });
    });
    $("rel-photo-rm").addEventListener("click", function () { draft.cover = ""; renderDraftPhoto(); });
    $("rel-pos").addEventListener("input", function () { $("rel-photo-img").style.objectPosition = "50% " + this.value + "%"; });

    $("ct-close").addEventListener("click", function () { $("ct-dlg").close(); });
    $("pic-close").addEventListener("click", function () { $("pic-dlg").close(); });
    $("set-close").addEventListener("click", function () { $("set-dlg").close(); });
    $("set-me").addEventListener("change", function () { save(C.setPrefs(data, { me: this.value }, Date.now())); });
    $("set-live").addEventListener("change", function () { save(C.setPrefs(data, { live: this.checked }, Date.now())); });
    $("lock-form").addEventListener("submit", tryUnlock);

    // A click on the backdrop closes a dialog (R32).
    [].forEach.call(document.querySelectorAll("dialog"), function (d) {
      d.addEventListener("click", function (ev) { if (ev.target === d) d.close(); });
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { hiddenAt = Date.now(); stopTick(); return; }
      if (lockRec && !locked && hiddenAt && Date.now() - hiddenAt > RELOCK_MS) showLock();
      hiddenAt = 0;
      render();
    });
    // Contacts changed in another frame: names follow.
    window.addEventListener("storage", function (e) { if (e.key === CONTACTS_KEY) render(); });

    // Contract Β: Ctrl+Alt+Shift belongs to the shell.
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null; try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
  }

  // ---------- 11. Deep link: { rel: id } ----------
  var waiting = null;
  function openTarget(target) {
    if (!target || typeof target !== "object") return;
    if (typeof target.rel === "string" && C.find(data, "rels", target.rel)) {
      local.active = target.rel;
      saveLocal();
      render();
    }
  }
  window.__orosOpenAt = function (target) {
    if (locked) { waiting = target; return; }
    if (draft) return;     // an open editor keeps its edits
    openTarget(target);
  };
  function runWaiting() { var w = waiting; waiting = null; if (w) openTarget(w); }
  function takePending() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget(APP_ID);
        if (pending) window.__orosOpenAt(pending);
      }
    } catch (e) { /* standalone */ }
  }

  // ---------- 12. Boot ----------
  function boot() {
    load();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    loadLock();
    if (lockRec) showLock();
    render();
    takePending();
  }
  boot();
})();
