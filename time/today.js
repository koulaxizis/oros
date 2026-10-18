// ============================================================
// orOS Time — Today provider (v1.1.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after stage-core.js (window.OrosStageCore).
// Read-only: lists the shell's alarms (window.orosAlarms.list(), the
// same list the Time app shows), never adds or removes one. Rows:
// alarms that ring later today, at their time. A running timer or
// Pomodoro is a "once" alarm set less than 3 hours ahead: left out
// (it rings by itself within the hour), like any such short alarm.
// Kitchen timers (wave 5, alarm ids "tmr-…") are always left out.
// Opens the Alarms tab of Time (__orosOpenTime("alarms")).
// Stage (wave 4), read-only from oros-time-stage (+ this device's
// oros-time-stage-run): on an event's day, the next session and
// when it is expected to start ("Next: Panel", at 14:30, later if
// the day runs behind); on the days ahead (the Today horizon), the
// event itself at its start. Opens the Stage tab on that event.
// ============================================================
(function (root) {
  "use strict";
  var TXT = { en: { "today.alarm": "Alarm", "today.next": "Next: {t}" },
              el: { "today.alarm": "Ξυπνητήρι", "today.next": "Επόμενο: {t}" } };
  var SHORT_MS = 3 * 3600000;      // shorter than this from now and "once": a timer
  // A pack language: English + the time pack, when one is loaded.
  function txt(lang, k) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (I && lang && !TXT[lang]) I.table(TXT, "time", lang);
    return (TXT[lang] || TXT.en)[k];
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hmOf(ms) { var d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  // Stage rows: today's events → the next item; later days → the event.
  function stageRows(ctx) {
    var C = root.OrosStageCore, raw = ctx.readJSON("oros-time-stage");
    if (!C || !raw || !Array.isArray(raw.events) || !raw.events.length) return [];
    var data = C.merge(C.empty(), raw), run = C.normRun(ctx.readJSON("oros-time-stage-run"));
    var last = ctx.addDays(ctx.today, ctx.horizon), out = [], lang = ctx.lang;
    data.events.forEach(function (ev) {
      if (!ev.date || ev.date < ctx.today || ev.date > last) return;
      var target = { stage: { ev: ev.id } };
      if (ev.date !== ctx.today) {
        out.push({ id: "stage-" + ev.id, due: ev.date, time: ev.start || null, kind: "event", title: ev.name, target: target });
        return;
      }
      var items = C.rundown(data, ev.id);
      if (!items.length) {
        out.push({ id: "stage-" + ev.id, due: ev.date, time: ev.start || null, kind: "event", title: ev.name, target: target });
        return;
      }
      var sc = C.schedule(ev, items, run.ev === ev.id ? run : null, ctx.now), next = -1;
      for (var i = 0; i < sc.rows.length && next < 0; i++) if (sc.rows[i].state === "todo") next = i;
      if (next < 0) return;                      // the last item is on now, or the day is done
      var it = items[next], r = sc.rows[next];
      target = { stage: { ev: ev.id, it: it.id } };
      out.push({ id: "stage-" + ev.id, due: ev.date, kind: "event",
                 time: (ev.start || run.ev === ev.id) && r.expStart !== null && r.expStart >= ctx.now - 60000 ? hmOf(r.expStart) : null,
                 title: txt(lang, "today.next").replace("{t}", it.title),
                 text: [it.speaker, ev.name].filter(Boolean).join(" · "), target: target });
    });
    return out;
  }

  var PROVIDER = {
    id: "time",
    keys: ["oros-alarms", "oros-time-stage"],
    collect: function (ctx) {
      var A = root.orosAlarms, list = [];
      try { list = A && typeof A.list === "function" ? A.list() : []; } catch (e) { list = []; }
      var out = [];
      (Array.isArray(list) ? list : []).forEach(function (a) {
        if (!a || typeof a.at !== "number" || a.at < ctx.now) return;
        if (typeof a.id === "string" && a.id.indexOf("tmr-") === 0) return;   // a kitchen timer (wave 5)
        var d = new Date(a.at);
        var day = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
        if (day !== ctx.today) return;
        if (a.repeat !== "daily" && a.mtime && a.at - a.mtime < SHORT_MS) return;
        out.push({ id: String(a.id), due: day, time: pad(d.getHours()) + ":" + pad(d.getMinutes()),
                   kind: "event", title: a.label || txt(ctx.lang, "today.alarm") });
      });
      try { out = out.concat(stageRows(ctx)); } catch (e) {}
      return out;
    },
    open: function (target, win) {
      if (target && target.stage && typeof win.__orosOpenAt === "function") { win.__orosOpenAt("time", target); return; }
      if (typeof win.__orosOpenTime === "function") win.__orosOpenTime("alarms");
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
