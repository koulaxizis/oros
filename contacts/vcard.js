// ============================================================
// orOS Contacts — vCard reader and writer (contacts/vcard.js,
// window.OrosVcard), CardDAV wave 4.
// Pure: no DOM, no storage, no network. Used by contacts.js (.vcf
// import / export) and contacts/dav.js (the CardDAV mapper). Node:
// module.exports (tests/contacts-vcard.test.js).
//
// Reads vCard 2.1, 3.0 and 4.0 (RFC 2426 / 6350):
//   - folded lines (CRLF, CR or LF, then a space or a tab);
//   - group prefixes ("item1.TEL:…", Apple) are set aside;
//   - TYPE as TYPE=a,b · TYPE="a,b" · TYPE=a;TYPE=b · bare (v2.1 "TEL;CELL:");
//   - TEL as text or as a tel: URI (vCard 4 VALUE=uri);
//   - BDAY / ANNIVERSARY / X-ANNIVERSARY as YYYY-MM-DD, YYYYMMDD,
//     --MM-DD or --MMDD (a time after T is ignored);
//   - the post office box and extended address of ADR are put in
//     front of the street, so nothing of them is lost;
//   - PHOTO is never read (CT-NP).
// parse(lines) also says what it could not keep exactly (`cut`):
// a value longer than Contacts keeps, a date it cannot read, a year
// outside 1850–2200. The CardDAV mapper makes such a card read-only.
// ============================================================
(function (root) {
  "use strict";

  // The same lists as contacts.js / package.js.
  var PHONE_TYPES = ["mobile", "home", "work", "main", "other"];
  var EMAIL_TYPES = ["home", "work", "other"];
  var ADDR_TYPES  = ["home", "work", "other"];
  var WEB_TYPES   = ["home", "work", "blog", "other"];
  var IM_TYPES    = ["home", "work", "other"];
  var PX_RE = /^px:[a-z0-9]{1,12}$/;
  var LIM = { name: 60, org: 80, title: 80, tel: 40, email: 120, street: 120, city: 60, region: 60, zip: 20,
              country: 60, url: 300, im: 120, note: 2000, label: 40, cat: 40 };

  // Unfold: CRLF / CR / LF + a leading space or tab continues the line.
  function unfold(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var c = lines[i].charAt(0);
      if ((c === " " || c === "\t") && out.length) out[out.length - 1] += lines[i].slice(1);
      else out.push(lines[i]);
    }
    return out;
  }

  // "item1.TEL;TYPE=CELL,VOICE:+3069…" → { group, name, params, value }.
  // A colon inside a quoted parameter value does not end the name part.
  function prop(line) {
    var ix = -1, q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === "\"") q = !q;
      else if (ch === ":" && !q) { ix = i; break; }
    }
    if (ix === -1) return null;
    var head = line.slice(0, ix), parts = [], cur = "";
    q = false;
    for (var j = 0; j < head.length; j++) {
      var c = head.charAt(j);
      // Our X-LABEL is written escaped ("a\;b"): an escaped ";" stays in the value.
      if (c === "\\" && j + 1 < head.length) { cur += c + head.charAt(++j); continue; }
      if (c === "\"") q = !q;
      if (c === ";" && !q) { parts.push(cur); cur = ""; } else cur += c;
    }
    parts.push(cur);
    var nm = parts[0], group = "", dot = nm.lastIndexOf(".");
    if (dot !== -1) { group = nm.slice(0, dot); nm = nm.slice(dot + 1); }
    return { group: group, name: nm.toUpperCase(), params: parts.slice(1), value: line.slice(ix + 1) };
  }
  // Every TYPE value, lower case: TYPE=a,b · TYPE="a,b" · bare v2.1 params.
  function types(params) {
    var out = [];
    (params || []).forEach(function (p) {
      var eq = p.indexOf("=");
      var k = eq === -1 ? "" : p.slice(0, eq).toUpperCase();
      var v = eq === -1 ? p : p.slice(eq + 1);
      if (eq !== -1 && k !== "TYPE") return;
      v.replace(/"/g, "").split(",").forEach(function (x) {
        x = x.trim().toLowerCase();
        if (x && out.indexOf(x) === -1) out.push(x);
      });
    });
    return out;
  }
  function param(params, key) {
    key = key.toUpperCase();
    for (var i = 0; i < (params || []).length; i++) {
      var p = params[i], eq = p.indexOf("=");
      if (eq !== -1 && p.slice(0, eq).toUpperCase() === key) return p.slice(eq + 1).replace(/^"|"$/g, "");
    }
    return null;
  }
  // One pass, so an escaped backslash before "n" ("\\n") stays a
  // backslash and an "n" instead of becoming a line break.
  function unesc(s) {
    return String(s || "").replace(/\\([nN,;:\\])/g, function (m, ch) {
      return ch === "n" || ch === "N" ? "\n" : ch;
    });
  }
  function esc(s) {
    return String(s || "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
      .replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }
  // Split a structured value on ";" that is not escaped.
  function split(v, sep) {
    var out = [], cur = "";
    for (var i = 0; i < v.length; i++) {
      var ch = v.charAt(i);
      if (ch === "\\" && i + 1 < v.length) { cur += ch + v.charAt(++i); continue; }
      if (ch === sep) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out;
  }
  // Lines longer than 75 octets are folded (RFC 6350 3.2), never
  // inside a character. → array of physical lines.
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
    return out.map(function (x, k) { return k ? " " + x : x; });
  }

  // A vCard type list (or one raw string, as CSV gives) → one of ours.
  function typeFrom(raw, whitelist, fallback) {
    var list = Array.isArray(raw) ? raw : [String(raw || "").toLowerCase()];
    var has = function (w) { return whitelist.indexOf(w) !== -1; };
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if ((r.indexOf("cell") !== -1 || r.indexOf("mobile") !== -1) && has("mobile")) return "mobile";
    }
    for (var j = 0; j < list.length; j++) if (list[j] !== "pref" && list[j] !== "internet" && list[j] !== "voice" && has(list[j])) return list[j];
    for (var k = 0; k < list.length; k++) {
      if (list[k].indexOf("work") !== -1 && has("work")) return "work";
      if (list[k].indexOf("home") !== -1 && has("home")) return "home";
    }
    return fallback;
  }

  // A date value → { day "MM-DD", year | null } or null.
  function validDay(day) {
    if (!/^\d{2}-\d{2}$/.test(day)) return false;
    var mm = +day.slice(0, 2), dd = +day.slice(3);
    if (mm < 1 || mm > 12 || dd < 1) return false;
    return dd <= new Date(2000, mm, 0).getDate();
  }
  function date(v) {
    v = String(v || "").trim().split("T")[0];
    var m;
    if ((m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)) || (m = v.match(/^(\d{4})(\d{2})(\d{2})$/))) {
      return validDay(m[2] + "-" + m[3]) ? { day: m[2] + "-" + m[3], year: +m[1] } : null;
    }
    if ((m = v.match(/^-{0,2}(\d{2})-?(\d{2})$/))) {
      return validDay(m[1] + "-" + m[2]) ? { day: m[1] + "-" + m[2], year: null } : null;
    }
    return null;
  }
  // REV / LAST-MODIFIED → ms, 0 when unreadable.
  function stamp(v) {
    var m = String(v || "").trim().match(/^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2}):?(\d{2})(?:[.,]\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/);
    if (!m) return 0;
    var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    if (m[7] && m[7] !== "Z") {
      var sg = m[7].charAt(0) === "-" ? -1 : 1, z = m[7].replace(/[^\d]/g, "");
      ms -= sg * (+z.slice(0, 2) * 60 + +z.slice(2, 4)) * 60000;
    }
    return isFinite(ms) ? ms : 0;
  }

  // The VCARD blocks of a text: arrays of unfolded lines (no BEGIN / END).
  function blocks(text) {
    var out = [], cur = null, depth = 0;
    unfold(text).forEach(function (ln) {
      var u = ln.trim().toUpperCase();
      if (u === "BEGIN:VCARD") { depth++; if (depth === 1) cur = []; else if (cur) cur.push(ln); return; }
      if (u === "END:VCARD") { depth--; if (depth === 0 && cur) { out.push(cur); cur = null; } else if (cur) cur.push(ln); return; }
      if (cur) cur.push(ln);
    });
    return out;
  }

  // One vCard (unfolded lines between BEGIN and END) → the parser
  // shape of contacts.js, plus { uid, rev, version, kind, cut }.
  function parse(lines) {
    var c = {
      given: "", middle: "", family: "", nickname: "",
      org: "", jobTitle: "",
      phones: [], emails: [], addresses: [], websites: [], im: [],
      events: [], cats: [], note: "", avatar: null, starred: false,
      uid: "", rev: 0, version: "", kind: "", cut: false
    };
    var fnText = "", haveN = false;
    function keep(v, max) {
      v = String(v || "").trim();
      if (v.length > max) { c.cut = true; v = v.slice(0, max); }
      return v;
    }
    function addDate(type, v, label) {
      var d = date(v);
      if (!d) { c.cut = true; return; }
      if (d.year !== null && (d.year < 1850 || d.year > 2200)) c.cut = true;
      c.events.push({ day: d.day, year: d.year, type: type, label: label || "" });
    }
    (lines || []).forEach(function (line) {
      if (!line) return;
      var p = prop(line);
      if (!p) return;
      var ty = types(p.params);
      switch (p.name) {
        case "VERSION": c.version = p.value.trim(); break;
        case "UID": c.uid = p.value.trim(); break;
        case "REV": c.rev = stamp(p.value); break;
        case "KIND": case "X-ADDRESSBOOKSERVER-KIND": c.kind = p.value.trim().toLowerCase(); break;
        case "N": {
          // N:family;given;middle;prefix;suffix
          var nn = split(p.value, ";");
          haveN = true;
          c.family = keep(unesc(nn[0]), LIM.name);
          c.given = keep(unesc(nn[1]), LIM.name);
          c.middle = keep(unesc(nn[2]), LIM.name);
          break;
        }
        case "FN": fnText = unesc(p.value).trim(); break;
        case "NICKNAME": c.nickname = keep(unesc(p.value), LIM.name); break;
        case "ORG": c.org = keep(unesc(split(p.value, ";")[0]), LIM.org); break;   // ORG:company;unit → company
        case "TITLE": c.jobTitle = keep(unesc(p.value), LIM.title); break;
        case "TEL": {
          var tv = unesc(p.value).trim().replace(/^tel:/i, "");
          if (tv) c.phones.push({ v: keep(tv, LIM.tel), type: typeFrom(ty, PHONE_TYPES, "other") });
          break;
        }
        case "EMAIL": {
          var ev = unesc(p.value).trim().replace(/^mailto:/i, "");
          if (ev) c.emails.push({ v: keep(ev, LIM.email), type: typeFrom(ty, EMAIL_TYPES, "other") });
          break;
        }
        case "ADR": {
          // ADR:pobox;ext;street;city;region;zip;country
          var aa = split(p.value, ";").map(function (x) { return unesc(x).trim(); });
          var street = [aa[0], aa[1], aa[2]].filter(Boolean).join(", ");
          var ad = {
            street: keep(street, LIM.street), city: keep(aa[3], LIM.city), region: keep(aa[4], LIM.region),
            zip: keep(aa[5], LIM.zip), country: keep(aa[6], LIM.country), type: typeFrom(ty, ADDR_TYPES, "other")
          };
          if (ad.street || ad.city || ad.region || ad.zip || ad.country) c.addresses.push(ad);
          break;
        }
        case "URL": {
          var uv = unesc(p.value).trim();
          if (uv) c.websites.push({ v: keep(uv, LIM.url), type: typeFrom(ty, WEB_TYPES, "other") });
          break;
        }
        case "IMPP": {
          var iv = unesc(p.value).trim();
          if (iv) c.im.push({ v: keep(iv, LIM.im), type: typeFrom(ty, IM_TYPES, "other") });
          break;
        }
        case "BDAY": addDate("birthday", p.value); break;
        case "ANNIVERSARY": case "X-ANNIVERSARY": addDate("anniversary", p.value); break;
        case "X-EVENT": {
          // Our own custom-event form: X-EVENT;TYPE=CUSTOM;X-LABEL=<escaped label>:<date>
          var xl = param(p.params, "X-LABEL");
          addDate("custom", p.value, xl === null ? "" : keep(unesc(xl), LIM.label));
          break;
        }
        case "NOTE": c.note = keep(unesc(p.value), LIM.note); break;
        case "PHOTO": break;   // CT-NP: photos are not kept
        case "X-OROS-AVATAR": {
          var av = p.value.trim();
          if (PX_RE.test(av)) c.avatar = av;
          break;
        }
        case "X-OROS-STARRED":
          if (/^TRUE$/i.test(p.value.trim())) c.starred = true;
          break;
        case "CATEGORIES":
          split(p.value, ",").forEach(function (cat) {
            var n = unesc(cat).trim();
            if (n && c.cats.indexOf(n.slice(0, LIM.cat)) === -1) {
              if (n.length > LIM.cat) c.cut = true;
              c.cats.push(n.slice(0, LIM.cat));
            }
          });
          break;
      }
    });
    if (!haveN && fnText) {
      // Some exports ship FN only.
      var fn = fnText.split(/\s+/);
      c.given = keep(fn[0] || "", LIM.name);
      c.family = keep(fn.slice(1).join(" "), LIM.name);
    }
    return c;
  }
  function parseText(text) { return blocks(text).map(parse); }

  var api = {
    unfold: unfold, prop: prop, types: types, param: param, unesc: unesc, esc: esc, split: split, fold: fold,
    typeFrom: typeFrom, date: date, stamp: stamp, blocks: blocks, parse: parse, parseText: parseText,
    PHONE_TYPES: PHONE_TYPES, EMAIL_TYPES: EMAIL_TYPES, ADDR_TYPES: ADDR_TYPES, WEB_TYPES: WEB_TYPES,
    IM_TYPES: IM_TYPES, LIM: LIM
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosVcard = api;
})(typeof window !== "undefined" ? window : null);
