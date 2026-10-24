// ============================================================
// orOS Calendar — Today provider (v1.2.0, wave 4)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-calendar-data (+ the shared oros-calendar-hh), oros-contacts-data and the
// Calendar's cached copy of its world days (oros-cal-days), never
// writes, never fetches. The rules are calendar/occur.js (eventsOn:
// your own events, series included, the same walk the Calendar draws
// and the reminder engine uses) and calendar/namedays.js (holidaysOn,
// namesOn, contactsCelebrating, observancesOn). Rows: your events of
// today and the next days (a multi-day event once, on its first day,
// or today while it runs); today's public holidays, who celebrates
// and world days as top lines; contacts who celebrate today; public
// holidays of the next days; the screen pet's birthday (wave 4,
// namedays.js petBirthday, the Calendar's pet feed rule; left out when
// the pet's Calendar feed is switched off on this device).
// Opens: the pet's birthday → the screen pet (__orosOpenPet); an event → that event in the Calendar; a contact → Contacts
// (__orosOpenContact); else the Calendar on that day
// (__orosOpenCalendar).
// ============================================================
(function (root) {
  "use strict";
  var W = {
    en: { names: "Name day: {n}", more: " and {n} more", contact: "{name}: name day", untitled: "(untitled)",
          pet: "{name}'s birthday", age1: "1 year old", ageN: "{n} years old" },
    el: { names: "Γιορτάζουν: {n}", more: " και {n} ακόμα", contact: "Γιορτάζει: {name}", untitled: "(χωρίς τίτλο)",
          pet: "Γενέθλια του/της {name}", age1: "1 έτους", ageN: "{n} ετών" }
  };
  var MAX_NAMES = 6;

  var PROVIDER = {
    id: "calendar",
    keys: ["oros-calendar-data", "oros-calendar-hh", "oros-contacts-data", "oros-cal-days", "oros-pet-data"],
    collect: function (ctx) {
      var ND = root.OrosNamedays, OCC = root.OrosCalOccur;
      // A pack language: English + the calendar pack, when one is loaded.
      if (!W[ctx.lang] && root.orosI18n) root.orosI18n.table(W, "calendar", ctx.lang);
      var w = W[ctx.lang] || W.en, el = ctx.lang === "el", out = [];
      var cal = OCC ? ctx.readJSON("oros-calendar-data") : null;
      // calendars shared with a household (calendar/house.js mirror)
      var hh = OCC ? ctx.readJSON("oros-calendar-hh") : null;
      if (hh && Array.isArray(hh.events) && hh.events.length) {
        cal = { events: (cal && Array.isArray(cal.events) ? cal.events : []).concat(hh.events),
                deleted: cal && Array.isArray(cal.deleted) ? cal.deleted : [] };
      }
      if (cal && Array.isArray(cal.events)) {
        for (var e = 0; e <= ctx.horizon; e++) {
          var on = ctx.addDays(ctx.today, e);
          OCC.eventsOn(cal, on).forEach(function (ev) {
            // This occurrence as seen here (its own time zone converted,
            // a repeating span included).
            var inst = typeof OCC.instanceOn === "function" ? OCC.instanceOn(ev, on) : null;
            var first = inst ? inst.date : ev.date, last = inst ? inst.dateEnd : ev.dateEnd;
            var span = typeof last === "string" && last > first;
            if (span && on !== first && on !== ctx.today) return;     // a running span: once
            var occ = inst && OCC.validRecur(ev.recur) ? inst.occ : on;
            out.push({ id: "ev:" + ev.id + ":" + on, due: on, kind: "event",
                       time: inst ? inst.start : (typeof ev.start === "string" ? ev.start : null),
                       title: typeof ev.title === "string" && ev.title ? ev.title : w.untitled,
                       text: typeof ev.location === "string" ? ev.location : "",
                       target: { ev: ev.id, date: occ } });
          });
        }
      }
      if (!ND) return out;
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
      var pd = ctx.readJSON("oros-pet-data"), pet = pd && typeof pd.pet === "object" ? pd.pet : null;
      if (pet && typeof ND.petBirthday === "function" && ctx.readRaw("oros-pet-calendar-sync") !== "0") {
        for (var q = 0; q <= ctx.horizon; q++) {
          var pday = ctx.addDays(ctx.today, q), age = ND.petBirthday(pet, pday);
          if (!age) continue;
          out.push({ id: "pet:" + pday, due: pday, kind: "event",
                     title: w.pet.replace("{name}", typeof pet.name === "string" && pet.name ? pet.name : "?"),
                     text: age === 1 ? w.age1 : w.ageN.replace("{n}", age), target: { pet: true } });
        }
      }
      return out;
    },
    open: function (target, win) {
      if (target && target.pet === true) {
        if (typeof win.__orosOpenPet === "function") win.__orosOpenPet(null);
        return;
      }
      if (target && typeof target.contact === "string") {
        if (typeof win.__orosOpenContact === "function") win.__orosOpenContact(target.contact);
        return;
      }
      var day = target && typeof target.date === "string" ? target.date : "";
      var ev = target && typeof target.ev === "string" ? target.ev : "day";   // unknown id → that day
      if (typeof win.__orosOpenCalendar === "function") win.__orosOpenCalendar(ev, day);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
