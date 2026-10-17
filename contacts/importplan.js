// ============================================================
// orOS Contacts — import review plan (contacts/importplan.js)
// ============================================================
// Pure helpers, no DOM, no storage (also loaded by the node tests).
// i18n-inline-ok: Greek letter folding for name matching (data, no UI text)
// Every import path (vCard / CSV file, "From phone", a .vcf handed
// over by the shell, "From an account") goes through one review:
//
//   plan(local, incoming, labels) → { items[], counts, folded }
//     Each incoming contact is matched against this device's
//     contacts: a shared e-mail, else a shared phone number (the
//     same number with or without the country code), else the same
//     first + last name (accents and case ignored).
//       kind "new"  — no match; default action "add".
//       kind "same" — matched and nothing new; default "skip".
//       kind "diff" — matched and the import brings details this
//                     contact lacks (add) and/or holds a different
//                     value in a one-value field (conflicts);
//                     default "merge" (keep mine on conflicts).
//     A name-only match where both sides have phones or e-mails and
//     none is shared is probably another person with the same name:
//     flagged `nameOnly` and defaulted to "add".
//     Sure duplicates inside the import itself (same name and a
//     shared e-mail or phone) are folded first; `folded` counts them.
//
//   apply(local, inc, prefer, labelIds) → { c, changed }
//     The merged copy of `local`: empty fields filled, missing list
//     rows appended, conflicts kept ("mine") or replaced ("theirs").
//     Nothing is ever removed. The caller sanitizes and stamps mtime.
//
// Incoming shape = the parser shape used by contacts.js:
//   { given, middle, family, nickname, org, jobTitle, phones[{v,type}],
//     emails[], addresses[{street,city,region,zip,country,type}],
//     websites[], im[], events[{day:"MM-DD",year,type,label}],
//     cats["label name"], note, avatar, starred }
// ============================================================
(function (root) {
  "use strict";

  var SCALARS = ["given", "middle", "family", "nickname", "org", "jobTitle", "note"];
  var LISTS = ["phones", "emails", "addresses", "websites", "im", "events"];

  function str(s) { return typeof s === "string" ? s : ""; }
  function fold(s) {
    return str(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/ς/g, "σ").replace(/\s+/g, " ").trim();
  }
  function digits(s) {
    var d = String(s || "").replace(/\D+/g, "");
    return d.indexOf("00") === 0 ? d.slice(2) : d;
  }
  // Same number with or without the country / trunk prefix:
  // "+30 210 123 4567" = "2101234567". Short codes must match exactly.
  function samePhone(a, b) {
    var x = digits(a), y = digits(b);
    if (!x || !y) return false;
    if (x === y) return true;
    var s = x.length < y.length ? x : y, l = s === x ? y : x;
    return s.length >= 8 && l.slice(-s.length) === s;
  }
  function emailKey(e) { return str(e).trim().toLowerCase(); }
  function webKey(w) { return str(w).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, ""); }
  function addrKey(a) { return [fold(a.street), fold(a.city), fold(a.zip)].join("|"); }
  function nameKey(c) { return fold([str(c.given), str(c.family)].filter(Boolean).join(" ")); }

  // One "has this row" test per list.
  var HAS = {
    phones: function (arr, r) { return arr.some(function (x) { return samePhone(x.v, r.v); }); },
    emails: function (arr, r) { return arr.some(function (x) { return emailKey(x.v) === emailKey(r.v); }); },
    addresses: function (arr, r) {
      var k = addrKey(r);
      return arr.some(function (x) { return addrKey(x) === k; });
    },
    websites: function (arr, r) { return arr.some(function (x) { return webKey(x.v) === webKey(r.v); }); },
    im: function (arr, r) { return arr.some(function (x) { return fold(x.v) === fold(r.v); }); },
    events: function (arr, r) {
      return arr.some(function (x) { return x.type === r.type && x.day === r.day; });
    }
  };
  function list(c, f) { return Array.isArray(c && c[f]) ? c[f] : []; }
  function birthday(c) {
    var b = list(c, "events").filter(function (e) { return e.type === "birthday"; });
    return b.length === 1 ? b[0] : null;
  }

  // Fold duplicates inside the import itself (a provider can hold
  // the same person twice): the first one wins on conflicts. This
  // happens before the review, so it only folds sure duplicates: a
  // shared e-mail or phone AND agreeing names, or the same name with
  // no phones / e-mails on one side. Two people who share a landline
  // or a first name stay two contacts.
  function sameEntry(a, b) {
    var by = matchBy(a, b);
    if (!by) return false;
    if (by === "name") return !contradicts(a, b);
    return namesAgree(nameKey(a), nameKey(b));
  }
  // "ann" and "ann lee" agree (one name holds all words of the other);
  // "nikos" and "allos" do not.
  function namesAgree(x, y) {
    if (x === y) return true;
    var a = x.split(" "), b = y.split(" ");
    var s = a.length <= b.length ? a : b, l = s === a ? b : a;
    return s.every(function (w) { return w && l.indexOf(w) !== -1; });
  }
  function collapse(incoming) {
    var out = [];
    (incoming || []).forEach(function (inc) {
      if (!inc || typeof inc !== "object") return;
      var hit = null;
      for (var i = 0; i < out.length && !hit; i++) {
        if (sameEntry(out[i], inc)) hit = out[i];
      }
      if (!hit) { out.push(copy(inc)); return; }
      var m = apply(hit, inc, "mine", null).c;
      m.cats = union(hit.cats, inc.cats);
      m.starred = !!(hit.starred || inc.starred);
      out[out.indexOf(hit)] = m;
    });
    return out;
  }
  function union(a, b) {
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function (x) {
      var k = fold(x);
      if (k && !seen[k]) { seen[k] = 1; out.push(x); }
    });
    return out;
  }
  function copy(c) {
    var o = {};
    Object.keys(c).forEach(function (k) {
      o[k] = Array.isArray(c[k]) ? c[k].map(function (r) {
        return r && typeof r === "object" ? Object.assign({}, r) : r;
      }) : c[k];
    });
    return o;
  }

  // "email" | "phone" | "name" | null
  function matchBy(a, b) {
    var i, j, ae = list(a, "emails"), be = list(b, "emails");
    for (i = 0; i < ae.length; i++) {
      for (j = 0; j < be.length; j++) if (emailKey(ae[i].v) && emailKey(ae[i].v) === emailKey(be[j].v)) return "email";
    }
    var ap = list(a, "phones"), bp = list(b, "phones");
    for (i = 0; i < ap.length; i++) {
      for (j = 0; j < bp.length; j++) if (samePhone(ap[i].v, bp[j].v)) return "phone";
    }
    var an = nameKey(a);
    if (an && an === nameKey(b)) return "name";
    return null;
  }
  // Both sides carry phones or e-mails and none of them is shared.
  function contradicts(a, b) {
    var aIds = list(a, "phones").length + list(a, "emails").length;
    var bIds = list(b, "phones").length + list(b, "emails").length;
    return aIds > 0 && bIds > 0;
  }

  // What `inc` would change on `local`.
  function diff(local, inc, labels) {
    var add = {}, conflicts = [], n = 0;
    SCALARS.forEach(function (f) {
      var mine = str(local[f]).trim(), theirs = str(inc[f]).trim();
      if (!theirs) return;
      if (!mine) { add[f] = 1; n++; return; }
      if (fold(mine) !== fold(theirs)) conflicts.push({ f: f, mine: mine, theirs: theirs });
    });
    var bl = birthday(local), bi = birthday(inc);
    LISTS.forEach(function (f) {
      var have = list(local, f), k = 0;
      list(inc, f).forEach(function (r) {
        if (!r) return;
        if (f === "events" && r.type === "birthday" && bl && bi && r.day !== bl.day) return;
        if (!HAS[f](have, r)) k++;
        else if (f === "events") {
          var same = have.filter(function (x) { return x.type === r.type && x.day === r.day; })[0];
          if (same && same.year == null && r.year != null) k++;
        }
      });
      if (k) { add[f] = k; n += k; }
    });
    if (bl && bi && bl.day !== bi.day) {
      conflicts.push({ f: "birthday", mine: bl.day, theirs: bi.day });
    }
    if (inc.starred && !local.starred) { add.starred = 1; n++; }
    var lblNames = {};
    (labels || []).forEach(function (l) { lblNames[l.id] = fold(l.name); });
    var mineCats = {};
    list(local, "labelIds").forEach(function (id) { if (lblNames[id]) mineCats[lblNames[id]] = 1; });
    var newCats = (inc.cats || []).filter(function (c) { return fold(c) && !mineCats[fold(c)]; });
    if (newCats.length) { add.labels = newCats.length; n += newCats.length; }
    return { add: add, nAdd: n, conflicts: conflicts };
  }

  function plan(local, incoming, labels) {
    local = Array.isArray(local) ? local : [];
    var items = [], counts = { "new": 0, same: 0, diff: 0 };
    var batch = collapse(incoming);
    var folded = (incoming || []).filter(function (x) { return x && typeof x === "object"; }).length - batch.length;
    var claimed = {};
    batch.forEach(function (inc, i) {
      var match = null, by = null, k;
      // e-mail first, then phone, then name — over all local contacts
      ["email", "phone", "name"].some(function (want) {
        for (k = 0; k < local.length; k++) {
          var c = local[k];
          if (!c) continue;
          // A contact an earlier row of this import already matched
          // takes another row only when the names agree (an earlier
          // import may have folded both into it); two people who share
          // a number do not end up as one.
          if (claimed[c.id] && !namesAgree(nameKey(c), nameKey(inc))) continue;
          if (matchHas(c, inc, want)) { match = c; by = want; return true; }
        }
        return false;
      });
      var it = { i: i, inc: inc, kind: "new", match: null, by: null, add: {}, nAdd: 0, conflicts: [], nameOnly: false, act: "add" };
      if (match) {
        var d = diff(match, inc, labels);
        it.match = match.id;
        it.by = by;
        it.add = d.add;
        it.nAdd = d.nAdd;
        it.conflicts = d.conflicts;
        it.kind = (d.nAdd || d.conflicts.length) ? "diff" : "same";
        it.act = it.kind === "same" ? "skip" : "merge";
        if (by === "name" && contradicts(match, inc)) { it.nameOnly = true; it.act = "add"; }
        else claimed[match.id] = 1;
      }
      counts[it.kind]++;
      items.push(it);
    });
    return { items: items, counts: counts, folded: folded };
  }
  // Does `a` match `b` by this one criterion?
  function matchHas(a, b, want) {
    if (want === "email") {
      return list(a, "emails").some(function (x) { return emailKey(x.v) && HAS.emails(list(b, "emails"), x); });
    }
    if (want === "phone") {
      return list(a, "phones").some(function (x) { return HAS.phones(list(b, "phones"), x); });
    }
    var an = nameKey(a);
    return !!an && an === nameKey(b);
  }

  function apply(local, inc, prefer, labelIds) {
    var c = copy(local), changed = false;
    SCALARS.forEach(function (f) {
      var mine = str(c[f]).trim(), theirs = str(inc[f]).trim();
      if (!theirs) return;
      if (!mine || (prefer === "theirs" && fold(mine) !== fold(theirs))) {
        if (c[f] !== theirs) { c[f] = theirs; changed = true; }
      }
    });
    var bl = birthday(c), bi = birthday(inc);
    if (bl && bi && bl.day !== bi.day && prefer === "theirs") {
      c.events = list(c, "events").filter(function (e) { return e !== bl; });
      bl = null;
      changed = true;
    }
    LISTS.forEach(function (f) {
      c[f] = list(c, f).slice();
      list(inc, f).forEach(function (r) {
        if (!r) return;
        if (f === "events" && r.type === "birthday" && bl && r.day !== bl.day) return;
        if (!HAS[f](c[f], r)) { c[f].push(Object.assign({}, r)); changed = true; return; }
        if (f === "events" && r.year != null) {
          c[f] = c[f].map(function (x) {
            if (x.type === r.type && x.day === r.day && x.year == null) { changed = true; return Object.assign({}, x, { year: r.year }); }
            return x;
          });
        }
      });
    });
    if (inc.starred && !c.starred) { c.starred = true; changed = true; }
    if (Array.isArray(labelIds)) {
      c.labelIds = list(c, "labelIds").slice();
      labelIds.forEach(function (id) {
        if (c.labelIds.indexOf(id) === -1) { c.labelIds.push(id); changed = true; }
      });
      c.labelIds.sort();
    }
    return { c: c, changed: changed };
  }

  var api = {
    plan: plan, apply: apply, collapse: collapse, matchBy: matchBy,
    samePhone: samePhone, nameKey: nameKey, fold: fold
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosContactsImport = api;
})(typeof self !== "undefined" ? self : this);
