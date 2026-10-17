// ============================================================
// orOS Flashcards — pure data model (FlashcardsCore), Node-tested.
//
// Where things live (OROS_BIBLE.md Part IV "FLASHCARDS v1"):
//   - slice "flashcards" (localStorage oros-flashcards-data): decks,
//     their settings and the day-start hour. Small on purpose (R30).
//   - notes (what the user writes; one note makes 1+ cards) and
//     reviews (every answer) live on the orOS disk, in files that
//     only ONE device ever writes:
//       /internal/Flashcards/Notes/<dev>-<yyyymm>.json
//       /internal/Flashcards/Reviews/<dev>-<yyyymm>.json
//     <dev> = this device's random id, <yyyymm> = UTC month. Vault
//     Drive copies them between devices and never sees two devices
//     write the same file, so nothing becomes a conflict copy.
//   - a card's schedule is NOT stored: it is the replay of its
//     answers through FSRS (fsrs.js), the same on every device.
//
// Merges (all symmetric, idempotent, associative; fuzz-tested):
//   decks: LWW per id by m (tie: tombstone, then larger canonical
//          JSON), tombstones (delete wins ties, newer edit resurrects);
//   notes: one version per id, LWW by m (tie: delete, then larger
//          canonical JSON);
//   reviews: union by id (same id twice: larger canonical JSON).
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var DAY = 86400000;
  var ROOT_DIR = "/internal/Flashcards";
  var NOTES_DIR = ROOT_DIR + "/Notes";
  var REVIEWS_DIR = ROOT_DIR + "/Reviews";
  var DEFAULT_DECK = "d0";
  var LIMITS = { decks: 500, name: 120, field: 20000, tags: 30, tag: 40, notes: 100000, reviews: 2000000 };
  var KINDS = ["basic", "rev", "cloze"];
  var DECK_ID = /^d[0-9a-z]{1,24}$/, NOTE_ID = /^n[0-9a-z]{1,24}$/, REV_ID = /^r[0-9a-z]{1,40}$/;
  var CARD_KEY = /^(n[0-9a-z]{1,24})\.(\d{1,3})$/;
  var DEV_RE = /^[0-9a-z]{4,16}$/;
  var FILE_RE = /^([0-9a-z]{4,16})-(\d{6})\.json$/;
  var MEDIA_DIR = ROOT_DIR + "/Media";
  // Media files are named by the SHA-256 of their bytes, so the same
  // picture added on two devices is one file and nothing ever conflicts.
  var MEDIA_RE = /^[0-9a-f]{64}\.(jpg|png|webp|gif|mp3|ogg|oga|opus|m4a|wav|webm)$/;
  var MEDIA_MAX = 6;          // per field
  var LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;
  var FLAGS = { s: 1, b: 1, r: 1 };   // suspend, bury (until the day ends), resume

  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function num(x, lo, hi, def) {
    x = +x;
    return isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def;
  }
  function stamp(x) { x = +x; return isFinite(x) && x > 0 ? Math.floor(x) : 0; }
  function str(x, max) {
    if (typeof x !== "string") return "";
    // Control characters out (tab and newline stay), length capped.
    x = x.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    return x.length > max ? x.slice(0, max) : x;
  }
  // Canonical JSON: keys sorted at every level (R26).
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (isObj(v)) {
      return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  function bigger(a, b) { return canon(a) >= canon(b) ? a : b; }

  // ---------- 1. Slice: decks + settings ----------
  // FLASH v1 { ver, decks:[deck], set:{m, ro}, tombs:{id: m} }
  // deck { id "d…", m, n name, par? parent id, cfg { nd new/day, rd reviews/day, ret,
  //        vq? / va? language of the front / back fields for Read aloud ("" = automatic) } }
  var CFG_DEF = { nd: 20, rd: 200, ret: 0.9 };
  function normCfg(c) {
    c = isObj(c) ? c : {};
    var out = {
      nd: Math.round(num(c.nd, 0, 9999, CFG_DEF.nd)),
      rd: Math.round(num(c.rd, 0, 99999, CFG_DEF.rd)),
      ret: Math.round(num(c.ret, 0.7, 0.99, CFG_DEF.ret) * 100) / 100
    };
    if (typeof c.vq === "string" && LANG_RE.test(c.vq)) out.vq = c.vq;
    if (typeof c.va === "string" && LANG_RE.test(c.va)) out.va = c.va;
    return out;
  }
  function normDeck(d) {
    if (!isObj(d) || typeof d.id !== "string" || !DECK_ID.test(d.id)) return null;
    var out = { id: d.id, m: stamp(d.m), n: str(d.n, LIMITS.name).replace(/\s+/g, " ").trim(), cfg: normCfg(d.cfg) };
    if (typeof d.par === "string" && DECK_ID.test(d.par) && d.par !== d.id) out.par = d.par;
    return out;
  }
  function empty() { return { ver: VER, decks: [], set: { m: 0, ro: 4 }, tombs: {} }; }
  function normalize(x) {
    var out = empty();
    if (!isObj(x)) return out;
    var byId = {};
    (Array.isArray(x.decks) ? x.decks : []).forEach(function (d) {
      d = normDeck(d);
      if (!d) return;
      byId[d.id] = byId[d.id] ? pickDeck(byId[d.id], d) : d;
    });
    if (isObj(x.tombs)) {
      Object.keys(x.tombs).forEach(function (id) {
        var m = stamp(x.tombs[id]);
        if (DECK_ID.test(id) && m) out.tombs[id] = m;
      });
    }
    out.decks = Object.keys(byId).sort().map(function (id) { return byId[id]; })
      .filter(function (d) { return !(out.tombs[d.id] >= d.m); });
    if (out.decks.length > LIMITS.decks) out.decks = out.decks.slice(0, LIMITS.decks);
    if (isObj(x.set)) out.set = { m: stamp(x.set.m), ro: Math.round(num(x.set.ro, 0, 23, 4)) };
    // Tombstones sorted by id (R26).
    var t = {};
    Object.keys(out.tombs).sort().forEach(function (id) { t[id] = out.tombs[id]; });
    out.tombs = t;
    return out;
  }
  function pickDeck(a, b) { return a.m !== b.m ? (a.m > b.m ? a : b) : bigger(a, b); }
  function merge(a, b) {
    a = normalize(a); b = normalize(b);
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (t) {
      Object.keys(t).forEach(function (id) { tombs[id] = Math.max(tombs[id] || 0, t[id]); });
    });
    return normalize({
      decks: a.decks.concat(b.decks),
      tombs: tombs,
      set: a.set.m !== b.set.m ? (a.set.m > b.set.m ? a.set : b.set) : bigger(a.set, b.set)
    });
  }
  function serialize(d) { return JSON.stringify(normalize(d)); }
  function next(m, old) { return Math.max(stamp(m), stamp(old) + 1); }

  function newId(prefix, now, rand) {
    var r = typeof rand === "string" ? rand : Math.random().toString(36).slice(2, 8);
    return prefix + Math.max(0, Math.floor(now)).toString(36) + r.replace(/[^0-9a-z]/g, "").slice(0, 8);
  }
  function addDeck(data, name, now, opts) {
    opts = opts || {};
    var d = normalize(data);
    var deck = normDeck({ id: opts.id || newId("d", now, opts.rand), m: stamp(now), n: name, par: opts.par, cfg: opts.cfg });
    if (!deck) return d;
    d.decks.push(deck);
    return normalize(d);
  }
  function updateDeck(data, id, patch, now) {
    var d = normalize(data);
    d.decks = d.decks.map(function (x) {
      if (x.id !== id) return x;
      var y = Object.assign({}, x, patch || {}, { id: id, m: next(now, x.m) });
      if (patch && "cfg" in patch) {
        y.cfg = Object.assign({}, x.cfg, patch.cfg);
        ["vq", "va"].forEach(function (k) { if (y.cfg[k] === "") delete y.cfg[k]; });
      }
      if (patch && patch.par === "") delete y.par;
      if (y.par && isAncestor(d.decks, id, y.par)) delete y.par;   // never a loop
      return normDeck(y) || x;
    });
    return normalize(d);
  }
  // True when `id` is `of` or an ancestor of it.
  function isAncestor(decks, id, of) {
    var by = {}, seen = {};
    decks.forEach(function (x) { by[x.id] = x; });
    for (var cur = of; cur && !seen[cur]; cur = by[cur] && by[cur].par) {
      if (cur === id) return true;
      seen[cur] = 1;
    }
    return false;
  }
  function removeDeck(data, id, now) {
    var d = normalize(data);
    var old = d.decks.filter(function (x) { return x.id === id; })[0];
    d.tombs[id] = Math.max(d.tombs[id] || 0, next(now, old ? old.m : 0));
    return normalize(d);
  }
  function setDayStart(data, ro, now) {
    var d = normalize(data);
    d.set = { m: next(now, d.set.m), ro: Math.round(num(ro, 0, 23, 4)) };
    return normalize(d);
  }
  // Decks as a tree, in display order: [{deck, depth}]. A deck whose
  // parent is gone (deleted on another device) shows at the top level.
  function deckTree(data) {
    var d = normalize(data), by = {}, kids = {};
    d.decks.forEach(function (x) { by[x.id] = x; });
    d.decks.forEach(function (x) {
      var p = x.par && by[x.par] && !isAncestor(d.decks, x.id, x.par) ? x.par : "";
      (kids[p] = kids[p] || []).push(x);
    });
    var out = [];
    (function walk(p, depth) {
      (kids[p] || []).sort(function (a, b) {
        var c = a.n.localeCompare(b.n);
        return c || (a.id < b.id ? -1 : 1);
      }).forEach(function (x) { out.push({ deck: x, depth: depth }); if (depth < 12) walk(x.id, depth + 1); });
    })("", 0);
    return out;
  }
  // The deck and every deck under it.
  function subtree(data, id) {
    var ids = {}, tree = deckTree(data), d = normalize(data), by = {};
    d.decks.forEach(function (x) { by[x.id] = x; });
    tree.forEach(function (t) {
      for (var cur = t.deck.id, guard = 0; cur && guard < 20; cur = by[cur] && by[cur].par, guard++) {
        if (cur === id) { ids[t.deck.id] = 1; break; }
      }
    });
    if (id === DEFAULT_DECK) ids[DEFAULT_DECK] = 1;
    return ids;
  }

  // ---------- 2. Notes (files on the disk) ----------
  // version { id "n…", m, k basic|rev|cloze, dk deck id, f {q,a} | {x,e}, tg [tags],
  //           md? { <field>: [media names] } (same field keys as f), del? 1 }
  function normMedia(md, keys) {
    if (!isObj(md)) return null;
    var out = {}, any = false;
    keys.forEach(function (k) {
      var seen = {}, list = [];
      (Array.isArray(md[k]) ? md[k] : []).forEach(function (n) {
        if (typeof n === "string" && MEDIA_RE.test(n) && !seen[n] && list.length < MEDIA_MAX) { seen[n] = 1; list.push(n); }
      });
      if (list.length) { out[k] = list; any = true; }
    });
    return any ? out : null;
  }
  function normTags(tg) {
    var seen = {}, out = [];
    (Array.isArray(tg) ? tg : []).forEach(function (t) {
      t = str(t, LIMITS.tag).replace(/\s+/g, "_").replace(/^#+/, "");
      var k = t.toLowerCase();
      if (t && !seen[k] && out.length < LIMITS.tags) { seen[k] = 1; out.push(t); }
    });
    return out.sort();
  }
  function normNote(n) {
    if (!isObj(n) || typeof n.id !== "string" || !NOTE_ID.test(n.id)) return null;
    var m = stamp(n.m);
    if (!m) return null;
    if (n.del) return { id: n.id, m: m, del: 1 };
    var k = KINDS.indexOf(n.k) >= 0 ? n.k : "basic";
    var f = isObj(n.f) ? n.f : {};
    var out = { id: n.id, m: m, k: k, dk: typeof n.dk === "string" && DECK_ID.test(n.dk) ? n.dk : DEFAULT_DECK };
    out.f = k === "cloze" ? { x: str(f.x, LIMITS.field), e: str(f.e, LIMITS.field) }
                          : { q: str(f.q, LIMITS.field), a: str(f.a, LIMITS.field) };
    out.tg = normTags(n.tg);
    var md = normMedia(n.md, k === "cloze" ? ["x", "e"] : ["q", "a"]);
    if (md) out.md = md;
    return out;
  }
  function pickNote(a, b) {
    if (a.m !== b.m) return a.m > b.m ? a : b;
    if (!!a.del !== !!b.del) return a.del ? a : b;
    return bigger(a, b);
  }
  // Fold note versions into a map id → newest version.
  function foldNotes(map, list) {
    map = map || {};
    (Array.isArray(list) ? list : []).forEach(function (n) {
      n = normNote(n);
      if (!n) return;
      map[n.id] = map[n.id] ? pickNote(map[n.id], n) : n;
    });
    return map;
  }
  function mergeNotes(a, b) {
    var map = foldNotes(foldNotes({}, a), b);
    return Object.keys(map).sort().map(function (id) { return map[id]; });
  }
  function liveNotes(map) {
    return Object.keys(map).sort().map(function (id) { return map[id]; }).filter(function (n) { return !n.del; });
  }

  // ---------- 3. Reviews (files on the disk) ----------
  // row { i "r…", c card key "n….<ord>", t ms, g 1-4, ms? answer time }
  // undo { i "r…", u reviewed row id, t ms }
  // flag { i "r…", c card key, t ms, f "s" suspend | "b" bury | "r" resume }
  // (wave-1 apps drop flag rows when they read them; they never
  // rewrite another device's file, so the rows are not lost)
  function normReview(r) {
    if (!isObj(r) || typeof r.i !== "string" || !REV_ID.test(r.i)) return null;
    var t = stamp(r.t);
    if (!t) return null;
    if (typeof r.u === "string") return REV_ID.test(r.u) ? { i: r.i, u: r.u, t: t } : null;
    if (typeof r.c !== "string" || !CARD_KEY.test(r.c)) return null;
    if (typeof r.f === "string") return FLAGS[r.f] === 1 ? { i: r.i, c: r.c, t: t, f: r.f } : null;
    var g = Math.round(+r.g);
    if (!(g >= 1 && g <= 4)) return null;
    var out = { i: r.i, c: r.c, t: t, g: g };
    var ms = Math.round(+r.ms);
    if (ms > 0 && ms < 3600000) out.ms = ms;
    return out;
  }
  function foldReviews(map, list) {
    map = map || {};
    (Array.isArray(list) ? list : []).forEach(function (r) {
      r = normReview(r);
      if (!r) return;
      map[r.i] = map[r.i] ? bigger(map[r.i], r) : r;
    });
    return map;
  }
  function revOrder(a, b) { return a.t - b.t || (a.i < b.i ? -1 : a.i > b.i ? 1 : 0); }
  function mergeReviews(a, b) {
    var map = foldReviews(foldReviews({}, a), b);
    return Object.keys(map).map(function (i) { return map[i]; }).sort(revOrder);
  }

  // ---------- 4. Files ----------
  function monthOf(ms) {
    var d = new Date(ms);
    var m = d.getUTCMonth() + 1;
    return d.getUTCFullYear() + (m < 10 ? "0" : "") + m;
  }
  function fileName(dev, ms) { return dev + "-" + monthOf(ms) + ".json"; }
  function notesPath(dev, ms) { return NOTES_DIR + "/" + fileName(dev, ms); }
  function reviewsPath(dev, ms) { return REVIEWS_DIR + "/" + fileName(dev, ms); }
  function parseFileName(name) {
    var m = FILE_RE.exec(String(name || ""));
    return m ? { dev: m[1], month: m[2] } : null;
  }
  // File text → items, or null when it is not one of ours.
  function readFile(text, kind) {
    var x;
    try { x = JSON.parse(text); } catch (e) { return null; }
    if (!isObj(x) || x.kind !== kind || !Array.isArray(x.items)) return null;
    return x.items;
  }
  function writeFile(kind, dev, items) {
    var list = kind === "notes" ? mergeNotes(items, []) : mergeReviews(items, []);
    return JSON.stringify({ v: VER, kind: kind, dev: dev, items: list });
  }
  function newDevId() {
    var s = "";
    while (s.length < 8) s += Math.random().toString(36).slice(2);
    return s.slice(0, 8);
  }

  // ---------- 5. Cards ----------
  var CLOZE_RE = /\{\{c(\d{1,3})::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
  function clozeNums(text) {
    var seen = {}, out = [], m;
    CLOZE_RE.lastIndex = 0;
    while ((m = CLOZE_RE.exec(String(text || "")))) {
      var n = +m[1];
      if (n >= 1 && n <= 500 && !seen[n]) { seen[n] = 1; out.push(n); }
    }
    return out.sort(function (a, b) { return a - b; });
  }
  // Card ords of a note: basic [0], rev [0, 1], cloze the numbers used.
  function ords(note) {
    if (!note || note.del) return [];
    if (note.k === "rev") return [0, 1];
    if (note.k === "cloze") return clozeNums(note.f.x);
    return [0];
  }
  // Segments to draw a cloze side: [{t}] text, {h hint} hidden part, {a} shown answer.
  function clozeSegments(text, ord, back) {
    var out = [], last = 0, m;
    text = String(text || "");
    CLOZE_RE.lastIndex = 0;
    while ((m = CLOZE_RE.exec(text))) {
      if (m.index > last) out.push({ t: text.slice(last, m.index) });
      if (+m[1] === ord) out.push(back ? { a: m[2] } : { h: m[3] || "" });
      else out.push({ t: m[2] });
      last = CLOZE_RE.lastIndex;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  }
  // { front, back } of one card as plain text (search, lists, tests).
  function cardText(note, ord) {
    if (!note) return { front: "", back: "" };
    if (note.k === "cloze") {
      var f = clozeSegments(note.f.x, ord, false).map(function (s) { return "t" in s ? s.t : "[" + (s.h || "…") + "]"; }).join("");
      var b = clozeSegments(note.f.x, ord, true).map(function (s) { return "t" in s ? s.t : s.a; }).join("");
      return { front: f, back: note.f.e ? b + "\n\n" + note.f.e : b };
    }
    if (note.k === "rev" && ord === 1) return { front: note.f.a, back: note.f.q };
    return { front: note.f.q, back: note.f.a };
  }
  // A note's title for lists and search: its text, plain.
  function noteTitle(note) {
    if (!note || note.del) return "";
    var s = note.k === "cloze" ? String(note.f.x).replace(CLOZE_RE, "$2") : note.f.q;
    return plain(s).replace(/\s+/g, " ").trim();
  }

  // ---------- 5b. Simple formatting ----------
  // A field is plain text with a few marks: **bold**, *italic*, and
  // lines that start with "- " (bullets) or "1. " (numbers). The app
  // draws the parts with DOM nodes and textContent, never HTML.
  // Cloze parts arrive wrapped in private-use characters (sideMarked)
  // so a gap can sit inside bold text and the other way round.
  var MK = { ans: "\uE000", ansEnd: "\uE001", gap: "\uE002", gapEnd: "\uE003" };
  var MK_ALL = /[\uE000-\uE003]/g;
  var UL_RE = /^\s*[-\u2022]\s+(.*)$/, OL_RE = /^\s*(\d{1,4})[.)]\s+(.*)$/;
  // Text → blocks: { k: "p", lines: [s] } | { k: "ul", items: [s] } | { k: "ol", start, items: [s] }
  function fmtBlocks(text) {
    var out = [], cur = null;
    String(text || "").split("\n").forEach(function (line) {
      var m;
      if ((m = UL_RE.exec(line))) {
        if (!cur || cur.k !== "ul") out.push(cur = { k: "ul", items: [] });
        cur.items.push(m[1]);
      } else if ((m = OL_RE.exec(line))) {
        if (!cur || cur.k !== "ol") out.push(cur = { k: "ol", start: +m[1], items: [] });
        cur.items.push(m[2]);
      } else {
        if (!cur || cur.k !== "p") out.push(cur = { k: "p", lines: [] });
        cur.lines.push(line);
      }
    });
    // Blank lines at the very start and end of a paragraph are dropped.
    out.forEach(function (b) {
      if (b.k !== "p") return;
      while (b.lines.length > 1 && !b.lines[0].trim()) b.lines.shift();
      while (b.lines.length > 1 && !b.lines[b.lines.length - 1].trim()) b.lines.pop();
    });
    return out.filter(function (b) { return b.k !== "p" || b.lines.join("").trim() || out.length === 1; });
  }
  // One line → runs { t, b?, i?, gap?, ans? }. An unmatched mark stays as text.
  function fmtInline(text) {
    var s = String(text || ""), out = [], st = { b: 0, i: 0, gap: 0, ans: 0 }, buf = "";
    function flush() {
      if (!buf) return;
      var r = { t: buf };
      if (st.b) r.b = 1;
      if (st.i) r.i = 1;
      if (st.gap) r.gap = 1;
      if (st.ans) r.ans = 1;
      out.push(r);
      buf = "";
    }
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === MK.ans || ch === MK.ansEnd || ch === MK.gap || ch === MK.gapEnd) {
        flush();
        if (ch === MK.ans) st.ans = 1; else if (ch === MK.ansEnd) st.ans = 0;
        else if (ch === MK.gap) st.gap = 1; else st.gap = 0;
        continue;
      }
      if (ch === "*" && s[i + 1] === "*" && (st.b || s.indexOf("**", i + 2) > i + 2)) {
        flush(); st.b = st.b ? 0 : 1; i++; continue;
      }
      if (ch === "*" && s[i + 1] !== "*" && (st.i ? true : (s[i + 1] && s[i + 1] !== " " && closesItalic(s, i + 1)))) {
        flush(); st.i = st.i ? 0 : 1; continue;
      }
      buf += ch;
    }
    flush();
    return out;
  }
  function closesItalic(s, from) {
    for (var j = from; j < s.length; j++) {
      if (s[j] === "*" && s[j + 1] === "*") { j++; continue; }
      if (s[j] === "*") return s[j - 1] !== " ";
    }
    return false;
  }
  // Marks out: for titles, search and speech.
  function plain(text) {
    return String(text || "").split("\n").map(function (line) {
      var m = UL_RE.exec(line) || OL_RE.exec(line);
      if (m) line = m[m.length - 1];
      return fmtInline(line).map(function (r) { return r.t; }).join("");
    }).join("\n").replace(MK_ALL, "");
  }
  // One side of a card as formatted text, cloze parts marked for fmtInline.
  // Returns [{ field: "q"|"a"|"x"|"e", text }] in drawing order.
  function sideMarked(note, ord, back) {
    if (!note || note.del) return [];
    function clean(s) { return String(s || "").replace(MK_ALL, ""); }
    if (note.k === "cloze") {
      var parts = clozeSegments(clean(note.f.x), ord, back).map(function (sg) {
        if ("t" in sg) return sg.t;
        if ("a" in sg) return MK.ans + sg.a + MK.ansEnd;
        return MK.gap + "[" + (sg.h || "\u2026") + "]" + MK.gapEnd;
      }).join("");
      var out = [{ field: "x", text: parts }];
      if (back && note.f.e) out.push({ field: "e", text: clean(note.f.e) });
      return out;
    }
    var f = (note.k === "rev" && ord === 1) !== !!back ? "a" : "q";
    return [{ field: f, text: clean(note.f[f]) }];
  }

  // ---------- 5c. Media ----------
  function mediaKind(name) {
    var m = MEDIA_RE.exec(String(name || ""));
    if (!m) return "";
    return /^(jpg|png|webp|gif)$/.test(m[1]) ? "img" : "aud";
  }
  var MIME_EXT = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/ogg": "ogg", "audio/opus": "opus",
    "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "m4a", "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/wave": "wav", "audio/webm": "webm", "video/webm": "webm"
  };
  // A file's media extension from its type, else its name; "" when not allowed.
  function mediaExt(mime, filename) {
    var t = String(mime || "").toLowerCase().split(";")[0].trim();
    if (MIME_EXT[t]) return MIME_EXT[t];
    var m = /\.([a-z0-9]{2,5})$/i.exec(String(filename || ""));
    var e = m ? m[1].toLowerCase() : "";
    if (e === "jpeg") e = "jpg";
    if (e === "mpga") e = "mp3";
    return /^(jpg|png|webp|gif|mp3|ogg|oga|opus|m4a|wav|webm)$/.test(e) ? e : "";
  }
  function mediaMime(name) {
    var e = (/\.([a-z0-9]+)$/.exec(String(name || "")) || [])[1] || "";
    return { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp3: "audio/mpeg",
      ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", wav: "audio/wav", webm: "audio/webm" }[e] || "";
  }
  // Size that fits inside max × max, never larger than the original.
  function fitSize(w, h, max) {
    w = Math.max(1, Math.round(+w || 1)); h = Math.max(1, Math.round(+h || 1));
    var k = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }
  // Every media name the live notes use.
  function mediaInUse(notesMap) {
    var used = {};
    Object.keys(notesMap || {}).forEach(function (id) {
      var n = notesMap[id];
      if (!n || n.del || !n.md) return;
      Object.keys(n.md).forEach(function (k) { n.md[k].forEach(function (x) { used[x] = 1; }); });
    });
    return used;
  }

  // ---------- 5d. Read aloud (local voices only) ----------
  // Only a voice installed on this device (localService === true): a
  // network voice sends the text to a server, so it is never picked.
  // Same language first (the part before "-"), then the exact tag,
  // then the system default; none → null and nothing is read.
  function localVoice(voices, lang) {
    var want = String(lang || "").toLowerCase().replace(/_/g, "-").trim();
    var base = want.split("-")[0];
    if (!voices || !base) return null;
    var best = null, score = -1;
    for (var i = 0; i < (voices.length || 0); i++) {
      var v = voices[i];
      if (!v || v.localService !== true) continue;
      var vl = String(v.lang || "").toLowerCase().replace(/_/g, "-");
      if (vl.split("-")[0] !== base) continue;
      var sc = (vl === want ? 2 : 0) + (v["default"] === true ? 1 : 0);
      if (sc > score) { score = sc; best = v; }
    }
    return best;
  }
  // Languages the local voices speak, as sorted unique tags.
  function voiceLangs(voices) {
    var seen = {};
    for (var i = 0; i < ((voices && voices.length) || 0); i++) {
      var v = voices[i];
      if (v && v.localService === true && v.lang) seen[String(v.lang).replace(/_/g, "-")] = 1;
    }
    return Object.keys(seen).sort();
  }
  // Automatic language of a text: Greek when most letters are, else `fallback`.
  function guessLang(text, fallback) {
    var s = String(text || "").slice(0, 4000);
    var gr = (s.match(/[\u0370-\u03ff\u1f00-\u1fff]/g) || []).length;
    var lat = (s.match(/[A-Za-z]/g) || []).length;
    if (gr > lat) return "el";
    return fallback && fallback !== "el" ? fallback : "en";
  }
  // Language to read one field of a note with: the deck's setting, else a guess.
  function fieldLang(note, field, deckCfg, fallback) {
    var front = field === "q" || field === "x";
    var set = deckCfg ? (front ? deckCfg.vq : deckCfg.va) : "";
    if (set) return set;
    return guessLang(note && note.f ? note.f[field] : "", fallback);
  }
  function cardKey(noteId, ord) { return noteId + "." + ord; }
  function parseKey(k) { var m = CARD_KEY.exec(String(k)); return m ? { n: m[1], o: +m[2] } : null; }

  // ---------- 6. Schedule = replay of the answers ----------
  // Returns { key: {note, ord, deck, card (FSRS state), first ms of the
  // first answer, revs count, sus suspended, bury ms it was buried or 0} }
  // for every live card.
  function schedule(data, notesMap, reviews, F, opts) {
    opts = opts || {};
    var d = normalize(data), decks = {}, out = {};
    d.decks.forEach(function (x) { decks[x.id] = x; });
    var params = {};
    function P(dk) {
      if (!params[dk]) params[dk] = F.params({ ret: decks[dk] ? decks[dk].cfg.ret : CFG_DEF.ret, fuzz: opts.fuzz !== false });
      return params[dk];
    }
    liveNotes(notesMap).forEach(function (n) {
      var dk = decks[n.dk] ? n.dk : DEFAULT_DECK;
      ords(n).forEach(function (o) {
        out[cardKey(n.id, o)] = { note: n, ord: o, deck: dk, card: F.newCard(0), first: 0, revs: 0, sus: false, bury: 0 };
      });
    });
    var undone = {};
    (reviews || []).forEach(function (r) { if (r.u) undone[r.u] = 1; });
    (reviews || []).forEach(function (r) {
      if (r.u || undone[r.i]) return;
      var c = out[r.c];
      if (!c) return;
      if (r.f) {
        c.sus = r.f === "s" ? true : r.f === "r" ? false : c.sus;
        c.bury = r.f === "b" ? r.t : r.f === "r" ? 0 : c.bury;
        return;
      }
      if (c.card.last && r.t < c.card.last) return;   // rows are sorted; equal times stay in id order
      if (opts.onAnswer) opts.onAnswer(r, c.card, c);   // stats: the card as it was before this answer
      c.card = F.next(c.card, r.t, r.g, P(c.deck));
      c.revs++;
      if (!c.first) c.first = r.t;
    });
    return out;
  }
  // Start of the study day that holds `now` (local time, day starts at `ro` o'clock).
  function dayStart(now, ro) {
    var d = new Date(now);
    d.setHours(ro || 0, 0, 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    return d.getTime();
  }
  function dayEnd(now, ro) {
    var d = new Date(dayStart(now, ro));
    d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  var LEARN_AHEAD = 20 * 60000;
  // Counts and order of study for a deck (and its sub-decks) now.
  // Returns { n new, l learning, r review, queue [keys], next ms of the next card later today or 0 }.
  function studyQueue(data, sched, reviews, deckId, now) {
    var d = normalize(data), ids = subtree(d, deckId), start = dayStart(now, d.set.ro), end = dayEnd(now, d.set.ro);
    var deck = d.decks.filter(function (x) { return x.id === deckId; })[0];
    var cfg = deck ? deck.cfg : CFG_DEF;
    var newToday = 0, revToday = 0, introduced = {}, undone = {};
    (reviews || []).forEach(function (r) { if (r.u) undone[r.u] = 1; });
    var seen = {};
    (reviews || []).forEach(function (r) {
      if (r.u || r.f || undone[r.i] || r.t < start || r.t >= end) return;
      var c = sched[r.c];
      if (!c || !ids[c.deck]) return;
      if (c.first >= start && c.first < end) { if (!introduced[r.c]) { introduced[r.c] = 1; newToday++; } }
      else if (!seen[r.c]) { seen[r.c] = 1; revToday++; }
    });
    var learn = [], rev = [], fresh = [], later = 0;
    Object.keys(sched).forEach(function (k) {
      var c = sched[k];
      if (!ids[c.deck] || c.sus || (c.bury && c.bury >= start)) return;
      var st = c.card.st;
      if (st === 0) fresh.push(k);
      else if (st === 1 || st === 3) {
        if (c.card.due <= now + LEARN_AHEAD) learn.push(k);
        else if (c.card.due < end && (!later || c.card.due < later)) later = c.card.due;
      } else if (c.card.due < end) rev.push(k);
    });
    function byDue(a, b) { return sched[a].card.due - sched[b].card.due || (a < b ? -1 : 1); }
    learn.sort(byDue); rev.sort(byDue);
    fresh.sort(function (a, b) {
      var A = parseKey(a), B = parseKey(b);
      return A.n < B.n ? -1 : A.n > B.n ? 1 : A.o - B.o;
    });
    rev = rev.slice(0, Math.max(0, cfg.rd - revToday));
    // New cards: siblings of a note are spread over days (one per note per day).
    var room = Math.max(0, cfg.nd - newToday), pickedNotes = {}, nw = [];
    Object.keys(introduced).forEach(function (k) { pickedNotes[parseKey(k).n] = 1; });
    fresh.forEach(function (k) {
      if (nw.length >= room) return;
      var n = parseKey(k).n;
      if (pickedNotes[n]) return;
      pickedNotes[n] = 1;
      nw.push(k);
    });
    // Learning first, then reviews and new cards mixed (one new after every few reviews).
    var queue = learn.slice(), ri = 0, ni = 0;
    while (ri < rev.length || ni < nw.length) {
      for (var j = 0; j < 4 && ri < rev.length; j++) queue.push(rev[ri++]);
      if (ni < nw.length) queue.push(nw[ni++]);
    }
    return { n: nw.length, l: learn.length, r: rev.length, queue: queue, next: later };
  }
  // What is waiting, for Today and the study reminder (flashcards/due.js
  // reads it; written to the device-local key oros-flashcards-due):
  // { v, at, day "YYYY-MM-DD" (the study day), n new and rv reviews +
  // learning left today (deck limits applied), nd new cards a day
  // (sum of the top decks' limits), fresh new cards in all,
  // days { "YYYY-MM-DD": reviews due that day } for the next 30 days }.
  function ymdOf(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
  }
  function dueSummary(data, sched, reviews, now) {
    var d = normalize(data), start = dayStart(now, d.set.ro), end = dayEnd(now, d.set.ro);
    var roots = deckTree(d).filter(function (x) { return x.depth === 0; }).map(function (x) { return x.deck; });
    var orphans = Object.keys(sched).some(function (k) { return sched[k].deck === DEFAULT_DECK; });
    if (orphans) roots.push({ id: DEFAULT_DECK, cfg: CFG_DEF });
    var n = 0, rv = 0, nd = 0, fresh = 0, days = {};
    roots.forEach(function (x) {
      var q = studyQueue(d, sched, reviews, x.id, now);
      n += q.n;
      rv += q.r;
      nd += x.cfg.nd;
    });
    Object.keys(sched).forEach(function (k) {
      var c = sched[k];
      if (c.sus) return;
      var st = c.card.st;
      if (!st) { fresh++; return; }
      if (c.bury && c.bury >= start) return;
      if (st === 1 || st === 3) { if (c.card.due < end) { rv++; return; } }
      if (c.card.due < end) return;           // reviews of today: in rv (limits applied)
      if (c.card.due >= end + 30 * DAY) return;
      var key = ymdOf(dayStart(c.card.due, d.set.ro));
      days[key] = (days[key] || 0) + 1;
    });
    return { v: 1, at: now, day: ymdOf(start), n: n, rv: rv, nd: nd, fresh: fresh, days: days };
  }
  // What a card is now, for the card browser:
  // "sus" suspended, "bury" buried today, "new", "learn", "due" (today), "rev" (later).
  function cardStatus(c, now, ro) {
    if (!c) return "";
    if (c.sus) return "sus";
    if (c.bury && c.bury >= dayStart(now, ro)) return "bury";
    var st = c.card.st;
    if (!st) return "new";
    if (st === 1 || st === 3) return "learn";
    return c.card.due < dayEnd(now, ro) ? "due" : "rev";
  }
  // Interval as short text parts: {n, u} with u "m" | "h" | "d" | "mo" | "y".
  function ivlParts(ms) {
    var min = Math.max(1, Math.round(ms / 60000));
    if (min < 60) return { n: min, u: "m" };
    if (min < 1440) return { n: Math.round(min / 60), u: "h" };
    var days = Math.round(min / 1440);
    if (days < 31) return { n: days, u: "d" };
    if (days < 365) return { n: Math.round(days / 30.4 * 10) / 10, u: "mo" };
    return { n: Math.round(days / 365 * 10) / 10, u: "y" };
  }

  var API = {
    VERSION: "1.2.0", VER: VER, DEFAULT_DECK: DEFAULT_DECK, ROOT_DIR: ROOT_DIR,
    NOTES_DIR: NOTES_DIR, REVIEWS_DIR: REVIEWS_DIR, MEDIA_DIR: MEDIA_DIR, MEDIA_RE: MEDIA_RE, MEDIA_MAX: MEDIA_MAX,
    LANG_RE: LANG_RE, LIMITS: LIMITS, CFG_DEF: CFG_DEF, DEV_RE: DEV_RE,
    canon: canon, empty: empty, normalize: normalize, merge: merge, serialize: serialize,
    newId: newId, addDeck: addDeck, updateDeck: updateDeck, removeDeck: removeDeck, setDayStart: setDayStart,
    deckTree: deckTree, subtree: subtree, isAncestor: isAncestor,
    normNote: normNote, foldNotes: foldNotes, mergeNotes: mergeNotes, liveNotes: liveNotes, normTags: normTags,
    normReview: normReview, foldReviews: foldReviews, mergeReviews: mergeReviews,
    monthOf: monthOf, fileName: fileName, notesPath: notesPath, reviewsPath: reviewsPath,
    parseFileName: parseFileName, readFile: readFile, writeFile: writeFile, newDevId: newDevId,
    clozeNums: clozeNums, ords: ords, clozeSegments: clozeSegments, cardText: cardText, noteTitle: noteTitle,
    cardKey: cardKey, parseKey: parseKey,
    fmtBlocks: fmtBlocks, fmtInline: fmtInline, plain: plain, sideMarked: sideMarked, MK: MK,
    mediaKind: mediaKind, mediaExt: mediaExt, mediaMime: mediaMime, fitSize: fitSize, mediaInUse: mediaInUse, normMedia: normMedia,
    localVoice: localVoice, voiceLangs: voiceLangs, guessLang: guessLang, fieldLang: fieldLang,
    schedule: schedule, dayStart: dayStart, dayEnd: dayEnd, studyQueue: studyQueue, dueSummary: dueSummary, ymdOf: ymdOf, cardStatus: cardStatus, ivlParts: ivlParts
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.FlashcardsCore = API;
})(typeof window !== "undefined" ? window : globalThis);
