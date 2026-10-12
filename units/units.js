// ============================================================
// orOS Unit Converter — App logic (v1.0.0)
// Everyday conversions, fifteen categories (units/core.js):
// length, weight, volume, temperature, area, speed, cooking (with
// an ingredient for cups ⇄ grams), time, data, fuel economy,
// pressure, energy, power, angle and currency.
//   - Two fields: type in either one, the other follows live; ⇄
//     swaps the units; the formula line says what was done
//   - Unit picker with search (both languages, symbols, plurals)
//   - All units: the value in every unit of the category; tap a
//     row to copy it
//   - Favourites (☆ on a pair) and Recent (the last 20)
//   - Numbers: comma or point, simple sums (2,5*3), no eval;
//     precision 2-12 significant digits (Settings)
//   - Currency: ECB reference rates through Frankfurter, fetched
//     only for Currency (at most every 6 h, or Update rates),
//     kept on the device for offline use
// Data:
//   - synced slice "units" (oros-units-data): favourites, recent,
//     precision (R5, R17, R26)
//   - device-local (R10): oros-units-prefs (category, pair per
//     category, ingredient, All units open), oros-units-rates
// Deep link: __orosOpenAt("units", { cat, from, to, value })
// (universal search, other apps).
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. Converting
//   4. Rendering: categories, card, lists
//   5. Unit picker
//   6. Favourites + recent
//   7. Currency rates
//   8. Settings, toasts, copy
//   9. Keyboard (Contract Β)
//  10. Sync slice + palette + deep link
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C           = window.UnitsCore;
  var STORAGE_KEY = C.DATA_KEY;
  var PREFS_KEY   = C.PREFS_KEY;
  var RATES_KEY   = C.RATES_KEY;
  var RECENT_MS   = 1500;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var LOCALE = LANG === "el" ? "el-GR" : "en-GB";

  var STRINGS = {
    en: {
      "app.name": "Unit Converter",
      "btn.more": "Converter settings", "btn.close": "Close", "btn.swap": "Swap units",
      "btn.star": "Add this pair to favourites", "btn.unstar": "Remove this pair from favourites",
      "btn.copy": "Copy the result", "btn.clear": "Clear",
      "all.hide": "Hide", "all.show": "Show",
      "f.from": "From", "f.to": "To", "f.ing": "Ingredient", "f.find": "Find a unit",
      "ph.find": "Find a unit (name or symbol)",
      "sec.favs": "Favourites", "sec.recent": "Recent", "sec.all": "All units",
      "sec.prec": "Precision", "sec.fx": "Exchange rates",
      "pick.from": "Convert from", "pick.to": "Convert to", "pick.none": "No unit by that name.",
      "g.m": "Metric", "g.i": "Imperial and US", "g.o": "Other",
      "err.parse": "That is not a number. Use digits, a comma or a point, and + − × ÷ if you like.",
      "err.neg": "There are no negative values here.",
      "err.belowZero": "That is below absolute zero (−273.15 °C).",
      "err.zero": "Zero has no counterpart in this unit.",
      "err.rate": "No exchange rate for this currency yet.",
      "err.dens": "Pick an ingredient first.",
      "f.rule": "Rule", "f.approx": "{ing}, approximate",
      "ing.hint": "Kitchen weights per cup or spoon are approximate.",
      "fx.refresh": "Update rates", "fx.loading": "Updating the rates…",
      "fx.none": "No exchange rates on this device yet. Connect to the internet and tap Update rates.",
      "fx.info": "ECB reference rates of {date} · updated {ago}",
      "fx.offline": "Offline: the rates of {date} are used.",
      "fx.fail": "Could not update the rates.",
      "fx.updated": "Exchange rates updated",
      "fx.about": "Currencies use the euro reference rates of the European Central Bank, through Frankfurter (frankfurter.dev). orOS asks for them only when you open Currency (at most every 6 hours) or tap Update rates; nothing about you is sent. The rates stay on this device, so currencies also work offline with the last rates. ECB rates are published on working days, around 16:00 CET; they are for information, not for trading.",
      "prec.label": "Significant digits in results", "prec.opt": "{n} digits",
      "prec.hint": "Results are rounded to this many significant digits. Syncs between your devices.",
      "more.title": "Converter settings",
      "toast.copied": "Copied", "toast.fav": "Added to favourites", "toast.unfav": "Removed from favourites",
      "toast.cleared": "Recent conversions cleared", "toast.undo": "Undo",
      "toast.saveFail": "Could not save: storage is full", "toast.copyFail": "Could not copy",
      "aria.row": "{name}: {value}. Tap to copy.", "aria.fav": "{from} to {to}",
      "aria.unit": "Unit: {name}"
    },
    el: {
      "app.name": "Μετατροπέας μονάδων",
      "btn.more": "Ρυθμίσεις μετατροπέα", "btn.close": "Κλείσιμο", "btn.swap": "Αντιμετάθεση μονάδων",
      "btn.star": "Προσθήκη του ζεύγους στα αγαπημένα", "btn.unstar": "Αφαίρεση του ζεύγους από τα αγαπημένα",
      "btn.copy": "Αντιγραφή του αποτελέσματος", "btn.clear": "Καθαρισμός",
      "all.hide": "Απόκρυψη", "all.show": "Εμφάνιση",
      "f.from": "Από", "f.to": "Σε", "f.ing": "Υλικό", "f.find": "Αναζήτηση μονάδας",
      "ph.find": "Βρες μονάδα (όνομα ή σύμβολο)",
      "sec.favs": "Αγαπημένα", "sec.recent": "Πρόσφατα", "sec.all": "Όλες οι μονάδες",
      "sec.prec": "Ακρίβεια", "sec.fx": "Ισοτιμίες",
      "pick.from": "Μετατροπή από", "pick.to": "Μετατροπή σε", "pick.none": "Δεν υπάρχει μονάδα με αυτό το όνομα.",
      "g.m": "Μετρικό σύστημα", "g.i": "Αγγλοσαξονικές και ΗΠΑ", "g.o": "Άλλες",
      "err.parse": "Αυτό δεν είναι αριθμός. Γράψε ψηφία, κόμμα ή τελεία, και αν θες + − × ÷.",
      "err.neg": "Εδώ δεν υπάρχουν αρνητικές τιμές.",
      "err.belowZero": "Αυτό είναι κάτω από το απόλυτο μηδέν (−273,15 °C).",
      "err.zero": "Το μηδέν δεν έχει αντιστοιχία σε αυτή τη μονάδα.",
      "err.rate": "Δεν υπάρχει ακόμα ισοτιμία για αυτό το νόμισμα.",
      "err.dens": "Διάλεξε πρώτα υλικό.",
      "f.rule": "Κανόνας", "f.approx": "{ing}, κατά προσέγγιση",
      "ing.hint": "Τα βάρη ανά φλιτζάνι ή κουτάλι στην κουζίνα είναι κατά προσέγγιση.",
      "fx.refresh": "Ενημέρωση ισοτιμιών", "fx.loading": "Ενημέρωση ισοτιμιών…",
      "fx.none": "Δεν υπάρχουν ακόμα ισοτιμίες σε αυτή τη συσκευή. Σύνδεσου στο διαδίκτυο και πάτα «Ενημέρωση ισοτιμιών».",
      "fx.info": "Ισοτιμίες αναφοράς ΕΚΤ της {date} · ενημέρωση {ago}",
      "fx.offline": "Χωρίς σύνδεση: χρησιμοποιούνται οι ισοτιμίες της {date}.",
      "fx.fail": "Οι ισοτιμίες δεν ενημερώθηκαν.",
      "fx.updated": "Οι ισοτιμίες ενημερώθηκαν",
      "fx.about": "Τα νομίσματα χρησιμοποιούν τις ισοτιμίες αναφοράς του ευρώ της Ευρωπαϊκής Κεντρικής Τράπεζας, μέσω του Frankfurter (frankfurter.dev). Το orOS τις ζητά μόνο όταν ανοίγεις τα Νομίσματα (το πολύ κάθε 6 ώρες) ή όταν πατάς «Ενημέρωση ισοτιμιών»· δεν στέλνεται τίποτα για σένα. Οι ισοτιμίες μένουν σε αυτή τη συσκευή, οπότε τα νομίσματα δουλεύουν και χωρίς σύνδεση με τις τελευταίες. Η ΕΚΤ τις δημοσιεύει τις εργάσιμες, γύρω στις 17:00 ώρα Ελλάδας· είναι ενημερωτικές, όχι για συναλλαγές.",
      "prec.label": "Σημαντικά ψηφία στα αποτελέσματα", "prec.opt": "{n} ψηφία",
      "prec.hint": "Τα αποτελέσματα στρογγυλεύονται σε τόσα σημαντικά ψηφία. Συγχρονίζεται στις συσκευές σου.",
      "more.title": "Ρυθμίσεις μετατροπέα",
      "toast.copied": "Αντιγράφηκε", "toast.fav": "Προστέθηκε στα αγαπημένα", "toast.unfav": "Αφαιρέθηκε από τα αγαπημένα",
      "toast.cleared": "Τα πρόσφατα καθαρίστηκαν", "toast.undo": "Αναίρεση",
      "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.copyFail": "Η αντιγραφή απέτυχε",
      "aria.row": "{name}: {value}. Πάτα για αντιγραφή.", "aria.fav": "{from} σε {to}",
      "aria.unit": "Μονάδα: {name}"
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
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function setLabel(b, label) { b.setAttribute("aria-label", label); b.title = label; }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("units.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = C.emptyData();
  var prefs = null;
  var rates = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") { data = C.mergeData(parsed, parsed); return; }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] units: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = C.emptyData();
  }

  var saveFailShown = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.saveFail")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function loadPrefs() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    prefs = C.readPrefs(raw);
    try { rates = C.storedRates(JSON.parse(localStorage.getItem(RATES_KEY) || "null")); } catch (e) { rates = null; }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 3. Converting ----------
  var catId = "length";
  var pair = { f: "km", t: "mi" };
  var side = "a";               // the field typed in last
  var recentTimer = null;

  function opts() {
    var ing = C.ingredient(prefs.ing);
    return { rates: rates, dens: ing ? ing[1] : 1 };
  }
  function prec() { return C.precOf(data); }
  function fmtOut(v) { return C.formatNumber(v, prec(), LANG, false); }
  function fmtShow(v) { return C.formatNumber(v, prec(), LANG, true); }
  function curUnit(id) { return C.unit(catId, id, rates); }
  function symOf(id) { var u = curUnit(id); return u ? u.sym : id; }
  function nameOf(id) { var u = curUnit(id); return u ? C.unitName(u, LANG) : id; }

  // The typed value: { ok, v } from the field typed in last.
  function typed() {
    return C.parseInput($(side === "a" ? "va" : "vb").value, LANG);
  }
  // The value expressed in the From unit (for All units and the formula).
  function fromValue() {
    var p = typed();
    if (!p.ok) return null;
    if (side === "a") return p.v;
    var r = C.convert(catId, pair.t, pair.f, p.v, opts());
    return r.ok ? r.v : null;
  }

  function recompute() {
    var src = side === "a" ? $("va") : $("vb"), dst = side === "a" ? $("vb") : $("va");
    var p = C.parseInput(src.value, LANG), err = "";
    src.classList.remove("bad");
    if (p.empty) dst.value = "";
    else if (!p.ok) { dst.value = ""; err = t("err.parse"); src.classList.add("bad"); }
    else {
      var r = side === "a" ? C.convert(catId, pair.f, pair.t, p.v, opts()) : C.convert(catId, pair.t, pair.f, p.v, opts());
      if (r.ok) dst.value = fmtOut(r.v);
      else { dst.value = ""; err = t("err." + r.err); src.classList.add("bad"); }
    }
    dst.classList.remove("bad");
    $("err").hidden = !err;
    $("err").textContent = err;
    renderFormula();
    renderAll();
  }

  function onField(which) {
    side = which;
    recompute();
    clearTimeout(recentTimer);
    recentTimer = setTimeout(commitRecent, RECENT_MS);
  }

  function setPair(f, t2) {
    pair = { f: f, t: t2 };
    prefs.pairs[catId] = { f: f, t: t2 };
    prefs.cat = catId;
    savePrefs();
    renderCard();
    recompute();
  }

  function swap() {
    var a = $("va").value, b = $("vb").value;
    pair = { f: pair.t, t: pair.f };
    prefs.pairs[catId] = { f: pair.f, t: pair.t };
    savePrefs();
    // The value typed stays in its field; the units trade places.
    if (side === "a") { $("va").value = a; } else { $("vb").value = b; }
    renderCard();
    recompute();
  }

  function setCat(id, keepValue) {
    if (!C.cat(id)) id = "length";
    flushRecent();
    var keep = keepValue !== undefined ? keepValue : (typed().ok ? $(side === "a" ? "va" : "vb").value : "1");
    catId = id;
    prefs.cat = id;
    var p = C.pairOf(prefs, id);
    if (!curUnit(p.f) || !curUnit(p.t)) p = { f: C.cat(id).def[0], t: C.cat(id).def[1] };
    pair = p;
    savePrefs();
    side = "a";
    $("va").value = keep;
    renderCats();
    renderCard();
    recompute();
    if (id === "currency") maybeFetchRates(false);
  }

  // ---------- 4. Rendering: categories, card, lists ----------
  function renderHead() {
    $("title-view").textContent = t("app.name");
    $("title-sub").textContent = C.catName(C.cat(catId), LANG);
  }

  function renderCats() {
    var host = $("cats");
    host.innerHTML = "";
    C.CATS.forEach(function (c) {
      var on = c.id === catId;
      var b = el("button", "chip", C.catName(c, LANG));
      b.type = "button";
      b.id = "cat-" + c.id;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      b.addEventListener("click", function () { setCat(c.id); });
      host.appendChild(b);
    });
    var cur = $("cat-" + catId);
    if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {} }
    renderHead();
  }

  function fillUnitBtn(b, id, which) {
    b.innerHTML = "";
    b.appendChild(el("span", "u-sym", symOf(id)));
    b.appendChild(el("span", "u-name", nameOf(id)));
    setLabel(b, (which === "a" ? t("f.from") : t("f.to")) + ". " + t("aria.unit", { name: nameOf(id) }));
  }

  function renderCard() {
    fillUnitBtn($("ua"), pair.f, "a");
    fillUnitBtn($("ub"), pair.t, "b");
    var fav = C.isFav(data, catId, pair.f, pair.t);
    $("star").setAttribute("aria-pressed", fav ? "true" : "false");
    setLabel($("star"), fav ? t("btn.unstar") : t("btn.star"));
    var c = C.cat(catId);
    var dens = !!c.dens;
    $("ing-row").hidden = !dens;
    if (dens) $("ing").value = prefs.ing;
    $("fx-row").hidden = !c.money;
    if (c.money) renderFx();
    renderFavs();
    renderRecent();
  }

  function ingName(id) { var g = C.ingredient(id); return g ? (LANG === "el" ? g[3] : g[2]) : ""; }

  function renderFormula() {
    var line = "", o = opts();
    if (catId === "temp") {
      var z = C.convert("temp", pair.f, pair.t, 0, o), h = C.convert("temp", pair.f, pair.t, 100, o);
      if (z.ok && h.ok) {
        line = "0 " + symOf(pair.f) + " = " + fmtShow(z.v) + " " + symOf(pair.t) +
               " · 100 " + symOf(pair.f) + " = " + fmtShow(h.v) + " " + symOf(pair.t);
      }
    } else if (catId === "fuel") {
      var r10 = C.convert("fuel", pair.f, pair.t, 10, o);
      if (r10.ok) line = "10 " + symOf(pair.f) + " = " + fmtShow(r10.v) + " " + symOf(pair.t);
    } else {
      var k = C.factorOf(catId, pair.f, pair.t, o);
      if (k !== null) {
        line = "1 " + symOf(pair.f) + " = " + fmtShow(k) + " " + symOf(pair.t);
        if (C.needsDensity(catId, pair.f, pair.t)) {
          line += " (" + t("f.approx", { ing: ingName(prefs.ing) }) + ")";
        }
      }
    }
    $("formula").textContent = line;
  }

  function renderAll() {
    var open = prefs.all;
    $("all-toggle").textContent = open ? t("all.hide") : t("all.show");
    $("all-toggle").setAttribute("aria-expanded", open ? "true" : "false");
    $("all-title").textContent = t("sec.all") + " · " + C.catName(C.cat(catId), LANG);
    var host = $("all");
    host.hidden = !open;
    host.innerHTML = "";
    if (!open) return;
    var v = fromValue(), o = opts();
    C.unitsOf(catId, rates).forEach(function (u) {
      var r = v === null ? null : C.convert(catId, pair.f, u.id, v, o);
      var b = el("button", "row" + (u.id === pair.t ? " cur" : ""));
      b.type = "button";
      b.appendChild(el("span", "row-name", C.unitName(u, LANG)));
      var val = el("span", "row-val", r && r.ok ? fmtShow(r.v) : "—");
      val.appendChild(el("small", "", u.sym));
      b.appendChild(val);
      if (r && r.ok) {
        b.setAttribute("aria-label", t("aria.row", { name: C.unitName(u, LANG), value: fmtShow(r.v) + " " + u.sym }));
        b.addEventListener("click", function () { copyText(fmtOut(r.v)); });
      } else b.disabled = true;
      var li = el("li");
      li.appendChild(b);
      host.appendChild(li);
    });
  }

  // ---------- 5. Unit picker ----------
  var pickSide = null, lastFocus = null;

  function openPicker(which) {
    pickSide = which;
    lastFocus = document.activeElement;
    $("picker-title").textContent = which === "a" ? t("pick.from") : t("pick.to");
    $("pq").value = "";
    renderPicker();
    $("picker").hidden = false; $("scrim").hidden = false;
    $("pq").focus();
  }
  function closeDialogs() {
    var was = !$("picker").hidden || !$("more").hidden;
    $("picker").hidden = true; $("more").hidden = true; $("scrim").hidden = true;
    pickSide = null;
    if (was && lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function renderPicker() {
    var list = C.matchUnits(C.unitsOf(catId, rates), $("pq").value);
    var host = $("plist"), cur = pickSide === "a" ? pair.f : pair.t, grp = null;
    host.innerHTML = "";
    var money = !!C.cat(catId).money;
    // Metric, then imperial / US, then other (currencies: one list).
    var order = { m: 0, i: 1, o: 2 };
    list = list.slice().sort(function (x, y) { return money ? 0 : order[x.g] - order[y.g]; });
    list.forEach(function (u) {
      if (!money && u.g !== grp) {
        grp = u.g;
        host.appendChild(el("li", "grp")).appendChild(el("h3", "", t("g." + u.g)));
      }
      var b = el("button", "row" + (u.id === cur ? " on" : ""));
      b.type = "button";
      b.setAttribute("aria-current", u.id === cur ? "true" : "false");
      b.appendChild(el("span", "row-main", C.unitName(u, LANG)));
      b.appendChild(el("span", "row-sym", u.sym));
      b.addEventListener("click", function () { pickUnit(u.id); });
      var li = el("li");
      li.appendChild(b);
      host.appendChild(li);
    });
    $("pempty").hidden = list.length > 0;
  }
  function pickUnit(id) {
    var which = pickSide;
    closeDialogs();
    if (which === "a") {
      if (id === pair.t) setPair(id, pair.f); else setPair(id, pair.t);       // picking the other side swaps
    } else if (which === "b") {
      if (id === pair.f) setPair(pair.t, id); else setPair(pair.f, id);
    }
  }

  // ---------- 6. Favourites + recent ----------
  function pairLabel(c, f, t2) {
    var a = C.unit(c, f, rates), b = C.unit(c, t2, rates);
    return (a ? a.sym : f) + " → " + (b ? b.sym : t2);
  }

  function renderFavs() {
    var list = C.favList(data), host = $("favs");
    $("favs-sec").hidden = !list.length;
    host.innerHTML = "";
    list.forEach(function (p) {
      var on = p.c === catId && p.f === pair.f && p.t === pair.t;
      var b = el("button", "chip" + (on ? " on" : ""), pairLabel(p.c, p.f, p.t));
      b.type = "button";
      var a = C.unit(p.c, p.f, rates), z = C.unit(p.c, p.t, rates);
      b.title = C.catName(C.cat(p.c), LANG) + ": " + t("aria.fav", { from: a ? C.unitName(a, LANG) : p.f, to: z ? C.unitName(z, LANG) : p.t });
      b.addEventListener("click", function () { openPair(p.c, p.f, p.t); });
      host.appendChild(b);
    });
  }

  function openPair(c, f, t2, value) {
    if (c !== catId) setCat(c, value !== undefined ? value : undefined);
    if (value !== undefined) { side = "a"; $("va").value = value; }
    if (curUnit(f) || C.cat(c).money) setPair(f, t2);
    else recompute();
  }

  function toggleStar() {
    var was = C.isFav(data, catId, pair.f, pair.t);
    data = C.toggleFav(data, catId, pair.f, pair.t, Date.now());
    save();
    renderCard();
    showToast(was ? t("toast.unfav") : t("toast.fav"));
  }

  function commitRecent() {
    recentTimer = null;
    var p = typed();
    if (!p.ok) return;
    var f = side === "a" ? pair.f : pair.t, to = side === "a" ? pair.t : pair.f;
    var r = C.convert(catId, f, to, p.v, opts());
    if (!r.ok) return;
    var before = JSON.stringify(data.recent);
    data = C.addRecent(data, catId, f, to, p.v, Date.now(), prefs.ing);
    if (JSON.stringify(data.recent) === before) return;
    save();
    renderRecent();
  }
  function flushRecent() { if (recentTimer) { clearTimeout(recentTimer); commitRecent(); } }

  function renderRecent() {
    var list = C.recentList(data), host = $("recent");
    $("recent-sec").hidden = !list.length;
    host.innerHTML = "";
    list.forEach(function (p) {
      var a = C.unit(p.c, p.f, rates), z = C.unit(p.c, p.t, rates);
      var o = opts();
      if (p.i) o.dens = C.ingredient(p.i)[1];
      var r = C.convert(p.c, p.f, p.t, p.v, o);
      var b = el("button", "row");
      b.type = "button";
      var main = fmtShow(p.v) + " " + (a ? a.sym : p.f) + " → " + (r.ok ? fmtShow(r.v) + " " : "") + (z ? z.sym : p.t);
      b.appendChild(el("span", "row-main", main));
      b.appendChild(el("span", "row-cat", C.catName(C.cat(p.c), LANG) + (p.i ? " · " + ingName(p.i) : "")));
      if (p.i) b.title = ingName(p.i);
      b.addEventListener("click", function () {
        if (p.i && p.i !== prefs.ing) { prefs.ing = p.i; savePrefs(); }
        openPair(p.c, p.f, p.t, fmtOut(p.v));
      });
      var li = el("li");
      li.appendChild(b);
      host.appendChild(li);
    });
  }

  function clearRecent() {
    var old = C.recentList(data);
    if (!old.length) return;
    clearTimeout(recentTimer); recentTimer = null;
    data = C.clearRecent(data, Date.now());
    save();
    renderRecent();
    undoToast(t("toast.cleared"), function () {
      var now = Date.now();
      old.slice().reverse().forEach(function (p, i) {             // oldest first, so the order comes back
        data = C.addRecent(data, p.c, p.f, p.t, p.v, now + i, p.i);   // R17: newer than the tombstones
      });
      save();
      renderRecent();
    });
  }

  // ---------- 7. Currency rates ----------
  var fetching = false, fxFailed = false;

  function relAgo(ms) {
    var s = Math.round((Date.now() - ms) / 1000);
    try {
      var rf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
      if (s < 60) return rf.format(0, "second");
      if (s < 3600) return rf.format(-Math.round(s / 60), "minute");
      if (s < 86400) return rf.format(-Math.round(s / 3600), "hour");
      return rf.format(-Math.round(s / 86400), "day");
    } catch (e) { return ""; }
  }
  function rateDate(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
    if (!m) return ymd || "";
    try { return new Date(+m[1], +m[2] - 1, +m[3], 12).toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" }); }
    catch (e) { return ymd; }
  }

  function renderFx() {
    var info = $("fx-info");
    $("fx-btn").disabled = fetching;
    if (fetching) { info.textContent = t("fx.loading"); return; }
    if (!rates) { info.textContent = fxFailed ? t("fx.fail") + " " + t("fx.none") : t("fx.none"); return; }
    var line = t("fx.info", { date: rateDate(rates.date), ago: relAgo(rates.at) });
    if (navigator.onLine === false) line += " " + t("fx.offline", { date: rateDate(rates.date) });
    else if (fxFailed) line += " " + t("fx.fail");
    info.textContent = line;
  }

  function fetchJSON(url) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 10000);
    return fetch(url, { cache: "no-store", credentials: "omit", signal: ctl ? ctl.signal : undefined })
      .then(function (res) { clearTimeout(timer); if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); },
            function (e) { clearTimeout(timer); throw e; });
  }

  function fetchRates(manual) {
    if (fetching) return;
    fetching = true; fxFailed = false;
    if (catId === "currency") renderFx();
    var urls = C.RATES_URLS.slice();
    function next() {
      var url = urls.shift();
      if (!url) return Promise.reject(new Error("no source"));
      return fetchJSON(url).then(function (json) {
        var r = C.readRates(json, Date.now(), url);
        if (!r) throw new Error("bad reply");
        return r;
      }).catch(function () { return next(); });
    }
    next().then(function (r) {
      fetching = false;
      rates = r;
      try { localStorage.setItem(RATES_KEY, JSON.stringify(r)); } catch (e) {}
      if (catId === "currency") {
        if (!curUnit(pair.f) || !curUnit(pair.t)) pair = { f: "EUR", t: "USD" };
        renderCard(); recompute();
      } else renderRecent();
      renderFavs();
      if (manual) showToast(t("fx.updated"));
    }, function () {
      fetching = false; fxFailed = true;
      if (catId === "currency") renderFx();
      if (manual) showToast(t("fx.fail"));
    });
  }
  function maybeFetchRates(manual) {
    if (manual || (C.ratesStale(rates, Date.now()) && navigator.onLine !== false)) fetchRates(manual);
  }

  // ---------- 8. Settings, toasts, copy ----------
  function openMore() {
    lastFocus = document.activeElement;
    var sel = $("prec");
    sel.innerHTML = "";
    for (var n = C.PREC_MIN; n <= C.PREC_MAX; n++) {
      var o = el("option", "", t("prec.opt", { n: n }));
      o.value = String(n);
      sel.appendChild(o);
    }
    sel.value = String(prec());
    $("more").hidden = false; $("scrim").hidden = false;
    $("more-close").focus();
  }
  function onPrec() {
    var next = C.setPrec(data, parseInt($("prec").value, 10), Date.now());
    if (JSON.stringify(next) === JSON.stringify(data)) return;
    data = next;
    save();
    recompute();
    renderRecent();
  }

  function copyText(text) {
    if (!text) return;
    var done = function () { showToast(t("toast.copied")); };
    var fail = function () {
      try {
        var ta = el("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        ta.remove();
        showToast(ok ? t("toast.copied") : t("toast.copyFail"));
      } catch (e) { showToast(t("toast.copyFail")); }
    };
    try { navigator.clipboard.writeText(text).then(done, fail); } catch (e) { fail(); }
  }
  function copyResult() {
    var v = $(side === "a" ? "vb" : "va").value;
    if (v) copyText(v);
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "units", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
  }

  // ---------- 9. Keyboard ----------
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
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && (!$("picker").hidden || !$("more").hidden)) { e.preventDefault(); closeDialogs(); return; }
      if (e.key === "Escape" && (e.target === $("va") || e.target === $("vb")) && e.target.value) {
        e.preventDefault();
        e.target.value = "";
        onField(e.target === $("va") ? "a" : "b");
      }
    });
    $("pq").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = $("plist").querySelector("button.row");
        if (first) { e.preventDefault(); first.click(); }
      } else if (e.key === "ArrowDown") {
        var b = $("plist").querySelector("button.row");
        if (b) { e.preventDefault(); b.focus(); }
      }
    });
    $("plist").addEventListener("keydown", function (e) {
      var d = e.key === "ArrowDown" ? 1 : (e.key === "ArrowUp" ? -1 : 0);
      if (!d) return;
      e.preventDefault();
      var btns = [].slice.call($("plist").querySelectorAll("button.row")), i = btns.indexOf(document.activeElement);
      if (i + d < 0) { $("pq").focus(); return; }
      if (btns[i + d]) btns[i + d].focus();
    });
    $("cats").addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : (e.key === "ArrowLeft" ? -1 : 0);
      if (!d) return;
      e.preventDefault();
      var ids = C.CATS.map(function (c) { return c.id; });
      var next = ids[(ids.indexOf(catId) + d + ids.length) % ids.length];
      setCat(next);
      $("cat-" + next).focus();
    });
    ["va", "vb"].forEach(function (id) {
      $(id).addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); flushRecent(); }
      });
    });
  }

  // ---------- 10. Sync slice + palette + deep link ----------
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
    api.registerSlice("units", sliceGet, sliceSet, STORAGE_KEY, C.mergeData);
  }

  function sliceGet() { flushRecent(); return C.mergeData(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object") return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeData(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    renderCard();                            // the fields keep what is being typed
    recompute();
  }

  // Deep link: { cat, from, to, value } (universal search, other apps).
  function openTarget(target) {
    if (!target || typeof target !== "object" || !C.cat(target.cat)) return;
    var value = typeof target.value === "number" && isFinite(target.value) ? fmtOut(target.value) :
                (typeof target.value === "string" && target.value.length < 60 ? target.value : undefined);
    closeDialogs();
    setCat(target.cat, value);
    var f = typeof target.from === "string" ? target.from : pair.f;
    var to = typeof target.to === "string" && target.to !== f ? target.to : (f === pair.t ? pair.f : pair.t);
    var money = !!C.cat(target.cat).money;
    if ((curUnit(f) || (money && /^[A-Z]{3}$/.test(f))) && (curUnit(to) || (money && /^[A-Z]{3}$/.test(to)))) setPair(f, to);
    $("va").focus();
  }
  window.__orosOpenAt = function (target) { openTarget(target); };

  // ---------- 11. Wiring & boot ----------
  var ICON = {
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16"/><path d="M3 8l4-4 4 4"/><path d="M17 20V4"/><path d="M21 16l-4 4-4-4"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app.name") + " · orOS";
    $("swap").innerHTML = ICON.swap; setLabel($("swap"), t("btn.swap"));
    $("star").innerHTML = ICON.star;
    $("copy").innerHTML = ICON.copy; setLabel($("copy"), t("btn.copy"));
    $("more-btn").innerHTML = ICON.more; setLabel($("more-btn"), t("btn.more"));
    $("more-close").innerHTML = ICON.close; setLabel($("more-close"), t("btn.close"));
    $("picker-close").innerHTML = ICON.close; setLabel($("picker-close"), t("btn.close"));
    $("pq").placeholder = t("ph.find");
    var sel = $("ing");
    sel.innerHTML = "";
    C.INGREDIENTS.forEach(function (g) {
      var o = el("option", "", LANG === "el" ? g[3] : g[2]);
      o.value = g[0];
      sel.appendChild(o);
    });
  }

  function wire() {
    $("va").addEventListener("input", function () { onField("a"); });
    $("vb").addEventListener("input", function () { onField("b"); });
    $("va").addEventListener("blur", flushRecent);
    $("vb").addEventListener("blur", flushRecent);
    $("ua").addEventListener("click", function () { openPicker("a"); });
    $("ub").addEventListener("click", function () { openPicker("b"); });
    $("swap").addEventListener("click", swap);
    $("star").addEventListener("click", toggleStar);
    $("copy").addEventListener("click", copyResult);
    $("ing").addEventListener("change", function () { prefs.ing = $("ing").value; savePrefs(); recompute(); });
    $("fx-btn").addEventListener("click", function () { maybeFetchRates(true); });
    $("recent-clear").addEventListener("click", clearRecent);
    $("all-toggle").addEventListener("click", function () { prefs.all = !prefs.all; savePrefs(); renderAll(); });
    $("pq").addEventListener("input", renderPicker);
    $("picker-close").addEventListener("click", closeDialogs);
    $("more-btn").addEventListener("click", openMore);
    $("more-close").addEventListener("click", closeDialogs);
    $("scrim").addEventListener("click", closeDialogs);
    $("prec").addEventListener("change", onPrec);
    window.addEventListener("pagehide", flushRecent);
    window.addEventListener("online", function () { if (catId === "currency") { renderFx(); maybeFetchRates(false); } });
    window.addEventListener("offline", function () { if (catId === "currency") renderFx(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flushRecent();
      else if (catId === "currency") { renderFx(); maybeFetchRates(false); }
    });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    inheritPalette();
    wire();
    registerSync();
    watchPalette();
    setCat(prefs.cat, "1");
    var opened = false;
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("units");
        if (pending) { openTarget(pending); opened = true; }
      }
    } catch (e) {}
    if (!opened && window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
      $("va").focus();
      $("va").select();
    }
  }

  boot();
})();
