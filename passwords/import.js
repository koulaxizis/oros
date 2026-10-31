// ============================================================
// orOS Passwords — import.js (more sources for Import, v1.1.0)
// Reads an export of another password manager or two-factor app and
// turns it into vault entries (pmcore.js shape). Pure: no DOM, no
// storage, no logging; pmapp.js runs the picker, the preview, the
// one save and the Undo. Works on DECRYPTED data in memory only.
//
// Sources (detected from zip entry names, JSON shape, CSV headers):
//   proton     Proton Pass: ZIP with "Proton Pass/data.json" (vaults
//              → items: login, note, creditCard, alias, identity) or
//              its CSV (name,url,email,username,password,note,totp,
//              vault). PGP-encrypted exports → error "encrypted-proton".
//   1pux       1Password .1pux (ZIP with export.data: accounts →
//              vaults → items; loginFields, sections, notesPlain).
//   lastpass   LastPass CSV (url,username,password,totp,extra,name,
//              grouping,fav; secure notes have url "http://sn").
//   dashlane   Dashlane CSV ZIP (credentials.csv + securenotes.csv)
//              or credentials.csv alone.
//   nordpass   NordPass CSV (name,url,…,cardholdername,…,folder,…).
//   enpass     Enpass JSON (items with fields[label,type,value]).
//   apple      Apple Passwords / iCloud Keychain CSV (Title,URL,
//              Username,Password,Notes,OTPAuth).
//   keeper     Keeper JSON ({ records }) or CSV (no header: Folder,
//              Title, Login, Password, Website Address, Notes, Shared
//              Folder, custom field pairs; "TFC:Keeper" = its 2FA).
//   roboform   RoboForm CSV (Name,Url,MatchUrl,Login,Pwd,Note,Folder).
//   zoho       Zoho Vault CSV (Password Name, Password URL, SecretData
//              / CustomData as "name:value" lines, ChamberName).
//   keepassxml KeePass 2 XML export (plain; read by kdbx.js readXml).
//   aegis      Aegis plain JSON (db.entries); encrypted → error.
//   2fas       2FAS backup (.2fas JSON: services); encrypted → error.
//   gauth      Google Authenticator "Transfer accounts" QR:
//              otpauth-migration://offline?data=… (protobuf
//              MigrationPayload, read by a small hand-written reader).
//   otpauth    one otpauth://totp/ link.
//   bitwarden, csv (Chrome, Edge, Firefox, KeePassXC, 1Password,
//              Bitwarden CSV) go through PmCore.fromBitwarden and
//              PmCore.fromCsv as before; keepass is read by kdbx.js in
//              pmapp.js and handed to fromEntries().
//
// parse({ name, bytes }) → Promise<result>; parseText(text, name) →
// result (synchronous). result:
//   { source, entries: [entry], codes: [code], skipped, unsupported,
//     trashed, attachments, recycled, types: { login, note, … },
//     batch?: { index, size, id }, plain: true (an unencrypted file) }
//   or { kdbx: true } (pmapp asks for the KeePass password) or
//   { locked: "bitwarden" | "aegis" | "2fas", data } (an export with a
//   password: unlock(locked, password) → Promise<result>) or
//   { error: "json" | "format" | "empty" | "encrypted" (Bitwarden) |
//     "encrypted-proton" | "encrypted-aegis" | "encrypted-2fas" |
//     "encrypted-dashlane" | "toobig" }.
//   code = { key, uri (otpauth://totp/…), secret (base32), issuer,
//            account, title } — a two-factor app's account.
// apply(snap, result, opts) → { snap, added, attached, duplicates,
//   undo }: merges into the snapshot (pure; pmcore normSnap shape).
//   Entry ids are stable (16 hex from the source and its item id or
//   content), so importing the same file again adds only what is
//   missing; an entry already in the vault (same id, or same title,
//   username, password and first website) is skipped. A code goes to
//   the one entry with the same account and site / issuer that has no
//   code yet; otherwise it becomes a code-only entry. A code whose
//   secret is already in the vault is skipped. Nothing the user has
//   is changed except an empty two-factor field.
// undo(snap, undoInfo, now) → snap: added entries get a newer tomb, an
//   attached code is taken off again with a newer stamp (sync-safe).
// mergeResults(a, b) → one result (several Google Authenticator QR
//   batches in a row).
// UMD: window.OrosPasswordsImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }
  function core() { return NODE ? require("./pmcore.js") : root.PmCore; }
  function kdbx() { return NODE ? require("./kdbx.js") : root.Kdbx; }
  function vaultLib() { return NODE ? require("./pmcrypto.js") : root.PmVault; }

  var MAX_ITEMS = 10000;              // entries + codes read from one file
  var MAX_ENTRY = 50 * 1024 * 1024;   // inflated bytes per zip entry
  var MAX_TEXT = 50 * 1024 * 1024;    // characters of a text export
  var LIM = function () { return core().LIM; };

  // ---------- small helpers ----------
  function low(v) { return String(v == null ? "" : v).trim().toLowerCase(); }
  function norm(h) { return low(h).replace(/^﻿/, "").replace(/[^a-z0-9]+/g, ""); }
  function s(v) {
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return typeof v === "string" ? v : "";
  }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function fnv(str, h) {
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  // 16 hex: what pmcore accepts as an entry id; stable for one input.
  function hexId(str) { str = String(str); return fnv(str, 0x811c9dc5) + fnv("orOS|" + str, 0x9747b28c); }
  function wipe(b) { try { if (b && typeof b.fill === "function") b.fill(0); } catch (e) {} }
  function msOf(v) {
    if (typeof v === "number" && isFinite(v) && v > 0) return v < 1e11 ? v * 1000 : v;
    var t = Date.parse(s(v));
    return isFinite(t) && t > 0 ? t : 0;
  }

  // An entry under construction (normalised by pmcore at the end).
  function blank(now) {
    return { c: now, fav: 0, fields: [], hist: [], id: "", m: now, notes: "", pw: "",
             tags: [], title: "", totp: "", urls: [], user: "" };
  }
  function addField(e, name, value, hidden) {
    var v = s(value).trim();
    if (!v || e.fields.length >= LIM().fields) return;
    e.fields.push({ h: hidden ? 1 : 0, n: s(name), v: v });
  }
  function addUrl(e, u) { u = s(u).trim(); if (u && e.urls.indexOf(u) < 0) e.urls.push(u); }
  function addTag(e, t) { t = s(t).trim(); if (t && e.tags.indexOf(t) < 0) e.tags.push(t); }
  function hostTitle(u) { return s(u).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[\/?#:]/)[0].replace(/^www\./i, ""); }

  function newResult(source) {
    return { source: source, entries: [], codes: [], skipped: 0, unsupported: 0, trashed: 0,
             attachments: 0, recycled: 0, types: {}, plain: true };
  }
  // Finish an entry: stable id, normalised, counted (or skipped).
  function push(res, e, key, type) {
    if (res.entries.length + res.codes.length >= MAX_ITEMS) { res.skipped++; return; }
    if (!e.title && e.urls.length) e.title = hostTitle(e.urls[0]);
    e.id = hexId(res.source + "|" + (key ? "k|" + key : "c|" + core().canon([e.title, e.user, e.pw, e.urls[0] || "", e.notes])));
    var n = core().normEntry(e, e.m);
    if (n && (n.title || n.user || n.pw || n.notes || n.urls.length || n.fields.length || n.totp)) {
      res.entries.push(n);
      res.types[type || "login"] = (res.types[type || "login"] || 0) + 1;
    } else res.skipped++;
  }

  // ---------- two-factor codes ----------
  var ALGO = { "SHA1": "SHA1", "SHA256": "SHA256", "SHA512": "SHA512" };
  // → code or null (counted as unsupported by the caller)
  function makeCode(o) {
    var secret = s(o.secret).toUpperCase().replace(/[\s=-]/g, "");
    var algo = ALGO[s(o.algo || "SHA1").toUpperCase().replace(/[^A-Z0-9]/g, "")];
    var digits = o.digits ? parseInt(o.digits, 10) : 6;
    var period = o.period ? parseInt(o.period, 10) : 30;
    if (!algo || !(digits >= 6 && digits <= 8) || !(period >= 15 && period <= 120)) return null;
    var issuer = kit().clean(o.issuer, 200), account = kit().clean(o.account, 200);
    if (issuer && account.toLowerCase().indexOf(issuer.toLowerCase() + ":") === 0) account = account.slice(issuer.length + 1).trim();
    var label = encodeURIComponent(issuer) + (issuer ? ":" : "") + encodeURIComponent(account);
    var uri = "otpauth://totp/" + label + "?secret=" + secret + (issuer ? "&issuer=" + encodeURIComponent(issuer) : "") +
              (algo !== "SHA1" ? "&algorithm=" + algo : "") + (digits !== 6 ? "&digits=" + digits : "") +
              (period !== 30 ? "&period=" + period : "");
    var p = core().parseOtp(uri);
    if (p.error) return null;
    var b32 = core().base32Encode(p.secret);
    return { key: hexId("otp|" + b32 + "|" + issuer.toLowerCase() + "|" + account.toLowerCase()), uri: uri,
             secret: b32, issuer: issuer, account: account, title: issuer || account, notes: kit().cleanText(o.notes, 2000),
             tags: arr(o.tags).map(s).filter(Boolean) };
  }
  function pushCode(res, o) {
    if (res.entries.length + res.codes.length >= MAX_ITEMS) { res.skipped++; return; }
    var c = makeCode(o);
    if (!c) { res.unsupported++; return; }
    if (res.codes.some(function (x) { return x.secret === c.secret && x.issuer === c.issuer && x.account === c.account; })) return;
    res.codes.push(c);
  }

  // A single otpauth://totp/ link.
  function fromOtpauth(text) {
    var res = newResult("otpauth"), p = core().parseOtp(text);
    if (p.error) { res.unsupported++; return res; }
    var q = /[?&]/.test(text) ? text.split("?")[1] : "";
    var get = function (k) { var m = new RegExp("(?:^|&)" + k + "=([^&#]*)", "i").exec(q || ""); return m ? m[1] : ""; };
    pushCode(res, { secret: core().base32Encode(p.secret), issuer: p.issuer, account: p.account,
                    algo: (get("algorithm") || "SHA1"), digits: p.digits, period: p.period });
    return res;
  }

  // ---------- Google Authenticator (otpauth-migration, protobuf) ----------
  function b64(str) {
    var t = s(str).replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
    while (t.length % 4) t += "=";
    if (!/^[A-Za-z0-9+\/]*=*$/.test(t)) return null;
    var bin;
    try { bin = NODE && typeof atob !== "function" ? Buffer.from(t, "base64").toString("binary") : atob(t); } catch (e) { return null; }
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Protobuf wire reader: fields → [{ no, wt, v (number | bytes) }].
  function pbFields(b) {
    var out = [], i = 0;
    function varint() {
      var n = 0, mul = 1, c;
      for (var k = 0; k < 10; k++) {
        if (i >= b.length) throw new Error("pb");
        c = b[i++];
        n += (c & 127) * mul; mul *= 128;
        if (!(c & 128)) return n;
      }
      throw new Error("pb");
    }
    while (i < b.length) {
      var tag = varint(), no = Math.floor(tag / 8), wt = tag % 8;
      if (wt === 0) out.push({ no: no, wt: 0, v: varint() });
      else if (wt === 2) {
        var len = varint();
        if (i + len > b.length) throw new Error("pb");
        out.push({ no: no, wt: 2, v: b.subarray(i, i + len) }); i += len;
      } else if (wt === 1) i += 8;
      else if (wt === 5) i += 4;
      else throw new Error("pb");
      if (out.length > 5000) throw new Error("pb");
    }
    if (i > b.length) throw new Error("pb");
    return out;
  }
  function utf8(b) { return new TextDecoder("utf-8").decode(b); }
  var GA_ALGO = { 0: "SHA1", 1: "SHA1", 2: "SHA256", 3: "SHA512", 4: "MD5" };
  var GA_DIGITS = { 0: 6, 1: 6, 2: 8 };
  function fromMigration(text) {
    var res = newResult("gauth");
    var m = /[?&]data=([^&#]*)/i.exec(text);
    var raw = null;
    try { raw = m ? b64(decodeURIComponent(m[1])) : null; } catch (e) { raw = null; }
    if (!raw) return { error: "format" };
    try {
      var top = pbFields(raw);
      top.forEach(function (f) {
        if (f.no === 1 && f.wt === 2) {
          var o = { algo: "SHA1", digits: 6, type: 2, secret: null, name: "", issuer: "" };
          pbFields(f.v).forEach(function (g) {
            if (g.no === 1 && g.wt === 2) o.secret = g.v;
            else if (g.no === 2 && g.wt === 2) o.name = utf8(g.v);
            else if (g.no === 3 && g.wt === 2) o.issuer = utf8(g.v);
            else if (g.no === 4 && g.wt === 0) o.algo = GA_ALGO[g.v] || "?";
            else if (g.no === 5 && g.wt === 0) o.digits = GA_DIGITS[g.v] || 0;
            else if (g.no === 6 && g.wt === 0) o.type = g.v;
          });
          if (o.type === 1 || !o.secret || !o.secret.length) { res.unsupported++; return; }
          var name = o.name, issuer = o.issuer;
          var colon = name.indexOf(":");
          if (colon >= 0 && (!issuer || name.slice(0, colon).trim() === issuer)) { issuer = issuer || name.slice(0, colon).trim(); name = name.slice(colon + 1); }
          pushCode(res, { secret: core().base32Encode(o.secret), issuer: issuer, account: name.trim(), algo: o.algo, digits: o.digits });
          wipe(o.secret);
        } else if (f.wt === 0 && f.no >= 3 && f.no <= 5) {
          res.batch = res.batch || {};
          res.batch[f.no === 3 ? "size" : f.no === 4 ? "index" : "id"] = f.v;
        }
      });
    } catch (e) { wipe(raw); return { error: "format" }; }
    wipe(raw);
    if (res.batch) res.batch = { size: res.batch.size || 1, index: res.batch.index || 0, id: res.batch.id || 0 };
    return res;
  }

  // ---------- Aegis, 2FAS ----------
  function fromAegis(j) {
    var h = j.header;
    if ((isObj(h) && h.slots != null) || typeof j.db === "string") {
      var pwSlot = typeof j.db === "string" && isObj(h) && isObj(h.params) && arr(h.slots).some(function (sl) { return isObj(sl) && sl.type === 1; });
      return pwSlot ? { locked: "aegis", data: j } : { error: "encrypted-aegis" };
    }
    var res = newResult("aegis");
    var groups = {};
    arr(j.db && j.db.groups).forEach(function (g) { if (g && g.uuid) groups[g.uuid] = s(g.name); });
    arr(j.db && j.db.entries).forEach(function (en) {
      if (!isObj(en)) { res.skipped++; return; }
      var info = isObj(en.info) ? en.info : {};
      if (low(en.type) !== "totp") { res.unsupported++; return; }
      var tags = arr(en.groups).map(function (g) { return groups[g] || ""; });
      if (en.group) tags.push(s(en.group));
      pushCode(res, { secret: info.secret, issuer: en.issuer, account: en.name, algo: info.algo,
                      digits: info.digits, period: info.period, notes: en.note, tags: tags });
    });
    return res;
  }
  function from2fas(j) {
    var list = arr(j.services);
    if (!list.length && typeof j.servicesEncrypted === "string" && j.servicesEncrypted) {
      return j.servicesEncrypted.split(":").length >= 3 ? { locked: "2fas", data: j } : { error: "encrypted-2fas" };
    }
    var res = newResult("2fas");
    var groups = {};
    arr(j.groups).forEach(function (g) { if (g && g.id) groups[g.id] = s(g.name); });
    list.forEach(function (sv) {
      if (!isObj(sv)) { res.skipped++; return; }
      var otp = isObj(sv.otp) ? sv.otp : {};
      if (otp.tokenType && low(otp.tokenType) !== "totp") { res.unsupported++; return; }
      pushCode(res, { secret: sv.secret, issuer: otp.issuer || sv.name, account: otp.account || otp.label || "",
                      algo: otp.algorithm, digits: otp.digits, period: otp.period,
                      tags: sv.groupId && groups[sv.groupId] ? [groups[sv.groupId]] : [] });
    });
    return res;
  }

  // ---------- Proton Pass ----------
  var PROTON_CARD = [["cardholderName", "Cardholder name"], ["cardType", "Card type"], ["number", "Number", 1],
                     ["verificationNumber", "Security code", 1], ["expirationDate", "Expiry date"], ["pin", "PIN", 1]];
  function protonItem(res, it, vaultName, now) {
    var d = isObj(it.data) ? it.data : null;
    if (!d) { res.skipped++; return; }
    if (it.state === 2) { res.trashed++; return; }
    var md = isObj(d.metadata) ? d.metadata : {}, c = isObj(d.content) ? d.content : {};
    var e = blank(now), type = s(d.type);
    e.title = s(md.name); e.notes = s(md.note);
    e.c = msOf(it.createTime) || now;
    e.fav = it.pinned ? 1 : 0;
    addTag(e, vaultName);
    if (type === "login") {
      var user = s(c.itemUsername) || s(c.username), mail = s(c.itemEmail);
      e.user = user || mail;
      if (user && mail && user !== mail) addField(e, "Email", mail);
      e.pw = s(c.password);
      e.totp = s(c.totpUri);
      arr(c.urls).forEach(function (u) { addUrl(e, u); });
    } else if (type === "creditCard") {
      PROTON_CARD.forEach(function (m) { addField(e, m[1], c[m[0]], m[2]); });
    } else if (type === "alias") {
      e.user = s(it.aliasEmail);
    } else if (type !== "note") {
      // identity and newer kinds: every plain value becomes a field
      Object.keys(c).forEach(function (k) {
        if (typeof c[k] === "string" || typeof c[k] === "number") addField(e, k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, function (x) { return x.toUpperCase(); }), c[k], /number|ssn|pin|passport|license/i.test(k) && k !== "phoneNumber");
      });
    }
    arr(d.extraFields).forEach(function (f) {
      if (!isObj(f)) return;
      var v = isObj(f.data) ? f.data.content : "";
      if (f.type === "totp" && !e.totp) { e.totp = s(v); return; }
      addField(e, f.fieldName, v, f.type === "hidden" || f.type === "totp");
    });
    var kinds = { login: "login", note: "note", creditCard: "card", alias: "alias", identity: "identity" };
    push(res, e, s(it.itemId) || s(md.itemUuid) || "", kinds[type] || "other");
  }
  function fromProtonJson(j, now) {
    if (j.encrypted === true) return { error: "encrypted-proton" };
    var res = newResult("proton");
    Object.keys(j.vaults).forEach(function (vid) {
      var v = j.vaults[vid];
      if (!isObj(v)) return;
      arr(v.items).forEach(function (it) { if (isObj(it)) protonItem(res, it, s(v.name), now); else res.skipped++; });
    });
    return res;
  }

  // ---------- 1Password .1pux ----------
  var OP_TYPES = { "001": "login", "005": "login", "002": "card", "003": "note", "004": "identity" };
  function opValue(v) {
    if (!isObj(v)) return null;
    var k = Object.keys(v)[0], x = v[k];
    if (k === undefined || x == null || x === "") return null;
    if (k === "totp") return { totp: s(x) };
    if (k === "email" && isObj(x)) return { v: s(x.email_address) };
    if (k === "date" && typeof x === "number") return { v: new Date(x * 1000).toISOString().slice(0, 10) };
    if (k === "monthYear" && typeof x === "number") return { v: String(x % 100).replace(/^(\d)$/, "0$1") + "/" + Math.floor(x / 100) };
    if (k === "address" && isObj(x)) return { v: Object.keys(x).map(function (a) { return s(x[a]); }).filter(Boolean).join(", ") };
    if (k === "sshKey" && isObj(x)) return { v: s(x.privateKey), h: 1 };
    if (isObj(x) || Array.isArray(x)) return null;
    return { v: s(x), h: k === "concealed" || k === "creditCardNumber" ? 1 : 0 };
  }
  function from1pux(j, now) {
    var res = newResult("1pux");
    arr(j.accounts).forEach(function (acc) {
      arr(acc && acc.vaults).forEach(function (vault) {
        var vname = vault && isObj(vault.attrs) ? s(vault.attrs.name) : "";
        arr(vault && vault.items).forEach(function (it) {
          if (!isObj(it)) { res.skipped++; return; }
          if (it.state === "archived" || it.trashed) { res.trashed++; return; }
          var ov = isObj(it.overview) ? it.overview : {}, dt = isObj(it.details) ? it.details : {};
          var e = blank(now);
          e.title = s(ov.title);
          e.notes = s(dt.notesPlain);
          e.fav = it.favIndex > 0 ? 1 : 0;
          e.c = msOf(it.createdAt) || now;
          if (vname && !/^(personal|private)$/i.test(vname)) addTag(e, vname);
          arr(ov.tags).forEach(function (t) { addTag(e, t); });
          addUrl(e, ov.url);
          arr(ov.urls).forEach(function (u) { addUrl(e, isObj(u) ? u.url : u); });
          arr(dt.loginFields).forEach(function (f) {
            if (!isObj(f)) return;
            if (f.designation === "username" && !e.user) e.user = s(f.value);
            else if (f.designation === "password" && !e.pw) e.pw = s(f.value);
            else if (/^[TEPUN]$/.test(s(f.fieldType)) && s(f.value)) addField(e, f.name || f.designation, f.value, f.fieldType === "P");
          });
          if (!e.pw && dt.password) e.pw = s(dt.password);
          arr(dt.sections).forEach(function (sec) {
            arr(sec && sec.fields).forEach(function (f) {
              if (!isObj(f)) return;
              var v = opValue(f.value);
              if (!v) return;
              if (v.totp !== undefined) { if (!e.totp) e.totp = v.totp; else addField(e, f.title || "One-time password", v.totp, 1); return; }
              addField(e, f.title || f.id || (sec.title || ""), v.v, v.h);
            });
          });
          arr(dt.passwordHistory).forEach(function (h) {
            if (h && h.value && e.hist.length < LIM().hist) e.hist.push({ pw: s(h.value), t: msOf(h.time) || e.c });
          });
          if (dt.documentAttributes) res.attachments++;
          push(res, e, s(it.uuid), OP_TYPES[s(it.categoryUuid)] || "other");
        });
      });
    });
    return res;
  }

  // ---------- Enpass ----------
  function fromEnpass(j, now) {
    var res = newResult("enpass");
    var folders = {};
    arr(j.folders).forEach(function (f) { if (f && f.uuid) folders[f.uuid] = s(f.title); });
    j.items.forEach(function (it) {
      if (!isObj(it)) { res.skipped++; return; }
      if (it.trashed || it.archived) { res.trashed++; return; }
      var e = blank(now);
      e.title = s(it.title); e.notes = s(it.note); e.fav = it.favorite ? 1 : 0;
      e.c = msOf(it.createdAt) || now;
      arr(it.folders).forEach(function (f) { addTag(e, folders[f]); });
      arr(it.fields).forEach(function (f) {
        if (!isObj(f) || f.deleted) return;
        var v = s(f.value), t = low(f.type);
        if (!v || t === "section") return;
        if (t === "username" && !e.user) e.user = v;
        else if (t === "email" && !e.user) e.user = v;
        else if (t === "password" && !e.pw) e.pw = v;
        else if (t === "url") addUrl(e, v);
        else if (t === "totp" && !e.totp) e.totp = v;
        else addField(e, f.label, v, f.sensitive || t === "password" || t === "totp");
      });
      if (it.attachments && it.attachments.length) res.attachments += it.attachments.length;
      var cat = low(it.category);
      push(res, e, s(it.uuid), cat === "login" || cat === "password" ? "login" : cat === "note" ? "note" :
           cat === "creditcard" ? "card" : cat === "identity" ? "identity" : "other");
    });
    return res;
  }

  // ---------- CSV sources ----------
  function table(text) {
    var rows = core().parseCsv(text);
    if (!rows.length) return null;
    return { head: rows[0].map(norm), rows: rows.slice(1, MAX_ITEMS + 1), more: Math.max(0, rows.length - 1 - MAX_ITEMS) };
  }
  function has(head, names) { return names.every(function (n) { return head.indexOf(n) >= 0; }); }
  function getter(head, r) {
    return function () {
      for (var i = 0; i < arguments.length; i++) {
        var k = head.indexOf(arguments[i]);
        if (k >= 0 && r[k] !== undefined && r[k] !== "") return r[k];
      }
      return "";
    };
  }
  // which CSV export this is (null: the generic mapper of pmcore)
  function csvKind(head) {
    if (has(head, ["url", "username", "password", "extra", "name", "grouping"])) return "lastpass";
    if (has(head, ["name", "url", "email", "username", "password", "note", "totp", "vault"])) return "proton";
    if (has(head, ["username", "username2", "title", "password", "url"])) return "dashlane";
    if (has(head, ["name", "url", "username", "password", "cardholdername", "folder"])) return "nordpass";
    if (has(head, ["title", "url", "username", "password", "otpauth"])) return "apple";
    if (has(head, ["name", "url", "login", "pwd"])) return "roboform";
    if ((has(head, ["passwordname"]) || has(head, ["secretname"])) && has(head, ["secretdata"])) return "zoho";
    if (has(head, ["folder", "title", "login", "password", "websiteaddress"])) return "keeper";
    return null;
  }
  // a generic CSV: name the app it most likely came from
  function csvLabel(head) {
    if (has(head, ["loginuri", "loginusername", "loginpassword"])) return "bitwarden";
    if (has(head, ["httprealm", "formactionorigin"])) return "firefox";
    if (has(head, ["group", "title", "username", "password"]) && head.indexOf("lastmodified") >= 0) return "keepassxc";
    if (has(head, ["name", "url", "username", "password"]) && head.length <= 5) return "chrome";
    return "csv";
  }
  function fromCsvKind(kind, t, now, res, extraRows) {
    res = res || newResult(kind);
    res.skipped += t.more;
    t.rows.forEach(function (r) {
      var g = getter(t.head, r), e = blank(now), type = "login";
      if (kind === "lastpass") {
        var url = g("url");
        e.title = g("name"); e.user = g("username"); e.pw = g("password"); e.notes = g("extra"); e.totp = g("totp");
        e.fav = /^1$/.test(g("fav").trim()) ? 1 : 0;
        addTag(e, g("grouping"));
        if (/^https?:\/\/sn\/?$/i.test(url.trim())) type = "note"; else addUrl(e, url);
      } else if (kind === "proton") {
        e.title = g("name"); e.user = g("username") || g("email"); e.pw = g("password"); e.notes = g("note"); e.totp = g("totp");
        if (g("username") && g("email") && g("username") !== g("email")) addField(e, "Email", g("email"));
        g("url").split(/,\s*/).forEach(function (u) { addUrl(e, u); });
        addTag(e, g("vault"));
        e.c = msOf(g("createtime")) || now;
        if (!e.pw && !e.user && !e.urls.length) type = "note";
      } else if (kind === "dashlane") {
        e.title = g("title"); e.user = g("username", "username2", "username3", "login", "email"); e.pw = g("password");
        e.notes = g("note"); e.totp = g("otpsecret", "otpurl"); addUrl(e, g("url")); addTag(e, g("category"));
        ["username2", "username3"].forEach(function (k) { var v = g(k); if (v && v !== e.user) addField(e, "Username", v); });
      } else if (kind === "dashnote") {
        e.title = g("title"); e.notes = g("note", "content"); addTag(e, g("category")); type = "note";
      } else if (kind === "nordpass") {
        if (low(g("type")) === "folder") return;
        e.title = g("name"); e.user = g("username", "email"); e.pw = g("password"); e.notes = g("note");
        addUrl(e, g("url"));
        var more = g("additionalurls"), list = kit().json(more);
        (Array.isArray(list) ? list : more.split(/[,\n]/)).forEach(function (u) { addUrl(e, s(u)); });
        addTag(e, g("folder"));
        [["cardholdername", "Cardholder name"], ["cardnumber", "Number", 1], ["cvc", "Security code", 1],
         ["pin", "PIN", 1], ["expirydate", "Expiry date"], ["fullname", "Full name"], ["phonenumber", "Phone"],
         ["address1", "Address 1"], ["address2", "Address 2"], ["city", "City"], ["state", "State"],
         ["zipcode", "Postal code"], ["country", "Country"]].forEach(function (m) { addField(e, m[1], g(m[0]), m[2]); });
        if (g("email") && g("email") !== e.user) addField(e, "Email", g("email"));
        var cf = kit().json(g("customfields"));
        arr(cf).forEach(function (f) { if (isObj(f)) addField(e, f.label || f.name, f.value, low(f.type) === "hidden"); });
        var ty = low(g("type"));
        type = ty === "note" ? "note" : ty === "credit_card" || g("cardnumber") ? "card" : ty === "identity" ? "identity" : "login";
      } else if (kind === "apple") {
        e.title = g("title"); e.user = g("username"); e.pw = g("password"); e.notes = g("notes"); e.totp = g("otpauth");
        addUrl(e, g("url"));
      } else if (kind === "roboform") {
        e.title = g("name"); e.user = g("login"); e.pw = g("pwd"); e.notes = g("note");
        addUrl(e, g("url", "matchurl"));
        addTag(e, g("folder").replace(/^\/+|\/+$/g, ""));
        if (!e.user && !e.pw && !e.urls.length && e.notes) type = "note";
      } else if (kind === "zoho") {
        e.title = g("passwordname", "secretname"); e.notes = g("notes", "description");
        addUrl(e, g("passwordurl", "secreturl"));
        e.fav = /^(1|true|yes)$/i.test(g("favorite").trim()) ? 1 : 0;
        addTag(e, g("chambername", "foldername", "folder"));
        g("tags").split(/[,;]/).forEach(function (t) { addTag(e, t); });
        zohoData(e, g("secretdata")); zohoData(e, g("customdata"));
        e.totp = e.totp || g("logintotp", "totp");
        if (!e.user && !e.pw && !e.urls.length && e.notes) type = "note";
      }
      push(res, e, "", type);
    });
    return res;
  }

  // Zoho Vault keeps the login in "SecretData" / "CustomData" as
  // "name:value" lines (the first username / password line wins).
  var ZOHO_USER = { username: 1, user: 1, login: 1, email: 1, "user name": 1 };
  var ZOHO_PW = { password: 1, pass: 1, pwd: 1 };
  function zohoData(e, text) {
    s(text).split(/\r?\n/).forEach(function (ln) {
      var at = ln.indexOf(":");
      if (at <= 0) return;
      var k = ln.slice(0, at).trim(), v = ln.slice(at + 1).trim(), kl = k.toLowerCase();
      if (!k || !v || kl === "secrettype") return;
      if (!e.user && ZOHO_USER[kl]) e.user = v;
      else if (!e.pw && ZOHO_PW[kl]) e.pw = v;
      else if (!e.totp && /^otpauth:\/\//i.test(v)) e.totp = v;
      else addField(e, k, v, /pass|secret|pin|key/i.test(k));
    });
  }
  // Keeper CSV: Folder, Title, Login, Password, Website Address,
  // Notes, Shared Folder, then custom fields as name, value pairs
  // ("TFC:Keeper" is its two-factor code). Keeper writes no header;
  // a file with the header row reads the same columns.
  function keeperRow(e, r) {
    var c = function (i) { return r[i] !== undefined ? s(r[i]) : ""; };
    addTag(e, c(0).replace(/\\/g, "/"));
    e.title = c(1); e.user = c(2); e.pw = c(3); addUrl(e, c(4)); e.notes = c(5);
    if (c(6)) addTag(e, c(6).replace(/\\/g, "/"));
    for (var i = 7; i + 1 < r.length; i += 2) {
      var k = c(i), v = c(i + 1);
      if (!k || !v) continue;
      if (!e.totp && (/^TFC:/i.test(k) || /^otpauth:\/\//i.test(v))) e.totp = v;
      else addField(e, k, v, /pass|secret|pin|code/i.test(k));
    }
  }
  function fromKeeperCsv(text, now) {
    var rows = core().parseCsv(text), res = newResult("keeper");
    if (rows.length && /^folder$/i.test(s(rows[0][0]).trim()) && /^title$/i.test(s(rows[0][1]).trim())) rows = rows.slice(1);
    res.skipped += Math.max(0, rows.length - MAX_ITEMS);
    rows.slice(0, MAX_ITEMS).forEach(function (r) {
      if (r.length < 6) { res.skipped++; return; }
      var e = blank(now);
      keeperRow(e, r);
      push(res, e, "", !e.user && !e.pw && !e.urls.length && e.notes ? "note" : "login");
    });
    return res.entries.length ? res : { error: res.skipped ? "format" : "empty" };
  }
  // Keeper JSON: { records: [{ title, login, password, login_url,
  // notes, custom_fields: { name: value }, folders: [{ folder,
  // shared_folder }] }] }
  function fromKeeperJson(j, now) {
    var res = newResult("keeper");
    arr(j.records).forEach(function (rec) {
      if (!isObj(rec)) { res.skipped++; return; }
      var e = blank(now);
      e.title = s(rec.title); e.user = s(rec.login); e.pw = s(rec.password); e.notes = s(rec.notes);
      addUrl(e, rec.login_url);
      arr(rec.folders).forEach(function (f) {
        if (!isObj(f)) return;
        addTag(e, [s(f.shared_folder), s(f.folder)].filter(Boolean).join("/").replace(/\\/g, "/"));
      });
      var cf = isObj(rec.custom_fields) ? rec.custom_fields : {};
      Object.keys(cf).forEach(function (k) {
        var v = cf[k];
        if (Array.isArray(v)) v = v.length === 1 ? v[0] : "";
        if (isObj(v) || Array.isArray(v)) return;
        v = s(v);
        if (!v) return;
        if (!e.totp && (/^(TFC:|\$oneTimeCode)/i.test(k) || /^otpauth:\/\//i.test(v))) e.totp = v;
        else addField(e, k.replace(/^\$[a-z]+:?/i, "") || k, v, /pass|secret|pin|code/i.test(k));
      });
      if (arr(rec.attachments).length) res.attachments += rec.attachments.length;
      var ty = low(rec.$type);
      push(res, e, s(rec.uid), ty === "encryptednotes" || (!e.user && !e.pw && !e.urls.length && e.notes) ? "note" :
           ty === "bankcard" ? "card" : "login");
    });
    return res;
  }

  // ---------- encrypted exports (opened with the file's password) ----------
  // Bitwarden "password protected" .json, Aegis encrypted vault, 2FAS
  // backup with a password. parse() returns { locked: kind, data } and
  // unlock(locked, password) decrypts in memory with WebCrypto (scrypt
  // for Aegis is below, Argon2id for Bitwarden is the vendored
  // hash-wasm). KDF settings come from the file, so they are bounded
  // before anything is derived. Errors: no-key (empty password),
  // wrong-password, kdf-params, bad-file, no-wasm / no-argon2.
  function subtle() { return globalThis.crypto.subtle; }
  function utf8b(str) { return new TextEncoder().encode(String(str)); }
  function u8(x) { return new Uint8Array(x); }
  function hexB(h) {
    h = s(h);
    if (!/^([0-9a-f]{2})*$/i.test(h)) return null;
    var out = new Uint8Array(h.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  function cat(a, b) { var o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
  function bad(code) { return new Error(code); }
  function intIn(v, lo, hi) { return typeof v === "number" && Math.floor(v) === v && v >= lo && v <= hi; }
  function pbkdf2(pw, salt, iter, bytes) {
    return subtle().importKey("raw", pw, "PBKDF2", false, ["deriveBits"]).then(function (k) {
      return subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: iter }, k, bytes * 8);
    }).then(u8);
  }
  function hmac(key, data) {
    return subtle().importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]).then(function (k) {
      return subtle().sign("HMAC", k, data);
    }).then(u8);
  }
  function gcmOpen(key, iv, data) {   // data = ciphertext + 16-byte tag
    return subtle().importKey("raw", key, "AES-GCM", false, ["decrypt"]).then(function (k) {
      return subtle().decrypt({ name: "AES-GCM", iv: iv, tagLength: 128 }, k, data);
    }).then(u8, function () { throw bad("wrong-password"); });
  }

  // scrypt (RFC 7914), for Aegis. Salsa20/8 on little-endian words.
  function R(a, b) { return (a << b) | (a >>> (32 - b)); }
  function salsa8(B, x) {
    var i;
    for (i = 0; i < 16; i++) x[i] = B[i];
    for (i = 0; i < 8; i += 2) {
      x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9); x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
      x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9); x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
      x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9); x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
      x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9); x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
      x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9); x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
      x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9); x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
      x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9); x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
      x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9); x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
    }
    for (i = 0; i < 16; i++) B[i] = (B[i] + x[i]) | 0;
  }
  function blockMix(B, Y, r, x) {   // B: 32r words, Y: scratch of 32r
    var X = new Int32Array(16), i, j;
    for (j = 0; j < 16; j++) X[j] = B[(2 * r - 1) * 16 + j];
    for (i = 0; i < 2 * r; i++) {
      for (j = 0; j < 16; j++) X[j] ^= B[i * 16 + j];
      salsa8(X, x);
      var at = ((i & 1) ? r + (i >> 1) : (i >> 1)) * 16;
      for (j = 0; j < 16; j++) Y[at + j] = X[j];
    }
    B.set(Y);
  }
  function scrypt(pw, salt, N, r, p, dkLen) {
    return pbkdf2(pw, salt, 1, p * 128 * r).then(function (Bb) {
      var W = 32 * r, B = new Int32Array(p * W), dv = new DataView(Bb.buffer), i, k;
      for (i = 0; i < B.length; i++) B[i] = dv.getInt32(i * 4, true);
      var V = new Int32Array(W * N), Y = new Int32Array(W), x = new Int32Array(16);
      for (k = 0; k < p; k++) {
        var X = B.subarray(k * W, (k + 1) * W);
        for (i = 0; i < N; i++) { V.set(X, i * W); blockMix(X, Y, r, x); }
        for (i = 0; i < N; i++) {
          var jj = (X[(2 * r - 1) * 16] & (N - 1)) * W;
          for (var q = 0; q < W; q++) X[q] ^= V[jj + q];
          blockMix(X, Y, r, x);
        }
      }
      V.fill(0);
      for (i = 0; i < B.length; i++) dv.setInt32(i * 4, B[i], true);
      B.fill(0);
      return pbkdf2(pw, Bb, 1, dkLen).then(function (dk) { Bb.fill(0); return dk; });
    });
  }

  // Bitwarden EncString type 2: "2.iv|ct|mac" (AES-256-CBC + HMAC-SHA256)
  function bwOpen(encStr, encKey, macKey) {
    var m = /^2\.([^|]+)\|([^|]+)\|([^|]+)$/.exec(s(encStr));
    if (!m) return Promise.reject(bad("bad-file"));
    var iv = b64(m[1]), ct = b64(m[2]), mac = b64(m[3]);
    if (!iv || iv.length !== 16 || !ct || !mac) return Promise.reject(bad("bad-file"));
    return hmac(macKey, cat(iv, ct)).then(function (want) {
      var diff = want.length ^ mac.length;
      for (var i = 0; i < want.length && i < mac.length; i++) diff |= want[i] ^ mac[i];
      if (diff) throw bad("wrong-password");
      return subtle().importKey("raw", encKey, "AES-CBC", false, ["decrypt"]);
    }).then(function (k) { return subtle().decrypt({ name: "AES-CBC", iv: iv }, k, ct); })
      .then(function (b) { var out = u8(b), txt = utf8(out); out.fill(0); return txt; });
  }
  function bwKey(j, pw) {
    var t = j.kdfType == null ? 0 : j.kdfType;
    if (t === 0) {
      if (!intIn(j.kdfIterations, 5000, 2000000)) return Promise.reject(bad("kdf-params"));
      return pbkdf2(pw, utf8b(j.salt), j.kdfIterations, 32);
    }
    if (t === 1) {
      if (!intIn(j.kdfIterations, 2, 10) || !intIn(j.kdfMemory, 16, 1024) || !intIn(j.kdfParallelism, 1, 16))
        return Promise.reject(bad("kdf-params"));
      return Promise.all([vaultLib().loadArgon2(), subtle().digest("SHA-256", utf8b(j.salt))]).then(function (x) {
        return x[0].argon2id({ password: pw, salt: u8(x[1]), iterations: j.kdfIterations, parallelism: j.kdfParallelism,
                               memorySize: j.kdfMemory * 1024, hashLength: 32, outputType: "binary" });
      }).then(u8);
    }
    return Promise.reject(bad("kdf-params"));
  }
  function unlockBitwarden(j, pw, now) {
    return bwKey(j, pw).then(function (key) {
      // stretch: HKDF-Expand(key, "enc" / "mac", 32) = one HMAC block each
      return Promise.all([hmac(key, cat(utf8b("enc"), new Uint8Array([1]))), hmac(key, cat(utf8b("mac"), new Uint8Array([1])))])
        .then(function (k) { key.fill(0); return k; });
    }).then(function (k) {
      return bwOpen(j.encKeyValidation_DO_NOT_EDIT, k[0], k[1]).then(function () {
        return bwOpen(j.data, k[0], k[1]);
      }).then(function (txt) { k[0].fill(0); k[1].fill(0); return txt; },
              function (e) { k[0].fill(0); k[1].fill(0); throw e; });
    }).then(function (txt) {
      var inner = kit().json(txt);
      txt = null;
      if (!isObj(inner) || inner.encrypted === true) throw bad("bad-file");
      return fromJson(inner, now);
    });
  }
  function unlockAegis(j, pw, now) {
    var h = j.header, params = h.params, slots = arr(h.slots).filter(function (sl) { return isObj(sl) && sl.type === 1; });
    var nonce = hexB(params.nonce), tag = hexB(params.tag), db = b64(j.db);
    if (!nonce || !tag || tag.length !== 16 || !db) return Promise.reject(bad("bad-file"));
    function trySlot(i) {
      if (i >= slots.length) return Promise.reject(bad("wrong-password"));
      var sl = slots[i], salt = hexB(sl.salt), key = hexB(sl.key), kp = isObj(sl.key_params) ? sl.key_params : {};
      var kn = hexB(kp.nonce), kt = hexB(kp.tag);
      // memory = 128 * r * N bytes: at most 256 MB
      if (!intIn(sl.n, 2, 1 << 20) || (sl.n & (sl.n - 1)) || !intIn(sl.r, 1, 32) || !intIn(sl.p, 1, 16) ||
          128 * sl.r * sl.n > 256 * 1024 * 1024) return Promise.reject(bad("kdf-params"));
      if (!salt || !key || !kn || !kt || kt.length !== 16) return Promise.reject(bad("bad-file"));
      return scrypt(pw, salt, sl.n, sl.r, sl.p, 32).then(function (dk) {
        return gcmOpen(dk, kn, cat(key, kt)).then(function (mk) { dk.fill(0); return mk; },
                                                  function (e) { dk.fill(0); throw e; });
      }).catch(function (e) {
        if (e && e.message === "wrong-password") return trySlot(i + 1);
        throw e;
      });
    }
    return trySlot(0).then(function (mk) {
      return gcmOpen(mk, nonce, cat(db, tag)).then(function (b) { mk.fill(0); return b; },
                                                   function () { mk.fill(0); throw bad("bad-file"); });
    }).then(function (b) {
      var inner = kit().json(utf8(b)); b.fill(0);
      if (!isObj(inner)) throw bad("bad-file");
      return fromAegis({ header: { slots: null, params: null }, db: inner });
    });
  }
  function unlock2fas(j, pw, now) {
    var parts = j.servicesEncrypted.split(":");
    var data = b64(parts[0]), salt = b64(parts[1]), iv = b64(parts[2]);
    if (!data || !salt || !iv || data.length < 17) return Promise.reject(bad("bad-file"));
    return pbkdf2(pw, salt, 10000, 32).then(function (key) {
      return gcmOpen(key, iv, data).then(function (b) { key.fill(0); return b; }, function (e) { key.fill(0); throw e; });
    }).then(function (b) {
      var list = kit().json(utf8(b)); b.fill(0);
      if (!Array.isArray(list)) throw bad("bad-file");
      return from2fas({ services: list, groups: j.groups });
    });
  }
  // → Promise<result> (the same shape as parse); plain: false.
  function unlock(locked, password, now) {
    now = now || Date.now();
    var j = locked && locked.data;
    if (!isObj(j)) return Promise.reject(bad("bad-file"));
    if (!s(password)) return Promise.reject(bad("no-key"));
    var pw = utf8b(password), p;
    try {
      p = locked.locked === "bitwarden" ? unlockBitwarden(j, pw, now) :
          locked.locked === "aegis" ? unlockAegis(j, pw, now) :
          locked.locked === "2fas" ? unlock2fas(j, pw, now) : Promise.reject(bad("format"));
    } catch (e) { p = Promise.reject(bad("bad-file")); }
    return p.then(function (r) {
      wipe(pw);
      if (r && !r.error) r.plain = false;
      return r;
    }, function (e) {
      wipe(pw);
      throw bad(e && /^(no-key|wrong-password|kdf-params|bad-file|no-wasm|no-argon2|format)$/.test(e.message) ? e.message : "bad-file");
    });
  }

  // ---------- detection ----------
  function fromJson(j, now) {
    if (!isObj(j)) return { error: "format" };
    if (j.encrypted === true && !isObj(j.vaults)) {
      // Bitwarden: "password protected" opens with the file password;
      // "account restricted" only inside that Bitwarden account.
      if (j.passwordProtected === true && typeof j.data === "string" && typeof j.salt === "string" &&
          typeof j.encKeyValidation_DO_NOT_EDIT === "string") return { locked: "bitwarden", data: j };
      return { error: "encrypted" };
    }
    if (Array.isArray(j.records)) return fromKeeperJson(j, now);
    if (isObj(j.vaults) && !Array.isArray(j.items)) return fromProtonJson(j, now);
    if (j.db !== undefined && isObj(j.header)) return fromAegis(j);
    if (Array.isArray(j.services) || typeof j.servicesEncrypted === "string") return from2fas(j);
    if (Array.isArray(j.accounts)) return from1pux(j, now);
    if (Array.isArray(j.items) && j.items.some(function (it) { return isObj(it) && Array.isArray(it.fields) && it.fields.some(function (f) { return isObj(f) && "label" in f; }); }))
      return fromEnpass(j, now);
    if (Array.isArray(j.items)) {
      var bw = core().fromBitwarden(j, now);
      return bw.error ? bw : fromEntries("bitwarden", bw);
    }
    return { error: "format" };
  }

  // text: JSON, CSV, a PGP message, an otpauth(-migration) link.
  function parseText(text, name, now) {
    now = now || Date.now();
    var t = s(text).replace(/^﻿/, "");
    if (t.length > MAX_TEXT) return { error: "toobig" };
    var head = t.slice(0, 64).trim();
    if (/^-----BEGIN PGP/.test(head) || /\.pgp$/i.test(s(name))) return { error: "encrypted-proton" };
    if (/^otpauth-migration:\/\//i.test(head)) return fromMigration(t.trim());
    if (/^otpauth:\/\//i.test(head)) return /^otpauth:\/\/hotp\//i.test(head) ? { error: "hotp" } : fromOtpauth(t.trim());
    if (/^<(\?xml|KeePassFile)/i.test(head)) {
      try { return fromEntries("keepassxml", kdbx().readXml(t, { now: now })); }
      catch (e) { return { error: e && e.message === "not-kdbx" ? "format" : "bad-file" }; }
    }
    if (/^[\[{]/.test(head)) {
      var j = kit().json(t);
      return j === null ? { error: "json" } : fromJson(j, now);
    }
    var tb = table(t);
    if (!tb || !tb.rows.length) return { error: "empty" };
    var kind = csvKind(tb.head);
    if (kind === "keeper") return fromKeeperCsv(t, now);
    if (kind) return fromCsvKind(kind, tb, now);
    var r = core().fromCsv(t, now);
    // Keeper writes no header: a CSV nothing else reads, of rows with
    // at least its six columns (or named keeper*.csv)
    if (r.error === "format" && (/keeper/i.test(s(name)) ||
        core().parseCsv(t).every(function (row) { return row.length >= 6; }))) return fromKeeperCsv(t, now);
    return r.error ? r : fromEntries(csvLabel(tb.head), r);
  }

  // Dashlane / Proton / 1pux ZIPs.
  function fromZip(bytes, now) {
    var z = kit().unzip(bytes), names = z.names;
    function find(re) { for (var i = 0; i < names.length; i++) if (re.test(names[i])) return names[i]; return null; }
    function text(n) {
      return z.bytes(n, MAX_ENTRY).then(function (b) { var x = b ? kit().text(b) : ""; wipe(b); return x; });
    }
    if (find(/\.pgp$/i)) return Promise.resolve({ error: "encrypted-proton" });
    var n = find(/(^|\/)Proton Pass\/data\.json$/i) || find(/(^|\/)data\.json$/i);
    if (n) return text(n).then(function (t) { var j = kit().json(t); return j && isObj(j.vaults) ? fromProtonJson(j, now) : { error: "format" }; });
    n = find(/(^|\/)export\.data$/i);
    if (n) return text(n).then(function (t) { var j = kit().json(t); return j ? from1pux(j, now) : { error: "json" }; });
    n = find(/(^|\/)credentials\.csv$/i);
    if (n) {
      var res = newResult("dashlane"), notes = find(/(^|\/)securenotes\.csv$/i);
      return text(n).then(function (t) {
        var tb = table(t);
        if (tb && tb.rows.length) fromCsvKind("dashlane", tb, now, res);
        return notes ? text(notes) : "";
      }).then(function (t) {
        var tb = t ? table(t) : null;
        if (tb && tb.rows.length) fromCsvKind("dashnote", tb, now, res);
        return res;
      });
    }
    return Promise.resolve({ error: "format" });
  }

  // input { name, bytes } (bytes are wiped once read) or a string.
  function parse(input, now) {
    now = now || Date.now();
    if (typeof input === "string") return Promise.resolve(parseText(input, "", now));
    var bytes = input && input.bytes, name = s(input && input.name);
    if (!bytes || !bytes.length) return Promise.resolve({ error: "empty" });
    var p;
    try {
      if (bytes.length >= 8 && bytes[0] === 0x03 && bytes[1] === 0xd9 && bytes[2] === 0xa2 && bytes[3] === 0x9a) {
        return Promise.resolve({ kdbx: true });   // pmapp reads it with the password (bytes kept)
      }
      if (/\.dash$/i.test(name) || (bytes[0] === 0x44 && bytes[1] === 0x41 && bytes[2] === 0x53 && bytes[3] === 0x48)) {
        wipe(bytes); return Promise.resolve({ error: "encrypted-dashlane" });
      }
      if (kit().isZip(bytes)) p = fromZip(bytes, now);
      else p = Promise.resolve(parseText(kit().text(bytes), name, now));
    } catch (e) { p = Promise.resolve({ error: "format" }); }
    return p.then(function (r) { wipe(bytes); return r; }, function () { wipe(bytes); return { error: "format" }; });
  }

  // Entries read by pmcore / kdbx.js → a result with stable ids.
  function fromEntries(source, r) {
    var res = newResult(source);
    res.skipped = r.skipped || 0; res.attachments = r.attachments || 0; res.recycled = r.recycled || 0;
    res.plain = source !== "keepass";
    arr(r.entries).forEach(function (e) {
      var x = JSON.parse(JSON.stringify(e));
      x.id = "";
      push(res, x, "", "login");
    });
    return res;
  }

  // Several QR batches (Google Authenticator) → one result.
  function mergeResults(a, b) {
    if (!a || a.error) return b;
    if (!b || b.error) return a;
    var out = JSON.parse(JSON.stringify(a));
    out.source = a.source === b.source ? a.source : "gauth";
    var seen = {};
    out.codes.forEach(function (c) { seen[c.key] = 1; });
    b.codes.forEach(function (c) { if (!seen[c.key] && out.codes.length < MAX_ITEMS) { seen[c.key] = 1; out.codes.push(c); } });
    var ids = {};
    out.entries.forEach(function (e) { ids[e.id] = 1; });
    b.entries.forEach(function (e) { if (!ids[e.id]) { ids[e.id] = 1; out.entries.push(e); } });
    ["skipped", "unsupported", "trashed", "attachments", "recycled"].forEach(function (k) { out[k] = (a[k] || 0) + (b[k] || 0); });
    Object.keys(b.types || {}).forEach(function (k) { out.types[k] = (out.types[k] || 0) + b.types[k]; });
    out.batches = (a.batches || (a.batch ? [a.batch] : [])).concat(b.batch ? [b.batch] : []);
    out.batch = b.batch || a.batch;
    return out;
  }

  // ---------- merge into the vault snapshot ----------
  function foldKey(v) { return core().fold(v).replace(/[^a-z0-9]+/g, ""); }
  function secretOf(totp) {
    if (!totp) return "";
    var p = core().parseOtp(totp);
    return p.error ? "" : core().base32Encode(p.secret);
  }
  // Does entry e belong to this code's site and account?
  function sameAccount(e, c) {
    if (!c.account || low(e.user) !== low(c.account)) return false;
    var iss = foldKey(c.issuer);
    if (!iss) return false;
    var host = core().hostOf(e), hostKey = foldKey(host.split(".").slice(0, -1).join(".") || host);
    var title = foldKey(e.title);
    return (!!hostKey && (hostKey === iss || hostKey.indexOf(iss) >= 0 || iss.indexOf(hostKey) >= 0)) ||
           (!!title && (title === iss || title.indexOf(iss) >= 0 || iss.indexOf(title) >= 0));
  }

  // → { snap, added, attached, duplicates, codesNew, undo }
  function apply(snap, res, opts) {
    var PC = core();
    opts = opts || {};
    var now = opts.now || Date.now();
    var base = PC.normSnap(snap);
    var live = {}, secrets = {};
    base.e.forEach(function (e) { live[e.id] = e; var sc = secretOf(e.totp); if (sc) secrets[sc] = 1; });
    function stamp(id, old) { return Math.max(now, (base.d[id] || 0) + 1, (old || 0) + 1); }
    var cand = arr(res.entries).filter(function (e) { return !live[e.id]; });
    var dd = PC.dedupe(base.e, cand);
    var duplicates = arr(res.entries).length - cand.length + dd.duplicates;
    var adds = [], undo = { added: [], attached: [] };
    dd.entries.forEach(function (e) {
      var x = JSON.parse(JSON.stringify(e));
      x.m = stamp(x.id); x.c = Math.min(x.c || x.m, x.m);
      adds.push(x);
      var sc = secretOf(x.totp); if (sc) secrets[sc] = 1;
    });
    var attachedTo = {}, attached = 0, codesNew = 0, changed = [];
    arr(res.codes).forEach(function (c) {
      if (secrets[c.secret]) { duplicates++; return; }
      secrets[c.secret] = 1;
      var pool = base.e.concat(adds).filter(function (e) { return sameAccount(e, c); });
      var free = pool.length === 1 && !pool[0].totp && !attachedTo[pool[0].id] ? pool[0] : null;
      if (free) {
        var y = JSON.parse(JSON.stringify(free));
        y.totp = c.uri;
        attachedTo[y.id] = 1;
        if (live[y.id]) {
          y.m = stamp(y.id, free.m);
          changed.push(y);
          undo.attached.push({ id: y.id, totp: c.uri });
        } else free.totp = c.uri;   // an entry of this same import
        attached++;
        return;
      }
      var e = PC.blankEntry(now);
      e.id = c.key;
      if (live[e.id]) { duplicates++; return; }
      e.title = c.title; e.user = c.account; e.totp = c.uri; e.notes = c.notes || ""; e.tags = c.tags || [];
      e.m = stamp(e.id);
      var n = PC.normEntry(e, now);
      if (n) { adds.push(n); codesNew++; }
    });
    var out = base;
    adds.concat(changed).forEach(function (e) { out = PC.upsert(out, e); });
    adds.forEach(function (e) { undo.added.push({ id: e.id, m: e.m }); });
    return { snap: out, added: adds.length - codesNew, codesNew: codesNew, attached: attached, duplicates: duplicates,
             undo: undo };
  }

  // Take an import back: newer tombs and stamps so a sync that already
  // carried it cannot bring it back.
  function undo(snap, info, now) {
    var PC = core();
    now = now || Date.now();
    var out = PC.normSnap(snap);
    arr(info && info.added).forEach(function (a) {
      var cur = out.e.filter(function (e) { return e.id === a.id; })[0];
      out = PC.remove(out, a.id, Math.max(now, (cur ? cur.m : a.m) + 1));
    });
    arr(info && info.attached).forEach(function (a) {
      var cur = out.e.filter(function (e) { return e.id === a.id; })[0];
      if (!cur || cur.totp !== a.totp) return;   // changed since: the user's now
      var y = JSON.parse(JSON.stringify(cur));
      y.totp = ""; y.m = Math.max(now, cur.m + 1);
      out = PC.upsert(out, y);
    });
    return out;
  }

  var API = {
    version: "1.1.0", MAX_ITEMS: MAX_ITEMS,
    parse: parse, parseText: parseText, unlock: unlock, scrypt: scrypt, fromEntries: fromEntries, mergeResults: mergeResults,
    apply: apply, undo: undo, hexId: hexId, pbFields: pbFields
  };
  if (NODE) module.exports = API;
  else root.OrosPasswordsImport = API;
})(this);
