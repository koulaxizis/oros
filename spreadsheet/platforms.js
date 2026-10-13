// ============================================================
// orOS Spreadsheet — sheet platforms (spreadsheet/platforms.js)
// Bring the Notion databases shared with the user's own integration
// into Spreadsheet, one sheet per database (integrations wave 6E).
// The account and its key live in the shell (Settings › Connected
// services, parent.orosLinks); this file never sees a key. Notion
// doesn't answer browsers, so every call goes through the orOS relay,
// a few requests per call with a pause between calls (the relay takes
// 60 calls a minute, Notion about 3 requests a second).
// links/sheets.js builds the requests, reads the answers and makes the
// plan; here is the dialog. Read = every shared database and its rows
// → the plan → "Import" = one write in spreadsheet.js (A.apply), with
// Undo. Nothing is ever written to Notion.
// ============================================================
(function (root) {
  "use strict";
  var M = root.OrosLinksSheets;
  var A = null;                                   // the app's helpers (init)
  var BATCH = 5, PAUSE = 1700;

  var S = {
    en: {
      btn: "Import from Notion…", title: "Import from Notion",
      intro: "Bring the Notion databases you shared with your integration here, one sheet per database: row 1 holds the property names, then one row per entry, as plain values (text, numbers, dates, TRUE/FALSE). orOS only reads Notion: nothing there changes.",
      none: "Connect Notion in Settings › Connected services first.",
      openSettings: "Open Connected services", noShell: "Open Spreadsheet from the orOS desktop to import from Notion.",
      acct: "Account", upd: "Replace the values of sheets imported before, where the database changed",
      updHint: "Your edits in those sheets would be replaced (Undo puts them back). Their names, formats and order stay.",
      revive: "Bring back what was deleted here",
      read: "Read the account", reading: "Reading {what}… {n}",
      "k.dbs": "databases", "k.rows": "rows",
      plan: "{a} new sheets · {u} updated · {s} unchanged",
      gone: "{n} deleted here earlier: not brought back.",
      capped: "Only the first {n} databases were read.",
      short: "Some databases have more than {n} rows: only the first {n} came.",
      empty: "No databases are shared with the integration yet. In Notion, open a database, ••• › Connections, and add it.",
      nothing: "Nothing new: Spreadsheet already has everything.",
      go: "Import", done: "Imported from Notion: {a} new sheets, {u} updated", undo: "Undo", undone: "Import undone",
      untitled: "Notion",
      "err.auth": "Notion refused the secret. Check it in Settings › Connected services.",
      "err.keys": "This device doesn't have the account's secret yet. Enter it in Settings › Connected services.",
      "err.offline": "You're offline.",
      "err.busy": "Notion asks to slow down. Try again in a minute.",
      "err.other": "Couldn't reach Notion. Try again later.",
      close: "Close", "p.notion": "Notion"
    },
    el: {
      btn: "Εισαγωγή από Notion…", title: "Εισαγωγή από Notion",
      intro: "Φέρε εδώ τις βάσεις δεδομένων του Notion που μοιράστηκες με την ενσωμάτωσή σου, ένα φύλλο για κάθε βάση: η γραμμή 1 έχει τα ονόματα των ιδιοτήτων και μετά μία γραμμή για κάθε εγγραφή, ως απλές τιμές (κείμενο, αριθμοί, ημερομηνίες, TRUE/FALSE). Το orOS μόνο διαβάζει το Notion: εκεί δεν αλλάζει τίποτα.",
      none: "Σύνδεσε πρώτα το Notion στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      openSettings: "Άνοιγμα Συνδεδεμένων υπηρεσιών", noShell: "Άνοιξε το Υπολογιστικό φύλλο από την επιφάνεια εργασίας του orOS για εισαγωγή από το Notion.",
      acct: "Λογαριασμός", upd: "Αντικατάσταση των τιμών όσων φύλλων ήρθαν παλιότερα, όπου άλλαξε η βάση",
      updHint: "Οι αλλαγές σου σε αυτά τα φύλλα θα αντικατασταθούν (η Αναίρεση τις φέρνει πίσω). Τα ονόματα, οι μορφοποιήσεις και η σειρά τους μένουν.",
      revive: "Επαναφορά όσων διαγράφηκαν εδώ",
      read: "Ανάγνωση λογαριασμού", reading: "Ανάγνωση: {what}… {n}",
      "k.dbs": "βάσεις δεδομένων", "k.rows": "γραμμές",
      plan: "{a} νέα φύλλα · {u} ενημερώνονται · {s} χωρίς αλλαγή",
      gone: "{n} διαγράφηκαν εδώ παλιότερα: δεν επανέρχονται.",
      capped: "Διαβάστηκαν μόνο οι πρώτες {n} βάσεις δεδομένων.",
      short: "Κάποιες βάσεις έχουν πάνω από {n} γραμμές: ήρθαν μόνο οι πρώτες {n}.",
      empty: "Καμία βάση δεδομένων δεν είναι ακόμα μοιρασμένη με την ενσωμάτωση. Στο Notion άνοιξε μια βάση, ••• › Connections, και πρόσθεσέ τη.",
      nothing: "Τίποτα νέο: το Υπολογιστικό φύλλο τα έχει ήδη όλα.",
      go: "Εισαγωγή", done: "Εισαγωγή από Notion: {a} νέα φύλλα, {u} ενημερώθηκαν", undo: "Αναίρεση", undone: "Η εισαγωγή αναιρέθηκε",
      untitled: "Notion",
      "err.auth": "Το Notion απέρριψε το secret. Έλεγξέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "err.keys": "Αυτή η συσκευή δεν έχει ακόμα το secret του λογαριασμού. Πέρασέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "err.offline": "Είσαι εκτός σύνδεσης.",
      "err.busy": "Το Notion ζητά να πάμε πιο αργά. Δοκίμασε ξανά σε ένα λεπτό.",
      "err.other": "Δεν ήταν δυνατή η σύνδεση με το Notion. Δοκίμασε αργότερα.",
      close: "Κλείσιμο", "p.notion": "Notion"
    }
  };
  function t(k, params) {
    var tab = S[A && A.lang === "el" ? "el" : "en"];
    var s = tab[k] !== undefined ? tab[k] : S.en[k] !== undefined ? S.en[k] : k;
    return s.replace(/\{(\w+)\}/g, function (m, n) { return params && params[n] !== undefined ? String(params[n]) : m; });
  }
  function links() {
    try { var p = root.parent; return p && p !== root && p.orosLinks && typeof p.orosLinks.call === "function" ? p.orosLinks : null; }
    catch (e) { return null; }
  }
  function accounts() {
    var Lk = links();
    if (!Lk) return [];
    return Lk.list().filter(function (a) { return M.PLATFORMS.indexOf(a.p) >= 0; });
  }
  function errText(e) {
    var c = e && e.code;
    return t(c === "auth" || c === "keys" || c === "offline" || c === "busy" ? "err." + c : "err.other");
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function check(label, on, k) {
    var w = el("label", "radio"), cb = el("input");
    cb.type = "checkbox";
    cb.checked = !!on;
    cb.setAttribute("data-k", k);
    w.appendChild(cb);
    w.appendChild(el("span", "", label));
    return { row: w, box: cb };
  }
  function button(text, cls, fn) {
    var b = el("button", cls || "", text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // One relay call with up to BATCH requests → their data (null for one
  // that failed on its own); auth, keys, offline stop the reading;
  // "busy" waits and tries again twice.
  function askMany(acct, reqs, tries) {
    return links().call(acct, reqs).then(function (res) {
      var out = [];
      for (var i = 0; i < reqs.length; i++) {
        var code = links().statusCode(res && res[i]);
        if (code === "auth" || code === "keys" || code === "offline" || code === "busy") { var e = new Error(code); e.code = code; throw e; }
        out.push(code ? null : res[i].data);
      }
      return out;
    }).catch(function (e) {
      if (e && e.code === "busy" && (tries || 0) < 2) return wait(PAUSE * 4).then(function () { return askMany(acct, reqs, (tries || 0) + 1); });
      throw e;
    });
  }

  // Every shared database (search, by cursor), then each one's rows: a
  // queue of queries, BATCH per call, MAX.rowPages pages per database.
  // → { dbs: [{ xid, title, cols, rows }], capped, short }
  function readAll(a, onStep) {
    var dbs = [], capped = false, short = false;
    function search(cursor) {
      return askMany(a.id, [M.searchReq(cursor)]).then(function (res) {
        if (!res[0]) { var e = new Error("other"); e.code = "other"; throw e; }
        var r = M.readSearch(res[0]);
        dbs = dbs.concat(r.dbs);
        onStep("dbs", dbs.length);
        if (dbs.length >= M.MAX.dbs) { capped = r.next !== "" || dbs.length > M.MAX.dbs; dbs = dbs.slice(0, M.MAX.dbs); return; }
        if (r.next) return wait(PAUSE).then(function () { return search(r.next); });
      });
    }
    return search("").then(function () {
      var queue = [], rows = 0;
      dbs.forEach(function (db) { db.rows = []; queue.push({ db: db, cursor: "", n: 1 }); });
      function step() {
        if (!queue.length) return Promise.resolve();
        var jobs = queue.splice(0, BATCH);
        return wait(PAUSE).then(function () {
          return askMany(a.id, jobs.map(function (j) { return M.queryReq(j.db.xid, j.cursor); }));
        }).then(function (res) {
          jobs.forEach(function (j, i) {
            if (!res[i]) return;
            var r = M.readRows(res[i], j.db.cols);
            j.db.rows = j.db.rows.concat(r.rows);
            rows += r.rows.length;
            if (r.next) {
              if (j.n < M.MAX.rowPages) queue.push({ db: j.db, cursor: r.next, n: j.n + 1 });
              else short = true;
            }
          });
          onStep("rows", rows);
          return step();
        });
      }
      return step();
    }).then(function () {
      dbs.forEach(function (db) { if (db.rows.length > M.MAX.rows) short = true; });
      return { dbs: dbs, capped: capped, short: short };
    });
  }

  function open() {
    var stale = document.getElementById("ss-plat");
    if (stale) stale.remove();
    var dlg = el("dialog");
    dlg.id = "ss-plat";
    var form = el("form");
    form.method = "dialog";
    form.autocomplete = "off";
    dlg.appendChild(form);
    form.appendChild(el("h3", "", t("title")));
    form.appendChild(el("p", "hint", t("intro")));
    var menu = el("menu");
    var closeBtn = button(t("close"), "", function () { dlg.close(); });
    function show() {
      document.body.appendChild(dlg);
      dlg.addEventListener("close", function () { dlg.remove(); });
      dlg.showModal();
    }
    var Lk = links(), accts = accounts();
    if (!Lk || !accts.length) {
      form.appendChild(el("p", "", Lk ? t("none") : t("noShell")));
      menu.appendChild(closeBtn);
      menu.appendChild(el("span", "spacer"));
      if (Lk) menu.appendChild(button(t("openSettings"), "", function () {
        dlg.close();
        try { root.parent.__orosOpenAt("settings", { section: "services" }); } catch (e) {}
      }));
      form.appendChild(menu);
      show();
      return;
    }
    var byId = {};
    accts.forEach(function (a) { byId[a.id] = a; });
    var lab = el("label", "", t("acct"));
    lab.htmlFor = "ss-plat-acct";
    form.appendChild(lab);
    var sel = el("select");
    sel.id = "ss-plat-acct";
    sel.setAttribute("data-k", "splat.acct");
    accts.forEach(function (a) {
      var pn = t("p." + a.p), o = el("option", "", a.name === pn ? pn : a.name + " (" + pn + ")");
      o.value = a.id;
      sel.appendChild(o);
    });
    form.appendChild(sel);
    var upd = check(t("upd"), false, "splat.upd"), rev = check(t("revive"), false, "splat.revive");
    form.appendChild(upd.row);
    form.appendChild(el("p", "hint", t("updHint")));
    form.appendChild(rev.row);
    var msg = el("div", "plat-msg");
    msg.setAttribute("aria-live", "polite");
    form.appendChild(msg);
    var got = null, capped = false, short = false, plan = null, busy = false, acct = null;
    var go = button(t("read"), "primary", function () {
      if (busy) return;
      if (!got || !plan) return readNow();
      apply();
    });
    go.setAttribute("data-k", "splat.go");
    menu.appendChild(closeBtn);
    menu.appendChild(el("span", "spacer"));
    menu.appendChild(go);
    form.appendChild(menu);
    sel.addEventListener("change", function () { got = null; plan = null; msg.textContent = ""; go.textContent = t("read"); go.disabled = false; });
    [upd.box, rev.box].forEach(function (b) { b.addEventListener("change", function () { if (got && !busy) compute(); }); });

    function line(text) { msg.appendChild(el("p", "hint", text)); }
    function compute() {
      plan = M.plan(A.data(), got, { p: acct.p, acct: acct.id, upd: upd.box.checked, revive: rev.box.checked, untitled: t("untitled") });
      var n = M.count(plan);
      msg.textContent = "";
      if (!got.dbs.length) { line(t("empty")); go.textContent = t("read"); go.disabled = false; got = null; return; }
      if (capped) line(t("capped", { n: M.MAX.dbs }));
      if (short) line(t("short", { n: M.MAX.rows }));
      if (!n.add && !n.upd) line(t("nothing"));
      else msg.appendChild(el("p", "", t("plan", { a: n.add, u: n.upd, s: plan.same })));
      if (plan.gone) line(t("gone", { n: plan.gone }));
      go.textContent = t("go");
      go.disabled = !n.add && !n.upd;
    }
    function readNow() {
      acct = byId[sel.value];
      if (!acct) return;
      busy = true;
      go.disabled = true;
      sel.disabled = true;
      msg.textContent = t("reading", { what: t("k.dbs"), n: 0 });
      readAll(acct, function (k, n) { msg.textContent = t("reading", { what: t("k." + k), n: n }); }).then(function (r) {
        busy = false;
        sel.disabled = false;
        got = { dbs: r.dbs };
        capped = r.capped;
        short = r.short;
        compute();
      }, function (e) {
        busy = false;
        sel.disabled = false;
        go.disabled = false;
        msg.textContent = errText(e);
      });
    }
    function apply() {
      var n = M.count(plan);
      if (!n.add && !n.upd) return;
      if (!A.apply(plan, t("done", { a: n.add, u: n.upd }))) return;
      dlg.close();
    }
    show();
    sel.focus();
  }

  root.OrosSheetPlatforms = {
    init: function (api) { A = api; },
    open: open,
    has: function () { return !!links() && !!M; },
    label: function () { return t("btn"); },
    undoLabel: function () { return t("undo"); },
    undone: function () { return t("undone"); }
  };
})(typeof window !== "undefined" ? window : this);
