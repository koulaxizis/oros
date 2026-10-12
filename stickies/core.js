// ============================================================
// orOS Sticky Notes — pure core (no DOM)
// Small coloured notes on the desktop that can ring at a time and
// fade away at a time.
//
//   Data  { ver, notes: [note], tombs: { <id>: ms } }
//   note  { id, text, color, ring, vanish, faded, ct,
//           fm: { text, color, ring, vanish, faded } }
//     text    plain text, up to 1,000 characters, line breaks kept
//     color   one of COLORS
//     ring    { at } or null: rings at that moment
//     vanish  { at, onDone } or null: fades at `at` (0 = no time),
//             and/or when the ring is answered with Done (onDone)
//     faded   0, or the moment it faded (in the Faded bin)
//     ct      created (ms), the earliest copy wins
//     fm      one stamp per field (R27: stamped at the mutation)
//   Merge: per field, the newer stamp wins, a tie goes to the larger
//   JSON (R5); tombstones: max, delete wins ties, a newer edit
//   resurrects with only the writes newer than the delete (R17); tombs older than 30 days are pruned against
//   the newest stamp in the data, never the device clock (R26).
//   Every time the engine writes (fade at the vanish time, purge of
//   the Faded bin) is computed from the data alone, so two devices
//   write identical bytes.
//
// Positions on the desktop are device-local (not here, see host.js).
// Used by the shell (stickies/host.js), the app and the tests.
// UMD: module.exports in Node, window.StickiesCore in the browser.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER  = 1;
  var MAX_LEN   = 1000;
  var MAX_NOTES = 60;
  var COLORS    = ["yellow", "pink", "green", "blue", "orange", "lilac"];
  var FIELDS    = ["text", "color", "ring", "vanish", "faded"];
  var DAY       = 86400000;
  var BIN_MS    = 7 * DAY;        // the Faded bin keeps a note 7 days
  var TOMB_MS   = 30 * DAY;
  var SNOOZE_MS = 10 * 60000;
  var ID_RE     = /^[A-Za-z0-9_-]{1,64}$/;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function stamp(v) { return isInt(v) && v > 0 ? v : 0; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function p2(n) { return (n < 10 ? "0" : "") + n; }

  // ---------- Normalising ----------
  function cleanText(s) {
    if (typeof s !== "string") return "";
    s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, " ");
    var chars = Array.from(s);                         // by characters, not halves of emoji
    if (chars.length > MAX_LEN) s = chars.slice(0, MAX_LEN).join("");
    return s.replace(/\s+$/, "");
  }
  function normColor(c) { return COLORS.indexOf(c) >= 0 ? c : COLORS[0]; }
  function normRing(r) {
    if (!r || typeof r !== "object" || !isInt(r.at) || r.at <= 0) return null;
    return { at: r.at };
  }
  function normVanish(v) {
    if (!v || typeof v !== "object") return null;
    var at = isInt(v.at) && v.at > 0 ? v.at : 0, od = v.onDone === true;
    if (!at && !od) return null;
    return { at: at, onDone: od };
  }

  function normNote(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
    var f = raw.fm && typeof raw.fm === "object" ? raw.fm : {};
    var fm = {};
    FIELDS.forEach(function (k) { fm[k] = stamp(f[k]); });
    var n = {
      id: raw.id,
      text: cleanText(raw.text),
      color: normColor(raw.color),
      ring: normRing(raw.ring),
      vanish: normVanish(raw.vanish),
      faded: stamp(raw.faded),
      ct: stamp(raw.ct),
      fm: fm
    };
    if (!mtime(n)) return null;                        // never stamped: not a real note
    return n;
  }
  function mtime(n) {
    var m = 0;
    FIELDS.forEach(function (k) { if (n.fm[k] > m) m = n.fm[k]; });
    return m;
  }
  function field(n, k) { return n[k]; }

  function newestStamp(notes, tombs) {
    var m = 0;
    notes.forEach(function (n) { var t = mtime(n); if (t > m) m = t; if (n.faded > m) m = n.faded; });
    Object.keys(tombs).forEach(function (k) { if (tombs[k] > m) m = tombs[k]; });
    return m;
  }

  function mergeNote(a, b) {
    var out = { id: a.id, text: "", color: "", ring: null, vanish: null, faded: 0, ct: 0, fm: {} };
    FIELDS.forEach(function (k) {
      var pick = a;
      if (b.fm[k] > a.fm[k]) pick = b;
      else if (b.fm[k] === a.fm[k] && JSON.stringify(field(b, k)) > JSON.stringify(field(a, k))) pick = b;
      out[k] = field(pick, k);
      out.fm[k] = pick.fm[k];
    });
    out.ct = a.ct && b.ct ? Math.min(a.ct, b.ct) : (a.ct || b.ct);
    return out;
  }

  // A note written again after a delete keeps only the writes newer
  // than the delete; older fields go back to blank. So the result does
  // not depend on the order the copies arrive in.
  var BLANK = { text: "", color: COLORS[0], ring: null, vanish: null, faded: 0 };
  function afterTomb(n, t) {
    var c = canonNote(n);
    FIELDS.forEach(function (k) {
      if (c.fm[k] <= t) { c[k] = BLANK[k]; c.fm[k] = 0; }
    });
    return c;
  }

  // Fixed key order (R26).
  function canonNote(n) {
    return {
      id: n.id, text: n.text, color: n.color,
      ring: n.ring ? { at: n.ring.at } : null,
      vanish: n.vanish ? { at: n.vanish.at, onDone: n.vanish.onDone } : null,
      faded: n.faded, ct: n.ct,
      fm: { text: n.fm.text, color: n.fm.color, ring: n.fm.ring, vanish: n.fm.vanish, faded: n.fm.faded }
    };
  }

  function merge(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (k) {
        if (!ID_RE.test(k) || !isInt(tm[k]) || tm[k] <= 0) return;
        if (!(k in tombs) || tm[k] > tombs[k]) tombs[k] = tm[k];
      });
    });
    var byId = {};
    [a.notes, b.notes].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var n = normNote(raw);
        if (!n) return;
        byId[n.id] = byId[n.id] ? mergeNote(byId[n.id], n) : n;
      });
    });
    var notes = [];
    Object.keys(byId).sort(cmpStr).forEach(function (id) {
      var n = byId[id];
      if (id in tombs) {
        if (tombs[id] >= mtime(n)) return;              // delete wins ties
        n = afterTomb(n, tombs[id]);                    // a delete erases every older write
      }
      notes.push(canonNote(n));
    });
    // Tombs stay next to a note written again after them (they still
    // erase the older writes of late copies); old ones are pruned
    // against the newest stamp in the data.
    var ref = newestStamp(notes, tombs), outTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (k) {
      if (ref - tombs[k] > TOMB_MS) return;
      outTombs[k] = tombs[k];
    });
    return { ver: DATA_VER, notes: notes, tombs: outTombs };
  }

  function empty() { return { ver: DATA_VER, notes: [], tombs: {} }; }

  // ---------- Reading ----------
  function find(data, id) {
    var list = (data && data.notes) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function live(data) { return ((data && data.notes) || []).filter(function (n) { return !n.faded; }); }
  function faded(data) {
    return ((data && data.notes) || []).filter(function (n) { return !!n.faded; })
      .sort(function (p, q) { return q.faded - p.faded || cmpStr(p.id, q.id); });
  }
  // Newest first by creation.
  function newestFirst(list) {
    return list.slice().sort(function (p, q) { return q.ct - p.ct || cmpStr(q.id, p.id); });
  }
  function isRinging(n, now) { return !!(n && !n.faded && n.ring && n.ring.at <= now); }
  function purgeAt(n) { return n.faded ? n.faded + BIN_MS : 0; }

  // ---------- Changes (each returns new data; input untouched) ----------
  function newId(rnd) {
    var r = rnd || Math.random, s = "sn-" + Date.now().toString(36) + "-";
    for (var i = 0; i < 6; i++) s += Math.floor(r() * 36).toString(36);
    return s;
  }

  // → { data, id } or { data, full: true } when MAX_NOTES live notes exist.
  function create(data, opts, now) {
    var cur = merge(data, null);
    if (live(cur).length >= MAX_NOTES) return { data: cur, full: true };
    var o = opts || {};
    var id = typeof o.id === "string" && ID_RE.test(o.id) && !find(cur, o.id) && !(o.id in cur.tombs) ? o.id : newId(o.rnd);
    var n = {
      id: id, text: cleanText(o.text || ""), color: normColor(o.color), ring: null, vanish: null,
      faded: 0, ct: now, fm: { text: now, color: now, ring: 0, vanish: 0, faded: 0 }
    };
    return { data: merge(cur, { notes: [n] }), id: id };
  }

  // One field of one note, stamped after its current stamp (R27).
  function setField(data, id, k, value, now) {
    if (FIELDS.indexOf(k) < 0) return data;
    var cur = merge(data, null), n = find(cur, id);
    if (!n) return cur;
    var v = k === "text" ? cleanText(value) : k === "color" ? normColor(value)
          : k === "ring" ? normRing(value) : k === "vanish" ? normVanish(value) : stamp(value);
    if (JSON.stringify(v) === JSON.stringify(n[k])) return cur;
    var c = canonNote(n);
    c[k] = v;
    c.fm[k] = Math.max(now, n.fm[k] + 1);
    return merge(cur, { notes: [c] });
  }
  function setText(data, id, text, now) { return setField(data, id, "text", text, now); }
  function setColor(data, id, color, now) { return setField(data, id, "color", color, now); }
  function setRing(data, id, at, now) { return setField(data, id, "ring", at ? { at: at } : null, now); }
  function setVanish(data, id, v, now) { return setField(data, id, "vanish", v, now); }

  // The ring answered: gone; with "vanish when done" the note fades now.
  function ringDone(data, id, now) {
    var cur = setRing(data, id, 0, now), n = find(cur, id);
    if (n && !n.faded && n.vanish && n.vanish.onDone) cur = fadeNow(cur, id, now);
    return cur;
  }
  function snooze(data, id, now) { return setRing(data, id, now + SNOOZE_MS, now); }

  function fadeNow(data, id, now) {
    var cur = merge(data, null), n = find(cur, id);
    if (!n || n.faded) return cur;
    var c = canonNote(n);
    c.faded = now;
    c.fm.faded = Math.max(now, n.fm.faded + 1);
    return merge(cur, { notes: [c] });
  }
  // Back to the desktop, with no vanish time left (it would fade again).
  function restore(data, id, now) {
    var cur = merge(data, null), n = find(cur, id);
    if (!n || !n.faded) return cur;
    var c = canonNote(n);
    c.faded = 0; c.fm.faded = Math.max(now, n.fm.faded + 1);
    c.vanish = null; c.fm.vanish = Math.max(now, n.fm.vanish + 1);
    if (c.ring && c.ring.at <= now) { c.ring = null; c.fm.ring = Math.max(now, n.fm.ring + 1); }
    return merge(cur, { notes: [c] });
  }
  function remove(data, id, now) {
    var cur = merge(data, null), n = find(cur, id);
    if (!n) return cur;
    var t = {}; t[id] = Math.max(now, mtime(n));
    return merge(cur, { tombs: t });
  }
  // Undo of a delete: the note as it was, every stamp moved past the
  // tomb so the copy beats it on every device.
  function revive(data, note, now) {
    var n = normNote(note);
    if (!n) return merge(data, null);
    var cur = merge(data, null), c = canonNote(n), t = Math.max(now, (cur.tombs[n.id] || 0) + 1);
    FIELDS.forEach(function (k) { c.fm[k] = t; });
    return merge(cur, { notes: [c] });
  }

  // ---------- The engine (shell tick) ----------
  // Fades every note whose vanish time has come, with stamps computed
  // from the data (faded = vanish.at), and empties the Faded bin of
  // notes older than BIN_MS (tomb = max(faded + BIN_MS, mtime)).
  // → { data, faded: [ids], purged: [ids] }
  function due(data, now) {
    var cur = merge(data, null), notes = [], tombs = {}, fadedIds = [], purged = [];
    cur.notes.forEach(function (n) {
      if (!n.faded && n.vanish && n.vanish.at && n.vanish.at <= now) {
        var c = canonNote(n);
        c.faded = n.vanish.at;
        c.fm.faded = Math.max(n.vanish.at, n.fm.faded + 1);
        notes.push(c);
        fadedIds.push(n.id);
      } else if (n.faded && purgeAt(n) <= now) {
        tombs[n.id] = Math.max(purgeAt(n), mtime(n));
        purged.push(n.id);
      }
    });
    if (!notes.length && !purged.length) return { data: cur, faded: fadedIds, purged: purged };
    return { data: merge(cur, { notes: notes, tombs: tombs }), faded: fadedIds, purged: purged };
  }
  // Notes that ring now (not faded, ring time reached).
  function ringing(data, now) {
    return live(data).filter(function (n) { return isRinging(n, now); });
  }
  // The next moment anything happens (ring, fade, purge), or 0.
  function nextEvent(data, now) {
    var next = 0;
    function take(t) { if (t > now && (!next || t < next)) next = t; }
    ((data && data.notes) || []).forEach(function (n) {
      if (n.faded) take(purgeAt(n));
      else {
        if (n.ring) take(n.ring.at);
        if (n.vanish && n.vanish.at) take(n.vanish.at);
      }
    });
    return next;
  }

  // ---------- Quick times ----------
  // Ring: "15m", "1h", "evening" (20:00 today, else tomorrow),
  // "morning" (09:00 tomorrow). Vanish: "1h", "today" (the end of
  // today), "tomorrow" (the end of tomorrow), "week" (in 7 days).
  function pick(kind, now) {
    var d = new Date(now);
    function at(addDays, h, mi) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + addDays, h, mi, 0, 0);
      return x.getTime();
    }
    switch (kind) {
      case "15m": return now + 15 * 60000;
      case "1h": return now + 3600000;
      case "evening": var e = at(0, 20, 0); return e > now ? e : at(1, 20, 0);
      case "morning": return at(1, 9, 0);
      case "today": return at(1, 0, 0) - 60000;           // 23:59
      case "tomorrow": return at(2, 0, 0) - 60000;
      case "week": return now + 7 * DAY;
    }
    return 0;
  }
  // <input type="datetime-local"> value ↔ ms (local time).
  function toLocalInput(ms) {
    if (!isInt(ms) || ms <= 0) return "";
    var d = new Date(ms);
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + "T" + p2(d.getHours()) + ":" + p2(d.getMinutes());
  }
  function fromLocalInput(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ""));
    if (!m) return 0;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  // ---------- Text ----------
  // A line that starts with "[ ]" or "[x]" is a tick box.
  var BOX_RE = /^(\s*)\[( |x|X)\]\s?/;
  function lines(text) {
    return String(text || "").split("\n").map(function (l) {
      var m = BOX_RE.exec(l);
      if (!m) return { box: false, done: false, text: l };
      return { box: true, done: m[2] !== " ", text: l.slice(m[0].length) };
    });
  }
  function toggleLine(text, i) {
    var ls = String(text || "").split("\n");
    if (i < 0 || i >= ls.length) return text;
    var m = BOX_RE.exec(ls[i]);
    if (!m) return text;
    ls[i] = m[1] + (m[2] === " " ? "[x]" : "[ ]") + " " + ls[i].slice(m[0].length);
    return ls.join("\n");
  }
  function firstLine(text) {
    var ls = lines(text);
    for (var i = 0; i < ls.length; i++) if (ls[i].text.trim()) return ls[i].text.trim();
    return "";
  }
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ς/g, "σ");
  }
  function matches(n, q) {
    var words = fold(q).split(/\s+/).filter(Boolean), f = fold(n.text);
    return words.every(function (w) { return f.indexOf(w) >= 0; });
  }
  // Every note on the desktop, blank line between notes.
  function toText(data) {
    return newestFirst(live(data)).map(function (n) { return n.text; }).join("\n\n—\n\n") + "\n";
  }

  // ---------- Placement (device-local positions) ----------
  // Positions are fractions of the desktop (x, y) plus a size in px,
  // so a resized window keeps the layout.
  var SIZE = { w: 200, h: 170, minW: 140, minH: 100, maxW: 480, maxH: 480, fold: 34 };
  function clampSize(w, h) {
    return {
      w: Math.round(Math.max(SIZE.minW, Math.min(SIZE.maxW, isFinite(w) ? w : SIZE.w))),
      h: Math.round(Math.max(SIZE.minH, Math.min(SIZE.maxH, isFinite(h) ? h : SIZE.h)))
    };
  }
  function normPos(p) {
    if (!p || typeof p !== "object") return null;
    var x = +p.x, y = +p.y;
    if (!isFinite(x) || !isFinite(y)) return null;
    var s = clampSize(+p.w, +p.h);
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), w: s.w, h: s.h,
             z: isInt(p.z) && p.z > 0 ? p.z : 1, fold: p.fold === true };
  }
  // Pixel box of a position in a W×H desktop, kept inside it.
  function box(p, W, H) {
    var h = p.fold ? SIZE.fold : p.h, w = p.fold ? Math.min(p.w, 180) : p.w;
    var left = Math.round(p.x * W), top = Math.round(p.y * H);
    left = Math.max(0, Math.min(left, Math.max(0, W - w)));
    top = Math.max(0, Math.min(top, Math.max(0, H - h)));
    return { left: left, top: top, w: w, h: h };
  }
  function overlaps(a, b) {
    return a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h;
  }
  // The first free spot for a new note: columns from the right edge,
  // top to bottom; when everything is taken, a cascade.
  function place(boxes, W, H, w, h) {
    var GAP = 12, M = 16;
    for (var col = 0; col < 8; col++) {
      var left = W - M - w - col * (w + GAP);
      if (left < M && col > 0) break;
      for (var top = M; top + h <= H - M || top === M; top += 24) {
        var b = { left: Math.max(0, left), top: top, w: w, h: h }, free = true;
        for (var i = 0; i < boxes.length; i++) if (overlaps(b, boxes[i])) { free = false; break; }
        if (free) return { x: W ? b.left / W : 0, y: H ? b.top / H : 0 };
        if (top + h > H - M) break;
      }
    }
    var k = boxes.length % 8;
    return { x: W ? Math.max(0, W - M - w - k * 24) / W : 0, y: H ? (M + k * 24) / H : 0 };
  }
  // Every note in neat columns from the right, newest first.
  function tidy(ids, sizes, W, H) {
    var GAP = 12, M = 16, out = {}, left = W - M, top = M, colW = 0;
    ids.forEach(function (id) {
      var s = sizes[id] || { w: SIZE.w, h: SIZE.h };
      if (top > M && top + s.h > H - M) { left -= colW + GAP; top = M; colW = 0; }
      colW = Math.max(colW, s.w);
      var l = Math.max(0, left - s.w);
      out[id] = { x: W ? l / W : 0, y: H ? top / H : 0 };
      top += s.h + GAP;
    });
    return out;
  }

  var api = {
    VER: DATA_VER, MAX_LEN: MAX_LEN, MAX_NOTES: MAX_NOTES, COLORS: COLORS.slice(), FIELDS: FIELDS.slice(),
    BIN_MS: BIN_MS, SNOOZE_MS: SNOOZE_MS, SIZE: SIZE, ID_RE: ID_RE,
    cleanText: cleanText, normNote: normNote, mtime: mtime, merge: merge, empty: empty,
    find: find, live: live, faded: faded, newestFirst: newestFirst, isRinging: isRinging, purgeAt: purgeAt,
    newId: newId, create: create, setField: setField, setText: setText, setColor: setColor,
    setRing: setRing, setVanish: setVanish, ringDone: ringDone, snooze: snooze, fadeNow: fadeNow,
    restore: restore, remove: remove, revive: revive,
    due: due, ringing: ringing, nextEvent: nextEvent,
    pick: pick, toLocalInput: toLocalInput, fromLocalInput: fromLocalInput,
    lines: lines, toggleLine: toggleLine, firstLine: firstLine, fold: fold, matches: matches, toText: toText,
    clampSize: clampSize, normPos: normPos, box: box, overlaps: overlaps, place: place, tidy: tidy
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StickiesCore = api;
})(typeof window !== "undefined" ? window : this);
