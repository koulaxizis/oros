// ============================================================
// orOS QR Generator — content formats, v1.0.0
// Turns the form fields of each type into the text a scanner
// understands. No DOM: runs in the app (window.orosQRPayload) and
// in Node tests (module.exports).
//   url    http or https only, https:// added when missing
//   text   as typed
//   wifi   WIFI:T:…;S:…;P:…;H:true;;  (ZXing / Android / iOS format)
//   vcard  vCard 3.0
//   event  BEGIN:VEVENT … END:VEVENT (floating local time)
//   email  mailto:…?subject=…&body=…
//   phone  tel:…
//   sms    SMSTO:number:message
//   geo    geo:lat,lon
// Every value is escaped by the rules of its own format, so a ";",
// "," or a new line typed by the user never breaks the structure.
// ============================================================
(function (root) {
  "use strict";

  var TYPES = ["url", "wifi", "vcard", "event", "text", "email", "phone", "sms", "geo"];

  // Field schema per type: key -> max length (strings) or a kind.
  var FIELDS = {
    url:   { url: 2000 },
    text:  { text: 2000 },
    wifi:  { ssid: 32, pass: 63, sec: ["WPA", "WEP", "nopass"], hidden: "bool" },
    vcard: { first: 60, last: 60, org: 80, title: 80, mobile: 40, phone: 40, email: 120,
             web: 300, street: 120, city: 60, zip: 20, region: 60, country: 60, note: 300 },
    event: { title: 120, allDay: "bool", date: "date", start: "time", dateEnd: "date", end: "time",
             location: 150, note: 500 },
    email: { to: 120, subject: 150, body: 1000 },
    phone: { number: 40 },
    sms:   { number: 40, message: 500 },
    geo:   { lat: 20, lon: 20 }
  };

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  function validDate(s) {
    if (!DATE_RE.test(s)) return false;
    var d = new Date(s + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  // Known keys only, strings capped, enums and booleans coerced.
  function normFields(type, raw) {
    var spec = FIELDS[type], out = {}, r = (raw && typeof raw === "object") ? raw : {};
    if (!spec) return null;
    Object.keys(spec).forEach(function (k) {
      var kind = spec[k], v = r[k];
      if (kind === "bool") out[k] = v === true;
      else if (Array.isArray(kind)) out[k] = kind.indexOf(v) >= 0 ? v : kind[0];
      else if (kind === "date") out[k] = typeof v === "string" && validDate(v) ? v : "";
      else if (kind === "time") out[k] = typeof v === "string" && TIME_RE.test(v) ? v : "";
      else out[k] = typeof v === "string" ? v.replace(/\r\n?/g, "\n").slice(0, kind) : "";
    });
    return out;
  }

  function one(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  function lines(s) { return String(s || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim(); }

  // ---------- Escaping ----------
  function escWifi(s) { return String(s).replace(/([\\;,:"])/g, "\\$1"); }
  // vCard 3.0 / iCalendar TEXT values: backslash, ";", ",", new line.
  function escText(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }

  // ---------- URL ----------
  function normUrl(s) {
    var u = one(s);
    if (!u) return { error: "need.url" };
    if (/\s/.test(u)) return { error: "bad.url" };
    // "host:8080/x" has no scheme (a digit follows the colon)
    if (!/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(u)) u = "https://" + u;
    var m = /^([a-z][a-z0-9+.-]*):\/\/([^\/?#]+)/i.exec(u);
    if (!m || !/^https?$/i.test(m[1])) return { error: "bad.url" };
    var host = m[2].replace(/^[^@]*@/, "").replace(/:\d+$/, "");
    if (!/^(\[[0-9a-f:.]+\]|[^\s.:\/]+(\.[^\s.:\/]+)*)$/i.test(host) ||
        (host.indexOf(".") < 0 && host.toLowerCase() !== "localhost" && host.charAt(0) !== "[")) return { error: "bad.url" };
    return { text: u };
  }

  // ---------- Dates ----------
  function ymd(s) { return s.replace(/-/g, ""); }
  function hms(s) { return s.replace(":", "") + "00"; }
  function addDay(s) {
    var d = new Date(s + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // ---------- Builders ----------
  var BUILD = {
    url: function (f) { return normUrl(f.url); },

    text: function (f) {
      var t = String(f.text || "");
      return t.trim() ? { text: t } : { error: "need.text" };
    },

    wifi: function (f) {
      var ssid = String(f.ssid || "");
      if (!ssid.trim()) return { error: "need.ssid" };
      var sec = f.sec === "WEP" || f.sec === "nopass" ? f.sec : "WPA", pass = String(f.pass || "");
      if (sec !== "nopass" && !pass) return { error: "need.pass" };
      if (sec === "WPA" && pass.length < 8) return { error: "bad.pass" };
      var s = "WIFI:T:" + sec + ";S:" + escWifi(ssid) + ";";
      if (sec !== "nopass") s += "P:" + escWifi(pass) + ";";
      if (f.hidden) s += "H:true;";
      return { text: s + ";" };
    },

    vcard: function (f) {
      var first = one(f.first), last = one(f.last), org = one(f.org);
      if (!first && !last && !org) return { error: "need.name" };
      var L = ["BEGIN:VCARD", "VERSION:3.0"];
      L.push("N:" + escText(last) + ";" + escText(first) + ";;;");
      L.push("FN:" + escText(one(first + " " + last) || org));
      if (org) L.push("ORG:" + escText(org));
      if (one(f.title)) L.push("TITLE:" + escText(one(f.title)));
      if (one(f.mobile)) L.push("TEL;TYPE=CELL:" + escText(one(f.mobile)));
      if (one(f.phone)) L.push("TEL;TYPE=VOICE:" + escText(one(f.phone)));
      if (one(f.email)) L.push("EMAIL;TYPE=INTERNET:" + escText(one(f.email)));
      var adr = [f.street, f.city, f.region, f.zip, f.country].map(one);
      if (adr.join("")) L.push("ADR:;;" + adr.map(escText).join(";"));
      if (one(f.web)) {
        var w = normUrl(f.web);
        L.push("URL:" + escText(w.text || one(f.web)));
      }
      if (lines(f.note)) L.push("NOTE:" + escText(lines(f.note)));
      L.push("END:VCARD");
      return { text: L.join("\r\n") };
    },

    event: function (f) {
      var title = one(f.title);
      if (!title) return { error: "need.title" };
      if (!validDate(f.date || "")) return { error: "need.date" };
      var dEnd = f.dateEnd && validDate(f.dateEnd) ? f.dateEnd : "";
      if (dEnd && dEnd < f.date) return { error: "bad.end" };
      var L = ["BEGIN:VEVENT", "SUMMARY:" + escText(title)];
      if (f.allDay) {
        L.push("DTSTART;VALUE=DATE:" + ymd(f.date));
        L.push("DTEND;VALUE=DATE:" + ymd(addDay(dEnd || f.date)));
      } else {
        if (!TIME_RE.test(f.start || "")) return { error: "need.time" };
        L.push("DTSTART:" + ymd(f.date) + "T" + hms(f.start));
        var end = TIME_RE.test(f.end || "") ? f.end : "";
        if (end || dEnd) {
          var ed = dEnd || f.date, et = end || f.start;
          if (ed + et < f.date + f.start) return { error: "bad.end" };
          L.push("DTEND:" + ymd(ed) + "T" + hms(et));
        }
      }
      if (one(f.location)) L.push("LOCATION:" + escText(one(f.location)));
      if (lines(f.note)) L.push("DESCRIPTION:" + escText(lines(f.note)));
      L.push("END:VEVENT");
      return { text: L.join("\r\n") };
    },

    email: function (f) {
      var to = one(f.to);
      if (!to) return { error: "need.email" };
      if (!/^[^\s@<>()",;:?&#\/\\]+@[^\s@<>()",;:?&#\/\\]+\.[^\s@<>()",;:?&#\/\\]+$/.test(to)) return { error: "bad.email" };
      var q = [];
      if (one(f.subject)) q.push("subject=" + encodeURIComponent(one(f.subject)));
      if (lines(f.body)) q.push("body=" + encodeURIComponent(lines(f.body)));
      return { text: "mailto:" + to + (q.length ? "?" + q.join("&") : "") };
    },

    phone: function (f) {
      var n = cleanNumber(f.number);
      return n.error ? n : { text: "tel:" + n.n };
    },

    sms: function (f) {
      var n = cleanNumber(f.number);
      if (n.error) return n;
      var msg = lines(f.message);
      return { text: "SMSTO:" + n.n + ":" + msg };
    },

    geo: function (f) {
      var la = String(f.lat || "").trim().replace(",", "."), lo = String(f.lon || "").trim().replace(",", ".");
      if (!la && !lo) return { error: "need.geo" };
      var NUM = /^[-+]?\d{1,3}(\.\d+)?$/;
      var a = parseFloat(la), b = parseFloat(lo);
      if (!NUM.test(la) || !NUM.test(lo) || a < -90 || a > 90 || b < -180 || b > 180) return { error: "bad.geo" };
      return { text: "geo:" + trimNum(a) + "," + trimNum(b) };
    }
  };

  function trimNum(x) { return String(Math.round(x * 1e6) / 1e6); }

  // Phone numbers: digits, a leading +, * and #. Spaces, dashes,
  // dots and brackets are dropped; anything else is an error.
  function cleanNumber(s) {
    var raw = one(s);
    if (!raw) return { error: "need.number" };
    var n = raw.replace(/[\s\-.()\/]/g, "");
    if (!/^\+?[0-9*#]{2,20}$/.test(n)) return { error: "bad.number" };
    return { n: n };
  }

  function build(type, fields) {
    var f = normFields(type, fields);
    if (!f) return { error: "bad.type" };
    return BUILD[type](f);
  }

  // A short default caption for the code.
  function caption(type, fields) {
    var f = normFields(type, fields) || {};
    switch (type) {
      case "wifi": return one(f.ssid);
      case "vcard": return one(one(f.first) + " " + one(f.last)) || one(f.org);
      case "event": return one(f.title);
      case "url": var m = /^(?:https?:\/\/)?([^\/?#]+)/i.exec(one(f.url)); return m ? m[1].replace(/^www\./i, "") : "";
      case "email": return one(f.to);
      case "phone": case "sms": return one(f.number);
      default: return "";
    }
  }

  // File name stem: "qr-wifi-Home-Net". Letters (any script), digits,
  // "-" and "_" only, ≤ 60 characters.
  function fileStem(type, fields) {
    var c = caption(type, fields).replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return "qr-" + type + (c ? "-" + c : "");
  }

  // ---------- Colours ----------
  function lum(hex) {
    var v = parseInt(String(hex).slice(1), 16);
    var lin = function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(v >> 16 & 255) + 0.7152 * lin(v >> 8 & 255) + 0.0722 * lin(v & 255);
  }
  // "ok" | "low" (contrast under 3:1) | "inverted" (light code on dark)
  function contrast(fg, bg) {
    var a = lum(fg), b = lum(bg);
    if (a > b) return "inverted";
    return (b + 0.05) / (a + 0.05) < 3 ? "low" : "ok";
  }

  var api = {
    VERSION: "1.0.0",
    TYPES: TYPES,
    FIELDS: FIELDS,
    normFields: normFields,
    build: build,
    caption: caption,
    fileStem: fileStem,
    contrast: contrast,
    escWifi: escWifi,
    escText: escText,
    normUrl: normUrl
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.orosQRPayload = api;
})(typeof window !== "undefined" ? window : this);
