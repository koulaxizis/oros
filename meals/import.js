// ============================================================
// orOS Meal Planner — import.js (pure logic, wave 2)
// Recipes from elsewhere, read as DATA only:
//   - a web page: the schema.org Recipe in its JSON-LD
//     (<script type="application/ld+json">), also inside @graph,
//     arrays and nested nodes; HowToSection / HowToStep; ISO 8601
//     durations; recipeYield; the picture's address kept as a link
//   - Paprika (.paprikarecipes = a ZIP of gzipped JSON, or one
//     .paprikarecipe), Mealie and Tandoor JSON (also their ZIPs)
//   - wave 6: Mela (.melarecipe JSON, .melarecipes ZIP), Recipe Keeper
//     (ZIP with recipes.html, schema.org microdata), Nextcloud Cookbook
//     (ZIP of folders with recipe.json: the schema.org path), Cooklang
//     (.cook text or a ZIP of them), Crouton (.crumb JSON or a ZIP),
//     MyCookbook (.mcb = ZIP with a <cookbook> XML)
// Nothing from a page is ever run or put into the document: the HTML
// is parsed by DOMParser into an inert document (scripts never run
// there) and only the text of the ld+json scripts is read; without
// DOMParser (Node tests) a plain text scan does the same. Every
// string is cleaned to plain text (tags dropped, entities decoded).
// A draft is { t, e, c, sv, pt, ct, dt, tg, ig, st, no, src, img }
// with ig already parsed (OrosMealsCore.parseIngLine): the editor
// shows it and nothing is saved without the user.
// Needs OrosMealsCore (core.js). ZIP files need AtelierZip
// (../atelier/zip.js), passed in. Exposes window.OrosMealsImport.
// Sections:
//   1. Text: entities, tags, times, yield
//   2. JSON-LD: blocks in a page, Recipe nodes
//   3. Drafts: schema.org, Paprika, Mealie, Tandoor
//   4. Wave 6 sources: Mela, Crouton, Recipe Keeper, MyCookbook,
//      Cooklang; stable ids for a batch
//   5. Detect + read (text, files, ZIP, gzip)
// Every draft also says where it came from in `fmt` (a FORMATS key);
// normRecipe drops it when a recipe is stored.
// ============================================================
(function (root) {
  "use strict";

  var C = root.OrosMealsCore;
  var MAX_TEXT = 6 * 1024 * 1024;       // one page / JSON file, characters
  var MAX_FILE = 40 * 1024 * 1024;      // a ZIP or gzip as given
  var MAX_ENTRY = 8 * 1024 * 1024;      // one inflated entry
  var MAX_RECIPES = 500;
  var MAX_DEPTH = 12;

  // ---------- 1. Text ----------
  var NAMED = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
    deg: "°", frac12: "½", frac14: "¼", frac34: "¾", frac13: "⅓", frac23: "⅔", frac18: "⅛",
    rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", laquo: "«", raquo: "»", times: "×", eacute: "é",
    egrave: "è", agrave: "à", ccedil: "ç", uuml: "ü", ouml: "ö", auml: "ä", ntilde: "ñ", reg: "®", copy: "©", trade: "™"
  };
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, function (m0, e) {
      if (e.charAt(0) === "#") {
        var n = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return "";
        return String.fromCodePoint(n);
      }
      var v = NAMED[e.toLowerCase()];
      return v === undefined ? m0 : v;
    });
  }
  // Any value → plain text: tags out (<br>, </p>, </li> become line
  // breaks), entities decoded twice at most (some sites double-encode).
  function txt(v, keepLines) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number" && isFinite(v)) return String(v);
    if (typeof v !== "string") return "";
    var s = v.length > 200000 ? v.slice(0, 200000) : v;
    for (var i = 0; i < 2 && /&[#a-z0-9]+;|<\/?[a-z]/i.test(s); i++) {
      s = s.replace(/<\s*(br|\/p|\/li|\/div|\/h\d)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, "");
      s = decodeEntities(s);
    }
    s = s.replace(/ /g, " ");
    if (keepLines) return s.replace(/\r\n?/g, "\n").split("\n").map(function (l) { return l.replace(/\s+/g, " ").trim(); }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return s.replace(/\s+/g, " ").trim();
  }
  function first(v) { return Array.isArray(v) ? v[0] : v; }
  function list(v) { return v === null || v === undefined ? [] : (Array.isArray(v) ? v : [v]); }

  // "PT1H30M", "P0DT0H20M", "PT20M", "PT1.5H" → minutes. Plain words
  // too ("1 hour 30 mins", "45 λεπτά", "1:30"). null when unknown.
  function minutes(v) {
    if (typeof v === "number" && isFinite(v) && v >= 0) return Math.round(v);
    var s = txt(first(v)).toLowerCase();
    if (!s) return null;
    var m = s.match(/^p(?:(\d+(?:[.,]\d+)?)d)?(?:t(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+(?:[.,]\d+)?)m)?(?:(\d+(?:[.,]\d+)?)s)?)?$/);
    if (m && (m[1] || m[2] || m[3] || m[4])) {
      var n = function (x) { return x ? Number(x.replace(",", ".")) : 0; };
      return Math.round(n(m[1]) * 1440 + n(m[2]) * 60 + n(m[3]) + n(m[4]) / 60);
    }
    var hm = s.match(/^(\d{1,2}):(\d{2})$/);
    if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
    var f = C.fold(s), total = 0, any = false;
    var h = f.match(/(\d+(?:[.,]\d+)?)\s*(hours?|hrs?|h\b|ωρ)/);
    var mi = f.match(/(\d+)\s*(minutes?|mins?|m\b|λεπτ|′|')/);
    if (h) { total += Number(h[1].replace(",", ".")) * 60; any = true; }
    if (mi) { total += Number(mi[1]); any = true; }
    if (!any && /^\d+$/.test(s)) { total = Number(s); any = true; }
    return any ? Math.round(total) : null;
  }
  // recipeYield / servings: 4, "4", "4 servings", ["4", "4 servings"],
  // "Serves 4-6" (the lower end) → 1…50 or null.
  function servings(v) {
    var vals = list(v);
    for (var i = 0; i < vals.length; i++) {
      var x = vals[i];
      if (typeof x === "number" && isFinite(x) && x >= 1) return Math.min(Math.round(x), C.LIM.servings);
      var m = txt(x).match(/(\d{1,3})/);
      if (m && Number(m[1]) >= 1) return Math.min(Number(m[1]), C.LIM.servings);
    }
    return null;
  }
  function urlOf(v) {
    var vals = list(v);
    for (var i = 0; i < vals.length; i++) {
      var x = vals[i], u = "";
      if (typeof x === "string") u = x;
      else if (x && typeof x === "object") u = typeof x.url === "string" ? x.url : (typeof x["@id"] === "string" ? x["@id"] : (typeof x.contentUrl === "string" ? x.contentUrl : ""));
      u = txt(u);
      if (/^https?:\/\/[^\s<>"']+$/i.test(u) && u.length <= C.LIM.img) return u;
    }
    return "";
  }
  function names(v) {
    var out = [];
    list(v).forEach(function (x) {
      if (typeof x === "string") txt(x).split(/\s*[,;]\s*/).forEach(function (w) { if (w) out.push(w); });
      else if (x && typeof x === "object" && typeof x.name === "string") out.push(txt(x.name));
    });
    return out;
  }

  // Course from a category word (EN / EL).
  var COURSE_WORDS = [
    ["breakfast", /breakfast|brunch|πρωιν/], ["dessert", /dessert|sweet|cake|γλυκ|επιδορπ/], ["soup", /soup|σουπ/],
    ["salad", /salad|σαλατ/], ["side", /side|συνοδευτ/], ["snack", /snack|appetizer|starter|μεζ|ορεκτικ|σνακ/],
    ["drink", /drink|beverage|cocktail|ποτ|ροφημ/], ["main", /main|dinner|lunch|entree|entrée|κυριως/]
  ];
  function courseOf(cats) {
    for (var i = 0; i < cats.length; i++) {
      var f = C.fold(cats[i]);
      for (var j = 0; j < COURSE_WORDS.length; j++) if (COURSE_WORDS[j][1].test(f)) return COURSE_WORDS[j][0];
    }
    return "";
  }
  var DIET_URLS = { VeganDiet: "vegan", VegetarianDiet: "veg", GlutenFreeDiet: "gf", LowLactoseDiet: "lf" };
  function dietsOf(v) {
    var out = [];
    list(v).forEach(function (x) {
      var m = txt(typeof x === "object" && x ? x["@id"] || x.name : x).match(/([A-Za-z]+Diet)$/);
      var d = m && DIET_URLS[m[1]];
      if (d && out.indexOf(d) < 0) out.push(d);
    });
    return out;
  }

  // Ingredient lines → parsed ingredients; "For the sauce:" lines and
  // header objects start a group.
  function ingLines(lines) {
    var out = [], g = "";
    lines.forEach(function (x) {
      var line = typeof x === "string" ? x : (x && x.line) || "";
      if (x && typeof x === "object" && x.group !== undefined) { g = C.clean(x.group, C.LIM.group); return; }
      line = txt(line);
      if (!line || out.length >= C.LIM.ings) return;
      if (/:$/.test(line) && line.length <= 60 && !/^[\d½¼¾⅓⅔⅛]/.test(line)) { g = C.clean(line.slice(0, -1), C.LIM.group); return; }
      var ing = C.parseIngLine(line, g);
      if (ing) out.push(ing);
    });
    return out;
  }
  function stepLines(text) { return C.textToSteps(txt(text, true)); }

  function draft(o) {
    return {
      t: C.clean(o.t || "", C.LIM.title), e: "", c: o.c || "",
      sv: o.sv || 4, pt: o.pt || 0, ct: o.ct || 0,
      dt: o.dt || [], tg: (o.tg || []).slice(0, C.LIM.tags),
      ig: o.ig || [], st: (o.st || []).slice(0, C.LIM.steps),
      no: C.cleanBlock(o.no || "", C.LIM.notes),
      src: C.clean(o.src || "", C.LIM.src), img: C.normImg(o.img || "")
    };
  }
  // prep, cook, total → { pt, ct }: cook = total − prep when only the
  // total is given.
  function times(p, c, tot) {
    var pt = minutes(p), ct = minutes(c), tt = minutes(tot);
    if (ct === null && tt !== null) ct = Math.max(0, tt - (pt || 0));
    var lim = C.LIM.minutes;
    return { pt: Math.min(pt || 0, lim), ct: Math.min(ct || 0, lim) };
  }

  // ---------- 2. JSON-LD ----------
  // The text of every <script type="application/ld+json"> in a page.
  function ldBlocks(html) {
    var out = [];
    if (typeof html !== "string") return out;
    if (html.length > MAX_TEXT) html = html.slice(0, MAX_TEXT);
    if (typeof root.DOMParser === "function") {
      try {
        // An inert document: scripts never run, nothing loads.
        var doc = new root.DOMParser().parseFromString(html, "text/html");
        var nodes = doc.querySelectorAll("script[type]");
        for (var i = 0; i < nodes.length; i++) {
          if (/^\s*application\/ld\+json\s*(;.*)?$/i.test(nodes[i].getAttribute("type") || "")) out.push(nodes[i].textContent || "");
        }
        return out;
      } catch (e) { out = []; }
    }
    var re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, m;
    while ((m = re.exec(html))) {
      if (/type\s*=\s*["']?\s*application\/ld\+json/i.test(m[1])) out.push(m[2]);
    }
    return out;
  }
  function parseJson(s) {
    if (typeof s !== "string") return null;
    s = s.replace(/^﻿/, "").trim().replace(/^<!--/, "").replace(/-->$/, "").trim();
    try { return JSON.parse(s); } catch (e) {}
    try { return JSON.parse(s.replace(/[\u0000-\u001f]+/g, " ")); } catch (e) { return null; }   // raw newlines inside strings
  }
  function isType(node, t) {
    return list(node["@type"]).some(function (x) { return typeof x === "string" && x.replace(/^.*[\/#:]/, "") === t; });
  }
  // Every schema.org Recipe node in a JSON-LD value (arrays, @graph,
  // nested objects such as mainEntity), at most MAX_RECIPES.
  function recipeNodes(v) {
    var out = [], seen = [];
    (function walk(x, depth) {
      if (!x || typeof x !== "object" || depth > MAX_DEPTH || out.length >= MAX_RECIPES || seen.indexOf(x) >= 0) return;
      seen.push(x);
      if (Array.isArray(x)) { x.forEach(function (y) { walk(y, depth + 1); }); return; }
      if (isType(x, "Recipe")) { out.push(x); return; }
      Object.keys(x).forEach(function (k) { if (x[k] && typeof x[k] === "object") walk(x[k], depth + 1); });
    })(v, 0);
    return out;
  }

  // ---------- 3. Drafts ----------
  // recipeInstructions: a string, strings, HowToStep, HowToSection
  // (its name starts the first step of the section), ItemList.
  function instructions(v) {
    var out = [];
    (function walk(x, section, depth) {
      if (depth > MAX_DEPTH || out.length >= C.LIM.steps) return;
      if (typeof x === "string") {
        stepLines(x).forEach(function (s) {
          out.push(section ? section + ": " + s : s);
          section = "";
        });
        return;
      }
      if (Array.isArray(x)) { x.forEach(function (y) { walk(y, section, depth + 1); section = ""; }); return; }
      if (!x || typeof x !== "object") return;
      var items = x.itemListElement || x.steps;
      if (isType(x, "HowToSection") || (items && !x.text)) {
        var nm = txt(x.name);
        walk(list(items), nm, depth + 1);
        return;
      }
      var t = txt(x.text !== undefined ? x.text : (x.description !== undefined ? x.description : x.name), true);
      if (t) walk(t, section, depth + 1);
    })(v, "", 0);
    return out.map(function (s) { return C.clean(s, C.LIM.step); }).filter(Boolean).slice(0, C.LIM.steps);
  }
  function fromSchema(n, pageUrl) {
    var tm = times(n.prepTime, n.cookTime, n.totalTime);
    var ingSrc = list(n.recipeIngredient !== undefined ? n.recipeIngredient : n.ingredients).map(function (x) {
      return typeof x === "string" ? x : mealieIngLine(x);
    });
    var cats = names(n.recipeCategory);
    var tags = names(n.recipeCuisine).concat(names(n.keywords)).filter(function (w) { return w.length <= C.LIM.tag; });
    return draft({
      t: txt(n.name || n.headline), c: courseOf(cats),
      sv: servings(n.recipeYield !== undefined ? n.recipeYield : n.yield),
      pt: tm.pt, ct: tm.ct, dt: dietsOf(n.suitableForDiet),
      tg: tags, ig: ingLines(ingSrc), st: instructions(n.recipeInstructions),
      no: txt(n.description, true),
      src: urlOf(pageUrl) || urlOf(n.url) || urlOf(n.mainEntityOfPage) || "",
      img: urlOf(n.image) || urlOf(n.thumbnailUrl)
    });
  }

  // Paprika: { name, ingredients, directions, servings, prep_time,
  // cook_time, total_time, source, source_url, notes, description,
  // categories, image_url, photo_data (ignored) }.
  function isPaprika(o) { return o && typeof o === "object" && typeof o.name === "string" && (typeof o.ingredients === "string" || typeof o.directions === "string"); }
  function fromPaprika(o) {
    var tm = times(o.prep_time, o.cook_time, o.total_time);
    var cats = names(o.categories);
    var notes = [txt(o.description, true), txt(o.notes, true)].filter(Boolean).join("\n\n");
    var srcUrl = urlOf(o.source_url);
    return draft({
      t: txt(o.name), c: courseOf(cats), sv: servings(o.servings), pt: tm.pt, ct: tm.ct,
      tg: cats.filter(function (w) { return w.length <= C.LIM.tag; }),
      ig: ingLines(txt(o.ingredients, true).split("\n")), st: stepLines(o.directions), no: notes,
      src: srcUrl || txt(o.source), img: urlOf(o.image_url)
    });
  }

  // Mealie (schema.org-like with objects): recipeIngredient [{ title,
  // quantity, unit, food, note, display, originalText }],
  // recipeInstructions [{ title, text }], performTime, orgURL, tags,
  // recipeCategory [{ name }], notes [{ title, text }].
  function nm(x) { return x && typeof x === "object" ? txt(x.name) : txt(x); }
  function mealieIngLine(x) {
    if (!x || typeof x !== "object") return "";
    var orig = txt(x.originalText) || txt(x.display);
    if (orig) return orig;
    var q = typeof x.quantity === "number" && x.quantity > 0 ? String(Math.round(x.quantity * 1000) / 1000) : "";
    var parts = [q, nm(x.unit), nm(x.food)].filter(Boolean).join(" ");
    var note = txt(x.note);
    return parts ? parts + (note ? ", " + note : "") : note;
  }
  function isMealie(o) {
    return o && typeof o === "object" && typeof o.name === "string" &&
      (Array.isArray(o.recipeIngredient) || Array.isArray(o.recipeInstructions)) && !o["@type"];
  }
  function fromMealie(o) {
    var tm = times(o.prepTime, o.performTime || o.cookTime, o.totalTime);
    var ings = [];
    list(o.recipeIngredient).forEach(function (x) {
      if (x && typeof x === "object" && txt(x.title)) ings.push({ group: txt(x.title) });
      ings.push(typeof x === "string" ? x : mealieIngLine(x));
    });
    var st = [];
    list(o.recipeInstructions).forEach(function (x) {
      var s = typeof x === "string" ? x : txt(x && x.text, true);
      var head = x && typeof x === "object" ? txt(x.title) : "";
      stepLines(s).forEach(function (line, i) { st.push(i === 0 && head ? head + ": " + line : line); });
    });
    var notes = [txt(o.description, true)];
    list(o.notes).forEach(function (n) { if (n && typeof n === "object") notes.push([txt(n.title), txt(n.text, true)].filter(Boolean).join(": ")); });
    var cats = names(o.recipeCategory);
    return draft({
      t: txt(o.name), c: courseOf(cats), sv: servings(o.recipeYield !== undefined ? o.recipeYield : o.recipeServings),
      pt: tm.pt, ct: tm.ct, tg: names(o.tags).concat(cats).filter(function (w) { return w.length <= C.LIM.tag; }),
      ig: ingLines(ings), st: st, no: notes.filter(Boolean).join("\n\n"),
      src: urlOf(o.orgURL) || urlOf(o.originalURL) || "", img: urlOf(o.image)
    });
  }

  // Tandoor (recipe.json): { name, description, servings, working_time,
  // waiting_time, source_url, keywords [{ name }], steps [{ name,
  // instruction, ingredients [{ food, unit, amount, note, is_header,
  // original_text }] }] }.
  function isTandoor(o) { return o && typeof o === "object" && typeof o.name === "string" && Array.isArray(o.steps) && !o["@type"]; }
  function fromTandoor(o) {
    var ings = [], st = [];
    list(o.steps).forEach(function (s) {
      if (!s || typeof s !== "object") return;
      list(s.ingredients).forEach(function (x) {
        if (!x || typeof x !== "object") return;
        if (x.is_header) { ings.push({ group: nm(x.food) || txt(x.note) }); return; }
        var orig = txt(x.original_text);
        if (orig) { ings.push(orig); return; }
        var q = typeof x.amount === "number" && x.amount > 0 && !x.no_amount ? String(Math.round(x.amount * 1000) / 1000) : "";
        var line = [q, nm(x.unit), nm(x.food)].filter(Boolean).join(" ");
        var note = txt(x.note);
        ings.push(line + (note ? ", " + note : ""));
      });
      var head = txt(s.name);
      stepLines(s.instruction).forEach(function (line, i) { st.push(i === 0 && head ? head + ": " + line : line); });
    });
    var w = minutes(o.working_time), wt = minutes(o.waiting_time);
    return draft({
      t: txt(o.name), sv: servings(o.servings), pt: Math.min(w || 0, C.LIM.minutes), ct: Math.min(wt || 0, C.LIM.minutes),
      tg: names(o.keywords).filter(function (x) { return x.length <= C.LIM.tag; }),
      ig: ingLines(ings), st: st, no: txt(o.description, true), src: urlOf(o.source_url)
    });
  }

  // Any parsed JSON → drafts (schema.org nodes anywhere, else Paprika,
  // Mealie, Tandoor, also as arrays or { recipes: [...] }).
  function fromJson(v, pageUrl) {
    var out = [];
    recipeNodes(v).forEach(function (n) { out.push(tag(fromSchema(n, pageUrl), "schema")); });
    if (out.length) return out.filter(useful);
    var items = Array.isArray(v) ? v : (v && typeof v === "object" && Array.isArray(v.recipes) ? v.recipes : (v && typeof v === "object" && Array.isArray(v.items) ? v.items : [v]));
    items.slice(0, MAX_RECIPES).forEach(function (o) {
      if (isPaprika(o)) out.push(tag(fromPaprika(o), "paprika"));
      else if (isMela(o)) out.push(tag(fromMela(o), "mela"));
      else if (isCrouton(o)) out.push(tag(fromCrouton(o), "crouton"));
      else if (isMealie(o)) out.push(tag(fromMealie(o), "mealie"));
      else if (isTandoor(o)) out.push(tag(fromTandoor(o), "tandoor"));
    });
    return out.filter(useful);
  }
  function tag(d, fmt) { d.fmt = fmt; return d; }
  function useful(d) { return !!(d.t && (d.ig.length || d.st.length)); }

  // ---------- 4. Wave 6 sources ----------
  // Display names of the sources (not translated: they are names).
  var FORMATS = {
    schema: "schema.org", paprika: "Paprika", mealie: "Mealie", tandoor: "Tandoor", mela: "Mela",
    recipekeeper: "Recipe Keeper", nextcloud: "Nextcloud Cookbook", cooklang: "Cooklang",
    crouton: "Crouton", mycookbook: "MyCookbook"
  };
  // Light Markdown (Mela, Cooklang notes) → plain: **b**, __b__, *i*,
  // [text](url) → text.
  function unmark(s) {
    return String(s || "").replace(/\[([^\]\n]{0,300})\]\([^)\s]{0,2000}\)/g, "$1")
      .replace(/(\*\*|__)(\S(?:[^\n]*?\S)?)\1/g, "$2").replace(/(^|[\s(])\*(\S(?:[^*\n]*?\S)?)\*/g, "$1$2");
  }
  // Steps from lines where "# Heading" starts a section: its name goes
  // in front of the section's first step (as for Mealie, Tandoor).
  function sectionSteps(lines) {
    var st = [], head = "";
    lines.forEach(function (raw) {
      var line = unmark(txt(raw, true));
      var h = line.match(/^#+\s*(.+)$/);
      if (h) { head = C.clean(h[1], 60); return; }
      stepLines(line).forEach(function (x) {
        if (st.length >= C.LIM.steps) return;
        st.push(head ? head + ": " + x : x);
        head = "";
      });
    });
    return st.map(function (x) { return C.clean(x, C.LIM.step); }).filter(Boolean);
  }

  // Mela (.melarecipe): { id, title, text, ingredients, instructions,
  // notes, yield, prepTime, cookTime, totalTime, categories, link,
  // images (base64: never kept), nutrition }. Ingredients and steps are
  // newline text where "# Dough" starts a group / section.
  function isMela(o) {
    return o && typeof o === "object" && !Array.isArray(o) && typeof o.title === "string" && o.name === undefined &&
      (typeof o.ingredients === "string" || typeof o.instructions === "string");
  }
  function fromMela(o) {
    var tm = times(o.prepTime, o.cookTime, o.totalTime);
    var cats = names(o.categories);
    var ings = txt(o.ingredients, true).split("\n").map(function (l) {
      var h = l.match(/^#+\s*(.+)$/);
      return h ? { group: unmark(h[1]) } : unmark(l);
    });
    var link = urlOf(o.link);
    return draft({
      t: txt(o.title), c: courseOf(cats), sv: servings(o.yield), pt: tm.pt, ct: tm.ct,
      tg: cats.filter(function (w) { return w.length <= C.LIM.tag; }),
      ig: ingLines(ings), st: sectionSteps(txt(o.instructions, true).split("\n")),
      no: [unmark(txt(o.text, true)), unmark(txt(o.notes, true))].filter(Boolean).join("\n\n"),
      src: link || txt(o.link)
    });
  }

  // Crouton (.crumb): { name, serves, duration, cookingDuration (both
  // minutes), ingredients [{ order, quantity { amount, quantityType },
  // ingredient { name } }], steps [{ order, step, isSection }], notes,
  // sourceName, webLink, tags, images (base64: never kept) }.
  var CROUTON_UNITS = {
    ITEM: "", CUP: "cup", CUPS: "cup", TABLESPOON: "tbsp", TEASPOON: "tsp", GRAMS: "g", GRAM: "g", KGS: "kg",
    KILOGRAMS: "kg", OUNCE: "oz", OUNCES: "oz", POUND: "lb", POUNDS: "lb", MILLS: "ml", MILLILITRES: "ml",
    MILLILITERS: "ml", LITRES: "l", LITERS: "l", FLUID_OUNCE: "fl oz", PINCH: "pinch", CAN: "can", BUNCH: "bunch",
    PACKET: "packet", CLOVE: "clove", SLICE: "slice", HANDFUL: "handful", RECIPE: "", SECTION: ""
  };
  function byOrder(a) {
    return list(a).filter(function (x) { return x && typeof x === "object"; }).map(function (x, i) { return { x: x, i: i }; })
      .sort(function (p, q) {
        var a1 = typeof p.x.order === "number" ? p.x.order : p.i, b1 = typeof q.x.order === "number" ? q.x.order : q.i;
        return a1 - b1 || p.i - q.i;
      }).map(function (p) { return p.x; });
  }
  function isCrouton(o) {
    return o && typeof o === "object" && typeof o.name === "string" && !o["@type"] &&
      (list(o.ingredients).some(function (x) { return x && typeof x === "object" && x.ingredient && typeof x.ingredient === "object"; }) ||
       list(o.steps).some(function (x) { return x && typeof x === "object" && typeof x.step === "string"; }));
  }
  function croutonMinutes(v) {
    if (typeof v !== "number" || !isFinite(v) || v <= 0) return 0;
    if (v > 1440 && v % 60 === 0) v = v / 60;        // an export in seconds
    return Math.min(Math.round(v), C.LIM.minutes);
  }
  function fromCrouton(o) {
    var ings = [];
    byOrder(o.ingredients).forEach(function (x) {
      var n = nm(x.ingredient);
      var q = x.quantity && typeof x.quantity === "object" ? x.quantity : {};
      if (q.quantityType === "SECTION" || x.isSection) { if (n) ings.push({ group: n }); return; }
      if (!n) return;
      var amt = typeof q.amount === "number" && isFinite(q.amount) && q.amount > 0 ? String(Math.round(q.amount * 1000) / 1000) : "";
      var qt = typeof q.quantityType === "string" ? q.quantityType.toUpperCase() : "";
      var u = qt in CROUTON_UNITS ? CROUTON_UNITS[qt] : txt(qt).toLowerCase().replace(/_/g, " ");
      ings.push([amt, amt ? u : "", n].filter(Boolean).join(" "));
    });
    var st = [], head = "";
    byOrder(o.steps).forEach(function (x) {
      var s = txt(x.step, true);
      if (!s) return;
      if (x.isSection) { head = C.clean(s, 60); return; }
      stepLines(s).forEach(function (line) { st.push(head ? head + ": " + line : line); head = ""; });
    });
    var link = urlOf(o.webLink);
    return draft({
      t: txt(o.name), sv: servings(o.serves), pt: croutonMinutes(o.duration), ct: croutonMinutes(o.cookingDuration),
      tg: names(o.tags).filter(function (w) { return w.length <= C.LIM.tag; }),
      ig: ingLines(ings), st: st, no: txt(o.notes, true), src: link || txt(o.sourceName)
    });
  }

  // Recipe Keeper (recipes.html in its export ZIP): one
  // <div class="recipe-details"> per recipe with schema.org microdata:
  // itemprop name, recipeIngredients / recipeIngredient,
  // recipeDirections / recipeInstructions, recipeYield, prepTime,
  // cookTime, totalTime, recipeCourse, recipeCategory, recipeNotes,
  // recipeSource. Photos (local files) are not kept. In the browser the
  // page goes through DOMParser into an inert document; in Node (tests)
  // a text scan does the same.
  var MICRO_RE = /itemprop\s*=\s*["']?(recipeIngredients?|recipeDirections|recipeInstructions)\b/i;
  var MAX_PROPS = 4000;
  function addProp(map, k, v) {
    if (!k || typeof v !== "string") return;
    (map[k] = map[k] || []).push(v);
  }
  // [{ prop: [values] }] for each recipe in a page.
  function microRecipes(html) {
    var out = [];
    if (typeof root.DOMParser === "function") {
      try {
        var doc = new root.DOMParser().parseFromString(html, "text/html");
        var scopes = doc.querySelectorAll(".recipe-details");
        if (!scopes.length) scopes = doc.querySelectorAll("[itemscope][itemtype*='Recipe'], [itemscope][itemtype*='recipe']");
        if (!scopes.length && doc.body) scopes = [doc.body];
        for (var i = 0; i < scopes.length && out.length < MAX_RECIPES; i++) {
          var map = {}, els = scopes[i].querySelectorAll("[itemprop]");
          for (var k = 0; k < els.length && k < MAX_PROPS; k++) {
            var e = els[k], tagName = e.tagName.toLowerCase(), v;
            if (tagName === "meta") v = e.getAttribute("content") || "";
            else if (tagName === "img" || tagName === "link") continue;
            else v = txt(e.innerHTML, true);   // the markup of an inert node, made plain text
            addProp(map, (e.getAttribute("itemprop") || "").trim(), v);
          }
          out.push(map);
        }
        return out;
      } catch (e2) { out = []; }
    }
    var parts = html.split(/<div\b[^>]*\bclass\s*=\s*["'][^"']*\brecipe-details\b[^"']*["'][^>]*>/i);
    if (parts.length > 1) parts.shift();
    parts.slice(0, MAX_RECIPES).forEach(function (chunk) {
      var map = {}, re = /<([a-z][a-z0-9]*)\b([^>]*?\bitemprop\s*=\s*["']?([\w-]+)[^>]*)>/gi, m, n = 0;
      while ((m = re.exec(chunk)) && n++ < MAX_PROPS) {
        var tagName = m[1].toLowerCase(), attrs = m[2], prop = m[3];
        if (tagName === "img" || tagName === "link") continue;
        if (tagName === "meta") {
          var c = attrs.match(/\bcontent\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
          addProp(map, prop, c ? txt(c[2] !== undefined ? c[2] : (c[3] !== undefined ? c[3] : c[4])) : "");
          continue;
        }
        // The element's end: the same tag counted in and out.
        var depth = 1, tre = new RegExp("<(/?)" + tagName + "\\b[^>]*>", "gi"), t2, end = chunk.length;
        tre.lastIndex = re.lastIndex;
        while ((t2 = tre.exec(chunk))) {
          depth += t2[1] ? -1 : 1;
          if (!depth) { end = t2.index; break; }
        }
        addProp(map, prop, txt(chunk.slice(re.lastIndex, end), true));
      }
      out.push(map);
    });
    return out;
  }
  function fromMicro(p) {
    function one(k) { return (p[k] || [])[0] || ""; }
    function lines(keys) {
      var out = [];
      keys.forEach(function (k) { (p[k] || []).forEach(function (v) { v.split("\n").forEach(function (l) { if (l.trim()) out.push(l); }); }); });
      return out;
    }
    var tm = times(one("prepTime"), one("cookTime"), one("totalTime"));
    var cats = names((p.recipeCourse || []).concat(p.recipeCategory || []));
    var src = one("recipeSource") || one("url");
    return draft({
      t: txt(one("name")), c: courseOf(cats), sv: servings(one("recipeYield") || one("recipeServings")), pt: tm.pt, ct: tm.ct,
      tg: (p.recipeCategory ? names(p.recipeCategory) : []).filter(function (w) { return w.length <= C.LIM.tag; }),
      ig: ingLines(lines(["recipeIngredients", "recipeIngredient"])),
      st: sectionSteps(lines(["recipeDirections", "recipeInstructions"])),
      no: [one("description"), (p.recipeNotes || []).join("\n\n")].filter(Boolean).join("\n\n"),
      src: urlOf(src) || txt(src)
    });
  }
  function fromMicrodata(html) {
    if (typeof html !== "string") return [];
    if (html.length > MAX_TEXT) html = html.slice(0, MAX_TEXT);
    var fmt = /recipe-details|itemprop\s*=\s*["']?recipeDirections/i.test(html) ? "recipekeeper" : "schema";
    return microRecipes(html).map(function (p) { return tag(fromMicro(p), fmt); }).filter(useful);
  }

  // MyCookbook (.mcb = a ZIP with an XML file): <cookbook><recipe>
  // <title/> <preptime/> <cooktime/> <totaltime/> <quantity/>
  // <ingredient><li/>…</ingredient> <recipetext><li/>…</recipetext>
  // <comments/> <description/> <url/> <source/> <category/>…
  // <imagepath/> (not kept) </recipe></cookbook>. Read by a text scan:
  // nothing in it is ever treated as markup.
  function xmlKids(x, tagName) {
    var out = [], re = new RegExp("<" + tagName + "\\b[^>]*>([\\s\\S]*?)</" + tagName + "\\s*>", "gi"), m;
    while ((m = re.exec(x)) && out.length < 2000) out.push(m[1]);
    return out;
  }
  function xmlLines(x, tagName) {
    var out = [];
    xmlKids(x, tagName).forEach(function (inner) {
      var li = xmlKids(inner, "li");
      (li.length ? li : [inner]).forEach(function (v) { txt(v, true).split("\n").forEach(function (l) { if (l.trim()) out.push(l); }); });
    });
    return out;
  }
  function fromMcb(xml) {
    if (typeof xml !== "string") return [];
    if (xml.length > MAX_TEXT) xml = xml.slice(0, MAX_TEXT);
    xml = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, function (m0, c) {
      return c.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    });
    return xmlKids(xml, "recipe").slice(0, MAX_RECIPES).map(function (r) {
      function one(k) { return txt(xmlKids(r, k)[0] || ""); }
      var tm = times(one("preptime"), one("cooktime"), one("totaltime"));
      var cats = [];
      xmlKids(r, "category").forEach(function (c) { names(txt(c)).forEach(function (w) { cats.push(w); }); });
      var src = one("url") || one("source");
      return tag(draft({
        t: one("title"), c: courseOf(cats), sv: servings(one("quantity")), pt: tm.pt, ct: tm.ct,
        tg: cats.filter(function (w) { return w.length <= C.LIM.tag; }),
        ig: ingLines(xmlLines(r, "ingredient")), st: sectionSteps(xmlLines(r, "recipetext")),
        no: [xmlLines(r, "description").join("\n"), xmlLines(r, "comments").join("\n")].filter(Boolean).join("\n\n"),
        src: urlOf(src) || src
      }), "mycookbook");
    }).filter(useful);
  }

  // Cooklang (.cook): ">> key: value" metadata (or a YAML front matter
  // between --- lines), steps are paragraphs (blank lines between),
  // "= Section" lines, @ingredient / @two words{qty%unit}(note),
  // #cookware{}, ~timer{qty%unit}, "-- comment", "[- block -]".
  var CL_ING = /@([^@#~{}\n]+?)\{([^}\n]*)\}(?:\(([^)\n]*)\))?|@([^\s@#~{}()\[\],.;:!?]+)(?:\(([^)\n]*)\))?/g;
  var CL_TOOL = /#([^@#~{}\n]+?)\{[^}\n]*\}|#([^\s@#~{}()\[\],.;:!?]+)/g;
  var CL_TIMER = /~([^@#~{}\n]*?)\{([^}\n]*)\}|~([^\s@#~{}()\[\],.;:!?]+)/g;
  function isCooklang(s) {
    s = String(s || "");
    return !/^[\[{<]/.test(s.trim()) && (/(^|\n)\s*>>\s*[\w ]+:/.test(s) || /@[^@#~{}\n]{1,60}\{[^}\n]*\}/.test(s) || /~[^~{}\n]{0,40}\{\d[^}\n]*%[^}\n]*\}/.test(s));
  }
  function fromCooklang(text, name) {
    var s = String(text || "").replace(/\r\n?/g, "\n").replace(/^﻿/, "");
    var meta = {};
    function setMeta(k, v) { k = C.fold(String(k).trim()).replace(/[\s_-]+/g, " "); if (k && !(k in meta)) meta[k] = String(v).trim(); }
    var fm = s.match(/^---\n([\s\S]*?)\n---[ \t]*(\n|$)/);
    if (fm) {
      var lastKey = "";
      fm[1].split("\n").forEach(function (l) {
        var kv = l.match(/^([\w][\w .-]*):\s*(.*)$/), it = l.match(/^\s+-\s+(.+)$/), sub = l.match(/^\s+(\w+):\s*(.+)$/);
        if (kv) { lastKey = kv[1]; if (kv[2]) setMeta(kv[1], kv[2].replace(/^["']|["']$/g, "")); }
        else if (it && lastKey) { var k2 = C.fold(lastKey); meta[k2] = (meta[k2] ? meta[k2] + ", " : "") + it[1].replace(/^["']|["']$/g, ""); }
        else if (sub && lastKey) setMeta(lastKey + " " + sub[1], sub[2].replace(/^["']|["']$/g, ""));
      });
      s = s.slice(fm[0].length);
    }
    s = s.replace(/\[-[\s\S]*?-\]/g, "");
    var ings = [], st = [], section = "", seen = {}, para = [];
    function flush() {
      if (!para.length) return;
      var step = para.join(" ");
      para = [];
      step = step.replace(CL_ING, function (m0, n1, q, note1, n2, note2) {
        var n = C.clean(n1 || n2 || "", 80), note = note1 || note2 || "", qty = "", unit = "";
        if (q) {
          var qp = q.split("%");
          qty = qp[0].replace(/^\s*=\s*/, "").trim();
          unit = (qp[1] || "").trim();
        }
        var line = [qty, unit, n].filter(Boolean).join(" ") + (note ? ", " + note : "");
        var key = C.fold(section + "|" + line);
        if (n && !seen[key]) { seen[key] = 1; ings.push(section && !seen["g|" + section] ? (seen["g|" + section] = 1, { group: section }) : null); ings.push(line); }
        return n;
      }).replace(CL_TOOL, function (m0, n1, n2) { return n1 || n2 || ""; })
        .replace(CL_TIMER, function (m0, n1, q, n2) {
          if (q) { var qp = q.split("%"); return [qp[0].trim(), (qp[1] || "").trim()].filter(Boolean).join(" "); }
          return n1 || n2 || "";
        });
      step = unmark(step).replace(/\s+/g, " ").trim();
      if (step && st.length < C.LIM.steps) st.push(C.clean((section && !seen["s|" + section] ? (seen["s|" + section] = 1, section + ": ") : "") + step, C.LIM.step));
    }
    s.split("\n").forEach(function (line) {
      line = line.replace(/(^|\s)--.*$/, "");
      var mt = line.match(/^\s*>>\s*([^:]+):\s*(.*)$/);
      if (mt) { setMeta(mt[1], mt[2]); return; }
      var sec = line.match(/^\s*=+\s*(.*?)\s*=*\s*$/);
      if (sec) { flush(); section = C.clean(sec[1], 60); return; }
      if (!line.trim()) { flush(); return; }
      para.push(line.trim());
    });
    flush();
    function m(keys) { for (var i = 0; i < keys.length; i++) if (meta[keys[i]]) return meta[keys[i]]; return ""; }
    var title = m(["title", "name"]) || String(name || "").replace(/^.*\//, "").replace(/\.cook$/i, "").replace(/[_]+/g, " ");
    var tm = times(m(["prep time", "prep", "preparation"]), m(["cook time", "cook", "cooking time"]), m(["time", "total time", "duration", "time required"]));
    var cats = names(m(["course", "category", "categories"]));
    var src = m(["source", "source url", "url", "link"]);
    return tag(draft({
      t: txt(title), c: courseOf(cats), sv: servings(m(["servings", "serves", "yield"])), pt: tm.pt, ct: tm.ct,
      tg: names(m(["tags", "tag"])).concat(cats).filter(function (w) { return w.length <= C.LIM.tag; }),
      ig: ingLines(ings.filter(Boolean)), st: st,
      no: unmark(txt(m(["description", "introduction", "notes"]), true)),
      src: urlOf(src) || txt(src)
    }), "cooklang");
  }

  // Stable ids: "imp-" + a hash of the source and the folded title, so
  // the same file imported twice adds nothing new (the same FNV-1a as
  // OrosImportKit.hash, which is used when it is there).
  function fnv(str) {
    var h = 0x811c9dc5, s = String(str);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  function idFor(d) {
    var K = root.OrosImportKit, key = (d.fmt || "") + "\n" + C.fold(d.t || "");
    return "imp-" + (K && typeof K.hash === "function" ? K.hash(key) : fnv(key));
  }
  // drafts → [{ id, d, stored }]: one entry per id (the first wins),
  // `stored` when that id is already among the user's recipes (it is
  // then never written again).
  function prepareBatch(drafts, storedIds) {
    var have = {}, seen = {}, out = [];
    list(storedIds).forEach(function (id) { have[id] = 1; });
    list(drafts).forEach(function (d) {
      if (!d || !d.t || out.length >= MAX_RECIPES) return;
      var id = idFor(d);
      if (seen[id]) return;
      seen[id] = 1;
      out.push({ id: id, d: d, stored: !!have[id] });
    });
    return out;
  }

  // ---------- 5. Detect + read ----------
  // Text the user pasted, or a file read as text: JSON, or a page
  // (its JSON-LD). [] when it holds no recipe data.
  // `name` (a file's name, optional) picks Cooklang by its .cook.
  function fromText(text, pageUrl, name) {
    if (typeof text !== "string") return [];
    var s = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
    var tr = s.replace(/^﻿/, "").trim();
    if (/\.cook$/i.test(name || "")) return [fromCooklang(s, name)].filter(useful);
    if (/^[\[{]/.test(tr)) {
      var j = parseJson(tr);
      if (j !== null) return fromJson(j, pageUrl);
    }
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<cookbook[\s>]/i.test(tr)) return fromMcb(s);
    var out = [];
    ldBlocks(s).forEach(function (b) {
      var j2 = parseJson(b);
      if (j2 !== null) fromJson(j2, pageUrl).forEach(function (d) { if (out.length < MAX_RECIPES) out.push(d); });
    });
    if (!out.length && MICRO_RE.test(s)) out = fromMicrodata(s);
    // Pasted Cooklang may have no title: the editor asks for one.
    if (!out.length && !/^</.test(tr) && isCooklang(tr)) out = [fromCooklang(s, "")].filter(function (d) { return d.ig.length || d.st.length; });
    return out;
  }
  function looksLikeData(text) {
    var tr = String(text || "").trim();
    return /^[\[{]/.test(tr) || /<script\b[^>]*application\/ld\+json/i.test(tr) || /^<(!doctype|html|head|body|\?xml|cookbook)\b/i.test(tr) ||
      MICRO_RE.test(tr) || isCooklang(tr);
  }

  function streamAll(stream, max) {
    var reader = stream.getReader(), parts = [], total = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total), o = 0;
          parts.forEach(function (c) { out.set(c, o); o += c.length; });
          return out;
        }
        total += r.value.length;
        if (total > max) { try { reader.cancel(); } catch (e) {} throw new Error("toobig"); }
        parts.push(r.value);
        return pump();
      });
    }
    return pump();
  }
  // gzip bytes → bytes, with the platform's DecompressionStream.
  function gunzip(bytes, max) {
    if (typeof root.DecompressionStream !== "function") return Promise.reject(new Error("gzip"));
    var ds = new root.DecompressionStream("gzip");
    var w = ds.writable.getWriter();
    w.write(bytes).then(null, function () {});
    w.close().then(null, function () {});
    return streamAll(ds.readable, max || MAX_ENTRY);
  }
  function isZip(b) { return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04; }
  function isGzip(b) { return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b; }
  function utf8(b) { return new TextDecoder("utf-8").decode(b); }

  // A file's bytes → Promise<drafts>. Zip: the AtelierZip module.
  // Paprika entries are gzipped JSON; Tandoor puts one ZIP per recipe
  // inside its ZIP (one level is read); JSON and HTML entries too.
  function fromBytes(bytes, name, Zip, depth) {
    depth = depth || 0;
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || []);
    if (bytes.length > MAX_FILE) return Promise.reject(new Error("toobig"));
    if (isGzip(bytes)) {
      return gunzip(bytes).then(function (b) { return fromBytes(b, String(name || "").replace(/\.gz$/i, ""), Zip, depth + 1); });
    }
    if (isZip(bytes)) {
      if (!Zip || depth > 1) return Promise.reject(new Error("zip"));
      var z, out = [];
      try { z = Zip.open(bytes); } catch (e) { return Promise.reject(e); }
      var wanted = z.names.filter(function (n) { return /\.(paprikarecipe|melarecipe|crumb|cook|xml|json|zip|html?)$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n); });
      return wanted.reduce(function (p, n) {
        return p.then(function () {
          if (out.length >= MAX_RECIPES) return;
          return z.bytes(n, MAX_ENTRY).then(function (b) {
            return b ? fromBytes(b, n, Zip, depth + 1) : [];
          }).then(function (list) {
            list.forEach(function (d) { if (out.length < MAX_RECIPES) out.push(d); });
          }, function () {});   // one bad entry does not stop the rest
        });
      }, Promise.resolve()).then(function () { return out; });
    }
    var text;
    try { text = utf8(bytes.length > MAX_TEXT ? bytes.subarray(0, MAX_TEXT) : bytes); } catch (e) { return Promise.resolve([]); }
    var list = fromText(text, "", name);
    // Nextcloud Cookbook: one folder per recipe with a schema.org recipe.json.
    if (/(^|\/)recipe\.json$/i.test(name || "")) list.forEach(function (d) { if (d.fmt === "schema" || d.fmt === "mealie") d.fmt = "nextcloud"; });
    return Promise.resolve(list);
  }

  root.OrosMealsImport = {
    decodeEntities: decodeEntities, txt: txt, minutes: minutes, servings: servings,
    ldBlocks: ldBlocks, recipeNodes: recipeNodes, instructions: instructions,
    fromSchema: fromSchema, fromPaprika: fromPaprika, fromMealie: fromMealie, fromTandoor: fromTandoor,
    fromJson: fromJson, fromText: fromText, fromBytes: fromBytes, gunzip: gunzip, looksLikeData: looksLikeData,
    fromMela: fromMela, fromCrouton: fromCrouton, fromMicrodata: fromMicrodata, fromMcb: fromMcb,
    fromCooklang: fromCooklang, isCooklang: isCooklang, FORMATS: FORMATS, idFor: idFor, prepareBatch: prepareBatch
  };
})(typeof window !== "undefined" ? window : this);
