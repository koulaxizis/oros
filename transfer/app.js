// ============================================================
// orOS Transfer — the app (transfer/index.html, inside the shell) and
// the receive page (transfer/receive.html, any browser, no orOS needed).
// Send: tick files and folders on the orOS disk (or add files from the
// device), create a link; the other side opens it, sees the list and
// accepts. The files go straight between the two browsers (engine.js).
// Receive: a code or the link; save to the orOS disk (Transfers, every
// file ≤ 200 MB) or to the device (one file, or a ZIP).
// Nothing is synced by this app itself (no slice): it keeps no data.
// Rules: R8 (shell APIs only from the parent, guarded), R33 (files in
// and out through orosDialog), textContent only.
// ============================================================
(function () {
  "use strict";

  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    console.log("transfer/app.js v" + (m ? m[1] : "?") + " boot");
  })();

  var APP_ID = "transfer";
  var C = window.OrosTransferCore, E = window.OrosTransferEngine, S = window.OrosTransferStore, X = window.OrosTransferCloud;
  var PAGE = document.body.getAttribute("data-page") === "receive" ? "receive" : "app";
  var SHOW_MAX = 200;                       // files listed in the offer

  // ---------- 1. Language ----------
  var STR = {
    en: {
      "app.name": "Transfer",
      "tab.send": "Send", "tab.recv": "Receive", "tab.hist": "History",
      "hist.empty": "No transfers yet. Finished ones are listed here, on every device you sync.",
      "hist.sent": "Sent to {dev}", "hist.recv": "Received from {dev}", "hist.someone": "another device",
      "hist.sum": "{n} files · {s}", "hist.one": "1 file · {s}",
      "hist.bad": "{n} did not arrive whole", "hist.stopped": "Stopped before the end", "hist.relay": "through the orOS relay",
      "hist.disk": "on the orOS disk", "hist.device": "on that device",
      "hist.open": "Open", "hist.clear": "Clear history", "hist.sure": "Press again to clear",
      "note.sent": "Transfer: sent {what}", "note.recv": "Transfer: received {what}",
      "send.intro": "Straight from browser to browser, end-to-end encrypted. No size limit from us.",
      "send.add": "Add files", "send.drop": "or drop files here",
      "btn.fromDisk": "From the orOS disk", "btn.fromDevice": "From this device", "btn.done": "Done",
      "meta.title": "Title (optional)", "meta.msg": "Message (optional)",
      "btn.share": "Share…",
      "share.match": "The other person sees the same shapes in the background. If theirs match, you are connected to each other.",
      "recv.head": "Receive",
      "offer.safe": "Open files only from people you know.",
      "foot.sent": "Sent with", "foot.free": "free, no account, no ads",
      "disk.empty": "This folder is empty.",
      "disk.none": "The orOS disk is not available here.",
      "disk.root": "orOS disk",
      "disk.open": "Open {n}",
      "disk.pick": "Choose {n}",
      "send.chosen": "To send",
            "send.sum": "{n} files · {s}", "send.sum1": "1 file · {s}",
      "send.counting": "Counting…",
      "btn.makeLink": "Create link",
      "btn.makeCloud": "Send through my Dropbox", "btn.cloudDel": "Delete now",
      "cloud.check": "Checking that a Dropbox link opens in a browser…",
      "cloud.up": "Encrypting and uploading to your Dropbox…",
      "cloud.ready": "Ready until {t}. You can close this page: the files wait in your Dropbox, encrypted.",
      "cloud.keep": "Anyone with this link can download the files until {t}; after that they are deleted. Send it only to the person they are for.",
      "cloud.deleted": "Deleted from your Dropbox. The link no longer works.",
      "offer.cloud": "Through the sender's Dropbox, end-to-end encrypted. The link works until {t}.",
      "err.expired": "This link has expired or the files were deleted (links through Dropbox last 4 hours). Ask for a new one.",
      "err.cloudcheck": "Dropbox did not let this browser download its test file, so sending through Dropbox does not work here. Nothing was uploaded. Use Create link instead.",
      "err.full": "Not enough free space in your Dropbox: {s} needed.",
      "err.dropbox": "Dropbox did not take the upload. Check the sync connection in Settings › Sync, then try again.",
      "hist.cloud": "through Dropbox",
      "btn.remove": "Remove",
      "share.code": "Code",
      "share.keep": "Keep this page open until the transfer is done. The link works once, for one person.",
      "btn.copy": "Copy", "copied": "Link copied",
      "btn.cancel": "Cancel", "btn.sendMore": "Send something else",
      "recv.intro": "Type the code you were given, or open the link you got.",
      "recv.code": "Code",
      "btn.receive": "Receive",
      "recv.badCode": "That is not a code. It has 12 letters and digits, like 7K2M-9QXH-4RTB.",
      "dest.where": "Save to",
      "dest.disk": "The orOS disk (Transfers folder)",
      "dest.device": "This device",
      "dest.deviceZip": "This device, as one ZIP file",
      "dest.tooBig": "Files over {s} go to the device only: the orOS disk syncs every file whole.",
      "dest.noDisk": "Open the link inside orOS to save to its disk.",
      "space.low": "This browser has about {s} free; this transfer needs {t}.",
      "btn.decline": "Decline", "btn.accept": "Accept",
      "btn.openFiles": "Open in Files", "btn.save": "Save", "btn.recvMore": "Receive something else",
      "offer.sum": "{n} files · {s} from {dev}", "offer.sum1": "1 file · {s} from {dev}",
      "offer.more": "… and {n} more",
      "st.connecting": "Connecting…",
      "st.wait.send": "Waiting for the other person to open the link…",
      "st.wait.recv": "The sender is not here yet. Their Transfer page has to be open; this page waits.",
      "st.linking": "Connecting directly to {dev}…",
      "st.offered": "{dev} is looking at the list…",
      "st.offer": "Do you want these files?",
      "st.sending": "Sending…",
      "st.sendingRelay": "Sending through the orOS relay (no direct link, so slower)…",
      "st.receivingRelay": "Receiving through the orOS relay (no direct link, so slower)…",
      "st.reconnecting": "The connection dropped. Reconnecting; the transfer goes on from where it stopped…",
      "offer.relay": "No direct link between the two devices: it comes through the orOS relay, still end-to-end encrypted, more slowly.",
      "st.receiving": "Receiving…",
      "st.done.send": "Done. Every file arrived whole.",
      "st.done.recv": "Done. Every file arrived whole.",
      "st.done.disk": "Saved in {f} on the orOS disk.",
      "st.done.file": "Ready. Press Save to keep it on this device.",
      "st.saved": "Saved.",
      "st.someBad": "{n} files did not arrive whole: {names}",
      "st.someBadZip": "{n} files in the ZIP did not arrive whole: {names}. Ask for them again.",
      "prog": "{a} of {b}",
      "err.noroom": "Could not reach the sender. Check the code, or someone else is already receiving it.",
      "err.left": "The other side closed the page.",
      "err.nodirect": "These two devices could not connect directly (a strict network, a VPN or a firewall), and over 50 MB does not go through the orOS relay. Try both on the same Wi-Fi, another network, or send less at a time.",
      "err.declined": "The transfer was declined.",
      "err.cancelled": "The transfer was cancelled.",
      "err.lost": "The connection was lost and did not come back. Start the transfer again.",
      "err.bad": "Something arrived that was not part of this transfer. It was stopped.",
      "err.version": "The other side runs another version of Transfer. Reload both pages.",
      "err.nocrypto": "This browser cannot encrypt (it needs a secure https page).",
      "err.io": "Could not read or write a file (storage full?). The transfer was stopped.",
      "err.mem": "This browser keeps transfers in memory, up to {s}. Use another browser for this one.",
      "into.oros": "Receive into my orOS instead",
      "full": "This device is out of storage space."
    },
    el: {
      "app.name": "Μεταφορά",
      "tab.send": "Αποστολή", "tab.recv": "Λήψη", "tab.hist": "Ιστορικό",
      "hist.empty": "Καμία μεταφορά ακόμα. Όσες τελειώνουν εμφανίζονται εδώ, σε κάθε συσκευή που συγχρονίζεις.",
      "hist.sent": "Στάλθηκε σε {dev}", "hist.recv": "Λήφθηκε από {dev}", "hist.someone": "άλλη συσκευή",
      "hist.sum": "{n} αρχεία · {s}", "hist.one": "1 αρχείο · {s}",
      "hist.bad": "{n} δεν έφτασαν ακέραια", "hist.stopped": "Σταμάτησε πριν το τέλος", "hist.relay": "μέσω του αναμεταδότη orOS",
      "hist.disk": "στον δίσκο του orOS", "hist.device": "σε εκείνη τη συσκευή",
      "hist.open": "Άνοιγμα", "hist.clear": "Καθαρισμός ιστορικού", "hist.sure": "Πάτα ξανά για καθαρισμό",
      "note.sent": "Μεταφορά: στάλθηκε {what}", "note.recv": "Μεταφορά: λήφθηκε {what}",
      "send.intro": "Κατευθείαν από browser σε browser, κρυπτογραφημένα από άκρο σε άκρο. Χωρίς όριο μεγέθους από εμάς.",
      "send.add": "Πρόσθεσε αρχεία", "send.drop": "ή σύρε αρχεία εδώ",
      "btn.fromDisk": "Από τον δίσκο orOS", "btn.fromDevice": "Από τη συσκευή", "btn.done": "Έτοιμο",
      "meta.title": "Τίτλος (προαιρετικό)", "meta.msg": "Μήνυμα (προαιρετικό)",
      "btn.share": "Κοινοποίηση…",
      "share.match": "Ο άλλος βλέπει τα ίδια σχήματα στο φόντο. Αν ταιριάζουν με τα δικά σου, είστε σωστά συνδεδεμένοι.",
      "recv.head": "Λήψη",
      "offer.safe": "Άνοιγε αρχεία μόνο από ανθρώπους που ξέρεις.",
      "foot.sent": "Στάλθηκε με", "foot.free": "δωρεάν, χωρίς λογαριασμό, χωρίς διαφημίσεις",
      "disk.empty": "Ο φάκελος είναι άδειος.",
      "disk.none": "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ.",
      "disk.root": "Δίσκος orOS",
      "disk.open": "Άνοιγμα {n}",
      "disk.pick": "Επιλογή {n}",
      "send.chosen": "Για αποστολή",
            "send.sum": "{n} αρχεία · {s}", "send.sum1": "1 αρχείο · {s}",
      "send.counting": "Μέτρηση…",
      "btn.makeLink": "Δημιουργία συνδέσμου",
      "btn.makeCloud": "Αποστολή μέσω του Dropbox μου", "btn.cloudDel": "Διαγραφή τώρα",
      "cloud.check": "Ελέγχω ότι ένας σύνδεσμος Dropbox ανοίγει σε browser…",
      "cloud.up": "Κρυπτογράφηση και ανέβασμα στο Dropbox σου…",
      "cloud.ready": "Έτοιμο έως τις {t}. Μπορείς να κλείσεις τη σελίδα: τα αρχεία περιμένουν στο Dropbox σου, κρυπτογραφημένα.",
      "cloud.keep": "Όποιος έχει αυτόν τον σύνδεσμο μπορεί να κατεβάσει τα αρχεία έως τις {t}· μετά σβήνονται. Στείλ' τον μόνο σε όποιον είναι για αυτόν.",
      "cloud.deleted": "Σβήστηκαν από το Dropbox σου. Ο σύνδεσμος δεν ισχύει πια.",
      "offer.cloud": "Μέσω του Dropbox του αποστολέα, κρυπτογραφημένα από άκρο σε άκρο. Ο σύνδεσμος ισχύει έως τις {t}.",
      "err.expired": "Ο σύνδεσμος έληξε ή τα αρχεία σβήστηκαν (οι σύνδεσμοι μέσω Dropbox ισχύουν 4 ώρες). Ζήτα νέο.",
      "err.cloudcheck": "Το Dropbox δεν άφησε αυτόν τον browser να κατεβάσει το δοκιμαστικό του αρχείο, οπότε η αποστολή μέσω Dropbox δεν δουλεύει εδώ. Δεν ανέβηκε τίποτα. Χρησιμοποίησε τη Δημιουργία συνδέσμου.",
      "err.full": "Δεν φτάνει ο ελεύθερος χώρος στο Dropbox σου: χρειάζονται {s}.",
      "err.dropbox": "Το Dropbox δεν δέχτηκε το ανέβασμα. Έλεγξε τη σύνδεση στις Ρυθμίσεις › Συγχρονισμός και δοκίμασε ξανά.",
      "hist.cloud": "μέσω Dropbox",
      "btn.remove": "Αφαίρεση",
      "share.code": "Κωδικός",
      "share.keep": "Κράτα αυτή τη σελίδα ανοιχτή μέχρι να τελειώσει η μεταφορά. Ο σύνδεσμος ισχύει μία φορά, για ένα άτομο.",
      "btn.copy": "Αντιγραφή", "copied": "Ο σύνδεσμος αντιγράφηκε",
      "btn.cancel": "Ακύρωση", "btn.sendMore": "Αποστολή κάτι άλλου",
      "recv.intro": "Γράψε τον κωδικό που σου έδωσαν ή άνοιξε τον σύνδεσμο που πήρες.",
      "recv.code": "Κωδικός",
      "btn.receive": "Λήψη",
      "recv.badCode": "Αυτό δεν είναι κωδικός. Έχει 12 γράμματα και ψηφία, όπως 7K2M-9QXH-4RTB.",
      "dest.where": "Αποθήκευση σε",
      "dest.disk": "Τον δίσκο του orOS (φάκελος Transfers)",
      "dest.device": "Αυτή τη συσκευή",
      "dest.deviceZip": "Αυτή τη συσκευή, ως ένα αρχείο ZIP",
      "dest.tooBig": "Αρχεία πάνω από {s} πάνε μόνο στη συσκευή: ο δίσκος του orOS συγχρονίζει κάθε αρχείο ολόκληρο.",
      "dest.noDisk": "Άνοιξε τον σύνδεσμο μέσα στο orOS για να αποθηκεύσεις στον δίσκο του.",
      "space.low": "Αυτός ο browser έχει περίπου {s} ελεύθερα· η μεταφορά χρειάζεται {t}.",
      "btn.decline": "Απόρριψη", "btn.accept": "Αποδοχή",
      "btn.openFiles": "Άνοιγμα στα Αρχεία", "btn.save": "Αποθήκευση", "btn.recvMore": "Λήψη κάτι άλλου",
      "offer.sum": "{n} αρχεία · {s} από {dev}", "offer.sum1": "1 αρχείο · {s} από {dev}",
      "offer.more": "… και {n} ακόμα",
      "st.connecting": "Σύνδεση…",
      "st.wait.send": "Περιμένω τον άλλον να ανοίξει τον σύνδεσμο…",
      "st.wait.recv": "Ο αποστολέας δεν είναι εδώ ακόμα. Η σελίδα Μεταφορά του πρέπει να είναι ανοιχτή· αυτή η σελίδα περιμένει.",
      "st.linking": "Απευθείας σύνδεση με {dev}…",
      "st.offered": "Ο/Η {dev} κοιτάζει τη λίστα…",
      "st.offer": "Θέλεις αυτά τα αρχεία;",
      "st.sending": "Αποστολή…",
      "st.sendingRelay": "Αποστολή μέσω του αναμεταδότη orOS (χωρίς απευθείας σύνδεση, άρα πιο αργά)…",
      "st.receivingRelay": "Λήψη μέσω του αναμεταδότη orOS (χωρίς απευθείας σύνδεση, άρα πιο αργά)…",
      "st.reconnecting": "Η σύνδεση διακόπηκε. Επανασύνδεση· η μεταφορά συνεχίζει από εκεί που σταμάτησε…",
      "offer.relay": "Οι δύο συσκευές δεν συνδέθηκαν απευθείας: τα αρχεία έρχονται μέσω του αναμεταδότη orOS, πάντα κρυπτογραφημένα από άκρο σε άκρο, πιο αργά.",
      "st.receiving": "Λήψη…",
      "st.done.send": "Έγινε. Όλα τα αρχεία έφτασαν ακέραια.",
      "st.done.recv": "Έγινε. Όλα τα αρχεία έφτασαν ακέραια.",
      "st.done.disk": "Αποθηκεύτηκαν στο {f} του δίσκου orOS.",
      "st.done.file": "Έτοιμο. Πάτησε Αποθήκευση για να το κρατήσεις σε αυτή τη συσκευή.",
      "st.saved": "Αποθηκεύτηκε.",
      "st.someBad": "{n} αρχεία δεν έφτασαν ακέραια: {names}",
      "st.someBadZip": "{n} αρχεία μέσα στο ZIP δεν έφτασαν ακέραια: {names}. Ζήτα τα ξανά.",
      "prog": "{a} από {b}",
      "err.noroom": "Δεν βρέθηκε ο αποστολέας. Έλεγξε τον κωδικό, ή κάποιος άλλος τον παραλαμβάνει ήδη.",
      "err.left": "Η άλλη πλευρά έκλεισε τη σελίδα.",
      "err.nodirect": "Οι δύο συσκευές δεν μπόρεσαν να συνδεθούν απευθείας (αυστηρό δίκτυο, VPN ή firewall), και πάνω από 50 MB δεν περνούν από τον αναμεταδότη orOS. Δοκίμασε και τις δύο στο ίδιο Wi-Fi, σε άλλο δίκτυο, ή στείλε λιγότερα κάθε φορά.",
      "err.declined": "Η μεταφορά απορρίφθηκε.",
      "err.cancelled": "Η μεταφορά ακυρώθηκε.",
      "err.lost": "Η σύνδεση χάθηκε και δεν επανήλθε. Ξεκίνα τη μεταφορά από την αρχή.",
      "err.bad": "Έφτασε κάτι που δεν ανήκει σε αυτή τη μεταφορά. Σταμάτησε.",
      "err.version": "Η άλλη πλευρά έχει άλλη έκδοση της Μεταφοράς. Ανανέωσε και τις δύο σελίδες.",
      "err.nocrypto": "Αυτός ο browser δεν μπορεί να κρυπτογραφήσει (χρειάζεται ασφαλή σελίδα https).",
      "err.io": "Δεν ήταν δυνατό να διαβαστεί ή να γραφτεί ένα αρχείο (γέμισε ο χώρος;). Η μεταφορά σταμάτησε.",
      "err.mem": "Αυτός ο browser κρατά τις μεταφορές στη μνήμη, έως {s}. Χρησιμοποίησε άλλον browser γι' αυτήν.",
      "into.oros": "Λήψη στο orOS μου",
      "full": "Ο χώρος αποθήκευσης της συσκευής γέμισε."
    }
  };

  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent !== window && window.parent.orosLang) || "";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  // orosI18n (../i18n.js) knows pack languages (German); the receive page
  // outside orOS has no stored choice, so it follows the browser.
  var I18N = window.orosI18n || null;
  var LANG = I18N ? I18N.lang() : appLang();
  var NAV_LANG = false;
  if (PAGE === "receive" && LANG === "en") {
    var stored = null;
    try { stored = localStorage.getItem("oros-lang"); } catch (e) {}
    var nav = String(navigator.language || "").slice(0, 2).toLowerCase();
    if (!stored && !/[?&]lang=/.test(location.search) && (nav === "el" || (I18N && nav !== "en" && I18N.known(nav)))) { LANG = nav; NAV_LANG = true; }
  }
  function useTable() { if (I18N && LANG !== "en" && LANG !== "el") I18N.table(STR, APP_ID, LANG); }
  useTable();
  function locale() { return I18N ? I18N.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }
  function t(k, v) {
    var s = (STR[LANG] && STR[LANG][k]) || STR.en[k] || k;
    if (v) Object.keys(v).forEach(function (n) { s = s.split("{" + n + "}").join(String(v[n])); });
    return s;
  }
  function size(n) { return C.fmtSize(n, LANG === "en" ? "en" : "el"); }   // a decimal comma in Greek and German
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    document.title = t("app.name") + " · orOS";
  }

  // ---------- 2. Shell APIs (R8) ----------
  function shell() { try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; } }
  function FS() {
    if (PAGE !== "app") return null;
    try { var p = shell(); return (p && p.orosFS) || null; } catch (e) { return null; }
  }
  function dialogs() {
    try { var p = shell(); if (p && p.orosDialog) return p.orosDialog; } catch (e) {}
    return window.orosDialog || null;
  }

  // ---------- 3. Palette (G3) ----------
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--accent-ink", "--panel-bg", "--border", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      if (window.parent === window) return;
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
      if (window.parent === window) return;
      new MutationObserver(function () { inheritPalette(); paintArt(); }).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }

  // ---------- 4. Little helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function show(id, on) { var n = $(id); if (n) n.hidden = !on; }
  var toastTimer = 0;
  function toast(msg) {
    var box = $("toast");
    box.textContent = msg;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3000);
  }
  function setProg(id, a, b) {
    var p = $(id);
    if (!p) return;
    p.hidden = false;
    var pc = b > 0 ? Math.min(100, a / b * 100) : 100;
    var f = p.querySelector(".fill"), n = p.querySelector(".pct");
    if (f) f.style.strokeDashoffset = (100 - pc).toFixed(2);
    if (n) n.textContent = Math.floor(pc) + "%";
  }

  // ---------- 4b. The artwork (art.js, TRANSFER-ART) ----------
  // Before a code exists the page shows a picture of its own; once there
  // is a code both sides draw from it, so sender and receiver see the
  // same picture (a quick check that they reached each other).
  var A = window.orosTransferArt || null;
  var artSeed = Math.floor(Math.random() * 4294967296), artW = 0, artH = 0, artKey = "";
  function accentNow() {
    try { return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#d4af37"; } catch (e) { return "#d4af37"; }
  }
  function lightNow() {
    if (PAGE === "receive") { try { return window.matchMedia("(prefers-color-scheme: light)").matches; } catch (e) { return false; } }
    return document.documentElement.getAttribute("data-theme") === "light";
  }
  function paintArt(force) {
    var box = $("art");
    if (!A || !box) return;
    var w = window.innerWidth || 360, h = window.innerHeight || 640;
    var key = artSeed + "|" + accentNow() + "|" + lightNow();
    // phones change height while scrolling: only a real change redraws
    if (!force && key === artKey && Math.abs(w - artW) < 40 && Math.abs(h - artH) < 160 && box.firstChild) return;
    artW = w; artH = h; artKey = key;
    var art = A.draw(artSeed, { accent: accentNow(), w: w, h: h, light: lightNow() });
    box.textContent = "";
    box.appendChild(A.toNode(art, document, "bg"));
  }
  function artThumb(host) {
    if (!A || !host) return;
    host.textContent = "";
    host.appendChild(A.toNode(A.draw(artSeed, { accent: accentNow(), w: 560, h: 400, light: lightNow() }), document, "th"));
  }
  function seedArt(code, then) {
    if (!A || !window.crypto || !window.crypto.subtle) { if (then) then(); return; }
    A.seedFrom(code).then(function (sd) { artSeed = sd; paintArt(true); if (then) then(); }, function () { if (then) then(); });
  }
  var artTm = 0;
  window.addEventListener("resize", function () { clearTimeout(artTm); artTm = setTimeout(paintArt, 160); });
  function devName() { return C.browserLabel(navigator.userAgent); }
  function errText(e) { return t("err." + e) !== "err." + e ? t("err." + e) : t("err.bad"); }
  // Keep the screen awake while a transfer runs, where the browser allows it.
  var wake = null;
  function stayAwake(on) {
    try {
      if (on && !wake && navigator.wakeLock) navigator.wakeLock.request("screen").then(function (w) { wake = w; }, function () {});
      if (!on && wake) { wake.release(); wake = null; }
    } catch (e) {}
  }
  // A page closing mid-transfer asks first.
  var busy = false;
  window.addEventListener("beforeunload", function (e) { if (busy) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- 5. Send: pick from the disk ----------
  var ROOT = "/internal";
  var cwd = ROOT;
  var chosen = [];      // { key, kind: "disk"|"local", path?, dir?, file?, name }
  function isChosen(key) { return chosen.some(function (c) { return c.key === key; }); }
  function hiddenName(n) { return n.charAt(0) === "."; }

  function renderCrumbs() {
    var nav = $("crumbs");
    nav.textContent = "";
    var parts = cwd === ROOT ? [] : cwd.slice(ROOT.length + 1).split("/");
    var b = el("button", "crumb", t("disk.root"));
    b.type = "button";
    b.addEventListener("click", function () { go(ROOT); });
    nav.appendChild(b);
    parts.forEach(function (p, i) {
      nav.appendChild(el("span", "sep", "›"));
      var c = el("button", "crumb", p);
      c.type = "button";
      var to = ROOT + "/" + parts.slice(0, i + 1).join("/");
      c.addEventListener("click", function () { go(to); });
      nav.appendChild(c);
    });
  }
  function go(path) { cwd = path; renderDisk(); }
  function renderDisk() {
    var fs = FS(), list = $("disk");
    renderCrumbs();
    list.textContent = "";
    show("disk-empty", false);
    if (!fs) { show("open-disk", false); return; }
    var at = cwd;
    Promise.resolve(fs.ready && fs.ready()).then(function () { return fs.ls(at); }).then(function (entries) {
      if (at !== cwd) return;
      entries = (entries || []).filter(function (e) { return !hiddenName(e.name) && !(at === ROOT && e.name === "Drive"); });
      entries.sort(function (a, b) { return (b.dir - a.dir) || a.name.localeCompare(b.name); });
      list.textContent = "";
      show("disk-empty", !entries.length);
      entries.forEach(function (e) {
        var path = at + "/" + e.name, key = "d:" + path;
        var li = el("li", e.dir ? "dir" : "");
        var box = el("input");
        box.type = "checkbox";
        box.checked = isChosen(key);
        box.setAttribute("aria-label", t("disk.pick", { n: e.name }));
        box.addEventListener("change", function () {
          if (box.checked) chosen.push({ key: key, kind: "disk", path: path, dir: !!e.dir, name: e.name });
          else chosen = chosen.filter(function (c) { return c.key !== key; });
          renderChosen();
        });
        li.appendChild(box);
        if (e.dir) {
          var open = el("button", "name link", e.name);
          open.type = "button";
          open.setAttribute("aria-label", t("disk.open", { n: e.name }));
          open.addEventListener("click", function () { go(path); });
          li.appendChild(open);
        } else {
          var lab = el("span", "name", e.name);
          lab.addEventListener("click", function () { box.click(); });
          li.appendChild(lab);
        }
        list.appendChild(li);
      });
    }, function () { if (at === cwd) show("disk-empty", true); });
  }

  // Every file under the chosen items → [{ path (relative), size, mtime, get() → Blob }]
  function walk(fs, path, rel, out) {
    return fs.ls(path).then(function (entries) {
      var q = Promise.resolve();
      (entries || []).forEach(function (e) {
        if (hiddenName(e.name)) return;
        var p = path + "/" + e.name, r = rel + "/" + e.name;
        q = q.then(function () {
          if (e.dir) return walk(fs, p, r, out);
          return fs.stat(p).then(function (st) { out.push({ path: r, size: st.size || 0, mtime: st.mtime || 0, src: p }); }, function () {});
        });
      });
      return q;
    });
  }
  var expandSeq = 0, expanded = null;
  function expand() {
    var fs = FS(), out = [], q = Promise.resolve();
    chosen.forEach(function (c) {
      q = q.then(function () {
        if (c.kind === "local") { out.push({ path: c.name, size: c.file.size, mtime: c.file.lastModified || 0, file: c.file }); return null; }
        if (c.dir) return walk(fs, c.path, c.name, out);
        return fs.stat(c.path).then(function (st) { out.push({ path: c.name, size: st.size || 0, mtime: st.mtime || 0, src: c.path }); }, function () {});
      });
    });
    return q.then(function () { return out; });
  }
  function renderChosen() {
    var list = $("chosen");
    list.textContent = "";
    chosen.forEach(function (c) {
      var li = el("li", c.dir ? "dir" : "");
      li.appendChild(badge(c.name, c.dir));
      var nm = el("span", "name", c.name);
      if (c.kind === "disk" && c.path.lastIndexOf("/") > ROOT.length) nm.appendChild(el("small", "", c.path.slice(ROOT.length + 1, c.path.lastIndexOf("/"))));
      li.appendChild(nm);
      var rm = el("button", "x", "×");
      rm.type = "button";
      rm.setAttribute("aria-label", t("btn.remove") + " " + c.name);
      rm.addEventListener("click", function () {
        chosen = chosen.filter(function (x) { return x !== c; });
        renderChosen();
        renderDisk();
      });
      li.appendChild(rm);
      list.appendChild(li);
    });
    show("chosen-empty", !chosen.length);
    show("chosen-box", chosen.length > 0);
    $("drop").classList.toggle("compact", chosen.length > 0);
    $("make-link").disabled = !chosen.length;
    var mc = $("make-cloud");
    if (mc) { mc.hidden = !cloudApi() || !X; mc.disabled = true; }
    var seq = ++expandSeq;
    expanded = null;
    $("chosen-sum").textContent = chosen.length ? t("send.counting") : "";
    if (!chosen.length) return;
    expand().then(function (all) {
      if (seq !== expandSeq) return;
      expanded = all;
      var total = all.reduce(function (a, f) { return a + f.size; }, 0);
      $("chosen-sum").textContent = t(all.length === 1 ? "send.sum1" : "send.sum", { n: all.length, s: size(total) });
      $("make-link").disabled = !all.length;
      if ($("make-cloud")) $("make-cloud").disabled = !all.length;
    });
  }
  function addLocal() {
    var d = dialogs();
    if (!d || typeof d.openFiles !== "function") return;
    d.openFiles("").then(function (files) {
      addFiles(files);
    });
  }
  function addFiles(files) {
    [].forEach.call(files || [], function (f) {
      if (!f || typeof f.size !== "number") return;
      var key = "l:" + f.name + ":" + f.size + ":" + f.lastModified;
      if (!isChosen(key)) chosen.push({ key: key, kind: "local", file: f, name: f.name });
    });
    renderChosen();
  }
  // A small type badge: the extension, tinted by kind from the skin's accent; a folder sign for folders.
  var KIND = { jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, heic: 1, svg: 1, mp4: 2, mov: 2, webm: 2, mkv: 2, mp3: 3, wav: 3, flac: 3, ogg: 3, m4a: 3, pdf: 4, zip: 5, "7z": 5, rar: 5 };
  function badge(name, dir) {
    var dot = String(name).lastIndexOf("."), ext = !dir && dot > 0 ? String(name).slice(dot + 1).toLowerCase() : "";
    var b = el("span", "ic", dir ? "▤" : (ext.slice(0, 4).toUpperCase() || "•"));
    b.setAttribute("aria-hidden", "true");
    var k = dir ? 0 : (KIND[ext] || 6);
    if (k) b.style.filter = "hue-rotate(" + [0, -12, -28, 22, 40, 60, 10][k] + "deg) saturate(" + (k === 6 ? 0.4 : 1) + ")";
    return b;
  }
  // The orOS disk in a sheet (a centred <dialog>, R32)
  function openDisk() {
    var d = $("disk-sheet");
    if (!FS()) { addLocal(); return; }
    renderDisk();
    try { d.showModal(); } catch (e) { d.setAttribute("open", ""); }
  }
  function closeDisk() { var d = $("disk-sheet"); try { d.close(); } catch (e) { d.removeAttribute("open"); } }
  function metaNow() {
    var ti = $("meta-title"), ms = $("meta-msg");
    return C.cleanMeta({ t: ti ? ti.value : "", m: ms ? ms.value : "" });
  }

  // ---------- 6. Send: the transfer ----------
  var sender = null;
  function qrSvg(text) {
    var Q = window.orosQR;
    if (!Q || typeof Q.encode !== "function") return null;
    var mods;
    try { mods = Q.encode(text, { ecl: "M" }).modules; } catch (e) { return null; }
    var n = mods.length, q = 4, sz = n + q * 2, d = "";
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (mods[y][x]) d += "M" + (x + q) + " " + (y + q) + "h1v1h-1z";
    var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + sz + " " + sz);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR");
    var bg = document.createElementNS(ns, "rect");
    bg.setAttribute("width", sz); bg.setAttribute("height", sz); bg.setAttribute("fill", "#ffffff");
    var p = document.createElementNS(ns, "path");
    p.setAttribute("d", d); p.setAttribute("fill", "#000000");
    svg.appendChild(bg); svg.appendChild(p);
    return svg;
  }
  function startSend() {
    if (!expanded || !expanded.length) return;
    var fs = FS(), list = expanded.slice();
    var manifest = C.buildManifest(list);
    // buildManifest keeps the order and drops only empty paths
    var src = [];
    list.forEach(function (f) { if (C.cleanPath(f.path)) src.push(f); });
    var code = C.newCode(), link = C.linkFor(code, location.origin), meta = metaNow();
    $("share-code").textContent = C.fmtCode(code);
    shareNative(link, meta);
    seedArt(code, function () { artThumb($("share-match").querySelector(".th")); show("share-match", !!A); });
    $("share-link").value = link;
    var qr = $("share-qr");
    qr.textContent = "";
    var svg = qrSvg(link);
    if (svg) qr.appendChild(svg);
    show("pick", false); show("share", true);
    show("send-again", false); show("send-cancel", true); show("send-prog", false);
    cloudShare(false);
    $("send-detail").textContent = "";
    var blobs = {};
    function blobOf(i) {
      if (blobs[i]) return Promise.resolve(blobs[i]);
      var f = src[i];
      var p = f.file ? Promise.resolve(f.file) : fs.read(f.src);
      return p.then(function (b) { blobs = {}; blobs[i] = b; return b; });
    }
    var dev = "", started = false, how = "direct";
    function log(end, bad) { if (started) record({ dir: "sent", files: manifest, dev: dev, bad: bad, mode: how, end: end }); }
    sender = new E.Transfer({
      role: "sender", code: code, dev: devName(), files: manifest, meta: meta,
      read: function (i, a, b) {
        return blobOf(i).then(function (blob) { return blob.slice(a, b).arrayBuffer(); }).then(function (buf) { return new Uint8Array(buf); });
      },
      onState: function (p, info) {
        var st = $("send-status");
        st.className = "status";
        if (info.dev) dev = info.dev;
        if (p === "connecting") st.textContent = t("st.connecting");
        else if (p === "wait") st.textContent = t("st.wait.send");
        else if (p === "linking") st.textContent = t("st.linking", { dev: dev });
        else if (p === "offered") st.textContent = t("st.offered", { dev: dev });
        else if (p === "sending") {
          if (sender) how = sender.mode() || how;
          started = true;
          st.textContent = t(how === "relay" ? "st.sendingRelay" : "st.sending"); busy = true; stayAwake(true);
        }
        else if (p === "reconnecting") st.textContent = t("st.reconnecting");
        else if (p === "done") {
          busy = false; stayAwake(false);
          var bad = info.bad || [];
          st.textContent = bad.length ? t("st.someBad", { n: bad.length, names: bad.slice(0, 5).map(function (i) { return manifest[i].p; }).join(", ") }) : t("st.done.send");
          st.className = "status " + (bad.length ? "warn" : "ok");
          log("done", bad);
          end();
        } else if (p === "error") {
          busy = false; stayAwake(false);
          st.textContent = errText(info.e);
          st.className = "status warn";
          log("stopped", []);
          end();
        }
      },
      onProgress: function (pr) {
        setProg("send-prog", pr.bytes, pr.total);
        $("send-detail").textContent = t("prog", { a: size(pr.bytes), b: size(pr.total) });
      }
    }).start();
    function end() { show("send-cancel", false); show("send-again", true); sender = null; }
  }
  // The system share sheet, where the browser has one (phones mostly)
  function shareNative(url, meta) {
    var b = $("share-native");
    if (!b) return;
    var ok = !!(navigator.share && url);
    b.hidden = !ok;
    b.onclick = ok ? function () {
      navigator.share({ title: (meta && meta.t) || "orOS Transfer", url: url }).catch(function () {});
    } : null;
  }
  function cancelSend() { if (sender) sender.cancel(); if (cloudSend) cloudSend.stop = true; }

  // ---------- 6b. Send through my Dropbox (TRANSFER-1 wave 4) ----------
  function cloudApi() {
    try { var p = shell(), d = p && p.orosSync && p.orosSync.cloudDrop; return d && typeof d.available === "function" && d.available() ? d : null; }
    catch (e) { return null; }
  }
  var CLOUD_OK = "oros-transfer-cloud-ok";
  function cloudShare(on) {
    show("share-code-lab", !on); show("share-code", !on); show("cloud-del", false);
    $("share-keep").textContent = t("share.keep");
    if (on) { $("share-link").value = ""; $("share-qr").textContent = ""; $("share-code").textContent = ""; }
  }
  function hhmm(ms) {
    try { return new Date(ms).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return new Date(ms).toISOString().slice(11, 16); }
  }
  var cloudSend = null;                   // { stop, id, drop } while one runs or waits
  function startCloud() {
    var drop = cloudApi();
    if (!drop || !X || !expanded || !expanded.length || sender || cloudSend) return;
    var fs = FS(), list = expanded.slice(), manifest = C.buildManifest(list), src = [];
    list.forEach(function (f) { if (C.cleanPath(f.path)) src.push(f); });
    var code = C.newCode(), st = $("send-status"), job = { stop: false, id: "", drop: drop }, meta = metaNow();
    shareNative("", null); show("share-match", false);
    cloudSend = job;
    show("pick", false); show("share", true);
    show("send-again", false); show("send-cancel", true); show("send-prog", true);
    cloudShare(true);
    $("share-keep").textContent = "";
    $("send-detail").textContent = "";
    st.className = "status";
    busy = true; stayAwake(true);
    var blobs = {};
    function read(i, a, b) {
      var f = src[i];
      var p = blobs[i] ? Promise.resolve(blobs[i]) : (f.file ? Promise.resolve(f.file) : fs.read(f.src)).then(function (bl) { blobs = {}; blobs[i] = bl; return bl; });
      return p.then(function (bl) { return bl.slice(a, b).arrayBuffer(); }).then(function (buf) { return new Uint8Array(buf); });
    }
    var need = manifest.reduce(function (n, f) { return n + X.packLen(f.s); }, 0);
    var checked = false;
    try { checked = localStorage.getItem(CLOUD_OK) === "1"; } catch (e) {}
    st.textContent = t(checked ? "cloud.up" : "cloud.check");
    (checked ? Promise.resolve(true) : X.probe(drop, window.fetch.bind(window))).then(function (ok) {
      if (!ok) { var e = new Error("cloudcheck"); e.code = "cloudcheck"; throw e; }
      try { localStorage.setItem(CLOUD_OK, "1"); } catch (e2) {}
      st.textContent = t("cloud.up");
      return drop.space();
    }).then(function (sp) {
      if (sp && sp.allocated - sp.used < need) { var e = new Error("full"); e.code = "full"; throw e; }
      return X.send({
        code: code, files: manifest, meta: meta, read: read, drop: drop, temp: S.temp,
        cancelled: function () { return job.stop; },
        onProgress: function (pr) {
          setProg("send-prog", pr.bytes, pr.total);
          $("send-detail").textContent = t("prog", { a: size(pr.bytes), b: size(pr.total) });
        }
      });
    }).then(function (r) {
      job.id = r.id;
      var url = C.linkFor(code, location.origin).split("#")[0] + "#" + r.frag;
      $("share-link").value = url;
      shareNative(url, meta);
      seedArt(code, function () { artThumb($("share-match").querySelector(".th")); show("share-match", !!A); });
      var qr = $("share-qr"), svg = qrSvg(url);
      qr.textContent = "";
      if (svg) qr.appendChild(svg);
      st.textContent = t("cloud.ready", { t: hhmm(r.exp) });
      st.className = "status ok";
      $("share-keep").textContent = t("cloud.keep", { t: hhmm(r.exp) });
      show("send-cancel", false); show("cloud-del", true); show("send-again", true);
      busy = false; stayAwake(false);
      record({ dir: "sent", files: manifest, dev: "", mode: "cloud", end: "done" });
      cloudSend = null;
      setTimeout(function () { if (job.id && !job.gone) drop.remove(job.id).catch(function () {}); }, Math.max(0, r.exp - Date.now() + 10 * 60000));
      $("cloud-del").onclick = function () {
        drop.remove(job.id).then(function () {
          job.gone = true;
          st.textContent = t("cloud.deleted"); st.className = "status";
          $("share-link").value = ""; $("share-qr").textContent = ""; $("share-keep").textContent = "";
          shareNative("", null);
          show("cloud-del", false);
        }, function () { toast(t("err.dropbox")); });
      };
    }).catch(function (e) {
      busy = false; stayAwake(false);
      cloudSend = null;
      var c = e && e.code;
      st.textContent = c === "full" ? t("err.full", { s: size(need) }) : c === "cancelled" ? t("err.cancelled") : c === "cloudcheck" ? t("err.cloudcheck") : c === "io" ? t("err.io") : t("err.dropbox");
      st.className = "status warn";
      show("send-cancel", false); show("send-again", true); show("send-prog", false);
    });
  }
  // Leftovers in the person's Dropbox older than 4 hours (the app page only).
  function cloudSweep() {
    var drop = cloudApi();
    if (drop && X) X.sweep(drop);
  }
  function sendAgain() {
    chosen = []; expanded = null;
    if ($("meta-title")) { $("meta-title").value = ""; $("meta-msg").value = ""; }
    show("share-match", false); shareNative("", null);
    artSeed = Math.floor(Math.random() * 4294967296); paintArt(true);
    show("share", false); show("pick", true);
    renderChosen(); renderDisk();
  }

  // ---------- 7. Receive ----------
  var receiver = null, sink = null, result = null, offerInfo = null, recvHow = "direct", recvDest = "", recvDev = "";
  function recvStatus(text, cls) { var s = $("recv-status"); s.textContent = text; s.className = "status" + (cls ? " " + cls : ""); }
  function resetRecv() {
    show("offer", false); show("recv-prog", false); show("recv-bad", false);
    show("open-files", false); show("save-file", false); show("recv-again", false); show("recv-cancel", true);
    $("recv-detail").textContent = "";
    result = null;
  }
  function startRecv(code, link) {
    if (receiver) return;
    resetRecv();
    seedArt(code);
    showHead(null, "");
    show("code-form", false); show("recv-box", true);
    var dev = "";
    recvHow = "direct"; recvDest = ""; recvDev = "";
    var Engine = link && X ? X.Receiver : E.Transfer;
    if (link) dev = recvDev = "Dropbox";
    receiver = new Engine({
      role: "receiver", code: code, dev: devName(), link: link,
      onState: function (p, info) {
        if (info.dev) dev = recvDev = info.dev;
        if (p === "connecting") recvStatus(t("st.connecting"));
        else if (p === "wait") recvStatus(t("st.wait.recv"));
        else if (p === "linking") recvStatus(t("st.linking", { dev: dev }));
        else if (p === "offer") showOffer(info, dev);
        else if (p === "receiving") {
          if (receiver) recvHow = receiver.mode() || recvHow;
          recvStatus(t(recvHow === "relay" ? "st.receivingRelay" : "st.receiving")); busy = true; stayAwake(true);
          if (recvHow === "cloud") show("recv-cancel", true);
        }
        else if (p === "reconnecting") recvStatus(t("st.reconnecting"));
        else if (p === "done") finishRecv(info);
        else if (p === "error") {
          busy = false; stayAwake(false);
          recvStatus(errText(info.e), "warn");
          if (sink && offerInfo) record({ dir: "recv", files: offerInfo.files, dev: dev, mode: recvHow, dest: recvDest, end: "stopped" });
          if (sink) sink.drop();
          sink = null;
          endRecv();
        }
      },
      onProgress: function (pr) {
        setProg("recv-prog", pr.bytes, pr.total);
        $("recv-detail").textContent = t("prog", { a: size(pr.bytes), b: size(pr.total) });
      }
    }).start();
  }
  function endRecv() { receiver = null; show("recv-cancel", false); show("offer", false); show("recv-again", true); }
  // The card's head: the sender's title and message (plain text), else the sizes only
  function showHead(meta, sum) {
    var ti = $("offer-title"), ms = $("offer-msg"), av = $("offer-av");
    if (!ti) return;
    ti.textContent = meta && meta.t ? meta.t : ""; ti.hidden = !(meta && meta.t);
    ms.textContent = meta && meta.m ? meta.m : ""; ms.hidden = !(meta && meta.m);
    av.textContent = meta && meta.t ? initials(meta.t) : "";
    $("offer-sum").textContent = sum || "";
  }
  function initials(s) {
    var w = String(s).split(/\s+/).filter(function (x) { return /[\p{L}\p{N}]/u.test(x); });
    return w.slice(0, 2).map(function (x) { return Array.from(x.replace(/^[^\p{L}\p{N}]+/u, ""))[0] || ""; }).join("").toUpperCase();
  }
  function showOffer(o, dev) {
    offerInfo = o;
    recvStatus(t("st.offer"));
    show("offer", true);
    show("recv-cancel", false);           // Decline is the way out here
    showHead(o.meta, t(o.files.length === 1 ? "offer.sum1" : "offer.sum", { n: o.files.length, s: size(o.total), dev: dev || "?" }));
    show("offer-relay", o.mode === "relay" || o.mode === "cloud");
    $("offer-relay").textContent = o.mode === "cloud" ? t("offer.cloud", { t: hhmm(o.exp) }) : t("offer.relay");
    var list = $("offer-list");
    list.textContent = "";
    o.files.slice(0, SHOW_MAX).forEach(function (f) {
      var li = el("li");
      li.appendChild(badge(f.p, false));
      li.appendChild(el("span", "name", f.p));
      li.appendChild(el("span", "dim", size(f.s)));
      list.appendChild(li);
    });
    if (o.files.length > SHOW_MAX) list.appendChild(el("li", "dim", t("offer.more", { n: o.files.length - SHOW_MAX })));
    var disk = $("dest-disk"), dev2 = $("dest-dev"), why = $("dest-disk-why");
    disk.closest(".opt").hidden = PAGE === "receive";        // outside orOS there is no disk: one clear choice
    var diskOk = !!FS() && o.biggest <= C.DISK_MAX;
    disk.disabled = !diskOk;
    why.hidden = diskOk || PAGE === "receive";
    why.textContent = !FS() ? t("dest.noDisk") : t("dest.tooBig", { s: size(C.DISK_MAX) });
    $("dest-dev-txt").textContent = o.files.length > 1 ? t("dest.deviceZip") : t("dest.device");
    (diskOk ? disk : dev2).checked = true;
    checkSpace();
  }
  function destValue() { return $("dest-disk").checked ? "disk" : "device"; }
  function checkSpace() {
    var o = offerInfo, warn = $("space-warn"), acc = $("accept");
    if (!o) return;
    acc.disabled = false;
    warn.hidden = true;
    if (!S.canScratch() && o.total > C.MEM_MAX) {
      warn.textContent = t("err.mem", { s: size(C.MEM_MAX) });
      warn.hidden = false; acc.disabled = true;
      return;
    }
    // disk: the scratch copy and the disk copy of one file exist at once
    var need = o.total + (destValue() === "disk" ? o.biggest : 0);
    S.freeBytes().then(function (free) {
      if (free === null || free >= need || offerInfo !== o) return;
      warn.textContent = t("space.low", { s: size(free), t: size(need) });
      warn.hidden = false;
      acc.disabled = true;
    });
  }
  function accept() {
    if (!receiver || !offerInfo) return;
    var dest = destValue();
    recvDest = dest;
    sink = S.sink({ dest: dest, files: offerInfo.files, fs: FS(), zipName: "orOS Transfer " + new Date().toISOString().slice(0, 10) + ".zip" });
    show("offer", false);
    show("recv-cancel", true);
    receiver.accept(sink);
  }
  function finishRecv(info) {
    var bad = info.bad || [], files = offerInfo ? offerInfo.files : [];
    var s = sink;
    if (!s) { endRecv(); return; }
    s.finish().then(function (r) {
      busy = false; stayAwake(false);
      result = r;
      record({ dir: "recv", files: files, dev: recvDev, bad: bad, mode: recvHow, dest: r.kind === "disk" ? "disk" : "device", folder: r.kind === "disk" ? r.folder : "", end: "done" });
      var badNames = bad.slice(0, 5).map(function (i) { return files[i] ? files[i].p : "?"; }).join(", ");
      if (bad.length) {
        $("recv-bad").textContent = t(r.kind === "file" && files.length > 1 ? "st.someBadZip" : "st.someBad", { n: bad.length, names: badNames });
        show("recv-bad", true);
      }
      if (r.kind === "disk") {
        recvStatus(t("st.done.disk", { f: r.folder.slice(ROOT.length + 1) }), "ok");
        show("open-files", true);
        s.drop();
        sink = null;
      } else if (r.file && !(files.length === 1 && bad.length)) {
        recvStatus(t("st.done.file"), "ok");
        show("save-file", true);
      } else {
        recvStatus(t("st.someBad", { n: bad.length, names: badNames }), "warn");
        s.drop(); sink = null;
      }
      endRecv();
      show("recv-cancel", false);
    }, function () {
      busy = false; stayAwake(false);
      recvStatus(t("err.io"), "warn");
      s.drop(); sink = null;
      endRecv();
    });
  }
  function saveResult() {
    var d = dialogs();
    if (!result || !result.file || !d) return;
    d.saveFile({ blob: result.file, filename: result.name, mime: result.file.type || "application/octet-stream" }).then(function (r) {
      if (!r || !r.ok) return;
      recvStatus(t("st.saved"), "ok");
      show("save-file", false);
      // a download may still be reading the file: drop the scratch copy later
      var s = sink; sink = null;
      setTimeout(function () { if (s) s.drop(); }, 120000);
    });
  }
  function openInFiles() {
    try {
      var p = shell();
      if (p && result && result.folder && typeof p.__orosOpenAt === "function") p.__orosOpenAt("files", { path: result.folder, dir: true });
    } catch (e) {}
  }
  function recvAgain() {
    if (sink) { sink.drop(); sink = null; }
    resetRecv();
    showHead(null, "");
    show("recv-box", false); show("code-form", true);
    $("code-in").value = "";
    if (PAGE === "receive") try { history.replaceState(null, "", location.pathname); } catch (e) {}
  }

  // ---------- 7b. History (synced slice "transfer") ----------
  // Only the orOS app keeps one; the receive page outside orOS does not.
  var hist = { ver: 1, items: [], tombs: {} };
  function syncApi() {
    try { return (window.parent && window.parent !== window && window.parent.orosSync) || null; } catch (e) { return null; }
  }
  var suppress = false;
  function loadHist() {
    try { hist = C.mergeHistory(JSON.parse(localStorage.getItem(C.HIST_KEY) || "null"), null); } catch (e) { hist = C.mergeHistory(null, null); }
  }
  function saveHist() {
    try { localStorage.setItem(C.HIST_KEY, JSON.stringify(hist)); } catch (e) { return; }
    var api = syncApi();
    if (!suppress && api && typeof api.markDirty === "function") try { api.markDirty(); } catch (e) {}
  }
  function record(o) {
    if (PAGE !== "app") return;
    var item = C.historyItem(o);
    if (!item) return;
    hist = C.mergeHistory(hist, { items: [item] });
    saveHist();
    renderHist();
    var root = shell();
    if (root && o.end === "done" && document.hidden) {
      try { if (root.orosNotifs && typeof root.orosNotifs.transient === "function") root.orosNotifs.transient({ ns: APP_ID, title: t(o.dir === "recv" ? "note.recv" : "note.sent", { what: item.what }) }); } catch (e) {}
    }
  }
  function sliceGet() { return C.mergeHistory(hist, hist); }      // canonical (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.items)) return;
    var before = JSON.stringify(hist);
    suppress = true;                                             // R6: a pull never marks dirty
    try { hist = C.mergeHistory(incoming, incoming); saveHist(); } finally { suppress = false; }
    if (JSON.stringify(hist) !== before) renderHist();
  }
  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    try { api.registerSlice(APP_ID, sliceGet, sliceSet, C.HIST_KEY, C.mergeHistory); } catch (e) {}
  }
  function when(ms) {
    try { return new Date(ms).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return new Date(ms).toISOString().slice(0, 16).replace("T", " "); }
  }
  function renderHist() {
    var list = $("hist-list");
    if (!list) return;
    list.textContent = "";
    hist.items.forEach(function (x) {
      var li = el("li");
      li.appendChild(el("span", "arrow", x.dir === "recv" ? "↓" : "↑"));
      var body = el("div", "body");
      body.appendChild(el("span", "what", x.what || "—"));
      var parts = [when(x.at), t(x.dir === "recv" ? "hist.recv" : "hist.sent", { dev: x.dev || t("hist.someone") }),
        x.n === 1 ? t("hist.one", { s: size(x.bytes) }) : t("hist.sum", { n: x.n, s: size(x.bytes) })];
      if (x.mode === "relay") parts.push(t("hist.relay"));
      else if (x.mode === "cloud") parts.push(t("hist.cloud"));
      if (x.dir === "recv" && x.dest) parts.push(t(x.dest === "disk" ? "hist.disk" : "hist.device"));
      body.appendChild(el("span", "meta", parts.join(" · ")));
      if (x.end === "stopped") body.appendChild(el("span", "meta warn", t("hist.stopped")));
      else if (x.bad) body.appendChild(el("span", "meta warn", t("hist.bad", { n: x.bad })));
      li.appendChild(body);
      if (x.folder && FS()) {
        var b = el("button", "chip small", t("hist.open"));
        b.type = "button";
        b.addEventListener("click", function () {
          try { var p = shell(); if (p && typeof p.__orosOpenAt === "function") p.__orosOpenAt("files", { path: x.folder, dir: true }); } catch (e) {}
        });
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    show("hist-empty", !hist.items.length);
    show("hist-clear", hist.items.length > 0);
  }
  var clearArmed = 0;
  function clearHist() {
    var b = $("hist-clear");
    if (!clearArmed) {
      b.textContent = t("hist.sure");
      clearArmed = setTimeout(function () { clearArmed = 0; b.textContent = t("hist.clear"); }, 4000);
      return;
    }
    clearTimeout(clearArmed); clearArmed = 0;
    b.textContent = t("hist.clear");
    var now = Date.now(), tombs = {};
    hist.items.forEach(function (x) { tombs[x.id] = now; });
    hist = C.mergeHistory(hist, { tombs: tombs });
    saveHist();
    renderHist();
  }

  // ---------- 8. Tabs, wiring, deep links ----------
  function tab(which) {
    ["send", "recv", "hist"].forEach(function (k) {
      var b = $("tab-" + k), on = k === which;
      if (!b) return;
      b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on));
      show(k, on);
    });
  }
  function codeFromHash(h) {
    if (/^#d=/.test(String(h || ""))) return "";
    var m = /^#(?:r=)?(.+)$/.exec(String(h || ""));
    return m ? C.normCode(decodeURIComponent(m[1])) : "";
  }
  // "#d=CODE.LINK" (through Dropbox) → { code, link }; "#CODE" / "#r=CODE" → { code }
  function hashTarget(h) {
    var c = X && X.parseFragment(h);
    if (c) return c;
    var code = codeFromHash(h);
    return code ? { code: code } : null;
  }
  function wire() {
    if ($("tab-send")) {
      $("tab-send").addEventListener("click", function () { tab("send"); });
      $("tab-recv").addEventListener("click", function () { tab("recv"); });
      $("tab-hist").addEventListener("click", function () { tab("hist"); });
      $("hist-clear").addEventListener("click", clearHist);
      $("add-local").addEventListener("click", addLocal);
      $("add-big").addEventListener("click", function () { if (FS()) openDisk(); else addLocal(); });
      $("open-disk").addEventListener("click", openDisk);
      $("disk-done").addEventListener("click", closeDisk);
      var dz = $("drop");
      ["dragenter", "dragover"].forEach(function (k) {
        document.addEventListener(k, function (ev) {
          if (!ev.dataTransfer || [].indexOf.call(ev.dataTransfer.types || [], "Files") < 0 || $("pick").hidden) return;
          ev.preventDefault(); dz.classList.add("over");
        });
      });
      ["dragleave", "drop"].forEach(function (k) {
        document.addEventListener(k, function (ev) {
          if (k === "dragleave" && ev.relatedTarget) return;
          dz.classList.remove("over");
          if (k === "drop" && ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length && !$("pick").hidden) { ev.preventDefault(); addFiles(ev.dataTransfer.files); }
        });
      });
      $("make-link").addEventListener("click", startSend);
      $("make-cloud").addEventListener("click", startCloud);
      $("send-cancel").addEventListener("click", cancelSend);
      $("send-again").addEventListener("click", sendAgain);
      $("copy-link").addEventListener("click", function () {
        var v = $("share-link").value;
        try { navigator.clipboard.writeText(v).then(function () { toast(t("copied")); }, function () { $("share-link").select(); }); }
        catch (e) { $("share-link").select(); }
      });
    }
    $("code-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var c = C.normCode($("code-in").value);
      if (!c) { toast(t("recv.badCode")); return; }
      startRecv(c);
    });
    [].forEach.call(document.querySelectorAll('input[name="dest"]'), function (r) { r.addEventListener("change", checkSpace); });
    $("accept").addEventListener("click", accept);
    $("decline").addEventListener("click", function () { if (receiver) receiver.decline(); });
    $("recv-cancel").addEventListener("click", function () { if (receiver) receiver.cancel(); else recvAgain(); });
    $("save-file").addEventListener("click", saveResult);
    $("open-files").addEventListener("click", openInFiles);
    $("recv-again").addEventListener("click", recvAgain);
    var into = $("into-oros");
    if (into) {
      var known = false;
      try { known = localStorage.getItem("oros-lang") !== null; } catch (e) {}
      into.hidden = true;
      into.textContent = t("into.oros");
      into.addEventListener("click", function (ev) {
        ev.preventDefault();
        var ht = hashTarget(location.hash), c = (ht && ht.code) || C.normCode($("code-in").value);
        if (receiver) receiver.cancel();
        location.href = "../?open=transfer&app-at=" + encodeURIComponent(ht && ht.link ? location.hash : "#r=" + (c ? C.fmtCode(c) : ""));
      });
      into.dataset.known = known ? "1" : "";
    }
  }
  // Files hands over disk paths to send: { send: ["/internal/…", …] }
  function takeSend(paths) {
    var fs = FS();
    if (!fs || !$("disk") || sender) return;
    tab("send");
    if (!$("share").hidden) { chosen = []; expanded = null; show("share", false); show("pick", true); }   // a finished send: start a new list
    var q = Promise.resolve(fs.ready && fs.ready()).catch(function () {});
    paths.slice(0, 500).forEach(function (p) {
      p = String(p || "").replace(/\/+$/, "");
      if (p.indexOf(ROOT + "/") !== 0 || /(^|\/)\.\.?(\/|$)/.test(p.slice(ROOT.length + 1))) return;
      var key = "d:" + p;
      if (isChosen(key)) return;
      q = q.then(function () { return fs.stat(p); }).then(function (st) {
        if (st && !isChosen(key)) chosen.push({ key: key, kind: "disk", path: p, dir: !!st.dir, name: p.slice(p.lastIndexOf("/") + 1) });
      }, function () {});
    });
    q.then(function () {
      var first = chosen.length ? chosen[chosen.length - 1].path : "";
      if (first) cwd = first.slice(0, first.lastIndexOf("/")) || ROOT;
      renderChosen(); renderDisk();
    });
  }
  // A link or another app hands over a code: { receive: code }
  window.__orosOpenAt = function (target) {
    if (target && Array.isArray(target.send)) { takeSend(target.send); return; }
    var c = target && typeof target.receive === "string" ? C.normCode(target.receive) : "";
    var link = target && X && X.okLink(target.link) ? target.link : "";
    if (!c) return;
    if ($("tab-recv")) tab("recv");
    $("code-in").value = link ? "" : C.fmtCode(c);
    startRecv(c, link);
  };
  function takePending() {
    var ht = hashTarget(location.hash);
    if (ht) {
      if ($("tab-recv")) tab("recv");
      $("code-in").value = ht.link ? "" : C.fmtCode(ht.code);
      var into = $("into-oros");
      if (into && into.dataset.known) into.hidden = false;
      startRecv(ht.code, ht.link);
      return;
    }
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget(APP_ID);
        if (pending) window.__orosOpenAt(pending);
      }
    } catch (e) { /* standalone */ }
  }

  // ---------- 9. Boot ----------
  function boot() {
    if (NAV_LANG && I18N && LANG !== "el") I18N.ensure(LANG, APP_ID, function () { useTable(); applyI18n(); });
    applyI18n();
    wire();
    inheritPalette();
    watchPalette();
    paintArt(true);
    if ($("disk")) { renderDisk(); renderChosen(); loadHist(); renderHist(); registerSync(); }
    S.sweep();
    if (PAGE === "app") setTimeout(cloudSweep, 3000);
    takePending();
    window.addEventListener("hashchange", function () {
      var ht = hashTarget(location.hash);
      if (ht && !receiver) { $("code-in").value = ht.link ? "" : C.fmtCode(ht.code); startRecv(ht.code, ht.link); }
    });
  }
  boot();
})();
