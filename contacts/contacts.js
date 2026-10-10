// ============================================================
// orOS Contacts
// Contact CRUD, structured names, multi-field phones/emails/
// addresses/websites/IM/events (birthday, anniversary, custom),
// labels (color-coded, filterable), starred favorites,
// vCard (.vcf) import + export, merge-capable sync.
// Data: localStorage "oros-contacts-data"
//   { ver: 1,
//     labels:   [ { id, name, color, mtime } ],
//     contacts: [ { id, mtime,
//                   given, middle, family, nickname,
//                   org, jobTitle,
//                   phones:    [ { v, type } ],
//                   emails:    [ { v, type } ],
//                   addresses: [ { street, city, zip, region, country, type } ],
//                   websites:  [ { v, type } ],
//                   im:        [ { v, type } ],
//                   events:    [ { day: "MM-DD", year: number|null,
//                                   type: "birthday"|"anniversary"|"custom",
//                                   label } ],
//                   labelIds: [ "lbl-…" ],   // sorted by sanitizer
//                   starred: false, note } ],
//     deleted:  [ { id, mtime } ] }          // shared tombstone list
// Events carry day "MM-DD" + optional year (null = yearless
// birthdays) — feeds the Calendar birthday feed (Wave 2) and the
// vCard BDAY round-trip ("--MM-DD" form) with zero ambiguity.
// id + mtime exist from day one for the merge sync (Part 5).
// photo: base64 JPEG data URI (≤50KB, 128×128), set via the
// dialog avatar uploader; round-trips as vCard PHOTO.
// ============================================================
(function () {
  "use strict";

  /* ---------- 0. Shell palette inheritance (same-origin iframe) ---------- */
  // Function NAMES are load-bearing: bump-version.yml's G3 palette
  // guard greps every app's JS for inheritPalette + watchPalette.
  // Single OS Skin rule: NO local accent palette (see Bible).
  function inheritPalette() {
    try {
      var pDoc = window.parent.document;
      var pCs = window.parent.getComputedStyle(pDoc.documentElement);
      ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
       "--accent-soft", "--panel-bg", "--border", "--shadow"].forEach(function (v) {
        var val = pCs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
      var th = pDoc.documentElement.getAttribute("data-theme");
      if (th) document.documentElement.setAttribute("data-theme", th);
    } catch (e) { /* standalone load — CSS fallbacks apply */ }
  }
  function watchPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      if (typeof MutationObserver !== "function") return;
      new MutationObserver(inheritPalette).observe(pRoot, {
        attributes: true, attributeFilter: ["data-theme", "data-skin"]
      });
    } catch (e) { /* standalone — nothing to watch */ }
  }
  inheritPalette();
  watchPalette();

  /* ---------- 1. i18n ---------- */
  var LANG = "en";
  try {
    if (window.parent && window.parent.orosLang) LANG = window.parent.orosLang;
    else if (localStorage.getItem("oros-lang")) LANG = localStorage.getItem("oros-lang");
  } catch (e) {}

  var STR = {
    en: {
      "app.contacts.self": "Contacts",
      "ct.add": "Add",
      "ct.import": "Import",
      "ct.export": "Export",
      "ct.search.ph": "Search contacts…",
      "ct.dlg.new": "New contact",
      "ct.dlg.edit": "Edit contact",
      "ct.field.given": "First name",
      "ct.field.middle": "Middle name",
      "ct.field.family": "Last name",
      "ct.field.nickname": "Nickname",
      "ct.field.org": "Company",
      "ct.field.jobtitle": "Job title",
      "ct.field.phones": "Phones",
      "ct.field.emails": "Emails",
      "ct.field.addresses": "Addresses",
      "ct.field.websites": "Websites",
      "ct.field.im": "Instant messaging",
      "ct.field.events": "Events",
      "ct.field.note": "Note",
      "ct.ph.given": "Maria",
      "ct.ph.middle": "—",
      "ct.ph.family": "Papadopoulou",
      "ct.ph.nickname": "Mary",
      "ct.ph.org": "Company…",
      "ct.ph.jobtitle": "Designer…",
      "ct.ph.note": "Details…",
      "ct.add.phone": "＋ Phone",
      "ct.add.email": "＋ Email",
      "ct.add.address": "＋ Address",
      "ct.add.website": "＋ Website",
      "ct.add.im": "＋ IM",
      "ct.add.event": "＋ Event",
      "ct.starred": "Favorite",
      "ct.filter.all": "All",
      "ct.filter.starred": "Favorites",
      "ct.save": "Save",
      "ct.cancel": "Cancel",
      "ct.delete": "Delete contact",
      "ct.delete.confirm": "Delete this contact?",
      "ct.del.yes": "Delete",
      "ct.del.done": "Contact deleted",
      "ct.err.name": "Give a name (or a company) first",
      "ct.none": "No contacts yet",
      "ct.search.none": "No contacts found",
      "ct.export.done": "Contacts exported (.vcf)",
      "ct.export.bad": "Export failed — please retry",
      "ct.export.json": "Export JSON",
      "ct.export.json.done": "Database exported (.json)",
      "ct.import.json": "Import JSON",
      "ct.import.json.done": "Database restored · {n} contact(s)",
      "ct.import.json.bad": "Not a valid orOS contacts JSON file",
      "ct.import.bad": "Could not read that file",
      "ct.import.done": "{n} contact(s) imported",
      "ct.import.csv.bad": "Could not read that CSV file",
      "ct.import.csv.noheader": "No recognizable columns — expected a Google Contacts CSV",
      "ct.import.csv.norows": "No importable contacts found in the CSV",
      "undo": "Undo",
      "lbl.personal": "Personal",
      "lbl.work": "Work",
      "lbl.family": "Family",
      "lbl.manage": "Manage labels",
      "lbl.new": "New label",
      "lbl.ph.name": "Name…",
      "lbl.color": "Color",
      "lbl.done": "Done",
      "lbl.delete": "Delete",
      "lbl.inuse": "This label is used by contacts",
      "lbl.empty": "No labels yet",
      "ty.mobile": "Mobile",
      "ty.home": "Home",
      "ty.work": "Work",
      "ty.main": "Main",
      "ty.other": "Other",
      "ty.blog": "Blog",
      "evt.birthday": "Birthday",
      "evt.anniversary": "Anniversary",
      "evt.custom": "Custom",
      "evt.ph": "Nameday…",
      "ct.unnamed": "(no name)",
      "ct.lbl.filter": "Labels",
      "dup.scan": "Duplicates",
      "dup.title": "Duplicate contacts",
      "dup.none": "No duplicates found",
      "dup.count": "Groups",
      "dup.merge": "Merge duplicates",
      "dup.primary": "Primary contact",
      "dup.flip": "Flip primary",
      "dup.do": "Merge now",
      "dup.reason.phone": "Same phone",
      "dup.reason.email": "Same email",
      "dup.reason.name": "Similar name",
      "dup.merged": "Contacts merged",
      "dup.undo": "Undo",
      "dup.sect.def": "Definitive matches",
      "dup.sect.pos": "Possible matches",
      "ct.avatar": "Photo",
      "ct.avatar.up": "Upload photo",
      "ct.avatar.rem": "Remove",
      "ct.avatar.bad": "Could not read that image",
      "ct.avatar.big": "Image too large after compression — try another one",
      "ct.field.relations": "Relations",
      "ct.add.relation": "＋ Relation",
      "ct.rel.pick": "— contact —",
      "ct.rel.in": "Linked from other contacts",
      "rel.spouse": "Spouse",
      "rel.partner": "Partner",
      "rel.parent": "Parent",
      "rel.child": "Child",
      "rel.sibling": "Sibling",
      "rel.friend": "Friend",
      "rel.colleague": "Colleague",
      "rel.manager": "Manager",
      "rel.other": "Other",
      "ct.back": "Back",
      "ct.share": "Share",
      "ct.familytree": "Family tree",
      "ct.share.done": "Contact copied to clipboard",
      "ct.share.fail": "Could not copy — please retry",
      "ct.maps": "Show on map",
    },
    el: {
      "app.contacts.self": "Επαφές",
      "ct.add": "Προσθήκη",
      "ct.import": "Εισαγωγή",
      "ct.export": "Εξαγωγή",
      "ct.search.ph": "Αναζήτηση επαφών…",
      "ct.dlg.new": "Νέα επαφή",
      "ct.dlg.edit": "Επεξεργασία επαφής",
      "ct.field.given": "Όνομα",
      "ct.field.middle": "Μεσόναμα",
      "ct.field.family": "Επώνυμο",
      "ct.field.nickname": "Ψευδώνυμο",
      "ct.field.org": "Εταιρεία",
      "ct.field.jobtitle": "Θέση",
      "ct.field.phones": "Τηλέφωνα",
      "ct.field.emails": "Emails",
      "ct.field.addresses": "Διευθύνσεις",
      "ct.field.websites": "Ιστοσελίδες",
      "ct.field.im": "Άμεσα μηνύματα",
      "ct.field.events": "Εκδηλώσεις",
      "ct.field.note": "Σημείωση",
      "ct.ph.given": "Μαρία",
      "ct.ph.middle": "—",
      "ct.ph.family": "Παπαδοπούλου",
      "ct.ph.nickname": "Μαριούλα",
      "ct.ph.org": "Εταιρεία…",
      "ct.ph.jobtitle": "Σχεδιάστρια…",
      "ct.ph.note": "Λεπτομέρειες…",
      "ct.add.phone": "＋ Τηλέφωνο",
      "ct.add.email": "＋ Email",
      "ct.add.address": "＋ Διεύθυνση",
      "ct.add.website": "＋ Ιστοσελίδα",
      "ct.add.im": "＋ IM",
      "ct.add.event": "＋ Εκδήλωση",
      "ct.starred": "Αγαπημένη",
      "ct.filter.all": "Όλες",
      "ct.filter.starred": "Αγαπημένες",
      "ct.save": "Αποθήκευση",
      "ct.cancel": "Άκυρο",
      "ct.delete": "Διαγραφή επαφής",
      "ct.delete.confirm": "Να διαγραφεί αυτή η επαφή;",
      "ct.del.yes": "Διαγραφή",
      "ct.del.done": "Η επαφή διαγράφηκε",
      "ct.err.name": "Δώσε πρώτα ένα όνομα (ή εταιρεία)",
      "ct.none": "Καμία επαφή ακόμα",
      "ct.search.none": "Καμία επαφή δεν βρέθηκε",
      "ct.export.done": "Οι επαφές εξήχθησαν (.vcf)",
      "ct.export.bad": "Η εξαγωγή απέτυχε — δοκίμασε ξανά",
      "ct.export.json": "Εξαγωγή JSON",
      "ct.export.json.done": "Η βάση εξήχθη (.json)",
      "ct.import.json": "Εισαγωγή JSON",
      "ct.import.json.done": "Η βάση επαναφέρθηκε · {n} επαφή/ές",
      "ct.import.json.bad": "Μη έγκυρο αρχείο JSON επαφών orOS",
      "ct.import.bad": "Το αρχείο δεν μπόρεσε να διαβαστεί",
      "ct.import.done": "{n} επαφή/ές εισήχθησαν",
      "ct.import.csv.bad": "Το αρχείο CSV δεν μπόρεσε να διαβαστεί",
      "ct.import.csv.noheader": "Δεν αναγνωρίστηκαν στήλες — αναμενόταν CSV από Google Contacts",
      "ct.import.csv.norows": "Δεν βρέθηκαν εισαγώμενες επαφές στο CSV",
      "undo": "Αναίρεση",
      "lbl.personal": "Προσωπικό",
      "lbl.work": "Εργασία",
      "lbl.family": "Οικογένεια",
      "lbl.manage": "Διαχείριση ετικετών",
      "lbl.new": "Νέα ετικέτα",
      "lbl.ph.name": "Όνομα…",
      "lbl.color": "Χρώμα",
      "lbl.done": "Τέλος",
      "lbl.delete": "Διαγραφή",
      "lbl.inuse": "Η ετικέτα χρησιμοποιείται από επαφές",
      "lbl.empty": "Δεν υπάρχουν ετικέτες ακόμα",
      "ty.mobile": "Κινητό",
      "ty.home": "Σπίτι",
      "ty.work": "Εργασία",
      "ty.main": "Κύριο",
      "ty.other": "Άλλο",
      "ty.blog": "Blog",
      "evt.birthday": "Γενέθλια",
      "evt.anniversary": "Επέτειος",
      "evt.custom": "Προσαρμοσμένη",
      "evt.ph": "Ονομαστική εορτή…",
      "ct.unnamed": "(χωρίς όνομα)",
      "ct.lbl.filter": "Ετικέτες",
      "dup.scan": "Διπλότυπα",
      "dup.title": "Διπλότυπες επαφές",
      "dup.none": "Δεν βρέθηκαν διπλότυπα",
      "dup.count": "Ομάδες",
      "dup.merge": "Συγχώνευση διπλότυπων",
      "dup.primary": "Κύρια επαφή",
      "dup.flip": "Αντιστροφή κύριας",
      "dup.do": "Συγχώνευση τώρα",
      "dup.reason.phone": "Ίδιο τηλέφωνο",
      "dup.reason.email": "Ίδιο email",
      "dup.reason.name": "Παρόμοιο όνομα",
      "dup.merged": "Οι επαφές συγχωνεύτηκαν",
      "dup.undo": "Αναίρεση",
      "dup.sect.def": "Βέβαια ταιριάσματα",
      "dup.sect.pos": "Πιθανά ταιριάσματα",
      "ct.avatar": "Φωτογραφία",
      "ct.avatar.up": "Μεταφόρτωση φωτογραφίας",
      "ct.avatar.rem": "Αφαίρεση",
      "ct.avatar.bad": "Η εικόνα δεν μπόρεσε να διαβαστεί",
      "ct.avatar.big": "Η εικόνα είναι πολύ μεγάλη μετά τη συμπίεση — δοκίμασε άλλη",
      "ct.field.relations": "Σχέσεις",
      "ct.add.relation": "＋ Σχέση",
      "ct.rel.pick": "— επαφή —",
      "ct.rel.in": "Σύνδεση από άλλες επαφές",
      "rel.spouse": "Σύζυγος",
      "rel.partner": "Σύντροφος",
      "rel.parent": "Γονέας",
      "rel.child": "Παιδί",
      "rel.sibling": "Αδελφός/ή",
      "rel.friend": "Φίλος/η",
      "rel.colleague": "Συνάδελφος",
      "rel.manager": "Αφεντικό",
      "rel.other": "Αλλη",
      "ct.back": "Πίσω",
      "ct.share": "Κοινοποίηση",
      "ct.familytree": "Οικογενειακό δέντρο",
      "ct.share.done": "Η επαφή αντιγράφηκε στο πρόχειρο",
      "ct.share.fail": "Η αντιγραφή απέτυχε — δοκίμασε ξανά",
      "ct.maps": "Εμφάνιση στον χάρτη"
    }
  };
  function t(k) {
    return (STR[LANG] && STR[LANG][k] !== undefined) ? STR[LANG][k]
         : (STR.en[k] !== undefined ? STR.en[k] : k);
  }
  function applyI18n() {
    var els = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute("data-i18n"));
    var phs = document.querySelectorAll("[data-i18n-ph]");
    for (var j = 0; j < phs.length; j++) phs[j].placeholder = t(phs[j].getAttribute("data-i18n-ph"));
    var airs = document.querySelectorAll("[data-i18n-aria]");
    for (var k = 0; k < airs.length; k++) airs[k].setAttribute("aria-label", t(airs[k].getAttribute("data-i18n-aria")));
  }

  // Boot marker (stale-bundle detection — R3/R11) + live lang attr
  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("contacts.js v" + (SCRIPT_V || "?") + " boot");
  })();

  function $(id) { return document.getElementById(id); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // Lazy singleton toast (orOS standard: top-right, text node FIRST,
  // optional action button SECOND, 5s auto-hide, single-slot).
  var toastEl = null, toastTimer = null;
  function hideToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (toastEl) toastEl.classList.remove("show");
  }
  function toast(text, actionLabel, actionFn) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "app-toast";
      document.body.appendChild(toastEl);
    }
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    toastEl.textContent = "";               // wipe before append
    toastEl.appendChild(document.createTextNode(text));
    if (actionLabel && typeof actionFn === "function") {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "app-toast-btn";
      b.textContent = actionLabel;
      b.addEventListener("click", function () {
        hideToast();
        actionFn();
      });
      toastEl.appendChild(b);
    }
    toastEl.classList.add("show");
    // Undo toasts stay 8 s (Part VII); plain notes 5 s.
    toastTimer = setTimeout(hideToast, (actionLabel && typeof actionFn === "function") ? 8000 : 5000);
  }

  // --- Unified notifications (Wave 12 migration) ---
  // Dynamic parent resolution + cross-origin guard; local toast()
  // remains as stale-bundle fallback for zero-crash boot.
  function notifyTransient(text) {
    try {
      var N = (window.parent && window.parent.orosNotifs) ||
               window.orosNotifs || null;
      if (N && typeof N.transient === "function") {
        N.transient({ ns: "contacts", title: text, body: "" });
        return;
      }
    } catch (e) { /* cross-origin guard */ }
    toast(text);
  }

  /* ---------- 2. State + schemas ---------- */
  var DATA_KEY = "oros-contacts-data";
  var state = { ver: 1, labels: [], contacts: [], deleted: [] };

  // Fixed label palette — identical bytes to the Calendar's, so a
  // label id + color pair renders the same hue in BOTH apps (the
  // birthday feed chip must match the Contacts side visually).
  var LABEL_PALETTE = [
    "#d4af37", "#a78bfa", "#7aa2f7", "#9ece6a",
    "#e06c75", "#ff9e64", "#4ec9b0", "#f28fb6"
  ];

  // Field type vocabularies (whitelist contract, mirrors Calendar's
  // REMIND_PRESETS doctrine: strict, enumerable, deterministic).
  var PHONE_TYPES = ["mobile", "home", "work", "main", "other"];
  var EMAIL_TYPES = ["home", "work", "other"];
  var ADDR_TYPES  = ["home", "work", "other"];
  var WEB_TYPES   = ["home", "work", "blog", "other"];
  var IM_TYPES    = ["home", "work", "other"];
  var EVENT_TYPES = ["birthday", "anniversary", "custom"];

  // Wave 2.3 — cross-contact relations. Stored ONLY on the
  // initiator (ONE record); the inverse direction is COMPUTED at
  // render time via the inverse map — no double-write, so no
  // merge races and no risk of half-updated pairs on sync.
  var RELATION_TYPES = ["spouse", "partner", "parent", "child",
                        "sibling", "friend", "colleague", "manager", "other"];
  var RELATION_INVERSE = {
    spouse: "spouse", partner: "partner",
    parent: "child",  child: "parent",
    sibling: "sibling", friend: "friend",
    colleague: "colleague", manager: "other", other: "other"
  };

  // Calendar day validity: year 2000 is leap → Feb 29 is legal.
  function validDay(day) {
    if (typeof day !== "string" || !/^\d{2}-\d{2}$/.test(day)) return false;
    var mm = +day.slice(0, 2), dd = +day.slice(3);
    if (mm < 1 || mm > 12 || dd < 1) return false;
    return dd <= new Date(2000, mm, 0).getDate();
  }

  // Seeds for fresh installs (mtime 0 → any user edit wins the merge
  // everywhere; identical bytes on every device — no Date.now() here).
  function defaultLabels() {
    return [
      { id: "lbl-personal", name: t("lbl.personal"), color: LABEL_PALETTE[0], mtime: 0 },
      { id: "lbl-work",     name: t("lbl.work"),     color: LABEL_PALETTE[4], mtime: 0 },
      { id: "lbl-family",   name: t("lbl.family"),   color: LABEL_PALETTE[3], mtime: 0 }
    ];
  }

  // Untouched seeds (mtime 0) follow the ACTIVE language — exact
  // mirror of calendar.js reseedSeedNames (merge-inert by design).
  function reseedSeedNames() {
    var map = {
      "lbl-personal": t("lbl.personal"),
      "lbl-work":     t("lbl.work"),
      "lbl-family":   t("lbl.family")
    };
    // #3 — seed colors must match the Calendar's defaults byte-for-
    // byte (shared palette): Personal gold, Work red, Family green.
    // mtime === 0 means never user-touched (every recolor bumps
    // mtime), so this migration can never override user intent.
    var seedColors = {
      "lbl-personal": LABEL_PALETTE[0],
      "lbl-work":     LABEL_PALETTE[4],
      "lbl-family":   LABEL_PALETTE[3]
    };
    var changed = false;
    state.labels.forEach(function (l) {
      if (l.mtime === 0 && map[l.id]) {
        if (l.name !== map[l.id]) {
          l.name = map[l.id];
          changed = true;
        }
        if (seedColors[l.id] && l.color !== seedColors[l.id]) {
          l.color = seedColors[l.id];
          changed = true;
        }
      }
    });
    if (changed) {
      try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {}
    }
  }

  function sanitizeLabel(l) {
    if (!l || typeof l !== "object") return null;
    if (typeof l.id !== "string" || !l.id) return null;
    if (LABEL_PALETTE.indexOf(l.color) === -1) return null;
    return {
      id: l.id,
      name: (typeof l.name === "string" ? l.name : "").slice(0, 40),
      color: l.color,
      mtime: (typeof l.mtime === "number" && isFinite(l.mtime)) ? l.mtime : 0
    };
  }

  function labelById(id) {
    for (var i = 0; i < state.labels.length; i++) {
      if (state.labels[i].id === id) return state.labels[i];
    }
    return null;
  }
  function labelColor(labelId) {
    var l = labelById(labelId);
    if (l) return l.color;
    var acc = "";
    try {
      acc = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent").trim();
    } catch (e) {}
    return acc || "#d4af37";
  }

  // Typed multi-field row sanitizers. Each takes a RAW row, returns
  // a normalized row or null (dropped — empty/invalid never stored).
  function sanVal(row, len, types) {
    if (!row || typeof row !== "object") return null;
    var v = (typeof row.v === "string" ? row.v : "").trim().slice(0, len);
    if (!v) return null;
    var ty = (types.indexOf(row.type) !== -1) ? row.type : "other";
    return { v: v, type: ty };
  }
  function sanAddr(row) {
    if (!row || typeof row !== "object") return null;
    var street = (typeof row.street === "string" ? row.street : "").trim().slice(0, 120);
    var city   = (typeof row.city   === "string" ? row.city   : "").trim().slice(0, 60);
    var zip    = (typeof row.zip    === "string" ? row.zip    : "").trim().slice(0, 20);
    var region = (typeof row.region === "string" ? row.region : "").trim().slice(0, 60);
    var country= (typeof row.country=== "string" ? row.country: "").trim().slice(0, 60);
    if (!street && !city && !zip && !region && !country) return null;
    var ty = (ADDR_TYPES.indexOf(row.type) !== -1) ? row.type : "other";
    return { street: street, city: city, zip: zip, region: region, country: country, type: ty };
  }
  function sanEvent(row) {
    if (!row || typeof row !== "object") return null;
    if (!validDay(row.day)) return null;
    var ty = (EVENT_TYPES.indexOf(row.type) !== -1) ? row.type : "custom";
    var year = null;
    if (typeof row.year === "number" && isFinite(row.year) &&
        row.year >= 1850 && row.year <= 2200) year = row.year;
    return {
      day: row.day,
      year: year,
      type: ty,
      label: (typeof row.label === "string" ? row.label : "").trim().slice(0, 40)
    };
  }

  function sanRelation(row) {
    if (!row || typeof row !== "object") return null;
    if (typeof row.with !== "string" || !row.with) return null;
    var ty = (RELATION_TYPES.indexOf(row.type) !== -1) ? row.type : "other";
    return { with: row.with, type: ty };
  }

  // Load-time sanitizer (lenient mtime fallback — the strict merge
  // twin lives in §9 with the no-Date.now() merge contract).
  function sanitizeContact(c) {
    if (!c || typeof c !== "object") return null;
    if (typeof c.id !== "string" || !c.id) return null;
    var seen = {};
    var lids = [];
    if (Array.isArray(c.labelIds)) {
      c.labelIds.forEach(function (lid) {
        if (typeof lid === "string" && lid && !seen[lid]) { seen[lid] = true; lids.push(lid); }
      });
    }
    lids.sort();   // deterministic bytes → JSON tie-break in merge
    return {
      id: c.id,
      given:    (typeof c.given === "string" ? c.given : "").slice(0, 60),
      middle:   (typeof c.middle === "string" ? c.middle : "").slice(0, 60),
      family:   (typeof c.family === "string" ? c.family : "").slice(0, 60),
      nickname: (typeof c.nickname === "string" ? c.nickname : "").slice(0, 60),
      org:      (typeof c.org === "string" ? c.org : "").slice(0, 80),
      jobTitle: (typeof c.jobTitle === "string" ? c.jobTitle : "").slice(0, 80),
      phones:    (Array.isArray(c.phones) ? c.phones : []).map(function (r) { return sanVal(r, 40, PHONE_TYPES); }).filter(Boolean),
      emails:    (Array.isArray(c.emails) ? c.emails : []).map(function (r) { return sanVal(r, 120, EMAIL_TYPES); }).filter(Boolean),
      addresses: (Array.isArray(c.addresses) ? c.addresses : []).map(sanAddr).filter(Boolean),
      websites:  (Array.isArray(c.websites) ? c.websites : []).map(function (r) { return sanVal(r, 300, WEB_TYPES); }).filter(Boolean),
      im:        (Array.isArray(c.im) ? c.im : []).map(function (r) { return sanVal(r, 120, IM_TYPES); }).filter(Boolean),
      events:    (Array.isArray(c.events) ? c.events : []).map(sanEvent).filter(Boolean)
                   .sort(function (a, b) { return a.type < b.type ? -1 : (a.type > b.type ? 1 : (a.day < b.day ? -1 : 1)); }),
      relations: (function () {
        var seen = {}, out = [];
        (Array.isArray(c.relations) ? c.relations : []).forEach(function (r) {
          var s = sanRelation(r);
          if (s && !seen[s.with + "|" + s.type]) { seen[s.with + "|" + s.type] = 1; out.push(s); }
        });
        out.sort(function (a, b) { return a.with < b.with ? -1 : (a.with > b.with ? 1 : 0); });
        return out;   // deterministic bytes → JSON tie-break in merge
      })(),
      labelIds:  lids,
      starred:   c.starred === true,
      note:      (typeof c.note === "string" ? c.note : "").slice(0, 500),
      photo:     (typeof c.photo === "string" && /^data:image\/(jpeg|png);base64,/.test(c.photo)) ? c.photo.slice(0, 50000) : null,
      mtime:     (typeof c.mtime === "number" && isFinite(c.mtime)) ? c.mtime : Date.now()
    };
  }

  // Tombstones: { id, mtime } — same shared-list contract as the
  // Calendar (contacts + labels die through ONE list).
  function sanitizeTomb(d) {
    if (!d || typeof d !== "object") return null;
    if (typeof d.id !== "string" || !d.id) return null;
    return {
      id: d.id,
      mtime: (typeof d.mtime === "number" && isFinite(d.mtime)) ? d.mtime : Date.now()
    };
  }

  function loadState() {
    var rawText = null;
    try {
      rawText = localStorage.getItem(DATA_KEY);
      var d = JSON.parse(rawText);
      // CT-3: stored text that is not a contacts object would be
      // overwritten by the first save — keep a verbatim rescue copy
      // first (device-local, never synced).
      if (rawText && (!d || typeof d !== "object" || !Array.isArray(d.contacts))) rescueRaw(rawText);
      if (d && typeof d === "object" && Array.isArray(d.contacts)) {
        state.contacts = d.contacts.map(sanitizeContact).filter(Boolean);
      }
      if (d && Array.isArray(d.deleted)) {
        state.deleted = d.deleted.map(sanitizeTomb).filter(Boolean);
      }
      if (d && Array.isArray(d.labels)) {
        state.labels = d.labels.map(sanitizeLabel).filter(Boolean);
      }
      if (!state.labels.length) state.labels = defaultLabels();
    } catch (e) {
      rescueRaw(rawText);
      if (!state.labels.length) state.labels = defaultLabels();
    }
  }
  function rescueRaw(text) {
    if (!text) return;
    try { localStorage.setItem(DATA_KEY + "-broken", text); } catch (e) {}
    try { console.error("contacts: unreadable data copied to " + DATA_KEY + "-broken"); } catch (e) {}
  }
  function saveState() {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {}
    markDirty();
  }

  // Shell sync bridge — canonical __orosSyncApi funnel (Part VII).
  function markDirty() {
    try {
      if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    } catch (e) {}
  }

  // orosDialog lives in the parent shell (same-origin iframe).
  // Standalone PWA mode -> null -> caller uses local fallback.
  function dialogHost() {
    try {
      return window.orosDialog || window.parent.orosDialog || null;
    } catch (e) { return null; }
  }

  /* ---------- 3. Display helpers ---------- */
  function displayName(c) {
    var parts = [c.given, c.middle, c.family].filter(Boolean);
    if (parts.length) return parts.join(" ");
    if (c.nickname) return c.nickname;
    if (c.org) return c.org;
    return t("ct.unnamed");
  }
  function initials(c) {
    var a = (c.given || "").charAt(0);
    var b = (c.family || c.org || c.nickname || "").charAt(0);
    var s = (a + b).toUpperCase();
    return s || "?";
  }
  function subLine(c) {
    if (c.jobTitle && c.org) return c.jobTitle + " · " + c.org;
    if (c.org) return c.org;
    if (c.jobTitle) return c.jobTitle;
    if (c.phones.length) return c.phones[0].v;
    if (c.emails.length) return c.emails[0].v;
    if (c.events.length) {
      var ev = c.events[0];
      return t("evt." + ev.type) + (ev.year ? " · " + ev.year : "");
    }
    return "";
  }
  // Phone-normalized search digits: "69…" matches "+30 69…".
  function phoneDigits(s) {
    return String(s || "").replace(/\D+/g, "");
  }

  // ===== TRANSLITERATION SEARCH (Wave 2.3) =====
  // greekFold: lowercase + accent-strip (ά→α, ή→η…) + ς→σ.
  // Latin passes through untouched. latinize: greekFold +
  // Greek→Latin letter map — "dionisis" finds "Διονύσης".
  // SEARCH-ONLY: nothing is ever stored transliterated.
  function greekFold(s) {
    var n = String(s || "").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return n.replace(/ς/g, "σ");
  }
  var LATIN_MAP = {
    "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z",
    "η": "i", "θ": "th", "ι": "i", "κ": "k", "λ": "l", "μ": "m",
    "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s",
    "τ": "t", "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o"
  };
  function latinize(s) {
    var f = greekFold(s);
    var out = "";
    for (var i = 0; i < f.length; i++) {
      out += (LATIN_MAP[f.charAt(i)] !== undefined) ? LATIN_MAP[f.charAt(i)] : f.charAt(i);
    }
    return out;
  }
  function contactById(id) {
    for (var i = 0; i < state.contacts.length; i++) {
      if (state.contacts[i].id === id) return state.contacts[i];
    }
    return null;
  }
  // Text haystack per contact: own fields + names of related
  // contacts (searching "Maria" finds everyone married to a Maria).
  function searchHay(c) {
    var hay = [displayName(c), c.nickname, c.org, c.jobTitle, c.note].join(" ");
    (c.relations || []).forEach(function (r) {
      var o = contactById(r.with);
      if (o) hay += " " + displayName(o);
    });
    return hay;
  }
  // Relations pointing AT this contact — COMPUTED inverse, never
  // stored. Deleted targets are skipped by contactById returning
  // null wherever used (dangling refs are render-safe by design).
  function incomingRelations(c) {
    var out = [];
    state.contacts.forEach(function (o) {
      if (o.id === c.id) return;
      (o.relations || []).forEach(function (r) {
        if (r.with === c.id) out.push({ id: o.id, type: RELATION_INVERSE[r.type] || "other" });
      });
    });
    return out;
  }

  // ===== DUPLICATE DETECTION ENGINE =====
  // Union-find structure for grouping contacts by match criteria.
  // Matches are definitive (email/phone) or possible (name-only).
  function normalizeEmail(e) {
    return String(e || "").toLowerCase().trim();
  }
  function nameKey(c) {
    // Normalization: given+family, accent-folded via greekFold
    // (lowercase + diacritics strip + ς→σ), so "Διονύσης" and
    // "Διονυσης" collapse to one dedup key.
    var s = greekFold([c.given, c.family].filter(Boolean).join(" "));
    return s.replace(/\s+/g, " ").trim();
  }

  // Union-Find data structure for contact IDs.
  function UnionFind(ids) {
    this.parent = {};
    this.rank = {};
    ids.forEach(function (id) {
      this.parent[id] = id;
      this.rank[id] = 0;
    }.bind(this));
  }
  UnionFind.prototype.find = function (x) {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  };
  UnionFind.prototype.union = function (x, y) {
    var rx = this.find(x), ry = this.find(y);
    if (rx === ry) return;
    if (this.rank[rx] < this.rank[ry]) this.parent[rx] = ry;
    else if (this.rank[rx] > this.rank[ry]) this.parent[ry] = rx;
    else { this.parent[ry] = rx; this.rank[rx]++; }
  };

  // Scan contacts for duplicates. Returns { definitive: [], possible: [] }.
  // definitive = shared email OR shared normalized phone.
  // possible = name key collision (needs second signal).
  function scanDuplicates() {
    var ids = state.contacts.map(function (c) { return c.id; });
    var uf = new UnionFind(ids);
    var definitive = [];
    var possible = [];

    // Build lookup maps for email/phone → contact IDs.
    var emailMap = {}, phoneMap = {};
    state.contacts.forEach(function (c) {
      c.emails.forEach(function (e) {
        var em = normalizeEmail(e.v);
        if (!emailMap[em]) emailMap[em] = [];
        emailMap[em].push(c.id);
      });
      c.phones.forEach(function (p) {
        var pd = phoneDigits(p.v);
        if (pd.length < 5) return; // too short to be meaningful
        if (!phoneMap[pd]) phoneMap[pd] = [];
        phoneMap[pd].push(c.id);
      });
    });

    // Definitive matches: shared email or phone.
    // Also compute name collision groups for "possible matches".
    Object.keys(emailMap).forEach(function (em) {
      var group = emailMap[em];
      if (group.length < 2) return;
      for (var i = 0; i < group.length - 1; i++) {
        uf.union(group[i], group[i + 1]);
      }
    });
    Object.keys(phoneMap).forEach(function (pd) {
      var group = phoneMap[pd];
      if (group.length < 2) return;
      for (var j = 0; j < group.length - 1; j++) {
        uf.union(group[j], group[j + 1]);
      }
    });

    // Name-based collision groups (separate from definitive).
    var nameMap = {};
    state.contacts.forEach(function (c) {
      var nk = nameKey(c);
      if (!nk || nk.length < 2) return; // too short to be meaningful
      if (!nameMap[nk]) nameMap[nk] = [];
      nameMap[nk].push(c.id);
    });
    Object.keys(nameMap).forEach(function (nk) {
      var group = nameMap[nk];
      if (group.length < 2) return;
      for (var ni = 0; ni < group.length - 1; ni++) {
        uf.union(group[ni], group[ni + 1]);
      }
    });

    // Group by root ID.
    var groups = {};
    ids.forEach(function (id) {
      var root = uf.find(id);
      if (!groups[root]) groups[root] = [];
      groups[root].push(id);
    });

    // Filter to groups with 2+ members.
    Object.keys(groups).forEach(function (root) {
      var mem = groups[root];
      if (mem.length < 2) return;
      var members = mem.map(function (id) {
        return state.contacts.find(function (c) { return c.id === id; });
      });
      // Pair-wise ANY-to-ANY check (members[0]-centric check lied for
      // chained groups: A~B by email, B~C by name → whole group judged
      // from A alone could miss the definitive pair).
      function pairShare(listOf, normOf) {
        for (var i = 0; i < members.length; i++) {
          for (var j = i + 1; j < members.length; j++) {
            var ai = listOf(members[i]), bj = listOf(members[j]);
            for (var x = 0; x < ai.length; x++) {
              for (var y = 0; y < bj.length; y++) {
                if (normOf(ai[x]) === normOf(bj[y])) return true;
              }
            }
          }
        }
        return false;
      }
      var hasSharedEmail = pairShare(function (m) { return m.emails; },
                                     function (e) { return normalizeEmail(e.v); });
      var hasSharedPhone = pairShare(function (m) { return m.phones; },
                                     function (p) { return phoneDigits(p.v); });
      var hasDefinite = hasSharedEmail || hasSharedPhone;
      var reason = hasSharedEmail ? t("dup.reason.email")
                 : (hasSharedPhone ? t("dup.reason.phone") : t("dup.reason.name"));
      var groupObj = { ids: mem, reason: reason, definitive: hasDefinite };
      if (hasDefinite) definitive.push(groupObj);
      else possible.push(groupObj);
    });

    return { definitive: definitive, possible: possible };
  }

  // Render duplicate groups into a dialog.
  function renderDupDialog(scanResult) {
    var box = $("dedup-groups");
    box.textContent = "";
    var noneMsg = $("dedup-none");
    var hasAny = scanResult.definitive.length + scanResult.possible.length > 0;
    noneMsg.hidden = hasAny;

    if (!hasAny) {
      noneMsg.textContent = t("dup.none");
      return;
    }

    // Helper to create a group row.
    function makeGroupRow(group, idx) {
      var div = document.createElement("div");
      div.className = "dup-group";

      var head = document.createElement("div");
      head.className = "dup-group-head";
      var badge = document.createElement("span");
      badge.className = "dup-badge";
      badge.textContent = group.ids.length + " " + t("dup.count");
      var reason = document.createElement("span");
      reason.textContent = " · " + group.reason;
      head.appendChild(badge);
      head.appendChild(reason);
      div.appendChild(head);

      // Mini contact rows for each member.
      var list = document.createElement("ul");
      list.className = "dup-members";
      group.ids.forEach(function (id) {
        var c = state.contacts.find(function (x) { return x.id === id; });
        if (!c) return;
        var li = document.createElement("li");
        // Real button (not plain li) — Enter/Space work, same as the
        // main list rows; focus-visible outline comes free.
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ct-row dup-member";
        btn.appendChild(mkAvatarEl(c));
        var main = document.createElement("div");
        main.className = "ct-main";
        var nm = document.createElement("div");
        nm.className = "ct-name";
        nm.textContent = displayName(c);
        main.appendChild(nm);
        var sb = subLine(c);
        if (sb) {
          var sub = document.createElement("div");
          sub.className = "ct-sub";
          sub.textContent = sb;
          main.appendChild(sub);
        }
        btn.appendChild(main);
        // Click OR keyboard opens the merge dialog for this group.
        (function (gid) {
          btn.addEventListener("click", function () { openMergeDlg(gid); });
        })(group.ids);
        li.appendChild(btn);
        list.appendChild(li);
      });
      div.appendChild(list);

      return div;
    }

    // Section: definitive matches.
    if (scanResult.definitive.length) {
      var secDef = document.createElement("div");
      var hDef = document.createElement("h4");
      hDef.textContent = t("dup.sect.def");
      secDef.appendChild(hDef);
      scanResult.definitive.forEach(function (g, i) {
        secDef.appendChild(makeGroupRow(g, i));
      });
      box.appendChild(secDef);
    }

    // Section: possible matches.
    if (scanResult.possible.length) {
      var secPos = document.createElement("div");
      var hPos = document.createElement("h4");
      hPos.textContent = t("dup.sect.pos");
      secPos.appendChild(hPos);
      scanResult.possible.forEach(function (g, i) {
        secPos.appendChild(makeGroupRow(g, i));
      });
      box.appendChild(secPos);
    }
  }

  // Label visibility: id -> true/false. Absent = visible.
  var labelVis = {};
  function labelVisible(labelId) {
    if (!labelId) return true;
    return labelVis[labelId] !== false;
  }
  function anyLabelVisible(c) {
    if (!c.labelIds.length) return true;
    for (var i = 0; i < c.labelIds.length; i++) {
      if (labelVis[c.labelIds[i]] !== false) return true;
    }
    return false;
  }

  var searchQ = "";

  // Quick filter (Wave 1): "all" | "starred". Keeps the exclusive
  // filter separate from the label VISIBILITY toggles in the chips.
  var quickFilter = "all";
  function setQuickFilter(mode) {
    quickFilter = mode;
    renderChips();
    renderList();
  }
  // Injected styling for the active quick-filter chip (self-
  // contained — no dependency on unseen contacts.css selectors).
  (function () {
    var st = document.createElement("style");
    st.textContent =
      ".chip.qf{font-weight:600}" +
      ".chip.qf.on{border-color:var(--accent,#d4af37);" +
        "color:var(--accent,#d4af37);" +
        "background:var(--accent-soft,rgba(212,175,55,.15))}";
    document.head.appendChild(st);
  })();

  /* ---------- 4. List render ---------- */
  function renderList() {
    var ul = $("ct-list");
    ul.textContent = "";

    var q = searchQ.trim().toLowerCase();
    var qDigits = phoneDigits(q);
    var qFold = greekFold(q);

    var hits = state.contacts.filter(function (c) {
      if (quickFilter === "starred" && !c.starred) return false;
      if (!anyLabelVisible(c)) return false;
      if (!q) return true;
      // Layer 1: accent-insensitive direct match (Greek↔Greek).
      // Layer 2: transliterated match (Latin query → Greek names).
      var hay = searchHay(c);
      if (greekFold(hay).indexOf(qFold) !== -1) return true;
      if (latinize(hay).indexOf(q) !== -1) return true;
      if (qDigits.length >= 3) {
        for (var i = 0; i < c.phones.length; i++) {
          if (phoneDigits(c.phones[i].v).indexOf(qDigits) !== -1) return true;
        }
      }
      for (var j = 0; j < c.emails.length; j++) {
        if (c.emails[j].v.toLowerCase().indexOf(q) !== -1) return true;
      }
      return false;
    }).sort(function (a, b) {
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      // Accent-insensitive collation: "Ήλιος" sorts with H, not last.
      var la = greekFold(displayName(a)).localeCompare(greekFold(displayName(b)), LANG);
      return la !== 0 ? la : (a.id < b.id ? -1 : 1);
    });

    if (!hits.length) {
      var emp = document.createElement("li");
      emp.className = "empty";
      emp.textContent = t(q ? "ct.search.none" : "ct.none");
      ul.appendChild(emp);
      return;
    }

    hits.forEach(function (c) {
      var li = document.createElement("li");
      var row = document.createElement("button");
      row.type = "button";
      row.className = "ct-row";

      row.appendChild(mkAvatarEl(c));

      var main = document.createElement("div");
      main.className = "ct-main";
      var nm = document.createElement("div");
      nm.className = "ct-name";
      nm.textContent = displayName(c);
      main.appendChild(nm);
      var sb = subLine(c);
      if (sb) {
        var sub = document.createElement("div");
        sub.className = "ct-sub";
        sub.textContent = sb;
        main.appendChild(sub);
      }
      row.appendChild(main);

      if (c.labelIds.length) {
        var tags = document.createElement("span");
        tags.className = "ct-tags";
        c.labelIds.forEach(function (lid) {
          var tg = document.createElement("span");
          tg.className = "ct-tag";
          tg.style.background = labelColor(lid);
          tags.appendChild(tg);
        });
        row.appendChild(tags);
      }
      if (c.starred) {
        var st = document.createElement("span");
        st.className = "ct-star";
        st.textContent = "★";
        row.appendChild(st);
      }

      (function (cc) {
        row.addEventListener("click", function () { openViewCard(cc); });
      })(c);

      li.appendChild(row);
      ul.appendChild(li);
    });
  }

  /* ---------- 4b. Label filter chips (calendar mirror) ---------- */
  function renderChips() {
    var row = $("lbl-chips");
    row.textContent = "";

    // Quick filter tabs first (exclusive), then label chips (visibility).
    ["all", "starred"].forEach(function (mode) {
      var q = document.createElement("button");
      q.type = "button";
      q.className = "chip qf" + (quickFilter === mode ? " on" : "");
      q.textContent = mode === "all" ? t("ct.filter.all") : "★ " + t("ct.filter.starred");
      q.addEventListener("click", function () { setQuickFilter(mode); });
      row.appendChild(q);
    });

    state.labels.forEach(function (l) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "chip" + (labelVisible(l.id) ? "" : " off");
      c.style.setProperty("--chip", l.color);
      var dot = document.createElement("span");
      dot.className = "chip-dot";
      dot.style.background = l.color;
      c.appendChild(dot);
      c.appendChild(document.createTextNode(l.name));
      c.addEventListener("click", function () {
        labelVis[l.id] = !labelVisible(l.id);
        renderChips();
        renderList();
      });
      row.appendChild(c);
    });
    var mg = document.createElement("button");
    mg.type = "button";
    mg.className = "chip chip-manage";
    mg.textContent = "＋ " + t("lbl.manage");
    mg.addEventListener("click", openLblDlg);
    row.appendChild(mg);
  }

  var searchDebounceTimer = null;
  if ($("search-in")) {
    $("search-in").addEventListener("input", function () {
      var v = this.value;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(function () {
        searchQ = v;
        renderList();
      }, 250);
    });
  }
  if ($("imp-done")) {
    $("imp-done").addEventListener("click", function () {
      $("import-sec").hidden = true;
      $("imp-list").textContent = "";
    });
  }

// ===== VIEW CARD (#4 — read-only contact card) =====
// List rows open a READ card first; Edit lives behind a button on
// the card. The shell deep-link (__orosContactsOpen) lands on the
// same card. Fully JS-built with injected styles — no dependency
// on unseen contacts.css selectors.

var VIEW_CSS_DONE = false;
function ensureViewCss() {
  if (VIEW_CSS_DONE) return;
  VIEW_CSS_DONE = true;
  var st = document.createElement("style");
  st.textContent =
    "#ct-view{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.5);" +
      "display:flex;justify-content:center;overflow:auto;" +
      "padding:24px 12px}" +
    ".ct-view-card{margin:auto;background:var(--panel-bg,#22242a);color:var(--text,#eee);" +
      "border:1px solid var(--border,#333);border-radius:14px;" +
      "box-shadow:var(--shadow,0 8px 30px rgba(0,0,0,.4));" +
      "width:100%;max-width:480px;padding:18px 18px 16px;position:relative}" +
    ".ct-view-x{position:absolute;top:10px;right:10px;width:30px;height:30px;" +
      "border:1px solid var(--border,#333);border-radius:8px;background:transparent;" +
      "color:var(--text-dim,#999);cursor:pointer;font-size:14px;line-height:1}" +
    ".ct-view-head{display:flex;flex-direction:column;align-items:center;gap:8px;" +
      "text-align:center}" +
    "#ct-view .ct-avatar{width:76px;height:76px;border-radius:50%;font-size:24px}" +
    "#ct-view .ct-avatar-img{width:76px;height:76px;border-radius:50%;object-fit:cover}" +
    ".ct-view-name{font-size:19px;font-weight:700;margin:0}" +
    ".ct-view-sub{font-size:12.5px;color:var(--text-dim,#999);margin:0}" +
    ".ct-view-star{color:#d4af37;font-size:13px}" +
    ".ct-view-lbls{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:10px 0 4px}" +
    ".ct-vs-title{font-size:11px;font-weight:700;text-transform:uppercase;" +
      "letter-spacing:.06em;color:var(--text-dim,#999);margin:16px 0 6px}" +
    ".ct-vs-row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;" +
      "border-top:1px solid var(--border,#333);font-size:13px;align-items:baseline}" +
    ".ct-vs-key{color:var(--text-dim,#999);flex-shrink:0}" +
    ".ct-vs-val{color:var(--text,#eee);text-decoration:none;word-break:break-word;text-align:right}" +
    "a.ct-vs-val:hover{color:var(--accent,#d4af37);text-decoration:underline}" +
    ".ct-vs-val.map-link{cursor:pointer}" +
    ".ct-vs-val.map-link:hover{color:var(--accent,#d4af37);text-decoration:underline}" +
    ".ct-view-note{font-size:13px;white-space:pre-wrap;line-height:1.5;" +
      "padding-top:8px;border-top:1px solid var(--border,#333)}" +
    ".ct-view-foot{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:18px}" +
    ".ct-view-share{border:1px solid var(--border,#333);background:transparent;" +
      "color:var(--text-dim,#999);border-radius:8px;padding:8px 18px;font:inherit;" +
      "cursor:pointer;font-weight:600}" +
    ".ct-view-share:hover{color:var(--text,#eee);border-color:var(--text-dim,#999)}" +
    ".ct-view-edit{border:1px solid var(--accent,#d4af37);background:transparent;" +
      "color:var(--accent,#d4af37);border-radius:8px;padding:8px 18px;font:inherit;" +
      "cursor:pointer;font-weight:600}" +
    ".ct-view-edit:hover{background:var(--accent-soft,rgba(212,175,55,.15))}" +
    "@media (max-width:520px){" +
      "#ct-view{padding:0;align-items:stretch}" +
      ".ct-view-card{max-width:none;border-radius:0;border:none;min-height:100%}}";
  document.head.appendChild(st);
}

var viewCardId = null;   // CT-2: which contact the open card shows
function closeViewCard() {
  var ov = $("ct-view");
  if (ov) ov.parentNode.removeChild(ov);
  viewCardId = null;
}

// Full plain-text dump of a contact — one line per field, typed,
// search-friendly. Same content goes to the clipboard (desktop)
// and the Web Share sheet (mobile).
function shareText(c) {
  var L = [];
  var head = displayName(c);
  var sb = subLine(c);
  L.push(sb ? head + " — " + sb : head);
  if (c.nickname) L.push(t("ct.field.nickname") + ": " + c.nickname);
  if (c.org) L.push(t("ct.field.org") + ": " + c.org);
  if (c.jobTitle) L.push(t("ct.field.jobtitle") + ": " + c.jobTitle);
  c.phones.forEach(function (p) {
    L.push(t("ct.field.phones") + " (" + t("ty." + p.type) + "): " + p.v);
  });
  c.emails.forEach(function (e) {
    L.push(t("ct.field.emails") + " (" + t("ty." + e.type) + "): " + e.v);
  });
  c.addresses.forEach(function (a) {
    var txt = [a.street, a.city, [a.zip, a.region].filter(Boolean).join(" "), a.country]
      .filter(Boolean).join(", ");
    L.push(t("ct.field.addresses") + " (" + t("ty." + a.type) + "): " + txt);
  });
  c.websites.forEach(function (w) {
    L.push(t("ct.field.websites") + " (" + t("ty." + w.type) + "): " + w.v);
  });
  c.im.forEach(function (m) {
    L.push(t("ct.field.im") + " (" + t("ty." + m.type) + "): " + m.v);
  });
  c.events.forEach(function (e) {
    L.push(t("evt." + e.type) + ": " + evtDateText(e));
  });
  (c.relations || []).forEach(function (r) {
    var o = contactById(r.with);
    L.push(t("rel." + r.type) + ": " + (o ? displayName(o) : t("ct.unnamed")));
  });
  if (c.note) L.push(t("ct.field.note") + ": " + c.note);
  return L.join("\n");
}

// Legacy fallback for non-secure contexts / older browsers where
// the async Clipboard API is unavailable (execCommand path).
function legacyCopy(text) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try { ok = document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
  return ok;
}

// Mobile-only native share: desktop browsers (Chrome/Edge on
// Windows expose navigator.share → Windows Share sheet) must NOT
// use it. Detection: navigator.share exists AND touch-capable AND
// NOT a desktop UA. Android UAs contain "Android" (never "X11"),
// iOS/iPadOS are touch-only — both pass cleanly.
function shareOnMobile() {
  if (!navigator.share) return false;
  if (/Windows NT|Macintosh|X11|CrOS/.test(navigator.userAgent)) return false;
  if (navigator.maxTouchPoints === 0 && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return false;
  return true;
}

// Mobile → native share sheet with the full text.
// Desktop (incl. Windows) → clipboard copy + toast. Nothing stored.
function shareContact(c) {
  var text = shareText(c);
  if (shareOnMobile()) {
    navigator.share({ title: displayName(c), text: text }).catch(function () {});
    return;
  }
  var done = function () { notifyTransient(t("ct.share.done")); };
  var fail = function () { notifyTransient(t("ct.share.fail")); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () {
      if (legacyCopy(text)) done(); else fail();
    });
    return;
  }
  if (legacyCopy(text)) done(); else fail();
}

// ===== MAPS BRIDGE (Wave 6) =====
// Structured address → geocode query. Field order mirrors
// shareText's address line: street, city, "zip region", country.
function addrToQuery(a) {
  return [a.street, a.city,
    [a.zip, a.region].filter(Boolean).join(" "), a.country]
    .filter(Boolean).join(", ");
}

// Shell bridge: parent dispatch (__orosMapsOpen) when running
// inside orOS — live push if Maps is open, staged open otherwise.
// Standalone fallback: maps page in a new tab with ?q= (geocode
// on boot, see maps.js PATCH-47).
function openInMaps(query, label) {
  try {
    if (window.parent &&
        typeof window.parent.__orosOpenMapsQuery === "function") {
      window.parent.__orosOpenMapsQuery(query, label || "");
      return;
    }
  } catch (e) { /* cross-origin guard */ }
  window.open("/maps/?q=" + encodeURIComponent(query),
    "_blank", "noopener,noreferrer");
}

// One row: dim key on the left, value on the right (link when an
// href is given). RETURNS the value node so callers can attach
// click handlers (incoming-relation navigation).
function viewRow(parent, key, text, href) {
  var row = document.createElement("div");
  row.className = "ct-vs-row";
  var k = document.createElement("span");
  k.className = "ct-vs-key";
  k.textContent = key;
  var v;
  if (href) {
    v = document.createElement("a");
    v.href = href;
    if (/^https?:/i.test(href)) { v.target = "_blank"; v.rel = "noopener noreferrer"; }
  } else {
    v = document.createElement("span");
  }
  v.className = "ct-vs-val";
  v.textContent = text;
  row.appendChild(k);
  row.appendChild(v);
  parent.appendChild(row);
  return v;
}

function viewSection(card, titleKey) {
  var h = document.createElement("div");
  h.className = "ct-vs-title";
  h.textContent = t(titleKey);
  var body = document.createElement("div");
  card.appendChild(h);
  card.appendChild(body);
  return body;
}

function evtDateText(ev) {
  return ev.year ? (ev.year + "-" + ev.day) : ev.day;
}

function openViewCard(c) {
  if (!c) return;
  closeViewCard();
  ensureViewCss();
  viewCardId = c.id;

  var ov = document.createElement("div");
  ov.id = "ct-view";
  var card = document.createElement("div");
  card.className = "ct-view-card";

  var x = document.createElement("button");
  x.type = "button";
  x.className = "ct-view-x";
  x.textContent = "✕";
  x.setAttribute("aria-label", t("ct.back"));
  x.addEventListener("click", closeViewCard);
  card.appendChild(x);

  var head = document.createElement("div");
  head.className = "ct-view-head";
  head.appendChild(mkAvatarEl(c));
  var nm = document.createElement("h2");
  nm.className = "ct-view-name";
  nm.textContent = displayName(c);
  head.appendChild(nm);
  var sb = subLine(c);
  if (sb) {
    var sub = document.createElement("p");
    sub.className = "ct-view-sub";
    sub.textContent = sb;
    head.appendChild(sub);
  }
  if (c.starred) {
    var star = document.createElement("span");
    star.className = "ct-view-star";
    star.textContent = "★";
    head.appendChild(star);
  }
  card.appendChild(head);

  if (c.labelIds.length) {
    var lbls = document.createElement("div");
    lbls.className = "ct-view-lbls";
    c.labelIds.forEach(function (lid) {
      var l = labelById(lid);
      if (!l) return;
      var chip = document.createElement("span");
      chip.className = "chip";
      chip.style.setProperty("--chip", l.color);
      var dot = document.createElement("span");
      dot.className = "chip-dot";
      dot.style.background = l.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(l.name));
      lbls.appendChild(chip);
    });
    card.appendChild(lbls);
  }

  if (c.phones.length) {
    var ph = viewSection(card, "ct.field.phones");
    c.phones.forEach(function (p) {
      viewRow(ph, t("ty." + p.type), p.v,
        "tel:" + p.v.replace(/[\s()\u2013\u2014-]/g, ""));
    });
  }
  if (c.emails.length) {
    var em = viewSection(card, "ct.field.emails");
    c.emails.forEach(function (e) {
      viewRow(em, t("ty." + e.type), e.v, "mailto:" + e.v);
    });
  }
  if (c.addresses.length) {
    var ad = viewSection(card, "ct.field.addresses");
    c.addresses.forEach(function (a) {
      var txt = addrToQuery(a);
      var v = viewRow(ad, t("ty." + a.type), txt);
      v.classList.add("map-link");
      v.title = t("ct.maps");
      v.insertAdjacentHTML("beforeend",
        ' <svg width="11" height="11" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round" style="opacity:.6;vertical-align:-1px">' +
        '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>' +
        '<circle cx="12" cy="10" r="3"/></svg>');
      v.addEventListener("click", function () {
        openInMaps(txt, displayName(c));
      });
    });
  }
  if (c.websites.length) {
    var wb = viewSection(card, "ct.field.websites");
    c.websites.forEach(function (w) {
      var href = /^https?:/i.test(w.v) ? w.v : ("https://" + w.v);
      viewRow(wb, t("ty." + w.type), w.v, href);
    });
  }
  if (c.im.length) {
    var im = viewSection(card, "ct.field.im");
    c.im.forEach(function (m) {
      viewRow(im, t("ty." + m.type), m.v);
    });
  }
  if (c.events.length) {
    var ev = viewSection(card, "ct.field.events");
    c.events.forEach(function (e) {
      var key = t("evt." + e.type) +
        ((e.type === "custom" && e.label) ? " · " + e.label : "");
      viewRow(ev, key, evtDateText(e));
    });
  }
  var outRels = c.relations || [];
  var incRels = incomingRelations(c);
  if (outRels.length || incRels.length) {
    var rl = viewSection(card, "ct.field.relations");
    outRels.forEach(function (r) {
      var o = contactById(r.with);
      var v = viewRow(rl, t("rel." + r.type),
        o ? displayName(o) : t("ct.unnamed"));
      if (o) {
        v.style.cursor = "pointer";
        v.addEventListener("click", function () { openViewCard(o); });
      }
    });
    incRels.forEach(function (r) {
      var o = contactById(r.id);
      if (!o) return;
      var v = viewRow(rl, t("rel." + r.type), displayName(o));
      v.style.cursor = "pointer";
      v.addEventListener("click", function () { openViewCard(o); });
    });
  }
  if (c.note) {
    var nt = viewSection(card, "ct.field.note");
    var p = document.createElement("div");
    p.className = "ct-view-note";
    p.textContent = c.note;
    nt.appendChild(p);
  }

  var foot = document.createElement("div");
  foot.className = "ct-view-foot";
  var sh = document.createElement("button");
  sh.type = "button";
  sh.className = "ct-view-share";
  sh.textContent = t("ct.share");
  sh.addEventListener("click", function () {
    shareContact(c);
  });
  foot.appendChild(sh);
  // Family Tree (read-only bridge, generic deep link): the person
  // linked to this contact, or Family Tree's "Build from Contacts"
  // starting here. Shown only inside the shell.
  var shell = null;
  try { shell = window.parent !== window && typeof window.parent.__orosOpenAt === "function" ? window.parent : null; } catch (e) {}
  if (shell) {
    var ft = document.createElement("button");
    ft.type = "button";
    ft.className = "ct-view-share";
    ft.textContent = t("ct.familytree");
    ft.addEventListener("click", function () {
      closeViewCard();
      shell.__orosOpenAt("familytree", { contact: c.id });
    });
    foot.appendChild(ft);
  }
  var ed = document.createElement("button");
  ed.type = "button";
  ed.className = "ct-view-edit";
  ed.textContent = t("ct.dlg.edit");
  ed.addEventListener("click", function () {
    closeViewCard();
    openDlg(c);
  });
  foot.appendChild(ed);
  card.appendChild(foot);

  ov.addEventListener("click", function (e) {
    if (e.target === ov) closeViewCard();
  });
  ov.appendChild(card);
  document.body.appendChild(ov);
}

// Global shortcuts. Ctrl+N is browser-reserved (cannot be
// intercepted in Chrome) — new contact uses Alt+N instead.
document.addEventListener("keydown", function (e) {
  // Ctrl/Cmd+F — focus search (browser find intentionally
  // overridden). Guarded: skipped while a dialog or the view card
  // is open, so focus never leaves an open modal's inputs.
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey &&
      (e.key === "f" || e.key === "F")) {
    var busy = ["ct-dlg", "del-dlg", "merge-dlg", "lbl-dlg"]
      .some(function (id) { var d = $(id); return d && d.open; })
      || !!$("ct-view");
    if (busy) return;
    var si = $("search-in");
    if (si) {
      e.preventDefault();
      si.focus();
      si.select();
    }
    return;
  }
  // Alt+N — new contact (guarded: never closes an open edit
  // dialog — an accidental shortcut must not silently discard
  // typed input)
  if (e.altKey && !e.ctrlKey && !e.metaKey &&
      (e.key === "n" || e.key === "N")) {
    var anyOpen = ["ct-dlg", "del-dlg", "merge-dlg", "lbl-dlg"]
      .some(function (id) { var d = $(id); return d && d.open; })
      || !!$("ct-view");
    if (anyOpen) return;
    e.preventDefault();
    openDlg(null);
    return;
  }
  // Escape — view card first, then any open dialog
  if (e.key === "Escape") {
    if ($("ct-view")) { closeViewCard(); return; }
    ["ct-dlg", "del-dlg", "merge-dlg", "lbl-dlg"].forEach(function (id) {
      var d = $(id);
      if (d && d.open) { try { d.close(); } catch (err) {} }
    });
  }
});

// ===== CONTACT DIALOG =====

  /* ---------- 5. Multi-field editors ----------
     Each holder (phones/emails/websites/im) builds rows:
     [ value input ][ type select ][ ✕ ]. Rows live only in the
     dialog — read back into the contact on Save. Empty rows are
     dropped at read time (never stored, never synced). */

  function typeOptions(sel, types, current) {
    types.forEach(function (ty) {
      var o = document.createElement("option");
      o.value = ty;
      o.textContent = t("ty." + ty);
      if (ty === current) o.selected = true;
      sel.appendChild(o);
    });
  }

  // Generic { v, type } row builder (phones, emails, websites, im).
  function buildValRow(holder, val, type, types, ph, maxlen, i18n) {
    var row = document.createElement("div");
    row.className = "mf-row";

    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "mf-val";
    inp.maxLength = maxlen;
    inp.placeholder = ph;
    inp.value = val || "";
    inp.dataset.kind = i18n;
    row.appendChild(inp);

    var sel = document.createElement("select");
    sel.className = "mf-type";
    typeOptions(sel, types, type);
    row.appendChild(sel);

    var rm = document.createElement("button");
    rm.type = "button";
    rm.className = "mf-rm";
    rm.textContent = "✕";
    rm.setAttribute("aria-label", t("ct.cancel"));
    rm.addEventListener("click", function () {
      row.parentNode.removeChild(row);
    });
    row.appendChild(rm);

    holder.appendChild(row);
    return inp;
  }

  // Read all { v, type } rows from a holder.
  function readValRows(holder) {
    var out = [];
    var rows = holder.querySelectorAll(".mf-row:not(.addr):not(.ev)");
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i].querySelector(".mf-val").value.trim();
      if (!v) continue;                            // empty row → dropped
      var sel = rows[i].querySelector("select");
      out.push({ v: v, type: sel.value });
    }
    return out;
  }

  // Address row: type select + 5 stacked text fields.
  function buildAddrRow(holder, addr) {
    addr = addr || {};
    var row = document.createElement("div");
    row.className = "mf-row addr";

    var fields = document.createElement("div");
    fields.className = "mf-addr-fields";
    [["street", 120, "Φ. Ερυθρών Σταυροφόρων 12 / 12 Crusaders St…"],
     ["city", 60, "Serres"],
     ["zip", 20, "621 00"],
     ["region", 60, "Central Macedonia / Κεντρική Μακεδονία"],
     ["country", 60, "Greece / Ελλάδα"]].forEach(function (def) {
      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "mf-af-" + def[0];
      inp.maxLength = def[1];
      inp.placeholder = def[2];
      inp.value = addr[def[0]] || "";
      fields.appendChild(inp);
    });
    row.appendChild(fields);

    var sel = document.createElement("select");
    sel.className = "mf-type";
    typeOptions(sel, ADDR_TYPES, addr.type || "home");
    row.appendChild(sel);

    var rm = document.createElement("button");
    rm.type = "button";
    rm.className = "mf-rm";
    rm.textContent = "✕";
    rm.setAttribute("aria-label", t("ct.cancel"));
    rm.addEventListener("click", function () {
      row.parentNode.removeChild(row);
    });
    row.appendChild(rm);

    holder.appendChild(row);
  }

  function readAddrRows(holder) {
    var out = [];
    var rows = holder.querySelectorAll(".mf-row.addr");
    for (var i = 0; i < rows.length; i++) {
      var g = function (cls) {
        return rows[i].querySelector("." + cls).value.trim();
      };
      var a = {
        street: g("mf-af-street"),
        city: g("mf-af-city"),
        zip: g("mf-af-zip"),
        region: g("mf-af-region"),
        country: g("mf-af-country"),
        type: rows[i].querySelector("select").value
      };
      if (a.street || a.city || a.zip || a.region || a.country) out.push(a);
    }
    return out;
  }

  // Event row: [ type select ][ date input (MM-DD via year "YYYY-MM-DD" trick
  // — see below) ][ "no year" toggle ][ custom label input ].
  //
  // DATE INPUT DESIGN (important): a native <input type="date"> CANNOT
  // represent a yearless birthday. We therefore use type="text" with a
  // YYYY-MM-DD pattern: full date = year kept; "MM-DD" (5 chars, e.g.
  // "03-17") or "--MM-DD" (vCard form) = yearless. The parse/validate
  // helper below normalizes both input styles. This keeps ONE input per
  // event row (minimal UI) while remaining honest about missing years.
  function parseEvtDate(raw) {
    var s = String(raw == null ? "" : raw).trim();
    var m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
      return { day: m[2] + "-" + m[3], year: +m[1] };
    }
    if ((m = s.match(/^-{0,2}(\d{2})-(\d{2})$/))) {
      return { day: m[1] + "-" + m[2], year: null };
    }
    return null;
  }
  function fmtEvtDate(ev) {
    if (ev.year) return ev.year + "-" + ev.day;
    return ev.day;
  }

  function buildEvtRow(holder, ev) {
    ev = ev || {};
    var row = document.createElement("div");
    row.className = "mf-row ev";

    var sel = document.createElement("select");
    sel.className = "mf-type";
    EVENT_TYPES.forEach(function (ty) {
      var o = document.createElement("option");
      o.value = ty;
      o.textContent = t("evt." + ty);
      if (ty === (ev.type || "birthday")) o.selected = true;
      sel.appendChild(o);
    });
    row.appendChild(sel);

    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "mf-val";
    inp.maxLength = 10;
    inp.placeholder = "1975-03-17 / 03-17";
    inp.inputMode = "numeric";
    if (ev.day) inp.value = fmtEvtDate(ev);
    row.appendChild(inp);

    var rm = document.createElement("button");
    rm.type = "button";
    rm.className = "mf-rm";
    rm.textContent = "✕";
    rm.setAttribute("aria-label", t("ct.cancel"));
    rm.addEventListener("click", function () {
      row.parentNode.removeChild(row);
    });
    row.appendChild(rm);

    // Custom label input appears only for type=custom — keeps the
    // common rows (birthday) to exactly 3 controls.
    var labWrap = document.createElement("span");
    labWrap.className = "mf-evt-label";
    var labIn = document.createElement("input");
    labIn.type = "text";
    labIn.className = "mf-val mf-evt-label-in";
    labIn.maxLength = 40;
    labIn.placeholder = t("evt.ph");
    labIn.value = ev.label || "";
    labWrap.appendChild(labIn);
    labWrap.hidden = (sel.value !== "custom");
    row.insertBefore(labWrap, rm);

    sel.addEventListener("change", function () {
      labWrap.hidden = (sel.value !== "custom");
    });

    // live parse feedback: invalid → red border, never blocks typing
    inp.addEventListener("input", function () {
      var ok = !inp.value.trim() || parseEvtDate(inp.value);
      inp.classList.toggle("invalid", !ok);
    });

    holder.appendChild(row);
  }

  function readEvtRows(holder) {
    var out = [];
    var rows = holder.querySelectorAll(".mf-row.ev");
    for (var i = 0; i < rows.length; i++) {
      var sel = rows[i].querySelector(".mf-type");
      var raw = rows[i].querySelector(".mf-val").value.trim();
      if (!raw) continue;
      var parsed = parseEvtDate(raw);
      if (!parsed) continue;                      // invalid row → dropped
      var labIn = rows[i].querySelector(".mf-evt-label-in");
      out.push({
        day: parsed.day,
        year: parsed.year,
        type: sel.value,
        label: labIn ? labIn.value.trim().slice(0, 40) : ""
      });
    }
    return out;
  }

  // Relation row: [ contact select ][ type select ][ ✕ ].
  // The "who" select excludes the contact being edited (no
  // self-relations). Unpicked rows are dropped at read time.
  function buildRelRow(holder, rel) {
    rel = rel || {};
    var row = document.createElement("div");
    row.className = "mf-row rel";

    var who = document.createElement("select");
    who.className = "mf-val rel-who";
    var blank = document.createElement("option");
    blank.value = "";
    blank.textContent = t("ct.rel.pick");
    who.appendChild(blank);
    state.contacts.forEach(function (o) {
      if (o.id === editingId) return;
      var op = document.createElement("option");
      op.value = o.id;
      op.textContent = displayName(o);
      if (o.id === rel.with) op.selected = true;
      who.appendChild(op);
    });
    row.appendChild(who);

    var sel = document.createElement("select");
    sel.className = "mf-type";
    RELATION_TYPES.forEach(function (ty) {
      var o = document.createElement("option");
      o.value = ty;
      o.textContent = t("rel." + ty);
      if (ty === (rel.type || "friend")) o.selected = true;
      sel.appendChild(o);
    });
    row.appendChild(sel);

    var rm = document.createElement("button");
    rm.type = "button";
    rm.className = "mf-rm";
    rm.textContent = "✕";
    rm.setAttribute("aria-label", t("ct.cancel"));
    rm.addEventListener("click", function () {
      row.parentNode.removeChild(row);
    });
    row.appendChild(rm);

    holder.appendChild(row);
  }

  function readRelRows(holder) {
    var out = [];
    var rows = holder.querySelectorAll(".mf-row.rel");
    for (var i = 0; i < rows.length; i++) {
      var who = rows[i].querySelector(".rel-who");
      var sel = rows[i].querySelector(".mf-type");
      if (!who || !who.value || !sel) continue;   // unpicked → dropped
      out.push({ with: who.value, type: sel.value });
    }
    return out;
  }

  // Read-only inverse links (computed, never stored). Shown under
  // the editable relation rows; dangling (deleted) targets are
  // silently hidden — tombstones never leak into the UI.
  function renderDlgIncoming(existing) {
    var box = $("ct-rel-in");
    if (!box) return;
    box.textContent = "";
    if (!existing) return;
    var inc = incomingRelations(existing);
    if (!inc.length) return;
    var head = document.createElement("div");
    head.className = "rel-in-head";
    head.textContent = t("ct.rel.in");
    box.appendChild(head);
    inc.forEach(function (r) {
      var o = contactById(r.id);
      if (!o) return;
      var line = document.createElement("div");
      line.className = "rel-in-row";
      line.textContent = "· " + t("rel." + r.type) + " · " + displayName(o);
      box.appendChild(line);
    });
  }

  /* ---------- 5b. Dialog open/save/delete ---------- */
  var editingId = null;
  var dlgLabelIds = [];      // working copy of the contact's labels
  var editingPhoto = null;   // working copy of the contact's photo (data URI | null)

  function renderDlgLabels() {
    var row = $("ct-label-row");
    row.textContent = "";
    var mk = function (id, name, color) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "chip" + (dlgLabelIds.indexOf(id) !== -1 ? "" : " off");
      if (color) {
        var dot = document.createElement("span");
        dot.className = "chip-dot";
        dot.style.background = color;
        c.appendChild(dot);
      }
      c.appendChild(document.createTextNode(name));
      c.addEventListener("click", function () {
        var ix = dlgLabelIds.indexOf(id);
        if (ix === -1) dlgLabelIds.push(id);
        else dlgLabelIds.splice(ix, 1);
        renderDlgLabels();
      });
      row.appendChild(c);
    };
    state.labels.forEach(function (l) { mk(l.id, l.name, l.color); });
  }

  function fillHolder(holder, arr, builder) {
    holder.textContent = "";
    if (arr.length) {
      arr.forEach(function (item) { builder(holder, item); });
    } else {
      builder(holder, null);   // one empty starter row
    }
  }

  // ===== AVATAR HANDLING (Wave 2.3) =====
  // Upload → center-crop to square → 128×128 JPEG (quality 0.85,
  // typically 8–20KB) → data URI stored on the contact. Hard cap
  // 50000 chars (sanitizeContract's photo slot) protects
  // localStorage + sync payload.
  var AVATAR_SIZE = 128;

  // Shared avatar element: photo if present, initials otherwise.
  // Used by BOTH the contact list and the dedup member rows.
  function mkAvatarEl(c) {
    if (c.photo) {
      var im = document.createElement("img");
      im.className = "ct-avatar ct-avatar-img";
      im.alt = "";
      im.src = c.photo;
      return im;
    }
    var sp = document.createElement("span");
    sp.className = "ct-avatar";
    sp.textContent = initials(c);
    return sp;
  }

  // Dialog preview painter: draws the current data URI onto the
  // 64×64 canvas (scaled by CSS) and toggles the Remove button.
  function paintAvatarPreview(uri) {
    var cv = $("avatar-preview");
    var rmBtn = $("ct-avatar-remove");
    if (!cv) return;
    if (rmBtn) rmBtn.hidden = !uri;
    if (!uri) { cv.hidden = true; return; }
    var ctx = cv.getContext("2d");
    var img = new Image();
    img.onload = function () {
      cv.width = img.width;
      cv.height = img.height;
      cv.hidden = false;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0);
    };
    img.onerror = function () { cv.hidden = true; };
    img.src = uri;
  }

  function readAvatarFile(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) { notifyTransient(t("ct.avatar.bad")); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        // Center-crop to square, then scale down to AVATAR_SIZE.
        var side = Math.min(img.width, img.height);
        var sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        var cv = document.createElement("canvas");
        cv.width = AVATAR_SIZE; cv.height = AVATAR_SIZE;
        var ctx = cv.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        try {
          var uri = cv.toDataURL("image/jpeg", 0.85);
          if (uri.length > 50000) { notifyTransient(t("ct.avatar.big")); return; }
          editingPhoto = uri;
          paintAvatarPreview(editingPhoto);
        } catch (e) {
          notifyTransient(t("ct.avatar.bad"));
        }
      };
      img.onerror = function () { notifyTransient(t("ct.avatar.bad")); };
      img.src = fr.result;
    };
    fr.onerror = function () { notifyTransient(t("ct.avatar.bad")); };
    fr.readAsDataURL(file);
  }

  function openDlg(existing) {
    editingId = existing ? existing.id : null;
    $("ct-dlg-title").textContent = t(existing ? "ct.dlg.edit" : "ct.dlg.new");
    $("ct-given").value    = existing ? existing.given : "";
    $("ct-middle").value   = existing ? existing.middle : "";
    $("ct-family").value   = existing ? existing.family : "";
    $("ct-nickname").value = existing ? existing.nickname : "";
    $("ct-org").value      = existing ? existing.org : "";
    $("ct-jobtitle").value = existing ? existing.jobTitle : "";
    $("ct-note").value     = existing ? existing.note : "";
    $("ct-starred").checked = existing ? existing.starred : false;
    editingPhoto = (existing && existing.photo) ? existing.photo : null;
    paintAvatarPreview(editingPhoto);

    fillHolder($("ct-phones"),    existing ? existing.phones    : [], function (h, r) { buildValRow(h, r && r.v, r && r.type, PHONE_TYPES, "+30 69…", 40, "ph"); });
    fillHolder($("ct-emails"),    existing ? existing.emails    : [], function (h, r) { buildValRow(h, r && r.v, r && r.type, EMAIL_TYPES, "name@example.com", 120, "em"); });
    fillHolder($("ct-websites"),  existing ? existing.websites  : [], function (h, r) { buildValRow(h, r && r.v, r && r.type, WEB_TYPES, "https://…", 300, "wb"); });
    fillHolder($("ct-im"),        existing ? existing.im        : [], function (h, r) { buildValRow(h, r && r.v, r && r.type, IM_TYPES, "handle…", 120, "im"); });
    fillHolder($("ct-addresses"), existing ? existing.addresses : [], buildAddrRow);
    fillHolder($("ct-events"),    existing ? existing.events    : [], buildEvtRow);
    fillHolder($("ct-relations"), existing ? existing.relations : [], buildRelRow);
    renderDlgIncoming(existing);

    dlgLabelIds = existing ? existing.labelIds.slice() : [];
    renderDlgLabels();

    $("ct-del-row").className = "dlg-row" + (existing ? " show" : "");
    // CT-2: what the form shows now, read back through the same
    // readers Save uses — Save writes only the fields that differ.
    dlgSnap = existing ? readDlgDraft() : null;
    $("ct-dlg").showModal();
    setTimeout(function () { $("ct-given").focus(); }, 50);
  }

  // Every editable field of the dialog, as Save reads it.
  var DLG_FIELDS = ["given", "middle", "family", "nickname", "org", "jobTitle",
    "phones", "emails", "addresses", "websites", "im", "events", "relations",
    "labelIds", "starred", "note", "photo"];
  var dlgSnap = null;
  function readDlgDraft() {
    return {
      given: $("ct-given").value.trim(),
      middle: $("ct-middle").value.trim(),
      family: $("ct-family").value.trim(),
      nickname: $("ct-nickname").value.trim(),
      org: $("ct-org").value.trim(),
      jobTitle: $("ct-jobtitle").value.trim(),
      phones: readValRows($("ct-phones")),
      emails: readValRows($("ct-emails")),
      addresses: readAddrRows($("ct-addresses")),
      websites: readValRows($("ct-websites")),
      im: readValRows($("ct-im")),
      events: readEvtRows($("ct-events")),
      relations: readRelRows($("ct-relations")),
      labelIds: dlgLabelIds.slice().sort(),
      starred: $("ct-starred").checked,
      note: $("ct-note").value.trim(),
      photo: editingPhoto
    };
  }

  // Starter-row buttons (＋ Phone / ＋ Email / …)
  if ($("ct-phone-add")) {
    $("ct-phone-add").addEventListener("click", function () {
      buildValRow($("ct-phones"), "", "mobile", PHONE_TYPES, "+30 69…", 40, "ph").focus();
    });
  }
  if ($("ct-email-add")) {
    $("ct-email-add").addEventListener("click", function () {
      buildValRow($("ct-emails"), "", "home", EMAIL_TYPES, "name@example.com", 120, "em").focus();
    });
  }
  if ($("ct-web-add")) {
    $("ct-web-add").addEventListener("click", function () {
      buildValRow($("ct-websites"), "", "home", WEB_TYPES, "https://…", 300, "wb").focus();
    });
  }
  if ($("ct-im-add")) {
    $("ct-im-add").addEventListener("click", function () {
      buildValRow($("ct-im"), "", "home", IM_TYPES, "handle…", 120, "im").focus();
    });
  }
  if ($("ct-addr-add")) {
    $("ct-addr-add").addEventListener("click", function () { buildAddrRow($("ct-addresses")); });
  }
  if ($("ct-ev-add")) {
    $("ct-ev-add").addEventListener("click", function () { buildEvtRow($("ct-events")); });
  }
  if ($("ct-rel-add")) {
    $("ct-rel-add").addEventListener("click", function () { buildRelRow($("ct-relations")); });
  }

  $("ct-add").addEventListener("click", function () { openDlg(null); });

  // Avatar wiring: upload button opens the picker, the hidden file
  // input feeds readAvatarFile, remove clears both state + preview.
  if ($("ct-avatar-upload")) {
    $("ct-avatar-upload").addEventListener("click", function () {
      var dlg = dialogHost();
      if (dlg && typeof dlg.openFile === "function") {
        dlg.openFile("image/jpeg,image/png,.jpg,.jpeg,.png")
          .then(function (f) { if (f) readAvatarFile(f); });
        return;                     // cancel (null) = silent exit
      }
      $("ct-avatar-input").value = "";            // allow re-pick of same file
      $("ct-avatar-input").click();
    });
  }
  if ($("ct-avatar-input")) {
    $("ct-avatar-input").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (f) readAvatarFile(f);
    });
  }
  if ($("ct-avatar-remove")) {
    $("ct-avatar-remove").addEventListener("click", function () {
      editingPhoto = null;
      paintAvatarPreview(null);
    });
  }

  /* Save — collects every holder, sanitizes through the SAME
     sanitizeContact() the loader uses (one truth), then pushes or
     edits. Edited-while-deleted-elsewhere → resurrect (fresh mtime
     beats the tombstone, calendar contract). */
  $("ct-save").addEventListener("click", function () {
    var form = readDlgDraft();
    var given = form.given, middle = form.middle, family = form.family;
    var nickname = form.nickname, org = form.org;
    if (!given && !middle && !family && !nickname && !org) {
      var ti = $("ct-given");
      ti.classList.add("invalid");
      ti.focus();
      notifyTransient(t("ct.err.name"));
      setTimeout(function () { ti.classList.remove("invalid"); }, 1600);
      return;
    }

    // CT-2: an edit applies only the fields the user changed since
    // the dialog opened, on top of the CURRENT contact (a pull may
    // have changed it meanwhile). Untouched fields keep the other
    // device's values (A67 Q1); a Save with no change stamps nothing
    // (R27). A new contact, or one deleted elsewhere while the dialog
    // was open, is saved whole (an edit outranks a delete).
    var current = editingId ? contactById(editingId) : null;
    var draft;
    if (current && dlgSnap) {
      var changedF = DLG_FIELDS.filter(function (f) {
        return JSON.stringify(form[f]) !== JSON.stringify(dlgSnap[f]);
      });
      if (!changedF.length) { $("ct-dlg").close(); return; }
      draft = JSON.parse(JSON.stringify(current));
      changedF.forEach(function (f) { draft[f] = form[f]; });
    } else {
      draft = form;
      draft.id = editingId || uid();
    }
    draft.mtime = Date.now();
    var clean = sanitizeContact(draft);
    // sanitizeContact keeps the drafted id/mtime (they were valid) —
    // belt and braces: restore them explicitly if the trim shape
    // lost them (it cannot, but no guessing about future edits).
    clean.id = draft.id;
    clean.mtime = draft.mtime;

    var found = false;
    for (var i = 0; i < state.contacts.length; i++) {
      if (state.contacts[i].id === editingId) {
        state.contacts[i] = clean;
        found = true;
        break;
      }
    }
    if (!found) state.contacts.push(clean);

    // Any edit outranks a stale tombstone (no phantom deletes).
    state.deleted = state.deleted.filter(function (d) {
      return d.id !== clean.id;
    });

    saveState();
    $("ct-dlg").close();
    renderChips();
    renderList();
  });

  $("ct-cancel").addEventListener("click", function () { $("ct-dlg").close(); });
  // Outside-click close (a click whose target IS the dialog hit the
  // backdrop) — same pattern as calendar ev-dlg.
  $("ct-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) this.close();
  });

  // Wave 2.1 — shell deep-link target. Calendar contact-feed rows
  // land here via window.parent.__orosOpenContact (live iframe push
  // when Contacts is already open). Opens the contact's edit dialog
  // — identical to tapping its row. Stale/deleted id → silent no-op.
  window.__orosContactsOpen = function (contactId) {
    if (typeof contactId !== "string" || !contactId) return;
    for (var i = 0; i < state.contacts.length; i++) {
      if (state.contacts[i].id === contactId) {
        // Guard: programmatic deep-link while ct-dlg is already open
        // would throw InvalidStateError from showModal(). Close the
        // stale edit first — the deep link is the newer intent.
        try { if ($("ct-dlg").open) $("ct-dlg").close(); } catch (e) {}
        openViewCard(state.contacts[i]);
        return;
      }
    }
  };

  /* Delete: themed confirm + UNDO (resurrection via fresh mtime). */
  var lastDeleted = null;

  $("ct-delete").addEventListener("click", function () {
    if (!editingId) return;
    var ev = null;
    for (var i = 0; i < state.contacts.length; i++) {
      if (state.contacts[i].id === editingId) { ev = state.contacts[i]; break; }
    }
    $("del-dlg-text").textContent = ev ? displayName(ev) : t("ct.unnamed");
    $("del-dlg").showModal();
    $("del-dlg-yes").focus();
  });

  $("del-dlg-yes").addEventListener("click", function () {
    if (!editingId) { $("del-dlg").close(); return; }
    var ev = null;
    for (var i = 0; i < state.contacts.length; i++) {
      if (state.contacts[i].id === editingId) { ev = state.contacts[i]; break; }
    }
    state.contacts = state.contacts.filter(function (c) { return c.id !== editingId; });
    state.deleted.push({ id: editingId, mtime: Date.now() });
    saveState();
    lastDeleted = ev ? JSON.parse(JSON.stringify(ev)) : null;
    editingId = null;   // clear dangling state
    $("del-dlg").close();
    $("ct-dlg").close();
    renderChips();
    renderList();
    if (lastDeleted) toast(t("ct.del.done"), t("undo"), undoDelete);
  });

  $("del-dlg-no").addEventListener("click", function () {
    $("del-dlg").close();
  });
  $("del-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) this.close();
  });

  function undoDelete() {
    if (!lastDeleted) return;
    // Already back (an edit on another device resurrected it and a
    // pull brought it here): nothing to restore, keep that version.
    if (contactById(lastDeleted.id)) { lastDeleted = null; return; }
    lastDeleted.mtime = Date.now();   // fresh: beats the tombstone
    state.contacts.push(lastDeleted);
    state.deleted = state.deleted.filter(function (d) {
      return d.id !== lastDeleted.id;
    });
    lastDeleted = null;
    saveState();
    renderChips();
    renderList();
  }

// ===== DUPLICATE MERGE LOGIC =====

  var pendingMergeGroup = null;    // group IDs awaiting merge
  var pendingMergePrimaryIndex = 0; // which member is primary (0-based)
  var pendingMergeSnapshot = null;  // pre-merge state for undo

  // Build a proposed merged contact from a group.
  function buildMergePreview(groupIds, primaryIdx) {
    var members = groupIds.map(function (id) {
      return state.contacts.find(function (c) { return c.id === id; });
    }).filter(Boolean);
    if (!members.length) return null;

    var primary = members[primaryIdx];
    var preview = JSON.parse(JSON.stringify(primary)); // deep copy
    preview.id = primary.id;
    preview.mtime = Date.now();

    // Scalar fields: keep primary unless empty, then take first non-empty.
    ["given", "middle", "family", "nickname", "org", "jobTitle", "note", "photo"].forEach(function (f) {
      if (!preview[f]) {
        for (var i = 0; i < members.length; i++) {
          if (members[i][f]) { preview[f] = members[i][f]; break; }
        }
      }
    });

    // Arrays: union with dedup.
    function arrayUnion(arrA, arrB, keyFn) {
      var map = {};
      arrA.forEach(function (x) { var k = keyFn(x); if (k && !map[k]) map[k] = x; });
      arrB.forEach(function (x) { var k = keyFn(x); if (k && !map[k]) map[k] = x; });
      return Object.keys(map).map(function (k) { return map[k]; });
    }

    preview.phones = arrayUnion(preview.phones,
      [].concat.apply([], members.slice(1).map(function (m) { return m.phones; })),
      function (p) { return phoneDigits(p.v); });

    preview.emails = arrayUnion(preview.emails,
      [].concat.apply([], members.slice(1).map(function (m) { return m.emails; })),
      function (e) { return normalizeEmail(e.v); });

    preview.addresses = arrayUnion(preview.addresses,
      [].concat.apply([], members.slice(1).map(function (m) { return m.addresses; })),
      function (a) { return a.street + "|" + a.city + "|" + a.zip; });

    preview.websites = arrayUnion(preview.websites,
      [].concat.apply([], members.slice(1).map(function (m) { return m.websites; })),
      function (w) { return w.v; });

    preview.im = arrayUnion(preview.im,
      [].concat.apply([], members.slice(1).map(function (m) { return m.im; })),
      function (i) { return i.v; });

    preview.relations = arrayUnion(preview.relations || [],
      [].concat.apply([], members.slice(1).map(function (m) { return m.relations || []; })),
      function (r) { return r.with + "|" + r.type; });

    preview.events = arrayUnion(preview.events,
      [].concat.apply([], members.slice(1).map(function (m) { return m.events; })),
      function (e) { return e.type + "|" + e.day; });

    preview.labelIds = arrayUnion(preview.labelIds,
      [].concat.apply([], members.slice(1).map(function (m) { return m.labelIds; })),
      function (l) { return l; });
    preview.labelIds.sort();

    preview.starred = primary.starred || members.some(function (m) { return m.starred; });

    return { preview: preview, members: members, primaryIdx: primaryIdx };
  }

  function openMergeDlg(groupIds) {
    pendingMergeGroup = groupIds;
    pendingMergePrimaryIndex = 0;
    pendingMergeSnapshot = null;

    renderMergePreview();
    $("merge-dlg").showModal();
  }

  function renderMergePreview() {
    if (!pendingMergeGroup) return;
    var prep = buildMergePreview(pendingMergeGroup, pendingMergePrimaryIndex);
    if (!prep) return;

    $("merge-title").textContent = t("dup.merge");
    var via = $("merge-via");
    via.textContent = "";
    via.appendChild(document.createTextNode(t("dup.primary") + ": "));
    var viaStrong = document.createElement("strong");
    viaStrong.textContent = displayName(prep.members[pendingMergePrimaryIndex]);
    via.appendChild(viaStrong);
    var prevBox = $("merge-preview");
    prevBox.textContent = "";

    // Show scalar fields.
    ["given", "middle", "family", "nickname", "org", "jobTitle"].forEach(function (f) {
      if (!prep.preview[f]) return;
      var div = document.createElement("div");
      div.className = "dup-preview-section";
      var lab = document.createElement("div");
      lab.className = "dup-preview-label";
      lab.textContent = t("ct.field." + (f === "jobTitle" ? "jobtitle" : f));
      var val = document.createElement("div");
      val.className = "dup-preview-value";
      val.textContent = prep.preview[f];
      div.appendChild(lab);
      div.appendChild(val);
      prevBox.appendChild(div);
    });

    // Show arrays (phones, emails, labels).
    if (prep.preview.phones.length) {
      var phDiv = document.createElement("div");
      phDiv.className = "dup-preview-section";
      phDiv.innerHTML = "<div class=\"dup-preview-label\">" + t("ct.field.phones") + "</div>";
      prep.preview.phones.forEach(function (p) {
        var span = document.createElement("span");
        span.textContent = p.v + " (" + t("ty." + p.type) + ") · ";
        phDiv.appendChild(span);
      });
      prevBox.appendChild(phDiv);
    }

    if (prep.preview.emails.length) {
      var emDiv = document.createElement("div");
      emDiv.className = "dup-preview-section";
      emDiv.innerHTML = "<div class=\"dup-preview-label\">" + t("ct.field.emails") + "</div>";
      prep.preview.emails.forEach(function (e) {
        var span = document.createElement("span");
        span.textContent = e.v + " · ";
        emDiv.appendChild(span);
      });
      prevBox.appendChild(emDiv);
    }

    if (prep.preview.labelIds.length) {
      var lbDiv = document.createElement("div");
      lbDiv.className = "dup-preview-section";
      lbDiv.innerHTML = "<div class=\"dup-preview-label\">" + t("ct.lbl.filter") + "</div>";
      prep.preview.labelIds.forEach(function (lid) {
        var l = labelById(lid);
        if (l) {
          var chip = document.createElement("span");
          chip.className = "chip";
          chip.style.setProperty("--chip", l.color);
          chip.textContent = l.name + " · ";
          lbDiv.appendChild(chip);
        }
      });
      prevBox.appendChild(lbDiv);
    }
  }

  // Commit merge: winners keep, losers become tombstones.
  function commitMerge() {
    if (!pendingMergeGroup) return;
    var prep = buildMergePreview(pendingMergeGroup, pendingMergePrimaryIndex);
    if (!prep) return;

    // CT-4: Undo snapshot = only the group's members, taken now.
    pendingMergeSnapshot = prep.members.map(function (m) {
      return JSON.parse(JSON.stringify(m));
    });

    // Store winner.
    var winnerId = prep.members[pendingMergePrimaryIndex].id;
    for (var i = 0; i < state.contacts.length; i++) {
      if (state.contacts[i].id === winnerId) {
        state.contacts[i] = prep.preview;
        break;
      }
    }

    // Losers become tombstones.
    pendingMergeGroup.forEach(function (id) {
      if (id !== winnerId) {
        state.deleted.push({ id: id, mtime: Date.now() });
        state.contacts = state.contacts.filter(function (c) { return c.id !== id; });
      }
    });

    saveState();
    $("merge-dlg").close();
    $("dedup-sec").hidden = true;
    renderChips();
    renderList();
    toast(t("dup.merged"), t("dup.undo"), undoMerge);
  }

  // CT-4: Undo puts back ONLY the merged group, with fresh stamps so
  // the restored copies beat their tombstones on every device. The
  // old Undo replaced the whole contact list and tombstone list with
  // a copy taken when the merge dialog opened (older stamps): work
  // pulled from another device in between was dropped locally, and
  // the "restored" duplicates were deleted again by the next pull.
  function undoMerge() {
    if (!pendingMergeSnapshot) return;
    var now = Date.now();
    pendingMergeSnapshot.forEach(function (m) {
      m.mtime = now;
      var found = false;
      for (var i = 0; i < state.contacts.length; i++) {
        if (state.contacts[i].id === m.id) { state.contacts[i] = m; found = true; break; }
      }
      if (!found) state.contacts.push(m);
      state.deleted = state.deleted.filter(function (d) { return d.id !== m.id; });
    });
    pendingMergeSnapshot = null;
    saveState();
    renderChips();
    renderList();
  }

  // Wiring: scan button + merge dialog controls.
  if ($("ct-dedup")) {
    $("ct-dedup").addEventListener("click", function () {
      var scan = scanDuplicates();
      var total = scan.definitive.length + scan.possible.length;
      $("dedup-title").textContent = t("dup.title") + " · " + total;
      renderDupDialog(scan);
      $("dedup-sec").hidden = false;
    });
  }

  if ($("dedup-done")) {
    $("dedup-done").addEventListener("click", function () {
      $("dedup-sec").hidden = true;
    });
  }

  if ($("merge-flip")) {
    $("merge-flip").addEventListener("click", function () {
      if (!pendingMergeGroup || pendingMergeGroup.length < 2) return;
      pendingMergePrimaryIndex = (pendingMergePrimaryIndex + 1) % pendingMergeGroup.length;
      renderMergePreview();
    });
  }

  if ($("merge-do")) {
    $("merge-do").addEventListener("click", function () {
      commitMerge();
    });
  }

  if ($("merge-cancel")) {
    $("merge-cancel").addEventListener("click", function () {
      $("merge-dlg").close();
    });
  }

  if ($("merge-dlg")) {
    $("merge-dlg").addEventListener("click", function (ev) {
      if (ev.target === this) this.close();
    });
  }

// ===== LABEL MANAGEMENT =====

  /* ---------- 6. Label management dialog ----------
     Mirror of the calendar lbl-dlg: rename (inline), recolor
     (palette popover), delete (blocked while in use), create
     (name + color pick). mtime bumped on every user touch so the
     merge winner is always the newest intent. */

  function labelInUse(id) {
    return state.contacts.some(function (c) {
      return c.labelIds.indexOf(id) !== -1;
    });
  }

  // One delegated closer for the recolor popover — registered
  // ONCE per app load. The old per-row version leaked a document
  // listener on EVERY renderLblList call (closures piling up).
  var lblPop = null;
  var lblPopOwner = null;
  function closeLblPop() {
    if (lblPop && lblPop.parentNode) lblPop.parentNode.removeChild(lblPop);
    lblPop = null;
    lblPopOwner = null;
  }
  document.addEventListener("click", function (ev) {
    if (!lblPop) return;
    if (lblPop.contains(ev.target)) return;
    if (ev.target && ev.target.closest &&
        ev.target.closest(".lbl-color-btn")) return;
    closeLblPop();
  });

  function openLblDlg() {
    renderLblList();
    $("lbl-new-name").value = "";
    $("lbl-add-colors").textContent = "";
    LABEL_PALETTE.forEach(function (col) {
      var s = document.createElement("button");
      s.type = "button";
      s.className = "lbl-swatch";
      s.style.background = col;
      s.setAttribute("aria-label", t("lbl.color"));
      s.addEventListener("click", function () {
        // mark selection, leave dialog open for typing the name
        var all = $("lbl-add-colors").querySelectorAll(".lbl-swatch");
        for (var i = 0; i < all.length; i++) all[i].classList.remove("active");
        s.classList.add("active");
      });
      $("lbl-add-colors").appendChild(s);
    });
    $("lbl-dlg").showModal();
  }

  function renderLblList() {
    var box = $("lbl-list");
    box.textContent = "";
    state.labels.forEach(function (l) {
      var row = document.createElement("div");
      row.className = "lbl-row";

      var cb = document.createElement("button");
      cb.type = "button";
      cb.className = "lbl-color-btn";
      cb.style.background = l.color;
      cb.setAttribute("aria-label", t("lbl.color"));
      row.appendChild(cb);

      var ni = document.createElement("input");
      ni.type = "text";
      ni.className = "lbl-name-in";
      ni.maxLength = 40;
      ni.value = l.name;
      ni.addEventListener("change", function () {
        // CT-2: the dialog may have outlived a pull — edit the current
        // label object, found by id (the row's `l` can be a stale copy).
        var cur = labelById(l.id);
        var nv = ni.value.trim();
        if (!cur) return;
        if (!nv || nv === cur.name) { ni.value = cur.name; return; }
        cur.name = nv.slice(0, 40);
        cur.mtime = Date.now();               // user intent outranks seeds
        saveState();
        renderChips();
        renderList();
      });
      row.appendChild(ni);

      var del = document.createElement("button");
      del.type = "button";
      del.className = "mini lbl-del";
      del.textContent = t("lbl.delete");
      del.addEventListener("click", function () {
        if (labelInUse(l.id)) { notifyTransient(t("lbl.inuse")); return; }
        state.labels = state.labels.filter(function (x) { return x.id !== l.id; });
        state.deleted.push({ id: l.id, mtime: Date.now() });   // shared tombstone
        delete labelVis[l.id];
        saveState();
        renderLblList();
        renderChips();
        renderList();
      });
      row.appendChild(del);

      // Recolor: inline palette popover beside the dot button.
      // Uses the SHARED single closer declared above openLblDlg —
      // no per-render document listeners. lblPopOwner keeps the
      // toggle behavior for the same button while clicking another
      // row's dot switches the popover instead of just closing it.
      cb.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var reopen = (lblPopOwner !== cb);
        closeLblPop();
        if (!reopen) return;
        var pop = document.createElement("div");
        pop.className = "lbl-palette";
        LABEL_PALETTE.forEach(function (col) {
          var s = document.createElement("button");
          s.type = "button";
          s.className = "lbl-swatch" + (col === l.color ? " active" : "");
          s.style.background = col;
          s.addEventListener("click", function () {
            var cur = labelById(l.id);        // CT-2: current object, by id
            if (!cur) { closeLblPop(); return; }
            cur.color = col;
            cur.mtime = Date.now();
            saveState();
            renderLblList();
            renderChips();
            renderList();
            closeLblPop();
          });
          pop.appendChild(s);
        });
        document.body.appendChild(pop);
        // position near the button, clamped to viewport
        var r = cb.getBoundingClientRect();
        pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 190)) + "px";
        pop.style.top = (r.bottom + 6) + "px";
        lblPop = pop;
        lblPopOwner = cb;
      });

      box.appendChild(row);
    });
    if (!state.labels.length) {
      var e = document.createElement("p");
      e.className = "empty";
      e.textContent = t("lbl.empty");
      box.appendChild(e);
    }
  }

  // Create: name typed, color = active swatch or first palette slot.
  if ($("lbl-add")) {
    $("lbl-add").addEventListener("click", function () {
      var name = $("lbl-new-name").value.trim();
      if (!name) { $("lbl-new-name").focus(); return; }
      var col = LABEL_PALETTE[0];
      var act = $("lbl-add-colors").querySelector(".lbl-swatch.active");
      if (act) col = act.style.background && LABEL_PALETTE[
        LABEL_PALETTE.indexOf(rgbToHex(act.style.background))] || col;
      var nu = {
        id: "lbl-" + uid(),
        name: name.slice(0, 40),
        color: col,
        mtime: Date.now()
      };
      state.labels.push(nu);
      saveState();
      $("lbl-new-name").value = "";
      renderLblList();
      renderChips();
      renderList();
    });
  }
  // Convert "rgb(r, g, b)" (browsers normalize inline styles) back to
  // a palette hex when possible; returns "" for no match.
  function rgbToHex(rgb) {
    var m = String(rgb || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return "";
    var h = "#" + [m[1], m[2], m[3]].map(function (d) {
      return (+d).toString(16).length < 2 ? "0" + (+d).toString(16) : (+d).toString(16);
    }).join("");
    return LABEL_PALETTE.indexOf(h) !== -1 ? h : "";
  }
  // NOTE: swatch buttons store colors via style.background, which
  // browsers may normalize — the palette comparison above tolerates
  // both hex and rgb() forms; a mismatch falls back to slot 0.

  if ($("lbl-done")) {
    $("lbl-done").addEventListener("click", function () { $("lbl-dlg").close(); });
  }
  if ($("lbl-dlg")) {
    $("lbl-dlg").addEventListener("click", function (ev) {
      if (ev.target === this) this.close();
    });
  }

// ===== VCARD IMPORT / EXPORT =====

  /* ---------- 7. vCard (.vcf) — RFC 6350 subset ----------
     Round-trip target: Android Contacts imports our exports and
     exports (Google Contacts takeout included) read back in. */

  // Unfold: CRLF/CR/LF + a leading space/tab continues the line.
  function vcfUnfold(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      if ((lines[i].charAt(0) === " " || lines[i].charAt(0) === "\t") && out.length) {
        out[out.length - 1] += lines[i].slice(1);
      } else {
        out.push(lines[i]);
      }
    }
    return out;
  }

  // Parse property params: "TEL;TYPE=CELL,VOICE:+3069…" → {name, params, value}
  function vcfProp(line) {
    var ix = line.indexOf(":");
    if (ix === -1) return null;
    var head = line.slice(0, ix);
    var value = line.slice(ix + 1);
    var parts = head.split(";");
    return { name: parts[0].toUpperCase(), params: parts.slice(1), value: value };
  }
  function vcfType(params) {
    // Map common vCard TYPE params onto our whitelists.
    var t = "";
    params.forEach(function (p) {
      var kv = p.toUpperCase().split("=");
      if (kv[0] === "TYPE") t = kv[1] || "";
    });
    return t;
  }
  function vcfUnesc(s) {
    return String(s || "")
      .replace(/\\n/gi, "\n")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\");
  }
  function vcfEsc(s) {
    return String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,").replace(/;/g, "\\;");
  }
  // 75-byte folding on export (RFC 6350 §3.2)
  function vcfFold(line) {
    if (line.length <= 75) return [line];
    var out = [];
    var rest = line;
    out.push(rest.slice(0, 75));
    rest = rest.slice(75);
    while (rest.length) {
      out.push(" " + rest.slice(0, 74));
      rest = rest.slice(74);
    }
    return out;
  }

  function typeFromVcf(rawT, whitelist, fallback) {
    var r = String(rawT || "").toLowerCase();
    if (r.indexOf("cell") !== -1 || r.indexOf("mobile") !== -1) {
      return whitelist.indexOf("mobile") !== -1 ? "mobile" : fallback;
    }
    if (whitelist.indexOf(r) !== -1) return r;
    if (r.indexOf("work") !== -1 && whitelist.indexOf("work") !== -1) return "work";
    if (r.indexOf("home") !== -1 && whitelist.indexOf("home") !== -1) return "home";
    return fallback;
  }

  // Parse one vCard block (array of unfolded lines, BEGIN..END).
  function parseVcardBlock(lines) {
    var c = {
      given: "", middle: "", family: "", nickname: "",
      org: "", jobTitle: "",
      phones: [], emails: [], addresses: [], websites: [], im: [],
      events: [], cats: [], note: "", photo: null, starred: false
    };
    lines.forEach(function (line) {
      if (!line) return;
      var p = vcfProp(line);
      if (!p) return;
      var ty = vcfType(p.params);
      switch (p.name) {
        case "N":
          // N:family;given;middle;prefix;suffix
          var nn = p.value.split(";");
          c.family  = vcfUnesc(nn[0] || "").trim().slice(0, 60);
          c.given   = vcfUnesc(nn[1] || "").trim().slice(0, 60);
          c.middle  = vcfUnesc(nn[2] || "").trim().slice(0, 60);
          break;
        case "FN":
          // Only used if N was absent (some exports ship FN only).
          if (!c.given && !c.family) {
            var fn = vcfUnesc(p.value).trim().split(/\s+/);
            c.given = (fn[0] || "").slice(0, 60);
            c.family = fn.slice(1).join(" ").slice(0, 60);
          }
          break;
        case "NICKNAME": c.nickname = vcfUnesc(p.value).trim().slice(0, 60); break;
        case "ORG":
          // ORG:company;unit → keep company
          c.org = vcfUnesc(p.value.split(";")[0] || "").trim().slice(0, 80);
          break;
        case "TITLE": c.jobTitle = vcfUnesc(p.value).trim().slice(0, 80); break;
        case "TEL":
          if (p.value.trim()) c.phones.push({ v: p.value.trim().slice(0, 40), type: typeFromVcf(ty, PHONE_TYPES, "other") });
          break;
        case "EMAIL":
          if (p.value.trim()) c.emails.push({ v: p.value.trim().slice(0, 120), type: typeFromVcf(ty, EMAIL_TYPES, "other") });
          break;
        case "ADR":
          // ADR;pobox;ext;street;city;region;zip;country
          var aa = p.value.split(";");
          var ad = {
            street: vcfUnesc(aa[2] || "").trim().slice(0, 120),
            city: vcfUnesc(aa[3] || "").trim().slice(0, 60),
            region: vcfUnesc(aa[4] || "").trim().slice(0, 60),
            zip: vcfUnesc(aa[5] || "").trim().slice(0, 20),
            country: vcfUnesc(aa[6] || "").trim().slice(0, 60),
            type: typeFromVcf(ty, ADDR_TYPES, "other")
          };
          if (ad.street || ad.city || ad.region || ad.zip || ad.country) c.addresses.push(ad);
          break;
        case "URL":
          if (p.value.trim()) c.websites.push({ v: p.value.trim().slice(0, 300), type: typeFromVcf(ty, WEB_TYPES, "other") });
          break;
        case "IMPP":
          if (p.value.trim()) c.im.push({ v: p.value.trim().slice(0, 120), type: typeFromVcf(ty, IM_TYPES, "other") });
          break;
        case "BDAY":
        case "ANNIVERSARY":
          // "YYYY-MM-DD" | "--MM-DD" | "YYYYMMDD" (v2.1 legacy)
          var bv = p.value.trim();
          var mm;
          if ((mm = bv.match(/^(\d{4})-(\d{2})-(\d{2})$/)) ||
              (mm = bv.match(/^(\d{4})(\d{2})(\d{2})$/))) {
            if (validDay(mm[2] + "-" + mm[3])) {
              c.events.push({ day: mm[2] + "-" + mm[3], year: +mm[1], type: p.name === "BDAY" ? "birthday" : "anniversary", label: "" });
            }
          } else if ((mm = bv.match(/^-{0,2}(\d{2})-(\d{2})$/))) {
            if (validDay(mm[1] + "-" + mm[2])) {
              c.events.push({ day: mm[1] + "-" + mm[2], year: null, type: p.name === "BDAY" ? "birthday" : "anniversary", label: "" });
            }
          }
          break;
        case "X-EVENT": {
          // Our own custom-event round-trip form:
          // X-EVENT;TYPE=CUSTOM;X-LABEL=<escaped label>:<date>.
          // The label is extracted BEFORE unescaping — vcfProp()
          // splits raw params on ";", which would cut an escaped
          // "\;" inside the label, so the params are re-joined and
          // regex-matched with escaped-atom tolerance, THEN unesc.
          var xv = p.value.trim();
          var xm;
          var xlab = "";
          var pm = p.params.join(";").match(/X-LABEL=((?:\\.|[^;])*)/i);
          if (pm) xlab = vcfUnesc(pm[1]).trim().slice(0, 40);
          if ((xm = xv.match(/^(\d{4})-(\d{2})-(\d{2})$/)) ||
              (xm = xv.match(/^(\d{4})(\d{2})(\d{2})$/))) {
            if (validDay(xm[2] + "-" + xm[3])) {
              c.events.push({ day: xm[2] + "-" + xm[3], year: +xm[1], type: "custom", label: xlab });
            }
          } else if ((xm = xv.match(/^-{0,2}(\d{2})-(\d{2})$/))) {
            if (validDay(xm[1] + "-" + xm[2])) {
              c.events.push({ day: xm[1] + "-" + xm[2], year: null, type: "custom", label: xlab });
            }
          }
          break;
        }
        case "NOTE": c.note = vcfUnesc(p.value).trim().slice(0, 500); break;
        case "PHOTO": {
          // Accepted forms: our own data URI ("data:image/…;base64,…")
          // or raw base64 with an explicit TYPE=JPEG|PNG param.
          // http(s) URLs are NOT fetched (static OS, no network
          // dependency in imports) — silently skipped.
          var pv = p.value.trim();
          if (/^data:image\/(jpeg|png);base64,/.test(pv)) {
            // CT-8: a cut data URI is a broken image; skip oversize photos
            if (pv.length <= 50000) c.photo = pv;
          } else if (/(?:JPEG|JPG|PNG)/i.test(ty) &&
                     pv.length > 64 && pv.length <= 50000 &&
                     /^[A-Za-z0-9+/=]+$/.test(pv)) {
            c.photo = "data:image/" + (/PNG/i.test(ty) ? "png" : "jpeg") + ";base64," + pv;
          }
          break;
        }
        case "X-OROS-STARRED":
          if (/^TRUE$/i.test(p.value.trim())) c.starred = true;
          break;
        case "CATEGORIES":
          vcfUnesc(p.value).split(",").forEach(function (cat) {
            var n = cat.trim();
            if (n) c.cats.push(n.slice(0, 40));
          });
          break;
      }
    });
    return c;
  }

  // Convert parsed blocks into contacts: match existing by email or
  // phone (update) — otherwise create. Categories map to labels by
  // name (create if missing). Returns {created, updated, report}.
  function importParsed(parsed) {
    var created = 0, updated = 0, report = [];

    parsed.forEach(function (pc) {
      // label resolution (CATEGORIES → labelIds)
      var lids = [];
      pc.cats.forEach(function (catName) {
        var found = null;
        state.labels.forEach(function (l) { if (l.name.toLowerCase() === catName.toLowerCase()) found = l; });
        if (!found) {
          found = {
            id: "lbl-" + uid(),
            name: catName,
            color: LABEL_PALETTE[(state.labels.length + 1) % LABEL_PALETTE.length],
            mtime: Date.now()
          };
          state.labels.push(found);
        }
        if (lids.indexOf(found.id) === -1) lids.push(found.id);
      });

      // match: any shared email or normalized phone
      var existing = null;
      state.contacts.forEach(function (c) {
        if (existing) return;
        for (var i = 0; i < pc.emails.length; i++) {
          for (var j = 0; j < c.emails.length; j++) {
            if (pc.emails[i].v.toLowerCase() === c.emails[j].v.toLowerCase()) { existing = c; return; }
          }
        }
        for (var k = 0; k < pc.phones.length; k++) {
          for (var l = 0; l < c.phones.length; l++) {
            if (phoneDigits(pc.phones[k].v) === phoneDigits(c.phones[l].v)) { existing = c; return; }
          }
        }
      });

      if (existing) {
        // Update-in-place: fill only EMPTY fields on the existing
        // contact — imported data never overwrites user-curated
        // values without a match being obvious (Wave 2 dedup will
        // formalize field-level merging).
        var touched = false;
        ["nickname", "org", "jobTitle", "note", "photo"].forEach(function (f) {
          if (!existing[f] && pc[f]) { existing[f] = pc[f]; touched = true; }
        });
        if (pc.starred && !existing.starred) { existing.starred = true; touched = true; }
        pc.phones.forEach(function (p) {
          if (!existing.phones.some(function (x) { return phoneDigits(x.v) === phoneDigits(p.v); })) {
            existing.phones.push(p); touched = true;
          }
        });
        pc.emails.forEach(function (e) {
          if (!existing.emails.some(function (x) { return x.v.toLowerCase() === e.v.toLowerCase(); })) {
            existing.emails.push(e); touched = true;
          }
        });
        pc.addresses.forEach(function (a) {
          if (!existing.addresses.some(function (x) { return x.street === a.street && x.city === a.city && x.zip === a.zip; })) {
            existing.addresses.push(a); touched = true;
          }
        });
        pc.websites.forEach(function (w) {
          if (!existing.websites.some(function (x) { return x.v === w.v; })) {
            existing.websites.push(w); touched = true;
          }
        });
        pc.im.forEach(function (m) {
          if (!existing.im.some(function (x) { return x.v === m.v; })) {
            existing.im.push(m); touched = true;
          }
        });
        pc.events.forEach(function (ev) {
          if (!existing.events.some(function (x) { return x.day === ev.day && x.type === ev.type; })) {
            existing.events.push(ev); touched = true;
          }
        });
        lids.forEach(function (lid) {
          if (existing.labelIds.indexOf(lid) === -1) { existing.labelIds.push(lid); existing.labelIds.sort(); touched = true; }
        });
        if (touched) {
          existing.mtime = Date.now();
          updated++;
          report.push({ name: displayName(existing), kind: "upd" });
        } else {
          report.push({ name: displayName(existing), kind: "skip" });
        }
      } else {
        var draft = {
          id: uid(),
          given: pc.given, middle: pc.middle, family: pc.family,
          nickname: pc.nickname, org: pc.org, jobTitle: pc.jobTitle,
          phones: pc.phones, emails: pc.emails, addresses: pc.addresses,
          websites: pc.websites, im: pc.im, events: pc.events,
          labelIds: lids.sort(),
          starred: pc.starred === true, note: pc.note,
          photo: pc.photo || null,
          relations: [],
          mtime: Date.now()
        };
        var clean = sanitizeContact(draft);
        if (clean.given || clean.family || clean.org || clean.nickname) {
          state.contacts.push(clean);
          created++;
          report.push({ name: displayName(clean), kind: "new" });
        } else {
          report.push({ name: t("ct.unnamed"), kind: "skip" });
        }
      }
    });

    saveState();
    renderChips();
    renderList();
    return { created: created, updated: updated, report: report };
  }
  
  // ===== CSV IMPORT (Google Contacts) =====
  // Google's "Google CSV" export: RFC 4180 quoted rows, UTF-8 BOM,
  // scalar name/org/note/birthday columns, numbered value/type pairs
  // ("Phone 1 - Type" / "Phone 1 - Value", "E-mail 1 - Value"…),
  // "Group Membership" (:::-separated) → labels, "* starred" →
  // favorite, "Birthday" (ISO or "Mon D, YYYY") → event.
  // Photos are URL-only in CSV → skipped (no network imports —
  // same doctrine as vCard http PHOTOs). English headers are the
  // canonical format; Greek aliases cover the scalar fields.

  // RFC 4180-tolerant CSV rows (quoted fields, "" escapes, embedded
  // commas/newlines). Strips the UTF-8 BOM Google ships — otherwise
  // it glues onto the first header and breaks matching.
  function parseCsvRows(text) {
    var s = String(text || "");
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var rows = [], row = [], field = "", inQ = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') { field += '"'; i++; }
          else inQ = false;
        } else { field += ch; }
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ",") {
        row.push(field); field = "";
      } else if (ch === "\n") {
        row.push(field); field = "";
        rows.push(row); row = [];
      } else if (ch !== "\r") {
        field += ch;
      }
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    // drop fully-empty rows (trailing blank lines)
    return rows.filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ""; });
    });
  }

  var CSV_H = {
    first:    ["first name", "given name", "όνομα"],
    middle:   ["middle name", "δεύτερο όνομα"],
    last:     ["last name", "family name", "surname", "επώνυμο"],
    nick:     ["nickname", "ψευδώνυμο"],
    fullname: ["name", "ονοματεπώνυμο"],
    org:      ["organization 1 - name", "organization", "company", "εταιρεία"],
    title:    ["organization 1 - title", "title", "job title", "θέση"],
    note:     ["notes", "note", "σημειώσεις"],
    bday:     ["birthday", "γενέθλια"],
    group:    ["group membership", "group memberships"]
  };

  // Exact-match a folded header against an alias list.
  function csvHeaderIndex(headers, aliases) {
    for (var i = 0; i < headers.length; i++) {
      var h = greekFold(headers[i]).trim();
      for (var a = 0; a < aliases.length; a++) {
        if (greekFold(aliases[a]) === h) return i;
      }
    }
    return -1;
  }

  // Header-only presence check ("phone 1 - value" etc.).
  function csvHasHeader(headers, target) {
    var tt = greekFold(target);
    for (var i = 0; i < headers.length; i++) {
      if (greekFold(headers[i]).trim() === tt) return true;
    }
    return false;
  }

  // Numbered pair lookup: prefix + " n - want" ("phone 3 - value").
  function csvPair(row, headers, prefix, n, want) {
    var target = greekFold(prefix + " " + n + " - " + want);
    for (var i = 0; i < headers.length; i++) {
      if (greekFold(headers[i]).trim() === target) return String(row[i] || "").trim();
    }
    return "";
  }

  // Google birthday spellings: 1975-03-17 · 1975-3-17 · 19750317 ·
  // --03-17 · 03-17 · Mar 17, 1975 · March 17 1975.
  var CSV_MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };
  function csvPad2(n) { return (n < 10 ? "0" : "") + n; }
  function parseCsvBirthday(v) {
    var s = String(v || "").trim();
    if (!s) return null;
    var m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)) ||
        (m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
      var day = csvPad2(+m[2]) + "-" + csvPad2(+m[3]);
      return validDay(day) ? { day: day, year: +m[1] } : null;
    }
    if ((m = s.match(/^-{0,2}(\d{1,2})-(\d{1,2})$/))) {
      var d2 = csvPad2(+m[1]) + "-" + csvPad2(+m[2]);
      return validDay(d2) ? { day: d2, year: null } : null;
    }
    if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/))) {
      var mo = CSV_MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mo) {
        var d3 = csvPad2(mo) + "-" + csvPad2(+m[2]);
        return validDay(d3) ? { day: d3, year: +m[3] } : null;
      }
    }
    return null;
  }

  // One CSV row → the SAME shape parseVcardBlock emits, so
  // importParsed() handles dedup (email/phone match), label
  // creation and the import report with zero extra code.
  function csvRowToContact(row, headers) {
    var pick = function (keys) {
      var ix = csvHeaderIndex(headers, keys);
      return ix === -1 ? "" : String(row[ix] || "").trim();
    };
    var pc = {
      given: pick(CSV_H.first).slice(0, 60),
      middle: pick(CSV_H.middle).slice(0, 60),
      family: pick(CSV_H.last).slice(0, 60),
      nickname: pick(CSV_H.nick).slice(0, 60),
      org: pick(CSV_H.org).slice(0, 80),
      jobTitle: pick(CSV_H.title).slice(0, 80),
      phones: [], emails: [], addresses: [], websites: [], im: [],
      events: [], cats: [], note: pick(CSV_H.note).slice(0, 500),
      photo: null, starred: false
    };
    // FN-style fallback: "Name" split when parts are missing.
    if (!pc.given && !pc.family && !pc.org && !pc.nickname) {
      var fn = pick(CSV_H.fullname).split(/\s+/).filter(Boolean);
      if (fn.length) {
        pc.given = fn[0].slice(0, 60);
        pc.family = fn.slice(1).join(" ").slice(0, 60);
      }
    }
    var n;
    for (n = 1; n <= 15; n++) {
      var pv = csvPair(row, headers, "phone", n, "value");
      if (!pv) continue;
      pc.phones.push({
        v: pv.slice(0, 40),
        type: typeFromVcf(csvPair(row, headers, "phone", n, "type"), PHONE_TYPES, "other")
      });
    }
    // Email spelling check: remember WHICH alias matched ("e-mail"
    // vs "email") so the type column is read from the same spelling.
    for (n = 1; n <= 15; n++) {
      var evKey = csvPair(row, headers, "e-mail", n, "value") ? "e-mail"
                : (csvPair(row, headers, "email", n, "value") ? "email" : null);
      if (!evKey) continue;
      pc.emails.push({
        v: csvPair(row, headers, evKey, n, "value").slice(0, 120),
        type: typeFromVcf(csvPair(row, headers, evKey, n, "type"), EMAIL_TYPES, "other")
      });
    }
    for (n = 1; n <= 10; n++) {
      var street = csvPair(row, headers, "address", n, "street") ||
                   csvPair(row, headers, "address", n, "formatted");
      var city = csvPair(row, headers, "address", n, "city");
      var region = csvPair(row, headers, "address", n, "region");
      var zip = csvPair(row, headers, "address", n, "postal code") ||
                csvPair(row, headers, "address", n, "zip");
      var country = csvPair(row, headers, "address", n, "country");
      if (!street && !city && !zip && !region && !country) continue;
      pc.addresses.push({
        street: street.slice(0, 120), city: city.slice(0, 60),
        zip: zip.slice(0, 20), region: region.slice(0, 60),
        country: country.slice(0, 60),
        type: typeFromVcf(csvPair(row, headers, "address", n, "type"), ADDR_TYPES, "other")
      });
    }
    for (n = 1; n <= 10; n++) {
      var wv = csvPair(row, headers, "website", n, "value");
      if (!wv) continue;
      pc.websites.push({
        v: wv.slice(0, 300),
        type: typeFromVcf(csvPair(row, headers, "website", n, "type"), WEB_TYPES, "other")
      });
    }
    var bd = parseCsvBirthday(pick(CSV_H.bday));
    if (bd) {
      pc.events.push({ day: bd.day, year: bd.year, type: "birthday", label: "" });
    }
    // Group Membership: "* myContacts ::: * starred ::: Family" —
    // starred flag honored, * system groups dropped, the rest become
    // labels via importParsed's CATEGORIES machinery.
    var gm = pick(CSV_H.group);
    if (gm) {
      gm.split(":::").forEach(function (g) {
        var name = g.trim();
        if (!name) return;
        if (name === "* starred") { pc.starred = true; return; }
        if (name.charAt(0) === "*") return;
        if (pc.cats.indexOf(name) === -1) pc.cats.push(name.slice(0, 40));
      });
    }
    return pc;
  }

  function importCsvText(text) {
    var rows = parseCsvRows(text);
    if (rows.length < 2) { notifyTransient(t("ct.import.csv.noheader")); return; }
    var headers = rows[0];
    // Sanity gate: at least one recognisable column (or numbered
    // family) must exist before we touch state.
    var known = Object.keys(CSV_H).some(function (k) {
      return csvHeaderIndex(headers, CSV_H[k]) !== -1;
    }) || csvHasHeader(headers, "phone 1 - value") ||
         csvHasHeader(headers, "e-mail 1 - value") ||
         csvHasHeader(headers, "email 1 - value");
    if (!known) { notifyTransient(t("ct.import.csv.bad")); return; }

    var parsed = [];
    for (var r = 1; r < rows.length; r++) {
      var pc = csvRowToContact(rows[r], headers);
      if (pc.given || pc.family || pc.org || pc.nickname) parsed.push(pc);
    }
    if (!parsed.length) { notifyTransient(t("ct.import.csv.norows")); return; }
    var res = importParsed(parsed);
    showImportReport(res);
    notifyTransient(t("ct.import.done").replace("{n}", String(res.created)));
  }

  // ---- Import wiring ----
  // orosDialog first (native picker on Chromium); standalone falls
  // back to the legacy hidden #vcard-file input. Single reader:
  // both paths converge on importFileText().
  function importFileText(f) {
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      // Route by extension: .csv → Google Contacts CSV path,
      // everything else → vCard path.
      if (f && (/\.csv$/i.test(f.name) || f.type === "text/csv")) {
        try {
          importCsvText(String(fr.result));
        } catch (e) {
          console.error("contacts: CSV import failed:", e);
          notifyTransient(t("ct.import.csv.bad"));
        }
        return;
      }
      try {
        var lines = vcfUnfold(fr.result);
        var blocks = [], cur = null;
        lines.forEach(function (ln) {
          var u = ln.trim().toUpperCase();
          if (u === "BEGIN:VCARD") { cur = []; return; }
          if (u === "END:VCARD") { if (cur) blocks.push(cur); cur = null; return; }
          if (cur) cur.push(ln);
        });
        var parsed = blocks.map(parseVcardBlock).filter(function (b) {
          return b.given || b.family || b.org || b.nickname;
        });
        if (!parsed.length) { notifyTransient(t("ct.import.bad")); return; }
        var res = importParsed(parsed);
        showImportReport(res);
        notifyTransient(t("ct.import.done").replace("{n}", String(res.created)));
      } catch (e) {
        console.error("contacts: vCard import failed:", e);
        notifyTransient(t("ct.import.bad"));
      }
    };
    fr.onerror = function () { notifyTransient(t("ct.import.bad")); };
    fr.readAsText(f, "utf-8");
  }
  if ($("ct-import")) {
    $("ct-import").addEventListener("click", function () {
      var dlg = dialogHost();
      if (dlg && typeof dlg.openFile === "function") {
        dlg.openFile(".vcf,.csv,text/vcard,text/csv")
          .then(function (f) { if (f) importFileText(f); });
        return;                     // cancel (null) = silent exit
      }
      $("vcard-file").click();      // standalone: legacy hidden input
    });
  }
  if ($("vcard-file")) {
    $("vcard-file").addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";                       // allow re-import of same file
      if (f) importFileText(f);
    });
  }

  function showImportReport(res) {
    var sec = $("import-sec"), ul = $("imp-list");
    ul.textContent = "";
    res.report.forEach(function (r) {
      var li = document.createElement("li");
      li.className = r.kind === "new" ? "imp-new" : (r.kind === "upd" ? "imp-upd" : "imp-skip");
      var mark = r.kind === "new" ? "＋ " : (r.kind === "upd" ? "↻ " : "· ");
      li.textContent = mark + r.name;
      ul.appendChild(li);
    });
    $("imp-title").textContent = t("ct.import.done").replace("{n}", String(res.created)) +
      " · ↻ " + res.updated;
    sec.hidden = false;
  }

  // ---- Export wiring ----
  function contactToVcard(c) {
    var L = [];
    L.push("BEGIN:VCARD");
    L.push("VERSION:3.0");
    var n = [c.family, c.given, c.middle, "", ""].map(vcfEsc).join(";");
    L.push("N:" + n);
    L.push("FN:" + vcfEsc(displayName(c)));
    if (c.nickname) L.push("NICKNAME:" + vcfEsc(c.nickname));
    if (c.org) L.push("ORG:" + vcfEsc(c.org));
    if (c.jobTitle) L.push("TITLE:" + vcfEsc(c.jobTitle));
    c.phones.forEach(function (p) {
      L.push("TEL;TYPE=" + vcfTelType(p.type) + ":" + vcfEsc(p.v));
    });
    c.emails.forEach(function (e) {
      L.push("EMAIL;TYPE=" + vcfAddrType(e.type) + ":" + vcfEsc(e.v));
    });
    c.addresses.forEach(function (a) {
      var adr = ["", "", a.street, a.city, a.region, a.zip, a.country].map(vcfEsc).join(";");
      L.push("ADR;TYPE=" + vcfAddrType(a.type) + ":" + adr);
    });
    c.websites.forEach(function (w) {
      L.push("URL:" + vcfEsc(w.v));
    });
    c.im.forEach(function (m) {
      L.push("IMPP:" + vcfEsc(m.v));
    });
    c.events.forEach(function (ev) {
      var val = ev.year ? (ev.year + "-" + ev.day) : ("--" + ev.day);
      if (ev.type === "birthday") L.push("BDAY:" + val);
      else if (ev.type === "anniversary") L.push("ANNIVERSARY:" + val);
      else L.push("X-EVENT;TYPE=CUSTOM;X-LABEL=" + vcfEsc(ev.label) + ":" + val);
    });
    if (c.note) L.push("NOTE:" + vcfEsc(c.note));
    if (c.labelIds.length) {
      var names = c.labelIds.map(function (lid) {
        var l = labelById(lid);
        return l ? l.name : "";
      }).filter(Boolean);
      if (names.length) L.push("CATEGORIES:" + names.map(vcfEsc).join(","));
    }
    // Round-trippable starred flag (X-ABShowAs was never parsed back
    // — favorite status silently died on vCard re-import).
    if (c.starred) L.push("X-OROS-STARRED:TRUE");
    if (c.photo) L.push("PHOTO:" + c.photo);
    L.push("REV:" + new Date(c.mtime).toISOString());
    L.push("END:VCARD");
    return L;
  }
  function vcfTelType(ty) {
    if (ty === "mobile") return "CELL";
    return ty.toUpperCase();
  }
  function vcfAddrType(ty) {
    return ty.toUpperCase();
  }

  if ($("ct-export")) {
    $("ct-export").addEventListener("click", function () {
      if (!state.contacts.length) { notifyTransient(t("ct.none")); return; }
      var lines = [];
      // Alphabetical export (deterministic, merge-order agnostic).
      var sorted = state.contacts.slice().sort(function (a, b) {
        return greekFold(displayName(a)).localeCompare(greekFold(displayName(b)), LANG);
      });
      sorted.forEach(function (c) {
        contactToVcard(c).forEach(function (l) {
          vcfFold(l).forEach(function (fl) { lines.push(fl); });
        });
      });
      var text = lines.join("\r\n") + "\r\n";
      try {
        var blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
        var done = function () { notifyTransient(t("ct.export.done")); };
        var dlg = dialogHost();
        if (dlg && typeof dlg.saveFile === "function") {
          dlg.saveFile({
            blob: blob,
            filename: "orOS-contacts.vcf",
            mime: "text/vcard;charset=utf-8",
            types: [{ description: "vCard",
                      accept: { "text/vcard": [".vcf"] } }]
          }).then(function (r) { if (r && r.ok) done(); });
          return;                   // cancel (ok=false) = silent exit
        }
        // Standalone fallback — classic download (no shell present).
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "orOS-contacts.vcf";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          document.body.removeChild(a);
          URL.revokeObjectURL(a.href);
        }, 200);
        done();
      } catch (e) { notifyTransient(t("ct.export.bad")); }
    });
  }

  // ---- Full-database JSON export (zero-loss backup) ----
  // Mirrors the vcf download flow. Dumps ver + labels + contacts +
  // deleted tombstones, so a restore preserves merge history and
  // the no-phantom-delete guarantee (project mantra: FULL export).
  function exportJson() {
    try {
      var text = JSON.stringify({
        app: "contacts",
        ver: state.ver,
        labels: state.labels,
        contacts: state.contacts,
        deleted: state.deleted
      }, null, 2);
      var blob = new Blob([text], { type: "application/json;charset=utf-8" });
      var done = function () { notifyTransient(t("ct.export.json.done")); };
      var dlg = dialogHost();
      if (dlg && typeof dlg.saveFile === "function") {
        dlg.saveFile({
          blob: blob,
          filename: "orOS-contacts.json",
          mime: "application/json;charset=utf-8",
          types: [{ description: "JSON",
                    accept: { "application/json": [".json"] } }]
        }).then(function (r) { if (r && r.ok) done(); });
        return;                     // cancel (ok=false) = silent exit
      }
      // Standalone fallback — classic download (no shell present).
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "orOS-contacts.json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }, 200);
      done();
    } catch (e) { notifyTransient(t("ct.export.bad")); }
  }
  // Button injected AFTER the vcf export button (same class →
  // same styling, no contacts.html edit required).
  if ($("ct-export")) {
    var jsonBtn = document.createElement("button");
    jsonBtn.type = "button";
    jsonBtn.className = $("ct-export").className;
    jsonBtn.textContent = t("ct.export.json");
    jsonBtn.addEventListener("click", exportJson);
    $("ct-export").parentNode.insertBefore(jsonBtn, $("ct-export").nextSibling);
  }

  // ---- Full-database JSON restore (merge, zero data loss) ----
  // Accepts only our own export shape: { app: "contacts", ver,
  // labels, contacts, deleted }. Runs through mergeContacts (union
  // by id, bigger mtime wins, tombstones honored — the SAME
  // contract as a cloud pull) and lands via setFromSync, so a
  // restore can never overwrite newer local edits and can never
  // resurrect phantom deletes. restore == cloud pull, by design.
  function importJsonFile(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var d = JSON.parse(fr.result);
        if (!d || typeof d !== "object" || d.app !== "contacts" ||
            !Array.isArray(d.contacts)) {
          notifyTransient(t("ct.import.json.bad"));
          return;
        }
        var local = null;
        try { local = JSON.parse(localStorage.getItem(DATA_KEY)); } catch (e) {}
        var merged = mergeContacts(
          local || { ver: 1, labels: [], contacts: [], deleted: [] }, d);
        setFromSync(merged);
        saveState();   // persist + markDirty → restore pushes to cloud
        notifyTransient(t("ct.import.json.done")
          .replace("{n}", String(state.contacts.length)));
      } catch (e) {
        console.error("contacts: JSON restore failed:", e);
        notifyTransient(t("ct.import.json.bad"));
      }
    };
    fr.onerror = function () { notifyTransient(t("ct.import.bad")); };
    fr.readAsText(file, "utf-8");
  }
  // Hidden file input + injected button (mirror of the export
  // injection — no contacts.html edit required).
  if ($("ct-export")) {
    var jsonImpIn = document.createElement("input");
    jsonImpIn.type = "file";
    jsonImpIn.accept = "application/json,.json";
    jsonImpIn.style.display = "none";
    document.body.appendChild(jsonImpIn);
    jsonImpIn.addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";                    // allow re-import of same file
      importJsonFile(f);
    });
    var jsonImpBtn = document.createElement("button");
    jsonImpBtn.type = "button";
    jsonImpBtn.className = $("ct-export").className;
    jsonImpBtn.textContent = t("ct.import.json");
    jsonImpBtn.addEventListener("click", function () {
      var dlg = dialogHost();
      if (dlg && typeof dlg.openFile === "function") {
        dlg.openFile("application/json,.json")
          .then(function (f) { if (f) importJsonFile(f); });
        return;                     // cancel (null) = silent exit
      }
      jsonImpIn.click();            // standalone: legacy hidden input
    });
    // Anchor: AFTER the Export JSON button (jsonBtn) — final order
    // [Export] [Export JSON] [Import JSON].
    $("ct-export").parentNode.insertBefore(jsonImpBtn, jsonBtn.nextSibling);
  }

// ===== SYNC =====

  /* ---------- 8. Merge + register ----------
     mergeContacts: exact mirror of the calendar's mergeCalendars
     contract — union-by-id, per-entity bigger-mtime wins, tie →
     lexicographic JSON, survivors clear their tombstones, sorted
     output, NO Date.now() inside the merge (determinism R5). */

  function mergeEntity(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (b.mtime > a.mtime) return b;
    if (a.mtime > b.mtime) return a;
    return JSON.stringify(a) <= JSON.stringify(b) ? a : b;   // tie
  }

  function mergeContacts(local, remote) {
    if (!remote || typeof remote !== "object") return local;
    if (!local || typeof local !== "object") return remote;

    var tomb = {};
    var a = local.deleted || [], b = remote.deleted || [];
    a.concat(b).forEach(function (d) {
      if (!d || !d.id) return;
      if (!tomb[d.id] || d.mtime > tomb[d.id].mtime) tomb[d.id] = d;
    });

    function alive(entity) {
      var t = tomb[entity.id];
      if (!t) return true;
      return entity.mtime > t.mtime;          // edit outranks delete
    }

    function unionById(listA, listB) {
      var map = {};
      (listA || []).forEach(function (x) { if (x && x.id) map[x.id] = x; });
      (listB || []).forEach(function (x) { if (x && x.id) map[x.id] = mergeEntity(map[x.id], x); });
      return Object.keys(map).map(function (k) { return map[k]; })
        .filter(alive)
        .sort(function (x, y) { return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0); });
    }

    var merged = {
      ver: 1,
      labels:   unionById(local.labels, remote.labels),
      contacts: unionById(local.contacts, remote.contacts),
      deleted:  Object.keys(tomb).map(function (k) { return tomb[k]; })
                  .sort(function (x, y) { return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0); })
    };
    return merged;
  }

  // CT-7: canonical form of the slice — exactly what mergeContacts
  // returns for (x, x): one entry per id, sorted by id, tombstones
  // deduped (max) and applied. The getter returns this, so
  // merge(get, get) === get and two devices stop re-uploading (R26).
  function canonContacts(d) {
    if (!d || typeof d !== "object") return d;
    return mergeContacts(d, d);
  }

  // setFromSync: adopt externally-provided data (a pull, or a JSON
  // restore). CT-1: the merged data is PERSISTED here (no markDirty,
  // R6). It used to live in memory only, while the sync getter reads
  // localStorage: with the app open, a pulled contact never reached
  // storage, every upload carried the stale local copy, and two open
  // devices replaced each other's contacts in the cloud forever.
  // CT-2: a pull no longer closes the open dialogs (typed text was
  // lost on every auto-sync); the edit dialog saves only the fields
  // the user changed (see ct-save), the view card is redrawn from
  // the merged data, filters and Undo survive.
  function setFromSync(data, info) {
    if (!data || typeof data !== "object") return;
    if (Array.isArray(data.contacts)) {
      state.contacts = data.contacts.map(sanitizeContact).filter(Boolean);
    }
    if (Array.isArray(data.labels)) {
      var sl = data.labels.map(sanitizeLabel).filter(Boolean);
      if (sl.length) state.labels = sl;
    }
    if (Array.isArray(data.deleted)) {
      state.deleted = data.deleted.map(sanitizeTomb).filter(Boolean);
    }
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {
      console.error("contacts: could not store synced data:", e);
    }
    if ($("ct-view") && viewCardId) {
      var vc = contactById(viewCardId);
      if (vc) openViewCard(vc); else closeViewCard();
    }
    if ($("lbl-dlg") && $("lbl-dlg").open &&
        !($("lbl-list") && $("lbl-list").contains(document.activeElement))) {
      renderLblList();
    }
    if ($("ct-dlg") && $("ct-dlg").open) renderDlgLabels();
    renderChips();
    renderList();
    // info.merged → sync dot (taskbar), not toast (Wave 11 doctrine)
  }

  // Canonical sync bridge — Contract B funnel. Live registration
  // with mergeFn means: closed-app proxies, offline divergence
  // guard, carry mailbox flush and register-pull all work for this
  // app with ZERO extra code (sync.js v0.6–v0.9 contracts).
  var syncApi = null;
  try { syncApi = window.parent && window.parent.orosSync; } catch (e) { syncApi = null; }
  if (syncApi && typeof syncApi.registerSlice === "function") {
    try {
      syncApi.registerSlice(
        "contacts",
        function () {
          try { return canonContacts(JSON.parse(localStorage.getItem(DATA_KEY))); }
          catch (e) { return null; }
        },
        setFromSync,
        DATA_KEY,
        mergeContacts
      );
    } catch (e) { console.warn("contacts: sync registration failed:", e); }
    // Bridge the funnel the shell routes app dirty-calls through.
    try {
      window.__orosSyncApi = {
        dirty: function () { syncApi.markDirty(); },
        pull: function () { return syncApi.pull(); },
        push: function () { return syncApi.push(); }
      };
    } catch (e) {}
  }

// ===== BOOT =====

  /* ---------- 9. Boot sequence ---------- */
  loadState();
  reseedSeedNames();
  applyI18n();
  renderChips();
  renderList();

  // Wave 2.1 — the shell staged a contact deep-link while we were
  // closed (sessionStorage, one-shot take). Runs AFTER render so the
  // list is already painted behind the opening dialog.
  try {
    if (window.parent &&
        typeof window.parent.__orosContactsTakePending === "function") {
      var pending = window.parent.__orosContactsTakePending();
      if (pending) window.__orosContactsOpen(pending);
    }
  } catch (e) {}

  console.log("contacts.js v" + (SCRIPT_V || "?") + " ready · " +
              state.contacts.length + " contact(s), " +
              state.labels.length + " label(s)");

})();