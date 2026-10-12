// ============================================================
// orOS Library — reading stats (v1.1.0)
// How long you read: today, the last seven days, the streak of days
// in a row, all time, a bar per day for the last two weeks and the
// books you spent most time in (with the time left at your pace).
// The seconds are counted by reader.js and kept in the synced slice
// (core.js section 10), so every device adds to the same totals.
// ============================================================
(function () {
  "use strict";

  var LIB = window.LIB, C = LIB.C, t = LIB.t, el = LIB.el;

  // "2 h 05 min", "12 min", "<1 min"
  LIB.dur = function (secs) {
    secs = Math.max(0, Math.round(secs || 0));
    if (secs < 60) return t(secs ? "stats.lessMin" : "stats.min", { m: 0 });
    var m = Math.round(secs / 60), h = Math.floor(m / 60);
    m = m % 60;
    if (!h) return t("stats.min", { m: m });
    return t("stats.hMin", { h: LIB.num(h), m: ("0" + m).slice(-2) });
  };

  function dayNum(ymd) { return String(+ymd.split("-")[2]); }
  function longDay(ymd) {
    var p = ymd.split("-");
    try {
      return new Date(+p[0], +p[1] - 1, +p[2], 12).toLocaleDateString(LIB.LANG === "el" ? "el-GR" : "en-GB", { weekday: "short", day: "numeric", month: "short" });
    } catch (e) { return ymd; }
  }

  function show() {
    var stats = LIB.data.stats || null;
    var today = C.ymdOf(new Date());
    var sum = C.statsSummary(stats, today, 14);
    var dlg = LIB.dialog("lb-stats", t("stats.title"), "wide");
    if (!sum.total) {
      dlg.appendChild(el("p", "dlg-text", t("stats.empty")));
      dlg.showModal();
      return;
    }
    var tiles = el("div", "st-tiles");
    function tile(name, value, sub) {
      var d = el("div", "st-tile");
      d.appendChild(el("span", "st-val", value));
      d.appendChild(el("span", "st-name", name));
      if (sub) d.appendChild(el("span", "st-sub", sub));
      tiles.appendChild(d);
    }
    tile(t("stats.today"), LIB.dur(sum.today));
    tile(t("stats.week"), LIB.dur(sum.week));
    tile(t("stats.streak"), t(sum.streak === 1 ? "stats.day1" : "stats.days", { n: LIB.num(sum.streak) }),
      sum.best > sum.streak ? t("stats.best", { n: LIB.num(sum.best) }) : "");
    tile(t("stats.total"), LIB.dur(sum.total));
    dlg.appendChild(tiles);

    // the last 14 days
    dlg.appendChild(el("h3", "st-h", t("stats.lastDays")));
    var max = 60;
    sum.days.forEach(function (d) { if (d.s > max) max = d.s; });
    var chart = el("ol", "st-chart");
    sum.days.forEach(function (d) {
      var li = el("li", "st-day" + (d.d === today ? " today" : ""));
      var lbl = longDay(d.d) + ": " + LIB.dur(d.s);
      li.title = lbl;
      li.setAttribute("aria-label", lbl);
      var col = el("span", "st-col");
      var barEl = el("span", "st-bar");
      barEl.style.height = (d.s ? Math.max(4, Math.round(d.s / max * 100)) : 0) + "%";
      col.appendChild(barEl);
      li.appendChild(col);
      li.appendChild(el("span", "st-wd", dayNum(d.d)));
      chart.appendChild(li);
    });
    dlg.appendChild(chart);

    // books by time
    var rows = Object.keys((stats && stats.b) || {}).map(function (id) {
      return { b: LIB.book(id), s: C.bookSeconds(stats, id) };
    }).filter(function (x) { return x.b && x.s >= 60; })
      .sort(function (x, y) { return y.s - x.s || C.cmpStr(x.b.id, y.b.id); }).slice(0, 10);
    if (rows.length) {
      dlg.appendChild(el("h3", "st-h", t("stats.books")));
      var ul = el("ul", "st-books");
      rows.forEach(function (x) {
        var li = el("li", "st-book");
        var bt = LIB.textBtn("st-btitle", x.b.title, function () { dlg.close(); LIB.home.details(x.b.id); });
        li.appendChild(bt);
        li.appendChild(el("span", "st-bmeta", bookLine(x.b, x.s)));
        ul.appendChild(li);
      });
      dlg.appendChild(ul);
    }
    dlg.appendChild(el("p", "hint st-note", t("stats.note")));
    dlg.showModal();
  }
  // "3 h 10 min · 42% · about 4 h 20 min left"
  function bookLine(b, secs) {
    var pct = C.progressOf(LIB.data, b.id);
    var parts = [LIB.dur(secs)];
    if (b.fin) parts.push(t("stats.finished"));
    else {
      parts.push(t("book.pct", { p: Math.floor(pct / 10) }));
      var left = C.timeLeft(secs, pct);
      if (left !== null) parts.push(t("stats.left", { d: LIB.dur(left) }));
    }
    return parts.join(" · ");
  }

  LIB.stats = {
    show: show,
    // details rows for one book: { read, left } (strings) or null
    ofBook: function (b) {
      var secs = C.bookSeconds(LIB.data.stats, b.id);
      if (secs < 60) return null;
      var left = b.fin ? null : C.timeLeft(secs, C.progressOf(LIB.data, b.id));
      return { read: LIB.dur(secs), left: left === null ? "" : t("stats.left", { d: LIB.dur(left) }) };
    }
  };
})();
