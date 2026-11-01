// ============================================================
// orOS Passwords — entries, merge, TOTP, imports (PmCore, v2.0.0)
// Pure logic, no DOM: the app (pmapp.js) and the tests
// (tests/passwords-*.test.js) load this same file. Works on
// DECRYPTED data only, in memory; it stores and logs nothing.
//   1. Entries: normalise, canonical snapshot, per-item merge
//   2. TOTP (RFC 6238): base32, otpauth:// URIs, codes
//   3. Import: Bitwarden JSON, CSV (several managers), dedupe
//   4. Export: Bitwarden JSON
//   5. Search, tags and health (weak / reused)
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module === "object" && module.exports;
  function subtle() { return globalThis.crypto.subtle; }

  // ---------- 1. Entries ----------
  var LIM = { title: 200, user: 500, pw: 4096, url: 2048, urls: 20, notes: 20000, totp: 2048,
              tag: 60, tags: 30, fn: 200, fv: 10000, fields: 50, hist: 5, entries: 10000 };
  var ID_RE = /^[0-9a-f]{16,32}$/;

  function str(v, max) {
    if (typeof v === "number" || typeof v === "boolean") v = String(v);
    if (typeof v !== "string") return "";
    v = v.replace(/\u0000/g, "");
    return v.length > max ? v.slice(0, max) : v;
  }
  function line(v, max) { return str(v, max * 2).replace(/[\r\n\t]+/g, " ").trim().slice(0, max); }
  function okTime(n) { return typeof n === "number" && isFinite(n) && n > 0 && n < 1e14; }
  function newId() {
    var a = new Uint8Array(8); globalThis.crypto.getRandomValues(a);
    var s = ""; for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? "0" : "") + a[i].toString(16);
    return s;
  }
  function normTag(t) { return line(t, LIM.tag).replace(/^\/+|\/+$/g, ""); }
  function normTags(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (t) {
      var n = normTag(t);
      if (n && out.indexOf(n) < 0 && out.length < LIM.tags) out.push(n);
    });
    return out;
  }
  function normUrls(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (u) {
      var n = line(u, LIM.url);
      if (n && out.indexOf(n) < 0 && out.length < LIM.urls) out.push(n);
    });
    return out;
  }

  // Idempotent. Unknown keys are dropped; every value is bounded.
  function normEntry(e, now) {
    if (!e || typeof e !== "object") return null;
    var id = typeof e.id === "string" && ID_RE.test(e.id) ? e.id : null;
    if (!id) return null;
    var m = okTime(e.m) ? e.m : (now || Date.now());
    var fields = [];
    (Array.isArray(e.fields) ? e.fields : []).forEach(function (f) {
      if (!f || typeof f !== "object" || fields.length >= LIM.fields) return;
      var n = line(f.n, LIM.fn), v = str(f.v, LIM.fv);
      if (n || v) fields.push({ h: f.h ? 1 : 0, n: n, v: v });
    });
    var hist = [];
    (Array.isArray(e.hist) ? e.hist : []).forEach(function (h) {
      if (!h || typeof h !== "object" || hist.length >= LIM.hist) return;
      var p = str(h.pw, LIM.pw);
      if (p) hist.push({ pw: p, t: okTime(h.t) ? h.t : m });
    });
    var out = {
      c: okTime(e.c) ? Math.min(e.c, m) : m,
      fav: e.fav ? 1 : 0,
      fields: fields,
      hist: hist,
      id: id,
      m: m,
      notes: str(e.notes, LIM.notes),
      pw: str(e.pw, LIM.pw),
      tags: normTags(e.tags),
      title: line(e.title, LIM.title),
      totp: line(e.totp, LIM.totp),
      urls: normUrls(e.urls),
      user: line(e.user, LIM.user)
    };
    var x = normX(e.x);
    if (x) out.x = x;
    return out;
  }
  // `x`: room for fields of a newer orOS (PW-K1). Kept as it is when it
  // is a small plain object (≤ 40 keys, string / number / 0|1 values,
  // ≤ 8,000 characters as canonical JSON), else dropped; never read here.
  function normX(x) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    var keys = Object.keys(x).filter(function (k) { return /^[a-z][a-z0-9_.]{0,39}$/i.test(k); }).sort();
    if (!keys.length || keys.length > 40) return null;
    var out = {};
    for (var i = 0; i < keys.length; i++) {
      var v = x[keys[i]];
      if (typeof v === "number" ? !isFinite(v) : typeof v !== "string") return null;
      out[keys[i]] = v;
    }
    return canon(out).length <= 8000 ? out : null;
  }

  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }

  // Snapshot = { v, e[] sorted by id, d{id: deletedAt} }. A tomb at or
  // after an entry's m hides it (an edit after the delete wins).
  function emptySnap() { return { d: {}, e: [], v: 1 }; }
  function normSnap(s) {
    var out = emptySnap();
    if (!s || typeof s !== "object") return out;
    var d = s.d && typeof s.d === "object" ? s.d : {};
    Object.keys(d).sort().forEach(function (id) { if (ID_RE.test(id) && okTime(d[id])) out.d[id] = d[id]; });
    var byId = {};
    (Array.isArray(s.e) ? s.e : []).forEach(function (raw) {
      var e = normEntry(raw, 1);
      if (!e) return;
      var cur = byId[e.id];
      if (!cur || e.m > cur.m || (e.m === cur.m && canon(e) > canon(cur))) byId[e.id] = e;
    });
    out.e = Object.keys(byId).sort().filter(function (id) {
      return !(out.d[id] !== undefined && out.d[id] >= byId[id].m);
    }).slice(0, LIM.entries).map(function (id) { return byId[id]; });
    return out;
  }

  // Per-item merge: newer m wins, equal m the larger canonical JSON;
  // tombs take the max time. Pure, symmetric, deterministic.
  function mergeSnap(a, b) {
    a = normSnap(a); b = normSnap(b);
    var d = {};
    [a.d, b.d].forEach(function (x) { Object.keys(x).forEach(function (id) { d[id] = Math.max(d[id] || 0, x[id]); }); });
    return normSnap({ d: d, e: a.e.concat(b.e), v: 1 });
  }

  function upsert(snap, entry) {
    var e = normEntry(entry);
    if (!e) return snap;
    var out = { d: {}, e: snap.e.filter(function (x) { return x.id !== e.id; }).concat([e]), v: 1 };
    Object.keys(snap.d).forEach(function (id) { if (id !== e.id) out.d[id] = snap.d[id]; });
    return normSnap(out);
  }
  function remove(snap, id, now) {
    var t = now || Date.now();
    var cur = snap.e.filter(function (x) { return x.id === id; })[0];
    if (cur && cur.m >= t) t = cur.m + 1;
    var d = {}; Object.keys(snap.d).forEach(function (k) { d[k] = snap.d[k]; });
    d[id] = Math.max(d[id] || 0, t);
    return normSnap({ d: d, e: snap.e, v: 1 });
  }

  // A changed password goes to the history (newest first, ≤ 5).
  function withHistory(prev, next, now) {
    if (!prev || !prev.pw || prev.pw === next.pw) return next.hist || (prev && prev.hist) || [];
    var h = [{ pw: prev.pw, t: now || Date.now() }].concat(prev.hist || []);
    return h.filter(function (x) { return x.pw !== next.pw; }).slice(0, LIM.hist);
  }

  // ---------- 2. TOTP ----------
  var B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  function base32Decode(s) {
    var c = String(s || "").toUpperCase().replace(/[\s=-]/g, "");
    if (!c || !/^[A-Z2-7]+$/.test(c)) return null;
    var out = [], buf = 0, bits = 0;
    for (var i = 0; i < c.length; i++) {
      buf = (buf << 5) | B32.indexOf(c[i]); bits += 5;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
      buf &= (1 << bits) - 1;
    }
    return out.length ? new Uint8Array(out) : null;
  }
  function base32Encode(bytes) {
    var out = "", buf = 0, bits = 0;
    for (var i = 0; i < bytes.length; i++) {
      buf = (buf << 8) | bytes[i]; bits += 8;
      while (bits >= 5) { bits -= 5; out += B32[(buf >> bits) & 31]; }
      buf &= (1 << bits) - 1;
    }
    if (bits > 0) out += B32[(buf << (5 - bits)) & 31];
    return out;
  }

  function dec(s) { try { return decodeURIComponent(s.replace(/\+/g, "%20")); } catch (e) { return s; } }

  // A secret or an otpauth:// URI → { secret (bytes), algo, digits,
  // period, issuer, account } or { error }.
  var ALGOS = { "SHA1": "SHA-1", "SHA256": "SHA-256", "SHA512": "SHA-512" };
  function parseOtp(input) {
    var s = String(input == null ? "" : input).trim();
    if (!s) return { error: "empty" };
    var o = { algo: "SHA-1", digits: 6, period: 30, issuer: "", account: "" };
    if (/^otpauth:/i.test(s)) {
      var m = s.match(/^otpauth:\/\/([a-z]+)\/([^?#]*)(?:\?([^#]*))?/i);
      if (!m) return { error: "bad" };
      if (m[1].toLowerCase() === "hotp") return { error: "hotp" };
      if (m[1].toLowerCase() !== "totp") return { error: "bad" };
      var label = dec(m[2]), q = {};
      (m[3] || "").split("&").forEach(function (p) {
        var k = p.indexOf("=");
        if (k > 0) q[p.slice(0, k).toLowerCase()] = dec(p.slice(k + 1));
      });
      var colon = label.indexOf(":");
      o.account = line(colon >= 0 ? label.slice(colon + 1) : label, 200);
      o.issuer = line(q.issuer || (colon >= 0 ? label.slice(0, colon) : ""), 200);
      if (q.algorithm) {
        var a = ALGOS[q.algorithm.toUpperCase().replace(/[^A-Z0-9]/g, "")];
        if (!a) return { error: "algo" };
        o.algo = a;
      }
      if (q.digits) { o.digits = parseInt(q.digits, 10); if (!(o.digits >= 6 && o.digits <= 8)) return { error: "digits" }; }
      if (q.period) { o.period = parseInt(q.period, 10); if (!(o.period >= 15 && o.period <= 120)) return { error: "period" }; }
      s = q.secret || "";
    }
    var key = base32Decode(s);
    if (!key || key.length < 10) return { error: "secret" };
    o.secret = key;
    return o;
  }

  function hotp(key, counter, algo, digits) {
    var msg = new Uint8Array(8), c = counter;
    for (var i = 7; i >= 0; i--) { msg[i] = c % 256; c = Math.floor(c / 256); }
    return subtle().importKey("raw", key, { name: "HMAC", hash: algo }, false, ["sign"]).then(function (k) {
      return subtle().sign("HMAC", k, msg);
    }).then(function (sig) {
      var h = new Uint8Array(sig), off = h[h.length - 1] & 15;
      var bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
      var code = String(bin % Math.pow(10, digits));
      while (code.length < digits) code = "0" + code;
      return code;
    });
  }
  // → Promise<{ code, left (seconds), period }>
  function totp(otp, nowMs) {
    var t = Math.floor((nowMs == null ? Date.now() : nowMs) / 1000);
    var counter = Math.floor(t / otp.period);
    return hotp(otp.secret, counter, otp.algo, otp.digits).then(function (code) {
      return { code: code, left: otp.period - (t % otp.period), period: otp.period };
    });
  }

  // ---------- 3. Import ----------
  function blankEntry(now) {
    return { c: now, fav: 0, fields: [], hist: [], id: newId(), m: now, notes: "", pw: "",
             tags: [], title: "", totp: "", urls: [], user: "" };
  }
  function msOf(s) {
    if (typeof s === "number" && okTime(s)) return s;
    var t = Date.parse(String(s || ""));
    return okTime(t) ? t : 0;
  }

  // Bitwarden unencrypted JSON export → { entries, skipped, error? }.
  var BW_CARD = [["cardholderName", "Cardholder name"], ["brand", "Brand"], ["number", "Number", 1],
                 ["expMonth", "Expiry month"], ["expYear", "Expiry year"], ["code", "Security code", 1]];
  var BW_ID = [["title", "Title"], ["firstName", "First name"], ["middleName", "Middle name"],
               ["lastName", "Last name"], ["address1", "Address 1"], ["address2", "Address 2"],
               ["address3", "Address 3"], ["city", "City"], ["state", "State"], ["postalCode", "Postal code"],
               ["country", "Country"], ["company", "Company"], ["email", "Email"], ["phone", "Phone"],
               ["ssn", "SSN", 1], ["username", "Username"], ["passportNumber", "Passport number", 1],
               ["licenseNumber", "License number", 1]];
  function fromBitwarden(text, now) {
    now = now || Date.now();
    var j;
    try { j = typeof text === "string" ? JSON.parse(text.replace(/^﻿/, "")) : text; } catch (e) { return { error: "json" }; }
    if (!j || typeof j !== "object" || !Array.isArray(j.items)) return { error: "format" };
    if (j.encrypted === true) return { error: "encrypted" };
    var folders = {};
    (Array.isArray(j.folders) ? j.folders : []).forEach(function (f) {
      if (f && f.id != null) folders[f.id] = line(f.name, LIM.tag);
    });
    var out = [], skipped = 0;
    j.items.forEach(function (it) {
      if (!it || typeof it !== "object") { skipped++; return; }
      var e = blankEntry(now);
      e.title = line(it.name, LIM.title);
      e.notes = str(it.notes, LIM.notes);
      e.fav = it.favorite ? 1 : 0;
      var rev = msOf(it.revisionDate), cr = msOf(it.creationDate);
      if (rev) e.m = rev;
      if (cr) e.c = cr;
      if (it.folderId != null && folders[it.folderId]) e.tags.push(folders[it.folderId]);
      var lg = it.login && typeof it.login === "object" ? it.login : null;
      if (lg) {
        e.user = line(lg.username, LIM.user);
        e.pw = str(lg.password, LIM.pw);
        e.totp = line(lg.totp, LIM.totp);
        (Array.isArray(lg.uris) ? lg.uris : []).forEach(function (u) { if (u && u.uri) e.urls.push(u.uri); });
      }
      function addObj(obj, map) {
        if (!obj || typeof obj !== "object") return;
        map.forEach(function (m) { if (obj[m[0]]) e.fields.push({ h: m[2] ? 1 : 0, n: m[1], v: str(obj[m[0]], LIM.fv) }); });
      }
      if (it.type === 3) addObj(it.card, BW_CARD);
      if (it.type === 4) addObj(it.identity, BW_ID);
      if (it.type === 5 && it.sshKey) {
        addObj(it.sshKey, [["privateKey", "Private key", 1], ["publicKey", "Public key"], ["keyFingerprint", "Fingerprint"]]);
      }
      (Array.isArray(it.fields) ? it.fields : []).forEach(function (f) {
        if (!f || typeof f !== "object") return;
        if (f.type === 3) return;   // "linked" fields point at other fields
        e.fields.push({ h: f.type === 1 ? 1 : 0, n: line(f.name, LIM.fn), v: str(f.value, LIM.fv) });
      });
      (Array.isArray(it.passwordHistory) ? it.passwordHistory : []).forEach(function (h) {
        if (h && h.password) e.hist.push({ pw: str(h.password, LIM.pw), t: msOf(h.lastUsedDate) || e.m });
      });
      var K = kinds(), hint = it.type === 3 ? "card" : it.type === 4 ? "identity" : it.type === 2 ? "note" : "";
      var list = K && hint ? K.fromLabels(e, hint, function () { return newId(); }) : [e];
      list.forEach(function (x) {
        var n = normEntry(x, now);
        if (n && (n.title || n.user || n.pw || n.notes || n.urls.length || n.fields.length)) out.push(n);
        else skipped++;
      });
    });
    return { entries: out, skipped: skipped };
  }
  // Entry types (pmkinds.js), loaded after this file in the app.
  function kinds() {
    if (NODE) { try { return require("./pmkinds.js"); } catch (e) { return null; } }
    return root.PmKinds || null;
  }

  // RFC 4180 CSV (quotes, doubled quotes, CR/LF inside quotes).
  function parseCsv(text) {
    var rows = [], row = [], cur = "", q = false, i = 0, s = String(text || "").replace(/^﻿/, "");
    for (; i < s.length; i++) {
      var c = s[i];
      if (q) {
        if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && s[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else cur += c;
    }
    row.push(cur);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    return rows;
  }

  // Column names of the common exports (lowercase, spaces removed).
  var CSV_COLS = {
    title: ["name", "title", "account", "item", "itemname"],
    user: ["login_username", "username", "user", "login", "email", "userorname"],
    pw: ["login_password", "password", "pass"],
    url: ["login_uri", "url", "uri", "website", "web site", "loginurl"],
    notes: ["notes", "note", "comment", "comments", "extra"],
    totp: ["login_totp", "totp", "otp", "otpauth", "onetimepassword"],
    tag: ["folder", "group", "grouping", "tags", "category"],
    fav: ["favorite", "favourite"],
    m: ["lastmodified", "last modified", "modified", "timepasswordchanged", "revisiondate"]
  };
  function fromCsv(text, now) {
    now = now || Date.now();
    var rows = parseCsv(text);
    if (rows.length < 2) return { error: "empty" };
    var head = rows[0].map(function (h) { return String(h).trim().toLowerCase().replace(/\s+/g, ""); });
    var col = {};
    Object.keys(CSV_COLS).forEach(function (k) {
      for (var i = 0; i < CSV_COLS[k].length; i++) {
        var at = head.indexOf(CSV_COLS[k][i].replace(/\s+/g, ""));
        if (at >= 0) { col[k] = at; break; }
      }
    });
    if (col.pw === undefined && col.user === undefined) return { error: "format" };
    var out = [], skipped = 0;
    rows.slice(1).forEach(function (r) {
      function get(k) { return col[k] !== undefined && r[col[k]] !== undefined ? r[col[k]] : ""; }
      var e = blankEntry(now);
      e.title = line(get("title"), LIM.title);
      e.user = line(get("user"), LIM.user);
      e.pw = str(get("pw"), LIM.pw);
      e.notes = str(get("notes"), LIM.notes);
      e.totp = line(get("totp"), LIM.totp);
      var u = line(get("url"), LIM.url);
      if (u) e.urls.push(u);
      get("tag").split(/[;,]/).forEach(function (t) { if (normTag(t)) e.tags.push(normTag(t)); });
      e.fav = /^(1|true|yes|x)$/i.test(get("fav").trim()) ? 1 : 0;
      var mm = get("m"), t = /^\d{9,13}$/.test(mm) ? Number(mm) * (mm.length <= 10 ? 1000 : 1) : msOf(mm);
      if (okTime(t)) e.m = e.c = t;
      if (!e.title && u) e.title = line(u.replace(/^[a-z]+:\/\//i, "").split("/")[0], LIM.title);
      var n = normEntry(e, now);
      if (n && (n.title || n.user || n.pw)) out.push(n); else skipped++;
    });
    return { entries: out, skipped: skipped };
  }

  // Imported entries not already in the vault (title, user, password
  // and first URL equal = the same login).
  // Typed entries (PW-K1) compare their typed values too: two cards
  // with the same title are not the same card.
  function dupKey(e) {
    var typed = e.fields.filter(function (f) { return /^oros:/.test(f.n); }).map(function (f) { return [f.n, f.v]; });
    var k = [e.title.toLowerCase(), e.user, e.pw, (e.urls[0] || "").toLowerCase()];
    if (typed.length) k.push(typed);
    return canon(k);
  }
  function dedupe(existing, incoming) {
    var seen = {};
    existing.forEach(function (e) { seen[dupKey(e)] = 1; });
    var fresh = [], dup = 0;
    incoming.forEach(function (e) {
      var k = dupKey(e);
      if (seen[k]) { dup++; return; }
      seen[k] = 1;
      fresh.push(e);
    });
    return { entries: fresh, duplicates: dup };
  }

  // ---------- 4. Export ----------
  function iso(ms) { return new Date(ms).toISOString(); }
  function uuidLike(id) {
    var h = (id + "00000000000000000000000000000000").slice(0, 32);
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-a" + h.slice(17, 20) + "-" + h.slice(20, 32);
  }
  function toBitwarden(entries) {
    var folders = [], folderOf = {};
    entries.forEach(function (e) {
      var t = e.tags[0];
      if (t && !folderOf[t]) {
        var a = new Uint8Array(16); globalThis.crypto.getRandomValues(a);
        var hx = ""; for (var i = 0; i < 16; i++) hx += (a[i] < 16 ? "0" : "") + a[i].toString(16);
        folderOf[t] = uuidLike(hx);
        folders.push({ id: folderOf[t], name: t });
      }
    });
    var K = kinds();
    var items = entries.map(function (e) {
      var typed = K && K.kindOf(e) !== "login" ? K.toBitwardenItem(e) : null;
      if (typed) {
        var it = {
          id: uuidLike(e.id), organizationId: null, folderId: e.tags[0] ? folderOf[e.tags[0]] : null,
          type: typed.type, reprompt: 0, name: e.title || "-", notes: e.notes || null, favorite: !!e.fav,
          fields: typed.fields, collectionIds: null, revisionDate: iso(e.m), creationDate: iso(e.c), passwordHistory: null
        };
        ["card", "identity", "secureNote"].forEach(function (k) { if (typed[k]) it[k] = typed[k]; });
        return it;
      }
      return {
        id: uuidLike(e.id), organizationId: null, folderId: e.tags[0] ? folderOf[e.tags[0]] : null,
        type: 1, reprompt: 0, name: e.title || "-", notes: e.notes || null, favorite: !!e.fav,
        fields: e.fields.map(function (f) { return { name: f.n, value: f.v, type: f.h ? 1 : 0, linkedId: null }; }),
        login: { uris: e.urls.map(function (u) { return { match: null, uri: u }; }),
                 username: e.user || null, password: e.pw || null, totp: e.totp || null },
        collectionIds: null,
        revisionDate: iso(e.m), creationDate: iso(e.c),
        passwordHistory: e.hist.length ? e.hist.map(function (h) { return { lastUsedDate: iso(h.t), password: h.pw }; }) : null
      };
    });
    return JSON.stringify({ encrypted: false, folders: folders, items: items }, null, 2);
  }

  // ---------- 5. Search, tags, health ----------
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  function matches(e, query) {
    var terms = fold(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    var hay = fold([e.title, e.user, e.urls.join(" "), e.tags.join(" "), e.notes,
                    e.fields.filter(function (f) { return !f.h && f.n !== "oros:k"; })
                      .map(function (f) { return (/^oros:/.test(f.n) ? "" : f.n + " ") + f.v; }).join(" ")].join(" "));
    return terms.every(function (t) { return hay.indexOf(t) >= 0; });
  }
  function allTags(entries) {
    var seen = {};
    entries.forEach(function (e) { e.tags.forEach(function (t) { seen[t] = (seen[t] || 0) + 1; }); });
    return Object.keys(seen).sort(function (a, b) { return fold(a) < fold(b) ? -1 : fold(a) > fold(b) ? 1 : 0; });
  }
  function sortEntries(list) {
    return list.slice().sort(function (a, b) {
      if (a.fav !== b.fav) return b.fav - a.fav;
      var x = fold(a.title || a.user), y = fold(b.title || b.user);
      return x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : 1);
    });
  }
  // ids of entries whose password is used by another entry too.
  function reused(entries) {
    var by = {}, out = {};
    entries.forEach(function (e) { if (e.pw) (by[e.pw] = by[e.pw] || []).push(e.id); });
    Object.keys(by).forEach(function (p) { if (by[p].length > 1) by[p].forEach(function (id) { out[id] = 1; }); });
    return out;
  }
  // First host of an entry, for the letter badge and display.
  function hostOf(e) {
    var u = e.urls[0] || "";
    var m = u.match(/^[a-z][a-z0-9+.-]*:\/\/([^\/?#:@]+@)?([^\/?#:]+)/i);
    return m ? m[2].replace(/^www\./i, "").toLowerCase() : "";
  }
  // Only http(s) links are ever opened.
  function safeUrl(u) {
    var s = String(u || "").trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([\/?#:].*)?$/i.test(s)) return "https://" + s;
    return null;
  }

  var PmCore = {
    version: "2.0.0", LIM: LIM,
    newId: newId, normEntry: normEntry, canon: canon, emptySnap: emptySnap, normSnap: normSnap,
    mergeSnap: mergeSnap, upsert: upsert, remove: remove, withHistory: withHistory, blankEntry: blankEntry,
    base32Decode: base32Decode, base32Encode: base32Encode, parseOtp: parseOtp, hotp: hotp, totp: totp,
    fromBitwarden: fromBitwarden, parseCsv: parseCsv, fromCsv: fromCsv, dedupe: dedupe, toBitwarden: toBitwarden,
    fold: fold, matches: matches, allTags: allTags, sortEntries: sortEntries, reused: reused,
    hostOf: hostOf, safeUrl: safeUrl, normTags: normTags
  };
  if (NODE) module.exports = PmCore;
  else root.PmCore = PmCore;
})(this);
