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
//   "χρονόμετρο 10 λεπτά μακαρόνια" · "timer 1h30m"         → Time (starts)
//   "ξυπνητήρι 7:00" · "wake me at 6:30 daily"              → Time (alarm form)
//   "κάρτα στο kanban: …" · "card fix the door"             → Kanban
//   "συνήθεια διάβασμα έγινε" · "habit run done"            → Habits (tick)
//   "νέα συνήθεια …" · "new habit …"                        → Habits (form)
//   "στείλε … στο writer" · "send … to mail"                → BR-SEND receiver
//   "12*3+4" · "√2" · "5 μίλια σε χλμ" · "100 usd to eur"   → an answer (copy)
// Anything else → null (the caller searches as usual).
//
// parse(text, opts) → null | { kind, app, data }
//   opts = { today: "YYYY-MM-DD", apps: [{ id, names: [..] }] (installed),
//            cal: OrosCalQuick (calendar/quickadd.js), lang: "en" | "el",
//            calc: CalcCore (calculator/core.js), units: UnitsCore
//            (units/core.js), rates: UnitsCore.storedRates(…) | null,
//            send: OrosSendCore (send/core.js) }; every engine is
//            optional: without it, its kind is never returned.
//   kind  event | todo | expense | income | note | water | open |
//         timer | alarm | card | habit | newhabit | send | calc | convert
//   data  the fields of that kind, already clean and capped:
//     event   { date, title, start, end, dateEnd, location, recur }
//     todo    { list: "tdl-groceries" | "", items: [{ text }] }
//     expense / income  { cents, cat, note, date }
//     note    { title, text }
//     water   {}
//     open    { id }
//     timer   { sec, label }           alarm   { at: "HH:MM", label, daily }
//     card    { title }                habit / newhabit   { name }
//     send    { to, kind: "text" | "link", text }
//     calc / convert  { text: "12*3+4 = 40", answer: "40" }
// call(cmd, lang) → { fn, args } the bridge the shell calls:
//   __orosOpenCalendarNew (BR-W8), __orosOpenAt("todo", {addItems})
//   (BR-TD-ADD), __orosOpenBudgetNew (BR-B1), __orosOpenAt("notes",
//   {add}), __orosOpenAt("water", {sip}), openAppById. Every one opens
//   a form or a prefill; nothing is saved until the user saves there
//   (BR-W8-6). Water's {sip} is the one exception: the user's Enter in
//   the bar is the confirmation, the same as the app's own button.
//   K2: __orosOpenAt("time", {timer}) starts a timer and
//   __orosOpenAt("habits", {tick}) ticks today (both one tap away
//   from undo in the app, like Water); {alarm} fills Time's alarm
//   form, {asNew} the Kanban / Habits forms; send → the BR-SEND
//   receiver's own target; calc / convert → { fn: "copy", args: [answer] }.
// describe(cmd, lang) → { verb, detail, hint? } for the preview row
//   (hint replaces "→ app" when set).
// The text is never run and never becomes HTML. No DOM, no storage.
// Node tests load it as is (tests/commands.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.1.0";
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

  var CUR_TO = /\s(?:to|σε|in|into)\s+(?:€|\$|£|eur|usd|gbp|chf|jpy|cad|aud|try|sek|nok|dkk|pln|czk|huf|ron|bgn|cny|ευρω|δολαρια?|λιρεσ?)$/;
  // "12€ καφές" with no verb: an expense too (a sum with a currency mark).
  function parseBareMoney(text, f, today) {
    if (!/^(?:€|\$|£)?\s*\d/.test(f) && !/\d\s*(?:€|\$|£|ευρω|eur)\b/.test(f)) return null;
    if (!/(€|\$|£|ευρω|eur)/.test(f)) return null;
    if (CUR_TO.test(f)) return null;  // "100 usd σε eur": a conversion (Unit Converter), never an expense
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

  // ---------- K2: Time ----------
  // Durations: "10 λεπτά", "1h30m", "90 sec", "μισή ώρα", "1,5 ώρα".
  var DUR = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(δευτερολεπτα|δευτερολεπτο|δευτ|sec(?:ond)?s?|s|λεπτα|λεπτο|λεπτ|λ|min(?:ute)?s?|m|ωρεσ|ωρα|ωρ|ω|h(?:ou)?rs?|h)(?![a-zα-ω])/g;
  var DUR_WORDS = [
    [/(^|\s)(?:μιαμιση|ενα(?:μ|ν)ιση|1,5) ωρα(?=\s|$)/, 5400],
    [/(^|\s)(?:μιση ωρα|μισαωρο|half an hour|half hour)(?=\s|$)/, 1800],
    [/(^|\s)(?:ενα τεταρτο|τεταρτο|a quarter of an hour|quarter of an hour|quarter hour)(?=\s|$)/, 900]
  ];
  // → { sec, rest } (rest = the text with the durations cut out) | null
  function duration(text, bareMin) {
    var f = fold(text), sec = 0, cuts = [], m;
    DUR_WORDS.forEach(function (w) {
      var x = w[0].exec(f);
      if (x) { sec += w[1]; cuts.push([x.index + x[1].length, x.index + x[0].length]); }
    });
    DUR.lastIndex = 0;
    while ((m = DUR.exec(f))) {
      var n = parseFloat(m[1].replace(",", ".")), u = m[2].charAt(0);
      var k = (u === "δ" || u === "s") ? 1 : (u === "ω" || u === "h") ? 3600 : 60;
      sec += n * k;
      cuts.push([m.index, m.index + m[0].length]);
    }
    if (!cuts.length && bareMin) {
      var b = /(^|\s)(\d{1,3})(?=\s|$)/.exec(f);
      if (b) { sec = +b[2] * 60; cuts.push([b.index + b[1].length, b.index + b[0].length]); }
    }
    sec = Math.round(sec);
    if (!cuts.length || sec < 1 || sec > 360000) return null;
    cuts.sort(function (a, c) { return c[0] - a[0]; });
    var rest = text;
    cuts.forEach(function (c) { rest = rest.slice(0, c[0]) + " " + rest.slice(c[1]); });
    return { sec: sec, rest: rest };
  }
  W.timer = ["βαλε αντιστροφη μετρηση", "αντιστροφη μετρηση", "βαλε χρονομετρο", "χρονομετρο", "set a timer for",
             "set a timer", "set timer", "start a timer", "timer", "countdown"];
  W.alarm = ["βαλε ξυπνητηρι", "ξυπνητηρι", "ξυπνησε με", "ξυπνα με", "set an alarm for", "set an alarm", "set alarm",
             "wake me up at", "wake me up", "wake me at", "wake me", "alarm"];
  var TIMER_TAIL = /\s+(?:χρονομετρο|αντιστροφη μετρηση|timer)$/;
  var DAILY = /(^|\s)(?:καθε μερα|καθε πρωι|καθημερινα|daily|every day|every morning)(?=\s|$)/;

  function parseTimer(text, f) {
    var n = lead(f, W.timer), body = text;
    if (n >= 0) body = text.slice(n);
    else {
      var tl = TIMER_TAIL.exec(f);
      if (!tl) return null;
      body = text.slice(0, tl.index);
    }
    var du = duration(body, true);
    if (!du) return null;
    return { kind: "timer", app: "time", data: { sec: du.sec, label: cap(trimJunk(du.rest).slice(0, 40)) } };
  }

  function parseAlarm(text, f) {
    var n = lead(f, W.alarm);
    if (n < 0) return null;
    var body = text.slice(n), bf = f.slice(n);
    // "ξυπνητήρι σε 10 λεπτά" / "wake me in 20 min": a timer.
    if (/^\s*(?:σε|in)\s/.test(bf)) {
      var du = duration(body.replace(/^\s*\S+/, ""), false);
      if (du) return { kind: "timer", app: "time", data: { sec: du.sec, label: cap(trimJunk(du.rest).slice(0, 40)) } };
    }
    var daily = false, dm = DAILY.exec(bf);
    if (dm) { daily = true; body = body.slice(0, dm.index + dm[1].length) + " " + body.slice(dm.index + dm[0].length); bf = fold(body); }
    var tm = /(^|\s)(?:(?:στισ|at)\s+|@\s*)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(π\.?μ\.?|μ\.?μ\.?|am|pm|a\.m\.|p\.m\.)?(?=\s|$)/.exec(bf);
    if (!tm) return null;
    var h = +tm[2], mi = tm[3] ? +tm[3] : 0, ap = tm[4] ? tm[4].replace(/\./g, "") : "";
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap === "pm" || ap === "μμ") h = h === 12 ? 12 : h + 12;
      else if (h === 12) h = 0;
    }
    var rest = body.slice(0, tm.index + tm[1].length) + " " + body.slice(tm.index + tm[0].length);
    return { kind: "alarm", app: "time",
             data: { at: (h < 10 ? "0" : "") + h + ":" + (mi < 10 ? "0" : "") + mi,
                     label: cap(trimJunk(rest).slice(0, 60)), daily: daily } };
  }

  // ---------- K2: Kanban, Habits ----------
  W.card = ["νεα καρτα στο kanban", "καρτα στο kanban", "νεα καρτα", "καρτα", "kanban", "new card", "add a card", "card"];
  var CARD_TAIL = /\s+(?:στο|to|on|in)\s+(?:the |my )?kanban$/;
  function parseCard(text, f) {
    var n = lead(f, W.card), body;
    if (n >= 0) body = text.slice(n);
    else {
      var tl = CARD_TAIL.exec(f);
      if (!tl) return null;
      body = text.slice(0, tl.index);
      var an = lead(fold(trimJunk(body)), ["βαλε", "προσθεσε", "add", "put"]);
      if (an >= 0) body = trimJunk(body).slice(an);
    }
    var t = trimJunk(body).slice(0, MAX_ITEM);
    return t ? { kind: "card", app: "kanban", data: { title: cap(t) } } : null;
  }
  W.newHabit = ["νεα συνηθεια", "new habit"];
  W.habit = ["συνηθεια", "habit", "τσεκαρε", "tick"];
  var HABIT_DONE = /\s+(?:εγινε|εκανα|ολοκληρωθηκε|τσεκ|done|ok|completed|ticked|✓)$/;
  function parseHabit(text, f) {
    var n = lead(f, W.newHabit);
    if (n >= 0) {
      var nm = trimJunk(text.slice(n)).slice(0, 200);
      return nm ? { kind: "newhabit", app: "habits", data: { name: cap(nm) } } : null;
    }
    n = lead(f, W.habit);
    if (n < 0) return null;
    var body = text.slice(n), dn = HABIT_DONE.exec(fold(body));
    var tick = f.indexOf("τσεκαρε") === 0 || f.indexOf("tick") === 0;
    if (dn) body = body.slice(0, dn.index);
    else if (!tick) return null;
    var name = trimJunk(body).slice(0, 200);
    return name ? { kind: "habit", app: "habits", data: { name: name } } : null;
  }

  // ---------- K2: "Send to an app" (BR-SEND) ----------
  W.send = ["στειλε", "μοιρασου", "send", "share"];
  function parseSend(text, f, apps, SC) {
    if (!SC || typeof SC.accepts !== "function") return null;
    var n = lead(f, W.send);
    if (n < 0) return null;
    var re = /\s(?:στο|στη|στην|στον|σε|to)\s/g, m, best = null;
    while ((m = re.exec(f))) {
      if (m.index < n) continue;
      var want = fold(trimJunk(text.slice(m.index + m[0].length)));
      if (!want) continue;
      (apps || []).forEach(function (a) {
        if (best && best.at < m.index) return;
        if (!a || SC.ORDER.indexOf(a.id) < 0) return;
        [a.id].concat(a.names || []).forEach(function (nm) {
          if (!best && fold(String(nm || "")) === want) best = { at: m.index, to: a.id };
        });
      });
      if (best) break;
    }
    if (!best) return null;
    var payload = text.slice(n, best.at).replace(/^[\s:]+/, "").trim();
    if (!payload) return null;
    var kind = /^https?:\/\/\S+$/i.test(payload) ? "link" : "text";
    var d = kind === "link" ? { url: payload } : { text: payload };
    if (!SC.accepts(best.to, kind, SC.norm(kind, d))) return null;
    return { kind: "send", app: best.to, data: { to: best.to, kind: kind, text: payload.slice(0, MAX_TEXT) } };
  }

  // ---------- K2: answers (Calculator, Unit Converter engines) ----------
  var CALC_FN = /(?:sqrt|sin|cos|tan|log|ln|abs|pi)/g;
  function parseCalc(text, CC) {
    if (!CC || typeof CC.calc !== "function") return null;
    var s = text.replace(/×/g, "*").replace(/÷/g, "/").replace(/,/g, ".");
    if (!/^[\d\s.+\-*\/^()%π√!]+$/.test(s.toLowerCase().replace(CALC_FN, ""))) return null;
    if (!/\d/.test(s)) return null;
    // A real sum, not a number, a phone (210-1234567) or a date (18/10).
    var op = /(\d|\)|π)\s*[+*^%]|√|!|[a-z]\(|\s[\-\/]\s|\)\s*[\-\/]|[\-\/]\s*\(/i.test(s) ||
             /\d[\-\/]\d.*[+*^]|[+*^].*\d[\-\/]\d/.test(s);
    if (!op) return null;
    var r = CC.calc(s, {});
    if (!r || !r.ok) return null;
    var ans = CC.formatNum(r.v);
    if (ans == null) return null;
    return { kind: "calc", app: "calculator", data: { text: clean(text) + " = " + ans, answer: ans } };
  }
  function parseConvert(text, U, rates, lang) {
    if (!U || typeof U.parseQuery !== "function") return null;
    var q = U.parseQuery(text, lang, rates || null);
    if (!q) return null;
    var to = q.to || U.partnerOf(q.cat, q.from);
    var ing = U.ingredient ? U.ingredient("water") : null;
    var r = U.convert(q.cat, q.from, to, q.v, { rates: rates || null, dens: ing ? ing[1] : undefined });
    var a = U.unit(q.cat, q.from, rates), b = U.unit(q.cat, to, rates);
    if (!r || !r.ok || !a || !b) return null;
    var right = U.formatNumber(r.v, 6, lang, true);
    return { kind: "convert", app: "units",
             data: { text: U.formatNumber(q.v, 6, lang, true) + " " + a.sym + " = " + right + " " + b.sym,
                     answer: U.formatNumber(r.v, 6, "en", false) + " " + b.sym } };
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
    var lang = o.lang === "el" ? "el" : "en";
    var tries = [
      function () { return parseOpen(t, f, apps); },
      function () { return parseSend(t, f, apps, o.send); },
      function () { return parseTimer(t, f); },
      function () { return parseAlarm(t, f); },
      function () { return parseCard(t, f); },
      function () { return parseHabit(t, f); },
      function () { return WATER.test(f) ? { kind: "water", app: "water", data: {} } : null; },
      function () { return parseMoney(t, f, today, "spent", false); },
      function () { return parseMoney(t, f, today, "earned", true); },
      function () { return parseNote(t, f); },
      function () { return parseTodo(t, f); },
      function () { return parseList(t, f); },
      function () { return lead(f, W.event) >= 0 ? parseEvent(t, f, today, o.cal, true) : null; },
      // "100 usd σε eur": a conversion, not a 100 € expense.
      function () { return /\s(?:to|σε|in|into)\s|→|=/.test(f) ? parseConvert(t, o.units, o.rates, lang) : null; },
      function () { return parseBareMoney(t, f, today); },
      function () { return parseEvent(t, f, today, o.cal, false); },
      function () { return parseCalc(t, o.calc); },
      function () { return parseConvert(t, o.units, o.rates, lang); }
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
    var d = cmd.data, from = strings(lang).from;
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
        var add = { from: from, items: items };
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
      case "timer": {
        var sec = d.sec;
        if (typeof sec !== "number" || Math.floor(sec) !== sec || sec < 1 || sec > 360000) return null;
        return { fn: "__orosOpenAt", args: ["time", { timer: { sec: sec, label: clean(String(d.label || "")).slice(0, 40) } }] };
      }
      case "alarm":
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(d.at || "")) return null;
        return { fn: "__orosOpenAt", args: ["time", { alarm: { at: d.at, label: clean(String(d.label || "")).slice(0, 60), daily: d.daily === true } }] };
      case "card":
        if (!d.title) return null;
        return { fn: "__orosOpenAt", args: ["kanban", { asNew: { title: clean(String(d.title)).slice(0, MAX_ITEM) } }] };
      case "habit":
        if (!d.name) return null;
        return { fn: "__orosOpenAt", args: ["habits", { tick: { name: clean(String(d.name)).slice(0, 200) } }] };
      case "newhabit":
        if (!d.name) return null;
        return { fn: "__orosOpenAt", args: ["habits", { asNew: { name: clean(String(d.name)).slice(0, 200) } }] };
      case "send": {
        var SC = sendCore();
        if (!SC || (d.kind !== "text" && d.kind !== "link") || typeof d.text !== "string") return null;
        var pl = d.kind === "link" ? { url: d.text } : { text: d.text.slice(0, MAX_TEXT) };
        var tg = SC.target(d.to, d.kind, pl, from);
        return tg ? { fn: "__orosOpenAt", args: [d.to, tg] } : null;
      }
      case "calc":
      case "convert":
        return typeof d.answer === "string" && d.answer ? { fn: "copy", args: [d.answer.slice(0, 200)] } : null;
    }
    return null;
  }
  // send/core.js: the shell's copy, or Node's (tests).
  var SEND_CORE = null;
  function sendCore() {
    if (SEND_CORE) return SEND_CORE;
    if (root && root.OrosSendCore) return (SEND_CORE = root.OrosSendCore);
    if (typeof require === "function") { try { SEND_CORE = require("../send/core.js"); } catch (e) {} }
    return SEND_CORE;
  }

  // ---------- Preview text ----------
  // English and Greek here; other languages from the "commands" pack
  // (i18n/<code>/commands.js, loaded by the shell with this file).
  // The parser's words above are data (what a person may type).
  var STR = {
    en: { event: "New event", todo: "Add to To-Do", groc: "Add to the shopping list", expense: "New expense",
          income: "New income", note: "New note", water: "A glass of water", open: "Open",
          timer: "Start a timer", alarm: "New alarm", daily: "every day", card: "New Kanban card", habit: "Tick a habit",
          newhabit: "New habit", send: "Send", copy: "Copy", allDay: "all day", from: "Command bar",
          wd: "Sun,Mon,Tue,Wed,Thu,Fri,Sat",
          "cat.o-eat": "Eating out", "cat.o-groc": "Groceries", "cat.o-trans": "Transport", "cat.o-bills": "Bills",
          "cat.o-home": "Rent & home", "cat.o-health": "Health", "cat.o-fun": "Entertainment", "cat.o-cloth": "Clothing",
          "cat.o-gift": "Gifts", "cat.o-other": "Other", "cat.i-salary": "Salary", "cat.i-free": "Freelance",
          "cat.i-gift": "Gifts", "cat.i-other": "Other" },
    el: { event: "Νέο συμβάν", todo: "Προσθήκη στο To-Do", groc: "Στη λίστα για ψώνια", expense: "Νέο έξοδο",
          income: "Νέο έσοδο", note: "Νέα σημείωση", water: "Ένα ποτήρι νερό", open: "Άνοιγμα",
          timer: "Έναρξη αντίστροφης μέτρησης", alarm: "Νέο ξυπνητήρι", daily: "κάθε μέρα", card: "Νέα κάρτα Kanban",
          habit: "Τσεκάρισμα συνήθειας", newhabit: "Νέα συνήθεια", send: "Αποστολή", copy: "Αντιγραφή",
          allDay: "όλη μέρα", from: "Γραμμή εντολών",
          wd: "Κυρ,Δευ,Τρί,Τετ,Πέμ,Παρ,Σάβ",
          "cat.o-eat": "Φαγητό έξω", "cat.o-groc": "Σούπερ μάρκετ", "cat.o-trans": "Μεταφορές", "cat.o-bills": "Λογαριασμοί",
          "cat.o-home": "Ενοίκιο & σπίτι", "cat.o-health": "Υγεία", "cat.o-fun": "Ψυχαγωγία", "cat.o-cloth": "Ρούχα",
          "cat.o-gift": "Δώρα", "cat.o-other": "Άλλα", "cat.i-salary": "Μισθός", "cat.i-free": "Ελεύθερο επάγγελμα",
          "cat.i-gift": "Δώρα", "cat.i-other": "Άλλα" }
  };
  // The strings of a language: en / el here, any other through the pack.
  function strings(lang) {
    if (lang === "en" || lang === "el") return STR[lang];
    var I = root && root.orosI18n;
    return I && I.known(lang) ? I.table(STR, "commands", lang) : STR.en;
  }
  function dayText(s, S) {
    if (!okDay(s)) return "";
    var p = s.split("-");
    var wd = ((dayNum(s) % 7) + 7 + 4) % 7;
    return (S.wd.split(",")[wd] || "") + " " + (+p[2]) + "/" + (+p[1]);
  }
  function euros(c, lang) {
    var v = (c / 100).toFixed(2);
    return (lang === "en" ? v : v.replace(".", ",")) + " €";   // a decimal comma outside English
  }
  function hms(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x;
  }
  function describe(cmd, lang) {
    var S = strings(lang), d = cmd && cmd.data || {}, lg = lang;
    switch (cmd && cmd.kind) {
      case "event":
        return { verb: S.event, detail: [dayText(d.date, S), d.start ? d.start + (d.end ? "–" + d.end : "") : S.allDay,
                                           d.title, d.location].filter(Boolean).join(" · ") };
      case "todo":
        return { verb: d.list === "tdl-groceries" ? S.groc : S.todo,
                 detail: (d.items || []).map(function (it) { return it.text; }).join(", ") };
      case "expense":
      case "income":
        return { verb: S[cmd.kind], detail: [euros(d.cents, lg), (d.cat && S["cat." + d.cat]) || "", d.note,
                                             d.date ? dayText(d.date, S) : ""].filter(Boolean).join(" · ") };
      case "note": return { verb: S.note, detail: d.title };
      case "water": return { verb: S.water, detail: "" };
      case "open": return { verb: S.open, detail: "" };
      case "timer": return { verb: S.timer, detail: [hms(d.sec), d.label].filter(Boolean).join(" · ") };
      case "alarm": return { verb: S.alarm, detail: [d.at, d.daily ? S.daily : "", d.label].filter(Boolean).join(" · ") };
      case "card": return { verb: S.card, detail: d.title };
      case "habit": return { verb: S.habit, detail: d.name };
      case "newhabit": return { verb: S.newhabit, detail: d.name };
      case "send": return { verb: S.send, detail: d.text.length > 80 ? d.text.slice(0, 79) + "…" : d.text };
      case "calc":
      case "convert": return { verb: d.text, detail: "", hint: S.copy };
    }
    return { verb: "", detail: "" };
  }

  var api = { VER: VER, parse: parse, call: call, describe: describe, fold: fold };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosCommands = api;
})(typeof window !== "undefined" ? window : null);
