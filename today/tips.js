// ============================================================
// orOS Today — tips of the day (T2, BR-TODAY-16)
// ------------------------------------------------------------
// Pure logic, no DOM, no storage: the Today app draws what this
// decides; node tests require it (tests/today-tips.test.js).
//   - make(input) → at most MAX tips, each { id, rule, text, acts }:
//     plain rules that look at the summary's rows of several apps at
//     once (the rows already gathered, the providers' facts: Weather's
//     max / min / rain chance, Water's total and goal). Nothing is
//     fetched, nothing is sent, no AI.
//   - the text is plain (drawn with textContent); acts are the same
//     kinds as a row's (OrosTodayAgg.ACTS), so the Today app draws
//     the labels and the app that receives one does the work
//   - choices (device-local, R10, localStorage "oros-today-tips"):
//     "Not today" hides one tip until the day changes, "Don't show
//     this kind" mutes its rule until "Show muted tips again" in the
//     Today settings. norm / hide / mute / unmute / visible.
//   - sensitive apps: a rule never quotes Cycle, Mood, Health, Baby
//     or Mail rows (it does not look at them at all)
// Exposed as window.OrosTodayTips (module.exports in node).
// ============================================================
(function (root) {
  "use strict";

  var MAX = 5;
  var STATE_KEY = "oros-today-tips";
  var RULES = ["rain", "heat", "cold", "late", "busy", "water", "quiet"];
  var RAIN_POP = 50, HOT_C = 32, COLD_C = 1, LATE_N = 3, LATE_OLD = 7, BUSY_N = 4, WATER_HOUR = 14;

  var W = {
    en: {
      "tp.rain": "Rain is likely today ({p}%): take an umbrella for {t} {e}.",
      "tp.heat": "A hot day ({d}): drink more water and keep out of the midday sun.",
      "tp.heatPlants": "A hot day ({d}): your plants may need water sooner than usual.",
      "tp.cold": "Cold tonight ({d}): dress warmly, and bring in plants that fear the frost.",
      "tp.late": "{n} tasks are late, {o} of them by more than a week: give them new dates, or drop what no longer matters.",
      "tp.late0": "{n} tasks are late: start with the oldest, or give them new dates.",
      "tp.busy": "A busy day: {n} things with a time, the first at {f} and the last at {l}. Leave some room between them.",
      "tp.water": "Only {a} of {g} of water so far: a glass now helps.",
      "tp.quiet": "A quiet day with nothing due: a good moment for a habit, a walk or a game."
    },
    el: {
      "tp.rain": "Πιθανή βροχή σήμερα ({p}%): πάρε ομπρέλα για τις {t}, {e}.",
      "tp.heat": "Ζεστή μέρα ({d}): πίνε περισσότερο νερό και απόφυγε τον μεσημεριανό ήλιο.",
      "tp.heatPlants": "Ζεστή μέρα ({d}): τα φυτά σου ίσως θέλουν νερό νωρίτερα από ό,τι συνήθως.",
      "tp.cold": "Κρύο απόψε ({d}): ντύσου ζεστά και μάζεψε μέσα τα φυτά που φοβούνται την παγωνιά.",
      "tp.late": "{n} εργασίες καθυστερούν, οι {o} πάνω από μια εβδομάδα: δώσε τους νέες ημερομηνίες ή σβήσε όσες δεν μετράνε πια.",
      "tp.late0": "{n} εργασίες καθυστερούν: ξεκίνα από την παλαιότερη ή δώσε τους νέες ημερομηνίες.",
      "tp.busy": "Γεμάτη μέρα: {n} πράγματα με ώρα, το πρώτο στις {f} και το τελευταίο στις {l}. Άφησε λίγο χρόνο ανάμεσα.",
      "tp.water": "Μόνο {a} από {g} νερό ως τώρα: ένα ποτήρι τώρα βοηθά.",
      "tp.quiet": "Ήσυχη μέρα χωρίς εκκρεμότητες: καλή στιγμή για μια συνήθεια, μια βόλτα ή ένα παιχνίδι."
    }
  };
  function words(lang) {
    var I = root.orosI18n;
    if (I && lang && !W[lang] && typeof I.table === "function") I.table(W, "today", lang);
    return W[lang] || W.en;
  }
  function fill(s, v) {
    Object.keys(v).forEach(function (k) { s = s.split("{" + k + "}").join(String(v[k])); });
    return s;
  }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hm(now) { var d = new Date(now); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function deg(c, imp) { return Math.round(imp ? c * 9 / 5 + 32 : c) + "°"; }
  function ml(v, lang) {
    if (v >= 1000) {
      var l = (v / 1000).toFixed(1).replace(/\.0$/, "");
      return (lang === "en" ? l : l.replace(".", ",")) + " L";
    }
    return Math.round(v) + " ml";
  }
  function diffDays(a, b) {          // days from a to b (YYYY-MM-DD)
    var p = function (s) { var m = s.split("-"); return Date.UTC(+m[0], +m[1] - 1, +m[2]) / 86400000; };
    return Math.round(p(b) - p(a));
  }

  // input = { groups: { overdue, today, soon, info }, facts: { app: {} },
  //           today: "YYYY-MM-DD", now: ms, lang, apps: [id] (installed) }
  function make(input) {
    var g = isObj(input && input.groups) ? input.groups : {};
    var facts = isObj(input && input.facts) ? input.facts : {};
    var today = input && typeof input.today === "string" ? input.today : "";
    var now = input && typeof input.now === "number" ? input.now : Date.now();
    var lang = input && input.lang, w = words(lang);
    var apps = {};
    (input && Array.isArray(input.apps) ? input.apps : []).forEach(function (id) { apps[id] = 1; });
    var overdue = Array.isArray(g.overdue) ? g.overdue : [];
    var todays = Array.isArray(g.today) ? g.today : [];
    var nowHM = hm(now), out = [];
    var wx = isObj(facts.weather) ? facts.weather : null, wa = isObj(facts.water) ? facts.water : null;
    function add(rule, text, acts) { out.push({ id: rule + ":" + today, rule: rule, text: text, acts: acts || [] }); }
    function sipAct() { return wa ? [{ k: "sip", app: "water", target: { sip: "glass" } }] : []; }

    // 1. rain + a timed event with a place still to come today
    if (wx && num(wx.pop) !== null && wx.pop >= RAIN_POP) {
      var ev = todays.filter(function (r) {
        return r.app === "calendar" && r.kind === "event" && r.time && r.time > nowHM && r.text;
      })[0];
      if (ev) {
        var route = (ev.acts || []).filter(function (a) { return a.k === "route"; });
        add("rain", fill(w["tp.rain"], { p: Math.round(wx.pop), t: ev.time, e: ev.title }), route);
      }
    }
    // 2. heat (with plants due: their own tip)
    if (wx && num(wx.max) !== null && wx.max >= HOT_C) {
      var plants = todays.concat(overdue).some(function (r) { return r.app === "plants"; });
      add("heat", fill(w[plants ? "tp.heatPlants" : "tp.heat"], { d: deg(wx.max, wx.imp) }), plants ? [] : sipAct());
    }
    // 3. cold night
    if (wx && num(wx.min) !== null && wx.min <= COLD_C) add("cold", fill(w["tp.cold"], { d: deg(wx.min, wx.imp) }));
    // 4. a pile of late tasks (To-Do, Kanban and the others' tasks)
    var late = overdue.filter(function (r) { return r.kind === "task"; });
    if (late.length >= LATE_N) {
      var old = late.filter(function (r) { return r.due && today && diffDays(r.due, today) > LATE_OLD; }).length;
      var todo = late.some(function (r) { return r.app === "todo"; });
      add("late", fill(w[old ? "tp.late" : "tp.late0"], { n: late.length, o: old }),
        todo ? [{ k: "open", app: "todo", target: { list: late.filter(function (r) { return r.app === "todo"; })[0].target.list } }] : []);
    }
    // 5. a busy day
    var timed = todays.filter(function (r) { return r.time; }).map(function (r) { return r.time; }).sort();
    if (timed.length >= BUSY_N) add("busy", fill(w["tp.busy"], { n: timed.length, f: timed[0], l: timed[timed.length - 1] }));
    // 6. water behind in the afternoon (and not already said by the heat tip)
    if (wa && num(wa.total) !== null && num(wa.goal) && wa.total < wa.goal / 2 && new Date(now).getHours() >= WATER_HOUR &&
        !out.some(function (t) { return t.rule === "heat"; })) {
      add("water", fill(w["tp.water"], { a: ml(wa.total, lang), g: ml(wa.goal, lang) }), sipAct());
    }
    // 7. a quiet day
    var due = late.length + todays.filter(function (r) { return r.kind === "task" || r.time; }).length;
    if (!due && !out.length) add("quiet", w["tp.quiet"], apps.habits ? [{ k: "open", app: "habits", target: {} }] : []);
    return out.slice(0, MAX);
  }

  // ---------- Choices (device-local) ----------
  function norm(raw, today) {
    var s = isObj(raw) ? raw : {};
    var day = typeof s.d === "string" ? s.d : "";
    var hid = day === today && Array.isArray(s.hid) ? s.hid.filter(function (x) { return typeof x === "string"; }).slice(0, 50) : [];
    var mute = Array.isArray(s.mute) ? s.mute.filter(function (x) { return RULES.indexOf(x) >= 0; }) : [];
    var seen = {};
    mute = mute.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; });
    return { d: today, hid: hid, mute: mute };
  }
  function hide(s, id, today) {
    var n = norm(s, today);
    if (n.hid.indexOf(id) < 0) n.hid.push(String(id).slice(0, 80));
    return n;
  }
  function mute(s, rule, today) {
    var n = norm(s, today);
    if (RULES.indexOf(rule) >= 0 && n.mute.indexOf(rule) < 0) n.mute.push(rule);
    return n;
  }
  function unmute(s, today) { var n = norm(s, today); n.mute = []; return n; }
  function visible(tips, s, today) {
    var n = norm(s, today);
    return (Array.isArray(tips) ? tips : []).filter(function (t) {
      return n.hid.indexOf(t.id) < 0 && n.mute.indexOf(t.rule) < 0;
    });
  }

  var api = { MAX: MAX, RULES: RULES, STATE_KEY: STATE_KEY, W: W, make: make,
              norm: norm, hide: hide, mute: mute, unmute: unmute, visible: visible };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosTodayTips = api;
})(typeof window !== "undefined" ? window : globalThis);
