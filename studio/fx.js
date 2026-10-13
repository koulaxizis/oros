// ============================================================
// orOS Studio — effects (v1.0.0)
// NULL JSFX effects (https://nulljsfx.tech, MIT) on the tracks and the
// master: the chains, their audio and the Effects dialog.
//   - nullfx/: the web version of NULL JSFX, copied from the null-jsfx
//     repository (web/runtime + web/fx). Each effect is a static file
//     translated ahead of time from its JSFX; nothing is evaluated.
//   - Audio: one AudioWorklet node ("null-fx-chain") per chain; live
//     chains stay alive between plays so a reorder or a slider move
//     does not reset them. Export builds its own in the offline context.
//   - Latency: effects that look ahead (limiters, convolution) delay
//     their track; the other tracks are delayed by the difference, and
//     the playhead, takes and export allow for the total.
//   - Interface: effects with a GFX interface draw it on a canvas (a
//     copy of the effect runs @init/@slider on the page, the worklet
//     sends the meters); every slider is also a plain control.
// Loaded before studio.js; window.StudioFX(host) returns the API.
// ============================================================
(function () {
  "use strict";

  var BASE = "nullfx/";
  var PEEK_MS = 33;

  window.StudioFX = function (host) {
    var C = host.C, t = host.t, el = host.el, setLabel = host.setLabel;
    var catalog = null, catalogP = null;      // index.json: { effects: [...] }
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
          // effects with an extra input (Sidechain Ducker's key) need routing Studio does not have yet
          catalog = (j.effects || []).filter(function (e) { return C.FX_ID_RE.test(e.id) && e.ins <= 2 && e.outs === 2; });
          return catalog;
        }, function (e) { catalogP = null; throw e; });
      }
      return catalogP;
    }
    function info(id) {
      if (!catalog) return null;
      for (var i = 0; i < catalog.length; i++) if (catalog[i].id === id) return catalog[i];
      return null;
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
    function known(item) { return !!info(item.id); }
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
      return Promise.all([NN.load(ctx, BASE, list)]
        .concat(list.map(needPage))
        .concat(Object.keys(paths).map(fileBuf)));
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
    function chainList(items) {
      return active(items).map(function (x) {
        return { uid: x.u, id: x.id, sliders: sliders(fxMeta(x.id) || { sliders: [] }, x, false), bypass: false };
      });
    }
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
    function insert(ctx, key, items, target, offline) {
      if (!active(items).length || !isReady(ctx, [items])) return null;
      var NN = window.NULLFXNode, rec = offline ? null : live[key];
      if (rec && rec.ctx !== ctx) { rec.chain.disconnect(); rec = null; }
      if (!rec) {
        var ch;
        try { ch = new NN.Chain(ctx, { chain: chainList(items) }); } catch (e) { return null; }
        ch.onerror = function (m) { host.showToast(t("fx.failed", { name: nameOf(m.id) })); };
        rec = { chain: ch, ctx: ctx, files: "" };
        if (!offline) live[key] = rec;
      } else {
        rec.chain.setChain(chainList(items));
      }
      sendSliders(rec.chain, items);
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
        fn(n);
        return n;
      }), opts);
    }
    function addFx(id) {
      var items = chainOf(openKey);
      if (items.length >= C.MAX_FX) { host.showToast(t("fx.max", { n: C.MAX_FX })); return; }
      var u = C.newId("f", Math.random);
      picking = false; query = "";
      expanded = {}; expanded[u] = true;
      setChain(openKey, items.concat([{ u: u, id: id, on: true, s: {} }]));
      render();
    }
    function removeFx(u) {
      setChain(openKey, chainOf(openKey).filter(function (x) { return x.u !== u; }));
      dropView(u);
      host.undoToast(t("fx.removed"));
      render();
    }
    function moveFx(u, d) {
      var items = chainOf(openKey).slice(), i = -1;
      items.forEach(function (x, k) { if (x.u === u) i = k; });
      var j = i + d;
      if (i < 0 || j < 0 || j >= items.length) return;
      var tmp = items[i]; items[i] = items[j]; items[j] = tmp;
      setChain(openKey, items);
      render();
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
      head.appendChild(iconBtn("fx-up", "M6 15l6-6 6 6", t("btn.up") + ": " + nameOf(x.id), k === 0, function () { moveFx(x.u, -1); }));
      head.appendChild(iconBtn("fx-down", "M6 9l6 6 6-6", t("btn.down") + ": " + nameOf(x.id), k === n - 1, function () { moveFx(x.u, 1); }));
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
      return c === "One Slider" ? t("fx.cat1") : c === "Essentials" ? t("fx.cat2") : c === "Advanced" ? t("fx.cat3") : c;
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
      var row = rowOf(u, i), sl = slOf(u, i), x = itemOf(u);
      if (!row || !sl || !x) return;
      var v = C.fxValue(x, sl), out = row.querySelector("output"), r = row.querySelector("input[type=range]");
      if (out) out.textContent = valueText(sl, v);
      if (r) r.setAttribute("aria-valuetext", valueText(sl, v));
    }
    // the interface moved a slider: move its control too
    function refreshControl(u, i) {
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
        return;
      }
      if (vw) dropView(x.u);
      var a = host.audio(), sr = a ? a.sampleRate : 48000;
      var view;
      try {
        view = new window.NULLGfx.View(FX, canvas, {
          srate: sr, sliders: sliders(FX, x, false),
          onSlider: function (i, v) { setSlider(key, x.u, i, v, true); }
        });
      } catch (e) { return; }
      views[x.u] = { view: view, canvas: canvas, id: x.id, key: key, busy: false, last: 0 };
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
      wire: wire, open: open, render: render, loadCatalog: loadCatalog,
      ensure: ensure, preparePage: preparePage, isReady: isReady, insert: insert, setTime: setTime, disconnect: disconnect, prune: prune,
      chainLatency: chainLatency, active: active, nameOf: nameOf, isOpen: function () { return !!openKey; },
      count: function (items) { return (items || []).filter(function (x) { return x.on; }).length; }
    };
  };
})();
