// ============================================================
// orOS Budget — live bank connection, dialogs and calls
// (budget/banklive.js, wave BK-2, over budget/bankapi.js)
// More › Banks: the person's own Enable Banking application (its id
// and private-key file, kept by the shell's Connected services,
// links/host.js: sealed on the device, every call signed there), the
// bank accounts they connected, which Budget account each one fills,
// consent days left, Renew, Remove, Update now.
// Connecting: Budget asks Enable Banking for a consent page of the
// chosen bank and opens it in a new window; the bank sends the person
// back to budget/bankback.html, which hands the answer over (same
// origin: BroadcastChannel + one localStorage record) and closes.
// Updating: every connected account's booked transactions since a
// week before the last day seen go through bank.js plan() (ids,
// rules, duplicates, deleted-here-earlier) and only the new ones are
// added, in one write with Undo. Automatic when Budget opens, at
// most every 6 hours per device (Chris 2026-11-01 20:44), or at the
// times set in Banks › Automatic updates (BK-AT, Chris 2026-11-12):
// the shell then runs Budget in a hidden frame (?bankbg=1) at each
// time while orOS is open, and a time missed runs on the next open.
// Read-only: orOS never asks a bank for payments. Nothing from the
// bank is run or inserted as HTML.
// ============================================================
(function (root) {
  "use strict";
  var K = root.OrosBudgetBankApi, B = root.OrosBudgetBank;
  var A = null;
  var PEND_KEY = "oros-budget-bank-pend";     // device: the consent request waiting for the bank's answer
  var CB_KEY = "oros-budget-bankcb";          // device: the bank's answer (bankback.html writes, Budget reads + deletes)
  var DEV_KEY = "oros-budget-bank-dev";       // device: { t: last refresh }
  var CHANNEL = "oros-budget-bank";
  var PEND_MS = 30 * 60000;
  var busy = false, connecting = false, lastErr = {}, keysHere = null;
  var keyMap = {};                            // Enable Banking account id → its key is on this device

  var S = {
    en: {
      webOnly: "This orOS isn't opened at useoros.online, so banks and PayPal can't be reached from here yet. Open useoros.online in a browser to connect and update; entries reach this device through sync.",
      localOnly: "Your banks and PayPal update here too. Connecting a bank or renewing its access works only in orOS opened at useoros.online in a browser, because the bank sends you back there; the accounts then reach this device through sync.",
      localConnect: "Connect or renew a bank at useoros.online in a browser: the bank sends you back there.",
      bankBal: "Bank balance {a} ({d})", cardBal: "Debt {a} · available {v} ({d})", availBal: "Available {v} ({d})", availShort: "available {v}",
      cardNoLimit: "Type the card's credit limit below to see the debt.", cardLimit: "Credit limit", isCard: "This is a credit card", limitBad: "Type the limit as an amount, e.g. 2000.", balSame: "same in Budget", balBudget: "Budget {a}", balMatch: "Match",
      balMatchHint: "Writes a balance correction on that day so that Budget shows the bank's balance (not income or an expense)",
      balMatched: "Starting balance changed by {a}",
      lvTitle: "Banks", lvIntro: "Your bank accounts can fill Budget by themselves, through Enable Banking (open banking), and so can PayPal Business. orOS only reads them and never makes payments. When a call goes through the orOS relay (always for PayPal), the data passes through it but is never stored or logged.",
      lvNoShell: "Open Budget inside orOS to connect a bank.",
      appT: "Your Enable Banking application", appNone: "Once: create a free account at enablebanking.com, register a Production application with this redirect URL, keep the .pem key file it downloads, and press “Activate by linking accounts” with your own accounts (not “Request activation”).",
      appLink: "Open Enable Banking", appId: "Application ID", appId_ph: "e.g. 1a2b3c4d-…", keyFile: "Private key (.pem)", keyPick: "Choose the .pem file",
      keyPicked: "Key file read ({n} characters)", keyBad: "This isn't a private key file (.pem).", idBad: "The application ID looks like 8-4-4-4-12 letters and digits.",
      appSave: "Save", appOk: "Enable Banking answers: application “{n}”.", keyHere: "Key on this device", keyNot: "No key on this device: choose the .pem file here, or turn on “Use on all my devices” in Settings › Connected services on the device that has it.",
      keyAdd: "Add the key file here", appSettings: "Settings › Connected services", redirect: "Redirect URL",
      accsT: "Connected accounts", accsNone: "No bank account connected yet.", fills: "Fills", upd: "Last booked day: {d}", updNever: "Not updated yet",
      left: "Access for {n} more days", leftSoon: "Access ends in {n} days: renew it", ended: "Access ended: renew it", renew: "Renew", remove: "Remove",
      removeQ: "Remove {n}? Entries already in Budget stay.", removed: "Bank account removed",
      connT: "Connect a bank", country: "Country", find: "Find banks", bank: "Bank", psu: "Account type", personal: "Personal", business: "Business",
      goBank: "Go to the bank", wait: "Waiting for the bank… Finish in the window that opened, then come back here.",
      popup: "The bank's page didn't open (blocked window). Allow pop-ups for orOS and try again.",
      mapT: "Which Budget account does each one fill?", mapHint: "New bookings of each bank account come into the Budget account you pick (or none).", mapDone: "Done",
      now: "Update now", updating: "Updating…", got: "{n} new entries from your banks", gotNone: "Your banks have nothing new",
      bar: "Bank access ends soon: {b}", barEnded: "Bank access ended: {b}", barGo: "Banks",
      err_auth: "Enable Banking refused the key: check the application ID and the .pem file.", err_offline: "You are offline.",
      err_busy: "The bank asks to wait a little (too many requests).", err_keys: "Needs the key of your Enable Banking application on this device: see above.",
      err_noapp: "This device doesn't have your Enable Banking application yet: add it above (application ID and .pem file), or wait for sync to bring it.",
      err_gone: "The Enable Banking application this bank was connected with isn't on this device any more: press Renew.",
      ksT: "Use on all my devices", ksHint: "Your phone and your other devices get this key through sync, sealed with your sync passphrase. Then banks update there too.",
      ksNeed: "Connect sync with a passphrase first (Settings › Sync).", ksWait: "“Use on all my devices” is on: the key arrives with sync from the device that has it. It needs the same sync passphrase there and here.",
      err_consent: "The bank no longer gives access: renew it.", err_state: "That answer doesn't belong to a request from this device.",
      err_cancel: "The bank connection was cancelled.", err_other: "The bank or Enable Banking didn't answer. Try again later.",
      err_server: "Enable Banking or the bank refused the request.", err_notfound: "Enable Banking or the bank refused the request.",
      err_noacc: "The bank gave access to no account. In Enable Banking's control panel, link this bank's accounts (same Personal or Business) to your application first.",
      ppT: "PayPal Business", ppNone: "Connect PayPal Business in Settings › Connected services first (Client ID and Secret of your own PayPal app). Then add it here.",
      ppAll: "Your PayPal accounts are connected above.", ppAdd: "Add",
      atT: "Automatic updates", atMode: "Update by itself", atSix: "When I open Budget, every 6 hours", atSet: "At times I set",
      atSixHint: "Budget updates when you open it, or come back to it, and the last update is 6 hours old or more.",
      atHint: "While orOS is open, in any app, your banks update at these times by themselves, on this device or another of yours (one is enough). A time missed while orOS was closed runs the next time you open it. A phone pauses a browser in the background, so there it comes when you return. Banks allow about 4 automatic reads a day, so up to 4 times. You get a notification only when an update fails.",
      atOne: "Time {n}", atAdd: "Add a time", atRemove: "Remove {v}",
      close: "Close", cancel: "Cancel"
    },
    el: {
      webOnly: "Αυτό το orOS δεν είναι ανοιγμένο στο useoros.online, οπότε οι τράπεζες και το PayPal δεν είναι ακόμα προσβάσιμα από εδώ. Άνοιξε το useoros.online σε browser για σύνδεση και ενημέρωση· οι κινήσεις φτάνουν σε αυτή τη συσκευή μέσω συγχρονισμού.",
      localOnly: "Οι τράπεζες και το PayPal ενημερώνονται και εδώ. Η σύνδεση τράπεζας ή η ανανέωση της πρόσβασης γίνεται μόνο στο orOS που ανοίγεις στο useoros.online μέσα σε browser, γιατί η τράπεζα σε επιστρέφει εκεί· οι λογαριασμοί φτάνουν μετά σε αυτή τη συσκευή μέσω συγχρονισμού.",
      localConnect: "Σύνδεση ή ανανέωση τράπεζας γίνεται στο useoros.online μέσα σε browser: η τράπεζα σε επιστρέφει εκεί.",
      bankBal: "Υπόλοιπο τράπεζας {a} ({d})", cardBal: "Χρέος {a} · διαθέσιμο {v} ({d})", availBal: "Διαθέσιμο {v} ({d})", availShort: "διαθέσιμο {v}",
      cardNoLimit: "Γράψε από κάτω το πιστωτικό όριο της κάρτας για να φανεί το χρέος.", cardLimit: "Πιστωτικό όριο", isCard: "Είναι πιστωτική κάρτα", limitBad: "Γράψε το όριο ως ποσό, π.χ. 2000.", balSame: "ίδιο στο Budget", balBudget: "Budget {a}", balMatch: "Ταίριαξε",
      balMatchHint: "Γράφει διόρθωση υπολοίπου εκείνη τη μέρα ώστε το Budget να δείχνει το υπόλοιπο της τράπεζας (όχι έσοδο ή έξοδο)",
      balMatched: "Το αρχικό υπόλοιπο άλλαξε κατά {a}",
      lvTitle: "Τράπεζες", lvIntro: "Οι τραπεζικοί σου λογαριασμοί μπορούν να γεμίζουν μόνοι τους την εφαρμογή, μέσω του Enable Banking (open banking), και το ίδιο το PayPal Business. Το orOS μόνο τους διαβάζει και δεν κάνει ποτέ πληρωμές. Όταν μια κλήση περνά από το relay του orOS (πάντα για το PayPal), τα δεδομένα περνούν αλλά δεν αποθηκεύονται ούτε καταγράφονται ποτέ.",
      lvNoShell: "Άνοιξε την εφαρμογή μέσα στο orOS για να συνδέσεις τράπεζα.",
      appT: "Η εφαρμογή σου στο Enable Banking", appNone: "Μία φορά: φτιάξε δωρεάν λογαριασμό στο enablebanking.com, δήλωσε μια εφαρμογή Production με αυτό το Redirect URL, κράτα το αρχείο κλειδιού .pem που κατεβαίνει και πάτα «Activate by linking accounts» με τους δικούς σου λογαριασμούς (όχι «Request activation»).",
      appLink: "Άνοιγμα Enable Banking", appId: "Application ID", appId_ph: "π.χ. 1a2b3c4d-…", keyFile: "Ιδιωτικό κλειδί (.pem)", keyPick: "Διάλεξε το αρχείο .pem",
      keyPicked: "Το αρχείο κλειδιού διαβάστηκε ({n} χαρακτήρες)", keyBad: "Αυτό δεν είναι αρχείο ιδιωτικού κλειδιού (.pem).", idBad: "Το Application ID έχει τη μορφή 8-4-4-4-12 γράμματα και ψηφία.",
      appSave: "Αποθήκευση", appOk: "Το Enable Banking απαντά: εφαρμογή «{n}».", keyHere: "Το κλειδί είναι σε αυτή τη συσκευή", keyNot: "Δεν υπάρχει κλειδί σε αυτή τη συσκευή: διάλεξε εδώ το αρχείο .pem ή άνοιξε το «Χρήση σε όλες τις συσκευές μου» στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες, στη συσκευή που το έχει.",
      keyAdd: "Πρόσθεσε εδώ το αρχείο κλειδιού", appSettings: "Ρυθμίσεις › Συνδεδεμένες υπηρεσίες", redirect: "Redirect URL",
      accsT: "Συνδεδεμένοι λογαριασμοί", accsNone: "Δεν έχει συνδεθεί ακόμα τραπεζικός λογαριασμός.", fills: "Γεμίζει", upd: "Τελευταία λογιστική ημέρα: {d}", updNever: "Δεν έχει ενημερωθεί ακόμα",
      left: "Πρόσβαση για {n} ακόμα ημέρες", leftSoon: "Η πρόσβαση λήγει σε {n} ημέρες: ανανέωσέ τη", ended: "Η πρόσβαση έληξε: ανανέωσέ τη", renew: "Ανανέωση", remove: "Αφαίρεση",
      removeQ: "Αφαίρεση του {n}; Οι κινήσεις που είναι ήδη στην εφαρμογή μένουν.", removed: "Ο τραπεζικός λογαριασμός αφαιρέθηκε",
      connT: "Σύνδεση τράπεζας", country: "Χώρα", find: "Βρες τράπεζες", bank: "Τράπεζα", psu: "Είδος λογαριασμού", personal: "Προσωπικός", business: "Επαγγελματικός",
      goBank: "Μετάβαση στην τράπεζα", wait: "Αναμονή για την τράπεζα… Ολοκλήρωσε στο παράθυρο που άνοιξε και γύρνα εδώ.",
      popup: "Η σελίδα της τράπεζας δεν άνοιξε (μπλοκαρισμένο παράθυρο). Επίτρεψε τα αναδυόμενα για το orOS και δοκίμασε ξανά.",
      mapT: "Ποιον λογαριασμό της εφαρμογής γεμίζει ο καθένας;", mapHint: "Οι νέες κινήσεις κάθε τραπεζικού λογαριασμού μπαίνουν στον λογαριασμό που διαλέγεις (ή σε κανέναν).", mapDone: "Έτοιμο",
      now: "Ενημέρωση τώρα", updating: "Ενημέρωση…", got: "{n} νέες κινήσεις από τις τράπεζές σου", gotNone: "Δεν υπάρχει κάτι νέο από τις τράπεζές σου",
      bar: "Η πρόσβαση στην τράπεζα λήγει σύντομα: {b}", barEnded: "Η πρόσβαση στην τράπεζα έληξε: {b}", barGo: "Τράπεζες",
      err_auth: "Το Enable Banking δεν δέχτηκε το κλειδί: έλεγξε το Application ID και το αρχείο .pem.", err_offline: "Είσαι εκτός σύνδεσης.",
      err_busy: "Η τράπεζα ζητά λίγη αναμονή (πολλά αιτήματα).", err_keys: "Χρειάζεται σε αυτή τη συσκευή το κλειδί της εφαρμογής σου στο Enable Banking: δες παραπάνω.",
      err_noapp: "Αυτή η συσκευή δεν έχει ακόμα την εφαρμογή σου στο Enable Banking: πρόσθεσέ τη παραπάνω (Application ID και αρχείο .pem) ή περίμενε να τη φέρει ο συγχρονισμός.",
      err_gone: "Η εφαρμογή του Enable Banking με την οποία συνδέθηκε αυτή η τράπεζα δεν υπάρχει πια σε αυτή τη συσκευή: πάτα Ανανέωση.",
      ksT: "Χρήση σε όλες τις συσκευές μου", ksHint: "Το κινητό και οι άλλες συσκευές σου παίρνουν αυτό το κλειδί μέσω συγχρονισμού, σφραγισμένο με τη φράση πρόσβασης του συγχρονισμού. Έτσι οι τράπεζες ενημερώνονται κι εκεί.",
      ksNeed: "Σύνδεσε πρώτα τον συγχρονισμό με φράση πρόσβασης (Ρυθμίσεις › Συγχρονισμός).", ksWait: "Το «Χρήση σε όλες τις συσκευές μου» είναι ανοιχτό: το κλειδί έρχεται με τον συγχρονισμό από τη συσκευή που το έχει. Χρειάζεται την ίδια φράση πρόσβασης συγχρονισμού εκεί και εδώ.",
      err_consent: "Η τράπεζα δεν δίνει πια πρόσβαση: ανανέωσέ τη.", err_state: "Αυτή η απάντηση δεν ανήκει σε αίτημα αυτής της συσκευής.",
      err_cancel: "Η σύνδεση με την τράπεζα ακυρώθηκε.", err_other: "Η τράπεζα ή το Enable Banking δεν απάντησε. Δοκίμασε ξανά αργότερα.",
      err_server: "Το Enable Banking ή η τράπεζα δεν δέχτηκε το αίτημα.", err_notfound: "Το Enable Banking ή η τράπεζα δεν δέχτηκε το αίτημα.",
      err_noacc: "Η τράπεζα δεν έδωσε πρόσβαση σε κανέναν λογαριασμό. Στο control panel του Enable Banking κάνε πρώτα link τους λογαριασμούς αυτής της τράπεζας (ίδιο Personal ή Business) στην εφαρμογή σου.",
      ppT: "PayPal Business", ppNone: "Σύνδεσε πρώτα το PayPal Business στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες (Client ID και Secret της δικής σου εφαρμογής PayPal). Μετά πρόσθεσέ το εδώ.",
      ppAll: "Οι λογαριασμοί σου PayPal είναι συνδεδεμένοι παραπάνω.", ppAdd: "Προσθήκη",
      atT: "Αυτόματη ενημέρωση", atMode: "Ενημέρωση μόνη της", atSix: "Όταν ανοίγω την εφαρμογή, κάθε 6 ώρες", atSet: "Σε ώρες που ορίζω",
      atSixHint: "Η εφαρμογή ενημερώνεται όταν την ανοίγεις ή επιστρέφεις σε αυτήν και η τελευταία ενημέρωση έγινε πριν από 6 ώρες ή περισσότερο.",
      atHint: "Όσο το orOS είναι ανοιχτό, σε οποιαδήποτε εφαρμογή, οι τράπεζές σου ενημερώνονται μόνες τους σε αυτές τις ώρες, σε αυτή ή σε άλλη συσκευή σου (αρκεί μία). Μια ώρα που χάθηκε όσο το orOS ήταν κλειστό γίνεται την επόμενη φορά που θα το ανοίξεις. Το κινητό παγώνει τον browser στο παρασκήνιο, οπότε εκεί η ενημέρωση έρχεται όταν επιστρέφεις. Οι τράπεζες επιτρέπουν περίπου 4 αυτόματες αναγνώσεις την ημέρα, γι' αυτό ως 4 ώρες. Ειδοποίηση παίρνεις μόνο όταν μια ενημέρωση αποτύχει.",
      atOne: "Ώρα {n}", atAdd: "Πρόσθεσε ώρα", atRemove: "Αφαίρεση {v}",
      close: "Κλείσιμο", cancel: "Άκυρο"
    }
  };
  if (root.orosI18n) root.orosI18n.table(S, "budget", root.orosI18n.lang());
  function t(k, p) {
    var tab = (A && S[A.lang]) || S.en;
    var s = tab[k] !== undefined ? tab[k] : S.en[k] !== undefined ? S.en[k] : k;
    return s.replace(/\{(\w+)\}/g, function (m, n) { return p && p[n] !== undefined ? String(p[n]) : m; });
  }
  function el(tag, cls, text) { return A.el(tag, cls, text); }
  function links() {
    try { var p = root.parent; return p && p !== root && p.orosLinks && typeof p.orosLinks.call === "function" ? p.orosLinks : null; }
    catch (e) { return null; }
  }
  // Every Enable Banking application in Connected services (one, or
  // copies made on other devices); app() is the one this device can sign
  // with, else the first.
  function apps() { var Lk = links(); return Lk ? Lk.list("ebank") : []; }
  function app() {
    var l = apps(), h = l.filter(function (a) { return keyMap[a.id]; });
    return h[0] || l[0] || null;
  }
  // The application a bank row is read with on this device: its own
  // when the key is here; otherwise the one here that has a key (the row
  // was connected on another device, or with a copy since removed).
  // → { la, moved } or { la: "", why: "keys" | "noapp" }
  function appFor(row) {
    if (row.la && keyMap[row.la]) return { la: row.la, moved: false };
    var a = app();
    if (a && keyMap[a.id]) return { la: a.id, moved: a.id !== row.la };
    return { la: "", why: apps().length ? "keys" : "noapp" };
  }
  function webOrigin() {
    try { return root.location.origin === "https://useoros.online"; }
    catch (e) { return true; }
  }
  // The orOS on the person's own computer (installed orOS, Portable,
  // USB): the relay answers its bank reads (relay LOCAL_OPS), but the
  // bank's return page is on useoros.online, so it can't connect or renew.
  function localOrigin() {
    try { return root.location.origin === "http://localhost:47800"; }
    catch (e) { return false; }
  }
  function canRead() { return webOrigin() || localOrigin(); }
  function live() { return (A.data().bnk || []).slice(); }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function code(e) { return (e && e.code) || "other"; }
  // Enable Banking's own words for a refusal, short and plain text
  // (shown with textContent), so a wrong setting can be told apart.
  function detailOf(r) {
    var d = r && r.data, w = "";
    if (d && typeof d === "object") {
      w = [d.error, d.message, typeof d.detail === "string" ? d.detail : ""].filter(function (x) { return typeof x === "string" && x; }).join(": ");
    }
    w = w.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    var st = r && r.status ? "HTTP " + r.status : "";
    return [st, w].filter(Boolean).join(" · ");
  }
  function errText(c, e) {
    var k = "err_" + c;
    var base = S.en[k] ? t(k) : t("err_other");
    var d = e && typeof e.detail === "string" ? e.detail
          : e && !e.code && e.message ? String(e.message).slice(0, 120)
          : e && typeof e.extra === "string" && e.extra ? c + ": " + e.extra.replace(/[^\w .-]/g, "").slice(0, 40)
          : (S.en[k] ? "" : String(c || ""));
    return d && k !== "err_offline" && k !== "err_keys" ? base + " (" + d + ")" : base;
  }
  function ask(la, req) {
    return links().call(la, [req]).then(function (res) {
      var r = res && res[0];
      var c = links().statusCode(r);
      if (c) { var e = new Error(c); e.code = c; e.status = r && r.status; e.detail = detailOf(r) || c; throw e; }
      return r.data;
    });
  }
  function checkKeys() {
    var Lk = links(), l = apps();
    if (!Lk || !l.length) { keyMap = {}; keysHere = false; return Promise.resolve(false); }
    return Promise.all(l.map(function (a) {
      return Lk.hasKeys(a.id).then(function (h) { return !!h; }, function () { return false; });
    })).then(function (hs) {
      var m = {};
      l.forEach(function (a, i) { m[a.id] = hs[i]; });
      keyMap = m;
      var a = app();
      keysHere = !!(a && keyMap[a.id]);
      return keysHere;
    });
  }

  // ---------- Update (refresh) ----------
  function fetchAll(row, la) {
    var from = K.fromDate(row, Date.now()), out = [], page = 0;
    function next(ck) {
      var path = "/accounts/" + row.uid + "/transactions?date_from=" + from + (ck ? "&continuation_key=" + encodeURIComponent(ck) : "");
      return ask(la, { m: "GET", path: path }).then(function (j) {
        out = out.concat(K.items(j, out.length));
        page++;
        var nk = j && typeof j.continuation_key === "string" ? j.continuation_key : "";
        if (nk && page < K.MAX_PAGES) return next(nk);
        return out;
      });
    }
    return next("");
  }
  // PayPal Business (BK-3): every window since the fetch point, every page
  function fetchPayPal(row) {
    var wins = K.ppWindows(K.fromDate(row, Date.now()), Date.now()), all = [];
    return wins.reduce(function (p, w) {
      return p.then(function () {
        function page(n) {
          return ask(row.la, { m: "GET", path: K.ppPath(w, n) }).then(function (j) {
            var pg = K.ppPage(j);
            all = all.concat(pg.list);
            if (n < pg.pages) return page(n + 1);
          });
        }
        return page(1);
      });
    }, Promise.resolve()).then(function () { return K.ppItems(all, A.cur()); });
  }
  function isPP(r) { return r.src === "pp"; }
  // → Promise<{ n, errs: { id: code } }>
  function refresh(auto) {
    if (busy || !links()) return Promise.resolve({ n: 0, errs: {} });
    var rows = live(), now = Date.now();
    if (!rows.length) return Promise.resolve({ n: 0, errs: {} });
    busy = true;
    var D = A.data(), add = [], seenIds = {}, lfs = {}, errs = {}, bals = {}, moves = {}, adopt = {};
    var tx = D.tx.slice();
    return checkKeys().then(function () {
      return rows.reduce(function (p, row) {
        return p.then(function () {
          var pp = isPP(row), use = pp ? { la: row.la, moved: false } : appFor(row);
          if (!use.la) { errs[row.id] = use.why; return; }
          if (!pp && row.vu && row.vu < now) { errs[row.id] = "consent"; return; }
          return (pp ? fetchPayPal(row) : fetchAll(row, use.la)).then(function (its) {
            // read with the application here: the row follows it (synced)
            if (use.moved) moves[row.id] = use.la;
            K.uniqueFits(its);
            // a PayPal reading is a PayPal file: its bank twins ("PAYPAL *…") are found
            var plan = B.plan(its, { tx: tx, tombs: D.tombs, ac: row.ac, cur: A.cur(), rules: D.rule, xfer: D.xfer, pp: pp, areas: D.area, plArea: (D.set && D.set.pld) || "" });
            B.entries(plan, row.ac, pp).forEach(function (x) {
              if (seenIds[x.id]) return;
              seenIds[x.id] = 1;
              add.push(x);
              tx.push(Object.assign({ m: 0 }, x));     // later accounts see these too (transfers, PayPal)
            });
            // NA-2: entries without an account this reading found as its
            // own go into its account (later rows no longer take them)
            var ad = B.adopts(plan, row.ac);
            Object.keys(ad).forEach(function (id) {
              if (adopt[id]) return;
              adopt[id] = ad[id];
              tx = tx.map(function (y) { return y.id === id ? Object.assign({}, y, { ac: ad[id] }) : y; });
            });
            var lb = K.lastBooked(its);
            if (lb && lb > (row.lf || "")) lfs[row.id] = lb;
            if (pp) return;
            // BK-5: the bank's own balance; a bank that won't give it
            // costs nothing (the entries are in already)
            return ask(use.la, { m: "GET", path: "/accounts/" + row.uid + "/balances" }).then(function (j) {
              // BK-8: a card's debt and what is left to spend, both
              var v = K.view(K.balance(j), K.available(j), row.cl || 0, K.isCard(row));
              if (v) bals[row.id] = { bb: v.bb === null ? undefined : v.bb, ba: v.ba === null ? undefined : v.ba, bc: v.bc, bd: v.bd || K.ymdOf(Date.now()) };
            }, function () {});
          }, function (e) {
            var c = code(e);
            errs[row.id] = !pp && e && (e.status === 401 || e.status === 403 || e.status === 422) && c !== "keys" ? "consent" : c;
          });
        });
      }, Promise.resolve());
    }).then(function () {
      busy = false;
      lastErr = errs;
      store(DEV_KEY, { t: Date.now() });
      // one write per row: where it was read with, its last booked day,
      // the bank's balance and, with set times, when it was read (bt:
      // the other devices then skip that time)
      var sched = times().length, at = Date.now(), pat = {};
      function put(id, f) { pat[id] = Object.assign(pat[id] || {}, f); }
      Object.keys(moves).forEach(function (id) { put(id, { la: moves[id] }); });
      Object.keys(lfs).forEach(function (id) { put(id, { lf: lfs[id] }); });
      Object.keys(bals).forEach(function (id) { put(id, bals[id]); });
      if (sched) rows.forEach(function (r) { if (!errs[r.id]) put(r.id, { bt: at }); });
      Object.keys(pat).forEach(function (id) { A.patchBnk(id, pat[id]); });
      if (add.length || Object.keys(adopt).length) A.addEntries(add, t("got", { n: add.length }), adopt);
      else if (!auto && !Object.keys(errs).length) A.showToast(t("gotNone"));
      A.renderAll();
      return { n: add.length, errs: errs };
    }, function (e) { busy = false; throw e; });
  }
  // BK-AT: the set times (synced), [] = every 6 hours on open
  function times() { var st = A.data().set || {}; return K.times(st.bat); }
  // Is an automatic update due on this device now?
  function isDue(now) {
    var dev = load(DEV_KEY), ts = times();
    if (!ts.length) return K.due(dev && dev.t, now);
    return !!K.slotDue(ts, K.lastRead(live(), dev && dev.t, (A.data().set || {}).bam, now), now);
  }
  function canAuto() {
    // not while a bank connection is being made: its accounts get their
    // Budget account first (mapDialog), then the first update runs
    if (!live().length || !links() || connecting || load(PEND_KEY)) return false;
    return !(typeof navigator !== "undefined" && navigator.onLine === false);
  }
  function autoRefresh() {
    if (!canAuto() || !isDue(Date.now())) return;
    refresh(true).catch(function () {});
  }
  // The shell's hidden run at a set time (?bankbg=1): one update, then
  // the shell is told and drops the frame. An error worth knowing about
  // (not a missing key on this device, not offline: Banks says those)
  // goes with its text, for the shell's notification (Chris: on errors only).
  var QUIET = { keys: 1, noapp: 1, offline: 1 };
  function bgDone(r) {
    var errs = (r && r.errs) || {}, worst = "", text = "";
    live().some(function (row) {
      var c = errs[row.id];
      if (!c || QUIET[c]) return false;
      worst = c;
      text = (row.bk || "") + (row.nm ? " · " + row.nm : "") + ": " + errText(c);
      return true;
    });
    try {
      root.parent.postMessage({ oros: "bank-bg-done", app: "budget", n: (r && r.n) || 0, err: worst, text: text.slice(0, 300) }, root.location.origin);
    } catch (e) {}
  }
  function bgRun() {
    if (!canRead() || !canAuto() || !isDue(Date.now())) { bgDone(null); return; }
    refresh(true).then(bgDone, function (e) {
      var c = code(e);
      bgDone({ n: 0, errs: live().reduce(function (o, row) { o[row.id] = c; return o; }, {}) });
    });
  }
  function bgMode() {
    try { return /[?&]bankbg=1(&|$)/.test(root.location.search); } catch (e) { return false; }
  }

  // ---------- The bank's answer ----------
  var handling = false;
  function takeAnswer(cb) {
    if (handling || !cb || typeof cb !== "object") return;
    var pend = load(PEND_KEY);
    store(CB_KEY, null);
    if (!pend || Date.now() - (pend.t || 0) > PEND_MS) return;
    if (cb.state !== pend.state) { A.showToast(t("err_state")); return; }
    store(PEND_KEY, null);
    if (cb.error || !cb.code) { A.showToast(t("err_cancel")); return; }
    handling = true;
    connecting = true;
    ask(pend.la, { m: "POST", path: "/sessions", body: { code: cb.code } }).then(function (j) {
      handling = false;
      var ses = K.session(j);
      if (!ses) { connecting = false; A.showToast(errText("other", { detail: "session" })); return; }
      if (!ses.accts.length) { connecting = false; A.showToast(t("err_noacc")); return; }
      var rows = live(), saved = [];
      ses.accts.forEach(function (ac) {
        var old = K.matchLink(rows, pend.bank, ac);
        var row = {
          id: old ? old.id : A.newId(), ac: old ? old.ac : "", bk: pend.bank.name, cty: pend.bank.country,
          cu: ac.cur, ib: ac.ib, ih: ac.ih, la: pend.la, lf: old ? old.lf : "", nm: ac.name,
          ps: pend.ps === "business" ? "business" : "personal", sid: ses.sid, uid: ac.uid, vu: ses.vu
        };
        // BK-8: the kind of account and a card's limit (the bank's, else
        // the one typed here before)
        if (ac.ty || (old && old.ty)) row.ty = ac.ty || old.ty;
        if (ac.cl || (old && old.cl)) row.cl = ac.cl || old.cl;
        A.saveBnk(row);
        saved.push(row.id);
      });
      mapDialog(saved);
    }, function (e) { handling = false; connecting = false; A.showToast(errText(code(e), e)); });
  }
  function listen() {
    try {
      var bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = function (ev) { takeAnswer(ev.data); };
    } catch (e) {}
    root.addEventListener("storage", function (ev) { if (ev.key === CB_KEY && ev.newValue) takeAnswer(load(CB_KEY)); });
    var cb = load(CB_KEY);
    if (cb) setTimeout(function () { takeAnswer(cb); }, 300);
  }

  // ---------- Dialogs ----------
  function mapDialog(ids) {
    var open0 = root.document.getElementById("bd-banks");   // the Banks dialog is stale now
    if (open0 && open0.open) open0.close();
    var dlg = A.makeDialog("bd-bankmap", t("mapT"));
    dlg.appendChild(el("p", "hint", t("mapHint")));
    ids.forEach(function (id) {
      var row = live().filter(function (r) { return r.id === id; })[0];
      if (!row) return;
      var s = A.accSelect(row.ac);
      s.addEventListener("change", function () { A.patchBnk(row.id, { ac: s.value }); });
      dlg.appendChild(A.field(rowName(row), s, "bm-" + row.id));
    });
    var acts = el("div", "dlg-actions");
    acts.appendChild(A.button(t("mapDone"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    // closed any way (Done, Esc, a click outside): the first update
    dlg.addEventListener("close", function () { connecting = false; refresh(false).catch(function () {}); });
    A.showDialog(dlg);
  }
  function rowName(r) {
    if (isPP(r)) return "PayPal" + (r.nm && r.nm !== "PayPal" ? " · " + r.nm : "");
    return r.bk + (r.nm ? " · " + r.nm : "") + (r.ib ? " ··" + r.ib : "") + (r.cu ? " (" + r.cu + ")" : "");
  }
  // BK-5: the bank's balance next to Budget's, and "Match" when they differ
  function balRow(li, r, redraw) {
    var card = K.isCard(r);
    if (!r.bc || (typeof r.bb !== "number" && typeof r.ba !== "number")) return;
    var hasB = typeof r.bb === "number", hasA = typeof r.ba === "number";
    var txt = card && hasB && hasA ? t("cardBal", { a: A.money(r.bb, r.bc), v: A.money(r.ba, r.bc), d: A.dateShort(r.bd) })
            : !hasB ? t("availBal", { v: A.money(r.ba, r.bc), d: A.dateShort(r.bd) }) + (card ? " " + t("cardNoLimit") : "")
            : t("bankBal", { a: A.money(r.bb, r.bc), d: A.dateShort(r.bd) }) + (hasA ? " · " + t("availShort", { v: A.money(r.ba, r.bc) }) : "");
    var line = el("div", "bk-meta bk-bal", txt);
    li.appendChild(line);
    if (!hasB) return;
    if (!r.ac || A.accCur(r.ac) !== r.bc) return;
    var mine = A.accBalAt(r.ac, r.bd);
    if (mine === null || mine === r.bb) { if (mine === r.bb) line.appendChild(el("span", "bk-ok", " · " + t("balSame"))); return; }
    var diff = r.bb - mine;
    line.appendChild(el("span", "", " · " + t("balBudget", { a: A.money(mine, r.bc) })));
    var b = A.button(t("balMatch"), "mini", function () {
      if (A.correct(r.ac, diff, t("balMatched", { a: A.money(diff, r.bc) }), r.bd)) redraw();
    });
    b.title = t("balMatchHint");
    li.appendChild(b);
  }
  // BK-8: a card's credit limit, from the bank or typed here; with it
  // the debt = available − limit, so the two always add up.
  function limitRow(r, redraw) {
    var inp = el("input");
    inp.type = "text";
    inp.inputMode = "decimal";
    inp.autocomplete = "off";
    inp.value = r.cl ? A.centsToInput(r.cl) : "";
    inp.placeholder = "0";
    inp.setAttribute("aria-label", t("cardLimit") + ": " + rowName(r));
    inp.addEventListener("change", function () {
      var v = inp.value.trim(), c = v ? A.parseAmount(v) : 0;
      if (c === null) { inp.value = r.cl ? A.centsToInput(r.cl) : ""; A.showToast(t("limitBad")); return; }
      var f = { cl: c || undefined };
      var v2 = K.recard(Object.assign({}, r, f));
      if (v2) { f.bb = v2.bb; f.ba = v2.ba; }
      A.patchBnk(r.id, f);
      redraw();
    });
    var row = el("div", "bk-bot bk-limit");
    row.appendChild(el("span", "dlg-lbl", t("cardLimit")));
    row.appendChild(inp);
    return row;
  }
  // CD-1: "This is a credit card", for a bank that does not say so
  // (its kind of account, or its name): the person's answer wins, and
  // the balance it last gave is read again as a card's (or not).
  function cardSwitch(r, redraw) {
    var lab = el("label", "bk-card-sw");
    var cb = el("input");
    cb.type = "checkbox";
    cb.checked = K.isCard(r);
    cb.addEventListener("change", function () {
      var f = { ck: cb.checked ? 1 : 2 };
      var v2 = K.recard(Object.assign({}, r, f));
      if (v2) { f.bb = v2.bb; f.ba = v2.ba; }
      A.patchBnk(r.id, f);
      redraw();
    });
    lab.appendChild(cb);
    lab.appendChild(el("span", "", t("isCard")));
    return lab;
  }
  // CD-1: the card's switch and limit, also in the account's sheet on
  // the Overview (where people look for the debt).
  function cardRows(box, r, redraw) {
    if (!box || !r || isPP(r) || (typeof r.bb !== "number" && typeof r.ba !== "number")) return;
    box.appendChild(cardSwitch(r, redraw));
    if (K.isCard(r)) box.appendChild(limitRow(r, redraw));
  }
  function statusText(r) {
    var d = K.daysLeft(r, Date.now());
    if (d === null) return "";
    if (d < 0) return t("ended");
    return d < K.WARN_DAYS ? t("leftSoon", { n: d }) : t("left", { n: d });
  }
  function readPem(file) {
    if (!file) return Promise.resolve("");
    if (typeof file.text === "function") return file.text();
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result || "")); };
      fr.onerror = rej;
      fr.readAsText(file);
    });
  }
  var PEM_RE = /-----BEGIN (RSA )?PRIVATE KEY-----[A-Za-z0-9+\/=\s]{200,6000}-----END (RSA )?PRIVATE KEY-----/;
  var APP_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  function appSection(dlg, redraw) {
    var Lk = links(), a = app();
    var box = el("section", "bk-sec");
    box.appendChild(el("h3", "bk-h", t("appT")));
    var msg = el("p", "hint bk-msg");
    var st = { id: "", pem: "" };
    function keyForm(withId) {
      var form = el("div", "bk-form");
      if (withId) {
        var inp = el("input");
        inp.type = "text"; inp.autocomplete = "off"; inp.spellcheck = false; inp.placeholder = t("appId_ph");
        inp.addEventListener("input", function () { st.id = inp.value.trim().toLowerCase(); });
        form.appendChild(A.field(t("appId"), inp, "bl-app"));
      }
      var pick = A.button(t("keyPick"), "", function () {
        A.pickFile(".pem,application/x-pem-file,application/x-x509-ca-cert,text/plain").then(function (f) { return readPem(f); }).then(function (txt) {
          var m = PEM_RE.exec(String(txt || ""));
          st.pem = m ? m[0] : "";
          msg.textContent = st.pem ? t("keyPicked", { n: st.pem.length }) : t("keyBad");
          msg.className = st.pem ? "hint bk-msg" : "err bk-msg";
          // the file's name is the application id (Enable Banking's own download)
        }, function () { msg.textContent = t("keyBad"); });
      });
      form.appendChild(A.field(t("keyFile"), pick, "bl-pem"));
      return form;
    }
    function done(p) {
      p.then(function () {
        var a2 = app();
        return a2 ? ask(a2.id, { m: "GET", path: "/application" }) : null;
      }).then(function (j) {
        msg.className = "hint bk-msg";
        msg.textContent = t("appOk", { n: B.clean(j && j.name ? String(j.name) : "", 60) || "—" });
        redraw();
      }, function (e) { msg.className = "err bk-msg"; msg.textContent = e && e.code === "keys" && e.extra ? t("keyBad") : errText(code(e), e); });
    }
    if (!a) {
      box.appendChild(el("p", "hint", t("appNone")));
      var lk = el("a", "bk-link", t("appLink"));
      lk.href = "https://enablebanking.com/cp/applications";
      lk.target = "_blank";
      lk.rel = "noopener noreferrer";
      box.appendChild(lk);
      var red = el("p", "hint");
      red.appendChild(el("span", "", t("redirect") + ": "));
      red.appendChild(el("code", "bk-code", K.REDIRECT));
      box.appendChild(red);
      box.appendChild(keyForm(true));
      var acts = el("div", "dlg-actions");
      var saveB = A.button(t("appSave"), "primary", function () {
        if (!APP_RE.test(st.id)) { msg.className = "err bk-msg"; msg.textContent = t("idBad"); return; }
        if (!st.pem) { msg.className = "err bk-msg"; msg.textContent = t("keyBad"); return; }
        // one Enable Banking application: a second Save (after a failed
        // check) must not add another account
        if (app()) { redraw(); return; }
        saveB.disabled = true;
        done(Lk.add({ p: "ebank", name: "Enable Banking", keys: { app: st.id, pem: st.pem } }));
      });
      acts.appendChild(saveB);
      box.appendChild(acts);
    } else {
      box.appendChild(el("p", "", a.name));
      var kl = el("p", keysHere ? "hint" : "err", keysHere ? t("keyHere") : a.ks === 1 ? t("ksWait") : t("keyNot"));
      box.appendChild(kl);
      // the device with the key can send it to the others (phone) right here
      if (keysHere && typeof Lk.setKeySync === "function") box.appendChild(ksSwitch(a, msg, redraw));
      if (!keysHere) {
        box.appendChild(keyForm(true));
        var acts2 = el("div", "dlg-actions");
        acts2.appendChild(A.button(t("keyAdd"), "primary", function () {
          if (!APP_RE.test(st.id)) { msg.className = "err bk-msg"; msg.textContent = t("idBad"); return; }
          if (!st.pem) { msg.className = "err bk-msg"; msg.textContent = t("keyBad"); return; }
          done(Lk.setKeys(a.id, { app: st.id, pem: st.pem }).then(function () { keysHere = true; }));
        }));
        box.appendChild(acts2);
      }
      var set = A.button(t("appSettings"), "mini", function () {
        dlg.close();
        try { root.parent.__orosOpenAt("settings", { section: "services" }); } catch (e) {}
      });
      box.appendChild(set);
    }
    box.appendChild(msg);
    return box;
  }
  function ksSwitch(a, msg, redraw) {
    var lab = el("label", "bk-check");
    var cb = el("input");
    cb.type = "checkbox";
    cb.checked = a.ks === 1;
    cb.addEventListener("change", function () {
      if (cb.checked && !links().canKeySync()) { cb.checked = false; msg.className = "err bk-msg"; msg.textContent = t("ksNeed"); return; }
      links().setKeySync(a.id, cb.checked);
      redraw();
    });
    lab.appendChild(cb);
    lab.appendChild(el("span", "", t("ksT")));
    var wrap = el("div", "");
    wrap.appendChild(lab);
    wrap.appendChild(el("p", "hint", t("ksHint")));
    return wrap;
  }
  // BK-AT: Automatic updates: every 6 hours on open, or at 1 to 4 set times
  function timesSection() {
    var box = el("section", "bk-sec bk-times");
    box.appendChild(el("h3", "bk-h", t("atT")));
    var mode = el("select");
    [["six", t("atSix")], ["set", t("atSet")]].forEach(function (p) { var o = el("option", "", p[1]); o.value = p[0]; mode.appendChild(o); });
    var list = times().slice();
    mode.value = list.length ? "set" : "six";
    box.appendChild(A.field(t("atMode"), mode, "bk-at-mode"));
    var wrap = el("div", "bk-at-list");
    box.appendChild(wrap);
    var hint = el("p", "hint");
    box.appendChild(hint);
    // sorted, without twins, as stored
    function save() { var v = K.timesText(list); A.saveTimes(v); list = K.times(v); }
    function draw() {
      wrap.innerHTML = "";
      hint.textContent = t(mode.value === "set" ? "atHint" : "atSixHint");
      if (mode.value !== "set") return;
      list.forEach(function (v, i) {
        var row = el("div", "bk-at-row");
        var inp = el("input");
        inp.type = "time";
        inp.step = "60";
        inp.value = v;
        inp.setAttribute("aria-label", t("atOne", { n: i + 1 }));
        inp.addEventListener("change", function () {
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(inp.value)) { inp.value = list[i]; return; }
          list[i] = inp.value;
          save();
          draw();
        });
        row.appendChild(inp);
        if (list.length > 1) {
          var rm = A.button("\u00d7", "mini", function () { list.splice(i, 1); save(); draw(); });
          rm.setAttribute("aria-label", t("atRemove", { v: v }));
          rm.title = t("atRemove", { v: v });
          row.appendChild(rm);
        }
        wrap.appendChild(row);
      });
      if (list.length < K.MAX_TIMES) {
        wrap.appendChild(A.button(t("atAdd"), "mini", function () {
          var last = list.length ? list[list.length - 1] : "08:00";
          var h = (+last.slice(0, 2) + 12) % 24;
          var nx = (h < 10 ? "0" : "") + h + last.slice(2);
          while (list.indexOf(nx) >= 0) { h = (h + 1) % 24; nx = (h < 10 ? "0" : "") + h + last.slice(2); }
          list.push(nx);
          save();
          draw();
        }));
      }
    }
    mode.addEventListener("change", function () {
      if (mode.value === "set" && !list.length) list = ["08:00"];
      if (mode.value === "six") A.saveTimes("");
      else save();
      draw();
    });
    draw();
    return box;
  }
  function accsSection(redraw) {
    var box = el("section", "bk-sec");
    box.appendChild(el("h3", "bk-h", t("accsT")));
    var rows = live();
    if (!rows.length) { box.appendChild(el("p", "hint", t("accsNone"))); return box; }
    var ul = el("ul", "day-list bk-links");
    rows.forEach(function (r) {
      var li = el("li", "bk-link-row");
      li.appendChild(el("div", "bk-text", rowName(r)));
      var meta = [r.lf ? t("upd", { d: A.dateShort(r.lf) }) : t("updNever"), statusText(r)].filter(Boolean).join(" · ");
      li.appendChild(el("div", "bk-meta", meta));
      if (lastErr[r.id]) li.appendChild(el("div", "err", errText(lastErr[r.id])));
      balRow(li, r, redraw);
      cardRows(li, r, redraw);
      var s = A.accSelect(r.ac);
      s.setAttribute("aria-label", t("fills") + ": " + rowName(r));
      s.addEventListener("change", function () { A.patchBnk(r.id, { ac: s.value }); });
      var bot = el("div", "bk-bot");
      bot.appendChild(el("span", "dlg-lbl", t("fills")));
      bot.appendChild(s);
      if (!isPP(r)) bot.appendChild(A.button(t("renew"), "mini", function () {
        // with the application this device can sign with (the row's own
        // may live on another device only); none here: say what's missing
        var u = appFor(r);
        if (!u.la) { A.showToast(t("err_" + u.why)); return; }
        connect({ name: r.bk, country: r.cty, days: 180 }, r.ps, u.la);
      }));
      bot.appendChild(A.button(t("remove"), "mini danger", function () {
        if (!root.confirm(t("removeQ", { n: rowName(r) }))) return;
        A.dropBnk(r.id);
        A.showToast(t("removed"));
        redraw();
      }));
      li.appendChild(bot);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    return box;
  }
  var waitMsg = null;
  function connect(bank, psu, la) {
    // the bank's return page is on useoros.online (budget/bankapi.js REDIRECT)
    if (!webOrigin()) { A.showToast(t("localConnect")); return; }
    var state = K.newState();
    if (!state) { A.showToast(t("err_other")); return; }
    // the window opens now (a click), the address comes after the call
    var w = null;
    // its name survives the bank's pages: bankback.html closes a window
    // with this name instead of opening orOS in it
    try { w = root.open("about:blank", "oros-bank"); } catch (e) { w = null; }
    store(PEND_KEY, { state: state, bank: bank, ps: psu, la: la, t: Date.now() });
    ask(la, { m: "POST", path: "/auth", body: K.authBody(bank, state, psu, Date.now()) }).then(function (j) {
      // the bank's page (https; a local address only in tests)
      var url = j && typeof j.url === "string" && /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/)/.test(j.url) ? j.url : "";
      if (!url) throw Object.assign(new Error("other"), { code: "other", detail: "auth: no url" });
      if (w && !w.closed) { try { w.opener = null; } catch (e) {} w.location.href = url; }
      else { try { root.top.location.href = url; } catch (e) { A.showToast(t("popup")); } }
      if (waitMsg) waitMsg.textContent = t("wait");
    }).catch(function (e) {
      if (w && !w.closed) w.close();
      store(PEND_KEY, null);
      A.showToast(errText(code(e), e));
    });
  }
  function connSection() {
    var a = app();
    var box = el("section", "bk-sec");
    box.appendChild(el("h3", "bk-h", t("connT")));
    var cs = el("select");
    K.COUNTRIES.forEach(function (c) {
      var o = el("option", "", c);
      try { o.textContent = new Intl.DisplayNames([A.lang === "el" ? "el" : "en"], { type: "region" }).of(c) || c; } catch (e) {}
      o.value = c;
      cs.appendChild(o);
    });
    cs.value = "GR";
    var ps = el("select");
    [["personal", t("personal")], ["business", t("business")]].forEach(function (p) { var o = el("option", "", p[1]); o.value = p[0]; ps.appendChild(o); });
    var row1 = el("div", "fld-row");
    row1.appendChild(A.field(t("country"), cs, "bc-cty"));
    row1.appendChild(A.field(t("psu"), ps, "bc-psu"));
    box.appendChild(row1);
    var bs = el("select");
    bs.disabled = true;
    var list = [];
    var msg = el("p", "hint bk-msg");
    waitMsg = msg;
    var goB = A.button(t("goBank"), "primary", function () {
      var b = list[+bs.value];
      if (!b) return;
      connect(b, ps.value, a.id);
    });
    goB.disabled = true;
    var findB = A.button(t("find"), "", function () {
      msg.textContent = "";
      findB.disabled = true;
      ask(a.id, { m: "GET", path: "/aspsps?country=" + cs.value + "&psu_type=" + ps.value }).then(function (j) {
        findB.disabled = false;
        list = K.banks(j, ps.value);
        bs.innerHTML = "";
        list.forEach(function (b, i) { var o = el("option", "", b.name + (b.beta ? " (beta)" : "")); o.value = String(i); bs.appendChild(o); });
        bs.disabled = goB.disabled = !list.length;
      }, function (e) { findB.disabled = false; msg.className = "err bk-msg"; msg.textContent = errText(code(e), e); });
    });
    var row2 = el("div", "fld-row");
    row2.appendChild(A.field(t("bank"), bs, "bc-bank"));
    box.appendChild(findB);
    box.appendChild(row2);
    var acts = el("div", "dlg-actions");
    acts.appendChild(goB);
    box.appendChild(acts);
    box.appendChild(msg);
    return box;
  }
  // PayPal Business: its accounts in Connected services, each added once
  function ppSection(dlg) {
    var Lk = links();
    var box = el("section", "bk-sec");
    box.appendChild(el("h3", "bk-h", t("ppT")));
    var accts = Lk.list("paypal"), rows = live();
    if (!accts.length) {
      box.appendChild(el("p", "hint", t("ppNone")));
      var acts0 = el("div", "dlg-actions");
      acts0.appendChild(A.button(t("appSettings"), "", function () {
        dlg.close();
        try { root.parent.__orosOpenAt("settings", { section: "services" }); } catch (e) {}
      }));
      box.appendChild(acts0);
      return box;
    }
    var free = accts.filter(function (a) { return !rows.some(function (r) { return isPP(r) && r.la === a.id; }); });
    if (!free.length) { box.appendChild(el("p", "hint", t("ppAll"))); return box; }
    var ul = el("ul", "day-list bk-links");
    free.forEach(function (a) {
      var li = el("li", "bk-link-row");
      li.appendChild(el("div", "bk-text", a.name));
      li.appendChild(A.button(t("ppAdd"), "primary mini", function () {
        var row = { id: A.newId(), ac: "", bk: "PayPal", la: a.id, lf: "", nm: B.clean(a.name, 40), src: "pp" };
        A.saveBnk(row);
        connecting = true;
        mapDialog([row.id]);
      }));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    return box;
  }
  function open() {
    var dlg = A.makeDialog("bd-banks", t("lvTitle"));
    dlg.classList.add("wide");
    var Lk = links();
    var body = el("div", "bk-body");
    dlg.appendChild(body);
    var acts = el("div", "dlg-actions");
    var nowB = A.button(t("now"), "", function () {
      nowB.disabled = true;
      nowB.textContent = t("updating");
      refresh(false).then(draw, draw);
    });
    acts.appendChild(nowB);
    acts.appendChild(A.button(t("close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    function draw() {
      body.innerHTML = "";
      nowB.disabled = false;
      nowB.textContent = t("now");
      body.appendChild(el("p", "hint", t("lvIntro")));
      // the relay answers useoros.online and, for bank reads only, the
      // installed orOS / Portable / USB (localhost:47800); the bank's
      // return page is on useoros.online, so only there can a bank connect
      if (localOrigin()) body.appendChild(el("p", "hint bk-web", t("localOnly")));
      else if (!webOrigin()) body.appendChild(el("p", "err bk-web", t("webOnly")));
      if (!Lk) { body.appendChild(el("p", "", t("lvNoShell"))); nowB.hidden = true; return; }
      body.appendChild(appSection(dlg, function () { checkKeys().then(draw); }));
      body.appendChild(accsSection(draw));
      if (live().length) body.appendChild(timesSection());
      nowB.hidden = !live().length;
      if (app() && keysHere && webOrigin()) body.appendChild(connSection());
      body.appendChild(ppSection(dlg));
    }
    checkKeys().then(draw, draw);
    A.showDialog(dlg);
  }

  // The bar over the list: a consent that ends within a week (or ended).
  function bar(host) {
    if (!host) return;
    host.innerHTML = "";
    var now = Date.now(), soon = live().filter(function (r) { return K.needsRenew(r, now); });
    host.hidden = !soon.length;
    if (!soon.length) return;
    var ended = soon.filter(function (r) { return K.daysLeft(r, now) < 0; });
    var names = soon.map(function (r) { return r.bk; }).filter(function (n, i, a) { return a.indexOf(n) === i; }).join(", ");
    var b = el("button", "inbox-go");
    b.type = "button";
    b.appendChild(el("span", "", t(ended.length ? "barEnded" : "bar", { b: names })));
    b.addEventListener("click", open);
    host.appendChild(b);
  }

  function init(api) {
    A = api;
    if (!K || !B) return;
    // the hidden run takes no bank answers (the open Budget does)
    if (bgMode()) { setTimeout(bgRun, 0); return; }
    listen();
    setTimeout(autoRefresh, 2500);
    // Back to an orOS left open (a phone in the pocket, a tab overnight):
    // the same check, so the update still comes about once a day or more.
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") setTimeout(autoRefresh, 1500);
    });
  }
  // For the Overview: are banks linked here, when did this device last
  // update, is an update running.
  function state() {
    var dev = load(DEV_KEY);
    return { linked: live().length > 0, reach: !!links(), last: dev && dev.t ? dev.t : 0, busy: busy };
  }
  root.OrosBudgetBankLive = { init: init, open: open, refresh: refresh, bar: bar, state: state, cardRows: cardRows, isCard: function (r) { return !!K && K.isCard(r); }, _takeAnswer: takeAnswer };
})(typeof window !== "undefined" ? window : this);
