// ============================================================
// orOS Notes — note platforms (notes/platforms.js)
// Bring the Notion pages shared with the user's own integration into
// Notes, as one notebook (integrations wave 6D).
// The account and its key live in the shell (Settings › Connected
// services, parent.orosLinks); this file never sees a key. Notion
// doesn't answer browsers, so every call goes through the orOS relay,
// a few requests per call with a pause between calls (the relay takes
// 60 calls a minute, Notion about 3 requests a second).
// links/notes.js builds the requests, reads the answers, writes the
// page text and makes the plan; here is the dialog. Read = every
// shared page and its blocks → the plan → "Import" = one write in
// notes.js (A.apply), with Undo. Nothing is ever written to Notion.
// ============================================================
(function (root) {
  "use strict";
  var M = root.OrosLinksNotes;
  var A = null;                                   // the app's helpers (init)
  var BATCH = 5, PAUSE = 1700, MAX_CALLS = 400;

  var S = {
    en: {
      btn: "Import from Notion…", title: "Import from Notion",
      intro: "Bring the Notion pages you shared with your integration here, as a notebook named Notion: subpages stay under their page, and the text keeps headings, lists, to-dos, quotes and code as plain text. Database rows, comments and files stay in Notion. orOS only reads Notion: nothing there changes.",
      none: "Connect Notion in Settings › Connected services first.",
      openSettings: "Open Connected services", noShell: "Open Notes from the orOS desktop to import from Notion.",
      acct: "Account", upd: "Replace the text of pages imported before, where it changed there",
      updHint: "Your edits here to those pages would be replaced (Undo puts them back). Labels, pins and the place of pages stay.",
      revive: "Bring back what was deleted here",
      read: "Read the account", reading: "Reading {what}… {n}",
      "k.pages": "pages", "k.text": "page text",
      plan: "{a} new pages · {u} updated · {s} unchanged",
      nb: "They go into a new notebook: {name}.",
      gone: "{n} deleted here earlier: not brought back.",
      capped: "Only the first {n} pages were read.",
      short: "Some long pages were read only in part.",
      empty: "No pages are shared with the integration yet. In Notion, open a page, ••• › Connections, and add it.",
      nothing: "Nothing new: Notes already has everything.",
      go: "Import", done: "Imported from Notion: {a} new, {u} updated", undo: "Undo", undone: "Import undone",
      untitled: "Untitled",
      "err.auth": "Notion refused the secret. Check it in Settings › Connected services.",
      "err.keys": "This device doesn't have the account's secret yet. Enter it in Settings › Connected services.",
      "err.offline": "You're offline.",
      "err.busy": "Notion asks to slow down. Try again in a minute.",
      "err.other": "Couldn't reach Notion. Try again later.",
      close: "Close", "p.notion": "Notion"
    },
    el: {
      btn: "Εισαγωγή από Notion…", title: "Εισαγωγή από Notion",
      intro: "Φέρε εδώ τις σελίδες του Notion που μοιράστηκες με την ενσωμάτωσή σου, σε σημειωματάριο με όνομα Notion: οι υποσελίδες μένουν κάτω από τη σελίδα τους, και το κείμενο κρατά επικεφαλίδες, λίστες, εργασίες, παραθέματα και κώδικα ως απλό κείμενο. Οι εγγραφές βάσεων δεδομένων, τα σχόλια και τα αρχεία μένουν στο Notion. Το orOS μόνο διαβάζει το Notion: εκεί δεν αλλάζει τίποτα.",
      none: "Σύνδεσε πρώτα το Notion στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      openSettings: "Άνοιγμα Συνδεδεμένων υπηρεσιών", noShell: "Άνοιξε τις Σημειώσεις από την επιφάνεια εργασίας του orOS για εισαγωγή από το Notion.",
      acct: "Λογαριασμός", upd: "Αντικατάσταση του κειμένου όσων σελίδων ήρθαν παλιότερα, όπου άλλαξε εκεί",
      updHint: "Οι αλλαγές σου εδώ σε αυτές τις σελίδες θα αντικατασταθούν (η Αναίρεση τις φέρνει πίσω). Ετικέτες, καρφιτσώματα και η θέση των σελίδων μένουν.",
      revive: "Επαναφορά όσων διαγράφηκαν εδώ",
      read: "Ανάγνωση λογαριασμού", reading: "Ανάγνωση: {what}… {n}",
      "k.pages": "σελίδες", "k.text": "κείμενο σελίδων",
      plan: "{a} νέες σελίδες · {u} ενημερώνονται · {s} χωρίς αλλαγή",
      nb: "Μπαίνουν σε νέο σημειωματάριο: {name}.",
      gone: "{n} διαγράφηκαν εδώ παλιότερα: δεν επανέρχονται.",
      capped: "Διαβάστηκαν μόνο οι πρώτες {n} σελίδες.",
      short: "Κάποιες μεγάλες σελίδες διαβάστηκαν μόνο εν μέρει.",
      empty: "Καμία σελίδα δεν είναι ακόμα μοιρασμένη με την ενσωμάτωση. Στο Notion άνοιξε μια σελίδα, ••• › Connections, και πρόσθεσέ τη.",
      nothing: "Τίποτα νέο: οι Σημειώσεις τα έχουν ήδη όλα.",
      go: "Εισαγωγή", done: "Εισαγωγή από Notion: {a} νέα, {u} ενημερώθηκαν", undo: "Αναίρεση", undone: "Η εισαγωγή αναιρέθηκε",
      untitled: "Χωρίς τίτλο",
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
  function ask(acct, req) {
    return links().call(acct, [req]).then(function (res) {
      var code = links().statusCode(res && res[0]);
      if (code) { var e = new Error(code); e.code = code; throw e; }
      return res[0].data;
    });
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
  // that failed on its own, e.g. a block that is not shared); auth, keys,
  // offline stop the reading; "busy" waits and tries again twice.
  function askMany(acct, reqs, tries) {
    return links().call(acct, reqs).then(function (res) {
      var out = [];
      for (var i = 0; i < reqs.length; i++) {
        var code = links().statusCode(res && res[i]);
        if (code === "auth" || code === "keys" || code === "offline") { var e = new Error(code); e.code = code; throw e; }
        if (code === "busy") { var b = new Error(code); b.code = code; throw b; }
        out.push(code ? null : res[i].data);
      }
      return out;
    }).catch(function (e) {
      if (e && e.code === "busy" && (tries || 0) < 2) return wait(PAUSE * 4).then(function () { return askMany(acct, reqs, (tries || 0) + 1); });
      throw e;
    });
  }

  // Every shared page (search, by cursor), then each page's blocks: a
  // queue of block reads, BATCH per call, children of nesting blocks to
  // MAX.depth, MAX.blockPages pages of blocks per parent.
  // → { pages: [{ xid, title, parent, text }], capped, short, empty }
  function readAll(a, onStep) {
    var pages = [], capped = false, short = false, calls = 0;
    function search(cursor) {
      calls++;
      return askMany(a.id, [M.searchReq(cursor)]).then(function (res) {
        if (!res[0]) { var e = new Error("other"); e.code = "other"; throw e; }
        var r = M.readSearch(res[0]);
        pages = pages.concat(r.pages);
        onStep("pages", pages.length);
        if (pages.length >= M.MAX.pages) { capped = r.next !== "" || pages.length > M.MAX.pages; pages = pages.slice(0, M.MAX.pages); return; }
        if (r.next) return wait(PAUSE).then(function () { return search(r.next); });
      });
    }
    return search("").then(function () {
      var queue = [], done = 0;
      pages.forEach(function (pg) { pg.blocks = []; queue.push({ id: pg.xid, cursor: "", depth: 0, n: 1, sink: pg.blocks, page: true }); });
      function step() {
        if (!queue.length) return Promise.resolve();
        if (calls >= MAX_CALLS) { short = true; return Promise.resolve(); }
        var jobs = queue.splice(0, BATCH);
        calls++;
        return wait(PAUSE).then(function () {
          return askMany(a.id, jobs.map(function (j) { return M.blocksReq(j.id, j.cursor); }));
        }).then(function (res) {
          jobs.forEach(function (j, i) {
            if (j.page) done++;
            if (!res[i]) return;
            var r = M.readBlocks(res[i]);
            r.blocks.forEach(function (b) {
              j.sink.push(b);
              if (b.more) {
                if (j.depth < M.MAX.depth) { b.kids = []; queue.push({ id: b.id, cursor: "", depth: j.depth + 1, n: 1, sink: b.kids }); }
                else short = true;
              }
            });
            if (r.next) {
              if (j.n < M.MAX.blockPages) queue.unshift({ id: j.id, cursor: r.next, depth: j.depth, n: j.n + 1, sink: j.sink });
              else short = true;
            }
          });
          onStep("text", done + "/" + pages.length);
          return step();
        });
      }
      return step();
    }).then(function () {
      pages.forEach(function (pg) { pg.text = M.toText(pg.blocks); delete pg.blocks; });
      return { pages: pages, capped: capped, short: short };
    });
  }

  function open() {
    var stale = document.getElementById("nt-plat");
    if (stale) stale.remove();
    var dlg = el("dialog");
    dlg.id = "nt-plat";
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
    lab.htmlFor = "plat-acct";
    form.appendChild(lab);
    var sel = el("select");
    sel.id = "plat-acct";
    sel.setAttribute("data-k", "nplat.acct");
    accts.forEach(function (a) {
      var pn = t("p." + a.p), o = el("option", "", a.name === pn ? pn : a.name + " (" + pn + ")");
      o.value = a.id;
      sel.appendChild(o);
    });
    form.appendChild(sel);
    var upd = check(t("upd"), false, "nplat.upd"), rev = check(t("revive"), false, "nplat.revive");
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
    go.setAttribute("data-k", "nplat.go");
    menu.appendChild(closeBtn);
    menu.appendChild(el("span", "spacer"));
    menu.appendChild(go);
    form.appendChild(menu);
    sel.addEventListener("change", function () { got = null; plan = null; msg.textContent = ""; go.textContent = t("read"); go.disabled = false; });
    [upd.box, rev.box].forEach(function (b) { b.addEventListener("change", function () { if (got && !busy) compute(); }); });

    function line(text) { msg.appendChild(el("p", "hint", text)); }
    function compute() {
      plan = M.plan(A.data(), got, { p: acct.p, acct: acct.id, upd: upd.box.checked, revive: rev.box.checked,
                                     name: t("p.notion"), untitled: t("untitled") });
      var n = M.count(plan);
      msg.textContent = "";
      if (!got.pages.length) { line(t("empty")); go.textContent = t("read"); go.disabled = false; got = null; return; }
      if (capped) line(t("capped", { n: M.MAX.pages }));
      if (short) line(t("short"));
      if (!n.add && !n.upd) line(t("nothing"));
      else msg.appendChild(el("p", "", t("plan", { a: plan.pages.add.length, u: n.upd, s: plan.same })));
      if (plan.notebook) line(t("nb", { name: plan.notebook.name }));
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
      msg.textContent = t("reading", { what: t("k.pages"), n: 0 });
      readAll(acct, function (k, n) { msg.textContent = t("reading", { what: t("k." + k), n: n }); }).then(function (r) {
        busy = false;
        sel.disabled = false;
        got = { pages: r.pages };
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

  root.OrosNotesPlatforms = {
    init: function (api) { A = api; },
    open: open,
    has: function () { return !!links() && !!M; },
    label: function () { return t("btn"); },
    undoLabel: function () { return t("undo"); },
    undone: function () { return t("undone"); }
  };
})(typeof window !== "undefined" ? window : this);
