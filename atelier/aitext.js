// ============================================================
// orOS Atelier — aitext.js: words and colours from an AI (v1.0.0)
// What Atelier asks the user's AI (the one set up in the Assistant
// app, see ai.js) and how the answers come back into a design:
//   - rewrite(kind, text): write / shorter / longer / fix / formal /
//     friendly / translate (Greek ↔ English) for one text box
//   - ideas(topic, slots): a few ideas for the whole page, each with
//     new words for every text box and a colour palette
//   - clean(): the model's answer → plain text for a text box
//   - parseIdeas(): the model's JSON → checked ideas
//   - recolor(): a palette onto a page, colours matched by lightness
//     (dark stays dark, light stays light, so text stays readable)
// Pure: no DOM, no network. Exposes window.AtelierAIText (browser) or
// module.exports.
// ============================================================
(function (root) {
  "use strict";

  var MAX_TX = 5000;             // ax.js MAX_TX
  var MAX_IDEAS = 3, MAX_SLOTS = 12, MAX_COLORS = 6;
  var KINDS = ["write", "shorter", "longer", "fix", "formal", "friendly", "translate"];
  var HEX = /^#[0-9a-f]{6}$/;

  function str(v) { return typeof v === "string" ? v : v == null ? "" : String(v); }
  function greekShare(s) {
    var gr = (s.match(/[Ͱ-Ͽἀ-῿]/g) || []).length;
    var la = (s.match(/[A-Za-z]/g) || []).length;
    return gr + la ? gr / (gr + la) : 0;
  }
  function isGreek(s) { return greekShare(str(s)) >= 0.5; }
  // The app's language (orosI18n code) → its name for the model
  var LANG_NAMES = { en: "English", el: "Greek", de: "German" };
  function langName(l) { return LANG_NAMES[l] || "English"; }

  var BASE = "You write the words for a graphic design (a social media post, poster, invitation, card, flyer). " +
    "Reply with the text only: no quotes around it, no Markdown, no title, no explanation, no options to choose from. " +
    "Keep it as short as a design needs.";

  // → { system, user }. opts: { ask (what the user typed, for write),
  // lang "en" | "el" | "de"… (the app's language, used when there is no text) }
  function rewrite(kind, text, opts) {
    opts = opts || {};
    text = str(text).slice(0, MAX_TX);
    // a text that is not Greek: English, or the app's language when it is another one
    var lang = text.trim() ? (isGreek(text) ? "Greek" : opts.lang && opts.lang !== "en" && opts.lang !== "el" ? "the language of the text" : "English") : langName(opts.lang);
    var keep = " Write it in " + lang + ".";
    var user;
    switch (kind) {
      case "write":
        user = "Write the text for this: " + str(opts.ask).slice(0, 2000).trim() +
          (text.trim() ? "\n\nThe text box holds now:\n" + text : "") +
          (/[Ͱ-Ͽ]/.test(str(opts.ask)) ? " Write it in Greek." : /[A-Za-z]/.test(str(opts.ask)) ? " Write it in the language of my request." : keep);
        break;
      case "shorter": user = "Make this text shorter, keep its meaning." + keep + "\n\n" + text; break;
      case "longer": user = "Make this text a little longer and richer, still short enough for a design." + keep + "\n\n" + text; break;
      case "fix": user = "Correct the spelling, grammar and punctuation of this text. Change nothing else." + keep + "\n\n" + text; break;
      case "formal": user = "Rewrite this text in a more formal, professional tone." + keep + "\n\n" + text; break;
      case "friendly": user = "Rewrite this text in a warmer, friendlier tone." + keep + "\n\n" + text; break;
      case "translate":
        user = "Translate this text into " + (isGreek(text) ? "English" : "Greek") + ". Keep the line breaks.\n\n" + text;
        break;
      default: throw new Error("kind");
    }
    return { system: BASE, user: user };
  }

  // The answer → text for a text box: no code fences, no quotes around
  // the whole text, no Markdown emphasis or heading marks, no
  // "Here is…:" lead-in line.
  function clean(s) {
    s = str(s).replace(/\r\n?/g, "\n").trim();
    var fence = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(s);
    if (fence) s = fence[1].trim();
    var lines = s.split("\n");
    if (lines.length > 1 && /^(here(\x27s| is| are)|sure|certainly|ορίστε|ιδού|εδώ (είναι|το))[^\n]*:\s*$/i.test(lines[0].trim())) {
      s = lines.slice(1).join("\n").trim();
    }
    s = s.replace(/^#{1,6}\s+/gm, "").replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/__([^_\n]+)__/g, "$1");
    var pairs = [["\"", "\""], ["“", "”"], ["«", "»"], ["'", "'"], ["‘", "’"]];
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      if (s.length > 1 && s.charAt(0) === p[0] && s.charAt(s.length - 1) === p[1] &&
          s.slice(1, -1).indexOf(p[0]) < 0 && s.slice(1, -1).indexOf(p[1]) < 0) { s = s.slice(1, -1).trim(); break; }
    }
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.slice(0, MAX_TX);
  }

  // ---------- Ideas for a page ----------
  // The text boxes of a page, biggest type first (the order a reader
  // sees them): [{ id, role, tx, chars }]
  function slotsOf(doc, pageId) {
    var list = (doc.items || []).filter(function (it) {
      return it.pg === pageId && it.ax && it.ax.k === "text" && !it.lock && str(it.ax.tx).trim();
    });
    list.sort(function (a, b) { return (b.ax.size || 0) - (a.ax.size || 0) || a.y - b.y || (a.id < b.id ? -1 : 1); });
    list = list.slice(0, MAX_SLOTS);
    var big = list.length ? list[0].ax.size || 0 : 0;
    return list.map(function (it, i) {
      var sz = it.ax.size || 0;
      var role = i === 0 ? "headline" : sz >= big * 0.6 ? "subheading" : sz >= big * 0.3 ? "text" : "small print";
      var tx = str(it.ax.tx).slice(0, 600);
      return { id: it.id, role: role, tx: tx, chars: tx.length };
    });
  }

  // → { system, user }. opts: { colors (ask for a palette too), lang }
  function ideas(topic, slots, opts) {
    opts = opts || {};
    topic = str(topic).slice(0, 2000).trim();
    var lang = /[Ͱ-Ͽ]/.test(topic) ? "Greek" : /[A-Za-z]/.test(topic) ? "the language of the request" :
      (slots.some(function (s) { return isGreek(s.tx); }) ? "Greek" : langName(opts.lang));
    var boxes = slots.map(function (s, i) {
      return (i + 1) + ". " + s.role + ", now " + s.chars + " characters: " + JSON.stringify(s.tx);
    }).join("\n");
    var shape = '{"ideas":[{"name":"two or three words","texts":[' + slots.map(function (s, i) { return '"text for box ' + (i + 1) + '"'; }).join(",") + "]" +
      (opts.colors ? ',"colors":["#rrggbb","#rrggbb","#rrggbb","#rrggbb","#rrggbb"]' : "") + "}]}";
    var system = "You are a graphic designer. You give ideas for a design that already has its layout: " +
      "only the words in its text boxes" + (opts.colors ? " and its colours" : "") + " change. " +
      "Answer with JSON only, exactly in this shape, no Markdown, no other text: " + shape;
    var user = "The design is for: " + (topic || "(no description: keep its subject, make it better)") + "\n\n" +
      "Its text boxes, biggest first:\n" + boxes + "\n\n" +
      "Give " + MAX_IDEAS + " different ideas. Each idea has exactly " + slots.length + " texts, in the same order, " +
      "each about as long as the text in that box now, written in " + lang + "." +
      (opts.colors ? " Each idea also has a palette of 5 colours that suit it, from darkest to lightest, with enough contrast for text." : "");
    return { system: system, user: user };
  }

  // The first JSON object in a text (fenced or bare)
  function firstJson(s) {
    s = str(s);
    var start = s.indexOf("{");
    while (start >= 0) {
      var depth = 0, inStr = false, esc = false;
      for (var i = start; i < s.length; i++) {
        var c = s.charAt(i);
        if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === "\"") inStr = false; continue; }
        if (c === "\"") inStr = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) {
          try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { break; }
        }
      }
      start = s.indexOf("{", start + 1);
    }
    return null;
  }

  // → [{ name, texts[n], colors[] }] (at most 3). A missing or empty
  // text keeps the box's own text (slots[i].tx).
  function parseIdeas(answer, slots) {
    var j = firstJson(answer);
    var list = j && Array.isArray(j.ideas) ? j.ideas : Array.isArray(j) ? j : j && Array.isArray(j.texts) ? [j] : [];
    var out = [];
    list.forEach(function (x) {
      if (!x || typeof x !== "object" || out.length >= MAX_IDEAS) return;
      var texts = slots.map(function (s, i) {
        var v = Array.isArray(x.texts) ? clean(str(x.texts[i])) : "";
        return v || s.tx;
      });
      var colors = (Array.isArray(x.colors) ? x.colors : []).map(function (c) { return str(c).trim().toLowerCase(); })
        .map(function (c) { return /^#[0-9a-f]{3}$/.test(c) ? "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c; })
        .filter(function (c) { return HEX.test(c); }).slice(0, MAX_COLORS);
      var changed = texts.some(function (tx, i) { return tx !== slots[i].tx; }) || colors.length >= 2;
      if (changed) out.push({ name: clean(str(x.name)).replace(/\n/g, " ").slice(0, 40), texts: texts, colors: colors.length >= 2 ? colors : [] });
    });
    return out;
  }

  // ---------- Palette ----------
  function lum(c) {
    var n = parseInt(c.slice(1), 16);
    var ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function byLum(a, b) { return lum(a) - lum(b) || (a < b ? -1 : a > b ? 1 : 0); }

  // Every colour a page's items use (fill, stroke, gradient, text
  // effect), each once. Locked items keep theirs, except the page
  // background (locked from the start in every template).
  function pageColors(doc, pageId) {
    var seen = {}, out = [];
    function add(c) { if (typeof c === "string" && HEX.test(c) && !seen[c]) { seen[c] = 1; out.push(c); } }
    (doc.items || []).forEach(function (it) {
      if (it.pg !== pageId || !it.ax || (it.lock && !it.ax.bg)) return;
      var a = it.ax;
      add(a.fc); add(a.sc);
      if (a.g) { add(a.g.a); add(a.g.b); }
      if (a.tfx) add(a.tfx.color);
    });
    return out;
  }
  // old colour → new colour: both lists in order of lightness, the
  // n-th darkest old colour takes the matching place in the palette.
  function colorMap(oldColors, palette) {
    var o = oldColors.slice().sort(byLum), p = palette.filter(function (c) { return HEX.test(c); }).sort(byLum);
    var map = {};
    if (!o.length || !p.length) return map;
    o.forEach(function (c, i) {
      var k = o.length === 1 ? (lum(c) > 0.5 ? p.length - 1 : 0) : Math.round(i * (p.length - 1) / (o.length - 1));
      map[c] = p[k];
    });
    return map;
  }
  // Mutates the page's items; returns how many changed.
  function recolor(doc, pageId, palette) {
    var map = colorMap(pageColors(doc, pageId), palette), n = 0;
    function sw(c) { return typeof c === "string" && map[c] ? map[c] : c; }
    (doc.items || []).forEach(function (it) {
      if (it.pg !== pageId || !it.ax || (it.lock && !it.ax.bg)) return;
      var a = it.ax, before = JSON.stringify(a);
      if (a.fc) a.fc = sw(a.fc);
      if (a.sc) a.sc = sw(a.sc);
      if (a.g) { a.g.a = sw(a.g.a); a.g.b = sw(a.g.b); }
      if (a.tfx && a.tfx.color) a.tfx.color = sw(a.tfx.color);
      if (JSON.stringify(a) !== before) n++;
    });
    return n;
  }

  var api = {
    KINDS: KINDS, MAX_IDEAS: MAX_IDEAS, isGreek: isGreek, rewrite: rewrite, clean: clean,
    slotsOf: slotsOf, ideas: ideas, firstJson: firstJson, parseIdeas: parseIdeas,
    lum: lum, pageColors: pageColors, colorMap: colorMap, recolor: recolor
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierAIText = api;
})(typeof window !== "undefined" ? window : this);
