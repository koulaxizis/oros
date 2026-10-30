// ============================================================
// orOS — qsettings.js (Quick settings, GNOME style, v1.0.0)
// ------------------------------------------------------------
// A shell component, like osk.js and quickmenu.js: it runs IN the
// shell document. shell.js calls attach() once at boot (also in a
// single app) and refresh() when the language changes. A bundle
// without this file draws exactly what it drew before.
//
//   • A status button at the right end of the top bar (#qs-btn):
//     network (online / offline), a crossed bell while Do Not
//     Disturb is on, the battery when the device has one and runs
//     on it, and the power symbol. One click opens the panel, as the
//     system menu of GNOME does. Ctrl+Alt+Shift+M too (SC_DEFS).
//   • The panel (#qs-panel, a non-modal dialog under the bar):
//       top row   battery · language · Settings · Lock (when the
//                 screen lock is on) · Power (Restart orOS, and the
//                 computer's own Restart / Shut down on orOS USB);
//       #qs-sys   empty here; the orOS USB system extension fills it
//                 with the volume and brightness sliders and the
//                 Wi-Fi and Bluetooth buttons (see "System part");
//       buttons   GNOME's rounded toggles in two columns: Network
//                 (status), Sync (tap = sync now, › = Settings),
//                 Dark style, Do Not Disturb (› = for one hour, until
//                 tomorrow morning, until I turn it off), Large text,
//                 High contrast, On-screen keyboard (not on phones);
//       playing   one row per sound that plays in the shell (Music,
//                 Podcasts, Radio, Sound Mixer) with Play / Pause.
//     Every switch goes through the shell's own setter (theme,
//     accessibility, language) or the module that owns it (DND in
//     notifications.js, the keyboard in osk.js, the lock in lock.js),
//     so the panel stores nothing of its own and Settings stays the
//     one full place for each of them.
//   • Closes on Escape, a click outside, the shell losing the focus
//     (a click in an app) and on any action that opens something.
//     Phones (≤ 480 px): the panel is the full width under the bar.
//
// System part (orOS USB, oros-usb system/extension/content.js):
//   The extension's content script shares this document. The panel
//   dispatches the DOM event "oros-qs" on document with detail
//   "open" or "close" (a string: it crosses the extension's isolated
//   world). The extension then fills #qs-sys (sliders .qs-slider),
//   #qs-sys-pills (.qs-pill buttons, first in the grid) and
//   #qs-power-sys (menu buttons .qs-menu-item), with this file's
//   classes. It sets
//   <html data-oros-qs-sys="1"> so the shell's own Network button
//   steps aside for its Wi-Fi button. It only answers these events and
//   never opens the panel itself. Nothing here depends on it; an
//   older stick keeps its own System button.
//
// Pure logic (DND times, labels, the battery rule) is unit-tested in
// node (tests/qsettings.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var HOUR = 3600000;

  // ---------- 1. Model (pure) ----------
  // Do Not Disturb, as notifications.js stores it (device-local
  // "oros-dnd"): "on" = until turned off, a number = until that ms.
  function dndUntil(choice, now) {
    if (choice === "hour") return now + HOUR;
    if (choice === "morning") {
      var d = new Date(now);
      d.setHours(8, 0, 0, 0);
      if (d.getTime() <= now) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    return "on";
  }
  // The second line of the DND button: "" when off, else until when.
  function dndSub(dnd, now, fmtTime, t) {
    if (!dnd || !dnd.on) return "";
    if (!dnd.until) return t("qs.dnd.untiloff");
    var d = new Date(dnd.until), n = new Date(now);
    var same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    return t(same ? "qs.dnd.until" : "qs.dnd.untiltomorrow").replace("{t}", fmtTime(d));
  }
  // Sync state from the shell (autoSyncDot's words) → string key.
  var SYNC_KEYS = { off: "qs.sync.off", locked: "qs.sync.locked", dirty: "qs.sync.dirty",
                    idle: "qs.sync.idle", syncing: "qs.sync.working", synced: "qs.sync.idle",
                    err: "qs.sync.error" };
  function syncKey(s) { return SYNC_KEYS[s] || "qs.sync.off"; }
  // A battery is worth showing when the device runs on it, or is not
  // full yet. A desktop reports "charging, 100 %" forever: nothing.
  function batteryShown(b) {
    if (!b || typeof b.level !== "number" || !isFinite(b.level)) return false;
    return !b.charging || b.level < 0.995;
  }
  function batteryPct(b) { return Math.round(Math.max(0, Math.min(1, b.level)) * 100); }
  // orOS USB's extension reports the battery as "<percent>:<1|0>" on
  // <html data-oros-sys-battery> (Linux Chromium's own needs UPower).
  function batteryAttr(v) {
    var m = /^(\d{1,3}):([01])$/.exec(v || "");
    if (!m) return null;
    return { level: Math.min(100, Number(m[1])) / 100, charging: m[2] === "1" };
  }
  // Text on the accent colour: black or white, whichever reads better
  // (skins' accents run from pale gold to deep green). "" when unknown.
  function onAccent(css) {
    var v = String(css || "").trim(), r, g, b, m;
    if ((m = /^#([0-9a-f]{3})$/i.exec(v))) v = "#" + m[1].replace(/(.)/g, "$1$1");
    if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(v))) {
      r = parseInt(m[1], 16); g = parseInt(m[2], 16); b = parseInt(m[3], 16);
    } else if ((m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(v))) {
      r = +m[1]; g = +m[2]; b = +m[3];
    } else return "";
    var lin = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    var L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#000" : "#fff";
  }
  // Large text: on from 130 % up to the largest; off = 100 %.
  function bigOn(size) { return size >= 130; }

  var model = { VER: VER, dndUntil: dndUntil, dndSub: dndSub, syncKey: syncKey,
                batteryShown: batteryShown, batteryPct: batteryPct, batteryAttr: batteryAttr, bigOn: bigOn, onAccent: onAccent };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 2. Shell side ----------
  var doc = document;
  var host = null, btn = null, panel = null, sub = "", battery = null;
  var lastFocus = null;

  function t(k) { return typeof root.t === "function" ? root.t(k) : k; }
  function fmtTime(d) {
    try {
      var loc = root.orosI18n ? root.orosI18n.locale(host.lang()) : undefined;
      return d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch (e) { return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  }
  function call(fn) { try { return fn(); } catch (e) { return undefined; } }

  var CSS = [
    "#qs-btn { display: inline-flex; align-items: center; gap: 5px; min-height: 40px; padding: 0 9px; margin-left: 2px;",
    "  background: transparent; border: none; border-radius: 999px; color: var(--text); cursor: pointer; font: inherit; font-size: 13px; }",
    "#qs-btn:hover, #qs-btn:focus-visible, #qs-btn[aria-expanded=\"true\"] { background: var(--accent-soft); outline: none; }",
    "#qs-btn svg { width: 16px; height: 16px; flex: none; }",
    "#qs-btn .qs-off { opacity: .55; }",
    "#oros-bar.bar-tight #qs-btn { padding: 0 6px; gap: 3px; }",
    "#qs-panel { position: fixed; z-index: 1200; top: calc(46px + env(safe-area-inset-top, 0px)); right: 8px; width: 368px;",
    "  max-height: calc(100dvh - 60px - env(safe-area-inset-top, 0px)); overflow: auto; box-sizing: border-box; padding: 14px;",
    "  background: var(--panel-bg, var(--bar-bg)); color: var(--text); border: 1px solid var(--border); border-radius: 22px;",
    "  box-shadow: 0 10px 34px var(--shadow, rgba(0,0,0,.4)); font-size: 14px; }",
    "#qs-panel [hidden] { display: none !important; }",
    ".qs-top { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }",
    ".qs-top .qs-grow { flex: 1; min-width: 0; }",
    ".qs-batt { display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; height: 40px; border-radius: 999px;",
    "  background: var(--accent-soft); font-size: 13px; white-space: nowrap; }",
    ".qs-round { width: 44px; height: 44px; flex: none; display: inline-flex; align-items: center; justify-content: center;",
    "  border-radius: 50%; border: none; background: var(--accent-soft); color: var(--text); cursor: pointer; font: inherit; font-size: 13px; font-weight: 700; }",
    ".qs-round:hover, .qs-round:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }",
    ".qs-round[aria-expanded=\"true\"] { background: var(--accent); color: var(--qs-on, #fff); }",
    ".qs-round svg, .qs-pill svg, .qs-slider svg, .qs-media svg, .qs-batt svg { width: 18px; height: 18px; flex: none; }",
    ".qs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0 0 10px; }",
    ".qs-pill { display: flex; align-items: stretch; min-height: 52px; border-radius: 999px; overflow: hidden;",
    "  background: var(--accent-soft); color: var(--text); }",
    ".qs-pill.on { background: var(--accent); color: var(--qs-on, #fff); }",
    ".qs-pill > button { border: none; background: transparent; color: inherit; font: inherit; cursor: pointer; }",
    ".qs-pill > button:focus-visible { outline: 2px solid var(--text); outline-offset: -3px; border-radius: 999px; }",
    ".qs-pill-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 16px; text-align: left; }",
    ".qs-pill-main:hover, .qs-pill-more:hover { background: rgba(127,127,127,.16); }",
    ".qs-pill-text { min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }",
    // A long name (Greek, German) takes two lines instead of an ellipsis.
    ".qs-pill-text b { font-weight: 700; font-size: 13.5px; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical;",
    "  -webkit-line-clamp: 2; overflow-wrap: anywhere; hyphens: auto; }",
    ".qs-pill-text small { font-size: 12px; opacity: .8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".qs-pill-more { width: 40px; flex: none; display: inline-flex; align-items: center; justify-content: center;",
    "  border-left: 1px solid rgba(127,127,127,.25) !important; }",
    ".qs-pill.qs-static .qs-pill-main { cursor: default; }",
    ".qs-pill.qs-static .qs-pill-main:hover { background: transparent; }",
    ".qs-slider { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; }",
    ".qs-slider > button { width: 40px; height: 40px; flex: none; border-radius: 50%; border: none; background: transparent;",
    "  color: var(--text); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }",
    ".qs-slider > button:hover { background: var(--accent-soft); }",
    ".qs-slider input[type=range] { flex: 1; min-width: 0; accent-color: var(--accent); height: 28px; }",
    ".qs-menu { margin: -2px 0 12px; padding: 8px; border-radius: 16px; background: var(--accent-soft); }",
    ".qs-menu h3 { margin: 4px 8px 6px; font-size: 13px; font-weight: 700; }",
    ".qs-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 0 12px; box-sizing: border-box;",
    "  border: none; border-radius: 10px; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }",
    ".qs-menu-item:hover, .qs-menu-item:focus-visible { background: rgba(127,127,127,.18); outline: none; }",
    ".qs-menu-item svg { width: 18px; height: 18px; flex: none; }",
    "#qs-sys-pills { display: contents; }",
    ".qs-media { display: flex; flex-direction: column; gap: 8px; }",
    ".qs-media-row { display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 14px; border-radius: 16px; background: var(--accent-soft); }",
    ".qs-media-open { flex: 1; min-width: 0; border: none; background: transparent; color: var(--text); font: inherit; text-align: left;",
    "  cursor: pointer; display: flex; flex-direction: column; line-height: 1.25; padding: 4px 0; }",
    ".qs-media-open b { font-size: 13px; }",
    ".qs-media-open small { font-size: 12px; opacity: .8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".qs-media-row .qs-round { width: 40px; height: 40px; background: var(--accent); color: var(--qs-on, #fff); }",
    "html[data-oros-contrast=\"high\"] .qs-pill, html[data-oros-contrast=\"high\"] .qs-round { outline: 1px solid var(--text); }",
    // Phones: last, so it wins over the rules above.
    "@media (max-width: 480px) { #qs-panel { left: 6px; right: 6px; width: auto; border-radius: 18px; padding: 12px; }",
    "  .qs-grid { gap: 8px; } .qs-pill-main { padding: 6px 2px 6px 11px; gap: 7px; } .qs-pill-more { width: 30px; }",
    "  .qs-pill-text b { font-size: 12px; } }"
  ].join("\n");

  // Static icons (never data).
  var SV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var IC = {
    net: SV + '<path d="M2 8.5a15 15 0 0 1 20 0"/><path d="M5 12a10.5 10.5 0 0 1 14 0"/><path d="M8.5 15.5a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>',
    netOff: SV + '<path d="M2 8.5a15 15 0 0 1 20 0" opacity=".35"/><path d="M5 12a10.5 10.5 0 0 1 14 0" opacity=".35"/><path d="M8.5 15.5a5.5 5.5 0 0 1 7 0" opacity=".35"/><path d="M3 3l18 18"/></svg>',
    power: SV + '<path d="M12 3v9"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/></svg>',
    gear: SV + '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    lock: SV + '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    sync: SV + '<path d="M21 12a9 9 0 0 1-15.4 6.4L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.4 5.6L21 8"/><path d="M21 3v5h-5"/></svg>',
    moon: SV + '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    bellOff: SV + '<path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M18.6 13A17.9 17.9 0 0 1 18 8"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.3-5"/><path d="M3 3l18 18"/></svg>',
    text: SV + '<path d="M4 7V5h11v2"/><path d="M9.5 5v14"/><path d="M7 19h5"/><path d="M14 13v-1.5h7V13"/><path d="M17.5 11.5V19"/><path d="M16 19h3"/></svg>',
    contrast: SV + '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
    keys: SV + '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>',
    more: SV + '<path d="M9 6l6 6-6 6"/></svg>',
    restart: SV + '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    music: SV + '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
  };
  function batteryIcon(b) {
    var w = Math.max(1, Math.round(batteryPct(b) / 100 * 12));
    return SV + '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/>' +
      '<rect x="4.5" y="9.5" width="' + w + '" height="5" rx="1" fill="currentColor" stroke="none"/>' +
      (b.charging ? '<path d="M11 8l-2 4h4l-2 4" stroke-width="1.6"/>' : '') + '</svg>';
  }

  function el(tag, cls, html) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (html) n.innerHTML = html;   // static icons only
    return n;
  }
  function button(cls, icon, label, fn) {
    var b = el("button", cls, icon || "");
    b.type = "button";
    if (label) { b.setAttribute("aria-label", label); b.title = label; }
    b.addEventListener("click", function (e) { e.stopPropagation(); fn(e); });
    return b;
  }

  // ---------- 3. Status button ----------
  function bat() {
    return batteryAttr(doc.documentElement.getAttribute("data-oros-sys-battery")) || battery;
  }

  function dnd() { return call(function () { return root.orosNotifs && root.orosNotifs.dnd ? root.orosNotifs.dnd() : null; }); }

  function paintBtn() {
    if (!btn) return;
    var online = navigator.onLine !== false;
    var d = dnd();
    var html = (online ? IC.net : IC.netOff);
    if (d && d.on) html += IC.bellOff;
    var b = bat();
    if (batteryShown(b)) html += batteryIcon(b) + '<span>' + batteryPct(b) + "%</span>";
    html += IC.power;
    if (btn.__qsHtml !== html) { btn.innerHTML = html; btn.__qsHtml = html; }
    var label = t("qs.title") + " · " + t(online ? "qs.net.on" : "qs.net.off") +
      (d && d.on ? " · " + t("qs.dnd") : "") +
      (batteryShown(b) ? " · " + t("qs.battery").replace("{p}", batteryPct(b)) : "");
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }

  function mountBtn() {
    var bar = doc.querySelector("#oros-bar .bar-right");
    if (!bar || btn) return;
    btn = doc.createElement("button");
    btn.id = "qs-btn";
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", function (e) { e.stopPropagation(); toggle(); });
    bar.appendChild(btn);
    paintBtn();
  }

  function watchBattery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then(function (b) {
      var up = function () { battery = { level: b.level, charging: b.charging }; paintBtn(); if (panel) paint(); };
      ["levelchange", "chargingchange"].forEach(function (ev) { b.addEventListener(ev, up); });
      up();
    }).catch(function () {});
  }

  // ---------- 4. Panel ----------
  function isOpen() { return !!panel; }
  function toggle() { if (panel) close(); else open(); }

  function onKey(e) {
    if (e.key === "Escape" && panel) { e.preventDefault(); close(true); }
  }
  function onDown(e) {
    if (!panel) return;
    if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
    // The USB extension's own panel opens from inside ours.
    var sys = doc.getElementById("oros-system-panel");
    if (sys && sys.contains(e.target)) return;
    close();
  }
  function onBlur() { setTimeout(function () { if (panel && !doc.hasFocus()) close(); }, 0); }

  function open() {
    if (panel || !host) return;
    lastFocus = doc.activeElement;
    sub = "";
    panel = el("div");
    panel.id = "qs-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t("qs.title"));
    doc.body.appendChild(panel);
    if (btn) btn.setAttribute("aria-expanded", "true");
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("mousedown", onDown, true);
    doc.addEventListener("touchstart", onDown, true);
    root.addEventListener("blur", onBlur);
    build();
    var first = panel.querySelector(".qs-pill-main, .qs-round");
    if (first) first.focus();
    fire("open");
  }

  function close(keepFocus) {
    if (!panel) return;
    panel.remove();
    panel = null;
    sub = "";
    if (btn) btn.setAttribute("aria-expanded", "false");
    doc.removeEventListener("keydown", onKey, true);
    doc.removeEventListener("mousedown", onDown, true);
    doc.removeEventListener("touchstart", onDown, true);
    root.removeEventListener("blur", onBlur);
    if (keepFocus && btn) btn.focus();
    else if (lastFocus && lastFocus.focus && doc.contains(lastFocus)) { try { lastFocus.focus(); } catch (e) {} }
    fire("close");
  }

  function fire(what) {
    try { doc.dispatchEvent(new CustomEvent("oros-qs", { detail: what })); } catch (e) {}
  }

  // An action that opens something else closes the panel first.
  function then(fn) { return function () { close(); fn(); }; }

  // Built once per opening; paint() refreshes the states, so a slider
  // the USB extension put in #qs-sys is never rebuilt under a finger.
  var parts = null;

  function build() {
    parts = {};
    var top = el("div", "qs-top");
    parts.batt = el("span", "qs-batt");
    parts.batt.setAttribute("role", "status");
    top.appendChild(parts.batt);
    top.appendChild(el("span", "qs-grow"));
    parts.lang = button("qs-round", "", "", function () { host.langToggle(); });
    top.appendChild(parts.lang);
    top.appendChild(button("qs-round", IC.gear, t("qs.settings"), then(function () { host.settings(""); })));
    parts.lock = button("qs-round", IC.lock, t("qs.lock"), then(function () { call(function () { root.orosLock.lock(); }); }));
    top.appendChild(parts.lock);
    parts.power = button("qs-round", IC.power, t("qs.power"), function () { setSub(sub === "power" ? "" : "power"); });
    parts.power.setAttribute("aria-expanded", "false");
    top.appendChild(parts.power);
    panel.appendChild(top);

    parts.powerMenu = el("div", "qs-menu");
    parts.powerMenu.setAttribute("role", "group");
    parts.powerMenu.setAttribute("aria-label", t("qs.power"));
    parts.powerMenu.appendChild(menuItem(IC.restart, t("qs.restart"), function () { close(); host.restart(); }));
    var sysPower = el("div");
    sysPower.id = "qs-power-sys";
    parts.powerMenu.appendChild(sysPower);
    panel.appendChild(parts.powerMenu);

    var sys = el("div");
    sys.id = "qs-sys";
    panel.appendChild(sys);

    var grid = el("div", "qs-grid");
    // The USB extension's Wi-Fi, Bluetooth and System buttons join the
    // same grid, first (display: contents).
    var sysPills = el("div");
    sysPills.id = "qs-sys-pills";
    grid.appendChild(sysPills);
    parts.net = pill(IC.net, null, null);
    parts.net.box.classList.add("qs-static");
    parts.net.main.setAttribute("aria-disabled", "true");
    parts.sync = pill(IC.sync, function () {
      var s = host.sync.state();
      if (s === "off" || s === "locked") { close(); host.settings("sync"); return; }
      host.sync.now();
      setTimeout(paint, 50);
    }, then(function () { host.settings("sync"); }), t("qs.sync.settings"));
    parts.dark = pill(IC.moon, function () { host.theme.set(host.theme.get() === "dark" ? "light" : "dark"); paint(); });
    parts.dnd = pill(IC.bellOff, function () {
      var d = dnd();
      setDnd(d && d.on ? false : "on");
    }, function () { setSub(sub === "dnd" ? "" : "dnd"); }, t("qs.dnd.more"));
    parts.big = pill(IC.text, function () {
      host.a11y.set("textSize", bigOn(host.a11y.get().size) ? 100 : 130); paint();
    });
    parts.contrast = pill(IC.contrast, function () {
      host.a11y.set("contrast", host.a11y.get().high ? "off" : "on"); paint();
    });
    parts.osk = pill(IC.keys, function () {
      var O = root.orosOsk;
      if (!O) return;
      if (O.isOpen()) O.hide(); else { close(); O.show(); }
      if (panel) paint();
    });
    [parts.net, parts.sync, parts.dark, parts.dnd, parts.big, parts.contrast, parts.osk].forEach(function (p) { grid.appendChild(p.box); });
    panel.appendChild(grid);

    parts.dndMenu = el("div", "qs-menu");
    parts.dndMenu.setAttribute("role", "group");
    parts.dndMenu.appendChild(el("h3")).textContent = t("qs.dnd");
    parts.dndItems = [["hour", "qs.dnd.hour"], ["morning", "qs.dnd.morning"], ["on", "qs.dnd.untiloff"]].map(function (c) {
      var it = menuItem("", t(c[1]), function () { setDnd(dndUntil(c[0], Date.now())); setSub(""); });
      parts.dndMenu.appendChild(it);
      return it;
    });
    parts.dndOff = menuItem("", t("qs.dnd.turnoff"), function () { setDnd(false); setSub(""); });
    parts.dndMenu.appendChild(parts.dndOff);
    panel.appendChild(parts.dndMenu);

    parts.media = el("div", "qs-media");
    parts.media.setAttribute("role", "group");
    parts.media.setAttribute("aria-label", t("qs.playing"));
    panel.appendChild(parts.media);
    paint();
  }

  function pill(icon, onMain, onMore, moreLabel) {
    var box = el("div", "qs-pill");
    var main = el("button", "qs-pill-main", icon);
    main.type = "button";
    var txt = el("span", "qs-pill-text");
    var b = el("b"), s = el("small");
    txt.appendChild(b); txt.appendChild(s);
    main.appendChild(txt);
    if (onMain) main.addEventListener("click", function (e) { e.stopPropagation(); onMain(); });
    box.appendChild(main);
    var more = null;
    if (onMore) {
      more = button("qs-pill-more", IC.more, moreLabel, onMore);
      box.appendChild(more);
    }
    return { box: box, main: main, title: b, sub: s, more: more };
  }
  function setPill(p, title, subText, on, toggleable) {
    if (p.title.textContent !== title) p.title.textContent = title;
    if (p.sub.textContent !== (subText || "")) p.sub.textContent = subText || "";
    p.sub.hidden = !subText;
    p.box.classList.toggle("on", !!on);
    if (toggleable) p.main.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function menuItem(icon, label, fn) {
    var b = button("qs-menu-item", icon, "", fn);
    b.appendChild(doc.createTextNode(label));
    return b;
  }
  function setSub(name) { sub = name; paint(); }

  function setDnd(v) {
    call(function () { root.orosNotifs.setDnd(v); });
    paintBtn();
    if (panel) paint();
  }

  function paint() {
    if (!panel || !parts) return;
    var now = Date.now();
    var on = onAccent(getComputedStyle(panel).getPropertyValue("--accent"));
    if (on) panel.style.setProperty("--qs-on", on);
    // Top row
    var b = bat();
    parts.batt.hidden = !batteryShown(b);
    if (batteryShown(b)) {
      parts.batt.innerHTML = batteryIcon(b);
      parts.batt.appendChild(doc.createTextNode(batteryPct(b) + "%" + (b.charging ? " · " + t("qs.charging") : "")));
    }
    var lang = host.langNext();
    parts.lang.textContent = lang.short;
    parts.lang.setAttribute("aria-label", lang.label);
    parts.lang.title = lang.label;
    parts.lock.hidden = !call(function () { return root.orosLock && root.orosLock.isOn(); });
    parts.power.setAttribute("aria-expanded", sub === "power" ? "true" : "false");
    parts.powerMenu.hidden = sub !== "power";

    // Buttons
    var online = navigator.onLine !== false;
    parts.net.box.hidden = doc.documentElement.getAttribute("data-oros-qs-sys") === "1";
    parts.net.main.innerHTML = online ? IC.net : IC.netOff;
    parts.net.main.appendChild(parts.net.title.parentNode);
    setPill(parts.net, t("qs.net"), t(online ? "qs.net.on" : "qs.net.off"), online, false);

    var s = host.sync.state();
    setPill(parts.sync, t("qs.sync"), t(syncKey(s)), s !== "off" && s !== "locked", false);
    parts.sync.main.setAttribute("aria-label", t("qs.sync") + ": " + t(syncKey(s)) +
      (s === "off" || s === "locked" ? "" : " · " + t("qs.sync.now")));

    setPill(parts.dark, t("qs.dark"), "", host.theme.get() === "dark", true);

    var d = dnd();
    parts.dnd.box.hidden = !d;
    if (d) setPill(parts.dnd, t("qs.dnd"), dndSub(d, now, fmtTime, t), d.on, true);
    parts.dndMenu.hidden = sub !== "dnd" || !d;
    if (parts.dnd.more) parts.dnd.more.setAttribute("aria-expanded", sub === "dnd" ? "true" : "false");
    parts.dndOff.hidden = !(d && d.on);

    var a = host.a11y.get();
    setPill(parts.big, t("qs.big"), "", bigOn(a.size), true);
    setPill(parts.contrast, t("qs.contrast"), "", a.high, true);

    var O = root.orosOsk;
    var oskOk = !!(O && call(function () { return O.snapshot && O.snapshot(); }));
    parts.osk.box.hidden = !oskOk;
    if (oskOk) setPill(parts.osk, t("qs.osk"), "", O.isOpen(), true);

    paintMedia();
  }

  function paintMedia() {
    var list = call(function () { return host.media(); }) || [];
    var key = JSON.stringify(list.map(function (m) { return [m.id, m.title, m.playing]; }));
    parts.media.hidden = !list.length;
    if (parts.media.__key === key) return;
    parts.media.__key = key;
    parts.media.textContent = "";
    list.forEach(function (m) {
      var row = el("div", "qs-media-row", IC.music);
      var openB = el("button", "qs-media-open");
      openB.type = "button";
      var b = el("b"), s = el("small");
      b.textContent = m.name;
      s.textContent = m.title || "";
      openB.appendChild(b); openB.appendChild(s);
      openB.addEventListener("click", function (e) { e.stopPropagation(); close(); m.open(); });
      row.appendChild(openB);
      row.appendChild(button("qs-round", m.playing ? IC.pause : IC.play,
        t(m.playing ? "qs.pause" : "qs.play") + " · " + m.name,
        function () { m.toggle(); setTimeout(function () { if (panel) paint(); }, 250); }));
      parts.media.appendChild(row);
    });
  }

  // ---------- 5. Attach ----------
  function injectCss() {
    if (doc.getElementById("qs-css")) return;
    var st = doc.createElement("style");
    st.id = "qs-css";
    st.textContent = CSS;
    doc.head.appendChild(st);
  }

  function attach(h) {
    if (host) return;
    host = h || {};
    injectCss();
    mountBtn();
    watchBattery();
    root.addEventListener("online", function () { paintBtn(); if (panel) paint(); });
    root.addEventListener("offline", function () { paintBtn(); if (panel) paint(); });
    // Cheap repaint: DND running out, sync state, playing sounds.
    setInterval(function () {
      paintBtn();
      if (panel) paint();
    }, 2000);
  }

  root.orosQS = {
    VER: VER,
    model: model,
    attach: attach,
    open: open,
    close: function () { close(); },
    toggle: toggle,
    isOpen: isOpen,
    // The shell calls this after a language change.
    refresh: function () {
      paintBtn();
      if (panel) { close(); open(); }
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
