// ============================================================
// orOS "Send to someone" — share/kinds.js (pure core, v1.0.0)
// One item (a To-Do list, a note, a contact, an event, a recipe,
// a few bookmarks, a Calendar's free times, a Wiki article or a whole
// calendar / date range of the Calendar)
// travels INSIDE a link:
//   https://useoros.online/share/#1.<base64url of deflate-raw JSON>
//   https://useoros.online/share/#p1.<base64url of salt|iv|AES-GCM>
// The part after "#" never reaches a server. No server, no account,
// no sync slice: the link IS the data. With a password the link alone
// is useless (AES-256-GCM, key = PBKDF2-SHA-256 × 600,000 of the
// password, the same strength as orOS sync).
//
// Everything that arrives is hostile: every kind has a strict
// normalizer with caps, decompression stops at MAX_JSON, and nothing
// here builds HTML (the views use textContent only).
//
// Used by the shell (share/send.js, lazy) and the receiving page
// (share/index.html). No DOM, no storage. Node tests load it as is.
//
// API (window.OrosShareKinds / module.exports):
//   KINDS, MAX_LINK, MAX_JSON, ITER
//   norm(kind, data)               → clean data | null
//   pack(kind, data)               → envelope {v, k, d} | null
//   encode(env, password?)         → Promise<code>  ("1.…", "0.…", "p1.…")
//   decode(code, password?)        → Promise<{ env } | { error }>
//                                    error: "bad" | "big" | "pass" (wrong or
//                                    missing password) | "crypto"
//   isLocked(code)                 → true for a password link
//   codeFromHash(hash)             → the code in "#…", or ""
//   summary(env, lang)             → one line ("List "Shop" · 12 items")
//   text(env, lang, helpers?)      → plain text of the item
//   file(env, lang)                → { name, mime, text } (.vcf, .ics, .html, .md, .txt)
//   target(env, lang)              → { app, target } for __orosOpenAt
//   vcard(d) / ics(d) / netscape(d) (the file builders)
//   slotWhen(d, day, min)          → a free time ("slots") as the
//                                    receiver's own local day + times
//   slotEvent(d, day, min, lang)   → that time as "event" data (.ics, Calendar)
//   slotMail(d, day, min, lang)    → mailto: link back to the sender, or ""
//   calIcs(d, lang)                → a whole "cal" item as one .ics
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var KINDS = ["list", "note", "contact", "event", "recipe", "links", "slots", "wiki", "cal"];
  var MAX_LINK = 32768;          // characters of the code after "#"
  var MAX_JSON = 262144;         // bytes after decompression (bomb guard)
  var ITER = 600000;             // PBKDF2 rounds for password links
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  var MD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

  // ---------- 1. Strings (EN / EL) ----------
  var S = {
    en: {
      list: "List", note: "Note", contact: "Contact", event: "Event", recipe: "Recipe", links: "Links", wiki: "Wiki article",
      items: "{n} items", item1: "1 item", links1: "1 link", linksN: "{n} links",
      untitled: "Untitled", allday: "all day", repeats: "Repeats", every: { D: "every day", W: "every week", M: "every month", Y: "every year" },
      every2: { D: "every 2 days", W: "every 2 weeks", M: "every 2 months", Y: "every 2 years" },
      until: "until {d}", serv: "Serves {n}", ings: "Ingredients", steps: "Steps", source: "Source",
      prep: "Prep {n} min", cook: "Cook {n} min", from: "an orOS link",
      phone: "Phone", email: "Email", address: "Address", web: "Website", im: "Chat",
      org: "Organisation", job: "Job title", nick: "Nickname", birthday: "Birthday", anniversary: "Anniversary",
      where: "Where", noteL: "Note", sharedLinks: "Links you got",
      slots: "Free times", slotsT: "Free times", slotsN: "{n} times to pick from", slots1: "1 time to pick from",
      slotLen: "{n} min", slotWith: "With {n}", slotSubj: "Booking: {t}, {w}",
      slotBody: "Hello{n},\n\nI'd like to take this time:\n{t}\n{w}\n\nThanks!",
      slotZone: "{w} ({z} time)",
      cal: "Calendar", calT: "Calendar", calN: "{n} events", cal1: "1 event", calFrom: "from {d}", calTo: "to {d}"
    },
    el: {
      list: "Λίστα", note: "Σημείωμα", contact: "Επαφή", event: "Γεγονός", recipe: "Συνταγή", links: "Σύνδεσμοι", wiki: "Άρθρο wiki",
      items: "{n} είδη", item1: "1 είδος", links1: "1 σύνδεσμος", linksN: "{n} σύνδεσμοι",
      untitled: "Χωρίς τίτλο", allday: "όλη μέρα", repeats: "Επαναλαμβάνεται", every: { D: "κάθε μέρα", W: "κάθε εβδομάδα", M: "κάθε μήνα", Y: "κάθε χρόνο" },
      every2: { D: "κάθε 2 μέρες", W: "κάθε 2 εβδομάδες", M: "κάθε 2 μήνες", Y: "κάθε 2 χρόνια" },
      until: "έως {d}", serv: "Μερίδες: {n}", ings: "Υλικά", steps: "Βήματα", source: "Πηγή",
      prep: "Προετοιμασία {n}′", cook: "Μαγείρεμα {n}′", from: "σύνδεσμο orOS",
      phone: "Τηλέφωνο", email: "Email", address: "Διεύθυνση", web: "Ιστότοπος", im: "Chat",
      org: "Οργανισμός", job: "Θέση", nick: "Ψευδώνυμο", birthday: "Γενέθλια", anniversary: "Επέτειος",
      where: "Πού", noteL: "Σημείωση", sharedLinks: "Σύνδεσμοι που έλαβες",
      slots: "Ελεύθερες ώρες", slotsT: "Ελεύθερες ώρες", slotsN: "{n} ώρες για να διαλέξεις", slots1: "1 ώρα για να διαλέξεις",
      slotLen: "{n}′", slotWith: "Με: {n}", slotSubj: "Κράτηση: {t}, {w}",
      slotBody: "Γεια σου{n},\n\nΘα ήθελα να κλείσω αυτή την ώρα:\n{t}\n{w}\n\nΕυχαριστώ!",
      slotZone: "{w} (ώρα {z})",
      cal: "Ημερολόγιο", calT: "Ημερολόγιο", calN: "{n} γεγονότα", cal1: "1 γεγονός", calFrom: "από {d}", calTo: "έως {d}"
    }
  };
  function L(lang) { return S[lang] || S.en; }
  function fill(s, p) {
    Object.keys(p || {}).forEach(function (k) { s = s.split("{" + k + "}").join(String(p[k])); });
    return s;
  }

  // ---------- 2. Clean text ----------
  // One line: control characters out, spaces collapsed, trimmed, capped.
  function line(v, max) {
    if (typeof v !== "string") return "";
    v = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    return v.length > max ? v.slice(0, max).trim() : v;
  }
  // A block: newlines kept (CRLF → LF), other control characters out.
  function block(v, max) {
    if (typeof v !== "string") return "";
    v = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, " ").trim();
    return v.length > max ? v.slice(0, max).trim() : v;
  }
  function pick(v, list, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }
  function validYmd(s) {
    var m = typeof s === "string" && YMD_RE.exec(s);
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function webUrl(v, max) {
    v = line(v, max);
    if (!/^https?:\/\//i.test(v)) return "";
    try {
      var u = new URL(v);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return u.href.length > max ? "" : u.href;
    } catch (e) { return ""; }
  }
  function num(v, lo, hi) {
    return (typeof v === "number" && isFinite(v) && v >= lo && v <= hi) ? v : null;
  }
  function arr(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }

  // ---------- 3. Normalizers (one per kind) ----------
  function normList(d) {
    var items = [];
    arr(d.i, 200).forEach(function (x) {
      if (!x || typeof x !== "object") return;
      var t = line(x.x, 300);
      if (!t) return;
      var o = { x: t };
      var n = block(x.n, 1000);
      if (n) o.n = n;
      if (x.d === 1) o.d = 1;
      items.push(o);
    });
    if (!items.length) return null;
    return { t: line(d.t, 60), i: items };
  }
  function normNote(d) {
    var t = line(d.t, 200), x = block(d.x, 20000);
    if (!t && !x) return null;
    return { t: t, x: x };
  }
  // A Wiki article: its title and its text (wiki/core.js markup, no
  // pictures); the receiver renders it with WikiCore (DOM nodes only).
  function normWiki(d) {
    var t = line(d.t, 200), x = block(d.x, 60000);
    if (!t) return null;
    return { t: t, x: x };
  }
  var PHONE_T = ["mobile", "home", "work", "main", "other"];
  var MAIL_T = ["home", "work", "other"];
  var EVT_T = ["birthday", "anniversary", "custom"];
  function vals(list, max, len, types) {
    var out = [];
    arr(list, max).forEach(function (r) {
      if (!r || typeof r !== "object") return;
      var v = line(r.v, len);
      if (v) out.push({ v: v, ty: pick(r.ty, types, "other") });
    });
    return out;
  }
  function normContact(d) {
    var c = {
      g: line(d.g, 60), mi: line(d.mi, 60), f: line(d.f, 60), nn: line(d.nn, 60),
      o: line(d.o, 100), j: line(d.j, 100),
      p: vals(d.p, 10, 40, PHONE_T),
      e: vals(d.e, 10, 120, MAIL_T).filter(function (r) { return /^[^\s@]+@[^\s@]+$/.test(r.v); }),
      a: [], u: [], im: vals(d.im, 10, 120, MAIL_T), ev: [], x: block(d.x, 2000)
    };
    arr(d.a, 5).forEach(function (r) {
      if (!r || typeof r !== "object") return;
      var a = { s: line(r.s, 200), c: line(r.c, 100), r: line(r.r, 100), z: line(r.z, 20), co: line(r.co, 100), ty: pick(r.ty, MAIL_T, "other") };
      if (a.s || a.c || a.r || a.z || a.co) c.a.push(a);
    });
    arr(d.u, 10).forEach(function (r) {
      var v = webUrl(r && typeof r === "object" ? r.v : r, 300);
      if (v) c.u.push({ v: v, ty: pick(r && r.ty, MAIL_T, "other") });
    });
    arr(d.ev, 10).forEach(function (r) {
      if (!r || typeof r !== "object" || typeof r.d !== "string" || !MD_RE.test(r.d)) return;
      var y = num(r.y, 1000, 9999);
      var e = { ty: pick(r.ty, EVT_T, "custom"), d: r.d };
      if (y !== null && Math.floor(y) === y && validYmd(y + "-" + r.d)) e.y = y;
      if (e.ty === "custom") e.l = line(r.l, 40);
      c.ev.push(e);
    });
    if (!c.g && !c.f && !c.mi && !c.nn && !c.o && !c.p.length && !c.e.length) return null;
    return c;
  }
  function normEvent(d) {
    if (!validYmd(d.d)) return null;
    var e = { t: line(d.t, 200), d: d.d };
    if (validYmd(d.de) && d.de > d.d) e.de = d.de;
    if (typeof d.s === "string" && HM_RE.test(d.s)) {
      e.s = d.s;
      if (typeof d.e === "string" && HM_RE.test(d.e)) e.e = d.e;
    }
    var l = line(d.l, 200), x = block(d.x, 500);
    if (l) e.l = l;
    if (x) e.x = x;
    if (d.r && typeof d.r === "object" && /^[DWMY]$/.test(d.r.f)) {
      e.r = { f: d.r.f, i: d.r.i === 2 ? 2 : 1 };
      if (validYmd(d.r.u) && d.r.u >= d.d) e.r.u = d.r.u;
      // A rule the short form cannot say (Calendar wave 5: every N, weekdays,
      // Nth / last weekday, COUNT) rides along as plain RRULE text.
      if (typeof d.r.x === "string" && d.r.x.length <= 200 &&
          /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]{2,10}=[A-Z0-9,+-]{1,40}){0,8}$/.test(d.r.x) &&
          d.r.x.indexOf("FREQ=" + { D: "DAILY", W: "WEEKLY", M: "MONTHLY", Y: "YEARLY" }[d.r.f]) === 0) e.r.x = d.r.x;
    }
    if (typeof d.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(d.id)) e.id = d.id;
    return e;
  }
  function normRecipe(d) {
    var t = line(d.t, 80);
    if (!t) return null;
    var r = {
      t: t, e: line(d.e, 8), c: /^[a-z]{1,12}$/.test(d.c) ? d.c : "",
      sv: Math.round(num(d.sv, 1, 50) || 4),
      pt: Math.round(num(d.pt, 0, 1440) || 0), ct: Math.round(num(d.ct, 0, 1440) || 0),
      dt: arr(d.dt, 10).filter(function (s) { return typeof s === "string" && /^[a-z]{1,12}$/.test(s); }),
      tg: arr(d.tg, 10).map(function (s) { return line(s, 24); }).filter(Boolean),
      ig: [], st: [], no: block(d.no, 2000), src: line(d.src, 300)
    };
    arr(d.ig, 80).forEach(function (x) {
      if (!x || typeof x !== "object") return;
      var n = line(x.n, 60);
      if (!n) return;
      var q = num(x.q, 0.000001, 100000);
      r.ig.push({
        q: q === null ? null : Math.round(q * 1000) / 1000,
        u: typeof x.u === "string" && /^[a-z0-9_]{0,12}$/.test(x.u) ? x.u : "",
        n: n, x: line(x.x, 80), g: line(x.g, 40)
      });
    });
    arr(d.st, 50).forEach(function (s) { var v = block(s, 1000); if (v) r.st.push(v); });
    return r;
  }
  function normLinks(d) {
    var seen = {}, items = [];
    arr(d.i, 200).forEach(function (x) {
      if (!x || typeof x !== "object") return;
      var u = webUrl(x.u, 2048);
      if (!u || seen[u]) return;
      seen[u] = 1;
      var o = { u: u, t: line(x.t, 256) };
      var n = block(x.n, 1024);
      if (n) o.n = n;
      items.push(o);
    });
    if (!items.length) return null;
    return { t: line(d.t, 60), i: items };
  }
  // Free times from the Calendar ("Share free times"): the sender's
  // wall-clock times in its zone `tz`, as minutes after midnight per day.
  var TZ_RE = /^[A-Za-z][A-Za-z0-9_+\-\/]{0,63}$/;
  function normSlots(d) {
    var len = num(d.len, 5, 480);
    if (len === null || len % 1) return null;
    var seen = {}, days = [], total = 0;
    arr(d.s, 62).forEach(function (x) {
      if (!x || typeof x !== "object" || !validYmd(x.d) || seen[x.d]) return;
      var mins = [];
      arr(x.m, 96).forEach(function (v) {
        if (typeof v === "number" && v % 1 === 0 && v >= 0 && v < 1440 && mins.indexOf(v) < 0 && total < 1500) { mins.push(v); total++; }
      });
      if (!mins.length) return;
      seen[x.d] = 1;
      mins.sort(function (a, b) { return a - b; });
      days.push({ d: x.d, m: mins });
    });
    if (!days.length) return null;
    days.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    var o = { t: line(d.t, 120), n: line(d.n, 80), len: len, s: days };
    var m = line(d.m, 120);
    if (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(m)) o.m = m;
    if (typeof d.tz === "string" && TZ_RE.test(d.tz)) o.tz = d.tz;
    var l = line(d.l, 200), x2 = block(d.x, 500);
    if (l) o.l = l;
    if (x2) o.x = x2;
    return o;
  }
  // A whole calendar or a date range of it (share wave 3): the
  // Calendar's own events, wall times in the zone `tz` (or the event's
  // own `z`), labels as names + colours, excluded dates `xd` of a
  // series. ≤ 5,000 events and about 3 MB of JSON (the relay opens up
  // to 4 MB).
  var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  var CAL_MAX = 5000, CAL_BYTES = 3000000;
  function normCalEv(x, nlb) {
    if (!x || typeof x !== "object") return null;
    var e = normEvent(x);
    if (!e) return null;
    if (!e.id) e.id = "c" + hashHex(JSON.stringify([e.t, e.d, e.s || "", e.l || ""]));
    if (e.r) {
      var seen = {}, xd = [];
      arr(x.xd, 400).forEach(function (v) { if (validYmd(v) && !seen[v]) { seen[v] = 1; xd.push(v); } });
      if (xd.length) e.xd = xd.sort();
    }
    if (e.s && typeof x.z === "string" && TZ_RE.test(x.z)) e.z = x.z;
    if (typeof x.b === "number" && x.b % 1 === 0 && x.b >= 0 && x.b < nlb) e.b = x.b;
    return e;
  }
  function normCal(d) {
    var o = { t: line(d.t, 120) };
    if (typeof d.tz === "string" && TZ_RE.test(d.tz)) o.tz = d.tz;
    if (validYmd(d.f)) o.f = d.f;
    if (validYmd(d.u) && (!o.f || d.u >= o.f)) o.u = d.u;
    var lb = [];
    arr(d.lb, 50).forEach(function (x) {
      if (!x || typeof x !== "object") return;
      lb.push({ n: line(x.n, 60), c: typeof x.c === "string" && COLOR_RE.test(x.c) ? x.c.toLowerCase() : "" });
    });
    if (lb.length) o.lb = lb;
    var ev = [], ids = {}, size = 0;
    arr(d.ev, CAL_MAX).forEach(function (x) {
      var e = normCalEv(x, lb.length);
      if (!e || ids[e.id]) return;
      size += JSON.stringify(e).length + 1;
      if (size > CAL_BYTES) return;
      ids[e.id] = 1;
      ev.push(e);
    });
    if (!ev.length) return null;
    o.ev = ev;
    return o;
  }
  var NORM = { list: normList, note: normNote, contact: normContact, event: normEvent, recipe: normRecipe, links: normLinks, slots: normSlots, wiki: normWiki, cal: normCal };
  function norm(kind, data) {
    if (!NORM[kind] || !data || typeof data !== "object" || Array.isArray(data)) return null;
    try { return NORM[kind](data); } catch (e) { return null; }
  }
  function pack(kind, data) {
    var d = norm(kind, data);
    return d ? { v: VER, k: kind, d: d } : null;
  }
  function unpack(o) {
    if (!o || typeof o !== "object" || o.v !== VER || typeof o.k !== "string") return null;
    return pack(o.k, o.d);
  }

  // ---------- 4. Bytes: base64url, deflate-raw, AES-GCM ----------
  function b64u(bytes) {
    var bin = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(s) {
    var b = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    var bin = atob(b), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hasZip() { return typeof CompressionStream === "function" && typeof DecompressionStream === "function"; }
  function deflate(bytes) {
    var s = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Response(s).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  // Inflate with a ceiling: reading stops (and fails "big") past MAX_JSON.
  function inflate(bytes) {
    var reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    var parts = [], total = 0;
    function step() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total), at = 0;
          parts.forEach(function (p) { out.set(p, at); at += p.length; });
          return out;
        }
        total += r.value.length;
        if (total > MAX_JSON) {
          try { reader.cancel(); } catch (e) {}
          throw new Error("big");
        }
        parts.push(r.value);
        return step();
      });
    }
    return step();
  }
  function subtle() {
    var c = (typeof crypto !== "undefined" && crypto) || (root && root.crypto);
    return c && c.subtle ? c : null;
  }
  function deriveKey(c, password, salt, usage) {
    return c.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"])
      .then(function (base) {
        return c.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: ITER, hash: "SHA-256" },
          base, { name: "AES-GCM", length: 256 }, false, [usage]);
      });
  }

  // ---------- 5. encode / decode ----------
  function encode(env, password) {
    var e = unpack(env);
    if (!e) return Promise.reject(new Error("bad"));
    var raw = new TextEncoder().encode(JSON.stringify(e));
    // The receiving page refuses more than MAX_JSON: such an item can
    // only travel with an expiry (share/relay.js).
    if (raw.length > MAX_JSON) return Promise.reject(new Error("big"));
    var body = hasZip()
      ? deflate(raw).then(function (z) { return { z: 1, b: z }; })
      : Promise.resolve({ z: 0, b: raw });
    if (!password) {
      return body.then(function (x) { return (x.z ? "1." : "0.") + b64u(x.b); });
    }
    var c = subtle();
    if (!c) return Promise.reject(new Error("crypto"));
    return body.then(function (x) {
      var salt = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
      var plain = new Uint8Array(x.b.length + 1);
      plain[0] = x.z;                              // 1 = deflated, 0 = raw JSON
      plain.set(x.b, 1);
      return deriveKey(c, password, salt, "encrypt").then(function (key) {
        return c.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plain);
      }).then(function (ct) {
        var ctb = new Uint8Array(ct), all = new Uint8Array(28 + ctb.length);
        all.set(salt, 0); all.set(iv, 16); all.set(ctb, 28);
        return "p1." + b64u(all);
      });
    });
  }
  function isLocked(code) { return /^p1\./.test(String(code || "")); }
  function codeFromHash(h) {
    h = String(h || "");
    if (h.charAt(0) === "#") h = h.slice(1);
    return /^(0|1|p1)\.[A-Za-z0-9_-]+$/.test(h) ? h : "";
  }
  function fromJsonBytes(bytes) {
    if (bytes.length > MAX_JSON) return { error: "big" };
    var o;
    try { o = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch (e) { return { error: "bad" }; }
    var env = unpack(o);
    return env ? { env: env } : { error: "bad" };
  }
  function opened(z, bytes) {
    if (!z) return Promise.resolve(fromJsonBytes(bytes));
    if (!hasZip()) return Promise.resolve({ error: "bad" });
    return inflate(bytes).then(fromJsonBytes, function (e) {
      return { error: e && e.message === "big" ? "big" : "bad" };
    });
  }
  function decode(code, password) {
    code = String(code || "");
    if (code.length > MAX_LINK + 8) return Promise.resolve({ error: "big" });
    var m = /^(0|1|p1)\.([A-Za-z0-9_-]+)$/.exec(code);
    if (!m) return Promise.resolve({ error: "bad" });
    var bytes;
    try { bytes = unb64u(m[2]); } catch (e) { return Promise.resolve({ error: "bad" }); }
    if (m[1] !== "p1") return opened(m[1] === "1", bytes);
    if (!password) return Promise.resolve({ error: "pass" });
    if (bytes.length < 29) return Promise.resolve({ error: "bad" });
    var c = subtle();
    if (!c) return Promise.resolve({ error: "crypto" });
    var salt = bytes.subarray(0, 16), iv = bytes.subarray(16, 28), ct = bytes.subarray(28);
    return deriveKey(c, String(password), salt, "decrypt").then(function (key) {
      return c.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ct);
    }).then(function (pt) {
      var p = new Uint8Array(pt);
      if (p[0] !== 0 && p[0] !== 1) return { error: "bad" };
      return opened(p[0] === 1, p.subarray(1));
    }, function () { return { error: "pass" }; });
  }

  // ---------- 6. Display helpers ----------
  function contactName(d) {
    var n = [d.g, d.mi, d.f].filter(Boolean).join(" ");
    return n || d.nn || d.o || (d.p[0] && d.p[0].v) || (d.e[0] && d.e[0].v) || "";
  }
  function titleOf(env, lang) {
    var d = env.d, s = L(lang);
    var t = env.k === "contact" ? contactName(d) : d.t;
    return t || (env.k === "links" ? s.sharedLinks : env.k === "slots" ? s.slotsT : env.k === "cal" ? s.calT : s.untitled);
  }
  function fmtDate(ymd, lang) {
    var m = YMD_RE.exec(ymd);
    if (!m) return ymd;
    try {
      return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString(lang === "el" ? "el-GR" : "en-GB",
        { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    } catch (e) { return ymd; }
  }
  function whenText(d, lang) {
    var s = L(lang), out = fmtDate(d.d, lang);
    if (d.de) out += " \u2013 " + fmtDate(d.de, lang);
    out += d.s ? ", " + d.s + (d.e ? "\u2013" + d.e : "") : " (" + s.allday + ")";
    return out;
  }
  function repeatText(r, lang) {
    if (!r) return "";
    var s = L(lang);
    var t = (r.i === 2 ? s.every2 : s.every)[r.f];
    if (r.u) t += ", " + fill(s.until, { d: fmtDate(r.u, lang) });
    return t;
  }
  function ingLine(ing, helpers, lang) {
    if (helpers && typeof helpers.ingLine === "function") {
      try { return helpers.ingLine(ing, lang); } catch (e) {}
    }
    var q = ing.q === null ? "" : String(ing.q);
    return [q, ing.u, ing.n].filter(Boolean).join(" ") + (ing.x ? ", " + ing.x : "");
  }
  function summary(env, lang) {
    var s = L(lang), d = env.d, name = titleOf(env, lang);
    if (env.k === "list") return s.list + " \u00ab" + name + "\u00bb \u00b7 " + (d.i.length === 1 ? s.item1 : fill(s.items, { n: d.i.length }));
    if (env.k === "links") return s.links + " \u00b7 " + (d.i.length === 1 ? s.links1 : fill(s.linksN, { n: d.i.length }));
    if (env.k === "event") return s.event + " \u00ab" + name + "\u00bb \u00b7 " + fmtDate(d.d, lang);
    if (env.k === "slots") {
      var cnt = 0;
      d.s.forEach(function (x) { cnt += x.m.length; });
      return s.slots + " \u00ab" + name + "\u00bb \u00b7 " + (cnt === 1 ? s.slots1 : fill(s.slotsN, { n: cnt }));
    }
    if (env.k === "cal") return s.cal + " \u00ab" + name + "\u00bb \u00b7 " + (d.ev.length === 1 ? s.cal1 : fill(s.calN, { n: d.ev.length }));
    return s[env.k] + " \u00ab" + name + "\u00bb";
  }
  // "from 1 Nov 2026 to 31 Dec 2026", "" for a whole calendar.
  function calRange(d, lang) {
    var s = L(lang);
    return [d.f ? fill(s.calFrom, { d: fmtDate(d.f, lang) }) : "", d.u ? fill(s.calTo, { d: fmtDate(d.u, lang) }) : ""]
      .filter(Boolean).join(" ");
  }

  // ---------- 7. Plain text ----------
  function text(env, lang, helpers) {
    var s = L(lang), d = env.d, out = [titleOf(env, lang)];
    if (env.k === "list") {
      out.push("");
      d.i.forEach(function (it) {
        out.push((it.d ? "\u2611 " : "\u2610 ") + it.x);
        if (it.n) out.push("   " + it.n.replace(/\n/g, "\n   "));
      });
    } else if (env.k === "note" || env.k === "wiki") {
      if (d.x) out.push("", d.x);
    } else if (env.k === "contact") {
      if (d.nn) out.push(s.nick + ": " + d.nn);
      if (d.o) out.push(s.org + ": " + d.o);
      if (d.j) out.push(s.job + ": " + d.j);
      d.p.forEach(function (r) { out.push(s.phone + ": " + r.v); });
      d.e.forEach(function (r) { out.push(s.email + ": " + r.v); });
      d.a.forEach(function (a) { out.push(s.address + ": " + addrText(a)); });
      d.u.forEach(function (r) { out.push(s.web + ": " + r.v); });
      d.im.forEach(function (r) { out.push(s.im + ": " + r.v); });
      d.ev.forEach(function (e) { out.push((e.ty === "custom" ? (e.l || s.event) : s[e.ty]) + ": " + (e.y ? e.y + "-" : "") + e.d); });
      if (d.x) out.push("", d.x);
    } else if (env.k === "event") {
      out.push(whenText(d, lang));
      if (d.r) out.push(s.repeats + ": " + repeatText(d.r, lang));
      if (d.l) out.push(s.where + ": " + d.l);
      if (d.x) out.push("", d.x);
    } else if (env.k === "recipe") {
      out[0] = (d.e ? d.e + " " : "") + d.t;
      var meta = [fill(s.serv, { n: d.sv })];
      if (d.pt) meta.push(fill(s.prep, { n: d.pt }));
      if (d.ct) meta.push(fill(s.cook, { n: d.ct }));
      out.push(meta.join(" \u00b7 "));
      if (d.ig.length) {
        out.push("", s.ings + ":");
        var g = "";
        d.ig.forEach(function (ing) {
          if (ing.g && ing.g !== g) { g = ing.g; out.push(g + ":"); }
          out.push("- " + ingLine(ing, helpers, lang));
        });
      }
      if (d.st.length) {
        out.push("", s.steps + ":");
        d.st.forEach(function (x, i) { out.push((i + 1) + ". " + x); });
      }
      if (d.no) out.push("", d.no);
      if (d.src) out.push("", s.source + ": " + d.src);
    } else if (env.k === "slots") {
      out.push([d.n ? fill(s.slotWith, { n: d.n }) : "", fill(s.slotLen, { n: d.len })].filter(Boolean).join(" \u00b7 "));
      if (d.l) out.push(s.where + ": " + d.l);
      if (d.x) out.push("", d.x);
      out.push("");
      d.s.forEach(function (x) {
        out.push(fmtDate(x.d, lang) + ": " + x.m.map(hmOf).join(", "));
      });
      if (d.tz) out.push("(" + d.tz + ")");
      if (d.m) out.push("", s.email + ": " + d.m);
    } else if (env.k === "cal") {
      var rg = calRange(d, lang);
      if (rg) out.push(rg);
      out.push("");
      d.ev.slice().sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.s || "") < (b.s || "") ? -1 : 1; })
        .forEach(function (e) {
          out.push(whenText(e, lang) + " \u00b7 " + (e.t || s.untitled) + (e.r ? " (" + repeatText(e.r, lang) + ")" : "") +
            (e.l ? " \u00b7 " + e.l : ""));
        });
      if (d.tz) out.push("", "(" + d.tz + ")");
    } else if (env.k === "links") {
      out.push("");
      d.i.forEach(function (it) {
        out.push("- " + (it.t || it.u));
        out.push("  " + it.u);
        if (it.n) out.push("  " + it.n.replace(/\n/g, "\n  "));
      });
    }
    return out.join("\n");
  }
  function addrText(a) {
    return [a.s, a.c, [a.z, a.r].filter(Boolean).join(" "), a.co].filter(Boolean).join(", ");
  }

  // ---------- 8. Files: vCard 3.0, iCalendar, Netscape bookmarks ----------
  function vEsc(s) {
    return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }
  function vcard(d) {
    var out = ["BEGIN:VCARD", "VERSION:3.0"];
    out.push("N:" + [d.f, d.g, d.mi, "", ""].map(vEsc).join(";"));
    out.push("FN:" + vEsc(contactName(d)));
    if (d.nn) out.push("NICKNAME:" + vEsc(d.nn));
    if (d.o) out.push("ORG:" + vEsc(d.o));
    if (d.j) out.push("TITLE:" + vEsc(d.j));
    d.p.forEach(function (r) { out.push("TEL;TYPE=" + (r.ty === "mobile" ? "CELL" : r.ty.toUpperCase()) + ":" + vEsc(r.v)); });
    d.e.forEach(function (r) { out.push("EMAIL;TYPE=" + r.ty.toUpperCase() + ":" + vEsc(r.v)); });
    d.a.forEach(function (a) { out.push("ADR;TYPE=" + a.ty.toUpperCase() + ":" + ["", "", a.s, a.c, a.r, a.z, a.co].map(vEsc).join(";")); });
    d.u.forEach(function (r) { out.push("URL:" + vEsc(r.v)); });
    d.im.forEach(function (r) { out.push("IMPP:" + vEsc(r.v)); });
    d.ev.forEach(function (e) {
      var v = e.y ? e.y + "-" + e.d : "--" + e.d;
      if (e.ty === "birthday") out.push("BDAY:" + v);
      else if (e.ty === "anniversary") out.push("ANNIVERSARY:" + v);
      else out.push("X-EVENT;TYPE=CUSTOM;X-LABEL=" + vEsc(e.l) + ":" + v);
    });
    if (d.x) out.push("NOTE:" + vEsc(d.x));
    out.push("END:VCARD");
    return out.join("\r\n") + "\r\n";
  }
  function icsDt(ymd, hm) { return ymd.replace(/-/g, "") + (hm ? "T" + hm.replace(":", "") + "00" : ""); }
  function addDay(ymd) {
    var m = YMD_RE.exec(ymd), t = Date.UTC(+m[1], +m[2] - 1, +m[3]) + 86400000, x = new Date(t);
    return x.getUTCFullYear() + "-" + ("0" + (x.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + x.getUTCDate()).slice(-2);
  }
  // Floating local times, like the Calendar's own export; the UID
  // keeps a re-sent event an update instead of a duplicate.
  function ics(d, stamp) {
    var out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//orOS//Share//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT"];
    out.push("UID:" + (d.id || ("x" + hashHex(JSON.stringify([d.t, d.d, d.s || ""])))) + "@share.oros");
    out.push("DTSTAMP:" + new Date(stamp || 946684800000).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""));
    if (!d.s) {
      out.push("DTSTART;VALUE=DATE:" + icsDt(d.d));
      out.push("DTEND;VALUE=DATE:" + icsDt(addDay(d.de || d.d)));
    } else {
      out.push("DTSTART:" + icsDt(d.d, d.s));
      out.push("DTEND:" + icsDt(d.de || d.d, d.e || d.s));
    }
    out.push("SUMMARY:" + vEsc(d.t || "Event"));
    if (d.x) out.push("DESCRIPTION:" + vEsc(d.x));
    if (d.l) out.push("LOCATION:" + vEsc(d.l));
    if (d.r) {
      var F = { D: "DAILY", W: "WEEKLY", M: "MONTHLY", Y: "YEARLY" };
      out.push("RRULE:" + (d.r.x || ("FREQ=" + F[d.r.f] + (d.r.i === 2 ? ";INTERVAL=2" : "") + (d.r.u ? ";UNTIL=" + icsDt(d.r.u) : ""))));
    }
    out.push("END:VEVENT", "END:VCALENDAR");
    return out.join("\r\n") + "\r\n";
  }
  // A whole "cal" item: one VEVENT per event, timed ones in their zone
  // (TZID = IANA name, which the Calendar's parser and the big calendar
  // apps read), series with their RRULE and excluded dates, the label
  // as CATEGORIES (the Calendar matches it to a label by name).
  function calIcs(d, lang) {
    var F = { D: "DAILY", W: "WEEKLY", M: "MONTHLY", Y: "YEARLY" };
    var out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//orOS//Share//EN", "CALSCALE:GREGORIAN",
      "X-WR-CALNAME:" + vEsc(d.t || L(lang).calT)];
    if (d.tz) out.push("X-WR-TIMEZONE:" + d.tz);
    d.ev.forEach(function (e) {
      var zone = e.s ? (e.z || d.tz || "") : "", zp = zone ? ";TZID=" + zone : "";
      out.push("BEGIN:VEVENT", "UID:" + e.id + "@share.oros", "DTSTAMP:20000101T000000Z");
      if (!e.s) {
        out.push("DTSTART;VALUE=DATE:" + icsDt(e.d), "DTEND;VALUE=DATE:" + icsDt(addDay(e.de || e.d)));
      } else {
        out.push("DTSTART" + zp + ":" + icsDt(e.d, e.s), "DTEND" + zp + ":" + icsDt(e.de || e.d, e.e || e.s));
      }
      out.push("SUMMARY:" + vEsc(e.t || L(lang).untitled));
      if (e.x) out.push("DESCRIPTION:" + vEsc(e.x));
      if (e.l) out.push("LOCATION:" + vEsc(e.l));
      if (e.r) {
        out.push("RRULE:" + (e.r.x || ("FREQ=" + F[e.r.f] + (e.r.i === 2 ? ";INTERVAL=2" : "") + (e.r.u ? ";UNTIL=" + icsDt(e.r.u) : ""))));
        if (e.xd) {
          out.push(e.s ? "EXDATE" + zp + ":" + e.xd.map(function (x) { return icsDt(x, e.s); }).join(",")
                       : "EXDATE;VALUE=DATE:" + e.xd.map(function (x) { return icsDt(x); }).join(","));
        }
      }
      var lb = typeof e.b === "number" && d.lb ? d.lb[e.b] : null;
      if (lb && lb.n) out.push("CATEGORIES:" + vEsc(lb.n));
      out.push("END:VEVENT");
    });
    out.push("END:VCALENDAR");
    return out.join("\r\n") + "\r\n";
  }
  function hashHex(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function hEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function netscape(d, lang) {
    var out = ["<!DOCTYPE NETSCAPE-Bookmark-file-1>",
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      "<TITLE>Bookmarks</TITLE>", "<H1>Bookmarks</H1>", "<DL><p>",
      "    <DT><H3>" + hEsc(d.t || L(lang).sharedLinks) + "</H3>", "    <DL><p>"];
    d.i.forEach(function (it) { out.push('        <DT><A HREF="' + hEsc(it.u) + '">' + hEsc(it.t || it.u) + "</A>"); });
    out.push("    </DL><p>", "</DL><p>");
    return out.join("\n") + "\n";
  }
  function fileName(s, ext) {
    var b = String(s || "").replace(/[\\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    return (b || "orOS") + ext;
  }
  function file(env, lang) {
    var name = titleOf(env, lang);
    if (env.k === "contact") return { name: fileName(name, ".vcf"), mime: "text/vcard;charset=utf-8", text: vcard(env.d) };
    if (env.k === "event") return { name: fileName(name, ".ics"), mime: "text/calendar;charset=utf-8", text: ics(env.d) };
    if (env.k === "links") return { name: fileName(name, ".html"), mime: "text/html;charset=utf-8", text: netscape(env.d, lang) };
    if (env.k === "cal") return { name: fileName(name, ".ics"), mime: "text/calendar;charset=utf-8", text: calIcs(env.d, lang) };
    if (env.k === "wiki") return { name: fileName(name, ".md"), mime: "text/markdown;charset=utf-8", text: "# " + env.d.t + "\n\n" + env.d.x + "\n" };
    return { name: fileName(name, ".txt"), mime: "text/plain;charset=utf-8", text: text(env, lang) + "\n" };
  }

  // ---------- 9. Where "Add to my orOS" goes ----------
  // Only receivers that already exist (or ship with this feature);
  // every one of them shows its own dialog or prefilled form, and the
  // To-Do / Calendar / Contacts / Bookmarks / Meals ones save nothing
  // until the user confirms.
  function target(env, lang) {
    var d = env.d, s = L(lang);
    if (env.k === "list") {
      var open = d.i.filter(function (it) { return !it.d; });
      var items = (open.length ? open : d.i).map(function (it) { return { text: it.x, note: it.n || "" }; });
      return { app: "todo", target: { addItems: { newList: d.t || s.list, from: s.from, items: items } } };
    }
    if (env.k === "note") return { app: "notes", target: { add: { title: d.t, text: d.x } } };
    if (env.k === "contact") return { app: "contacts", target: { importVcf: { name: fileName(contactName(d), ".vcf"), text: vcard(d) } } };
    if (env.k === "event") return { app: "calendar", target: { importIcs: { name: fileName(d.t, ".ics"), text: ics(d) } } };
    if (env.k === "recipe") return { app: "meals", target: { addRecipe: d } };
    if (env.k === "cal") return { app: "calendar", target: { importIcs: { name: fileName(d.t || s.calT, ".ics"), text: calIcs(d, lang) } } };
    if (env.k === "wiki") return { app: "wiki", target: { addArticle: { t: d.t, x: d.x } } };
    if (env.k === "slots") return null;          // a time is picked on the page first (slotEvent)
    if (d.i.length === 1) return { app: "bookmarks", target: { add: { url: d.i[0].u, title: d.i[0].t } } };
    return { app: "bookmarks", target: { addMany: { folder: d.t || s.sharedLinks, items: d.i.map(function (it) { return { url: it.u, title: it.t }; }) } } };
  }

  // ---------- 10. Free times: zones, the picked time ----------
  function hmOf(min) { return ("0" + Math.floor(min / 60)).slice(-2) + ":" + ("0" + (min % 60)).slice(-2); }
  function zoneOff(tz, ms) {
    var f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    var p = {};
    f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000) / 60000;
  }
  // Sender's wall time (day, minutes, its zone) → ms, or null.
  function slotMs(d, day, min) {
    var m = YMD_RE.exec(day);
    if (!m || !d.tz) return null;
    var wall = Date.UTC(+m[1], +m[2] - 1, +m[3]) + min * 60000;
    try {
      var g = wall - zoneOff(d.tz, wall) * 60000;
      return wall - zoneOff(d.tz, g) * 60000;
    } catch (e) { return null; }
  }
  function ymdLocal(dt) {
    return dt.getFullYear() + "-" + ("0" + (dt.getMonth() + 1)).slice(-2) + "-" + ("0" + dt.getDate()).slice(-2);
  }
  // { d, s, e, de?, shifted } in the receiver's own zone (the sender's
  // times as they are when there is no zone or Intl fails).
  function slotWhen(d, day, min) {
    var ms = slotMs(d, day, min);
    if (ms === null) {
      var endM = min + d.len, o = { d: day, s: hmOf(min), e: hmOf(endM % 1440), shifted: false };
      if (endM >= 1440) o.de = addDay(day);
      return o;
    }
    var a = new Date(ms), b = new Date(ms + d.len * 60000);
    var r = { d: ymdLocal(a), s: ("0" + a.getHours()).slice(-2) + ":" + ("0" + a.getMinutes()).slice(-2),
              e: ("0" + b.getHours()).slice(-2) + ":" + ("0" + b.getMinutes()).slice(-2), shifted: false };
    if (ymdLocal(b) !== r.d) r.de = ymdLocal(b);
    r.shifted = r.d !== day || r.s !== hmOf(min);
    return r;
  }
  function slotEvent(d, day, min, lang) {
    var w = slotWhen(d, day, min), s = L(lang);
    var e = { t: d.t || s.slotsT, d: w.d, s: w.s, e: w.e };
    if (w.de) e.de = w.de;
    if (d.l) e.l = d.l;
    var note = [d.n ? fill(s.slotWith, { n: d.n }) : "", d.m || "", d.x || ""].filter(Boolean).join("\n");
    if (note) e.x = note.slice(0, 500);
    e.id = "slot" + hashHex(JSON.stringify([d.t, day, min, d.m || ""]));
    return normEvent(e);
  }
  function slotMail(d, day, min, lang) {
    if (!d.m) return "";
    var s = L(lang), ev = slotEvent(d, day, min, lang);
    var when = whenText(ev, lang);
    // The sender's own wall time too, when the zones differ.
    var w = slotWhen(d, day, min);
    if (w.shifted && d.tz) {
      when += "\n" + fill(s.slotZone, { w: whenText({ d: day, s: hmOf(min), e: hmOf((min + d.len) % 1440) }, lang), z: d.tz });
    }
    var subj = fill(s.slotSubj, { t: d.t || s.slotsT, w: whenText(ev, lang) });
    var body = fill(s.slotBody, { n: d.n ? " " + d.n.split(" ")[0] : "", t: d.t || s.slotsT, w: when });
    return "mailto:" + encodeURIComponent(d.m).replace(/%40/g, "@") +
      "?subject=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(body);
  }

  var api = {
    VER: VER, KINDS: KINDS, MAX_LINK: MAX_LINK, MAX_JSON: MAX_JSON, ITER: ITER,
    norm: norm, pack: pack, encode: encode, decode: decode, isLocked: isLocked, codeFromHash: codeFromHash,
    summary: summary, title: titleOf, text: text, file: file, target: target,
    whenText: whenText, repeatText: repeatText, addrText: addrText, contactName: contactName,
    vcard: vcard, ics: ics, calIcs: calIcs, calRange: calRange, fmtDate: fmtDate, netscape: netscape, strings: L,
    slotWhen: slotWhen, slotEvent: slotEvent, slotMail: slotMail, hm: hmOf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosShareKinds = api;
})(typeof window !== "undefined" ? window : globalThis);
