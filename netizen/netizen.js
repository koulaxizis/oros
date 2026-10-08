// ============================================================
// orOS Netizen ID — App logic (v1.0.0)
// A voluntary "identity card" for the netizen: username (the only
// required field), identity, contact, sites & socials, bio, motto,
// tags and a 12×12 pixel avatar, shown live as an ID-1 sized card
// (front + back) in five styles.
//   - several cards (personas); each field can be hidden from the card
//   - avatar: symmetric face generated from a seed, editable by pixel
//   - export: PNG / SVG (side shown), PDF (both sides, card size),
//     avatar PNG / SVG, vCard; copy image; view-only share link that
//     carries the card in the URL fragment (#c=…, never sent to a server)
// Data:
//   - synced slice "netizen" (oros-netizen-data): cards LWW by mtime
//     + tombstones (R5, R17, R26)
//   - device-local (R10): oros-netizen-prefs (current card, phone tab,
//     side shown)
// Sections:
//   1. Constants, i18n, helpers
//   2. Card model: normalize, merge (R5, R17, R26)
//   3. Pixel avatar: seeded generator
//   4. Storage + prefs
//   5. Card rendering (SVG: front, back, avatar)
//   6. Exports (PNG, SVG, PDF, vCard, copy image)
//   7. Share link (encode / decode, viewer)
//   8. Editor (form, avatar painter, links, tags, styles)
//   9. Cards (select, new, duplicate, delete + Undo)
//  10. Dialogs + toasts
//  11. Keyboard (Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-netizen-data";
  var PREFS_KEY   = "oros-netizen-prefs";
  var DATA_VER    = 1;

  var AV = 12;                                   // avatar grid size
  var MAX_CARDS = 20, MAX_LINKS = 8, MAX_TAGS = 12, TAG_LEN = 24;
  var LINK_LABEL = 24, LINK_URL = 120;
  var TEXT_FIELDS = { user: 32, disp: 48, pron: 24, loc: 48, langs: 48, since: 4,
                      email: 80, phone: 32, web: 120, bio: 280, motto: 100 };
  var TEXT_KEYS = ["user", "disp", "pron", "loc", "langs", "since",
                   "email", "phone", "web", "bio", "motto"];
  var HIDEABLE = ["avatar", "bio", "disp", "email", "langs", "links", "loc",
                  "motto", "phone", "pron", "since", "tags", "web"];
  var STYLES = ["oros", "terminal", "paper", "mint", "rose"];

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
      "tab.edit": "Edit", "tab.card": "Card",
      "sec.identity": "Identity", "sec.avatar": "Pixel avatar", "sec.contact": "Contact",
      "sec.links": "Sites & socials", "sec.about": "Bio & motto", "sec.tags": "Tags & traits",
      "sec.style": "Card style",
      "f.user": "Username", "f.disp": "Display name", "f.pron": "Pronouns",
      "f.loc": "Location", "f.langs": "Languages", "f.since": "Netizen since (year)",
      "f.email": "Email", "f.phone": "Phone", "f.web": "Website",
      "f.bio": "Bio", "f.motto": "Motto",
      "ph.user": "required", "ph.disp": "Ada Lovelace", "ph.pron": "she/her",
      "ph.loc": "Athens, Greece", "ph.langs": "Greek, English", "ph.since": "1999",
      "ph.email": "me@example.org", "ph.phone": "+30 …", "ph.web": "example.org",
      "ph.bio": "A few words about you", "ph.motto": "One line to live by",
      "ph.tag": "e.g. night owl", "ph.linkL": "Label", "ph.linkU": "Link",
      "eye.show": "Shown on the card", "eye.hide": "Hidden from the card",
      "av.roll": "New face", "av.clear": "Transparent background",
      "av.hint": "Tap or drag on the grid to paint with the chosen colour.",
      "av.grid": "Avatar, 12 by 12 pixels",
      "av.px": "Row {r}, column {c}",
      "av.col0": "Background / eraser", "av.col1": "Skin", "av.col2": "Hair",
      "av.col3": "Eyes", "av.col4": "Mouth", "av.col5": "Clothes", "av.col6": "Accent",
      "link.add": "Add link", "link.up": "Move up", "link.down": "Move down", "link.del": "Remove link",
      "tag.add": "Add", "tag.del": "Remove tag {tag}",
      "style.oros": "orOS", "style.terminal": "Terminal", "style.paper": "Paper",
      "style.mint": "Mint", "style.rose": "Rose",
      "btn.new": "New card", "btn.dup": "Duplicate card", "btn.del": "Delete card",
      "btn.flip": "Flip card", "btn.copy": "Copy card image", "btn.share": "Share link",
      "btn.export": "Export", "btn.cards": "Cards",
      "card.untitled": "(no username)", "card.draft": "New card",
      "side.front": "Front", "side.back": "Back",
      "c.label": "NETIZEN ID", "c.loc": "LOCATION", "c.langs": "LANGUAGES", "c.since": "NETIZEN SINCE",
      "c.about": "ABOUT", "c.email": "EMAIL", "c.phone": "PHONE", "c.web": "WEB",
      "c.empty": "Nothing to show on this side yet.",
      "c.noname": "username",
      "exp.title": "Export", "exp.side": "Side shown: {side}",
      "exp.png": "Card · PNG", "exp.svg": "Card · SVG", "exp.pdf": "Card · PDF (both sides)",
      "exp.avpng": "Avatar · PNG", "exp.avsvg": "Avatar · SVG", "exp.vcf": "Contact · vCard (.vcf)",
      "exp.close": "Close",
      "share.title": "Share link",
      "share.warn": "The link carries everything shown on this card. Anyone who has it can see it. Hidden fields stay out. Nothing is sent to a server.",
      "share.copy": "Copy link", "share.close": "Close",
      "view.flip": "Flip", "view.open": "Open Netizen ID",
      "confirm.no": "Cancel",
      "toast.exported": "Exported", "toast.copied": "Copied", "toast.linkCopied": "Link copied",
      "toast.copyFail": "Copying is not available here",
      "toast.save": "Could not save: storage is full",
      "toast.needUser": "Add a username first",
      "toast.deleted": "Card deleted", "toast.undo": "Undo",
      "toast.rolled": "New face", "toast.maxCards": "Up to {n} cards",
      "toast.maxLinks": "Up to {n} links", "toast.maxTags": "Up to {n} tags",
      "toast.tagDup": "That tag is already there", "toast.badLink": "This share link is damaged",
      "toast.exportFail": "Export failed", "toast.dup": "Card duplicated", "toast.new": "New card"
    },
    el: {
      "tab.edit": "Επεξεργασία", "tab.card": "Κάρτα",
      "sec.identity": "Ταυτότητα", "sec.avatar": "Pixel avatar", "sec.contact": "Επικοινωνία",
      "sec.links": "Sites & socials", "sec.about": "Bio & μότο", "sec.tags": "Ετικέτες & χαρακτηριστικά",
      "sec.style": "Στυλ κάρτας",
      "f.user": "Όνομα χρήστη", "f.disp": "Εμφανιζόμενο όνομα", "f.pron": "Αντωνυμίες",
      "f.loc": "Τοποθεσία", "f.langs": "Γλώσσες", "f.since": "Netizen από (έτος)",
      "f.email": "Email", "f.phone": "Τηλέφωνο", "f.web": "Ιστοσελίδα",
      "f.bio": "Bio", "f.motto": "Μότο",
      "ph.user": "υποχρεωτικό", "ph.disp": "Ελένη Παπαδοπούλου", "ph.pron": "αυτή",
      "ph.loc": "Αθήνα, Ελλάδα", "ph.langs": "Ελληνικά, Αγγλικά", "ph.since": "1999",
      "ph.email": "me@example.org", "ph.phone": "+30 …", "ph.web": "example.org",
      "ph.bio": "Λίγα λόγια για σένα", "ph.motto": "Μία φράση-οδηγός",
      "ph.tag": "π.χ. νυχτοπούλι", "ph.linkL": "Ετικέτα", "ph.linkU": "Σύνδεσμος",
      "eye.show": "Φαίνεται στην κάρτα", "eye.hide": "Κρυφό από την κάρτα",
      "av.roll": "Νέο πρόσωπο", "av.clear": "Διάφανο φόντο",
      "av.hint": "Πάτα ή σύρε πάνω στο πλέγμα για να ζωγραφίσεις με το χρώμα που διάλεξες.",
      "av.grid": "Avatar, 12 επί 12 pixel",
      "av.px": "Γραμμή {r}, στήλη {c}",
      "av.col0": "Φόντο / γόμα", "av.col1": "Δέρμα", "av.col2": "Μαλλιά",
      "av.col3": "Μάτια", "av.col4": "Στόμα", "av.col5": "Ρούχα", "av.col6": "Αξεσουάρ",
      "link.add": "Προσθήκη συνδέσμου", "link.up": "Πάνω", "link.down": "Κάτω", "link.del": "Αφαίρεση συνδέσμου",
      "tag.add": "Προσθήκη", "tag.del": "Αφαίρεση ετικέτας {tag}",
      "style.oros": "orOS", "style.terminal": "Τερματικό", "style.paper": "Χαρτί",
      "style.mint": "Μέντα", "style.rose": "Ροζ",
      "btn.new": "Νέα κάρτα", "btn.dup": "Αντίγραφο κάρτας", "btn.del": "Διαγραφή κάρτας",
      "btn.flip": "Γύρισμα κάρτας", "btn.copy": "Αντιγραφή εικόνας κάρτας", "btn.share": "Σύνδεσμος κοινοποίησης",
      "btn.export": "Εξαγωγή", "btn.cards": "Κάρτες",
      "card.untitled": "(χωρίς όνομα χρήστη)", "card.draft": "Νέα κάρτα",
      "side.front": "Πρόσοψη", "side.back": "Πίσω όψη",
      "c.label": "NETIZEN ID", "c.loc": "ΤΟΠΟΘΕΣΙΑ", "c.langs": "ΓΛΩΣΣΕΣ", "c.since": "NETIZEN ΑΠΟ",
      "c.about": "ΣΧΕΤΙΚΑ", "c.email": "EMAIL", "c.phone": "ΤΗΛΕΦΩΝΟ", "c.web": "WEB",
      "c.empty": "Δεν υπάρχει ακόμα τίποτα για αυτή την όψη.",
      "c.noname": "όνομα χρήστη",
      "exp.title": "Εξαγωγή", "exp.side": "Όψη: {side}",
      "exp.png": "Κάρτα · PNG", "exp.svg": "Κάρτα · SVG", "exp.pdf": "Κάρτα · PDF (και οι δύο όψεις)",
      "exp.avpng": "Avatar · PNG", "exp.avsvg": "Avatar · SVG", "exp.vcf": "Επαφή · vCard (.vcf)",
      "exp.close": "Κλείσιμο",
      "share.title": "Σύνδεσμος κοινοποίησης",
      "share.warn": "Ο σύνδεσμος περιέχει ό,τι δείχνει η κάρτα. Όποιος τον έχει, το βλέπει. Τα κρυφά πεδία μένουν έξω. Τίποτα δεν στέλνεται σε server.",
      "share.copy": "Αντιγραφή συνδέσμου", "share.close": "Κλείσιμο",
      "view.flip": "Γύρισμα", "view.open": "Άνοιγμα του Netizen ID",
      "confirm.no": "Άκυρο",
      "toast.exported": "Η εξαγωγή έγινε", "toast.copied": "Αντιγράφηκε", "toast.linkCopied": "Ο σύνδεσμος αντιγράφηκε",
      "toast.copyFail": "Η αντιγραφή δεν είναι διαθέσιμη εδώ",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.needUser": "Βάλε πρώτα όνομα χρήστη",
      "toast.deleted": "Η κάρτα διαγράφηκε", "toast.undo": "Αναίρεση",
      "toast.rolled": "Νέο πρόσωπο", "toast.maxCards": "Έως {n} κάρτες",
      "toast.maxLinks": "Έως {n} σύνδεσμοι", "toast.maxTags": "Έως {n} ετικέτες",
      "toast.tagDup": "Η ετικέτα υπάρχει ήδη", "toast.badLink": "Ο σύνδεσμος κοινοποίησης είναι χαλασμένος",
      "toast.exportFail": "Η εξαγωγή απέτυχε", "toast.dup": "Δημιουργήθηκε αντίγραφο", "toast.new": "Νέα κάρτα"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var str = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        str = str.split("{" + k + "}").join(String(params[k]));
      });
    }
    return str;
  }

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // FNV-1a, 32 bit: the seed / card-number hash.
  function hash32(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32: small deterministic PRNG for the avatar.
  function prng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }
  function newSeed() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return (r[0].toString(36) + r[1].toString(36)).slice(0, 12);
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("netizen.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Card model ----------
  // card = {
  //   id, m (mtime, ms),
  //   user, disp, pron, loc, langs, since, email, phone, web, bio, motto,
  //   links: [{ l: label, u: url }],
  //   tags: [string],
  //   hide: [field…]          // sorted; fields kept but not shown on the card
  //   st: style id,
  //   av: { s: seed, px: "" | 144 digits 0–6 (painted), t: 0 | 1 (transparent) }
  // }
  // data = { ver: 1, cards: [card…] sorted by id, tombs: { id: deletedAt } }
  function normCard(c) {
    if (!c || typeof c !== "object" || typeof c.id !== "string" ||
        !/^[a-z0-9]{6,40}$/.test(c.id) || !isInt(c.m) || c.m < 0) return null;
    var out = { id: c.id, m: c.m };
    TEXT_KEYS.forEach(function (k) { out[k] = str(c[k], TEXT_FIELDS[k]); });
    out.links = [];
    if (Array.isArray(c.links)) {
      c.links.forEach(function (x) {
        if (out.links.length >= MAX_LINKS || !x || typeof x !== "object") return;
        out.links.push({ l: str(x.l, LINK_LABEL), u: str(x.u, LINK_URL) });
      });
    }
    out.tags = [];
    if (Array.isArray(c.tags)) {
      c.tags.forEach(function (x) {
        var s = str(x, TAG_LEN);
        if (s && out.tags.length < MAX_TAGS && out.tags.indexOf(s) < 0) out.tags.push(s);
      });
    }
    var hide = [];
    if (Array.isArray(c.hide)) {
      c.hide.forEach(function (k) { if (HIDEABLE.indexOf(k) >= 0 && hide.indexOf(k) < 0) hide.push(k); });
    }
    out.hide = hide.sort(cmpStr);
    out.st = STYLES.indexOf(c.st) >= 0 ? c.st : "oros";
    var av = (c.av && typeof c.av === "object") ? c.av : {};
    out.av = {
      s: (typeof av.s === "string" && /^[a-z0-9]{1,24}$/.test(av.s)) ? av.s : "netizen",
      px: (typeof av.px === "string" && /^[0-6]{144}$/.test(av.px)) ? av.px : "",
      t: av.t === 1 ? 1 : 0
    };
    return out;
  }

  // LWW per card (newer m wins; equal m: the larger canonical JSON),
  // tombstones max-merged, delete wins ties, a newer edit resurrects (R17).
  function mergeNetizen(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!/^[a-z0-9]{6,40}$/.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.cards, b.cards].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var c = normCard(raw);
        if (!c) return;
        var cur = best[c.id];
        if (!cur || c.m > cur.m ||
            (c.m === cur.m && JSON.stringify(c) > JSON.stringify(cur))) best[c.id] = c;
      });
    });
    var cards = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      cards.push(best[id]);
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, cards: cards, tombs: sortedTombs };
  }

  function shown(card, k) { return card.hide.indexOf(k) < 0; }

  // ---------- 3. Pixel avatar ----------
  // 7 colours: 0 background, 1 skin, 2 hair, 3 eyes, 4 mouth, 5 clothes, 6 accent.
  var AV_BG    = ["#f4d35e", "#9bd1e5", "#c3b1e1", "#a8e6a3", "#f7a6a6", "#ffd6a5", "#b8c0ff", "#d9d9d9"];
  var AV_SKIN  = ["#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffe0bd", "#a1665e"];
  var AV_HAIR  = ["#2c1b10", "#5a3825", "#a0522d", "#d6b370", "#e8e8e8", "#1c1c1c", "#b5463c", "#6a4c93", "#3a7ca5"];
  var AV_EYES  = ["#1b1b1b", "#2e5e8c", "#3d7a3d", "#5b3a1a"];
  var AV_MOUTH = ["#9e3b3b", "#7a2e2e", "#c0504d"];
  var AV_SHIRT = ["#e63946", "#457b9d", "#2a9d8f", "#f4a261", "#6d597a", "#264653", "#ff7aa2"];
  var AV_ACC   = ["#111111", "#d4af37", "#f0f0f0", "#e63946"];
  // Head: first skin column of the left half per row 2…9 (the face is
  // mirrored around the centre, columns 5 | 6).
  var HEADS = [[3, 2, 2, 2, 2, 2, 3, 4], [2, 2, 2, 2, 2, 2, 2, 3], [3, 3, 3, 3, 3, 3, 3, 4]];

  function genAvatar(seed) {
    var rnd = prng(hash32("av:" + seed));
    function pick(list) { return list[Math.floor(rnd() * list.length)]; }
    var pal = [pick(AV_BG), pick(AV_SKIN), pick(AV_HAIR), pick(AV_EYES),
               pick(AV_MOUTH), pick(AV_SHIRT), pick(AV_ACC)];
    var g = [];
    for (var y = 0; y < AV; y++) { g.push([0, 0, 0, 0, 0, 0]); }   // left half
    function set(yy, x, v) { if (yy >= 0 && yy < AV && x >= 0 && x < 6) g[yy][x] = v; }
    var head = HEADS[Math.floor(rnd() * HEADS.length)];
    var y2;
    for (y2 = 2; y2 <= 9; y2++) for (var x = head[y2 - 2]; x < 6; x++) set(y2, x, 1);
    // ears
    if (rnd() < 0.7) { set(5, head[3] - 1, 1); set(6, head[4] - 1, 1); }
    // neck + clothes
    set(10, 4, 1); set(10, 5, 1);
    for (x = 1; x < 4; x++) set(10, x, 5);
    for (x = 0; x < 6; x++) set(11, x, 5);
    if (rnd() < 0.4) set(11, 5, 6);                         // collar / pendant
    // hair
    var hs = Math.floor(rnd() * 5);
    if (hs !== 3) {                                         // 3 = bald
      for (x = 3; x < 6; x++) set(1, x, 2);
      for (x = head[0]; x < 6; x++) set(2, x, 2);
      set(3, head[1], 2);
      if (hs === 1) {                                       // long
        for (y2 = 3; y2 <= 8; y2++) { set(y2, head[y2 - 2] - 1, 2); set(y2, head[y2 - 2], 2); }
      } else if (hs === 2) {                                // spiky
        set(0, 3, 2); set(0, 5, 2); set(1, 2, 2);
      } else if (hs === 4) {                                // bun
        set(0, 4, 2); set(0, 5, 2);
        set(3, 3, 2); set(3, 4, 2);
      }
    }
    // eyes, brows, glasses
    var ey = rnd() < 0.5 ? 5 : 6;
    set(ey, 3, 3);
    if (rnd() < 0.5) set(ey - 1, 3, 2);
    if (rnd() < 0.25) { set(ey, 2, 6); set(ey, 4, 6); set(ey - 1, 2, 6); set(ey - 1, 3, 6); set(ey - 1, 4, 6); set(ey, 5, 6); }
    // mouth
    var ms = Math.floor(rnd() * 3);
    if (ms === 0) { set(8, 4, 4); set(8, 5, 4); }
    else if (ms === 1) { set(8, 3, 4); set(8, 4, 4); set(8, 5, 4); }
    else { set(7, 3, 4); set(8, 4, 4); set(8, 5, 4); }
    // blush
    if (rnd() < 0.3 && g[7][2] === 1) set(7, 2, 4);
    var out = "";
    for (y2 = 0; y2 < AV; y2++) {
      var row = g[y2];
      out += row.join("") + row.slice().reverse().join("");
    }
    return { pal: pal, px: out };
  }

  function avatarOf(card) {
    var gen = genAvatar(card.av.s);
    return { pal: gen.pal, px: card.av.px || gen.px };
  }

  // ---------- 4. Storage + prefs ----------
  var data = null;
  var prefs = { cur: "", tab: "edit", side: "front" };
  var draft = null;           // a new card, stored on its first edit

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.cards)) {
          data = mergeNetizen(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] netizen: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: DATA_VER, cards: [], tombs: {} };
  }

  var saveFailShown = false, saveTimer = null;
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 350);
  }
  function flush() { if (saveTimer) saveNow(); }

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (typeof p.cur === "string") prefs.cur = p.cur;
        if (p.tab === "edit" || p.tab === "card") prefs.tab = p.tab;
        if (p.side === "front" || p.side === "back") prefs.side = p.side;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function cardById(id) {
    for (var i = 0; i < data.cards.length; i++) if (data.cards[i].id === id) return data.cards[i];
    return null;
  }
  function blankCard() {
    return normCard({ id: newId(), m: Date.now(), st: "oros", av: { s: newSeed() } });
  }
  // The card in the editor: a stored card, or the draft until its first edit.
  function cur() {
    var c = cardById(prefs.cur);
    if (c) return c;
    // the draft stays only while it is chosen (New card) or nothing is stored;
    // cards arriving by sync replace an untouched start-up draft
    if (draft && (prefs.cur === draft.id || !data.cards.length)) return draft;
    if (data.cards.length) {
      draft = null;
      prefs.cur = data.cards[0].id; savePrefs();
      return data.cards[0];
    }
    draft = blankCard();
    return draft;
  }
  function isDraft(c) { return c === draft; }

  // Every edit goes through here: stamps mtime at the mutation site (R27),
  // stores the draft on its first real edit (R16 lazy), saves soon.
  function mutate(fn) {
    var c = cur();
    fn(c);
    c.m = Math.max(Date.now(), c.m + 1, (data.tombs[c.id] || 0) + 1);
    if (isDraft(c)) {
      draft = null;
      prefs.cur = c.id; savePrefs();
      data.cards.push(c);
      data = mergeNetizen(data, data);
      renderCardSelect();
    } else {
      // normalize in place (the stored card is the object being edited)
      var n = normCard(c);
      Object.keys(n).forEach(function (k) { c[k] = n[k]; });
    }
    saveSoon();
    renderPreview();
    renderCardSelectLabel();
  }

  // ---------- 5. Card rendering ----------
  var CW = 856, CH = 540;                        // ID-1 (85.6 × 54 mm) × 10
  var SANS = "Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif";
  var MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace";
  var SERIF = "Georgia, Cambria, Times New Roman, serif";

  function cssVar(name, fb) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fb;
    } catch (e) { return fb; }
  }

  function theme(st) {
    if (st === "terminal") return { bg: "#0b0f0c", panel: "#111a13", fg: "#b9ffb3", dim: "#5f9a63",
      accent: "#39ff88", border: "#1f3a25", font: MONO };
    if (st === "paper") return { bg: "#f5efe0", panel: "#ece3cd", fg: "#2b2620", dim: "#7a6f5d",
      accent: "#b0412e", border: "#d3c6a8", font: SERIF };
    if (st === "mint") return { bg: "#dff5ea", panel: "#c9ecda", fg: "#12392b", dim: "#4f7d69",
      accent: "#0f8f61", border: "#a9dcc2", font: SANS };
    if (st === "rose") return { bg: "#fde4ea", panel: "#f8cfd9", fg: "#4a1c27", dim: "#8e5866",
      accent: "#c92a62", border: "#f0b3c3", font: SANS };
    return { bg: cssVar("--panel-bg", "#1d1a13"), panel: cssVar("--bg", "#14120d"),
      fg: cssVar("--text", "#f0ead9"), dim: cssVar("--text-dim", "#a89f8a"),
      accent: cssVar("--accent", "#d4af37"), border: cssVar("--border", "#322d20"), font: SANS };
  }

  // Text measurement for wrapping / fitting (same font stacks as the SVG).
  var measureCtx = null;
  function textW(s, size, weight, family) {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = (weight || 400) + " " + size + "px " + family;
    return measureCtx.measureText(s).width;
  }
  function fit(s, size, weight, family, maxW) {
    if (textW(s, size, weight, family) <= maxW) return s;
    var lo = 0, hi = s.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (textW(s.slice(0, mid) + "…", size, weight, family) <= maxW) lo = mid; else hi = mid - 1;
    }
    return s.slice(0, lo).replace(/\s+$/, "") + "…";
  }
  function wrap(s, size, weight, family, maxW, maxLines) {
    var lines = [];
    var paras = String(s).split(/\n/);
    for (var p = 0; p < paras.length; p++) {
      var words = paras[p].split(/\s+/).filter(Boolean), line = "";
      if (!words.length) { lines.push(""); continue; }
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        var tryLine = line ? line + " " + w : w;
        if (textW(tryLine, size, weight, family) <= maxW) { line = tryLine; continue; }
        if (line) lines.push(line);
        // a single word longer than the line breaks by character
        while (textW(w, size, weight, family) > maxW && w.length > 1) {
          var k = w.length;
          while (k > 1 && textW(w.slice(0, k), size, weight, family) > maxW) k--;
          lines.push(w.slice(0, k));
          w = w.slice(k);
        }
        line = w;
      }
      lines.push(line);
    }
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = fit(lines[maxLines - 1] + "…", size, weight, family, maxW);
    }
    return lines;
  }

  function txt(x, y, s, size, weight, fill, family, extra) {
    return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" font-weight="' + (weight || 400) +
      '" fill="' + fill + '" font-family="' + esc(family) + '"' + (extra || "") + ">" + esc(s) + "</text>";
  }

  function avatarRects(card, x0, y0, size, withBg) {
    var a = avatarOf(card), px = size / AV, out = "";
    if (withBg && !card.av.t) {
      out += '<rect x="' + x0 + '" y="' + y0 + '" width="' + size + '" height="' + size + '" fill="' + a.pal[0] + '"/>';
    }
    for (var y = 0; y < AV; y++) {
      var x = 0;
      while (x < AV) {
        var v = +a.px.charAt(y * AV + x), run = 1;
        while (x + run < AV && +a.px.charAt(y * AV + x + run) === v) run++;
        if (v !== 0) {
          out += '<rect x="' + (x0 + x * px) + '" y="' + (y0 + y * px) + '" width="' + (run * px) +
            '" height="' + px + '" fill="' + a.pal[v] + '"/>';
        }
        x += run;
      }
    }
    return out;
  }

  function avatarSvg(card, size, standalone) {
    var head = standalone
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + " " + size + '" shape-rendering="crispEdges">'
      : '<svg viewBox="0 0 ' + size + " " + size + '" shape-rendering="crispEdges" aria-hidden="true">';
    return head + avatarRects(card, 0, 0, size, true) + "</svg>";
  }

  function cardNo(card) {
    var h = hash32("no:" + card.id).toString(16).toUpperCase();
    while (h.length < 8) h = "0" + h;
    return "No. " + h.slice(0, 4) + "·" + h.slice(4);
  }

  // Machine-readable zone, passport style: NTZ<USER<<DISPLAY<NAME<<<…
  function mrz(card) {
    function clean(s) { return s.toUpperCase().replace(/[^A-Z0-9]+/g, "<"); }
    var s = "NTZ<" + clean(card.user) + "<<" + (shown(card, "disp") ? clean(card.disp) : "");
    while (s.length < 40) s += "<";
    return s.slice(0, 40);
  }

  function frame(th, standalone, inner) {
    var head = standalone
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="' + CW + '" height="' + CH + '" viewBox="0 0 ' + CW + " " + CH + '">'
      : '<svg viewBox="0 0 ' + CW + " " + CH + '" role="img">';
    return head +
      '<rect x="1.5" y="1.5" width="' + (CW - 3) + '" height="' + (CH - 3) + '" rx="30" fill="' + th.bg +
      '" stroke="' + th.border + '" stroke-width="3"/>' + inner + "</svg>";
  }

  function header(th, right) {
    return txt(40, 62, t("c.label"), 18, 800, th.accent, th.font, ' letter-spacing="4"') +
      txt(CW - 40, 62, right, 16, 600, th.dim, th.font, ' text-anchor="end"') +
      '<line x1="40" y1="84" x2="' + (CW - 40) + '" y2="84" stroke="' + th.border + '" stroke-width="2"/>';
  }

  function cardFront(card, standalone) {
    var th = theme(card.st), f = th.font, s = "";
    s += header(th, cardNo(card));
    var x0 = 40, colX = 300, colW = CW - 40 - colX;
    if (shown(card, "avatar")) {
      s += '<rect x="' + (x0 - 2) + '" y="106" width="232" height="232" rx="14" fill="' + th.panel +
        '" stroke="' + th.border + '" stroke-width="2"/>';
      s += '<g shape-rendering="crispEdges">' + avatarRects(card, x0 + 2, 110, 224, true) + "</g>";
    } else {
      colX = 40; colW = CW - 80;
    }
    var user = card.user.trim() || t("c.noname");
    s += txt(colX, 150, fit("@" + user, 40, 800, f, colW), 40, 800, card.user.trim() ? th.fg : th.dim, f);
    var sub = [];
    if (shown(card, "disp") && card.disp.trim()) sub.push(card.disp.trim());
    var subLine = sub.join("");
    var pron = shown(card, "pron") && card.pron.trim() ? card.pron.trim() : "";
    if (subLine || pron) {
      var dispFit = fit(subLine, 24, 600, f, colW - (pron ? textW(" · " + pron, 20, 400, f) : 0));
      s += '<text x="' + colX + '" y="190" font-family="' + esc(f) + '">' +
        (dispFit ? '<tspan font-size="24" font-weight="600" fill="' + th.fg + '">' + esc(dispFit) + "</tspan>" : "") +
        (pron ? '<tspan font-size="20" fill="' + th.dim + '">' + esc((dispFit ? " · " : "") + pron) + "</tspan>" : "") +
        "</text>";
    }
    var y = 240;
    [["loc", "c.loc"], ["langs", "c.langs"], ["since", "c.since"]].forEach(function (r) {
      var v = card[r[0]].trim();
      if (!v || !shown(card, r[0]) || y > 380) return;
      s += txt(colX, y, t(r[1]), 13, 800, th.dim, f, ' letter-spacing="2"');
      s += txt(colX, y + 27, fit(v, 22, 500, f, colW), 22, 500, th.fg, f);
      y += 64;
    });
    if (shown(card, "motto") && card.motto.trim()) {
      var lines = wrap("“" + card.motto.trim() + "”", 22, 600, f, CW - 80, 2);
      var my = lines.length > 1 ? 410 : 440;
      lines.forEach(function (ln, i) {
        s += txt(40, my + i * 30, ln, 22, 600, th.accent, f, ' font-style="italic"');
      });
    }
    s += txt(40, 512, mrz(card), 17, 500, th.dim, MONO, ' letter-spacing="3"');
    return frame(th, standalone, s);
  }

  function cardBack(card, standalone) {
    var th = theme(card.st), f = th.font, s = "";
    s += header(th, "@" + (card.user.trim() || t("c.noname")));
    var y = 124, W = CW - 80, any = false;
    if (shown(card, "bio") && card.bio.trim()) {
      any = true;
      s += txt(40, y, t("c.about"), 13, 800, th.dim, f, ' letter-spacing="2"');
      y += 30;
      wrap(card.bio.trim(), 20, 400, f, W, 4).forEach(function (ln) {
        s += txt(40, y, ln, 20, 400, th.fg, f);
        y += 27;
      });
      y += 10;
    }
    if (shown(card, "tags") && card.tags.length) {
      any = true;
      y += 14;
      var x = 40, rows = 1;
      for (var i = 0; i < card.tags.length; i++) {
        var label = card.tags[i], w = textW(label, 15, 700, f) + 24;
        if (x + w > CW - 40 && x > 40) {
          if (rows === 2) break;
          rows++; x = 40; y += 40;
        }
        if (w > CW - 80) { label = fit(label, 15, 700, f, CW - 104); w = CW - 80; }
        s += '<rect x="' + x + '" y="' + (y - 21) + '" width="' + w + '" height="30" rx="15" fill="none" stroke="' +
          th.accent + '" stroke-width="2"/>';
        s += txt(x + 12, y, label, 15, 700, th.accent, f);
        x += w + 8;
      }
      y += 44;
    }
    var rowsC = [];
    if (shown(card, "email") && card.email.trim()) rowsC.push([t("c.email"), card.email.trim()]);
    if (shown(card, "phone") && card.phone.trim()) rowsC.push([t("c.phone"), card.phone.trim()]);
    if (shown(card, "web") && card.web.trim()) rowsC.push([t("c.web"), card.web.trim()]);
    if (shown(card, "links")) {
      card.links.forEach(function (l) {
        if (l.u.trim() || l.l.trim()) rowsC.push([(l.l.trim() || "LINK").toUpperCase(), l.u.trim()]);
      });
    }
    // contact rows: two columns when they don't fit in one
    var room = Math.max(0, Math.floor((CH - 52 - y) / 30));
    if (rowsC.length) any = true;
    var twoCol = rowsC.length > room;
    var colW2 = twoCol ? (W - 24) / 2 : W;
    var perCol = twoCol ? room : rowsC.length;
    rowsC.slice(0, twoCol ? room * 2 : room).forEach(function (r, k) {
      var col = Math.floor(k / Math.max(1, perCol)), rr = k % Math.max(1, perCol);
      var cx = 40 + col * (colW2 + 24), cy = y + rr * 30;
      var lw = Math.min(130, colW2 * 0.38);
      s += txt(cx, cy, fit(r[0], 13, 800, f, lw - 8), 13, 800, th.dim, f, ' letter-spacing="1.5"');
      s += txt(cx + lw, cy, fit(r[1], 18, 500, f, colW2 - lw), 18, 500, th.fg, f);
    });
    if (!any) s += txt(40, 150, t("c.empty"), 20, 400, th.dim, f);
    s += txt(CW - 40, CH - 28, "useoros.online", 14, 600, th.dim, f, ' text-anchor="end"');
    return frame(th, standalone, s);
  }

  function cardSvg(card, side, standalone) {
    return side === "back" ? cardBack(card, standalone) : cardFront(card, standalone);
  }

  var previewRaf = 0;
  function renderPreview() {
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(function () {
      previewRaf = 0;
      var c = cur();
      $("face-front").innerHTML = cardSvg(c, "front", false);
      $("face-back").innerHTML = cardSvg(c, "back", false);
      $("face-front").querySelector("svg").setAttribute("aria-label", t("side.front"));
      $("face-back").querySelector("svg").setAttribute("aria-label", t("side.back"));
      renderSide();
    });
  }
  function renderSide() {
    var back = prefs.side === "back";
    $("flip").classList.toggle("back", back);
    $("face-front").setAttribute("aria-hidden", back ? "true" : "false");
    $("face-back").setAttribute("aria-hidden", back ? "false" : "true");
    $("side-label").textContent = t(back ? "side.back" : "side.front");
  }

  // ---------- 6. Exports ----------
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }

  function downloadBlob(blob, fileName, mime, types) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({ blob: blob, filename: fileName, mime: mime, types: types })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;                         // cancel (ok=false) = silent exit
    }
    // Standalone fallback — classic download (no shell present).
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast(t("toast.exported"));
  }

  function fileBase(card) {
    var u = card.user.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return "netizen-" + (u || "card");
  }

  // SVG string → PNG (default) or JPEG blob at the given pixel size.
  function rasterize(svg, w, h, type) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      var img = new Image();
      img.onload = function () {
        try {
          var cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          var ctx = cv.getContext("2d");
          ctx.imageSmoothingEnabled = false;
          if (type === "image/jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); }
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("toBlob")); },
                    type || "image/png", 0.92);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("image")); };
      img.src = url;
    });
  }
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function needUser(card) {
    if (card.user.trim()) return false;
    showToast(t("toast.needUser"));                      // R28
    return true;
  }

  var PNG_TYPES = [{ description: "PNG", accept: { "image/png": [".png"] } }];
  var SVG_TYPES = [{ description: "SVG", accept: { "image/svg+xml": [".svg"] } }];

  function exportCardPng() {
    var c = cur();
    if (needUser(c)) return;
    rasterize(cardSvg(c, prefs.side, true), CW * 2, CH * 2).then(function (b) {
      downloadBlob(b, fileBase(c) + "-" + prefs.side + ".png", "image/png", PNG_TYPES);
    }, function () { showToast(t("toast.exportFail")); });
  }
  function exportCardSvg() {
    var c = cur();
    if (needUser(c)) return;
    var b = new Blob([cardSvg(c, prefs.side, true)], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(b, fileBase(c) + "-" + prefs.side + ".svg", "image/svg+xml", SVG_TYPES);
  }
  function exportAvatarPng() {
    var c = cur();
    rasterize(avatarSvg(c, 480, true), 480, 480).then(function (b) {
      downloadBlob(b, fileBase(c) + "-avatar.png", "image/png", PNG_TYPES);
    }, function () { showToast(t("toast.exportFail")); });
  }
  function exportAvatarSvg() {
    var c = cur();
    var b = new Blob([avatarSvg(c, 480, true)], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(b, fileBase(c) + "-avatar.svg", "image/svg+xml", SVG_TYPES);
  }

  // PDF: two pages at card size (85.6 × 54 mm), each a 3× JPEG of a side
  // (on white: the rounded corners are the paper).
  function exportPdf() {
    var c = cur();
    if (needUser(c)) return;
    var JsPDF = window.jspdf && window.jspdf.jsPDF;
    if (!JsPDF) { showToast(t("toast.exportFail")); return; }
    Promise.all([rasterize(cardSvg(c, "front", true), CW * 3, CH * 3, "image/jpeg"),
                 rasterize(cardSvg(c, "back", true), CW * 3, CH * 3, "image/jpeg")])
      .then(function (bs) { return Promise.all(bs.map(blobToDataUrl)); })
      .then(function (urls) {
        var doc = new JsPDF({ orientation: "landscape", unit: "mm", format: [85.6, 54] });
        doc.addImage(urls[0], "JPEG", 0, 0, 85.6, 54);
        doc.addPage([85.6, 54], "landscape");
        doc.addImage(urls[1], "JPEG", 0, 0, 85.6, 54);
        doc.setProperties({ title: "Netizen ID · @" + c.user.trim(), creator: "orOS" });
        downloadBlob(doc.output("blob"), fileBase(c) + ".pdf", "application/pdf",
          [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }]);
      })
      .catch(function () { showToast(t("toast.exportFail")); });
  }

  // vCard 3.0. Only what the card shows goes in (hidden fields stay out).
  function vEsc(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }
  // Fold at 75 octets (UTF-8), continuation lines start with a space.
  function vFold(line) {
    var out = [], cur2 = "", bytes = 0, limit = 75;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i), code = line.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < line.length) { ch += line.charAt(i + 1); i++; }
      var cp = ch.codePointAt(0);
      var n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      if (bytes + n > limit) { out.push(cur2); cur2 = " "; bytes = 1; limit = 75; }
      cur2 += ch; bytes += n;
    }
    out.push(cur2);
    return out.join("\r\n");
  }
  function buildVCard(card, photoB64) {
    var L = ["BEGIN:VCARD", "VERSION:3.0"];
    var user = card.user.trim();
    var disp = shown(card, "disp") ? card.disp.trim() : "";
    L.push("FN:" + vEsc(disp || user));
    L.push("N:;" + vEsc(disp || user) + ";;;");
    if (user) L.push("NICKNAME:" + vEsc(user));
    if (shown(card, "email") && card.email.trim()) L.push("EMAIL;TYPE=INTERNET:" + vEsc(card.email.trim()));
    if (shown(card, "phone") && card.phone.trim()) L.push("TEL:" + vEsc(card.phone.trim()));
    if (shown(card, "web") && card.web.trim()) L.push("URL:" + vEsc(card.web.trim()));
    var item = 0;
    if (shown(card, "links")) {
      card.links.forEach(function (l) {
        if (!l.u.trim()) return;
        item++;
        L.push("item" + item + ".URL:" + vEsc(l.u.trim()));
        if (l.l.trim()) L.push("item" + item + ".X-ABLabel:" + vEsc(l.l.trim()));
      });
    }
    if (shown(card, "loc") && card.loc.trim()) L.push("ADR:;;;" + vEsc(card.loc.trim()) + ";;;");
    var note = [];
    if (shown(card, "motto") && card.motto.trim()) note.push("“" + card.motto.trim() + "”");
    if (shown(card, "bio") && card.bio.trim()) note.push(card.bio.trim());
    if (shown(card, "pron") && card.pron.trim()) note.push(card.pron.trim());
    if (shown(card, "langs") && card.langs.trim()) note.push(card.langs.trim());
    if (note.length) L.push("NOTE:" + vEsc(note.join("\n\n")));
    if (shown(card, "tags") && card.tags.length) L.push("CATEGORIES:" + card.tags.map(vEsc).join(","));
    if (photoB64) L.push("PHOTO;ENCODING=b;TYPE=PNG:" + photoB64);
    L.push("END:VCARD");
    return L.map(vFold).join("\r\n") + "\r\n";
  }
  function exportVcf() {
    var c = cur();
    if (needUser(c)) return;
    var photo = shown(c, "avatar")
      ? rasterize(avatarSvg(c, 240, true), 240, 240).then(blobToDataUrl).then(function (u) { return u.split(",")[1]; })
      : Promise.resolve("");
    photo.catch(function () { return ""; }).then(function (b64) {
      var b = new Blob([buildVCard(c, b64)], { type: "text/vcard;charset=utf-8" });
      downloadBlob(b, fileBase(c) + ".vcf", "text/vcard",
        [{ description: "vCard", accept: { "text/vcard": [".vcf"] } }]);
    });
  }

  function copyImage() {
    var c = cur();
    if (needUser(c)) return;
    if (!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem)) {
      showToast(t("toast.copyFail"));
      return;
    }
    var p = rasterize(cardSvg(c, prefs.side, true), CW * 2, CH * 2);
    // Safari wants the ClipboardItem created inside the gesture, with a promise.
    navigator.clipboard.write([new window.ClipboardItem({ "image/png": p })])
      .then(function () { showToast(t("toast.copied")); },
            function () { showToast(t("toast.copyFail")); });
  }

  // ---------- 7. Share link ----------
  // #c=<v>.<base64url>: v "1" = UTF-8 JSON, "2" = deflate-raw of it.
  // Only what the card shows travels; hidden fields and ids never do.
  function sharePayload(card) {
    var p = { st: card.st, user: card.user.trim() };
    TEXT_KEYS.forEach(function (k) {
      if (k !== "user" && shown(card, k) && card[k].trim()) p[k] = card[k].trim();
    });
    if (shown(card, "links")) {
      var links = card.links.filter(function (l) { return l.u.trim() || l.l.trim(); })
        .map(function (l) { return { l: l.l.trim(), u: l.u.trim() }; });
      if (links.length) p.links = links;
    }
    if (shown(card, "tags") && card.tags.length) p.tags = card.tags.slice();
    if (shown(card, "avatar")) {
      p.av = { s: card.av.s, t: card.av.t };
      if (card.av.px) p.av.px = card.av.px;
    }
    return p;
  }
  // The viewer's card: a payload back through normCard, avatar hidden if absent.
  function cardFromPayload(p) {
    if (!p || typeof p !== "object" || typeof p.user !== "string" || !p.user.trim()) return null;
    var c = {};
    Object.keys(p).forEach(function (k) { c[k] = p[k]; });
    c.id = "shared"; c.m = 0;
    c.hide = p.av ? [] : ["avatar"];
    return normCard(c);
  }

  function b64urlFromBytes(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function bytesFromB64url(s) {
    var b = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    var bin = atob(b), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function streamBytes(bytes, Ctor) {
    var s = new Blob([bytes]).stream().pipeThrough(new Ctor("deflate-raw"));
    return new Response(s).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  function encodeShare(card) {
    var bytes = new TextEncoder().encode(JSON.stringify(sharePayload(card)));
    if (typeof CompressionStream === "function") {
      return streamBytes(bytes, CompressionStream)
        .then(function (z) { return "2." + b64urlFromBytes(z); },
              function () { return "1." + b64urlFromBytes(bytes); });
    }
    return Promise.resolve("1." + b64urlFromBytes(bytes));
  }
  function decodeShare(code) {
    return new Promise(function (resolve) {
      var m = /^([12])\.([A-Za-z0-9_-]+)$/.exec(code || "");
      if (!m) { resolve(null); return; }
      var bytes;
      try { bytes = bytesFromB64url(m[2]); } catch (e) { resolve(null); return; }
      var raw = m[1] === "1" ? Promise.resolve(bytes)
        : (typeof DecompressionStream === "function" ? streamBytes(bytes, DecompressionStream) : Promise.reject());
      raw.then(function (b) {
        try { resolve(cardFromPayload(JSON.parse(new TextDecoder().decode(b)))); }
        catch (e) { resolve(null); }
      }, function () { resolve(null); });
    });
  }

  function shareUrl(code) {
    var base = location.href.split("#")[0].split("?")[0];
    return base + "#c=" + code;
  }

  function shareDialog() {
    var c = cur();
    if (needUser(c)) return;
    encodeShare(c).then(function (code) {
      var url = shareUrl(code);
      var dlg = makeDialog("nz-share");
      dlg.appendChild(el("div", "dlg-title", t("share.title")));
      dlg.appendChild(el("div", "dlg-msg", t("share.warn")));
      var box = el("textarea", "share-url");
      box.readOnly = true;
      box.rows = 3;
      box.value = url;
      box.setAttribute("aria-label", t("share.title"));
      dlg.appendChild(box);
      var acts = el("div", "dlg-actions");
      acts.appendChild(button(t("share.close"), "", function () { dlg.close(); }));
      var copy = button(t("share.copy"), "primary", function () {
        copyText(url).then(function (ok) {
          if (ok) { dlg.close(); showToast(t("toast.linkCopied")); }
          else { box.focus(); box.select(); showToast(t("toast.copyFail")); }
        });
      });
      acts.appendChild(copy);
      dlg.appendChild(acts);
      document.body.appendChild(dlg);
      dlg.showModal();
      copy.focus();
    });
  }

  function copyText(s) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).then(function () { return true; }, function () { return false; });
    }
    return Promise.resolve(false);
  }

  var viewCard = null, viewBack = false;
  function openViewer(card) {
    viewCard = card;
    document.body.classList.add("viewing");
    $("viewer").hidden = false;
    $("v-front").innerHTML = cardSvg(card, "front", false);
    $("v-back").innerHTML = cardSvg(card, "back", false);
    $("v-front").querySelector("svg").setAttribute("aria-label", t("side.front"));
    $("v-back").querySelector("svg").setAttribute("aria-label", t("side.back"));
    paintViewerSide();
    $("v-flip-btn").focus();
  }
  function paintViewerSide() {
    $("v-flip").classList.toggle("back", viewBack);
    $("v-front").setAttribute("aria-hidden", viewBack ? "true" : "false");
    $("v-back").setAttribute("aria-hidden", viewBack ? "false" : "true");
  }
  function closeViewer() {
    viewCard = null;
    document.body.classList.remove("viewing");
    $("viewer").hidden = true;
    try { history.replaceState(null, "", location.href.split("#")[0]); } catch (e) { location.hash = ""; }
  }

  // ---------- 8. Editor ----------
  var paintColor = 1;

  var UI_ICONS = {
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    dup:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    flip:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
    copy:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 16l-5-5-8 8"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    exp:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
    eye:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10 10 0 0 1 12 19c-6.5 0-10-7-10-7a18 18 0 0 1 5.1-5.9M9.9 5.2A9 9 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M2 2l20 20"/></svg>',
    dice:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
    up:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
    down:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'
  };

  function iconBtn(cls, icon, label, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = UI_ICONS[icon];
    b.setAttribute("aria-label", label);
    b.title = label;
    if (fn) b.addEventListener("click", fn);
    return b;
  }

  // The form shows the current card; inputs write back through mutate().
  function renderForm() {
    var c = cur();
    [].forEach.call(document.querySelectorAll("#form input[data-f], #form textarea[data-f]"), function (inp) {
      var k = inp.getAttribute("data-f");
      if (inp.value !== c[k]) inp.value = c[k];
    });
    renderEyes();
    renderLinks();
    renderTags();
    renderStyles();
    renderAvatarEditor();
  }

  function renderEyes() {
    var c = cur();
    [].forEach.call(document.querySelectorAll(".fld[data-f]"), function (f) {
      var k = f.getAttribute("data-f"), b = f.querySelector(".eye");
      if (!b) return;
      var on = shown(c, k);
      b.innerHTML = on ? UI_ICONS.eye : UI_ICONS.eyeOff;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.title = t(on ? "eye.show" : "eye.hide");
      b.setAttribute("aria-label", b.title);
      f.classList.toggle("off", !on);
    });
  }

  function buildEyes() {
    [].forEach.call(document.querySelectorAll(".fld[data-f]"), function (f) {
      var k = f.getAttribute("data-f");
      if (HIDEABLE.indexOf(k) < 0) return;
      var b = iconBtn("eye", "eye", "", function () {
        mutate(function (c) {
          var i = c.hide.indexOf(k);
          if (i >= 0) c.hide.splice(i, 1); else { c.hide.push(k); c.hide.sort(cmpStr); }
        });
        renderEyes();
      });
      f.insertBefore(b, f.firstChild);
    });
  }

  // Avatar painter: 144 cells, roving tabindex, drag to paint.
  var avFocus = 0, painting = false;
  function buildAvatarEditor() {
    var g = $("av-grid");
    g.setAttribute("aria-label", t("av.grid"));
    for (var i = 0; i < AV * AV; i++) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "px";
      b.setAttribute("data-i", String(i));
      b.setAttribute("aria-label", t("av.px", { r: Math.floor(i / AV) + 1, c: i % AV + 1 }));
      b.tabIndex = i === avFocus ? 0 : -1;
      g.appendChild(b);
    }
    var pal = $("av-pal");
    for (var k = 0; k < 7; k++) {
      var s = document.createElement("button");
      s.type = "button";
      s.className = "sw";
      s.setAttribute("role", "radio");
      s.setAttribute("data-c", String(k));
      s.title = t("av.col" + k);
      s.setAttribute("aria-label", s.title);
      pal.appendChild(s);
    }
    pal.addEventListener("click", function (e) {
      var s2 = e.target.closest && e.target.closest(".sw");
      if (!s2) return;
      paintColor = +s2.getAttribute("data-c");
      renderAvatarEditor();
    });
    $("av-roll").innerHTML = UI_ICONS.dice + "<span>" + esc(t("av.roll")) + "</span>";
    $("av-roll").addEventListener("click", rollAvatar);
    $("av-clear").addEventListener("change", function () {
      var v = $("av-clear").checked ? 1 : 0;
      mutate(function (c) { c.av.t = v; });
      renderAvatarEditor();
    });

    g.addEventListener("pointerdown", function (e) {
      var px = e.target.closest && e.target.closest(".px");
      if (!px) return;
      e.preventDefault();
      painting = true;
      try { g.setPointerCapture(e.pointerId); } catch (err) {}
      paintAt(+px.getAttribute("data-i"));
    });
    g.addEventListener("pointermove", function (e) {
      if (!painting) return;
      var n = document.elementFromPoint(e.clientX, e.clientY);
      var px = n && n.closest && n.closest(".px");
      if (px && px.parentNode === g) paintAt(+px.getAttribute("data-i"));
    });
    var stop = function () { painting = false; };
    g.addEventListener("pointerup", stop);
    g.addEventListener("pointercancel", stop);
    g.addEventListener("click", function (e) {
      // keyboard activation (Enter / Space) arrives as a click with detail 0
      if (e.detail !== 0) return;
      var px = e.target.closest && e.target.closest(".px");
      if (px) paintAt(+px.getAttribute("data-i"));
    });
    g.addEventListener("keydown", function (e) {
      var d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -AV, ArrowDown: AV }[e.key];
      if (d === undefined) return;
      e.preventDefault();
      var n = avFocus + d;
      if (d === -1 && avFocus % AV === 0) return;
      if (d === 1 && avFocus % AV === AV - 1) return;
      if (n < 0 || n >= AV * AV) return;
      g.children[avFocus].tabIndex = -1;
      avFocus = n;
      g.children[n].tabIndex = 0;
      g.children[n].focus();
    });
  }

  function paintAt(i) {
    var c = cur(), a = avatarOf(c);
    if (+a.px.charAt(i) === paintColor) return;
    var px = a.px.slice(0, i) + paintColor + a.px.slice(i + 1);
    mutate(function (cc) { cc.av.px = px; });
    paintCells();
  }

  function rollAvatar() {
    var prev = JSON.parse(JSON.stringify(cur().av));
    mutate(function (c) { c.av.s = newSeed(); c.av.px = ""; });
    renderAvatarEditor();
    undoToast(t("toast.rolled"), function () {
      mutate(function (c) { c.av.s = prev.s; c.av.px = prev.px; c.av.t = prev.t; });
      renderAvatarEditor();
    });
  }

  function paintCells() {
    var c = cur(), a = avatarOf(c), g = $("av-grid");
    for (var i = 0; i < AV * AV; i++) {
      var v = +a.px.charAt(i), cell = g.children[i];
      var col = v === 0 ? (c.av.t ? "transparent" : a.pal[0]) : a.pal[v];
      if (cell.style.backgroundColor !== col) cell.style.background = col;
    }
    g.classList.toggle("clear", !!c.av.t);
  }

  function renderAvatarEditor() {
    var c = cur(), a = avatarOf(c);
    paintCells();
    [].forEach.call($("av-pal").children, function (s) {
      var k = +s.getAttribute("data-c");
      s.style.background = k === 0 && c.av.t ? "transparent" : a.pal[k];
      s.classList.toggle("eraser", k === 0);
      s.setAttribute("aria-checked", k === paintColor ? "true" : "false");
      s.classList.toggle("on", k === paintColor);
    });
    $("av-clear").checked = !!c.av.t;
  }

  // Links: label + URL rows, reorder, remove.
  function renderLinks() {
    var c = cur(), box = $("links");
    var focused = document.activeElement && box.contains(document.activeElement)
      ? [document.activeElement.getAttribute("data-li"), document.activeElement.getAttribute("data-k")] : null;
    box.innerHTML = "";
    c.links.forEach(function (l, i) {
      var r = el("div", "link-row");
      var lab = el("input", "link-l");
      lab.value = l.l; lab.maxLength = LINK_LABEL; lab.placeholder = t("ph.linkL");
      lab.setAttribute("aria-label", t("ph.linkL") + " " + (i + 1));
      lab.setAttribute("data-li", String(i)); lab.setAttribute("data-k", "l");
      var url = el("input", "link-u");
      url.value = l.u; url.maxLength = LINK_URL; url.placeholder = t("ph.linkU");
      url.type = "url"; url.spellcheck = false; url.setAttribute("autocapitalize", "off");
      url.setAttribute("aria-label", t("ph.linkU") + " " + (i + 1));
      url.setAttribute("data-li", String(i)); url.setAttribute("data-k", "u");
      [lab, url].forEach(function (inp) {
        inp.addEventListener("input", function () {
          var k = inp.getAttribute("data-k"), v = inp.value;
          mutate(function (cc) { if (cc.links[i]) cc.links[i][k] = v; });
        });
      });
      r.appendChild(lab); r.appendChild(url);
      var up = iconBtn("mini", "up", t("link.up"), function () { moveLink(i, -1); });
      up.disabled = i === 0;
      var dn = iconBtn("mini", "down", t("link.down"), function () { moveLink(i, 1); });
      dn.disabled = i === c.links.length - 1;
      r.appendChild(up); r.appendChild(dn);
      r.appendChild(iconBtn("mini danger", "x", t("link.del"), function () {
        mutate(function (cc) { cc.links.splice(i, 1); });
        renderLinks();
        var add = $("link-add");
        if (add) add.focus();
      }));
      box.appendChild(r);
    });
    if (focused) {
      var n = box.querySelector('[data-li="' + focused[0] + '"][data-k="' + focused[1] + '"]');
      if (n) n.focus();
    }
    $("link-add").disabled = false;
  }
  function moveLink(i, d) {
    var j = i + d;
    mutate(function (c) {
      if (j < 0 || j >= c.links.length) return;
      var x = c.links[i]; c.links[i] = c.links[j]; c.links[j] = x;
    });
    renderLinks();
    var row = $("links").children[j];
    if (row) {
      var b = row.querySelectorAll(".mini")[d < 0 ? 0 : 1];
      if (b && !b.disabled) b.focus(); else row.querySelector("input").focus();
    }
  }
  function addLink() {
    var c = cur();
    if (c.links.length >= MAX_LINKS) { showToast(t("toast.maxLinks", { n: MAX_LINKS })); return; }
    mutate(function (cc) { cc.links.push({ l: "", u: "" }); });
    renderLinks();
    var rows = $("links").children;
    if (rows.length) rows[rows.length - 1].querySelector("input").focus();
  }

  // Tags: chips; Enter or comma adds.
  function renderTags() {
    var c = cur(), box = $("tags");
    box.innerHTML = "";
    c.tags.forEach(function (tag, i) {
      var chip = el("span", "chip");
      chip.appendChild(el("span", "", tag));
      chip.appendChild(iconBtn("chip-x", "x", t("tag.del", { tag: tag }), function () {
        mutate(function (cc) { cc.tags.splice(i, 1); });
        renderTags();
        $("tag-in").focus();
      }));
      box.appendChild(chip);
    });
  }
  function addTag() {
    var inp = $("tag-in");
    var parts = inp.value.split(",").map(function (s) { return s.trim().slice(0, TAG_LEN); }).filter(Boolean);
    if (!parts.length) { inp.focus(); return; }
    var c = cur(), added = false;
    parts.forEach(function (p) {
      if (c.tags.indexOf(p) >= 0) { showToast(t("toast.tagDup")); return; }
      if (c.tags.length >= MAX_TAGS) { showToast(t("toast.maxTags", { n: MAX_TAGS })); return; }
      mutate(function (cc) { cc.tags.push(p); });
      added = true;
    });
    if (added) inp.value = "";
    renderTags();
    inp.focus();
  }

  function renderStyles() {
    var c = cur();
    [].forEach.call($("styles").children, function (b) {
      var on = b.getAttribute("data-st") === c.st;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  function buildStyles() {
    STYLES.forEach(function (st) {
      var th = theme(st);
      var b = el("button", "style-btn");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-st", st);
      var sw = el("span", "style-sw");
      sw.setAttribute("data-st", st);
      if (st !== "oros") {
        sw.style.background = th.bg;
        sw.style.borderColor = th.border;
        sw.style.color = th.accent;
      }
      sw.textContent = "Aa";
      b.appendChild(sw);
      b.appendChild(el("span", "", t("style." + st)));
      b.addEventListener("click", function () {
        mutate(function (c) { c.st = st; });
        renderStyles();
      });
      $("styles").appendChild(b);
    });
  }

  // ---------- 9. Cards ----------
  function cardName(c) {
    if (isDraft(c)) return t("card.draft");
    return c.user.trim() ? "@" + c.user.trim() : t("card.untitled");
  }
  function renderCardSelect() {
    var s = $("card-select"), c = cur();
    s.innerHTML = "";
    var list = data.cards.slice();
    if (isDraft(c)) list.push(c);
    list.forEach(function (x) {
      var o = document.createElement("option");
      o.value = x.id;
      o.textContent = cardName(x);
      s.appendChild(o);
    });
    s.value = c.id;
    s.setAttribute("aria-label", t("btn.cards"));
    s.title = t("btn.cards");
    $("dup-btn").disabled = isDraft(c);
    $("del-btn").disabled = isDraft(c);
  }
  function renderCardSelectLabel() {
    var s = $("card-select"), c = cur();
    var o = s.querySelector('option[value="' + c.id + '"]');
    if (o) { var n = cardName(c); if (o.textContent !== n) o.textContent = n; }
  }

  function switchCard(id) {
    flush();
    if (draft && draft.id !== id) draft = null;
    prefs.cur = id; savePrefs();
    renderAll();
  }

  function newCard() {
    var c = cur();
    if (isDraft(c)) { $("f-user").focus(); return; }
    if (data.cards.length >= MAX_CARDS) { showToast(t("toast.maxCards", { n: MAX_CARDS })); return; }
    flush();
    draft = blankCard();
    prefs.cur = draft.id; savePrefs();
    renderAll();
    showToast(t("toast.new"));
    if (prefs.tab === "card") setTab("edit");
    $("f-user").focus();
  }

  function dupCard() {
    var c = cur();
    if (isDraft(c)) return;
    if (data.cards.length >= MAX_CARDS) { showToast(t("toast.maxCards", { n: MAX_CARDS })); return; }
    flush();
    var copy = normCard(JSON.parse(JSON.stringify(c)));
    copy.id = newId();
    copy.m = Date.now();
    data.cards.push(copy);
    data = mergeNetizen(data, data);
    prefs.cur = copy.id; savePrefs();
    saveNow();
    renderAll();
    showToast(t("toast.dup"));
  }

  function deleteCard() {
    var c = cur();
    if (isDraft(c)) return;
    flush();
    var snapshot = JSON.parse(JSON.stringify(c));
    var ts = Math.max(Date.now(), c.m);
    data.tombs[c.id] = ts;
    data = mergeNetizen(data, data);
    prefs.cur = data.cards.length ? data.cards[0].id : "";
    savePrefs();
    saveNow();
    renderAll();
    undoToast(t("toast.deleted"), function () {
      // R17: a fresh mtime beats the tombstone
      snapshot.m = Math.max(Date.now(), (data.tombs[snapshot.id] || 0) + 1);
      data.cards.push(snapshot);
      data = mergeNetizen(data, data);
      prefs.cur = snapshot.id; savePrefs();
      if (draft) draft = null;
      saveNow();
      renderAll();
    });
  }

  function setTab(tab) {
    prefs.tab = tab; savePrefs();
    document.body.setAttribute("data-tab", tab);
    [].forEach.call(document.querySelectorAll("#tab-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function flipCard() {
    prefs.side = prefs.side === "back" ? "front" : "back";
    savePrefs();
    renderSide();
    live(t(prefs.side === "back" ? "side.back" : "side.front"));
  }

  function renderAll() {
    renderCardSelect();
    renderForm();
    renderPreview();
    setTab(prefs.tab);
  }

  // ---------- 10. Dialogs + toasts ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }

  function exportDialog() {
    var c = cur();
    if (needUser(c)) return;
    flush();
    var dlg = makeDialog("nz-export");
    dlg.appendChild(el("div", "dlg-title", t("exp.title")));
    dlg.appendChild(el("div", "dlg-sub", t("exp.side", { side: t(prefs.side === "back" ? "side.back" : "side.front") })));
    var list = el("div", "exp-list");
    [["exp.png", exportCardPng], ["exp.svg", exportCardSvg], ["exp.pdf", exportPdf],
     ["exp.avpng", exportAvatarPng], ["exp.avsvg", exportAvatarSvg], ["exp.vcf", exportVcf]]
      .forEach(function (x) {
        list.appendChild(button(t(x[0]), "exp-btn", function () { dlg.close(); x[1](); }));
      });
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    var close = button(t("exp.close"), "", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    list.firstChild.focus();
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "netizen", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 11. Keyboard ----------
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
  }

  // ---------- 12. Sync slice + palette ----------
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
    // the "orOS" card style follows the skin
    if (data) {
      renderPreview();
      if (viewCard) openViewer(viewCard);
    }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("netizen", sliceGet, sliceSet, STORAGE_KEY, mergeNetizen);
  }

  function sliceGet() {
    flush();
    return mergeNetizen(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.cards)) return;
    var before = JSON.stringify(cur());
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeNetizen(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    renderCardSelect();
    if (JSON.stringify(cur()) !== before) {    // no toast on merge (sync feedback = taskbar dot)
      renderForm();
      renderPreview();
    }
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    [].forEach.call(document.querySelectorAll("#form input[data-f], #form textarea[data-f]"), function (inp) {
      inp.placeholder = t("ph." + inp.getAttribute("data-f"));
    });
    $("tag-in").placeholder = t("ph.tag");
    $("tag-in").setAttribute("aria-label", t("sec.tags"));
    $("link-add").innerHTML = UI_ICONS.plus + "<span>" + esc(t("link.add")) + "</span>";
    $("tag-add").textContent = t("tag.add");
    $("styles").setAttribute("aria-label", t("sec.style"));
    $("av-pal").setAttribute("aria-label", t("sec.avatar"));
    $("tab-seg").setAttribute("aria-label", t("tab.card"));
    $("v-flip-btn").textContent = t("view.flip");
    $("v-open").textContent = t("view.open");
  }

  function paintStatic() {
    [["new-btn", "plus", "btn.new"], ["dup-btn", "dup", "btn.dup"], ["del-btn", "trash", "btn.del"],
     ["flip-btn", "flip", "btn.flip"], ["copy-btn", "copy", "btn.copy"],
     ["share-btn", "share", "btn.share"], ["export-btn", "exp", "btn.export"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#form input[data-f], #form textarea[data-f]"), function (inp) {
      var k = inp.getAttribute("data-f");
      inp.addEventListener("input", function () {
        var v = inp.value;
        if (k === "since") {
          v = v.replace(/\D+/g, "").slice(0, 4);
          if (v !== inp.value) inp.value = v;
        }
        mutate(function (c) { c[k] = v; });
      });
    });
    $("form").addEventListener("submit", function (e) { e.preventDefault(); });
    $("link-add").addEventListener("click", addLink);
    $("tag-add").addEventListener("click", addTag);
    $("tag-in").addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); }
    });
    $("card-select").addEventListener("change", function () { switchCard($("card-select").value); });
    $("new-btn").addEventListener("click", newCard);
    $("dup-btn").addEventListener("click", dupCard);
    $("del-btn").addEventListener("click", deleteCard);
    $("flip-btn").addEventListener("click", flipCard);
    $("copy-btn").addEventListener("click", copyImage);
    $("share-btn").addEventListener("click", shareDialog);
    $("export-btn").addEventListener("click", exportDialog);
    $("stage").addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("#flip")) flipCard();
    });
    [].forEach.call(document.querySelectorAll("#tab-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
    });
    $("v-flip-btn").addEventListener("click", function () { viewBack = !viewBack; paintViewerSide(); });
    $("v-flip").addEventListener("click", function () { viewBack = !viewBack; paintViewerSide(); });
    $("v-open").addEventListener("click", closeViewer);

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", flush);
    window.addEventListener("hashchange", checkHash);

    wireKeyboard();
  }

  function checkHash() {
    var m = /^#c=(.+)$/.exec(location.hash || "");
    if (!m) { if (viewCard) closeViewer(); return; }
    decodeShare(m[1]).then(function (card) {
      if (card) { viewBack = false; openViewer(card); }
      else { closeViewer(); showToast(t("toast.badLink")); }
    });
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    paintStatic();
    buildEyes();
    buildAvatarEditor();
    buildStyles();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderAll();
    checkHash();
  }

  boot();
})();
