// ============================================================
// orOS Meal Planner — import.js (pure logic, wave 2)
// Recipes from elsewhere, read as DATA only:
//   - a web page: the schema.org Recipe in its JSON-LD
//     (<script type="application/ld+json">), also inside @graph,
//     arrays and nested nodes; HowToSection / HowToStep; ISO 8601
//     durations; recipeYield; the picture's address kept as a link
//   - Paprika (.paprikarecipes = a ZIP of gzipped JSON, or one
//     .paprikarecipe), Mealie and Tandoor JSON (also their ZIPs)
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
//   4. Detect + read (text, files, ZIP, gzip)
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
    recipeNodes(v).forEach(function (n) { out.push(fromSchema(n, pageUrl)); });
    if (out.length) return out.filter(useful);
    var items = Array.isArray(v) ? v : (v && typeof v === "object" && Array.isArray(v.recipes) ? v.recipes : (v && typeof v === "object" && Array.isArray(v.items) ? v.items : [v]));
    items.slice(0, MAX_RECIPES).forEach(function (o) {
      if (isPaprika(o)) out.push(fromPaprika(o));
      else if (isMealie(o)) out.push(fromMealie(o));
      else if (isTandoor(o)) out.push(fromTandoor(o));
    });
    return out.filter(useful);
  }
  function useful(d) { return !!(d.t && (d.ig.length || d.st.length)); }

  // ---------- 4. Detect + read ----------
  // Text the user pasted, or a file read as text: JSON, or a page
  // (its JSON-LD). [] when it holds no recipe data.
  function fromText(text, pageUrl) {
    if (typeof text !== "string") return [];
    var s = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
    var tr = s.replace(/^﻿/, "").trim();
    if (/^[\[{]/.test(tr)) {
      var j = parseJson(tr);
      if (j !== null) return fromJson(j, pageUrl);
    }
    var out = [];
    ldBlocks(s).forEach(function (b) {
      var j2 = parseJson(b);
      if (j2 !== null) fromJson(j2, pageUrl).forEach(function (d) { if (out.length < MAX_RECIPES) out.push(d); });
    });
    return out;
  }
  function looksLikeData(text) {
    var tr = String(text || "").trim();
    return /^[\[{]/.test(tr) || /<script\b[^>]*application\/ld\+json/i.test(tr) || /^<(!doctype|html|head|body)\b/i.test(tr);
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
      var wanted = z.names.filter(function (n) { return /\.(paprikarecipe|json|zip|html?)$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n); });
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
    return Promise.resolve(fromText(text, ""));
  }

  root.OrosMealsImport = {
    decodeEntities: decodeEntities, txt: txt, minutes: minutes, servings: servings,
    ldBlocks: ldBlocks, recipeNodes: recipeNodes, instructions: instructions,
    fromSchema: fromSchema, fromPaprika: fromPaprika, fromMealie: fromMealie, fromTandoor: fromTandoor,
    fromJson: fromJson, fromText: fromText, fromBytes: fromBytes, gunzip: gunzip, looksLikeData: looksLikeData
  };
})(typeof window !== "undefined" ? window : this);
