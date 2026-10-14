// ============================================================
// orOS QR Generator — what a scanned code says, v1.0.0
// Pure: no DOM. Runs in the app (window.orosQRScan) and in Node
// tests (module.exports). Needs qr-payload.js (vCard builder for
// MECARD, URL rules).
//   parse(text) -> { kind, text, … } where kind is one of
//     url    { url, host }            http/https only (others: text)
//     wifi   { ssid, pass, sec, hidden }
//     vcard  { vcf, name, org, phones[], emails[] }   vCard or MECARD
//     event  { title, date, start, dateEnd, end, allDay, location, note }
//     email  { to, subject, body }    mailto: or MATMSG:
//     phone  { number }               tel:
//     sms    { number, message }      SMSTO: / sms:
//     geo    { lat, lon }             geo:
//     text   (anything else, javascript: and other schemes included)
//   and gen = { type, fields } to make a code of the same kind.
//   calendarPayload(ev) -> the payload of __orosOpenCalendarNew
//   history: normHistory / addHistory (device-local scan list)
// Nothing here opens, runs or fetches anything.
// ============================================================
(function (root) {
  "use strict";

  var P = (typeof module === "object" && module.exports) ? require("./qr-payload.js") : root.orosQRPayload;

  var MAX_TEXT = 4096;          // longer scans are cut (a QR holds ≤ 2953 bytes)
  var HISTORY_MAX = 50;

  function str(v) { return typeof v === "string" ? v : ""; }
  function one(s) { return str(s).replace(/\s+/g, " ").trim(); }

  // "K:V;K:V;;" with backslash escapes (WIFI:, MECARD:, MATMSG:).
  function splitFields(body) {
    var out = [], cur = "", i;
    for (i = 0; i < body.length; i++) {
      var c = body.charAt(i);
      if (c === "\\" && i + 1 < body.length) { cur += body.charAt(++i); continue; }
      if (c === ";") { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    if (cur) out.push(cur);
    return out;
  }
  // Key = text before the first unescaped ":" (keys never hold escapes).
  function fieldMap(body) {
    var map = {};
    var parts = [], cur = "", i;
    // keep escapes until the key is split off
    for (i = 0; i < body.length; i++) {
      var c = body.charAt(i);
      if (c === "\\" && i + 1 < body.length) { cur += c + body.charAt(++i); continue; }
      if (c === ";") { parts.push(cur); cur = ""; continue; }
      cur += c;
    }
    if (cur) parts.push(cur);
    parts.forEach(function (p) {
      var k = p.indexOf(":");
      if (k <= 0) return;
      var key = p.slice(0, k).toUpperCase(), val = splitFields(p.slice(k + 1)).join(";");
      if (!(key in map)) map[key] = [];
      map[key].push(val);
    });
    return map;
  }
  function first(map, k) { return map[k] && map[k].length ? map[k][0] : ""; }

  // ---------- URL ----------
  function parseUrl(s) {
    if (!/^https?:\/\/[^\s]+$/i.test(s)) return null;
    var n = P.normUrl(s);
    if (n.error) return null;
    var m = /^https?:\/\/(?:[^@\/?#]*@)?([^\/?#:]+|\[[^\]]+\])/i.exec(s);
    return { kind: "url", url: s, host: m ? m[1].toLowerCase() : "", gen: { type: "url", fields: { url: s } } };
  }

  // ---------- WiFi ----------
  function parseWifi(s) {
    if (!/^WIFI:/i.test(s)) return null;
    var map = fieldMap(s.slice(5));
    var ssid = first(map, "S");
    if (!ssid) return null;
    var t = first(map, "T").toUpperCase();
    var sec = t === "WEP" ? "WEP" : (t === "" || t === "NOPASS" ? (first(map, "P") ? "WPA" : "nopass") : "WPA");
    var pass = sec === "nopass" ? "" : first(map, "P");
    var hidden = /^true$/i.test(first(map, "H"));
    return { kind: "wifi", ssid: ssid, pass: pass, sec: sec, hidden: hidden,
             gen: { type: "wifi", fields: { ssid: ssid, pass: pass, sec: sec, hidden: hidden } } };
  }

  // ---------- vCard / MECARD ----------
  function unescText(s) {
    return str(s).replace(/\\([nN,;:\\])/g, function (m, c) { return c === "n" || c === "N" ? "\n" : c; });
  }
  // Content lines of a vCard or iCalendar text: unfolded, { name, params, value }.
  function contentLines(text) {
    var raw = str(text).replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
    var out = [];
    raw.forEach(function (ln) {
      var q = false, k = -1;
      for (var i = 0; i < ln.length; i++) {
        var c = ln.charAt(i);
        if (c === '"') q = !q;
        else if (c === ":" && !q) { k = i; break; }
      }
      if (k <= 0) return;
      var head = ln.slice(0, k).split(";");
      var name = head[0].replace(/^item\d+\./i, "").toUpperCase();
      var params = {};
      head.slice(1).forEach(function (p) {
        var e = p.indexOf("=");
        if (e > 0) params[p.slice(0, e).toUpperCase()] = p.slice(e + 1).replace(/^"|"$/g, "");
        else params.TYPE = (params.TYPE ? params.TYPE + "," : "") + p;
      });
      out.push({ name: name, params: params, value: ln.slice(k + 1) });
    });
    return out;
  }
  // Split a structured value on unescaped ";".
  function structured(v) {
    var out = [], cur = "";
    for (var i = 0; i < v.length; i++) {
      var c = v.charAt(i);
      if (c === "\\" && i + 1 < v.length) { cur += c + v.charAt(++i); continue; }
      if (c === ";") { out.push(unescText(cur)); cur = ""; continue; }
      cur += c;
    }
    out.push(unescText(cur));
    return out;
  }

  function parseVcard(s) {
    if (!/^BEGIN:VCARD/i.test(s)) return null;
    var lines = contentLines(s), f = { first: "", last: "", org: "", title: "", mobile: "", phone: "", email: "", web: "",
      street: "", city: "", zip: "", region: "", country: "", note: "" };
    var fn = "", phones = [], emails = [];
    lines.forEach(function (l) {
      var v = l.value, type = str(l.params.TYPE).toUpperCase();
      switch (l.name) {
        case "FN": fn = one(unescText(v)); break;
        case "N": var n = structured(v); f.last = one(n[0]); f.first = one([n[1], n[2]].join(" ")); break;
        case "ORG": f.org = one(structured(v).filter(Boolean).join(", ")); break;
        case "TITLE": f.title = one(unescText(v)); break;
        case "TEL":
          var tel = one(unescText(v)).replace(/^tel:/i, "");
          if (!tel) break;
          phones.push(tel);
          if (!f.mobile && /CELL|MOBILE/.test(type)) f.mobile = tel;
          else if (!f.phone) f.phone = tel;
          break;
        case "EMAIL": var em = one(unescText(v)).replace(/^mailto:/i, ""); if (em) { emails.push(em); if (!f.email) f.email = em; } break;
        case "URL": if (!f.web) f.web = one(unescText(v)); break;
        case "ADR":
          if (f.street || f.city) break;
          var a = structured(v);
          f.street = one([a[1], a[2]].filter(Boolean).join(" ")); f.city = one(a[3]); f.region = one(a[4]);
          f.zip = one(a[5]); f.country = one(a[6]);
          break;
        case "NOTE": if (!f.note) f.note = unescText(v).trim(); break;
      }
    });
    if (!f.mobile && f.phone && phones.length === 1) { f.mobile = f.phone; f.phone = ""; }
    var name = fn || one(f.first + " " + f.last) || f.org;
    if (!name && !phones.length && !emails.length) return null;
    if (!f.first && !f.last && !f.org && fn) f.first = fn;
    return { kind: "vcard", vcf: s, name: name, org: f.org, phones: phones, emails: emails,
             gen: { type: "vcard", fields: f } };
  }

  // MECARD:N:Doe,John;TEL:…;EMAIL:…;URL:…;ADR:…;NOTE:…;ORG:…;;
  function parseMecard(s) {
    if (!/^MECARD:/i.test(s)) return null;
    var map = fieldMap(s.slice(7));
    var n = first(map, "N").split(","), last = one(n[0]), firstName = one(n.slice(1).join(" "));
    var tels = (map.TEL || []).map(one).filter(Boolean), mails = (map.EMAIL || []).map(one).filter(Boolean);
    var f = { first: firstName, last: last, org: one(first(map, "ORG")), title: "",
              mobile: tels[0] || "", phone: tels[1] || "", email: mails[0] || "", web: one(first(map, "URL")),
              street: one(first(map, "ADR")), city: "", zip: "", region: "", country: "", note: first(map, "NOTE").trim() };
    if (!firstName && !last && !f.org) {
      if (!tels.length && !mails.length) return null;
      f.first = tels[0] || mails[0];
    }
    var b = P.build("vcard", f);
    if (b.error) return null;
    return { kind: "vcard", vcf: b.text, name: one(firstName + " " + last) || f.org || f.first, org: f.org,
             phones: tels, emails: mails, gen: { type: "vcard", fields: f } };
  }

  // ---------- Event ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // iCalendar DATE / DATE-TIME -> { date: "YYYY-MM-DD", time: "HH:MM" | "" }.
  // A UTC time ("Z") becomes the device's local time; TZID and floating
  // times are taken as written.
  function icsWhen(v, params) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(one(v));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    if (!m[4] || (params && /^DATE$/i.test(params.VALUE || ""))) return { date: m[1] + "-" + m[2] + "-" + m[3], time: "" };
    var h = +m[4], mi = +m[5];
    if (h > 23 || mi > 59) return null;
    if (m[7]) {
      var L = new Date(Date.UTC(y, mo - 1, d, h, mi));
      return { date: L.getFullYear() + "-" + pad(L.getMonth() + 1) + "-" + pad(L.getDate()), time: pad(L.getHours()) + ":" + pad(L.getMinutes()) };
    }
    return { date: m[1] + "-" + m[2] + "-" + m[3], time: m[4] + ":" + m[5] };
  }
  function addDays(ymd, n) {
    var d = new Date(ymd + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function parseEvent(s) {
    if (!/^BEGIN:(VEVENT|VCALENDAR)/i.test(s)) return null;
    var lines = contentLines(s), inEv = false, done = false, ev = { title: "", location: "", note: "" }, st = null, en = null;
    lines.forEach(function (l) {
      if (done) return;
      if (l.name === "BEGIN" && /^VEVENT$/i.test(l.value.trim())) { inEv = true; return; }
      if (l.name === "END" && /^VEVENT$/i.test(l.value.trim())) { if (inEv) done = true; return; }
      if (!inEv) return;
      if (l.name === "SUMMARY") ev.title = one(unescText(l.value));
      else if (l.name === "LOCATION") ev.location = one(unescText(l.value));
      else if (l.name === "DESCRIPTION") ev.note = unescText(l.value).trim();
      else if (l.name === "DTSTART") st = icsWhen(l.value, l.params);
      else if (l.name === "DTEND") en = icsWhen(l.value, l.params);
    });
    if (!st) return null;
    var allDay = !st.time, dateEnd = "", end = "";
    if (en) {
      if (allDay) { var last = addDays(en.date, en.time ? 0 : -1); if (last > st.date) dateEnd = last; }
      else {
        if (en.date > st.date) dateEnd = en.date;
        if (en.time && (en.date > st.date || en.time > st.time)) end = en.time;
      }
    }
    var out = { kind: "event", title: ev.title, date: st.date, start: st.time, dateEnd: dateEnd, end: end, allDay: allDay,
                location: ev.location, note: ev.note };
    out.gen = { type: "event", fields: { title: ev.title, allDay: allDay, date: st.date, start: st.time,
                dateEnd: dateEnd, end: end, location: ev.location, note: ev.note } };
    return out;
  }
  // Payload for the shell bridge __orosOpenCalendarNew (Calendar opens
  // its New event window filled in; nothing is saved until Save).
  function calendarPayload(ev) {
    var p = { date: ev.date };
    if (ev.title) p.title = ev.title.slice(0, 80);
    if (ev.location) p.location = ev.location.slice(0, 150);
    if (ev.note) p.note = ev.note.slice(0, 500);
    if (!ev.allDay && ev.start) { p.start = ev.start; if (ev.end) p.end = ev.end; }
    if (ev.dateEnd && ev.dateEnd > ev.date) p.dateEnd = ev.dateEnd;
    return p;
  }

  // ---------- Email, phone, SMS, location ----------
  function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function parseMail(s) {
    var to = "", subject = "", body = "";
    if (/^mailto:/i.test(s)) {
      var q = s.slice(7).split("?");
      to = dec(q[0]);
      (q[1] || "").split("&").forEach(function (kv) {
        var e = kv.indexOf("="), k = (e < 0 ? kv : kv.slice(0, e)).toLowerCase(), v = e < 0 ? "" : dec(kv.slice(e + 1));
        if (k === "subject") subject = v; else if (k === "body") body = v; else if (k === "to" && !to) to = v;
      });
    } else if (/^MATMSG:/i.test(s)) {
      var map = fieldMap(s.slice(7));
      to = first(map, "TO"); subject = first(map, "SUB"); body = first(map, "BODY");
    } else return null;
    to = one(to);
    if (!to) return null;
    return { kind: "email", to: to, subject: one(subject), body: body.trim(),
             gen: { type: "email", fields: { to: to, subject: one(subject), body: body.trim() } } };
  }
  function parsePhone(s) {
    var m = /^tel:(.+)$/i.exec(s);
    if (!m) return null;
    var n = one(dec(m[1]));
    return n ? { kind: "phone", number: n, gen: { type: "phone", fields: { number: n } } } : null;
  }
  function parseSms(s) {
    var m = /^SMSTO:([^:]*)(?::([\s\S]*))?$/i.exec(s), number, message;
    if (m) { number = one(m[1]); message = str(m[2]).trim(); }
    else {
      m = /^sms:([^?]*)(?:\?([\s\S]*))?$/i.exec(s);
      if (!m) return null;
      number = one(dec(m[1])); message = "";
      str(m[2]).split("&").forEach(function (kv) { if (/^body=/i.test(kv)) message = dec(kv.slice(5)).trim(); });
    }
    if (!number) return null;
    return { kind: "sms", number: number, message: message, gen: { type: "sms", fields: { number: number, message: message } } };
  }
  function parseGeo(s) {
    var m = /^geo:([-+]?\d{1,3}(?:\.\d+)?),([-+]?\d{1,3}(?:\.\d+)?)(?:[,;?].*)?$/i.exec(s);
    if (!m) return null;
    var la = parseFloat(m[1]), lo = parseFloat(m[2]);
    if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
    return { kind: "geo", lat: m[1], lon: m[2], gen: { type: "geo", fields: { lat: m[1], lon: m[2] } } };
  }

  function parse(text) {
    var raw = str(text).slice(0, MAX_TEXT);
    var s = raw.replace(/^﻿/, "").trim();
    var r = parseUrl(s) || parseWifi(s) || parseVcard(s) || parseMecard(s) || parseEvent(s) ||
            parseMail(s) || parsePhone(s) || parseSms(s) || parseGeo(s);
    if (!r) r = { kind: "text", gen: raw.trim() ? { type: "text", fields: { text: raw.slice(0, 2000) } } : null };
    r.text = raw;
    return r;
  }

  // ---------- Scan history (device-local) ----------
  // [{ id, at (ms), text }] newest first; the same text is kept once
  // (a new scan moves it to the top); at most HISTORY_MAX.
  var HID_RE = /^[a-z0-9]{4,40}$/;
  function normHistory(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (h) {
      if (!h || typeof h !== "object" || typeof h.text !== "string" || !h.text.trim() ||
          typeof h.id !== "string" || !HID_RE.test(h.id) ||
          typeof h.at !== "number" || !isFinite(h.at) || h.at < 0) return;
      out.push({ id: h.id, at: Math.floor(h.at), text: h.text.slice(0, MAX_TEXT) });
    });
    out.sort(function (a, b) { return b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    return out.filter(function (h) {
      if (seen.hasOwnProperty(h.text)) return false;
      seen[h.text] = 1;
      return true;
    }).slice(0, HISTORY_MAX);
  }
  function addHistory(list, text, at, id) {
    var t = str(text).slice(0, MAX_TEXT);
    if (!t.trim()) return normHistory(list);
    var rest = normHistory(list).filter(function (h) { return h.text !== t; });
    return normHistory([{ id: id, at: at, text: t }].concat(rest));
  }

  var api = {
    VERSION: "1.0.0",
    MAX_TEXT: MAX_TEXT,
    HISTORY_MAX: HISTORY_MAX,
    parse: parse,
    calendarPayload: calendarPayload,
    normHistory: normHistory,
    addHistory: addHistory,
    _internal: { contentLines: contentLines, icsWhen: icsWhen, fieldMap: fieldMap }
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.orosQRScan = api;
})(typeof window !== "undefined" ? window : this);
