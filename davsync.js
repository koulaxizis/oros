// ============================================================
// orOS — CalDAV / CardDAV sync engine (davsync.js), CalDAV wave 3
// One pass over ONE linked collection (a server calendar, address
// book or task list) against the app's own items, through davkit.js
// (the client) and a mapper the app gives (calendar/dav.js for
// Calendar; Contacts and To-Do follow in waves 4 and 5).
//
// The engine never touches the app's data itself. It returns what to
// write locally (upsert / remove) and the new device-local state; the
// app applies the result with its own stamps (so other orOS devices
// get it by normal sync), then saves the state, then runs again when
// `retry` says a conditional write was refused.
//
// State per link (device-local, IndexedDB "oros-dav", never synced):
//   { v: 1, token, items: { key: { href, etag, hash, id, ro, extra: { id: hash } } },
//     raw: { key: the server's own text } }
// key = the item's address without encoding differences (normHref).
//
// The rules (Bible Part II "CalDAV / CardDAV W3"):
//   DAV-1 no base, no delete: an item gone from the server is removed
//         here only when this device saw it before and its copy here
//         is unchanged since; a changed copy is uploaded again.
//   DAV-2 a deletion here goes out as DELETE If-Match <base etag>; a
//         refusal (412) deletes nothing and the server copy comes back.
//   DAV-3 an empty listing where items were seen deletes nothing; more
//         than 50 deletions, or more than 20% of the collection (5 or
//         more), in one pass wait for the person's answer (`held`).
//   DAV-4 a write patches the server's own text (the mapper's write)
//         so what orOS does not model survives; an item orOS cannot
//         show exactly is read-only here (`ro`): the server wins.
//   DAV-6 the base hash is the mapper's hash of the same projection a
//         write is built from, so a pass that changed nothing writes
//         nothing.
// Both sides changed: the newer wins (the item's mtime here, the
// server's LAST-MODIFIED there) and the other version is kept as a
// copy (mapper.copy, "(conflict)"), which then uploads as a new item.
// New items here: PUT <collection>/<mapper.file(id)> If-None-Match: *.
// New items there: the mapper's id (own orOS UID → that id; an item
// already here by the same UID is bound; otherwise "dav-" + a hash of
// collection + UID, the same on every device).
//
// Pure: no DOM, no storage of its own (idbStore / memStore are given
// to it). Browser: window.OrosDavSync. Node: module.exports
// (tests/davsync.test.js with tests/dav-fake.js).
// ============================================================
(function (root) {
  "use strict";

  var MAX_DEL = 50, DEL_SHARE = 0.2, DEL_MIN = 5;
  var CONCURRENCY = 4;

  // FNV-1a, two seeds → 16 hex digits. Not secret, only stable.
  function hash(s) {
    s = String(s);
    function fnv(seed) {
      var h = seed >>> 0;
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return ("0000000" + h.toString(16)).slice(-8);
    }
    return fnv(2166136261) + fnv(0x9747b28c);
  }

  // One spelling per address: "/a%40b/x%20y.ics" and "/a@b/x y.ics"
  // are the same item.
  function normHref(h) {
    try {
      var u = new URL(h);
      var p = u.pathname;
      try { p = decodeURIComponent(p); } catch (e) {}
      return u.origin + p;
    } catch (e) { return String(h); }
  }
  function within(colUrl, name) {
    var base = colUrl.replace(/\/?$/, "/");
    return new URL(encodeURIComponent(name), base).href;
  }

  function emptyState() { return { v: 1, token: "", items: {}, raw: {} }; }
  function cleanState(s) {
    if (!s || typeof s !== "object" || s.v !== 1 || !s.items || typeof s.items !== "object") return emptyState();
    var out = { v: 1, token: typeof s.token === "string" ? s.token : "", items: {}, raw: {} };
    Object.keys(s.items).forEach(function (k) {
      var b = s.items[k];
      if (!b || typeof b.href !== "string" || typeof b.id !== "string" || !b.id) return;
      out.items[k] = { href: b.href, etag: typeof b.etag === "string" ? b.etag : "",
                       hash: typeof b.hash === "string" ? b.hash : "", id: b.id, ro: b.ro === true,
                       extra: b.extra && typeof b.extra === "object" ? Object.assign({}, b.extra) : {} };
      if (s.raw && typeof s.raw[k] === "string") out.raw[k] = s.raw[k];
    });
    return out;
  }

  // Run fn over list, at most n at a time, in order of start.
  function each(list, n, fn) {
    var i = 0;
    function worker() {
      if (i >= list.length) return Promise.resolve();
      var x = list[i++];
      return Promise.resolve().then(function () { return fn(x); }).then(worker);
    }
    var ws = [];
    for (var k = 0; k < Math.min(n, list.length); k++) ws.push(worker());
    return Promise.all(ws);
  }

  // o: { client, url, readOnly, state, local: { items: [{id, item}], find(id) },
  //      map: { read, write, hash, idFor, file, copy, mtime, type, kind },
  //      dry, decision: "allow" | "restore" | null }
  // → { state, upsert: [item], remove: [id], held, retry, ro: {id: 1}, stats }
  function run(o) {
    var cl = o.client, map = o.map, url = o.url;
    var prev = o.state ? cleanState(o.state) : null;
    var S = prev ? cleanState(prev) : emptyState();
    var first = !prev;
    var L = {};
    (o.local.items || []).forEach(function (x) { if (x && x.id) L[x.id] = x.item; });

    var claimed = {};                     // id → key, from the base
    Object.keys(S.items).forEach(function (k) {
      var b = S.items[k];
      claimed[b.id] = k;
      Object.keys(b.extra).forEach(function (x) { claimed[x] = k; });
    });
    // A "dav-" item here that this device never saw on the server:
    // only a full listing can tell whether it is still there.
    var full = !S.token || o.decision === "restore" ||
      Object.keys(L).some(function (id) { return !claimed[id] && /^dav-/.test(id); });

    var stats = { up: 0, down: 0, same: 0, del: 0, delServer: 0, conflicts: 0, ro: 0, errors: 0, items: 0 };
    var up = [], rm = [], roIds = {}, retry = false, forceFull = false;
    var upById = {};
    function upsert(item) { upById[item.id] = item; }
    var baseSize = Object.keys(S.items).length;

    function listing() {
      if (!full) {
        return cl.syncCollection(url, S.token).then(function (r) {
          return { token: r.token, changed: r.changed, removed: r.removed, full: false };
        }, function (e) {
          if (!e || e.message !== "cd-token") throw e;
          full = true;
          return listing();
        });
      }
      return cl.syncCollection(url, "").then(function (r) {
        return { token: r.token, changed: r.changed, removed: null, full: true };
      }, function (e) {
        if (!e || (e.message !== "cd-token" && e.message !== "cd-http")) throw e;
        return cl.listEtags(url).then(function (all) { return { token: "", changed: all, removed: null, full: true }; });
      });
    }

    return listing().then(function (lst) {
      var seen = {};
      lst.changed.forEach(function (c) { seen[normHref(c.href)] = c; });
      var removed = [];
      if (lst.full) {
        // DAV-3: an empty listing where items were seen deletes nothing.
        if (lst.changed.length || !baseSize) {
          Object.keys(S.items).forEach(function (k) { if (!seen[k]) removed.push(k); });
        }
      } else {
        lst.removed.forEach(function (h) { var k = normHref(h); if (S.items[k]) removed.push(k); });
      }
      var want = lst.changed.filter(function (c) {
        var b = S.items[normHref(c.href)];
        return !b || b.etag !== c.etag;
      }).map(function (c) { return c.href; });
      return cl.multiget(url, map.kind, want).then(function (got) {
        return { lst: lst, got: got, removed: removed };
      });
    }).then(function (p) {
      var puts = [], dels = [], restoreLocal = [];
      var visited = {};
      var localDeletes = [];             // [key] DAV-1 removals here
      stats.items = p.lst.changed.length;

      function pickId(r, k) {
        var ids = map.idFor(r.uid, k);
        var taken = function (id) { return id && claimed[id] && claimed[id] !== k; };
        if (ids.own && !taken(ids.own)) return ids.own;
        if (ids.bind && !taken(ids.bind) && (L[ids.bind] || o.local.find(ids.bind))) return ids.bind;
        if (!taken(ids.dav)) return ids.dav;
        return "dav-" + hash(k);
      }
      function baseOf(r, k, etag, id, raw) {
        var ex = {};
        (r.extras || []).forEach(function (x) { ex[x.id] = map.hash(x); claimed[x.id] = k; });
        S.items[k] = { href: S.items[k] ? S.items[k].href : k, etag: etag, hash: map.hash(r.main), id: id,
                       ro: !!(r.ro || o.readOnly), extra: ex };
        S.raw[k] = raw;
        claimed[id] = k;
      }
      function takeServer(r, prevExtra) {
        upsert(r.main);
        (r.extras || []).forEach(function (x) { upsert(x); visited[x.id] = 1; });
        Object.keys(prevExtra || {}).forEach(function (x) {
          if (!(r.extras || []).some(function (y) { return y.id === x; })) rm.push(x);
        });
      }

      // 1. What changed on the server.
      p.got.forEach(function (g) {
        var k = normHref(g.href);
        var b = S.items[k];
        var r = map.read(g.data, g.href);
        if (!r) {                          // not this app's (a task in a calendar)
          if (b) { delete S.items[k]; delete S.raw[k]; }
          return;
        }
        if (r.gone) {                      // cancelled: as if removed there
          if (b) p.removed.push(k);
          return;
        }
        var id = b ? b.id : pickId(r, k);
        r.main.id = id;
        visited[id] = 1;
        (r.extras || []).forEach(function (x) { visited[x.id] = 1; });
        var sh = map.hash(r.main);
        var ro = !!(r.ro || o.readOnly);
        var loc = L[id] || (!b ? o.local.find(id) : null);
        if (ro) roIds[id] = 1;
        (r.extras || []).forEach(function (x) { roIds[x.id] = 1; });
        if (!b) {
          if (!loc) { takeServer(r); stats.down++; baseOf(r, k, g.etag, id, g.data); return; }
          if (map.hash(loc) === sh) {
            if (!L[id]) upsert(r.main);    // bound from outside the link: moves into it
            (r.extras || []).forEach(function (x) { upsert(x); });
            stats.same++;
            baseOf(r, k, g.etag, id, g.data);
            return;
          }
          // Never in sync before: the newer one is kept, no copy.
          if (ro || map.mtime(loc) <= r.mtime) { takeServer(r); stats.down++; baseOf(r, k, g.etag, id, g.data); return; }
          baseOf(r, k, g.etag, id, g.data);
          S.items[k].hash = "";            // not in sync yet: the PUT sets it
          puts.push({ k: k, href: g.href, id: id, item: loc, etag: g.etag, raw: g.data, nobase: true });
          return;
        }
        if (!loc) {                        // deleted here, changed there: it comes back (DAV-2)
          takeServer(r, b.extra); stats.down++; baseOf(r, k, g.etag, id, g.data); return;
        }
        var localChanged = map.hash(loc) !== b.hash;
        if (!localChanged || ro) { takeServer(r, b.extra); stats.down++; baseOf(r, k, g.etag, id, g.data); return; }
        // The same change on both sides (another orOS device brought it): in step.
        if (map.hash(loc) === sh) {
          (r.extras || []).forEach(function (x) { upsert(x); });
          stats.same++;
          baseOf(r, k, g.etag, id, g.data);
          return;
        }
        // Both changed. The copy goes up in the next pass (retry).
        stats.conflicts++;
        retry = true;
        if (map.mtime(loc) >= r.mtime) {
          upsert(map.copy(r.main));
          baseOf(r, k, g.etag, id, g.data);
          puts.push({ k: k, href: g.href, id: id, item: loc, etag: g.etag, raw: g.data });
        } else {
          upsert(map.copy(loc));
          takeServer(r, b.extra); stats.down++;
          baseOf(r, k, g.etag, id, g.data);
        }
      });

      // 2. Gone from the server (DAV-1).
      p.removed.forEach(function (k) {
        var b = S.items[k];
        if (!b) return;
        visited[b.id] = 1;
        Object.keys(b.extra).forEach(function (x) { visited[x] = 1; });
        var loc = L[b.id];
        if (!loc) { delete S.items[k]; delete S.raw[k]; return; }
        if (b.ro || map.hash(loc) === b.hash) { localDeletes.push(k); return; }
        // Changed here since: uploaded again (local wins, as VD-4).
        delete S.items[k]; delete S.raw[k];
        puts.push({ k: null, href: within(url, map.file(b.id)), id: b.id, item: loc, create: true, raw: null });
      });

      // 3. The base items the server did not change.
      Object.keys(S.items).forEach(function (k) {
        var b = S.items[k];
        if (visited[b.id]) return;
        visited[b.id] = 1;
        var loc = L[b.id];
        if (b.ro) roIds[b.id] = 1;
        var exIds = Object.keys(b.extra);
        exIds.forEach(function (x) { visited[x] = 1; roIds[x] = 1; });
        var needExtras = exIds.some(function (x) { return !L[x] || map.hash(L[x]) !== b.extra[x]; });
        if (!loc) {
          if (o.readOnly) { restoreLocal.push(k); return; }   // nothing can be deleted there
          dels.push(k);
          return;
        }
        if (map.hash(loc) !== b.hash) {
          if (b.ro) { restoreLocal.push(k); return; }               // the server wins
          puts.push({ k: k, href: b.href, id: b.id, item: loc, etag: b.etag, raw: S.raw[k] || null });
        } else if (needExtras) {
          restoreLocal.push(k);
        }
      });

      // 4. New here.
      Object.keys(L).forEach(function (id) {
        if (visited[id] || claimed[id]) return;
        if (o.readOnly) { stats.ro++; return; }
        puts.push({ k: null, href: within(url, map.file(id)), id: id, item: L[id], create: true, raw: null });
      });

      // DAV-3: many deletions wait for the person.
      var nDel = localDeletes.length + dels.length;
      var held = null;
      var many = nDel > MAX_DEL || (nDel >= DEL_MIN && nDel > DEL_SHARE * baseSize);
      if (many && o.decision !== "allow" && o.decision !== "restore") {
        held = { local: localDeletes.length, server: dels.length };
        localDeletes = []; dels = [];
      } else if (o.decision === "restore") {
        localDeletes.forEach(function (k) {
          var b = S.items[k];
          puts.push({ k: null, href: within(url, map.file(b.id)), id: b.id, item: L[b.id], create: true, raw: null });
          delete S.items[k]; delete S.raw[k];
        });
        dels.forEach(function (k) { restoreLocal.push(k); });
        localDeletes = []; dels = [];
      }

      localDeletes.forEach(function (k) {
        var b = S.items[k];
        rm.push(b.id);
        Object.keys(b.extra).forEach(function (x) { rm.push(x); });
        delete S.items[k]; delete S.raw[k];
        stats.del++;
      });
      restoreLocal.forEach(function (k) {
        var r = S.raw[k] ? map.read(S.raw[k], S.items[k].href) : null;
        if (!r || r.gone) return;
        r.main.id = S.items[k].id;
        takeServer(r, S.items[k].extra);
        stats.down++;
      });

      if (o.dry) {
        stats.up = puts.length;
        stats.delServer = dels.length;
        stats.del = localDeletes.length;
        return finish(held, true);
      }

      return each(puts, CONCURRENCY, function (w) {
        var text = map.write(w.item, w.raw);
        if (text === null) {
          // Cannot be written exactly: read-only, the server version stays.
          stats.ro++;
          roIds[w.id] = 1;
          if (w.k && S.raw[w.k]) {
            var r = map.read(S.raw[w.k], w.href);
            if (r && !r.gone) { r.main.id = w.id; takeServer(r, S.items[w.k].extra); S.items[w.k].ro = true; S.items[w.k].hash = map.hash(r.main); }
          }
          return;
        }
        var opts = w.create ? { create: true } : { etag: w.etag };
        return cl.put(w.href, text, map.type, opts).then(function (res) {
          if (!res.ok) {
            retry = true;
            if (w.create) forceFull = true;                 // made elsewhere meanwhile: read it
            if (w.nobase) { delete S.items[w.k]; delete S.raw[w.k]; }
            return;
          }
          var k = w.k || normHref(w.href);
          var keepExtra = S.items[k] ? S.items[k].extra : {};
          S.items[k] = { href: w.href, etag: res.etag, hash: map.hash(w.item), id: w.id, ro: false, extra: keepExtra };
          S.raw[k] = text;
          claimed[w.id] = k;
          stats.up++;
        }, function (e) {
          stats.errors++;
          if (e && e.message === "cd-readonly") { stats.ro++; roIds[w.id] = 1; return; }
          throw e;
        });
      }).then(function () {
        return each(dels, CONCURRENCY, function (k) {
          var b = S.items[k];
          return cl.del(b.href, b.etag).then(function (ok) {
            if (!ok) { retry = true; return; }
            delete S.items[k]; delete S.raw[k];
            stats.delServer++;
          }, function (e) {
            stats.errors++;
            if (e && e.message === "cd-readonly") { restoreLocalNow(k); return; }
            throw e;
          });
        });
      }).then(function () { return finish(held, false, p.lst.token); });

      function restoreLocalNow(k) {
        var r = S.raw[k] ? map.read(S.raw[k], S.items[k].href) : null;
        if (!r || r.gone) return;
        r.main.id = S.items[k].id;
        takeServer(r, S.items[k].extra);
      }
    });

    function finish(held, dry, token) {
      Object.keys(upById).forEach(function (id) { up.push(upById[id]); });
      // Held deletions keep the old token, so the next pass sees them again.
      if (!dry && !held && token !== undefined) S.token = token;
      if (forceFull) S.token = "";
      return { state: dry ? null : S, upsert: up, remove: rm, held: held, retry: retry, ro: roIds,
               stats: stats, first: first };
    }
  }

  // Up to 3 passes: after a refused write the next pass reads the
  // server again and decides again. apply(result) writes the app's
  // data (and returns a promise or nothing); local() gives o.local
  // fresh for every pass; save(state) keeps the state.
  // The result is the last pass's, with the counts of every pass added up.
  function sync(o, local, apply, save) {
    var n = 0, total = {};
    function once(state) {
      n++;
      var oo = Object.assign({}, o, { state: state, local: local() });
      return run(oo).then(function (r) {
        Object.keys(r.stats).forEach(function (k) { total[k] = (total[k] || 0) + r.stats[k]; });
        r.stats = Object.assign({}, total);
        return Promise.resolve(apply(r)).then(function () { return save(r.state); }).then(function () {
          if (r.retry && n < 3) {
            o = Object.assign({}, o, { decision: null });
            return once(r.state);
          }
          return r;
        });
      });
    }
    return once(o.state);
  }

  // ---------- state stores ----------
  function memStore() {
    var m = {};
    return {
      get: function (k) { return Promise.resolve(m.hasOwnProperty(k) ? JSON.parse(m[k]) : null); },
      set: function (k, v) { m[k] = JSON.stringify(v); return Promise.resolve(); },
      del: function (k) { delete m[k]; return Promise.resolve(); },
      keys: function () { return Promise.resolve(Object.keys(m)); }
    };
  }
  // IndexedDB "oros-dav", store "state" (device-local; in the factory
  // reset list in shell.js).
  function idbStore() {
    var dbP = null;
    function db() {
      if (dbP) return dbP;
      dbP = new Promise(function (res, rej) {
        var req;
        try { req = root.indexedDB.open("oros-dav", 1); } catch (e) { rej(e); return; }
        req.onupgradeneeded = function () { req.result.createObjectStore("state"); };
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { dbP = null; rej(req.error); };
      });
      return dbP;
    }
    function tx(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction("state", mode), st = t.objectStore("state"), out;
          var r = fn(st);
          if (r) r.onsuccess = function () { out = r.result; };
          t.oncomplete = function () { res(out); };
          t.onerror = function () { rej(t.error); };
          t.onabort = function () { rej(t.error); };
        });
      });
    }
    return {
      get: function (k) { return tx("readonly", function (st) { return st.get(k); }).then(function (v) { return v || null; }); },
      set: function (k, v) { return tx("readwrite", function (st) { st.put(v, k); }); },
      del: function (k) { return tx("readwrite", function (st) { st.delete(k); }); },
      keys: function () { return tx("readonly", function (st) { return st.getAllKeys(); }); }
    };
  }

  var api = { v: 1, run: run, sync: sync, hash: hash, normHref: normHref, within: within,
              memStore: memStore, idbStore: idbStore, MAX_DEL: MAX_DEL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosDavSync = api;
})(typeof window !== "undefined" ? window : null);
