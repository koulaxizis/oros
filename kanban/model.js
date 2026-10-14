// ============================================================
// orOS Kanban — sync model (v1.0.0): canonical form + merge
// Pure: no DOM, no storage. Loaded by kanban/index.html before
// kanban.js (window.OrosKanbanModel) and by tests/kanban-*.test.js
// (module.exports).
//
// Per-field card merge (wave K1). A card carries `fm`, one stamp per
// field group, plus `fm.m` = the card's mtime at the moment `fm` was
// written:
//   t text · n notes · d due · l labels · s subtasks · x extra info
//   p column (placement) · a attachments · c cover · k lane
// Subtasks and attachments merge per item (`m` stamp on the item,
// deletions as board tombstones "<cardId>/<itemId>").
// A card whose fm is missing or whose fm.m differs from its mtime was
// last written by an older version (whole-card stamp): all its groups
// count with its mtime, so such a card behaves exactly like before
// (the newer whole card wins) and nothing is ever lost to a version
// that does not know fm.
// Compatibility rules (no endless uploads between versions):
//   · ver stays 5; the card/column/label/board key order is the old
//     canonOrder (old known keys, then unknown keys sorted), so an
//     older device re-canonicalises our data to the same bytes;
//   · new card keys (att, cover, fm, lane) appear only when set;
//   · nothing new lives on the board or the root (old merges drop
//     unknown keys there): WIP limits and arrival rules live on the
//     column, the overdue rule on its label (label.auto), templates
//     are archived boards whose id starts with "tpl-".
//   · a full stamp tie is broken like the old merge (card JSON + col),
//     so an old and a new device pick the same whole card.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER = 5;
  var TOMB_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
  var GROUPS = ["a", "c", "d", "k", "l", "n", "p", "s", "t", "x"];
  // group → card field (p is the placement, outside the card object)
  var FIELD = { a: "att", c: "cover", d: "due", k: "lane", l: "labels",
                n: "notes", s: "subtasks", t: "text", x: "info" };
  var LIST_GROUPS = { s: true, a: true };

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function isTpl(b) { return !!b && typeof b.id === "string" && b.id.indexOf("tpl-") === 0; }

  // ---------- field stamps ----------
  function fmValid(card) {
    return !!(card && card.fm && typeof card.fm === "object" &&
              typeof card.fm.m === "number" && card.fm.m === (card.mtime || 0));
  }
  function eff(card, g) {
    if (fmValid(card)) { var v = card.fm[g]; return typeof v === "number" ? v : 0; }
    return card.mtime || 0;
  }
  function fieldVal(card, g) {
    var v = card[FIELD[g]];
    if (g === "t" || g === "n" || g === "k") return typeof v === "string" ? v : "";
    if (g === "d" || g === "c") return typeof v === "string" && v ? v : null;
    return Array.isArray(v) ? v : [];
  }
  function setField(card, g, v) {
    var f = FIELD[g];
    if (g === "t" || g === "n") { card[f] = typeof v === "string" ? v : ""; return; }
    if (g === "d") { card.due = v || null; return; }
    if (g === "l" || g === "s" || g === "x") { card[f] = Array.isArray(v) ? v : []; return; }
    // optional keys: only present when set (older cards stay canonical)
    if (g === "k" || g === "c") { if (v) card[f] = v; else delete card[f]; return; }
    if (g === "a") { if (Array.isArray(v) && v.length) card.att = v; else delete card.att; }
  }

  // Stamp the given groups of a card (an edit). Older cards get their
  // fm first, every group at their old mtime. The stamp never goes
  // back in time (a card stamped by a device whose clock runs ahead).
  function stampCard(card, groups, now) {
    if (!card) return 0;
    now = Math.max(typeof now === "number" ? now : Date.now(), (card.mtime || 0) + 1);
    if (!fmValid(card)) {
      var base = card.mtime || 0;
      card.fm = {};
      GROUPS.forEach(function (g) { card.fm[g] = base; });
    }
    (groups || GROUPS).forEach(function (g) { card.fm[g] = now; });
    card.mtime = now;
    card.fm.m = now;
    return now;
  }
  function freshFm(now) {
    var fm = {};
    GROUPS.forEach(function (g) { fm[g] = now; });
    fm.m = now;
    return fm;
  }
  // Item edit in a per-item list (subtasks "s", attachments "a").
  function stampItem(card, g, item, now) {
    var at = stampCard(card, [g], now);
    if (item) item.m = at;
    return at;
  }
  function itemTomb(cardId, itemId) { return cardId + "/" + itemId; }

  // ---------- merge helpers (shared with the old engine) ----------
  function mergeEntityMaps(aDel, bDel) {
    var out = {};
    var a = aDel || {}, b = bDel || {};
    Object.keys(a).forEach(function (id) { out[id] = a[id]; });
    Object.keys(b).forEach(function (id) { out[id] = Math.max(out[id] || 0, b[id]); });
    return out;
  }
  function entAlive(ent, tomb) {
    var ts = tomb[ent.id];
    return ts === undefined || (ent.mtime || 0) > ts;
  }
  function newerEntity(a, b) {
    if ((a.mtime || 0) !== (b.mtime || 0)) return (a.mtime || 0) > (b.mtime || 0) ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  function unionEntities(aArr, bArr, tomb) {
    var map = {};
    (aArr || []).forEach(function (e) { map[e.id] = e; });
    (bArr || []).forEach(function (e) { map[e.id] = map[e.id] ? newerEntity(map[e.id], e) : e; });
    var out = [];
    Object.keys(map).forEach(function (id) { if (entAlive(map[id], tomb)) out.push(map[id]); });
    return out;
  }
  function orderEntities(entities, refArr) {
    var idx = {};
    (refArr || []).forEach(function (e, i) { idx[e.id] = i; });
    entities.sort(function (x, y) {
      var ix = idx[x.id] !== undefined ? idx[x.id] : Infinity;
      var iy = idx[y.id] !== undefined ? idx[y.id] : Infinity;
      if (ix !== iy) return ix - iy;
      if ((x.mtime || 0) !== (y.mtime || 0)) return (x.mtime || 0) - (y.mtime || 0);
      return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
    });
    entities.forEach(function (e, i) { e.pos = i; });
    return entities;
  }
  function pickRef(aArr, bArr, aOm, bOm) {
    if ((aOm || 0) !== (bOm || 0)) return (aOm || 0) > (bOm || 0) ? aArr : bArr;
    var ka = JSON.stringify((aArr || []).map(function (e) { return e.id; }));
    var kb = JSON.stringify((bArr || []).map(function (e) { return e.id; }));
    return ka >= kb ? aArr : bArr;
  }
  function strCmp(a, b) { return a === b ? 0 : (a > b ? 1 : -1); }

  // ---------- per-item list merge (subtasks, attachments) ----------
  // aWins = side A wins the group stamp (its list gives the order).
  // legA / legB = that side's mtime when it is an older whole-card write
  // (its items then count with that mtime), else null. An item from such
  // a side carries that stamp in the result, so later merges see it.
  function stripM(list) {
    return JSON.stringify(list.map(function (x) {
      if (!x || typeof x !== "object") return x;
      var y = clone(x); delete y.m; return y;
    }));
  }
  function mergeItems(listA, listB, aWins, legA, legB, tomb, cardId) {
    var ref = aWins ? listA : listB;
    var bad = function (l) { return l.some(function (x) { return !x || typeof x.id !== "string" || !x.id; }); };
    if (bad(listA) || bad(listB)) return clone(ref);
    var map = {};
    var put = function (x, leg) {
      var e = leg !== null ? leg : (typeof x.m === "number" ? x.m : 0);
      var cur = map[x.id];
      var cand = { x: x, e: e, leg: leg !== null };
      if (!cur) { map[x.id] = cand; return; }
      if (e !== cur.e) { if (e > cur.e) map[x.id] = cand; return; }
      var jx = JSON.stringify(x), jc = JSON.stringify(cur.x);
      if (jx > jc || (jx === jc && cand.leg && !cur.leg)) map[x.id] = cand;
    };
    listA.forEach(function (x) { put(x, legA); });
    listB.forEach(function (x) { put(x, legB); });
    var out = [];
    Object.keys(map).forEach(function (id) {
      var c = map[id], ts = tomb[itemTomb(cardId, id)];
      if (ts !== undefined && c.e <= ts) return;
      var y = clone(c.x);
      if (c.leg) y.m = c.e;
      out.push(y);
    });
    var idx = {};
    ref.forEach(function (x, i) { idx[x.id] = i; });
    out.sort(function (x, y) {
      var ix = idx[x.id] !== undefined ? idx[x.id] : Infinity;
      var iy = idx[y.id] !== undefined ? idx[y.id] : Infinity;
      if (ix !== iy) return ix - iy;
      if ((x.m || 0) !== (y.m || 0)) return (x.m || 0) - (y.m || 0);
      return strCmp(x.id, y.id);
    });
    return out;
  }

  // ---------- per-field card merge ----------
  // pa/pb = { card, colId }. Returns { card, colId }.
  // Both cards from an older version → the old rule (whole newer card).
  // Otherwise each group comes from the side with the newer stamp. A
  // result that equals neither input gets mtime = newest + 1, so an
  // older device (whole newer card wins) adopts it instead of sending
  // its own copy back again and again.
  function canonJson(card) { return JSON.stringify(canonCard(clone(card), 0)); }
  function mergeCard(pa, pb, tomb) {
    var a = pa.card, b = pb.card;
    var keyA = JSON.stringify(a) + "|" + pa.colId;
    var keyB = JSON.stringify(b) + "|" + pb.colId;
    if (keyA === keyB) return { card: clone(a), colId: pa.colId };
    var tie = strCmp(keyA, keyB);                 // the old engine's tie-break
    var la = !fmValid(a), lb = !fmValid(b);
    if (la && lb) {
      var aNew = (a.mtime || 0) !== (b.mtime || 0) ? (a.mtime || 0) > (b.mtime || 0) : tie > 0;
      return aNew ? { card: clone(a), colId: pa.colId } : { card: clone(b), colId: pb.colId };
    }
    var values = {}, stamps = {};
    var allA = true, allB = true;
    GROUPS.forEach(function (g) {
      var ea = eff(a, g), eb = eff(b, g);
      var aw = ea !== eb ? ea > eb : tie > 0;
      stamps[g] = aw ? ea : eb;
      var v;
      if (g === "p") v = aw ? pa.colId : pb.colId;
      else if (LIST_GROUPS[g]) {
        var lA = fieldVal(a, g), lB = fieldVal(b, g);
        v = mergeItems(lA, lB, aw, la ? (a.mtime || 0) : null, lb ? (b.mtime || 0) : null, tomb, a.id);
        if (stripM(v) !== stripM(aw ? lA : lB)) aw = null;
      } else v = clone(fieldVal(aw ? a : b, g));
      values[g] = v;
      if (aw !== true) allA = false;
      if (aw !== false) allB = false;
    });
    if (allA) return { card: clone(a), colId: pa.colId };
    if (allB) return { card: clone(b), colId: pb.colId };
    // Mixed: base = the newer whole card (unknown keys of a newer
    // version ride along), every group from its winner.
    var mt = Math.max(a.mtime || 0, b.mtime || 0);
    var base = clone((a.mtime || 0) !== (b.mtime || 0) ? ((a.mtime || 0) > (b.mtime || 0) ? a : b) : (tie > 0 ? a : b));
    GROUPS.forEach(function (g) { if (g !== "p") setField(base, g, values[g]); });
    base.fm = {};
    GROUPS.forEach(function (g) { base.fm[g] = stamps[g]; });
    base.fm.m = mt;
    base.mtime = mt;
    var cj = canonJson(base);
    if (cj === canonJson(a) && values.p === pa.colId) return { card: clone(a), colId: pa.colId };
    if (cj === canonJson(b) && values.p === pb.colId) return { card: clone(b), colId: pb.colId };
    base.mtime = mt + 1;
    base.fm.m = mt + 1;
    return { card: base, colId: values.p };
  }

  function wholeCard(pa, pb) {
    if ((pa.card.mtime || 0) !== (pb.card.mtime || 0)) return clone((pa.card.mtime || 0) > (pb.card.mtime || 0) ? pa : pb);
    return clone(JSON.stringify(pa.card) + "|" + pa.colId >= JSON.stringify(pb.card) + "|" + pb.colId ? pa : pb);
  }
  function flattenSide(board) {
    var out = {};
    ((board && board.columns) || []).forEach(function (col) {
      (col.cards || []).forEach(function (card) { out[card.id] = { card: card, colId: col.id }; });
    });
    return out;
  }
  function stripCards(c) { var h = clone(c); delete h.cards; return h; }
  function mergeColHeaders(la, lb) {
    var head = newerEntity(stripCards(la), stripCards(lb));
    head.om = Math.max(la.om || 0, lb.om || 0);
    return head;
  }

  function mergeBoardBody(ba, bb, now, whole) {
    var tomb = mergeEntityMaps(ba.deleted, bb.deleted);
    var cutoff = now - TOMB_LIFETIME_MS;
    Object.keys(tomb).forEach(function (id) { if (tomb[id] < cutoff) delete tomb[id]; });

    var labels = unionEntities(ba.labels || [], bb.labels || [], tomb);

    var colPairs = {};
    var pairColumns = function (arr) {
      (arr || []).forEach(function (col) { (colPairs[col.id] = colPairs[col.id] || []).push(col); });
    };
    pairColumns(ba.columns); pairColumns(bb.columns);
    var mergedCols = {};
    Object.keys(colPairs).forEach(function (id) {
      var pair = colPairs[id];
      var head = pair.length === 2 ? mergeColHeaders(pair[0], pair[1]) : stripCards(pair[0]);
      if (!entAlive(head, tomb)) return;
      mergedCols[id] = { head: head, cards: [], refA: pair[0] || null, refB: pair[1] || null };
    });

    var fa = flattenSide(ba), fb = flattenSide(bb);
    var cardIds = {};
    Object.keys(fa).forEach(function (id) { cardIds[id] = true; });
    Object.keys(fb).forEach(function (id) { cardIds[id] = true; });
    Object.keys(cardIds).forEach(function (id) {
      var pa = fa[id], pb = fb[id];
      var win = pa && pb ? (whole ? wholeCard(pa, pb) : mergeCard(pa, pb, tomb)) : { card: clone((pa || pb).card), colId: (pa || pb).colId };
      if (!entAlive(win.card, tomb)) return;
      var mc = mergedCols[win.colId];
      if (!mc) return;                                 // orphan rule
      mc.cards.push(win.card);
    });
    Object.keys(mergedCols).forEach(function (id) {
      var mc = mergedCols[id];
      orderEntities(mc.cards, pickRef((mc.refA && mc.refA.cards) || [], (mc.refB && mc.refB.cards) || [],
                                      mc.refA ? mc.refA.om || 0 : 0, mc.refB ? mc.refB.om || 0 : 0));
    });

    var hdr = function (x) { return { id: x.id, name: x.name, archived: !!x.archived, color: x.color || null, mtime: x.mtime }; };
    var head = newerEntity(hdr(ba), hdr(bb));
    var cols = [];
    Object.keys(mergedCols).forEach(function (id) {
      var mc = mergedCols[id];
      mc.head.cards = mc.cards;
      cols.push(mc.head);
    });
    return {
      id: ba.id,
      name: head.name,
      archived: head.archived,
      color: head.color || undefined,
      mtime: Math.max(ba.mtime || 0, bb.mtime || 0),
      om: Math.max(ba.om || 0, bb.om || 0),
      deleted: tomb,
      labels: orderEntities(labels, pickRef(ba.labels || [], bb.labels || [], ba.om || 0, bb.om || 0)),
      columns: orderEntities(cols, pickRef(ba.columns || [], bb.columns || [], ba.om || 0, bb.om || 0))
    };
  }

  function boardAlive(board, rootTomb) {
    var ts = rootTomb[board.id];
    return ts === undefined || (board.mtime || 0) > ts;
  }

  // Root merge — the sync engine's mergeFn. `now` only for tests.
  // whole = the pre-K1 rule (whole newer card), kept for the tests that
  // check a mixed fleet of old and new devices converges.
  function mergeKanbanStates(A, B, now, whole) {
    now = typeof now === "number" ? now : Date.now();
    var a = A || {}, b = B || {};
    var boardTomb = mergeEntityMaps(a.boardDeleted, b.boardDeleted);
    var cutoff = now - TOMB_LIFETIME_MS;
    Object.keys(boardTomb).forEach(function (id) { if (boardTomb[id] < cutoff) delete boardTomb[id]; });
    var pairs = {};
    var pairBoards = function (arr) {
      (arr || []).forEach(function (bd) { if (bd && bd.id) (pairs[bd.id] = pairs[bd.id] || []).push(bd); });
    };
    pairBoards(a.boards); pairBoards(b.boards);
    var merged = [];
    Object.keys(pairs).forEach(function (id) {
      var pair = pairs[id], bd;
      if (pair.length === 2) bd = mergeBoardBody(pair[0], pair[1], now, whole);
      else {
        var src = pair[0];
        bd = { id: src.id, name: src.name, archived: src.archived, color: src.color || undefined,
               mtime: src.mtime, om: src.om, deleted: clone(src.deleted || {}),
               labels: clone(src.labels || []), columns: clone(src.columns || []) };
      }
      if (!boardAlive(bd, boardTomb)) return;
      merged.push(bd);
    });
    if (merged.length === 0) return null;
    orderEntities(merged, pickRef(a.boards || [], b.boards || [], a.om || 0, b.om || 0));
    return canonState({ ver: DATA_VER, om: Math.max(a.om || 0, b.om || 0), boardDeleted: boardTomb, boards: merged }, now);
  }

  // ---------- canonical synced form (KN-7) ----------
  function canonOrder(obj, keys) {
    var out = {};
    keys.forEach(function (k) { if (obj[k] !== undefined) out[k] = obj[k]; });
    Object.keys(obj).sort().forEach(function (k) {
      if (keys.indexOf(k) === -1 && obj[k] !== undefined) out[k] = obj[k];
    });
    return out;
  }
  function canonTombs(map, now) {
    var out = {};
    var cutoff = now - TOMB_LIFETIME_MS;
    Object.keys(map || {}).sort().forEach(function (id) {
      var ts = map[id];
      if (typeof ts === "number" && ts >= cutoff) out[id] = ts;
    });
    return out;
  }
  var CARD_KEYS  = ["id", "text", "notes", "due", "labels", "subtasks", "info", "mtime", "pos"];
  var COL_KEYS   = ["id", "name", "mtime", "om", "pos", "cards"];
  var LABEL_KEYS = ["id", "name", "color", "mtime", "pos"];
  var BOARD_KEYS = ["id", "name", "archived", "color", "mtime", "om", "pos", "deleted", "labels", "columns"];
  var SUB_KEYS   = ["id", "text", "completed", "m"];
  var ATT_KEYS   = ["id", "name", "file", "kind", "size", "m"];
  var AUTO_KEYS  = ["done", "today", "label", "top"];

  function canonFm(fm) {
    var out = {};
    Object.keys(fm).sort().forEach(function (k) { if (typeof fm[k] === "number") out[k] = fm[k]; });
    return out;
  }
  function canonCard(c, ki) {
    c.pos = ki;
    if (Array.isArray(c.subtasks)) c.subtasks = c.subtasks.map(function (s) { return s && typeof s === "object" ? canonOrder(s, SUB_KEYS) : s; });
    if (Array.isArray(c.att)) {
      if (c.att.length) c.att = c.att.map(function (x) { return x && typeof x === "object" ? canonOrder(x, ATT_KEYS) : x; });
      else delete c.att;
    }
    if (c.fm && typeof c.fm === "object") c.fm = canonFm(c.fm);
    if (c.lane === "" || c.lane === null) delete c.lane;
    if (c.cover === "" || c.cover === null) delete c.cover;
    return canonOrder(c, CARD_KEYS);
  }
  function canonCol(col, ci) {
    col.pos = ci;
    col.cards = (col.cards || []).map(canonCard);
    if (col.auto && typeof col.auto === "object") col.auto = canonOrder(col.auto, AUTO_KEYS);
    return canonOrder(col, COL_KEYS);
  }
  function canonState(src, now) {
    now = typeof now === "number" ? now : Date.now();
    var s = clone(src || {});
    var boards = (Array.isArray(s.boards) ? s.boards : []).map(function (b, bi) {
      var labels = (b.labels || []).map(function (lb, i) { lb.pos = i; return canonOrder(lb, LABEL_KEYS); });
      var columns = (b.columns || []).map(canonCol);
      b.archived = !!b.archived;
      if (!b.color) delete b.color;
      b.pos = bi;
      b.deleted = canonTombs(b.deleted, now);
      b.labels = labels;
      b.columns = columns;
      return canonOrder(b, BOARD_KEYS);
    });
    delete s.activeBoardId;
    s.ver = DATA_VER;
    s.om = typeof s.om === "number" ? s.om : 0;
    s.boardDeleted = canonTombs(s.boardDeleted, now);
    s.boards = boards;
    return canonOrder(s, ["ver", "om", "boardDeleted", "boards"]);
  }

  var api = {
    DATA_VER: DATA_VER, TOMB_LIFETIME_MS: TOMB_LIFETIME_MS, GROUPS: GROUPS,
    isTpl: isTpl, fmValid: fmValid, eff: eff, stampCard: stampCard, stampItem: stampItem,
    freshFm: freshFm, itemTomb: itemTomb,
    mergeCard: mergeCard, mergeItems: mergeItems, mergeBoardBody: mergeBoardBody,
    mergeKanbanStates: mergeKanbanStates, canonState: canonState
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosKanbanModel = api;
})(typeof window !== "undefined" ? window : globalThis);
