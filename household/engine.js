// ============================================================
// orOS Household — the shell engine (window.orosHousehold, BR-HH)
// Loaded by the shell (index.html) after household/core.js and
// household/crypto.js. Keeps every household this person belongs to
// in step with its box on the orOS relay (relay/house.js), for all
// apps at once: apps read and change shared documents through this
// object (window.parent.orosHousehold in an app frame) and never talk
// to the relay themselves.
//
// Where things live:
//   - membership (households, member keys, household keys, admin
//     token): localStorage "oros-household-data", sync slice
//     "household" (so the person's other devices are members too);
//   - the shared documents: IndexedDB "oros-household" on this device
//     only, filled from the box (never copied into the person's own
//     cloud slices: one path per piece of data, no loops);
//   - a join waiting for an answer: localStorage
//     "oros-household-pending" (this device only).
// Sync per household: GET the revisions, fetch what changed, merge
// (core.merge, so nothing is lost), upload only documents that differ
// from what the box holds, with If-Match (a refused write fetches,
// merges and tries again). A hibernating WebSocket tells an open orOS
// that something changed; otherwise orOS asks when it opens, comes
// back to the front, goes online, and every 10 minutes.
// Removing a member: the admin's device makes a new household key,
// wraps it for each member left (relay "rot"); the removed person's
// write token stops working. Documents of a household left, or removed
// by someone, wait in the archive (30 days) so nothing vanishes
// unseen: apps take a private copy (To-Do), the Household app can put
// them back.
// The engine is created by create(opts) so the tests can run several
// people against one relay (tests/household-engine.test.js).
// ============================================================
(function (root) {
  "use strict";

  var Core = (root && root.OrosHouseCore) || (typeof require === "function" ? require("./core.js") : null);
  var X = (root && root.OrosHouseCrypto) || (typeof require === "function" ? require("./crypto.js") : null);

  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // = mail.js
  var SHARE_PAGE = "https://useoros.online/share/";
  var MEM_KEY = "oros-household-data";
  var PEND_KEY = "oros-household-pending";
  var ROSTER = "r";
  var DAY = 86400000;
  var LIMITS = { households: 6, members: 12, docBytes: 250 * 1024, archiveMs: 30 * DAY, pollMs: 10 * 60000 };

  function create(opts) {
    var fetchFn = opts.fetch;
    var store = opts.store;                 // { all(), put(rec), del(id) } (async)
    var memIO = opts.membership;            // { load() → obj, save(obj) }
    var pendIO = opts.pending;              // { load() → obj, save(obj) }
    var now = opts.now || function () { return Date.now(); };
    var notify = opts.notify || function () {};
    var onChanged = opts.changed || function () {};   // (box, id, before, after): a pull changed a shared document
    var WS = opts.WebSocket || null;
    var relay = String(opts.relay || RELAY).replace(/\/+$/, "");
    var lang = opts.lang || function () { return "en"; };
    var log = opts.log || function () {};
    var later = opts.later || function (fn, ms) { return setTimeout(fn, ms); };

    var mem = Core.cleanMembership(memIO.load());
    var pend = cleanPending(pendIO.load());
    var docs = {};          // box → k → { rev, doc, dirty }
    var arch = {};          // "box/k" → { box, k, kind, title, doc, at, why, take }
    var info = {};          // box → { status, reqs, epoch, err, at }
    var reqs = {};          // box → rid → decoded request
    var seen = {};          // box → newest stamp seen (hybrid clock)
    var listeners = [];
    var busy = {};          // box → promise of the running pass
    var again = {};         // box → another pass was asked for meanwhile
    var pushTimer = {};
    var sockets = {};
    var readyP = null;
    var wtok = {};

    // ---------- small helpers ----------
    function emit(ev) {
      listeners.slice().forEach(function (fn) { try { fn(ev); } catch (e) { log(e); } });
    }
    function saveMem() {
      mem = Core.cleanMembership(mem);
      memIO.save(mem);
      emit({ type: "list" });
    }
    function cleanPending(p) {
      var out = {};
      if (!p || typeof p !== "object") return out;
      Object.keys(p).forEach(function (b) {
        var e = p[b];
        if (!Core.BOX_RE.test(b) || !e || typeof e !== "object" || typeof e.rid !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(e.secret || "") ||
            !Core.BOX_RE.test(e.mid || "") || typeof e.pub !== "string" || !e.priv || typeof e.priv.d !== "string") return;
        out[b] = { box: b, secret: e.secret, rid: e.rid, mid: e.mid, pub: e.pub, priv: e.priv, name: Core.line(e.name, 40),
                   at: +e.at || 0, state: e.state === "refused" || e.state === "gone" ? e.state : "wait" };
      });
      return out;
    }
    function savePend() { pendIO.save(pend); emit({ type: "list" }); }
    function entry(box) { return mem.hh[box] || null; }
    function rec(box, k) { return (docs[box] || {})[k] || null; }
    function setRec(box, k, r) {
      (docs[box] = docs[box] || {})[k] = r;
      seen[box] = Math.max(seen[box] || 0, Core.newestOf(r.doc));
      return Promise.resolve(store.put({ id: box + "/" + k, box: box, k: k, rev: r.rev, doc: r.doc, dirty: !!r.dirty })).catch(log);
    }
    function dropRec(box, k) {
      if (docs[box]) delete docs[box][k];
      return Promise.resolve(store.del(box + "/" + k)).catch(log);
    }
    function stamp(box) {
      var t = Core.clock(seen[box] || 0, now());
      seen[box] = t;
      return t;
    }
    function rosterOf(box) { var r = rec(box, ROSTER); return Core.roster(r ? r.doc : null); }
    function me(box) {
      var e = entry(box);
      if (!e) return null;
      var r = rosterOf(box);
      return r.members.filter(function (m) { return m.id === e.mid; })[0] || null;
    }
    function fail(code) { var e = new Error(code); e.code = code; return e; }
    function token(box) {
      var e = entry(box);
      if (!e) return Promise.reject(fail("nohh"));
      var id = box + "/" + e.epoch;
      if (!wtok[id]) wtok[id] = X.writeToken(e.keys[e.epoch]);
      return wtok[id];
    }

    // ---------- relay calls ----------
    function call(method, box, path, o) {
      o = o || {};
      var h = {};
      var go = function () {
        var init = { method: method, headers: h, cache: "no-store" };
        if (o.json) { init.body = JSON.stringify(o.json); h["Content-Type"] = "application/json"; }
        else if (o.bytes) { init.body = o.bytes; h["Content-Type"] = "application/octet-stream"; }
        return fetchFn(relay + "/h/" + box + (path || ""), init);
      };
      if (o.rev !== undefined) h["If-Match"] = '"' + o.rev + '"';
      if (o.admin) h["X-HH-Admin"] = o.admin;
      if (o.invite) { h.Authorization = "Invite " + o.invite; return go(); }
      if (o.noauth) return go();
      return (o.w ? Promise.resolve(o.w) : token(box)).then(function (w) { h.Authorization = "Bearer " + w; return go(); });
    }
    function jsonOf(res) {
      return res.json().then(function (j) { return j; }, function () { return null; });
    }
    function bytesOf(res) { return res.arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
    function httpFail(res) {
      return jsonOf(res).then(function (j) { throw fail((j && j.error && j.error.code) || ("http-" + res.status)); });
    }

    // ---------- load ----------
    function ready() {
      if (readyP) return readyP;
      readyP = Promise.resolve(store.all()).then(function (rows) {
        (rows || []).forEach(function (r) {
          if (!r || typeof r.id !== "string") return;
          if (r.id.indexOf("x/") === 0) {
            if (now() - (r.at || 0) > LIMITS.archiveMs) { store.del(r.id); return; }
            arch[r.box + "/" + r.k] = r;
            return;
          }
          if (!entry(r.box)) { store.del(r.id); return; }
          var doc = Core.clean(r.doc, r.k === ROSTER ? "roster" : undefined);
          (docs[r.box] = docs[r.box] || {})[r.k] = { rev: +r.rev || 0, doc: doc, dirty: !!r.dirty };
          seen[r.box] = Math.max(seen[r.box] || 0, Core.newestOf(doc));
        });
      }, function (e) { log(e); }).then(function () { emit({ type: "list" }); });
      return readyP;
    }

    // ---------- the sync pass ----------
    function sync(box) {
      if (busy[box]) { again[box] = true; return busy[box]; }
      busy[box] = pass(box).catch(function (e) {
        var i = info[box] = info[box] || {};
        i.err = e && e.code || String(e && e.message || e);
        if (i.status !== "removed" && i.status !== "gone") i.status = "offline";
        emit({ type: "status", box: box });
      }).then(function () {
        busy[box] = null;
        if (again[box]) { again[box] = false; return sync(box); }
      });
      return busy[box];
    }
    function syncAll() {
      return ready().then(function () {
        return Promise.all(Object.keys(mem.hh).map(sync).concat([checkJoins()]));
      });
    }

    function pass(box) {
      var e = entry(box);
      if (!e) return Promise.resolve();
      return call("GET", box, "").then(function (res) {
        if (res.status === 404) return gone(box);
        if (!res.ok) return httpFail(res);
        return jsonOf(res).then(function (j) {
          var d = j && j.data;
          if (!d) throw fail("proto");
          if (d.moved) return newEpoch(box).then(function (okk) { if (okk) return pass(box); });
          return pullDocs(box, d).then(function () { return pushDirty(box); }).then(function () {
            return afterRoster(box);
          });
        });
      });
    }

    function pullDocs(box, d) {
      var i = info[box] = info[box] || {};
      i.status = "ok"; i.err = ""; i.epoch = d.epoch; i.at = now(); i.size = d.size || 0;
      var before = (i.reqs || []).join(",");
      i.reqs = Array.isArray(d.reqs) ? d.reqs.slice(0, 20) : [];
      if (i.reqs.join(",") !== before) {
        emit({ type: "requests", box: box });
        i.reqs.forEach(function (rid) { if (before.indexOf(rid) < 0) notify("req", box, { rid: rid, name: (entry(box) || {}).name }); });
      }
      var revs = d.revs || {}, jobs = [];
      Object.keys(revs).forEach(function (k) {
        var r = rec(box, k);
        if (r && r.rev === revs[k]) return;
        jobs.push(fetchDoc(box, k));
      });
      Object.keys(docs[box] || {}).forEach(function (k) {
        var r = rec(box, k);
        if (revs[k] === undefined && r.rev > 0) jobs.push(removedRemotely(box, k));
      });
      emit({ type: "status", box: box });
      return Promise.all(jobs);
    }

    // One document from the box, merged into the local copy.
    function fetchDoc(box, k) {
      var e = entry(box);
      return call("GET", box, "/d/" + k).then(function (res) {
        if (res.status === 404) return null;
        if (!res.ok) return httpFail(res);
        var rev = +(res.headers.get("X-Rev") || 0);
        return bytesOf(res).then(function (b) {
          return X.open(e.keys, box, k, b).then(function (remote) {
            remote = Core.clean(remote, k === ROSTER ? "roster" : undefined);
            var r = rec(box, k);
            var merged = Core.merge(r ? r.doc : null, remote);
            var changed = !r || !Core.same(merged, r.doc);
            return setRec(box, k, { rev: rev, doc: merged, dirty: !Core.same(merged, remote) }).then(function () {
              if (changed) emit({ type: k === ROSTER ? "roster" : "doc", box: box, id: k, remote: true });
              if (changed && r && k !== ROSTER) { try { onChanged(box, k, r.doc, merged); } catch (x) { log(x); } }
              return { rev: rev, doc: merged };
            });
          }, function () {
            // a document this device cannot open (a key it does not hold
            // yet): left alone, never overwritten
            log("household: cannot open " + k);
            return null;
          });
        });
      });
    }

    function removedRemotely(box, k) {
      var r = rec(box, k);
      if (!r) return Promise.resolve();
      if (k !== ROSTER) archive(box, k, r.doc, "unshared", false);
      return dropRec(box, k).then(function () { emit({ type: "doc", box: box, id: k, gone: true }); });
    }

    function pushDirty(box) {
      var list = Object.keys(docs[box] || {}).filter(function (k) { return docs[box][k].dirty; });
      // the roster first: a new document must be listed before it is filled
      list.sort(function (a, b) { return (a === ROSTER ? -1 : 0) - (b === ROSTER ? -1 : 0); });
      return list.reduce(function (p, k) { return p.then(function () { return pushDoc(box, k, 0); }); }, Promise.resolve());
    }
    function pushDoc(box, k, tries) {
      var e = entry(box), r = rec(box, k);
      if (!e || !r || !r.dirty) return Promise.resolve();
      var snap = r.doc;
      return X.seal(e.keys[e.epoch], e.epoch, box, k, snap).then(function (bytes) {
        if (bytes.length > LIMITS.docBytes) {
          (info[box] = info[box] || {}).err = "too-large";
          emit({ type: "status", box: box });
          return null;
        }
        return call("PUT", box, "/d/" + k, { rev: r.rev, bytes: bytes }).then(function (res) {
          if (res.status === 412) {
            if (tries >= 3) throw fail("busy");
            return fetchDoc(box, k).then(function () { return pushDoc(box, k, tries + 1); });
          }
          if (!res.ok) return httpFail(res);
          return jsonOf(res).then(function (j) {
            var cur = rec(box, k);
            if (!cur) return;
            return setRec(box, k, { rev: j.data.rev, doc: cur.doc, dirty: !Core.same(cur.doc, snap) });
          });
        });
      });
    }
    function schedulePush(box) {
      clearTimeout(pushTimer[box]);
      pushTimer[box] = later(function () { sync(box); }, 700);
    }

    // Local change to a document (stamped here, never by the app).
    function changeDoc(box, k, changes, kind) {
      var e = entry(box);
      if (!e) return null;
      var r = rec(box, k);
      // a document that is gone (unshared, the household left) is never
      // made again by a late edit from an app
      if (!r && k !== ROSTER) return null;
      var base = r ? r.doc : Core.empty(kind || (k === ROSTER ? "roster" : "list"));
      var next = Core.apply(base, changes, stamp(box), e.mid);
      if (r && Core.same(next, r.doc)) return Promise.resolve(false);
      var p = setRec(box, k, { rev: r ? r.rev : 0, doc: next, dirty: true });
      emit({ type: k === ROSTER ? "roster" : "doc", box: box, id: k, local: true });
      schedulePush(box);
      return p.then(function () { return true; });
    }

    // ---------- after a pass: roster duties ----------
    function afterRoster(box) {
      var e = entry(box);
      if (!e) return Promise.resolve();
      var r = rosterOf(box), mine = me(box), jobs = [];
      if (rec(box, ROSTER) && !mine && (r.members.length || rec(box, ROSTER).rev > 0)) {
        // I am not on the roster any more (removed, or left on another
        // device): the key rotation will lock me out; nothing to do here
        log("household: not on the roster of " + box);
      }
      if (e.name !== r.name && r.name) { e.name = r.name; e.m = Math.max(e.m, now()); saveMem(); }
      // made admin on another device or by an admin: take the token from my envelope
      if (mine && mine.admin && !e.adm) jobs.push(readEnvelope(box, e.mid, e));
      // shared documents removed from the roster
      var listed = {};
      r.docs.forEach(function (d) { listed[d.id] = 1; });
      Object.keys(docs[box] || {}).forEach(function (k) {
        if (k === ROSTER || listed[k]) return;
        var d = rec(box, k);
        if (d && d.rev > 0 && Core.view(d.doc).m.t !== undefined && !d.dirty) {
          archive(box, k, d.doc, "unshared", false);
          jobs.push(dropRec(box, k).then(function () { emit({ type: "doc", box: box, id: k, gone: true }); }));
        }
      });
      // an admin rotates the key when someone holding it left the roster
      if (e.adm) {
        var km = Core.view(rec(box, ROSTER) ? rec(box, ROSTER).doc : null).m.km;
        var ids = {};
        r.members.forEach(function (m) { ids[m.id] = 1; });
        if (Array.isArray(km) && km.some(function (id) { return !ids[id]; })) jobs.push(rotate(box));
      }
      return Promise.all(jobs);
    }

    // The box is gone (deleted, or my token is too old to know).
    function gone(box) {
      var i = info[box] = info[box] || {};
      i.status = "gone";
      emit({ type: "status", box: box });
    }

    // A new key epoch: read my envelope with the token I still hold.
    function newEpoch(box) {
      var e = entry(box);
      return readEnvelope(box, e.mid, e).then(function (got) {
        if (got) return true;
        var i = info[box] = info[box] || {};
        i.status = "removed";
        emit({ type: "status", box: box });
        notify("removed", box, { name: e.name });
        return false;
      });
    }
    function readEnvelope(box, mid, e) {
      return call("GET", box, "/e/" + mid).then(function (res) {
        if (res.status === 404) return false;
        if (!res.ok) return httpFail(res);
        return bytesOf(res).then(function (b) { return X.unwrap(e.priv, box, b); }).then(function (env) {
          var cur = entry(box);
          if (!cur || !env || env.box !== box || !env.keys) return false;
          Object.keys(env.keys).forEach(function (ep) { if (/^[1-9]\d{0,8}$/.test(ep)) cur.keys[ep] = cur.keys[ep] || env.keys[ep]; });
          if (typeof env.adm === "string") cur.adm = env.adm;
          cur.m = Math.max(cur.m, now());
          saveMem();
          return true;
        }, function () { return false; });
      });
    }

    // ---------- key rotation (admin) ----------
    function rotate(box) {
      var e = entry(box);
      if (!e || !e.adm) return Promise.reject(fail("notadmin"));
      var r = rosterOf(box);
      var km = Core.view(rec(box, ROSTER) ? rec(box, ROSTER).doc : null).m.km || [];
      var ids = {};
      r.members.forEach(function (m) { ids[m.id] = 1; });
      var removedAdmin = false;   // an admin who left: the admin token changes too
      var prevAdmins = Core.view(rec(box, ROSTER).doc).m.ad || [];
      prevAdmins.forEach(function (id) { if (!ids[id]) removedAdmin = true; });
      var K2 = X.newKey(), ep = e.epoch + 1, A2 = removedAdmin ? X.rand(32) : e.adm;
      var keys = JSON.parse(JSON.stringify(e.keys));
      keys[ep] = K2;
      var W2;
      return X.writeToken(K2).then(function (w) {
        W2 = w;
        return Promise.all(r.members.filter(function (m) { return m.pub; }).map(function (m) {
          var env = { box: box, epoch: ep, keys: keys };
          if (m.admin) env.adm = A2;
          return X.wrap(m.pub, box, env).then(function (b) { return [m.id, X.b64u(b)]; });
        }));
      }).then(function (envs) {
        var map = {};
        envs.forEach(function (x) { map[x[0]] = x[1]; });
        return Promise.all([X.sha256hex(W2), X.sha256hex(A2)]).then(function (h) {
          var body = { epoch: ep, wh: h[0], env: map };
          if (removedAdmin) body.ah = h[1];
          return call("POST", box, "/rot", { json: body, admin: e.adm });
        });
      }).then(function (res) {
        if (res.status === 412) return false;      // someone rotated first: the next pass reads the envelope
        if (!res.ok) return httpFail(res);
        var cur = entry(box);
        cur.keys[ep] = K2; cur.adm = A2; cur.m = Math.max(cur.m, now());
        saveMem();
        var admins = r.members.filter(function (m) { return m.admin; }).map(function (m) { return m.id; });
        return changeDoc(box, ROSTER, { m: { km: Object.keys(ids).sort(), ad: admins.sort() } }).then(function () {
          // everything local is written again with the new key
          Object.keys(docs[box] || {}).forEach(function (k) { docs[box][k].dirty = true; });
          // inside a pass: one more pass right after it (never wait on ourselves)
          if (busy[box]) again[box] = true; else sync(box);
          return true;
        });
      }).then(function (x) { return x; }, function (err) { log(err); return false; });
    }

    // ---------- households ----------
    function createHousehold(name, myName) {
      name = Core.line(name, 60); myName = Core.line(myName, 40);
      if (!name || !myName) return Promise.reject(fail("name"));
      if (Object.keys(mem.hh).length >= LIMITS.households) return Promise.reject(fail("toomany"));
      var box = X.rand(16), K = X.newKey(), A = X.rand(32), mid = X.rand(16), mk;
      return X.newMemberKey().then(function (k) {
        mk = k;
        return X.writeToken(K);
      }).then(function (W) {
        return Promise.all([X.sha256hex(W), X.sha256hex(A)]);
      }).then(function (h) {
        return call("POST", box, "", { json: { act: "new", wh: h[0], ah: h[1] }, noauth: true });
      }).then(function (res) {
        if (!res.ok) return httpFail(res);
        var t = now();
        mem.hh[box] = { name: name, mid: mid, pub: mk.pub, priv: mk.priv, keys: { 1: K }, epoch: 1, adm: A, at: t, m: t };
        delete mem.tomb[box];
        saveMem();
        var set = {};
        set["p:" + mid] = { n: myName, c: 0, pub: mk.pub, adm: true, j: t };
        return changeDoc(box, ROSTER, { m: { name: name, km: [mid], ad: [mid] }, set: set }, "roster");
      }).then(function () { return sync(box); }).then(function () { return box; });
    }

    function invite(box, o) {
      o = o || {};
      var e = entry(box);
      if (!e) return Promise.reject(fail("nohh"));
      var days = [1, 2, 7, 30].indexOf(o.days) >= 0 ? o.days : 2;
      var uses = o.uses === 1 ? 1 : 20;
      var I = X.rand(32), exp = now() + days * DAY, code, ih;
      return Promise.all([X.sha256hex(I), X.makeCode(box, I, o.password || "")]).then(function (r) {
        ih = r[0]; code = r[1];
        return call("POST", box, "/i", { json: { ih: ih, exp: exp, n: uses } });
      }).then(function (res) {
        if (!res.ok) return httpFail(res);
        var set = {};
        set["i:" + ih] = { s: I, code: code, pw: !!o.password, exp: exp, n: uses, by: e.mid };
        return changeDoc(box, ROSTER, { set: set });
      }).then(function () { return { ih: ih, code: code, link: SHARE_PAGE + "#" + code, exp: exp }; });
    }
    function withdraw(box, ih) {
      return call("DELETE", box, "/i/" + ih).then(function () {
        return changeDoc(box, ROSTER, { del: ["i:" + ih] });
      });
    }

    // ---------- joining (the invited person) ----------
    function join(input, myName, password) {
      myName = Core.line(myName, 40);
      if (!myName) return Promise.reject(fail("name"));
      var parsed = X.parseCode(input);
      if (!parsed) return Promise.reject(fail("code"));
      var p = parsed.locked ? (password ? X.unlock(parsed, password).catch(function () { throw fail("password"); }) : Promise.reject(fail("locked"))) : Promise.resolve(parsed);
      var box, I, mk, mid = X.rand(16);
      return p.then(function (c) {
        box = c.box; I = c.secret;
        if (entry(box)) throw fail("already");
        if (Object.keys(mem.hh).length >= LIMITS.households) throw fail("toomany");
        return X.newMemberKey();
      }).then(function (k) {
        mk = k;
        return X.inviteSeal(I, box, { v: 1, n: myName, pub: mk.pub, mid: mid, at: now() });
      }).then(function (bytes) {
        return call("POST", box, "/j", { invite: I, bytes: bytes });
      }).then(function (res) {
        if (res.status === 404) throw fail("expired");
        if (!res.ok) return httpFail(res);
        return jsonOf(res).then(function (j) {
          pend[box] = { box: box, secret: I, rid: j.data.rid, mid: mid, pub: mk.pub, priv: mk.priv, name: myName, at: now(), state: "wait" };
          savePend();
          return { box: box, state: "wait" };
        });
      });
    }
    function checkJoins() {
      return Promise.all(Object.keys(pend).map(function (box) {
        var p = pend[box];
        if (p.state !== "wait") return null;
        return call("GET", box, "/a/" + p.rid, { invite: p.secret }).then(function (res) {
          if (res.status === 202) return null;
          if (res.status === 410) { p.state = "refused"; savePend(); return null; }
          if (res.status === 404) { p.state = "gone"; savePend(); return null; }
          if (!res.ok) return null;
          return bytesOf(res).then(function (b) { return X.unwrap(p.priv, box, b); }).then(function (a) {
            if (!a || a.box !== box || !a.keys) return null;
            var keys = {}, ep = 0;
            Object.keys(a.keys).forEach(function (k) { if (/^[1-9]\d{0,8}$/.test(k)) { keys[k] = a.keys[k]; ep = Math.max(ep, +k); } });
            var t = now();
            mem.hh[box] = { name: Core.line(a.name, 60), mid: p.mid, pub: p.pub, priv: p.priv, keys: keys, epoch: ep, adm: "", at: t, m: t };
            delete mem.tomb[box];
            delete pend[box];
            savePend();
            saveMem();
            notify("joined", box, { name: Core.line(a.name, 60) });
            return sync(box);
          }, function (err) { log(err); return null; });
        }, function () { return null; });
      }));
    }
    function dismissJoin(box) { delete pend[box]; savePend(); }

    // ---------- requests (members) ----------
    function requests(box) {
      var i = info[box] || {}, r = rosterOf(box), e = entry(box);
      if (!e) return Promise.resolve([]);
      var cache = reqs[box] = reqs[box] || {};
      return Promise.all((i.reqs || []).map(function (rid) {
        if (cache[rid]) return cache[rid];
        return call("GET", box, "/r/" + rid).then(function (res) {
          if (!res.ok) return null;
          return bytesOf(res).then(function (b) {
            // the request is sealed with one of the open invites
            return r.invites.reduce(function (p, inv) {
              return p.then(function (got) {
                if (got || !/^[A-Za-z0-9_-]{43}$/.test(inv.secret)) return got;
                return X.inviteOpen(inv.secret, box, b).then(function (o) { return { o: o, ih: inv.ih }; }, function () { return null; });
              });
            }, Promise.resolve(null));
          }).then(function (got) {
            if (!got || !got.o || !Core.BOX_RE.test(got.o.mid || "") || typeof got.o.pub !== "string") return null;
            cache[rid] = { rid: rid, ih: got.ih, name: Core.line(got.o.n, 40) || "?", mid: got.o.mid, pub: got.o.pub, at: +got.o.at || 0 };
            return cache[rid];
          });
        }, function () { return null; });
      })).then(function (list) { return list.filter(Boolean); });
    }
    function accept(box, rid) {
      var e = entry(box), q = (reqs[box] || {})[rid];
      if (!e || !q) return Promise.reject(fail("norequest"));
      var r = rosterOf(box);
      if (r.members.length >= LIMITS.members) return Promise.reject(fail("full"));
      return X.wrap(q.pub, box, { box: box, name: r.name || e.name, keys: e.keys, epoch: e.epoch }).then(function (b) {
        return call("PUT", box, "/r/" + rid, { bytes: b });
      }).then(function (res) {
        if (!res.ok) return httpFail(res);
        delete reqs[box][rid];
        var used = {};
        r.members.forEach(function (m) { used[m.ci] = 1; });
        var c = 0;
        while (used[c] && c < Core.COLORS.length - 1) c++;
        var set = {};
        set["p:" + q.mid] = { n: q.name, c: c, pub: q.pub, adm: false, j: now() };
        var inv = r.invites.filter(function (x) { return x.ih === q.ih; })[0];
        var del = [];
        if (inv) { if (inv.n <= 1) del.push("i:" + inv.ih); else set["i:" + inv.ih] = { n: inv.n - 1 }; }
        var km = (Core.view(rec(box, ROSTER).doc).m.km || []).concat([q.mid]).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
        (info[box] || {}).reqs = ((info[box] || {}).reqs || []).filter(function (x) { return x !== rid; });
        return changeDoc(box, ROSTER, { set: set, del: del, m: { km: km } });
      }).then(function () { emit({ type: "requests", box: box }); return sync(box); });
    }
    function refuse(box, rid) {
      return call("DELETE", box, "/r/" + rid).then(function () {
        if (reqs[box]) delete reqs[box][rid];
        (info[box] || {}).reqs = ((info[box] || {}).reqs || []).filter(function (x) { return x !== rid; });
        emit({ type: "requests", box: box });
      });
    }

    // ---------- members ----------
    function setMe(box, o) {
      var e = entry(box), m = me(box);
      if (!e || !m) return Promise.reject(fail("nohh"));
      var ch = {};
      if (o && typeof o.name === "string" && Core.line(o.name, 40)) ch.n = Core.line(o.name, 40);
      if (o && Number.isInteger(o.color) && o.color >= 0 && o.color < Core.COLORS.length) ch.c = o.color;
      var set = {};
      set["p:" + e.mid] = ch;
      return changeDoc(box, ROSTER, { set: set });
    }
    function rename(box, name) {
      name = Core.line(name, 60);
      if (!name || !entry(box)) return Promise.reject(fail("name"));
      var e = entry(box);
      e.name = name; e.m = Math.max(e.m, now());
      saveMem();
      return changeDoc(box, ROSTER, { m: { name: name } });
    }
    function removeMember(box, mid) {
      var e = entry(box);
      if (!e || !e.adm) return Promise.reject(fail("notadmin"));
      if (mid === e.mid) return Promise.reject(fail("self"));
      return changeDoc(box, ROSTER, { del: ["p:" + mid] }).then(function () { return sync(box); });
      // afterRoster() sees the member in km but not on the roster and rotates
    }
    function makeAdmin(box, mid) {
      var e = entry(box);
      if (!e || !e.adm) return Promise.reject(fail("notadmin"));
      var m = rosterOf(box).members.filter(function (x) { return x.id === mid; })[0];
      if (!m || !m.pub) return Promise.reject(fail("nomember"));
      return X.wrap(m.pub, box, { box: box, epoch: e.epoch, keys: e.keys, adm: e.adm }).then(function (b) {
        return call("PUT", box, "/e/" + mid, { bytes: b, admin: e.adm });
      }).then(function (res) {
        if (!res.ok) return httpFail(res);
        var set = {};
        set["p:" + mid] = { adm: true };
        var ad = (Core.view(rec(box, ROSTER).doc).m.ad || []).concat([mid]).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
        return changeDoc(box, ROSTER, { set: set, m: { ad: ad } });
      });
    }
    function leave(box) {
      var e = entry(box);
      if (!e) return Promise.resolve();
      var r = rosterOf(box);
      var others = r.members.filter(function (m) { return m.id !== e.mid; });
      if (e.adm && others.length && !others.some(function (m) { return m.admin; })) return Promise.reject(fail("lastadmin"));
      var p = (info[box] || {}).status === "ok" || !info[box] ? changeDoc(box, ROSTER, { del: ["p:" + e.mid] }).then(function () { return sync(box); }) : Promise.resolve();
      return p.catch(function () {}).then(function () { forget(box, "left"); });
    }
    function forget(box, why) {
      Object.keys(docs[box] || {}).forEach(function (k) {
        if (k !== ROSTER) archive(box, k, docs[box][k].doc, why, true);
        dropRec(box, k);
      });
      delete docs[box]; delete info[box]; delete reqs[box];
      closeSocket(box);
      delete mem.hh[box];
      mem.tomb[box] = now();
      saveMem();
    }
    function removeHousehold(box) {
      var e = entry(box);
      if (!e || !e.adm) return Promise.reject(fail("notadmin"));
      return call("DELETE", box, "", { admin: e.adm }).then(function (res) {
        if (!res.ok && res.status !== 404) return httpFail(res);
        forget(box, "deleted");
      });
    }

    // ---------- the archive ----------
    function archive(box, k, doc, why, take) {
      var v = Core.view(doc);
      var a = { id: "x/" + box + "/" + k, box: box, k: k, kind: doc.kind, title: typeof v.m.t === "string" ? v.m.t : "",
                hh: (entry(box) || {}).name || "", doc: doc, at: now(), why: why, take: !!take };
      arch[box + "/" + k] = a;
      Promise.resolve(store.put(a)).catch(log);
      emit({ type: "archive" });
    }
    function archived(kind) {
      return Object.keys(arch).map(function (id) { return arch[id]; }).filter(function (a) { return !kind || a.kind === kind; })
        .map(function (a) { return { box: a.box, id: a.k, kind: a.kind, title: a.title, hh: a.hh, at: a.at, why: a.why, take: a.take, doc: a.doc }; });
    }
    function dropArchived(box, k) {
      delete arch[box + "/" + k];
      return Promise.resolve(store.del("x/" + box + "/" + k)).catch(log).then(function () { emit({ type: "archive" }); });
    }
    function restore(box, k) {
      var a = arch[box + "/" + k];
      if (!a || !entry(box)) return Promise.reject(fail("nohh"));
      var title = a.title;
      return shareDoc(box, a.kind, title, null, a.doc).then(function (id) { return dropArchived(box, k).then(function () { return id; }); });
    }

    // ---------- shared documents (apps) ----------
    function shareDoc(box, kind, title, changes, fromDoc) {
      var e = entry(box);
      if (!e) return Promise.reject(fail("nohh"));
      if (!/^[a-z]{1,16}$/.test(kind || "")) return Promise.reject(fail("kind"));
      title = Core.line(title, 80);
      var id = X.rand(12);
      var t = stamp(box);
      var doc = fromDoc ? Core.merge(Core.clean(fromDoc, kind), null) : Core.empty(kind);
      doc.kind = kind;
      doc = Core.apply(doc, changes || {}, t, e.mid);
      doc = Core.apply(doc, { m: { t: title } }, t, e.mid);
      var set = {};
      set["c:" + id] = { kind: kind, t: title };
      return setRec(box, id, { rev: 0, doc: doc, dirty: true }).then(function () {
        return changeDoc(box, ROSTER, { set: set });
      }).then(function () {
        emit({ type: "doc", box: box, id: id, local: true });
        return id;
      });
    }
    function retitle(box, id, title) {
      title = Core.line(title, 80);
      if (!title || !rec(box, id)) return Promise.resolve(false);
      var set = {};
      set["c:" + id] = { t: title };
      return Promise.all([changeDoc(box, id, { m: { t: title } }), changeDoc(box, ROSTER, { set: set })]);
    }
    function unshare(box, id) {
      var r = rec(box, id);
      if (!r) return Promise.resolve();
      archive(box, id, r.doc, "mine", true);
      var rev = r.rev;
      return dropRec(box, id).then(function () {
        return changeDoc(box, ROSTER, { del: ["c:" + id] });
      }).then(function () {
        emit({ type: "doc", box: box, id: id, gone: true });
        if (rev > 0) return call("DELETE", box, "/d/" + id, { rev: rev }).catch(function () {});
      });
    }
    function docsOf(kind) {
      var out = [];
      Object.keys(mem.hh).forEach(function (box) {
        rosterOf(box).docs.forEach(function (d) {
          if (kind && d.kind !== kind) return;
          var r = rec(box, d.id);
          out.push({ box: box, id: d.id, kind: d.kind, title: d.title, hh: mem.hh[box].name, ready: !!r });
        });
      });
      return out;
    }

    // ---------- live notices ----------
    function openSocket(box, tries) {
      if (!WS || sockets[box] || !entry(box)) return;
      var s = { ws: null, tries: tries || 0, timer: null, ping: null };
      sockets[box] = s;
      token(box).then(function (w) {
        if (sockets[box] !== s) return;
        var ws;
        try { ws = new WS(relay.replace(/^http/, "ws") + "/h/" + box + "/ws", ["hh1", "w." + w]); }
        catch (e) { return; }
        s.ws = ws;
        ws.onopen = function () { s.tries = 0; s.ping = setInterval(function () { try { ws.send("ping"); } catch (e) {} }, 50000); };
        ws.onmessage = function (m) {
          var d;
          try { d = JSON.parse(m.data); } catch (e) { return; }
          if (!d || typeof d !== "object") return;
          if (typeof d.k === "string") { var r = rec(box, d.k); if (!r || r.rev !== d.r) sync(box); return; }
          if (d.q || d.e || d.x) sync(box);
        };
        ws.onclose = function () {
          clearInterval(s.ping);
          if (sockets[box] !== s) return;
          s.ws = null;
          // back off: 5 s, 10 s, 20 s … at most 5 minutes; a closed box
          // (deleted, new key epoch) is noticed by the pass that follows
          var wait = Math.min(300000, 5000 * Math.pow(2, s.tries));
          s.timer = setTimeout(function () {
            if (sockets[box] !== s) return;
            delete sockets[box];
            openSocket(box, s.tries + 1);
            sync(box);
          }, wait);
        };
      }, function () { if (sockets[box] === s) delete sockets[box]; });
    }
    function closeSocket(box) {
      var s = sockets[box];
      if (!s) return;
      delete sockets[box];
      clearTimeout(s.timer); clearInterval(s.ping);
      try { if (s.ws) s.ws.close(1000, "bye"); } catch (e) {}
    }
    function liveOn() { Object.keys(mem.hh).forEach(openSocket); }
    function liveOff() { Object.keys(sockets).forEach(closeSocket); }

    // ---------- membership from the person's other devices ----------
    function sliceGet() { return Object.keys(mem.hh).length || Object.keys(mem.tomb).length ? mem : null; }
    function sliceSet(data) {
      var next = Core.mergeMembership(mem, data);
      if (Core.same(next, mem)) return;
      var before = Object.keys(mem.hh);
      mem = next;
      memIO.save(mem);
      before.forEach(function (b) {
        if (!mem.hh[b]) {
          Object.keys(docs[b] || {}).forEach(function (k) { if (k !== ROSTER) archive(b, k, docs[b][k].doc, "left", true); dropRec(b, k); });
          delete docs[b]; delete info[b]; closeSocket(b);
        }
      });
      Object.keys(mem.hh).forEach(function (b) { if (before.indexOf(b) < 0) { sync(b); openSocket(b); } });
      emit({ type: "list" });
    }

    // ---------- what the Household app shows ----------
    function list() {
      return Object.keys(mem.hh).map(function (box) {
        var e = mem.hh[box], r = rosterOf(box), i = info[box] || {};
        return { box: box, name: r.name || e.name, me: e.mid, admin: !!e.adm, epoch: e.epoch,
                 members: r.members, docs: r.docs, invites: r.invites.map(function (x) {
                   return { ih: x.ih, link: x.code ? SHARE_PAGE + "#" + x.code : "", pw: x.pw, exp: x.exp, n: x.n, by: x.by };
                 }),
                 reqs: (i.reqs || []).length, status: i.status || "", err: i.err || "", at: i.at || 0, size: i.size || 0 };
      }).sort(function (a, b) { return (mem.hh[a.box].at - mem.hh[b.box].at) || (a.box < b.box ? -1 : 1); });
    }
    function pending() {
      return Object.keys(pend).map(function (b) { var p = pend[b]; return { box: b, name: p.name, at: p.at, state: p.state }; });
    }
    function member(box, mid) {
      var m = rosterOf(box).members.filter(function (x) { return x.id === mid; })[0];
      return m ? { id: m.id, name: m.name, color: m.color, initials: Core.initials(m.name) } : null;
    }

    return {
      LIMITS: LIMITS, SHARE_PAGE: SHARE_PAGE,
      ready: ready, sync: sync, syncAll: syncAll, list: list, pending: pending, member: member,
      me: function (box) { var e = entry(box); return e ? e.mid : ""; },
      create: createHousehold, invite: invite, withdraw: withdraw, join: join, checkJoins: checkJoins, dismissJoin: dismissJoin,
      requests: requests, accept: accept, refuse: refuse,
      setMe: setMe, rename: rename, removeMember: removeMember, makeAdmin: makeAdmin, leave: leave, remove: removeHousehold,
      rotate: rotate, forget: function (box) { forget(box, "left"); },
      docs: docsOf,
      get: function (box, id) { var r = rec(box, id); return r ? JSON.parse(JSON.stringify(r.doc)) : null; },
      view: function (box, id, quiet) { var r = rec(box, id); return r ? Core.view(r.doc, quiet) : null; },
      share: shareDoc, change: function (box, id, changes) { return changeDoc(box, id, changes) || Promise.resolve(false); },
      retitle: retitle, unshare: unshare,
      archived: archived, dropArchived: dropArchived, restore: restore,
      liveOn: liveOn, liveOff: liveOff,
      sliceGet: sliceGet, sliceSet: sliceSet, merge: Core.mergeMembership,
      on: function (fn) {
        if (typeof fn !== "function") return function () {};
        listeners.push(fn);
        return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
      },
      _state: function () { return { mem: mem, docs: docs, info: info, pend: pend, arch: arch }; }
    };
  }

  // ---------- the browser side ----------
  function idbStore() {
    var dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve, reject) {
        var rq = indexedDB.open("oros-household", 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore("docs", { keyPath: "id" }); };
        rq.onsuccess = function () { resolve(rq.result); };
        rq.onerror = function () { reject(rq.error); };
      });
      return dbp;
    }
    function tx(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (resolve, reject) {
          var t = d.transaction("docs", mode), st = t.objectStore("docs"), out;
          var r = fn(st);
          if (r) r.onsuccess = function () { out = r.result; };
          t.oncomplete = function () { resolve(out); };
          t.onerror = function () { reject(t.error); };
        });
      });
    }
    return {
      all: function () { return tx("readonly", function (s) { return s.getAll(); }); },
      put: function (rec) { return tx("readwrite", function (s) { return s.put(rec); }); },
      del: function (id) { return tx("readwrite", function (s) { return s.delete(id); }); }
    };
  }
  function lsIO(key) {
    return {
      load: function () { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } },
      save: function (v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
    };
  }

  var STR = {
    en: { "n.req": "{name}: someone asks to join", "n.joined": "You are now in {name}", "n.removed": "You are no longer in {name}", "n.title": "Household" },
    el: { "n.req": "{name}: κάποιος ζητά να μπει", "n.joined": "Είσαι πλέον στο νοικοκυριό {name}", "n.removed": "Δεν είσαι πια στο νοικοκυριό {name}", "n.title": "Νοικοκυριό" }
  };
  // What the others changed (household/recent.js): device-local, rung
  // on the bell once a burst is over (one line per household), shown by
  // the Today row "Today at home".
  var recent = {
    eng: null,
    io: function () { return lsIO(root.OrosHouseRecent ? root.OrosHouseRecent.RECENT_KEY : "oros-household-recent"); },
    note: function (box, id, before, after) {
      var R = root.OrosHouseRecent, eng = recent.eng;
      if (!R || !eng) return;
      var sum = R.summarize(before, after, eng.me(box));
      if (!sum) return;
      var hh = eng.list().filter(function (x) { return x.box === box; })[0];
      var tc = after && after.m && after.m.t, title = tc && typeof tc[0] === "string" ? tc[0] : "";
      var st = R.load(recent.io().load());
      R.add(st, box, hh ? hh.name : "", id, title, sum, function (mid) { var m = eng.member(box, mid); return m ? m.name : ""; }, Date.now());
      recent.io().save(st);
    },
    ring: function () {
      var R = root.OrosHouseRecent, N = root.orosNotifs;
      if (!R || !N || typeof N.emit !== "function") return;
      var io = recent.io(), raw = io.load();
      if (!raw) return;
      var st = R.load(raw), list = R.due(st, Date.now());
      if (!list.length) return;
      io.save(R.prune(st, Date.now()));
      list.forEach(function (x) {
        try { N.emit({ ns: "household", key: "chg:" + x.box + ":" + x.from, type: "info",
                       title: x.hh || STR[(root.orosI18n && root.orosI18n.lang && String(root.orosI18n.lang()).slice(0, 2) === "el") ? "el" : "en"]["n.title"],
                       body: x.body, deepLink: "household:" + x.box }); } catch (e) {}
      });
    }
  };
  function boot() {
    if (!root || !root.document || !Core || !X || !root.indexedDB || !root.crypto || !root.crypto.subtle) return;
    var lang = function () {
      var l = root.orosI18n && root.orosI18n.lang ? root.orosI18n.lang() : (localStorage.getItem("oros-lang") || "en");
      return String(l).slice(0, 2) === "el" ? "el" : "en";
    };
    var memIO = lsIO(MEM_KEY);
    var eng = create({
      fetch: function (u, o) { return root.fetch(u, o); },
      store: idbStore(),
      membership: { load: memIO.load, save: function (v) { memIO.save(v); if (root.orosSync && root.orosSync.markDirty) root.orosSync.markDirty(); } },
      pending: lsIO(PEND_KEY),
      WebSocket: root.WebSocket,
      lang: lang,
      log: function (e) { try { console.warn("orOS household:", e && e.message || e); } catch (x) {} },
      changed: function (box, id, before, after) { recent.note(box, id, before, after); },
      notify: function (what, box, d) {
        var N = root.orosNotifs, s = STR[lang()];
        if (!N || typeof N.emit !== "function") return;
        var body = s["n." + what].replace("{name}", (d && d.name) || "");
        try { N.emit({ ns: "household", key: what + ":" + box + ":" + ((d && d.rid) || Math.floor(Date.now() / 3600000)), type: "info",
                       title: s["n.title"], body: body, deepLink: "household:" + box }); } catch (e) {}
      }
    });
    root.orosHousehold = eng;
    recent.eng = eng;
    setInterval(recent.ring, 60000);
    var registered = false;
    function register() {
      var s = root.orosSync;
      if (!s || typeof s.registerSlice !== "function") { setTimeout(register, 200); return; }
      if (registered) return;
      registered = true;
      s.registerSlice("household", eng.sliceGet, eng.sliceSet, MEM_KEY, eng.merge);
    }
    register();
    eng.ready().then(function () {
      eng.syncAll();
      if (!root.document.hidden) eng.liveOn();
    });
    var hiddenAt = 0, offTimer = null;
    root.document.addEventListener("visibilitychange", function () {
      if (root.document.hidden) {
        hiddenAt = Date.now();
        offTimer = setTimeout(function () { eng.liveOff(); }, 60000);
      } else {
        clearTimeout(offTimer);
        eng.liveOn();
        if (Date.now() - hiddenAt > 20000) eng.syncAll();
      }
    });
    root.addEventListener("online", function () { eng.syncAll(); });
    setInterval(function () { if (!root.document.hidden) eng.syncAll(); }, LIMITS.pollMs);
  }

  var api = { create: create, RELAY: RELAY, MEM_KEY: MEM_KEY, PEND_KEY: PEND_KEY, LIMITS: LIMITS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) { root.OrosHouseEngine = api; boot(); }
})(typeof window !== "undefined" ? window : null);
