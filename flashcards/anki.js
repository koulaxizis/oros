// ============================================================
// orOS Flashcards — importing Anki decks and text files (FlashcardsAnki)
// Pure, Node-tested. Turns an Anki package (.apkg / .colpkg) or a
// CSV / TSV / plain-text export (Anki "Notes in plain text", Quizlet)
// into Flashcards notes, review rows and decks.
//
// Anki packages are zip files holding one collection database:
//   collection.anki21b  newest format: zstd-compressed SQLite, note
//                       types, fields, templates and decks in their own
//                       tables (protobuf blobs), media map = zstd +
//                       protobuf, media files zstd-compressed;
//   collection.anki21 / collection.anki2  older formats: note types and
//                       decks as JSON in the col table, media map JSON.
// Read with flashcards/sqlite.js (our own read-only reader) and
// vendor/fzstd (MIT). Nothing in the package is ever run: fields are
// HTML that is turned into plain text with our simple marks; template
// scripts and styles are dropped; only a small mustache subset of the
// card templates is understood, the rest is left out.
//
// Mapping (OROS_BIBLE.md Part IV "FLASHCARDS"):
//   cloze note type      → one cloze note, Anki card ord k → our ord k+1;
//   one-template type    → one basic note;
//   two templates that mirror each other → one "basic and reversed" note;
//   anything else        → one basic note per template (front/back
//                          rendered from that template).
//   Note ids come from the Anki note guid, review ids from the Anki
//   review id, so importing the same deck twice adds nothing new.
//   Anki review history (ease 1-4, learning/review/relearning, and
//   filtered reviews that rescheduled) becomes answer rows, so the FSRS
//   schedule goes on from where Anki left it. Suspended cards stay
//   suspended (a flag row).
// ============================================================
(function (root) {
  "use strict";

  var MAX_NOTES = 60000, MAX_REVLOG = 1500000, MAX_FIELD = 20000;
  var SEP = "\u001f";

  function fail(code) { var e = new Error(code); e.code = code; return e; }

  // ---------- 1. small helpers ----------
  function fnv(s, seed) {
    var h = seed >>> 0 || 0x811c9dc5;
    s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h;
  }
  // Note id from the Anki guid: stable, so a second import finds the note.
  function noteIdFor(guid, suffix) {
    var g = String(guid || "");
    return "n" + fnv(g).toString(36) + fnv(g, 0x9747b28c).toString(36) + (suffix || "");
  }
  function b36(n) { n = Math.floor(Math.abs(+n || 0)); return n.toString(36); }
  function utf8(bytes) { return new TextDecoder("utf-8").decode(bytes); }

  // Protobuf: field number → list of values (numbers for varints, bytes otherwise).
  function proto(bytes) {
    var out = {}, o = 0;
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
    function varint() {
      var v = 0, mul = 1;
      for (var k = 0; k < 10; k++) {
        var b = bytes[o++];
        if (b === undefined) throw fail("proto");
        v += (b & 0x7f) * mul;
        mul *= 128;
        if (!(b & 0x80)) return v;
      }
      throw fail("proto");
    }
    while (o < bytes.length) {
      var key = varint(), f = Math.floor(key / 8), wt = key % 8, val;
      if (wt === 0) val = varint();
      else if (wt === 2) {
        var n = varint();
        if (o + n > bytes.length) throw fail("proto");
        val = bytes.subarray(o, o + n);
        o += n;
      } else if (wt === 1) { val = bytes.subarray(o, o + 8); o += 8; }
      else if (wt === 5) { val = bytes.subarray(o, o + 4); o += 4; }
      else throw fail("proto");
      (out[f] = out[f] || []).push(val);
    }
    return out;
  }
  function pstr(msg, f) { return msg[f] && msg[f][0] instanceof Uint8Array ? utf8(msg[f][0]) : ""; }
  function pnum(msg, f) { return msg[f] && typeof msg[f][0] === "number" ? msg[f][0] : 0; }

  // ---------- 2. HTML → our text ----------
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—",
    hellip: "…", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“",
    rdquo: "”", middot: "·", times: "×", divide: "÷", deg: "°", euro: "€", copy: "©" };
  function entities(s) {
    return String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, function (m, e) {
      if (e[0] === "#") {
        var code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code < 0x110000 && !(code >= 0xd800 && code < 0xe000) ? String.fromCodePoint(code) : "";
      }
      var k = e.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m;
    });
  }
  var BLOCK = /^(div|p|br|li|ul|ol|tr|table|h[1-6]|blockquote|pre|hr|section|article|header|footer|dd|dt|dl)$/;
  // Returns { text, media: [file names in order] }. `[sound:x]` becomes media too.
  function htmlToText(html) {
    var media = [];
    var s = String(html == null ? "" : html);
    s = s.replace(/\[sound:([^\]\n]{1,300})\]/g, function (m, f) { media.push(f.trim()); return " "; });
    s = s.replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|template|svg|math|object|iframe)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<(script|style|template|svg|math|object|iframe)\b[^>]*>/gi, "");
    var out = "", lists = [], bold = 0, ital = 0;
    var re = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|(<)/g, m;
    function nl() { if (out && !/\n$/.test(out)) out += "\n"; }
    while ((m = re.exec(s))) {
      if (m[4] !== undefined || m[5] !== undefined) {
        out += entities(m[4] !== undefined ? m[4] : "<").replace(/[ \t\r\n\f]+/g, " ");
        continue;
      }
      var close = m[1] === "/", tag = m[2].toLowerCase(), attrs = m[3] || "";
      if (tag === "b" || tag === "strong") {
        if (close) { if (bold) { bold--; out = out.replace(/ +$/, ""); out += "**"; } }
        else { bold++; out += "**"; }
        continue;
      }
      if (tag === "i" || tag === "em") {
        if (close) { if (ital) { ital--; out = out.replace(/ +$/, ""); out += "*"; } }
        else { ital++; out += "*"; }
        continue;
      }
      if (tag === "img" && !close) {
        var src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
        if (src) media.push(entities(src[1] || src[2] || src[3] || "").trim());
        continue;
      }
      if ((tag === "ul" || tag === "ol") && !close) { nl(); lists.push({ k: tag, n: 0 }); continue; }
      if ((tag === "ul" || tag === "ol") && close) { lists.pop(); nl(); continue; }
      if (tag === "li" && !close) {
        nl();
        var l = lists[lists.length - 1];
        if (l && l.k === "ol") { l.n++; out += l.n + ". "; } else out += "- ";
        continue;
      }
      if (tag === "br") { out += "\n"; continue; }
      if (BLOCK.test(tag)) { nl(); continue; }
    }
    // Close marks left open, tidy spaces and blank lines.
    while (bold-- > 0) out += "**";
    while (ital-- > 0) out += "*";
    var text = out.split("\n").map(function (ln) { return ln.replace(/^ +| +$/g, "").replace(/ {2,}/g, " "); })
      .join("\n").replace(/\*\*\*\*/g, "").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
    // Empty mark pairs ("****", "**") left by empty bold tags.
    text = text.replace(/\*\*\s*\*\*/g, " ").replace(/^ +| +$/gm, "");
    var seen = {}, list = [];
    media.forEach(function (f) { if (f && !seen[f]) { seen[f] = 1; list.push(f); } });
    return { text: text.length > MAX_FIELD ? text.slice(0, MAX_FIELD) : text, media: list };
  }

  // ---------- 3. Card templates (a safe mustache subset) ----------
  // {{Field}}, {{FrontSide}}, {{#Field}}…{{/Field}}, {{^Field}}…{{/Field}},
  // filters text: / furigana: / kana: / kanji: / hint: / tts …: (the field
  // itself), cloze: (the field), type: (left out). Unknown names render "".
  function render(fmt, fields, front) {
    var s = String(fmt || "");
    function has(name) { return Object.prototype.hasOwnProperty.call(fields, name) && String(fields[name]).replace(/<[^>]*>|&nbsp;|\s/g, "") !== ""; }
    // Sections, innermost first, at most 50 rounds.
    for (var round = 0; round < 50; round++) {
      var next = s.replace(/\{\{([#^])\s*([^}]+?)\s*\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\s*\2\s*\}\}/g, function (m, kind, name, body) {
        var on = has(name.trim());
        return (kind === "#" ? on : !on) ? body : "";
      });
      if (next === s) break;
      s = next;
    }
    return s.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, function (m, expr) {
      if (expr === "FrontSide") return front || "";
      var parts = expr.split(":"), name = parts.pop().trim(), filters = parts.map(function (p) { return p.trim().split(/\s+/)[0].toLowerCase(); });
      if (filters.indexOf("type") >= 0) return "";
      return Object.prototype.hasOwnProperty.call(fields, name) ? String(fields[name]) : "";
    });
  }
  // The answer side without the question: what comes after <hr id=answer>,
  // else the template with {{FrontSide}} taken out.
  function backOnly(afmt) {
    var s = String(afmt || "");
    var m = /<hr[^>]*\bid\s*=\s*["']?answer["']?[^>]*>/i.exec(s);
    if (m) return s.slice(m.index + m[0].length);
    return s.replace(/\{\{\s*FrontSide\s*\}\}/g, "");
  }

  // ---------- 4. Reading a package ----------
  // deps = { zip: AtelierZip, sqlite: FlashcardsSqlite, zstd: fzstd }
  function readPackage(bytes, deps) {
    var Z;
    try { Z = deps.zip.open(bytes); } catch (e) { return Promise.reject(fail("notanki")); }
    var name = ["collection.anki21b", "collection.anki21", "collection.anki2"].filter(function (n) { return Z.has(n); })[0];
    if (!name) return Promise.reject(fail("notanki"));
    var modern = name === "collection.anki21b";
    function unz(b) {
      if (!b || b.length < 4) return b;
      // zstd frame magic 28 b5 2f fd
      if (b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd) return deps.zstd.decompress(b);
      return b;
    }
    return Z.bytes(name, 400 * 1024 * 1024).then(function (dbBytes) {
      var db = deps.sqlite.open(unz(dbBytes));
      var model = modern ? readModern(db) : readLegacy(db);
      model.format = modern ? "anki21b" : name === "collection.anki21" ? "anki21" : "anki2";
      return (Z.has("media") ? Z.bytes("media", 64 * 1024 * 1024) : Promise.resolve(null)).then(function (mb) {
        model.media = {};
        if (mb && mb.length) {
          var raw = unz(mb);
          if (raw[0] === 0x7b) {          // "{": JSON { "0": "name.jpg" }
            var j = {};
            try { j = JSON.parse(utf8(raw)); } catch (e) { j = {}; }
            Object.keys(j).forEach(function (k) { if (typeof j[k] === "string") model.media[j[k]] = k; });
          } else {
            (proto(raw)[1] || []).forEach(function (entry, i) {
              var m = proto(entry), nm = pstr(m, 1);
              var zipName = m[255] ? String(pnum(m, 255)) : String(i);
              if (nm) model.media[nm] = zipName;
            });
          }
        }
        model.readMedia = function (fileName, max) {
          var z = model.media[fileName];
          if (z === undefined || !Z.has(z)) return Promise.resolve(null);
          return Z.bytes(z, max || 64 * 1024 * 1024).then(unz);
        };
        return model;
      });
    });
  }
  function rows(db, table) { return db.has(table) ? db.rows(table) : []; }
  function baseModel(db) {
    var notes = rows(db, "notes").slice(0, MAX_NOTES).map(function (n) {
      return { id: n.id, guid: String(n.guid || n.id), mid: n.mid, tags: String(n.tags || ""), flds: String(n.flds || "").split(SEP) };
    });
    var cards = rows(db, "cards").map(function (c) {
      return { id: c.id, nid: c.nid, did: c.odid || c.did, ord: c.ord | 0, queue: c.queue | 0, mod: c.mod || 0 };
    });
    var revlog = rows(db, "revlog").slice(0, MAX_REVLOG).map(function (r) {
      return { id: r.id, cid: r.cid, ease: r.ease | 0, type: r.type | 0, factor: r.factor | 0, time: r.time | 0 };
    });
    return { notes: notes, cards: cards, revlog: revlog, notetypes: {}, decks: {} };
  }
  function readLegacy(db) {
    var m = baseModel(db), col = rows(db, "col")[0] || {};
    var models = {}, decks = {};
    try { models = JSON.parse(col.models || "{}") || {}; } catch (e) { models = {}; }
    try { decks = JSON.parse(col.decks || "{}") || {}; } catch (e) { decks = {}; }
    Object.keys(models).forEach(function (id) {
      var x = models[id] || {};
      m.notetypes[id] = {
        name: String(x.name || ""), kind: x.type === 1 ? "cloze" : "normal",
        fields: (x.flds || []).slice().sort(function (a, b) { return (a.ord | 0) - (b.ord | 0); }).map(function (f) { return String(f.name || ""); }),
        tmpls: (x.tmpls || []).map(function (t) { return { ord: t.ord | 0, q: String(t.qfmt || ""), a: String(t.afmt || "") }; })
      };
    });
    Object.keys(decks).forEach(function (id) {
      var d = decks[id] || {};
      m.decks[id] = String(d.name || "").split("::").map(function (s) { return s.trim(); }).filter(Boolean);
    });
    return m;
  }
  function readModern(db) {
    var m = baseModel(db);
    rows(db, "notetypes").forEach(function (t) {
      var cfg = proto(t.config instanceof Uint8Array ? t.config : new Uint8Array(0));
      m.notetypes[t.id] = { name: String(t.name || ""), kind: pnum(cfg, 1) === 1 ? "cloze" : "normal", fields: [], tmpls: [] };
    });
    rows(db, "fields").sort(function (a, b) { return a.ord - b.ord; }).forEach(function (f) {
      var nt = m.notetypes[f.ntid];
      if (nt) nt.fields[f.ord | 0] = String(f.name || "");
    });
    rows(db, "templates").forEach(function (t) {
      var nt = m.notetypes[t.ntid];
      if (!nt) return;
      var cfg = proto(t.config instanceof Uint8Array ? t.config : new Uint8Array(0));
      nt.tmpls.push({ ord: t.ord | 0, q: pstr(cfg, 1), a: pstr(cfg, 2) });
    });
    rows(db, "decks").forEach(function (d) {
      m.decks[d.id] = String(d.name || "").split(SEP).map(function (s) { return s.trim(); }).filter(Boolean);
    });
    // Older collections opened in new Anki can still carry JSON in col.
    if (!Object.keys(m.notetypes).length) {
      var legacy = readLegacy(db);
      m.notetypes = legacy.notetypes;
      if (!Object.keys(m.decks).length) m.decks = legacy.decks;
    }
    return m;
  }

  // ---------- 5. Package → Flashcards ----------
  function fieldMap(nt, flds) {
    var o = {};
    (nt.fields || []).forEach(function (name, i) { if (name) o[name] = flds[i] || ""; });
    return o;
  }
  function tagList(s) { return String(s || "").split(/\s+/).filter(Boolean); }
  function clozeField(nt, fields) {
    for (var i = 0; i < nt.tmpls.length; i++) {
      var m = /\{\{[^}]*cloze:\s*([^}]+?)\s*\}\}/.exec(nt.tmpls[i].q);
      if (m && Object.prototype.hasOwnProperty.call(fields, m[1])) return m[1];
    }
    return nt.fields[0];
  }
  // The sides of every card the package holds, before ids and decks are chosen.
  // Returns [{ guid, kind, ords: [{ankiCard, ord}], f, mediaByField, tags, did, key }].
  function convert(model) {
    var out = [], byNote = {};
    model.cards.forEach(function (c) { (byNote[c.nid] = byNote[c.nid] || []).push(c); });
    model.notes.forEach(function (n) {
      var nt = model.notetypes[n.mid], cards = (byNote[n.id] || []).sort(function (a, b) { return a.ord - b.ord; });
      if (!nt || !cards.length) return;
      var fields = fieldMap(nt, n.flds), tags = tagList(n.tags);
      var isCloze = nt.kind === "cloze" || nt.tmpls.some(function (t) { return /\{\{[^}]*cloze:/.test(t.q); });
      if (isCloze) {
        var xf = clozeField(nt, fields), x = htmlToText(fields[xf]);
        var extraHtml = nt.fields.filter(function (f) { return f && f !== xf && fields[f] && (nt.tmpls[0] ? nt.tmpls[0].a.indexOf(f) >= 0 : true); })
          .map(function (f) { return fields[f]; }).join("<br>");
        var e = htmlToText(extraHtml);
        out.push({ guid: n.guid, key: "", kind: "cloze", tags: tags, did: cards[0].did,
          f: { x: x.text, e: e.text }, media: { x: x.media, e: e.media },
          cards: cards.map(function (c) { return { card: c, ord: c.ord + 1 }; }) });
        return;
      }
      var sides = cards.map(function (c) {
        var t = nt.tmpls.filter(function (x) { return x.ord === c.ord; })[0] || nt.tmpls[0];
        if (!t) return null;
        var qh = render(t.q, fields, ""), ah = render(backOnly(t.a), fields, qh);
        var q = htmlToText(qh), a = htmlToText(ah);
        return { card: c, q: q, a: a };
      }).filter(function (s) { return s && (s.q.text || s.q.media.length); });
      if (!sides.length) return;
      if (nt.tmpls.length === 1) {
        var s0 = sides[0];
        out.push({ guid: n.guid, key: "", kind: "basic", tags: tags, did: s0.card.did,
          f: { q: s0.q.text, a: s0.a.text }, media: { q: s0.q.media, a: s0.a.media }, cards: [{ card: s0.card, ord: 0 }] });
        return;
      }
      // Two cards that mirror each other: one reversed note.
      if (sides.length === 2 && sides[0].q.text === sides[1].a.text && sides[1].q.text === sides[0].a.text) {
        out.push({ guid: n.guid, key: "", kind: "rev", tags: tags, did: sides[0].card.did,
          f: { q: sides[0].q.text, a: sides[0].a.text }, media: { q: sides[0].q.media, a: sides[0].a.media },
          cards: [{ card: sides[0].card, ord: 0 }, { card: sides[1].card, ord: 1 }] });
        return;
      }
      sides.forEach(function (s) {
        out.push({ guid: n.guid, key: "t" + s.card.ord, kind: "basic", tags: tags, did: s.card.did,
          f: { q: s.q.text, a: s.a.text }, media: { q: s.q.media, a: s.a.media }, cards: [{ card: s.card, ord: 0 }] });
      });
    });
    return out;
  }
  // Every media file name the notes use, in order.
  function mediaUsed(items) {
    var seen = {}, list = [];
    items.forEach(function (it) {
      Object.keys(it.media).forEach(function (k) {
        it.media[k].forEach(function (f) { if (!seen[f]) { seen[f] = 1; list.push(f); } });
      });
    });
    return list;
  }
  // items (convert) → { notes: [note versions], rows: [answer + flag rows], skipped, cards, answers }.
  // opts = { now, deckId(path array) → deck id, existing: notes map, media: { file name → our name }, history: bool }
  function plan(model, items, opts) {
    var now = opts.now, notes = [], rows = [], skipped = 0, cards = 0, cardKey = {};
    items.forEach(function (it) {
      var id = noteIdFor(it.guid, it.key);
      it.cards.forEach(function (c) { cardKey[c.card.id] = id + "." + c.ord; });
      if (opts.existing && opts.existing[id] && !opts.existing[id].del) { skipped++; return; }
      var md = {};
      Object.keys(it.media).forEach(function (k) {
        var list = it.media[k].map(function (f) { return opts.media ? opts.media[f] : null; }).filter(Boolean);
        if (list.length) md[k] = list;
      });
      var deckPath = model.decks[it.did] || [];
      notes.push({ id: id, m: now, k: it.kind, dk: opts.deckId(deckPath), f: it.f, tg: it.tags, md: md });
      cards += it.cards.length;
      it.cards.forEach(function (c) {
        if (c.card.queue === -1) rows.push({ i: "rs" + b36(c.card.id), c: id + "." + c.ord, t: c.card.mod > 0 ? c.card.mod * 1000 : now, f: "s" });
      });
    });
    var answers = 0;
    if (opts.history !== false) {
      model.revlog.forEach(function (r) {
        var key = cardKey[r.cid];
        if (!key || !(r.ease >= 1 && r.ease <= 4) || r.type > 3 || (r.type === 3 && !r.factor) || !(r.id > 0)) return;
        var row = { i: "ra" + b36(r.id) + "c" + b36(r.cid), c: key, t: r.id, g: r.ease };
        if (r.time > 0 && r.time < 3600000) row.ms = r.time;
        rows.push(row);
        answers++;
      });
    }
    return { notes: notes, rows: rows, skipped: skipped, cards: cards, answers: answers };
  }

  // ---------- 6. Text files: CSV, TSV, Anki plain text, Quizlet ----------
  // Anki's "#separator:Tab" style header lines are read and skipped.
  function parseText(text) {
    text = String(text == null ? "" : text).replace(/^﻿/, "");
    var lines = text.split(/\r\n|\n|\r/), meta = { html: false, sep: "", tags: -1, deck: -1 }, start = 0;
    var NAMES = { tab: "\t", comma: ",", semicolon: ";", pipe: "|", space: " ", colon: ":" };
    while (start < lines.length && /^#[a-z ]+:/i.test(lines[start])) {
      var m = /^#([a-z ]+):(.*)$/i.exec(lines[start]), k = m[1].trim().toLowerCase(), v = m[2].trim();
      if (k === "separator") meta.sep = NAMES[v.toLowerCase()] || v.slice(0, 1);
      else if (k === "html") meta.html = v === "true";
      else if (k === "tags column") meta.tags = (+v | 0) - 1;
      else if (k === "deck column") meta.deck = (+v | 0) - 1;
      start++;
    }
    var body = lines.slice(start).join("\n");
    var sep = meta.sep || sniff(body);
    var out = [], row = [], f = "", q = false;
    for (var i = 0; i < body.length; i++) {
      var ch = body[i];
      if (q) {
        if (ch === "\"") { if (body[i + 1] === "\"") { f += "\""; i++; } else q = false; }
        else f += ch;
        continue;
      }
      if (ch === "\"" && f === "") { q = true; continue; }
      if (ch === sep) { row.push(f); f = ""; continue; }
      if (ch === "\n") { row.push(f); f = ""; if (row.join("").trim()) out.push(row); row = []; if (out.length > MAX_NOTES) break; continue; }
      f += ch;
    }
    if (f !== "" || row.length) { row.push(f); if (row.join("").trim()) out.push(row); }
    var cols = out.reduce(function (n, r) { return Math.max(n, r.length); }, 0);
    return { rows: out.slice(0, MAX_NOTES), sep: sep, html: meta.html, tagsCol: meta.tags, cols: cols };
  }
  function sniff(s) {
    var head = s.slice(0, 4000), best = "\t", score = -1;
    ["\t", ";", ",", "|"].forEach(function (d) {
      var lines = head.split("\n").slice(0, 20).filter(Boolean);
      if (!lines.length) return;
      // Lines that hold the separator count most (quoted fields may span lines).
      var hit = lines.filter(function (l) { return l.indexOf(d) >= 0; }).length;
      if (hit > score) { score = hit; best = d; }
    });
    return best;
  }
  // rows + mapping { front, back, tags (-1 none), kind basic|rev, header bool, html bool }
  //   → [{ k, f, tg }] (cloze when the front has {{c1::…}}).
  function textNotes(parsed, map) {
    var list = map.header ? parsed.rows.slice(1) : parsed.rows;
    var out = [];
    list.forEach(function (r) {
      var fr = r[map.front] || "", bk = map.back >= 0 ? r[map.back] || "" : "";
      if (map.html) { fr = htmlToText(fr).text; bk = htmlToText(bk).text; }
      else { fr = fr.replace(/<br\s*\/?>/gi, "\n"); bk = bk.replace(/<br\s*\/?>/gi, "\n"); }
      fr = fr.trim(); bk = bk.trim();
      if (!fr) return;
      var tg = map.tags >= 0 ? tagList(r[map.tags]) : [];
      if (/\{\{c\d{1,3}::/.test(fr)) out.push({ k: "cloze", f: { x: fr, e: bk }, tg: tg });
      else out.push({ k: map.kind === "rev" ? "rev" : "basic", f: { q: fr, a: bk }, tg: tg });
    });
    return out;
  }

  var API = {
    MAX_NOTES: MAX_NOTES,
    proto: proto, htmlToText: htmlToText, render: render, backOnly: backOnly, noteIdFor: noteIdFor,
    readPackage: readPackage, convert: convert, mediaUsed: mediaUsed, plan: plan,
    parseText: parseText, textNotes: textNotes
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && typeof window !== "undefined") root.FlashcardsAnki = API;
})(typeof window !== "undefined" ? window : globalThis);
