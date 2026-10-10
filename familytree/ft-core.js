// ============================================================
// orOS Family Tree — core (v1.0.0)
// Everything that does not need a DOM, so the browser app and
// `node --test` run the very same code:
//   1. Constants + small helpers
//   2. Dates (partial genealogy dates: YYYY, YYYY-MM, YYYY-MM-DD)
//   3. Entity normalizers (allow-list builders, never copies)
//   4. Merge (sync slice "familytree": LWW per entity + tombstones)
//   5. Index + relationship helpers (cycle guard)
//   6. JSON export / strict JSON import
//   7. Layout (hourglass around a focus person)
//   8. Scene + SVG serializer (export) — no user text is ever markup
//   9. Contacts bridge (read-only: plan + build from relations)
//  10. GEDCOM import (5.5.1 / 7.0, into a new tree) / export (5.5.1)
//  11. Calendar feed (death anniversaries; read by calendar.js)
// Data FAMTREE v1 (oros-familytree-data):
//   { ver: 1,
//     trees:  [{ id, m, name, home }],
//     people: [{ id, m, tree, given, family, birthName, sex,
//                birth{d,q,place}, death{d,q,place}, dead, note,
//                photo, contact, parents[{u, kind}] }],
//     unions: [{ id, m, tree, a, b, kind, start{d,q}, end{d,q} }],
//     tombs:  { id: deletedAt } }
// Parents live on the CHILD (`parents[].u` = a union id), so two
// devices adding a child to the same couple never collide (LWW on
// a children list would drop one of them).
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants + helpers ----------
  var VER        = 1;
  var FORMAT     = 1;
  var NAME_LEN   = 80;
  var PLACE_LEN  = 120;
  var TREE_LEN   = 60;
  var NOTE_LEN   = 2000;
  var PHOTO_MAX  = 28000;          // chars of the data URI (~20 KB)
  var PHOTO_BUDGET = 1400000;      // all photos together (~1 MB)
  var MAX_TREES  = 200;
  var MAX_PEOPLE = 20000;
  var MAX_UNIONS = 20000;
  var MAX_PARENTS = 4;
  var IMPORT_MAX = 5 * 1024 * 1024;
  var MAX_TS     = 8640000000000000;

  var SEXES        = ["f", "m", "x", "u"];
  var QUALS        = ["", "abt", "bef", "aft"];
  var PARENT_KINDS = ["birth", "adopted", "foster", "step"];
  var UNION_KINDS  = ["married", "partner", "divorced", "unknown"];

  // First character alphanumeric: "__proto__" can never be an id.
  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
  // C0/C1 controls, line/paragraph separators, bidi overrides.
  var CTRL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
  var PHOTO_RE = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+\/]+={0,2}$/;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function isTs(v) { return isInt(v) && v >= 0 && v <= MAX_TS; }
  function isId(v) { return typeof v === "string" && ID_RE.test(v); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function dict() { return Object.create(null); }
  function inList(list, v) { return list.indexOf(v) !== -1; }

  // One-line text: controls out, spaces collapsed, trimmed, capped.
  function line(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(CTRL_RE, "").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  // Multi-line text (notes): keeps \n, drops the other controls.
  function para(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/\r\n?/g, "\n").replace(CTRL_RE, "").replace(/\t/g, " ")
            .replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
  }
  function validPhoto(s) {
    return typeof s === "string" && s.length <= PHOTO_MAX && PHOTO_RE.test(s);
  }

  // ---------- 2. Dates ----------
  // d: "" | "YYYY" | "YYYY-MM" | "YYYY-MM-DD" (year 1–2200, real day)
  // q: "" | "abt" | "bef" | "aft" (meaningless without d)
  function daysIn(y, mo) { return [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]; }
  function leap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function validD(d) {
    if (typeof d !== "string") return false;
    var m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(d);
    if (!m) return false;
    var y = +m[1];
    if (y < 1 || y > 2200) return false;
    if (m[2] === undefined) return true;
    var mo = +m[2];
    if (mo < 1 || mo > 12) return false;
    if (m[3] === undefined) return true;
    var day = +m[3];
    return day >= 1 && day <= daysIn(y, mo);
  }
  function normDate(x) {
    var d = x && typeof x === "object" && validD(x.d) ? x.d : "";
    var q = d && x && inList(QUALS, x.q) ? x.q : "";
    return { d: d, q: q };
  }
  function normEvent(x) {
    var o = normDate(x);
    o.place = line(x && typeof x === "object" ? x.place : "", PLACE_LEN);
    return o;
  }
  // Typed input → d, or null when it is not a date. Accepts
  // "1890", "3/1890", "15/3/1890", "15.03.1890", "1890-03-15".
  function parseDateInput(s) {
    s = line(s, 20);
    if (!s) return "";
    var m, d = null;
    if ((m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(s))) {
      d = m[1] + (m[2] ? "-" + pad2(m[2]) + (m[3] ? "-" + pad2(m[3]) : "") : "");
    } else if ((m = /^(\d{1,2})[\/.\-](\d{4})$/.exec(s))) {
      d = m[2] + "-" + pad2(m[1]);
    } else if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s))) {
      d = m[3] + "-" + pad2(m[2]) + "-" + pad2(m[1]);
    }
    return d && validD(d) ? d : null;
  }
  function pad2(v) { v = String(+v); return v.length < 2 ? "0" + v : v; }
  // d → "dd/mm/yyyy" | "mm/yyyy" | "yyyy" (both languages, R: Greek dates)
  function fmtD(d) {
    if (!validD(d)) return "";
    var p = d.split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : (p.length === 2 ? p[1] + "/" + p[0] : p[0]);
  }
  var QWORD = {
    en: { abt: "c. ", bef: "before ", aft: "after " },
    el: { abt: "περ. ", bef: "πριν ", aft: "μετά " }
  };
  function fmtDate(x, lang) {
    if (!x || !validD(x.d)) return "";
    var w = (QWORD[lang] || QWORD.en)[x.q] || "";
    return w + fmtD(x.d);
  }
  function yearOf(x, lang) {
    if (!x || !validD(x.d)) return "";
    var y = String(+x.d.slice(0, 4));
    if (x.q === "abt") return (lang === "el" ? "περ." : "c.") + y;
    if (x.q === "bef") return "<" + y;
    if (x.q === "aft") return ">" + y;
    return y;
  }
  // "1920–1995", "b. 1990", "d. 1995", "†", ""
  function lifeSpan(p, lang) {
    var b = yearOf(p.birth, lang), d = yearOf(p.death, lang);
    if (p.dead) {
      if (b || d) return (b || "?") + "–" + (d || "?");
      return "†";
    }
    return b ? (lang === "el" ? "γ. " : "b. ") + b : "";
  }

  // ---------- 3. Normalizers ----------
  // Each builds a FRESH object from known fields only. Fixed key
  // order = canonical bytes (R26). null = drop the row.
  function normTree(x) {
    if (!x || typeof x !== "object" || !isId(x.id) || !isTs(x.m)) return null;
    var name = line(x.name, TREE_LEN);
    if (!name) return null;
    return { id: x.id, m: x.m, name: name, home: isId(x.home) ? x.home : "" };
  }

  function normParents(list) {
    var out = [], seen = dict();
    (Array.isArray(list) ? list : []).forEach(function (r) {
      if (out.length >= MAX_PARENTS || !r || typeof r !== "object" || !isId(r.u) || own(seen, r.u)) return;
      seen[r.u] = 1;
      out.push({ u: r.u, kind: inList(PARENT_KINDS, r.kind) ? r.kind : "birth" });
    });
    return out;
  }

  function normPerson(x) {
    if (!x || typeof x !== "object" || !isId(x.id) || !isTs(x.m) || !isId(x.tree)) return null;
    var death = normEvent(x.death);
    return {
      id: x.id,
      m: x.m,
      tree: x.tree,
      given: line(x.given, NAME_LEN),
      family: line(x.family, NAME_LEN),
      birthName: line(x.birthName, NAME_LEN),
      sex: inList(SEXES, x.sex) ? x.sex : "u",
      birth: normEvent(x.birth),
      death: death,
      dead: x.dead === true || !!death.d || !!death.place,
      note: para(x.note, NOTE_LEN),
      photo: validPhoto(x.photo) ? x.photo : "",
      contact: isId(x.contact) ? x.contact : "",
      parents: normParents(x.parents)
    };
  }

  function normUnion(x) {
    if (!x || typeof x !== "object" || !isId(x.id) || !isTs(x.m) || !isId(x.tree)) return null;
    var a = isId(x.a) ? x.a : "", b = isId(x.b) ? x.b : "";
    if (a && a === b) b = "";
    if (!a && b) { a = b; b = ""; }
    return {
      id: x.id,
      m: x.m,
      tree: x.tree,
      a: a,
      b: b,
      kind: inList(UNION_KINDS, x.kind) ? x.kind : "unknown",
      start: normDate(x.start),
      end: normDate(x.end)
    };
  }

  function normTombs(t, into) {
    if (!t || typeof t !== "object" || Array.isArray(t)) return into;
    Object.keys(t).forEach(function (id) {
      if (!isId(id) || !isTs(t[id])) return;
      if (!own(into, id) || t[id] > into[id]) into[id] = t[id];
    });
    return into;
  }

  function emptyData() { return { ver: VER, trees: [], people: [], unions: [], tombs: {} }; }

  // ---------- 4. Merge ----------
  // LWW per entity (newer m wins; equal m: the larger canonical
  // JSON), tombstones max-merged, delete wins ties, a newer edit
  // resurrects (R17). People and unions whose tree is gone are
  // left out: a pure function of the merged trees, so every device
  // computes the same. Symmetric + idempotent + canonical (R5, R26).
  function lww(lists, norm) {
    var best = dict();
    lists.forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = norm(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur || x.m > cur.m || (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
      });
    });
    return best;
  }
  function alive(best, tombs) {
    var out = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (own(tombs, id) && tombs[id] >= best[id].m) return;
      out.push(best[id]);
    });
    return out;
  }
  function merge(A, B) {
    var a = A && typeof A === "object" ? A : {}, b = B && typeof B === "object" ? B : {};
    var tombs = normTombs(b.tombs, normTombs(a.tombs, dict()));
    var trees = alive(lww([a.trees, b.trees], normTree), tombs);
    var live = dict();
    trees.forEach(function (t) { live[t.id] = 1; });
    var inTree = function (x) { return own(live, x.tree); };
    var people = alive(lww([a.people, b.people], normPerson), tombs).filter(inTree);
    var unions = alive(lww([a.unions, b.unions], normUnion), tombs).filter(inTree);
    var sorted = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sorted[id] = tombs[id]; });
    return { ver: VER, trees: trees, people: people, unions: unions, tombs: sorted };
  }

  // ---------- 5. Index + relationships ----------
  function birthKey(p) { return (p.birth && p.birth.d) || "9999"; }
  function index(data, treeId) {
    var ix = { P: dict(), U: dict(), unionsOf: dict(), kids: dict() };
    (data.people || []).forEach(function (p) { if (!treeId || p.tree === treeId) ix.P[p.id] = p; });
    (data.unions || []).forEach(function (u) { if (!treeId || u.tree === treeId) ix.U[u.id] = u; });
    Object.keys(ix.U).forEach(function (id) {
      var u = ix.U[id];
      [u.a, u.b].forEach(function (pid) {
        if (pid && own(ix.P, pid)) (ix.unionsOf[pid] = ix.unionsOf[pid] || []).push(u);
      });
    });
    Object.keys(ix.P).forEach(function (pid) {
      ix.P[pid].parents.forEach(function (r) {
        if (own(ix.U, r.u)) (ix.kids[r.u] = ix.kids[r.u] || []).push(ix.P[pid]);
      });
    });
    var byStart = function (x, y) { return cmpStr(x.start.d || "9999", y.start.d || "9999") || cmpStr(x.id, y.id); };
    var byBirth = function (x, y) { return cmpStr(birthKey(x), birthKey(y)) || cmpStr(x.id, y.id); };
    Object.keys(ix.unionsOf).forEach(function (k) { ix.unionsOf[k].sort(byStart); });
    Object.keys(ix.kids).forEach(function (k) { ix.kids[k].sort(byBirth); });
    return ix;
  }
  // The family a person is drawn under: birth first, then the order
  // of the links. null when none of the links resolves.
  function primaryUnion(ix, pid) {
    var p = ix.P[pid];
    if (!p) return null;
    var best = null;
    p.parents.forEach(function (r) {
      if (!own(ix.U, r.u)) return;
      if (!best || (r.kind === "birth" && best.kind !== "birth")) best = r;
    });
    return best ? ix.U[best.u] : null;
  }
  // Would linking `childId` under union `uid` make someone their own
  // ancestor? Walks up from the union's partners.
  function wouldCycle(ix, childId, uid) {
    var u = ix.U[uid];
    if (!u) return false;
    if (u.a === childId || u.b === childId) return true;
    var stack = [u.a, u.b], seen = dict();
    while (stack.length) {
      var pid = stack.pop();
      if (!pid || own(seen, pid)) continue;
      if (pid === childId) return true;
      seen[pid] = 1;
      var p = ix.P[pid];
      if (!p) continue;
      p.parents.forEach(function (r) {
        var pu = ix.U[r.u];
        if (pu) { stack.push(pu.a); stack.push(pu.b); }
      });
    }
    return false;
  }
  function soloUnion(ix, pid) {
    var list = ix.unionsOf[pid] || [];
    for (var i = 0; i < list.length; i++) if (!list[i].b || !own(ix.P, list[i].b)) {
      if (list[i].a === pid || !own(ix.P, list[i].a)) return list[i];
    }
    return null;
  }
  function findUnion(ix, a, b) {
    var list = ix.unionsOf[a] || [];
    for (var i = 0; i < list.length; i++) {
      var u = list[i];
      if ((u.a === a && u.b === b) || (u.a === b && u.b === a)) return u;
    }
    return null;
  }
  function partnerOf(u, pid) { return u.a === pid ? u.b : (u.b === pid ? u.a : ""); }
  function displayName(p, fallback) {
    if (!p) return fallback || "?";
    var n = (p.given + " " + p.family).trim();
    return n || fallback || "?";
  }
  function photoBytes(data) {
    var n = 0;
    (data.people || []).forEach(function (p) { n += p.photo ? p.photo.length : 0; });
    return n;
  }

  // ---------- 6. JSON export / import ----------
  function exportData(data, treeId, nowIso) {
    var d = merge(data, data);
    var out = { app: "familytree", format: FORMAT, exported: String(nowIso || "") };
    if (treeId) {
      out.trees = d.trees.filter(function (t) { return t.id === treeId; });
      out.people = d.people.filter(function (p) { return p.tree === treeId; });
      out.unions = d.unions.filter(function (u) { return u.tree === treeId; });
      out.tombs = {};
    } else {
      out.trees = d.trees; out.people = d.people; out.unions = d.unions; out.tombs = d.tombs;
    }
    return JSON.stringify(out, null, 1);
  }

  // Strict import. `text` is the raw file; `local` the data already
  // on this device (references may point into it). Returns
  //   { ok: false, err: "size" | "json" | "format" | "toolarge" }
  //   { ok: true, data, stats: { trees, people, unions, dropped, refs, cycles } }
  // Nothing in the file is ever evaluated: JSON.parse, then fresh
  // objects built from known fields only. Invalid rows are dropped
  // and counted, never guessed.
  function parseImport(text, local) {
    if (typeof text !== "string") return { ok: false, err: "format" };
    if (text.length > IMPORT_MAX) return { ok: false, err: "size" };
    var raw;
    try { raw = JSON.parse(text); } catch (e) { return { ok: false, err: "json" }; }
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.app !== "familytree" ||
        raw.format !== FORMAT || !Array.isArray(raw.trees) || !Array.isArray(raw.people) ||
        !Array.isArray(raw.unions)) return { ok: false, err: "format" };
    if (raw.trees.length > MAX_TREES || raw.people.length > MAX_PEOPLE || raw.unions.length > MAX_UNIONS) {
      return { ok: false, err: "toolarge" };
    }
    var st = { trees: 0, people: 0, unions: 0, dropped: 0, refs: 0, cycles: 0 };
    function keep(list, norm) {
      var out = [];
      list.forEach(function (r) { var x = norm(r); if (x) out.push(x); else st.dropped++; });
      return out;
    }
    var tombs = {};
    normTombs(raw.tombs, tombs);
    return checkRows(keep(raw.trees, normTree), keep(raw.people, normPerson), keep(raw.unions, normUnion),
                     tombs, local, st);
  }
  // The checks every import shares (JSON and GEDCOM): rows already
  // normalized; broken references and loops are cut and counted.
  function checkRows(fileTrees, filePeople, fileUnions, tombs, local, st) {
    var loc = local && typeof local === "object" ? merge(local, local) : emptyData();

    // Trees known after the import (file + this device).
    var treeOk = dict();
    loc.trees.concat(fileTrees).forEach(function (t) { treeOk[t.id] = 1; });
    filePeople = filePeople.filter(function (p) { if (own(treeOk, p.tree)) return true; st.dropped++; return false; });
    fileUnions = fileUnions.filter(function (u) { if (own(treeOk, u.tree)) return true; st.dropped++; return false; });

    // Combined view: the file's rows over the local ones (by id).
    var P = dict(), U = dict();
    loc.people.forEach(function (p) { P[p.id] = p; });
    filePeople.forEach(function (p) { P[p.id] = p; });
    loc.unions.forEach(function (u) { U[u.id] = u; });
    fileUnions.forEach(function (u) { U[u.id] = u; });

    // Union partners must be people of the same tree.
    fileUnions.forEach(function (u) {
      ["a", "b"].forEach(function (k) {
        if (u[k] && (!own(P, u[k]) || P[u[k]].tree !== u.tree)) { u[k] = ""; st.refs++; }
      });
      if (!u.a && u.b) { u.a = u.b; u.b = ""; }
    });
    // Parent links must name a union of the same tree, not one the
    // child is a partner in.
    filePeople.forEach(function (p) {
      p.parents = p.parents.filter(function (r) {
        var u = U[r.u];
        if (u && u.tree === p.tree && u.a !== p.id && u.b !== p.id) return true;
        st.refs++;
        return false;
      });
    });
    // Cycles: accept links one by one (people in id order) against
    // the links accepted so far; the link that would close a loop
    // is dropped.
    var ix = { P: dict(), U: U, unionsOf: dict(), kids: dict() };
    var fileIds = dict();
    filePeople.forEach(function (p) { fileIds[p.id] = 1; });
    Object.keys(P).forEach(function (id) {
      var p = P[id];
      ix.P[id] = own(fileIds, id) ? { id: id, parents: [] } : p;
    });
    filePeople.slice().sort(function (x, y) { return cmpStr(x.id, y.id); }).forEach(function (p) {
      var acc = [];
      p.parents.forEach(function (r) {
        ix.P[p.id] = { id: p.id, parents: acc };
        if (wouldCycle(ix, p.id, r.u)) { st.cycles++; return; }
        acc.push(r);
      });
      p.parents = acc;
      ix.P[p.id] = { id: p.id, parents: acc };
    });

    // Local trees the file's rows belong to ride along (same rows as
    // on this device, so merging them back changes nothing).
    var used = dict(), fileTreeIds = dict();
    fileTrees.forEach(function (t) { fileTreeIds[t.id] = 1; });
    filePeople.concat(fileUnions).forEach(function (x) { used[x.tree] = 1; });
    var hostTrees = loc.trees.filter(function (t) { return own(used, t.id) && !own(fileTreeIds, t.id); });
    var data = merge({ trees: fileTrees.concat(hostTrees), people: filePeople, unions: fileUnions, tombs: tombs }, {});
    st.trees = data.trees.length - hostTrees.length;
    st.people = data.people.length;
    st.unions = data.unions.length;
    return { ok: true, data: data, stats: st };
  }

  // ---------- 7. Layout ----------
  // Cards on a grid of rows; rows < 0 are ancestors, 0 the focus
  // person (with partners and siblings), > 0 descendants. Each part
  // packs subtrees side by side, so cards never overlap. A person
  // met a second time (cousin marriage, loops from two devices) is
  // drawn once more as a dashed "see there" card and not expanded.
  var CW = 168, CH = 72, HG = 24, PG = 32, VG = 64, MARGIN = 24;

  function layout(data, treeId, focusId, opts) {
    opts = opts || {};
    var up = isInt(opts.up) ? Math.max(0, Math.min(10, opts.up)) : 3;
    var down = isInt(opts.down) ? Math.max(0, Math.min(10, opts.down)) : 3;
    var sibs = opts.siblings !== false;
    var ix = index(data, treeId);
    var out = { nodes: [], links: [], w: 0, h: 0, focus: focusId };
    if (!own(ix.P, focusId)) return out;
    var seen = dict();
    seen[focusId] = 1;
    var rowY = function (r) { return r * (CH + VG); };
    function card(pid, x, row, dup) {
      out.nodes.push({ pid: pid, x: x, y: rowY(row), dup: !!dup, focus: pid === focusId && !dup });
    }
    function link(cls, segs) { out.links.push({ cls: cls, segs: segs }); }

    // --- ancestors (measured first: they get the solid cards) ---
    function mAnc(pid, depth) {
      var n = { pid: pid, w: CW, par: [], u: null, dup: false };
      if (depth <= 0) return n;
      var u = primaryUnion(ix, pid);
      if (!u) return n;
      n.u = u;
      [u.a, u.b].forEach(function (pp) {
        if (!pp || !own(ix.P, pp)) return;
        if (own(seen, pp)) { n.par.push({ pid: pp, w: CW, par: [], u: null, dup: true }); return; }
        seen[pp] = 1;
        n.par.push(mAnc(pp, depth - 1));
      });
      n.w = Math.max(CW, parW(n));
      return n;
    }
    function parW(n) {
      var w = 0;
      n.par.forEach(function (p, i) { w += p.w + (i ? PG : 0); });
      return w;
    }
    // Places n's parents in row-1, centred over `cx`; the child's
    // link ends at `ends` (x centres of the cards it drops onto).
    function placeAnc(n, cx, row, ends) {
      if (!n.par.length) return;
      var w = parW(n), s = cx - w / 2, xs = [];
      n.par.forEach(function (p) {
        var x = s + (p.w - CW) / 2;
        xs.push(x);
        card(p.pid, x, row - 1, p.dup);
        if (!p.dup) placeAnc(p, x + CW / 2, row - 1, [x + CW / 2]);
        s += p.w + PG;
      });
      var y = rowY(row - 1) + CH / 2, ax, ay;
      if (xs.length === 2) {
        link(n.u.kind === "divorced" ? "ft-div" : "ft-couple", [[xs[0] + CW, y, xs[1], y]]);
        ax = (xs[0] + CW + xs[1]) / 2; ay = y;
      } else {
        ax = xs[0] + CW / 2; ay = rowY(row - 1) + CH;
      }
      drop(ax, ay, rowY(row) - VG / 2, ends, rowY(row));
    }
    // Anchor → bus → each card top.
    function drop(ax, ay, busY, ends, topY) {
      var lo = ax, hi = ax, segs = [[ax, ay, ax, busY]];
      ends.forEach(function (x) { lo = Math.min(lo, x); hi = Math.max(hi, x); segs.push([x, busY, x, topY]); });
      if (hi > lo) segs.push([lo, busY, hi, busY]);
      link("ft-link", segs);
    }

    // --- descendants ---
    function mDesc(pid, depth, isRoot) {
      var n = { pid: pid, w: CW, partners: [], groups: [], dup: false, cw: CW };
      if (!isRoot) {
        if (own(seen, pid)) { n.dup = true; return n; }
        seen[pid] = 1;
      }
      var us = ix.unionsOf[pid] || [];
      us.forEach(function (u) {
        var po = partnerOf(u, pid);
        if (!po || !own(ix.P, po)) return;
        var k = n.partners.length;
        var slot = { pid: po, u: u, dup: own(seen, po), side: k % 2 === 0 ? 1 : -1, idx: Math.floor(k / 2) };
        seen[po] = 1;
        n.partners.push(slot);
      });
      us.forEach(function (u) {
        var po = partnerOf(u, pid), slot = null;
        n.partners.forEach(function (s) { if (s.u === u) slot = s; });
        if (po && !slot) po = "";
        var g = { u: u, partner: slot, kids: [] };
        if (depth > 0) (ix.kids[u.id] || []).forEach(function (c) { g.kids.push(mDesc(c.id, depth - 1, false)); });
        n.groups.push(g);
      });
      var gkey = function (g) { return g.partner ? g.partner.side * (g.partner.idx + 1) : 0; };
      n.groups.sort(function (x, y) { return gkey(x) - gkey(y) || cmpStr(x.u.id, y.u.id); });
      var cards = 1 + n.partners.length;
      n.cw = cards * CW + (cards - 1) * PG;
      n.kw = 0;
      var nk = 0;
      n.groups.forEach(function (g) { g.kids.forEach(function (k) { n.kw += k.w + (nk++ ? HG : 0); }); });
      n.w = Math.max(n.cw, n.kw);
      return n;
    }
    // Returns the x of n's own card.
    function placeDesc(n, x0, row) {
      var left = n.partners.filter(function (s) { return s.side < 0; }).sort(function (a, b) { return b.idx - a.idx; });
      var right = n.partners.filter(function (s) { return s.side > 0; }).sort(function (a, b) { return a.idx - b.idx; });
      var x = x0 + (n.w - n.cw) / 2, px = 0, y = rowY(row) + CH / 2;
      left.forEach(function (s) { s.x = x; x += CW + PG; });
      px = x; x += CW + PG;
      right.forEach(function (s) { s.x = x; x += CW + PG; });
      card(n.pid, px, row, n.dup);
      if (n.dup) return px;
      n.partners.forEach(function (s) {
        card(s.pid, s.x, row, s.dup);
        var inner = s.side > 0 ? s.x - PG : s.x + CW;
        link(s.u.kind === "divorced" ? "ft-div" : "ft-couple", [[inner, y, inner + PG, y]]);
      });
      var kx = x0 + (n.w - n.kw) / 2;
      n.groups.forEach(function (g, gi) {
        if (!g.kids.length) return;
        var ends = [];
        g.kids.forEach(function (k) {
          var cx = placeDesc(k, kx, row + 1);
          ends.push(cx + CW / 2);
          kx += k.w + HG;
        });
        var ax, ay;
        if (g.partner) {
          ax = g.partner.side > 0 ? g.partner.x - PG / 2 : g.partner.x + CW + PG / 2;
          ay = y;
        } else { ax = px + CW / 2; ay = rowY(row) + CH; }
        drop(ax, ay, rowY(row + 1) - VG / 2 + Math.min(gi, 3) * 6, ends, rowY(row + 1));
      });
      return px;
    }

    var anc = mAnc(focusId, up);
    var sibList = [];
    if (sibs && anc.u) {
      (ix.kids[anc.u.id] || []).forEach(function (c) {
        if (c.id === focusId) return;
        sibList.push({ pid: c.id, dup: own(seen, c.id) });
        seen[c.id] = 1;
      });
    }
    var desc = mDesc(focusId, down, true);
    var fx = placeDesc(desc, 0, 0);
    // Siblings: left of everything in row 0, birth order, nearest last.
    var rowLeft = fx;
    desc.partners.forEach(function (s) { if (s.x < rowLeft) rowLeft = s.x; });
    var ends = [fx + CW / 2];
    for (var i = sibList.length - 1, sx = rowLeft - HG - CW; i >= 0; i--, sx -= CW + HG) {
      card(sibList[i].pid, sx, 0, sibList[i].dup);
      ends.push(sx + CW / 2);
    }
    if (anc.par.length) {
      var lo = Math.min.apply(null, ends), hi = Math.max.apply(null, ends);
      placeAnc(anc, (lo + hi) / 2, 0, ends);
    } else if (anc.u && ends.length > 1) {
      // Siblings with no known parent: a bar over them.
      var l2 = Math.min.apply(null, ends), h2 = Math.max.apply(null, ends), by = -VG / 2;
      var segs = [[l2, by, h2, by]];
      ends.forEach(function (x) { segs.push([x, by, x, 0]); });
      link("ft-link", segs);
    }

    // Normalize to positive coordinates with a margin.
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    out.nodes.forEach(function (c) {
      minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + CW); maxY = Math.max(maxY, c.y + CH);
    });
    out.links.forEach(function (l) {
      l.segs.forEach(function (s) {
        minY = Math.min(minY, s[1], s[3]); maxY = Math.max(maxY, s[1], s[3]);
      });
    });
    var dx = MARGIN - minX, dy = MARGIN - minY;
    var r1 = function (v) { return Math.round(v * 10) / 10; };
    out.nodes.forEach(function (c) { c.x = r1(c.x + dx); c.y = r1(c.y + dy); });
    out.links.forEach(function (l) {
      l.segs = l.segs.map(function (s) { return [r1(s[0] + dx), r1(s[1] + dy), r1(s[2] + dx), r1(s[3] + dy)]; });
    });
    out.w = Math.ceil(maxX - minX + 2 * MARGIN);
    out.h = Math.ceil(maxY - minY + 2 * MARGIN);
    return out;
  }

  // ---------- 8. Scene + SVG ----------
  // A scene is plain data: { w, h, items: [{ tag, cls, a: {attrs}, text?, kids? }] }.
  // The app renders it with createElementNS + textContent; the
  // exporter serializes it with XML escaping. Tags and attribute
  // names come from this file only; user text only ever lands in
  // `text` (and a validated photo data URI in `href`).
  var TAGS = { g: 1, rect: 1, path: 1, text: 1, image: 1, title: 1, clipPath: 1 };
  var ATTRS = { x: 1, y: 1, width: 1, height: 1, rx: 1, d: 1, href: 1, id: 1, "clip-path": 1,
                "data-pid": 1, "text-anchor": 1, preserveAspectRatio: 1 };

  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function pathD(segs) {
    return segs.map(function (s) { return "M" + s[0] + " " + s[1] + "L" + s[2] + " " + s[3]; }).join("");
  }

  // opts: { lang, hideLiving, photos, dates, unknown }
  function scene(lay, data, treeId, opts) {
    opts = opts || {};
    var lang = opts.lang === "el" ? "el" : "en";
    var ix = index(data, treeId);
    var items = [];
    lay.links.forEach(function (l) { items.push({ tag: "path", cls: l.cls, a: { d: pathD(l.segs) } }); });
    lay.nodes.forEach(function (n, i) {
      var p = ix.P[n.pid];
      if (!p) return;
      var hide = opts.hideLiving && !p.dead;
      var cls = "ft-card ft-sex-" + p.sex + (n.focus ? " ft-focus" : "") + (n.dup ? " ft-dup" : "");
      var kids = [
        { tag: "rect", cls: "ft-box", a: { x: n.x, y: n.y, width: CW, height: CH, rx: 10 } },
        { tag: "rect", cls: "ft-stripe", a: { x: n.x, y: n.y + 8, width: 5, height: CH - 16, rx: 2.5 } }
      ];
      var tx = n.x + 14, maxc = 19;
      if (opts.photos && p.photo && !hide) {
        var cid = "ftc" + i;
        kids.push({ tag: "clipPath", a: { id: cid }, kids: [{ tag: "rect", a: { x: n.x + 12, y: n.y + 14, width: 44, height: 44, rx: 22 } }] });
        kids.push({ tag: "image", a: { x: n.x + 12, y: n.y + 14, width: 44, height: 44, href: p.photo,
                                       preserveAspectRatio: "xMidYMid slice", "clip-path": "url(#" + cid + ")" } });
        tx = n.x + 64; maxc = 13;
      }
      var given = p.given || (p.family ? "" : (opts.unknown || "?"));
      var fam = [p.family, p.birthName && !hide ? "(" + p.birthName + ")" : ""].filter(Boolean).join(" ");
      kids.push({ tag: "text", cls: "ft-t1", a: { x: tx, y: n.y + 25 }, text: trunc(given || fam, maxc) });
      if (given && fam) kids.push({ tag: "text", cls: "ft-t2", a: { x: tx, y: n.y + 43 }, text: trunc(fam, maxc) });
      var span = (opts.dates === false || hide) ? "" : lifeSpan(p, lang);
      if (span) kids.push({ tag: "text", cls: "ft-t3", a: { x: tx, y: n.y + 61 }, text: trunc(span, maxc + 3) });
      if (n.dup) kids.push({ tag: "text", cls: "ft-t3", a: { x: n.x + CW - 10, y: n.y + 18, "text-anchor": "end" }, text: "↗" });
      items.push({ tag: "g", cls: cls, a: { "data-pid": n.pid }, kids: kids });
    });
    return { w: lay.w, h: lay.h, items: items };
  }

  var THEMES = {
    light: { bg: "#ffffff", box: "#f6f7f9", border: "#c9ced6", text: "#1d2330", dim: "#5b6474",
             line: "#8a93a3", focus: "#3a7bd5" },
    dark:  { bg: "#1b1e24", box: "#262a33", border: "#3a404c", text: "#e6e9ef", dim: "#9aa4b0",
             line: "#6c7585", focus: "#6aa6ff" }
  };
  var SEX_COLORS = { f: "#e07aa8", m: "#4f9fe0", x: "#a07ce0", u: "#9aa4b0" };

  function escXml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;";
    }).replace(CTRL_RE, "");
  }
  function styleFor(item, parentCls, th) {
    var c = (item.cls || ""), pc = parentCls || "", s = "";
    var sex = /ft-sex-([fmxu])/.exec(pc), focus = / ft-focus/.test(pc), dup = / ft-dup/.test(pc);
    if (c === "ft-link") s = 'fill="none" stroke="' + th.line + '" stroke-width="1.6"';
    else if (c === "ft-couple") s = 'fill="none" stroke="' + th.line + '" stroke-width="2.4"';
    else if (c === "ft-div") s = 'fill="none" stroke="' + th.line + '" stroke-width="2.4" stroke-dasharray="6 4"';
    else if (c === "ft-box") s = 'fill="' + th.box + '" stroke="' + (focus ? th.focus : th.border) + '" stroke-width="' +
                                 (focus ? 2.5 : 1.2) + '"' + (dup ? ' stroke-dasharray="5 4"' : "");
    else if (c === "ft-stripe") s = 'fill="' + SEX_COLORS[sex ? sex[1] : "u"] + '"';
    else if (c === "ft-t1") s = 'fill="' + th.text + '" font-size="14" font-weight="700"';
    else if (c === "ft-t2") s = 'fill="' + th.text + '" font-size="13"';
    else if (c === "ft-t3") s = 'fill="' + th.dim + '" font-size="12"';
    return s;
  }
  function itemXml(item, parentCls, th) {
    if (!own(TAGS, item.tag)) return "";
    var out = "<" + item.tag;
    Object.keys(item.a || {}).forEach(function (k) {
      if (!own(ATTRS, k) || k === "data-pid") return;
      var v = item.a[k];
      if (k === "href" && !validPhoto(v)) return;
      out += " " + k + '="' + escXml(v) + '"';
    });
    var st = styleFor(item, parentCls, th);
    if (st) out += " " + st;
    var inner = "";
    if (item.text !== undefined) inner = escXml(item.text);
    (item.kids || []).forEach(function (k) { inner += itemXml(k, item.cls || parentCls, th); });
    return out + (inner ? ">" + inner + "</" + item.tag + ">" : "/>");
  }
  function toSvg(sc, opts) {
    opts = opts || {};
    var th = THEMES[opts.theme === "dark" ? "dark" : "light"];
    var w = Math.max(1, Math.round(sc.w)), h = Math.max(1, Math.round(sc.h));
    var s = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h +
      '" font-family="Nunito, \'Segoe UI\', Roboto, Arial, sans-serif">\n';
    if (opts.title) s += "<title>" + escXml(opts.title) + "</title>\n";
    s += '<rect width="' + w + '" height="' + h + '" fill="' + th.bg + '"/>\n';
    sc.items.forEach(function (it) { s += itemXml(it, "", th) + "\n"; });
    return s + "</svg>\n";
  }

  // ---------- 9. Contacts bridge (read-only) ----------
  // Contacts store a relation on ONE side: { with: X, type: T } on
  // contact c means "X is c's T". The inverse is computed here the
  // way contacts.js does it. Only family relations are followed.
  var REL_KEEP = { spouse: "spouse", partner: "partner", parent: "child", child: "parent", sibling: "sibling" };

  function contactsIndex(ct) {
    var C = dict(), adj = dict();
    if (!ct || typeof ct !== "object") return { C: C, adj: adj };
    var gone = dict();
    (Array.isArray(ct.deleted) ? ct.deleted : []).forEach(function (d) {
      if (d && isId(d.id) && typeof d.mtime === "number") gone[d.id] = Math.max(gone[d.id] || 0, d.mtime);
    });
    (Array.isArray(ct.contacts) ? ct.contacts : []).forEach(function (c) {
      if (!c || typeof c !== "object" || !isId(c.id) || c.del) return;
      if (own(gone, c.id) && gone[c.id] >= (typeof c.mtime === "number" ? c.mtime : 0)) return;
      C[c.id] = c;
    });
    function add(a, b, type) {
      var l = adj[a] = adj[a] || [];
      for (var i = 0; i < l.length; i++) if (l[i].to === b && l[i].type === type) return;
      l.push({ to: b, type: type });
    }
    Object.keys(C).forEach(function (id) {
      var rels = Array.isArray(C[id].relations) ? C[id].relations : [];
      rels.forEach(function (r) {
        if (!r || !own(REL_KEEP, r.type) || !isId(r.with) || !own(C, r.with) || r.with === id) return;
        add(id, r.with, r.type);
        add(r.with, id, REL_KEEP[r.type]);
      });
    });
    Object.keys(adj).forEach(function (k) {
      adj[k].sort(function (x, y) { return cmpStr(x.to, y.to) || cmpStr(x.type, y.type); });
    });
    return { C: C, adj: adj };
  }
  function contactName(c) {
    var n = [line(c.given, NAME_LEN), line(c.middle, NAME_LEN), line(c.family, NAME_LEN)].filter(Boolean).join(" ");
    return n || line(c.nickname, NAME_LEN) || line(c.org, NAME_LEN) || "";
  }
  function contactBirth(c) {
    var ev = Array.isArray(c.events) ? c.events : [];
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (!e || e.type !== "birthday" || typeof e.day !== "string" || !/^\d{2}-\d{2}$/.test(e.day)) continue;
      if (isInt(e.year) && e.year >= 1 && e.year <= 2200) {
        var y = String(e.year);
        while (y.length < 4) y = "0" + y;
        var d = y + "-" + e.day;
        if (validD(d)) return d;
      }
    }
    return "";
  }
  // The family reachable from `startId` (breadth first, ≤ limit),
  // start first. [{ cid, name, birth }]
  function planFromContacts(ct, startId, limit) {
    var ci = contactsIndex(ct);
    if (!own(ci.C, startId)) return [];
    limit = limit || 200;
    var out = [], seen = dict(), q = [startId];
    seen[startId] = 1;
    while (q.length && out.length < limit) {
      var id = q.shift(), c = ci.C[id];
      out.push({ cid: id, name: contactName(c), birth: contactBirth(c) });
      (ci.adj[id] || []).forEach(function (e) {
        if (!own(seen, e.to)) { seen[e.to] = 1; q.push(e.to); }
      });
    }
    return out;
  }
  // Builds the selected contacts into tree `treeId`. People already
  // linked to a contact are reused; their filled fields and existing
  // parent links are never overwritten. Returns new/changed rows:
  // { people, unions, photos: { personId: contactPhoto } , map: { cid: pid } }
  function buildFromContacts(ct, cids, data, treeId, now, newId) {
    var ci = contactsIndex(ct);
    var sel = dict();
    (cids || []).forEach(function (id) { if (own(ci.C, id)) sel[id] = 1; });
    var ix = index(data, treeId);
    var byContact = dict();
    Object.keys(ix.P).forEach(function (pid) { var p = ix.P[pid]; if (p.contact) byContact[p.contact] = p; });
    var changed = dict(), newUnions = [], photos = {}, map = {};
    var ids = Object.keys(sel).sort(cmpStr);
    ids.forEach(function (cid) {
      var c = ci.C[cid];
      var ex = byContact[cid];
      if (ex) { map[cid] = ex.id; return; }
      var nm = [line(c.given, NAME_LEN), line(c.middle, NAME_LEN)].filter(Boolean).join(" ");
      var p = normPerson({ id: newId(), m: now, tree: treeId, given: nm || contactName(c),
                           family: c.family, birth: { d: contactBirth(c) }, contact: cid, parents: [] });
      changed[p.id] = p;
      ix.P[p.id] = p;
      map[cid] = p.id;
      if (typeof c.photo === "string" && /^data:image\/(jpeg|png);base64,/.test(c.photo)) photos[p.id] = c.photo;
    });
    function rels(cid, type) {
      return (ci.adj[cid] || []).filter(function (e) { return e.type === type && own(sel, e.to); })
                                .map(function (e) { return e.to; });
    }
    function getUnion(a, b, kind) {
      var u = b ? findUnion(ix, a, b) : soloUnion(ix, a);
      if (u) return u;
      u = normUnion({ id: newId(), m: now, tree: treeId, a: a, b: b, kind: kind });
      ix.U[u.id] = u;
      (ix.unionsOf[a] = ix.unionsOf[a] || []).push(u);
      if (b) (ix.unionsOf[b] = ix.unionsOf[b] || []).push(u);
      newUnions.push(u);
      return u;
    }
    function coupleKind(a, b) {
      var l = ci.adj[a] || [];
      for (var i = 0; i < l.length; i++) if (l[i].to === b && (l[i].type === "spouse" || l[i].type === "partner")) {
        return l[i].type === "spouse" ? "married" : "partner";
      }
      return "";
    }
    function setParents(pid, u) {
      var p = ix.P[pid];
      if (p.parents.length || wouldCycle(ix, pid, u.id)) return false;
      var q = changed[pid] || JSON.parse(JSON.stringify(p));
      if (!changed[pid]) q.m = Math.max(now, p.m + 1);
      q.parents = [{ u: u.id, kind: "birth" }];
      changed[pid] = q;
      ix.P[pid] = q;
      return true;
    }
    // Parents: a couple among them if there is one, else the first two.
    ids.forEach(function (cid) {
      var par = rels(cid, "parent");
      if (!par.length) return;
      var pick = par.slice(0, 2);
      for (var i = 0; i < par.length; i++) {
        for (var j = i + 1; j < par.length; j++) {
          if (coupleKind(par[i], par[j])) { pick = [par[i], par[j]]; i = j = par.length; }
        }
      }
      var kind = pick.length === 2 ? (coupleKind(pick[0], pick[1]) || "unknown") : "unknown";
      var pair = pick.map(function (x) { return map[x]; }).sort(cmpStr);
      setParents(map[cid], getUnion(pair[0], pair[1] || "", kind));
    });
    // Couples without children.
    ids.forEach(function (cid) {
      ["spouse", "partner"].forEach(function (ty) {
        rels(cid, ty).forEach(function (o) {
          if (cmpStr(cid, o) >= 0) return;
          var pa = [map[cid], map[o]].sort(cmpStr);
          getUnion(pa[0], pa[1], ty === "spouse" ? "married" : "partner");
        });
      });
    });
    // Siblings: share the family of whichever already has one; a
    // group with none gets one family with unknown parents.
    var done = dict();
    ids.forEach(function (cid) {
      if (own(done, cid)) return;
      var group = [], q = [cid];
      done[cid] = 1;
      while (q.length) {
        var x = q.shift();
        group.push(x);
        rels(x, "sibling").forEach(function (o) { if (!own(done, o)) { done[o] = 1; q.push(o); } });
      }
      if (group.length < 2) return;
      var fam = null;
      group.forEach(function (x) { if (!fam) fam = primaryUnion(ix, map[x]); });
      if (!fam) {
        fam = normUnion({ id: newId(), m: now, tree: treeId, a: "", b: "", kind: "unknown" });
        ix.U[fam.id] = fam;
        newUnions.push(fam);
      }
      group.forEach(function (x) { setParents(map[x], fam); });
    });
    var people = Object.keys(changed).sort(cmpStr).map(function (k) { return changed[k]; });
    return { people: people, unions: newUnions, photos: photos, map: map };
  }

  // ---------- 10. GEDCOM import / export ----------
  // GEDCOM 5.5.1 and 7.0 lineage-linked files. Import reads INDI
  // (NAME, SEX, BIRT, DEAT/BURI/CREM, NOTE, FAMC + PEDI) and FAM
  // (HUSB, WIFE, CHIL + _FREL/_MREL, MARR, DIV) into ONE new tree;
  // everything else (sources, media, places' maps, custom tags) is
  // skipped. Values are plain strings run through the same
  // normalizers and checks as a JSON import: nothing is evaluated.
  // Export writes GEDCOM 5.5.1, UTF-8.
  var GED_MAX = 15 * 1024 * 1024;
  var GED_MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  var GED_MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  var GED_LINE = /^\s*(\d{1,2})\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_]+)(?: (.*))?$/;

  // ANSEL (old GEDCOM files): ASCII + spacing specials + combining
  // marks written BEFORE their base letter.
  var ANSEL_SPEC = {
    0xA1: "Ł", 0xA2: "Ø", 0xA3: "Đ", 0xA4: "Þ", 0xA5: "Æ", 0xA6: "Œ",
    0xA7: "ʹ", 0xA8: "·", 0xA9: "♭", 0xAA: "®", 0xAB: "±", 0xAC: "Ơ",
    0xAD: "Ư", 0xAE: "ʼ", 0xB0: "ʻ", 0xB1: "ł", 0xB2: "ø", 0xB3: "đ",
    0xB4: "þ", 0xB5: "æ", 0xB6: "œ", 0xB7: "ʺ", 0xB8: "ı", 0xB9: "£",
    0xBA: "ð", 0xBC: "ơ", 0xBD: "ư", 0xC0: "°", 0xC1: "ℓ", 0xC2: "℗",
    0xC3: "©", 0xC4: "♯", 0xC5: "¿", 0xC6: "¡", 0xC7: "ß", 0xC8: "€"
  };
  var ANSEL_COMB = {
    0xE0: "̉", 0xE1: "̀", 0xE2: "́", 0xE3: "̂", 0xE4: "̃", 0xE5: "̄",
    0xE6: "̆", 0xE7: "̇", 0xE8: "̈", 0xE9: "̌", 0xEA: "̊", 0xEB: "︠",
    0xEC: "︡", 0xED: "̕", 0xEE: "̋", 0xEF: "̐", 0xF0: "̧", 0xF1: "̨",
    0xF2: "̣", 0xF3: "̤", 0xF4: "̥", 0xF5: "̳", 0xF6: "̲", 0xF7: "̦",
    0xF8: "̜", 0xF9: "̮", 0xFA: "︢", 0xFB: "︣", 0xFE: "̓"
  };
  function decodeAnsel(b) {
    var out = "", marks = "";
    for (var i = 0; i < b.length; i++) {
      var c = b[i];
      if (own(ANSEL_COMB, c)) { marks += ANSEL_COMB[c]; continue; }
      out += (c < 0x80 ? String.fromCharCode(c) : (own(ANSEL_SPEC, c) ? ANSEL_SPEC[c] : "�")) + marks;
      marks = "";
    }
    return out.normalize ? out.normalize("NFC") : out;
  }
  // Bytes → text: BOM first, then the header's CHAR, then UTF-8 if
  // it decodes cleanly, else Windows-1252.
  function decodeGedcom(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    function dec(label, from, fatal) { return new TextDecoder(label, { fatal: !!fatal }).decode(b.subarray(from)); }
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return dec("utf-8", 3);
    if (b[0] === 0xFF && b[1] === 0xFE) return dec("utf-16le", 2);
    if (b[0] === 0xFE && b[1] === 0xFF) return dec("utf-16be", 2);
    var head = "";
    for (var i = 0; i < Math.min(b.length, 4096); i++) head += String.fromCharCode(b[i] < 0x80 ? b[i] : 0x3F);
    var m = /\n\s*1\s+CHAR\s+([A-Za-z0-9-]+)/.exec("\n" + head);
    var ch = m ? m[1].toUpperCase() : "";
    if (ch === "ANSEL") return decodeAnsel(b);
    if (ch === "UNICODE") return dec(b[1] === 0 ? "utf-16le" : "utf-16be", 0);
    if (ch !== "ANSI" && ch !== "IBMPC" && ch !== "MACINTOSH") {
      try { return dec("utf-8", 0, true); } catch (e) { /* not UTF-8 */ }
    }
    return dec("windows-1252", 0);
  }

  // Lines → nested records { tag, xref, val, kids }. CONT / CONC are
  // folded into the value. Unreadable lines are skipped.
  function gedRecords(text) {
    var lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
    var top = [], stack = [];
    for (var i = 0; i < lines.length; i++) {
      var m = GED_LINE.exec(lines[i]);
      if (!m) continue;
      var lvl = +m[1], tag = m[3].toUpperCase(), val = m[4] === undefined ? "" : m[4];
      while (stack.length > lvl) stack.pop();
      var parent = lvl > 0 ? stack[lvl - 1] : null;
      if (lvl > 0 && !parent) continue;               // level jump: orphan line
      if (parent && (tag === "CONT" || tag === "CONC")) {
        parent.val += (tag === "CONT" ? "\n" : "") + val;
        continue;
      }
      var node = { tag: tag, xref: m[2] || "", val: val, kids: [] };
      if (parent) parent.kids.push(node); else top.push(node);
      stack.length = lvl;
      stack.push(node);
    }
    return top;
  }
  function gedKid(n, tag) {
    for (var i = 0; i < n.kids.length; i++) if (n.kids[i].tag === tag) return n.kids[i];
    return null;
  }
  function gedKids(n, tag) { return n.kids.filter(function (k) { return k.tag === tag; }); }
  function gedText(v) { return String(v).replace(/@@/g, "@"); }

  // "ABT 12 MAR 1900", "BEF 1900", "1652/53", "BET 1900 AND 1910",
  // "@#DJULIAN@ 1600" → { d, q }; null when there is no usable year.
  function gedDate(v) {
    var s = String(v || "").toUpperCase().replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    var cal = /^@#D([A-Z ]+)@\s*/.exec(s) || /^(GREGORIAN|JULIAN|HEBREW|FRENCH_R)\s+/.exec(s);
    if (cal) {
      if (!/GREGORIAN|JULIAN/.test(cal[1])) return null;
      s = s.slice(cal[0].length);
    }
    var q = "", m;
    if ((m = /^(ABT|CAL|EST|BET|FROM)\s+/.exec(s))) q = "abt";
    else if ((m = /^(BEF|TO)\s+/.exec(s))) q = "bef";
    else if ((m = /^AFT\s+/.exec(s))) q = "aft";
    else if ((m = /^INT\s+/.exec(s))) q = "";
    if (m) s = s.slice(m[0].length);
    s = s.split(/\s(?:AND|TO)\s/)[0].replace(/^@#D[A-Z ]+@\s*/, "");
    m = /^(?:(\d{1,2})\s+)?(?:([A-Z]{3})\s+)?(\d{1,4})(?:\/(\d{1,4}))?(\s*B\.?C\.?)?$/.exec(s);
    if (!m || m[5]) return null;
    var y = m[3];
    if (m[4]) {                                    // dual year: the new-style one
      var alt = y.slice(0, y.length - m[4].length) + m[4];
      if (+alt > +y) y = alt;
    }
    while (y.length < 4) y = "0" + y;
    var d = y;
    if (m[2]) {
      if (!own(GED_MONTHS, m[2])) return null;
      d += "-" + pad2(GED_MONTHS[m[2]]);
      if (m[1]) d += "-" + pad2(m[1]);
    } else if (m[1]) return null;
    return validD(d) ? { d: d, q: q } : null;
  }
  function gedEvent(n) {
    if (!n) return { d: "", q: "", place: "" };
    var dt = gedKid(n, "DATE"), pl = gedKid(n, "PLAC");
    var x = dt ? gedDate(dt.val) : null;
    return { d: x ? x.d : "", q: x ? x.q : "", place: pl ? gedText(pl.val) : "" };
  }
  function gedUnderscores(s) { return s.replace(/_/g, " "); }
  // NAME "Given /Surname/ Suffix" (+ GIVN / SURN / TYPE).
  function gedName(n) {
    var v = gedText(n.val), given, family;
    var m = /^([^\/]*)\/([^\/]*)\/?(.*)$/.exec(v);
    if (m) {
      given = m[1];
      family = (m[2] + " " + m[3]).trim();
    } else {
      given = v;
      family = "";
    }
    var gv = gedKid(n, "GIVN"), sn = gedKid(n, "SURN");
    if (!given.trim() && gv) given = gedText(gv.val);
    if (!family.trim() && sn) family = gedText(sn.val);
    var ty = gedKid(n, "TYPE");
    return { given: gedUnderscores(given), family: gedUnderscores(family),
             type: ty ? String(ty.val).trim().toLowerCase() : "" };
  }
  function gedRel(v) {
    var s = String(v || "").trim().toLowerCase();
    if (s.indexOf("adopt") === 0) return "adopted";
    if (s.indexOf("foster") === 0) return "foster";
    if (s.indexOf("step") === 0) return "step";
    return "birth";
  }

  // `opts` = { name, now, newId }. Returns the same shape as
  // parseImport; the file always becomes a new tree.
  function parseGedcom(text, local, opts) {
    if (typeof text !== "string") return { ok: false, err: "format" };
    if (text.length > GED_MAX) return { ok: false, err: "size" };
    var recs = gedRecords(text);
    if (!recs.length || recs[0].tag !== "HEAD") return { ok: false, err: "format" };
    var indis = [], fams = [], notes = dict();
    recs.forEach(function (r) {
      if (r.tag === "INDI" && r.xref) indis.push(r);
      else if (r.tag === "FAM" && r.xref) fams.push(r);
      else if ((r.tag === "NOTE" || r.tag === "SNOTE") && r.xref) notes[r.xref] = gedText(r.val);
    });
    if (!indis.length) return { ok: false, err: "empty" };
    if (indis.length > MAX_PEOPLE || fams.length > MAX_UNIONS) return { ok: false, err: "toolarge" };
    var now = opts.now, newId = opts.newId;
    var st = { trees: 0, people: 0, unions: 0, dropped: 0, refs: 0, cycles: 0 };
    var tree = normTree({ id: newId(), m: now, name: line(opts.name, TREE_LEN) || "GEDCOM", home: "" });

    var pid = dict(), people = [], byX = dict();
    indis.forEach(function (r) {
      if (own(pid, r.xref)) { st.dropped++; return; }
      var names = gedKids(r, "NAME").map(gedName);
      var main = null, birth = null;
      names.forEach(function (x) {
        if (x.type === "birth" || x.type === "maiden") { if (!birth) birth = x; }
        else if (!main) main = x;
      });
      if (!main) { main = birth; birth = null; }
      var sx = gedKid(r, "SEX"), sv = sx ? String(sx.val).trim().toUpperCase() : "";
      var death = gedEvent(gedKid(r, "DEAT"));
      var dead = !!(gedKid(r, "DEAT") || gedKid(r, "BURI") || gedKid(r, "CREM"));
      var noteList = [];
      [gedKids(r, "NOTE"), gedKids(r, "SNOTE")].forEach(function (list) {
        list.forEach(function (n) {
          var v = n.val.trim();
          var t = /^@[^@\s]+@$/.test(v) ? notes[v] : gedText(n.val);
          if (t) noteList.push(t);
        });
      });
      var p = {
        id: newId(), m: now, tree: tree.id,
        given: main ? main.given : "", family: main ? main.family : "",
        birthName: birth && main && birth.family !== main.family ? birth.family : "",
        sex: sv === "F" ? "f" : (sv === "M" ? "m" : (sv === "X" ? "x" : "u")),
        birth: gedEvent(gedKid(r, "BIRT")), death: death, dead: dead,
        note: noteList.join("\n\n"), photo: "", contact: "", parents: []
      };
      pid[r.xref] = p.id;
      byX[r.xref] = { p: p, famc: gedKids(r, "FAMC") };
      people.push(p);
    });

    var fid = dict(), unions = [], kidsOf = dict();
    fams.forEach(function (r) {
      if (own(fid, r.xref)) { st.dropped++; return; }
      var ref = function (tag) {
        var k = gedKid(r, tag);
        if (!k || k.val.trim() === "@VOID@") return "";
        if (own(pid, k.val.trim())) return pid[k.val.trim()];
        st.refs++;
        return "";
      };
      var div = gedKid(r, "DIV"), marr = gedKid(r, "MARR");
      var s = gedEvent(marr), e = gedEvent(div);
      var u = {
        id: newId(), m: now, tree: tree.id, a: ref("HUSB"), b: ref("WIFE"),
        kind: div ? "divorced" : (marr ? "married" : "unknown"),
        start: { d: s.d, q: s.q }, end: { d: e.d, q: e.q }
      };
      fid[r.xref] = u.id;
      unions.push(u);
      kidsOf[u.id] = [];
      gedKids(r, "CHIL").forEach(function (c) {
        var x = c.val.trim();
        if (x === "@VOID@") return;
        if (!own(byX, x)) { st.refs++; return; }
        var f = gedKid(c, "_FREL"), mo = gedKid(c, "_MREL");
        var kind = gedRel(f && gedRel(f.val) !== "birth" ? f.val : (mo ? mo.val : ""));
        kidsOf[u.id].push({ x: x, kind: kind });
      });
    });
    // Parents: the child's own FAMC (with PEDI) first, then CHIL
    // lines the child does not repeat.
    Object.keys(byX).forEach(function (xr) {
      var e = byX[xr];
      e.famc.forEach(function (fc) {
        var x = fc.val.trim();
        if (x === "@VOID@") return;
        if (!own(fid, x)) { st.refs++; return; }
        var pedi = gedKid(fc, "PEDI");
        e.p.parents.push({ u: fid[x], kind: gedRel(pedi ? pedi.val : "") });
      });
    });
    Object.keys(kidsOf).forEach(function (uid) {
      kidsOf[uid].forEach(function (k) {
        var p = byX[k.x].p;
        for (var i = 0; i < p.parents.length; i++) {
          if (p.parents[i].u === uid) {
            if (p.parents[i].kind === "birth" && k.kind !== "birth") p.parents[i].kind = k.kind;
            return;
          }
        }
        p.parents.push({ u: uid, kind: k.kind });
      });
    });
    // Normalize (cuts long text, > 4 parents, bad dates) and check.
    var ps = [], us = [];
    people.forEach(function (p) {
      if (p.parents.length > MAX_PARENTS) st.refs += p.parents.length - MAX_PARENTS;
      var x = normPerson(p);
      if (x) ps.push(x); else st.dropped++;
    });
    unions.forEach(function (u) { var x = normUnion(u); if (x) us.push(x); else st.dropped++; });
    if (ps.length) tree.home = ps[0].id;
    return checkRows([tree], ps, us, {}, local, st);
  }

  // ----- export -----
  function gedDateOut(x) {
    if (!x || !x.d) return "";
    var parts = x.d.split("-"), out = String(+parts[0]);
    if (parts[1]) out = GED_MON[+parts[1] - 1] + " " + out;
    if (parts[2]) out = String(+parts[2]) + " " + out;
    var q = { abt: "ABT ", bef: "BEF ", aft: "AFT " }[x.q] || "";
    return q + out;
  }
  // One value → lines: newlines become CONT, long lines CONC (never
  // split next to a space), "@" doubled, controls gone.
  function gedValue(out, lvl, tag, value) {
    var v = para(String(value || ""), 100000).replace(/@/g, "@@");
    var rows = v.split("\n");
    rows.forEach(function (row, i) {
      var head = i === 0 ? lvl + " " + tag : (lvl + 1) + " CONT";
      do {
        var cut = row.length;
        if (cut > 200) {
          cut = 200;
          while (cut > 100 && (row.charAt(cut) === " " || row.charAt(cut - 1) === " ")) cut--;
        }
        out.push(head + (cut ? " " + row.slice(0, cut) : ""));
        head = (lvl + 1) + " CONC";
        row = row.slice(cut);
      } while (row.length);
    });
  }
  function gedNamePart(s) { return String(s || "").replace(/\//g, "-"); }
  // `opts` = { living: hide dates, places and notes of the living,
  //            date: Date for the header }
  function exportGedcom(data, treeId, opts) {
    opts = opts || {};
    var d = merge(data, data);
    var P = d.people.filter(function (p) { return p.tree === treeId; });
    var ix = index(d, treeId);
    var px = dict(), fx = dict();
    P.forEach(function (p, i) { px[p.id] = "@I" + (i + 1) + "@"; });
    var famIds = Object.keys(ix.U).filter(function (id) {
      var u = ix.U[id];
      return (u.a && own(px, u.a)) || (u.b && own(px, u.b)) || (ix.kids[id] || []).length;
    }).sort(cmpStr);
    famIds.forEach(function (id, i) { fx[id] = "@F" + (i + 1) + "@"; });
    var now = opts.date || new Date();
    var out = [
      "0 HEAD", "1 SOUR orOS", "2 NAME orOS Family Tree",
      "1 DATE " + now.getUTCDate() + " " + GED_MON[now.getUTCMonth()] + " " + now.getUTCFullYear(),
      "1 SUBM @U1@", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8",
      "0 @U1@ SUBM", "1 NAME orOS"
    ];
    function event(tag, ev, hide, flag) {
      var dt = hide ? "" : gedDateOut(ev), pl = hide ? "" : ev.place;
      if (!dt && !pl) { if (flag) out.push("1 " + tag + " Y"); return; }
      out.push("1 " + tag);
      if (dt) out.push("2 DATE " + dt);
      if (pl) gedValue(out, 2, "PLAC", pl);
    }
    P.forEach(function (p) {
      var hide = !!opts.living && !p.dead;
      out.push("0 " + px[p.id] + " INDI");
      gedValue(out, 1, "NAME", (gedNamePart(p.given) + " /" + gedNamePart(p.family) + "/").trim());
      if (p.given) gedValue(out, 2, "GIVN", p.given);
      if (p.family) gedValue(out, 2, "SURN", p.family);
      if (p.birthName) {
        gedValue(out, 1, "NAME", (gedNamePart(p.given) + " /" + gedNamePart(p.birthName) + "/").trim());
        out.push("2 TYPE birth");
      }
      out.push("1 SEX " + ({ f: "F", m: "M" }[p.sex] || "U"));
      event("BIRT", p.birth, hide, false);
      if (p.dead) event("DEAT", p.death, false, true);
      (ix.unionsOf[p.id] || []).forEach(function (u) { if (own(fx, u.id)) out.push("1 FAMS " + fx[u.id]); });
      p.parents.forEach(function (r) {
        if (!own(fx, r.u)) return;
        out.push("1 FAMC " + fx[r.u]);
        if (r.kind === "adopted" || r.kind === "foster") out.push("2 PEDI " + r.kind);
      });
      if (p.note && !hide) gedValue(out, 1, "NOTE", p.note);
    });
    famIds.forEach(function (id) {
      var u = ix.U[id];
      out.push("0 " + fx[id] + " FAM");
      var a = own(px, u.a) ? ix.P[u.a] : null, b = own(px, u.b) ? ix.P[u.b] : null;
      if (a && b && a.sex === "f" && b.sex !== "f") { var t = a; a = b; b = t; }
      if (a) out.push("1 HUSB " + px[a.id]);
      if (b) out.push("1 WIFE " + px[b.id]);
      var hide = !!opts.living && ((a && !a.dead) || (b && !b.dead));
      if (u.kind === "married" || u.kind === "divorced") event("MARR", u.start, hide, true);
      if (u.kind === "divorced") event("DIV", u.end, hide, true);
      (ix.kids[id] || []).forEach(function (c) {
        out.push("1 CHIL " + px[c.id]);
        c.parents.forEach(function (r) {
          if (r.u === id && r.kind === "step") { out.push("2 _FREL Step"); out.push("2 _MREL Step"); }
        });
      });
    });
    out.push("0 TRLR");
    return out.join("\r\n") + "\r\n";
  }

  // ---------- 11. Calendar feed (read-only, death anniversaries) ----------
  // Day index for Calendar: "MM-DD" → [{ pid, name, y }] for people
  // with an exact death date (full day, no about / before / after).
  // Deaths on 29 Feb also show on 28 Feb of common years.
  // The same name + date in two trees (an imported copy) shows once.
  function deathDays(raw) {
    var d = merge(raw, raw), out = dict(), seen = dict();
    d.people.forEach(function (p) {
      var x = p.death;
      if (!p.dead || x.q || x.d.length !== 10) return;
      var name = displayName(p, "");
      if (!name) return;
      var key = name + "|" + x.d;
      if (own(seen, key)) return;
      seen[key] = 1;
      var md = x.d.slice(5);
      (out[md] = out[md] || []).push({ pid: p.id, name: name, y: +x.d.slice(0, 4) });
    });
    Object.keys(out).forEach(function (k) {
      out[k].sort(function (a, b) { return cmpStr(a.name, b.name) || cmpStr(a.pid, b.pid); });
    });
    return out;
  }
  // Rows for one "YYYY-MM-DD": [{ pid, name, years }] (years ≥ 1).
  function deathAnniversaries(idx, dateStr) {
    var y = +dateStr.slice(0, 4), md = dateStr.slice(5), rows = [];
    var lists = [idx[md] || []];
    if (md === "02-28" && !leap(y)) lists.push(idx["02-29"] || []);
    lists.forEach(function (list) {
      list.forEach(function (r) { if (y > r.y) rows.push({ pid: r.pid, name: r.name, years: y - r.y }); });
    });
    return rows;
  }

  var api = {
    VER: VER, FORMAT: FORMAT, CW: CW, CH: CH, NAME_LEN: NAME_LEN, PLACE_LEN: PLACE_LEN, TREE_LEN: TREE_LEN,
    NOTE_LEN: NOTE_LEN, PHOTO_MAX: PHOTO_MAX, PHOTO_BUDGET: PHOTO_BUDGET, IMPORT_MAX: IMPORT_MAX,
    MAX_PEOPLE: MAX_PEOPLE, MAX_TREES: MAX_TREES, MAX_PARENTS: MAX_PARENTS,
    SEXES: SEXES, QUALS: QUALS, PARENT_KINDS: PARENT_KINDS, UNION_KINDS: UNION_KINDS, SEX_COLORS: SEX_COLORS,
    TAGS: TAGS, ATTRS: ATTRS,
    isId: isId, line: line, para: para, validPhoto: validPhoto, validD: validD, parseDateInput: parseDateInput,
    fmtD: fmtD, fmtDate: fmtDate, lifeSpan: lifeSpan,
    normTree: normTree, normPerson: normPerson, normUnion: normUnion, emptyData: emptyData, merge: merge,
    index: index, primaryUnion: primaryUnion, wouldCycle: wouldCycle, soloUnion: soloUnion, findUnion: findUnion,
    partnerOf: partnerOf, displayName: displayName, photoBytes: photoBytes,
    exportData: exportData, parseImport: parseImport,
    layout: layout, scene: scene, toSvg: toSvg, escXml: escXml,
    contactsIndex: contactsIndex, contactName: contactName, planFromContacts: planFromContacts,
    buildFromContacts: buildFromContacts,
    GED_MAX: GED_MAX, decodeGedcom: decodeGedcom, gedDate: gedDate, parseGedcom: parseGedcom,
    exportGedcom: exportGedcom, deathDays: deathDays, deathAnniversaries: deathAnniversaries
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FTCore = api;
})(typeof window !== "undefined" ? window : this);
