// ============================================================
// orOS Time — Stage view renderer (v1.1.0, wave 2)
// Draws what the speaker sees, from the stored state only:
//   oros-time-stage      (synced: events, items)
//   oros-time-stage-run  (device-local: the live item and its clock)
//   oros-time-stage-show (device-local: message, black screen, layout,
//                         mirror) + the logo in IndexedDB.
// Used twice: the full-screen view inside Time (time/stage.js) and
// the separate stage display window (time/display.html), which keeps
// running from storage even when Time itself is closed. No sync, no
// writes except the logo store; everything is drawn with textContent.
// window.OrosStageView = { create(root, {lang}), readState(), logo }.
// ============================================================
(function () {
  "use strict";
  var C = window.OrosStageCore;
  if (!C) return;

  var STR = {
    en: {
      nextup: "Next: {t}", last: "Last item", done: "All done", waiting: "Nothing on stage yet",
      agenda: "Today"
    },
    el: {
      nextup: "Επόμενο: {t}", last: "Τελευταίο στοιχείο", done: "Τέλος", waiting: "Τίποτα στη σκηνή ακόμη",
      agenda: "Σήμερα"
    }
  };

  function readJSON(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
  }
  function readState() {
    return {
      data: C.canon(readJSON("oros-time-stage") || C.empty()),
      run: C.normRun(readJSON("oros-time-stage-run")),
      show: C.normShow(readJSON("oros-time-stage-show"))
    };
  }

  // ---------- Logo (device-local picture, IndexedDB) ----------
  var DB = "oros-time-stage", STORE = "files";
  function idb() {
    return new Promise(function (res, rej) {
      try {
        var rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      } catch (e) { rej(e); }
    });
  }
  var logo = {
    get: function () {
      return idb().then(function (db) {
        return new Promise(function (res) {
          var rq = db.transaction(STORE, "readonly").objectStore(STORE).get("logo");
          rq.onsuccess = function () { res(rq.result instanceof Blob ? rq.result : null); db.close(); };
          rq.onerror = function () { res(null); db.close(); };
        });
      }).catch(function () { return null; });
    },
    set: function (blob) {
      return idb().then(function (db) {
        return new Promise(function (res) {
          var tx = db.transaction(STORE, "readwrite");
          if (blob) tx.objectStore(STORE).put(blob, "logo"); else tx.objectStore(STORE).delete("logo");
          tx.oncomplete = function () { db.close(); res(true); };
          tx.onerror = function () { db.close(); res(false); };
        });
      }).catch(function () { return false; });
    }
  };

  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  // create(root, {lang}) -> { paint(state, now), node }
  function create(root, opts) {
    var lang = (opts && opts.lang === "el") ? "el" : "en";
    var S = STR[lang];
    function tr(k, v) { var s = S[k]; if (v) Object.keys(v).forEach(function (x) { s = s.split("{" + x + "}").join(v[x]); }); return s; }

    var wrap = el("div", "sv", root);
    var logoImg = el("img", "sv-logo", wrap);
    logoImg.alt = ""; logoImg.hidden = true;
    var top = el("div", "sv-top", wrap);
    var title = el("div", "sv-title", top);
    var spk = el("div", "sv-spk", top);
    var time = el("div", "sv-time", wrap);
    var prog = el("div", "sv-prog", wrap);
    var bar = el("span", "", prog);
    var msg = el("div", "sv-msg", wrap);
    msg.setAttribute("role", "status");
    msg.setAttribute("aria-live", "polite");
    var agenda = el("ol", "sv-agenda", wrap);
    var bottom = el("div", "sv-bottom", wrap);
    var next = el("div", "sv-next", bottom);
    var clock = el("div", "sv-clock", bottom);
    var black = el("div", "sv-blackout", wrap);
    black.hidden = true;

    var logoAt = -1, logoUrl = null, agendaKey = "";
    function loadLogo(at) {
      logoAt = at;
      logo.get().then(function (b) {
        if (logoUrl) { URL.revokeObjectURL(logoUrl); logoUrl = null; }
        if (b) { logoUrl = URL.createObjectURL(b); logoImg.src = logoUrl; logoImg.hidden = false; }
        else { logoImg.removeAttribute("src"); logoImg.hidden = true; }
      });
    }

    function paint(st, now) {
      var show = st.show, run = st.run, data = st.data;
      if (show.logoAt !== logoAt) loadLogo(show.logoAt);
      wrap.className = "sv layout-" + show.layout + (show.mirror ? " mirror" : "");
      black.hidden = !show.black;

      var ev = null;
      for (var i = 0; i < data.events.length; i++) if (data.events[i].id === run.ev) ev = data.events[i];
      var list = ev ? C.rundown(data, ev.id) : [];
      var sch = ev ? C.schedule(ev, list, run, now) : { rows: [] };
      var it = ev ? C.focus(list, sch, run) : null;
      var tv = it ? C.timer(it, ev, run, now) : null;

      title.textContent = it ? it.title : (ev && list.length ? tr("done") : tr("waiting"));
      spk.textContent = it ? it.speaker : "";
      var tx;
      if (!it || !tv) tx = "--:--";
      else if (it.kind === "clock") {
        var d = new Date(now);
        tx = C.hm(now) + ":" + (d.getSeconds() < 10 ? "0" : "") + d.getSeconds();
      } else tx = it.kind === "up" ? C.fmt(tv.shown, true) : C.fmt(tv.shown);
      time.textContent = tx;
      time.className = "sv-time ph-" + (tv ? tv.phase : "idle") + (tx.length > 6 ? " long" : "") +
        (tv && tv.paused ? " paused" : "");
      wrap.classList.toggle("flash", !!(tv && tv.phase === "over" && ev && ev.flash));
      bar.style.width = tv ? Math.round(tv.progress * 1000) / 10 + "%" : "0%";
      bar.className = tv ? "ph-" + tv.phase : "";

      var idx = it ? list.indexOf(it) : -1;
      var nx = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
      next.textContent = it ? (nx ? tr("nextup", { t: nx.title + (nx.speaker ? " — " + nx.speaker : "") }) : tr("last")) : "";
      clock.textContent = C.hm(now);

      msg.textContent = show.msg.on ? show.msg.text : "";
      msg.hidden = !show.msg.on;
      msg.className = "sv-msg c-" + show.msg.color + (show.msg.flash ? " blink" : "");

      // agenda: rebuilt only when something in it changes
      if (show.layout === "agenda") {
        var key = JSON.stringify([list.map(function (x) { return [x.id, x.title, x.speaker]; }),
          sch.rows.map(function (r) { return [r.state, r.planStart || r.expStart]; }), run.cur]);
        if (key !== agendaKey) {
          agendaKey = key;
          agenda.textContent = "";
          list.forEach(function (x, k) {
            var r = sch.rows[k];
            var li = el("li", "st-" + r.state + (it && x.id === it.id ? " cur" : ""), agenda);
            var at = r.planStart !== null ? r.planStart : r.expStart;
            el("span", "sv-a-at", li).textContent = at !== null ? C.hm(at) : "";
            var b = el("span", "sv-a-t", li);
            b.textContent = x.title + (x.speaker ? " — " + x.speaker : "");
          });
        }
      }
      agenda.hidden = show.layout !== "agenda";
    }
    return { paint: paint, node: wrap };
  }

  window.OrosStageView = { create: create, readState: readState, logo: logo };
})();
