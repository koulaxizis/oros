// ============================================================
// orOS Settings › Screen time (settings/screentime.js, ST-1)
// Loaded by settings/settings.js only when the section first opens
// (Settings size budget, with screentime.css). Draws the section from
// the shell's snapshot (s.screentime, device/screentime.js) with the
// page's own helpers (ctx): the switch, the picked day (its apps,
// longest first), the last 7 days as columns and Clear history.
// Owns no data: every change goes through ctx.set() to the shell.
// The picked day lives in memory only (R10). Strings used only here
// are added to SettingsCore's tables on load (German: i18n/de pack).
// ============================================================
(function () {
  "use strict";

  var STR = {
    en: {
      "st.hint": "Counts the app in front while orOS is on screen, unlocked and in use (or playing sound or video). It stays on this device: never synced, never in a backup, never seen by the Assistant or orOS Gate. Kept for 4 weeks.",
      "st.offKept": "Counting is off. What was counted before stays until you clear it.",
      "st.today": "Today",
      "st.total": "In total",
      "st.weekHint": "Tap a day to see its apps.",
      "st.none": "Nothing counted on this day.",
      "st.desk": "Desktop",
      "st.sens": "Sensitive work",
      "st.dayAria": "{day}: {time}",
      "st.clearSure": "Tap again to clear",
      "st.clear.hint": "Removes every counted day from this device.",
      "st.limits.hint": "5 minutes before a limit you get a quiet notice. At the limit a card asks whether to take a break: the app stays open under it, nothing is lost, and one tap goes on. Settings has no limit.",
      "st.limit.none": "No limit",
      "st.limit.used": "{used} of {limit} today",
      "st.limits.empty": "The apps you use appear here once they have been counted."
    },
    el: {
      "st.hint": "Μετράει την εφαρμογή που είναι μπροστά, όσο το orOS φαίνεται, είναι ξεκλείδωτο και το χρησιμοποιείς (ή παίζει ήχος ή βίντεο). Μένει σε αυτή τη συσκευή: δεν συγχρονίζεται, δεν μπαίνει σε αντίγραφο ασφαλείας και δεν το βλέπουν ποτέ ο Βοηθός ή το orOS Gate. Κρατιέται 4 εβδομάδες.",
      "st.offKept": "Η μέτρηση είναι κλειστή. Ό,τι μετρήθηκε πριν μένει μέχρι να το σβήσεις.",
      "st.today": "Σήμερα",
      "st.total": "Συνολικά",
      "st.weekHint": "Πάτησε μια ημέρα για να δεις τις εφαρμογές της.",
      "st.none": "Δεν μετρήθηκε τίποτα αυτή την ημέρα.",
      "st.desk": "Επιφάνεια εργασίας",
      "st.sens": "Ευαίσθητη δουλειά",
      "st.dayAria": "{day}: {time}",
      "st.clearSure": "Πάτησε ξανά για σβήσιμο",
      "st.clear.hint": "Σβήνει όλες τις ημέρες που μετρήθηκαν από αυτή τη συσκευή.",
      "st.limits.hint": "5 λεπτά πριν από ένα όριο βγαίνει μια ήσυχη ειδοποίηση. Στο όριο μια κάρτα ρωτά αν θέλεις διάλειμμα: η εφαρμογή μένει ανοιχτή από κάτω, δεν χάνεται τίποτα και ένα πάτημα συνεχίζει. Οι Ρυθμίσεις δεν έχουν όριο.",
      "st.limit.none": "Χωρίς όριο",
      "st.limit.used": "{used} από {limit} σήμερα",
      "st.limits.empty": "Οι εφαρμογές που χρησιμοποιείς εμφανίζονται εδώ μόλις μετρηθούν."
    }
  };
  var C0 = window.SettingsCore;
  if (C0 && C0.STRINGS) {
    ["en", "el"].forEach(function (l) {
      Object.keys(STR[l]).forEach(function (k) { if (!(k in C0.STRINGS[l])) C0.STRINGS[l][k] = STR[l][k]; });
    });
  }

  var C, LANG, t, el, card, row, switchBtn, actions, confirmBtn, set, render, select;

  var stPick = null;
  function stLocale() { return LANG === "el" ? "el-GR" : LANG === "de" ? "de-DE" : "en-GB"; }
  function stDayDate(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  }
  function stDayName(key, today, long) {
    if (key === today && long) return t("st.today");   // a column keeps its weekday (narrow screens)
    try { return stDayDate(key).toLocaleDateString(stLocale(), long ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short" }); }
    catch (e) { return key; }
  }
  function stPct(part, whole, min) {   // a bar's length: 0-100 %
    var v = whole > 0 ? Math.round(part / whole * 100) : 0;
    if (part > 0) v = Math.max(min || 0, v);
    return Math.max(0, Math.min(100, v)) + "%";
  }
  function stAppName(a) {
    return a.id === "~desk" ? t("st.desk") : a.id === "~sens" ? t("st.sens") : (a.name || a.id);
  }
  function secScreenTime(host, s) {
    var st = s.screentime;
    if (!st) { host.appendChild(el("p", "hint card-note", t("st.wait"))); return; }
    var c1 = card(null);
    c1.appendChild(row(t("st.on"), switchBtn(st.on, "screentime", function (v) { set("screentime", v); }, t("st.on")),
      { scope: "screentime", hint: t("st.hint") }));
    if (!st.on && st.has) c1.appendChild(el("p", "hint", t("st.offKept")));
    host.appendChild(c1);
    if (!st.on && !st.has) return;

    var days = st.days || [];
    var pick = null;
    days.forEach(function (d) { if (d.day === stPick) pick = d; });
    if (!pick) { pick = days[days.length - 1] || { day: st.today, total: 0, apps: [] }; stPick = null; }

    // The picked day: its total and its apps.
    var c2 = card(stDayName(pick.day, st.today, true));
    var tot = el("div", "st-total");
    tot.appendChild(el("span", "st-total-num", C.stDur(LANG, pick.total)));
    tot.appendChild(el("span", "hint", t("st.total")));
    c2.appendChild(tot);
    if (!pick.apps.length) c2.appendChild(el("p", "hint", t("st.none")));
    else {
      var ul = el("ul", "st-list");
      var top = pick.apps[0].secs || 1;
      pick.apps.forEach(function (a) {
        var li = el("li", "st-app");
        var hd = el("div", "st-app-head");
        hd.appendChild(el("span", "st-app-name", stAppName(a)));
        hd.appendChild(el("span", "st-app-time", C.stDur(LANG, a.secs)));
        li.appendChild(hd);
        var bar = el("div", "st-bar");
        var fill = el("span", "st-bar-fill");
        fill.style.width = stPct(a.secs, top, 2);
        bar.appendChild(fill);
        li.appendChild(bar);
        ul.appendChild(li);
      });
      c2.appendChild(ul);
    }
    host.appendChild(c2);

    // The last 7 days: one column each, the picked one marked.
    var c3 = card(t("st.week"));
    var max = 1;
    days.forEach(function (d) { if (d.total > max) max = d.total; });
    var wk = el("div", "st-week");
    days.forEach(function (d) {
      var b = el("button", "st-col" + (d.day === pick.day ? " on" : "") + (d.day === st.today ? " today" : ""));
      b.type = "button";
      b.setAttribute("data-k", "st-day:" + d.day);
      b.setAttribute("aria-pressed", d.day === pick.day ? "true" : "false");
      b.setAttribute("aria-label", t("st.dayAria", { day: stDayName(d.day, st.today, true), time: C.stDur(LANG, d.total) }));
      var col = el("span", "st-col-bar");
      var f = el("span", "st-col-fill");
      f.style.height = stPct(d.total, max, 4);
      col.appendChild(f);
      b.appendChild(col);
      b.appendChild(el("span", "st-col-day", stDayName(d.day, st.today, false)));
      b.addEventListener("click", function () { stPick = d.day; render(); });
      wk.appendChild(b);
    });
    c3.appendChild(wk);
    c3.appendChild(el("p", "hint", t("st.weekHint")));
    host.appendChild(c3);

    // S2: a daily limit per app (the apps of the last 7 days, most
    // used first, and every app that has a limit). Older shells send
    // no `limits`: no card.
    if (st.limits && select) {
      var c5 = card(t("st.limits"), "screentime");
      c5.appendChild(el("p", "hint", t("st.limits.hint")));
      var tot = {}, names = {}, no = st.noLimit || [];
      days.forEach(function (d) {
        d.apps.forEach(function (a) {
          if (a.id.charAt(0) === "~" || no.indexOf(a.id) !== -1) return;
          tot[a.id] = (tot[a.id] || 0) + a.secs;
          names[a.id] = a.name || a.id;
        });
      });
      Object.keys(st.limits).forEach(function (id) { if (!(id in tot)) { tot[id] = 0; } });
      var ids = Object.keys(tot).sort(function (a, b) { return tot[b] - tot[a] || (a < b ? -1 : 1); }).slice(0, 40);
      if (!ids.length) c5.appendChild(el("p", "hint", t("st.limits.empty")));
      var opts = [{ value: "0", label: t("st.limit.none") }].concat((st.choices || []).map(function (m) {
        return { value: String(m), label: C.stDur(LANG, m * 60) };
      }));
      ids.forEach(function (id) {
        var lim = st.limits[id] || 0;
        var sel = select(opts, String(lim), "st-limit:" + id, function (v) { set("screentimeLimit", { id: id, min: Number(v) }); });
        var hint = lim ? t("st.limit.used", { used: C.stDur(LANG, (st.used && st.used[id]) || 0), limit: C.stDur(LANG, lim * 60) }) : null;
        c5.appendChild(row(names[id] || (st.limitNames && st.limitNames[id]) || id, sel, { forId: sel.id, hint: hint }));
      });
      host.appendChild(c5);
    }

    if (st.has) {
      var c4 = card(null);
      c4.appendChild(row(t("st.clear"), null, { hint: t("st.clear.hint") }));
      c4.appendChild(actions(confirmBtn(t("st.clear"), t("st.clearSure"), "st.clear", function () {
        stPick = null;
        set("screentimeClear", true);
      }, "danger")));
      host.appendChild(c4);
    }
  }

  window.SettingsScreenTime = {
    STRINGS: STR,
    draw: function (host, s, ctx) {
      C = ctx.C; LANG = ctx.LANG; t = ctx.t; el = ctx.el; card = ctx.card; row = ctx.row;
      switchBtn = ctx.switchBtn; actions = ctx.actions; confirmBtn = ctx.confirmBtn; set = ctx.set; render = ctx.render;
      select = ctx.select;
      secScreenTime(host, s);
    }
  };
})();
