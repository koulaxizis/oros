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
// BR-TODAY-15: an event's details (start–end, the days of a span, the
// note's first line), "Directions" through Maps' { routeTo } when it
// has a place, a tip before a timed event with a place today or an
// early start tomorrow; a contact's name day: open the card, or put
// "wishes" in To-Do (its Add dialog, nothing saved until Add).
// ============================================================
(function (root) {
  "use strict";
  var W = {
    en: { names: "Name day: {n}", more: " and {n} more", contact: "{name}: name day", untitled: "(untitled)",
          pet: "{name}'s birthday", age1: "1 year old", ageN: "{n} years old",
          "tdy.span": "{s}–{e}", "tdy.days": "From {s} to {e}",
          "tdy.tipLeave": "Starts at {t} at {p}: check the way there in time.",
          "tdy.tipEarly": "Tomorrow starts early ({t}): get what you need ready tonight.",
          "tdy.tipWish": "A short message or a call on the day means a lot.",
          "tdy.wish": "Name day wishes: {name}", "tdy.from": "Today" },
    el: { names: "Γιορτάζουν: {n}", more: " και {n} ακόμα", contact: "Γιορτάζει: {name}", untitled: "(χωρίς τίτλο)",
          pet: "Γενέθλια του/της {name}", age1: "1 έτους", ageN: "{n} ετών",
          "tdy.span": "{s}–{e}", "tdy.days": "Από {s} έως {e}",
          "tdy.tipLeave": "Ξεκινά στις {t} στο «{p}»: δες τη διαδρομή εγκαίρως.",
          "tdy.tipEarly": "Αύριο ξεκινάς νωρίς ({t}): ετοίμασε από απόψε ό,τι χρειάζεσαι.",
          "tdy.tipWish": "Ένα σύντομο μήνυμα ή ένα τηλεφώνημα τη μέρα της γιορτής λέει πολλά.",
          "tdy.wish": "Ευχές για τη γιορτή: {name}", "tdy.from": "Σήμερα" }
  };
  var MAX_NAMES = 6;
  function hmNow(now) {
    var d = new Date(typeof now === "number" ? now : Date.now());
    return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  }
  // "12 Nov" in the summary's language (details of a span, BR-TODAY-15)
  function shortDay(ymd, lang) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
    if (!m) return "";
    var loc = root.orosI18n ? root.orosI18n.locale(lang) : (lang === "el" ? "el-GR" : "en-GB");
    try { return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(loc, { day: "numeric", month: "short" }); }
    catch (e) { return ymd; }
  }

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
            var title = typeof ev.title === "string" && ev.title ? ev.title : w.untitled;
            var place = typeof ev.location === "string" ? ev.location.trim() : "";
            var start = inst ? inst.start : (typeof ev.start === "string" ? ev.start : null);
            var end = inst ? inst.end : (typeof ev.end === "string" ? ev.end : null);
            // Details and suggestions (BR-TODAY-15)
            var more = [], acts = [], tip = "";
            if (start && end) more.push(w["tdy.span"].replace("{s}", start).replace("{e}", end));
            if (span) more.push(w["tdy.days"].replace("{s}", shortDay(first, ctx.lang)).replace("{e}", shortDay(last, ctx.lang)));
            var note = typeof ev.note === "string" ? ev.note.split(/\r?\n/).filter(function (x) { return x.trim(); })[0] : "";
            if (note) more.push(note);
            if (place) acts.push({ k: "route", app: "maps", target: { routeTo: { query: place.slice(0, 200), name: title.slice(0, 120) } } });
            if (on === ctx.today && start && place && start > hmNow(ctx.now)) tip = w["tdy.tipLeave"].replace("{t}", start).replace("{p}", place);
            else if (on === ctx.addDays(ctx.today, 1) && start && start < "09:00") tip = w["tdy.tipEarly"].replace("{t}", start);
            out.push({ id: "ev:" + ev.id + ":" + on, due: on, kind: "event",
                       time: start, end: end,
                       title: title,
                       text: place,
                       target: { ev: ev.id, date: occ },
                       more: more, tip: tip, acts: acts });
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
                     target: { contact: x.id },
                     tip: w["tdy.tipWish"],
                     acts: [{ k: "contact", target: { contact: x.id } },
                            { k: "todo", app: "todo", target: { addItems: { from: w["tdy.from"],
                              items: [{ text: w["tdy.wish"].replace("{name}", String(x.name || "").slice(0, 120)) }] } } }] });
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
