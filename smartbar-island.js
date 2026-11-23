// ============================================================
// orOS — smartbar-island.js (the top bar's island, ISLAND-1 v1.0.0)
// ------------------------------------------------------------
// Loaded by smartbar.js only when Settings › Appearance › Top bar ›
// Island is on and the window is wide enough (video ideas 2026-11-23
// #20). smartbar.js owns #sb-island and puts the live pills (timer,
// stopwatch, recording) in it; this file paints the media part:
//   • collapsed: a thin line with the line being sung now (Music's
//     synced lyrics, when the song has them on this device) or the
//     title, with a small light while it plays;
//   • open (hover with a mouse, tap, or Enter on the line): the cover,
//     title and artist, the progress with time played and time left,
//     Previous / Play-Pause / Next and "Open <app>" (the lyric line
//     stays on top).
// It closes again when the pointer leaves, on Escape, on a tap outside
// and when the bar locks. Sensitive work shows only the app's name: no
// title, no lyric, no cover. A locked app's player never reaches it
// (the shell's media() leaves it out). Data goes in with textContent;
// the icons are smartbar.js's own static SVG. Nothing is stored.
// Pure part unit-tested in node (tests/island.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var KEEP_MS = 30000;          // a paused player stays this long, then the island lets go
  var CLOSE_MS = 350;           // the pointer may leave this long before it closes

  // ---------- Model (pure) ----------
  // Which player to show: the one playing (the one shown before wins
  // when several play), else the one shown before while it paused less
  // than KEEP_MS ago, or while the island is open. → item | null
  function pick(list, shownId, lastPlay, now, open) {
    var a = (Array.isArray(list) ? list : []).filter(function (x) { return x && typeof x === "object"; });
    var prev = null, playing = null;
    a.forEach(function (x) {
      if (shownId && x.id === shownId) prev = x;
      if (x.playing && !playing) playing = x;
    });
    if (prev && prev.playing) return prev;
    if (playing) return playing;
    if (prev && (open || (now - (lastPlay || 0)) < KEEP_MS)) return prev;
    return null;
  }
  // Seconds → "m:ss" (or "h:mm:ss").
  function fmt(sec) {
    sec = Math.max(0, Math.floor(+sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  // → { pct, at: "1:02", left: "-2:38" } | null (live streams and unknown lengths)
  function prog(m) {
    var dur = +(m && m.dur) || 0, pos = Math.min(dur, Math.max(0, +(m && m.pos) || 0));
    if (!m || m.live || !isFinite(dur) || dur <= 0) return null;
    return { pct: Math.round(pos / dur * 1000) / 10, at: fmt(pos), left: "-" + fmt(dur - pos) };
  }
  // The title and the artist from the shell's "title · artist".
  function parts(m) {
    var p = String((m && m.title) || "").split(" · ");
    return { what: p[0] || "", sub: p.slice(1).join(" · ") };
  }
  // The collapsed line: the lyric line (♪ between lines), else the title.
  // lyric: string (a line, "" between lines) | null (no synced lyrics).
  function line(m, lyric, strict) {
    if (!m) return "";
    if (strict) return String(m.name || "");
    if (typeof lyric === "string") return lyric.trim() || "♪";
    var p = parts(m);
    return [p.what, p.sub].filter(Boolean).join(" · ") || String(m.name || "");
  }
  var model = { VER: VER, KEEP_MS: KEEP_MS, pick: pick, fmt: fmt, prog: prog, parts: parts, line: line };

  // ---------- The island (browser) ----------
  function make(kit) {
    var t = kit.t, call = kit.call, el = kit.el, ic = kit.icons || {};
    var doc = root.document;
    var holder = null, wrap = null, btn = null, dot = null, txt = null, panel = null;
    var shownId = "", lastPlay = 0, open = false, openedAt = 0, closeT = 0, cur = null, key = "", pg = null;
    function host() { return kit.host(); }
    function strict() { return !!kit.strict(); }

    function build() {
      wrap = el("div", "sbi-media");
      btn = el("button", "sbi-line");
      btn.type = "button";
      btn.setAttribute("aria-expanded", "false");
      dot = el("span", "sbi-dot");
      dot.setAttribute("aria-hidden", "true");
      txt = el("span", "sbi-txt");
      btn.appendChild(dot);
      btn.appendChild(txt);
      // A click right after the hover opened it keeps it open.
      btn.addEventListener("click", function (e) { e.stopPropagation(); setOpen(!open || Date.now() - openedAt < 500); });
      wrap.appendChild(btn);
      panel = el("div", "sbi-panel");
      panel.id = "sbi-panel";
      panel.hidden = true;
      panel.setAttribute("role", "group");
      btn.setAttribute("aria-controls", "sbi-panel");
      wrap.appendChild(panel);
    }
    function onEnter() { clearTimeout(closeT); if (cur && hoverable()) setOpen(true); }
    function onLeave() {
      clearTimeout(closeT);
      if (!hoverable() || (holder && holder.contains(doc.activeElement))) return;
      closeT = setTimeout(function () { setOpen(false); }, CLOSE_MS);
    }
    function onKey(e) { if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); if (btn) btn.focus(); } }
    function onDown(e) { if (open && holder && !holder.contains(e.target)) setOpen(false); }
    function hoverable() { return !!(root.matchMedia && root.matchMedia("(hover: hover)").matches); }
    function setOpen(on) {
      on = !!on && !!cur;
      if (on === open) return;
      open = on;
      if (on) openedAt = Date.now();
      if (holder) holder.classList.toggle("open", on);
      btn.setAttribute("aria-expanded", on ? "true" : "false");
      panel.hidden = !on;
      key = "";
      if (on) {
        doc.addEventListener("keydown", onKey, true);
        doc.addEventListener("mousedown", onDown, true);
        doc.addEventListener("touchstart", onDown, true);
      } else {
        doc.removeEventListener("keydown", onKey, true);
        doc.removeEventListener("mousedown", onDown, true);
        doc.removeEventListener("touchstart", onDown, true);
      }
      paint(Date.now());
    }
    function lyricOf(m) {
      if (!m || strict()) return null;
      var h = host(), v = call(function () { return h && typeof h.lyric === "function" ? h.lyric(m.id) : null; });
      return typeof v === "string" ? v : null;
    }
    function artOf(m) {
      if (!m || strict()) return "";
      var h = host();
      return call(function () { return h && typeof h.art === "function" ? h.art(m.title) : ""; }) || "";
    }
    function cbtn(cls, icon, label, fn) {
      var b = el("button", "sbi-b " + cls);
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.innerHTML = icon;                                   // static SVG from smartbar.js
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        call(fn);
        setTimeout(function () { key = ""; paint(Date.now()); var f = panel.querySelector("." + cls.split(" ")[0]); if (f) f.focus(); }, 250);
      });
      return b;
    }
    function fillPanel(m, st) {
      panel.textContent = "";
      pg = null;
      panel.setAttribute("aria-label", t("sb.k.playing") + " · " + m.name);
      var top = el("div", "sbi-top");
      var src = artOf(m);
      if (src) {
        var img = el("img", "sbi-cover");
        img.alt = "";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        img.src = src;                                       // blob:, data:image or https (the shell checks)
        top.appendChild(img);
      }
      var p = parts(m), tx = el("div", "sbi-tx");
      tx.appendChild(el("b", "sbi-t", st ? m.name : (p.what || m.name)));
      tx.appendChild(el("small", "sbi-a", st ? "" : [p.sub, m.name].filter(Boolean).join(" · ")));
      top.appendChild(tx);
      panel.appendChild(top);
      var g = prog(m);
      if (g) {
        var bar = el("div", "sbi-prog");
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        var fill = el("span");
        bar.appendChild(fill);
        panel.appendChild(bar);
        var tm = el("div", "sbi-time"), at = el("span"), left = el("span");
        tm.appendChild(at);
        tm.appendChild(left);
        panel.appendChild(tm);
        pg = { bar: bar, fill: fill, at: at, left: left };
        paintProg(m);
      }
      var ctl = el("div", "sbi-ctl");
      if (typeof m.prev === "function") ctl.appendChild(cbtn("sbi-prev", ic.prev, t("wg.media.prev") + " · " + m.name, function () { m.prev(); }));
      ctl.appendChild(cbtn("sbi-play", m.playing ? ic.pause : ic.play, t(m.playing ? "qs.pause" : "qs.play") + " · " + m.name, function () { m.toggle(); }));
      if (typeof m.next === "function") ctl.appendChild(cbtn("sbi-next", ic.next, t("wg.media.next") + " · " + m.name, function () { m.next(); }));
      panel.appendChild(ctl);
      var o = el("button", "sbi-open", t("pk.open").replace("{app}", m.name));
      o.type = "button";
      o.addEventListener("click", function (e) { e.stopPropagation(); setOpen(false); call(function () { m.open(); }); });
      panel.appendChild(o);
    }
    // The progress changes every second: only its numbers are painted
    // again, so the buttons under the pointer stay the same.
    function paintProg(m) {
      var g = prog(m);
      if (!pg || !g) return;
      pg.fill.style.width = g.pct + "%";
      pg.bar.setAttribute("aria-valuenow", String(Math.round(g.pct)));
      pg.bar.setAttribute("aria-valuetext", t("sbi.pos").replace("{a}", g.at).replace("{b}", fmt(m.dur)));
      if (pg.at.textContent !== g.at) pg.at.textContent = g.at;
      if (pg.left.textContent !== g.left) pg.left.textContent = g.left;
    }
    // → true when the media part shows.
    function paint(now) {
      if (!wrap) return false;
      var h = host(), list = call(function () { return h.media(); }) || [];
      var m = pick(list, shownId, lastPlay, now, open);
      if (m && m.playing) lastPlay = now;
      cur = m;
      if (!m) {
        shownId = "";
        if (open) setOpen(false);
        wrap.hidden = true;
        return false;
      }
      shownId = m.id;
      wrap.hidden = false;
      var st = strict(), lyric = lyricOf(m);
      var ln = line(m, lyric, st);
      if (txt.textContent !== ln) txt.textContent = ln;
      btn.setAttribute("aria-label", t("sb.k.playing") + ": " + ln);
      dot.classList.toggle("on", !!m.playing);
      if (open) {
        var k = [m.id, m.title, m.playing, st, !!prog(m), artOf(m)].join("|");
        if (k !== key) {
          var had = panel.contains(doc.activeElement) ? doc.activeElement.className : "";
          key = k;
          fillPanel(m, st);
          if (had) { var f = panel.querySelector("." + String(had).split(" ").filter(function (c) { return c !== "sbi-b"; })[0]); if (f) f.focus(); }
        } else paintProg(m);
      }
      return true;
    }
    function mount(h) {
      if (!wrap) build();
      if (holder === h) return;
      if (holder) { holder.removeEventListener("mouseenter", onEnter); holder.removeEventListener("mouseleave", onLeave); }
      holder = h;
      holder.appendChild(wrap);
      holder.addEventListener("mouseenter", onEnter);
      holder.addEventListener("mouseleave", onLeave);
      holder.setAttribute("role", "region");
      holder.setAttribute("aria-label", t("sbi.label"));
    }
    function close() { clearTimeout(closeT); if (open) setOpen(false); }
    return { mount: mount, paint: paint, close: close };
  }

  var api = { VER: VER, model: model, make: make };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.orosSmartBarIsland = api;
})(typeof window !== "undefined" ? window : this);
