// ============================================================
// orOS Contacts — .oroscontacts file (contacts/package.js,
// window.OrosContactsPackage). The descriptor of Contacts for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every contact (with its interaction log) and every label in
// one orOS bundle; opening one ADDS what this device lacks, with its
// ids. Pure (no DOM, no storage), so the app and `node --test` run the
// same code. Uses merge.js (loaded first in the page; required in
// Node) for the keep-in-touch keys, the log and the field stamps.
// No photos (CT-NP): a contact has its initials or an 8-bit avatar
// seed ("px:<seed>"); anything else in `avatar` or `photo` is dropped.
// Nothing of the Google / Microsoft import (tokens, own app ids) is
// in the slice, so nothing of it can reach a file.
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; contacts.js then runs the
//                            result through its sanitizer + saveState,
//                            which stamps fields and marks sync dirty)
//   DESC.norm(data)          a file's data → { ver, labels, contacts }
//                            with known fields only, typed and capped
//                            (the rules of sanitizeContact)
//   DESC.strip(state)        the slice → { ver, labels, contacts }: no
//                            tombstones (deleted)
//   DESC.tombIds(state)      the ids in state.deleted
//   DESC.previews(state, l)  contacts.vcf (vCard 3.0, the app's Export)
//   contactToVcard(c, labels, lang)  one contact → vCard lines
//   kindOf(id, state)        "contact" | "label" | ""
// ============================================================
(function (root) {
  "use strict";

  var MG = (typeof module === "object" && module.exports) ? require("./merge.js") : root.OrosContactsMerge;

  var LIM = { contacts: 20000, labels: 200, rows: 50, rels: 200 };
  // The same lists as contacts.js (a test keeps them equal).
  var LABEL_PALETTE = ["#d4af37", "#a78bfa", "#7aa2f7", "#9ece6a",
                       "#e06c75", "#ff9e64", "#4ec9b0", "#f28fb6"];
  var PHONE_TYPES = ["mobile", "home", "work", "main", "other"];
  var EMAIL_TYPES = ["home", "work", "other"];
  var ADDR_TYPES  = ["home", "work", "other"];
  var WEB_TYPES   = ["home", "work", "blog", "other"];
  var IM_TYPES    = ["home", "work", "other"];
  var EVENT_TYPES = ["birthday", "anniversary", "custom"];
  var RELATION_TYPES = ["spouse", "partner", "parent", "child",
                        "sibling", "friend", "colleague", "manager", "other"];
  var PX_RE = /^px:[a-z0-9]{1,12}$/;
  var FUTURE = 5 * 60 * 1000;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  // control characters out (a name never spans lines); notes keep \n
  function line(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : ""; }
  function text(v, max) { return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").slice(0, max) : ""; }
  function okId(v) { return typeof v === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(v) && v !== "__proto__"; }

  // ---------- norm (the rules of contacts.js sanitizeContact) ----------
  function validDay(day) {
    if (typeof day !== "string" || !/^\d{2}-\d{2}$/.test(day)) return false;
    var mm = +day.slice(0, 2), dd = +day.slice(3);
    if (mm < 1 || mm > 12 || dd < 1) return false;
    return dd <= new Date(2000, mm, 0).getDate();
  }
  function rows(list, fn) {
    return (Array.isArray(list) ? list : []).slice(0, LIM.rows).map(fn).filter(Boolean);
  }
  function sanVal(len, types) {
    return function (row) {
      if (!isObj(row)) return null;
      var v = line(row.v, len).trim();
      if (!v) return null;
      return { v: v, type: types.indexOf(row.type) !== -1 ? row.type : "other" };
    };
  }
  function sanAddr(row) {
    if (!isObj(row)) return null;
    var o = { street: line(row.street, 120).trim(), city: line(row.city, 60).trim(), zip: line(row.zip, 20).trim(),
              region: line(row.region, 60).trim(), country: line(row.country, 60).trim() };
    if (!o.street && !o.city && !o.zip && !o.region && !o.country) return null;
    o.type = ADDR_TYPES.indexOf(row.type) !== -1 ? row.type : "other";
    return o;
  }
  function sanEvent(row) {
    if (!isObj(row) || !validDay(row.day)) return null;
    var y = typeof row.year === "number" && isFinite(row.year) && row.year >= 1850 && row.year <= 2200 ? Math.floor(row.year) : null;
    return { day: row.day, year: y, type: EVENT_TYPES.indexOf(row.type) !== -1 ? row.type : "custom",
             label: line(row.label, 40).trim() };
  }
  function normContact(c, now) {
    if (!isObj(c) || !okId(c.id)) return null;
    var seen = {}, lids = [];
    (Array.isArray(c.labelIds) ? c.labelIds : []).forEach(function (l) {
      if (okId(l) && !seen[l] && lids.length < LIM.labels) { seen[l] = 1; lids.push(l); }
    });
    lids.sort();
    var rs = {}, rels = [];
    (Array.isArray(c.relations) ? c.relations : []).slice(0, LIM.rels).forEach(function (r) {
      if (!isObj(r) || !okId(r.with)) return;
      var ty = RELATION_TYPES.indexOf(r.type) !== -1 ? r.type : "other";
      if (rs[r.with + "|" + ty]) return;
      rs[r.with + "|" + ty] = 1;
      rels.push({ with: r.with, type: ty });
    });
    rels.sort(function (a, b) { return a.with < b.with ? -1 : (a.with > b.with ? 1 : 0); });
    var out = {
      id: c.id,
      given: line(c.given, 60), middle: line(c.middle, 60), family: line(c.family, 60),
      nickname: line(c.nickname, 60), org: line(c.org, 80), jobTitle: line(c.jobTitle, 80),
      phones: rows(c.phones, sanVal(40, PHONE_TYPES)),
      emails: rows(c.emails, sanVal(120, EMAIL_TYPES)),
      addresses: rows(c.addresses, sanAddr),
      websites: rows(c.websites, sanVal(300, WEB_TYPES)),
      im: rows(c.im, sanVal(120, IM_TYPES)),
      events: rows(c.events, sanEvent).sort(function (a, b) {
        return a.type < b.type ? -1 : (a.type > b.type ? 1 : (a.day < b.day ? -1 : 1));
      }),
      relations: rels,
      labelIds: lids,
      starred: c.starred === true,
      note: text(c.note, 2000),
      avatar: typeof c.avatar === "string" && PX_RE.test(c.avatar) ? c.avatar : null,   // CT-NP: never a photo
      mtime: num(c.mtime)
    };
    if (MG) {
      MG.sanExtras(c, out);                    // keep, seen, log, logDel, fm (typed)
      // the log's own stamps, clamped like every other stamp
      var lim = now + FUTURE;
      (out.log || []).forEach(function (it) { if (it.m > lim) it.m = lim; });
      if (out.logDel) Object.keys(out.logDel).forEach(function (k) { if (out.logDel[k] > lim) out.logDel[k] = lim; });
    }
    return out;
  }
  function normLabel(l) {
    if (!isObj(l) || !okId(l.id)) return null;
    return { id: l.id, name: line(l.name, 40),
             color: LABEL_PALETTE.indexOf(l.color) !== -1 ? l.color : LABEL_PALETTE[0],
             mtime: num(l.mtime) };
  }
  function norm(data) {
    if (!isObj(data)) return null;
    var now = Date.now(), out = { ver: 1, labels: [], contacts: [] };
    if (Array.isArray(data.deleted)) out.deleted = data.deleted;   // strip and tombIds see it, then it goes
    (Array.isArray(data.labels) ? data.labels : []).slice(0, LIM.labels).forEach(function (l) {
      var c = normLabel(l);
      if (c) out.labels.push(c);
    });
    (Array.isArray(data.contacts) ? data.contacts : []).slice(0, LIM.contacts).forEach(function (c) {
      var n = normContact(c, now);
      if (n) out.contacts.push(n);
    });
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    return JSON.parse(JSON.stringify({ ver: 1, labels: Array.isArray(s.labels) ? s.labels : [],
                                       contacts: Array.isArray(s.contacts) ? s.contacts : [] }));
  }
  function tombIds(state) {
    var out = [];
    (isObj(state) && Array.isArray(state.deleted) ? state.deleted : []).forEach(function (d) {
      if (isObj(d) && typeof d.id === "string" && d.id) out.push(d.id);
    });
    return out;
  }

  // ---------- preview: contacts.vcf (contacts.js contactToVcard) ----------
  function vcfEsc(s) {
    return String(s || "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
      .replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }
  function vcfFold(l) {
    if (l.length <= 75) return [l];
    var out = [l.slice(0, 75)], rest = l.slice(75);
    while (rest.length) { out.push(" " + rest.slice(0, 74)); rest = rest.slice(74); }
    return out;
  }
  var W = { en: { "name.unnamed": "Unnamed" }, el: { "name.unnamed": "Χωρίς όνομα" } };
  function unnamed(lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (I && lang && !W[lang]) I.table(W, "contacts", lang);
    return (W[lang] || W.en)["name.unnamed"];
  }
  function displayName(c, lang) {
    var parts = [c.given, c.middle, c.family].filter(Boolean);
    if (parts.length) return parts.join(" ");
    return c.nickname || c.org || unnamed(lang);
  }
  function upType(ty) { return String(ty || "other").replace(/[^a-z]/gi, "").toUpperCase() || "OTHER"; }
  // c: a contact (as norm returns it); labels: { id: name }
  function contactToVcard(c, labels, lang) {
    var L = ["BEGIN:VCARD", "VERSION:3.0"];
    L.push("N:" + [c.family, c.given, c.middle, "", ""].map(vcfEsc).join(";"));
    L.push("FN:" + vcfEsc(displayName(c, lang)));
    if (c.nickname) L.push("NICKNAME:" + vcfEsc(c.nickname));
    if (c.org) L.push("ORG:" + vcfEsc(c.org));
    if (c.jobTitle) L.push("TITLE:" + vcfEsc(c.jobTitle));
    (c.phones || []).forEach(function (p) { L.push("TEL;TYPE=" + (p.type === "mobile" ? "CELL" : upType(p.type)) + ":" + vcfEsc(p.v)); });
    (c.emails || []).forEach(function (e) { L.push("EMAIL;TYPE=" + upType(e.type) + ":" + vcfEsc(e.v)); });
    (c.addresses || []).forEach(function (a) {
      L.push("ADR;TYPE=" + upType(a.type) + ":" + ["", "", a.street, a.city, a.region, a.zip, a.country].map(vcfEsc).join(";"));
    });
    (c.websites || []).forEach(function (w) { L.push("URL:" + vcfEsc(w.v)); });
    (c.im || []).forEach(function (m) { L.push("IMPP:" + vcfEsc(m.v)); });
    (c.events || []).forEach(function (ev) {
      var val = ev.year ? (ev.year + "-" + ev.day) : ("--" + ev.day);
      if (ev.type === "birthday") L.push("BDAY:" + val);
      else if (ev.type === "anniversary") L.push("ANNIVERSARY:" + val);
      else L.push("X-EVENT;TYPE=CUSTOM;X-LABEL=" + vcfEsc(ev.label) + ":" + val);
    });
    if (c.note) L.push("NOTE:" + vcfEsc(c.note));
    var names = (c.labelIds || []).map(function (id) { return labels[id] || ""; }).filter(Boolean);
    if (names.length) L.push("CATEGORIES:" + names.map(vcfEsc).join(","));
    if (c.starred) L.push("X-OROS-STARRED:TRUE");
    if (c.avatar && PX_RE.test(c.avatar)) L.push("X-OROS-AVATAR:" + c.avatar);   // a seed, never a PHOTO
    var d = new Date(num(c.mtime));
    if (isFinite(d.getTime())) L.push("REV:" + d.toISOString());
    L.push("END:VCARD");
    return L;
  }
  function previews(state, lang) {
    var labels = {}, out = [];
    (state.labels || []).forEach(function (l) { if (isObj(l)) labels[l.id] = l.name; });
    var list = (state.contacts || []).filter(isObj).slice();
    if (!list.length) return {};
    list.sort(function (a, b) {
      var x = displayName(a, lang).toLowerCase(), y = displayName(b, lang).toLowerCase();
      return x < y ? -1 : (x > y ? 1 : (a.id < b.id ? -1 : 1));
    });
    list.forEach(function (c) {
      contactToVcard(c, labels, lang).forEach(function (l) { vcfFold(l).forEach(function (f) { out.push(f); }); });
    });
    return { "contacts.vcf": out.join("\r\n") + "\r\n" };
  }

  // What an id names in a state (Undo removes each the right way).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {}, k = "";
    (s.labels || []).forEach(function (l) { if (l && l.id === id) k = "label"; });
    (s.contacts || []).forEach(function (c) { if (c && c.id === id) k = "contact"; });
    return k;
  }

  var DESC = {
    app: "contacts", title: "Contacts", slice: "contacts", ext: ".oroscontacts", mime: "application/x-oros-contacts",
    colls: {
      labels: { shape: "array", id: "id", stamp: "mtime" },
      contacts: { shape: "array", id: "id", stamp: "mtime", clampIn: ["fm"] }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, LIM: LIM, LABEL_PALETTE: LABEL_PALETTE, contactToVcard: contactToVcard, kindOf: kindOf };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosContactsPackage = api;
})(this);
