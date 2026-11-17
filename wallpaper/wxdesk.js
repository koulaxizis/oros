// ============================================================
// orOS — wallpaper/wxdesk.js (weather on the desktop, v1.0.0, WX-DESK-1)
// ------------------------------------------------------------
// A shell component like seasonal.js: it runs IN the shell
// document, over the wallpaper and UNDER the desktop's icons
// (z-index -1 inside #oros-desktop) and never takes a click.
//
//   • Gentle weather from the shell's tray weather (the Weather
//     app's city, `oros-wx-cache`): sun or stars when it is clear, a
//     few clouds, overcast, fog, rain, snow, or a storm (heavier rain
//     under darker clouds; never a flash).
//   • OFF by default; a device-local switch (`oros-wxdesk` = "on"),
//     Settings › Wallpaper › Weather on the desktop. Nothing syncs.
//   • Weather older than 3 hours, or none yet, draws nothing.
//
// Performance (the seasonal.js rules): one canvas at
// devicePixelRatio ≤ 1.25, at most 30 frames a second, paused while
// an app is open or the tab is hidden. Reduced motion, a low battery
// (under 20 % and not charging, where the browser tells) or a frame
// rate that keeps dropping (mean frame > 55 ms) leave one still
// frame. Our own drawing only: no images, nothing from the net.
//
// Pure parts (Node, tests/wxdesk.test.js):
//   kindOf(code, night)        WMO code → sun|stars|part|cloud|fog|rain|snow|storm|""
//   plan(kind, w, h)           what a kind draws: { clouds, dark, drops, flakes, fog, sun, stars }
//   stillReason(o)             "reduced" | "battery" | "slow" | ""
//   fresh(c, now)              the cache is usable (code, at ≤ 3 h old)
//   isNight(hours)             h < 6 or h ≥ 21 (the tray's rule)
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var KEY = "oros-wxdesk";                // "on" | absent (device-local, never synced)
  var STALE_MS = 3 * 60 * 60 * 1000;

  // ---------- 1. Pure ----------
  function isNight(h) { return h < 6 || h >= 21; }

  // WMO codes: 0 clear · 1-2 partly · 3 overcast · 45/48 fog ·
  // 51-67 rain · 71-77 snow · 80-82 showers · 85/86 snow showers · 95+ storm
  function kindOf(code, night) {
    if (code === null || code === undefined || code === "") return "";
    var c = Number(code);
    if (!isFinite(c) || c < 0) return "";
    if (c === 0) return night ? "stars" : "sun";
    if (c === 1 || c === 2) return "part";
    if (c === 3) return "cloud";
    if (c === 45 || c === 48) return "fog";
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return "rain";
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
    if (c >= 95) return "storm";
    return "cloud";
  }

  // Counts scale with the area (1280×720 = 1), clamped.
  function plan(kind, w, h) {
    var a = Math.sqrt(Math.max(1, w * h) / (1280 * 720));
    function n(x, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(x * a))); }
    var p = { clouds: 0, dark: 0, drops: 0, flakes: 0, fog: 0, sun: false, stars: 0 };
    switch (kind) {
      case "sun":   p.sun = true; p.clouds = n(1, 1, 2); break;
      case "stars": p.stars = n(46, 16, 90); break;
      case "part":  p.clouds = n(3, 2, 5); break;
      case "cloud": p.clouds = n(6, 4, 10); p.dark = 0.06; break;
      case "fog":   p.fog = 4; p.dark = 0.04; break;
      case "rain":  p.clouds = n(6, 4, 10); p.dark = 0.1; p.drops = n(130, 50, 260); break;
      case "snow":  p.clouds = n(4, 3, 8); p.dark = 0.05; p.flakes = n(110, 40, 220); break;
      case "storm": p.clouds = n(8, 5, 12); p.dark = 0.2; p.drops = n(240, 90, 420); break;
      default: return null;
    }
    return p;
  }

  function stillReason(o) {
    o = o || {};
    if (o.reduced) return "reduced";
    if (o.battery) return "battery";
    if (o.slow) return "slow";
    return "";
  }

  function fresh(c, now) {
    return !!(c && typeof c === "object" && c.code !== undefined && c.code !== null &&
              typeof c.at === "number" && now - c.at >= 0 && now - c.at <= STALE_MS);
  }

  // Small seeded PRNG so a frame is the same for the same weather.
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  // ---------- 2. Browser ----------
  var host = null, layer = null, canvas = null, ctx = null;
  var shown = "", scene = null, raf = 0, lastTs = 0, ema = 33, slowFrames = 0;
  var lowBattery = false, slow = false, mqReduce = null, t0 = 0;

  function isOn() {
    try { return localStorage.getItem(KEY) === "on"; } catch (e) { return false; }
  }
  function reduced() { return !!(mqReduce && mqReduce.matches); }
  function running() { return !!(host && host.running && host.running()); }
  function why() { return stillReason({ reduced: reduced(), battery: lowBattery, slow: slow }); }

  function current() {
    if (!host || !isOn()) return "";
    var c = null;
    try { c = host.weather ? host.weather() : null; } catch (e) { c = null; }
    if (!fresh(c, Date.now())) return "";
    return kindOf(c.code, isNight(new Date().getHours()));
  }

  function size() {
    var w = root.innerWidth || 800, h = Math.max(100, (root.innerHeight || 600) - 40);
    return { w: w, h: h };
  }

  function clear() {
    stopLoop();
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layer = canvas = ctx = scene = null;
    shown = "";
  }

  function build(kind, w, h) {
    var p = plan(kind, w, h), r = rng(kind.length * 977 + Math.round(w) * 7 + Math.round(h));
    var s = { kind: kind, p: p, clouds: [], drops: [], flakes: [], fog: [], stars: [] };
    var i;
    for (i = 0; i < p.clouds; i++) {
      var cw = (0.18 + r() * 0.16) * Math.max(w, 600);
      var puffs = [];
      for (var k = 0; k < 5; k++) puffs.push({ dx: (k - 2) * cw * 0.17 + (r() - 0.5) * cw * 0.08, dy: (r() - 0.5) * cw * 0.08 - (k === 2 ? cw * 0.06 : 0), r: cw * (0.16 + r() * 0.1) });
      s.clouds.push({ x: r() * (w + cw) - cw / 2, y: (0.04 + r() * 0.34) * h, w: cw, v: 5 + r() * 7, puffs: puffs });
    }
    for (i = 0; i < p.drops; i++) s.drops.push({ x: r() * w, y: r() * h, l: 9 + r() * 10, v: 420 + r() * 220 });
    for (i = 0; i < p.flakes; i++) s.flakes.push({ x: r() * w, y: r() * h, r: 1 + r() * 1.8, v: 22 + r() * 34, ph: r() * 6.28 });
    for (i = 0; i < p.fog; i++) s.fog.push({ y: (0.2 + i * 0.2 + r() * 0.08) * h, x: r() * w, v: 4 + r() * 5, th: h * (0.1 + r() * 0.06) });
    for (i = 0; i < p.stars; i++) s.stars.push({ x: r() * w, y: r() * h * 0.7, r: 0.6 + r() * 1.1, ph: r() * 6.28 });
    return s;
  }

  function light() {
    try { return document.documentElement.getAttribute("data-theme") === "light"; } catch (e) { return false; }
  }

  function drawCloud(c, x, dark) {
    var lt = light();
    var col = dark > 0.12 ? (lt ? "70,78,92" : "120,128,145") : (lt ? "255,255,255" : "220,226,238");
    var al = dark > 0.12 ? 0.22 : (lt ? 0.34 : 0.16);
    for (var k = 0; k < c.puffs.length; k++) {
      var pf = c.puffs[k], cx = x + pf.dx, cy = c.y + pf.dy;
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, pf.r);
      g.addColorStop(0, "rgba(" + col + "," + al + ")");
      g.addColorStop(0.6, "rgba(" + col + "," + (al * 0.55) + ")");
      g.addColorStop(1, "rgba(" + col + ",0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, pf.r, 0, 6.2832); ctx.fill();
    }
  }

  function render(t, dt) {
    var sz = size(), w = sz.w, h = sz.h, s = scene, p = s.p, i;
    ctx.clearRect(0, 0, w, h);
    if (p.dark) { ctx.fillStyle = "rgba(10,14,26," + p.dark + ")"; ctx.fillRect(0, 0, w, h); }
    if (p.sun) {
      var sx = w * 0.86, sy = h * 0.1, R = Math.max(w, h) * 0.55;
      var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
      g.addColorStop(0, "rgba(255,226,160,.26)");
      g.addColorStop(0.35, "rgba(255,206,130,.09)");
      g.addColorStop(1, "rgba(255,200,120,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(t * 0.015);
      ctx.fillStyle = "rgba(255,236,190,.05)";
      for (i = 0; i < 9; i++) {
        ctx.rotate(6.2832 / 9);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R, -R * 0.07); ctx.lineTo(R, R * 0.07); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    for (i = 0; i < s.stars.length; i++) {
      var st = s.stars[i], a = 0.35 + 0.35 * Math.sin(st.ph + t * 0.8);
      ctx.fillStyle = "rgba(235,240,255," + a.toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.2832); ctx.fill();
    }
    for (i = 0; i < s.fog.length; i++) {
      var f = s.fog[i];
      f.x = (f.x + f.v * dt) % (w * 2);
      var fg = ctx.createLinearGradient(0, f.y - f.th, 0, f.y + f.th);
      var fc = light() ? "255,255,255" : "205,212,225";
      fg.addColorStop(0, "rgba(" + fc + ",0)"); fg.addColorStop(0.5, "rgba(" + fc + ",.13)"); fg.addColorStop(1, "rgba(" + fc + ",0)");
      ctx.fillStyle = fg;
      ctx.save(); ctx.translate(f.x - w, 0);
      ctx.fillRect(0, f.y - f.th, w * 2, f.th * 2);
      ctx.restore();
    }
    for (i = 0; i < s.clouds.length; i++) {
      var c = s.clouds[i];
      c.x += c.v * dt;
      if (c.x - c.w > w) c.x = -c.w;
      drawCloud(c, c.x, p.dark);
    }
    if (s.drops.length) {
      ctx.strokeStyle = light() ? "rgba(60,80,110,.32)" : "rgba(200,215,235,.34)";
      ctx.lineWidth = 1; ctx.lineCap = "round";
      ctx.beginPath();
      for (i = 0; i < s.drops.length; i++) {
        var d = s.drops[i];
        d.y += d.v * dt; d.x += d.v * dt * 0.16;
        if (d.y > h) { d.y = -d.l; d.x = (d.x * 7.31) % w; }
        if (d.x > w) d.x -= w;
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.16, d.y - d.l);
      }
      ctx.stroke();
    }
    if (s.flakes.length) {
      ctx.fillStyle = light() ? "rgba(255,255,255,.9)" : "rgba(240,244,252,.75)";
      for (i = 0; i < s.flakes.length; i++) {
        var fl = s.flakes[i];
        fl.y += fl.v * dt;
        var fx = fl.x + Math.sin(fl.ph + t * 0.9) * 8;
        if (fl.y > h + 3) fl.y = -3;
        ctx.beginPath(); ctx.arc(fx, fl.y, fl.r, 0, 6.2832); ctx.fill();
      }
    }
  }

  function paint() {
    var desk = host && host.desktop;
    if (!desk) return;
    var kind = current();
    if (!kind) { clear(); return; }
    var sz = size(), still = !!why();
    var key = [kind, sz.w, sz.h, still ? 1 : 0, light() ? "l" : "d"].join("|");
    if (key === shown && layer && layer.parentNode === desk) { syncLoop(); return; }
    clear();
    shown = key;
    layer = document.createElement("div");
    layer.id = "wxd-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.setAttribute("data-kind", kind);
    canvas = document.createElement("canvas");
    var dpr = Math.min(1.25, root.devicePixelRatio || 1);
    canvas.width = Math.round(sz.w * dpr);
    canvas.height = Math.round(sz.h * dpr);
    ctx = canvas.getContext("2d");
    if (!ctx) { canvas = null; return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layer.appendChild(canvas);
    desk.appendChild(layer);
    scene = build(kind, sz.w, sz.h);
    render(0, 0);                     // the first (or the only, when still) frame
    if (still) layer.setAttribute("data-still", why());
    syncLoop();
  }

  function shouldRun() {
    return !!(ctx && scene && layer && !why() && !running() && !document.hidden);
  }
  function stopLoop() { if (raf) { root.cancelAnimationFrame(raf); raf = 0; } }
  function syncLoop() {
    if (shouldRun()) { if (!raf) { lastTs = 0; raf = root.requestAnimationFrame(frame); } }
    else stopLoop();
  }
  function frame(ts) {
    raf = 0;
    if (!shouldRun()) return;
    if (lastTs && ts - lastTs < 31) { raf = root.requestAnimationFrame(frame); return; }   // ≤ 30 fps
    var gap = lastTs ? ts - lastTs : 33;
    lastTs = ts;
    if (!t0) t0 = ts;
    ema = ema * 0.95 + Math.min(gap, 250) * 0.05;
    if (ema > 55) {
      if (++slowFrames > 90) { slow = true; shown = ""; update(); return; }   // still for this session
    } else slowFrames = 0;
    render((ts - t0) / 1000, Math.min(gap, 100) / 1000);
    raf = root.requestAnimationFrame(frame);
  }

  var CSS =
    "#wxd-layer{position:fixed;top:calc(40px + env(safe-area-inset-top,0px));left:0;width:100vw;" +
    "height:calc(100vh - 40px - env(safe-area-inset-top,0px));height:calc(100dvh - 40px - env(safe-area-inset-top,0px));" +
    "z-index:-1;pointer-events:none;overflow:hidden}" +
    "#wxd-layer canvas{position:absolute;inset:0;width:100%;height:100%}" +
    "html[data-oros-contrast=\"high\"] #wxd-layer{display:none}";

  function injectCss() {
    if (document.getElementById("wxd-css")) return;
    var st = document.createElement("style");
    st.id = "wxd-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function update() { if (host) paint(); }

  function setOn(on) {
    try { if (on) localStorage.setItem(KEY, "on"); else localStorage.removeItem(KEY); } catch (e) {}
    slow = false; ema = 33; slowFrames = 0;     // a new choice gives a slow device another try
    shown = ""; update();
    return true;
  }

  function snapshot() {
    var c = null;
    try { c = host && host.weather ? host.weather() : null; } catch (e) {}
    var ok = fresh(c, Date.now());
    return { on: isOn(), kind: ok ? kindOf(c.code, isNight(new Date().getHours())) : "", none: !ok, still: why() };
  }

  var tick = null, resizeT = null;
  function attach(h) {
    if (host || !h || !h.desktop) return;
    host = h;
    injectCss();
    try { mqReduce = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null; } catch (e) {}
    if (mqReduce && mqReduce.addEventListener) mqReduce.addEventListener("change", function () { shown = ""; update(); });
    var nav = root.navigator || {};
    if (typeof nav.getBattery === "function") {
      nav.getBattery().then(function (b) {
        function chk() {
          var low = !b.charging && b.level < 0.2;
          if (low !== lowBattery) { lowBattery = low; shown = ""; update(); }
        }
        b.addEventListener("levelchange", chk);
        b.addEventListener("chargingchange", chk);
        chk();
      }).catch(function () {});
    }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) update(); else stopLoop(); });
    root.addEventListener("resize", function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () { shown = ""; update(); }, 250);
    });
    // The weather and the night change on their own.
    tick = setInterval(function () { if (!document.hidden) update(); }, 60000);
    update();
  }

  var api = {
    VER: VER, KEY: KEY,
    kindOf: kindOf, plan: plan, stillReason: stillReason, fresh: fresh, isNight: isNight,
    attach: attach,
    refresh: function () { if (host) update(); },
    set: setOn,
    snapshot: snapshot
  };
  root.orosWxDesk = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
