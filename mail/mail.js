// ============================================================
// orOS Mail — App logic (v1.0.0, phase 1: accounts + reading)
// An IMAP mail reader. The browser cannot speak IMAP, so every
// server call goes through the orOS mail relay (relay/, a small
// stateless Cloudflare Worker): HTTPS in, IMAP out, nothing kept.
//   - accounts with presets by domain (any IMAP server; Gmail /
//     iCloud / Yahoo need an app password)
//   - folders with unread counts, message list (newest first,
//     "older" paging), reading pane
//   - HTML mail: sanitized (sanitize.js) AND shown in a sandboxed
//     iframe without scripts or origin; remote images off until
//     asked ("always for this sender" syncs)
//   - offline: what was opened or listed stays readable
//   - attachments download (orosDialog, R33); invitations (.ics)
//     go to Calendar, their place to Maps
// Data:
//   - synced slice "mail" (oros-mail-data): accounts WITHOUT
//     passwords, relay address, senders with images allowed;
//     LWW + tombstones (R5, R17, R26)
//   - device-local (R10): oros-mail-prefs (open account / folder,
//     plain-text mode); IndexedDB "oros-mail": non-extractable
//     device key, sealed passwords, folder lists, message headers
//     and bodies (cache). Never synced, never exported.
// Sections:
//   1. Constants, i18n, helpers
//   2. Data model: accounts, merge
//   3. Device store (IndexedDB)
//   4. Passwords (sealed with the device key)
//   5. Relay client
//   6. Folders + message cache
//   7. UI: toolbar, side, list
//   8. UI: reader
//   9. Account dialog + settings
//  10. Dialogs + toasts
//  11. Keyboard
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY   = "oros-mail-data";
  var PREFS_KEY     = "oros-mail-prefs";
  var DB_NAME       = "oros-mail";
  var DATA_VER      = 1;
  // The orOS relay (Christos's Worker, relay/). Settings can override
  // it per user (synced); an empty override falls back to this.
  var DEFAULT_RELAY = "https://oros-mail-relay.koulaxizis-25b.workers.dev";
  var PAGE          = 50;
  var KEEP_HEADS    = 500;              // per folder
  var KEEP_BODIES   = 200;              // messages
  var BODY_BUDGET   = 60 * 1024 * 1024; // bytes of cached sources
  var REFRESH_MS    = 2 * 60 * 1000;
  var BACKOFF_MAX   = 30 * 60 * 1000;
  var CALL_TIMEOUT  = 45000;
  var MAX_ACCTS     = 10;
  var MAX_TOMBS     = 200;
  var MAX_IMGOK     = 500;
  var M = window.orosMailMime;

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
      "app": "Mail", "nav.folders": "Folders", "nav.back": "Back", "btn.refresh": "Check for new mail",
      "btn.settings": "Settings", "acct.add": "Add account",
      "wel.title": "Your e-mail, inside orOS", "wel.text": "Add an account to read your mail here, also offline.",
      "f.inbox": "Inbox", "f.sent": "Sent", "f.drafts": "Drafts", "f.trash": "Trash", "f.junk": "Spam",
      "f.archive": "Archive", "f.all": "All mail", "f.flagged": "Starred",
      "list.empty": "No messages here.", "list.loading": "Loading…", "list.older": "Load older messages",
      "list.end": "That's all.", "list.count": "{n} unread", "list.never": "Not checked yet.",
      "read.none": "Choose a message to read it.", "read.loading": "Opening the message…",
      "read.offline": "This message is not saved on this device yet. Connect to the internet to open it.",
      "read.failed": "The message could not be opened.", "read.retry": "Try again",
      "read.to": "To: {list}", "read.cc": "Cc: {list}", "read.me": "me", "read.nosubj": "(no subject)",
      "read.nosender": "(unknown sender)",
      "img.blocked": "Pictures from the internet are hidden, so the sender cannot tell you opened this.",
      "img.show": "Show pictures", "img.always": "Always for {who}",
      "read.plainOnly": "Shown as plain text (Settings).", "read.html": "Show the formatted version",
      "att.title": "Attachments", "att.save": "Save {name}",
      "ics.title": "Invitation", "ics.cal": "Add to Calendar", "ics.map": "Show on the map",
      "ics.allday": "all day",
      "net.offline": "Offline: showing mail saved on this device.",
      "net.norelay": "Set the relay address in Settings to connect.",
      "dlg.acctTitle": "Add account", "dlg.editTitle": "Account", "dlg.name": "Your name",
      "dlg.email": "E-mail address", "dlg.pass": "Password", "dlg.passKeep": "Leave empty to keep the saved one",
      "dlg.server": "Server settings", "dlg.imap": "Incoming (IMAP) server", "dlg.port": "Port / security",
      "dlg.user": "Username", "dlg.smtp": "Outgoing (SMTP) server", "dlg.smtpNote": "Used for sending (next update).",
      "dlg.relay": "Relay address", "dlg.relayHint": "The orOS mail relay (https://…). It passes your mail through and keeps nothing.",
      "dlg.connect": "Connect", "dlg.save": "Save", "dlg.cancel": "Cancel", "dlg.checking": "Checking…",
      "dlg.appPass": "{svc} needs an app password: create one in your {svc} account security settings and use it here.",
      "dlg.oauth": "Outlook.com / Hotmail no longer accept passwords from other apps. Support needs a later update.",
      "dlg.generic": "Most providers (Papaki among them) use mail.{domain}. If the connection fails, check the server name in your provider's panel.",
      "dlg.passDevice": "The password stays sealed on this device and is never synced. Enter it once on each device.",
      "dlg.remove": "Remove account", "dlg.removeQ": "Remove {name} from orOS on all your devices? Your mail stays on the server.",
      "dlg.removeOk": "Remove",
      "set.title": "Mail settings", "set.accounts": "Accounts", "set.plain": "Always show plain text",
      "set.relay": "Relay address", "set.edit": "Edit", "set.close": "Close",
      "pass.title": "Password for {email}", "pass.text": "This account came from another device. Enter its password once on this device.",
      "pass.need": "Password needed on this device", "pass.set": "Enter password",
      "err.offline": "You are offline.", "err.norelay": "Set the relay address first.",
      "err.nopass": "The password is not saved on this device.", "err.auth": "The server refused the login. Check the e-mail address and password.",
      "err.connect": "Could not reach the mail server. Check its address and port.",
      "err.tls": "The server's secure connection failed.", "err.timeout": "The server did not answer in time.",
      "err.network": "Could not reach the relay.", "err.relay": "The relay sent an unexpected answer.",
      "err.origin": "The relay does not accept this page.", "err.rate": "Too many requests, wait a minute.",
      "err.bad-request": "The relay rejected the request ({msg}).", "err.too-big": "The message is too large to open here.",
      "err.gone": "The message no longer exists on the server.", "err.proto": "Unexpected answer from the mail server.",
      "err.closed": "The mail server closed the connection.", "err.no": "The server refused: {msg}",
      "err.fields": "Fill in the e-mail address, password and server.", "err.host": "The server address is not valid.",
      "err.relayUrl": "The relay address must start with https://",
      "err.max": "Up to {n} accounts.", "err.dup": "This account is already added.",
      "toast.added": "Account added", "toast.saved": "Saved", "toast.removed": "Account removed",
      "toast.storage": "Could not save: storage is full", "toast.saveFail": "The attachment could not be saved",
      "toast.updated": "Up to date", "toast.cal": "Calendar is not available", "time.yesterday": "Yesterday"
    },
    el: {
      "app": "Αλληλογραφία", "nav.folders": "Φάκελοι", "nav.back": "Πίσω", "btn.refresh": "Έλεγχος για νέα μηνύματα",
      "btn.settings": "Ρυθμίσεις", "acct.add": "Προσθήκη λογαριασμού",
      "wel.title": "Το email σου, μέσα στο orOS", "wel.text": "Πρόσθεσε έναν λογαριασμό για να διαβάζεις την αλληλογραφία σου εδώ, και χωρίς σύνδεση.",
      "f.inbox": "Εισερχόμενα", "f.sent": "Απεσταλμένα", "f.drafts": "Πρόχειρα", "f.trash": "Κάδος", "f.junk": "Ανεπιθύμητα",
      "f.archive": "Αρχειοθήκη", "f.all": "Όλα τα μηνύματα", "f.flagged": "Με αστέρι",
      "list.empty": "Δεν υπάρχουν μηνύματα εδώ.", "list.loading": "Φόρτωση…", "list.older": "Παλαιότερα μηνύματα",
      "list.end": "Αυτά ήταν όλα.", "list.count": "{n} αδιάβαστα", "list.never": "Δεν έχει ελεγχθεί ακόμα.",
      "read.none": "Διάλεξε ένα μήνυμα για να το διαβάσεις.", "read.loading": "Άνοιγμα μηνύματος…",
      "read.offline": "Αυτό το μήνυμα δεν έχει αποθηκευτεί ακόμα σε αυτή τη συσκευή. Συνδέσου στο internet για να το ανοίξεις.",
      "read.failed": "Το μήνυμα δεν άνοιξε.", "read.retry": "Δοκίμασε ξανά",
      "read.to": "Προς: {list}", "read.cc": "Κοιν.: {list}", "read.me": "εμένα", "read.nosubj": "(χωρίς θέμα)",
      "read.nosender": "(άγνωστος αποστολέας)",
      "img.blocked": "Οι εικόνες από το internet είναι κρυμμένες, για να μη μαθαίνει ο αποστολέας ότι το άνοιξες.",
      "img.show": "Εμφάνιση εικόνων", "img.always": "Πάντα για {who}",
      "read.plainOnly": "Εμφανίζεται ως απλό κείμενο (Ρυθμίσεις).", "read.html": "Εμφάνιση με μορφοποίηση",
      "att.title": "Συνημμένα", "att.save": "Αποθήκευση: {name}",
      "ics.title": "Πρόσκληση", "ics.cal": "Προσθήκη στο Ημερολόγιο", "ics.map": "Στον χάρτη",
      "ics.allday": "όλη μέρα",
      "net.offline": "Χωρίς σύνδεση: βλέπεις όσα είναι αποθηκευμένα σε αυτή τη συσκευή.",
      "net.norelay": "Βάλε τη διεύθυνση του relay στις Ρυθμίσεις για να συνδεθείς.",
      "dlg.acctTitle": "Προσθήκη λογαριασμού", "dlg.editTitle": "Λογαριασμός", "dlg.name": "Το όνομά σου",
      "dlg.email": "Διεύθυνση email", "dlg.pass": "Κωδικός", "dlg.passKeep": "Άφησέ το κενό για να μείνει ο αποθηκευμένος",
      "dlg.server": "Ρυθμίσεις διακομιστή", "dlg.imap": "Διακομιστής εισερχομένων (IMAP)", "dlg.port": "Θύρα / ασφάλεια",
      "dlg.user": "Όνομα χρήστη", "dlg.smtp": "Διακομιστής εξερχομένων (SMTP)", "dlg.smtpNote": "Για την αποστολή (στην επόμενη ενημέρωση).",
      "dlg.relay": "Διεύθυνση relay", "dlg.relayHint": "Το relay αλληλογραφίας του orOS (https://…). Μεταφέρει τα μηνύματα και δεν κρατά τίποτα.",
      "dlg.connect": "Σύνδεση", "dlg.save": "Αποθήκευση", "dlg.cancel": "Άκυρο", "dlg.checking": "Έλεγχος…",
      "dlg.appPass": "Το {svc} θέλει κωδικό εφαρμογής: φτιάξε έναν στις ρυθμίσεις ασφαλείας του λογαριασμού σου στο {svc} και βάλ' τον εδώ.",
      "dlg.oauth": "Το Outlook.com / Hotmail δεν δέχεται πια κωδικούς από άλλες εφαρμογές. Θα υποστηριχτεί σε επόμενη ενημέρωση.",
      "dlg.generic": "Οι περισσότεροι πάροχοι (και το Papaki) χρησιμοποιούν mail.{domain}. Αν η σύνδεση αποτύχει, δες το όνομα του διακομιστή στο panel του παρόχου σου.",
      "dlg.passDevice": "Ο κωδικός μένει σφραγισμένος σε αυτή τη συσκευή και δεν συγχρονίζεται. Τον δίνεις μία φορά σε κάθε συσκευή.",
      "dlg.remove": "Αφαίρεση λογαριασμού", "dlg.removeQ": "Να αφαιρεθεί το {name} από το orOS σε όλες τις συσκευές σου; Τα μηνύματα μένουν στον διακομιστή.",
      "dlg.removeOk": "Αφαίρεση",
      "set.title": "Ρυθμίσεις αλληλογραφίας", "set.accounts": "Λογαριασμοί", "set.plain": "Πάντα ως απλό κείμενο",
      "set.relay": "Διεύθυνση relay", "set.edit": "Επεξεργασία", "set.close": "Κλείσιμο",
      "pass.title": "Κωδικός για {email}", "pass.text": "Ο λογαριασμός ήρθε από άλλη συσκευή. Δώσε τον κωδικό του μία φορά σε αυτή τη συσκευή.",
      "pass.need": "Χρειάζεται κωδικός σε αυτή τη συσκευή", "pass.set": "Βάλε κωδικό",
      "err.offline": "Δεν υπάρχει σύνδεση.", "err.norelay": "Βάλε πρώτα τη διεύθυνση του relay.",
      "err.nopass": "Ο κωδικός δεν είναι αποθηκευμένος σε αυτή τη συσκευή.", "err.auth": "Ο διακομιστής δεν δέχτηκε τη σύνδεση. Έλεγξε τη διεύθυνση email και τον κωδικό.",
      "err.connect": "Ο διακομιστής αλληλογραφίας δεν απάντησε. Έλεγξε τη διεύθυνση και τη θύρα του.",
      "err.tls": "Η ασφαλής σύνδεση με τον διακομιστή απέτυχε.", "err.timeout": "Ο διακομιστής δεν απάντησε εγκαίρως.",
      "err.network": "Το relay δεν απάντησε.", "err.relay": "Το relay έδωσε απρόσμενη απάντηση.",
      "err.origin": "Το relay δεν δέχεται αυτή τη σελίδα.", "err.rate": "Πολλά αιτήματα, περίμενε ένα λεπτό.",
      "err.bad-request": "Το relay απέρριψε το αίτημα ({msg}).", "err.too-big": "Το μήνυμα είναι πολύ μεγάλο για να ανοίξει εδώ.",
      "err.gone": "Το μήνυμα δεν υπάρχει πια στον διακομιστή.", "err.proto": "Απρόσμενη απάντηση από τον διακομιστή.",
      "err.closed": "Ο διακομιστής έκλεισε τη σύνδεση.", "err.no": "Ο διακομιστής αρνήθηκε: {msg}",
      "err.fields": "Συμπλήρωσε email, κωδικό και διακομιστή.", "err.host": "Η διεύθυνση του διακομιστή δεν είναι έγκυρη.",
      "err.relayUrl": "Η διεύθυνση του relay πρέπει να ξεκινά με https://",
      "err.max": "Έως {n} λογαριασμοί.", "err.dup": "Αυτός ο λογαριασμός υπάρχει ήδη.",
      "toast.added": "Ο λογαριασμός προστέθηκε", "toast.saved": "Αποθηκεύτηκε", "toast.removed": "Ο λογαριασμός αφαιρέθηκε",
      "toast.storage": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.saveFail": "Το συνημμένο δεν αποθηκεύτηκε",
      "toast.updated": "Όλα ενημερωμένα", "toast.cal": "Το Ημερολόγιο δεν είναι διαθέσιμο", "time.yesterday": "Χθες"
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
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }
  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }
  function locale() { return LANG === "el" ? "el-GR" : "en-GB"; }
  function fmtListDate(ms) {
    if (!ms) return "";
    var d = new Date(ms), now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
    }
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return t("time.yesterday");
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(locale(), { day: "numeric", month: "short" });
    return d.toLocaleDateString(locale(), { day: "numeric", month: "numeric", year: "numeric" });
  }
  function fmtFullDate(ms) {
    if (!ms) return "";
    return new Date(ms).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short",
      year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function hue(s) {
    var h = 0;
    s = String(s || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }
  function initial(p) {
    var s = (p && (p.name || p.addr)) || "?";
    var m = /[\p{L}\p{N}]/u.exec(s);
    return (m ? m[0] : "?").toUpperCase();
  }
  function who(p) { return p ? (p.name || p.addr || "") : ""; }
  function lowerAddr(a) { return String(a || "").trim().toLowerCase(); }

  // UID sets "1:5,9" (the relay's compact form)
  function compressUids(uids) {
    var a = uids.slice().sort(function (x, y) { return x - y; });
    var parts = [], i = 0;
    while (i < a.length) {
      var j = i;
      while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
      parts.push(i === j ? String(a[i]) : a[i] + ":" + a[j]);
      i = j + 1;
    }
    return parts.join(",");
  }
  function uidSetHas(set) {
    var out = {};
    String(set || "").split(",").forEach(function (p) {
      if (!p) return;
      var m = p.split(":"), a = +m[0], b = m.length > 1 ? +m[1] : a;
      if (!(a > 0 && b > 0) || Math.abs(b - a) > 2000000) return;
      for (var k = Math.min(a, b); k <= Math.max(a, b); k++) out[k] = 1;
    });
    return out;
  }

  var UI = {
    menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
    back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    refresh: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    gear: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    mail: '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/></svg>',
    clip: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    star: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    key: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>'
  };

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("mail.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Data model: accounts, merge ----------
  var SECS = { 993: "tls", 143: "starttls", 465: "tls", 587: "starttls" };

  function normHost(h) {
    h = String(h || "").trim().toLowerCase().replace(/\.$/, "");
    if (h.length < 4 || h.length > 253) return "";
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) return "";
    if (/^[0-9.]+$/.test(h)) return "";
    return h;
  }
  function normServer(s, ports) {
    if (!s || typeof s !== "object") return null;
    var host = normHost(s.host), port = +s.port;
    if (!host || ports.indexOf(port) < 0) return null;
    var user = typeof s.user === "string" ? s.user.trim().slice(0, 320) : "";
    return { host: host, port: port, sec: SECS[port], user: user };
  }
  function normEmail(e) {
    e = String(e || "").trim();
    return /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(e) && e.length <= 254 ? e : "";
  }
  function normAccount(a) {
    if (!a || typeof a !== "object" || typeof a.id !== "string" || !/^[a-z0-9]{6,40}$/.test(a.id)) return null;
    if (!isInt(a.m) || a.m < 0) return null;
    var email = normEmail(a.email);
    var imap = normServer(a.imap, [993, 143]);
    if (!email || !imap) return null;
    if (!imap.user) imap.user = email;
    var out = { id: a.id, m: a.m, name: String(a.name || "").replace(/\s+/g, " ").trim().slice(0, 80),
                email: email, imap: imap };
    var smtp = normServer(a.smtp, [465, 587]);
    if (smtp) { if (!smtp.user) smtp.user = imap.user; out.smtp = smtp; }
    return out;
  }
  function normRelayUrl(u) {
    u = String(u || "").trim().replace(/\/+$/, "");
    if (!u) return "";
    if (/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w.~-]*)*$/i.test(u)) return u;
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(u)) return u;   // local relay (development)
    return null;
  }

  function emptyData() { return { ver: DATA_VER, accounts: [], relay: { url: "", m: 0 }, imgOk: {}, tombs: {} }; }

  function sortedObj(src, maxN) {
    var keys = Object.keys(src);
    if (maxN && keys.length > maxN) {
      keys.sort(function (x, y) { return (src[y] - src[x]) || cmpStr(x, y); });
      keys = keys.slice(0, maxN);
    }
    keys.sort(cmpStr);
    var out = {};
    keys.forEach(function (k) { out[k] = src[k]; });
    return out;
  }

  // Symmetric merge (R5): accounts LWW by m (tie: JSON order), tombstones
  // max-ts and delete wins ties (R17), relay LWW, allowed-image senders
  // union of the latest stamp. Canonical output (R26).
  function mergeMail(a, b) {
    var res = emptyData();
    var tombs = {}, byId = {}, img = {};
    [a, b].forEach(function (d) {
      if (!d || typeof d !== "object") return;
      if (d.tombs && typeof d.tombs === "object") {
        Object.keys(d.tombs).forEach(function (k) {
          var v = d.tombs[k];
          if (/^[a-z0-9]{6,40}$/.test(k) && isInt(v) && v > 0 && !(tombs[k] >= v)) tombs[k] = v;
        });
      }
      (Array.isArray(d.accounts) ? d.accounts : []).forEach(function (x) {
        var n = normAccount(x);
        if (!n) return;
        var cur = byId[n.id];
        if (!cur || n.m > cur.m || (n.m === cur.m && cmpStr(JSON.stringify(n), JSON.stringify(cur)) > 0)) byId[n.id] = n;
      });
      var r = d.relay;
      if (r && typeof r === "object" && isInt(r.m) && r.m >= 0) {
        var url = normRelayUrl(r.url);
        if (url !== null) {
          var cand = { url: url, m: r.m };
          if (cand.m > res.relay.m || (cand.m === res.relay.m && cmpStr(cand.url, res.relay.url) > 0)) res.relay = cand;
        }
      }
      if (d.imgOk && typeof d.imgOk === "object") {
        Object.keys(d.imgOk).forEach(function (k) {
          var v = d.imgOk[k], key = lowerAddr(k);
          if (key && key.length <= 254 && /@/.test(key) && isInt(v) && v > 0 && !(img[key] >= v)) img[key] = v;
        });
      }
    });
    Object.keys(byId).sort(cmpStr).forEach(function (id) {
      if (tombs[id] >= byId[id].m) return;
      res.accounts.push(byId[id]);
    });
    res.tombs = sortedObj(tombs, MAX_TOMBS);
    res.imgOk = sortedObj(img, MAX_IMGOK);
    return res;
  }

  // Server presets by e-mail domain.
  var PRESETS = [
    { d: ["gmail.com", "googlemail.com"], imap: "imap.gmail.com", smtp: "smtp.gmail.com", sp: 465, svc: "Google" },
    { d: ["icloud.com", "me.com", "mac.com"], imap: "imap.mail.me.com", smtp: "smtp.mail.me.com", sp: 587, svc: "Apple" },
    { d: ["yahoo.com", "yahoo.gr", "ymail.com", "rocketmail.com"], imap: "imap.mail.yahoo.com", smtp: "smtp.mail.yahoo.com", sp: 465, svc: "Yahoo" },
    { d: ["gmx.com", "gmx.net", "gmx.de"], imap: "imap.gmx.com", smtp: "mail.gmx.com", sp: 587 },
    { d: ["zoho.com", "zohomail.com"], imap: "imap.zoho.com", smtp: "smtp.zoho.com", sp: 465 },
    { d: ["outlook.com", "hotmail.com", "live.com", "msn.com", "hotmail.gr", "outlook.com.gr", "live.gr"], oauth: true }
  ];
  function presetFor(email) {
    var dom = (String(email || "").split("@")[1] || "").trim().toLowerCase();
    if (!dom) return null;
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].d.indexOf(dom) >= 0) return PRESETS[i];
    }
    return { imap: "mail." + dom, smtp: "mail." + dom, sp: 465, generic: dom };
  }

  // Special folders: \Sent etc. (RFC 6154), else well-known names.
  var SPECIAL_ORDER = ["inbox", "drafts", "sent", "archive", "junk", "trash", "all", "flagged"];
  var SPECIAL_NAMES = {
    sent: /^(sent|sent items|sent messages|sent mail|απεσταλμένα)$/i,
    drafts: /^(drafts?|πρόχειρα)$/i,
    trash: /^(trash|deleted|deleted items|deleted messages|bin|κάδος|διαγραμμένα)$/i,
    junk: /^(junk|spam|junk e-mail|bulk mail|ανεπιθύμητα)$/i,
    archive: /^(archive|archives|αρχειοθήκη)$/i
  };
  function folderRole(f) {
    if (/^inbox$/i.test(f.name)) return "inbox";
    var fl = (f.flags || []).join(" ").toLowerCase();
    var roles = ["sent", "drafts", "trash", "junk", "archive", "all", "flagged"];
    for (var i = 0; i < roles.length; i++) if (fl.indexOf("\\" + roles[i]) >= 0) return roles[i];
    var leaf = folderLeaf(f);
    for (var k in SPECIAL_NAMES) if (SPECIAL_NAMES[k].test(leaf)) return k;
    return "";
  }
  function folderLeaf(f) {
    var name = M.utf7Decode(f.name);
    if (f.delim && name.indexOf(f.delim) >= 0) name = name.slice(name.lastIndexOf(f.delim) + 1);
    return name;
  }
  function folderDepth(f) {
    if (!f.delim) return 0;
    var parts = f.name.split(f.delim).length - 1;
    if (/^inbox$/i.test(f.name.split(f.delim)[0]) && parts > 0) parts--;   // INBOX.Sent shows at top level
    return Math.min(parts, 4);
  }
  function folderLabel(f) {
    var role = folderRole(f);
    return role ? t("f." + role) : folderLeaf(f);
  }
  function sortFolders(list) {
    var seenRole = {};
    return list.filter(function (f) {
      return !(f.flags || []).some(function (x) { return /^\\(noselect|nonexistent)$/i.test(x); });
    }).map(function (f) {
      var r = folderRole(f);
      var rank = r && !seenRole[r] ? SPECIAL_ORDER.indexOf(r) : 99;
      if (r) seenRole[r] = 1;
      return { f: f, rank: rank, key: M.utf7Decode(f.name).toLowerCase() };
    }).sort(function (x, y) {
      return (x.rank - y.rank) || cmpStr(x.key, y.key);
    }).map(function (x) { return x.f; });
  }

  // ---------- 3. Device store (IndexedDB) ----------
  var dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var d = req.result;
          ["keys", "creds", "folders", "heads", "bodies"].forEach(function (n) {
            if (!d.objectStoreNames.contains(n)) d.createObjectStore(n);
          });
        };
        req.onsuccess = function () {
          var d = req.result;
          d.onversionchange = function () { d.close(); dbPromise = null; };   // factory reset can delete it
          resolve(d);
        };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () { reject(new Error("blocked")); };
      });
      dbPromise.catch(function () { dbPromise = null; });
    }
    return dbPromise;
  }
  function idb(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(store, mode);
        var res;
        var r = fn(tx.objectStore(store));
        if (r) r.onsuccess = function () { res = r.result; };
        tx.oncomplete = function () { resolve(res); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }
  function idbGet(store, key) { return idb(store, "readonly", function (s) { return s.get(key); }); }
  function idbPut(store, key, val) { return idb(store, "readwrite", function (s) { s.put(val, key); }); }
  function idbDel(store, key) { return idb(store, "readwrite", function (s) { s.delete(key); }); }
  // Deletes every key starting with prefix (one account's cache).
  function idbDelPrefix(store, prefix) {
    return idb(store, "readwrite", function (s) {
      s.delete(IDBKeyRange.bound(prefix, prefix + "\uffff"));
    });
  }

  // ---------- 4. Passwords (sealed with the device key) ----------
  // A non-extractable AES-GCM key lives in this app's own IndexedDB:
  // the raw bytes can never be read, not even by script (A65c).
  var passCache = {};
  function deviceKey() {
    return idbGet("keys", "device").then(function (k) {
      if (k) return k;
      return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
        .then(function (nk) { return idbPut("keys", "device", nk).then(function () { return nk; }); });
    });
  }
  function savePass(acctId, pass) {
    return deviceKey().then(function (key) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(pass))
        .then(function (sealed) { return idbPut("creds", acctId, { iv: iv.buffer, data: sealed }); })
        .then(function () { passCache[acctId] = pass; });
    });
  }
  function loadPass(acctId) {
    if (passCache[acctId] !== undefined) return Promise.resolve(passCache[acctId]);
    return idbGet("creds", acctId).then(function (rec) {
      if (!rec) return null;
      return deviceKey().then(function (key) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, key, rec.data);
      }).then(function (plain) {
        var p = new TextDecoder().decode(plain);
        passCache[acctId] = p;
        return p;
      });
    }).catch(function () { return null; });
  }
  function dropPass(acctId) {
    delete passCache[acctId];
    return idbDel("creds", acctId).catch(function () {});
  }

  // ---------- 5. Relay client ----------
  function relayUrl() { return data.relay.url || DEFAULT_RELAY; }

  function MailError(code, msg) { this.code = code; this.msg = msg || ""; }
  function errText(e) {
    var code = e && e.code ? e.code : "relay";
    var s = t("err." + code, { msg: (e && e.msg) || code });
    return s === "err." + code ? t("err.relay") : s;
  }

  // One relay call. `pass` given = a login test before the account is saved.
  function call(op, acct, args, pass) {
    if (!navigator.onLine) return Promise.reject(new MailError("offline"));
    var url = relayUrl();
    if (!url) return Promise.reject(new MailError("norelay"));
    var pp = pass !== undefined ? Promise.resolve(pass) : loadPass(acct.id);
    return pp.then(function (pw) {
      if (!pw) throw new MailError("nopass");
      var body = { op: op, acct: { host: acct.imap.host, port: acct.imap.port, sec: acct.imap.sec,
                                   user: acct.imap.user || acct.email, pass: pw } };
      Object.keys(args || {}).forEach(function (k) { body[k] = args[k]; });
      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); }, CALL_TIMEOUT);
      return fetch(url + "/v1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer"
      }).then(function (r) {
        return r.json().catch(function () { return null; });
      }, function () {
        throw new MailError(ctl.signal.aborted ? "timeout" : "network");
      }).then(function (j) {
        clearTimeout(timer);
        if (!j || typeof j !== "object") throw new MailError("relay");
        if (!j.ok) throw new MailError((j.error && j.error.code) || "relay", j.error && j.error.msg);
        return j.data;
      }, function (e) {
        clearTimeout(timer);
        throw e;
      });
    });
  }

  // ---------- 6. Folders + message cache ----------
  var data = emptyData();
  var prefs = { acct: null, folder: "INBOX", plain: 0 };
  var folders = {};        // acctId → [folder] (sorted)
  var needPass = {};       // acctId → 1 when no password on this device
  var cur = null;          // heads record of the open folder
  var openMsg = null;      // { uid, sum, parsed, blocked, remote }
  var busy = {};           // key → promise (de-dup)
  var lastErr = null;
  var showImgFor = {};     // uid → 1 (this session)
  var view = "list";       // mobile pane: side | list | read
  var refreshTimer = null, backoff = REFRESH_MS, tick = 0;

  function acctById(id) {
    for (var i = 0; i < data.accounts.length; i++) if (data.accounts[i].id === id) return data.accounts[i];
    return null;
  }
  function curAcct() { return acctById(prefs.acct) || data.accounts[0] || null; }
  function headKey(acctId, folder) { return acctId + "|" + folder; }
  function bodyKey(acctId, folder, uidv, uid) { return acctId + "|" + folder + "|" + uidv + "|" + uid; }

  function loadFolders(acct) {
    return idbGet("folders", acct.id).then(function (rec) {
      if (rec && Array.isArray(rec.list)) folders[acct.id] = rec.list;
    }).catch(function () {});
  }
  function refreshFolders(acct) {
    var k = "f|" + acct.id;
    if (busy[k]) return busy[k];
    busy[k] = call("folders", acct, {}).then(function (res) {
      var list = sortFolders(Array.isArray(res.folders) ? res.folders : []);
      folders[acct.id] = list;
      delete needPass[acct.id];
      return idbPut("folders", acct.id, { list: list, at: Date.now() });
    }).then(function () { renderSide(); }, function (e) {
      if (e.code === "nopass") { needPass[acct.id] = 1; renderSide(); }
      throw e;
    });
    busy[k].then(clearBusy, clearBusy);
    function clearBusy() { delete busy[k]; }
    return busy[k];
  }

  function emptyHeads(acctId, folder) {
    return { acct: acctId, folder: folder, uidv: 0, msgs: [], more: false, at: 0, pend: {} };
  }
  function loadHeads(acctId, folder) {
    return idbGet("heads", headKey(acctId, folder)).then(function (rec) {
      return rec && Array.isArray(rec.msgs) ? rec : emptyHeads(acctId, folder);
    }, function () { return emptyHeads(acctId, folder); });
  }
  function saveHeads(rec) { return idbPut("heads", headKey(rec.acct, rec.folder), rec).catch(function () {}); }

  function summarize(x) {
    var s = M.summary(M.b64ToBin(x.hdr || ""));
    return { uid: x.uid, flags: Array.isArray(x.flags) ? x.flags : [], size: x.size || 0,
             date: s.date || M.parseDate(x.date), from: s.from, to: s.to, cc: s.cc,
             subj: s.subject, att: s.att, mid: s.messageId };
  }
  function hasFlag(m, f) { return m.flags.indexOf(f) >= 0; }

  // Applies one "list" answer to the cache: drops what the server no
  // longer has, refreshes flags, adds the new headers, and keeps the
  // cached run contiguous (a gap of unseen UIDs cuts the older part,
  // "older" paging brings it back).
  function applyList(rec, res, older) {
    if (rec.uidv && res.uidvalidity !== rec.uidv) { rec.msgs = []; rec.pend = {}; }
    rec.uidv = res.uidvalidity;
    var alive = uidSetHas(res.uids);
    var byUid = {};
    rec.msgs.forEach(function (m) { if (alive[m.uid]) byUid[m.uid] = m; });
    Object.keys(res.flags || {}).forEach(function (u) {
      if (byUid[u]) byUid[u].flags = res.flags[u];
    });
    (res.msgs || []).forEach(function (x) { if (x && x.uid > 0) byUid[x.uid] = summarize(x); });
    // re-apply local changes not yet on the server
    Object.keys(rec.pend || {}).forEach(function (u) {
      if (byUid[u] && !hasFlag(byUid[u], "\\Seen")) byUid[u].flags = byUid[u].flags.concat("\\Seen");
      if (!alive[u]) delete rec.pend[u];
    });
    var aliveDesc = Object.keys(alive).map(Number).sort(function (a, b) { return b - a; });
    var cut = 0;
    if (!older) {
      for (var i = 0; i < aliveDesc.length; i++) { if (!byUid[aliveDesc[i]]) { cut = aliveDesc[i]; break; } }
    }
    var list = Object.keys(byUid).map(function (u) { return byUid[u]; })
      .filter(function (m) { return !cut || m.uid > cut; })
      .sort(function (a, b) { return b.uid - a.uid; })
      .slice(0, KEEP_HEADS);
    rec.msgs = list;
    var minUid = list.length ? list[list.length - 1].uid : Infinity;
    rec.more = aliveDesc.some(function (u) { return u < minUid; });
    rec.at = Date.now();
    return rec;
  }

  function refreshFolder(acct, folder, older) {
    var k = "l|" + acct.id + "|" + folder + (older ? "|o" : "");
    if (busy[k]) return busy[k];
    busy[k] = loadHeads(acct.id, folder).then(function (rec) {
      return flushPend(acct, rec).then(function () {
        var known = rec.msgs.map(function (m) { return m.uid; });
        var args = { folder: folder, limit: PAGE };
        if (known.length) args.known = compressUids(known);
        if (older && known.length) args.beforeUid = known[known.length - 1];
        return call("list", acct, args).then(function (res) {
          applyList(rec, res, older);
          return saveHeads(rec).then(function () { return rec; });
        });
      });
    });
    busy[k].then(clearBusy, clearBusy);
    function clearBusy() { delete busy[k]; }
    return busy[k];
  }

  // Read marks made offline (or that failed) go up with the next call.
  function flushPend(acct, rec) {
    var uids = Object.keys(rec.pend || {}).map(Number).filter(function (u) { return u > 0; });
    if (!uids.length || !navigator.onLine) return Promise.resolve();
    return call("flag", acct, { folder: rec.folder, uids: uids.slice(0, 500), add: ["\\Seen"], remove: [] })
      .then(function () { uids.forEach(function (u) { delete rec.pend[u]; }); return saveHeads(rec); },
            function () {});
  }

  // Message source: cache first, then the relay. Kept as base64.
  function getSource(acct, folder, uidv, uid) {
    var key = bodyKey(acct.id, folder, uidv, uid);
    return idbGet("bodies", key).catch(function () { return null; }).then(function (rec) {
      if (rec && typeof rec.raw === "string") {
        rec.at = Date.now();
        idbPut("bodies", key, rec).catch(function () {});
        return rec.raw;
      }
      if (!navigator.onLine) throw new MailError("offline-body");
      return call("fetch", acct, { folder: folder, uid: uid }).then(function (res) {
        var raw = res.raw || "";
        var val = { raw: raw, at: Date.now(), size: raw.length };
        return idbPut("bodies", key, val).catch(function () {}).then(function () {
          pruneBodies();
          return raw;
        });
      });
    });
  }
  var pruning = false;
  function pruneBodies() {
    if (pruning) return;
    pruning = true;
    var rows = [];
    db().then(function (d) {
      return new Promise(function (resolve) {
        var tx = d.transaction("bodies", "readonly");
        var req = tx.objectStore("bodies").openCursor();
        req.onsuccess = function () {
          var c = req.result;
          if (!c) return;
          rows.push({ k: c.key, at: c.value.at || 0, size: c.value.size || 0 });
          c.continue();
        };
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    }).then(function () {
      rows.sort(function (a, b) { return b.at - a.at; });
      var total = 0, drop = [];
      rows.forEach(function (r, i) {
        total += r.size;
        if (i >= KEEP_BODIES || total > BODY_BUDGET) drop.push(r.k);
      });
      if (!drop.length) return;
      return idb("bodies", "readwrite", function (s) { drop.forEach(function (k) { s.delete(k); }); });
    }).catch(function () {}).then(function () { pruning = false; });
  }

  function markSeen(acct, rec, m) {
    if (hasFlag(m, "\\Seen")) return;
    m.flags = m.flags.concat("\\Seen");
    rec.pend = rec.pend || {};
    rec.pend[m.uid] = 1;
    adjustUnseen(acct.id, rec.folder, -1);
    saveHeads(rec).then(function () { return flushPend(acct, rec); });
  }
  function adjustUnseen(acctId, folder, d) {
    (folders[acctId] || []).forEach(function (f) {
      if (f.name === folder && isInt(f.unseen)) f.unseen = Math.max(0, f.unseen + d);
    });
    renderSide();
  }

  // ---------- 7. UI: toolbar, side, list ----------
  function setView(v) {
    view = v;
    document.body.setAttribute("data-view", v);
    $("scrim").hidden = v !== "side";
    renderBar();
  }
  function narrow() { return window.matchMedia("(max-width: 899px)").matches; }
  function phone() { return window.matchMedia("(max-width: 639px)").matches; }

  function renderBar() {
    var nav = $("nav-btn");
    var back = phone() && view === "read";
    nav.innerHTML = back ? UI.back : UI.menu;
    nav.setAttribute("aria-label", back ? t("nav.back") : t("nav.folders"));
    nav.title = nav.getAttribute("aria-label");
    nav.hidden = !narrow() && !back;
    var acct = curAcct();
    var f = acct && currentFolder();
    $("bar-title").textContent = f ? folderLabel(f) : t("app");
    var spin = Object.keys(busy).length > 0;
    $("refresh-btn").classList.toggle("spin", spin);
    $("refresh-btn").disabled = !acct;
    var net = $("net");
    var msg = !navigator.onLine ? t("net.offline") : (data.accounts.length && !relayUrl() ? t("net.norelay") : "");
    net.textContent = msg;
    net.hidden = !msg;
  }

  function currentFolder() {
    var acct = curAcct();
    if (!acct) return null;
    var list = folders[acct.id] || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === prefs.folder) return list[i];
    return { name: prefs.folder, delim: "", flags: [] };
  }

  function renderSide() {
    var box = $("accts");
    box.innerHTML = "";
    data.accounts.forEach(function (acct) {
      var sec = el("section", "acct");
      var head = el("div", "acct-head");
      var av = el("span", "av sm", initial({ name: acct.name, addr: acct.email }));
      av.style.background = "hsl(" + hue(acct.email) + " 45% 42%)";
      head.appendChild(av);
      var nm = el("div", "acct-name");
      nm.appendChild(el("div", "acct-title", acct.name || acct.email));
      if (acct.name) nm.appendChild(el("div", "acct-mail", acct.email));
      head.appendChild(nm);
      sec.appendChild(head);
      if (needPass[acct.id]) {
        var pb = el("button", "pass-need");
        pb.type = "button";
        pb.innerHTML = UI.key;
        pb.appendChild(el("span", "", t("pass.need")));
        pb.addEventListener("click", function () { passDialog(acct); });
        sec.appendChild(pb);
      }
      var ul = el("ul", "folders");
      var list = folders[acct.id] || [{ name: "INBOX", delim: "", flags: [] }];
      list.forEach(function (f) {
        var li = el("li");
        var b = el("button", "folder");
        b.type = "button";
        var active = acct.id === (curAcct() && curAcct().id) && f.name === prefs.folder;
        if (active) { b.classList.add("on"); b.setAttribute("aria-current", "true"); }
        b.style.paddingLeft = (12 + folderDepth(f) * 14) + "px";
        b.appendChild(el("span", "folder-name", folderLabel(f)));
        if (f.unseen > 0) b.appendChild(el("span", "badge", f.unseen > 999 ? "999+" : String(f.unseen)));
        b.addEventListener("click", function () { openFolder(acct.id, f.name); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      box.appendChild(sec);
    });
    var add = $("add-acct");
    add.innerHTML = UI.plus;
    add.appendChild(el("span", "", t("acct.add")));
    add.hidden = data.accounts.length >= MAX_ACCTS;
  }

  function renderList() {
    var ul = $("list");
    var foot = $("list-foot");
    var acct = curAcct();
    ul.innerHTML = "";
    foot.innerHTML = "";
    var f = currentFolder();
    $("list-title").textContent = f ? folderLabel(f) : "";
    $("list-count").textContent = f && f.unseen > 0 ? t("list.count", { n: f.unseen }) : "";
    if (!acct || !cur) return;
    var loading = !!busy["l|" + acct.id + "|" + cur.folder];
    if (!cur.msgs.length) {
      foot.appendChild(el("p", "hint", loading ? t("list.loading") :
        (lastErr ? errText(lastErr) : (cur.at ? t("list.empty") : t("list.never")))));
      if (!loading && lastErr) foot.appendChild(retryBtn(function () { refreshCurrent(true); }));
      return;
    }
    cur.msgs.forEach(function (m) { ul.appendChild(listRow(m)); });
    if (lastErr && !loading) {
      var p = el("p", "hint err", errText(lastErr));
      foot.appendChild(p);
    }
    if (cur.more) {
      var ob = el("button", "older-btn", busy["l|" + acct.id + "|" + cur.folder + "|o"] ? t("list.loading") : t("list.older"));
      ob.type = "button";
      ob.addEventListener("click", loadOlder);
      foot.appendChild(ob);
    } else if (cur.msgs.length > 10) {
      foot.appendChild(el("p", "hint", t("list.end")));
    }
  }

  function listRow(m) {
    var li = el("li");
    var b = el("button", "row");
    b.type = "button";
    b.setAttribute("data-uid", String(m.uid));
    var unseen = !hasFlag(m, "\\Seen");
    if (unseen) b.classList.add("unseen");
    if (openMsg && openMsg.uid === m.uid) { b.classList.add("on"); b.setAttribute("aria-current", "true"); }
    var role = folderRole(currentFolder() || {});
    var person = (role === "sent" || role === "drafts") ? (m.to[0] || m.from) : m.from;
    var av = el("span", "av", initial(person));
    av.style.background = "hsl(" + hue(person && person.addr) + " 45% 42%)";
    av.setAttribute("aria-hidden", "true");
    b.appendChild(av);
    var mid = el("span", "row-mid");
    var top = el("span", "row-top");
    top.appendChild(el("span", "row-from", who(person) || t("read.nosender")));
    top.appendChild(el("time", "row-date", fmtListDate(m.date)));
    mid.appendChild(top);
    var bot = el("span", "row-bot");
    bot.appendChild(el("span", "row-subj", m.subj || t("read.nosubj")));
    if (m.att) { var ic = el("span", "row-ic"); ic.innerHTML = UI.clip; bot.appendChild(ic); }
    if (hasFlag(m, "\\Flagged")) { var st = el("span", "row-ic star"); st.innerHTML = UI.star; bot.appendChild(st); }
    mid.appendChild(bot);
    b.appendChild(mid);
    if (unseen) b.appendChild(el("span", "dot", ""));
    b.addEventListener("click", function () { openMessage(m.uid); });
    li.appendChild(b);
    return li;
  }

  function retryBtn(fn) {
    var b = el("button", "link-btn", t("read.retry"));
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function showWelcome() {
    var none = !data.accounts.length;
    $("welcome").hidden = !none;
    $("side").hidden = none;
    $("listp").hidden = none;
    $("read").hidden = none;
    $("settings-btn").hidden = none;
    $("refresh-btn").hidden = none;
  }

  function renderAll() {
    showWelcome();
    renderSide();
    renderList();
    renderReader();
    renderBar();
  }

  function openFolder(acctId, folder) {
    prefs.acct = acctId;
    prefs.folder = folder;
    savePrefs();
    openMsg = null;
    lastErr = null;
    cur = null;
    if (narrow()) setView("list");
    renderAll();
    var acct = acctById(acctId);
    return loadHeads(acctId, folder).then(function (rec) {
      if (prefs.acct !== acctId || prefs.folder !== folder) return;
      cur = rec;
      renderList();
      refreshCurrent(false);
    });
  }

  function refreshCurrent(manual) {
    var acct = curAcct();
    if (!acct || !cur) return Promise.resolve();
    var folder = cur.folder;
    if (!navigator.onLine || !relayUrl()) {
      if (manual) showToast(errText(new MailError(navigator.onLine ? "norelay" : "offline")));
      renderBar();
      return Promise.resolve();
    }
    var p = refreshFolder(acct, folder, false);
    renderList();
    renderBar();
    return p.then(function (rec) {
      lastErr = null;
      backoff = REFRESH_MS;
      if (cur && cur.acct === acct.id && cur.folder === folder) { cur = rec; keepOpenValid(); }
      renderList();
      renderBar();
      if (manual) showToast(t("toast.updated"));
    }, function (e) {
      lastErr = e;
      if (e.code === "nopass") needPass[acct.id] = 1;
      backoff = Math.min(BACKOFF_MAX, backoff * 2);
      renderSide();
      renderList();
      renderBar();
      if (manual) showToast(errText(e));
    });
  }

  function keepOpenValid() {
    if (!openMsg || !cur) return;
    var still = cur.msgs.some(function (m) { return m.uid === openMsg.uid; });
    if (!still && !openMsg.parsed) { openMsg = null; renderReader(); }
  }

  function loadOlder() {
    var acct = curAcct();
    if (!acct || !cur) return;
    var folder = cur.folder;
    var p = refreshFolder(acct, folder, true);
    renderList();
    p.then(function (rec) {
      if (cur && cur.acct === acct.id && cur.folder === folder) cur = rec;
      renderList();
    }, function (e) { showToast(errText(e)); renderList(); });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      if (document.visibilityState === "visible" && navigator.onLine && curAcct()) {
        tick++;
        if (tick % 5 === 0) refreshFolders(curAcct()).catch(function () {});
        refreshCurrent(false);
      }
      scheduleRefresh();
    }, backoff);
  }

  // ---------- 8. UI: reader ----------
  function findMsg(uid) {
    if (!cur) return null;
    for (var i = 0; i < cur.msgs.length; i++) if (cur.msgs[i].uid === uid) return cur.msgs[i];
    return null;
  }

  function openMessage(uid) {
    var acct = curAcct(), m = findMsg(uid);
    if (!acct || !m || !cur) return;
    var rec = cur;
    openMsg = { uid: uid, sum: m, parsed: null, err: null, loading: true };
    if (phone()) setView("read");
    renderList();
    renderReader();
    getSource(acct, rec.folder, rec.uidv, uid).then(function (raw) {
      if (!openMsg || openMsg.uid !== uid) return;
      openMsg.parsed = M.parseMessage(M.b64ToBin(raw));
      openMsg.loading = false;
      markSeen(acct, rec, m);
      renderList();
      renderReader();
    }, function (e) {
      if (!openMsg || openMsg.uid !== uid) return;
      openMsg.loading = false;
      openMsg.err = e;
      renderReader();
    });
  }

  function renderReader() {
    var empty = $("read-empty"), art = $("msg");
    if (!openMsg) {
      art.hidden = true;
      empty.hidden = false;
      empty.textContent = t("read.none");
      return;
    }
    empty.hidden = true;
    art.hidden = false;
    var m = openMsg.sum;
    $("msg-subj").textContent = m.subj || t("read.nosubj");
    var av = $("msg-av");
    av.textContent = initial(m.from);
    av.style.background = "hsl(" + hue(m.from.addr) + " 45% 42%)";
    var sender = $("msg-sender");
    sender.innerHTML = "";
    sender.appendChild(el("span", "who", m.from.name || m.from.addr || t("read.nosender")));
    if (m.from.name && m.from.addr) sender.appendChild(el("span", "addr", m.from.addr));
    var acct = curAcct();
    var mine = acct ? lowerAddr(acct.email) : "";
    function names(list) {
      return list.map(function (p) { return lowerAddr(p.addr) === mine ? t("read.me") : who(p); }).join(", ");
    }
    var to = $("msg-to");
    to.textContent = [m.to.length ? t("read.to", { list: names(m.to) }) : "",
                      m.cc.length ? t("read.cc", { list: names(m.cc) }) : ""].filter(Boolean).join(" · ");
    $("msg-date").textContent = fmtFullDate(m.date);
    $("msg-date").setAttribute("datetime", m.date ? new Date(m.date).toISOString() : "");
    var bars = $("msg-bars"), body = $("msg-body"), atts = $("msg-atts");
    bars.innerHTML = "";
    body.innerHTML = "";
    atts.innerHTML = "";
    atts.hidden = true;
    if (openMsg.loading) { body.appendChild(el("p", "hint pad", t("read.loading"))); return; }
    if (openMsg.err) {
      var off = openMsg.err.code === "offline-body";
      body.appendChild(el("p", "hint pad", off ? t("read.offline") : t("read.failed") + " " + errText(openMsg.err)));
      if (!off) body.appendChild(retryBtn(function () { openMessage(openMsg.uid); }));
      return;
    }
    var p = openMsg.parsed;
    renderIcs(p, bars);
    var useHtml = p.html !== null && !(prefs.plain && p.text !== null && !openMsg.forceHtml);
    if (useHtml) renderHtml(p, m, bars, body);
    else {
      if (p.html !== null && prefs.plain) {
        var pb = el("div", "bar");
        pb.appendChild(el("span", "", t("read.plainOnly")));
        var hb = el("button", "link-btn", t("read.html"));
        hb.type = "button";
        hb.addEventListener("click", function () { openMsg.forceHtml = true; renderReader(); });
        pb.appendChild(hb);
        bars.appendChild(pb);
      }
      renderText(p.text !== null ? p.text : "", body);
    }
    renderAtts(p, atts);
  }

  function renderText(text, box) {
    var pre = el("div", "plain");
    M.splitLinks(text).forEach(function (seg) {
      if (!seg.href) { pre.appendChild(document.createTextNode(seg.t)); return; }
      var a = el("a", "", seg.t);
      a.href = seg.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      pre.appendChild(a);
    });
    box.appendChild(pre);
  }

  function dataUrl(att) {
    if (!/^image\/(png|jpe?g|gif|webp|bmp)$/.test(att.type)) return null;
    if (att.data.length > 5 * 1024 * 1024) return null;
    return "data:" + att.type + ";base64," + M.binToB64(att.data);
  }

  // Second wall: an iframe with sandbox (no scripts, opaque origin, no
  // forms) and a CSP that allows only inline style and data: images —
  // plus http(s) images once the reader allows them.
  function renderHtml(p, m, bars, body) {
    var cids = {};
    Object.keys(p.cids).forEach(function (c) { var u = dataUrl(p.cids[c]); if (u) cids[c] = u; });
    var sender = lowerAddr(m.from.addr);
    var remote = !!showImgFor[m.uid] || !!(sender && data.imgOk[sender]);
    var clean = window.orosMailSanitize(p.html, { remote: remote, cids: cids });
    if (clean.blocked > 0 && !remote) {
      var bar = el("div", "bar");
      bar.appendChild(el("span", "", t("img.blocked")));
      var acts = el("span", "bar-acts");
      var b1 = el("button", "link-btn", t("img.show"));
      b1.type = "button";
      b1.addEventListener("click", function () { showImgFor[m.uid] = 1; renderReader(); });
      acts.appendChild(b1);
      if (sender) {
        var b2 = el("button", "link-btn", t("img.always", { who: m.from.name || sender }));
        b2.type = "button";
        b2.addEventListener("click", function () {
          data.imgOk[sender] = Date.now();
          data = mergeMail(data, data);
          saveData();
          renderReader();
        });
        acts.appendChild(b2);
      }
      bar.appendChild(acts);
      bars.appendChild(bar);
    }
    var csp = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:" +
              (remote ? " https: http:" : "") + "; form-action 'none'; frame-src 'none'";
    var doc = "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"" + csp + "\">" +
      "<meta name=\"referrer\" content=\"no-referrer\"><base target=\"_blank\">" +
      "<style>html{background:#fff}body{margin:0;padding:14px 16px;font:15px/1.5 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;" +
      "color:#1b1b1b;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}" +
      "pre{white-space:pre-wrap}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #ccc}</style>" +
      "</head><body>" + clean.html + "</body></html>";
    var fr = document.createElement("iframe");
    fr.className = "html-frame";
    fr.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    fr.setAttribute("referrerpolicy", "no-referrer");
    fr.setAttribute("title", m.subj || t("read.nosubj"));
    fr.srcdoc = doc;
    body.appendChild(fr);
  }

  function renderAtts(p, box) {
    var list = p.attachments.filter(function (a) { return !(a.inline && a.cid && /^image\//.test(a.type)); });
    if (!list.length) return;
    box.hidden = false;
    box.appendChild(el("div", "atts-title", t("att.title")));
    var row = el("div", "atts");
    list.forEach(function (a) {
      var b = el("button", "att");
      b.type = "button";
      b.title = t("att.save", { name: a.name });
      b.setAttribute("aria-label", b.title);
      var ic = el("span", "att-ic");
      ic.innerHTML = UI.down;
      b.appendChild(ic);
      var tx = el("span", "att-tx");
      tx.appendChild(el("span", "att-name", a.name));
      tx.appendChild(el("span", "att-size", fmtSize(a.size)));
      b.appendChild(tx);
      b.addEventListener("click", function () { saveAttachment(a); });
      row.appendChild(b);
    });
    box.appendChild(row);
  }

  function dialogHost() {
    try {
      var d = window.parent && window.parent !== window ? window.parent.orosDialog : null;
      if (d && typeof d.saveFile === "function") return d;
    } catch (e) {}
    return null;
  }
  function saveAttachment(a) {
    var bytes = new Uint8Array(a.data.length);
    for (var i = 0; i < a.data.length; i++) bytes[i] = a.data.charCodeAt(i) & 0xff;
    var blob = new Blob([bytes], { type: "application/octet-stream" });
    var host = dialogHost();
    if (host) {
      host.saveFile({ blob: blob, filename: a.name, mime: "application/octet-stream" }).then(function (r) {
        if (!r || (!r.ok && r.mode !== "native")) showToast(t("toast.saveFail"));
      });
      return;
    }
    // Standalone run (no shell): plain download.
    var url = URL.createObjectURL(blob);
    var link = el("a");
    link.href = url;
    link.download = a.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
  }

  // Invitations (.ics): one card per event; Calendar gets a PREFILL
  // (BR-W8-6), Maps the place.
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function icsLocal(d) {
    if (!d) return null;
    if (d.allDay || !d.utc) return { ymd: d.y + "-" + pad2(d.mo) + "-" + pad2(d.d), hm: d.allDay ? "" : pad2(d.h) + ":" + pad2(d.mi), ms: new Date(d.y, d.mo - 1, d.d, d.h, d.mi).getTime() };
    var x = new Date(Date.UTC(d.y, d.mo - 1, d.d, d.h, d.mi));
    return { ymd: x.getFullYear() + "-" + pad2(x.getMonth() + 1) + "-" + pad2(x.getDate()),
             hm: pad2(x.getHours()) + ":" + pad2(x.getMinutes()), ms: x.getTime() };
  }
  function renderIcs(p, bars) {
    p.ics.forEach(function (text) {
      M.parseIcs(text).slice(0, 3).forEach(function (ev) {
        var st = icsLocal(ev.dtstart);
        if (!st) return;
        var card = el("div", "ics");
        card.appendChild(el("div", "ics-k", t("ics.title")));
        card.appendChild(el("div", "ics-title", ev.summary || t("read.nosubj")));
        var when = new Date(st.ms).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }) +
                   (st.hm ? " · " + st.hm : " · " + t("ics.allday"));
        card.appendChild(el("div", "ics-when", when));
        if (ev.location) card.appendChild(el("div", "ics-loc", ev.location));
        var acts = el("div", "ics-acts");
        var parent = null;
        try { parent = window.parent !== window ? window.parent : null; } catch (e) {}
        if (parent && typeof parent.__orosOpenCalendarNew === "function") {
          var cb = el("button", "dlg-btn primary", t("ics.cal"));
          cb.type = "button";
          cb.addEventListener("click", function () {
            var pay = { date: st.ymd, title: String(ev.summary || "").slice(0, 200) };
            if (st.hm) pay.start = st.hm;
            if (ev.location) pay.location = ev.location;
            if (ev.description) pay.note = ev.description;
            parent.__orosOpenCalendarNew(pay);
          });
          acts.appendChild(cb);
        }
        if (ev.location && parent && typeof parent.__orosOpenMapsQuery === "function") {
          var mb = el("button", "dlg-btn", t("ics.map"));
          mb.type = "button";
          mb.addEventListener("click", function () { parent.__orosOpenMapsQuery(ev.location, ev.summary || ""); });
          acts.appendChild(mb);
        }
        if (acts.firstChild) card.appendChild(acts);
        bars.appendChild(card);
      });
    });
  }

  // ---------- 9. Account dialog + settings ----------
  function field(form, id, label, type, value, attrs) {
    var lab = el("label", "dlg-lbl", label);
    lab.setAttribute("for", id);
    var inp = el("input");
    inp.id = id;
    inp.type = type || "text";
    inp.value = value || "";
    Object.keys(attrs || {}).forEach(function (k) { inp.setAttribute(k, attrs[k]); });
    form.appendChild(lab);
    form.appendChild(inp);
    return inp;
  }
  function portSelect(form, id, label, opts, value) {
    var lab = el("label", "dlg-lbl", label);
    lab.setAttribute("for", id);
    var sel = el("select");
    sel.id = id;
    opts.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = String(o[0]);
      sel.appendChild(op);
    });
    sel.value = String(value);
    form.appendChild(lab);
    form.appendChild(sel);
    return sel;
  }

  function acctDialog(existing) {
    if (!existing && data.accounts.length >= MAX_ACCTS) { showToast(t("err.max", { n: MAX_ACCTS })); return; }
    var dlg = makeDialog("ml-acct");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t(existing ? "dlg.editTitle" : "dlg.acctTitle")));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var fName = field(form, "ml-name", t("dlg.name"), "text", existing ? existing.name : "", { maxlength: "80", autocomplete: "name" });
    var fMail = field(form, "ml-email", t("dlg.email"), "email", existing ? existing.email : "", { maxlength: "254", autocomplete: "email", inputmode: "email" });
    var fPass = field(form, "ml-pass", t("dlg.pass"), "password", "", { maxlength: "512", autocomplete: "current-password" });
    if (existing) fPass.placeholder = t("dlg.passKeep");
    var hint = el("p", "dlg-hint");
    form.appendChild(hint);

    var det = el("details", "srv");
    det.appendChild(el("summary", "", t("dlg.server")));
    var fImap = field(det, "ml-imap", t("dlg.imap"), "text", existing ? existing.imap.host : "", { maxlength: "253", autocapitalize: "off", spellcheck: "false" });
    var fPort = portSelect(det, "ml-port", t("dlg.port"), [[993, "993 · SSL/TLS"], [143, "143 · STARTTLS"]], existing ? existing.imap.port : 993);
    var fUser = field(det, "ml-user", t("dlg.user"), "text", existing ? existing.imap.user : "", { maxlength: "320", autocapitalize: "off", spellcheck: "false" });
    var fSmtp = field(det, "ml-smtp", t("dlg.smtp"), "text", existing && existing.smtp ? existing.smtp.host : "", { maxlength: "253", autocapitalize: "off", spellcheck: "false" });
    var fSport = portSelect(det, "ml-sport", t("dlg.port"), [[465, "465 · SSL/TLS"], [587, "587 · STARTTLS"]], existing && existing.smtp ? existing.smtp.port : 465);
    det.appendChild(el("p", "dlg-hint", t("dlg.smtpNote")));
    form.appendChild(det);

    var fRelay = null;
    if (!relayUrl()) {
      fRelay = field(form, "ml-relay", t("dlg.relay"), "url", "", { maxlength: "300", placeholder: "https://", autocapitalize: "off", spellcheck: "false" });
      form.appendChild(el("p", "dlg-hint", t("dlg.relayHint")));
    }
    form.appendChild(el("p", "dlg-hint dim", t("dlg.passDevice")));
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);

    var touched = { imap: !!existing, user: !!existing, smtp: !!existing };
    fImap.addEventListener("input", function () { touched.imap = true; });
    fUser.addEventListener("input", function () { touched.user = true; });
    fSmtp.addEventListener("input", function () { touched.smtp = true; });
    function applyPreset() {
      var pre = presetFor(fMail.value);
      hint.textContent = "";
      if (!pre) return;
      if (pre.oauth) { hint.textContent = t("dlg.oauth"); return; }
      if (!touched.imap) { fImap.value = pre.imap; fPort.value = "993"; }
      if (!touched.smtp) { fSmtp.value = pre.smtp; fSport.value = String(pre.sp); }
      if (!touched.user) fUser.value = fMail.value.trim();
      if (pre.svc) hint.textContent = t("dlg.appPass", { svc: pre.svc });
      else if (pre.generic) hint.textContent = t("dlg.generic", { domain: pre.generic });
    }
    fMail.addEventListener("input", applyPreset);
    if (!existing) applyPreset();

    var acts = el("div", "dlg-actions");
    if (existing) {
      var rm = button(t("dlg.remove"), "danger", function () { dlg.close(); removeDialog(existing); });
      acts.appendChild(rm);
    }
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t(existing ? "dlg.save" : "dlg.connect"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errP.textContent = "";
      var email = normEmail(fMail.value);
      var host = normHost(fImap.value);
      var pass = fPass.value;
      if (!email || (!pass && !existing) || !fImap.value.trim()) { errP.textContent = t("err.fields"); return; }
      if (!host) { errP.textContent = t("err.host"); return; }
      var dup = data.accounts.some(function (a) {
        return (!existing || a.id !== existing.id) && lowerAddr(a.email) === lowerAddr(email) && a.imap.host === host;
      });
      if (dup) { errP.textContent = t("err.dup"); return; }
      if (fRelay) {
        var ru = normRelayUrl(fRelay.value);
        if (!ru) { errP.textContent = t("err.relayUrl"); return; }
        data.relay = { url: ru, m: Math.max(Date.now(), data.relay.m + 1) };
      }
      var acct = {
        id: existing ? existing.id : newId(),
        m: existing ? Math.max(Date.now(), existing.m + 1) : Date.now(),
        name: fName.value, email: email,
        imap: { host: host, port: +fPort.value, user: fUser.value.trim() || email }
      };
      var smtpHost = normHost(fSmtp.value);
      if (smtpHost) acct.smtp = { host: smtpHost, port: +fSport.value, user: fUser.value.trim() || email };
      var n = normAccount(acct);
      if (!n) { errP.textContent = t("err.host"); return; }
      var serverChanged = !existing || existing.imap.host !== n.imap.host || existing.imap.port !== n.imap.port ||
                          existing.imap.user !== n.imap.user;
      var needCheck = !!pass || serverChanged;
      ok.disabled = true;
      ok.textContent = t("dlg.checking");
      var check = needCheck
        ? (pass ? Promise.resolve(pass) : loadPass(n.id)).then(function (pw) {
            if (!pw) throw new MailError("nopass");
            return call("check", n, {}, pw).then(function () { return pw; });
          })
        : Promise.resolve(null);
      check.then(function (pw) {
        return (pw && pass ? savePass(n.id, pw) : Promise.resolve()).then(function () {
          data.accounts = data.accounts.filter(function (a) { return a.id !== n.id; }).concat([n]);
          data = mergeMail(data, data);
          saveData();
          delete needPass[n.id];
          dlg.close();
          showToast(t(existing ? "toast.saved" : "toast.added"));
          if (!existing || serverChanged) {
            if (existing) { delete folders[n.id]; idbDelPrefix("heads", n.id + "|").catch(function () {}); }
            refreshFolders(n).catch(function () {});
            openFolder(n.id, "INBOX");
          } else renderAll();
        });
      }).catch(function (err) {
        ok.disabled = false;
        ok.textContent = t(existing ? "dlg.save" : "dlg.connect");
        errP.textContent = errText(err);
      });
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    (existing ? fPass : fMail).focus();
  }

  function passDialog(acct) {
    var dlg = makeDialog("ml-pass-dlg");
    dlg.appendChild(el("div", "dlg-title", t("pass.title", { email: acct.email })));
    dlg.appendChild(el("p", "dlg-hint", t("pass.text")));
    var form = el("form");
    form.method = "dialog";
    var inp = field(form, "ml-pass2", t("dlg.pass"), "password", "", { maxlength: "512", autocomplete: "current-password" });
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.connect"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var pw = inp.value;
      if (!pw) { errP.textContent = t("err.fields"); return; }
      ok.disabled = true;
      ok.textContent = t("dlg.checking");
      call("check", acct, {}, pw).then(function () { return savePass(acct.id, pw); }).then(function () {
        delete needPass[acct.id];
        dlg.close();
        if (narrow()) setView("list");
        refreshFolders(acct).catch(function () {});
        if (curAcct() && curAcct().id === acct.id) refreshCurrent(false);
        renderSide();
      }, function (err) {
        ok.disabled = false;
        ok.textContent = t("dlg.connect");
        errP.textContent = errText(err);
      });
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    inp.focus();
  }

  function removeDialog(acct) {
    var dlg = makeDialog("ml-rm");
    dlg.appendChild(el("div", "dlg-title", t("dlg.remove")));
    dlg.appendChild(el("p", "dlg-text", t("dlg.removeQ", { name: acct.email })));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("dlg.removeOk"), "danger", function () {
      dlg.close();
      data.tombs[acct.id] = Math.max(Date.now(), acct.m);
      data = mergeMail(data, data);
      saveData();
      forgetAccount(acct.id);
      showToast(t("toast.removed"));
      afterAccountsChanged();
    }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // Drops this device's password and cache of an account.
  function forgetAccount(id) {
    dropPass(id);
    delete folders[id];
    delete needPass[id];
    idbDel("folders", id).catch(function () {});
    idbDelPrefix("heads", id + "|").catch(function () {});
    idbDelPrefix("bodies", id + "|").catch(function () {});
  }

  function afterAccountsChanged() {
    if (!acctById(prefs.acct)) {
      var first = data.accounts[0];
      if (first) { openFolder(first.id, "INBOX"); return; }
      prefs.acct = null;
      prefs.folder = "INBOX";
      savePrefs();
      cur = null;
      openMsg = null;
    }
    renderAll();
  }

  function settingsDialog() {
    var dlg = makeDialog("ml-set");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("set.title")));
    dlg.appendChild(el("div", "dlg-lbl", t("set.accounts")));
    var ul = el("ul", "set-accts");
    data.accounts.forEach(function (a) {
      var li = el("li");
      var tx = el("div", "set-acct");
      tx.appendChild(el("div", "set-acct-name", a.name || a.email));
      tx.appendChild(el("div", "set-acct-mail", a.email + " · " + a.imap.host));
      li.appendChild(tx);
      li.appendChild(button(t("set.edit"), "small", function () { dlg.close(); acctDialog(a); }));
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    if (data.accounts.length < MAX_ACCTS) {
      dlg.appendChild(button(t("acct.add"), "small", function () { dlg.close(); acctDialog(null); }));
    }
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var fRelay = field(form, "ml-relay2", t("set.relay"), "url", data.relay.url, { maxlength: "300", placeholder: DEFAULT_RELAY || "https://", autocapitalize: "off", spellcheck: "false" });
    form.appendChild(el("p", "dlg-hint", t("dlg.relayHint")));
    var lab = el("label", "check");
    var cb = el("input");
    cb.type = "checkbox";
    cb.checked = !!prefs.plain;
    lab.appendChild(cb);
    lab.appendChild(el("span", "", t("set.plain")));
    form.appendChild(lab);
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("set.close"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var ru = normRelayUrl(fRelay.value);
      if (ru === null || (!ru && !DEFAULT_RELAY && data.accounts.length)) { errP.textContent = t("err.relayUrl"); return; }
      if (ru !== data.relay.url) {
        data.relay = { url: ru, m: Math.max(Date.now(), data.relay.m + 1) };
        data = mergeMail(data, data);
        saveData();
      }
      prefs.plain = cb.checked ? 1 : 0;
      savePrefs();
      dlg.close();
      showToast(t("toast.saved"));
      renderAll();
      refreshCurrent(false);
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- 10. Dialogs + toasts ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
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

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "mail", title: String(text) })) return;
    } catch (e) {}
    localToast(text);
  }

  var toastTimer = null;
  function localToast(text) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.textContent = text;
    box.classList.remove("show");
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 4000);
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
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
    // j / k or arrows: next / previous message; Esc: back (phone)
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape" && view !== "list" && narrow()) { e.preventDefault(); setView("list"); return; }
      var dir = (e.key === "j" || e.key === "ArrowDown") ? 1 : ((e.key === "k" || e.key === "ArrowUp") ? -1 : 0);
      if (!dir || !cur || !cur.msgs.length) return;
      e.preventDefault();
      var idx = -1;
      if (openMsg) cur.msgs.forEach(function (m, i) { if (m.uid === openMsg.uid) idx = i; });
      var next = cur.msgs[Math.max(0, Math.min(cur.msgs.length - 1, idx + dir))];
      if (next && (!openMsg || next.uid !== openMsg.uid)) {
        openMessage(next.uid);
        var row = document.querySelector('.row[data-uid="' + next.uid + '"]');
        if (row) { row.focus(); row.scrollIntoView({ block: "nearest" }); }
      }
    });
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
    api.registerSlice("mail", sliceGet, sliceSet, STORAGE_KEY, mergeMail);
  }

  function sliceGet() { return mergeMail(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.accounts)) return;
    var before = JSON.stringify(data);
    var hadIds = data.accounts.map(function (a) { return a.id; });
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeMail(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    hadIds.forEach(function (id) { if (!acctById(id)) forgetAccount(id); });   // removed elsewhere
    data.accounts.forEach(function (a) {
      if (hadIds.indexOf(a.id) < 0) {
        loadPass(a.id).then(function (pw) { if (!pw) { needPass[a.id] = 1; renderSide(); } });
      }
    });
    afterAccountsChanged();
    if (openMsg) renderReader();
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      data = raw ? mergeMail(JSON.parse(raw), JSON.parse(raw)) : emptyData();
    } catch (e) { data = emptyData(); }
  }
  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      showToast(t("toast.storage"));
      return;
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (typeof p.acct === "string") prefs.acct = p.acct;
        if (typeof p.folder === "string" && p.folder.length <= 1000) prefs.folder = p.folder;
        prefs.plain = p.plain ? 1 : 0;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app") + " · orOS";
    $("side").setAttribute("aria-label", t("nav.folders"));
    var rb = $("refresh-btn");
    rb.innerHTML = UI.refresh;
    rb.setAttribute("aria-label", t("btn.refresh"));
    rb.title = t("btn.refresh");
    var sb = $("settings-btn");
    sb.innerHTML = UI.gear;
    sb.setAttribute("aria-label", t("btn.settings"));
    sb.title = t("btn.settings");
    $("wel-icon").innerHTML = UI.mail;
  }

  function wire() {
    $("nav-btn").addEventListener("click", function () {
      if (phone() && view === "read") setView("list");
      else setView(view === "side" ? "list" : "side");
    });
    $("scrim").addEventListener("click", function () { setView("list"); });
    $("refresh-btn").addEventListener("click", function () {
      var a = curAcct();
      if (a) refreshFolders(a).catch(function () {});
      refreshCurrent(true);
    });
    $("settings-btn").addEventListener("click", settingsDialog);
    $("add-acct").addEventListener("click", function () { acctDialog(null); });
    $("wel-add").addEventListener("click", function () { acctDialog(null); });
    window.addEventListener("online", function () { renderBar(); refreshCurrent(false); });
    window.addEventListener("offline", renderBar);
    window.addEventListener("resize", function () {
      if (!narrow() && view === "side") setView("list");
      renderBar();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && cur && Date.now() - (cur.at || 0) > REFRESH_MS) refreshCurrent(false);
    });
    wireKeyboard();
  }

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { acct, folder, uid }. Opens the folder and, when the
  // message is in its cached list, the message. Unknown account, or
  // a dialog open (maybe with unsaved edits) → no-op (returns false).
  function openSearchTarget(t) {
    if (!t || typeof t.acct !== "string" || typeof t.folder !== "string" || !t.folder ||
        typeof t.uid !== "number" || document.querySelector("dialog[open]")) return false;
    if (!acctById(t.acct)) return false;
    openFolder(t.acct, t.folder).then(function () {
      if (cur && cur.acct === t.acct && cur.folder === t.folder && findMsg(t.uid)) openMessage(t.uid);
    });
    return true;
  }
  window.__orosOpenAt = openSearchTarget;

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    setView("list");
    renderAll();
    var acct = curAcct();
    if (!acct) return;
    var pendingTarget = null;
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        pendingTarget = window.parent.__orosTakeTarget("mail");
      }
    } catch (e) {}
    Promise.all(data.accounts.map(function (a) {
      return Promise.all([loadFolders(a), loadPass(a.id).then(function (pw) { if (!pw) needPass[a.id] = 1; })]);
    })).then(function () {
      renderSide();
      data.accounts.forEach(function (a) { if (!needPass[a.id]) refreshFolders(a).catch(function () {}); });
      if (!(pendingTarget && openSearchTarget(pendingTarget))) {
        openFolder(acct.id, prefs.acct === acct.id ? prefs.folder : "INBOX");
      }
      scheduleRefresh();
    });
  }

  boot();
})();
