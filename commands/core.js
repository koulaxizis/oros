// ============================================================
// orOS — commands/core.js (command bar, pure core, v1.0.0)
// One line of plain words (English and Greek, mixed freely) → one
// action in an orOS app, on the device, without AI:
//   "ραντεβού αύριο 10 οδοντίατρος" · "dentist fri 9:30"   → Calendar
//   "γάλα στη λίστα" · "buy milk, eggs"                     → To-Do (groceries)
//   "θυμήσου να πάρω τη μάνα" · "todo call Nikos"           → To-Do
//   "ξόδεψα 12€ καφές" · "spent 30 on fuel" · "πήρα 500 μισθό" → Budget
//   "σημείωση: …" · "note …"                                → Notes
//   "ένα ποτήρι νερό" · "drank water"                       → Water
//   "άνοιξε χάρτες" · "open budget"                         → that app
// Anything else → null (the caller searches as usual).
//
// parse(text, opts) → null | { kind, app, data }
//   opts = { today: "YYYY-MM-DD", apps: [{ id, names: [..] }] (installed),
//            cal: OrosCalQuick (calendar/quickadd.js) }
//   kind  event | todo | expense | income | note | water | open
//   data  the fields of that kind, already clean and capped:
//     event   { date, title, start, end, dateEnd, location, recur }
//     todo    { list: "tdl-groceries" | "", items: [{ text }] }
//     expense / income  { cents, cat, note, date }
//     note    { title, text }
//     water   {}
//     open    { id }
// call(cmd, lang) → { fn, args } the bridge the shell calls:
//   __orosOpenCalendarNew (BR-W8), __orosOpenAt("todo", {addItems})
//   (BR-TD-ADD), __orosOpenBudgetNew (BR-B1), __orosOpenAt("notes",
//   {add}), __orosOpenAt("water", {sip}), openAppById. Every one opens
//   a form or a prefill; nothing is saved until the user saves there
//   (BR-W8-6). Water's {sip} is the one exception: the user's Enter in
//   the bar is the confirmation, the same as the app's own button.
// describe(cmd, lang) → { verb, detail } for the preview row.
// The text is never run and never becomes HTML. No DOM, no storage.
// Node tests load it as is (tests/commands.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var MAX_IN = 300;              // longer lines are searches, not commands
  var MAX_TITLE = 200;
  var MAX_ITEM = 300;
  var MAX_ITEMS = 50;
  var MAX_NOTE = 140;            // Budget note (the Assistant's cap)
  var MAX_TEXT = 20000;          // Notes' {add} cap

  // ---------- Folding: lower case, no accents, final sigma → σ ----------
  // One character in, one out: positions on the folded copy are
  // positions in the original text (same rule as calendar/quickadd.js).
  function foldChar(c) {
    var l = c.toLowerCase();
    if (l.length !== 1) return c;
    if (l === "ς") return "σ";
    var n = l.normalize ? l.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : l;
    return n.length === 1 ? n : l;
  }
  function fold(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) out += foldChar(s.charAt(i));
    return out;
  }
  var CTRL = /[\u0000-\u001f\u007f\u2028\u2029]/g;
  function clean(s) { return String(s).replace(CTRL, " ").replace(/\s+/g, " ").trim(); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function trimJunk(s) {
    // Leading / trailing joiners and punctuation left after a cut.
    return clean(s).replace(/^[\s:,.;\-–—]+|[\s:,.;\-–—]+$/g, "")
      .replace(/^(?:για|σε|στο|στη|στην|στον|for|on|at|to|the|a|an|το|τη|την|τον|ενα|μια|ένα|μία)\s+/i, "")
      .trim();
  }

  // A word of Latin or Greek letters (folded text).
  var L = "a-z0-9α-ωϊϋ";
  // `head` at the very start (then a space, ":" or the end).
  function lead(f, words) {
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (f.indexOf(w) === 0) {
        var nx = f.charAt(w.length);
        if (!nx || /[\s:,.\-–—]/.test(nx)) return w.length;
      }
    }
    return -1;
  }
  function rest(text, n) { return trimJunk(text.slice(n)); }

  // ---------- Day math (whole UTC days) ----------
  function dayNum(s) { var p = s.split("-"); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function fromDayNum(n) {
    var d = new Date(n * 86400000);
    var m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    return d.getUTCFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (dd < 10 ? "0" : "") + dd;
  }
  function okDay(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  // ---------- Words (folded) ----------
  var W = {
    event: ["ραντεβου", "συναντηση", "meeting", "appointment", "event", "ημερολογιο", "calendar"],
    eventStrip: ["ημερολογιο", "calendar", "event"],
    spent: ["ξοδεψα", "πληρωσα", "εδωσα", "εξοδο", "εξοδα", "spent", "paid", "expense", "pay"],
    earned: ["πηρα", "εισεπραξα", "εσοδο", "εσοδα", "πληρωθηκα", "earned", "received", "income", "got paid", "got"],
    todo: ["θυμησου να", "θυμησου", "να θυμηθω να", "να θυμηθω", "θυμισε μου να", "θυμισε μου", "υπενθυμιση",
           "remind me to", "remind me", "todo", "to-do", "to do", "task", "εργασια", "να κανω"],
    buy: ["αγορασε", "να αγορασω", "να παρω απο το σουπερ", "ψωνια", "buy", "shopping", "groceries"],
    note: ["σημειωση", "σημειωσε", "κρατα σημειωση", "note", "write down"],
    open: ["ανοιξε το", "ανοιξε τη", "ανοιξε την", "ανοιξε τον", "ανοιξε", "παμε σε", "παμε στο", "παμε στη", "open", "go to", "launch", "start"]
  };
  // "… στη λίστα" / "… on the list": the end of the line.
  var LIST_TAIL = /\s+(?:(?:στη|στην|σε|για) λιστα(?: (?:για |με τα )?ψωνια| του σουπερ)?|στα ψωνια|(?:to|on|in) (?:the |my )?(?:shopping |grocery )?list|to (?:the |my )?groceries)\s*$/;
  // Water: the whole line.
  var WATER = /^(?:(?:ενα |1 )?ποτηρι νερο|νερο|επια (?:ενα )?(?:ποτηρι )?νερο|(?:a |one )?glass of water|drank (?:a glass of )?water|water)$/;

  // Budget categories (budget.js ready ids), by words (folded).
  var CATS = [
    ["o-eat", ["καφε", "καφεσ", "φρεντο", "εσπρεσο", "φαγητο", "εστιατοριο", "ταβερνα", "σουβλακ", "πιτσα", "μπυρα",
               "ποτο", "coffee", "cafe", "lunch", "dinner", "breakfast", "restaurant", "pizza", "beer", "drinks", "takeaway"]],
    ["o-groc", ["σουπερ", "μαρκετ", "λαικη", "ψωνια", "φουρνο", "supermarket", "groceries", "grocery", "bakery", "market"]],
    ["o-trans", ["βενζινη", "καυσιμα", "ταξι", "εισιτηριο", "λεωφορειο", "μετρο", "παρκινγκ", "διοδια", "fuel", "petrol",
                 "gas", "taxi", "uber", "ticket", "bus", "metro", "train", "parking", "toll"]],
    ["o-bills", ["ρευμα", "δεη", "λογαριασμο", "ιντερνετ", "κινητο", "τηλεφωνο", "κοινοχρηστα", "electricity", "bill",
                 "internet", "phone", "water bill"]],
    ["o-home", ["ενοικιο", "rent", "σπιτι", "home"]],
    ["o-health", ["φαρμακειο", "φαρμακα", "γιατρο", "οδοντιατρο", "pharmacy", "medicine", "doctor", "dentist"]],
    ["o-fun", ["σινεμα", "θεατρο", "συναυλια", "netflix", "spotify", "cinema", "movies", "concert", "games"]],
    ["o-cloth", ["ρουχα", "παπουτσια", "clothes", "shoes", "shirt"]],
    ["o-gift", ["δωρο", "gift", "present"]]
  ];
  var INCATS = [
    ["i-salary", ["μισθο", "μισθοσ", "salary", "wage", "paycheck"]],
    ["i-free", ["τιμολογιο", "πελατη", "freelance", "invoice", "client"]],
    ["i-gift", ["δωρο", "gift"]]
  ];
  function catOf(list, f) {
    for (var i = 0; i < list.length; i++) {
      for (var j = 0; j < list[i][1].length; j++) {
        if (new RegExp("(^|[^" + L + "])" + list[i][1][j]).test(f)) return list[i][0];
      }
    }
    return "";
  }

  // ---------- Money: "12€", "€12", "12,50 ευρώ", "30 eur", "$5" ----------
  var MONEY = /(?:(?:€|\$|£)\s*(\d{1,9}(?:[.,]\d{1,2})?))|(?:(\d{1,9}(?:[.,]\d{1,2})?)\s*(?:€|\$|£|ευρω|ευρουλα|ευρα|eur|euro|euros|e|δολαρια|dollars?|usd)?(?![\d.,]))/;
  function money(f) {
    var m = MONEY.exec(f);
    if (!m) return null;
    var num = (m[1] || m[2]).replace(",", ".");
    var cents = Math.round(parseFloat(num) * 100);
    if (!(cents > 0) || cents > 100000000000) return null;
    return { cents: cents, at: m.index, len: m[0].length };
  }

  // ---------- Kinds ----------
  function parseMoney(text, f, today, kindWord, isIncome) {
    var n = lead(f, isIncome ? W.earned : W.spent);
    if (n < 0) return null;
    var body = text.slice(n), bf = f.slice(n);
    var mo = money(bf);
    if (!mo) return null;
    var cut = body.slice(0, mo.at) + " " + body.slice(mo.at + mo.len);
    var cf = fold(cut);
    var date = today;
    var dm = /(^|\s)(χθεσ|yesterday|προχθεσ)(?=\s|$)/.exec(cf);
    if (dm) {
      date = fromDayNum(dayNum(today) - (dm[2] === "προχθεσ" ? 2 : 1));
      cut = cut.slice(0, dm.index) + " " + cut.slice(dm.index + dm[0].length);
      cf = fold(cut);
    }
    var note = trimJunk(cut).slice(0, MAX_NOTE);
    return {
      kind: isIncome ? "income" : "expense", app: "budget",
      data: { cents: mo.cents, cat: catOf(isIncome ? INCATS : CATS, cf) || (isIncome ? "i-other" : "o-other"),
              note: cap(note), date: date }
    };
  }

  // "12€ καφές" with no verb: an expense too (a sum with a currency mark).
  function parseBareMoney(text, f, today) {
    if (!/^(?:€|\$|£)?\s*\d/.test(f) && !/\d\s*(?:€|\$|£|ευρω|eur)\b/.test(f)) return null;
    if (!/(€|\$|£|ευρω|eur)/.test(f)) return null;
    var mo = money(f);
    if (!mo) return null;
    var cut = text.slice(0, mo.at) + " " + text.slice(mo.at + mo.len);
    var note = trimJunk(cut);
    if (!note) return null;          // a bare "12€" is a search
    return { kind: "expense", app: "budget",
             data: { cents: mo.cents, cat: catOf(CATS, fold(cut)) || "o-other", note: cap(note.slice(0, MAX_NOTE)), date: today } };
  }

  function splitItems(s) {
    var out = [];
    s.split(/\s*(?:,|;|\+|\s&\s|\sκαι\s|\sand\s)\s*/i).forEach(function (p) {
      var t = trimJunk(p).slice(0, MAX_ITEM);
      if (t && out.length < MAX_ITEMS) out.push({ text: cap(t) });
    });
    return out;
  }

  function parseList(text, f) {
    var tail = LIST_TAIL.exec(f);
    var n = lead(f, W.buy);
    if (!tail && n < 0) return null;
    var body = text.slice(n < 0 ? 0 : n, tail ? tail.index : text.length);
    var bn = lead(fold(body), ["βαλε", "προσθεσε", "add", "put"]);
    if (bn >= 0) body = body.slice(bn);
    var items = splitItems(body);
    if (!items.length) return null;
    return { kind: "todo", app: "todo", data: { list: "tdl-groceries", items: items } };
  }

  function parseTodo(text, f) {
    var n = lead(f, W.todo);
    if (n < 0) return null;
    var t = rest(text, n).slice(0, MAX_ITEM);
    if (!t) return null;
    return { kind: "todo", app: "todo", data: { list: "", items: [{ text: cap(t) }] } };
  }

  function parseNote(text, f) {
    var n = lead(f, W.note);
    if (n < 0) return null;
    var body = text.slice(n).replace(/^[\s:,\-–—]+/, "").trim().slice(0, MAX_TEXT);
    if (!body) return null;
    return { kind: "note", app: "notes", data: { title: cap(clean(body).slice(0, 60)), text: body } };
  }

  // Calendar: an explicit word ("ραντεβού", "meeting"…), or a line with
  // a date AND a time. A bare hour after the day ("αύριο 10 …") counts
  // as the time here (quick add itself asks for "στις 10").
  function parseEvent(text, f, today, cal, explicit) {
    if (!cal || typeof cal.parse !== "function") return null;
    var src = text;
    var sn = lead(f, W.eventStrip);
    if (sn >= 0) src = text.slice(sn).replace(/^[\s:]+/, "");
    var q = cal.parse(src, { today: today });
    if (q && q.found && q.found.date && !q.found.time) {
      // "… 10 …" → "… στις 10 …" (only a lone 0–23 number, not 15/11).
      var m = /(^|\s)([01]?\d|2[0-3])(?=\s|$)/.exec(src);
      if (m) {
        var again = cal.parse(src.slice(0, m.index) + m[1] + "@" + m[2] + src.slice(m.index + m[0].length), { today: today });
        if (again && again.found && again.found.time) q = again;
      }
    }
    if (!q || !q.found) return null;
    if (!explicit && !(q.found.date && q.found.time)) return null;
    if (!explicit && !q.found.date && !q.found.repeat) return null;
    var title = cap(clean(q.title || "").slice(0, MAX_TITLE));
    if (!title) return null;
    return { kind: "event", app: "calendar",
             data: { date: q.date, title: title, start: q.start || null, end: q.end || null,
                     dateEnd: q.dateEnd || null, location: clean(q.location || "").slice(0, 150), recur: q.recur || null } };
  }

  function parseOpen(text, f, apps) {
    var n = lead(f, W.open);
    if (n < 0) return null;
    var want = fold(rest(text, n));
    if (!want) return null;
    var hit = null, part = null;
    (apps || []).forEach(function (a) {
      if (!a || typeof a.id !== "string") return;
      var names = [a.id].concat(Array.isArray(a.names) ? a.names : []);
      names.forEach(function (nm) {
        var fn = fold(String(nm || ""));
        if (!fn) return;
        if (fn === want) hit = hit || a.id;
        else if (!part && (fn.indexOf(want) === 0 || (want.length >= 4 && fn.indexOf(want) >= 0))) part = a.id;
      });
    });
    var id = hit || part;
    return id ? { kind: "open", app: id, data: { id: id } } : null;
  }

  function has(apps, id) {
    if (!Array.isArray(apps)) return true;    // no list given: assume yes (tests)
    for (var i = 0; i < apps.length; i++) if (apps[i] && apps[i].id === id) return true;
    return false;
  }

  function parse(text, opts) {
    if (typeof text !== "string") return null;
    var o = opts || {};
    var today = okDay(o.today) ? o.today : fromDayNum(Math.floor(Date.now() / 86400000));
    var t = clean(text);
    if (!t || t.length > MAX_IN) return null;
    var f = fold(t);
    var apps = o.apps;
    var tries = [
      function () { return parseOpen(t, f, apps); },
      function () { return WATER.test(f) ? { kind: "water", app: "water", data: {} } : null; },
      function () { return parseMoney(t, f, today, "spent", false); },
      function () { return parseMoney(t, f, today, "earned", true); },
      function () { return parseNote(t, f); },
      function () { return parseTodo(t, f); },
      function () { return parseList(t, f); },
      function () { return lead(f, W.event) >= 0 ? parseEvent(t, f, today, o.cal, true) : null; },
      function () { return parseBareMoney(t, f, today); },
      function () { return parseEvent(t, f, today, o.cal, false); }
    ];
    for (var i = 0; i < tries.length; i++) {
      var r = null;
      try { r = tries[i](); } catch (e) { r = null; }
      if (r && has(apps, r.app)) return r;
    }
    return null;
  }

  // ---------- The bridge call (built again from data, never trusted) ----------
  function call(cmd, lang) {
    if (!cmd || typeof cmd !== "object" || !cmd.data) return null;
    var d = cmd.data, el = lang === "el";
    switch (cmd.kind) {
      case "event": {
        if (!okDay(d.date) || typeof d.title !== "string" || !d.title) return null;
        var p = { date: d.date, title: d.title.slice(0, MAX_TITLE) };
        if (/^\d{2}:\d{2}$/.test(d.start || "")) p.start = d.start;
        if (/^\d{2}:\d{2}$/.test(d.end || "")) p.end = d.end;
        if (okDay(d.dateEnd)) p.dateEnd = d.dateEnd;
        if (d.location) p.location = String(d.location).slice(0, 150);
        if (d.recur && typeof d.recur === "object") p.recur = d.recur;
        return { fn: "__orosOpenCalendarNew", args: [p] };
      }
      case "todo": {
        var items = (Array.isArray(d.items) ? d.items : []).slice(0, MAX_ITEMS).map(function (it) {
          return { text: String(it && it.text || "").slice(0, MAX_ITEM), note: "" };
        }).filter(function (it) { return it.text; });
        if (!items.length) return null;
        var add = { from: el ? "Γραμμή εντολών" : "Command bar", items: items };
        if (d.list === "tdl-groceries") add.list = "tdl-groceries";
        return { fn: "__orosOpenAt", args: ["todo", { addItems: add }] };
      }
      case "expense":
      case "income": {
        var c = d.cents;
        if (typeof c !== "number" || Math.floor(c) !== c || c <= 0 || c > 100000000000) return null;
        var b = { k: cmd.kind === "income" ? "i" : "o", a: c, src: "command" };
        if (okDay(d.date)) b.d = d.date;
        if (d.note) b.n = String(d.note).slice(0, MAX_NOTE);
        if (/^[io]-[a-z]{1,10}$/.test(d.cat || "")) b.c = d.cat;
        return { fn: "__orosOpenBudgetNew", args: [b] };
      }
      case "note":
        if (!d.text) return null;
        return { fn: "__orosOpenAt", args: ["notes", { add: { title: String(d.title || "").slice(0, 200), text: String(d.text).slice(0, MAX_TEXT) } }] };
      case "water":
        return { fn: "__orosOpenAt", args: ["water", { sip: "glass" }] };
      case "open":
        return (typeof d.id === "string" && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(d.id)) ? { fn: "openAppById", args: [d.id] } : null;
    }
    return null;
  }

  // ---------- Preview text ----------
  var STR = {
    en: { event: "New event", todo: "Add to To-Do", groc: "Add to the shopping list", expense: "New expense",
          income: "New income", note: "New note", water: "A glass of water", open: "Open",
          allDay: "all day", cats: { "o-eat": "Eating out", "o-groc": "Groceries", "o-trans": "Transport", "o-bills": "Bills",
          "o-home": "Rent & home", "o-health": "Health", "o-fun": "Entertainment", "o-cloth": "Clothing", "o-gift": "Gifts",
          "o-other": "Other", "i-salary": "Salary", "i-free": "Freelance", "i-gift": "Gifts", "i-other": "Other" } },
    el: { event: "Νέο συμβάν", todo: "Προσθήκη στο To-Do", groc: "Στη λίστα για ψώνια", expense: "Νέο έξοδο",
          income: "Νέο έσοδο", note: "Νέα σημείωση", water: "Ένα ποτήρι νερό", open: "Άνοιγμα",
          allDay: "όλη μέρα", cats: { "o-eat": "Φαγητό έξω", "o-groc": "Σούπερ μάρκετ", "o-trans": "Μεταφορές", "o-bills": "Λογαριασμοί",
          "o-home": "Ενοίκιο & σπίτι", "o-health": "Υγεία", "o-fun": "Ψυχαγωγία", "o-cloth": "Ρούχα", "o-gift": "Δώρα",
          "o-other": "Άλλα", "i-salary": "Μισθός", "i-free": "Ελεύθερο επάγγελμα", "i-gift": "Δώρα", "i-other": "Άλλα" } }
  };
  var WD = { en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], el: ["Κυρ", "Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ"] };
  function dayText(s, lang) {
    if (!okDay(s)) return "";
    var p = s.split("-");
    var wd = ((dayNum(s) % 7) + 7 + 4) % 7;
    return WD[lang][wd] + " " + (+p[2]) + "/" + (+p[1]);
  }
  function euros(c, lang) {
    var v = (c / 100).toFixed(2);
    return (lang === "el" ? v.replace(".", ",") : v) + " €";
  }
  function describe(cmd, lang) {
    var lg = lang === "el" ? "el" : "en", S = STR[lg], d = cmd && cmd.data || {};
    switch (cmd && cmd.kind) {
      case "event":
        return { verb: S.event, detail: [dayText(d.date, lg), d.start ? d.start + (d.end ? "–" + d.end : "") : S.allDay,
                                           d.title, d.location].filter(Boolean).join(" · ") };
      case "todo":
        return { verb: d.list === "tdl-groceries" ? S.groc : S.todo,
                 detail: (d.items || []).map(function (it) { return it.text; }).join(", ") };
      case "expense":
      case "income":
        return { verb: S[cmd.kind], detail: [euros(d.cents, lg), S.cats[d.cat] || "", d.note,
                                             d.date ? dayText(d.date, lg) : ""].filter(Boolean).join(" · ") };
      case "note": return { verb: S.note, detail: d.title };
      case "water": return { verb: S.water, detail: "" };
      case "open": return { verb: S.open, detail: "" };
    }
    return { verb: "", detail: "" };
  }

  var api = { VER: VER, parse: parse, call: call, describe: describe, fold: fold };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosCommands = api;
})(typeof window !== "undefined" ? window : null);
