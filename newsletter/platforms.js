// ============================================================
// orOS Newsletter — email platforms (newsletter/platforms.js)
// A list linked to a group / audience / list on MailerLite, Mailchimp
// or Brevo (integrations wave 3). The account and its key live in the
// shell (Settings › Connected services, parent.orosLinks); this file
// never sees a key. links/mail.js builds the requests and reads the
// answers; here are the dialogs and the order things happen in:
//   Sync = read everyone on the platform → show what would change →
//   on "Apply": change this list first (saved, synced), then
//   unsubscribe there, then add there. Someone who left on one side is
//   never brought back on the other (see links/mail.js).
// Data: data.plinks (newsletter/core.js normPlink), synced; nothing
// device-local.
// ============================================================
(function (root) {
  "use strict";
  var C = root.OrosNewsletterCore, M = root.OrosLinksMail;
  var A = null;                                   // the app's helpers (init)

  var S = {
    en: {
      btn: "Email platforms", "plat.title": "Email platforms",
      intro: "Link this list to a group on MailerLite, an audience on Mailchimp or a list on Brevo. Sync brings their subscribers here, sends yours there, and carries every unsubscribe both ways.",
      "plat.none": "Connect MailerLite, Mailchimp or Brevo in Settings › Connected services first.",
      openSettings: "Open Connected services", noShell: "Open Newsletter from the orOS desktop to use email platforms.",
      linked: "Linked", never: "never synced", last: "last sync {t}",
      sync: "Sync", unlink: "Unlink", unlinkQ: "Unlink {g}? Nothing is deleted here or there.",
      link: "Link a group", acct: "Account", load: "Show its groups", group: "Group", doLink: "Link",
      loading: "Reading…", noGroups: "This account has no groups yet.",
      already: "This group is already linked to this list.",
      pull: "Bring their subscribers here", push: "Send our confirmed subscribers there",
      always: "Unsubscribes always travel both ways.",
      check: "Check", reading: "Reading the platform… {n}",
      plan: "{a} new here · {h} left there, leave here too · {u} left here, unsubscribed there · {s} sent there",
      nothing: "Nothing to change: both sides agree.",
      apply: "Apply", applying: "Applying… {n}",
      "plat.done": "Done: {a} added here, {h} left here, {u} unsubscribed there, {s} sent there.",
      fails: "{n} couldn't be changed on the platform; Sync again later.",
      tooMany: "The platform has more than {n} people in this group; only the first {n} were read.",
      basisNote: "People brought in count as \"Gave consent\": they signed up on the platform.",
      "plat.err.auth": "The platform refused the key. Check it in Settings › Connected services.",
      "plat.err.keys": "This device doesn't have the account's key yet. Enter it in Settings › Connected services.",
      "plat.err.offline": "You're offline.",
      "plat.err.busy": "The platform asks to slow down. Try again in a minute.",
      "plat.err.notfound": "The group wasn't found on the platform. It may have been deleted there.",
      "plat.err.other": "Couldn't reach the platform. Try again later.",
      "p.mlite": "MailerLite", "p.mchimp": "Mailchimp", "p.brevo": "Brevo"
    },
    el: {
      btn: "Πλατφόρμες email", "plat.title": "Πλατφόρμες email",
      intro: "Σύνδεσε αυτή τη λίστα με ένα group στο MailerLite, ένα audience στο Mailchimp ή μια λίστα στο Brevo. Ο συγχρονισμός φέρνει τους συνδρομητές τους εδώ, στέλνει τους δικούς σου εκεί και μεταφέρει κάθε διαγραφή και προς τις δύο μεριές.",
      "plat.none": "Σύνδεσε πρώτα MailerLite, Mailchimp ή Brevo στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      openSettings: "Άνοιγμα Συνδεδεμένων υπηρεσιών", noShell: "Άνοιξε το Newsletter από την επιφάνεια εργασίας του orOS για να χρησιμοποιήσεις πλατφόρμες email.",
      linked: "Συνδεδεμένα", never: "δεν έχει συγχρονιστεί", last: "τελευταίος συγχρονισμός {t}",
      sync: "Συγχρονισμός", unlink: "Αποσύνδεση", unlinkQ: "Αποσύνδεση του {g}; Δεν διαγράφεται τίποτα ούτε εδώ ούτε εκεί.",
      link: "Σύνδεση με group", acct: "Λογαριασμός", load: "Δείξε τα groups του", group: "Group", doLink: "Σύνδεση",
      loading: "Ανάγνωση…", noGroups: "Ο λογαριασμός δεν έχει ακόμα groups.",
      already: "Αυτό το group είναι ήδη συνδεδεμένο με τη λίστα.",
      pull: "Φέρε τους συνδρομητές τους εδώ", push: "Στείλε εκεί τους επιβεβαιωμένους συνδρομητές μας",
      always: "Οι διαγραφές μεταφέρονται πάντα και προς τις δύο μεριές.",
      check: "Έλεγχος", reading: "Ανάγνωση της πλατφόρμας… {n}",
      plan: "{a} νέοι εδώ · {h} αποχώρησαν εκεί, αποχωρούν και εδώ · {u} αποχώρησαν εδώ, διαγράφονται εκεί · {s} στέλνονται εκεί",
      nothing: "Τίποτα να αλλάξει: οι δύο μεριές συμφωνούν.",
      apply: "Εφαρμογή", applying: "Εφαρμογή… {n}",
      "plat.done": "Έγινε: {a} προστέθηκαν εδώ, {h} αποχώρησαν εδώ, {u} διαγράφηκαν εκεί, {s} στάλθηκαν εκεί.",
      fails: "{n} δεν άλλαξαν στην πλατφόρμα· κάνε ξανά συγχρονισμό αργότερα.",
      tooMany: "Η πλατφόρμα έχει πάνω από {n} άτομα σε αυτό το group· διαβάστηκαν μόνο τα πρώτα {n}.",
      basisNote: "Όσοι έρχονται από εκεί μετράνε ως «Έδωσε συναίνεση»: γράφτηκαν στην πλατφόρμα.",
      "plat.err.auth": "Η πλατφόρμα απέρριψε το κλειδί. Έλεγξέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "plat.err.keys": "Αυτή η συσκευή δεν έχει ακόμα το κλειδί του λογαριασμού. Πέρασέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "plat.err.offline": "Είσαι εκτός σύνδεσης.",
      "plat.err.busy": "Η πλατφόρμα ζητά να πάμε πιο αργά. Δοκίμασε ξανά σε ένα λεπτό.",
      "plat.err.notfound": "Το group δεν βρέθηκε στην πλατφόρμα. Ίσως διαγράφηκε εκεί.",
      "plat.err.other": "Δεν ήταν δυνατή η σύνδεση με την πλατφόρμα. Δοκίμασε αργότερα.",
      "p.mlite": "MailerLite", "p.mchimp": "Mailchimp", "p.brevo": "Brevo"
    }
  };
  // A pack language (orosI18n, ../i18n.js): English + the "newsletter" pack.
  function t(k, params) {
    var code = A && A.lang ? A.lang : "en", I = root.orosI18n;
    var tab = S[code] || (I ? I.table(S, "newsletter", code) : S.en);
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
  function plinksOf(listId) {
    return (A.data().plinks || []).filter(function (x) { return !x.del && x.list === listId; });
  }
  function errText(e) {
    var c = e && e.code;
    return t(c === "auth" || c === "keys" || c === "offline" || c === "busy" || c === "notfound" ? "plat.err." + c : "plat.err.other");
  }
  // One request → its answer, or a thrown code (status-based too).
  function ask(acct, req) {
    return links().call(acct, [req]).then(function (res) {
      var r = res && res[0];
      var code = links().statusCode(r);
      if (code) { var e = new Error(code); e.code = code; throw e; }
      return r.data;
    });
  }
  function el(tag, cls, text) { return A.el(tag, cls, text); }
  function check(label, on) {
    var w = el("label", "check"), cb = el("input");
    cb.type = "checkbox";
    cb.checked = !!on;
    w.appendChild(cb);
    w.appendChild(el("span", "", label));
    return { row: w, box: cb };
  }
  function savePlink(rec) {
    var d = A.data();
    if (!d.plinks) d.plinks = [];
    var cur = null;
    d.plinks.forEach(function (x) { if (x.id === rec.id) cur = x; });
    rec.m = Math.max(Date.now(), cur ? cur.m + 1 : 0);
    A.replaceIn(d.plinks, rec);
    A.save();
  }

  // ---------- the panel ----------
  function open() {
    var l = A.curList();
    if (!l) return;
    var dlg = A.makeDialog("nl-plat", t("plat.title"), true);
    dlg.appendChild(el("p", "hint", t("intro")));
    var Lk = links();
    if (!Lk) {
      dlg.appendChild(el("p", "dlg-text", t("noShell")));
      A.actionsRow(dlg, [], "", null);
      A.openDialog(dlg);
      return;
    }
    var accts = accounts();
    if (!accts.length) {
      dlg.appendChild(el("p", "dlg-text", t("plat.none")));
      A.actionsRow(dlg, [A.btn(t("openSettings"), "", function () {
        dlg.close();
        try { root.parent.__orosOpenAt("settings", { section: "services" }); } catch (e) {}
      })], "", null);
      A.openDialog(dlg);
      return;
    }
    var name = {};
    accts.forEach(function (a) { name[a.id] = a; });
    var mine = plinksOf(l.id);
    if (mine.length) {
      dlg.appendChild(el("div", "dlg-lbl", t("linked")));
      var ul = el("ul", "plat-list");
      mine.forEach(function (x) {
        var li = el("li", "plat-row");
        var txt = el("div", "plat-txt");
        txt.appendChild(el("div", "plat-name", t("p." + x.p) + " · " + (x.gname || x.grp)));
        var a = name[x.acct];
        txt.appendChild(el("div", "hint", [a ? a.name : "—", x.last ? t("last", { t: A.when(x.last) }) : t("never")].join(" · ")));
        li.appendChild(txt);
        var b1 = A.btn(t("sync"), "primary", function () { dlg.close(); syncDialog(x); });
        b1.disabled = !a;
        b1.setAttribute("data-k", "plat.sync");
        var b2 = A.btn(t("unlink"), "", function () {
          A.confirm(t("unlink"), t("unlinkQ", { g: x.gname || x.grp }), t("unlink"), function () {
            var d = A.data(), z = { id: x.id, m: x.m, del: 1 };
            z.m = Math.max(Date.now(), x.m + 1);
            A.replaceIn(d.plinks, z);
            A.save();
            dlg.close();
            open();
          }, true);
        });
        var acts = el("div", "plat-acts");
        acts.appendChild(b1);
        acts.appendChild(b2);
        li.appendChild(acts);
        ul.appendChild(li);
      });
      dlg.appendChild(ul);
    }
    // link a new group
    dlg.appendChild(el("div", "dlg-lbl", t("link")));
    var acctSel = A.sel(accts.map(function (a) { return [a.id, a.name + " (" + t("p." + a.p) + ")"]; }), accts[0].id);
    acctSel.setAttribute("data-k", "plat.acct");
    dlg.appendChild(A.field(t("acct"), acctSel));
    var gBox = el("div");
    dlg.appendChild(gBox);
    var msg = el("p", "dlg-text");
    msg.setAttribute("aria-live", "polite");
    dlg.appendChild(msg);
    var groups = null, gSel = null;
    var loadBtn = A.btn(t("load"), "", function () { loadGroups(); });
    loadBtn.setAttribute("data-k", "plat.load");
    var acts0 = A.actionsRow(dlg, [loadBtn], t("doLink"), function () {
      if (!gSel || !groups) return;
      var a = name[acctSel.value], g = null;
      groups.forEach(function (x) { if (x.id === gSel.value) g = x; });
      if (!a || !g) return;
      var id = C.plinkId(l.id, a.id, g.id);
      if (plinksOf(l.id).some(function (x) { return x.id === id; })) { msg.textContent = t("already"); return; }
      savePlink({ id: id, list: l.id, acct: a.id, p: a.p, grp: g.id, gname: g.name, last: 0 });
      dlg.close();
      open();
    });
    var linkBtn = acts0.lastChild;
    linkBtn.disabled = true;
    linkBtn.setAttribute("data-k", "plat.link");
    acctSel.addEventListener("change", function () { groups = null; gSel = null; gBox.innerHTML = ""; linkBtn.disabled = true; msg.textContent = ""; });
    function loadGroups() {
      var a = name[acctSel.value];
      if (!a) return;
      msg.textContent = t("loading");
      loadBtn.disabled = true;
      var all = [];
      (function page(n) {
        return ask(a.id, M.groupsReq(a.p, n)).then(function (data) {
          var r = M.readGroups(a.p, data, n);
          all = all.concat(r.items);
          return r.next >= 0 ? page(r.next) : all;
        });
      })(0).then(function (items) {
        loadBtn.disabled = false;
        groups = items;
        gBox.innerHTML = "";
        if (!items.length) { msg.textContent = t("noGroups"); return; }
        msg.textContent = "";
        gSel = A.sel(items.map(function (g) { return [g.id, g.name + " (" + g.n + ")"]; }), items[0].id);
        gSel.setAttribute("data-k", "plat.group");
        gBox.appendChild(A.field(t("group"), gSel));
        linkBtn.disabled = false;
      }, function (e) {
        loadBtn.disabled = false;
        msg.textContent = errText(e);
      });
    }
    A.openDialog(dlg, acctSel);
  }

  // ---------- sync ----------
  // Everyone on the platform's side → [{ email, name, lang, st }]
  function readAll(x, onCount) {
    var out = [], parts = M.PARTS[x.p].slice(), capped = false;
    function part() {
      if (!parts.length) return Promise.resolve({ people: out, capped: capped });
      var name = parts.shift();
      return (function page(at) {
        return ask(x.acct, M.membersReq(x.p, x.grp, name, at)).then(function (data) {
          var r = M.readMembers(x.p, x.grp, name, data, at);
          out = out.concat(r.people);
          onCount(out.length);
          if (out.length >= M.MAX_PEOPLE) { capped = true; return; }
          if (r.next !== null) return page(r.next);
        });
      })(x.p === "mlite" ? "" : 0).then(part);
    }
    return part();
  }
  function syncDialog(x) {
    var l = C.list(A.data(), x.list);
    if (!l) return;
    var dlg = A.makeDialog("nl-plat-sync", t("p." + x.p) + " · " + (x.gname || x.grp), true);
    var pull = check(t("pull"), true), push = check(t("push"), true);
    pull.box.setAttribute("data-k", "plat.pull");
    push.box.setAttribute("data-k", "plat.push");
    dlg.appendChild(pull.row);
    dlg.appendChild(push.row);
    dlg.appendChild(el("p", "hint", t("always") + " " + t("basisNote")));
    var msg = el("p", "dlg-text");
    msg.setAttribute("aria-live", "polite");
    dlg.appendChild(msg);
    var remote = null, plan = null, busy = false, capped = false;
    var acts = A.actionsRow(dlg, [], t("check"), function () {
      if (busy) return;
      if (!remote) return read();
      apply();
    });
    var go = acts.lastChild;
    go.setAttribute("data-k", "plat.go");
    function locals() {
      return C.subsOf(A.data(), l.id).map(function (s) { return { id: s.id, email: s.email, name: s.name, lang: s.lang, st: C.status(s) }; });
    }
    function suppSet() {
      var sp = {};
      (A.data().supp || []).forEach(function (h) { sp[h] = 1; });
      return function (e) { return !!sp[C.suppHash(e)]; };
    }
    function compute() {
      plan = M.plan(locals(), remote, { pull: pull.box.checked, push: push.box.checked, supp: suppSet() });
      // what Newsletter's own import would add (the limit, earlier leavers)
      plan.imp = C.planImport(A.data(), l.id, plan.add, { basis: "consent", src: "platform", tags: [t("p." + x.p).toLowerCase()] });
      var n = plan.imp.add.length + plan.offHere.length + plan.offThere.length + plan.send.length;
      msg.textContent = (capped ? t("tooMany", { n: M.MAX_PEOPLE }) + " " : "") +
        (n ? t("plan", { a: plan.imp.add.length, h: plan.offHere.length, u: plan.offThere.length, s: plan.send.length }) : t("nothing"));
      go.textContent = t("apply");
      go.disabled = !n;
    }
    [pull.box, push.box].forEach(function (b) { b.addEventListener("change", function () { if (remote && !busy) compute(); }); });
    function read() {
      busy = true;
      go.disabled = true;
      msg.textContent = t("reading", { n: 0 });
      readAll(x, function (n) { msg.textContent = t("reading", { n: n }); }).then(function (r) {
        busy = false;
        remote = r.people;
        capped = r.capped;
        compute();
      }, function (e) {
        busy = false;
        go.disabled = false;
        msg.textContent = errText(e);
      });
    }
    function apply() {
      if (!plan) return;
      busy = true;
      go.disabled = true;
      pull.box.disabled = push.box.disabled = true;
      // 1. here first: saved and synced whatever the platform says next
      var d = A.data(), now = Date.now();
      plan.imp.add.forEach(function (s) { A.replaceIn(d.subs, s); });
      plan.offHere.forEach(function (o) {
        var s = C.sub(d, o.id);
        if (!s) return;
        var z = JSON.parse(JSON.stringify(s));
        z.off = now;
        z.offSt = o.st;
        if (o.st === "bounce") z.bnc = Math.max(z.bnc, C.SOFT_LIMIT);
        z.m = Math.max(now, s.m + 1);
        A.replaceIn(d.subs, z);
      });
      A.save();
      // 2. then there: unsubscribes before additions
      var writes = M.unsubReqs(x.p, x.grp, plan.offThere).map(function (r) { return { r: r, n: count(r), k: "u" }; })
        .concat(M.pushReqs(x.p, x.grp, plan.send).map(function (r) { return { r: r, n: count(r), k: "s" }; }));
      var tally = { u: 0, s: 0, failed: 0 }, i = 0;
      function next() {
        if (i >= writes.length) return Promise.resolve();
        var w = writes[i++];
        msg.textContent = t("applying", { n: i + "/" + writes.length });
        return links().call(x.acct, [w.r]).then(function (res) {
          var got = M.readWrite(x.p, w.n, res && res[0]);
          tally[w.k] += got.ok;
          tally.failed += got.failed;
        }, function () { tally.failed += w.n; }).then(next);
      }
      next().then(function () {
        var cur = null;
        (A.data().plinks || []).forEach(function (y) { if (y.id === x.id && !y.del) cur = y; });
        if (cur) { var z = JSON.parse(JSON.stringify(cur)); z.last = Date.now(); savePlink(z); }
        busy = false;
        msg.textContent = t("plat.done", { a: plan.imp.add.length, h: plan.offHere.length, u: tally.u, s: tally.s }) +
          (tally.failed ? " " + t("fails", { n: tally.failed }) : "");
        go.hidden = true;
        A.renderAll();
      });
    }
    function count(r) {
      var b = r.body || {};
      return (b.requests || b.members || b.jsonBody || b.emails || []).length;
    }
    A.openDialog(dlg, go);
  }

  root.OrosNewsletterPlatforms = {
    init: function (api) { A = api; },
    open: open,
    has: function () { return !!links() && !!C && !!M; },
    label: function () { return t("btn"); }
  };
})(typeof window !== "undefined" ? window : this);
