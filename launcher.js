// ============================================================
// orOS — launcher.js (favourites: desktop shortcuts + Dock, menu apps, v1.10.0)
// ------------------------------------------------------------
// A shell component, like pet.js: it runs IN the shell document,
// keeps its own storage and registers its own sync slice. shell.js
// only calls attach() once at boot, refresh() after every menu
// render, menuRow() for each app row of the menu and
// renderSettings() for the Dock section. A bundle without this file
// draws exactly what it drew before.
//
//   • The menu: a star at the end of every app row opens a small
//     panel with two switches, "On the desktop" and "In the Dock".
//     The star is filled while the app has a shortcut anywhere.
//   • The desktop: shortcuts in an automatic grid, in the order they
//     were added. Tap opens; right-click, a long press or the
//     context-menu key opens a small menu (Open · Move earlier ·
//     Move later · Remove).
//   • The Dock: a mac-style bar at the bottom, OFF until the user
//     turns it on in Settings (size, style, hover effect, auto-hide,
//     over open apps: off until chosen). Same small menu; mouse users can also drag.
//     Groups (1.10.0, DOCK-GRP): drop an app on the middle of another
//     icon, or "Put in a group with…" in its menu, and both go into a
//     named group tile; tapping it opens a panel (rename, open, take
//     out, Ungroup). Synced with the Dock order (section 1a).
//     While it is shown, --tb-h lifts the pet and the desktop grid.
//   • Menu apps (1.3.0): which apps the menu lists (Settings › Menu).
//     A hidden app still opens from search, deep links, the desktop
//     and the Dock. Synced as its own slice "menu" (section 1b).
//     1.4.0: a first-run profile (profiles.js) hides apps through
//     menuPreset (mtime 1: any real choice wins the merge).
//   • 1.5.0: a shortcut of an app that became an alias (apps.json
//     "aliases") shows its new home and opens it at the old place.
//   • 1.6.0: the Dock can sit at the bottom (default), left, right or
//     top edge (Settings › Dock › Position). Narrow or short screens
//     (phones) keep it at the bottom whatever is chosen (dockSide).
//   • 1.8.0 (BADGE-1): a small red count on a desktop shortcut or a
//     Dock icon = the app's unread notices in the inbox (notifications.js
//     items by `ns`) plus, for To-Do and Today, the tasks whose day has
//     passed. Never on a sensitive app (apps.json searchOff, Passwords,
//     the Assistant, an app with a lock), none at all under Sensitive
//     work, and none when "Show counts on icons" is off (on by default,
//     device-local pref `badges`). Pure part: badgeCounts / badgeText.
//   • 1.9.0 (DOCK-CARDS): "Cards in the Dock" (pref `cards`, off by
//     default) puts the smart top bar's cards (smartbar.js) in #ld-cards
//     at the end of a bottom Dock on windows at least 760 px wide;
//     elsewhere they stay in the top bar. Pure part: cardsHere.
//
// Data (synced, slice "launcher", key oros-launcher-data):
//   { ver:1, items:[{ id, desk, dock, mtime }] }
//   • id    = the app id from apps.json;
//   • desk  = order key on the desktop, or null (not there);
//   • dock  = order key in the Dock, or null (not there);
//   • mtime = ms of the last change to THIS item (R27: stamped at the
//     mutation site only).
//   Order keys are fractional: moving one shortcut rewrites only that
//   item, so two devices reordering different apps never fight.
//   Removing both places keeps the item with a new mtime: it is its
//   own tombstone (at most one item per app id, so it stays small).
//   DOCK-GRP (1.10.0): an item in the Dock may carry `grp` (a group id
//   "g…"), written only while set; `groups:[{ id, name, dock, mtime }]`
//   appears once there is a group (dock null = ungrouped, a tombstone).
//   An older device drops both: its next change to that app takes it
//   out of the group, and nothing else is lost (the merge is a union).
// Merge: union by id; per id the higher mtime wins, a tie goes to the
//   greater canonical JSON. Items sorted by id, fixed field order
//   (R26). A fresh device stores nothing until the first real change.
// Pure logic (normalize, merge, pin, move, list) is unit-tested in
// node (tests/launcher.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.10.0";
  var DATA_KEY = "oros-launcher-data";
  var MENU_KEY = "oros-menu-apps";
  var MAX_ITEMS = 500;
  var ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
  var PLACES = ["desk", "dock"];
  var GID_RE = /^g[a-z0-9]{1,23}$/;          // DOCK-GRP group ids
  var GNAME_MAX = 40, MAX_GROUPS = 60;

  // ---------- FWD-1: fields of a newer orOS survive this one ----------
  // (Chris 2026-11-28, sync audit proposal 6.) An older orOS used to
  // drop what it did not know; its copy then differed from the cloud,
  // so it uploaded it without them, the newer device put them back,
  // and so on. Now unknown fields (name ^[a-z][a-zA-Z0-9]{0,23}$, at
  // most MORE_N, MORE_MAX characters of JSON each) are kept as they
  // came, in the key order they came in (the engine compares JSON
  // text), and never used here. Without such fields nothing changes.
  var MORE_RE = /^[a-z][a-zA-Z0-9]{0,23}$/, MORE_N = 16;
  function moreOwn(o, k) { return !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k); }
  // `out` (cleaned, our key order) plus the fields of `src` this orOS
  // does not know (`known`: ours, also those it drops on purpose).
  function withMore(src, out, known, max) {
    if (!src || typeof src !== "object" || Array.isArray(src)) return out;
    var more = {}, n = 0;
    Object.keys(src).forEach(function (k) {
      if (n >= MORE_N || known.indexOf(k) >= 0 || moreOwn(out, k) || !MORE_RE.test(k)) return;
      var s;
      try { s = JSON.stringify(src[k]); } catch (e) { return; }
      if (typeof s !== "string" || s.length > (max || 1024)) return;
      more[k] = JSON.parse(s);
      n++;
    });
    if (!n) return out;
    var res = {};
    Object.keys(src).forEach(function (k) {
      if (moreOwn(out, k)) res[k] = out[k];
      else if (moreOwn(more, k)) res[k] = more[k];
    });
    Object.keys(out).forEach(function (k) { if (!moreOwn(res, k)) res[k] = out[k]; });
    return res;
  }
  // Two whole copies as one source for withMore: per field the larger
  // JSON, in the key order of the copy with the larger key list (the
  // same answer in both argument orders).
  function moreSrc(a, b) {
    var A = (a && typeof a === "object") ? a : {}, B = (b && typeof b === "object") ? b : {};
    var first = JSON.stringify(Object.keys(A)) >= JSON.stringify(Object.keys(B)) ? A : B;
    var second = first === A ? B : A, src = {};
    Object.keys(first).concat(Object.keys(second)).forEach(function (k) {
      if (moreOwn(src, k)) return;
      var p = moreOwn(A, k) ? A[k] : undefined, q = moreOwn(B, k) ? B[k] : undefined;
      src[k] = p === undefined ? q : q === undefined ? p : (JSON.stringify(p) >= JSON.stringify(q) ? p : q);
    });
    return src;
  }

  var ITEM_KNOWN = ["id", "desk", "dock", "grp", "mtime"];
  var GROUP_KNOWN = ["id", "name", "dock", "mtime"];
  var MENU_KNOWN = ["id", "hidden", "mtime"];
  var TOP_KNOWN = ["ver", "items", "groups"];
  var MENU_TOP_KNOWN = ["ver", "apps"];

  // ---------- 1. Model (pure) ----------
  function num(v) {
    return (typeof v === "number" && isFinite(v)) ? v : null;
  }

  function cleanItem(it) {
    if (!it || typeof it !== "object" || typeof it.id !== "string" || !ID_RE.test(it.id)) return null;
    var m = (typeof it.mtime === "number" && isFinite(it.mtime) && it.mtime >= 0) ? Math.floor(it.mtime) : 0;
    var out = { id: it.id, desk: num(it.desk), dock: num(it.dock) };
    if (out.dock !== null && typeof it.grp === "string" && GID_RE.test(it.grp)) out.grp = it.grp;   // DOCK-GRP
    out.mtime = m;
    return withMore(it, out, ITEM_KNOWN);
  }

  // DOCK-GRP: a group in the Dock { id, name, dock, mtime }; dock null =
  // ungrouped (its own tombstone, like an item).
  function cleanGroup(g) {
    if (!g || typeof g !== "object" || typeof g.id !== "string" || !GID_RE.test(g.id)) return null;
    var m = (typeof g.mtime === "number" && isFinite(g.mtime) && g.mtime >= 0) ? Math.floor(g.mtime) : 0;
    return withMore(g, { id: g.id, name: groupName(g.name), dock: num(g.dock), mtime: m }, GROUP_KNOWN);
  }
  function groupName(v) {
    return String(typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, GNAME_MAX);
  }

  // The winner between two versions of the same app's item.
  function newer(a, b) {
    if (a.mtime !== b.mtime) return a.mtime > b.mtime ? a : b;
    // DOCK-GRP: a tie between the same item with and without `grp` is
    // an older device's copy that dropped it: keep the group.
    if (!a.grp !== !b.grp) return a.grp ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  // The single funnel: load, save, merge output, slice get and set.
  function normalize(data) {
    var byId = {};
    var list = (data && typeof data === "object" && Array.isArray(data.items)) ? data.items : [];
    for (var i = 0; i < list.length; i++) {
      var it = cleanItem(list[i]);
      if (!it) continue;
      byId[it.id] = byId[it.id] ? newer(byId[it.id], it) : it;
    }
    var ids = Object.keys(byId).sort();
    if (ids.length > MAX_ITEMS) ids = ids.slice(0, MAX_ITEMS);
    var out = { ver: 1, items: ids.map(function (id) { return byId[id]; }) };
    // DOCK-GRP: "groups" only once there is one (older data stays as it was).
    var gById = {};
    var gl = (data && typeof data === "object" && Array.isArray(data.groups)) ? data.groups : [];
    for (var j = 0; j < gl.length; j++) {
      var g = cleanGroup(gl[j]);
      if (!g) continue;
      gById[g.id] = gById[g.id] ? newer(gById[g.id], g) : g;
    }
    var gids = Object.keys(gById).sort();
    if (gids.length > MAX_GROUPS) gids = gids.slice(0, MAX_GROUPS);
    if (gids.length) out.groups = gids.map(function (id) { return gById[id]; });
    return withMore(data, out, TOP_KNOWN, 8192);
  }

  function merge(a, b) {
    var na = normalize(a), nb = normalize(b);
    var out = normalize({ items: na.items.concat(nb.items), groups: (na.groups || []).concat(nb.groups || []) });
    return withMore(moreSrc(na, nb), out, TOP_KNOWN, 8192);
  }

  function find(data, id) {
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id) return data.items[i];
    return null;
  }

  // Ids placed in `place`, in their shown order (order key, then id).
  function list(data, place) {
    return data.items.filter(function (it) { return it[place] !== null; })
      .sort(function (a, b) { return (a[place] - b[place]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); })
      .map(function (it) { return it.id; });
  }

  function isPinned(data, id, place) {
    var it = find(data, id);
    if (!it) return false;
    if (place) return it[place] !== null;
    return it.desk !== null || it.dock !== null;
  }

  // Returns a NEW normalized object; the input is never mutated.
  function withItem(data, id, fields, now) {
    var d = normalize(data);
    var it = find(d, id);
    // FWD-1: a stored item keeps its fields (and their order).
    var next = it ? JSON.parse(JSON.stringify(it)) : { id: id, desk: null, dock: null, mtime: 0 };
    next.mtime = Math.max(now, it ? it.mtime + 1 : 0);
    Object.keys(fields).forEach(function (k) { next[k] = fields[k]; });
    var items = d.items.filter(function (x) { return x.id !== id; });
    items.push(next);
    return withMore(d, normalize({ items: items, groups: d.groups }), TOP_KNOWN, 8192);
  }

  // Pin goes to the END of the place; unpin clears it. No-op when the
  // state is already right (mtime moves only on a real change).
  function pin(data, id, place, on, now) {
    var d = normalize(data);
    if (!ID_RE.test(String(id)) || PLACES.indexOf(place) === -1) return d;
    if (isPinned(d, id, place) === !!on) return d;
    var f = {};
    if (on) {
      var max = 0;
      d.items.forEach(function (it) { if (it[place] !== null && it[place] > max) max = it[place]; });
      f[place] = Math.floor(max) + 1;
    } else {
      f[place] = null;
    }
    return withItem(d, id, f, now);
  }

  // dir -1 = earlier, +1 = later. Only the moved item changes, unless
  // the keys have become too close to split: then the whole place is
  // renumbered 1..n (every item stamped, rare).
  function move(data, id, place, dir, now) {
    var d = normalize(data);
    var ids = list(d, place);
    var i = ids.indexOf(id);
    var j = i + (dir < 0 ? -1 : 1);
    if (i === -1 || j < 0 || j >= ids.length) return d;
    var key = function (k) { return find(d, ids[k])[place]; };
    var lo, hi;
    if (dir < 0) { hi = key(j); lo = (j - 1 >= 0) ? key(j - 1) : hi - 2; }
    else { lo = key(j); hi = (j + 1 < ids.length) ? key(j + 1) : lo + 2; }
    var mid = (lo + hi) / 2;
    if (!(mid > lo && mid < hi) || hi - lo < 1e-6) {
      ids.splice(i, 1);
      ids.splice(j, 0, id);
      var out = d;
      ids.forEach(function (x, n) {
        var f = {}; f[place] = n + 1;
        out = withItem(out, x, f, now);
      });
      return out;
    }
    var f = {}; f[place] = mid;
    return withItem(d, id, f, now);
  }

  // Drop `id` at position `index` of the place (0 = first), as a drag
  // does. Same rules as move(): one item changes, or a renumbering.
  function moveTo(data, id, place, index, now) {
    var d = normalize(data);
    var ids = list(d, place);
    var i = ids.indexOf(id);
    if (i === -1) return d;
    index = Math.max(0, Math.min(ids.length - 1, Math.floor(index)));
    if (index === i) return d;
    while (i !== index) {
      var dir = index < i ? -1 : 1;
      d = move(d, id, place, dir, now);
      i += dir;
    }
    return d;
  }

  // ---------- 1a. Dock groups (DOCK-GRP, pure) ----------
  // Drop an app on an app in the Dock: both go into a named group (a
  // folder tile that opens a small panel). Synced with the Dock order
  // ("launcher" slice): a member item carries `grp`, the group has its
  // own order key among the Dock's entries. A group shows while two or
  // more of its members are in the Dock; one left goes back to being
  // a plain icon at the group's place.
  function idCmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function findGroup(d, gid) {
    var gs = d.groups || [];
    for (var i = 0; i < gs.length; i++) if (gs[i].id === gid) return gs[i];
    return null;
  }
  function withGroup(data, gid, fields, now) {
    var d = normalize(data);
    var g = findGroup(d, gid);
    var next = g ? JSON.parse(JSON.stringify(g)) : { id: gid, name: "", dock: null, mtime: 0 };   // FWD-1: keeps its fields
    next.mtime = Math.max(now, g ? g.mtime + 1 : 0);
    Object.keys(fields).forEach(function (k) { next[k] = fields[k]; });
    var gs = (d.groups || []).filter(function (x) { return x.id !== gid; });
    gs.push(next);
    return withMore(d, normalize({ items: d.items, groups: gs }), TOP_KNOWN, 8192);
  }
  function setGrp(d, id, gid, dockKey, now) {
    var f = { grp: gid || undefined };
    if (dockKey !== undefined) f.dock = dockKey;
    var out = withItem(d, id, f, now);
    if (!gid) { var it = find(out, id); if (it) delete it.grp; }
    return normalize(out);
  }
  function membersOf(d, gid) {
    return list(d, "dock").filter(function (id) { return find(d, id).grp === gid; });
  }
  // The Dock as shown, in order: { app, key } or { group, name, ids, key }.
  // okIds (optional): the ids that may show (an alias once).
  function dockEntries(data, okIds) {
    var d = normalize(data);
    var ids = list(d, "dock");
    if (okIds) ids = ids.filter(function (id) { return okIds.indexOf(id) >= 0; });
    var live = {};
    (d.groups || []).forEach(function (g) { if (g.dock !== null) live[g.id] = { group: g.id, name: g.name, ids: [], key: g.dock }; });
    ids.forEach(function (id) { var it = find(d, id); if (it.grp && live[it.grp]) live[it.grp].ids.push(id); });
    var out = [];
    ids.forEach(function (id) {
      var it = find(d, id), g = it.grp && live[it.grp];
      if (!g || g.ids.length < 2) out.push({ app: id, key: it.dock });
    });
    Object.keys(live).forEach(function (gid) { if (live[gid].ids.length >= 2) out.push(live[gid]); });
    out.sort(function (a, b) { return (a.key - b.key) || idCmp(a.app || a.group, b.app || b.group); });
    return out;
  }
  function entryIs(e, ref) { return ref.group ? e.group === ref.group : e.app === ref.app; }
  function setEntryKey(d, e, key, now) {
    if (e.group) return withGroup(d, e.group, { dock: key }, now);
    var f = { dock: key };
    return withItem(d, e.app, f, now);
  }
  // The key between the entry before `index` and the one at it.
  function keyAt(entries, index) {
    var prev = index > 0 ? entries[index - 1].key : null, next = index < entries.length ? entries[index].key : null;
    if (prev === null && next === null) return 1;
    if (prev === null) return next - 1;
    if (next === null) return Math.floor(prev) + 1;
    var mid = (prev + next) / 2;
    return (mid > prev && mid < next && next - prev >= 1e-6) ? mid : null;
  }
  // Drop the entry `ref` ({ app } or { group }) at position `index` of
  // the shown Dock. One entry changes, or (keys too close) all renumber.
  function dockMoveTo(data, ref, index, okIds, now) {
    var d = normalize(data);
    var es = dockEntries(d, okIds);
    var i = -1;
    for (var k = 0; k < es.length; k++) if (entryIs(es[k], ref)) i = k;
    if (i === -1) return d;
    index = Math.max(0, Math.min(es.length - 1, Math.floor(index)));
    if (index === i) return d;
    var e = es.splice(i, 1)[0];
    var key = keyAt(es, index);
    if (key !== null) return setEntryKey(d, e, key, now);
    es.splice(index, 0, e);
    es.forEach(function (x, n) { d = setEntryKey(d, x, n + 1, now); });
    return d;
  }
  // A group with fewer than two members left goes: the last one takes
  // the group's place.
  function dissolveSmall(d, gid, now) {
    var g = findGroup(d, gid);
    if (!g || g.dock === null) return d;
    var ms = membersOf(d, gid);
    if (ms.length >= 2) return d;
    if (ms.length === 1) d = setGrp(d, ms[0], null, g.dock, now);
    return withGroup(d, gid, { dock: null }, now);
  }
  // Put app `id` into a group with `target` ({ app } or { group }).
  // `gid` and `name` are used when a new group is made.
  function groupAdd(data, id, target, gid, name, now) {
    var d = normalize(data);
    if (!ID_RE.test(String(id)) || !target) return d;
    var old = find(d, id) && find(d, id).grp;
    var into = null, key;
    if (target.group) {
      var g = findGroup(d, target.group);
      if (!g || g.dock === null) return d;
      into = g.id;
    } else {
      var t = find(d, target.app);
      if (!t || t.dock === null || target.app === id) return d;
      var tg = t.grp && findGroup(d, t.grp);
      if (tg && tg.dock !== null && membersOf(d, tg.id).length >= 2) into = tg.id;
      else {
        if (!GID_RE.test(String(gid))) return d;
        key = t.dock;
        d = withGroup(d, gid, { name: groupName(name), dock: key }, now);
        d = setGrp(d, target.app, gid, undefined, now);
        into = gid;
      }
    }
    if (old === into) return d;
    var it = find(d, id);
    d = setGrp(d, id, into, it && it.dock !== null ? undefined : findGroup(d, into).dock, now);
    if (old && old !== into) d = dissolveSmall(d, old, now);
    return d;
  }
  // Take app `id` out of its group: it lands right after the group.
  function groupLeave(data, id, okIds, now) {
    var d = normalize(data);
    var it = find(d, id);
    if (!it || !it.grp) return d;
    var gid = it.grp, es = dockEntries(d, okIds), at = -1;
    for (var k = 0; k < es.length; k++) if (es[k].group === gid) at = k;
    var key = at === -1 ? it.dock : keyAt(es, at + 1);
    if (key === null) key = it.dock;
    d = setGrp(d, id, null, key, now);
    return dissolveSmall(d, gid, now);
  }
  function groupRename(data, gid, name, now) {
    var d = normalize(data), g = findGroup(d, gid), n = groupName(name);
    if (!g || !n || n === g.name) return d;
    return withGroup(d, gid, { name: n }, now);
  }
  // Every member back to a plain icon, in the group's place and order.
  function groupUngroup(data, gid, okIds, now) {
    var d = normalize(data), g = findGroup(d, gid);
    if (!g || g.dock === null) return d;
    var es = dockEntries(d, okIds), at = -1;
    for (var k = 0; k < es.length; k++) if (es[k].group === gid) at = k;
    var lo = g.dock, hi = at >= 0 && at + 1 < es.length ? es[at + 1].key : lo + 1;
    var ms = membersOf(d, gid);
    ms.forEach(function (id, n) { d = setGrp(d, id, null, lo + (hi - lo) * n / ms.length, now); });
    return withGroup(d, gid, { dock: null }, now);
  }

  // ---------- 1b. Apps shown in the menu (pure) ----------
  // Data (synced, slice "menu", key oros-menu-apps):
  //   { ver:1, apps:[{ id, hidden, mtime }] }
  //   An app without an item is shown, so a new app always appears.
  //   Showing an app again keeps its item (hidden:false, new mtime):
  //   it is its own tombstone, at most one item per app id.
  // Merge: union by id, per id the higher mtime wins, a tie goes to the
  //   greater canonical JSON (hidden:true). Items sorted by id (R26).
  function cleanMenuItem(it) {
    if (!it || typeof it !== "object" || typeof it.id !== "string" || !ID_RE.test(it.id)) return null;
    var m = (typeof it.mtime === "number" && isFinite(it.mtime) && it.mtime >= 0) ? Math.floor(it.mtime) : 0;
    return withMore(it, { id: it.id, hidden: it.hidden === true, mtime: m }, MENU_KNOWN);
  }

  function menuNormalize(data) {
    var byId = {};
    var list = (data && typeof data === "object" && Array.isArray(data.apps)) ? data.apps : [];
    for (var i = 0; i < list.length; i++) {
      var it = cleanMenuItem(list[i]);
      if (!it) continue;
      byId[it.id] = byId[it.id] ? newer(byId[it.id], it) : it;
    }
    var ids = Object.keys(byId).sort();
    if (ids.length > MAX_ITEMS) ids = ids.slice(0, MAX_ITEMS);
    return withMore(data, { ver: 1, apps: ids.map(function (id) { return byId[id]; }) }, MENU_TOP_KNOWN, 8192);
  }

  function menuMerge(a, b) {
    var na = menuNormalize(a), nb = menuNormalize(b);
    return withMore(moreSrc(na, nb), menuNormalize({ apps: na.apps.concat(nb.apps) }), MENU_TOP_KNOWN, 8192);
  }

  // Ids hidden from the menu, sorted.
  function menuHiddenIds(data) {
    return menuNormalize(data).apps.filter(function (it) { return it.hidden; })
      .map(function (it) { return it.id; });
  }

  // Hide (or show) every id in `ids`. Only the apps whose state really
  // changes get a new item and mtime (R27); a new NORMALIZED object is
  // returned and the input is never mutated.
  function menuSetHidden(data, ids, hidden, now) {
    var d = menuNormalize(data);
    var byId = {};
    d.apps.forEach(function (it) { byId[it.id] = it; });
    var want = hidden === true;
    var changed = false;
    (Array.isArray(ids) ? ids : [ids]).forEach(function (id) {
      if (typeof id !== "string" || !ID_RE.test(id)) return;
      var cur = byId[id];
      if ((cur ? cur.hidden : false) === want) return;
      byId[id] = Object.assign(cur ? JSON.parse(JSON.stringify(cur)) : { id: id }, { hidden: want, mtime: Math.max(now, cur ? cur.mtime + 1 : 0) });   // FWD-1: keeps its fields
      changed = true;
    });
    if (!changed) return d;
    return withMore(d, menuNormalize({ apps: Object.keys(byId).map(function (id) { return byId[id]; }) }), MENU_TOP_KNOWN, 8192);
  }

  // First-run profile (profiles.js): hide `ids` with mtime 1, and only
  // the apps that have no item yet. A choice the user ever made on any
  // device (a real mtime) wins every merge over a profile's guess, so a
  // second device picking a profile before it syncs never hides apps
  // the user had chosen to show elsewhere.
  function menuPreset(data, ids) {
    var d = menuNormalize(data);
    var byId = {};
    d.apps.forEach(function (it) { byId[it.id] = it; });
    var changed = false;
    (Array.isArray(ids) ? ids : [ids]).forEach(function (id) {
      if (typeof id !== "string" || !ID_RE.test(id) || byId[id]) return;
      byId[id] = { id: id, hidden: true, mtime: 1 };
      changed = true;
    });
    if (!changed) return d;
    return withMore(d, menuNormalize({ apps: Object.keys(byId).map(function (id) { return byId[id]; }) }), MENU_TOP_KNOWN, 8192);
  }

  // ---------- 1c. Dock position (pure) ----------
  // The edge the Dock really uses: the chosen one on a screen at least
  // SIDE_W wide and SIDE_H tall, else the bottom (a phone, a small
  // window). Unknown values are the bottom.
  var POSITIONS = ["bottom", "left", "right", "top"];
  var SIDE_W = 600, SIDE_H = 480;
  function dockSide(pos, w, h) {
    if (POSITIONS.indexOf(pos) < 1) return "bottom";
    return (Number(w) >= SIDE_W && Number(h) >= SIDE_H) ? pos : "bottom";
  }

  // ---------- 1c. Count badges (BADGE-1, pure) ----------
  // Apps that never show a count whatever else says (the Gate's NEVER
  // list); apps.json searchOff apps and locked apps join them at run time.
  var BADGE_NEVER = ["assistant", "passwords"];
  // items   the notification inbox (unread = no readAt; app = ns)
  // overdue { appId: n } tasks whose day passed (To-Do, Today)
  // hidden  { appId: true } apps that never show a count
  // → { appId: n } only the apps with n > 0
  function badgeCounts(items, overdue, hidden) {
    var out = {};
    function add(id, n) {
      if (typeof id !== "string" || !ID_RE.test(id) || !(n > 0)) return;
      if (BADGE_NEVER.indexOf(id) >= 0 || (hidden && hidden[id] === true)) return;
      out[id] = (out[id] || 0) + Math.floor(n);
    }
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (it && typeof it === "object" && !it.readAt) add(it.ns, 1);
    });
    if (overdue && typeof overdue === "object") {
      Object.keys(overdue).forEach(function (k) { add(k, Number(overdue[k])); });
    }
    return out;
  }
  function badgeText(n) { return n > 99 ? "99+" : String(n); }
  // To-Do's agenda rows (orosToday.agenda) → how many tasks are late.
  function lateTasks(rows, today) {
    var n = 0;
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (r && r.kind === "task" && typeof r.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.due) && r.due < today) n++;
    });
    return n;
  }

  // ---------- 1d. Cards in the Dock (DOCK-CARDS, pure) ----------
  // The smart top bar's cards sit at the end of the Dock when the person
  // turned it on, the Dock shows, it lies along the bottom edge and the
  // window is at least CARDS_W wide; anywhere else they stay in the bar.
  var CARDS_W = 760;
  function cardsHere(p, width, side) {
    return !!(p && p.on && p.cards && side === "bottom" && (Number(width) || 0) >= CARDS_W);
  }

  var model = { normalize: normalize, merge: merge, list: list, isPinned: isPinned, pin: pin, move: move, moveTo: moveTo, VER: VER, DATA_KEY: DATA_KEY,
                menuNormalize: menuNormalize, menuMerge: menuMerge, menuHiddenIds: menuHiddenIds,
                menuSetHidden: menuSetHidden, menuPreset: menuPreset, MENU_KEY: MENU_KEY,
                dockSide: dockSide, POSITIONS: POSITIONS.slice(),
                badgeCounts: badgeCounts, badgeText: badgeText, lateTasks: lateTasks, BADGE_NEVER: BADGE_NEVER.slice(),
                cardsHere: cardsHere, CARDS_W: CARDS_W,
                dockEntries: dockEntries, dockMoveTo: dockMoveTo, groupAdd: groupAdd, groupLeave: groupLeave,
                groupRename: groupRename, groupUngroup: groupUngroup, groupName: groupName, GID_RE: GID_RE };

  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (!root || !root.document) return;

  // ---------- 2. Storage + sync ----------
  var doc = root.document;
  var host = null;               // set by attach()
  var cache = null;              // normalized data in memory

  function load() {
    if (cache) return cache;
    var raw = null;
    try { raw = root.localStorage.getItem(DATA_KEY); } catch (e) {}
    var parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); }
      catch (e) {
        // Unreadable: keep a copy, never overwrite it silently.
        try { root.localStorage.setItem(DATA_KEY + "-broken", raw); } catch (e2) {}
      }
    }
    cache = normalize(parsed);
    return cache;
  }

  function store(d) {
    cache = normalize(d);
    try { root.localStorage.setItem(DATA_KEY, JSON.stringify(cache)); } catch (e) {}
  }

  function change(d) {
    if (JSON.stringify(d) === JSON.stringify(load())) return;
    store(d);
    var api = root.orosSync;
    if (api && typeof api.markDirty === "function") api.markDirty();
    paint();
  }

  function sliceGet() {
    var raw = null;
    try { raw = root.localStorage.getItem(DATA_KEY); } catch (e) {}
    if (!raw) return null;     // nothing yet: a fresh device sends nothing
    return load();
  }

  function sliceSet(data) {
    if (!data) return;
    store(data);               // no markDirty: pulled data must not re-push
    paint();
  }

  function registerSync() {
    var api = root.orosSync;
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("launcher", sliceGet, sliceSet, DATA_KEY, merge);
    api.registerSlice("menu", menuSliceGet, menuSliceSet, MENU_KEY, menuMerge);
  }

  // ---------- 2b. Apps shown in the menu: storage + sync ----------
  // Its own slice: an older bundle carries it untouched (unknown slice)
  // instead of dropping a field it does not know from "launcher".
  var menuCache = null;

  function menuLoad() {
    if (menuCache) return menuCache;
    var raw = null;
    try { raw = root.localStorage.getItem(MENU_KEY); } catch (e) {}
    var parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); }
      catch (e) {
        try { root.localStorage.setItem(MENU_KEY + "-broken", raw); } catch (e2) {}
      }
    }
    menuCache = menuNormalize(parsed);
    return menuCache;
  }

  function menuStore(d) {
    menuCache = menuNormalize(d);
    try { root.localStorage.setItem(MENU_KEY, JSON.stringify(menuCache)); } catch (e) {}
  }

  function menuChanged() {
    if (host && typeof host.menuChanged === "function") {
      try { host.menuChanged(); } catch (e) {}
    }
  }

  function menuSliceGet() {
    var raw = null;
    try { raw = root.localStorage.getItem(MENU_KEY); } catch (e) {}
    if (!raw) return null;     // nothing yet: a fresh device sends nothing
    return menuLoad();
  }

  function menuSliceSet(data) {
    if (!data) return;
    var before = JSON.stringify(menuLoad());
    menuStore(data);           // no markDirty: pulled data must not re-push
    if (JSON.stringify(menuCache) !== before) menuChanged();
  }

  // Public: is this app hidden from the menu?
  function isMenuHidden(id) {
    var d = menuLoad();
    for (var i = 0; i < d.apps.length; i++) if (d.apps[i].id === id) return d.apps[i].hidden;
    return false;
  }

  // Public: hide or show one id or a list of ids. True when anything
  // changed (stored, marked dirty, menu repainted).
  function setMenuHidden(ids, hidden) {
    var cur = menuLoad();
    var next = menuSetHidden(cur, ids, hidden === true, Date.now());
    if (JSON.stringify(next) === JSON.stringify(cur)) return false;
    menuStore(next);
    var api = root.orosSync;
    if (api && typeof api.markDirty === "function") api.markDirty();
    menuChanged();
    return true;
  }

  // Public: a first-run profile's hidden apps (menuPreset). True when
  // anything changed.
  function presetMenuHidden(ids) {
    var cur = menuLoad();
    var next = menuPreset(cur, ids);
    if (JSON.stringify(next) === JSON.stringify(cur)) return false;
    menuStore(next);
    var api = root.orosSync;
    if (api && typeof api.markDirty === "function") api.markDirty();
    menuChanged();
    return true;
  }

  // Public: has this device any menu choice stored (or pulled)?
  function menuStored() {
    try { return !!root.localStorage.getItem(MENU_KEY); } catch (e) { return false; }
  }

  // ---------- 3. Dock preferences (DEVICE-LOCAL, never synced) ----------
  // A phone and a PC want different docks, so only the pins travel.
  // oros-launcher-prefs = { on, size: s|m|l, magnify, autohide, over, style, pos }
  // pos: the edge (POSITIONS, launcher 1.6.0); unknown = "bottom".
  // over: null = never chosen = off (Chris 2026-10-10; it used to follow
  // the pointer). A stored true / false is the user's own choice and wins.
  // style: the look of the bar (STYLES); unknown = "classic".
  // hover: what an icon does under the mouse (HOVERS, launcher 1.2.0).
  // Never chosen = "magnify", or "none" when the old `magnify` switch was
  // turned off. `magnify` is still written (= hover is "magnify") for an
  // older bundle reading the same key.
  var PREFS_KEY = "oros-launcher-prefs";
  var SIZES = { s: 40, m: 52, l: 64 };
  var MAG = 0.45;                // magnify: how much the icon under the mouse grows
  var STYLES = ["classic", "glass", "frosted", "smoke", "transparent", "solid", "3d", "neon"];
  var HOVERS = ["magnify", "bounce", "pulse", "frame", "glow", "lift", "wiggle", "none"];

  function finePointer() {
    try { return root.matchMedia("(hover: hover) and (pointer: fine)").matches; } catch (e) { return false; }
  }
  function prefs() {
    var p = null;
    try { p = JSON.parse(root.localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    var hover = HOVERS.indexOf(p.hover) >= 0 ? p.hover : (p.magnify === false ? "none" : "magnify");
    return {
      on: p.on === true,
      size: SIZES[p.size] ? p.size : "m",
      hover: hover,
      magnify: hover === "magnify",
      autohide: p.autohide === true,
      over: (p.over === true || p.over === false) ? p.over : null,
      style: STYLES.indexOf(p.style) >= 0 ? p.style : "classic",
      pos: POSITIONS.indexOf(p.pos) >= 0 ? p.pos : "bottom",
      badges: p.badges !== false,                // BADGE-1: on until turned off
      cards: p.cards === true                    // DOCK-CARDS: off until turned on
    };
  }
  function savePrefs(p) {
    p.magnify = p.hover === "magnify";
    try { root.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) {}
    paintDock();
    paintBadges();
  }
  function overApps(p) { return p.over === true; }

  // ---------- 4. Strings ----------
  // The shell's table (translations.js "ln.<key>"), German and other
  // languages from the shell pack.
  function tr(k) {
    var f = root.t, v = typeof f === "function" ? f("ln." + k) : "";
    return v && v !== "ln." + k ? v : k;
  }

  // ---------- 5. Styles (injected once; skin variables only) ----------
  var CSS = [
    // menu star + panel
    ".ld-row{display:flex;align-items:center;gap:2px;position:relative}",
    ".ld-row>.menu-item{flex:1;min-width:0}",
    ".ld-star{flex:0 0 auto;width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;",
    "background:transparent;border:none;border-radius:7px;color:var(--text-dim);cursor:pointer;padding:0}",
    ".ld-star:hover,.ld-star:focus-visible{background:var(--accent-soft);color:var(--accent)}",
    ".ld-star.on{color:var(--accent)}",
    ".ld-star svg{width:18px;height:18px}",
    ".ld-pop{margin:0 4px 6px 32px;padding:4px 8px;border:1px solid var(--border);border-radius:8px;background:var(--bg)}",
    ".ld-sw{display:flex;align-items:center;gap:10px;min-height:44px;font-size:13px;color:var(--text);cursor:pointer;padding:0 10px}",
    ".ld-pop .ld-sw{padding:0}",
    ".ld-sw input{flex:0 0 auto;width:18px;height:18px;accent-color:var(--accent);margin:0}",
    ".ld-note{font-size:12px;color:var(--text-dim);padding:0 10px 8px 38px}",
    ".ld-pop .ld-note{padding:0 0 8px 28px}",
    ".ld-note button{background:none;border:none;color:var(--accent);cursor:pointer;font:inherit;padding:4px 0;text-decoration:underline}",
    ".ld-seg{display:flex;gap:4px;padding:4px 10px 6px}",
    ".ld-seg button{flex:1;min-height:40px;border:1px solid var(--border);border-radius:7px;background:transparent;",
    "color:var(--text);font-size:13px;cursor:pointer}",
    ".ld-seg button[aria-pressed=true]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}",
    ".ld-lbl{font-size:12px;color:var(--text-dim);padding:6px 10px 0}",
    // desktop grid (the Dock lifts it through --tb-h)
    "#ld-desk{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px 4px;",
    "padding:calc(14px + var(--ld-st,0px)) 10px calc(150px + var(--tb-h,0px)) calc(10px + var(--ld-sl,0px));max-width:960px;align-content:start}",
    "@media (min-width:600px){#ld-desk{grid-template-columns:repeat(auto-fill,96px);",
    "padding:calc(20px + var(--ld-st,0px)) 20px calc(150px + var(--tb-h,0px)) calc(20px + var(--ld-sl,0px))}}",
    ".ld-ic{display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 2px;min-height:44px;",
    "background:transparent;border:1px solid transparent;border-radius:10px;color:var(--text);cursor:pointer;",
    "-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation}",
    ".ld-ic:hover,.ld-ic:focus-visible{background:var(--accent-soft);border-color:var(--border)}",
    ".ld-tile{width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;",
    "background:var(--panel-bg);color:var(--accent);border:1px solid var(--border);box-shadow:0 2px 8px var(--shadow)}",
    ".ld-tile svg{width:28px;height:28px}",
    // BADGE-1: the count on a shortcut or Dock icon (fixed red + white: 4.98:1 on every skin)
    ".ld-tile{position:relative}",
    ".ld-badge{position:absolute;top:-5px;right:-6px;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;",
    "border-radius:9px;background:#d32f2f;color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center;",
    "font-variant-numeric:tabular-nums;pointer-events:none;box-shadow:0 0 0 2px var(--panel-bg)}",
    ".ld-name{font-size:12px;line-height:1.25;text-align:center;max-width:100%;overflow:hidden;display:-webkit-box;",
    "-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:break-word;-webkit-hyphens:auto;hyphens:auto;padding:1px 5px;border-radius:6px;",
    "background:color-mix(in srgb,var(--panel-bg) 72%,transparent)}",
    // small menu (desktop + Dock)
    ".ld-menu{position:fixed;z-index:1100;min-width:200px;max-width:calc(100vw - 16px);padding:4px;",
    "background:var(--panel-bg);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 32px var(--shadow)}",
    ".ld-menu button{display:block;width:100%;min-height:44px;padding:8px 12px;text-align:left;background:transparent;",
    "border:none;border-radius:7px;color:var(--text);font-size:14px;cursor:pointer}",
    ".ld-menu button:hover,.ld-menu button:focus-visible{background:var(--accent-soft)}",
    ".ld-menu button:disabled{opacity:.45;cursor:default;background:transparent}",
    ".ld-menu .ld-danger{color:var(--danger)}",
    // DOCK-GRP: a group's tile (up to four small icons) and its panel
    ".ld-gtile{display:grid!important;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:2px;padding:calc(var(--ld-t,52px) * .12);box-sizing:border-box}",
    ".ld-gmini{display:flex;align-items:center;justify-content:center;min-width:0;min-height:0}",
    ".ld-dk .ld-gtile .ld-gmini svg{width:calc(var(--ld-t) * .3);height:calc(var(--ld-t) * .3)}",
    ".ld-dk.ld-drop .ld-tile{outline:2px dashed var(--accent);outline-offset:3px;transform:scale(1.08)}",
    ".ld-gpop{width:min(320px,calc(100vw - 16px));min-width:0;box-sizing:border-box;padding:10px}",
    ".ld-gpop .ld-gname{display:block;width:100%;box-sizing:border-box;min-height:40px;padding:6px 10px;margin:0 0 8px;font:inherit;font-weight:600;",
    "color:var(--text);background:transparent;border:1px solid transparent;border-radius:8px;text-align:center}",
    ".ld-gpop .ld-gname:hover,.ld-gpop .ld-gname:focus{border-color:var(--border);background:var(--accent-soft);outline:none}",
    ".ld-ggrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px;margin-bottom:6px}",
    ".ld-gcell{position:relative}",
    ".ld-gpop .ld-gapp{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;text-align:center;min-height:0}",
    ".ld-gpop .ld-gapp .ld-tile{width:44px;height:44px;border-radius:12px;box-shadow:none}",
    ".ld-gpop .ld-gapp .ld-tile svg{width:24px;height:24px}",
    ".ld-gl{font-size:12px;line-height:1.25;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".ld-gpop .ld-gx{position:absolute;top:0;right:0;width:28px;min-height:28px;height:28px;padding:0;border-radius:50%;",
    "display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1;color:var(--text-dim);background:var(--panel-bg);border:1px solid var(--border)}",
    ".ld-gpop .ld-gx:hover,.ld-gpop .ld-gx:focus-visible{color:var(--danger);background:var(--panel-bg)}",
    // the Dock (z 950: over a running app at 900, under the menu at 999)
    "#ld-dock{position:fixed;left:50%;bottom:calc(6px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);",
    "z-index:950;max-width:calc(100vw - 16px);transition:transform .22s ease,opacity .22s ease;--ld-dx:0;--ld-dy:-1}",
    "#ld-dock.ld-hidden{transform:translate(-50%,calc(100% + 12px));opacity:0;pointer-events:none}",
    ".ld-bar{display:flex;align-items:flex-end;gap:6px;padding:6px calc(8px + var(--ld-mag,0px));border-radius:18px;transition:padding .12s ease;",
    "background:color-mix(in srgb,var(--panel-bg) 86%,transparent);border:1px solid var(--border);",
    "box-shadow:0 8px 28px var(--shadow);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}",
    "#ld-cards{flex:0 1 auto;min-width:0;align-self:center;display:flex;align-items:center;margin-left:4px;padding-left:8px;border-left:1px solid var(--border);color:var(--text)}",
    "#ld-cards:empty,#ld-cards:not(:has(.sb-chip:not([hidden]))){display:none}",
    ".ld-dk{position:relative;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;padding:0;",
    "background:transparent;border:none;cursor:pointer;color:var(--accent);transform-origin:50% 100%;",
    "transition:transform .12s ease;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation}",
    ".ld-dk .ld-tile{width:var(--ld-t);height:var(--ld-t);border-radius:calc(var(--ld-t) * .27);box-shadow:none}",
    ".ld-dk .ld-tile svg{width:calc(var(--ld-t) * .54);height:calc(var(--ld-t) * .54)}",
    ".ld-dk:focus-visible .ld-tile{outline:2px solid var(--accent);outline-offset:2px}",
    ".ld-dot{width:4px;height:4px;border-radius:50%;margin-top:3px;background:transparent}",
    ".ld-dk.run .ld-dot{background:var(--accent)}",
    ".ld-dk.open .ld-dot{background:var(--text-dim)}",
    ".ld-dk.drag{opacity:.55}",
    ".ld-tip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);white-space:nowrap;",
    "padding:4px 9px;border-radius:7px;font-size:12px;background:var(--panel-bg);color:var(--text);",
    "border:1px solid var(--border);box-shadow:0 4px 14px var(--shadow);pointer-events:none;opacity:0;transition:opacity .12s}",
    "@media (hover:hover) and (pointer:fine){.ld-dk:hover .ld-tip,.ld-dk:focus-visible .ld-tip{opacity:1}}",
    // hover effects (Settings › Dock › Hover effect): one class on #ld-dock,
    // on the tile only (the button's own transform belongs to magnify)
    ".ld-dk .ld-tile{transition:transform .18s ease,box-shadow .18s ease,outline-color .18s ease,filter .18s ease}",
    // bounce and lift move away from the Dock's edge (--ld-dx / --ld-dy)
    "@keyframes ld-bounce{0%,55%,88%,100%{transform:translate(0,0)}30%{transform:translate(calc(var(--ld-dx) * 14px),calc(var(--ld-dy) * 14px))}",
    "72%{transform:translate(calc(var(--ld-dx) * 6px),calc(var(--ld-dy) * 6px))}}",
    "@keyframes ld-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}",
    "@keyframes ld-wiggle{0%,100%{transform:rotate(0)}20%{transform:rotate(-9deg)}40%{transform:rotate(8deg)}60%{transform:rotate(-5deg)}80%{transform:rotate(3deg)}}",
    "@media (hover:hover) and (pointer:fine){",
    "#ld-dock.ld-h-bounce .ld-dk:hover .ld-tile{animation:ld-bounce .7s ease}",
    "#ld-dock.ld-h-pulse .ld-dk:hover .ld-tile{animation:ld-pulse 1s ease-in-out infinite}",
    "#ld-dock.ld-h-frame .ld-dk:hover .ld-tile{outline:2px solid var(--accent);outline-offset:3px}",
    "#ld-dock.ld-h-glow .ld-dk:hover .ld-tile{box-shadow:0 0 0 1px var(--accent),0 0 18px color-mix(in srgb,var(--accent) 70%,transparent)}",
    "#ld-dock.ld-h-lift .ld-dk:hover .ld-tile{transform:translate(calc(var(--ld-dx) * 10px),calc(var(--ld-dy) * 10px));box-shadow:0 10px 16px var(--shadow)}",
    "#ld-dock.ld-h-wiggle .ld-dk:hover .ld-tile{animation:ld-wiggle .5s ease}",
    "}",
    "@media (prefers-reduced-motion:reduce){#ld-dock .ld-dk .ld-tile{animation:none!important}",
    "#ld-dock.ld-h-bounce .ld-dk:hover .ld-tile,#ld-dock.ld-h-pulse .ld-dk:hover .ld-tile,#ld-dock.ld-h-wiggle .ld-dk:hover .ld-tile{outline:2px solid var(--accent);outline-offset:3px}}",
    // looks (Settings › Dock › Style): one class on #ld-dock, the bar only
    "#ld-dock.ld-s-glass .ld-bar{background:linear-gradient(180deg,rgba(255,255,255,.28),rgba(255,255,255,.08));",
    "border:1px solid rgba(255,255,255,.45);box-shadow:inset 0 1px 0 rgba(255,255,255,.6),inset 0 -1px 0 rgba(255,255,255,.12),0 10px 30px rgba(0,0,0,.28);",
    "-webkit-backdrop-filter:blur(16px) saturate(180%);backdrop-filter:blur(16px) saturate(180%)}",
    "#ld-dock.ld-s-frosted .ld-bar{background:color-mix(in srgb,var(--panel-bg) 55%,rgba(255,255,255,.35));",
    "border:1px solid rgba(255,255,255,.3);-webkit-backdrop-filter:blur(28px) brightness(1.08);backdrop-filter:blur(28px) brightness(1.08)}",
    "#ld-dock.ld-s-smoke .ld-bar{background:rgba(18,18,22,.58);border:1px solid rgba(255,255,255,.1);",
    "box-shadow:0 10px 30px rgba(0,0,0,.4);-webkit-backdrop-filter:blur(14px) grayscale(.5);backdrop-filter:blur(14px) grayscale(.5)}",
    "#ld-dock.ld-s-transparent .ld-bar{background:transparent;border-color:transparent;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}",
    "#ld-dock.ld-s-transparent .ld-tile{filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))}",
    "#ld-dock.ld-s-solid .ld-bar{background:var(--panel-bg);-webkit-backdrop-filter:none;backdrop-filter:none}",
    "#ld-dock.ld-s-3d .ld-bar{position:relative;isolation:isolate;background:transparent;border-color:transparent;box-shadow:none;",
    "-webkit-backdrop-filter:none;backdrop-filter:none;padding-bottom:10px}",
    "#ld-dock.ld-s-3d .ld-bar::before{content:\"\";position:absolute;z-index:-1;left:4px;right:4px;bottom:2px;height:62%;border-radius:10px;",
    "transform:perspective(260px) rotateX(48deg);transform-origin:50% 100%;",
    "background:linear-gradient(180deg,color-mix(in srgb,var(--panel-bg) 35%,rgba(255,255,255,.7)),color-mix(in srgb,var(--panel-bg) 75%,rgba(255,255,255,.2)));",
    "border:1px solid rgba(255,255,255,.4);border-bottom:4px solid color-mix(in srgb,var(--panel-bg) 60%,#000);",
    "box-shadow:0 12px 24px rgba(0,0,0,.35);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}",
    "#ld-dock.ld-s-3d .ld-tile{box-shadow:0 6px 10px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.35)}",
    "#ld-dock.ld-s-neon .ld-bar{background:color-mix(in srgb,var(--panel-bg) 78%,transparent);border:1px solid var(--accent);",
    "box-shadow:0 0 14px color-mix(in srgb,var(--accent) 55%,transparent),inset 0 0 12px color-mix(in srgb,var(--accent) 22%,transparent)}",
    "#ld-dock.ld-s-neon .ld-dk.run .ld-dot{box-shadow:0 0 6px var(--accent)}",
    // auto-hide: an edge strip (mouse) and a small handle (touch)
    "#ld-edge{position:fixed;left:0;right:0;bottom:0;height:calc(10px + env(safe-area-inset-bottom,0px));z-index:949;",
    "display:flex;align-items:flex-end;justify-content:center;background:transparent;border:none;padding:0 0 env(safe-area-inset-bottom,0px);cursor:pointer}",
    "#ld-edge[hidden]{display:none}",
    "#ld-edge span{width:44px;height:4px;border-radius:2px;margin-bottom:3px;background:var(--text-dim);opacity:.6}",
    "@media (pointer:coarse){#ld-edge{height:calc(24px + env(safe-area-inset-bottom,0px));left:calc(50% - 40px);right:auto;width:80px}}",
    // a running app hides the Dock unless "over open apps" is on
    "#oros-running.active ~ #ld-dock.ld-noover,#oros-running.active ~ #ld-edge.ld-noover{display:none}",
    // a pinned (not auto-hidden) Dock over apps: the app ends above it
    "html.ld-push #oros-running.active{bottom:calc(var(--tb-h,0px) + env(safe-area-inset-bottom,0px))}",
    "html.ld-push-l #oros-running.active{left:var(--ld-sl,0px)}",
    "html.ld-push-r #oros-running.active{right:var(--ld-sr,0px)}",
    "html.ld-push-t #oros-running.active{top:calc(40px + env(safe-area-inset-top,0px) + var(--ld-st,0px))}",
    "@media (max-width:480px){.ld-bar{overflow-x:auto;overscroll-behavior:contain;scrollbar-width:none}",
    ".ld-bar::-webkit-scrollbar{display:none}}",
    // position (Settings › Dock › Position, launcher 1.6.0): one ld-p-<edge>
    // class on #ld-dock and #ld-edge; ld-v = a column (left, right).
    // Side docks sit in the middle of the space under the top bar (40 px).
    "#ld-dock.ld-v{top:calc(50% + 20px + env(safe-area-inset-top,0px) / 2);bottom:auto;max-width:none;",
    "--ld-maxh:calc(100vh - 56px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));max-height:var(--ld-maxh)}",
    "#ld-dock.ld-p-left{left:calc(6px + env(safe-area-inset-left,0px));transform:translateY(-50%);--ld-dx:1;--ld-dy:0}",
    "#ld-dock.ld-p-right{left:auto;right:calc(6px + env(safe-area-inset-right,0px));transform:translateY(-50%);--ld-dx:-1;--ld-dy:0}",
    "#ld-dock.ld-p-top{top:calc(46px + env(safe-area-inset-top,0px));bottom:auto;--ld-dy:1}",
    "#ld-dock.ld-p-left.ld-hidden{transform:translate(calc(-100% - 12px),-50%)}",
    "#ld-dock.ld-p-right.ld-hidden{transform:translate(calc(100% + 12px),-50%)}",
    "#ld-dock.ld-p-top.ld-hidden{transform:translate(-50%,calc(-100% - 52px))}",
    "#ld-dock.ld-v .ld-bar{flex-direction:column;padding:calc(8px + var(--ld-mag,0px)) 6px;max-height:var(--ld-maxh);box-sizing:border-box}",
    "#ld-dock.ld-v.ld-scroll .ld-bar{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}",
    "#ld-dock.ld-p-left .ld-bar{align-items:flex-start}",
    "#ld-dock.ld-p-right .ld-bar{align-items:flex-end}",
    "#ld-dock.ld-p-top .ld-bar{align-items:flex-start}",
    "#ld-dock.ld-p-left .ld-dk{flex-direction:row-reverse;transform-origin:0 50%}",
    "#ld-dock.ld-p-right .ld-dk{flex-direction:row;transform-origin:100% 50%}",
    "#ld-dock.ld-p-top .ld-dk{flex-direction:column-reverse;transform-origin:50% 0}",
    "#ld-dock.ld-v .ld-dot{margin:0 3px}",
    "#ld-dock.ld-p-top .ld-dot{margin:0 0 3px}",
    "#ld-dock.ld-p-left .ld-tip{bottom:auto;top:50%;left:calc(100% + 8px);transform:translateY(-50%)}",
    "#ld-dock.ld-p-right .ld-tip{bottom:auto;top:50%;left:auto;right:calc(100% + 8px);transform:translateY(-50%)}",
    "#ld-dock.ld-p-top .ld-tip{bottom:auto;top:calc(100% + 8px)}",
    // the 3D shelf tilts towards the bottom only; elsewhere a flat slab
    "#ld-dock.ld-v.ld-s-3d .ld-bar,#ld-dock.ld-p-top.ld-s-3d .ld-bar{padding-bottom:calc(8px + var(--ld-mag,0px))}",
    "#ld-dock.ld-p-top.ld-s-3d .ld-bar{padding-bottom:6px}",
    "#ld-dock.ld-v.ld-s-3d .ld-bar::before,#ld-dock.ld-p-top.ld-s-3d .ld-bar::before{left:2px;right:2px;top:2px;bottom:2px;height:auto;transform:none;border-bottom-width:1px}",
    // the auto-hide strip along the chosen edge
    "#ld-edge.ld-p-left,#ld-edge.ld-p-right{top:calc(40px + env(safe-area-inset-top,0px));bottom:0;height:auto;align-items:center;padding:0}",
    "#ld-edge.ld-p-left{right:auto;width:calc(10px + env(safe-area-inset-left,0px));justify-content:flex-start}",
    "#ld-edge.ld-p-right{left:auto;width:calc(10px + env(safe-area-inset-right,0px));justify-content:flex-end}",
    "#ld-edge.ld-p-left span,#ld-edge.ld-p-right span{width:4px;height:44px;margin:0 3px}",
    "#ld-edge.ld-p-top{top:calc(40px + env(safe-area-inset-top,0px));bottom:auto;height:10px;align-items:flex-start;padding:0}",
    "#ld-edge.ld-p-top span{margin:3px 0 0}",
    "@media (pointer:coarse){#ld-edge.ld-p-left,#ld-edge.ld-p-right{width:24px;height:80px;top:calc(50% - 20px);bottom:auto}",
    "#ld-edge.ld-p-left{left:0;right:auto}#ld-edge.ld-p-right{left:auto;right:0}",
    "#ld-edge.ld-p-top{left:calc(50% - 40px);right:auto;width:80px;height:24px}}"
  ].join("\n");

  function injectCss() {
    if (doc.getElementById("ld-css")) return;
    var s = doc.createElement("style");
    s.id = "ld-css";
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  // Outline star / filled star (static markup, never data).
  var STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6L12 17l-5.38 2.85 1.03-6L3.3 9.6l6-.9z"/></svg>';
  var STAR_ON = STAR.replace('fill="none"', 'fill="currentColor"');

  // ---------- 6. Helpers ----------
  function apps() { return (host && host.apps && host.apps()) || []; }
  function appById(id) {
    var a = apps();
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    // 1.5.0 APP-ALIAS: a shortcut of an app that moved into another
    // one shows that app (shell aliasHost); the item keeps its old id.
    return (host && typeof host.aliasHost === "function" && host.aliasHost(id)) || null;
  }
  function labelOf(app) { return host && host.label ? host.label(app) : app.name; }
  function iconOf(app) {
    var icons = (host && host.icons) || {};
    return Object.prototype.hasOwnProperty.call(icons, app.icon) ? icons[app.icon] : "";
  }
  function runningId() {
    var r = host && host.running && host.running();
    return r ? r.id : null;
  }
  function launch(id) {
    var app = appById(id);
    if (!app || runningId() === id) return;     // never reload the open app
    if (app.id !== id && host.openAlias && host.openAlias(id)) return;   // APP-ALIAS: opens at the old app's place
    host.open(app);
  }
  // An alias and its new home pinned both show once (the first one).
  function shown(place) {
    var seen = {};
    return list(load(), place).filter(function (id) {
      var app = appById(id);
      if (!app || seen[app.id]) return false;
      seen[app.id] = true;
      return true;
    });
  }
  function switchRow(text, checked, onChange, key) {
    var sw = doc.createElement("label");
    sw.className = "ld-sw";
    var cb = doc.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!checked;
    if (key) cb.setAttribute("data-k", key);
    cb.addEventListener("change", function () { onChange(cb.checked); });
    sw.appendChild(cb);
    var tx = doc.createElement("span");
    tx.textContent = text;
    sw.appendChild(tx);
    return sw;
  }

  // ---------- 7. Menu: the star and its panel ----------
  var openPop = null;            // app id whose panel is open (memory only)

  function paintStar(btn, id) {
    var on = isPinned(load(), id);
    btn.classList.toggle("on", on);
    btn.innerHTML = on ? STAR_ON : STAR;     // static markup
  }

  function buildPop(app, star) {
    var pop = doc.createElement("div");
    pop.className = "ld-pop";
    pop.id = "ld-pop-" + app.id;
    PLACES.forEach(function (place) {
      pop.appendChild(switchRow(tr(place === "desk" ? "desk" : "inDock"), isPinned(load(), app.id, place), function (on) {
        change(pin(load(), app.id, place, on, Date.now()));
        paintStar(star, app.id);
        paintDockNote(pop);
      }, place));
    });
    paintDockNote(pop);
    return pop;
  }

  // "The Dock is off · Turn on", only while this app is in an off Dock.
  function paintDockNote(pop) {
    var old = pop.querySelector(".ld-note");
    if (old) old.remove();
    var cb = pop.querySelector('input[data-k="dock"]');
    if (!cb || !cb.checked || prefs().on) return;
    var note = doc.createElement("div");
    note.className = "ld-note";
    note.appendChild(doc.createTextNode(tr("dockOff") + " "));
    var b = doc.createElement("button");
    b.type = "button";
    b.textContent = tr("turnOn");
    b.addEventListener("click", function () {
      var p = prefs(); p.on = true; savePrefs(p);
      note.remove();
      cb.focus();
      repaintSettings();
    });
    note.appendChild(b);
    pop.appendChild(note);
  }

  // Wraps the shell's app button in a row with the star. The panel is
  // toggled IN PLACE (no menu rebuild), and the open panel survives
  // the shell's rebuilds through `openPop`.
  function menuRow(btn, app) {
    if (!app || !ID_RE.test(String(app.id)) || app.type === "external") return btn;
    var row = doc.createElement("div");
    row.className = "ld-row-wrap";
    var line = doc.createElement("div");
    line.className = "ld-row";
    line.appendChild(btn);
    var star = doc.createElement("button");
    star.type = "button";
    star.className = "ld-star";
    star.title = tr("star");
    star.setAttribute("aria-label", tr("star") + ": " + labelOf(app));
    star.setAttribute("aria-controls", "ld-pop-" + app.id);
    star.setAttribute("data-app", app.id);
    paintStar(star, app.id);
    line.appendChild(star);
    row.appendChild(line);

    function show(open) {
      var old = row.querySelector(".ld-pop");
      if (old) old.remove();
      star.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) row.appendChild(buildPop(app, star));
    }
    star.addEventListener("click", function () {
      if (openPop && openPop !== app.id) {
        var other = doc.getElementById("ld-pop-" + openPop);
        if (other) {
          var os = other.parentNode && other.parentNode.querySelector(".ld-star");
          if (os) os.setAttribute("aria-expanded", "false");
          other.remove();
        }
      }
      openPop = (openPop === app.id) ? null : app.id;
      show(openPop === app.id);
      if (openPop) {
        var cb = row.querySelector(".ld-pop input");
        if (cb) cb.focus();
      }
    });
    row.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openPop === app.id) {
        e.stopPropagation();
        openPop = null;
        show(false);
        star.focus();
      }
    });
    show(openPop === app.id);
    return row;
  }

  function paintStars() {
    var stars = doc.querySelectorAll(".ld-star[data-app]");
    for (var i = 0; i < stars.length; i++) {
      var id = stars[i].getAttribute("data-app");
      paintStar(stars[i], id);
      var pop = doc.getElementById("ld-pop-" + id);
      if (!pop) continue;
      PLACES.forEach(function (place) {
        var cb = pop.querySelector('input[data-k="' + place + '"]');
        if (cb) cb.checked = isPinned(load(), id, place);
      });
      paintDockNote(pop);
    }
  }

  // ---------- 8. Menu: the Dock settings section ----------
  // A callable builder, so a future Settings app can host it too.
  function buildSettings() {
    var p = prefs();
    var sec = doc.createElement("div");
    sec.className = "sync-section";
    sec.id = "ld-set";
    var h = doc.createElement("div");
    h.className = "menu-heading";
    h.textContent = tr("dock");
    sec.appendChild(h);
    function set(k, v) { var q = prefs(); q[k] = v; savePrefs(q); repaintSettings(k); }
    sec.appendChild(switchRow(tr("dockOn"), p.on, function (v) { set("on", v); }, "on"));
    sec.appendChild(switchRow(tr("badges"), p.badges, function (v) { set("badges", v); }, "badges"));
    if (!p.on) return sec;

    var lbl = doc.createElement("div");
    lbl.className = "ld-lbl";
    lbl.id = "ld-size-lbl";
    lbl.textContent = tr("size");
    sec.appendChild(lbl);
    var seg = doc.createElement("div");
    seg.className = "ld-seg";
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-labelledby", "ld-size-lbl");
    ["s", "m", "l"].forEach(function (k) {
      var b = doc.createElement("button");
      b.type = "button";
      b.textContent = tr(k);
      b.setAttribute("aria-pressed", p.size === k ? "true" : "false");
      b.setAttribute("data-k", "size-" + k);
      b.addEventListener("click", function () { set("size", k); });
      seg.appendChild(b);
    });
    sec.appendChild(seg);
    if (finePointer()) sec.appendChild(switchRow(tr("magnify"), p.magnify, function (v) { set("hover", v ? "magnify" : "none"); }, "magnify"));
    sec.appendChild(switchRow(tr("autohide"), p.autohide, function (v) { set("autohide", v); }, "autohide"));
    sec.appendChild(switchRow(tr("over"), overApps(p), function (v) { set("over", v); }, "over"));
    if (!shown("dock").length) {
      var note = doc.createElement("div");
      note.className = "ld-note";
      note.textContent = tr("empty");
      sec.appendChild(note);
    }
    return sec;
  }

  function renderSettings(menu) {
    if (!host || !menu) return;
    menu.appendChild(buildSettings());
  }

  // Rebuild the section in place (no menu rebuild) and keep focus.
  function repaintSettings(focusKey) {
    var old = doc.getElementById("ld-set");
    if (!old) return;
    var fresh = buildSettings();
    old.replaceWith(fresh);
    var k = focusKey === "size" ? "size-" + prefs().size : focusKey;
    var el = k && fresh.querySelector('[data-k="' + k + '"]');
    if (el) el.focus();
  }

  // ---------- 9. Small menu (desktop icons + Dock icons) ----------
  var ctx = null;                // { el, back } of the open small menu

  function closeCtx(refocus) {
    if (!ctx) return;
    var back = ctx.back, after = ctx.onClose;
    ctx.el.remove();
    ctx = null;
    if (after) { try { after(); } catch (e) {} }
    doc.removeEventListener("pointerdown", ctxOutside, true);
    if (refocus && back && back.isConnected) back.focus();
  }
  function ctxOutside(e) {
    if (ctx && !ctx.el.contains(e.target)) closeCtx(false);
  }

  function openCtx(id, place, anchor, x, y, gid) {
    closeCtx(false);
    var app = gid ? null : appById(id);
    if (!app && !gid) return;
    var ids = list(load(), place);
    var i = ids.indexOf(id);
    // DOCK-GRP: in the Dock, earlier and later walk what is shown (a
    // group counts as one).
    var ref = gid ? { group: gid } : { app: id }, es = null;
    if (place === "dock") {
      es = dockEntries(load(), shown("dock"));
      i = -1;
      for (var q = 0; q < es.length; q++) if (gid ? es[q].group === gid : es[q].app === id) i = q;
      ids = es;
    }
    var m = doc.createElement("div");
    m.className = "ld-menu";
    m.setAttribute("role", "menu");
    m.setAttribute("aria-label", gid ? anchor.getAttribute("data-ld-name") : labelOf(app));
    function item(key, fn, disabled, cls) {
      var b = doc.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = tr(key);
      if (cls) b.className = cls;
      b.disabled = !!disabled;
      b.addEventListener("click", function () { closeCtx(false); fn(); });
      m.appendChild(b);
    }
    var step = function (dir) {
      if (es) change(dockMoveTo(load(), ref, i + dir, shown("dock"), Date.now()));
      else change(move(load(), id, place, dir, Date.now()));
      focusIcon(gid || id, place);
    };
    item("open", function () { if (gid) openGroup(gid, anchor); else launch(id); });
    item("earlier", function () { step(-1); }, i <= 0);
    item("later", function () { step(1); }, i === -1 || i >= ids.length - 1);
    if (es && !gid && es.length > 1) item("grpWith", function () { openGroupPick(id, anchor); });
    if (gid) item("grpUngroup", function () {
      var en = entryOf(gid), first = en && en.ids[0];
      change(groupUngroup(load(), gid, shown("dock"), Date.now()));
      if (first) focusIcon(first, "dock");
    }, false, "ld-danger");
    else item(place === "desk" ? "remove" : "removeDock", function () { change(unpinDock(load(), id, place)); }, false, "ld-danger");
    m.addEventListener("keydown", function (e) {
      var bs = Array.prototype.slice.call(m.querySelectorAll("button:not(:disabled)"));
      var k = bs.indexOf(doc.activeElement);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeCtx(true); }
      else if (e.key === "ArrowDown") { e.preventDefault(); bs[(k + 1) % bs.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); bs[(k - 1 + bs.length) % bs.length].focus(); }
      else if (e.key === "Tab") { closeCtx(false); }
    });
    placePop(m, anchor, x, y, place === "dock");
    ctx = { el: m, back: anchor };
    doc.addEventListener("pointerdown", ctxOutside, true);
    var first = m.querySelector("button:not(:disabled)");
    if (first) first.focus();
  }

  function placePop(m, anchor, x, y, inDock) {
    doc.body.appendChild(m);
    var r = m.getBoundingClientRect();
    var vw = root.innerWidth, vh = root.innerHeight;
    if (inDock) {                                   // open away from the Dock's edge
      var side = dockEdge();
      var ar = anchor.getBoundingClientRect();
      if (!x && !y) { x = ar.left + ar.width / 2 - r.width / 2; y = ar.top; }
      if (side === "left") { x = ar.right + 8; y = ar.top; }
      else if (side === "right") { x = ar.left - r.width - 8; y = ar.top; }
      else if (side === "top") y = ar.bottom + 8;
      else y = Math.min(y, ar.top) - r.height - 8;   // upwards from a bottom Dock
    }
    m.style.left = Math.max(8, Math.min(x, vw - r.width - 8)) + "px";
    m.style.top = Math.max(8, Math.min(y, vh - r.height - 8)) + "px";
  }

  // DOCK-GRP: unpinning a group's member from the Dock may leave one.
  function unpinDock(d, id, place) {
    var it = find(d, id), gid = place === "dock" && it && it.grp;
    var out = pin(d, id, place, false, Date.now());
    return gid ? dissolveSmall(out, gid, Date.now()) : out;
  }

  // "Put in a group with…": the other things in the Dock, by name.
  function openGroupPick(id, anchor) {
    closeCtx(false);
    var m = doc.createElement("div");
    m.className = "ld-menu";
    m.setAttribute("role", "menu");
    m.setAttribute("aria-label", tr("grpWith"));
    dockEntries(load(), shown("dock")).forEach(function (en) {
      if (en.app === id) return;
      var b = doc.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = en.group ? groupLabel(en) + " (" + en.ids.length + ")" : labelOf(appById(en.app));
      b.addEventListener("click", function () { closeCtx(false); groupDrop(id, en); });
      m.appendChild(b);
    });
    m.addEventListener("keydown", function (e) {
      var bs = Array.prototype.slice.call(m.querySelectorAll("button"));
      var k = bs.indexOf(doc.activeElement);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeCtx(true); }
      else if (e.key === "ArrowDown") { e.preventDefault(); bs[(k + 1) % bs.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); bs[(k - 1 + bs.length) % bs.length].focus(); }
      else if (e.key === "Tab") { closeCtx(false); }
    });
    placePop(m, anchor, 0, 0, true);
    ctx = { el: m, back: anchor };
    doc.addEventListener("pointerdown", ctxOutside, true);
    var first = m.querySelector("button");
    if (first) first.focus();
  }
  // `id` dropped on the entry `en`: join its group, or make a new one.
  function groupDrop(id, en) {
    var d = load(), now = Date.now();
    var n = (d.groups || []).filter(function (g) { return g.dock !== null; }).length + 1;
    var gid = "g" + now.toString(36) + Math.floor(Math.random() * 1296).toString(36);
    var name = "";
    if (en.app) {
      var a = appById(id), b = appById(en.app);
      var cat = a && b && a.category && a.category === b.category && host.category ? host.category(a.category) : "";
      name = cat || tr("grpNew").replace("{n}", String(n));
    }
    change(groupAdd(d, id, en.group ? { group: en.group } : { app: en.app }, gid, name, now));
    focusIcon(en.group || (find(load(), en.app) || {}).grp || id, "dock");
  }

  function focusIcon(id, place) {
    var el = doc.querySelector((place === "dock" ? "#ld-dock" : "#ld-desk") + ' [data-app="' + id + '"]') ||
      (place === "dock" ? doc.querySelector('#ld-dock [data-group="' + id + '"]') : null);
    if (el) el.focus();
  }

  // Long press on touch (500 ms; moving more than 10 px cancels; the
  // click that follows is swallowed). Mouse: the contextmenu event.
  function wireIcon(b, id, place) {
    var timer = null, sx = 0, sy = 0, fired = 0;
    b.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      sx = e.clientX; sy = e.clientY;
      clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fired = Date.now();
        openCtx(id, place, b, sx, sy);
      }, 500);
    });
    b.addEventListener("pointermove", function (e) {
      if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) { clearTimeout(timer); timer = null; }
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (t) {
      b.addEventListener(t, function () { if (timer) { clearTimeout(timer); timer = null; } });
    });
    b.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      if (Date.now() - fired < 1000) return;      // the long press already opened it
      var r = b.getBoundingClientRect();
      var kb = !e.clientX && !e.clientY;           // context-menu key
      openCtx(id, place, b, kb ? r.left : e.clientX, kb ? (place === "dock" ? r.top : r.bottom) : e.clientY);
    });
    b.addEventListener("click", function (e) {
      if (Date.now() - fired < 1000 || b.__ldDragged) { e.preventDefault(); b.__ldDragged = false; return; }
      launch(id);
    });
  }

  // The colour 0-11 of the Mix and Rainbow icon packs. On the desktop and
  // the Dock it follows the tile's place (`pos`), so 12 tiles in a row
  // never share a colour and run through the spectrum in order; elsewhere
  // (no pos) a hash of the app id, the same as shell.js iconHue.
  function hueOf(app, pos) {
    if (typeof pos === "number" && pos >= 0) return String(pos % 12);
    var s = String((app && app.id) || ""), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(Math.abs(h) % 12);
  }

  function tileFor(app, pos) {
    var tile = doc.createElement("span");
    tile.className = "ld-tile";
    tile.setAttribute("data-cat", String(app.category || "other").toLowerCase().replace(/[^a-z]/g, ""));   // icon packs
    tile.setAttribute("data-hue", hueOf(app, pos));                                                           // Mix, Rainbow
    tile.innerHTML = iconOf(app);            // static shell icon, not data
    return tile;
  }

  // ---------- 10. Desktop shortcuts ----------
  function paintDesktop() {
    var desk = host && host.desktop;
    if (!desk) return;
    var grid = doc.getElementById("ld-desk");
    var ids = shown("desk");
    if (!ids.length) { if (grid) grid.remove(); return; }
    var act = doc.activeElement;
    var focusId = act && act.closest && act.closest("#ld-desk") ? act.getAttribute("data-app") : null;
    if (!grid) {
      grid = doc.createElement("div");
      grid.id = "ld-desk";
      grid.setAttribute("role", "list");
      desk.appendChild(grid);
    }
    grid.setAttribute("aria-label", tr("deskLabel"));
    grid.lang = root.orosI18n ? root.orosI18n.lang() : ((host.lang && host.lang() === "el") ? "el" : "en");     // hyphenation of long names
    grid.textContent = "";
    ids.forEach(function (id, pos) {
      var app = appById(id);
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "ld-ic";
      b.setAttribute("role", "listitem");
      b.setAttribute("data-app", id);
      b.title = labelOf(app);
      b.setAttribute("data-ld-name", labelOf(app));
      b.appendChild(tileFor(app, pos));
      var nm = doc.createElement("span");
      nm.className = "ld-name";
      nm.textContent = labelOf(app);
      b.appendChild(nm);
      wireIcon(b, id, "desk");
      grid.appendChild(b);
    });
    paintBadges();
    if (focusId) focusIcon(focusId, "desk");
  }

  // ---------- 11. The Dock ----------
  var dock = null, edge = null, hideTimer = null, dockShownAt = 0;

  function dockHeight(p) { return SIZES[p.size] + 7 + 12 + 2 + 6; }   // tile + dot + padding + border + gap

  // The space a shown, pinned Dock takes from its edge: --tb-h at the
  // bottom (the old hook: pet, desktop grid, widgets, notes), --ld-sl /
  // --ld-sr / --ld-st at the left, right and top. ld-push[-l|-r|-t]
  // ends a running app at the Dock ("over open apps").
  var SIDE_VAR = { bottom: "--tb-h", left: "--ld-sl", right: "--ld-sr", top: "--ld-st" };
  var SIDE_PUSH = { bottom: "ld-push", left: "ld-push-l", right: "ld-push-r", top: "ld-push-t" };
  function setVars(p, visible, side) {
    var de = doc.documentElement;
    var lift = (visible && !p.autohide) ? dockHeight(p) + 6 : 0;
    POSITIONS.forEach(function (k) {
      var on = !!lift && k === side;
      if (on) de.style.setProperty(SIDE_VAR[k], lift + "px");
      else de.style.removeProperty(SIDE_VAR[k]);
      de.classList.toggle(SIDE_PUSH[k], on && overApps(p));
    });
  }
  function sideNow(p) { return dockSide(p.pos, root.innerWidth, root.innerHeight); }
  function vertical() { return !!dock && dock.classList.contains("ld-v"); }
  // The edge the painted Dock sits at now ("bottom" when there is none).
  function dockEdge() {
    for (var i = 1; i < POSITIONS.length; i++) if (dock && dock.classList.contains("ld-p-" + POSITIONS[i])) return POSITIONS[i];
    return "bottom";
  }
  // A column longer than the screen scrolls (and does not magnify).
  function fitColumn() {
    if (!dock) return;
    dock.classList.remove("ld-scroll");
    var bar = dock.firstChild;
    if (vertical() && bar && bar.scrollHeight > bar.clientHeight + 1) dock.classList.add("ld-scroll");
  }

  // DOCK-CARDS: one holder kept across repaints (smartbar.js moves its
  // row of chips into it); every time it comes or goes the smart bar
  // hears "oros-dock-cards" and puts its row where it belongs.
  // `cardsAt` remembers where it was: a Dock repaint empties the bar
  // (and so takes the holder out) before this runs.
  var cardsEl = null, cardsAt = false;
  function placeCards(bar) {
    var was = cardsAt;
    if (bar) {
      if (!cardsEl) {
        cardsEl = doc.createElement("div");
        cardsEl.id = "ld-cards";
      }
      bar.appendChild(cardsEl);                       // after the apps and the Pocket
    } else if (cardsEl) cardsEl.remove();
    cardsAt = !!bar;
    if (was !== cardsAt) {
      try { doc.dispatchEvent(new CustomEvent("oros-dock-cards")); } catch (e) {}
    }
  }
  function removeDock() {
    placeCards(null);
    if (dock) { dock.remove(); dock = null; }
    if (edge) { edge.remove(); edge = null; }
  }

  function revealDock() {
    if (!dock) return;
    clearTimeout(hideTimer);
    dock.classList.remove("ld-hidden");
    dockShownAt = Date.now();
  }
  function hideSoon(ms) {
    if (!dock || !prefs().autohide) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (!dock) return;
      if (dock.contains(doc.activeElement) || (ctx && dock.contains(ctx.back))) { hideSoon(ms); return; }
      dock.classList.add("ld-hidden");
    }, ms);
  }

  function paintDock() {
    if (!host) return;
    var p = prefs();
    var ids = p.on ? shown("dock") : [];
    var side = sideNow(p);
    if (!ids.length) { removeDock(); setVars(p, false, side); return; }
    var act = doc.activeElement;
    var focusId = act && dock && dock.contains(act) ? (act.getAttribute("data-app") || act.getAttribute("data-group")) : null;
    if (!dock) {
      dock = doc.createElement("div");
      dock.id = "ld-dock";
      dock.setAttribute("role", "toolbar");
      var bar = doc.createElement("div");
      bar.className = "ld-bar";
      dock.appendChild(bar);
      doc.body.appendChild(dock);
      wireDock(dock, bar);
      edge = doc.createElement("button");
      edge.type = "button";
      edge.id = "ld-edge";
      edge.appendChild(doc.createElement("span"));
      edge.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") revealDock(); });
      edge.addEventListener("click", function () { revealDock(); hideSoon(4000); });
      doc.body.appendChild(edge);
      if (p.autohide) dock.classList.add("ld-hidden");
    }
    dock.setAttribute("aria-label", tr("dock"));
    edge.setAttribute("aria-label", tr("reveal"));
    edge.title = tr("reveal");
    var noover = !overApps(p);
    dock.classList.toggle("ld-noover", noover);
    edge.classList.toggle("ld-noover", noover);
    edge.hidden = !p.autohide;
    edge.tabIndex = -1;                 // keyboard users reach the Dock itself (focus reveals it)
    if (!p.autohide) { clearTimeout(hideTimer); dock.classList.remove("ld-hidden"); }
    dock.style.setProperty("--ld-t", SIZES[p.size] + "px");
    POSITIONS.forEach(function (k) {
      if (k === "bottom") return;
      dock.classList.toggle("ld-p-" + k, side === k);
      edge.classList.toggle("ld-p-" + k, side === k);
    });
    dock.classList.toggle("ld-v", side === "left" || side === "right");
    dock.setAttribute("aria-orientation", vertical() ? "vertical" : "horizontal");
    STYLES.forEach(function (k) { dock.classList.toggle("ld-s-" + k, p.style === k); });
    HOVERS.forEach(function (k) { dock.classList.toggle("ld-h-" + k, p.hover === k); });
    var bar2 = dock.firstChild;
    bar2.textContent = "";
    bar2.style.removeProperty("--ld-mag");
    var run = runningId();
    var pos = -1;
    dockEntries(load(), ids).forEach(function (en) {
      pos++;
      if (en.group) { bar2.appendChild(groupTile(en, pos, run)); return; }
      var id = en.app;
      var app = appById(id);
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "ld-dk" + (run === id ? " run" : (host.isOpen && host.isOpen(id) ? " open" : ""));
      b.setAttribute("data-app", id);
      b.setAttribute("aria-label", labelOf(app));
      b.setAttribute("data-ld-name", labelOf(app));
      if (run === id) b.setAttribute("aria-current", "true");
      b.appendChild(tileFor(app, pos));
      var dot = doc.createElement("span");
      dot.className = "ld-dot";
      b.appendChild(dot);
      var tip = doc.createElement("span");
      tip.className = "ld-tip";
      tip.setAttribute("aria-hidden", "true");
      tip.textContent = labelOf(app);
      b.appendChild(tip);
      wireIcon(b, id, "dock");
      bar2.appendChild(b);
    });
    // One more button after the apps (the Pocket, POCKET-1): the shell
    // builds it; it is not an app and is never dragged or reordered.
    var extra = null;
    try { extra = host.dockExtra ? host.dockExtra() : null; } catch (e) { extra = null; }
    if (extra) bar2.appendChild(extra);
    placeCards(cardsHere(p, root.innerWidth, side) ? bar2 : null);
    setVars(p, true, side);
    fitColumn();
    paintBadges();
    if (focusId) focusIcon(focusId, "dock");
  }

  // ---------- 11a. Dock groups (DOCK-GRP) ----------
  function groupLabel(en) { return en.name || tr("grpNew").replace("{n}", ""); }
  function groupTile(en, pos, run) {
    var b = doc.createElement("button");
    b.type = "button";
    var on = en.ids.indexOf(run) >= 0, open = !on && host.isOpen && en.ids.some(function (x) { return host.isOpen(x); });
    b.className = "ld-dk ld-grp" + (on ? " run" : open ? " open" : "");
    b.setAttribute("data-group", en.group);
    b.setAttribute("data-ids", en.ids.join(" "));
    var name = tr("grpAria").replace("{name}", groupLabel(en)).replace("{n}", String(en.ids.length));
    b.setAttribute("aria-label", name);
    b.setAttribute("data-ld-name", name);
    b.setAttribute("aria-haspopup", "dialog");
    b.setAttribute("aria-expanded", "false");
    var tile = doc.createElement("span");
    tile.className = "ld-tile ld-gtile";
    tile.setAttribute("data-hue", hueOf(null, pos));
    en.ids.slice(0, 4).forEach(function (id) {
      var app = appById(id);
      if (!app) return;
      var mini = doc.createElement("span");
      mini.className = "ld-gmini";
      mini.innerHTML = iconOf(app);          // static shell icon, not data
      tile.appendChild(mini);
    });
    b.appendChild(tile);
    var dot = doc.createElement("span");
    dot.className = "ld-dot";
    b.appendChild(dot);
    var tip = doc.createElement("span");
    tip.className = "ld-tip";
    tip.setAttribute("aria-hidden", "true");
    tip.textContent = groupLabel(en);
    b.appendChild(tip);
    b.addEventListener("click", function (e) {
      if (b.__ldDragged) { e.preventDefault(); b.__ldDragged = false; return; }
      if (ctx && ctx.back === b) { closeCtx(true); return; }
      openGroup(en.group, b);
    });
    b.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      var r = b.getBoundingClientRect(), kb = !e.clientX && !e.clientY;
      openCtx(null, "dock", b, kb ? r.left : e.clientX, kb ? r.top : e.clientY, en.group);
    });
    return b;
  }
  function entryOf(gid) {
    var es = dockEntries(load(), shown("dock"));
    for (var i = 0; i < es.length; i++) if (es[i].group === gid) return es[i];
    return null;
  }
  // The group's panel: its name (edit to rename), its apps (tap to open,
  // × to take one out) and Ungroup.
  function openGroup(gid, anchor) {
    closeCtx(false);
    var en = entryOf(gid);
    if (!en) return;
    var m = doc.createElement("div");
    m.className = "ld-menu ld-gpop";
    m.setAttribute("role", "dialog");
    m.setAttribute("aria-label", groupLabel(en));
    var nm = doc.createElement("input");
    nm.type = "text";
    nm.className = "ld-gname";
    nm.maxLength = 40;
    nm.value = en.name;
    nm.placeholder = tr("grpNew").replace("{n}", "").trim();
    nm.setAttribute("aria-label", tr("grpName"));
    nm.setAttribute("data-k", "ld-gname");
    var saveName = function () {
      if (nm.value.trim() && nm.value.trim() !== en.name) change(groupRename(load(), gid, nm.value, Date.now()));
    };
    nm.addEventListener("change", saveName);
    nm.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); saveName(); closeCtx(true); } });
    m.appendChild(nm);
    var grid = doc.createElement("div");
    grid.className = "ld-ggrid";
    en.ids.forEach(function (id, n) {
      var app = appById(id);
      if (!app) return;
      var cell = doc.createElement("div");
      cell.className = "ld-gcell";
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "ld-gapp";
      b.setAttribute("data-app", id);
      b.appendChild(tileFor(app, n));
      var lab = doc.createElement("span");
      lab.className = "ld-gl";
      lab.textContent = labelOf(app);
      b.appendChild(lab);
      b.addEventListener("click", function () { closeCtx(false); launch(id); });
      cell.appendChild(b);
      var x = doc.createElement("button");
      x.type = "button";
      x.className = "ld-gx";
      x.textContent = "\u00d7";
      x.setAttribute("aria-label", tr("grpOut") + ": " + labelOf(app));
      x.title = tr("grpOut");
      x.setAttribute("data-k", "ld-gout:" + id);
      x.addEventListener("click", function () {
        closeCtx(false);
        change(groupLeave(load(), id, shown("dock"), Date.now()));
        if (entryOf(gid)) { var t = doc.querySelector('#ld-dock [data-group="' + gid + '"]'); if (t) openGroup(gid, t); }
        else focusIcon(id, "dock");
      });
      cell.appendChild(x);
      grid.appendChild(cell);
    });
    m.appendChild(grid);
    var ug = doc.createElement("button");
    ug.type = "button";
    ug.className = "ld-danger";
    ug.textContent = tr("grpUngroup");
    ug.setAttribute("data-k", "ld-gungroup");
    ug.addEventListener("click", function () {
      closeCtx(false);
      var first = en.ids[0];
      change(groupUngroup(load(), gid, shown("dock"), Date.now()));
      focusIcon(first, "dock");
    });
    m.appendChild(ug);
    m.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); saveName(); closeCtx(true); }
    });
    placePop(m, anchor, 0, 0, true);
    anchor.setAttribute("aria-expanded", "true");
    ctx = { el: m, back: anchor, onClose: function () { saveName(); anchor.setAttribute("aria-expanded", "false"); } };
    doc.addEventListener("pointerdown", ctxOutside, true);
    var f = grid.querySelector(".ld-gapp");
    if (f) f.focus();
  }

  // ---------- 11b. Count badges (BADGE-1) ----------
  // Painted onto the icons that are there; never rebuilds them.
  var overdue = {}, overdueAt = 0, overdueBusy = false, badgeRaf = 0;
  var OVERDUE_MS = 5 * 60000;
  function strictOn() {
    var S = root.orosStrict;
    try { return !!(S && typeof S.level === "function" && S.level()); } catch (e) { return false; }
  }
  function lockedApp(id) {
    var L = root.orosLock;
    if (!L || !L.apps || typeof L.apps.state !== "function") return false;
    try { return !!L.apps.state(id); } catch (e) { return true; }
  }
  function countsNow() {
    if (!prefs().badges || strictOn()) return {};
    var N = root.orosNotifs, items = [];
    try { items = (N && typeof N.getSlice === "function" && N.getSlice() && N.getSlice().items) || []; } catch (e) { items = []; }
    var hidden = {};
    apps().forEach(function (a) { if (a && a.searchOff === true) hidden[a.id] = true; });
    var c = badgeCounts(items, overdue, hidden);
    Object.keys(c).forEach(function (id) { if (lockedApp(id)) delete c[id]; });
    return c;
  }
  function badgeOn(b, n) {
    var tile = b.querySelector(".ld-tile");
    if (!tile) return;
    var el = tile.querySelector(".ld-badge");
    var name = b.getAttribute("data-ld-name") || "";
    if (!n) {
      if (el) el.remove();
      if (b.classList.contains("ld-dk")) b.setAttribute("aria-label", name); else b.removeAttribute("aria-label");
      return;
    }
    if (!el) {
      el = doc.createElement("span");
      el.className = "ld-badge";
      el.setAttribute("aria-hidden", "true");
      tile.appendChild(el);
    }
    el.textContent = badgeText(n);
    b.setAttribute("aria-label", name + ", " + tr("badgeAria").replace("{n}", String(n)));
  }
  function paintBadges() {
    if (!host) return;
    var c = countsNow();
    var bs = doc.querySelectorAll("#ld-desk .ld-ic[data-app], #ld-dock .ld-dk[data-app]");
    for (var i = 0; i < bs.length; i++) badgeOn(bs[i], c[bs[i].getAttribute("data-app")] || 0);
    var gs = doc.querySelectorAll("#ld-dock .ld-grp[data-ids]");      // DOCK-GRP: a group shows the sum
    for (var g = 0; g < gs.length; g++) {
      badgeOn(gs[g], gs[g].getAttribute("data-ids").split(" ").reduce(function (n, id) { return n + (c[id] || 0); }, 0));
    }
    refreshOverdue(false);
  }
  function badgesSoon() {
    if (badgeRaf) return;
    badgeRaf = (root.requestAnimationFrame || setTimeout)(function () { badgeRaf = 0; paintBadges(); });
  }
  // To-Do: its late tasks (its own Today provider); Today: the summary's
  // late tasks of every app it shows. Only while one of them has an icon,
  // at most every 5 minutes (or when an app closes, `force`).
  function refreshOverdue(force) {
    var T = root.orosToday;
    if (overdueBusy || !T || !prefs().badges || strictOn()) return;
    if (!force && Date.now() - overdueAt < OVERDUE_MS) return;
    var placed = shown("desk").concat(prefs().on ? shown("dock") : []);
    var wantTodo = placed.indexOf("todo") >= 0 && typeof T.agenda === "function";
    var wantToday = placed.indexOf("today") >= 0 && typeof T.build === "function";
    if (!wantTodo && !wantToday) { overdueAt = Date.now(); return; }
    overdueBusy = true;
    var d = new Date(), pad = function (x) { return (x < 10 ? "0" : "") + x; };
    var today = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    var next = {};
    var jobs = [];
    if (wantTodo) jobs.push(Promise.resolve().then(function () { return T.agenda("todo", 1); }).then(function (rows) { next.todo = lateTasks(rows, today); }, function () {}));
    if (wantToday) jobs.push(Promise.resolve().then(function () { return T.build(); }).then(function (res) {
      next.today = res && res.counts && res.counts.overdue > 0 ? res.counts.overdue : 0;
    }, function () {}));
    Promise.all(jobs).then(function () {
      overdueBusy = false;
      overdueAt = Date.now();
      var changed = JSON.stringify(next) !== JSON.stringify(overdue);
      overdue = next;
      if (changed) badgesSoon();
    });
  }

  function wireDock(dk, bar) {
    // Auto-hide: leaving the Dock hides it again; focus shows it.
    dk.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") hideSoon(900); });
    dk.addEventListener("pointerenter", function () { clearTimeout(hideTimer); });
    dk.addEventListener("focusin", revealDock);
    dk.addEventListener("focusout", function () { hideSoon(900); });
    doc.addEventListener("pointerdown", function (e) {
      if (dock && prefs().autohide && !dock.contains(e.target) && !(edge && edge.contains(e.target)) &&
          !(ctx && ctx.el.contains(e.target)) && Date.now() - dockShownAt > 300) hideSoon(0);
    }, true);

    // Arrow keys walk the icons.
    bar.addEventListener("keydown", function (e) {
      var back = e.key === "ArrowLeft" || e.key === "ArrowUp", fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
      if (!back && !fwd && e.key !== "Home" && e.key !== "End") return;
      var bs = Array.prototype.slice.call(bar.querySelectorAll(".ld-dk"));
      var i = bs.indexOf(doc.activeElement);
      if (i === -1) return;
      e.preventDefault();
      var j = e.key === "Home" ? 0 : e.key === "End" ? bs.length - 1 : i + (back ? -1 : 1);
      if (bs[j]) bs[j].focus();
    });

    // Magnify (mouse only, hover effect "magnify"). Each icon grows from
    // its bottom centre and its neighbours slide apart by the extra width,
    // so grown icons never overlap; the bar widens by the same amount on
    // both sides, which keeps every icon's resting centre where it was.
    // Distances use layout positions (offsetLeft), never the transformed
    // boxes, so the effect does not feed back into itself. A side Dock
    // (1.6.0) does the same along its column (offsetTop, translateY);
    // a column that scrolls does not magnify.
    bar.addEventListener("mousemove", function (e) {
      var p = prefs();
      if (p.hover !== "magnify" || !finePointer() || dragging) return;
      var v = vertical();
      if (v && dk.classList.contains("ld-scroll")) return;
      var t = SIZES[p.size];
      var bs = bar.querySelectorAll(".ld-dk");
      var br = bar.getBoundingClientRect();
      var x = v ? e.clientY - br.top - bar.clientTop + bar.scrollTop
                : e.clientX - br.left - bar.clientLeft + bar.scrollLeft;
      var sc = [], extra = [], total = 0;
      for (var i = 0; i < bs.length; i++) {
        var len = v ? bs[i].offsetHeight : bs[i].offsetWidth;
        var c = (v ? bs[i].offsetTop : bs[i].offsetLeft) + len / 2;
        var d = Math.abs(x - c);
        sc[i] = 1 + MAG * Math.max(0, 1 - d / (t * 2.2));
        extra[i] = (sc[i] - 1) * len;
        total += extra[i];
      }
      var before = 0;
      for (var k = 0; k < bs.length; k++) {
        var shift = before + extra[k] / 2 - total / 2;
        before += extra[k];
        bs[k].style.transform = sc[k] > 1.001 || Math.abs(shift) > 0.1
          ? (v ? "translateY(" : "translateX(") + shift.toFixed(2) + "px) scale(" + sc[k].toFixed(3) + ")" : "";
      }
      bar.style.setProperty("--ld-mag", (total / 2).toFixed(2) + "px");
    });
    bar.addEventListener("mouseleave", unmagnify);
    function unmagnify() {
      var bs = bar.querySelectorAll(".ld-dk");
      for (var i = 0; i < bs.length; i++) bs[i].style.transform = "";
      bar.style.removeProperty("--ld-mag");
    }

    // Drag to reorder (mouse; touch uses the long-press menu, because
    // a finger dragging across a phone Dock scrolls it).
    var dragging = null, sx = 0, sy = 0, startIdx = -1;
    bar.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      var b = e.target.closest(".ld-dk");
      if (!b || !(b.hasAttribute("data-app") || b.hasAttribute("data-group"))) return;   // the Pocket button stays last
      dragging = null;
      var target = null;
      var isEntry = function (x) { return x.hasAttribute("data-app") || x.hasAttribute("data-group"); };
      var setTarget = function (t) {
        if (target === t) return;
        if (target) target.classList.remove("ld-drop");
        target = t;
        if (target) target.classList.add("ld-drop");
      };
      sx = e.clientX; sy = e.clientY;
      var v = vertical();
      var onMove = function (ev) {
        if (!dragging) {
          if (Math.abs(v ? ev.clientY - sy : ev.clientX - sx) < 6) return;
          dragging = b;
          startIdx = Array.prototype.indexOf.call(bar.children, b);
          b.classList.add("drag");
          unmagnify();
        }
        var bs = Array.prototype.filter.call(bar.children, function (x) { return x !== dragging && isEntry(x); });
        // DOCK-GRP: an app held over the middle of another icon groups.
        var over = null;
        if (dragging.hasAttribute("data-app")) {
          for (var o = 0; o < bs.length; o++) {
            var ro = bs[o].getBoundingClientRect();
            var lo = v ? ro.top : ro.left, len = v ? ro.height : ro.width, at = v ? ev.clientY : ev.clientX;
            var across = v ? ev.clientX >= ro.left - 8 && ev.clientX <= ro.right + 8 : ev.clientY >= ro.top - 12 && ev.clientY <= ro.bottom + 8;
            if (across && at > lo + len * 0.28 && at < lo + len * 0.72) { over = bs[o]; break; }
          }
        }
        setTarget(over);
        if (over) return;
        var before = null;
        for (var i = 0; i < bs.length; i++) {
          var r = bs[i].getBoundingClientRect();
          if (v ? ev.clientY < r.top + r.height / 2 : ev.clientX < r.left + r.width / 2) { before = bs[i]; break; }
        }
        if (!before) before = bar.querySelector(".ld-pocket");     // apps stay before the Pocket
        if (before !== dragging.nextSibling) bar.insertBefore(dragging, before);
      };
      var onUp = function () {
        doc.removeEventListener("pointermove", onMove, true);
        doc.removeEventListener("pointerup", onUp, true);
        if (!dragging) return;
        var d = dragging, t = target;
        dragging = null;
        setTarget(null);
        d.classList.remove("drag");
        d.__ldDragged = true;
        setTimeout(function () { d.__ldDragged = false; }, 0);
        var aid = d.getAttribute("data-app"), gid = d.getAttribute("data-group");
        if (t && aid) {
          var tg = t.getAttribute("data-group");
          groupDrop(aid, tg ? { group: tg } : { app: t.getAttribute("data-app") });
          return;
        }
        var idx = Array.prototype.filter.call(bar.children, isEntry).indexOf(d);
        if (Array.prototype.indexOf.call(bar.children, d) !== startIdx) {
          change(dockMoveTo(load(), gid ? { group: gid } : { app: aid }, idx, shown("dock"), Date.now()));
        }
        focusIcon(aid || gid, "dock");
      };
      doc.addEventListener("pointermove", onMove, true);
      doc.addEventListener("pointerup", onUp, true);
    });
  }

  function paint() {
    if (!host) return;
    paintDesktop();
    paintDock();
    paintStars();
  }

  // ---------- 12. Public API ----------
  // host = { apps(), open(app), running(), label(app), icons, lang(), desktop,
  //          category(c) optional: a category's label (DOCK-GRP names),
  //          menuChanged(), isOpen(id) optional: alive behind (multitasking),
  //          aliasHost(id) / openAlias(id) optional: APP-ALIAS (1.5.0),
  //          dockExtra() optional: one more button after the apps, or null
  //          (the Pocket, POCKET-1) }
  function attach(h) {
    if (host) return;
    host = h || {};
    injectCss();
    load();
    registerSync();
    // The open app's dot in the Dock, and hiding the Dock behind a
    // running app (CSS) — both follow #oros-running.
    var run = doc.getElementById("oros-running");
    if (run && root.MutationObserver) {
      new root.MutationObserver(function () { paintDock(); refreshOverdue(true); }).observe(run, { attributes: true, attributeFilter: ["class"] });
    }
    // BADGE-1: the inbox changed (notifications.js), Sensitive work went
    // on or off, the tab came back.
    doc.addEventListener("oros-notifs-changed", badgesSoon);
    try { if (root.orosStrict && typeof root.orosStrict.onChange === "function") root.orosStrict.onChange(badgesSoon); } catch (e) {}
    doc.addEventListener("visibilitychange", function () { if (!doc.hidden) paintBadges(); });
    // A window made narrow or short moves a side Dock to the bottom
    // and back; a column that no longer fits starts to scroll.
    var resizeRaf = 0;
    root.addEventListener("resize", function () {
      if (resizeRaf || !dock) return;
      resizeRaf = (root.requestAnimationFrame || setTimeout)(function () {
        resizeRaf = 0;
        if (!dock) return;
        var p = prefs(), side = sideNow(p);
        if (side !== dockEdge() || cardsHere(p, root.innerWidth, side) !== cardsAt) paintDock();
        else fitColumn();
      });
    });
  }

  // For the Settings app: read and write the Dock settings without the
  // menu section. `over` comes resolved (never chosen = off).
  function publicPrefs() {
    var p = prefs();
    return { on: p.on, size: p.size, magnify: p.magnify, autohide: p.autohide,
             over: overApps(p), style: p.style, styles: STYLES.slice(),
             hover: p.hover, hovers: HOVERS.slice(),
             pos: p.pos, positions: POSITIONS.slice(), side: sideNow(p),
             fine: finePointer(), pinned: shown("dock").length, badges: p.badges, cards: p.cards };
  }
  var PREF_OK = {
    on: function (v) { return typeof v === "boolean"; },
    size: function (v) { return Object.prototype.hasOwnProperty.call(SIZES, v); },
    magnify: function (v) { return typeof v === "boolean"; },
    autohide: function (v) { return typeof v === "boolean"; },
    over: function (v) { return typeof v === "boolean" || v === null; },
    style: function (v) { return STYLES.indexOf(v) >= 0; },
    hover: function (v) { return HOVERS.indexOf(v) >= 0; },
    pos: function (v) { return POSITIONS.indexOf(v) >= 0; },
    badges: function (v) { return typeof v === "boolean"; },
    cards: function (v) { return typeof v === "boolean"; }
  };
  function setPref(k, v) {
    if (!Object.prototype.hasOwnProperty.call(PREF_OK, k) || !PREF_OK[k](v)) return false;
    var q = prefs();
    if (k === "magnify") { k = "hover"; v = v ? "magnify" : "none"; }
    q[k] = v; savePrefs(q); repaintSettings();
    return true;
  }

  root.orosLauncher = {
    VER: VER,
    model: model,
    attach: attach,
    refresh: paint,
    refreshDock: function () { paintDock(); },     // the Pocket's count changed (POCKET-1)
    badges: function () { return countsNow(); },   // BADGE-1: { appId: n } shown now
    // DOCK-CARDS: the holder at the end of the Dock, or null (top bar)
    cardSlot: function () { return cardsEl && cardsEl.isConnected ? cardsEl : null; },
    menuRow: menuRow,
    renderSettings: renderSettings,
    prefs: publicPrefs,
    setPref: setPref,
    menuHidden: isMenuHidden,
    menuHiddenIds: function () { return menuHiddenIds(menuLoad()); },
    setMenuHidden: setMenuHidden,
    presetMenuHidden: presetMenuHidden,
    menuStored: menuStored,
    // the apps on this device's desktop and Dock (Focus F3 picker)
    placed: function () { return { desk: shown("desk"), dock: shown("dock") }; }
  };
})(typeof window !== "undefined" ? window : globalThis);
