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
// most every 6 hours per device (Chris 2026-11-01 20:44).
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

  var S = {
    en: {
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
      err_busy: "The bank asks to wait a little (too many requests).", err_keys: "No key on this device.",
      err_consent: "The bank no longer gives access: renew it.", err_state: "That answer doesn't belong to a request from this device.",
      err_cancel: "The bank connection was cancelled.", err_other: "The bank or Enable Banking didn't answer. Try again later.",
      ppT: "PayPal Business", ppNone: "Connect PayPal Business in Settings › Connected services first (Client ID and Secret of your own PayPal app). Then add it here.",
      ppAll: "Your PayPal accounts are connected above.", ppAdd: "Add",
      close: "Close", cancel: "Cancel"
    },
    el: {
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
      err_busy: "Η τράπεζα ζητά λίγη αναμονή (πολλά αιτήματα).", err_keys: "Δεν υπάρχει κλειδί σε αυτή τη συσκευή.",
      err_consent: "Η τράπεζα δεν δίνει πια πρόσβαση: ανανέωσέ τη.", err_state: "Αυτή η απάντηση δεν ανήκει σε αίτημα αυτής της συσκευής.",
      err_cancel: "Η σύνδεση με την τράπεζα ακυρώθηκε.", err_other: "Η τράπεζα ή το Enable Banking δεν απάντησε. Δοκίμασε ξανά αργότερα.",
      ppT: "PayPal Business", ppNone: "Σύνδεσε πρώτα το PayPal Business στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες (Client ID και Secret της δικής σου εφαρμογής PayPal). Μετά πρόσθεσέ το εδώ.",
      ppAll: "Οι λογαριασμοί σου PayPal είναι συνδεδεμένοι παραπάνω.", ppAdd: "Προσθήκη",
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
  function app() { var Lk = links(); var l = Lk ? Lk.list("ebank") : []; return l.length ? l[0] : null; }
  function live() { return (A.data().bnk || []).slice(); }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function code(e) { return (e && e.code) || "other"; }
  function errText(c) {
    var k = "err_" + c;
    return S.en[k] ? t(k) : t("err_other");
  }
  function ask(la, req) {
    return links().call(la, [req]).then(function (res) {
      var r = res && res[0];
      var c = links().statusCode(r);
      if (c) { var e = new Error(c); e.code = c; e.status = r && r.status; throw e; }
      return r.data;
    });
  }
  function checkKeys() {
    var a = app(), Lk = links();
    if (!a || !Lk) { keysHere = false; return Promise.resolve(false); }
    return Lk.hasKeys(a.id).then(function (h) { keysHere = h; return h; }, function () { keysHere = false; return false; });
  }

  // ---------- Update (refresh) ----------
  function fetchAll(row) {
    var from = K.fromDate(row, Date.now()), out = [], page = 0;
    function next(ck) {
      var path = "/accounts/" + row.uid + "/transactions?date_from=" + from + (ck ? "&continuation_key=" + encodeURIComponent(ck) : "");
      return ask(row.la, { m: "GET", path: path }).then(function (j) {
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
    var D = A.data(), add = [], seenIds = {}, lfs = {}, errs = {};
    var tx = D.tx.slice();
    return checkKeys().then(function (has) {
      return rows.reduce(function (p, row) {
        return p.then(function () {
          var pp = isPP(row);
          if (!pp && !has) { errs[row.id] = "keys"; return; }
          if (!pp && row.vu && row.vu < now) { errs[row.id] = "consent"; return; }
          return (pp ? fetchPayPal(row) : fetchAll(row)).then(function (its) {
            K.uniqueFits(its);
            // a PayPal reading is a PayPal file: its bank twins ("PAYPAL *…") are found
            var plan = B.plan(its, { tx: tx, tombs: D.tombs, ac: row.ac, cur: A.cur(), rules: D.rule, xfer: D.xfer, pp: pp });
            B.entries(plan, row.ac, pp).forEach(function (x) {
              if (seenIds[x.id]) return;
              seenIds[x.id] = 1;
              add.push(x);
              tx.push(Object.assign({ m: 0 }, x));     // later accounts see these too (transfers, PayPal)
            });
            var lb = K.lastBooked(its);
            if (lb && lb > (row.lf || "")) lfs[row.id] = lb;
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
      Object.keys(lfs).forEach(function (id) { A.patchBnk(id, { lf: lfs[id] }); });
      if (add.length) A.addEntries(add, t("got", { n: add.length }));
      else if (!auto && !Object.keys(errs).length) A.showToast(t("gotNone"));
      A.renderAll();
      return { n: add.length, errs: errs };
    }, function (e) { busy = false; throw e; });
  }
  function autoRefresh() {
    // not while a bank connection is being made: its accounts get their
    // Budget account first (mapDialog), then the first update runs
    if (!live().length || !links() || connecting || load(PEND_KEY)) return;
    var dev = load(DEV_KEY);
    if (!K.due(dev && dev.t, Date.now())) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    refresh(true).catch(function () {});
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
      if (!ses || !ses.accts.length) { connecting = false; A.showToast(t("err_other")); return; }
      var rows = live(), saved = [];
      ses.accts.forEach(function (ac) {
        var old = K.matchLink(rows, pend.bank, ac);
        var row = {
          id: old ? old.id : A.newId(), ac: old ? old.ac : "", bk: pend.bank.name, cty: pend.bank.country,
          cu: ac.cur, ib: ac.ib, ih: ac.ih, la: pend.la, lf: old ? old.lf : "", nm: ac.name,
          ps: pend.ps === "business" ? "business" : "personal", sid: ses.sid, uid: ac.uid, vu: ses.vu
        };
        A.saveBnk(row);
        saved.push(row.id);
      });
      mapDialog(saved);
    }, function (e) { handling = false; connecting = false; A.showToast(errText(code(e))); });
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
      }, function (e) { msg.className = "err bk-msg"; msg.textContent = e && e.code === "keys" && e.extra ? t("keyBad") : errText(code(e)); });
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
      acts.appendChild(A.button(t("appSave"), "primary", function () {
        if (!APP_RE.test(st.id)) { msg.className = "err bk-msg"; msg.textContent = t("idBad"); return; }
        if (!st.pem) { msg.className = "err bk-msg"; msg.textContent = t("keyBad"); return; }
        done(Lk.add({ p: "ebank", name: "Enable Banking", keys: { app: st.id, pem: st.pem } }));
      }));
      box.appendChild(acts);
    } else {
      box.appendChild(el("p", "", a.name));
      var kl = el("p", keysHere ? "hint" : "err", keysHere ? t("keyHere") : t("keyNot"));
      box.appendChild(kl);
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
      var s = A.accSelect(r.ac);
      s.setAttribute("aria-label", t("fills") + ": " + rowName(r));
      s.addEventListener("change", function () { A.patchBnk(r.id, { ac: s.value }); });
      var bot = el("div", "bk-bot");
      bot.appendChild(el("span", "dlg-lbl", t("fills")));
      bot.appendChild(s);
      if (!isPP(r)) bot.appendChild(A.button(t("renew"), "mini", function () { connect({ name: r.bk, country: r.cty, days: 180 }, r.ps, r.la); }));
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
      if (!url) throw Object.assign(new Error("other"), { code: "other" });
      if (w && !w.closed) { try { w.opener = null; } catch (e) {} w.location.href = url; }
      else { try { root.top.location.href = url; } catch (e) { A.showToast(t("popup")); } }
      if (waitMsg) waitMsg.textContent = t("wait");
    }).catch(function (e) {
      if (w && !w.closed) w.close();
      store(PEND_KEY, null);
      A.showToast(errText(code(e)));
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
      }, function (e) { findB.disabled = false; msg.className = "err bk-msg"; msg.textContent = errText(code(e)); });
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
      if (!Lk) { body.appendChild(el("p", "", t("lvNoShell"))); nowB.hidden = true; return; }
      body.appendChild(appSection(dlg, function () { checkKeys().then(draw); }));
      body.appendChild(accsSection(draw));
      nowB.hidden = !live().length;
      if (app() && keysHere) body.appendChild(connSection());
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
    listen();
    setTimeout(autoRefresh, 2500);
  }
  root.OrosBudgetBankLive = { init: init, open: open, refresh: refresh, bar: bar, _takeAnswer: takeAnswer };
})(typeof window !== "undefined" ? window : this);
