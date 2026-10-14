// ============================================================
// orOS Storage — pure core (OrosStorageCore), v1.0.0
// No DOM, no storage: the same file runs in the app frame, in the
// shell (warranty / return-by reminder engine, storageCheckTick) and
// in Node tests (module.exports).
//   - the strict merge row normalizer + merge (slice "storage"),
//     moved here from storage.js unchanged in behaviour; it now also
//     keeps the wave-2 fields (tags, value, dates, photos, receipt,
//     lent), each written only when set, so a row without them keeps
//     its old canonical bytes (no upload after the update)
//   - search over every level (name, note, tags, lent to) with path
//   - move rules (fixed hierarchy, cycle guard)
//   - value totals per place, the "Lent out" list
//   - reminder alerts (warranty end 30 → 7 → 0 days, return-by date)
//   - box deep links (QR labels) and file names on the orOS disk
// ============================================================
(function (root) {
  "use strict";

  var LEVELS = {
    space:     { child: "room",      parent: null,        depth: 0 },
    room:      { child: "furniture", parent: "space",     depth: 1 },
    furniture: { child: "position",  parent: "room",      depth: 2 },
    position:  { child: "item",      parent: "furniture", depth: 3 },
    item:      { child: null,        parent: "position",  depth: 4 }
  };
  var NOTE_MAX = 300;
  var TAG_MAX = 10, TAG_LEN = 30;
  var LENT_LEN = 80;
  var PH_MAX = 4;
  var CENTS_MAX = 99999999999;          // just under a billion
  var TOMB_PRUNE_DAYS = 30;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var PHOTO_DIR = "/internal/Storage/Photos";
  var RC_DIR = "/internal/Storage/Receipts";
  var PH_RE = /^[a-z0-9]{4,40}-[a-z0-9]{4,12}\.jpg$/;
  var RC_RE = /^[a-z0-9]{4,40}-[a-z0-9]{4,12}\.(jpg|pdf)$/;
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "CAD", "AUD", "JPY"];
  var WARR_STEPS = [30, 7, 0];

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v) { return typeof v === "string" ? v : ""; }
  function oneLine(v, max) {
    return str(v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }

  // ---------- dates (local calendar days, "YYYY-MM-DD") ----------
  function isYmd(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function dayNum(s) { return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS); }
  // whole days from a to b (b later → positive)
  function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
  function ymdOf(d) {
    var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  }

  // ---------- field cleaners (deterministic: no clock, no random) ----------
  function fold(s) {
    s = String(s || "").toLowerCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s.replace(/ς/g, "σ");
  }
  // "#Winter, camping;  tools" or ["winter", …] → ["Winter", "camping", "tools"]
  function cleanTags(v) {
    var list = Array.isArray(v) ? v : (typeof v === "string" ? v.split(/[,;\n]/) : []);
    var out = [], seen = {};
    for (var i = 0; i < list.length && out.length < TAG_MAX; i++) {
      var t = oneLine(list[i], 200).replace(/^#+/, "").trim().slice(0, TAG_LEN).trim();
      if (!t) continue;
      var k = fold(t);
      if (seen[k]) continue;
      seen[k] = true;
      out.push(t);
    }
    return out;
  }
  function cleanCents(v) {
    if (typeof v !== "number" || !isFinite(v) || v <= 0) return 0;
    return Math.min(CENTS_MAX, Math.round(v));
  }
  // "1.234,50" / "1,234.50" / "12,5" / "12" → cents; "" → 0; junk → null
  function parseMoney(s) {
    s = String(s == null ? "" : s).replace(/[\s €$£]/g, "");
    if (!s) return 0;
    if (!/^\d[\d.,]*$/.test(s)) return null;
    var lastC = s.lastIndexOf(","), lastD = s.lastIndexOf("."), dec = -1;
    var sep = lastC > lastD ? lastC : lastD;
    if (sep >= 0) {
      var tail = s.length - sep - 1;
      if (tail === 0) return null;
      // the last separator followed by exactly 3 digits groups thousands
      dec = tail === 3 ? -1 : sep;
    }
    var intPart = (dec >= 0 ? s.slice(0, dec) : s).replace(/[.,]/g, "");
    var frac = dec >= 0 ? s.slice(dec + 1) : "";
    if (/[.,]/.test(frac)) return null;
    if (!intPart) intPart = "0";
    var c = parseInt(intPart, 10) * 100 + (frac ? Math.round(parseFloat("0." + frac) * 100) : 0);
    if (!isFinite(c) || c > CENTS_MAX) return null;
    return c;
  }
  function cleanLent(v) {
    if (!v || typeof v !== "object") return null;
    var to = oneLine(v.to, LENT_LEN);
    if (!to || !isYmd(v.on)) return null;
    var out = { to: to, on: v.on };
    if (isYmd(v.due)) out.due = v.due;
    return out;
  }
  function cleanPhotos(v) {
    var out = [];
    if (Array.isArray(v)) v.forEach(function (n) {
      if (typeof n === "string" && PH_RE.test(n) && out.indexOf(n) < 0 && out.length < PH_MAX) out.push(n);
    });
    return out;
  }

  // The wave-2 fields of a row, in a fixed key order, each present only
  // when set. Shared by the local normalizer (storage.js entDefaults)
  // and mergeRow, so load and merge agree byte for byte.
  function extras(raw, type, into) {
    var e = into || {};
    if (type !== "item") {
      var n = typeof raw.note === "string" ? raw.note.slice(0, NOTE_MAX) : "";
      if (n.trim()) e.note = n;
    }
    var tags = cleanTags(raw.tags);
    if (tags.length) e.tags = tags;
    if (type === "item") {
      var val = cleanCents(raw.val);
      if (val) e.val = val;
      if (isYmd(raw.bought)) e.bought = raw.bought;
      if (isYmd(raw.warr)) e.warr = raw.warr;
      var ph = cleanPhotos(raw.ph);
      if (ph.length) e.ph = ph;
      if (typeof raw.rc === "string" && RC_RE.test(raw.rc)) e.rc = raw.rc;
      var lent = cleanLent(raw.lent);
      if (lent) e.lent = lent;
    }
    return e;
  }

  // ---------- merge (slice "storage") ----------
  // STRICT merge-side normalizer: NO volatile values — no uid(), no
  // Date.now(). Any row missing a valid id / type / mtime is DROPPED:
  // a dropped row is a deterministic outcome on every device.
  function mergeRow(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !raw.id) return null;
    if (!has(LEVELS, raw.type)) return null;
    if (!(typeof raw.mtime === "number" && isFinite(raw.mtime))) return null;
    var e = {
      id:       raw.id,
      type:     raw.type,
      name:     (typeof raw.name === "string") ? raw.name : "",
      bi:       (raw.bi && typeof raw.bi === "object" &&
                 (raw.bi.en || raw.bi.el)) ? { en: raw.bi.en || "", el: raw.bi.el || "" } : null,
      parentId: (typeof raw.parentId === "string" && raw.parentId) ? raw.parentId : null,
      pos:      (typeof raw.pos === "number" && isFinite(raw.pos)) ? raw.pos : 0,
      mtime:    raw.mtime,
      del:      !!raw.del
    };
    if (raw.type === "item") {
      e.qty = (typeof raw.qty === "number" && isFinite(raw.qty) && raw.qty >= 1)
                ? Math.max(1, Math.floor(raw.qty)) : 1;
      e.note = (typeof raw.note === "string") ? raw.note.slice(0, NOTE_MAX) : undefined;
    }
    return extras(raw, raw.type, e);
  }

  // Same id, same mtime, same del and qty, different content: the row
  // with MORE canonical JSON wins (a copy that went through an older
  // app version lost its wave-2 fields; plain "larger string" would
  // pick that one, since "}" sorts after ","), then the larger string.
  function richer(a, b) {
    var ja = JSON.stringify(a), jb = JSON.stringify(b);
    if (ja.length !== jb.length) return ja.length > jb.length ? a : b;
    return ja >= jb ? a : b;
  }
  // union by id · LWW by mtime (the whole row) · tombstone wins ties ·
  // then bigger qty · then the richer canonical JSON. Identical inputs
  // yield identical output on every device.
  function mergeEnts(localArr, remoteArr) {
    var map = {}, i, r, l, ex;
    for (i = 0; i < remoteArr.length; i++) {
      r = mergeRow(remoteArr[i]);
      if (r) map[r.id] = r;
    }
    for (i = 0; i < localArr.length; i++) {
      l = mergeRow(localArr[i]);
      if (!l) continue;
      ex = map[l.id];
      if (!ex) { map[l.id] = l; continue; }
      if (l.mtime > ex.mtime) map[l.id] = l;
      else if (l.mtime < ex.mtime) map[l.id] = ex;
      else if (l.del !== ex.del) map[l.id] = l.del ? l : ex;
      else if (typeof l.qty === "number" && typeof ex.qty === "number" &&
               l.qty !== ex.qty) map[l.id] = l.qty > ex.qty ? l : ex;
      else map[l.id] = richer(l, ex);
    }
    var out = [];
    for (var k in map) if (has(map, k)) out.push(map[k]);
    out.sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
    return out;
  }
  // tombstones older than the dataset's newest mtime minus 30 days
  // leave the payload (same data → same bytes everywhere)
  function prunePayload(ents) {
    var maxTs = 0, i, out = [];
    for (i = 0; i < ents.length; i++) if ((ents[i].mtime || 0) > maxTs) maxTs = ents[i].mtime;
    var cutoff = maxTs - TOMB_PRUNE_DAYS * DAY_MS;
    for (i = 0; i < ents.length; i++) {
      if (ents[i].del && ents[i].mtime < cutoff) continue;
      out.push(ents[i]);
    }
    return out;
  }
  function mergeData(local, remote) {
    if (!local || !remote) return remote || local || null;
    return {
      ver: Math.max(local.ver || 1, remote.ver || 1),
      ents: prunePayload(mergeEnts(local.ents || [], remote.ents || []))
    };
  }

  // ---------- index + paths ----------
  function nameOf(e, lang) {
    if (!e) return "";
    if (e.name) return e.name;
    if (e.bi) return lang === "el" ? (e.bi.el || e.bi.en) : (e.bi.en || e.bi.el);
    return "";
  }
  // { byId, kids: {parentId|"": [live child, …] sorted by pos} }
  function index(ents) {
    var byId = {}, kids = {};
    (ents || []).forEach(function (e) {
      if (e && typeof e.id === "string" && has(LEVELS, e.type) && !has(byId, e.id)) byId[e.id] = e;
    });
    Object.keys(byId).forEach(function (id) {
      var e = byId[id];
      if (e.del) return;
      var p = e.parentId || "";
      (kids[p] = kids[p] || []).push(e);
    });
    Object.keys(kids).forEach(function (p) {
      kids[p].sort(function (a, b) { return a.pos - b.pos || (a.id < b.id ? -1 : 1); });
    });
    return { byId: byId, kids: kids };
  }
  function idx(x) { return x && x.byId ? x : index(x); }
  // live ancestors, root first; null when the row or a parent is
  // deleted or missing, a parent is not of the level above (the app
  // never shows such a row), or the chain loops
  function chain(x, id) {
    var I = idx(x), e = I.byId[id], out = [], seen = {};
    if (!e || e.del) return null;
    while (e.parentId) {
      if (seen[e.id]) return null;
      seen[e.id] = true;
      var want = LEVELS[e.type].parent;
      e = I.byId[e.parentId];
      if (!e || e.del || e.type !== want) return null;   // the levels are fixed
      out.unshift(e);
    }
    if (LEVELS[e.type].parent) return null;   // a root that is not a space
    return out;
  }
  function pathNames(x, id, lang) {
    var c = chain(x, id);
    return c ? c.map(function (e) { return nameOf(e, lang); }) : null;
  }
  function isAlive(x, id) { return chain(x, id) !== null; }
  function descendants(x, id) {
    var I = idx(x), out = [], stack = [id], seen = {};
    while (stack.length) {
      var p = stack.pop();
      if (seen[p]) continue;
      seen[p] = true;
      (I.kids[p] || []).forEach(function (c) { out.push(c); stack.push(c.id); });
    }
    return out;
  }

  // ---------- search ----------
  // Every word must appear in name, note, tags or "lent to". Live rows
  // only. Ranked: name starts with the query > a name word starts with
  // it > name contains it > the rest; then by path. → [{ id, type,
  // name, path: [names], tags, note, lent, field }]
  function search(x, q, lang, limit) {
    var I = idx(x), words = fold(q).split(/\s+/).filter(Boolean), out = [];
    if (!words.length) return out;
    var whole = words.join(" ");
    Object.keys(I.byId).forEach(function (id) {
      var e = I.byId[id];
      if (e.del) return;
      var path = pathNames(I, id, lang);
      if (!path) return;
      var name = nameOf(e, lang);
      var fn = fold(name), fnote = fold(e.note), ftags = fold((e.tags || []).join(" ")),
          flent = e.lent ? fold(e.lent.to) : "";
      var hay = fn + "\n" + fnote + "\n" + ftags + "\n" + flent;
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return;
      var rank = fn.indexOf(whole) === 0 ? 0 : ((" " + fn).indexOf(" " + whole) >= 0 ? 1 : (fn.indexOf(whole) >= 0 ? 2 : 3));
      var field = "name";
      if (rank === 3) {
        field = words.some(function (w) { return ftags.indexOf(w) >= 0; }) ? "tags"
          : (words.some(function (w) { return fnote.indexOf(w) >= 0; }) ? "note" : (flent ? "lent" : "name"));
      }
      out.push({ id: id, type: e.type, name: name, path: path, tags: (e.tags || []).slice(),
                 note: typeof e.note === "string" ? e.note : "", lent: e.lent || null, field: field, _r: rank });
    });
    out.sort(function (a, b) {
      return a._r - b._r || LEVELS[a.type].depth - LEVELS[b.type].depth ||
        (a.path.join("\u0001") + "\u0001" + a.name).localeCompare(b.path.join("\u0001") + "\u0001" + b.name) ||
        (a.id < b.id ? -1 : 1);
    });
    out.forEach(function (r) { delete r._r; });
    return limit ? out.slice(0, limit) : out;
  }

  // ---------- move ----------
  // The hierarchy is fixed: an item goes into a position, a position
  // onto furniture, furniture into a room, a room into a space. Spaces
  // do not move. Never into itself or anything inside it (cycle guard,
  // kept even though the levels make it unlikely), never onto a dead
  // row. → null when allowed, else a reason code.
  function moveError(x, id, targetId) {
    var I = idx(x), e = I.byId[id], tg = I.byId[targetId];
    if (!e || !isAlive(I, id)) return "gone";
    var want = LEVELS[e.type].parent;
    if (!want) return "root";
    if (!tg || !isAlive(I, targetId)) return "target";
    if (tg.type !== want) return "level";
    if (targetId === id) return "cycle";
    var c = chain(I, targetId);
    for (var i = 0; i < c.length; i++) if (c[i].id === id) return "cycle";
    if (e.parentId === targetId) return "same";
    return null;
  }
  // every live row this one may move into, in tree order
  function moveTargets(x, id) {
    var I = idx(x), out = [];
    (function walk(p) {
      (I.kids[p] || []).forEach(function (c) {
        if (c.type === "item") return;
        if (!moveError(I, id, c.id)) out.push(c.id);
        if (c.id !== id) walk(c.id);
      });
    })("");
    return out;
  }

  // ---------- totals + lent ----------
  // { id: { v: cents (value × quantity of every live item inside),
  //   n: items inside } }; "" = everything
  function totals(x) {
    var I = idx(x), out = {};
    function walk(p) {
      var t = { v: 0, n: 0 };
      (I.kids[p] || []).forEach(function (c) {
        if (c.type === "item") {
          t.v += (c.val || 0) * (c.qty || 1);
          t.n += 1;
        } else {
          var s = walk(c.id);
          t.v += s.v; t.n += s.n;
        }
      });
      out[p] = t;
      return t;
    }
    walk("");
    return out;
  }
  // live items lent out, the earliest return-by first (overdue at the
  // top), then those without one by lent date
  function lentList(x, lang) {
    var I = idx(x), out = [];
    Object.keys(I.byId).forEach(function (id) {
      var e = I.byId[id];
      if (e.type !== "item" || e.del || !e.lent) return;
      var path = pathNames(I, id, lang);
      if (!path) return;
      out.push({ id: id, name: nameOf(e, lang), path: path, to: e.lent.to, on: e.lent.on, due: e.lent.due || "" });
    });
    out.sort(function (a, b) {
      if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
      if (!!a.due !== !!b.due) return a.due ? -1 : 1;
      return a.on < b.on ? -1 : (a.on > b.on ? 1 : (a.id < b.id ? -1 : 1));
    });
    return out;
  }

  // ---------- reminders ----------
  // warranty end: one step each at 30 and 7 days before and on the day
  // (an end passed less than 8 days ago still counts as "ended"); a
  // return-by date: once, from the day on (up to 30 days late).
  // → [{ key, step, kind "w"|"l", id, days }]; key changes with the date
  function alerts(x, today) {
    var I = idx(x), out = [];
    if (!isYmd(today)) return out;
    Object.keys(I.byId).sort().forEach(function (id) {
      var e = I.byId[id];
      if (e.type !== "item" || e.del || !isAlive(I, id)) return;
      if (e.warr) {
        var d = daysBetween(today, e.warr), step = null;
        for (var i = 0; i < WARR_STEPS.length; i++) if (d <= WARR_STEPS[i]) step = WARR_STEPS[i];
        if (step !== null && d >= -7) out.push({ key: "w:" + id + ":" + e.warr, step: step, kind: "w", id: id, days: d });
      }
      if (e.lent && e.lent.due) {
        var dl = daysBetween(today, e.lent.due);
        if (dl <= 0 && dl >= -30) out.push({ key: "l:" + id + ":" + e.lent.due, step: 0, kind: "l", id: id, days: dl });
      }
    });
    return out;
  }
  // the alerts not yet announced at this step or a lower one
  function toNotify(list, notified) {
    var n = notified && typeof notified === "object" ? notified : {};
    return list.filter(function (a) {
      return !(has(n, a.key) && typeof n[a.key] === "number" && n[a.key] <= a.step);
    });
  }
  function alertLine(a, x, lang) {
    var I = idx(x), e = I.byId[a.id], name = nameOf(e, lang), el = lang === "el";
    if (a.kind === "l") {
      var who = e && e.lent ? e.lent.to : "";
      return el ? name + ": επιστροφή από " + who + (a.days < 0 ? " (καθυστερεί)" : " σήμερα")
                : name + ": due back from " + who + (a.days < 0 ? " (late)" : " today");
    }
    if (a.days > 1) return el ? name + ": η εγγύηση λήγει σε " + a.days + " ημέρες" : name + ": warranty ends in " + a.days + " days";
    if (a.days === 1) return el ? name + ": η εγγύηση λήγει αύριο" : name + ": warranty ends tomorrow";
    if (a.days === 0) return el ? name + ": η εγγύηση λήγει σήμερα" : name + ": warranty ends today";
    return el ? name + ": η εγγύηση έληξε" : name + ": warranty has ended";
  }

  // ---------- device-local prefs (oros-storage-prefs) ----------
  function readPrefs(p) {
    p = p && typeof p === "object" ? p : {};
    var r = typeof p.remind === "number" && isFinite(p.remind) ? Math.floor(p.remind) : -1;
    return {
      remind: r >= 0 && r <= 23 ? r : -1,          // off by default
      cur: CURRENCIES.indexOf(p.cur) >= 0 ? p.cur : "EUR"
    };
  }
  function money(cents, cur, lang) {
    var v = (cents || 0) / 100, c = CURRENCIES.indexOf(cur) >= 0 ? cur : "EUR";
    try {
      return new Intl.NumberFormat(lang === "el" ? "el-GR" : "en-GB", { style: "currency", currency: c }).format(v);
    } catch (e) { return v.toFixed(2) + " " + c; }
  }

  // ---------- box deep links (QR labels) ----------
  // base = the app page's folder URL ("https://host/storage/")
  function boxLink(base, id) {
    if (typeof base !== "string" || !ID_RE.test(String(id))) return null;
    return base.replace(/[?#].*$/, "").replace(/[^/]*$/, "") + "?box=" + encodeURIComponent(id);
  }
  // a scanned text → the box id, or null. Accepts our own links
  // (any host: a label printed on another install still names the box)
  // and the bare "?box=<id>" query the shell hands back (DL-1 app-at).
  function parseBox(text) {
    var s = String(text || "").trim();
    if (!s || s.length > 2000) return null;
    var m = /^(?:https?:\/\/[^\s?#]+\/storage\/(?:index\.html)?)?\?(?:[^#]*&)?box=([^&#]+)/.exec(s);
    if (!m) return null;
    var id;
    try { id = decodeURIComponent(m[1]); } catch (e) { return null; }
    return ID_RE.test(id) ? id : null;
  }

  // ---------- files on the orOS disk ----------
  function fileStem(id) { return String(id || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40); }
  function photoName(itemId, rnd) {
    var s = fileStem(itemId), r = String(rnd || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
    if (s.length < 4 || r.length < 4) return null;
    return s + "-" + r + ".jpg";
  }
  function receiptName(itemId, rnd, ext) {
    var n = photoName(itemId, rnd);
    return n ? n.replace(/\.jpg$/, ext === "pdf" ? ".pdf" : ".jpg") : null;
  }
  function photoPath(name) { return typeof name === "string" && PH_RE.test(name) ? PHOTO_DIR + "/" + name : null; }
  function receiptPath(name) { return typeof name === "string" && RC_RE.test(name) ? RC_DIR + "/" + name : null; }
  // every file name a row still points at (deleted rows excluded)
  function filesInUse(x) {
    var I = idx(x), ph = {}, rc = {};
    Object.keys(I.byId).forEach(function (id) {
      var e = I.byId[id];
      if (e.del) return;
      (e.ph || []).forEach(function (n) { ph[n] = true; });
      if (e.rc) rc[e.rc] = true;
    });
    return { ph: ph, rc: rc };
  }

  var api = {
    VERSION: "1.0.0",
    LEVELS: LEVELS, NOTE_MAX: NOTE_MAX, TAG_MAX: TAG_MAX, TAG_LEN: TAG_LEN, LENT_LEN: LENT_LEN,
    PH_MAX: PH_MAX, CURRENCIES: CURRENCIES, PHOTO_DIR: PHOTO_DIR, RC_DIR: RC_DIR,
    isYmd: isYmd, daysBetween: daysBetween, ymdOf: ymdOf, fold: fold,
    cleanTags: cleanTags, cleanCents: cleanCents, parseMoney: parseMoney, cleanLent: cleanLent,
    cleanPhotos: cleanPhotos, extras: extras,
    mergeRow: mergeRow, mergeEnts: mergeEnts, prunePayload: prunePayload, mergeData: mergeData,
    nameOf: nameOf, index: index, chain: chain, pathNames: pathNames, isAlive: isAlive, descendants: descendants,
    search: search, moveError: moveError, moveTargets: moveTargets,
    totals: totals, lentList: lentList,
    alerts: alerts, toNotify: toNotify, alertLine: alertLine,
    readPrefs: readPrefs, money: money,
    boxLink: boxLink, parseBox: parseBox,
    photoName: photoName, receiptName: receiptName, photoPath: photoPath, receiptPath: receiptPath, filesInUse: filesInUse
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosStorageCore = api;
})(typeof window !== "undefined" ? window : this);
