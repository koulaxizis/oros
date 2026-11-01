// orOS Contacts — CardDAV mapper (contacts/dav.js), CalDAV / CardDAV wave 4.
//
// Turns one address object (the vCard text of one contact on the
// person's CardDAV server) into the item the sync engine
// (../davsync.js) compares, and back. Pure: no DOM, no storage, no
// network; nothing from the server is executed or shown as HTML.
// Browser: window.OrosContactsDav (needs vcard.js first). Node:
// module.exports (tests/contacts-dav.test.js, tests/davsync-contacts.test.js).
//
// The item is a contact's own fields with its labels as names:
//   { id, mtime, given, middle, family, nickname, org, jobTitle, phones,
//     emails, addresses, websites, im, events, note, starred, avatar,
//     cats: ["label name"] }
// contacts.js turns names into its label ids and keeps everything
// that is only orOS's (relations, keep in touch, the log, stamps).
//
//   mapper(colUrl, { mark, now }) → the engine's `map`:
//     read(text, href) → null (a group card, not a person)
//                      | { uid, main, extras: [], ro, mtime }
//     write(item, raw) → text | null (null: cannot be written exactly)
//     hash, idFor, file, copy, mtime, merge (the first link: the same
//     person on both sides, nothing of either is lost)
//
// DAV-4 (lossless): a write patches the server's own text, one group
// of properties at a time, and only the groups whose value changed:
// N + FN, NICKNAME, ORG (its units stay), TITLE, TEL, EMAIL, ADR, URL,
// IMPP, BDAY + ANNIVERSARY + X-EVENT, NOTE, CATEGORIES, X-OROS-STARRED,
// X-OROS-AVATAR, plus REV. A line whose value is still there is kept
// as it was (its parameters and Apple "itemN." group too). PHOTO
// (DAV-5, never read: CT-NP), UID, X-* and everything else stay as the
// server sent them.
// Read-only (ro: the server always wins, "edit it on the server"): a
// card with a value longer than Contacts keeps, a date Contacts cannot
// read, or more than one card in the item.
// Every write is read back before it goes out: when the text does not
// read as exactly the item (same hash), write gives null and nothing
// is sent (DAV-6: no endless uploads).
(function (root) {
  "use strict";

  var VC = (root && root.OrosVcard) || (typeof require === "function" ? require("./vcard.js") : null);
  var PX_RE = /^px:[a-z0-9]{1,12}$/;
  var EVENT_TYPES = ["birthday", "anniversary", "custom"];
  var ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
  // The three seed labels (contacts.js defaultLabels) are one label in
  // every language, so a Greek and an English device agree on them.
  // i18n-inline-ok: seed label names in each language (data for matching, no UI text)
  var SEEDS = {
    "lbl-personal": ["personal", "προσωπικο", "privat"],
    "lbl-work": ["work", "εργασια", "arbeit"],
    "lbl-family": ["family", "οικογενεια", "familie"]
  };

  function fnv(s, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function hash16(s) { s = String(s); return fnv(s, 2166136261) + fnv(s, 0x9747b28c); }
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/ς/g, "σ").replace(/\s+/g, " ").trim();
  }
  // The key of a label name: a seed label by its id, others by name.
  function catKey(name) {
    var f = fold(name);
    for (var id in SEEDS) if (SEEDS[id].indexOf(f) !== -1) return "#" + id;
    return f;
  }
  function seedOf(name) {
    var k = catKey(name);
    return k.charAt(0) === "#" ? k.slice(1) : null;
  }

  // What a value is once written and read back: control characters
  // are spaces (a note keeps its line breaks), no space around it.
  function txt(v, max) {
    return String(typeof v === "string" ? v : "").replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, max);
  }
  function one(v, max) { return txt(String(typeof v === "string" ? v : "").replace(/\n/g, " "), max); }
  function okType(t, list) { return list.indexOf(t) !== -1 ? t : "other"; }
  function validDay(day) {
    if (typeof day !== "string" || !/^\d{2}-\d{2}$/.test(day)) return false;
    var mm = +day.slice(0, 2), dd = +day.slice(3);
    if (mm < 1 || mm > 12 || dd < 1) return false;
    return dd <= new Date(2000, mm, 0).getDate();
  }
  var L = VC.LIM;
  function pVal(len, types) {
    return function (r) {
      if (!r || typeof r !== "object") return null;
      var v = one(r.v, len);
      return v ? { v: v, type: okType(r.type, types) } : null;
    };
  }
  function pAddr(r) {
    if (!r || typeof r !== "object") return null;
    var o = { street: one(r.street, L.street), city: one(r.city, L.city), zip: one(r.zip, L.zip),
              region: one(r.region, L.region), country: one(r.country, L.country) };
    if (!o.street && !o.city && !o.zip && !o.region && !o.country) return null;
    o.type = okType(r.type, VC.ADDR_TYPES);
    return o;
  }
  function pEvent(r) {
    if (!r || typeof r !== "object" || !validDay(r.day)) return null;
    var y = typeof r.year === "number" && isFinite(r.year) && r.year >= 1850 && r.year <= 2200 ? Math.floor(r.year) : null;
    var ty = EVENT_TYPES.indexOf(r.type) !== -1 ? r.type : "custom";
    return { day: r.day, year: y, type: ty, label: ty === "custom" ? one(r.label, L.label).replace(/"/g, "'") : "" };
  }
  function rows(list, fn) { return (Array.isArray(list) ? list : []).map(fn).filter(Boolean); }

  // The fields the sync compares, in the form they have once written
  // and read back (contacts.js sanitizeContact keeps them this way).
  function proj(c) {
    c = c || {};
    var keys = [];
    (Array.isArray(c.cats) ? c.cats : []).forEach(function (n) {
      var k = catKey(one(n, L.cat));
      if (k && keys.indexOf(k) === -1) keys.push(k);
    });
    keys.sort();
    return {
      given: one(c.given, L.name), middle: one(c.middle, L.name), family: one(c.family, L.name),
      nickname: one(c.nickname, L.name), org: one(c.org, L.org), jobTitle: one(c.jobTitle, L.title),
      phones: rows(c.phones, pVal(L.tel, VC.PHONE_TYPES)),
      emails: rows(c.emails, pVal(L.email, VC.EMAIL_TYPES)),
      addresses: rows(c.addresses, pAddr),
      websites: rows(c.websites, pVal(L.url, VC.WEB_TYPES)),
      im: rows(c.im, pVal(L.im, VC.IM_TYPES)),
      events: rows(c.events, pEvent).sort(function (a, b) {
        return a.type < b.type ? -1 : (a.type > b.type ? 1 : (a.day < b.day ? -1 : (a.day > b.day ? 1 : 0)));
      }),
      note: txt(c.note, L.note),
      cats: keys,
      starred: c.starred === true,
      avatar: typeof c.avatar === "string" && PX_RE.test(c.avatar) ? c.avatar : null
    };
  }

  // The property groups a write patches: the item's fields → the vCard
  // property names that hold them.
  var GROUPS = [
    { f: ["given", "middle", "family"], p: ["N", "FN"] },
    { f: ["nickname"], p: ["NICKNAME"] },
    { f: ["org"], p: ["ORG"] },
    { f: ["jobTitle"], p: ["TITLE"] },
    { f: ["phones"], p: ["TEL"], list: "phones" },
    { f: ["emails"], p: ["EMAIL"], list: "emails" },
    { f: ["addresses"], p: ["ADR"], list: "addresses" },
    { f: ["websites"], p: ["URL"], list: "websites" },
    { f: ["im"], p: ["IMPP"], list: "im" },
    { f: ["events"], p: ["BDAY", "ANNIVERSARY", "X-ANNIVERSARY", "X-EVENT"], list: "events" },
    { f: ["note"], p: ["NOTE"] },
    { f: ["cats"], p: ["CATEGORIES"] },
    { f: ["starred"], p: ["X-OROS-STARRED"] },
    { f: ["avatar"], p: ["X-OROS-AVATAR"] }
  ];
  var GROUP_OF = {};
  GROUPS.forEach(function (g, i) { g.p.forEach(function (p) { GROUP_OF[p] = i; }); });

  function utc(ms, v4) {
    var s = new Date(ms).toISOString().replace(/\.\d+/, "");
    return v4 ? s.replace(/[-:]/g, "") : s;
  }
  function up(t, v4) { return v4 ? t : t.toUpperCase(); }
  function dateVal(ev, v4) {
    var md = v4 ? ev.day.replace("-", "") : ev.day;
    if (ev.year) return v4 ? String(ev.year) + md : ev.year + "-" + ev.day;
    return "--" + md;
  }
  function display(c) {
    var parts = [c.given, c.middle, c.family].filter(Boolean);
    if (parts.length) return parts.join(" ");
    return c.nickname || c.org || (c.emails[0] && c.emails[0].v) || (c.phones[0] && c.phones[0].v) || "";
  }

  // Fresh lines of one group for a projected item p (names: the item's
  // own label names, in its order). raw: the old lines of the group.
  function emit(gi, p, names, v4, rawN, rawOrg) {
    var E = VC.esc, out = [];
    switch (gi) {
      case 0:
        out.push("N:" + [E(p.family), E(p.given), E(p.middle)].concat(rawN || ["", ""]).join(";"));
        out.push("FN:" + E(display(p)));
        break;
      case 1: if (p.nickname) out.push("NICKNAME:" + E(p.nickname)); break;
      case 2: if (p.org || (rawOrg && rawOrg.length)) out.push("ORG:" + [E(p.org)].concat(rawOrg || []).join(";")); break;
      case 3: if (p.jobTitle) out.push("TITLE:" + E(p.jobTitle)); break;
      case 10: if (p.note) out.push("NOTE:" + E(p.note)); break;
      case 11: if (names.length) out.push("CATEGORIES:" + names.map(E).join(",")); break;
      case 12: if (p.starred) out.push("X-OROS-STARRED:TRUE"); break;
      case 13: if (p.avatar) out.push("X-OROS-AVATAR:" + p.avatar); break;
    }
    return out;
  }
  function emitRow(list, r, v4) {
    var E = VC.esc;
    switch (list) {
      case "phones": return "TEL;TYPE=" + up(r.type === "mobile" ? "cell" : r.type, v4) + ":" + E(r.v);
      case "emails": return "EMAIL;TYPE=" + up(r.type, v4) + ":" + E(r.v);
      case "addresses":
        return "ADR;TYPE=" + up(r.type, v4) + ":" + ["", "", r.street, r.city, r.region, r.zip, r.country].map(E).join(";");
      case "websites": return "URL;TYPE=" + up(r.type, v4) + ":" + E(r.v);
      case "im": return "IMPP;TYPE=" + up(r.type, v4) + ":" + E(r.v);
      case "events":
        if (r.type === "birthday") return "BDAY:" + dateVal(r, v4);
        if (r.type === "anniversary") return "ANNIVERSARY:" + dateVal(r, v4);
        return "X-EVENT;TYPE=CUSTOM;X-LABEL=\"" + r.label + "\":" + dateVal(r, v4);
    }
    return "";
  }
  // The names to write for the item's labels, seed labels by the name
  // the item gives them, without repeats of one key.
  function catNames(c) {
    var seen = {}, out = [];
    (Array.isArray(c.cats) ? c.cats : []).forEach(function (n) {
      var v = one(n, L.cat), k = catKey(v);
      if (k && !seen[k]) { seen[k] = 1; out.push(v); }
    });
    return out;
  }

  function mapper(colUrl, opts) {
    opts = opts || {};
    var mark = opts.mark || " (conflict)";
    var now = opts.now || function () { return Date.now(); };

    function hash(c) { return hash16(JSON.stringify(proj(c))); }

    function itemOf(pc) {
      return { given: pc.given, middle: pc.middle, family: pc.family, nickname: pc.nickname, org: pc.org,
               jobTitle: pc.jobTitle, phones: pc.phones, emails: pc.emails, addresses: pc.addresses,
               websites: pc.websites, im: pc.im, events: pc.events, note: pc.note, starred: pc.starred,
               avatar: pc.avatar, cats: pc.cats };
    }

    function read(text) {
      var bs = VC.blocks(text);
      if (!bs.length) return null;
      var pc = VC.parse(bs[0]);
      if (pc.kind === "group") return null;          // a group card (Apple, vCard 4 KIND:group)
      return { uid: pc.uid, main: itemOf(pc), extras: [], ro: pc.cut || bs.length > 1, mtime: pc.rev || 0 };
    }

    function build(c) {
      var p = proj(c), names = catNames(c);
      var out = ["BEGIN:VCARD", "VERSION:3.0", "PRODID:-//orOS//Contacts//EN", "UID:" + VC.esc(c.id) + "@oros.contacts"];
      GROUPS.forEach(function (g, gi) {
        if (g.list) p[g.list].forEach(function (r) { out.push(emitRow(g.list, r, false)); });
        else out = out.concat(emit(gi, p, names, false, null, null));
      });
      out.push("REV:" + utc(now(), false), "END:VCARD");
      return out.map(function (l) { return VC.fold(l).join("\r\n"); }).join("\r\n") + "\r\n";
    }

    function patch(raw, c) {
      var lines = VC.unfold(raw);
      var start = -1, end = -1, depth = 0;
      for (var i = 0; i < lines.length; i++) {
        var u = lines[i].trim().toUpperCase();
        if (u === "BEGIN:VCARD") { depth++; if (depth === 1 && start === -1) start = i; }
        else if (u === "END:VCARD") { depth--; if (depth === 0 && start !== -1) { end = i; break; } }
      }
      if (start === -1 || end === -1) return null;
      var inner = lines.slice(start + 1, end);
      var old = VC.parse(inner);
      if (old.cut || old.kind === "group") return null;
      var v4 = /^4/.test(old.version);
      var po = proj(itemOf(old)), pn = proj(c), names = catNames(c);
      var changed = GROUPS.map(function (g) {
        return g.f.some(function (f) { return JSON.stringify(po[f]) !== JSON.stringify(pn[f]); });
      });
      var pool = {}, kept = [], rawN = null, rawOrg = null, d = 0;
      inner.forEach(function (ln) {
        var uu = ln.trim().toUpperCase();
        if (uu.indexOf("BEGIN:") === 0) { d++; kept.push(ln); return; }
        if (uu.indexOf("END:") === 0) { d--; kept.push(ln); return; }
        if (d > 0) { kept.push(ln); return; }
        var pr = VC.prop(ln);
        if (!pr) { kept.push(ln); return; }
        if (pr.name === "REV") return;
        var gi = GROUP_OF[pr.name];
        if (gi === undefined || !changed[gi]) { kept.push(ln); return; }
        if (pr.name === "N") rawN = VC.split(pr.value, ";").slice(3, 5);
        if (pr.name === "ORG") rawOrg = VC.split(pr.value, ";").slice(1);
        var g = GROUPS[gi];
        if (g.list) {
          var one1 = proj(itemOf(VC.parse([ln])))[g.list][0];
          if (one1) (pool[g.list] = pool[g.list] || []).push({ line: ln, key: JSON.stringify(one1) });
        }
      });
      while (rawN && rawN.length < 2) rawN.push("");
      if (rawOrg && !rawOrg.some(Boolean)) rawOrg = null;
      var add = [];
      GROUPS.forEach(function (g, gi) {
        if (!changed[gi]) return;
        if (!g.list) { add = add.concat(emit(gi, pn, names, v4, rawN, rawOrg)); return; }
        var free = pool[g.list] || [];
        pn[g.list].forEach(function (r) {
          var k = JSON.stringify(r);
          for (var j = 0; j < free.length; j++) {
            if (!free[j].used && free[j].key === k) { free[j].used = true; add.push(free[j].line); return; }
          }
          add.push(emitRow(g.list, r, v4));
        });
      });
      var body = kept.concat(add, ["REV:" + utc(now(), v4)]);
      var out = lines.slice(0, start + 1).concat(body, lines.slice(end)).filter(function (l, ix, arr) {
        return !(ix === arr.length - 1 && l === "");
      });
      return out.map(function (l) { return VC.fold(l).join("\r\n"); }).join("\r\n") + "\r\n";
    }

    function write(c, raw) {
      var text = raw ? patch(raw, c) : build(c);
      if (text === null) return null;
      var back = read(text);
      if (!back || back.ro || hash(back.main) !== hash(c)) return null;
      return text;
    }

    function idFor(uid, key) {
      var own = String(uid || "").match(/^(.+)@oros\.contacts$/);
      return {
        own: own && ID_RE.test(own[1]) ? own[1] : null,
        bind: null,
        dav: "dav-" + hash16(colUrl + "\n" + (uid || key))
      };
    }

    function copy(c) {
      var x = JSON.parse(JSON.stringify(c));
      x.id = "c" + now().toString(36) + Math.random().toString(36).slice(2, 7);
      var f = x.given ? "given" : x.family ? "family" : x.org ? "org" : x.nickname ? "nickname" : "given";
      var max = f === "org" ? L.org : L.name;
      x[f] = String(x[f] || "").trim().slice(0, Math.max(0, max - mark.length)) + mark;
      if (f === "given" && !c.given && !c.family && !c.org && !c.nickname) x.given = mark.trim();
      return x;
    }

    // The first link found the same person here and there (shared
    // e-mail or phone, contacts.js davMatch): one contact with both,
    // the one here leading on one-value fields; nothing is dropped.
    function merge(loc, srv) {
      var x = JSON.parse(JSON.stringify(loc));
      ["given", "middle", "family", "nickname", "org", "jobTitle"].forEach(function (f) {
        if (!one(x[f], 200) && one(srv[f], 200)) x[f] = srv[f];
      });
      var a = txt(x.note, L.note), b = txt(srv.note, L.note);
      if (!a) x.note = srv.note || "";
      else if (b && a.indexOf(b) === -1) x.note = (a + "\n\n" + b).slice(0, L.note);
      var keyOf = {
        phones: function (r) { var d = String(r.v || "").replace(/\D+/g, ""); return d.slice(-9) || fold(r.v); },
        emails: function (r) { return String(r.v || "").trim().toLowerCase(); },
        addresses: function (r) { return [fold(r.street), fold(r.city), fold(r.zip)].join("|"); },
        websites: function (r) { return String(r.v || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, ""); },
        im: function (r) { return fold(r.v); },
        events: function (r) { return r.type + "|" + r.day + "|" + (r.type === "custom" ? fold(r.label) : ""); }
      };
      Object.keys(keyOf).forEach(function (f) {
        var have = {};
        x[f] = Array.isArray(x[f]) ? x[f] : [];
        x[f].forEach(function (r) { have[keyOf[f](r)] = 1; });
        (Array.isArray(srv[f]) ? srv[f] : []).forEach(function (r) {
          var k = keyOf[f](r);
          if (f === "events" && r.type !== "custom") {
            // one birthday, one anniversary: the one here stays
            if (x[f].some(function (y) { return y.type === r.type; })) return;
          }
          if (!have[k]) { have[k] = 1; x[f].push(JSON.parse(JSON.stringify(r))); }
        });
      });
      var ck = {};
      x.cats = Array.isArray(x.cats) ? x.cats.slice() : [];
      x.cats.forEach(function (n) { ck[catKey(n)] = 1; });
      (Array.isArray(srv.cats) ? srv.cats : []).forEach(function (n) { if (!ck[catKey(n)]) { ck[catKey(n)] = 1; x.cats.push(n); } });
      x.starred = loc.starred === true || srv.starred === true;
      if (!x.avatar && srv.avatar) x.avatar = srv.avatar;
      return x;
    }

    return {
      kind: "card", type: "text/vcard",
      read: read, write: write, hash: hash, idFor: idFor, copy: copy, merge: merge,
      file: function (id) { return id + ".vcf"; },
      mtime: function (c) { return c && typeof c.mtime === "number" ? c.mtime : 0; },
      patch: patch, build: build
    };
  }

  var api = { mapper: mapper, proj: proj, catKey: catKey, seedOf: seedOf, fold: fold };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosContactsDav = api;
})(typeof window !== "undefined" ? window : null);
