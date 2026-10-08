// ============================================================
// orOS Meal Planner — core.js (pure logic, v1.0.0)
// Everything that is not the screen: the data model and its merge
// (sync slice "meals"), quantities and units, the ingredient line
// parser, the "paste a recipe" parser, the shopping list builder,
// the diet checks and the ready recipes. No DOM, no storage, no
// network: meals.js draws, this file decides. Node tests load it
// as is (it attaches OrosMealsCore to its global).
//
// API (window.OrosMealsCore): see the object at the end of the file.
// Sections:
//   1. Constants
//   2. Text: clean, fold, ingredient keys
//   3. Units + quantities
//   4. Ingredient lines (parse / format)
//   5. "Paste a recipe" parser
//   6. Dictionary: aisles + diet flags
//   7. Diets
//   8. Dates
//   9. Normalize
//  10. Merge (R5, R17, R26)
//  11. Shopping list
//  12. Ready recipes (seeds)
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants ----------
  var VER = 1;
  var DATA_VER = 1;
  var ID_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
  var MAN_RE = /^n(\d{8})-[a-z0-9]{4,20}$/;          // manual shopping item: n<yyyymmdd of its week>-<rand>
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var KEEP_DAYS = 400;                                 // plan, ticks and manual items older than this go
  var LIM = {
    title: 80, emoji: 8, tag: 24, tags: 10, ings: 80, ingName: 60, ingNote: 80, group: 40,
    steps: 50, step: 1000, notes: 2000, src: 300, cellItems: 6, cellText: 60, manual: 80,
    slotName: 24, servings: 50, minutes: 1440, key: 80, recipes: 500
  };
  var SLOT_IDS = ["b", "l", "d", "s", "x"];           // breakfast, lunch, dinner, snack, extra
  var COURSES = ["breakfast", "main", "side", "salad", "soup", "dessert", "snack", "drink"];
  var DIETS = ["vegan", "veg", "pesc", "raw", "keto", "lowcarb", "gf", "lf", "nut", "fast"];
  var AISLES = ["produce", "meat", "fish", "dairy", "bakery", "pantry", "spices", "frozen", "drinks", "other"];

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function clampInt(v, lo, hi, dflt) {
    v = Number(v);
    if (!isFinite(v)) return dflt;
    v = Math.round(v);
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function sortedObj(o) {
    var out = {};
    Object.keys(o).sort(cmpStr).forEach(function (k) { out[k] = o[k]; });
    return out;
  }

  // ---------- 2. Text ----------
  // One line of user text: control characters out, spaces collapsed.
  function clean(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    if (s.length > max) s = s.slice(0, max).trim();
    return s;
  }
  // Multi-line text (notes): line breaks kept, at most one empty line.
  function cleanBlock(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
         .split("\n").map(function (l) { return l.replace(/\s+/g, " ").trim(); }).join("\n")
         .replace(/\n{3,}/g, "\n\n").trim();
    if (s.length > max) s = s.slice(0, max).trim();
    return s;
  }
  // Lower case without accents, ONE character for one character, so
  // a match in the folded text has the same offsets in the original.
  function fold(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i).toLowerCase();
      var d = c.normalize ? c.normalize("NFD").replace(/[̀-ͯ]/g, "") : c;
      out += d.length === 1 ? d : c;
    }
    return out.replace(/ς/g, "σ");
  }

  // Singular and plural of the same ingredient share a key:
  // "ντομάτες" / "ντομάτα", "κρεμμύδια" / "κρεμμύδι", "eggs" / "egg".
  var STEM_EXCEPT = {
    "πιπερια": "πιπερια", "πιπεριεσ": "πιπερια",       // bell pepper ≠ πιπέρι (pepper)
    "καρυδα": "καρυδα",                                // coconut ≠ καρύδια (walnuts)
    "κρεμα": "κρεμα"
  };
  var GR_ENDINGS = ["εσ", "ια", "οσ", "οι", "ου", "ων", "ασ", "ησ", "α", "ο", "ι", "η", "ε", "υ"];
  function stem(w) {
    if (STEM_EXCEPT[w]) return STEM_EXCEPT[w];
    if (/[α-ω]/.test(w)) {
      for (var i = 0; i < GR_ENDINGS.length; i++) {
        var e = GR_ENDINGS[i];
        if (w.length - e.length >= 3 && w.slice(-e.length) === e) return w.slice(0, -e.length);
      }
      return w;
    }
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + "y";
    if (w.length > 4 && /(oes|ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /[^s]s$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function words(name) {
    return fold(String(name || "")).replace(/[^0-9a-zα-ω]+/g, " ").trim().split(" ").filter(Boolean);
  }
  // The shopping key of an ingredient name.
  function keyOf(name) {
    return words(name).map(stem).join(" ").slice(0, LIM.key);
  }

  // ---------- 3. Units + quantities ----------
  // fam: units of one family add up (f = size in the family's base).
  var UNITS = {
    g:     { fam: "mass",  f: 1,    en: ["g", "gr", "gram", "grams"],                 el: ["γρ.", "γρ", "γρα", "γραμμάρια", "γραμμάριο", "γραμ.", "g", "gr"],
             lab: { en: ["g", "g"], el: ["γρ.", "γρ."] } },
    kg:    { fam: "mass",  f: 1000, en: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"], el: ["κιλό", "κιλά", "κιλο", "kg", "κ."],
             lab: { en: ["kg", "kg"], el: ["κιλό", "κιλά"] } },
    ml:    { fam: "vol",   f: 1,    en: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"], el: ["ml", "μλ", "μλ."],
             lab: { en: ["ml", "ml"], el: ["ml", "ml"] } },
    l:     { fam: "vol",   f: 1000, en: ["l", "liter", "liters", "litre", "litres", "lt"], el: ["λίτρο", "λίτρα", "λτ.", "λτ", "l", "lt"],
             lab: { en: ["l", "l"], el: ["λίτρο", "λίτρα"] } },
    tsp:   { fam: "spoon", f: 1,    en: ["tsp", "tsp.", "teaspoon", "teaspoons"],
             el: ["κουταλάκι του γλυκού", "κουταλάκια του γλυκού", "κουτ. γλυκού", "κ.γ.", "κγ", "κουταλάκι", "κουταλάκια"],
             lab: { en: ["tsp", "tsp"], el: ["κ.γ.", "κ.γ."] } },
    tbsp:  { fam: "spoon", f: 3,    en: ["tbsp", "tbsp.", "tbs", "tablespoon", "tablespoons"],
             el: ["κουταλιά της σούπας", "κουταλιές της σούπας", "κουτ. σούπας", "κ.σ.", "κσ", "κουταλιά", "κουταλιές"],
             lab: { en: ["tbsp", "tbsp"], el: ["κ.σ.", "κ.σ."] } },
    cup:   { fam: "spoon", f: 48,   en: ["cup", "cups"], el: ["φλιτζάνι", "φλιτζάνια", "φλ.", "κούπα", "κούπες"],
             lab: { en: ["cup", "cups"], el: ["φλιτζάνι", "φλιτζάνια"] } },
    pinch: { fam: null, f: 1, en: ["pinch", "pinches"], el: ["πρέζα", "πρέζες"],
             lab: { en: ["pinch", "pinches"], el: ["πρέζα", "πρέζες"] } },
    clove: { fam: null, f: 1, en: ["clove", "cloves"], el: ["σκελίδα", "σκελίδες"],
             lab: { en: ["clove", "cloves"], el: ["σκελίδα", "σκελίδες"] } },
    can:   { fam: null, f: 1, en: ["can", "cans", "tin", "tins"], el: ["κονσέρβα", "κονσέρβες", "κουτί", "κουτιά"],
             lab: { en: ["can", "cans"], el: ["κονσέρβα", "κονσέρβες"] } },
    bunch: { fam: null, f: 1, en: ["bunch", "bunches"], el: ["ματσάκι", "ματσάκια", "μάτσο", "μάτσα"],
             lab: { en: ["bunch", "bunches"], el: ["ματσάκι", "ματσάκια"] } },
    pack:  { fam: null, f: 1, en: ["pack", "packs", "packet", "packets"], el: ["πακέτο", "πακέτα", "συσκευασία", "συσκευασίες"],
             lab: { en: ["pack", "packs"], el: ["πακέτο", "πακέτα"] } },
    slice: { fam: null, f: 1, en: ["slice", "slices"], el: ["φέτα", "φέτες"],
             lab: { en: ["slice", "slices"], el: ["φέτα", "φέτες"] } },
    pc:    { fam: null, f: 1, en: ["pc", "pcs", "piece", "pieces"], el: ["τεμ.", "τεμ", "τεμάχιο", "τεμάχια", "τμχ"],
             lab: { en: ["", ""], el: ["", ""] } }
  };
  var UNIT_IDS = Object.keys(UNITS);
  // Every alias, folded, longest first (so "κ.σ." wins over "κ.").
  var ALIASES = [];
  UNIT_IDS.forEach(function (id) {
    UNITS[id].en.concat(UNITS[id].el).forEach(function (a) {
      var fa = fold(a);
      if (!ALIASES.some(function (x) { return x.a === fa; })) ALIASES.push({ a: fa, u: id });
    });
  });
  ALIASES.sort(function (x, y) { return y.a.length - x.a.length || cmpStr(x.a, y.a); });

  function unitLabel(u, q, lang) {
    var U = UNITS[u];
    if (!U) return "";
    var l = U.lab[lang === "el" ? "el" : "en"];
    return (q !== null && q !== undefined && q > 1) ? l[1] : l[0];
  }

  var GLYPHS = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
  // "1 1/2", "1½", "½", "0,5", "0.5", "1.000" (Greek thousands), "2-3" (upper end).
  function parseQty(str) {
    if (typeof str !== "string") return null;
    var s = str.trim();
    if (!s) return null;
    var range = s.split(/\s*[-–—]\s*/).filter(Boolean);
    if (range.length > 1) {
      var best = null;
      range.forEach(function (r) { var v = parseQty(r); if (v !== null && (best === null || v > best)) best = v; });
      return best;
    }
    s = s.replace(/([0-9])([½¼¾⅓⅔⅛])/g, "$1 $2");
    var total = 0, any = false, ok = true;
    s.split(/\s+/).forEach(function (tok) {
      if (!ok) return;
      var v = null;
      if (GLYPHS[tok] !== undefined) v = GLYPHS[tok];
      else if (/^\d{1,3}(\.\d{3})+$/.test(tok)) v = Number(tok.replace(/\./g, ""));
      else if (/^\d+([.,]\d+)?$/.test(tok)) v = Number(tok.replace(",", "."));
      else if (/^\d+\/\d+$/.test(tok)) {
        var p = tok.split("/");
        v = Number(p[1]) ? Number(p[0]) / Number(p[1]) : null;
      }
      if (v === null || !isFinite(v)) { ok = false; return; }
      total += v; any = true;
    });
    if (!ok || !any || total <= 0) return null;
    return Math.round(Math.min(total, 100000) * 1000) / 1000;
  }

  var FRACS = [[0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"]];
  // A quantity for people: "1½", "0,3", "250". `metric` (g, ml) rounds,
  // no fractions.
  function fmtQty(q, lang, metric) {
    if (q === null || q === undefined || !isFinite(q)) return "";
    var sep = lang === "el" ? "," : ".";
    if (metric) {
      var r = q >= 100 ? Math.round(q / 5) * 5 : (q >= 10 ? Math.round(q) : Math.round(q * 10) / 10);
      return String(r).replace(".", sep);
    }
    var whole = Math.floor(q + 1e-9), frac = q - whole;
    if (frac < 0.02) return String(whole);
    if (frac > 0.98) return String(whole + 1);
    for (var i = 0; i < FRACS.length; i++) {
      if (Math.abs(frac - FRACS[i][0]) < 0.02) return (whole ? String(whole) : "") + FRACS[i][1];
    }
    var v = q >= 10 ? Math.round(q) : Math.round(q * 10) / 10;
    return String(v).replace(".", sep);
  }

  var WORD_QTY = {
    "μισο": 0.5, "μιση": 0.5, "half": 0.5, "ενα": 1, "μια": 1, "μια ": 1, "ενασ": 1, "one": 1, "a": 1, "an": 1,
    "δυο": 2, "two": 2, "τρια": 3, "τρεισ": 3, "three": 3, "τεσσερα": 4, "τεσσερισ": 4, "four": 4
  };

  // ---------- 4. Ingredient lines ----------
  // ing = { q: number|null, u: unit id|"", n: name, x: note, g: group }
  function parseIngLine(line, group) {
    var s = clean(String(line || ""), 300).replace(/^[-*•·–—]+\s*/, "").replace(/^\d+[.)]\s+(?=\D)/, "");
    var ing = { q: null, u: "", n: "", x: "", g: clean(group || "", LIM.group) };
    if (!s) return null;
    // Notes: "(…)" anywhere and everything after the first comma.
    var notes = [];
    s = s.replace(/\(([^)]*)\)/g, function (m0, inner) { if (inner.trim()) notes.push(inner.trim()); return " "; });
    var comma = -1;
    for (var ci = s.indexOf(","); ci >= 0; ci = s.indexOf(",", ci + 1)) {
      if (!(/\d/.test(s.charAt(ci - 1)) && /\d/.test(s.charAt(ci + 1)))) { comma = ci; break; }   // "1,5" is a number
    }
    if (comma > 0) {
      notes.unshift(s.slice(comma + 1).trim());
      s = s.slice(0, comma);
    }
    s = clean(s, 300);
    // Quantity.
    var m = s.match(/^[\d½¼¾⅓⅔⅛][\d\s.,\/½¼¾⅓⅔⅛–—-]*/);
    var rest = s;
    if (m) {
      var qs = m[0].replace(/[\s.,\/–—-]+$/, "");
      var q = parseQty(qs);
      if (q !== null) { ing.q = q; rest = s.slice(qs.length).trim(); }
    } else {
      var fw = fold(s).split(" ");
      if (fw.length > 1 && WORD_QTY[fw[0]] !== undefined) {
        ing.q = WORD_QTY[fw[0]];
        rest = s.slice(fw[0].length).trim();
      }
    }
    // Unit: the longest alias at the start, followed by a space, and
    // only when a name follows ("1 φέτα" is feta, "1 φέτα ψωμί" a slice).
    var fr = fold(rest);
    for (var i = 0; i < ALIASES.length; i++) {
      var a = ALIASES[i].a;
      if (fr.slice(0, a.length) !== a) continue;
      var after = rest.slice(a.length);
      if (after && !/^[\s.]/.test(after) && !/\.$/.test(a)) continue;
      var name = after.replace(/^\.?\s*/, "").replace(/^(of|από)\s+/i, "");
      if (!clean(name, 1)) continue;
      ing.u = ALIASES[i].u;
      rest = name;
      break;
    }
    ing.n = clean(rest, LIM.ingName);
    ing.x = clean(notes.join(", "), LIM.ingNote);
    if (!ing.n) {
      if (ing.q === null && !ing.u) return null;
      ing.n = clean(s, LIM.ingName);
      ing.q = null; ing.u = "";
    }
    return ing;
  }

  function fmtIngQty(ing, lang, factor) {
    if (ing.q === null) return "";
    var q = ing.q * (factor || 1);
    var metric = ing.u === "g" || ing.u === "ml";
    var txt = fmtQty(q, lang, metric);
    var lab = unitLabel(ing.u, q, lang);
    return lab ? txt + " " + lab : txt;
  }
  function ingToLine(ing, lang, factor) {
    var qty = fmtIngQty(ing, lang, factor);
    return (qty ? qty + " " : "") + ing.n + (ing.x ? ", " + ing.x : "");
  }
  // The editor's text: one ingredient per line, "Group:" lines between.
  function ingsToText(ings, lang) {
    var out = [], g = "";
    (ings || []).forEach(function (ing) {
      if ((ing.g || "") !== g) {
        g = ing.g || "";
        if (out.length) out.push("");
        if (g) out.push(g + ":");
      }
      out.push(ingToLine(ing, lang));
    });
    return out.join("\n");
  }
  function textToIngs(text) {
    var out = [], g = "";
    String(text || "").split(/\r?\n/).forEach(function (raw) {
      var line = clean(raw, 300);
      if (!line) return;
      if (/:$/.test(line) && !/^[\d½¼¾⅓⅔⅛]/.test(line)) { g = clean(line.slice(0, -1), LIM.group); return; }
      var ing = parseIngLine(line, g);
      if (ing && out.length < LIM.ings) out.push(ing);
    });
    return out;
  }
  function textToSteps(text) {
    var out = [];
    String(text || "").split(/\r?\n/).forEach(function (raw) {
      var s = clean(raw.replace(/^\s*(\d+\s*[.)]|step\s*\d+\s*[:.]?|βήμα\s*\d+\s*[:.]?)\s*/i, ""), LIM.step);
      if (s && out.length < LIM.steps) out.push(s);
    });
    return out;
  }

  // ---------- 5. "Paste a recipe" parser ----------
  // Free text in, a draft out (never saved by itself: a prefill).
  var H_ING = /^(ingredients?|υλικα|τα υλικα|συστατικα|χρειαζομαστε|you will need|what you need)$/;
  var H_STEP = /^(method|instructions?|directions?|steps|preparation|how to make( it)?|εκτελεση|οδηγιεσ|βηματα|διαδικασια|παρασκευη|τροποσ παρασκευησ|η συνταγη)$/;
  var H_NOTE = /^(notes?|tips?|σημειωσεισ|σημειωση|συμβουλεσ|μυστικα)$/;
  function headerOf(line) {
    var f = fold(line).replace(/[:：\-–—#*=]+$/g, "").replace(/^[#*=\s]+/, "").trim();
    if (H_ING.test(f)) return "ing";
    if (H_STEP.test(f)) return "step";
    if (H_NOTE.test(f)) return "note";
    return null;
  }
  function minutesIn(f) {
    var m = f.match(/(\d+(?:[.,]\d+)?)\s*(ωρ|hour|hr|h\b)/);
    var n = f.match(/(\d+)\s*(λεπτ|min|′|')/);
    var total = 0;
    if (m) total += Math.round(Number(m[1].replace(",", ".")) * 60);
    if (n) total += Number(n[1]);
    return total || null;
  }
  function parseRecipeText(text) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var d = { t: "", sv: null, pt: null, ct: null, ig: [], st: [], no: "" };
    var mode = null, sawHeader = false, group = "", notes = [];
    lines.forEach(function (raw) { if (headerOf(clean(raw, 200))) sawHeader = true; });
    lines.forEach(function (raw) {
      var line = clean(raw, LIM.step);
      if (!line) return;
      var h = headerOf(line);
      if (h) { mode = h; group = ""; return; }
      var f = fold(line);
      var sv = f.match(/^(serves|servings|yield|makes|μεριδεσ|για)\s*:?\s*(\d{1,2})\b/) ||
               f.match(/\b(\d{1,2})\s*(μεριδεσ|ατομα|servings|portions)\b/);
      if (sv && line.length < 40 && d.sv === null) { d.sv = Number(sv[2] && /^\d/.test(sv[2]) ? sv[2] : sv[1]); return; }
      if (/^(prep|preparation time|χρονοσ προετοιμασιασ|προετοιμασια)\b/.test(f) && line.length < 50) { d.pt = minutesIn(f); return; }
      if (/^(cook|cooking time|bake|χρονοσ (ψησιματοσ|μαγειρεματοσ)|ψησιμο|μαγειρεμα|βρασιμο)\b/.test(f) && line.length < 50) { d.ct = minutesIn(f); return; }
      if (!d.t && mode === null) { d.t = clean(line.replace(/^#+\s*/, ""), LIM.title); return; }
      var m = mode;
      if (m === null && !sawHeader) {
        // No headers at all: short lines that start with a quantity or a
        // bullet are ingredients, the rest are steps.
        m = (/^[-*•·]|^[\d½¼¾⅓⅔⅛]/.test(line) && line.length <= 80 && !/^\d+[.)]\s/.test(line)) ? "ing" : "step";
      }
      if (m === "ing") {
        if (/:$/.test(line) && !/^[\d½¼¾⅓⅔⅛]/.test(line)) { group = clean(line.slice(0, -1).replace(/^[-*•·]\s*/, ""), LIM.group); return; }
        var ing = parseIngLine(line, group);
        if (ing && d.ig.length < LIM.ings) d.ig.push(ing);
      } else if (m === "note") {
        notes.push(line);
      } else if (m === "step" || m === null) {
        d.st = d.st.concat(textToSteps(line)).slice(0, LIM.steps);
      }
    });
    d.no = cleanBlock(notes.join("\n"), LIM.notes);
    return d;
  }

  // ---------- 6. Dictionary: aisles + diet flags ----------
  // Words (singular or plural, EN or EL) → aisle and flags. Matched on
  // keys, so "Ντομάτες" finds "ντομάτα". Hints only: nothing is changed
  // because of them without the user.
  var DICT_SRC = [
    ["produce", "", "tomato tomatoes onion onions garlic carrot carrots celery zucchini courgette eggplant aubergine lettuce cucumber spinach parsley dill mint basil lemon lemons lime orange apple banana strawberry mushroom mushrooms broccoli cauliflower cabbage avocado leek scallion ginger fruit grapes pear peach cherry beetroot pumpkin " +
      "ντομάτα ντομάτες κρεμμύδι κρεμμύδια σκόρδο καρότο καρότα σέλινο κολοκυθάκι κολοκυθάκια μελιτζάνα μελιτζάνες μαρούλι αγγούρι σπανάκι μαϊντανός άνηθος δυόσμος βασιλικός λεμόνι λεμόνια πορτοκάλι μήλο μήλα μπανάνα φράουλα φράουλες μανιτάρι μανιτάρια μπρόκολο κουνουπίδι λάχανο αβοκάντο πράσο κρεμμυδάκι τζίντζερ φρούτα σταφύλι αχλάδι ροδάκινο κεράσι παντζάρι κολοκύθα πιπεριά πιπεριές"],
    ["produce", "carb", "potato potatoes corn πατάτα πατάτες καλαμπόκι"],
    ["meat", "meat", "beef pork chicken lamb veal turkey mince bacon ham sausage sausages meat prosciutto salami chorizo duck goat steak liver meatballs " +
      "κρέας μοσχάρι μοσχαρίσιο μοσχαρίσιος χοιρινό χοιρινή κοτόπουλο αρνί αρνίσιο κατσίκι γαλοπούλα κιμάς μπέικον ζαμπόν λουκάνικο λουκάνικα μπριζόλα μπριζόλες σαλάμι προσούτο πάπια συκώτι κεφτέδες μπιφτέκια μπούτι μπούτια στήθος φιλέτο"],
    ["fish", "fish", "fish salmon tuna cod anchovy anchovies sardines sardine seabream seabass trout mackerel roe " +
      "ψάρι ψάρια σολομός τόνος μπακαλιάρος αντζούγια αντζούγιες σαρδέλα σαρδέλες τσιπούρα λαβράκι γαύρος πέστροφα σκουμπρί ταραμάς"],
    ["fish", "shell", "shrimp shrimps prawn prawns octopus squid mussels clams crab lobster cuttlefish " +
      "γαρίδα γαρίδες χταπόδι καλαμάρι καλαμάρια καλαμαράκια μύδια σουπιά σουπιές αστακός καβούρι"],
    ["dairy", "dairy", "milk cheese butter cream yogurt yoghurt feta parmesan mozzarella cheddar ricotta kefir mascarpone " +
      "γάλα γάλακτος τυρί τυριά βούτυρο κρέμα γιαούρτι φέτα κεφαλοτύρι γραβιέρα παρμεζάνα μοτσαρέλα μυζήθρα ανθότυρο κασέρι ρικότα κεφίρ μασκαρπόνε"],
    ["dairy", "egg", "egg eggs mayonnaise αυγό αυγά μαγιονέζα"],
    ["bakery", "gluten", "bread pita tortilla breadcrumbs rusk rusks baguette bun buns ψωμί πίτα πίτες αραβική φρυγανιά φρυγανιές παξιμάδι παξιμάδια φύλλο μπαγκέτα"],
    ["pantry", "gluten", "flour pasta spaghetti noodles couscous bulgur barley semolina orzo penne macaroni wheat " +
      "αλεύρι ζυμαρικά μακαρόνια σπαγγέτι κριθαράκι πλιγούρι κουσκούς σιμιγδάλι χυλοπίτες τραχανάς κριθάρι πένες"],
    ["pantry", "carb", "rice sugar beans lentils chickpeas oats ρύζι ζάχαρη φασόλια φακές ρεβίθια φάβα βρώμη"],
    ["pantry", "honey", "honey μέλι"],
    ["pantry", "nut", "almonds almond walnuts walnut hazelnuts pistachios cashews peanuts peanut nuts " +
      "αμύγδαλα αμύγδαλο καρύδια καρύδι φουντούκια φιστίκια κάσιους κουκουνάρι κουκουνάρια"],
    ["pantry", "", "oil olive olives vinegar paste stock broth tahini mustard ketchup yeast chocolate cocoa sauce raisins " +
      "λάδι ελαιόλαδο ελιές ξίδι πελτές ζωμός κύβος ταχίνι μουστάρδα κέτσαπ μαγιά σοκολάτα κακάο σάλτσα σταφίδες"],
    ["spices", "", "salt pepper oregano cumin paprika cinnamon thyme rosemary nutmeg bay chili chilli curry turmeric vanilla cloves allspice " +
      "αλάτι πιπέρι ρίγανη κύμινο πάπρικα κανέλα θυμάρι δεντρολίβανο μοσχοκάρυδο δάφνη μπούκοβο κάρι κουρκουμάς βανίλια γαρίφαλο μπαχάρι"],
    ["frozen", "", "peas αρακάς"],
    ["drinks", "", "water wine beer juice νερό κρασί μπύρα χυμός"]
  ];
  // Words that make "milk", "cheese", "meat" plant-based ("γάλα καρύδας").
  var PLANT = "coconut soy soya almond oat rice plant vegan vegetable καρύδας σόγιας αμυγδάλου βρώμης ρυζιού φυτικό φυτική φυτικό λαχανικών";
  var DICT = {}, PLANT_KEYS = {};
  DICT_SRC.forEach(function (row) {
    row[2].split(" ").forEach(function (w) {
      if (!w) return;
      var k = keyOf(w);
      var cur = DICT[k] || (DICT[k] = { a: row[0], f: [] });
      if (row[1] && cur.f.indexOf(row[1]) < 0) cur.f.push(row[1]);
      if (row[1] === "gluten" && cur.f.indexOf("carb") < 0) cur.f.push("carb");
      if (row[1] === "honey" && cur.f.indexOf("carb") < 0) cur.f.push("carb");
    });
  });
  // The sugar in "ζάχαρη" is carb; "brown sugar" too (word match).
  PLANT.split(" ").forEach(function (w) { if (w) PLANT_KEYS[keyOf(w)] = 1; });
  // Phrases first: "tomato paste" is pantry, not produce.
  var PHRASES = {};
  [["pantry", "tomato paste"], ["pantry", "πελτές ντομάτας"], ["pantry", "chopped tomatoes"], ["pantry", "ντομάτα κονκασέ"],
   ["pantry", "olive oil"], ["spices", "black pepper"], ["spices", "bay leaf"], ["spices", "bay leaves"],
   ["spices", "φύλλα δάφνης"], ["spices", "φύλλο δάφνης"], ["dairy", "κρέμα γάλακτος"],
   ["produce", "green pepper"], ["produce", "red pepper"], ["produce", "yellow pepper"], ["produce", "bell pepper"],
   ["produce", "green peppers"], ["produce", "red peppers"], ["produce", "bell peppers"]]
    .forEach(function (p) { PHRASES[keyOf(p[1])] = p[0]; });

  function lookup(name) {
    var k = keyOf(name), ws = k.split(" ");
    var aisle = PHRASES[k] || null, flags = [];
    var plant = ws.some(function (w) { return PLANT_KEYS[w]; });
    ws.forEach(function (w) {
      var e = DICT[w];
      if (!e) return;
      if (!aisle) aisle = e.a;
      e.f.forEach(function (f) {
        if (plant && (f === "dairy" || f === "meat" || f === "egg")) return;
        if (flags.indexOf(f) < 0) flags.push(f);
      });
    });
    if (/δαφν|\bbay\b/.test(k)) flags = flags.filter(function (f) { return f !== "gluten" && f !== "carb"; });   // "φύλλα δάφνης" ≠ φύλλο κρούστας
    return { aisle: aisle || "other", flags: flags.sort() };
  }

  // ---------- 7. Diets ----------
  var DIET_FORBIDS = {
    vegan:   ["meat", "fish", "shell", "dairy", "egg", "honey"],
    veg:     ["meat", "fish", "shell"],
    pesc:    ["meat"],
    raw:     [],
    keto:    ["carb", "gluten"],
    lowcarb: ["carb", "gluten"],
    gf:      ["gluten"],
    lf:      ["dairy"],
    nut:     ["nut"],
    fast:    ["meat", "fish", "dairy", "egg"]          // Orthodox fasting: shellfish and octopus are allowed
  };
  // For each diet the recipe claims: the ingredients that seem to break it.
  function dietWarnings(rec) {
    var out = [];
    (rec.dt || []).forEach(function (d) {
      var bad = [];
      if (d === "raw" && rec.ct > 0) bad.push("*cooked");
      (rec.ig || []).forEach(function (ing) {
        var f = lookup(ing.n).flags;
        if (DIET_FORBIDS[d].some(function (x) { return f.indexOf(x) >= 0; }) && bad.indexOf(ing.n) < 0) bad.push(ing.n);
      });
      if (bad.length) out.push({ d: d, ings: bad });
    });
    return out;
  }
  // Diets nothing in the ingredients argues against (keto, low-carb and
  // raw need a human: they are never suggested).
  function suggestDiets(rec) {
    var flags = [];
    (rec.ig || []).forEach(function (ing) { lookup(ing.n).flags.forEach(function (f) { if (flags.indexOf(f) < 0) flags.push(f); }); });
    if (!(rec.ig || []).length) return [];
    return DIETS.filter(function (d) {
      if (d === "keto" || d === "lowcarb" || d === "raw") return false;
      return !DIET_FORBIDS[d].some(function (x) { return flags.indexOf(x) >= 0; });
    });
  }
  // A recipe fits the household when it claims every diet of it.
  function fits(rec, dt) {
    return (dt || []).every(function (d) { return (rec.dt || []).indexOf(d) >= 0; });
  }

  // ---------- 8. Dates (calendar days as "YYYY-MM-DD", UTC arithmetic) ----------
  function validYmd(s) {
    var m = typeof s === "string" && s.match(YMD_RE);
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function toUTC(s) { var m = s.match(YMD_RE); return Date.UTC(+m[1], +m[2] - 1, +m[3]); }
  function fromUTC(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + d.getUTCDate()).slice(-2);
  }
  function addDays(s, n) { return fromUTC(toUTC(s) + n * 86400000); }
  function localYmd(date) {
    var d = date || new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function dow(s) { return new Date(toUTC(s)).getUTCDay(); }   // 0 = Sunday
  function weekStartOf(s, ws) {
    var diff = (dow(s) - (ws === 0 ? 0 : 1) + 7) % 7;
    return addDays(s, -diff);
  }
  function weekDays(wk) { var out = []; for (var i = 0; i < 7; i++) out.push(addDays(wk, i)); return out; }
  function compactYmd(s) { return s.replace(/-/g, ""); }
  function expandYmd(c) { return c.slice(0, 4) + "-" + c.slice(4, 6) + "-" + c.slice(6, 8); }

  // ---------- 9. Normalize ----------
  function normIng(x) {
    if (!x || typeof x !== "object") return null;
    var n = clean(x.n, LIM.ingName);
    if (!n) return null;
    var q = (typeof x.q === "number" && isFinite(x.q) && x.q > 0) ? Math.round(Math.min(x.q, 100000) * 1000) / 1000 : null;
    return { q: q, u: UNITS[x.u] ? x.u : "", n: n, x: clean(x.x, LIM.ingNote), g: clean(x.g, LIM.group) };
  }
  function normTags(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (s) {
      var t = clean(s, LIM.tag), k = fold(t);
      if (t && !seen[k] && out.length < LIM.tags) { seen[k] = 1; out.push(t); }
    });
    return out;
  }
  function normSrc(s) {
    s = clean(s, LIM.src);
    return s;
  }
  // The recipe as stored: fixed key order (R26).
  function normRecipe(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !isInt(x.m) || x.m < 0) return null;
    var t = clean(x.t, LIM.title);
    if (!t) return null;
    var ig = [], st = [];
    (Array.isArray(x.ig) ? x.ig : []).forEach(function (i) { var v = normIng(i); if (v && ig.length < LIM.ings) ig.push(v); });
    (Array.isArray(x.st) ? x.st : []).forEach(function (s) { var v = clean(s, LIM.step); if (v && st.length < LIM.steps) st.push(v); });
    var dt = DIETS.filter(function (d) { return Array.isArray(x.dt) && x.dt.indexOf(d) >= 0; });
    return {
      id: x.id, m: x.m, t: t,
      e: clean(x.e, LIM.emoji),
      c: COURSES.indexOf(x.c) >= 0 ? x.c : "",
      sv: clampInt(x.sv, 1, LIM.servings, 4),
      pt: clampInt(x.pt, 0, LIM.minutes, 0),
      ct: clampInt(x.ct, 0, LIM.minutes, 0),
      dt: dt, tg: normTags(x.tg), ig: ig, st: st,
      no: cleanBlock(x.no, LIM.notes),
      src: normSrc(x.src),
      fv: x.fv === 1 ? 1 : 0
    };
  }
  var CELL_RE = /^(\d{4}-\d{2}-\d{2})\|([a-z])$/;
  function normCellKey(k) {
    var m = typeof k === "string" && k.match(CELL_RE);
    return !!(m && validYmd(m[1]) && SLOT_IDS.indexOf(m[2]) >= 0);
  }
  function normCell(x) {
    if (!x || typeof x !== "object" || !isInt(x.m) || x.m < 0) return null;
    var it = [];
    (Array.isArray(x.it) ? x.it : []).forEach(function (i) {
      if (!i || typeof i !== "object" || it.length >= LIM.cellItems) return;
      if (typeof i.r === "string" && ID_RE.test(i.r)) it.push({ r: i.r, sv: clampInt(i.sv, 1, LIM.servings, 1) });
      else { var tx = clean(i.t, LIM.cellText); if (tx) it.push({ t: tx }); }
    });
    return { m: x.m, it: it };
  }
  function normFlag(x, field, ok) {
    if (!x || typeof x !== "object" || !isInt(x.m) || x.m < 0) return null;
    var v = x[field];
    if (!ok(v)) return null;
    var o = {}; o[field] = v; o.m = x.m;
    return o;
  }
  function normPantry(x) {
    var o = normFlag(x, "v", isBit);
    if (!o) return null;
    var n = clean(x.n, LIM.ingName);
    return n ? { v: o.v, m: o.m, n: n } : o;
  }
  function isBit(v) { return v === 0 || v === 1; }
  function isAisle(v) { return AISLES.indexOf(v) >= 0; }
  var CK_RE = /^(\d{4}-\d{2}-\d{2})\|(.+)$/;
  function normCkKey(k) {
    var m = typeof k === "string" && k.match(CK_RE);
    return !!(m && validYmd(m[1]) && m[2].length <= LIM.key && m[2] === clean(m[2], LIM.key));
  }
  function normIngKey(k) { return typeof k === "string" && k.length > 0 && k.length <= LIM.key && k === clean(k, LIM.key); }
  function normManual(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !isInt(x.m) || x.m < 0) return null;
    var mm = x.id.match(MAN_RE);
    if (!mm || !validYmd(x.w) || compactYmd(x.w) !== mm[1]) return null;
    var t = clean(x.t, LIM.manual);
    if (!t) return null;
    return { id: x.id, m: x.m, w: x.w, t: t, d: x.d === 1 ? 1 : 0 };
  }
  function defaultSet() { return { m: 0, dt: [], sl: ["b", "l", "d"], nm: {}, ws: 1 }; }
  function normSet(x) {
    if (!x || typeof x !== "object" || !isInt(x.m) || x.m < 0) return defaultSet();
    var sl = SLOT_IDS.filter(function (s) { return Array.isArray(x.sl) && x.sl.indexOf(s) >= 0; });
    // order as the user set it
    if (Array.isArray(x.sl)) {
      var ord = [];
      x.sl.forEach(function (s) { if (sl.indexOf(s) >= 0 && ord.indexOf(s) < 0) ord.push(s); });
      sl = ord;
    }
    if (!sl.length) sl = ["b", "l", "d"];
    var nm = {};
    if (x.nm && typeof x.nm === "object") {
      SLOT_IDS.forEach(function (s) { var v = clean(x.nm[s], LIM.slotName); if (v) nm[s] = v; });
    }
    return {
      m: x.m,
      dt: DIETS.filter(function (d) { return Array.isArray(x.dt) && x.dt.indexOf(d) >= 0; }),
      sl: sl, nm: nm, ws: x.ws === 0 ? 0 : 1
    };
  }
  function emptyData() {
    return { ver: DATA_VER, rc: [], pl: {}, ck: {}, mn: [], ai: {}, pn: {}, set: defaultSet(), tombs: {} };
  }

  // ---------- 10. Merge ----------
  // Recipes and manual items: LWW per id (newer m; equal m: the larger
  // canonical JSON), tombstones max-merged, a tomb at or after m wins
  // (R17). Plan cells, ticks, aisle and pantry choices: LWW per key; a
  // cleared cell or an un-ticked box is a NEWER entry, never a removal,
  // so two phones in the shop lose nothing. Settings: LWW as a whole.
  // Old days go by one rule everywhere (also inside the merge): plan
  // days, ticks and manual items more than KEEP_DAYS before the NEWEST
  // day in the data. The newest day itself never goes, so the rule
  // gives the same result in any merge order. Recipe tombstones stay
  // (a deleted ready recipe must stay deleted: SS-3).
  function pick(cur, x) {
    if (!cur) return x;
    if (x.m !== cur.m) return x.m > cur.m ? x : cur;
    return JSON.stringify(x) > JSON.stringify(cur) ? x : cur;
  }
  function mergeMeals(A, B) {
    var a = (A && typeof A === "object") ? A : {}, b = (B && typeof B === "object") ? B : {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!(ID_RE.test(id) || MAN_RE.test(id)) || !isInt(tm[id]) || tm[id] < 0) return;
        if (MAN_RE.test(id) && !validYmd(expandYmd(id.match(MAN_RE)[1]))) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var rc = {}, mn = {}, pl = {}, ck = {}, ai = {}, pn = {};
    [a, b].forEach(function (s) {
      if (Array.isArray(s.rc)) s.rc.forEach(function (r) { var x = normRecipe(r); if (x) rc[x.id] = pick(rc[x.id], x); });
      if (Array.isArray(s.mn)) s.mn.forEach(function (r) { var x = normManual(r); if (x) mn[x.id] = pick(mn[x.id], x); });
      if (s.pl && typeof s.pl === "object") Object.keys(s.pl).forEach(function (k) {
        if (!normCellKey(k)) return; var x = normCell(s.pl[k]); if (x) pl[k] = pick(pl[k], x);
      });
      if (s.ck && typeof s.ck === "object") Object.keys(s.ck).forEach(function (k) {
        if (!normCkKey(k)) return; var x = normFlag(s.ck[k], "v", isBit); if (x) ck[k] = pick(ck[k], x);
      });
      if (s.ai && typeof s.ai === "object") Object.keys(s.ai).forEach(function (k) {
        if (!normIngKey(k)) return; var x = normFlag(s.ai[k], "a", isAisle); if (x) ai[k] = pick(ai[k], x);
      });
      if (s.pn && typeof s.pn === "object") Object.keys(s.pn).forEach(function (k) {
        if (!normIngKey(k)) return; var x = normPantry(s.pn[k]); if (x) pn[k] = pick(pn[k], x);
      });
    });
    var sa = normSet(a.set), sb = normSet(b.set);
    var set = pick(sa, sb);

    // The newest day in the data, and the cut-off.
    var ref = "";
    Object.keys(pl).forEach(function (k) { var d = k.slice(0, 10); if (d > ref) ref = d; });
    Object.keys(ck).forEach(function (k) { var d = k.slice(0, 10); if (d > ref) ref = d; });
    Object.keys(mn).forEach(function (id) { if (mn[id].w > ref) ref = mn[id].w; });
    Object.keys(tombs).forEach(function (id) {
      var mm = id.match(MAN_RE); if (mm) { var d = expandYmd(mm[1]); if (d > ref) ref = d; }
    });
    var cut = ref ? addDays(ref, -KEEP_DAYS) : "";
    function old(d) { return cut && d < cut; }

    var outRc = [];
    Object.keys(rc).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= rc[id].m) return;
      outRc.push(rc[id]);
    });
    var outMn = [];
    Object.keys(mn).sort(cmpStr).forEach(function (id) {
      if (old(mn[id].w) || (id in tombs && tombs[id] >= mn[id].m)) return;
      outMn.push(mn[id]);
    });
    var outPl = {}, outCk = {}, outTombs = {};
    Object.keys(pl).sort(cmpStr).forEach(function (k) { if (!old(k.slice(0, 10))) outPl[k] = pl[k]; });
    Object.keys(ck).sort(cmpStr).forEach(function (k) { if (!old(k.slice(0, 10))) outCk[k] = ck[k]; });
    Object.keys(tombs).sort(cmpStr).forEach(function (id) {
      var mm = id.match(MAN_RE);
      if (mm && old(expandYmd(mm[1]))) return;
      outTombs[id] = tombs[id];
    });
    return {
      ver: DATA_VER, rc: outRc, pl: outPl, ck: outCk, mn: outMn,
      ai: sortedObj(ai), pn: sortedObj(pn), set: set, tombs: outTombs
    };
  }

  // ---------- 11. Shopping list ----------
  // Computed from the plan, never stored. Only ticks, manual items and
  // the aisle / pantry choices are data.
  var PANTRY_PAIRS = [["salt", "αλάτι"], ["pepper", "πιπέρι"], ["water", "νερό"]];
  // The two keys of a pair act as one: the newest choice on either wins.
  var PAIR_OF = {};
  PANTRY_PAIRS.forEach(function (p) {
    var keys = [keyOf(p[0]), keyOf(p[1])];
    keys.forEach(function (k) { PAIR_OF[k] = keys; });
  });
  function inPantry(data, k) {
    var keys = PAIR_OF[k] || [k], best = null;
    keys.forEach(function (x) {
      var o = data.pn && data.pn[x];
      if (o && (!best || o.m > best.m || (o.m === best.m && o.v < best.v))) best = o;
    });
    if (best) return best.v === 1;
    return !!PAIR_OF[k];
  }
  // What the settings show: [{ keys, name }]. A ready pair (salt / αλάτι)
  // is one entry in the app's language; the user's own keep their name.
  function pantryList(data, lang) {
    var out = [], seen = {};
    PANTRY_PAIRS.forEach(function (p) {
      var keys = [keyOf(p[0]), keyOf(p[1])];
      keys.forEach(function (k) { seen[k] = 1; });
      if (inPantry(data, keys[0])) out.push({ keys: keys, name: p[lang === "el" ? 1 : 0] });
    });
    Object.keys(data.pn || {}).sort(cmpStr).forEach(function (k) {
      if (seen[k] || !inPantry(data, k)) return;
      out.push({ keys: [k], name: data.pn[k].n || k });
    });
    return out;
  }
  function aisleOf(data, k, name) {
    var o = data.ai && data.ai[k];
    return o ? o.a : lookup(name).aisle;
  }
  function fmtAmounts(am, lang) {
    var parts = [];
    if (am.mass) parts.push(am.mass >= 1000 ? fmtQty(am.mass / 1000, lang) + " " + unitLabel("kg", am.mass / 1000, lang)
                                            : fmtQty(am.mass, lang, true) + " " + unitLabel("g", am.mass, lang));
    if (am.vol) parts.push(am.vol >= 1000 ? fmtQty(am.vol / 1000, lang) + " " + unitLabel("l", am.vol / 1000, lang)
                                          : fmtQty(am.vol, lang, true) + " " + unitLabel("ml", am.vol, lang));
    if (am.spoon) {
      var u = am.spoon >= 48 ? "cup" : (am.spoon >= 3 ? "tbsp" : "tsp");
      var q = am.spoon / UNITS[u].f;
      parts.push(fmtQty(q, lang) + " " + unitLabel(u, q, lang));
    }
    Object.keys(am.u).sort(cmpStr).forEach(function (u) {
      var q = am.u[u], lab = unitLabel(u, q, lang);
      parts.push(fmtQty(q, lang) + (lab ? " " + lab : ""));
    });
    return parts.join(" + ");
  }
  // getRecipe(id) → recipe or null (seeds included). from: first day to
  // count ("from today on"), or null for the whole week.
  function buildShop(data, getRecipe, wk, from, lang) {
    var days = weekDays(wk).filter(function (d) { return !from || d >= from; });
    var map = {}, excluded = {};
    days.forEach(function (d) {
      SLOT_IDS.forEach(function (s) {
        var cell = data.pl[d + "|" + s];
        if (!cell) return;
        cell.it.forEach(function (item) {
          if (!item.r) return;
          var rec = getRecipe(item.r);
          if (!rec) return;
          var factor = item.sv / rec.sv;
          rec.ig.forEach(function (ing) {
            var k = keyOf(ing.n);
            if (!k) return;
            if (inPantry(data, k)) { excluded[k] = excluded[k] || ing.n; return; }
            var e = map[k] || (map[k] = { key: k, name: ing.n, am: { mass: 0, vol: 0, spoon: 0, u: {} }, any: false, from: [] });
            if (e.from.indexOf(rec.t) < 0) e.from.push(rec.t);
            if (ing.q === null) return;
            e.any = true;
            var q = ing.q * factor, U = UNITS[ing.u];
            if (U && U.fam) e.am[U.fam] += q * U.f;
            else { var u = ing.u || "pc"; e.am.u[u] = (e.am.u[u] || 0) + q; }
          });
        });
      });
    });
    var items = Object.keys(map).map(function (k) {
      var e = map[k], c = data.ck[wk + "|" + k];
      return { key: k, name: e.name, qty: e.any ? fmtAmounts(e.am, lang) : "", from: e.from,
               aisle: aisleOf(data, k, e.name), done: !!(c && c.v === 1), manual: false };
    });
    (data.mn || []).forEach(function (x) {
      if (x.w !== wk) return;
      items.push({ key: x.id, name: x.t, qty: "", from: [], aisle: aisleOf(data, keyOf(x.t), x.t), done: x.d === 1, manual: true });
    });
    items.sort(function (x, y) {
      return (AISLES.indexOf(x.aisle) - AISLES.indexOf(y.aisle)) ||
             fold(x.name).localeCompare(fold(y.name), lang === "el" ? "el" : "en") || cmpStr(x.key, y.key);
    });
    var ex = Object.keys(excluded).sort(cmpStr).map(function (k) { return { key: k, name: excluded[k] }; });
    return { items: items, excluded: ex, days: days };
  }
  function shopText(list, aisleName, lang) {
    var out = [], a = null;
    list.items.forEach(function (it) {
      if (it.aisle !== a) { a = it.aisle; if (out.length) out.push(""); out.push(aisleName(a) + ":"); }
      out.push((it.done ? "☑ " : "☐ ") + (it.qty ? it.qty + " " : "") + it.name);
    });
    return out.join("\n");
  }

  // ---------- 12. Ready recipes ----------
  // Shown from here in the app's language and stored only once the user
  // changes one (R28): an EN and an EL device never fight over them
  // (SS-2). Ids never change.
  var SEEDS = [
    { id: "s-fasolada", e: "🫘", c: "soup", sv: 4, pt: 15, ct: 90, dt: ["vegan", "veg", "pesc", "gf", "lf", "nut", "fast"],
      en: { t: "Fasolada (bean soup)", tg: ["Greek"],
            ig: "500 g dried white beans, soaked overnight\n2 carrots, sliced\n2 celery stalks, chopped\n1 onion, chopped\n2 tbsp tomato paste\n120 ml olive oil\nsalt\npepper",
            st: ["Drain the beans, cover with fresh water and boil for 5 minutes. Drain again.",
                 "Put the beans back with 2 litres of water, the onion, carrots and celery. Simmer for 60 minutes.",
                 "Stir in the tomato paste and the olive oil, season and cook for 25 minutes more, until the beans are soft."] },
      el: { t: "Φασολάδα", tg: ["Ελληνική"],
            ig: "500 γρ. ξερά φασόλια, μουλιασμένα από το βράδυ\n2 καρότα, σε ροδέλες\n2 κλωνάρια σέλινο, ψιλοκομμένα\n1 κρεμμύδι, ψιλοκομμένο\n2 κ.σ. πελτές ντομάτας\n120 ml ελαιόλαδο\nαλάτι\nπιπέρι",
            st: ["Στραγγίζουμε τα φασόλια, τα σκεπάζουμε με νερό και τα βράζουμε 5 λεπτά. Τα ξαναστραγγίζουμε.",
                 "Τα βάζουμε πάλι στην κατσαρόλα με 2 λίτρα νερό, το κρεμμύδι, τα καρότα και το σέλινο. Σιγοβράζουμε 60 λεπτά.",
                 "Προσθέτουμε τον πελτέ και το ελαιόλαδο, αλατοπιπερώνουμε και βράζουμε άλλα 25 λεπτά, μέχρι να μαλακώσουν."] } },
    { id: "s-gemista", e: "🫑", c: "main", sv: 4, pt: 30, ct: 75, dt: ["vegan", "veg", "pesc", "gf", "lf", "nut", "fast"],
      en: { t: "Gemista (stuffed vegetables)", tg: ["Greek", "Oven"],
            ig: "4 tomatoes\n4 green peppers\n200 g rice\n1 onion, grated\n1 bunch parsley, chopped\n1 bunch mint, chopped\n3 potatoes, in wedges\n150 ml olive oil\nsalt\npepper",
            st: ["Cut a lid off the tomatoes and peppers and scoop out the tomato flesh. Blend the flesh.",
                 "Mix the rice, onion, herbs, half the oil, the tomato flesh, salt and pepper.",
                 "Fill the vegetables, put the lids back and place them in a baking dish with the potatoes around them.",
                 "Pour over the rest of the oil and a glass of water. Bake at 180 °C for 75 minutes."] },
      el: { t: "Γεμιστά", tg: ["Ελληνική", "Φούρνος"],
            ig: "4 ντομάτες\n4 πράσινες πιπεριές\n200 γρ. ρύζι\n1 κρεμμύδι, τριμμένο\n1 ματσάκι μαϊντανός, ψιλοκομμένος\n1 ματσάκι δυόσμος, ψιλοκομμένος\n3 πατάτες, σε κυδωνάτες\n150 ml ελαιόλαδο\nαλάτι\nπιπέρι",
            st: ["Κόβουμε καπάκι στις ντομάτες και στις πιπεριές και αδειάζουμε τη σάρκα των ντοματών. Τη χτυπάμε στο μπλέντερ.",
                 "Ανακατεύουμε το ρύζι, το κρεμμύδι, τα μυρωδικά, το μισό λάδι, τη σάρκα, αλάτι και πιπέρι.",
                 "Γεμίζουμε τα λαχανικά, τα σκεπάζουμε με τα καπάκια και τα βάζουμε σε ταψί με τις πατάτες γύρω.",
                 "Περιχύνουμε με το υπόλοιπο λάδι και ένα ποτήρι νερό. Ψήνουμε στους 180 °C για 75 λεπτά."] } },
    { id: "s-bolognese", e: "🍝", c: "main", sv: 4, pt: 10, ct: 40, dt: ["nut"],
      en: { t: "Spaghetti bolognese", tg: ["Quick"],
            ig: "500 g spaghetti\n500 g minced beef\n1 onion, chopped\n2 cloves garlic, chopped\n1 can chopped tomatoes\n2 tbsp olive oil\n1 bay leaf\n50 g grated parmesan\nsalt\npepper",
            st: ["Heat the oil and soften the onion and garlic for 5 minutes.",
                 "Add the mince and brown it, breaking it up.",
                 "Add the tomatoes, the bay leaf, salt and pepper. Simmer for 30 minutes.",
                 "Boil the spaghetti in salted water as the packet says and serve with the sauce and the cheese."] },
      el: { t: "Μακαρόνια με κιμά", tg: ["Γρήγορο"],
            ig: "500 γρ. σπαγγέτι\n500 γρ. κιμάς μοσχαρίσιος\n1 κρεμμύδι, ψιλοκομμένο\n2 σκελίδες σκόρδο, ψιλοκομμένες\n1 κονσέρβα ντομάτα κονκασέ\n2 κ.σ. ελαιόλαδο\n1 φύλλο δάφνης\n50 γρ. τριμμένο κεφαλοτύρι\nαλάτι\nπιπέρι",
            st: ["Ζεσταίνουμε το λάδι και σοτάρουμε το κρεμμύδι και το σκόρδο για 5 λεπτά.",
                 "Ρίχνουμε τον κιμά και τον σοτάρουμε μέχρι να ροδίσει, σπάζοντάς τον.",
                 "Προσθέτουμε την ντομάτα, τη δάφνη, αλάτι και πιπέρι. Σιγοβράζουμε 30 λεπτά.",
                 "Βράζουμε τα μακαρόνια σε αλατισμένο νερό όπως γράφει η συσκευασία και σερβίρουμε με τη σάλτσα και το τυρί."] } },
    { id: "s-horiatiki", e: "🥗", c: "salad", sv: 2, pt: 15, ct: 0, dt: ["veg", "pesc", "gf", "keto", "lowcarb", "nut"],
      en: { t: "Greek salad (horiatiki)", tg: ["Greek", "No cooking"],
            ig: "3 tomatoes, in wedges\n1 cucumber, sliced\n1 red onion, in rings\n1 green pepper, in rings\n10 olives\n200 g feta\n1 tsp oregano\n4 tbsp olive oil\nsalt",
            st: ["Put the tomatoes, cucumber, onion and pepper in a bowl and salt them lightly.",
                 "Add the olives and the feta in one piece on top.",
                 "Sprinkle with oregano and pour the olive oil over."] },
      el: { t: "Χωριάτικη σαλάτα", tg: ["Ελληνική", "Χωρίς μαγείρεμα"],
            ig: "3 ντομάτες, σε κομμάτια\n1 αγγούρι, σε ροδέλες\n1 κόκκινο κρεμμύδι, σε ροδέλες\n1 πράσινη πιπεριά, σε ροδέλες\n10 ελιές\n200 γρ. φέτα\n1 κ.γ. ρίγανη\n4 κ.σ. ελαιόλαδο\nαλάτι",
            st: ["Βάζουμε σε μπολ τις ντομάτες, το αγγούρι, το κρεμμύδι και την πιπεριά και τα αλατίζουμε ελαφρά.",
                 "Προσθέτουμε τις ελιές και από πάνω τη φέτα ολόκληρη.",
                 "Πασπαλίζουμε με ρίγανη και περιχύνουμε με το ελαιόλαδο."] } },
    { id: "s-omelette", e: "🍳", c: "breakfast", sv: 1, pt: 5, ct: 5, dt: ["veg", "pesc", "gf", "keto", "lowcarb", "nut"],
      en: { t: "Cheese omelette", tg: ["Quick"],
            ig: "3 eggs\n2 tbsp milk\n1 tbsp butter\n30 g grated cheese\nsalt\npepper",
            st: ["Beat the eggs with the milk, salt and pepper.",
                 "Melt the butter in a pan over medium heat and pour in the eggs.",
                 "When the edges set, add the cheese, fold in half and cook for 1 minute more."] },
      el: { t: "Ομελέτα με τυρί", tg: ["Γρήγορο"],
            ig: "3 αυγά\n2 κ.σ. γάλα\n1 κ.σ. βούτυρο\n30 γρ. τριμμένο τυρί\nαλάτι\nπιπέρι",
            st: ["Χτυπάμε τα αυγά με το γάλα, αλάτι και πιπέρι.",
                 "Λιώνουμε το βούτυρο σε τηγάνι σε μέτρια φωτιά και ρίχνουμε τα αυγά.",
                 "Όταν πήξουν οι άκρες, βάζουμε το τυρί, διπλώνουμε στη μέση και ψήνουμε άλλο 1 λεπτό."] } },
    { id: "s-fakes", e: "🍲", c: "soup", sv: 4, pt: 10, ct: 50, dt: ["vegan", "veg", "pesc", "gf", "lf", "nut", "fast"],
      en: { t: "Lentil soup (fakes)", tg: ["Greek"],
            ig: "500 g brown lentils\n1 onion, chopped\n3 cloves garlic\n2 bay leaves\n1 tbsp tomato paste\n100 ml olive oil\n2 tbsp vinegar\nsalt\npepper",
            st: ["Rinse the lentils, cover with water, boil for 5 minutes and drain.",
                 "Add 1.5 litres of water, the onion, garlic and bay leaves. Simmer for 30 minutes.",
                 "Stir in the tomato paste and the olive oil, season and cook for 15 minutes more.",
                 "Add the vinegar at the end, off the heat."] },
      el: { t: "Φακές σούπα", tg: ["Ελληνική"],
            ig: "500 γρ. φακές ψιλές\n1 κρεμμύδι, ψιλοκομμένο\n3 σκελίδες σκόρδο\n2 φύλλα δάφνης\n1 κ.σ. πελτές ντομάτας\n100 ml ελαιόλαδο\n2 κ.σ. ξίδι\nαλάτι\nπιπέρι",
            st: ["Ξεπλένουμε τις φακές, τις σκεπάζουμε με νερό, τις βράζουμε 5 λεπτά και τις στραγγίζουμε.",
                 "Προσθέτουμε 1,5 λίτρο νερό, το κρεμμύδι, το σκόρδο και τη δάφνη. Σιγοβράζουμε 30 λεπτά.",
                 "Ρίχνουμε τον πελτέ και το ελαιόλαδο, αλατοπιπερώνουμε και βράζουμε άλλα 15 λεπτά.",
                 "Στο τέλος, εκτός φωτιάς, προσθέτουμε το ξίδι."] } },
    { id: "s-lemon-chicken", e: "🍗", c: "main", sv: 4, pt: 15, ct: 75, dt: ["gf", "lf", "nut"],
      en: { t: "Lemon chicken with potatoes", tg: ["Oven"],
            ig: "1.5 kg chicken, in pieces\n1 kg potatoes, in wedges\n2 lemons, juiced\n100 ml olive oil\n3 cloves garlic\n1 tsp oregano\n200 ml water\nsalt\npepper",
            st: ["Put the chicken and potatoes in a baking dish.",
                 "Whisk the lemon juice, oil, garlic, oregano, salt and pepper and pour over.",
                 "Add the water and bake at 200 °C for 75 minutes, turning once."] },
      el: { t: "Κοτόπουλο λεμονάτο με πατάτες", tg: ["Φούρνος"],
            ig: "1,5 κιλό κοτόπουλο, σε μερίδες\n1 κιλό πατάτες, σε κυδωνάτες\n2 λεμόνια, ο χυμός τους\n100 ml ελαιόλαδο\n3 σκελίδες σκόρδο\n1 κ.γ. ρίγανη\n200 ml νερό\nαλάτι\nπιπέρι",
            st: ["Βάζουμε το κοτόπουλο και τις πατάτες σε ταψί.",
                 "Χτυπάμε τον χυμό λεμονιού, το λάδι, το σκόρδο, τη ρίγανη, αλάτι και πιπέρι και περιχύνουμε.",
                 "Προσθέτουμε το νερό και ψήνουμε στους 200 °C για 75 λεπτά, γυρίζοντας μία φορά."] } },
    { id: "s-yogurt-honey", e: "🍯", c: "dessert", sv: 1, pt: 3, ct: 0, dt: ["veg", "pesc", "gf"],
      en: { t: "Yogurt with honey and walnuts", tg: ["Quick", "No cooking"],
            ig: "200 g Greek yogurt\n2 tbsp honey\n30 g walnuts, chopped",
            st: ["Put the yogurt in a bowl, pour the honey over and sprinkle with the walnuts."] },
      el: { t: "Γιαούρτι με μέλι και καρύδια", tg: ["Γρήγορο", "Χωρίς μαγείρεμα"],
            ig: "200 γρ. στραγγιστό γιαούρτι\n2 κ.σ. μέλι\n30 γρ. καρύδια, χοντροκομμένα",
            st: ["Βάζουμε το γιαούρτι σε μπολ, το περιχύνουμε με το μέλι και πασπαλίζουμε με τα καρύδια."] } }
  ];
  var SEED_IDS = SEEDS.map(function (s) { return s.id; });
  // A ready recipe in the given language, as a recipe with m = 0.
  function seedRecipe(id, lang) {
    for (var i = 0; i < SEEDS.length; i++) {
      var s = SEEDS[i];
      if (s.id !== id) continue;
      var L = s[lang === "el" ? "el" : "en"];
      return normRecipe({ id: s.id, m: 0, t: L.t, e: s.e, c: s.c, sv: s.sv, pt: s.pt, ct: s.ct, dt: s.dt,
                          tg: L.tg, ig: textToIngs(L.ig), st: L.st, no: "", src: "", fv: 0 });
    }
    return null;
  }

  // Every recipe the user sees: stored ones + ready ones not stored and
  // not deleted. Sorted by title in the language.
  function allRecipes(data, lang) {
    var have = {}, out = [];
    data.rc.forEach(function (r) { have[r.id] = 1; out.push(r); });
    SEED_IDS.forEach(function (id) {
      if (have[id] || (data.tombs && id in data.tombs)) return;
      out.push(seedRecipe(id, lang));
    });
    return out;
  }

  // Minutes mentioned in a step ("20 minutes", "1 ώρα", "1½ hours") → timers.
  function stepTimers(step) {
    var f = fold(step), out = [];
    var re = /(\d+(?:[.,]\d+)?½?|½|μιση|μισο)\s*(?:-\s*\d+\s*)?(λεπτ\S*|min\S*|ωρ\S*|hours?|hrs?)/g, m;
    while ((m = re.exec(f)) && out.length < 4) {
      var n = m[1] === "μιση" || m[1] === "μισο" ? 0.5 : parseQty(m[1]);
      if (n === null) continue;
      var mins = /^(ωρ|hour|hr)/.test(m[2]) ? n * 60 : n;
      mins = Math.round(mins);
      if (mins > 0 && mins <= 24 * 60 && out.indexOf(mins) < 0) out.push(mins);
    }
    return out;
  }

  root.OrosMealsCore = {
    VER: VER, DATA_VER: DATA_VER, LIM: LIM, ID_RE: ID_RE, MAN_RE: MAN_RE,
    SLOT_IDS: SLOT_IDS, COURSES: COURSES, DIETS: DIETS, AISLES: AISLES, UNITS: UNITS, UNIT_IDS: UNIT_IDS,
    DIET_FORBIDS: DIET_FORBIDS, SEED_IDS: SEED_IDS, KEEP_DAYS: KEEP_DAYS,
    clean: clean, cleanBlock: cleanBlock, fold: fold, keyOf: keyOf,
    parseQty: parseQty, fmtQty: fmtQty, unitLabel: unitLabel,
    parseIngLine: parseIngLine, ingToLine: ingToLine, fmtIngQty: fmtIngQty, ingsToText: ingsToText,
    textToIngs: textToIngs, textToSteps: textToSteps, parseRecipeText: parseRecipeText,
    lookup: lookup, dietWarnings: dietWarnings, suggestDiets: suggestDiets, fits: fits,
    validYmd: validYmd, addDays: addDays, localYmd: localYmd, dow: dow, weekStartOf: weekStartOf, weekDays: weekDays,
    compactYmd: compactYmd,
    normRecipe: normRecipe, normCell: normCell, normSet: normSet, defaultSet: defaultSet, emptyData: emptyData,
    mergeMeals: mergeMeals,
    inPantry: inPantry, pantryList: pantryList, buildShop: buildShop, shopText: shopText,
    seedRecipe: seedRecipe, allRecipes: allRecipes, stepTimers: stepTimers
  };
})(typeof window !== "undefined" ? window : this);
