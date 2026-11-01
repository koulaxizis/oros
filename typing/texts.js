// i18n-inline-ok: practice texts in Greek, English and German (literature, not UI strings)
// ============================================================
// orOS Typing Tutor: practice texts (pure, no DOM)
//  1. LIB: short public-domain excerpts, each with its author, work
//     and year. Greek ones in today's monotonic spelling (the poets
//     wrote polytonic); a "·" is typed as a comma (no key on the Greek
//     layout). Nothing here is copied from a typing site.
//  2. clean(lay, text): makes any text typeable on a layout: typographic
//     quotes and dashes become the plain ones, line breaks become
//     spaces, characters the layout cannot type are dropped (counted).
//  3. parts(text): long texts are typed part by part (about 350
//     characters, cut after a sentence where possible).
//  4. My texts, slice "typingtexts", localStorage "oros-typing-texts"
//     (TYPINGTEXTS v1, OROS_BIBLE.md Part IV):
//       { ver: 1, items: [{ id, m, n title ≤ 80, t text ≤ 20 000 }], tombs: { id: m } }
//     LWW per text by m (tie: the larger JSON), tombstones (a delete at
//     m ≥ the text's m wins, a newer edit comes back), ≤ 50 texts,
//     sorted by id. Merge symmetric, idempotent, associative (R5, R17,
//     R26). Kept apart from the TYPING v1 slice so a wave-1 device,
//     which rebuilds that slice from known fields, never drops a text.
// Needs TypingLayouts (loaded before it).
// ============================================================
(function (root) {
  "use strict";

  var K = root && root.TypingLayouts ? root.TypingLayouts :
    (typeof require === "function" ? require("./layouts.js") : null);

  // ---------- 1. The library ----------
  // l: the layout it is typed on; a: author; w: work; y: year.
  var LIB = [
    { id: "el-ithaki", l: "el", a: "Κωνσταντίνος Καβάφης", w: "Ιθάκη", y: 1911,
      t: "Σα βγεις στον πηγαιμό για την Ιθάκη, να εύχεσαι νάναι μακρύς ο δρόμος, γεμάτος περιπέτειες, γεμάτος γνώσεις. " +
         "Τους Λαιστρυγόνας και τους Κύκλωπας, τον θυμωμένο Ποσειδώνα μη φοβάσαι, τέτοια στον δρόμο σου ποτέ σου δεν θα βρεις, " +
         "αν μέν' η σκέψις σου υψηλή, αν εκλεκτή συγκίνησις το πνεύμα και το σώμα σου αγγίζει." },
    { id: "el-keria", l: "el", a: "Κωνσταντίνος Καβάφης", w: "Κεριά", y: 1899,
      t: "Του μέλλοντος η μέρες στέκοντ' εμπροστά μας σα μια σειρά κεράκια αναμμένα, χρυσά, ζεστά, και ζωηρά κεράκια. " +
         "Η περασμένες μέρες πίσω μένουν, μια θλιβερή γραμμή κεριών σβυσμένων· τα πιο κοντά βγάζουν καπνόν ακόμη, κρύα κεριά, λυωμένα, και κυρτά." },
    { id: "el-ymnos", l: "el", a: "Διονύσιος Σολωμός", w: "Ύμνος εις την Ελευθερίαν", y: 1823,
      t: "Σε γνωρίζω από την κόψη του σπαθιού την τρομερή, σε γνωρίζω από την όψη που με βια μετράει τη γη. " +
         "Απ' τα κόκαλα βγαλμένη των Ελλήνων τα ιερά, και σαν πρώτα ανδρειωμένη, χαίρε, ω χαίρε, Ελευθεριά!" },
    { id: "el-preveza", l: "el", a: "Κώστας Καρυωτάκης", w: "Πρέβεζα", y: 1928,
      t: "Θάνατος είναι οι κάργιες που χτυπιούνται στους μαύρους τοίχους και τα κεραμίδια, " +
         "θάνατος οι γυναίκες, που αγαπιούνται καθώς να καθαρίζουνε κρεμμύδια." },
    { id: "en-pride", l: "en", a: "Jane Austen", w: "Pride and Prejudice", y: 1813,
      t: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. " +
         "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed " +
         "in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters." },
    { id: "en-cities", l: "en", a: "Charles Dickens", w: "A Tale of Two Cities", y: 1859,
      t: "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, " +
         "it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, " +
         "it was the spring of hope, it was the winter of despair, we had everything before us, we had nothing before us, " +
         "we were all going direct to Heaven, we were all going direct the other way." },
    { id: "en-ishmael", l: "en", a: "Herman Melville", w: "Moby-Dick", y: 1851,
      t: "Call me Ishmael. Some years ago - never mind how long precisely - having little or no money in my purse, and nothing particular " +
         "to interest me on shore, I thought I would sail about a little and see the watery part of the world. " +
         "It is a way I have of driving off the spleen and regulating the circulation." },
    { id: "en-alice", l: "en", a: "Lewis Carroll", w: "Alice's Adventures in Wonderland", y: 1865,
      t: "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had " +
         "peeped into the book her sister was reading, but it had no pictures or conversations in it, 'and what is the use of a book,' " +
         "thought Alice 'without pictures or conversations?'" },
    { id: "en-gettysburg", l: "en", a: "Abraham Lincoln", w: "Gettysburg Address", y: 1863,
      t: "Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated " +
         "to the proposition that all men are created equal. Now we are engaged in a great civil war, testing whether that nation, or any " +
         "nation so conceived and so dedicated, can long endure. We are met on a great battle-field of that war. We have come to dedicate " +
         "a portion of that field, as a final resting place for those who here gave their lives that that nation might live. " +
         "It is altogether fitting and proper that we should do this." },
    { id: "de-samsa", l: "de", a: "Franz Kafka", w: "Die Verwandlung", y: 1915,
      t: "Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich in seinem Bett zu einem ungeheueren Ungeziefer verwandelt. " +
         "Er lag auf seinem panzerartig harten Rücken und sah, wenn er den Kopf ein wenig hob, seinen gewölbten, braunen, von bogenförmigen " +
         "Versteifungen geteilten Bauch, auf dessen Höhe sich die Bettdecke, zum gänzlichen Niedergleiten bereit, kaum noch erhalten konnte." },
    { id: "de-process", l: "de", a: "Franz Kafka", w: "Der Process", y: 1925,
      t: "Jemand mußte Josef K. verleumdet haben, denn ohne daß er etwas Böses getan hätte, wurde er eines Morgens verhaftet." },
    { id: "de-erlkoenig", l: "de", a: "Johann Wolfgang von Goethe", w: "Erlkönig", y: 1782,
      t: "Wer reitet so spät durch Nacht und Wind? Es ist der Vater mit seinem Kind; er hat den Knaben wohl in dem Arm, " +
         "er faßt ihn sicher, er hält ihn warm. Mein Sohn, was birgst du so bang dein Gesicht? Siehst, Vater, du den Erlkönig nicht? " +
         "Den Erlenkönig mit Kron und Schweif? Mein Sohn, es ist ein Nebelstreif." },
    { id: "de-frosch", l: "de", a: "Brüder Grimm", w: "Der Froschkönig", y: 1857,
      t: "In den alten Zeiten, wo das Wünschen noch geholfen hat, lebte ein König, dessen Töchter waren alle schön, aber die jüngste " +
         "war so schön, daß die Sonne selber, die doch so vieles schon gesehen hat, sich verwunderte, so oft sie ihr ins Gesicht schien." },
    { id: "de-loreley", l: "de", a: "Heinrich Heine", w: "Die Lore-Ley", y: 1824,
      t: "Ich weiß nicht, was soll es bedeuten, daß ich so traurig bin; ein Märchen aus alten Zeiten, das kommt mir nicht aus dem Sinn. " +
         "Die Luft ist kühl und es dunkelt, und ruhig fließt der Rhein; der Gipfel des Berges funkelt im Abendsonnenschein." },
    // Polytonic (wave 4): typed on the polytonic layout; yd is the date
    // shown when the year alone would read oddly.
    { id: "elp-odyssey", l: "elp", a: "Ὅμηρος", w: "Ὀδύσσεια", y: -700, yd: "8ος αἰ. π.Χ.",
      t: "Ἄνδρα μοι ἔννεπε, Μοῦσα, πολύτροπον, ὃς μάλα πολλὰ πλάγχθη, ἐπεὶ Τροίης ἱερὸν πτολίεθρον ἔπερσε." },
    { id: "elp-john", l: "elp", a: "Ἰωάννης", w: "Κατὰ Ἰωάννην", y: 100, yd: "1ος αἰ.",
      t: "Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν, καὶ θεὸς ἦν ὁ λόγος. οὗτος ἦν ἐν ἀρχῇ πρὸς τὸν θεόν. " +
         "ἐν αὐτῷ ζωὴ ἦν, καὶ ἡ ζωὴ ἦν τὸ φῶς τῶν ἀνθρώπων· καὶ τὸ φῶς ἐν τῇ σκοτίᾳ φαίνει, καὶ ἡ σκοτία αὐτὸ οὐ κατέλαβεν." },
    { id: "elp-hymn", l: "elp", a: "Διονύσιος Σολωμός", w: "Ὕμνος εἰς τὴν Ἐλευθερίαν", y: 1823,
      t: "Σὲ γνωρίζω ἀπὸ τὴν κόψι τοῦ σπαθιοῦ τὴν τρομερή, σὲ γνωρίζω ἀπὸ τὴν ὄψι, ποὺ μὲ βιὰ μετράει τὴ γῆ." }
  ];
  // The passages for a layout: its own and those of its word language
  // and family (Dvorak and Colemak show the English ones, polytonic the
  // Greek ones and its own).
  function library(lay) {
    if (!lay) return LIB.slice();
    var L = K.get(lay), ok = {};
    ok[lay] = ok[L.words] = ok[L.base] = true;
    if (L.lang === "en") ok.en = true;
    return LIB.filter(function (x) { return ok[x.l]; });
  }
  function libText(id) {
    for (var i = 0; i < LIB.length; i++) if (LIB[i].id === id) return LIB[i];
    return null;
  }

  // ---------- 2. Make a text typeable ----------
  // Tried in order: the character itself, then each stand-in.
  var STAND_IN = {
    "“": ["\""], "”": ["\""], "„": ["\""], "«": ["\""], "»": ["\""],
    "‘": ["'"], "’": ["'"], "‚": ["'"], "ʼ": ["'"],
    "–": ["-"], "—": ["-"], "−": ["-"], "‐": ["-"], "‑": ["-"],
    "·": [","], "·": [","], "…": ["..."], ";": [";", "?"],
    " ": [" "], " ": [" "], " ": [" "]
  };
  function clean(lay, text) {
    var src = Array.from(String(text || "").normalize("NFC").replace(/\r\n?/g, "\n"));
    var out = "", dropped = 0;
    src.forEach(function (ch) {
      if (/\s/.test(ch)) { out += " "; return; }
      if (K.strokes(lay, ch)) { out += ch; return; }
      var alt = STAND_IN[ch] || [];
      for (var i = 0; i < alt.length; i++) {
        if (Array.from(alt[i]).every(function (c) { return !!K.strokes(lay, c); })) { out += alt[i]; return; }
      }
      // a letter with an accent the layout lacks: the plain letter
      var base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (base !== ch && base && K.strokes(lay, base)) { out += base; return; }
      dropped++;
    });
    return { text: out.replace(/ {2,}/g, " ").trim(), dropped: dropped };
  }

  // ---------- 3. Parts ----------
  var PART = 350;
  function parts(text) {
    var chars = Array.from(String(text || "")), out = [], i = 0;
    while (i < chars.length) {
      var end = Math.min(chars.length, i + PART);
      if (end < chars.length) {
        // cut after a sentence end in the last third, else after a space
        var cut = -1;
        for (var j = end; j > i + PART * 0.6; j--) {
          if (chars[j - 1] === " " && /[.!?;:]/.test(chars[j - 2] || "")) { cut = j; break; }
        }
        if (cut < 0) for (var k = end; k > i + PART * 0.5; k--) if (chars[k - 1] === " ") { cut = k; break; }
        if (cut > 0) end = cut;
      }
      // a short tail joins the part before it
      if (chars.length - end < 80) end = chars.length;
      var p = chars.slice(i, end).join("").trim();
      if (p) out.push(p);
      i = end;
    }
    return out;
  }

  // ---------- 4. My texts (slice "typingtexts") ----------
  var VER = 1, MAX_ITEMS = 50, TITLE_MAX = 80, TEXT_MAX = 20000;
  var ID_RE = /^t[a-z0-9]{4,20}$/;
  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function ms(v) { return typeof v === "number" && isFinite(v) && v >= 1 && v <= 1e15 ? Math.floor(v) : 0; }
  function canon(o) { return JSON.stringify(o); }
  function emptyMine() { return { ver: VER, items: [], tombs: {} }; }
  function cleanTitle(s) { return Array.from(String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, TITLE_MAX).join(""); }
  function cleanBody(s) {
    return Array.from(String(s || "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim()).slice(0, TEXT_MAX).join("");
  }
  function cleanItem(x) {
    if (!isObj(x) || typeof x.id !== "string" || !ID_RE.test(x.id)) return null;
    var m = ms(x.m), t = typeof x.t === "string" ? cleanBody(x.t) : "";
    if (!m || !t) return null;
    return { id: x.id, m: m, n: cleanTitle(x.n), t: t };
  }
  function mergeMine(list) {
    var items = {}, tombs = {};
    list.forEach(function (d) {
      if (!isObj(d)) return;
      if (isObj(d.tombs)) Object.keys(d.tombs).forEach(function (id) {
        var m = ms(d.tombs[id]);
        if (ID_RE.test(id) && m) tombs[id] = Math.max(tombs[id] || 0, m);
      });
      (Array.isArray(d.items) ? d.items : []).forEach(function (x) {
        var c = cleanItem(x);
        if (!c) return;
        var o = items[c.id];
        if (!o || c.m > o.m || (c.m === o.m && canon(c) > canon(o))) items[c.id] = c;
      });
    });
    var out = emptyMine();
    out.items = Object.keys(items).sort().filter(function (id) { return !(tombs[id] >= items[id].m); })
      .map(function (id) { return items[id]; });
    // ≤ 50 texts: the newest stay (the cut is the same on every device)
    if (out.items.length > MAX_ITEMS) {
      var keep = out.items.slice().sort(function (a, b) { return b.m - a.m || (a.id < b.id ? -1 : 1); }).slice(0, MAX_ITEMS);
      var ok = {};
      keep.forEach(function (x) { ok[x.id] = true; });
      out.items = out.items.filter(function (x) { return ok[x.id]; });
    }
    Object.keys(tombs).sort().forEach(function (id) { out.tombs[id] = tombs[id]; });
    return out;
  }
  function normMine(d) { return mergeMine([d]); }
  function mergeTwo(a, b) { return mergeMine([a, b]); }
  function serializeMine(d) { return canon(normMine(d)); }
  function newId(rand) {
    var s = "t";
    for (var i = 0; i < 10; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(rand() * 36));
    return s;
  }
  // The clock and the random source come from the caller (tests pass their own).
  function addMine(d, title, text, now, rand) {
    var out = normMine(d), body = cleanBody(text);
    if (!body) return { data: out, id: "" };
    var id = newId(rand || Math.random);
    var m = Math.max(1, Math.floor(now));
    out.items.push({ id: id, m: m, n: cleanTitle(title), t: body });
    return { data: normMine(out), id: id };
  }
  function removeMine(d, id, now) {
    var out = normMine(d), it = mineById(out, id);
    if (!it) return out;
    out.tombs[id] = Math.max(Math.floor(now), it.m);
    return normMine(out);
  }
  function mineById(d, id) {
    for (var i = 0; i < d.items.length; i++) if (d.items[i].id === id) return d.items[i];
    return null;
  }
  // A title for a text without one: its first words.
  function titleOf(it) {
    if (it.n) return it.n;
    var w = it.t.replace(/\s+/g, " ").split(" ").slice(0, 6).join(" ");
    return Array.from(w).slice(0, 40).join("");
  }

  var API = {
    LIB: LIB, library: library, libText: libText, clean: clean, parts: parts, PART: PART,
    MAX_ITEMS: MAX_ITEMS, TITLE_MAX: TITLE_MAX, TEXT_MAX: TEXT_MAX,
    emptyMine: emptyMine, normMine: normMine, mergeMine: mergeTwo, serializeMine: serializeMine,
    addMine: addMine, removeMine: removeMine, mineById: mineById, titleOf: titleOf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.TypingTexts = API;
})(typeof window !== "undefined" ? window : globalThis);
