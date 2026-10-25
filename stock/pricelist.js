// ============================================================
// orOS Stock — a supplier's price list (stock/pricelist.js, v1.0.0)
// The UI over prices.js (publisher wave P10). A publisher or a
// wholesaler sends a price list (CSV or Excel); pick the supplier and
// the file and Stock shows what differs:
//   - new prices (retail and, when the list has one, net / discount),
//   - titles the supplier no longer has that still have a minimum
//     here (Reorder would keep asking for them),
//   - titles in the list that are not here yet.
// Tick what to take, Apply = ONE write, with Undo. With "put them
// under this supplier", every product the list names gets the
// supplier and the supplier's code, so Reorder groups them and the
// order e-mail (Reorder › E-mail) names the supplier's codes.
// Then, only on a button and only when a WooCommerce shop is
// connected (Settings › Connected services): the new prices go to the
// shop (product found by its SKU, regular price set) and the new
// titles become DRAFT products there (never published from here).
// Nothing from the file or the shop is rendered as HTML.
// Loaded by stock/index.html after prices.js; stock.js calls
// window.OrosStockPriceList.open(api, supId).
// ============================================================
(function () {
  "use strict";

  var STR = {
    en: {
      "pl.title": "Supplier price list", "pl.link": "Price list…", "pl.sups": "Price list from a supplier…",
      "pl.hint": "A publisher or a wholesaler sends you a price list (CSV or Excel)? Stock compares it with your products by ISBN / EAN / code (or the exact title) and shows new prices, titles they no longer have and titles you don't have yet. You choose what changes.",
      "pl.sup": "Supplier", "pl.noSup": "(no supplier)", "pl.file": "Choose the file (CSV or Excel)…",
      "pl.cols": "The columns were not found. The list needs a header row with an ISBN / EAN / code or a title column, and a price, net price or availability column.",
      "pl.bad": "The file could not be read.", "pl.lib": "The Excel reader could not load. Save the list as CSV and try again.",
      "pl.sum": "{n} lines in the list · {m} match your products · {s} with nothing to change",
      "pl.skip": "{n} lines without a price were skipped", "pl.dup": "{n} repeated lines were skipped",
      "pl.price": "New prices ({n})", "pl.out": "No longer available from the supplier ({n})", "pl.fresh": "Not in Stock yet ({n})",
      "pl.outHint": "Ticked: the minimum and reorder quantity become 0, so Reorder stops asking for it. What you hold stays for sale.",
      "pl.freshHint": "Ticked: added as products with this price (quantity 0).",
      "pl.cost": "net {a} → {b}", "pl.costNew": "net {a}", "pl.all": "All", "pl.none": "None",
      "pl.more": "…and {n} more (all are applied as ticked by All / None)",
      "pl.linkSup": "Put the products the list names under {s} ({n} to change)",
      "pl.apply": "Apply in Stock", "pl.nothing": "Nothing is ticked.", "pl.cancel": "Cancel", "pl.close": "Close",
      "pl.done": "Price list applied: {p} prices, {o} no longer available, {f} added",
      "pl.undone": "Price list undone",
      "pl.shopHead": "Your shop", "pl.shopAsk": "{p} new prices and {f} new titles can go to the shop. Prices are found by SKU (the ISBN / code); new titles become drafts that you publish in the shop.",
      "pl.shopGo": "Send to the shop", "pl.shopBusy": "Sending… {n} of {t}",
      "pl.shopDone": "Shop: {p} prices set, {s} already right, {f} drafts made, {e} already in the shop, {x} not found, {b} failed.",
      "pl.shopCur": "The shop sells in {shop}, Stock counts in {mine}: no prices were sent and the drafts have no price.",
      "pl.shopVar": "{n} are variable products: set their prices in the shop.",
      "pl.shopSale": "{n} left as they are: their sale price is not below the new price. Change the sale in the shop first.",
      "pl.acct": "Shop", "pl.offline": "You are offline.",
      "pl.err": "The shop could not be reached or refused the keys. Check it in Settings › Connected services."
    },
    el: {
      "pl.title": "Τιμοκατάλογος προμηθευτή", "pl.link": "Τιμοκατάλογος…", "pl.sups": "Τιμοκατάλογος από προμηθευτή…",
      "pl.hint": "Σου στέλνει ένας εκδότης ή χονδρέμπορος τιμοκατάλογο (CSV ή Excel); Το Απόθεμα τον συγκρίνει με τα προϊόντα σου με ISBN / EAN / κωδικό (ή ακριβή τίτλο) και δείχνει νέες τιμές, τίτλους που δεν έχουν πια και τίτλους που δεν έχεις ακόμα. Εσύ διαλέγεις τι αλλάζει.",
      "pl.sup": "Προμηθευτής", "pl.noSup": "(χωρίς προμηθευτή)", "pl.file": "Διάλεξε το αρχείο (CSV ή Excel)…",
      "pl.cols": "Δεν βρέθηκαν οι στήλες. Ο κατάλογος θέλει μια γραμμή επικεφαλίδων με στήλη ISBN / EAN / κωδικού ή τίτλου, και στήλη τιμής, καθαρής τιμής ή διαθεσιμότητας.",
      "pl.bad": "Το αρχείο δεν διαβάστηκε.", "pl.lib": "Ο αναγνώστης Excel δεν φόρτωσε. Αποθήκευσε τον κατάλογο ως CSV και ξαναδοκίμασε.",
      "pl.sum": "{n} γραμμές στον κατάλογο · {m} ταιριάζουν με προϊόντα σου · {s} χωρίς αλλαγή",
      "pl.skip": "Παραλείφθηκαν {n} γραμμές χωρίς τιμή", "pl.dup": "Παραλείφθηκαν {n} διπλές γραμμές",
      "pl.price": "Νέες τιμές ({n})", "pl.out": "Δεν διατίθενται πια από τον προμηθευτή ({n})", "pl.fresh": "Δεν υπάρχουν ακόμα στο Απόθεμα ({n})",
      "pl.outHint": "Με τικ: το ελάχιστο και η ποσότητα παραγγελίας γίνονται 0, ώστε η Παραγγελία να μην το ζητά πια. Ό,τι έχεις μένει προς πώληση.",
      "pl.freshHint": "Με τικ: προστίθενται ως προϊόντα με αυτή την τιμή (ποσότητα 0).",
      "pl.cost": "καθαρή {a} → {b}", "pl.costNew": "καθαρή {a}", "pl.all": "Όλα", "pl.none": "Κανένα",
      "pl.more": "…και άλλα {n} (εφαρμόζονται όπως τα τικάρουν τα Όλα / Κανένα)",
      "pl.linkSup": "Τα προϊόντα του καταλόγου να ανήκουν στον {s} ({n} αλλάζουν)",
      "pl.apply": "Εφαρμογή στο Απόθεμα", "pl.nothing": "Δεν έχεις τικάρει τίποτα.", "pl.cancel": "Άκυρο", "pl.close": "Κλείσιμο",
      "pl.done": "Ο τιμοκατάλογος εφαρμόστηκε: {p} τιμές, {o} μη διαθέσιμα, {f} νέα",
      "pl.undone": "Ο τιμοκατάλογος αναιρέθηκε",
      "pl.shopHead": "Το κατάστημά σου", "pl.shopAsk": "{p} νέες τιμές και {f} νέοι τίτλοι μπορούν να πάνε στο κατάστημα. Οι τιμές βρίσκονται με το SKU (ISBN / κωδικό)· οι νέοι τίτλοι γίνονται πρόχειρα που δημοσιεύεις εσύ στο κατάστημα.",
      "pl.shopGo": "Αποστολή στο κατάστημα", "pl.shopBusy": "Αποστολή… {n} από {t}",
      "pl.shopDone": "Κατάστημα: {p} τιμές άλλαξαν, {s} ήταν ήδη σωστές, {f} πρόχειρα φτιάχτηκαν, {e} υπήρχαν ήδη, {x} δεν βρέθηκαν, {b} απέτυχαν.",
      "pl.shopCur": "Το κατάστημα πουλά σε {shop}, το Απόθεμα μετρά σε {mine}: δεν στάλθηκαν τιμές και τα πρόχειρα δεν έχουν τιμή.",
      "pl.shopVar": "{n} είναι μεταβλητά προϊόντα: όρισε τις τιμές τους στο κατάστημα.",
      "pl.shopSale": "{n} έμειναν όπως ήταν: η τιμή προσφοράς τους δεν είναι κάτω από τη νέα τιμή. Άλλαξε πρώτα την προσφορά στο κατάστημα.",
      "pl.acct": "Κατάστημα", "pl.offline": "Είσαι εκτός σύνδεσης.",
      "pl.err": "Το κατάστημα δεν απάντησε ή απέρριψε τα κλειδιά. Έλεγξέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες."
    }
  };

  var api = null, LANG = "en";
  var SHOW = 300;                      // rows drawn per section
  function init(a) {
    api = a;
    LANG = window.orosI18n ? window.orosI18n.lang() : (a.lang === "el" ? "el" : "en");
    if (window.orosI18n && !STR[LANG]) window.orosI18n.table(STR, "stock", LANG);
  }
  function t(k, p) {
    var s = (STR[LANG] || STR.en)[k];
    if (s === undefined) s = STR.en[k] !== undefined ? STR.en[k] : k;
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function el(tag, cls, txt) { return api.el(tag, cls, txt); }
  function btn(label, cls, fn) { return api.button(label, cls, fn); }
  function P() { return window.OrosStockPrices; }
  function links() {
    try { return window.parent && window.parent !== window && window.parent.orosLinks && typeof window.parent.orosLinks.list === "function" ? window.parent.orosLinks : null; }
    catch (e) { return null; }
  }

  function open(a, supId) {
    init(a);
    var sups = (api.data().sups || []).slice().sort(function (x, y) { return x.name.localeCompare(y.name, api.locale); });
    var dlg = api.makeDialog("st-pl", true);
    dlg.classList.add("pl-dlg");
    dlg.appendChild(el("div", "dlg-title", "📄 " + t("pl.title")));
    dlg.appendChild(el("p", "hint", t("pl.hint")));
    var sel = api.selectInput([["", t("pl.noSup")]].concat(sups.map(function (s) { return [s.id, s.name]; })), supId && sups.some(function (s) { return s.id === supId; }) ? supId : (sups[0] ? sups[0].id : ""));
    dlg.appendChild(api.field(t("pl.sup"), sel, "st-pl-sup"));
    var fileRow = el("div", "dlg-actions tight");
    var body = el("div", "pl-body");
    var msg = el("p", "err-msg");
    msg.hidden = true;
    fileRow.appendChild(btn(t("pl.file"), "primary", function () {
      msg.hidden = true;
      api.readRows().then(function (r) {
        if (!r) return;
        if (r.error) { say(t(r.error === "lib" ? "pl.lib" : "pl.bad")); return; }
        var res = P().parse(typeof r.text === "string" ? P().rowsOfText(r.text) : r.rows);
        if (res.error) { say(t("pl.cols")); return; }
        review(res);
      }, function () { say(t("pl.bad")); });
    }));
    dlg.appendChild(fileRow);
    dlg.appendChild(msg);
    dlg.appendChild(body);
    var acts = el("div", "dlg-actions");
    acts.appendChild(btn(t("pl.close"), "", function () { dlg.close(); }));
    var go = btn(t("pl.apply"), "primary", function () { applyNow(); });
    go.hidden = true;
    acts.appendChild(go);
    dlg.appendChild(acts);
    api.showDialog(dlg);

    function say(text) { msg.textContent = text; msg.hidden = false; }
    var cur = null;                  // { res, cmp, pick, link }

    function money(c) { return api.money(c); }
    function section(key, list, rowOf, hint) {
      var sec = el("div", "pl-sec");
      var head = el("div", "pl-head");
      head.appendChild(el("h3", "", t("pl." + key, { n: list.length })));
      var tools = el("span", "pl-tools");
      var boxes = [];
      function setAll(v) {
        list.forEach(function (x) { cur.pick[key][x.id] = v; });
        boxes.forEach(function (b) { b.checked = v; });
      }
      tools.appendChild(btn(t("pl.all"), "small", function () { setAll(true); }));
      tools.appendChild(btn(t("pl.none"), "small", function () { setAll(false); }));
      head.appendChild(tools);
      sec.appendChild(head);
      if (hint) sec.appendChild(el("p", "hint", hint));
      var ul = el("ul", "pl-list");
      list.slice(0, SHOW).forEach(function (x) {
        var r = rowOf(x);
        var li = el("li");
        var lab = el("label", "pl-row");
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = !!cur.pick[key][x.id];
        cb.addEventListener("change", function () { cur.pick[key][x.id] = cb.checked; });
        boxes.push(cb);
        lab.appendChild(cb);
        var b = el("span", "pl-txt");
        b.appendChild(el("span", "pl-name", r.name));
        if (r.sub) b.appendChild(el("span", "pl-sub", r.sub));
        lab.appendChild(b);
        if (r.val) lab.appendChild(el("span", "pl-val", r.val));
        li.appendChild(lab);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      if (list.length > SHOW) sec.appendChild(el("p", "hint", t("pl.more", { n: list.length - SHOW })));
      return sec;
    }

    function review(res) {
      var sid = sel.value;
      var cmp = P().compare(api.data(), res.lines, sid);
      var pick = { price: {}, out: {}, fresh: {} };
      // ids for the pick maps: an item id, or the line's code / name
      cmp.price.forEach(function (r) { r.id = r.item.id; pick.price[r.id] = true; });
      cmp.out.forEach(function (r) { r.id = r.item.id; pick.out[r.id] = true; });
      cmp.fresh.forEach(function (l) { l.id = l.code || l.name; pick.fresh[l.id] = false; });
      cur = { res: res, cmp: cmp, pick: pick, sid: sid, link: null };
      body.innerHTML = "";
      var sum = el("ul", "pl-sum");
      sum.appendChild(el("li", "", t("pl.sum", { n: res.lines.length, m: cmp.matched, s: cmp.same })));
      if (res.skipped) sum.appendChild(el("li", "", t("pl.skip", { n: res.skipped })));
      if (res.dup) sum.appendChild(el("li", "", t("pl.dup", { n: res.dup })));
      body.appendChild(sum);
      if (cmp.price.length) body.appendChild(section("price", cmp.price, function (r) {
        var sub = [r.item.sku || r.line.code];
        if (r.cost !== r.oldCost) sub.push(r.oldCost ? t("pl.cost", { a: money(r.oldCost), b: money(r.cost) }) : t("pl.costNew", { a: money(r.cost) }));
        return { name: r.item.name, sub: sub.filter(Boolean).join(" · "), val: r.now !== r.old ? money(r.old) + " → " + money(r.now) : money(r.now) };
      }));
      if (cmp.out.length) body.appendChild(section("out", cmp.out, function (r) {
        return { name: r.item.name, sub: r.item.sku || r.line.code, val: "" };
      }, t("pl.outHint")));
      if (cmp.fresh.length) body.appendChild(section("fresh", cmp.fresh, function (l) {
        return { name: l.name, sub: [l.code, l.cost ? t("pl.costNew", { a: money(l.cost) }) : ""].filter(Boolean).join(" · "), val: money(l.price) };
      }, t("pl.freshHint")));
      var s = sid ? (api.data().sups || []).filter(function (x) { return x.id === sid; })[0] : null;
      if (s && cmp.link.length) {
        cur.link = api.checkRow(t("pl.linkSup", { s: s.name, n: cmp.link.length }), true);
        body.appendChild(cur.link);
      }
      go.hidden = false;
      go.disabled = false;
    }

    function count(m) { return Object.keys(m).filter(function (k) { return m[k]; }).length; }
    function applyNow() {
      if (!cur) return;
      var link = !!(cur.link && cur.link.querySelector("input").checked);
      var np = count(cur.pick.price), no = count(cur.pick.out), nf = count(cur.pick.fresh);
      if (!np && !no && !nf && !link) { say(t("pl.nothing")); return; }
      // compared again against the data as it is now (a sync may have landed)
      var cmp = P().compare(api.data(), cur.res.lines, cur.sid);
      cmp.price.forEach(function (r) { r.id = r.item.id; });
      cmp.out.forEach(function (r) { r.id = r.item.id; });
      var out = P().apply(api.data(), cmp, cur.pick, { supId: cur.sid, link: link, now: Date.now(), newId: api.newId });
      var jobs = P().shopJobs(cmp, cur.pick);
      api.setData(out.data);
      var info = out.undo, used = false;
      api.actionToast(t("pl.done", { p: np, o: no, f: info.added.length }), null, null, function () {
        if (used) return;
        used = true;
        api.setData(P().undo(api.data(), info, Date.now()));
        api.toast(t("pl.undone"));
      });
      go.hidden = true;
      cur = null;
      body.innerHTML = "";
      shopStep(jobs);
    }

    function shopStep(jobs) {
      var Lk = links(), accts = Lk ? Lk.list("woo") : [];
      if (!jobs.length || !accts.length) return;
      var box = el("div", "pl-shop");
      box.appendChild(el("h3", "", "🛍️ " + t("pl.shopHead")));
      var np = jobs.filter(function (j) { return j.k === "price"; }).length;
      box.appendChild(el("p", "hint", t("pl.shopAsk", { p: np, f: jobs.length - np })));
      var pickA = api.selectInput(accts.map(function (x) { return [x.id, x.name]; }), accts[0].id);
      if (accts.length > 1) box.appendChild(api.field(t("pl.acct"), pickA, "st-pl-acct"));
      var st = el("p", "pl-msg");
      var send = btn(t("pl.shopGo"), "primary", function () {
        send.disabled = true;
        runShop(Lk, pickA.value, jobs, function (text) { st.textContent = text; }).then(function () {}, function (e) {
          st.textContent = t(e && e.code === "offline" ? "pl.offline" : "pl.err");
          send.disabled = false;
        });
      });
      box.appendChild(el("div", "dlg-actions tight").appendChild(send).parentNode);
      box.appendChild(st);
      body.appendChild(box);
    }
  }

  // ---------- Sending to a WooCommerce shop ----------
  function ok(x) { return x && x.status >= 200 && x.status < 300; }
  function chunks(list, n) { var out = []; for (var i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; }
  function price2(c) { return (c / 100).toFixed(2); }
  function shopCents(v) {
    var n = typeof v === "string" && /^[0-9]{1,10}(\.[0-9]{1,6})?$/.test(v) ? parseFloat(v) : NaN;
    return isFinite(n) ? Math.round(n * 100) : null;
  }
  function runShop(Lk, acct, jobs, say) {
    var n = { p: 0, s: 0, f: 0, e: 0, x: 0, b: 0, v: 0, sp: 0 }, done = 0, total = jobs.length, samePrice = true, shopCur = "";
    var mine = (api.data().settings && api.data().settings.cur) || "EUR";
    function step() { say(t("pl.shopBusy", { n: done, t: total })); }
    function fail(x) { var c = Lk.statusCode(x); if (c === "auth" || c === "offline" || c === "relay" || c === "keys" || c === "gone") throw { code: c }; }
    step();
    return Lk.call(acct, [{ m: "GET", path: "/data/currencies/current" }]).then(function (res) {
      var c = Lk.statusCode(res[0]);
      if (c) throw { code: c };
      shopCur = res[0].data && typeof res[0].data.code === "string" ? res[0].data.code : "";
      samePrice = !shopCur || shopCur === mine;
      var found = {};
      // find every code in the shop, ten at a time
      return chunks(jobs, 10).reduce(function (pr, part) {
        return pr.then(function () {
          return Lk.call(acct, part.map(function (j) { return { m: "GET", path: "/products?sku=" + encodeURIComponent(j.code) }; })).then(function (rs) {
            part.forEach(function (j, i) {
              fail(rs[i]);
              var list = ok(rs[i]) && Array.isArray(rs[i].data) ? rs[i].data : [];
              found[j.code] = list.filter(function (p) { return p && typeof p.id === "number" && p.id > 0 && String(p.sku || "") === j.code; })[0] || null;
            });
          });
        });
      }, Promise.resolve()).then(function () { return found; });
    }).then(function (found) {
      var puts = [], posts = [];
      jobs.forEach(function (j) {
        var p = found[j.code];
        if (j.k === "price") {
          if (!samePrice) { done++; return; }
          if (!p) { n.x++; done++; return; }
          if (p.type === "variable") { n.v++; done++; return; }
          if (shopCents(p.regular_price) === j.price) { n.s++; done++; return; }
          // a sale price at or above the new price would show as an odd "sale": left to the person
          var sale = shopCents(p.sale_price);
          if (sale !== null && sale > 0 && sale >= j.price) { n.sp++; done++; return; }
          var path = p.parent_id > 0 ? "/products/" + p.parent_id + "/variations/" + p.id : "/products/" + p.id;
          puts.push({ m: "PUT", path: path, body: { regular_price: price2(j.price) } });
        } else {
          if (p) { n.e++; done++; return; }
          var b = { name: j.name, type: "simple", status: "draft", sku: j.code, manage_stock: true };
          if (samePrice && j.price > 0) b.regular_price = price2(j.price);
          posts.push(b);
        }
      });
      step();
      return chunks(puts, 10).reduce(function (pr, part) {
        return pr.then(function () {
          return Lk.call(acct, part).then(function (rs) {
            part.forEach(function (r, i) { fail(rs[i]); if (ok(rs[i])) n.p++; else n.b++; done++; });
            step();
          });
        });
      }, Promise.resolve()).then(function () {
        // a new product is not idempotent: one per call, one after the other
        return posts.reduce(function (pr, b) {
          return pr.then(function () {
            return Lk.call(acct, [{ m: "POST", path: "/products", body: b }]).then(function (rs) {
              fail(rs[0]);
              if (ok(rs[0]) && rs[0].data && rs[0].data.id > 0) n.f++; else n.b++;
              done++;
              step();
            });
          });
        }, Promise.resolve());
      });
    }).then(function () {
      var text = t("pl.shopDone", n);
      if (!samePrice) text += " " + t("pl.shopCur", { shop: shopCur, mine: mine });
      if (n.v) text += " " + t("pl.shopVar", { n: n.v });
      if (n.sp) text += " " + t("pl.shopSale", { n: n.sp });
      say(text);
    });
  }

  window.OrosStockPriceList = { open: open, STR: STR };
})();
