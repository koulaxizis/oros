// ============================================================
// orOS To-Do — CalDAV mapper (todo/dav.js), CalDAV wave 5
// Turns one task on the person's CalDAV server (the .ics text of one
// VTODO) into a To-Do task or subtask and back, for the sync engine
// (../davsync.js). Pure: no DOM, no storage, no network. Browser:
// window.OrosTodoDav. Node: module.exports (tests/todo-dav.test.js).
//
//   mapper(colUrl, { mark, now }) → the engine's `map`:
//     read(text) → null (no VTODO: an event, not ours)
//                | { uid, main, ro, mtime }
//     write(item, raw) → text | null (null: cannot be written exactly)
//     hash(item), idFor(uid, key), file(id), copy(item), mtime(item)
//   proj(item), catKey(name), parentId(colUrl, uid), uidOf(text)
//
// The item both sides compare (the To-Do app builds it from a task or
// a subtask, todo.js tdItem):
//   { id, text, notes, due, prio (1..4), done, rec, cats: [label name],
//     sub (a subtask), puid (its parent's UID, for a new one), mtime }
// A subtask holds a text and a tick only, so a server task is one
// (sub: true) only when it has a parent (RELATED-TO, RELTYPE=PARENT)
// and nothing else a subtask cannot keep; the parent is not part of
// the hash (orOS never moves a subtask to another task).
//
// DAV-4 (lossless): a write patches the server's own text, and only
// the property groups whose value changed: SUMMARY; DESCRIPTION; DUE
// (a date-time keeps its time of day and zone); PRIORITY (P1 1, P2 5,
// P3 9; 1-4 / 5 / 6-9 read back the same, so an unchanged one stays as
// it was); STATUS + COMPLETED + PERCENT-COMPLETE; RRULE + X-OROS-
// AFTER-DONE ("repeat after completion", which iCalendar has no word
// for); CATEGORIES. DTSTAMP, LAST-MODIFIED and SEQUENCE always move.
// VALARM, RELATED-TO, DTSTART, X-* and every other line stay.
// What orOS cannot keep exactly (vtodo.js read: cut) is read-only.
// Every write is read back first; it goes out only when it reads as
// exactly the item (DAV-6).
// ============================================================
(function (root) {
  "use strict";

  var V = (root && root.OrosVtodo) || (typeof require === "function" ? require("./vtodo.js") : null);

  function fnv(s, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function hash16(s) { s = String(s); return fnv(s, 2166136261) + fnv(s, 0x9747b28c); }

  function catKey(n) { return String(n || "").normalize("NFC").trim().toLowerCase(); }
  function cleanText(s) { return String(s == null ? "" : s).replace(/\s*[\r\n]+\s*/g, " ").trim().slice(0, V.LIM.text); }
  function cleanNotes(s) { return String(s == null ? "" : s).replace(/\r\n|\r/g, "\n").replace(/\s+$/, "").slice(0, V.LIM.notes); }

  // The fields the sync compares, in one canonical form.
  function proj(it) {
    var cats = [];
    (Array.isArray(it.cats) ? it.cats : []).forEach(function (c) {
      var k = catKey(c);
      if (k && cats.indexOf(k) === -1) cats.push(k);
    });
    cats.sort();
    var p = it.prio === 1 || it.prio === 2 || it.prio === 3 ? it.prio : 4;
    return {
      text: cleanText(it.text), notes: cleanNotes(it.notes),
      due: typeof it.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.due) ? it.due : null,
      prio: p, done: !!it.done, rec: V.normRec(it.rec), cats: cats
    };
  }
  function ownId(uid) {
    var m = String(uid || "").match(/^(.+)@oros\.todo$/);
    return m && /^[A-Za-z0-9_-]{1,64}$/.test(m[1]) ? m[1] : null;
  }
  function davId(colUrl, key) { return "dav-" + hash16(colUrl + "\n" + key); }
  // The orOS id a parent UID has here (the same rule as idFor, which
  // the engine follows for every new server item).
  function parentId(colUrl, uid) { return ownId(uid) || davId(colUrl, uid); }
  function uidOf(text) {
    var bs = V.blocks(V.unfold(text)), p = bs.length ? V.first(bs[0], "UID") : null;
    return p ? p.value.trim() : "";
  }

  function catLine(cats) { return "CATEGORIES:" + cats.map(V.esc).join(","); }

  function mapper(colUrl, opts) {
    opts = opts || {};
    var mark = opts.mark || " (conflict)";
    var now = opts.now || function () { return Date.now(); };

    function hash(it) { return hash16(JSON.stringify(proj(it))); }

    function read(text) {
      var r = V.read(text);
      if (!r) return null;
      var main = { text: r.text, notes: r.notes, due: r.due, prio: r.prio, done: r.done, rec: r.rec, cats: r.cats,
                   sub: !!(r.puid && r.plain), puid: r.puid };
      return { uid: r.uid, main: main, ro: r.cut, mtime: r.mtime };
    }

    // The lines of each group, for a new value.
    function groupLines(g, p, it, oldDue) {
      if (g === "text") return ["SUMMARY:" + V.esc(p.text)];
      if (g === "notes") return p.notes ? ["DESCRIPTION:" + V.esc(p.notes)] : [];
      if (g === "due") return p.due ? [V.dueLine(p.due, oldDue)] : [];
      if (g === "prio") return p.prio < 4 ? ["PRIORITY:" + V.prioValue(p.prio)] : [];
      if (g === "done") {
        return p.done ? ["STATUS:COMPLETED", "COMPLETED:" + V.utc(now()), "PERCENT-COMPLETE:100"] : ["STATUS:NEEDS-ACTION"];
      }
      if (g === "rec") {
        if (!p.rec) return [];
        var L = ["RRULE:" + V.ruleValue(p.rec)];
        if (p.rec.after) L.push("X-OROS-AFTER-DONE:TRUE");
        return L;
      }
      if (g === "cats") {
        // The names as this side has them (case kept).
        var seen = {}, names = [];
        (it.cats || []).forEach(function (c) {
          var k = catKey(c);
          if (k && !seen[k]) { seen[k] = 1; names.push(String(c).trim()); }
        });
        return names.length ? [catLine(names)] : [];
      }
      return [];
    }
    var GROUPS = {
      text: ["SUMMARY"], notes: ["DESCRIPTION"], due: ["DUE"], prio: ["PRIORITY"],
      done: ["STATUS", "COMPLETED", "PERCENT-COMPLETE"], rec: ["RRULE", "X-OROS-AFTER-DONE"], cats: ["CATEGORIES"]
    };
    var ORDER = ["text", "notes", "due", "prio", "done", "rec", "cats"];

    function build(it) {
      var p = proj(it), stamp = V.utc(now());
      var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//orOS//To-Do//EN", "BEGIN:VTODO",
               "UID:" + V.esc(it.id) + "@oros.todo", "DTSTAMP:" + stamp, "CREATED:" + stamp, "LAST-MODIFIED:" + stamp];
      ORDER.forEach(function (g) { L = L.concat(groupLines(g, p, it, null)); });
      if (it.sub && it.puid) L.push("RELATED-TO;RELTYPE=PARENT:" + it.puid);
      L.push("END:VTODO", "END:VCALENDAR");
      return L.map(V.fold).join("\r\n") + "\r\n";
    }

    function patch(raw, it) {
      var lines = V.unfold(raw), bs = V.blocks(lines);
      if (bs.length !== 1) return null;
      var b = bs[0], old = V.read(raw);
      if (!old || old.cut) return null;
      var po = proj(old), pn = proj(it), drop = { DTSTAMP: 1, "LAST-MODIFIED": 1, SEQUENCE: 1 }, add = [];
      var oldDue = V.parseDue(V.first(b, "DUE"));
      ORDER.forEach(function (g) {
        if (JSON.stringify(po[g]) === JSON.stringify(pn[g])) return;
        GROUPS[g].forEach(function (n) { drop[n] = 1; });
        add = add.concat(groupLines(g, pn, it, oldDue));
      });
      var seqP = V.first(b, "SEQUENCE");
      var seq = seqP && /^\d+$/.test(seqP.value.trim()) ? +seqP.value.trim() + 1 : 1;
      var stamp = V.utc(now());
      add = ["DTSTAMP:" + stamp, "LAST-MODIFIED:" + stamp, "SEQUENCE:" + seq].concat(add);
      var own = {};
      b.at.forEach(function (i) { own[i] = 1; });
      var after = b.at.length ? b.at[b.at.length - 1] : b.start;
      var out = [];
      for (var i = 0; i < lines.length; i++) {
        if (!(own[i] && drop[V.nameOf(lines[i])])) out.push(lines[i]);
        if (i === after) out = out.concat(add);
      }
      return out.map(V.fold).join("\r\n") + "\r\n";
    }

    function write(it, raw) {
      var text = raw ? patch(raw, it) : build(it);
      if (text === null) return null;
      var back = read(text);
      if (!back || back.ro || hash(back.main) !== hash(it)) return null;
      return text;
    }

    function idFor(uid, key) {
      return { own: ownId(uid), bind: null, dav: davId(colUrl, uid || key) };
    }

    function copy(it) {
      var c = JSON.parse(JSON.stringify(it));
      c.id = "c" + now().toString(36) + Math.random().toString(36).slice(2, 7);
      var t = cleanText(it.text);
      c.text = (it.sub ? t.slice(0, Math.max(0, 300 - mark.length)) : t) + mark;
      return c;
    }

    return {
      kind: "cal", type: "text/calendar",
      read: read, write: write, hash: hash, idFor: idFor, copy: copy,
      file: function (id) { return id + ".ics"; },
      mtime: function (it) { return it && typeof it.mtime === "number" ? it.mtime : 0; },
      patch: patch, build: build
    };
  }

  var api = { v: 1, mapper: mapper, proj: proj, catKey: catKey, parentId: parentId, uidOf: uidOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosTodoDav = api;
})(typeof window !== "undefined" ? window : null);
