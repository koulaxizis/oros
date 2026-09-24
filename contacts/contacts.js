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
      "rel.other": "Άλλη",
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
    toastTimer = setTimeout(hideToast, 5000);
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
      { id: "lbl-work",     name: t("lbl.work"),     color: LABEL_PALETTE[2], mtime: 0 },
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
    var changed = false;
    state.labels.forEach(function (l) {
      if (l.mtime === 0 && map[l.id] && l.name !== map[l.id]) {
        l.name = map[l.id];
        changed = true;
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
    try {
      var d = JSON.parse(localStorage.getItem(DATA_KEY));
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
      if (!state.labels.length) state.labels = defaultLabels();
    }
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
    // Simple normalization: given+family, trimmed lowercase.
    var s = [c.given, c.family].filter(Boolean).join(" ").toLowerCase().trim();
    // Collapse multiple spaces, strip accents (basic).
    return s.replace(/\s+/g, " ");
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
        li.className = "ct-row dup-member";
        li.appendChild(mkAvatarEl(c));
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
        li.appendChild(main);
        // Click to open merge dialog for this group.
        (function (gid) {
          li.addEventListener("click", function () { openMergeDlg(gid); });
        })(group.ids);
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

  /* ---------- 4. List render ---------- */
  function renderList() {
    var ul = $("ct-list");
    ul.textContent = "";

    var q = searchQ.trim().toLowerCase();
    var qDigits = phoneDigits(q);
    var qFold = greekFold(q);

    var hits = state.contacts.filter(function (c) {
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
        row.addEventListener("click", function () { openDlg(cc); });
      })(c);

      li.appendChild(row);
      ul.appendChild(li);
    });
  }

  /* ---------- 4b. Label filter chips (calendar mirror) ---------- */
  function renderChips() {
    var row = $("lbl-chips");
    row.textContent = "";
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

  if ($("search-in")) {
    $("search-in").addEventListener("input", function () {
      searchQ = this.value;
      renderList();
    });
  }
  if ($("imp-done")) {
    $("imp-done").addEventListener("click", function () {
      $("import-sec").hidden = true;
      $("imp-list").textContent = "";
    });
  }

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
    $("ct-dlg").showModal();
    setTimeout(function () { $("ct-given").focus(); }, 50);
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
    var given = $("ct-given").value.trim();
    var middle = $("ct-middle").value.trim();
    var family = $("ct-family").value.trim();
    var nickname = $("ct-nickname").value.trim();
    var org = $("ct-org").value.trim();
    var jobTitle = $("ct-jobtitle").value.trim();
    if (!given && !middle && !family && !nickname && !org) {
      var ti = $("ct-given");
      ti.classList.add("invalid");
      ti.focus();
      notifyTransient(t("ct.err.name"));
      setTimeout(function () { ti.classList.remove("invalid"); }, 1600);
      return;
    }

    var draft = {
      id: editingId || uid(),
      given: given, middle: middle, family: family,
      nickname: nickname, org: org, jobTitle: jobTitle,
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
      photo: editingPhoto,
      mtime: Date.now()
    };
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
        openDlg(state.contacts[i]);
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
    pendingMergeSnapshot = {
      contacts: JSON.parse(JSON.stringify(state.contacts)),
      deleted: JSON.parse(JSON.stringify(state.deleted))
    };

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
      lab.textContent = t("ct.field." + f);
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

  function undoMerge() {
    if (!pendingMergeSnapshot) return;
    state.contacts = pendingMergeSnapshot.contacts;
    state.deleted = pendingMergeSnapshot.deleted;
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
        var nv = ni.value.trim();
        if (!nv || nv === l.name) { ni.value = l.name; return; }
        l.name = nv.slice(0, 40);
        l.mtime = Date.now();                 // user intent outranks seeds
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
      var pop = null;
      cb.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (pop) { pop.parentNode.removeChild(pop); pop = null; return; }
        pop = document.createElement("div");
        pop.className = "lbl-palette";
        LABEL_PALETTE.forEach(function (col) {
          var s = document.createElement("button");
          s.type = "button";
          s.className = "lbl-swatch" + (col === l.color ? " active" : "");
          s.style.background = col;
          s.addEventListener("click", function () {
            l.color = col;
            l.mtime = Date.now();
            saveState();
            renderLblList();
            renderChips();
            renderList();
            if (pop) { pop.parentNode.removeChild(pop); pop = null; }
          });
          pop.appendChild(s);
        });
        document.body.appendChild(pop);
        // position near the button, clamped to viewport
        var r = cb.getBoundingClientRect();
        pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 190)) + "px";
        pop.style.top = (r.bottom + 6) + "px";
      });
      document.addEventListener("click", function (ev) {
        if (pop && !pop.contains(ev.target) && ev.target !== cb) {
          pop.parentNode.removeChild(pop); pop = null;
        }
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
        case "NOTE": c.note = vcfUnesc(p.value).trim().slice(0, 500); break;
        case "PHOTO": {
          // Accepted forms: our own data URI ("data:image/…;base64,…")
          // or raw base64 with an explicit TYPE=JPEG|PNG param.
          // http(s) URLs are NOT fetched (static OS, no network
          // dependency in imports) — silently skipped.
          var pv = p.value.trim();
          if (/^data:image\/(jpeg|png);base64,/.test(pv)) {
            c.photo = pv.slice(0, 50000);
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
        ["nickname", "org", "jobTitle", "note"].forEach(function (f) {
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
  if ($("ct-import")) {
    $("ct-import").addEventListener("click", function () { $("vcard-file").click(); });
  }
  if ($("vcard-file")) {
    $("vcard-file").addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";                       // allow re-import of same file
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
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "orOS-contacts.vcf";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          document.body.removeChild(a);
          URL.revokeObjectURL(a.href);
        }, 200);
        notifyTransient(t("ct.export.done"));
      } catch (e) { notifyTransient(t("ct.export.bad")); }
    });
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

  // setFromSync: adopt externally-provided data. Closes dialogs so a
  // background merge can never collide with an open edit dialog.
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
    try {
      $("ct-dlg").close();
      $("del-dlg").close();
      $("lbl-dlg").close();
    } catch (e) {}
    editingId = null;
    lastDeleted = null;
    labelVis = {};
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
          try { return JSON.parse(localStorage.getItem(DATA_KEY)); }
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