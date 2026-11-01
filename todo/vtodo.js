// ============================================================
// orOS To-Do — iCalendar VTODO reader and line helpers (todo/vtodo.js)
// CalDAV wave 5. Pure: no DOM, no storage, no network; nothing from
// the server is executed or shown as HTML. Browser: window.OrosVtodo.
// Node: module.exports (tests/todo-dav.test.js).
//
//   unfold(text)          → logical lines (RFC 5545 3.1)
//   fold(line)            → the line folded at 75 octets ("\r\n " joins)
//   prop(line)            → { group, name, params: { NAME: [values] }, value } | null
//   esc(s) / unesc(s)     → TEXT escaping (\\ \; \, \n)
//   split(v)              → a list value split on unescaped commas
//   blocks(lines)         → the VTODO components: { start, end, props, depth1 }
//   parseDue(p)           → { date: "YYYY-MM-DD", form: "date" | "float" | "zone" | "utc", time, params } | null
//   dueValue(date, old)   → the value + params for a new date in the old form
//   readRule(v)           → { every, unit, weekday? } | null (null: orOS cannot repeat it this way)
//   ruleValue(rec)        → the RRULE value for an orOS repeat
//   prio(n) / prioValue(p) → iCalendar PRIORITY ↔ To-Do P1..P4
//   read(text)            → the task in the To-Do shape, with what
//                           could not be kept exactly (cut) and the
//                           parent UID (RELATED-TO, RELTYPE=PARENT)
//   utc(ms)               → 20261101T090000Z
// ============================================================
(function (root) {
  "use strict";

  var LIM = { text: 1000, notes: 20000, cat: 40, cats: 20 };
  var DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

  function unfold(text) {
    var raw = String(text || "").replace(/\r\n|\r/g, "\n").split("\n"), out = [];
    for (var i = 0; i < raw.length; i++) {
      var l = raw[i];
      if ((l.charAt(0) === " " || l.charAt(0) === "\t") && out.length) out[out.length - 1] += l.slice(1);
      else if (l.length) out.push(l);
    }
    return out;
  }

  function fold(line) {
    var out = [], cur = "", n = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i), code = line.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < line.length) ch += line.charAt(++i);
      var len = code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xd800 && code <= 0xdbff ? 4 : 3;
      if (n + len > (out.length ? 74 : 75)) { out.push(cur); cur = ""; n = 0; }
      cur += ch; n += len;
    }
    out.push(cur);
    return out.join("\r\n ");
  }

  // NAME;PARAM=a,"b;c":value — quotes guard ; : , inside a parameter.
  function prop(line) {
    var i = 0, q = false, head = "", s = String(line || "");
    for (; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '"') q = !q;
      else if (c === ":" && !q) break;
      head += c;
    }
    if (i >= s.length) return null;
    var value = s.slice(i + 1), parts = [], cur = "";
    q = false;
    for (var j = 0; j < head.length; j++) {
      var d = head.charAt(j);
      if (d === '"') { q = !q; cur += d; continue; }
      if (d === ";" && !q) { parts.push(cur); cur = ""; continue; }
      cur += d;
    }
    parts.push(cur);
    var nm = parts.shift(), group = "", dot = nm.lastIndexOf(".");
    if (dot > 0) { group = nm.slice(0, dot); nm = nm.slice(dot + 1); }
    if (!/^[A-Za-z0-9-]+$/.test(nm)) return null;
    var params = {};
    parts.forEach(function (p) {
      var eq = p.indexOf("=");
      if (eq < 1) return;
      var k = p.slice(0, eq).toUpperCase(), vs = [], v = "", qq = false, rest = p.slice(eq + 1);
      for (var x = 0; x < rest.length; x++) {
        var e = rest.charAt(x);
        if (e === '"') { qq = !qq; continue; }
        if (e === "," && !qq) { vs.push(v); v = ""; continue; }
        v += e;
      }
      vs.push(v);
      params[k] = (params[k] || []).concat(vs);
    });
    return { group: group, name: nm.toUpperCase(), params: params, value: value };
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
      .replace(/\r\n|\r|\n/g, "\\n");
  }
  function unesc(s) {
    return String(s || "").replace(/\\([\\;,nN])/g, function (m, c) { return c === "n" || c === "N" ? "\n" : c; });
  }
  function split(v) {
    var out = [], cur = "";
    v = String(v || "");
    for (var i = 0; i < v.length; i++) {
      var c = v.charAt(i);
      if (c === "\\" && i + 1 < v.length) { cur += c + v.charAt(++i); continue; }
      if (c === ",") { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }
  function nameOf(line) {
    var m = /^(?:[A-Za-z0-9-]+\.)?([A-Za-z0-9-]+)[;:]/.exec(line);
    return m ? m[1].toUpperCase() : "";
  }

  // The VTODO components of a text (nested ones, such as VALARM, are
  // kept apart: props are the VTODO's own lines only).
  function blocks(lines) {
    var out = [], cur = null, stack = [];
    for (var i = 0; i < lines.length; i++) {
      var u = lines[i].toUpperCase();
      if (u.indexOf("BEGIN:") === 0) {
        var comp = u.slice(6).trim();
        stack.push(comp);
        if (comp === "VTODO" && stack.length === 2) cur = { start: i, end: -1, props: [], at: [] };
        continue;
      }
      if (u.indexOf("END:") === 0) {
        var c2 = stack.pop();
        if (cur && c2 === "VTODO" && stack.length === 1) { cur.end = i; out.push(cur); cur = null; }
        continue;
      }
      if (cur && stack.length === 2) { cur.props.push(lines[i]); cur.at.push(i); }
    }
    return out;
  }
  function all(b, name) {
    var out = [];
    for (var i = 0; i < b.props.length; i++) {
      if (nameOf(b.props[i]) === name) { var p = prop(b.props[i]); if (p) out.push(p); }
    }
    return out;
  }
  function first(b, name) { return all(b, name)[0] || null; }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }
  function validYmd(y, m, d) {
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function utc(ms) { return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""); }

  // DUE / DTSTART / LAST-MODIFIED: a date, or a date-time (floating,
  // with a TZID, or UTC). A UTC time is shown on this device's day.
  function parseDue(p) {
    if (!p) return null;
    var v = p.value.trim(), m;
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(v))) {
      if (!validYmd(+m[1], +m[2], +m[3])) return null;
      return { date: iso(+m[1], +m[2], +m[3]), form: "date", time: "", params: p.params };
    }
    if ((m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v))) {
      if (!validYmd(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59 || +m[6] > 60) return null;
      if (m[7]) {
        var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        var d = new Date(ms);
        return { date: iso(d.getFullYear(), d.getMonth() + 1, d.getDate()), form: "utc",
                 time: pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()), params: p.params, ms: ms };
      }
      return { date: iso(+m[1], +m[2], +m[3]), form: p.params.TZID ? "zone" : "float", time: m[4] + m[5] + m[6],
               params: p.params };
    }
    return null;
  }
  function stampMs(p) {
    var d = parseDue(p);
    if (!d) return 0;
    if (d.ms) return d.ms;
    var x = d.date.split("-"), t = d.time || "000000";
    return Date.UTC(+x[0], +x[1] - 1, +x[2], +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
  }
  function paramText(params, skip) {
    var s = "";
    Object.keys(params || {}).forEach(function (k) {
      if (skip && skip[k]) return;
      s += ";" + k + "=" + params[k].map(function (v) { return /[;:,]/.test(v) ? '"' + v + '"' : v; }).join(",");
    });
    return s;
  }
  // The DUE line for a new date, in the old line's form (a date-time
  // keeps its time of day and its zone), or as a plain date.
  function dueLine(date, old) {
    var ymd = date.replace(/-/g, "");
    if (!old || old.form === "date") return "DUE;VALUE=DATE:" + ymd;
    if (old.form === "utc") {
      var x = date.split("-"), t = old.time;
      var local = new Date(+x[0], +x[1] - 1, +x[2], +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
      return "DUE" + paramText(old.params, { VALUE: 1 }) + ":" + utc(local.getTime());
    }
    return "DUE" + paramText(old.params, { VALUE: 1 }) + ":" + ymd + "T" + old.time;
  }

  // RRULE → an orOS repeat. Only what To-Do can repeat exactly is
  // read: every n days / weeks (one weekday at most) / months / years
  // (as 12 n months); COUNT, UNTIL, BYMONTHDAY, BYSETPOS… are not.
  function readRule(v) {
    var parts = {}, ok = true;
    String(v || "").split(";").forEach(function (kv) {
      var eq = kv.indexOf("=");
      if (eq < 1) { if (kv) ok = false; return; }
      parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1).toUpperCase();
    });
    if (!ok) return null;
    var every = parts.INTERVAL === undefined ? 1 : (/^\d{1,3}$/.test(parts.INTERVAL) ? +parts.INTERVAL : 0);
    if (every < 1) return null;
    var extra = Object.keys(parts).filter(function (k) { return k !== "FREQ" && k !== "INTERVAL" && k !== "WKST" && k !== "BYDAY"; });
    if (extra.length) return null;
    var f = parts.FREQ;
    if (parts.BYDAY !== undefined && f !== "WEEKLY") return null;
    if (f === "DAILY") return { every: every, unit: "day" };
    if (f === "MONTHLY") return { every: every, unit: "month" };
    if (f === "YEARLY") return every * 12 <= 999 ? { every: every * 12, unit: "month" } : null;
    if (f === "WEEKLY") {
      var rec = { every: every, unit: "week" };
      if (parts.BYDAY !== undefined) {
        var wd = DAYS.indexOf(parts.BYDAY);
        if (wd < 0) return null;
        rec.weekday = wd;
      }
      return rec;
    }
    return null;
  }
  function ruleValue(rec) {
    var f = rec.unit === "day" ? "DAILY" : rec.unit === "month" ? "MONTHLY" : "WEEKLY";
    var v = "FREQ=" + f;
    if (rec.every > 1) v += ";INTERVAL=" + rec.every;
    if (rec.unit === "week" && typeof rec.weekday === "number") v += ";BYDAY=" + DAYS[rec.weekday];
    return v;
  }
  // The repeat in its one shape (the same as To-Do keeps it).
  function normRec(r) {
    if (!r || typeof r !== "object") return null;
    var every = Math.floor(+r.every);
    if (!(every >= 1 && every <= 999)) return null;
    var unit = r.unit === "day" || r.unit === "month" ? r.unit : r.unit === "week" ? "week" : null;
    if (!unit) return null;
    var out = { every: every, unit: unit };
    if (unit === "week" && typeof r.weekday === "number" && r.weekday >= 0 && r.weekday <= 6) out.weekday = r.weekday;
    if (r.after === true) out.after = true;
    return out;
  }

  // PRIORITY 1-4 high (P1), 5 medium (P2), 6-9 low (P3), 0 or none (P4).
  function prio(n) {
    n = +n;
    if (!(n >= 1 && n <= 9)) return 4;
    return n <= 4 ? 1 : n === 5 ? 2 : 3;
  }
  function prioValue(p) { return p === 1 ? 1 : p === 2 ? 5 : p === 3 ? 9 : 0; }

  // One task. cut: something orOS cannot keep exactly (the item is
  // then read-only in To-Do: the server wins).
  function read(text) {
    var lines = unfold(text), bs = blocks(lines);
    if (!bs.length) return null;
    var b = bs[0], cut = bs.length !== 1;
    var uidP = first(b, "UID");
    var sumP = first(b, "SUMMARY"), desP = first(b, "DESCRIPTION");
    var txt = sumP ? unesc(sumP.value).trim() : "";
    if (/[\r\n]/.test(txt) || txt.length > LIM.text) cut = true;
    txt = txt.replace(/\s*[\r\n]+\s*/g, " ").slice(0, LIM.text);
    var notes = desP ? unesc(desP.value).replace(/\r\n|\r/g, "\n").replace(/\s+$/, "") : "";
    if (notes.length > LIM.notes) { cut = true; notes = notes.slice(0, LIM.notes); }
    var dueP = first(b, "DUE"), due = null;
    if (dueP) { var dd = parseDue(dueP); if (dd) due = dd.date; else cut = true; }
    else if (first(b, "DURATION")) cut = true;            // DTSTART + DURATION: orOS has no such due
    var stP = first(b, "STATUS"), st = stP ? stP.value.trim().toUpperCase() : "";
    var pcP = first(b, "PERCENT-COMPLETE");
    var done = st === "COMPLETED" || st === "CANCELLED" ||
      (!st && (!!first(b, "COMPLETED") || (pcP && pcP.value.trim() === "100")));
    if (st === "CANCELLED") cut = true;
    var prP = first(b, "PRIORITY");
    var rec = null, rr = all(b, "RRULE");
    if (rr.length > 1) cut = true;
    if (rr.length) { rec = readRule(rr[0].value.trim()); if (!rec) cut = true; }
    if (first(b, "RDATE") || first(b, "EXDATE") || first(b, "EXRULE") || first(b, "RECURRENCE-ID")) cut = true;
    var after = first(b, "X-OROS-AFTER-DONE");
    if (rec && after && /^(TRUE|1)$/i.test(after.value.trim())) rec.after = true;
    var cats = [];
    all(b, "CATEGORIES").forEach(function (p) {
      split(p.value).forEach(function (c) {
        c = unesc(c).trim();
        if (!c) return;
        if (c.length > LIM.cat || /[\u0000-\u001f\u007f]/.test(c)) { cut = true; return; }
        if (cats.indexOf(c) === -1) cats.push(c);
      });
    });
    if (cats.length > LIM.cats) { cut = true; cats = cats.slice(0, LIM.cats); }
    var puid = "";
    all(b, "RELATED-TO").forEach(function (p) {
      var rt = (p.params.RELTYPE || ["PARENT"])[0].toUpperCase();
      if (rt === "PARENT" && !puid) puid = p.value.trim();
    });
    var lm = first(b, "LAST-MODIFIED") || first(b, "DTSTAMP");
    return {
      uid: uidP ? uidP.value.trim() : "",
      text: txt, notes: notes, due: due, prio: prio(prP ? prP.value.trim() : 0), done: !!done,
      rec: rec, cats: cats, puid: puid,
      // What a To-Do subtask cannot hold (it has a text and a tick only).
      plain: !notes && !due && !(prP && prio(prP.value.trim()) < 4) && !rec && !cats.length && txt.length <= 300,
      cut: cut,
      mtime: lm ? stampMs(lm) : 0
    };
  }

  var api = { v: 1, LIM: LIM, DAYS: DAYS, unfold: unfold, fold: fold, prop: prop, esc: esc, unesc: unesc,
              split: split, nameOf: nameOf, blocks: blocks, all: all, first: first, parseDue: parseDue,
              dueLine: dueLine, readRule: readRule, ruleValue: ruleValue, normRec: normRec, prio: prio,
              prioValue: prioValue, read: read, utc: utc };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosVtodo = api;
})(typeof window !== "undefined" ? window : null);
