// ============================================================
// orOS CRM — CRM platforms (crm/platforms.js)
// Bring companies, contacts, deals and (Pipedrive) open activities
// from a HubSpot or Pipedrive account, the clients of an Invoice
// Ninja account, or an Odoo's contacts and opportunities, into CRM
// (integrations waves 4A, 4C and 4D).
// The account and its key live in the shell (Settings › Connected
// services, parent.orosLinks); this file never sees a key.
// links/crm.js builds the requests, reads the answers and makes the
// plan; here are the dialog and the one write:
//   Read = every page of every kind → the plan (what is new, what
//   changed since the last time) → "Import" = one write here, with
//   Undo. Nothing is ever written to the platform.
// Nothing of its own is stored: the ids of what came in (L.extId) are
// how the next import finds it again.
// ============================================================
(function (root) {
  "use strict";
  var M = root.OrosLinksCrm, C = root.OrosCrmCore;
  var A = null;                                   // the app's helpers (init)

  var S = {
    en: {
      btn: "Import from HubSpot, Pipedrive, Invoice Ninja or Odoo", title: "CRM platforms",
      intro: "Bring companies, contacts and deals here (Pipedrive's open activities as follow-ups, Invoice Ninja's clients and Odoo's contacts with their VAT ID, Odoo's opportunities as deals). orOS only reads the platform: nothing there changes.",
      none: "Connect HubSpot, Pipedrive, Invoice Ninja or Odoo in Settings › Connected services first.",
      openSettings: "Open Connected services", noShell: "Open CRM from the orOS desktop to import from a CRM platform.",
      acct: "Account", upd: "Update what was imported before, where it changed there",
      updHint: "Only the platform's fields: name, phone, e-mail, website, address, people (and VAT ID from Invoice Ninja and Odoo), deal stage and value. Status, tags, notes, stars and history here are never touched.",
      revive: "Bring back what was deleted here",
      read: "Read the account", reading: "Reading {what}… {n}",
      "k.own": "your companies", "k.stages": "stages", "k.orgs": "companies", "k.people": "contacts", "k.deals": "deals", "k.acts": "activities",
      plan: "{c} new customers, {d} new deals, {f} new follow-ups · {u} updated · {s} unchanged",
      here: "{n} already here under the same name or e-mail: used as they are.",
      gone: "{n} deleted here earlier: not brought back.",
      noCust: "{n} deals or activities without a company or contact: skipped.",
      otherCur: "{n} deals in another currency than CRM's ({cur}): brought in without a value.",
      over: "{n} didn't fit (CRM's limits).",
      capped: "The account has more than {n} {what}; only the first {n} were read.",
      nothing: "Nothing new: CRM already has everything.",
      go: "Import", done: "Imported: {a} new, {u} updated",
      "err.auth": "The platform refused the key. Check it in Settings › Connected services.",
      "err.keys": "This device doesn't have the account's key yet. Enter it in Settings › Connected services.",
      "err.offline": "You're offline.",
      "err.busy": "The platform asks to slow down. Try again in a minute.",
      "err.denied": "The key doesn't allow reading this. Give it read access to contacts, companies and deals.",
      "err.other": "Couldn't reach the platform. Try again later.",
      close: "Close", "p.hubspot": "HubSpot", "p.pdrive": "Pipedrive", "p.ininja": "Invoice Ninja", "p.odoo": "Odoo"
    },
    el: {
      btn: "Εισαγωγή από HubSpot, Pipedrive, Invoice Ninja ή Odoo", title: "Πλατφόρμες CRM",
      intro: "Φέρε εδώ εταιρείες, επαφές και deals (τις ανοιχτές δραστηριότητες του Pipedrive ως υπενθυμίσεις, τους πελάτες του Invoice Ninja και τις επαφές του Odoo με το ΑΦΜ τους, τις ευκαιρίες του Odoo ως deals). Το orOS μόνο διαβάζει την πλατφόρμα: εκεί δεν αλλάζει τίποτα.",
      none: "Σύνδεσε πρώτα HubSpot, Pipedrive, Invoice Ninja ή Odoo στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      openSettings: "Άνοιγμα Συνδεδεμένων υπηρεσιών", noShell: "Άνοιξε το CRM από την επιφάνεια εργασίας του orOS για εισαγωγή από πλατφόρμα CRM.",
      acct: "Λογαριασμός", upd: "Ενημέρωση όσων ήρθαν παλιότερα, όπου άλλαξαν εκεί",
      updHint: "Μόνο τα πεδία της πλατφόρμας: όνομα, τηλέφωνο, e-mail, ιστότοπος, διεύθυνση, άτομα (και ΑΦΜ από το Invoice Ninja και το Odoo), στάδιο και αξία deal. Η κατάσταση, οι ετικέτες, οι σημειώσεις, τα αστέρια και το ιστορικό εδώ δεν αλλάζουν ποτέ.",
      revive: "Επαναφορά όσων διαγράφηκαν εδώ",
      read: "Ανάγνωση λογαριασμού", reading: "Ανάγνωση: {what}… {n}",
      "k.own": "οι εταιρείες σου", "k.stages": "στάδια", "k.orgs": "εταιρείες", "k.people": "επαφές", "k.deals": "deals", "k.acts": "δραστηριότητες",
      plan: "{c} νέοι πελάτες, {d} νέα deals, {f} νέες υπενθυμίσεις · {u} ενημερώνονται · {s} χωρίς αλλαγή",
      here: "{n} υπάρχουν ήδη εδώ με το ίδιο όνομα ή e-mail: χρησιμοποιούνται όπως είναι.",
      gone: "{n} διαγράφηκαν εδώ παλιότερα: δεν επανέρχονται.",
      noCust: "{n} deals ή δραστηριότητες χωρίς εταιρεία ή επαφή: παραλείπονται.",
      otherCur: "{n} deals σε άλλο νόμισμα από του CRM ({cur}): έρχονται χωρίς αξία.",
      over: "{n} δεν χώρεσαν (όρια του CRM).",
      capped: "Ο λογαριασμός έχει πάνω από {n} {what}· διαβάστηκαν μόνο τα πρώτα {n}.",
      nothing: "Τίποτα νέο: το CRM τα έχει ήδη όλα.",
      go: "Εισαγωγή", done: "Εισαγωγή: {a} νέα, {u} ενημερώθηκαν",
      "err.auth": "Η πλατφόρμα απέρριψε το κλειδί. Έλεγξέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "err.keys": "Αυτή η συσκευή δεν έχει ακόμα το κλειδί του λογαριασμού. Πέρασέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "err.offline": "Είσαι εκτός σύνδεσης.",
      "err.busy": "Η πλατφόρμα ζητά να πάμε πιο αργά. Δοκίμασε ξανά σε ένα λεπτό.",
      "err.denied": "Το κλειδί δεν επιτρέπει αυτή την ανάγνωση. Δώσε του δικαίωμα ανάγνωσης σε επαφές, εταιρείες και deals.",
      "err.other": "Δεν ήταν δυνατή η σύνδεση με την πλατφόρμα. Δοκίμασε αργότερα.",
      close: "Κλείσιμο", "p.hubspot": "HubSpot", "p.pdrive": "Pipedrive", "p.ininja": "Invoice Ninja", "p.odoo": "Odoo"
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
    return t(c === "auth" || c === "keys" || c === "offline" || c === "busy" || c === "denied" ? "err." + c : "err.other");
  }
  function ask(acct, req) {
    return links().call(acct, [req]).then(function (res) {
      var r = res && res[0];
      // 403: the key works but lacks a scope (HubSpot private apps)
      var code = r && r.status === 403 ? "denied" : links().statusCode(r);
      if (code) { var e = new Error(code); e.code = code; throw e; }
      return r.data;
    });
  }
  function el(tag, cls, text) { return A.el(tag, cls, text); }
  function check(label, on, k) {
    var w = el("label", "check-row"), cb = el("input");
    cb.type = "checkbox";
    cb.checked = !!on;
    cb.setAttribute("data-k", k);
    w.appendChild(cb);
    w.appendChild(el("span", "", label));
    return { row: w, box: cb };
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
          if (r.next) return page(r.next);
        }, function (e) {
          // a part the account doesn't have (Odoo without the CRM app)
          if (e && e.code === "notfound" && M.OPTIONAL && M.OPTIONAL[a.p] && M.OPTIONAL[a.p][k]) return;
          throw e;
        });
      })("").then(kind);
    }
    return kind();
  }

  function open() {
    var dlg = A.makeDialog("crm-plat", true);
    dlg.appendChild(el("h2", "dlg-title", t("title")));
    dlg.appendChild(el("p", "hint", t("intro")));
    var acts = el("div", "dlg-actions");
    var closeBtn = A.button(t("close"), "", function () { dlg.close(); });
    var Lk = links(), accts = accounts();
    if (!Lk || !accts.length) {
      dlg.appendChild(el("p", "", Lk ? t("none") : t("noShell")));
      acts.appendChild(closeBtn);
      if (Lk) acts.appendChild(A.button(t("openSettings"), "primary", function () {
        dlg.close();
        try { root.parent.__orosOpenAt("settings", { section: "services" }); } catch (e) {}
      }));
      dlg.appendChild(acts);
      A.showDialog(dlg);
      return;
    }
    var byId = {};
    accts.forEach(function (a) { byId[a.id] = a; });
    var sel = A.field(dlg, t("acct"), A.selectEl(accts.map(function (a) { return [a.id, a.name + " (" + t("p." + a.p) + ")"]; }), accts[0].id));
    sel.setAttribute("data-k", "cplat.acct");
    var upd = check(t("upd"), true, "cplat.upd"), rev = check(t("revive"), false, "cplat.revive");
    dlg.appendChild(upd.row);
    dlg.appendChild(el("p", "hint", t("updHint")));
    dlg.appendChild(rev.row);
    var msg = el("div", "plat-msg");
    msg.setAttribute("aria-live", "polite");
    dlg.appendChild(msg);
    var got = null, capped = [], plan = null, busy = false, acct = null;
    var go = A.button(t("read"), "primary", function () {
      if (busy) return;
      if (!got || !plan) return readNow();
      apply();
    });
    go.setAttribute("data-k", "cplat.go");
    acts.appendChild(closeBtn);
    acts.appendChild(go);
    dlg.appendChild(acts);
    sel.addEventListener("change", function () { got = null; plan = null; msg.textContent = ""; go.textContent = t("read"); go.disabled = false; });
    [upd.box, rev.box].forEach(function (b) { b.addEventListener("change", function () { if (got && !busy) compute(); }); });

    function line(text) { msg.appendChild(el("p", "hint", text)); }
    function compute() {
      plan = M.plan(C, A.data(), got, { p: acct.p, acct: acct.id, src: t("p." + acct.p), now: Date.now(), upd: upd.box.checked, revive: rev.box.checked });
      var n = M.count(plan);
      msg.textContent = "";
      capped.forEach(function (k) { line(t("capped", { n: M.MAX[k], what: t("k." + k) })); });
      if (!n.add && !n.upd) line(t("nothing"));
      else msg.appendChild(el("p", "", t("plan", { c: plan.cust.add.length, d: plan.deals.add.length, f: plan.fups.add.length, u: n.upd, s: plan.same })));
      if (plan.here) line(t("here", { n: plan.here }));
      if (plan.gone) line(t("gone", { n: plan.gone }));
      if (plan.noCust) line(t("noCust", { n: plan.noCust }));
      if (plan.otherCur) line(t("otherCur", { n: plan.otherCur, cur: A.data().prefs.cur }));
      if (plan.over) line(t("over", { n: plan.over }));
      go.textContent = t("go");
      go.disabled = !n.add && !n.upd;
    }
    function readNow() {
      acct = byId[sel.value];
      if (!acct) return;
      busy = true;
      go.disabled = true;
      sel.disabled = true;
      msg.textContent = t("reading", { what: t("k.stages"), n: 0 });
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
      var upds = [];
      ["cust", "deals", "fups"].forEach(function (k) { plan[k].upd.forEach(function (u) { upds.push({ k: k, row: u.row }); }); });
      if (!A.apply({ cust: plan.cust.add, deals: plan.deals.add, fups: plan.fups.add }, upds, t("done", { a: n.add, u: n.upd }))) return;
      dlg.close();
    }
    A.showDialog(dlg);
    sel.focus();
  }

  root.OrosCrmPlatforms = {
    init: function (api) { A = api; },
    open: open,
    has: function () { return !!links() && !!C && !!M; },
    label: function () { return t("btn"); }
  };
})(typeof window !== "undefined" ? window : this);
