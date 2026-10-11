// ============================================================
// orOS Calendar — Today provider (v1.0.0, wave 1)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-contacts-data and the Calendar's cached copy
// of its world days (oros-cal-days), never writes, never fetches.
// The rules are calendar/namedays.js (holidaysOn, namesOn,
// contactsCelebrating, observancesOn), the same the Calendar chips and
// the shell's name-day notice use. Rows: today's public holidays,
// who celebrates and world days as top lines; contacts who celebrate
// today (a row: you may want to call them); public holidays of the
// next days. The Calendar's own events join in wave 2.
// Opens: a contact → Contacts (__orosOpenContact), else the Calendar
// on that day (__orosOpenCalendar).
// ============================================================
(function (root) {
  "use strict";
  var W = {
    en: { names: "Name day: {n}", more: " and {n} more", contact: "{name}: name day" },
    el: { names: "Γιορτάζουν: {n}", more: " και {n} ακόμα", contact: "Γιορτάζει: {name}" }
  };
  var MAX_NAMES = 6;

  var PROVIDER = {
    id: "calendar",
    keys: ["oros-contacts-data", "oros-cal-days"],
    collect: function (ctx) {
      var ND = root.OrosNamedays;
      if (!ND) return [];
      var w = W[ctx.lang] || W.en, el = ctx.lang === "el", out = [];
      for (var d = 0; d <= ctx.horizon; d++) {
        var day = ctx.addDays(ctx.today, d);
        ND.holidaysOn(day).forEach(function (h) {
          out.push({ id: "hol:" + h.id + ":" + day, due: day, kind: d === 0 ? "info" : "event",
                     title: el ? h.el : h.en, target: { date: day } });
        });
      }
      var names = ND.namesOn(ctx.today);
      if (names.length) {
        var shown = names.slice(0, MAX_NAMES).join(", ");
        if (names.length > MAX_NAMES) shown += w.more.replace("{n}", names.length - MAX_NAMES);
        out.push({ id: "names:" + ctx.today, kind: "info", title: w.names.replace("{n}", shown), target: { date: ctx.today } });
      }
      var days = ctx.readJSON("oros-cal-days");
      var clean = days && typeof days === "object" ? ND.cleanDays(days.data) : null;
      if (clean) {
        ND.observancesOn(ctx.today, clean).forEach(function (o) {
          out.push({ id: "obs:" + o.id, kind: "info", title: el ? o.el : o.en, target: { date: ctx.today } });
        });
      }
      var ct = ctx.readJSON("oros-contacts-data");
      if (ct && Array.isArray(ct.contacts) && typeof ND.contactsCelebrating === "function") {
        ND.contactsCelebrating(ct.contacts, ctx.today).forEach(function (x) {
          out.push({ id: "nd:" + x.id, due: ctx.today, kind: "event", title: w.contact.replace("{name}", x.name),
                     target: { contact: x.id } });
        });
      }
      return out;
    },
    open: function (target, win) {
      if (target && typeof target.contact === "string") {
        if (typeof win.__orosOpenContact === "function") win.__orosOpenContact(target.contact);
        return;
      }
      var day = target && typeof target.date === "string" ? target.date : "";
      if (typeof win.__orosOpenCalendar === "function") win.__orosOpenCalendar("day", day);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
