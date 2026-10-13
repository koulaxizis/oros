// ============================================================
// orOS Bookmarks — bookmark platforms (bookmarks/platforms.js)
// Bring a Raindrop.io account's collections and bookmarks into
// Bookmarks (integrations wave 6C).
// The account and its key live in the shell (Settings › Connected
// services, parent.orosLinks); this file never sees a key.
// links/bookmarks.js builds the requests, reads the answers and makes
// the plan; here is the dialog. Read = the collections and every page
// of bookmarks → the plan (what is new, what changed since the last
// time) → "Import" = one write in bookmarks.js (A.apply), with Undo.
// Nothing is ever written to the platform, and nothing of its own is
// stored: the ids of what came in (L.extId) are how the next import
// finds it again.
// ============================================================
(function (root) {
  "use strict";
  var M = root.OrosLinksBookmarks;
  var A = null;                                   // the app's helpers (init)

  var S = {
    en: {
      btn: "Import from Raindrop.io…", title: "Import from Raindrop.io",
      intro: "Bring your Raindrop.io bookmarks here: each collection becomes a folder (one with the same name is used), with titles, notes, tags and favourites. orOS only reads Raindrop: nothing there changes.",
      none: "Connect Raindrop.io in Settings › Connected services first.",
      openSettings: "Open Connected services", noShell: "Open Bookmarks from the orOS desktop to import from Raindrop.io.",
      acct: "Account", upd: "Update what was imported before, where it changed there",
      updHint: "Only the title and the note; tags are only added. Folders, favourites and order here are never touched.",
      revive: "Bring back what was deleted here",
      read: "Read the account", reading: "Reading {what}… {n}",
      "k.collections": "collections", "k.children": "collections", "k.raindrops": "bookmarks",
      plan: "{f} new folders, {a} new bookmarks · {u} updated · {s} unchanged",
      here: "{n} links are already here: skipped.",
      gone: "{n} deleted here earlier: not brought back.",
      capped: "The account has more than {n} {what}; only the first {n} were read.",
      nothing: "Nothing new: Bookmarks already has everything.",
      go: "Import", done: "Imported from Raindrop.io: {a} new, {u} updated",
      "err.auth": "Raindrop.io refused the token. Check it in Settings › Connected services.",
      "err.keys": "This device doesn't have the account's token yet. Enter it in Settings › Connected services.",
      "err.offline": "You're offline.",
      "err.busy": "Raindrop.io asks to slow down. Try again in a minute.",
      "err.other": "Couldn't reach Raindrop.io. Try again later.",
      close: "Close", "p.raindrop": "Raindrop.io"
    },
    el: {
      btn: "Εισαγωγή από Raindrop.io…", title: "Εισαγωγή από Raindrop.io",
      intro: "Φέρε εδώ τους σελιδοδείκτες σου από το Raindrop.io: κάθε συλλογή γίνεται φάκελος (αν υπάρχει φάκελος με το ίδιο όνομα, μπαίνουν εκεί), με τίτλους, σημειώσεις, ετικέτες και αγαπημένα. Το orOS μόνο διαβάζει το Raindrop: εκεί δεν αλλάζει τίποτα.",
      none: "Σύνδεσε πρώτα το Raindrop.io στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      openSettings: "Άνοιγμα Συνδεδεμένων υπηρεσιών", noShell: "Άνοιξε τους Σελιδοδείκτες από την επιφάνεια εργασίας του orOS για εισαγωγή από το Raindrop.io.",
      acct: "Λογαριασμός", upd: "Ενημέρωση όσων ήρθαν παλιότερα, όπου άλλαξαν εκεί",
      updHint: "Μόνο ο τίτλος και η σημείωση· οι ετικέτες μόνο προστίθενται. Οι φάκελοι, τα αγαπημένα και η σειρά εδώ δεν αλλάζουν ποτέ.",
      revive: "Επαναφορά όσων διαγράφηκαν εδώ",
      read: "Ανάγνωση λογαριασμού", reading: "Ανάγνωση: {what}… {n}",
      "k.collections": "συλλογές", "k.children": "συλλογές", "k.raindrops": "σελιδοδείκτες",
      plan: "{f} νέοι φάκελοι, {a} νέοι σελιδοδείκτες · {u} ενημερώνονται · {s} χωρίς αλλαγή",
      here: "{n} σύνδεσμοι υπάρχουν ήδη εδώ: παραλείπονται.",
      gone: "{n} διαγράφηκαν εδώ παλιότερα: δεν επανέρχονται.",
      capped: "Ο λογαριασμός έχει πάνω από {n} {what}· διαβάστηκαν μόνο οι πρώτοι {n}.",
      nothing: "Τίποτα νέο: οι Σελιδοδείκτες τα έχουν ήδη όλα.",
      go: "Εισαγωγή", done: "Εισαγωγή από Raindrop.io: {a} νέα, {u} ενημερώθηκαν",
      "err.auth": "Το Raindrop.io απέρριψε το token. Έλεγξέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "err.keys": "Αυτή η συσκευή δεν έχει ακόμα το token του λογαριασμού. Πέρασέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "err.offline": "Είσαι εκτός σύνδεσης.",
      "err.busy": "Το Raindrop.io ζητά να πάμε πιο αργά. Δοκίμασε ξανά σε ένα λεπτό.",
      "err.other": "Δεν ήταν δυνατή η σύνδεση με το Raindrop.io. Δοκίμασε αργότερα.",
      close: "Κλείσιμο", "p.raindrop": "Raindrop.io"
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

  // Every page of every kind → { got, capped: [kind] }
  function readAll(a, onStep) {
    var got = {}, capped = [], kinds = M.KINDS[a.p].slice();
    function kind() {
      if (!kinds.length) return Promise.resolve({ got: got, capped: capped });
      var k = kinds.shift();
      got[k] = [];
      return (function page(at) {
        return ask(a.id, M.req(a.p, k, at)).then(function (data) {
          var r = M.read(a.p, k, data, at);
          got[k] = got[k].concat(r.items);
          onStep(k, got[k].length);
          if (got[k].length >= M.MAX[k]) { got[k] = got[k].slice(0, M.MAX[k]); capped.push(k); return; }
          if (r.next >= 0) return page(r.next);
        });
      })(0).then(kind);
    }
    return kind();
  }

  function open() {
    var stale = document.getElementById("bm-plat");
    if (stale) stale.remove();
    var dlg = el("dialog");
    dlg.id = "bm-plat";
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
    sel.setAttribute("data-k", "bplat.acct");
    accts.forEach(function (a) {
      var pn = t("p." + a.p), o = el("option", "", a.name === pn ? pn : a.name + " (" + pn + ")");
      o.value = a.id;
      sel.appendChild(o);
    });
    form.appendChild(sel);
    var upd = check(t("upd"), true, "bplat.upd"), rev = check(t("revive"), false, "bplat.revive");
    form.appendChild(upd.row);
    form.appendChild(el("p", "hint", t("updHint")));
    form.appendChild(rev.row);
    var msg = el("div", "plat-msg");
    msg.setAttribute("aria-live", "polite");
    form.appendChild(msg);
    var got = null, capped = [], plan = null, busy = false, acct = null;
    var go = button(t("read"), "primary", function () {
      if (busy) return;
      if (!got || !plan) return readNow();
      apply();
    });
    go.setAttribute("data-k", "bplat.go");
    menu.appendChild(closeBtn);
    menu.appendChild(el("span", "spacer"));
    menu.appendChild(go);
    form.appendChild(menu);
    sel.addEventListener("change", function () { got = null; plan = null; msg.textContent = ""; go.textContent = t("read"); go.disabled = false; });
    [upd.box, rev.box].forEach(function (b) { b.addEventListener("change", function () { if (got && !busy) compute(); }); });

    function line(text) { msg.appendChild(el("p", "hint", text)); }
    function compute() {
      plan = M.plan(A.data(), got, { p: acct.p, acct: acct.id, upd: upd.box.checked, revive: rev.box.checked, dupe: A.dupe });
      var n = M.count(plan);
      msg.textContent = "";
      capped.forEach(function (k) { line(t("capped", { n: M.MAX[k], what: t("k." + k) })); });
      if (!n.add && !n.upd) line(t("nothing"));
      else msg.appendChild(el("p", "", t("plan", { f: plan.folders.add.length, a: plan.items.add.length, u: n.upd, s: plan.same })));
      if (plan.here) line(t("here", { n: plan.here }));
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
      msg.textContent = t("reading", { what: t("k.collections"), n: 0 });
      readAll(acct, function (k, n) { msg.textContent = t("reading", { what: t("k." + k), n: n }); }).then(function (r) {
        busy = false;
        sel.disabled = false;
        got = r.got;
        capped = r.capped;
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

  root.OrosBookmarksPlatforms = {
    init: function (api) { A = api; },
    open: open,
    has: function () { return !!links() && !!M; },
    label: function () { return t("btn"); }
  };
})(typeof window !== "undefined" ? window : this);
