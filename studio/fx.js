// ============================================================
// orOS Studio — effects (v1.0.0)
// NULL JSFX effects (https://nulljsfx.tech, MIT) on the tracks and the
// master: the chains, their audio and the Effects dialog.
//   - nullfx/: the web version of NULL JSFX, copied from the null-jsfx
//     repository (web/runtime + web/fx). Each effect is a static file
//     translated ahead of time from its JSFX; nothing is evaluated.
//     .github/workflows/sync-nullfx.yml opens a PR when null-jsfx
//     changes (weekly or on demand); never edit these files by hand.
//   - Audio: one AudioWorklet node per chain, Studio's own processor
//     "studio-fx-chain" (fxchain.worklet.js: the same messages as NULL
//     JSFX's null-fx-chain, plus key inputs for sidechain effects and
//     AudioParams that carry automation); live chains stay alive between
//     plays so a reorder or a slider move does not reset them. Export
//     builds its own in the offline context.
//   - Sidechain: an effect with key pins (Sidechain Ducker) can listen to
//     another track (item.sc); studio.js connects that track's sound.
//   - Latency: effects that look ahead (limiters, convolution) delay
//     their track; the other tracks are delayed by the difference, and
//     the playhead, takes and export allow for the total.
//   - Interface: effects with a GFX interface draw it on a canvas (a
//     copy of the effect runs @init/@slider on the page, the worklet
//     sends the meters); every slider is also a plain control.
//   - Instruments (NULL Drum Machine, index.json "instruments"): an
//     instrument track can be played by one instead of a built-in
//     sound. It is the first item of the track's chain (it makes the
//     sound the effects after it change) and gets the track's notes as
//     MIDI on the audio clock; its own state (the drawn pattern, the
//     plugin's @serialize) is kept in the item as .st. Keys and
//     auditions play it through a preview chain on the keyboard's bus.
// Loaded before studio.js; window.StudioFX(host) returns the API.
// ============================================================
(function () {
  "use strict";

  var BASE = "nullfx/";
  var PEEK_MS = 33;

  window.StudioFX = function (host) {
    var C = host.C, t = host.t, el = host.el, setLabel = host.setLabel;
    var catalog = null, catalogP = null;      // index.json: { effects: [...] }
    var instCat = [];                         // index.json: { instruments: [...] }
    var pv = null;                            // preview chain { key, ctx, chain, items, out }
    var pageP = {};                           // id -> Promise (script on the page)
    var latCache = {};                        // key -> samples
    var fileBufs = {};                        // path -> AudioBuffer | Promise
    var live = {};                            // chain key -> { chain, ctx, uids }
    var openKey = "", expanded = {}, picking = false, query = "";
    var views = {};                           // slot u -> { view, canvas, busy, last }
    var raf = 0;

    // ---------- Catalog and files ----------
    function loadCatalog() {
      if (catalog) return Promise.resolve(catalog);
      if (!catalogP) {
        catalogP = fetch(BASE + "fx/index.json?v=" + host.version).then(function (r) {
          if (!r.ok) throw new Error("index");
          return r.json();
        }).then(function (j) {
          // stereo effects, and those with a stereo key input (Sidechain Ducker)
          catalog = (j.effects || []).filter(function (e) { return C.FX_ID_RE.test(e.id) && (e.ins <= 2 || e.ins === 4) && e.outs === 2; });
          instCat = (j.instruments || []).filter(function (e) { return C.FX_ID_RE.test(e.id) && e.ins === 0 && e.outs === 2; });
          return catalog;
        }, function (e) { catalogP = null; throw e; });
      }
      return catalogP;
    }
    function info(id) {
      if (!catalog) return null;
      for (var i = 0; i < catalog.length; i++) if (catalog[i].id === id) return catalog[i];
      for (var k = 0; k < instCat.length; k++) if (instCat[k].id === id) return instCat[k];
      return null;
    }
    function isInstrument(id) { return instCat.some(function (e) { return e.id === id; }); }
    // the chain's instrument (its first item), else null
    function instrumentOf(items) { var x = (items || [])[0]; return x && isInstrument(x.id) ? x : null; }
    // the chain with instrument `id` first (null: without one); null when it has no room
    function withInstrument(items, id) {
      var rest = (items || []).filter(function (x) { return !isInstrument(x.id); });
      if (!id) return rest;
      if (rest.length >= C.MAX_FX) return null;
      var old = instrumentOf(items);
      return [old && old.id === id ? old : { u: C.newId("f", Math.random), id: id, on: true, s: {} }].concat(rest);
    }
    function fxMeta(id) { return window.NULLFX && window.NULLFX[id] || null; }
    // the effect's script on the page (for its interface and latency)
    function needPage(id) {
      if (!C.FX_ID_RE.test(id)) return Promise.reject(new Error("id"));
      if (fxMeta(id)) return Promise.resolve(fxMeta(id));
      if (!pageP[id]) {
        pageP[id] = new Promise(function (res, rej) {
          var s = document.createElement("script");
          s.src = BASE + "fx/" + id + ".js?v=" + host.version;
          s.onload = function () { if (fxMeta(id)) res(fxMeta(id)); else rej(new Error("fx")); };
          s.onerror = function () { delete pageP[id]; rej(new Error("fx")); };
          document.head.appendChild(s);
        });
      }
      return pageP[id];
    }
    // Effect files are not precached (sw.js keeps each one the first time
    // it loads, across releases): while online, fetch the effects the
    // projects use, one at a time, so they work offline later, also
    // projects synced from another device. Once per id per session.
    var kept = {}, keepQ = [], keeping = false;
    function keepOffline(ids) {
      var sw = navigator.serviceWorker;
      if (!sw || !sw.controller || navigator.onLine === false) return;
      (ids || []).forEach(function (id) {
        if (!kept[id] && info(id)) { kept[id] = true; keepQ.push(id); }
      });
      if (keeping) return;
      keeping = true;
      (function next() {
        var id = keepQ.shift();
        if (!id) { keeping = false; return; }
        fetch(BASE + "fx/" + id + ".js", { priority: "low" }).then(function (r) { return r.ok ? r.blob() : null; })
          .catch(function () { delete kept[id]; }).then(next);
      })();
    }
    function known(item) { return !!info(item.id); }
    // an effect with a key input (its extra pins)
    function hasKey(id) { var e = info(id); return !!(e && e.ins > 2); }
    function active(items) { return (items || []).filter(function (x) { return x.on && known(x); }); }

    // An audio file of a file slider (Convolution's IR), decoded once.
    function fileBuf(path) {
      var b = fileBufs[path];
      if (b && !b.then) return Promise.resolve(b);
      if (b) return b;
      var fs = host.fsApi();
      if (!fs) return Promise.resolve(null);
      fileBufs[path] = Promise.resolve(fs.readBlob(path)).then(function (blob) {
        if (!blob) return null;
        return blob.arrayBuffer().then(host.decode);
      }).then(function (buf) {
        if (buf) fileBufs[path] = buf; else delete fileBufs[path];
        return buf;
      }, function () { delete fileBufs[path]; return null; });
      return fileBufs[path];
    }

    // ---------- Loading into an audio context ----------
    // Everything a set of chains needs: page scripts (latency), worklet
    // modules and files. Resolves when all are there.
    function prepare(ctx, chains) {
      var ids = {}, paths = {};
      chains.forEach(function (items) {
        active(items).forEach(function (x) {
          ids[x.id] = true;
          Object.keys(x.f || {}).forEach(function (k) { paths[x.f[k]] = true; });
        });
      });
      var list = Object.keys(ids);
      if (!list.length) return Promise.resolve();
      var NN = window.NULLFXNode;
      if (!NN || !ctx.audioWorklet) return Promise.reject(new Error("noworklet"));
      return Promise.all([NN.load(ctx, BASE, list).then(function () { return ownProc(ctx); })]
        .concat(list.map(needPage))
        .concat(Object.keys(paths).map(fileBuf)));
    }
    // Studio's chain processor, once per context (after the runtime)
    var procs = typeof WeakMap !== "undefined" ? new WeakMap() : null;
    function ownProc(ctx) {
      var p = procs && procs.get(ctx);
      if (!p) {
        p = ctx.audioWorklet.addModule("fxchain.worklet.js?v=" + host.version);
        if (procs) procs.set(ctx, p);
      }
      return p;
    }
    var readyIds = typeof WeakMap !== "undefined" ? new WeakMap() : null;
    function needs(chains) { return chains.some(function (items) { return (items || []).some(function (x) { return x.on; }); }); }
    function isReady(ctx, chains) {
      if (!catalog) return !needs(chains);
      var have = readyIds && readyIds.get(ctx);
      return chains.every(function (items) {
        return active(items).every(function (x) { return have && have[x.id] && fxMeta(x.id); });
      });
    }
    function markReady(ctx, chains) {
      if (!readyIds) return;
      var have = readyIds.get(ctx) || {};
      chains.forEach(function (items) { active(items).forEach(function (x) { have[x.id] = true; }); });
      readyIds.set(ctx, have);
    }
    function ensure(ctx, chains) {
      if (isReady(ctx, chains)) return Promise.resolve(true);
      return loadCatalog().then(function () { return prepare(ctx, chains); }).then(function () { markReady(ctx, chains); return true; });
    }
    // only what the page needs (latency before an export is set up)
    function preparePage(chains) {
      return loadCatalog().then(function () {
        var ids = {};
        chains.forEach(function (items) { active(items).forEach(function (x) { ids[x.id] = true; }); });
        return Promise.all(Object.keys(ids).map(needPage));
      });
    }

    // ---------- Latency ----------
    function latencyOf(item, sr) {
      var FX = fxMeta(item.id);
      if (!FX || !item.on) return 0;
      var key = item.id + "|" + sr + "|" + JSON.stringify(item.s || {});
      if (latCache[key] != null) return latCache[key];
      var d = 0;
      try {
        var e = new window.NULLFXHost.Effect(FX, window.NULLRT, { srate: sr, sliders: sliders(FX, item, false) });
        e.inst.slider();
        d = Math.max(0, Math.round(e.pdc()));
      } catch (err) { d = 0; }
      latCache[key] = d;
      return d;
    }
    function chainLatency(items, sr) {
      return active(items).reduce(function (n, x) { return n + latencyOf(x, sr); }, 0);
    }

    // slider values for an instance; file sliders start at 0 (no file)
    // so that handing the file over later changes the value and reloads
    function sliders(FX, item, withFiles) {
      var out = {};
      FX.sliders.forEach(function (sl) {
        if (sl.path) out[sl.i] = withFiles && item.f && item.f[sl.i] ? C.fxValue(item, sl) : 0;
        else out[sl.i] = C.fxValue(item, sl);
      });
      return out;
    }
    // key: the input (1..8) a sidechain effect listens on, 0 for none
    function chainList(items) {
      var n = 0;
      return active(items).map(function (x) {
        var it = { uid: x.u, id: x.id, sliders: sliders(fxMeta(x.id) || { sliders: [] }, x, false), bypass: false,
                   key: x.sc && hasKey(x.id) ? ++n : 0 };
        if (x.st) it.state = x.st;
        return it;
      });
    }
    // The key inputs of a chain: [{ sc: track id, input }]
    function keyInputs(items) {
      return chainList(items).filter(function (x) { return x.key; }).map(function (x) {
        return { sc: active(items).filter(function (y) { return y.u === x.uid; })[0].sc, input: x.key };
      });
    }
    // Automation lanes of this chain's sliders, each on its own AudioParam:
    // [{ k (param a<k>), lane, map: { k, uid, i, inc, min, max } }]
    function autoParams(items, lanes) {
      var out = [], on = {};
      active(items).forEach(function (x) { on[x.u] = x; });
      (lanes || []).forEach(function (l) {
        var f = C.laneFx(l.k);
        if (!f || l.on === false || !l.p.length || !on[f.u] || out.length >= 16) return;
        var FX = fxMeta(on[f.u].id), sl = FX ? FX.sliders.filter(function (q) { return q.i === f.i && !q.path; })[0] : null;
        if (!sl) return;
        out.push({ k: out.length, lane: l, sl: sl, map: { k: out.length, uid: f.u, i: f.i, inc: sl.inc || 0, min: sl.min, max: sl.max } });
      });
      return out;
    }
    // A chain node on Studio's processor; the same object NULLFXNode.Chain makes.
    // extra (an export): { midi: [[at, status, d1, d2]], times: [{ at, playing, position, ... }] }
    function makeChain(ctx, list, auto, extra) {
      var NN = window.NULLFXNode, ch = Object.create(NN.Chain.prototype);
      ch.ctx = ctx;
      ch.node = new AudioWorkletNode(ctx, "studio-fx-chain", {
        numberOfInputs: 1 + KEY_INPUTS, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers",
        processorOptions: { chain: list, auto: auto, midi: extra && extra.midi || null, times: extra && extra.times || null }
      });
      ch.pdc = 0; ch.waiting = {}; ch.req = 0;
      ch.onpdc = null; ch.onerror = null; ch.onmissing = null;
      ch.node.port.onmessage = function (e) {
        var m = e.data || {};
        if (m.type === "pdc") { ch.pdc = m.samples; if (ch.onpdc) ch.onpdc(m.samples); }
        else if (m.type === "live") { var w = ch.waiting[m.req]; if (w) { delete ch.waiting[m.req]; w(m); } }
        else if (m.type === "error") { if (ch.onerror) ch.onerror(m); }
        else if (m.type === "missing") { if (ch.onmissing) ch.onmissing(m); }
      };
      return ch;
    }
    var KEY_INPUTS = 8;
    function sendFiles(chain, items) {
      active(items).forEach(function (x) {
        var FX = fxMeta(x.id);
        if (!FX) return;
        FX.sliders.forEach(function (sl) {
          var path = sl.path && x.f && x.f[sl.i];
          if (!path) return;
          var b = fileBufs[path];
          if (b && !b.then) chain.setFile(x.u, sl.i, C.fxValue(x, sl) || 1, b);
        });
      });
    }
    function sendStates(chain, items) {
      active(items).forEach(function (x) { if (x.st) chain.setState(x.u, x.st); });
    }
    function sendSliders(chain, items) {
      active(items).forEach(function (x) {
        var FX = fxMeta(x.id);
        if (!FX) return;
        FX.sliders.forEach(function (sl) { if (!sl.path) chain.setSlider(x.u, sl.i, C.fxValue(x, sl)); });
      });
    }

    // ---------- Graph ----------
    // Puts the chain of `key` in front of `target`; returns the node to
    // feed, or null when the chain has nothing to do (or is not loaded).
    // lanes: the track's automation (the chain's sliders follow theirs)
    // extra: the MIDI and transport of an export (makeChain)
    function insert(ctx, key, items, target, offline, lanes, extra) {
      if (!active(items).length || !isReady(ctx, [items])) return null;
      var rec = offline ? null : live[key], ap = autoParams(items, lanes), map = ap.map(function (x) { return x.map; });
      if (rec && rec.ctx !== ctx) { rec.chain.disconnect(); rec = null; }
      if (!rec) {
        var ch;
        try { ch = makeChain(ctx, chainList(items), map, offline ? extra : null); } catch (e) { return null; }
        ch.onerror = function (m) { host.showToast(t("fx.failed", { name: nameOf(m.id) })); };
        rec = { chain: ch, ctx: ctx, files: "" };
        if (!offline) live[key] = rec;
      } else {
        rec.chain.setChain(chainList(items));
      }
      sendSliders(rec.chain, items);
      if (!offline) sendStates(rec.chain, items);
      rec.chain.send({ type: "auto", map: map });
      var fk = JSON.stringify(active(items).map(function (x) { return [x.u, x.f || null, x.s]; }));
      if (rec.files !== fk) { rec.files = fk; sendFiles(rec.chain, items); }
      try { rec.chain.node.disconnect(); } catch (e) { /* first use */ }
      rec.chain.node.connect(target);
      return rec.chain.node;
    }
    // transport: @init runs again at each start, as in REAPER
    function setTime(tm) {
      Object.keys(live).forEach(function (k) { live[k].chain.setTime(tm); });
    }
    // the transport of one chain at a time on the audio clock (a play start, a loop jump)
    function setTimeAt(key, at, tm) { var rec = live[key]; if (rec) rec.chain.setTimeAt(at, tm); }
    // MIDI for the instrument of a chain: [[at, status, d1, d2], ...]
    function midi(key, ev) { var rec = live[key]; if (rec && ev.length) rec.chain.midi(ev); }

    // ---------- Preview: the keys and auditions on an instrument ----------
    // One chain with only the instrument of track `key`, on `out` (the
    // keyboard's bus), heard whether or not the song plays. Resolves
    // with true when it can play.
    function preview(ctx, key, out) {
      var items = chainOf(key), x = instrumentOf(items);
      if (!x || !x.on) return Promise.resolve(false);
      var one = [x];
      if (pv && pv.key === key && pv.ctx === ctx && pv.id === x.id) {
        if (pv.out !== out) { try { pv.chain.node.disconnect(); } catch (e) {} pv.chain.node.connect(out); pv.out = out; }
        return Promise.resolve(true);
      }
      dropPreview();
      return ensure(ctx, [one]).then(function () {
        if (pv && pv.key === key && pv.id === x.id) return true;
        var ch;
        try { ch = makeChain(ctx, chainList(one), []); } catch (e) { return false; }
        sendSliders(ch, one);
        ch.node.connect(out);
        pv = { key: key, ctx: ctx, chain: ch, id: x.id, u: x.u, out: out };
        return true;
      }, function () { return false; });
    }
    function previewMidi(key, ev) { if (pv && pv.key === key) pv.chain.midi(ev); }
    function dropPreview() { if (pv) { pv.chain.disconnect(); pv = null; } }
    function disconnect() {
      Object.keys(live).forEach(function (k) { try { live[k].chain.node.disconnect(); } catch (e) { /* not connected */ } });
    }
    // drop the chains of tracks that are gone (or of another project)
    function prune(keys) {
      Object.keys(live).forEach(function (k) {
        if (keys.indexOf(k) < 0) { live[k].chain.disconnect(); delete live[k]; }
      });
    }
    // a slider moved while playing
    function liveSlider(key, u, i, v) {
      var rec = live[key];
      if (rec) rec.chain.setSlider(u, i, v);
      if (pv && pv.key === key && pv.u === u) pv.chain.setSlider(u, i, v);
    }
    // an instrument's own state changed (its interface, undo, another device)
    function liveState(key, u, st) {
      var rec = live[key];
      if (rec) rec.chain.setState(u, st);
      if (pv && pv.key === key && pv.u === u) pv.chain.setState(u, st);
    }

    // ---------- Edits ----------
    function chainOf(key) {
      if (key === "master") { var p = host.proj(); return p ? p.fx : []; }
      var tr = C.find(host.data(), "tracks", key);
      return tr ? tr.fx : [];
    }
    function nameOf(id) { var e = info(id); return e ? e.name : id; }
    function keyName(key) {
      if (key === "master") return t("f.master");
      var tr = C.find(host.data(), "tracks", key);
      return tr ? tr.name : "";
    }
    function setChain(key, items, opts) { host.setFx(key, C.normFx(items), opts); }
    function update(key, u, fn, opts) {
      setChain(key, chainOf(key).map(function (x) {
        if (x.u !== u) return x;
        var n = { u: x.u, id: x.id, on: x.on, s: Object.assign({}, x.s) };
        if (x.f) n.f = Object.assign({}, x.f);
        if (x.sc) n.sc = x.sc;
        if (x.st) n.st = x.st.slice();
        fn(n);
        return n;
      }), opts);
    }
    // key: a track id or "master"; also used by the remote (remote.js)
    function addTo(key, id) {
      var items = chainOf(key);
      if (items.length >= C.MAX_FX) { host.showToast(t("fx.max", { n: C.MAX_FX })); return ""; }
      var u = C.newId("f", Math.random);
      setChain(key, items.concat([{ u: u, id: id, on: true, s: {} }]));
      return u;
    }
    function removeFrom(key, u) {
      if (!chainOf(key).some(function (x) { return x.u === u; })) return;
      setChain(key, chainOf(key).filter(function (x) { return x.u !== u; }));
      dropView(u);
      host.undoToast(t("fx.removed"));
      render();
    }
    function moveIn(key, u, d) {
      var items = chainOf(key).slice(), i = -1;
      items.forEach(function (x, k) { if (x.u === u) i = k; });
      var j = i + d;
      if (i < 0 || j < 0 || j >= items.length) return false;
      if (isInstrument(items[i].id) || isInstrument(items[j].id)) return false;   // the instrument stays first
      var tmp = items[i]; items[i] = items[j]; items[j] = tmp;
      setChain(key, items);
      render();
      return true;
    }
    function addFx(id) {
      picking = false; query = "";
      var u = addTo(openKey, id);
      if (u) { expanded = {}; expanded[u] = true; }
      render();
    }
    function removeFx(u) { removeFrom(openKey, u); }
    function moveFx(u, d) {
      if (!moveIn(openKey, u, d)) return;
      var b = document.querySelector('#fx-list [data-u="' + u + '"] .fx-' + (d < 0 ? "up" : "down"));
      if (b && !b.disabled) b.focus();
    }
    function toggleFx(u) {
      update(openKey, u, function (n) { n.on = !n.on; });
      render();
      var b = document.querySelector('#fx-list [data-u="' + u + '"] .fx-pw');
      if (b) b.focus();
    }
    function setSlider(key, u, i, v, fromView) {
      if (!chainOf(key).some(function (x) { return x.u === u; })) return;
      update(key, u, function (n) { n.s[String(i)] = v; }, host.burst("fx" + u + "." + i, { live: true }));
      liveSlider(key, u, i, v);
      var vw = views[u];
      if (vw && !fromView) vw.view.setSlider(i, v);
      if (!fromView) refreshValue(u, i);
      else refreshControl(u, i);
    }
    // a file for a file slider: kept on the orOS disk next to the project's audio
    function pickFile(key, u, sl) {
      var fs = host.fsApi();
      if (!fs) { host.showToast(t("toast.noDisk")); return; }
      host.pickFiles("audio/*,.wav,.flac,.ogg,.mp3,.m4a", false).then(function (files) {
        var f = files && files[0];
        if (!f) return;
        if (f.size > 20 * 1024 * 1024) { host.showToast(t("toast.tooBig20", { name: f.name })); return; }
        return f.arrayBuffer().then(host.decode).then(function (buf) {
          var path = C.fxFilePath(C.newId("s", Math.random), f.name, C.extOf(f.name, f.type));
          return Promise.resolve(fs.writeBlob(path, f)).then(function () {
            fileBufs[path] = buf;
            var cur = chainOf(key).filter(function (x) { return x.u === u; })[0];
            var v = (cur ? Math.abs(C.fxValue(cur, sl)) : 0) % 1000 + 1;
            update(key, u, function (n) {
              n.f = Object.assign({}, n.f || {}); n.f[String(sl.i)] = path;
              n.s[String(sl.i)] = v;
              // Convolution: picking a file means using it
              FXsrcFile(n, sl);
            });
            var rec = live[key];
            if (rec) { rec.files = ""; sendFiles(rec.chain, chainOf(key)); }
            render();
          });
        }, function () { host.showToast(t("toast.badFile", { name: f.name })); });
      });
    }
    // an enum slider whose last choice names the file ("IR File") switches to it
    function FXsrcFile(n, fileSl) {
      var FX = fxMeta(n.id);
      if (!FX) return;
      FX.sliders.forEach(function (sl) {
        if (sl.enums && sl.i !== fileSl.i && /file/i.test(sl.enums[sl.enums.length - 1] || "")) n.s[String(sl.i)] = sl.max;
      });
    }

    // ---------- Dialog ----------
    function open(key) {
      openKey = key;
      picking = false; query = "";
      $("fx-dlg").setAttribute("data-key", key);
      var ok = function () {
        var ids = chainOf(key).map(function (x) { return x.id; }).filter(function (id) { return info(id); });
        return Promise.all(ids.map(function (id) { return needPage(id).catch(function () { return null; }); }));
      };
      render();
      host.showDlg("fx-dlg");
      loadCatalog().then(ok).then(function () { if (openKey === key) render(); }, function () {
        if (openKey === key) { $("fx-status").textContent = t("fx.noCatalog"); }
      });
      startLoop();
    }
    function close() {
      Object.keys(views).forEach(dropView);
      openKey = "";
      cancelAnimationFrame(raf); raf = 0;
    }
    function $(id) { return document.getElementById(id); }

    function render() {
      if (!openKey) return;
      var key = openKey, items = chainOf(key);
      if (key !== "master" && !C.find(host.data(), "tracks", key)) { host.hideDlg("fx-dlg"); return; }
      $("fx-title").textContent = t("fx.title", { name: keyName(key) });
      var list = $("fx-list");
      // keep canvases that stay (their views keep state)
      var keepCanvas = {};
      Object.keys(views).forEach(function (u) { keepCanvas[u] = views[u].canvas; });
      list.innerHTML = "";
      var seen = {};
      items.forEach(function (x, k) {
        seen[x.u] = true;
        list.appendChild(slotEl(key, x, k, items.length, keepCanvas[x.u]));
      });
      Object.keys(views).forEach(function (u) { if (!seen[u] || !expanded[u]) dropView(u); });
      $("fx-empty").hidden = items.length > 0;
      var add = $("fx-add");
      add.disabled = items.length >= C.MAX_FX || !catalog;
      add.setAttribute("aria-expanded", picking ? "true" : "false");
      $("fx-status").textContent = items.length >= C.MAX_FX ? t("fx.max", { n: C.MAX_FX }) : "";
      renderPicker();
    }

    function slotEl(key, x, k, n, canvas) {
      var e = info(x.id), FX = fxMeta(x.id), isOpen = !!expanded[x.u];
      var li = el("li", "fx-slot" + (x.on ? "" : " off") + (e ? "" : " unknown"));
      li.setAttribute("data-u", x.u);
      var head = el("div", "fx-head");
      var pw = el("button", "fx-pw" + (x.on ? " on" : ""));
      pw.type = "button";
      pw.setAttribute("aria-pressed", x.on ? "true" : "false");
      setLabel(pw, t("fx.on") + ": " + nameOf(x.id));
      pw.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3v8"/><path d="M6.3 7.5a8 8 0 1 0 11.4 0"/></svg>';
      pw.addEventListener("click", function () { toggleFx(x.u); });
      head.appendChild(pw);
      var nm = el("button", "fx-name");
      nm.type = "button";
      nm.setAttribute("aria-expanded", isOpen ? "true" : "false");
      nm.appendChild(el("span", "fx-label", e ? e.name : t("fx.unknown", { id: x.id })));
      if (e) nm.appendChild(el("span", "fx-cat", catName(e.category)));
      nm.addEventListener("click", function () {
        expanded[x.u] = !expanded[x.u];
        render();
        var f = document.querySelector('#fx-list [data-u="' + x.u + '"] .fx-name');
        if (f) f.focus();
      });
      head.appendChild(nm);
      var inst = isInstrument(x.id), afterInst = k === 1 && !!instrumentOf(chainOf(key));
      head.appendChild(iconBtn("fx-up", "M6 15l6-6 6 6", t("btn.up") + ": " + nameOf(x.id), k === 0 || inst || afterInst, function () { moveFx(x.u, -1); }));
      head.appendChild(iconBtn("fx-down", "M6 9l6 6 6-6", t("btn.down") + ": " + nameOf(x.id), k === n - 1 || inst, function () { moveFx(x.u, 1); }));
      head.appendChild(iconBtn("fx-del", "M6 6l12 12M18 6L6 18", t("fx.remove") + ": " + nameOf(x.id), false, function () { removeFx(x.u); }));
      li.appendChild(head);
      if (!isOpen) return li;
      var body = el("div", "fx-body");
      if (!e) { body.appendChild(el("p", "hint small", t("fx.unknownHint"))); li.appendChild(body); return li; }
      if (!FX) {
        body.appendChild(el("p", "hint small", t("clip.loading")));
        needPage(x.id).then(function () { if (openKey === key) render(); }, function () {});
        li.appendChild(body);
        return li;
      }
      if (e.ins > 2) body.appendChild(keyEl(key, x));
      if (FX.gfx) {
        var cv = canvas || el("canvas", "fx-gfx");
        cv.style.aspectRatio = FX.gfx.w + " / " + FX.gfx.h;
        cv.setAttribute("role", "img");
        setLabel(cv, t("fx.gfx", { name: e.name }));
        body.appendChild(cv);
        ensureView(key, x, FX, cv);
      }
      var ctl = el("details", "fx-ctl");
      ctl.open = !FX.gfx;
      ctl.appendChild(el("summary", "", t("fx.controls")));
      FX.sliders.forEach(function (sl) { ctl.appendChild(sliderEl(key, x, sl)); });
      body.appendChild(ctl);
      li.appendChild(body);
      return li;
    }
    // Sidechain: which track this effect listens to. Tracks that already
    // listen to this one (directly or through others) are left out: a loop.
    function keyEl(key, x) {
      var id = "fx-" + x.u + "-key", row = el("div", "fx-row fx-key"), lab = el("label", "field");
      lab.htmlFor = id;
      lab.appendChild(el("span", "", t("fx.key")));
      row.appendChild(lab);
      var sel = el("select", ""), none = el("option", "", t("fx.keyNone"));
      sel.id = id; none.value = ""; sel.appendChild(none);
      var trs = C.tracksOf(host.data(), host.proj() ? host.proj().id : "");
      trs.forEach(function (tr) {
        if (key !== "master" && (tr.id === key || C.keyLoops(trs, key, tr.id))) return;
        var o = el("option", "", tr.name || t("track.default", { n: "" }));
        o.value = tr.id;
        sel.appendChild(o);
      });
      sel.value = x.sc || "";
      if (sel.value !== (x.sc || "")) sel.value = "";
      sel.addEventListener("change", function () {
        var v = sel.value;
        update(key, x.u, function (n) { if (v) n.sc = v; else delete n.sc; });
        render();
        var f = $(id); if (f) f.focus();
      });
      row.appendChild(sel);
      row.appendChild(el("p", "hint small", t("fx.keyHint")));
      return row;
    }
    function iconBtn(cls, path, label, disabled, fn) {
      var b = el("button", "icon-btn small " + cls);
      b.type = "button";
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
      setLabel(b, label);
      b.disabled = disabled;
      b.addEventListener("click", fn);
      return b;
    }
    function catName(c) {
      return c === "One Slider" ? t("fx.cat1") : c === "Essentials" ? t("fx.cat2") : c === "Advanced" ? t("fx.cat3") : c === "Instruments" ? t("fx.catInst") : c;
    }
    function decimals(sl) {
      if (sl.inc >= 1 || !(sl.inc > 0)) return sl.inc > 0 ? 0 : 2;
      var s = String(sl.inc), i = s.indexOf(".");
      return i < 0 ? 0 : Math.min(4, s.length - i - 1);
    }
    function valueText(sl, v) {
      if (sl.enums) return sl.enums[Math.round(v - sl.min)] != null ? sl.enums[Math.round(v - sl.min)] : String(v);
      return host.numTxt(v, decimals(sl));
    }
    function sliderEl(key, x, sl) {
      var v = C.fxValue(x, sl), id = "fx-" + x.u + "-" + sl.i, row = el("div", "fx-row");
      row.setAttribute("data-i", String(sl.i));
      var lab = el("label", "field");
      lab.htmlFor = id;
      lab.appendChild(el("span", "", sl.name || ("Slider " + sl.i)));
      if (sl.path) {
        var fname = x.f && x.f[sl.i] ? x.f[sl.i].replace(/^.*\//, "") : t("fx.noFile");
        lab.appendChild(el("output", "", fname));
        row.appendChild(lab);
        var b = el("button", "chip", t("fx.chooseFile"));
        b.type = "button"; b.id = id;
        b.addEventListener("click", function () { pickFile(key, x.u, sl); });
        row.appendChild(b);
        return row;
      }
      var out = el("output", "", valueText(sl, v));
      lab.appendChild(out);
      row.appendChild(lab);
      if (sl.enums) {
        var sel = el("select", "");
        sel.id = id;
        sl.enums.forEach(function (name, k) { var o = el("option", "", name); o.value = String(sl.min + k); sel.appendChild(o); });
        sel.value = String(Math.round(v));
        sel.addEventListener("change", function () { setSlider(key, x.u, sl.i, parseFloat(sel.value)); });
        row.appendChild(sel);
      } else {
        var r = el("input", "");
        r.type = "range"; r.id = id; r.min = "0"; r.max = String(C.POS_STEPS); r.step = "1";
        r.value = String(Math.round(C.sliderToPos(sl, v) * C.POS_STEPS));
        r.setAttribute("aria-valuetext", valueText(sl, v));
        r.addEventListener("input", function () {
          setSlider(key, x.u, sl.i, C.sliderFromPos(sl, parseInt(r.value, 10) / C.POS_STEPS));
        });
        r.addEventListener("dblclick", function () { setSlider(key, x.u, sl.i, sl.def); refreshControl(x.u, sl.i); });
        row.appendChild(r);
      }
      return row;
    }
    function rowOf(u, i) { return document.querySelector('#fx-list [data-u="' + u + '"] .fx-row[data-i="' + i + '"]'); }
    function itemOf(u) { return chainOf(openKey).filter(function (x) { return x.u === u; })[0]; }
    function slOf(u, i) {
      var x = itemOf(u), FX = x && fxMeta(x.id);
      return FX ? FX.sliders.filter(function (s) { return s.i === i; })[0] : null;
    }
    // the text next to a control (the control itself is moving)
    function refreshValue(u, i) {
      if (!openKey) return;
      var row = rowOf(u, i), sl = slOf(u, i), x = itemOf(u);
      if (!row || !sl || !x) return;
      var v = C.fxValue(x, sl), out = row.querySelector("output"), r = row.querySelector("input[type=range]");
      if (out) out.textContent = valueText(sl, v);
      if (r) r.setAttribute("aria-valuetext", valueText(sl, v));
    }
    // the interface moved a slider: move its control too
    function refreshControl(u, i) {
      if (!openKey) return;
      var row = rowOf(u, i), sl = slOf(u, i), x = itemOf(u);
      if (!row || !sl || !x) return;
      var v = C.fxValue(x, sl), r = row.querySelector("input[type=range]"), s = row.querySelector("select");
      if (r && document.activeElement !== r) r.value = String(Math.round(C.sliderToPos(sl, v) * C.POS_STEPS));
      if (s) s.value = String(Math.round(v));
      refreshValue(u, i);
    }

    // ---------- Picker ----------
    function renderPicker() {
      var box = $("fx-pick");
      box.hidden = !picking;
      if (!picking) return;
      var host2 = $("fx-cats");
      host2.innerHTML = "";
      if (!catalog) { host2.appendChild(el("p", "hint small", t("clip.loading"))); return; }
      var q = query.trim().toLowerCase(), any = false;
      ["One Slider", "Essentials", "Advanced"].forEach(function (cat) {
        var list = catalog.filter(function (e) {
          return e.category === cat && (!q || (e.name + " " + (e.tags || "")).toLowerCase().indexOf(q) >= 0);
        });
        if (!list.length) return;
        any = true;
        host2.appendChild(el("h3", "", catName(cat)));
        var ul = el("ul", "fx-picks");
        list.forEach(function (e) {
          var li = el("li", ""), b = el("button", "chip", e.name);
          b.type = "button";
          if (e.gfx) b.classList.add("has-gfx");
          setLabel(b, t("fx.add") + ": " + e.name);
          b.addEventListener("click", function () { addFx(e.id); });
          li.appendChild(b); ul.appendChild(li);
        });
        host2.appendChild(ul);
      });
      if (!any) host2.appendChild(el("p", "hint small", t("fx.none")));
    }
    function togglePicker() {
      picking = !picking;
      render();
      if (picking) { var s = $("fx-search"); s.value = query; s.focus(); }
    }

    // ---------- Interfaces (GFX) ----------
    function ensureView(key, x, FX, canvas) {
      var vw = views[x.u];
      if (vw && vw.canvas === canvas && vw.id === x.id) {
        // undo, redo or another device may have moved sliders
        FX.sliders.forEach(function (sl) {
          var v = C.fxValue(x, sl);
          if (!sl.path && vw.view.fx.inst.getSlider(sl.i) !== v) vw.view.setSlider(sl.i, v);
        });
        if (x.st && JSON.stringify(x.st) !== vw.view.lastState) vw.view.setState(x.st);
        return;
      }
      if (vw) dropView(x.u);
      var a = host.audio(), sr = a ? a.sampleRate : 48000;
      var view;
      try {
        view = new window.NULLGfx.View(FX, canvas, {
          srate: sr, sliders: sliders(FX, x, false), state: x.st || null,
          onSlider: function (i, v) { setSlider(key, x.u, i, v, true); }
        });
      } catch (e) { return; }
      views[x.u] = { view: view, canvas: canvas, id: x.id, key: key, busy: false, last: 0 };
    }
    // what an interface shares with its audio in REAPER: variables it sets
    // for the audio (a voice to hear) and the plugin's own state (a drawn
    // pattern, saved with the track and sent to the audio)
    function shared(vw, u) {
      var pk = vw.view.takePokes ? vw.view.takePokes() : null;
      if (pk) {
        var rec = live[vw.key];
        if (rec && host.isPlaying()) rec.chain.setVars(u, pk);
        else {
          var a = host.audio();
          if (a) preview(a, vw.key, host.previewOut(a)).then(function (ok) { if (ok && pv) pv.chain.setVars(u, pk); });
        }
      }
      var st = vw.view.takeState ? vw.view.takeState() : null;
      if (st) {
        update(vw.key, u, function (n) { n.st = st; }, host.burst("fxst" + u, { live: true }));
        liveState(vw.key, u, st);
      }
    }
    function dropView(u) {
      var vw = views[u];
      if (!vw) return;
      try { vw.view.destroy(); } catch (e) { /* gone */ }
      delete views[u];
    }
    function startLoop() {
      if (raf) return;
      var frame = function () {
        raf = 0;
        if (!openKey) return;
        var now = Date.now();
        Object.keys(views).forEach(function (u) {
          var vw = views[u], rec = live[vw.key];
          if (rec && host.isPlaying() && !vw.busy && now - vw.last >= PEEK_MS) {
            vw.busy = true; vw.last = now;
            rec.chain.peek(u).then(function (m) { vw.busy = false; if (views[u] === vw) vw.view.setLive(m); });
          }
          try { vw.view.draw(); } catch (e) { /* a drawing error must not stop the others */ }
          shared(vw, u);
        });
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }

    function wire() {
      $("fx-close").addEventListener("click", function () { host.hideDlg("fx-dlg"); });
      $("fx-dlg").addEventListener("close", close);
      $("fx-add").addEventListener("click", togglePicker);
      $("fx-search").addEventListener("input", function () { query = $("fx-search").value; renderPicker(); });
      $("fx-search").addEventListener("keydown", function (e) { if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); query = ""; $("fx-search").value = ""; renderPicker(); } });
    }

    return {
      wire: wire, open: open, render: render, loadCatalog: loadCatalog, keepOffline: keepOffline,
      ensure: ensure, preparePage: preparePage, isReady: isReady, insert: insert, setTime: setTime, disconnect: disconnect, prune: prune,
      chainLatency: chainLatency, active: active, nameOf: nameOf, isOpen: function () { return !!openKey; },
      setTimeAt: setTimeAt, midi: midi, preview: preview, previewMidi: previewMidi, dropPreview: dropPreview,
      instruments: function () { return instCat; }, isInstrument: isInstrument, instrumentOf: instrumentOf, withInstrument: withInstrument,
      keyInputs: keyInputs, autoParams: autoParams, hasKey: hasKey,
      // automatable sliders of a chain: [{ k: lane key, u, sl, name }] (loads what it needs, then onReady)
      params: function (items, onReady) {
        var out = [], wait = [];
        (items || []).forEach(function (x) {
          if (!known(x)) return;
          var FX = fxMeta(x.id);
          if (!FX) { wait.push(needPage(x.id)); return; }
          FX.sliders.forEach(function (sl) {
            if (!sl.path) out.push({ k: C.fxLaneKey(x.u, sl.i), u: x.u, sl: sl, name: nameOf(x.id) + ": " + (sl.name || ("Slider " + sl.i)) });
          });
        });
        if (wait.length && onReady) Promise.all(wait).then(onReady, function () {});
        return out;
      },
      // for the remote (remote.js): the same edits the dialog makes, by chain key
      catalog: function () { return catalog; }, meta: needPage, fxMeta: fxMeta, chainOf: chainOf, catName: catName, valueText: valueText,
      setSlider: function (key, u, i, v) { setSlider(key, u, i, v, false); }, addTo: function (key, id) { var u = addTo(key, id); render(); return u; },
      removeFrom: removeFrom, moveIn: moveIn,
      peek: function (key, u) { var rec = live[key]; return rec && host.isPlaying() ? rec.chain.peek(u) : Promise.resolve(null); },
      count: function (items) { return (items || []).filter(function (x) { return x.on; }).length; }
    };
  };
})();
