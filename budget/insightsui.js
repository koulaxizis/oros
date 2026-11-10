// ============================================================
// orOS Budget — Charts by period (budget/insightsui.js)
// The top of the Charts tab, over budget/insights.js (pure):
//   - a period: Month, Quarter, Year (around the month you are
//     looking at) or your own Dates; the choice stays on this device
//   - income, expenses and their difference, each next to the period
//     before; average a day and how much of the income was kept
//   - a donut of expenses or income by category, with the change of
//     each against the period before
//   - the month day by day as a calendar shaded by what each day cost
//   - what changed most against the period before
//   - where you spend most, by name
// Everything the app owns comes in through init(api). Every user
// text goes in with textContent.
// ============================================================
(function (root) {
  "use strict";
  var I = root.OrosBudgetInsights;
  var A = null;
  var kindView = "o";          // donut: expenses | income (session only)
  var drill = "";              // donut: the main category opened into its subcategories
  // 6.05.03 (Chris 2026-11-10 «Τα other τι είναι;»): a tap on Other shows
  // every category of that view (month, kind, drill-down); session only
  var allOn = "";
  var custom = { from: "", to: "" };
  var openDay = "";            // calendar: the day whose entries are open

  var S = {
    en: {
      "in.period": "Period", "in.m": "Month", "in.q": "Quarter", "in.y": "Year", "in.c": "Dates",
      "in.from": "From", "in.to": "To", "in.range": "{a} – {b}",
      "in.inc": "Income", "in.out": "Expenses", "in.diff": "Difference",
      "in.vs": "vs {a} before", "in.vsNone": "nothing before",
      "in.perDay": "{a} a day on average", "in.kept": "Kept {p}% of the income", "in.keptNeg": "Spent {p}% more than came in",
      "in.donutO": "Expenses by category", "in.donutI": "Income by category", "in.none": "Nothing in this period.",
      "in.total": "total", "in.other": "Other", "in.back": "All categories", "in.ownOnly": "No subcategory",
      "in.chUp": "{p}% more than the period before", "in.chDown": "{p}% less than the period before", "in.chNew": "Nothing in the period before", "in.new": "new",
      "in.cal": "Day by day, {m}", "in.calHint": "Darker days cost more. Tap a day for its entries.",
      "in.calDay": "{d}: {a}", "in.calNone": "{d}: nothing spent", "in.dayEmpty": "No expenses on this day.", "in.max": "Dearest day {a}",
      "in.cmp": "What changed", "in.cmpHint": "Against {a}.", "in.cmpNone": "Nothing to compare yet.",
      "in.now": "now {a}", "in.before": "before {a}",
      "in.pay": "Where you spend most", "in.payNone": "Entries with a note or a bank text show up here by name.",
      "in.payN1": "1 entry", "in.payN": "{n} entries",
      "in.wd": "Mon,Tue,Wed,Thu,Fri,Sat,Sun"
    },
    el: {
      "in.period": "Περίοδος", "in.m": "Μήνας", "in.q": "Τρίμηνο", "in.y": "Έτος", "in.c": "Ημερομηνίες",
      "in.from": "Από", "in.to": "Έως", "in.range": "{a} – {b}",
      "in.inc": "Έσοδα", "in.out": "Έξοδα", "in.diff": "Διαφορά",
      "in.vs": "έναντι {a} πριν", "in.vsNone": "τίποτα πριν",
      "in.perDay": "{a} τη μέρα κατά μέσο όρο", "in.kept": "Έμεινε το {p}% των εσόδων", "in.keptNeg": "Βγήκαν {p}% περισσότερα από όσα μπήκαν",
      "in.donutO": "Έξοδα ανά κατηγορία", "in.donutI": "Έσοδα ανά κατηγορία", "in.none": "Τίποτα σε αυτή την περίοδο.",
      "in.total": "σύνολο", "in.other": "Άλλα", "in.back": "Όλες οι κατηγορίες", "in.ownOnly": "Χωρίς υποκατηγορία",
      "in.chUp": "{p}% περισσότερα από την προηγούμενη περίοδο", "in.chDown": "{p}% λιγότερα από την προηγούμενη περίοδο", "in.chNew": "Τίποτα στην προηγούμενη περίοδο", "in.new": "νέα",
      "in.cal": "Μέρα με τη μέρα, {m}", "in.calHint": "Όσο πιο σκούρα η μέρα, τόσο πιο ακριβή. Πάτησε μια μέρα για τις κινήσεις της.",
      "in.calDay": "{d}: {a}", "in.calNone": "{d}: κανένα έξοδο", "in.dayEmpty": "Κανένα έξοδο αυτή τη μέρα.", "in.max": "Πιο ακριβή μέρα {a}",
      "in.cmp": "Τι άλλαξε", "in.cmpHint": "Σε σύγκριση με {a}.", "in.cmpNone": "Τίποτα για σύγκριση ακόμη.",
      "in.now": "τώρα {a}", "in.before": "πριν {a}",
      "in.pay": "Πού ξοδεύεις περισσότερο", "in.payNone": "Οι κινήσεις με σημείωση ή κείμενο τράπεζας εμφανίζονται εδώ με το όνομά τους.",
      "in.payN1": "1 κίνηση", "in.payN": "{n} κινήσεις",
      "in.wd": "Δε,Τρ,Τε,Πε,Πα,Σα,Κυ"
    }
  };
  // orosI18n (../i18n.js): S[<pack language>] from the pack "budget".
  if (root.orosI18n) root.orosI18n.table(S, "budget", root.orosI18n.lang());

  function t(k, p) {
    var tab = S[A.lang] || S.en;
    var s = tab[k] !== undefined ? tab[k] : (S.en[k] !== undefined ? S.en[k] : k);
    if (p) Object.keys(p).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function el(tag, cls, text) { return A.el(tag, cls, text); }
  function D() { return A.data(); }
  function TXV() { return A.viewTx ? A.viewTx() : D().tx; }   // AR-VIEW: the area switch
  // A subcategory's own name, without its main category's.
  function shortName(id) {
    var c = (A.cats ? A.cats() : []).filter(function (y) { return y.id === id; })[0];
    return c ? c.name : A.catName(id);
  }

  function current() {
    var k = A.periodKind();
    if (k === "c" && !(I.okYmd(custom.from) && I.okYmd(custom.to))) {
      var mk = A.viewMk();
      custom.from = mk + "-01";
      custom.to = I.period("m", mk).to;
    }
    return I.period(k, A.viewMk(), custom.from, custom.to);
  }
  function rangeLabel(from, to) { return t("in.range", { a: A.dateShort(from), b: A.dateShort(to) }); }
  function chip(p, upIsBad) {
    var s = el("span", "ov-chip " + (p === null ? "new" : p === 0 ? "flat" : (p > 0) === upIsBad ? "up" : "down"),
               p === null ? t("in.new") : (p > 0 ? "▲ " : p < 0 ? "▼ " : "") + Math.abs(p) + "%");
    s.title = p === null ? t("in.chNew") : p >= 0 ? t("in.chUp", { p: p }) : t("in.chDown", { p: -p });
    return s;
  }

  function render(box) {
    box.innerHTML = "";
    var P = current();
    var cur = I.sum(TXV(), P.from, P.to), prev = I.sum(TXV(), P.pFrom, P.pTo);
    // subcategories folded into their main category (drill-down opens them)
    var pm = A.pm ? A.pm() : {};
    var rc = Object.assign({}, cur, { byCat: A.rollUp ? A.rollUp(cur.byCat, pm) : cur.byCat });
    var rp = Object.assign({}, prev, { byCat: A.rollUp ? A.rollUp(prev.byCat, pm) : prev.byCat });
    box.appendChild(cardPeriod(P, cur, prev));
    var dn = el("div", "card");
    box.appendChild(dn);
    cardDonut(dn, rc, rp, cur, prev, pm);
    var cal = el("div", "card");
    box.appendChild(cal);
    cardCalendar(cal);
    box.appendChild(cardCompare(P, rc, rp));
    box.appendChild(cardPayees(P));
  }

  // ---------- period + totals ----------
  function cardPeriod(P, cur, prev) {
    var card = el("div", "card in-period");
    var seg = el("div", "seg in-seg");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", t("in.period"));
    ["m", "q", "y", "c"].forEach(function (k) {
      var b = el("button", "seg-btn", t("in." + k));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", P.kind === k ? "true" : "false");
      b.addEventListener("click", function () { openDay = ""; A.setPeriodKind(k); });
      seg.appendChild(b);
    });
    card.appendChild(seg);
    if (P.kind === "c") {
      var row = el("div", "fld-row in-dates");
      [["from", "in.from"], ["to", "in.to"]].forEach(function (f) {
        var inp = el("input");
        inp.type = "date";
        inp.value = custom[f[0]];
        inp.addEventListener("change", function () {
          if (!I.okYmd(inp.value)) return;
          custom[f[0]] = inp.value;
          A.renderCharts();
        });
        row.appendChild(A.field(t(f[1]), inp, "in-" + f[0]));
      });
      card.appendChild(row);
    }
    card.appendChild(el("p", "in-range", rangeLabel(P.from, P.to)));
    var tiles = el("div", "in-tiles");
    function tile(label, a, b, cls, upIsBad) {
      var x = el("div", "in-tile");
      x.appendChild(el("span", "tile-k", label));
      x.appendChild(el("span", "tile-v " + cls, A.money(a)));
      var line = el("span", "in-vs");
      line.appendChild(chip(I.pct(a, b), upIsBad));
      line.appendChild(el("span", "", b || a ? t("in.vs", { a: A.money(b) }) : t("in.vsNone")));
      x.appendChild(line);
      tiles.appendChild(x);
    }
    var d = cur.inc - cur.out, pd = prev.inc - prev.out;
    tile(t("in.inc"), cur.inc, prev.inc, "in", false);
    tile(t("in.out"), cur.out, prev.out, "", true);
    var x = el("div", "in-tile");
    x.appendChild(el("span", "tile-k", t("in.diff")));
    x.appendChild(el("span", "tile-v" + (d < 0 ? " neg" : " in"), (d < 0 ? "−" : "+") + A.money(Math.abs(d))));
    x.appendChild(el("span", "in-vs", t("in.vs", { a: (pd < 0 ? "−" : "+") + A.money(Math.abs(pd)) })));
    tiles.appendChild(x);
    card.appendChild(tiles);
    var notes = [t("in.perDay", { a: A.money(Math.round(cur.out / P.days)) })];
    if (cur.inc) notes.push(d >= 0 ? t("in.kept", { p: Math.round(d * 100 / cur.inc) }) : t("in.keptNeg", { p: Math.round(-d * 100 / cur.inc) }));
    card.appendChild(el("p", "hint", notes.join(" · ")));
    return card;
  }

  // ---------- donut ----------
  // cur/prev: main categories only; rawCur/rawPrev: as entered, for
  // the subcategories of `drill` (a main category that has some).
  function cardDonut(card, cur, prev, rawCur, rawPrev, pm) {
    var hasKids = {};
    Object.keys(pm).forEach(function (id) { hasKids[pm[id]] = 1; });
    if (drill && !hasKids[drill]) drill = "";
    var head = el("div", "ov-head");
    var h = el("h2", "", drill ? A.catName(drill) : t(kindView === "i" ? "in.donutI" : "in.donutO"));
    head.appendChild(h);
    if (drill) {
      var back = el("button", "txt-btn in-back", t("in.back"));
      back.type = "button";
      back.addEventListener("click", function () { drill = ""; A.renderCharts(); });
      head.appendChild(back);
      card.appendChild(head);
      return donutBody(card, h, rawCur, rawPrev, function (id) { return id === drill || pm[id] === drill; }, {}, pm);
    }
    var seg = el("div", "seg in-kind");
    seg.setAttribute("role", "radiogroup");
    [["o", "in.out"], ["i", "in.inc"]].forEach(function (v) {
      var b = el("button", "seg-btn", t(v[1]));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", kindView === v[0] ? "true" : "false");
      b.addEventListener("click", function () { kindView = v[0]; A.renderCharts(); });
      seg.appendChild(b);
    });
    head.appendChild(seg);
    card.appendChild(head);
    donutBody(card, h, cur, prev, null, hasKids, pm);
  }
  // keep: only the categories it says yes to (drill-down); kids:
  // main categories that open into their subcategories.
  function donutBody(card, h, cur, prev, keep, kids, pm) {
    var k = kindView, total = 0;
    var parts = [];
    Object.keys(cur.byCat).forEach(function (key) {
      if (key.charAt(0) !== k) return;
      var id = key.slice(2);
      if (keep && !keep(id)) return;
      total += cur.byCat[key];
      // in the drill-down the main category's own entries read "No subcategory"
      var name = !keep ? A.catName(id) : !pm[id] ? t("in.ownOnly") : shortName(id);
      parts.push({ id: id, name: name, col: keep && !pm[id] ? 8 : A.catCol(id), a: cur.byCat[key], p: prev.byCat[key] || 0 });
    });
    function open(p) {
      if (kids[p.id]) { drill = p.id; A.renderCharts(); }
      else A.showFilter("c:" + p.id);
    }
    parts.sort(function (a, b) { return b.a - a.a || (a.name < b.name ? -1 : 1); });
    if (!parts.length) { card.appendChild(el("p", "hint", t("in.none"))); return; }
    var allKey = A.viewMk() + "|" + k + "|" + drill;
    if (parts.length > 8 && allOn !== allKey) {
      var rest = parts.slice(7), sa = 0, sp = 0;
      rest.forEach(function (p) { sa += p.a; sp += p.p; });
      parts = parts.slice(0, 7).concat([{ id: null, name: t("in.other"), col: 8, a: sa, p: sp }]);
    }
    var wrap = el("div", "donut-wrap");
    var S0 = 180, R = 84, r0 = 54, cx = S0 / 2, cy = S0 / 2;
    var svg = A.sv("svg", { viewBox: "0 0 " + S0 + " " + S0, width: S0, height: S0, "class": "donut", role: "img",
                            "aria-label": h.textContent + ": " + A.money(total) });
    var a0 = -Math.PI / 2;
    parts.forEach(function (p) {
      var frac = p.a / total, a1 = a0 + frac * Math.PI * 2, d;
      if (frac >= 0.9999) {
        d = "M" + cx + "," + (cy - R) + " A" + R + "," + R + " 0 1 1 " + (cx - 0.01) + "," + (cy - R) +
            " L" + (cx - 0.01) + "," + (cy - r0) + " A" + r0 + "," + r0 + " 0 1 0 " + cx + "," + (cy - r0) + " Z";
      } else {
        var big = a1 - a0 > Math.PI ? 1 : 0;
        d = "M" + [cx + R * Math.cos(a0), cy + R * Math.sin(a0)] + " A" + R + "," + R + " 0 " + big + " 1 " +
            [cx + R * Math.cos(a1), cy + R * Math.sin(a1)] + " L" + [cx + r0 * Math.cos(a1), cy + r0 * Math.sin(a1)] +
            " A" + r0 + "," + r0 + " 0 " + big + " 0 " + [cx + r0 * Math.cos(a0), cy + r0 * Math.sin(a0)] + " Z";
      }
      var path = A.sv("path", { d: d, "class": "slice", style: "fill:var(--c" + p.col + ")" });
      var g = A.sv("g");
      g.appendChild(path);
      A.hit(g, p.name + ": " + A.money(p.a) + " (" + Math.round(frac * 100) + "%)", p.id !== null ? function () { open(p); } : null);
      g.setAttribute("class", "hit slice-g");
      svg.appendChild(g);
      a0 = a1;
    });
    svg.appendChild(A.svText(cx, cy - 2, A.money(total), "donut-total", "middle"));
    svg.appendChild(A.svText(cx, cy + 16, t("in.total"), "ax", "middle"));
    wrap.appendChild(svg);
    var ul = el("ul", "rank");
    parts.forEach(function (p) {
      var li = el("li");
      var b = el("button", "rank-row");
      b.type = "button";
      if (p.id !== null) {
        b.addEventListener("click", function () { open(p); });
        if (kids[p.id]) b.setAttribute("aria-haspopup", "true");
      } else {
        b.setAttribute("aria-expanded", "false");
        b.addEventListener("click", function () { allOn = allKey; A.renderCharts(); });
      }
      var pc = I.pct(p.a, p.p);
      b.setAttribute("aria-label", p.name + ", " + A.money(p.a) + ", " + (pc === null ? t("in.chNew") : pc >= 0 ? t("in.chUp", { p: pc }) : t("in.chDown", { p: -pc })));
      var top = el("span", "rank-top");
      top.appendChild(p.id !== null && A.catBadge && !(keep && !pm[p.id]) ? A.catBadge(p.id) : A.swatch(p.col));
      top.appendChild(el("span", "rank-name", p.name + (kids[p.id] || p.id === null ? " ›" : "")));
      top.appendChild(chip(pc, k === "o"));
      top.appendChild(el("span", "rank-amt", A.money(p.a)));
      top.appendChild(el("span", "rank-pct", Math.round(p.a * 100 / total) + "%"));
      b.appendChild(top);
      var bar = el("span", "rank-bar");
      var f = el("span");
      f.style.width = (p.a * 100 / parts[0].a) + "%";
      f.style.background = "var(--c" + p.col + ")";
      bar.appendChild(f);
      b.appendChild(bar);
      li.appendChild(b);
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    card.appendChild(wrap);
  }

  // ---------- calendar ----------
  function cardCalendar(card) {
    var mk = A.viewMk();
    var m = I.period("m", mk);
    var cal = I.calendar(I.sum(TXV(), m.from, m.to).byDay, mk);
    card.appendChild(el("h2", "", t("in.cal", { m: A.monthLabel(mk) })));
    var grid = el("div", "in-cal");
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", t("in.cal", { m: A.monthLabel(mk) }));
    var hr = el("div", "in-cal-row");
    hr.setAttribute("role", "row");
    t("in.wd").split(",").forEach(function (w) {
      var c = el("span", "in-wd", w);
      c.setAttribute("role", "columnheader");
      hr.appendChild(c);
    });
    grid.appendChild(hr);
    cal.weeks.forEach(function (wk) {
      var row = el("div", "in-cal-row");
      row.setAttribute("role", "row");
      wk.forEach(function (c) {
        if (!c) { var e = el("span", "in-day empty"); e.setAttribute("role", "gridcell"); row.appendChild(e); return; }
        var b = el("button", "in-day l" + c.lvl + (c.d === openDay ? " on" : "") + (c.d === A.today() ? " today" : ""));
        b.type = "button";
        b.setAttribute("role", "gridcell");
        var lbl = A.dayLabel(c.d);
        b.setAttribute("aria-label", c.a ? t("in.calDay", { d: lbl, a: A.money(c.a) }) : t("in.calNone", { d: lbl }));
        b.setAttribute("aria-pressed", c.d === openDay ? "true" : "false");
        b.appendChild(el("span", "in-dn", String(+c.d.slice(8, 10))));
        if (c.a) b.appendChild(el("span", "in-da", A.moneyShort(c.a)));
        b.addEventListener("click", function () { openDay = openDay === c.d ? "" : c.d; A.renderCharts(); });
        row.appendChild(b);
      });
      grid.appendChild(row);
    });
    card.appendChild(grid);
    card.appendChild(el("p", "hint", t("in.calHint") + (cal.max ? " " + t("in.max", { a: A.money(cal.max) }) : "")));
    if (openDay && openDay.slice(0, 7) === mk) {
      var list = TXV().filter(function (x) { return x.d === openDay && x.k === "o"; })
        .sort(function (a, b) { return b.a - a.a; });
      var box = el("div", "in-dayl");
      box.appendChild(el("h3", "", A.dayLabel(openDay)));
      if (!list.length) box.appendChild(el("p", "hint", t("in.dayEmpty")));
      var ul = el("ul", "ov-rows");
      list.forEach(function (x) {
        var li = el("li");
        var b = el("button", "ov-row");
        b.type = "button";
        b.appendChild(A.swatch(A.catCol(x.c)));
        var n = el("span", "ov-n");
        n.appendChild(el("span", "", x.n || A.catName(x.c)));
        if (x.n) n.appendChild(el("span", "ov-when", A.catName(x.c)));
        b.appendChild(n);
        b.appendChild(el("span", "ov-v", "−" + A.money(x.a)));
        b.addEventListener("click", function () { A.openTx(x.id); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      box.appendChild(ul);
      card.appendChild(box);
    }
  }

  // ---------- what changed ----------
  function cardCompare(P, cur, prev) {
    var card = el("div", "card");
    card.appendChild(el("h2", "", t("in.cmp")));
    var rows = I.compare(cur, prev, "o").filter(function (r) { return r.d; }).slice(0, 8);
    if (!rows.length) { card.appendChild(el("p", "hint", t("in.cmpNone"))); return card; }
    card.appendChild(el("p", "hint", t("in.cmpHint", { a: rangeLabel(P.pFrom, P.pTo) })));
    var max = 1;
    rows.forEach(function (r) { max = Math.max(max, r.a, r.p); });
    var ul = el("ul", "ov-rows in-cmp");
    rows.forEach(function (r) {
      var li = el("li");
      var b = el("button", "ov-row ov-toprow");
      b.type = "button";
      var name = A.catName(r.c);
      b.setAttribute("aria-label", name + ", " + t("in.now", { a: A.money(r.a) }) + ", " + t("in.before", { a: A.money(r.p) }));
      var l = el("span", "ov-top-l");
      l.appendChild(A.swatch(A.catCol(r.c)));
      l.appendChild(el("span", "ov-n", name));
      l.appendChild(el("span", "ov-v" + (r.d > 0 ? " neg" : " in"), (r.d > 0 ? "+" : "−") + A.money(Math.abs(r.d))));
      b.appendChild(l);
      [["in-now", r.a, "in.now"], ["in-before", r.p, "in.before"]].forEach(function (z) {
        var line = el("span", "in-bar " + z[0]);
        var f = el("span");
        f.style.width = (z[1] * 100 / max) + "%";
        if (z[0] === "in-now") f.style.background = "var(--c" + A.catCol(r.c) + ")";
        line.appendChild(f);
        line.appendChild(el("span", "in-bar-t", t(z[2], { a: A.money(z[1]) })));
        b.appendChild(line);
      });
      b.addEventListener("click", function () { A.showFilter("c:" + r.c); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    card.appendChild(ul);
    return card;
  }

  // ---------- payees ----------
  function cardPayees(P) {
    var card = el("div", "card");
    card.appendChild(el("h2", "", t("in.pay")));
    var list = I.payees(TXV(), P.from, P.to, 6);
    if (!list.length) { card.appendChild(el("p", "hint", t("in.payNone"))); return card; }
    var ul = el("ul", "ov-rows");
    list.forEach(function (p) {
      var li = el("li");
      var b = el("button", "ov-row");
      b.type = "button";
      var n = el("span", "ov-n");
      n.appendChild(el("span", "", p.name));
      n.appendChild(el("span", "ov-when", p.n === 1 ? t("in.payN1") : t("in.payN", { n: p.n })));
      b.appendChild(n);
      b.appendChild(el("span", "ov-v", A.money(p.a)));
      b.addEventListener("click", function () { A.search(p.name); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    card.appendChild(ul);
    return card;
  }

  root.OrosBudgetInsightsUI = {
    init: function (api) { A = api; },
    render: function (box) { if (A) render(box); },
    t: function (k, p) { return A ? t(k, p) : k; }
  };
})(typeof window !== "undefined" ? window : this);
