// ============================================================
// orOS Health — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after health/core.js. Read-only: reads oros-health-data, never
// writes. One row per reminder time of today that has no reading
// yet ("08:00 Blood pressure"), from OrosHealthCore.timesOn: a
// reading taken up to an hour early, or late, ticks it. Hidden kinds
// stay out. The hour reminders themselves still ring as before.
// Health is a sensitive app: in the summary by default, it can be
// switched off in the Today settings. Opens a new reading of that
// kind (__orosOpenHealth(kind), as the reminder does).
// Wave 2: today's medicine doses that are not marked yet (taken or
// skipped; a snoozed one stays) as tasks at their time, from
// OrosHealthCore.dosesOn (stopped medicines left out), and a top line
// per medicine running low (lowStock). Both open the Medicines tab
// (__orosOpenHealth("meds")).
// Wave 3: doctor's appointments up to the horizon (events) and
// vaccinations due (tasks), see recRows.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-health-data";
  var NAMES = {
    en: { bp: "Blood pressure", wt: "Weight", gl: "Blood sugar", sl: "Sleep",
          hr: "Resting heart rate", tp: "Temperature", o2: "Oxygen (SpO₂)", st: "Steps" },
    el: { bp: "Πίεση", wt: "Βάρος", gl: "Σάκχαρο", sl: "Ύπνος",
          hr: "Σφυγμοί ηρεμίας", tp: "Θερμοκρασία", o2: "Οξυγόνο (SpO₂)", st: "Βήματα" }
  };
  var TXT = { en: "Reading", el: "Μέτρηση" };
  var MED = { en: "Medicine", el: "Φάρμακο" };
  var LOW = { en: ["runs out in about {d} days", "none left", "running low", "runs out in about a day"],
              el: ["φτάνει για περίπου {d} μέρες", "τελείωσε", "τελειώνει", "φτάνει για περίπου μία μέρα"] };

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function medRows(C, d, ctx, lang) {
    if (typeof C.dosesOn !== "function" || !Array.isArray(d.md) || !d.md.length) return [];
    var live = { dl: d.dl, md: d.md.filter(function (m) { return !m.ar; }) }, out = [];
    C.dosesOn(live, ctx.today, ctx.now).forEach(function (r) {
      if (r.state === "taken" || r.state === "skipped") return;
      var hm = pad2(Math.floor(r.tm / 60)) + ":" + pad2(r.tm % 60);
      out.push({ id: "dose@" + r.key, due: ctx.today, time: hm, title: r.med.n + (r.med.s ? " " + r.med.s : ""),
                 text: MED[lang], kind: "task", target: { meds: true } });
    });
    C.lowStock(d, ctx.now).forEach(function (x) {
      var w = LOW[lang], txt = x.left <= 0 ? w[1] : x.days === null ? w[2] : x.days < 2 ? w[3] : w[0].replace("{d}", x.days);
      out.push({ id: "low@" + x.md, due: null, time: null, title: x.med.n + (x.med.s ? " " + x.med.s : "") + ": " + txt,
                 text: "", kind: "info", target: { meds: true } });
    });
    return out;
  }

  // Wave 3: doctor's appointments from today to the horizon as events
  // at their time, and vaccinations whose next dose is due by the
  // horizon (up to 30 days late) as tasks. Open the appointment /
  // vaccination in Health (__orosOpenAt("health", {appt} | {vax})).
  var VAX = { en: "Vaccine dose", el: "Δόση εμβολίου" };
  var APPT = { en: "Doctor's appointment", el: "Ραντεβού με γιατρό" };
  function recRows(C, d, ctx, lang) {
    if (typeof C.recordOn !== "function") return [];
    var out = [], horizon = typeof ctx.horizon === "number" ? ctx.horizon : 3;
    for (var i = 0; i <= horizon; i++) {
      var day = C.ymdAdd(ctx.today, i);
      C.recordOn(d, day).forEach(function (r) {
        if (r.k !== "ap") return;
        var a = r.ap, x = new Date(a.at);
        out.push({ id: "ap@" + a.id, due: day, time: pad2(x.getHours()) + ":" + pad2(x.getMinutes()),
                   title: a.dr && a.sp ? a.dr + " · " + a.sp : (a.dr || a.sp), text: APPT[lang] + (a.pl ? " · " + a.pl : ""),
                   kind: "event", target: { appt: a.id } });
      });
    }
    var last = C.ymdAdd(ctx.today, horizon), first = C.ymdAdd(ctx.today, -30);
    C.vaxOpen(d).forEach(function (v) {
      if (v.nx > last || v.nx < first) return;
      out.push({ id: "vx@" + v.id, due: v.nx, time: null, title: v.n, text: VAX[lang], kind: "task", target: { vax: v.id } });
    });
    return out;
  }

  var PROVIDER = {
    id: "health",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosHealthCore, raw = ctx.readJSON(KEY);
      if (!C || typeof C.timesOn !== "function" || !raw || typeof raw !== "object") return [];
      var d = C.merge(raw, raw), lang = ctx.lang === "el" ? "el" : "en";
      if (C.ymdOf(ctx.now) !== ctx.today) return [];
      return C.timesOn(d, ctx.now).filter(function (s) { return !s.done; }).map(function (s) {
        var row = C.typeRow(d, s.t);
        var name = C.isBuiltin(s.t) ? NAMES[lang][s.t] : (row && row.n) || s.t;
        var hm = pad2(Math.floor(s.min / 60)) + ":" + pad2(s.min % 60);
        return {
          id: s.t + "@" + hm,
          due: ctx.today,
          time: hm,
          title: name,
          text: TXT[lang],
          kind: "task",
          target: { kind: s.t }
        };
      }).concat(medRows(C, d, ctx, lang)).concat(recRows(C, d, ctx, lang));
    },
    open: function (target, win) {
      if (target && (typeof target.appt === "string" || typeof target.vax === "string") && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("health", typeof target.appt === "string" ? { appt: target.appt } : { vax: target.vax });
        return;
      }
      var kind = target && target.meds ? "meds" : target && typeof target.kind === "string" ? target.kind : "";
      if (kind && typeof win.__orosOpenHealth === "function") win.__orosOpenHealth(kind);
      else if (typeof win.__orosOpenApp === "function") win.__orosOpenApp("health");
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
