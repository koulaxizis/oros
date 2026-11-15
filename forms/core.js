// ============================================================
// orOS Forms — data (forms/core.js, window.OrosFormsCore)
// The synced slice "forms" (localStorage oros-forms-data):
//   { ver: 1, forms: [ record | tombstone ] }   sorted by id
//   record    = the form (engine.js normForm) + { m, c, x? }
//               m: last change (ms), c: made (ms),
//               x: the published form (W2, normX): { k, sec, key, priv,
//                  dev, open, close, pubH, rep?, at } — relay name and
//                  secret, link key, RSA private JWK the answers are
//                  sealed for, the device that collects, open 0/1,
//                  closing time (0 = none), fingerprint of what was
//                  published, closed by reports, first published.
//                  These keys only open this form's own answers, so
//                  they travel with the form (like CRM's web form).
//   tombstone = { id, m, del: 1 }
// Merge: per form, newer m wins whole; equal m → the tombstone, else
// the larger canonical JSON (R26: merge(a, a) = a, same order always).
// A form is edited in one place at a time in practice; per-question
// merge is not worth the risk of a half-merged form.
// Answers (W2): the synced slice "forms-answers" (localStorage
// oros-forms-answers), kept apart so the list of forms stays small:
//   { ver: 1, rs: [ answer | tombstone ], seen: { formId: ms } }
//   answer    = { id: "<k>.<relay id>", f: formId, at, a, w?, l? }
//               a: the answers (cleanAnswers), w: on the waiting list,
//               l: the respondent's page language
//   tombstone = { id, f, del: 1 } (a deleted answer never comes back)
//   seen      = when each form's answers were last looked at (max wins)
// Merge: union by id, tombstone wins; per form at most MAX_PER_FORM,
// in all MAX_ANSWERS (the oldest go).
// Pure, Node-tested (tests/forms.test.js, tests/forms-share.test.js).
// ============================================================
(function (root) {
  "use strict";

  var E = (typeof module !== "undefined" && module.exports) ? require("./engine.js") : root.OrosFormsEngine;
  var STORAGE_KEY = "oros-forms-data";
  var DATA_VER = 1;
  var MAX_FORMS = 500;
  var X_MAX = 200000;          // characters of the opaque x object

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function stamp(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }

  function normRecord(r) {
    if (!isObj(r) || typeof r.id !== "string" || !E.ID_RE.test(r.id)) return null;
    var m = stamp(r.m);
    if (r.del) return { id: r.id, m: m, del: 1 };
    var f = E.normForm(r);
    var out = { id: f.id, m: m, c: stamp(r.c) || m, title: f.title };
    if (f.desc) out.desc = f.desc;
    out.qs = f.qs;
    out.set = f.set;
    var x = normX(r.x);
    if (x) out.x = x;
    return out;
  }

  // ---------- the published form (x) ----------
  var K_RE = /^[a-z0-9]{16}$/, SEC_RE = /^[A-Za-z0-9]{32}$/, KEY_RE = /^[A-Za-z0-9_-]{43}$/;
  var B64U = /^[A-Za-z0-9_-]{1,800}$/;
  var DEV_RE = /^[a-z0-9]{6,20}$/;
  function normPriv(p) {
    if (!isObj(p) || p.kty !== "RSA") return null;
    var out = { kty: "RSA", alg: "RSA-OAEP-256" };
    var ok = ["n", "e", "d", "p", "q", "dp", "dq", "qi"].every(function (k) {
      if (typeof p[k] !== "string" || !B64U.test(p[k])) return false;
      out[k] = p[k];
      return true;
    });
    return ok && out.n.length >= 342 && out.n.length <= 344 ? out : null;
  }
  function normX(x) {
    if (!isObj(x) || !K_RE.test(x.k || "") || !SEC_RE.test(x.sec || "") || !KEY_RE.test(x.key || "")) return null;
    var priv = normPriv(x.priv);
    if (!priv) return null;
    var out = { k: x.k, sec: x.sec, key: x.key, priv: priv, open: x.open === 0 ? 0 : 1, close: stamp(x.close),
                pubH: typeof x.pubH === "string" && /^[a-z0-9]{1,16}$/.test(x.pubH) ? x.pubH : "", at: stamp(x.at) };
    if (typeof x.dev === "string" && DEV_RE.test(x.dev)) out.dev = x.dev;
    if (x.rep) out.rep = 1;
    return JSON.stringify(out).length <= X_MAX ? out : null;
  }
  // What the public page shows: a change here means "not published yet".
  function fingerprint(rec) {
    var f = E.normForm(rec || {});
    var s = JSON.stringify({ t: f.title, d: f.desc || "", q: f.qs, s: f.set });
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36) + s.length.toString(36);
  }

  // ---------- answers ----------
  var ANS_KEY = "oros-forms-answers";
  var MAX_PER_FORM = 5000, MAX_ANSWERS = 20000;
  var ANS_ID = /^[a-z0-9]{16}\.[0-9]{1,16}$/;
  var AKEY = /^[a-z0-9]{1,24}(\.o)?$/;
  var A_MAX = 20000;            // characters of one answer's JSON
  function clip(s, n) { return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, n); }
  function cleanValue(v, depth) {
    if (typeof v === "string") return clip(v, E.LIM.para);
    if (typeof v === "number") return isFinite(v) ? v : undefined;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (Array.isArray(v)) {
      var arr = v.slice(0, E.LIM.opts).filter(function (x) { return typeof x === "string"; }).map(function (x) { return clip(x, E.LIM.opt); });
      return arr;
    }
    if (isObj(v) && !depth) {
      var o = {}, n = 0;
      Object.keys(v).sort().forEach(function (k) {
        if (n >= E.LIM.rows || !/^[a-z0-9]{1,24}$/.test(k)) return;
        var c = cleanValue(v[k], 1);
        if (c === undefined || isObj(c)) return;
        o[k] = c; n++;
      });
      return o;
    }
    return undefined;
  }
  // Answers from a stranger's browser → plain values under the form's
  // own keys (strings, numbers, lists of strings, one level of rows).
  function cleanAnswers(a) {
    if (!isObj(a)) return {};
    var out = {}, n = 0;
    Object.keys(a).sort().forEach(function (k) {
      if (n >= E.LIM.items * 2 || !AKEY.test(k)) return;
      var c = cleanValue(a[k], 0);
      if (c === undefined) return;
      out[k] = c; n++;
    });
    return JSON.stringify(out).length <= A_MAX ? out : {};
  }
  function normAnswer(r) {
    if (!isObj(r) || typeof r.id !== "string" || !ANS_ID.test(r.id) || typeof r.f !== "string" || !E.ID_RE.test(r.f)) return null;
    if (r.del) return { id: r.id, f: r.f, del: 1 };
    var at = stamp(r.at);
    if (!at) return null;
    var out = { id: r.id, f: r.f, at: at, a: cleanAnswers(r.a) };
    if (r.w) out.w = 1;
    if (r.l === "en" || r.l === "el" || r.l === "de") out.l = r.l;
    return out;
  }
  function pickAns(a, b) {
    if (a.del || b.del) return a.del ? a : b;
    var ja = JSON.stringify(a), jb = JSON.stringify(b);
    return ja >= jb ? a : b;
  }
  function normAnswers(d) {
    d = isObj(d) ? d : {};
    var byId = {};
    (Array.isArray(d.rs) ? d.rs : []).forEach(function (r) {
      var n = normAnswer(r);
      if (n) byId[n.id] = byId[n.id] ? pickAns(byId[n.id], n) : n;
    });
    var seen = {};
    if (isObj(d.seen)) Object.keys(d.seen).sort().forEach(function (k) { if (E.ID_RE.test(k) && stamp(d.seen[k])) seen[k] = stamp(d.seen[k]); });
    return { ver: DATA_VER, rs: capAnswers(byId), seen: seen };
  }
  function capAnswers(byId) {
    var list = Object.keys(byId).sort().map(function (k) { return byId[k]; });
    var live = list.filter(function (r) { return !r.del; });
    var drop = {}, per = {};
    live.slice().sort(function (a, b) { return b.at - a.at || (a.id < b.id ? 1 : -1); }).forEach(function (r, i) {
      per[r.f] = (per[r.f] || 0) + 1;
      if (per[r.f] > MAX_PER_FORM || i >= MAX_ANSWERS) drop[r.id] = 1;
    });
    return list.filter(function (r) { return !drop[r.id]; });
  }
  function mergeAnswers(a, b) {
    var x = normAnswers(a), y = normAnswers(b), byId = {};
    x.rs.concat(y.rs).forEach(function (r) { byId[r.id] = byId[r.id] ? pickAns(byId[r.id], r) : r; });
    var seen = {};
    [x.seen, y.seen].forEach(function (s) { Object.keys(s).forEach(function (k) { seen[k] = Math.max(seen[k] || 0, s[k]); }); });
    var keys = Object.keys(seen).sort(), sorted = {};
    keys.forEach(function (k) { sorted[k] = seen[k]; });
    return { ver: DATA_VER, rs: capAnswers(byId), seen: sorted };
  }
  // New answers in (rows: [{ id, at, a, w?, l? }] already opened) →
  // { data, added } (R27: nothing new, same data).
  function addAnswers(d, fid, rows) {
    var cur = normAnswers(d), have = {};
    cur.rs.forEach(function (r) { have[r.id] = 1; });
    var add = [];
    (rows || []).forEach(function (r) {
      var n = normAnswer(Object.assign({}, r, { f: fid }));
      if (n && !have[n.id]) { have[n.id] = 1; add.push(n); }
    });
    if (!add.length) return { data: cur, added: 0 };
    var next = normAnswers({ rs: cur.rs.concat(add), seen: cur.seen });
    return { data: next, added: add.length };
  }
  function answersOf(d, fid) {
    return (d && d.rs || []).filter(function (r) { return r.f === fid && !r.del; })
      .sort(function (a, b) { return b.at - a.at || (a.id < b.id ? 1 : -1); });
  }
  function unread(d, fid) {
    var s = (d && d.seen && d.seen[fid]) || 0;
    return answersOf(d, fid).filter(function (r) { return r.at > s; }).length;
  }
  function markSeen(d, fid, now) {
    var cur = normAnswers(d);
    var last = answersOf(cur, fid)[0];
    var at = Math.max(cur.seen[fid] || 0, last ? last.at : 0, 0);
    if (!last || (cur.seen[fid] || 0) >= last.at) return { data: cur, changed: false };
    cur.seen[fid] = at;
    return { data: normAnswers(cur), changed: true };
  }
  // One answer as lines of text for the current form: [{ q, label, text }]
  // (questions without an answer get text ""). words: { yes, no, other(x) }.
  // Values are checked against the question (engine valueOf): a value the
  // form no longer allows (a removed choice, a changed type) is left out.
  function answerLines(form, a, words) {
    var f = E.normForm(form), out = [];
    a = isObj(a) ? a : {};
    f.qs.forEach(function (q) {
      if (!E.ASKS[q.t]) return;
      var v = E.valueOf(q, a[q.id]), text = "";
      var label = function (id) {
        if (id === E.OTHER) return words.other(typeof a[q.id + ".o"] === "string" ? clip(a[q.id + ".o"], E.LIM.other) : "");
        var o = (q.opts || []).filter(function (x) { return x.id === id; })[0];
        return o ? o.label : "";
      };
      if (v === undefined) text = "";
      else if (q.t === "yesno") text = v === "yes" ? words.yes : words.no;
      else if (q.t === "choice" || q.t === "select") text = label(v);
      else if (q.t === "multi") text = v.map(label).filter(Boolean).join(", ");
      else if (q.t === "stars") text = v + " / " + q.hi;
      else if (q.t === "matrix") {
        text = (q.rows || []).map(function (r) {
          var c = v[r.id];
          if (c === undefined) return "";
          var name = function (id) { var col = (q.opts || []).filter(function (x) { return x.id === id; })[0]; return col ? col.label : ""; };
          var vals = Array.isArray(c) ? c.map(name).filter(Boolean).join(", ") : name(c);
          return vals ? (r.label || "") + ": " + vals : "";
        }).filter(Boolean).join("\n");
      } else text = String(v);
      out.push({ q: q.id, label: q.label, text: text });
    });
    return out;
  }

  // A deleted form takes its answers along (the same on every device).
  function dropOrphans(d, forms) {
    var gone = {};
    (forms && forms.forms || []).forEach(function (r) { if (r.del) gone[r.id] = 1; });
    var cur = normAnswers(d);
    var rs = cur.rs.filter(function (r) { return !gone[r.f]; });
    if (rs.length === cur.rs.length) return { data: cur, changed: false };
    var seen = {};
    Object.keys(cur.seen).forEach(function (k) { if (!gone[k]) seen[k] = cur.seen[k]; });
    return { data: { ver: DATA_VER, rs: rs, seen: seen }, changed: true };
  }

  function normalize(d) {
    d = isObj(d) ? d : {};
    var byId = {};
    (Array.isArray(d.forms) ? d.forms : []).forEach(function (r) {
      var n = normRecord(r);
      if (!n) return;
      byId[n.id] = byId[n.id] ? pick(byId[n.id], n) : n;
    });
    return { ver: DATA_VER, forms: sorted(byId) };
  }

  function sorted(byId) {
    var list = Object.keys(byId).sort().map(function (k) { return byId[k]; });
    // Over the cap, the oldest live forms go (tombstones are tiny and stay).
    var live = list.filter(function (r) { return !r.del; });
    if (live.length > MAX_FORMS) {
      var drop = {};
      live.slice().sort(function (a, b) { return a.m - b.m || (a.id < b.id ? -1 : 1); })
        .slice(0, live.length - MAX_FORMS).forEach(function (r) { drop[r.id] = 1; });
      list = list.filter(function (r) { return !drop[r.id]; });
    }
    return list;
  }

  function pick(a, b) {
    if (a.m !== b.m) return a.m > b.m ? a : b;
    if (a.del || b.del) return a.del ? a : b;
    var ja = JSON.stringify(a), jb = JSON.stringify(b);
    return ja >= jb ? a : b;
  }

  function merge(a, b) {
    var x = normalize(a), y = normalize(b), byId = {};
    x.forms.concat(y.forms).forEach(function (r) { byId[r.id] = byId[r.id] ? pick(byId[r.id], r) : r; });
    return { ver: DATA_VER, forms: sorted(byId) };
  }

  function live(d) { return (d && d.forms || []).filter(function (r) { return !r.del; }); }
  function find(d, id) {
    var list = d && d.forms || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // Put a changed form in (new m only when something really changed, R27).
  function put(d, rec, now) {
    var old = find(d, rec.id);
    var next = normRecord(Object.assign({}, rec, { m: old ? old.m : 0, c: old ? old.c : now }));
    if (old && !old.del && JSON.stringify(old) === JSON.stringify(next)) return { data: d, changed: false };
    next.m = Math.max(now, old ? old.m + 1 : 0);
    if (!old || old.del) next.c = now;
    var forms = (d.forms || []).filter(function (r) { return r.id !== rec.id; }).concat([next]);
    return { data: normalize({ forms: forms }), changed: true, rec: next };
  }

  function remove(d, id, now) {
    var old = find(d, id);
    if (!old || old.del) return { data: d, changed: false };
    var forms = d.forms.filter(function (r) { return r.id !== id; })
      .concat([{ id: id, m: Math.max(now, old.m + 1), del: 1 }]);
    return { data: normalize({ forms: forms }), changed: true, old: old };
  }

  // Undo of a delete: the old form comes back with a newer stamp.
  function restore(d, rec, now) {
    var cur = find(d, rec.id);
    var r = Object.assign({}, rec, { m: Math.max(now, cur ? cur.m + 1 : 0) });
    var forms = (d.forms || []).filter(function (x) { return x.id !== rec.id; }).concat([r]);
    return normalize({ forms: forms });
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, DATA_VER: DATA_VER, MAX_FORMS: MAX_FORMS,
    normRecord: normRecord, normalize: normalize, merge: merge,
    live: live, find: find, put: put, remove: remove, restore: restore,
    normX: normX, fingerprint: fingerprint,
    ANS_KEY: ANS_KEY, MAX_PER_FORM: MAX_PER_FORM, MAX_ANSWERS: MAX_ANSWERS,
    cleanAnswers: cleanAnswers, normAnswers: normAnswers, mergeAnswers: mergeAnswers, addAnswers: addAnswers,
    answersOf: answersOf, unread: unread, markSeen: markSeen, dropOrphans: dropOrphans, answerLines: answerLines
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosFormsCore = api;
})(typeof window !== "undefined" ? window : this);
