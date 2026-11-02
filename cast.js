/* ============================================================
   orOS — Play on (shared): send what an app plays to another
   speaker or TV ("Play on…" / «Αναπαραγωγή σε…», CAST-1)

   One button next to an app's player opens a small picker with two
   groups:
   - This device: where the sound comes out. A Bluetooth speaker is
     paired by the system (Windows, Linux, Android, orOS USB's Quick
     settings › Bluetooth); after that it is an output like any other.
     Where the browser lets a page choose (setSinkId), the outputs it
     shows are listed; Firefox opens its own speaker list
     (selectAudioOutput). orOS never asks for the microphone just to
     read output names, so Chrome usually shows "System output" only.
   - TV or speaker on the network: the browser's own Remote Playback
     (Chrome on Android: Chromecast and Cast TVs; Safari: AirPlay).
     The browser shows its own device list; orOS loads no Google code
     (Chris 2026-11-02, rule 29, option A).

   Remote Playback needs a plain stream address on the element. An app
   that plays through MSE (Television's hls.js) passes probe: true and
   url(): a hidden element of the same kind carries that address, plays
   on the TV once connected, and the app pauses its own player
   (onRemote "connected") and resumes it when the TV lets go.

   Device-local, never synced: oros-cast-prefs = { <app>: { sink } },
   the output last chosen per app (a browser device id, origin-bound).

   window.OrosCast = { attach(o), model(c), castable(url), prefs, STR }
   attach({ app, button, media() → element, url() → address,
     probe (bool), lang, onRemote(state) }) → { open, close, update,
     remote() → "disconnected" | "connecting" | "connected" }
   Nothing from a device (labels) is inserted as HTML: textContent only.
   ============================================================ */
(function (root) {
  "use strict";

  var PREF = "oros-cast-prefs";
  var MAX_ID = 200;

  var STR = {
    en: {
      "btn": "Play on…",
      "title": "Play on",
      "close": "Close",
      "dev.head": "This device",
      "dev.system": "System output",
      "dev.default": "Default output",
      "dev.n": "Output {n}",
      "dev.select": "Choose a speaker…",
      "dev.fail": "This output cannot be used now.",
      "bt.note": "Bluetooth speaker or headphones: pair them in your system's Bluetooth settings (on orOS USB: Quick settings › Bluetooth). orOS then plays through them.",
      "net.head": "TV or speaker on the network",
      "net.remote": "Chromecast, AirPlay or TV",
      "net.remote.sub": "The browser shows the devices it finds",
      "net.on": "Playing on a TV or speaker",
      "net.connecting": "Connecting…",
      "net.manage": "Stop or change",
      "net.none": "This browser found no TV or speaker. Chrome on Android finds Chromecast devices, Safari finds AirPlay.",
      "net.nostream": "This station or channel cannot be sent to a TV.",
      "net.notfound": "No TV or speaker answered."
    },
    el: {
      "btn": "Αναπαραγωγή σε…",
      "title": "Αναπαραγωγή σε",
      "close": "Κλείσιμο",
      "dev.head": "Αυτή η συσκευή",
      "dev.system": "Έξοδος συστήματος",
      "dev.default": "Προεπιλεγμένη έξοδος",
      "dev.n": "Έξοδος {n}",
      "dev.select": "Επιλογή ηχείου…",
      "dev.fail": "Αυτή η έξοδος δεν μπορεί να χρησιμοποιηθεί τώρα.",
      "bt.note": "Ηχείο ή ακουστικά Bluetooth: κάνε σύζευξη στις ρυθμίσεις Bluetooth του συστήματος (στο orOS USB: Γρήγορες ρυθμίσεις › Bluetooth). Μετά το orOS παίζει από εκεί.",
      "net.head": "Τηλεόραση ή ηχείο στο δίκτυο",
      "net.remote": "Chromecast, AirPlay ή τηλεόραση",
      "net.remote.sub": "Ο browser δείχνει τις συσκευές που βρίσκει",
      "net.on": "Παίζει σε τηλεόραση ή ηχείο",
      "net.connecting": "Σύνδεση…",
      "net.manage": "Διακοπή ή αλλαγή",
      "net.none": "Ο browser δεν βρήκε τηλεόραση ή ηχείο. Το Chrome στο Android βρίσκει συσκευές Chromecast, το Safari βρίσκει AirPlay.",
      "net.nostream": "Αυτός ο σταθμός ή το κανάλι δεν μπορεί να σταλεί σε τηλεόραση.",
      "net.notfound": "Καμία τηλεόραση ή ηχείο δεν απάντησε."
    }
  };

  function noop() {}

  // ---------- pure ----------

  // Only an http(s) address can go to another device (never blob: or data:).
  function castable(url) {
    return typeof url === "string" && url.length <= 4096 && /^https?:\/\/[^\s]+$/i.test(url);
  }

  // What the picker shows, from what the browser offers.
  // c = { canSink, canSelect, outputs: [{ id, label }], sink,
  //       remote: "none" | "unknown" | "available" | "unavailable",
  //       rstate: "disconnected" | "connecting" | "connected", stream }
  function model(c) {
    var out = { device: [], net: [], netNote: "" };
    var list = (c.outputs || []).filter(function (d) { return d && d.id && d.id !== "communications"; });
    var cur = c.sink || "default";
    if (c.canSink && list.length > 1) {
      list.forEach(function (d, i) {
        out.device.push({ kind: "sink", id: d.id, label: d.label || "", n: i + 1, on: d.id === cur });
      });
      if (!list.some(function (d) { return d.id === cur; })) out.device[0].on = true;
    } else {
      out.device.push({ kind: "system", on: true });
    }
    if (c.canSink && c.canSelect) out.device.push({ kind: "select" });
    if (c.rstate === "connected" || c.rstate === "connecting") {
      out.net.push({ kind: "remote-on", state: c.rstate });
    } else if (c.stream === false) {
      out.netNote = "net.nostream";
    } else if (c.remote === "available" || c.remote === "unknown") {
      out.net.push({ kind: "remote" });
    } else {
      out.netNote = "net.none";
    }
    return out;
  }

  var prefs = {
    read: function (store, app) {
      try {
        var all = JSON.parse(store.getItem(PREF) || "{}");
        var p = all && typeof all === "object" && all[app];
        var s = p && typeof p.sink === "string" && p.sink.length <= MAX_ID ? p.sink : "";
        return { sink: s };
      } catch (e) { return { sink: "" }; }
    },
    write: function (store, app, sink) {
      if (!/^[a-z0-9-]{1,40}$/.test(app)) return;
      var all = null;
      try { all = JSON.parse(store.getItem(PREF) || "{}"); } catch (e) {}
      if (!all || typeof all !== "object" || Array.isArray(all)) all = {};
      try {
        if (sink && sink !== "default" && typeof sink === "string" && sink.length <= MAX_ID) all[app] = { sink: sink };
        else delete all[app];
        store.setItem(PREF, JSON.stringify(all));
      } catch (e) {}
    }
  };

  // ---------- DOM ----------

  var CSS = [
    ".oros-cast-dlg{margin:auto;border:1px solid var(--line,var(--border,#2e2c28));border-radius:14px;padding:0;",
    "background:var(--panel,var(--panel-bg,#1b1a18));color:var(--fg,var(--text,#e8e6e3));",
    "width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px);font:inherit}",
    ".oros-cast-dlg::backdrop{background:rgba(0,0,0,.5)}",
    ".oros-cast-box{padding:14px 16px 16px;overflow:auto;max-height:calc(100dvh - 34px)}",
    ".oros-cast-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}",
    ".oros-cast-head h3{flex:1;font-size:1.05em;margin:0}",
    ".oros-cast-dlg h4{font-size:.85em;margin:12px 0 6px;color:var(--muted,var(--text-dim,#9aa4b0));font-weight:600}",
    ".oros-cast-row{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:8px 10px;margin:0 0 6px;",
    "border:1px solid var(--line,var(--border,#2e2c28));border-radius:10px;background:transparent;color:inherit;",
    "font:inherit;text-align:left;cursor:pointer}",
    ".oros-cast-row[aria-pressed=true]{border-color:var(--accent,#d4af37);background:var(--accent-soft,rgba(212,175,55,.15))}",
    ".oros-cast-row:focus-visible,.oros-cast-x:focus-visible{outline:2px solid var(--accent,#d4af37);outline-offset:2px}",
    ".oros-cast-row span{display:block}",
    ".oros-cast-sub{font-size:.82em;color:var(--muted,var(--text-dim,#9aa4b0))}",
    ".oros-cast-note{font-size:.85em;color:var(--muted,var(--text-dim,#9aa4b0));margin:4px 0 8px;line-height:1.4}",
    ".oros-cast-x{min-width:44px;min-height:44px;border:0;background:transparent;color:inherit;font:inherit;font-size:1.1em;cursor:pointer}",
    ".oros-cast-on{color:var(--accent,#d4af37)}",
    ".oros-cast-btn svg{display:block;margin:auto;pointer-events:none}",
    ".oros-cast-btn.oros-cast-active{color:var(--accent,#d4af37);border-color:var(--accent,#d4af37)}"
  ].join("");

  function icon(doc) {
    var NS = "http://www.w3.org/2000/svg";
    var svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    ["M3 8V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6",
      "M3 12a8 8 0 0 1 8 8", "M3 16a4 4 0 0 1 4 4", "M3 20h.01"].forEach(function (d) {
      var p = doc.createElementNS(NS, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    });
    return svg;
  }

  function attach(o) {
    var btn = o.button, doc = btn.ownerDocument, win = doc.defaultView;
    var I = root.orosI18n, LANG = o.lang === "el" ? "el" : (I && I.lang() !== "el" ? I.lang() : "en");
    var S0 = STR[LANG] || (I ? I.table(STR, "cast", LANG) : STR.en);
    function t(k, p) {
      var s = S0[k] || STR.en[k] || k;
      if (p) Object.keys(p).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
      return s;
    }
    var store = null;
    try { store = win.localStorage; } catch (e) {}
    var md = win.navigator && win.navigator.mediaDevices;
    var probe = null, watched = null, watchId = null;
    var avail = "none", rstate = "disconnected", outputs = [], note = "", dlg = null;

    function local() { try { return o.media ? o.media() : null; } catch (e) { return null; } }
    function streamUrl() { try { return o.url ? o.url() : ""; } catch (e) { return ""; } }

    // The element Remote Playback works on: the app's own, or the probe.
    function target() {
      if (!o.probe) return local();
      var u = streamUrl();
      if (!probe) {
        var m = local();
        probe = doc.createElement(m && m.tagName === "VIDEO" ? "video" : "audio");
        probe.preload = "none";
        probe.setAttribute("data-oros-cast", "1");
        probe.setAttribute("playsinline", "");
        probe.style.display = "none";
        doc.body.appendChild(probe);
      }
      if (castable(u) && probe.getAttribute("src") !== u && rstate === "disconnected") probe.src = u;
      return castable(probe.getAttribute("src") || "") ? probe : null;
    }

    function hook(el) {
      if (!el || !el.remote || el.__orosCast) return;
      el.__orosCast = true;
      ["connecting", "connect", "disconnect"].forEach(function (ev) {
        el.remote.addEventListener(ev, function () { changed(el); });
      });
    }
    function changed(el) {
      var s = el.remote.state;
      if (s === rstate) return;
      rstate = s;
      if (o.probe && el === probe) {
        if (s === "connected") { try { var p = el.play(); if (p && p.catch) p.catch(noop); } catch (e) {} }
        else if (s === "disconnected") { try { el.pause(); } catch (e) {} }
      }
      paint();
      if (o.onRemote) { try { o.onRemote(s); } catch (e) {} }
      if (dlg && dlg.open) render();
    }

    function watch() {
      var el = target();
      if (!el || !el.remote || el.disableRemotePlayback) { avail = "none"; return; }
      hook(el);
      rstate = el.remote.state || "disconnected";
      if (watched === el) return;
      if (watched && watchId !== null) { try { watched.remote.cancelWatchAvailability(watchId); } catch (e) {} }
      watched = el; watchId = null; avail = "unknown";
      try {
        el.remote.watchAvailability(function (a) {
          avail = a ? "available" : "unavailable";
          if (dlg && dlg.open) render();
        }).then(function (id) { watchId = id; }, function () { avail = "unknown"; });
      } catch (e) { avail = "unknown"; }
    }

    function canSink() { var m = local(); return !!(m && typeof m.setSinkId === "function"); }
    function canSelect() { return !!(md && typeof md.selectAudioOutput === "function"); }

    function readOutputs() {
      if (!md || typeof md.enumerateDevices !== "function" || !canSink()) return Promise.resolve([]);
      return md.enumerateDevices().then(function (l) {
        return (l || []).filter(function (d) { return d.kind === "audiooutput"; })
          .map(function (d) { return { id: String(d.deviceId || ""), label: String(d.label || "").slice(0, 120) }; });
      }, function () { return []; });
    }

    function useSink(id) {
      var m = local();
      if (!m || typeof m.setSinkId !== "function") return Promise.resolve(false);
      return m.setSinkId(id || "").then(function () {
        if (store) prefs.write(store, o.app, id);
        note = "";
        return true;
      }, function () { note = "dev.fail"; return false; });
    }

    function paint() {
      var on = rstate === "connected" || rstate === "connecting";
      btn.classList.toggle("oros-cast-active", on);
      btn.setAttribute("aria-label", on ? t("net.on") : t("btn"));
      btn.title = on ? t("net.on") : t("btn");
    }

    function el(tag, cls, text) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function row(main, sub, pressed, fn) {
      var b = el("button", "oros-cast-row");
      b.type = "button";
      var w = el("span");
      w.appendChild(el("span", "", main));
      if (sub) w.appendChild(el("span", "oros-cast-sub", sub));
      b.appendChild(w);
      if (pressed !== null) b.setAttribute("aria-pressed", pressed ? "true" : "false");
      b.addEventListener("click", fn);
      return b;
    }

    function render() {
      if (!dlg) return;
      var box = dlg.firstChild;
      box.textContent = "";
      var head = el("div", "oros-cast-head");
      head.appendChild(el("h3", "", t("title")));
      var x = el("button", "oros-cast-x", "✕");
      x.type = "button";
      x.setAttribute("aria-label", t("close"));
      x.addEventListener("click", close);
      head.appendChild(x);
      box.appendChild(head);

      var m = local();
      var u = o.probe ? streamUrl() : (m ? (m.currentSrc || m.getAttribute("src") || "") : "");
      var mod = model({
        canSink: canSink(), canSelect: canSelect(), outputs: outputs,
        sink: m && m.sinkId, remote: avail, rstate: rstate, stream: castable(u)
      });

      box.appendChild(el("h4", "", t("dev.head")));
      mod.device.forEach(function (d) {
        if (d.kind === "system") box.appendChild(row(t("dev.system"), "", true, close));
        else if (d.kind === "sink") {
          var label = d.label || (d.id === "default" ? t("dev.default") : t("dev.n", { n: d.n }));
          box.appendChild(row(label, "", d.on, function () { useSink(d.id === "default" ? "" : d.id).then(render); }));
        } else if (d.kind === "select") {
          box.appendChild(row(t("dev.select"), "", null, function () {
            md.selectAudioOutput().then(function (dev) {
              return useSink(dev.deviceId).then(function () { return readOutputs(); }).then(function (l) { outputs = l; render(); });
            }, noop);
          }));
        }
      });
      if (note && note.indexOf("dev.") === 0) box.appendChild(el("p", "oros-cast-note", t(note)));
      box.appendChild(el("p", "oros-cast-note", t("bt.note")));

      box.appendChild(el("h4", "", t("net.head")));
      mod.net.forEach(function (n) {
        if (n.kind === "remote") {
          box.appendChild(row(t("net.remote"), t("net.remote.sub"), null, prompt));
        } else if (n.kind === "remote-on") {
          var p = el("p", "oros-cast-note oros-cast-on", n.state === "connecting" ? t("net.connecting") : t("net.on"));
          box.appendChild(p);
          box.appendChild(row(t("net.manage"), "", null, prompt));
        }
      });
      if (mod.netNote) box.appendChild(el("p", "oros-cast-note", t(mod.netNote)));
      if (note && note.indexOf("net.") === 0) box.appendChild(el("p", "oros-cast-note", t(note)));
    }

    // Must run inside the click (user activation): no await before prompt().
    function prompt() {
      var e = target();
      if (!e || !e.remote) { avail = "none"; render(); return; }
      hook(e);
      note = "";
      var p;
      try { p = e.remote.prompt(); } catch (err) { p = Promise.reject(err); }
      p.then(function () { if (dlg && dlg.open) render(); }, function (err) {
        var n = err && err.name;
        if (n === "NotFoundError") note = "net.notfound";
        else if (n === "NotSupportedError" || n === "InvalidStateError") { avail = "none"; }
        if (dlg && dlg.open) render();
      });
    }

    function css() {
      if (doc.getElementById("oros-cast-css")) return;
      var st = el("style");
      st.id = "oros-cast-css";
      st.textContent = CSS;
      (doc.head || doc.body).appendChild(st);
    }

    function open() {
      css();
      if (!dlg) {
        dlg = el("dialog", "oros-cast-dlg");
        dlg.setAttribute("aria-label", t("title"));
        dlg.appendChild(el("div", "oros-cast-box"));
        dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });
        doc.body.appendChild(dlg);
      }
      note = "";
      watch();
      render();
      if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } }
      readOutputs().then(function (l) { outputs = l; if (dlg.open) render(); });
    }
    function close() { if (dlg && dlg.open) { try { dlg.close(); } catch (e) { dlg.removeAttribute("open"); } } }

    // The app changed station or channel: a TV that is on follows it.
    function update() {
      if (o.probe && probe && rstate === "connected") {
        var u = streamUrl();
        if (castable(u) && probe.getAttribute("src") !== u) {
          probe.src = u;
          try { var p = probe.play(); if (p && p.catch) p.catch(noop); } catch (e) {}
        }
      }
      if (dlg && dlg.open) { watch(); render(); }
    }

    css();
    if (!btn.firstChild) btn.appendChild(icon(doc));
    btn.classList.add("oros-cast-btn");
    btn.addEventListener("click", open);
    paint();
    // The output chosen last time, where the browser still knows it.
    if (store && canSink()) {
      var saved = prefs.read(store, o.app).sink;
      var m0 = local();
      if (saved && m0 && m0.sinkId !== saved) m0.setSinkId(saved).catch(noop);
    }
    // An element already on a TV (Radio's player lives in the shell).
    var e0 = o.probe ? null : local();
    if (e0 && e0.remote) { hook(e0); rstate = e0.remote.state || "disconnected"; paint(); }

    return {
      open: open, close: close, update: update,
      remote: function () { return rstate; }, t: t
    };
  }

  var api = { attach: attach, model: model, castable: castable, prefs: prefs, STR: STR, PREF: PREF };
  root.OrosCast = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
