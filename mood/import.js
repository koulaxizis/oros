// ============================================================
// orOS Mood — import.js (pure logic, no DOM) — "Import from
// another app". Reads files the user exported elsewhere, as DATA:
//   - Daylio CSV (full_date, date, weekday, time, mood, activities,
//     note_title, note; activities joined with " | ")
//   - Daylio backup (.daylio = a ZIP holding "backup.daylio", whose
//     text is base64 of JSON: customMoods, tags, dayEntries); a bare
//     base64 or JSON copy of that file works too
//   - Bearable CSV (date / date formatted, time of day, category,
//     rating/amount, detail, notes): the "Mood" rows, and "Emotions"
//     as feelings
//   - eMoods CSV (date, depressed, elevated, irritable, anxiety 0–3,
//     sleep, notes…): the four ratings become feelings, the rest goes
//     into the note
//   - any CSV with a date (+ time) and a mood (1–5, 1–10 or a word),
//     plus optional note, activities/tags and feelings columns
// Mood has no single "mood score": an entry is a set of feelings with
// a strength 1–5. A source mood is read as one of five steps (1 best …
// 5 worst, Daylio's groups) and each step becomes one feeling (STEPS).
// The preview lets the user change the step of every mood name.
// Three stages, all pure:
//   read(name, bytes)  → Promise<parsed>   (detect + parse the file)
//   prepare(parsed, ctx) → prep            (entries + vocabulary to add,
//                                           preview numbers)
//   apply(state, prep, now) → { state, added, skipped, defs }
// Entry ids are "imp-" + hash(source, time, mood): importing the same
// file again finds them and adds only what is new. apply never
// touches an entry that already exists. Nothing from a file is ever
// run or rendered as HTML (mood.js shows it with textContent).
// Needs OrosImportKit (../importkit.js) and, for ZIPs, AtelierZip.
// UMD: window.OrosMoodImport in the browser, module.exports in Node.
// i18n-inline-ok: the Greek (and German) words below are file data the
// importer recognises, not UI text (labels come from mood.js tables).
// ============================================================
(function (root) {
  "use strict";

  var K = (typeof module !== "undefined" && module.exports && typeof require === "function")
    ? require("../importkit.js") : root.OrosImportKit;

  var MAX_FILE = 40 * 1024 * 1024;      // as picked
  var MAX_ENTRY = 60 * 1024 * 1024;     // inflated backup.daylio
  var MAX_ITEMS = 10000;                // entries per import
  var MAX_NEW_DEFS = 150;               // new activities / feelings
  var NOTE_MAX = 2000;                  // same cap as the Capture note
  var NAME_MAX = 40;                    // vocabulary label (vocab.js LAB_MAX)

  // The five steps of a source mood → one Mood feeling each.
  // 1 rad · 2 good · 3 meh · 4 bad · 5 awful (Daylio's mood groups).
  var STEPS = {
    1: { k: "happy", i: 5 },
    2: { k: "happy", i: 3 },
    3: { k: "numb", i: 2 },
    4: { k: "sad", i: 3 },
    5: { k: "sad", i: 5 }
  };

  function norm(s) { return K.clean(s, 200).toLowerCase(); }
  function p2(n) { return (n < 10 ? "0" : "") + n; }

  // ---------- mood words → step ----------
  var WORDS = {
    1: ["rad", "great", "excellent", "awesome", "amazing", "fantastic", "super", "ecstatic", "very good", "τέλεια", "τελεια", "φανταστικά", "φανταστικα", "υπέροχα", "υπεροχα", "sehr gut", "großartig", "fantastisch"],
    2: ["good", "happy", "fine", "nice", "well", "καλά", "καλα", "καλή", "καλη", "gut"],
    3: ["meh", "ok", "okay", "neutral", "so-so", "so so", "average", "normal", "μέτρια", "μετρια", "έτσι κι έτσι", "ετσι κι ετσι", "ουδέτερα", "naja", "mittel"],
    4: ["bad", "sad", "low", "down", "poor", "not good", "άσχημα", "ασχημα", "κακά", "κακα", "schlecht", "nicht gut"],
    5: ["awful", "terrible", "horrible", "very bad", "worst", "miserable", "χάλια", "χαλια", "απαίσια", "απαισια", "furchtbar", "schrecklich", "sehr schlecht", "mies"]
  };
  var WORD_STEP = {};
  Object.keys(WORDS).forEach(function (g) { WORDS[g].forEach(function (w) { WORD_STEP[w] = +g; }); });

  // A label → step 1–5, or 0 (unknown). scale = the file's top value
  // for numeric moods (5 or 10); higher numbers are better moods.
  function guessStep(label, scale) {
    var s = norm(label);
    if (!s) return 0;
    if (WORD_STEP[s]) return WORD_STEP[s];
    if (/^-?\d+([.,]\d+)?$/.test(s)) {
      var v = K.num(s);
      if (!isFinite(v)) return 0;
      if ((scale || 5) > 5) {                       // 1–10 (0–10)
        if (v < 0 || v > 10) return 0;
        return v >= 9 ? 1 : v >= 7 ? 2 : v >= 5 ? 3 : v >= 3 ? 4 : 5;
      }
      if (v < 1 || v > 5) return 0;
      return 6 - Math.round(v);
    }
    return 0;
  }

  // ---------- feeling names → built-in key ----------
  var EMO_SYN = {
    happy: ["happy", "joy", "joyful", "content", "grateful", "cheerful", "glad", "loved", "proud", "χαρούμενος", "χαρούμενη", "χαρά", "glücklich", "fröhlich", "froh"],
    calm: ["calm", "relaxed", "peaceful", "serene", "at peace", "chill", "ήρεμος", "ήρεμη", "ηρεμία", "ruhig", "entspannt", "gelassen"],
    excited: ["excited", "energetic", "motivated", "hopeful", "inspired", "enthusiastic", "elevated", "ενθουσιασμένος", "ενθουσιασμένη", "aufgeregt", "begeistert", "motiviert"],
    sad: ["sad", "down", "lonely", "depressed", "unhappy", "hopeless", "low", "λυπημένος", "λυπημένη", "λύπη", "traurig", "einsam"],
    angry: ["angry", "irritable", "irritated", "frustrated", "annoyed", "mad", "θυμωμένος", "θυμωμένη", "θυμός", "wütend", "gereizt", "verärgert"],
    anxious: ["anxious", "worried", "nervous", "scared", "afraid", "fearful", "panicked", "αγχωμένος", "αγχωμένη", "άγχος", "ängstlich", "besorgt", "nervös"],
    tired: ["tired", "exhausted", "sleepy", "fatigued", "drained", "κουρασμένος", "κουρασμένη", "κούραση", "müde", "erschöpft"],
    stressed: ["stressed", "overwhelmed", "under pressure", "tense", "πιεσμένος", "πιεσμένη", "στρες", "gestresst", "überfordert"],
    numb: ["numb", "empty", "bored", "indifferent", "apathetic", "άδειος", "άδεια", "leer", "gelangweilt"]
  };
  var EMO_KEY = {};
  Object.keys(EMO_SYN).forEach(function (k) { EMO_SYN[k].forEach(function (w) { EMO_KEY[w] = k; }); });

  // ---------- activity names → built-in habit side ----------
  // Daylio's default activities and common words; anything else
  // becomes one of the user's own activities.
  var HAB_SYN = {
    "read": ["read", "reading", "book", "books", "διάβασμα"],
    "games": ["gaming", "games", "videogames", "video games", "παιχνίδια"],
    "move": ["sport", "sports", "exercise", "workout", "gym", "running", "fitness", "άσκηση", "γυμναστική"],
    "sleep": ["good sleep", "slept well", "καλός ύπνος"],
    "sleep:no": ["bad sleep", "poor sleep", "κακός ύπνος"],
    "chores": ["cleaning", "laundry", "chores", "housework", "καθάρισμα", "δουλειές σπιτιού"],
    "tv": ["movies", "movie", "tv", "series", "netflix", "ταινίες", "τηλεόραση"],
    "walk": ["walk", "walking", "went for a walk", "βόλτα", "περπάτημα"],
    "meditate": ["meditation", "meditate", "meditated", "mindfulness", "διαλογισμός"],
    "cook": ["homemade", "cooking", "cooked", "μαγείρεμα", "σπιτικό"],
    "cook:no": ["fast food", "takeout", "take-out", "delivery"],
    "music": ["music", "μουσική"],
    "nap": ["nap", "napping", "υπνάκος"],
    "journal": ["journal", "journaling", "diary", "ημερολόγιο"],
    "caf": ["coffee", "caffeine", "καφές"],
    "alc": ["alcohol", "drinks", "drinking", "beer", "wine", "αλκοόλ"],
    "meds": ["medication", "meds", "medicine", "φάρμακα"],
    "outdoor": ["outdoors", "nature", "outside", "φύση"],
    "water": ["water", "νερό"]
  };
  var HAB_KEY = {};
  Object.keys(HAB_SYN).forEach(function (k) {
    var parts = k.split(":");
    HAB_SYN[k].forEach(function (w) { HAB_KEY[w] = { f: parts[0], side: parts[1] || "yes" }; });
  });

  // ---------- text helpers ----------
  // A note that may carry simple markup (newer Daylio notes) → text.
  function noteText(v) {
    var s = v == null ? "" : String(v);
    if (/<[a-z\/!]/i.test(s)) {
      s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<[^>]*>/g, "");
      s = s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
        .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
    }
    return K.cleanText(s, NOTE_MAX);
  }
  function joinNote(parts) {
    return K.cleanText(parts.filter(function (x) { return x; }).join("\n"), NOTE_MAX);
  }
  function splitList(v, re) {
    return String(v == null ? "" : v).split(re || /\s*[|,;]\s*/).map(function (x) { return K.clean(x, NAME_MAX); })
      .filter(function (x) { return x; });
  }

  // "21:45", "9:45 PM", "09:45:10" → [h, m] or null
  function timeOf(v) {
    var m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(K.clean(v, 20));
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (m[3]) {
      var pm = /^p/i.test(m[3]);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    return h < 24 && mi < 60 ? [h, mi] : null;
  }
  // Bearable's parts of the day
  var SLOTS = { am: [9, 0], morning: [9, 0], mid: [13, 0], midday: [13, 0], afternoon: [15, 0], noon: [13, 0],
    pm: [18, 0], evening: [18, 0], late: [22, 0], night: [22, 0] };
  // date (+ time) → ms in local time; a date without a time → 12:00
  function tsOf(dateV, timeV, hint) {
    var day = K.ymd(dateV, hint);
    if (!day) return NaN;
    var tm = timeOf(timeV) || SLOTS[norm(timeV)] || null;
    var d = day.split("-");
    if (!tm) {
      var full = K.parseDate(dateV, hint);
      var hasTime = /\d[:.]\d{2}/.test(String(dateV)) || /^\d{9,13}$/.test(K.clean(dateV, 20));
      if (hasTime && isFinite(full)) return full;
      tm = [12, 0];
    }
    return new Date(+d[0], +d[1] - 1, +d[2], tm[0], tm[1], 0).getTime();
  }

  // ---------- base64 → text (Daylio backup) ----------
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function b64bytes(s) {
    s = String(s).replace(/[\s=]+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+\/]*$/.test(s)) return null;
    var out = new Uint8Array(Math.floor(s.length * 3 / 4)), o = 0, buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      buf = (buf << 6) | B64.indexOf(s[i]);
      bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 0xff; }
    }
    return out.subarray(0, o);
  }
  function looksB64(s) { return s.length > 8 && /^[A-Za-z0-9+\/=\s_-]+$/.test(s.slice(0, 4000)); }

  // ---------- 1. Daylio backup ----------
  var DAYLIO_NAMES = { 1: "rad", 2: "good", 3: "meh", 4: "bad", 5: "awful" };
  function fromDaylioJson(o) {
    var moods = {}, tags = {}, items = [], skipped = 0;
    (Array.isArray(o.customMoods) ? o.customMoods : []).forEach(function (m) {
      if (!m || m.id == null) return;
      var g = +m.mood_group_id;
      if (!(g >= 1 && g <= 5)) g = 0;
      var label = K.clean(m.custom_name, NAME_MAX) || DAYLIO_NAMES[+m.predefined_name_id] || DAYLIO_NAMES[g] || String(m.id);
      moods[m.id] = { label: label, g: g };
    });
    (Array.isArray(o.tags) ? o.tags : []).forEach(function (t) {
      if (t && t.id != null) tags[t.id] = K.clean(t.name, NAME_MAX);
    });
    var list = Array.isArray(o.dayEntries) ? o.dayEntries : [];
    list.forEach(function (e) {
      if (!e || typeof e !== "object") { skipped++; return; }
      var ts = typeof e.datetime === "number" && isFinite(e.datetime) ? e.datetime
        : (e.year ? new Date(+e.year, +e.month || 0, +e.day || 1, +e.hour || 12, +e.minute || 0).getTime() : NaN);
      var md = moods[e.mood] || (DAYLIO_NAMES[e.mood] ? { label: DAYLIO_NAMES[e.mood], g: +e.mood } : null);
      if (!isFinite(ts) || !md) { skipped++; return; }
      items.push({
        ts: ts, mood: md.label, g: md.g, emos: [],
        acts: (Array.isArray(e.tags) ? e.tags : []).map(function (id) { return tags[id] || ""; }).filter(Boolean),
        note: joinNote([K.clean(e.note_title, 200), noteText(e.note)])
      });
    });
    return { source: "daylio-bk", items: items, skipped: skipped };
  }
  function daylioText(s) {
    s = String(s || "").trim();
    var o = s.charAt(0) === "{" ? K.json(s) : null;
    if (!o && looksB64(s)) {
      var b = b64bytes(s);
      o = b ? K.json(K.text(b)) : null;
    }
    return o && typeof o === "object" && Array.isArray(o.dayEntries) ? fromDaylioJson(o) : null;
  }

  // ---------- 2. CSV sources ----------
  var SIGS = [
    { id: "daylio", need: [["full_date"], ["mood"], ["activities"]] },
    { id: "bearable", need: [["category"], ["rating/amount", "rating", "amount", "detail"]] },
    { id: "emoods", need: [["depressed", "depression"], ["elevated", "elevation", "mania"]] },
    { id: "generic", need: [["date", "day", "datetime", "timestamp", "full_date", "time", "created", "date time"], ["mood", "rating", "score", "feeling", "value", "mood score", "level"]] }
  ];

  function fromDaylioCsv(rows) {
    var items = [], skipped = 0;
    rows.forEach(function (r) {
      var ts = tsOf(K.get(r, ["full_date", "date"]), K.get(r, ["time"]));
      var mood = K.clean(K.get(r, ["mood"]), NAME_MAX);
      if (!isFinite(ts) || !mood) { skipped++; return; }
      items.push({
        ts: ts, mood: mood, g: 0, emos: [],
        acts: splitList(K.get(r, ["activities"]), /\s*\|\s*/),
        note: joinNote([K.clean(K.get(r, ["note_title"]), 200), noteText(K.get(r, ["note"]))])
      });
    });
    return { source: "daylio", items: items, skipped: skipped };
  }

  function fromBearable(rows) {
    var groups = {}, order = [], skipped = 0, other = 0;
    function slotKey(r) {
      var dv = K.get(r, ["date formatted", "date"]);
      var day = K.ymd(dv) || K.ymd(K.get(r, ["date"]));
      var tod = K.get(r, ["time of day", "time"]);
      return day ? { day: day, tod: norm(tod), ts: tsOf(dv, tod) } : null;
    }
    rows.forEach(function (r) {
      var cat = norm(K.get(r, ["category"]));
      var sk = slotKey(r);
      if (!sk || !isFinite(sk.ts)) { skipped++; return; }
      var key = sk.day + "|" + sk.tod;
      var g = groups[key];
      if (!g) { g = groups[key] = { ts: sk.ts, day: sk.day, mood: "", emos: [], notes: [] }; order.push(key); }
      var detail = K.clean(K.get(r, ["detail"]), 300);
      var notes = noteText(K.get(r, ["notes", "note"]));
      if (cat === "mood") {
        var v = K.clean(K.get(r, ["rating/amount", "rating", "amount"]), 20) || K.clean(detail, NAME_MAX);
        if (v) g.mood = v;
        if (notes) g.notes.push(notes);
      } else if (cat === "emotions" || cat === "emotion" || cat === "feelings") {
        splitList(detail, /\s*[|,;]\s*/).forEach(function (n) { g.emos.push({ name: n, i: 3 }); });
        if (notes) g.notes.push(notes);
      } else if (cat === "notes" || cat === "note" || cat === "journal") {
        var tx = joinNote([detail, notes]);
        if (tx) g.notes.push(tx);
      } else other++;
    });
    // a day's note / feelings without a mood row of their own join that
    // day's first mood row
    var firstMood = {};
    order.forEach(function (k) { var g = groups[k]; if (g.mood && !firstMood[g.day]) firstMood[g.day] = g; });
    var items = [];
    order.forEach(function (k) {
      var g = groups[k];
      if (!g.mood && firstMood[g.day]) {
        var host = firstMood[g.day];
        host.emos = host.emos.concat(g.emos);
        host.notes = host.notes.concat(g.notes);
        return;
      }
      if (!g.mood && !g.emos.length) return;               // only other categories
      items.push(g);
    });
    return {
      source: "bearable",
      items: items.map(function (g) {
        return { ts: g.ts, mood: g.mood, g: 0, emos: g.emos, acts: [], note: joinNote(g.notes) };
      }),
      skipped: skipped, other: other
    };
  }

  // eMoods: 0 none · 1 mild · 2 moderate · 3 severe → strength
  var EM_I = [0, 2, 4, 5];
  var EM_DIMS = [
    { k: "sad", names: ["depressed", "depression", "depressed mood"], lab: "depressed" },
    { k: "excited", names: ["elevated", "elevation", "elevated mood", "mania"], lab: "elevated" },
    { k: "angry", names: ["irritable", "irritability"], lab: "irritable" },
    { k: "anxious", names: ["anxiety", "anxious"], lab: "anxiety" }
  ];
  function fromEmoods(rows, head, lab) {
    var items = [], skipped = 0;
    var used = {};
    var dateNames = ["date", "day", "full date"], sleepNames = ["sleep", "hours of sleep", "sleep hours"], noteNames = ["notes", "note", "journal"];
    [dateNames, sleepNames, noteNames].concat(EM_DIMS.map(function (d) { return d.names; })).forEach(function (ns) {
      var c = K.col(head, ns);
      if (c !== -1) used[head[c]] = 1;
    });
    rows.forEach(function (r) {
      var ts = tsOf(K.get(r, dateNames), K.get(r, ["time"]));
      if (!isFinite(ts)) { skipped++; return; }
      var emos = [], line = [], any = false;
      EM_DIMS.forEach(function (d) {
        var v = K.num(K.get(r, d.names));
        if (!isFinite(v)) return;
        any = true;
        v = Math.max(0, Math.min(3, Math.round(v)));
        line.push(lab[d.lab] + " " + v + "/3");
        if (v > 0) emos.push({ k: d.k, i: EM_I[v] });
      });
      if (!any) { skipped++; return; }
      if (!emos.length) emos.push({ k: "calm", i: 3 });     // a stable day
      var sl = K.clean(K.get(r, sleepNames), 20);
      if (sl) line.push(lab.sleep + " " + sl + " h");
      var extra = [];
      head.forEach(function (h) {
        if (used[h]) return;
        var v = K.clean(r[h], 200);
        if (v && h) extra.push(K.clean(h, 40) + ": " + v);
      });
      items.push({
        ts: ts, mood: "", g: 0, emos: emos, acts: [],
        note: joinNote([noteText(K.get(r, noteNames)), "eMoods · " + line.join(" · "), extra.join(" · ")])
      });
    });
    return { source: "emoods", items: items, skipped: skipped };
  }

  function fromGeneric(rows) {
    var items = [], skipped = 0;
    rows.forEach(function (r) {
      var ts = tsOf(K.get(r, ["date", "day", "datetime", "timestamp", "full_date", "created", "date time", "time"]),
        K.get(r, ["time", "hour"]));
      var mood = K.clean(K.get(r, ["mood", "rating", "score", "mood score", "value", "level", "feeling"]), NAME_MAX);
      var emos = splitList(K.get(r, ["feelings", "emotions", "emotion"])).map(function (n) { return { name: n, i: 3 }; });
      if (!isFinite(ts) || (!mood && !emos.length)) { skipped++; return; }
      items.push({
        ts: ts, mood: mood, g: 0, emos: emos,
        acts: splitList(K.get(r, ["activities", "activity", "tags", "tag"])),
        note: joinNote([K.clean(K.get(r, ["title", "note_title"]), 200), noteText(K.get(r, ["note", "notes", "comment", "comments", "journal", "text", "description"]))])
      });
    });
    return { source: "generic", items: items, skipped: skipped };
  }

  var LAB_EN = { depressed: "Depressed", elevated: "Elevated", irritable: "Irritable", anxiety: "Anxiety", sleep: "Sleep", more: "More activities" };

  function fromCsvText(text, lab) {
    var rec = K.records(text, { maxRows: MAX_ITEMS * 4 });
    var id = K.detect(rec.head, SIGS);
    if (!id) return null;
    if (id === "daylio") return fromDaylioCsv(rec.rows);
    if (id === "bearable") return fromBearable(rec.rows);
    if (id === "emoods") return fromEmoods(rec.rows, rec.head, lab);
    return fromGeneric(rec.rows);
  }

  // Count each mood label and guess its step; cap the item count.
  function finish(p) {
    if (!p) return null;
    p.items.sort(function (a, b) { return a.ts - b.ts; });
    p.capped = 0;
    if (p.items.length > MAX_ITEMS) { p.capped = p.items.length - MAX_ITEMS; p.items = p.items.slice(p.items.length - MAX_ITEMS); }
    var scale = 5;
    p.items.forEach(function (it) {
      var v = /^-?\d+([.,]\d+)?$/.test(it.mood || "") ? K.num(it.mood) : NaN;
      if (v > 5) scale = 10;
    });
    var moods = {}, list = [];
    p.items.forEach(function (it) {
      if (!it.mood) return;
      var m = moods[it.mood];
      if (!m) { m = moods[it.mood] = { label: it.mood, n: 0, g: it.g || guessStep(it.mood, scale) }; list.push(m); }
      m.n++;
    });
    list.sort(function (a, b) {
      var na = K.num(a.label), nb = K.num(b.label);
      if (isFinite(na) && isFinite(nb)) return nb - na;
      return (a.g || 9) - (b.g || 9) || b.n - a.n;
    });
    p.moods = list;
    p.scale = scale;
    return p;
  }

  // name: the file's name; bytes: Uint8Array (or a string).
  // lab: words for the eMoods summary line (default English).
  // Resolves to parsed { source, items, moods, skipped, capped } or
  // rejects with Error("format" | "toobig" | "zip").
  function read(name, bytes, lab) {
    lab = lab || LAB_EN;
    return Promise.resolve().then(function () {
      if (bytes && bytes.length > MAX_FILE) throw new Error("toobig");
      if (typeof bytes !== "string" && K.isZip(bytes)) {
        var z = K.unzip(bytes);
        var entry = z.names.filter(function (n) { return /(^|\/)backup\.daylio$/i.test(n); })[0] ||
          z.names.filter(function (n) { return /\.daylio$/i.test(n); })[0];
        var csvName = z.names.filter(function (n) { return /\.csv$/i.test(n); })[0];
        if (entry) return z.bytes(entry, MAX_ENTRY).then(function (b) { return daylioText(K.text(b)); });
        if (csvName) return z.bytes(csvName, MAX_ENTRY).then(function (b) { return fromCsvText(K.text(b), lab); });
        return null;
      }
      var s = K.text(bytes);
      var head = s.slice(0, 200).trim();
      if (/\.daylio$/i.test(name || "") || head.charAt(0) === "{" || (looksB64(head) && !/[,;\t]/.test(head))) {
        var d = daylioText(s);
        if (d) return d;
      }
      return fromCsvText(s, lab);
    }).then(function (p) {
      p = finish(p);
      if (!p || !p.items.length) throw new Error("format");
      return p;
    });
  }

  // ---------- 3. prepare: entries + vocabulary ----------
  // ctx = {
  //   steps: { label: 0–5 }      the user's choice per mood (0 = skip),
  //                              missing → the guess
  //   emos: [{ k, label }]       feelings Mood knows (built-in keys too;
  //                              several labels per key are fine)
  //   acts: [{ id, label }]      the user's own activities
  //   habits: [{ f, yes, no }]   built-in pairs with their labels now
  //   habitFields: [f…]          every built-in habit field
  //   colors: ["#rrggbb"…]       for new feelings
  //   nCustomEmo                 own feelings so far (picks the colour)
  //   lab                        words for notes (more: "More activities")
  // }
  function hid(source, it) {
    return source.replace(/-bk$/, "") + "|" + it.ts + "|" + (it.mood || it.emos.map(function (e) { return e.k || e.name; }).join(","));
  }
  function prepare(parsed, ctx) {
    ctx = ctx || {};
    var lab = ctx.lab || LAB_EN;
    var steps = ctx.steps || {};
    var emoBy = {}, actBy = {}, habBy = {};
    (ctx.emos || []).forEach(function (e) { if (e && e.label) emoBy[norm(e.label)] = e.k; });
    (ctx.acts || []).forEach(function (a) { if (a && a.label) actBy[norm(a.label)] = a.id; });
    (ctx.habits || []).forEach(function (h) {
      if (h.yes) habBy[norm(h.yes)] = { f: h.f, side: "yes" };
      if (h.no) habBy[norm(h.no)] = { f: h.f, side: "no" };
    });
    var fields = ctx.habitFields || [];
    var newEmo = {}, newAct = {}, emoOrder = [], actOrder = [], nDefs = 0;
    var habUsed = {}, actsMapped = {};
    var colors = ctx.colors && ctx.colors.length ? ctx.colors : ["#9aa0ae"];
    var nCustom = ctx.nCustomEmo || 0;

    function emoKey(name) {
      var n = norm(name);
      if (!n) return "";
      if (emoBy[n]) return emoBy[n];
      if (EMO_KEY[n]) return EMO_KEY[n];
      var id = "c-iemo" + K.hash("emo|" + n);
      if (!newEmo[id]) {
        if (nDefs >= MAX_NEW_DEFS) return "";
        nDefs++;
        newEmo[id] = { id: id, lab: K.clean(name, NAME_MAX), ic: "🙂", col: colors[(nCustom + emoOrder.length) % colors.length] };
        emoOrder.push(id);
      }
      return id;
    }
    function actRef(name) {
      var n = norm(name);
      if (!n) return null;
      if (actBy[n]) { actsMapped[name] = 1; return { id: actBy[n] }; }
      var h = habBy[n] || HAB_KEY[n];
      if (h && fields.indexOf(h.f) !== -1) { habUsed[name] = h; return h; }
      var id = "c-iact" + K.hash("act|" + n);
      if (!newAct[id]) {
        if (nDefs >= MAX_NEW_DEFS) return null;
        nDefs++;
        newAct[id] = { id: id, lab: K.clean(name, NAME_MAX), ic: "⭐" };
        actOrder.push(id);
      }
      return { id: id };
    }

    var entries = [], seen = {}, skipped = 0, from = Infinity, to = -Infinity;
    parsed.items.forEach(function (it) {
      var emos = {};
      function put(k, i) { if (k && (!emos[k] || emos[k] < i)) emos[k] = i; }
      if (it.mood) {
        var g = steps[it.mood] !== undefined ? +steps[it.mood] : (it.g || guessStep(it.mood, parsed.scale));
        if (STEPS[g]) put(STEPS[g].k, STEPS[g].i);
      }
      (it.emos || []).forEach(function (e) { put(e.k || emoKey(e.name), Math.max(1, Math.min(5, e.i || 3))); });
      var keys = Object.keys(emos).sort();
      if (!keys.length) { skipped++; return; }
      var e = { id: "", ts: it.ts, emotions: keys.map(function (k) { return { k: k, i: emos[k] }; }),
        loc: null, person: null, note: "", trig: null, trigger: "" };
      fields.forEach(function (f) { e[f] = null; });
      var acts = {}, rest = [];
      (it.acts || []).forEach(function (name) {
        var r = actRef(name);
        if (!r) { rest.push(name); return; }
        if (r.id) acts[r.id] = 1;
        else e[r.f] = r.side;
      });
      var al = Object.keys(acts).sort();
      if (al.length) e.acts = al;
      e.note = joinNote([it.note, rest.length ? (lab.more || LAB_EN.more) + ": " + rest.join(", ") : ""]);
      // stable id; a second item with the same time and mood in one file
      // gets a counter
      var base = hid(parsed.source, it), id = "imp-" + K.hash(base), c = 1;
      while (seen[id]) id = "imp-" + K.hash(base + "#" + (++c));
      seen[id] = 1;
      e.id = id;
      entries.push(e);
      if (it.ts < from) from = it.ts;
      if (it.ts > to) to = it.ts;
    });
    return {
      source: parsed.source,
      entries: entries,
      defs: {
        emo: emoOrder.map(function (id) { return newEmo[id]; }),
        act: actOrder.map(function (id) { return newAct[id]; })
      },
      stats: {
        n: entries.length, from: entries.length ? from : 0, to: entries.length ? to : 0,
        skipped: skipped + (parsed.skipped || 0), capped: parsed.capped || 0,
        habits: Object.keys(habUsed).map(function (n) { return { name: n, f: habUsed[n].f, side: habUsed[n].side }; }),
        mapped: Object.keys(actsMapped)
      }
    };
  }

  // ---------- 4. apply ----------
  // state: oros-mood-data (not modified). Adds every prepared entry
  // whose id is not in state.entries (an import deleted earlier comes
  // back: its fresh mtime beats the tombstone, which is dropped as
  // commitEntry does); creates the new feelings / activities the
  // entries use, or shows again one an earlier import made and an
  // Undo hid. Returns { state, added: [ids], skipped, defs: { emo:
  // [def], act: [def] } } — defs = what this import created or showed.
  function apply(state, prep, now) {
    var s = JSON.parse(JSON.stringify(state || {}));
    s.entries = Array.isArray(s.entries) ? s.entries : [];
    s.deleted = s.deleted && typeof s.deleted === "object" ? s.deleted : {};
    var have = {}, added = [], skipped = 0, usedEmo = {}, usedAct = {};
    s.entries.forEach(function (e) { if (e && e.id) have[e.id] = 1; });
    prep.entries.forEach(function (src) {
      if (have[src.id]) { skipped++; return; }
      var e = JSON.parse(JSON.stringify(src));
      e.mtime = now;
      s.entries.push(e);
      have[e.id] = 1;
      if (s.deleted[e.id] !== undefined) delete s.deleted[e.id];
      added.push(e.id);
      e.emotions.forEach(function (m) { usedEmo[m.k] = 1; });
      (e.acts || []).forEach(function (id) { usedAct[id] = 1; });
    });
    var defs = { emo: [], act: [] };
    var vo = s.vocab && typeof s.vocab === "object" ? s.vocab : {};
    ["emo", "act"].forEach(function (list) {
      var used = list === "emo" ? usedEmo : usedAct;
      prep.defs[list].forEach(function (d) {
        if (!used[d.id]) return;
        var arr = vo[list] = Array.isArray(vo[list]) ? vo[list] : [];
        var cur = null;
        arr.forEach(function (x) { if (x && x.id === d.id) cur = x; });
        if (!cur) {
          var nd = JSON.parse(JSON.stringify(d));
          nd.mtime = now;
          arr.push(nd);
          defs[list].push(JSON.parse(JSON.stringify(nd)));
        } else if (cur.hid) {
          delete cur.hid;
          cur.mtime = Math.max(now, (cur.mtime || 0) + 1);
          defs[list].push(JSON.parse(JSON.stringify(cur)));
        }
      });
    });
    if (vo.emo || vo.act) s.vocab = vo;
    s.entries.sort(function (x, y) { return x.ts !== y.ts ? y.ts - x.ts : (x.id < y.id ? -1 : (x.id > y.id ? 1 : 0)); });
    if (added.length || defs.emo.length || defs.act.length) s.sm = now;
    return { state: s, added: added, skipped: skipped, defs: defs };
  }

  // The undo of apply on a state that may have moved on since (a pull,
  // an edit): the added entries leave with a tombstone (so a device that
  // already has them drops them too), the definitions the import made
  // go back to their old version, hidden, with a newer stamp (so a copy
  // that already travelled hides as well). prev = the state before the
  // import; res = what apply returned.
  function undo(cur, prev, res, now) {
    var s = JSON.parse(JSON.stringify(cur || {}));
    var gone = {};
    res.added.forEach(function (id) { gone[id] = 1; });
    s.entries = (s.entries || []).filter(function (e) { return !gone[e.id]; });
    s.deleted = s.deleted || {};
    res.added.forEach(function (id) { s.deleted[id] = Math.max(s.deleted[id] || 0, now); });
    var pv = (prev && prev.vocab) || {};
    ["emo", "act"].forEach(function (list) {
      res.defs[list].forEach(function (d) {
        s.vocab = s.vocab && typeof s.vocab === "object" ? s.vocab : {};
        var arr = s.vocab[list] = Array.isArray(s.vocab[list]) ? s.vocab[list] : [];
        var old = null, at = -1;
        (pv[list] || []).forEach(function (x) { if (x && x.id === d.id) old = x; });
        arr.forEach(function (x, i) { if (x && x.id === d.id) at = i; });
        var o = JSON.parse(JSON.stringify(old || d));
        o.hid = true;
        o.mtime = Math.max(now, (at >= 0 ? arr[at].mtime || 0 : d.mtime || 0) + 1);
        if (at >= 0) arr[at] = o; else arr.push(o);
      });
    });
    s.sm = Math.max(now, s.sm || 0);
    return s;
  }

  var API = {
    STEPS: STEPS, MAX_ITEMS: MAX_ITEMS, MAX_FILE: MAX_FILE,
    read: read, prepare: prepare, apply: apply, undo: undo,
    guessStep: guessStep, tsOf: tsOf, noteText: noteText, b64bytes: b64bytes,
    emoKeyOf: function (n) { return EMO_KEY[norm(n)] || ""; },
    habitOf: function (n) { return HAB_KEY[norm(n)] || null; }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosMoodImport = API;
})(typeof self !== "undefined" ? self : this);
