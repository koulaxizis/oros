// ============================================================
// orOS Settings — App logic (v1.0.0)
// One place for the system settings that used to sit under the
// app list in the menu: appearance, menu apps, notifications, sync,
// backups, language and search, system.
//   - owns NO data: every value is read from the shell
//     (window.parent.orosSettings.get) and every change goes back
//     through it (set / act), so the shell stamps, saves and syncs
//     exactly as the menu does. Notifications and the screen pet are
//     read and written through their own shell modules (orosNotifs,
//     orosPet via set("pet")).
//   - no synced slice, no localStorage. The open section is kept in
//     sessionStorage ("oros-settings-ui") so a language switch, which
//     reloads open apps, comes back to the same page.
//   - repaints when the shell says something changed (onChange): a
//     pull from another device, a sync message, the language button.
//   - text is set with textContent only; the only markup written is
//     the app's own static SVG icons.
// Sections:
//   1. Constants, i18n, helpers
//   2. Shell access
//   3. Widgets
//   4. Section: Appearance
//   4b. Section: Menu (which apps the menu lists)
//   5. Section: Notifications
//   6. Section: Sync
//   7. Section: Backups
//   8. Section: Language & search
//  8b. Section: Opening files
//  8c. Section: Connected services (window.parent.orosLinks)
//   9. Section: System
//  10. Navigation + render
//  11. Keyboard (Contract Β) + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    console.log("settings.js v" + (m ? m[1] : "?") + " boot");
  })();

  var C = window.SettingsCore;
  var UI_KEY = "oros-settings-ui";
  var NARROW = "(max-width: 719px)";

  // ---------- 1. Constants, i18n, helpers ----------
  function parentWin() {
    try { return (window.parent && window.parent !== window) ? window.parent : null; }
    catch (e) { return null; }
  }
  function appLang() {
    try {
      var p = parentWin();
      if (window.orosI18n) return window.orosI18n.lang();
      if (p && (p.orosLang === "el" || p.orosLang === "en")) return p.orosLang;
      return localStorage.getItem("oros-lang") === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  function t(key, vars) { return C.t(LANG, key, vars); }
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  var ICON = {
    appearance: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.8-9-7.8z"/><circle cx="7.5" cy="11.5" r="1" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1" fill="currentColor"/><circle cx="15.5" cy="7.5" r="1" fill="currentColor"/></svg>',
    notifications: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
    sync: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.5 12 3.5 3.5 0 0 0 6 19z"/><rect x="9.5" y="13" width="5" height="4" rx="1"/><path d="M10.5 13v-1.2a1.5 1.5 0 0 1 3 0V13"/></svg>',
    backup: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13l3 3 3-3"/></svg>',
    language: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    solo: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/><path d="M17 3v6M14 6h6"/></svg>',
    system: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    files: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14h6M12 11v6"/></svg>',
    menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7"/></svg>',
    services: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>',
    eye: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 3.9M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
  };

  // ---------- 2. Shell access ----------
  function shell() {
    var p = parentWin();
    try { return (p && p.orosSettings && p.orosSettings.v >= 1) ? p.orosSettings : null; }
    catch (e) { return null; }
  }
  function notifs() {
    var p = parentWin();
    try {
      var N = p && p.orosNotifs;
      return (N && typeof N.getSetting === "function" && typeof N.setSetting === "function") ? N : null;
    } catch (e) { return null; }
  }
  function snap() {
    var S = shell();
    try { return S ? S.get() : null; } catch (e) { return null; }
  }
  function set(name, value) {
    var S = shell();
    if (S) S.set(name, value);
    render();
  }
  function act(name, arg) {
    var S = shell();
    if (S) S.act(name, arg);
    render();
  }
  function appName(id) {
    var p = parentWin(), k = "app." + id;
    try {
      var v = p && typeof p.t === "function" ? p.t(k) : k;
      return v === k ? id : v;
    } catch (e) { return id; }
  }

  // ---------- 3. Widgets ----------
  // A setting row: label (+ hint) on the left, the control on the
  // right (stacked under it on narrow screens), and where it applies.
  function row(label, control, opts) {
    opts = opts || {};
    var r = el("div", "row" + (opts.stack ? " stack" : ""));
    var head = el("div", "row-head");
    var lab = el(opts.forId ? "label" : "div", "row-label", label);
    if (opts.forId) lab.htmlFor = opts.forId;
    head.appendChild(lab);
    if (opts.scope) head.appendChild(scopeBadge(opts.scope));
    r.appendChild(head);
    if (opts.hint) r.appendChild(el("div", "hint", opts.hint));
    if (control) {
      var c = el("div", "row-ctl");
      c.appendChild(control);
      r.appendChild(c);
    }
    return r;
  }

  function scopeBadge(name) {
    var scope = C.scopeOf(name);
    var b = el("span", "scope scope-" + scope, t("scope." + scope));
    b.title = t("scope." + scope + ".title");
    return b;
  }

  function card(title, scope) {
    var c = el("section", "card");
    if (title) {
      var h = el("div", "card-head");
      h.appendChild(el("h3", null, title));
      if (scope) h.appendChild(scopeBadge(scope));
      c.appendChild(h);
    }
    return c;
  }

  function switchBtn(on, key, onToggle, label) {
    var b = el("button", "switch");
    b.type = "button";
    b.setAttribute("role", "switch");
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.setAttribute("data-k", key);
    if (label) b.setAttribute("aria-label", label);
    b.appendChild(el("span", "knob"));
    b.addEventListener("click", function () { onToggle(!on); });
    return b;
  }

  function segmented(options, current, key, onPick, label) {
    var g = el("div", "seg");
    g.setAttribute("role", "radiogroup");
    if (label) g.setAttribute("aria-label", label);
    options.forEach(function (o) {
      var b = el("button", "seg-btn" + (o.value === current ? " on" : ""), o.label);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", o.value === current ? "true" : "false");
      b.setAttribute("data-k", key + ":" + o.value);
      b.addEventListener("click", function () { if (o.value !== current) onPick(o.value); });
      g.appendChild(b);
    });
    return g;
  }

  function select(options, current, key, onPick) {
    var s = el("select", "sel");
    s.id = "f-" + key;
    s.setAttribute("data-k", key);
    options.forEach(function (o) {
      var op = el("option", null, o.label);
      op.value = String(o.value);
      if (String(o.value) === String(current)) op.selected = true;
      s.appendChild(op);
    });
    s.addEventListener("change", function () { onPick(s.value); });
    return s;
  }

  function button(label, key, onClick, cls) {
    var b = el("button", "btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.setAttribute("data-k", key);
    b.addEventListener("click", onClick);
    return b;
  }

  function actions() {
    var a = el("div", "actions");
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) a.appendChild(arguments[i]);
    return a;
  }

  // Two taps to confirm: the first arms the button (danger look and
  // a new label) for 10 s, the second runs. Survives repaints.
  var armed = { key: null, until: 0, timer: null };
  function confirmBtn(label, armedLabel, key, run, cls) {
    var isArmed = armed.key === key && Date.now() < armed.until;
    var b = button(isArmed ? armedLabel : label, key, function () {
      if (armed.key === key && Date.now() < armed.until) {
        armed.key = null;
        clearTimeout(armed.timer);
        run();
        return;
      }
      armed.key = key;
      armed.until = Date.now() + 10000;
      clearTimeout(armed.timer);
      armed.timer = setTimeout(function () { armed.key = null; render(); }, 10000);
      render();
    }, (cls || "") + (isArmed ? " armed" : ""));
    return b;
  }

  // ---------- 4. Section: Appearance ----------
  function secAppearance(host, s) {
    var c1 = card(t("a.theme"), "theme");
    c1.appendChild(segmented([
      { value: "dark", label: t("a.dark") }, { value: "light", label: t("a.light") }
    ], s.theme, "theme", function (v) { set("theme", v); }, t("a.theme")));
    host.appendChild(c1);

    var c2 = card(t("a.skin"), "skin");
    var sw = el("div", "swatches");
    sw.setAttribute("role", "radiogroup");
    sw.setAttribute("aria-label", t("a.skin"));
    s.skins.forEach(function (k) {
      var b = el("button", "swatch" + (k.id === s.skin ? " on" : ""));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", k.id === s.skin ? "true" : "false");
      b.setAttribute("data-k", "skin:" + k.id);
      b.title = k.name;
      b.setAttribute("aria-label", k.name);
      b.style.background = k.color;
      b.addEventListener("click", function () { set("skin", k.id); });
      sw.appendChild(b);
    });
    c2.appendChild(sw);
    host.appendChild(c2);

    var c3 = card(t("a.wallpaper"), "wallpaper");
    var grid = el("div", "walls");
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", t("a.wallpaper"));
    s.wallpapers.forEach(function (w) {
      var make = w.id === "custom" && !w.css;
      var b = el("button", "wall" + (w.id === s.wallpaper ? " on" : "") + (make ? " make" : ""));
      b.type = "button";
      b.setAttribute("data-k", "wall:" + w.id);
      var name = make ? t("a.wallpaper.make") : w.name;
      b.title = name;
      b.setAttribute("aria-label", name);
      if (make) b.innerHTML = ICON.plus;               // static icon
      else {
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", w.id === s.wallpaper ? "true" : "false");
        b.style.background = w.css;                    // shell's own CSS
        b.style.backgroundSize = "cover";
        b.style.backgroundPosition = "center";
      }
      b.addEventListener("click", function () { set("wallpaper", w.id); });
      grid.appendChild(b);
    });
    c3.appendChild(grid);
    host.appendChild(c3);

    if (s.seasonal) secSeasonal(host, s.seasonal);

    if (s.dock) {
      var d = s.dock;
      var c5 = card(t("k.dock"), "dock");
      c5.appendChild(row(t("k.on"), switchBtn(d.on, "dock:on", function (v) { set("dock:on", v); }, t("k.on"))));
      if (d.on) {
        var sizeRow = row(t("k.size"), null);
        sizeRow.appendChild(segmented(["s", "m", "l"].map(function (k) {
          return { value: k, label: t("k.size." + k) };
        }), d.size, "dock:size", function (v) { set("dock:size", v); }, t("k.size")));
        c5.appendChild(sizeRow);
        if (d.style && d.styles && d.styles.length) {
          var stRow = row(t("k.style"), select(d.styles.map(function (k) {
            return { value: k, label: t("k.style." + k) };
          }), d.style, "dock:style", function (v) { set("dock:style", v); }), { forId: "f-dock:style" });
          c5.appendChild(stRow);
        }
        if (d.fine) {
          if (d.hover && d.hovers && d.hovers.length) {
            c5.appendChild(row(t("k.hover"), select(d.hovers.map(function (k) {
              return { value: k, label: t("k.hover." + k) };
            }), d.hover, "dock:hover", function (v) { set("dock:hover", v); }), { forId: "f-dock:hover" }));
          } else {
            c5.appendChild(row(t("k.magnify"), switchBtn(d.magnify, "dock:magnify", function (v) { set("dock:magnify", v); }, t("k.magnify"))));
          }
        }
        c5.appendChild(row(t("k.autohide"), switchBtn(d.autohide, "dock:autohide", function (v) { set("dock:autohide", v); }, t("k.autohide"))));
        c5.appendChild(row(t("k.over"), switchBtn(d.over, "dock:over", function (v) { set("dock:over", v); }, t("k.over"))));
        if (!d.pinned) c5.appendChild(el("p", "hint", t("k.empty")));
      }
      host.appendChild(c5);
    }

    if (s.pet.available) {
      var c4 = card(null);
      c4.appendChild(row(t("a.pet"), switchBtn(s.pet.on, "pet", function (v) { set("pet", v); }, t("a.pet")),
        { scope: "pet", hint: t("a.pet.hint") }));
      host.appendChild(c4);
    }
  }

  // Seasonal decorations (seasonal.js through the shell): a main
  // switch, motion, amount, the Christmas piece, and per event a
  // switch and "Try it now" (which closes Settings to show it).
  function segRow(label, seg, opts) {    // like the Dock's Size row
    var r = row(label, null, opts);
    r.appendChild(seg);
    return r;
  }
  function secSeasonal(host, z) {
    var c = card(t("z.title"), "seasonal");
    c.appendChild(row(t("z.on"), switchBtn(z.on, "seasonal:on", function (v) { set("seasonal:on", v); }, t("z.on")),
      { hint: t("z.hint") }));
    if (z.showing && z.showing.mode !== "auto") {
      var msg = z.showing.mode === "kept" ? t("z.kept", { name: z.showing.name, until: z.showing.until })
                                          : t("z.previewing", { name: z.showing.name });
      var pr = row(msg, actions(
        z.showing.mode === "preview" ? button(t("z.keep"), "seasonal.keep", function () { act("seasonal.keep"); }, "primary") : null,
        button(t("z.stop"), "seasonal.stop", function () { act("seasonal.stop"); })), { stack: true });
      c.appendChild(pr);
    }
    if (z.on) {
      c.appendChild(segRow(t("z.motion"), segmented([
        { value: "auto", label: t("z.motion.auto") }, { value: "still", label: t("z.motion.still") }
      ], z.motion, "seasonal:motion", function (v) { set("seasonal:motion", v); }, t("z.motion")),
        { hint: z.reduced ? t("z.reduced") : (z.lowBattery ? t("z.battery") : (z.slow ? t("z.slow") : null)) }));
      c.appendChild(segRow(t("z.amount"), segmented(["low", "mid", "high"].map(function (k) {
        return { value: k, label: t("z.amount." + k) };
      }), z.amount, "seasonal:amount", function (v) { set("seasonal:amount", v); }, t("z.amount"))));
      c.appendChild(segRow(t("z.xmas"), segmented([
        { value: "tree", label: t("z.xmas.tree") }, { value: "boat", label: t("z.xmas.boat") }
      ], z.xmas, "seasonal:xmas", function (v) { set("seasonal:xmas", v); }, t("z.xmas"))));
      if (z.easter) {
        c.appendChild(segRow(t("z.easter"), segmented([
          { value: "orthodox", label: t("z.easter.orthodox") }, { value: "western", label: t("z.easter.western") }
        ], z.easter, "seasonal:easter", function (v) { set("seasonal:easter", v); }, t("z.easter"))));
      }
      if (z.todayEvent) {
        c.appendChild(row(z.hidden ? t("z.hidden") : t("z.today", { name: z.todayEvent.name }), actions(
          button(z.hidden ? t("z.showToday") : t("z.hideToday"), "seasonal.hide",
            function () { act("seasonal.hide", !z.hidden); }))));
      }
    }
    function evRow(ev) {
      var when = ev.id === "birthday" && !ev.from ? t("z.bday.unset")
               : (ev.one ? ev.from : ev.from + " – " + ev.to);
      var r = row(ev.name, switchBtn(ev.on, "seasonal:ev." + ev.id, function (v) { set("seasonal:ev." + ev.id, v); }, ev.name),
        { hint: when + (ev.now ? " · " + t("z.now") : "") });
      if (ev.id === "birthday" && z.bday !== undefined) r.appendChild(bdayPicker(z.bday));
      r.appendChild(actions(button(t("z.try"), "seasonal.preview:" + ev.id, function () { act("seasonal.preview", ev.id); })));
      c.appendChild(r);
    }
    c.appendChild(el("h4", "sub", t("z.events")));
    z.events.filter(function (ev) { return !ev.season; }).forEach(evRow);
    var seasons = z.events.filter(function (ev) { return ev.season; });
    if (seasons.length) {
      c.appendChild(el("h4", "sub", t("z.seasons")));
      c.appendChild(el("p", "hint", t("z.seasons.hint")));
      seasons.forEach(evRow);
    }
    host.appendChild(c);
  }

  // Day + month of the birthday ("MM-DD", no year). Saved once both
  // are picked; both empty clears it. The day is clamped to the month.
  var MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function bdayPicker(cur) {
    var wrap = el("div", "actions");
    var m0 = cur ? +cur.slice(0, 2) : 0, d0 = cur ? +cur.slice(3) : 0;
    var day = select([{ value: "", label: t("z.bday.day") }].concat(Array.apply(null, Array(31)).map(function (x, i) {
      return { value: String(i + 1), label: String(i + 1) };
    })), d0 ? String(d0) : "", "seasonal:bday:d", save);
    var months = t("z.months").split(",");
    var mon = select([{ value: "", label: t("z.bday.month") }].concat(months.map(function (n, i) {
      return { value: String(i + 1), label: n };
    })), m0 ? String(m0) : "", "seasonal:bday:m", save);
    day.setAttribute("aria-label", t("z.bday.day"));
    mon.setAttribute("aria-label", t("z.bday.month"));
    function save() {
      var m = +mon.value, d = +day.value;
      if (!m && !d) { set("seasonal:bday", ""); return; }
      if (!m || !d) return;                        // wait for the other half
      d = Math.min(d, MONTH_DAYS[m - 1]);
      set("seasonal:bday", (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d);
    }
    wrap.appendChild(day);
    wrap.appendChild(mon);
    return wrap;
  }

  // ---------- 4b. Section: Menu (which apps the menu lists) ----------
  var menuFilter = "";       // memory only: the list's find field

  function secMenu(host, s) {
    var c = card(t("m.apps"), "menu");
    if (!s.menu) {
      c.appendChild(el("p", "hint", t("m.none")));
      host.appendChild(c);
      return;
    }
    var total = s.menu.length;
    var shownN = s.menu.filter(function (a) { return a.shown; }).length;
    c.appendChild(el("p", "hint", t("m.hint")));
    var showAll = button(t("m.showAll"), "m.showAll", function () { act("menu.showAll"); });
    var hideAll = button(t("m.hideAll"), "m.hideAll", function () { act("menu.hideAll"); });
    showAll.disabled = shownN === total;
    hideAll.disabled = shownN === 0;
    if (s.menuProfiles) {
      // Home, Work, School…: the first-run screen, over the current menu.
      var prof = button(t("m.profiles"), "m.profiles", function () { act("menu.profiles"); });
      c.appendChild(actions(showAll, hideAll, prof));
    } else c.appendChild(actions(showAll, hideAll));
    c.appendChild(el("p", "m-count", t("m.count", { n: shownN, total: total })));

    var find = el("input", "m-find");
    find.type = "text";
    find.id = "f-menu-find";
    find.autocomplete = "off";
    find.spellcheck = false;
    find.placeholder = t("m.filter");
    find.setAttribute("aria-label", t("m.filter"));
    find.setAttribute("data-k", "menu-find");
    find.value = menuFilter;
    find.addEventListener("input", function () { menuFilter = find.value; render(); });
    find.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && find.value) {
        e.preventDefault();
        e.stopPropagation();
        menuFilter = "";
        render();
      }
    });
    c.appendChild(find);

    var groups = C.menuGroups(s.menu, menuFilter, LANG);
    if (!groups.length) c.appendChild(el("p", "hint", t("m.filter.none")));
    groups.forEach(function (g) {
      c.appendChild(el("h4", "m-cat", g.name));
      var list = el("div", "checks");
      g.apps.forEach(function (a) {
        var lab = el("label", "check");
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = !!a.shown;
        cb.setAttribute("data-k", "menu:" + a.id);
        cb.addEventListener("change", function () { set("menu:" + a.id, cb.checked); });
        lab.appendChild(cb);
        lab.appendChild(el("span", null, a.name));
        lab.title = a.name;
        list.appendChild(lab);
      });
      c.appendChild(list);
    });
    host.appendChild(c);
  }

  // ---------- 5. Section: Notifications ----------
  // [{ id, name }] of Ringtone Composer (shell, stickies/host.js)
  function melodyList() {
    var p = parentWin();
    try { return p && p.orosMelodies && typeof p.orosMelodies.list === "function" ? p.orosMelodies.list() : []; }
    catch (e) { return []; }
  }

  function nSet(name, value) {
    var N = notifs();
    if (N) N.setSetting(name, value);
    render();
  }

  function secNotifications(host) {
    var N = notifs();
    if (!N) { host.appendChild(el("p", "hint", t("n.none"))); return; }
    var on = !!N.getSetting("enabled", true);

    var c1 = card(null);
    c1.appendChild(row(t("n.enabled"), switchBtn(on, "n.enabled", function (v) { nSet("enabled", v); }, t("n.enabled")),
      { scope: "notifications" }));
    c1.appendChild(actions(button(t("n.test"), "n.test", function () {
      N.fireToast({ id: "test_" + Date.now(), ns: "system", type: "test",
                    title: t("n.test.title"), body: t("n.test.body") }, false);
    })));
    host.appendChild(c1);
    secPhoneReminders(host);
    secWebPush(host);

    var c2 = card(null);
    c2.appendChild(row(t("n.position"), select(C.POSITIONS.map(function (p) {
      return { value: p, label: t("n.pos." + p) };
    }), N.getSetting("position", "bottom-right"), "n.position", function (v) { nSet("position", v); }),
      { forId: "f-n.position" }));
    c2.appendChild(row(t("n.style"), select(C.STYLES.map(function (v) {
      return { value: v, label: v.charAt(0).toUpperCase() + v.slice(1) };
    }), N.getSetting("style", "oros"), "n.style", function (v) { nSet("style", v); }),
      { forId: "f-n.style" }));
    // the built-in sounds, then the Ringtone Composer melodies ("rt:<id>")
    var sndCur = String(N.getSetting("sound", "none")), sndOpts = C.SOUNDS.map(function (v) {
      return { value: v, label: t("n.sound." + v) };
    });
    melodyList().forEach(function (m) { sndOpts.push({ value: "rt:" + m.id, label: t("n.sound.rt", { name: m.name || "…" }) }); });
    if (/^rt:/.test(sndCur) && !sndOpts.some(function (o) { return o.value === sndCur; })) sndOpts.push({ value: sndCur, label: t("n.sound.gone") });
    c2.appendChild(row(t("n.sound"), select(sndOpts, sndCur, "n.sound", function (v) { nSet("sound", v); }),
      { forId: "f-n.sound" }));

    var volWrap = el("div", "range");
    var vol = el("input");
    vol.type = "range"; vol.min = "0"; vol.max = "1"; vol.step = "0.05";
    vol.id = "f-n.volume";
    vol.setAttribute("data-k", "n.volume");
    var v0 = Number(N.getSetting("soundVolume", 0.7));
    vol.value = String(isFinite(v0) ? v0 : 0.7);
    var pct = el("span", "range-val", Math.round(Number(vol.value) * 100) + "%");
    vol.addEventListener("input", function () { pct.textContent = Math.round(Number(vol.value) * 100) + "%"; });
    vol.addEventListener("change", function () { nSet("soundVolume", Number(vol.value)); });
    volWrap.appendChild(vol);
    volWrap.appendChild(pct);
    c2.appendChild(row(t("n.volume"), volWrap, { forId: "f-n.volume" }));

    c2.appendChild(row(t("n.duration"), select(C.DURATIONS.map(function (d) {
      return { value: d, label: (d / 1000) + " s" };
    }), N.getSetting("duration", 5000), "n.duration", function (v) { nSet("duration", parseInt(v, 10)); }),
      { forId: "f-n.duration" }));
    host.appendChild(c2);

    var q = C.readQuiet(N.getSetting("quietHours", {}));
    var c3 = card(null);
    c3.appendChild(row(t("n.quiet"), switchBtn(q.enabled, "n.quiet", function (v) {
      nSet("quietHours", C.quietValue(v, q.start, q.end));
    }, t("n.quiet")), { hint: t("n.quiet.hint") }));
    var hours = [];
    for (var h = 0; h <= 23; h++) hours.push({ value: h, label: C.hourLabel(h) });
    var qRow = el("div", "pair");
    var fromLab = el("label", "pair-label", t("n.from"));
    fromLab.htmlFor = "f-n.from";
    qRow.appendChild(fromLab);
    qRow.appendChild(select(hours, q.start, "n.from", function (v) {
      nSet("quietHours", C.quietValue(q.enabled, parseInt(v, 10), q.end));
    }));
    var toLab = el("label", "pair-label", t("n.to"));
    toLab.htmlFor = "f-n.to";
    qRow.appendChild(toLab);
    qRow.appendChild(select(hours, q.end, "n.to", function (v) {
      nSet("quietHours", C.quietValue(q.enabled, q.start, parseInt(v, 10)));
    }));
    c3.appendChild(qRow);
    host.appendChild(c3);

    var known = (typeof N.getKnownApps === "function") ? N.getKnownApps() : [];
    if (known.length) {
      var c4 = card(t("n.apps"));
      var list = el("div", "checks");
      known.forEach(function (id) {
        var lab = el("label", "check");
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = !!N.getAppToggle(id);
        cb.setAttribute("data-k", "n.app:" + id);
        cb.addEventListener("change", function () {
          N.setAppToggle(id, cb.checked);
          render();
        });
        lab.appendChild(cb);
        lab.appendChild(el("span", null, id === "system" ? "orOS" : appName(id)));
        list.appendChild(lab);
      });
      c4.appendChild(list);
      host.appendChild(c4);
    }
  }

  // In the orOS Android app only (BR-PHONE v3): the phone rings
  // Clock alarms, Water and To-Do reminders even when orOS is closed.
  var phoneOff = null;
  function inBrowserTab() {
    try { return (window.top || window).matchMedia("(display-mode: browser)").matches; } catch (e) { return false; }
  }
  function phone() {
    var p = parentWin();
    try { return p && p.orosPhone && p.orosPhone.available() ? p.orosPhone : null; } catch (e) { return null; }
  }
  function secPhoneReminders(host) {
    var P = phone();
    if (!P) return;
    if (!phoneOff) phoneOff = P.onChange(function () { render(); });
    var st = P.state() || {};
    if (!st.reminders) return;                 // an app too old for reminders
    var on = P.enabled("reminders");
    var c = card(null);
    c.appendChild(row(t("n.phone"), switchBtn(on, "n.phone", function (v) {
      P.setEnabled("reminders", v);
      if (v && st.reminders !== "granted") P.askPermission("reminders");
      render();
    }, t("n.phone")), { hint: t("n.phone.hint") }));
    if (on && st.reminders !== "granted") {
      c.appendChild(actions(button(t("n.phone.allow"), "n.phone.allow", function () { P.askPermission("reminders"); })));
    } else if (on && !st.exact) {
      c.appendChild(el("div", "hint", t("n.phone.exact")));
      c.appendChild(actions(button(t("n.phone.allow"), "n.phone.exact", function () { P.askPermission("reminders"); })));
    }
    host.appendChild(c);
  }

  // Notifications with orOS closed (webpush.js): optional, off by
  // default, per device; hidden in the Android app (it rings itself).
  var pushOff = null, pushNote = "", pushCode = "";
  function webPush() {
    var p = parentWin();
    try { return p && p.orosPush && typeof p.orosPush.enable === "function" ? p.orosPush : null; } catch (e) { return null; }
  }
  function secWebPush(host) {
    var W = webPush();
    if (!W || phone()) return;
    if (!pushOff) pushOff = W.onChange(function () { render(); });
    var c = card(null);
    if (!W.supported()) {
      c.appendChild(row(t("n.push"), el("span", "hint", t("n.push.unsupported")), {}));
      host.appendChild(c);
      return;
    }
    var st = W.state();
    c.appendChild(row(t("n.push"), switchBtn(st.on, "n.push", function (v) {
      pushNote = ""; pushCode = "";
      (v ? W.enable() : W.disable()).catch(function (e) {
        var code = e && e.code;
        pushNote = code === "denied" ? "n.push.denied" : (code === "unsupported" || code === "nosubscribe") ? "n.push.unsupported" : "n.push.unavailable";
        pushCode = pushNote === "n.push.unavailable" && typeof code === "string" ? code.replace(/[^a-z-]/g, "").slice(0, 20) : "";
        render();
      }).then(function () { render(); });
    }, t("n.push")), { hint: t("n.push.hint") }));
    c.appendChild(el("div", "hint", t("n.push.desktop")));
    if (st.on && st.at) {
      c.appendChild(el("div", "hint", t("n.push.status", { n: st.n,
        when: new Date(st.at).toLocaleString(document.documentElement.lang || undefined, { dateStyle: "short", timeStyle: "short" }) })));
    }
    if (st.on && st.err && st.err !== "rate") c.appendChild(el("div", "hint", t("n.push.failed")));
    // The relay's code ("nopush", "rate", "network"…) tells what to fix.
    if (pushNote) c.appendChild(el("div", "hint", t(pushNote) + (pushCode && pushNote === "n.push.unavailable" ? " (" + pushCode + ")" : "")));
    var devs = W.devices ? W.devices() : [];
    if (devs.length) {
      var dl = el("div", "checks");
      c.appendChild(el("div", "hint", t("n.push.devices")));
      devs.forEach(function (d) {
        var line = el("div", "pair");
        line.appendChild(el("span", "pair-label", (d.name || "?") + (d.self ? " (" + t("n.push.this") + ")" : "")));
        line.appendChild(button(t("n.push.remove"), "n.push.remove:" + d.id, function () {
          W.remove(d.id).then(function () { render(); });
        }));
        dl.appendChild(line);
      });
      c.appendChild(dl);
    }
    if (st.on) {
      c.appendChild(actions(button(t("n.push.test"), "n.push.test", function () {
        W.test(t("n.push.test.title"), t("n.push.test.body")).then(function () {
          pushNote = "n.push.test.sent"; render();
        }, function (e) {
          pushNote = "n.push.unavailable";
          pushCode = e && typeof e.code === "string" ? e.code.replace(/[^a-z-]/g, "").slice(0, 20) : "";
          render();
        });
      })));
    }
    host.appendChild(c);
  }

  // In the orOS Android app only (BR-PHONE v5): Health Connect.
  function secPhoneHealth(host) {
    var P = phone();
    if (!P) return;
    if (!phoneOff) phoneOff = P.onChange(function () { render(); });
    var st = P.state() || {};
    if (!st.health) return;                    // an app too old for Health Connect
    var on = P.enabled("health");
    var c = card(t("v.hc"));
    if (st.health === "unavailable") { c.appendChild(el("p", "hint", t("v.hc.none"))); host.appendChild(c); return; }
    c.appendChild(row(t("v.hc"), switchBtn(on, "v.hc", function (v) {
      P.setEnabled("health", v);
      if (v && st.health !== "granted") P.askPermission("health");
      render();
    }, t("v.hc")), { hint: t("v.hc.hint") }));
    if (on && st.health === "update") {
      c.appendChild(el("div", "hint", t("v.hc.update")));
      c.appendChild(actions(button(t("v.hc.install"), "v.hc.install", function () { P.askPermission("health"); })));
    } else if (on && st.health !== "granted") {
      if (st.health === "some") c.appendChild(el("div", "hint", t("v.hc.some")));
      c.appendChild(actions(button(t("v.hc.allow"), "v.hc.allow", function () { P.askPermission("health"); })));
    }
    var info = on && P.healthInfo ? P.healthInfo() : null;
    if (info && info.at) {
      var d = new Date(info.at);
      c.appendChild(el("div", "hint", t("v.hc.last", {
        when: d.toLocaleString(document.documentElement.lang || undefined, { dateStyle: "short", timeStyle: "short" }),
        steps: info.steps | 0, water: info.water | 0, wo: info.workouts | 0 })));
    }
    host.appendChild(c);
  }

  // ---------- 6. Section: Sync ----------
  // The passphrase lives only in this field and in the shell call;
  // it survives repaints in memory and is cleared once used.
  var pass = { value: "", shown: false, remember: null };
  // WebDAV W2: the server form. The password stays in memory only
  // until it is handed to the shell.
  // W4: move = the same form moves this device's Dropbox cloud.
  var dav = { open: false, move: false, url: "", user: "", pass: "", dir: "orOS", relay: false };

  function davInput(key, label, type, ph, auto) {
    var wrap = el("div", "dav-field");
    var lab = el("label", "row-label", label);
    lab.htmlFor = "f-dav-" + key;
    wrap.appendChild(lab);
    var inp = el("input");
    inp.id = "f-dav-" + key;
    inp.type = type;
    inp.autocomplete = auto;
    inp.spellcheck = false;
    inp.setAttribute("autocapitalize", "off");
    if (ph) inp.placeholder = ph;
    inp.value = dav[key];
    inp.setAttribute("data-k", "dav-" + key);
    inp.addEventListener("input", function () { dav[key] = inp.value; });
    wrap.appendChild(inp);
    return wrap;
  }

  // W3: "Through the orOS relay" (servers without CORS, the user's
  // choice) and "Sign in with Nextcloud" (Login Flow v2: no password
  // typed here).
  function davForm(y) {
    var form = el("form", "pass dav-form");
    form.setAttribute("autocomplete", "off");
    if (dav.move) form.appendChild(el("div", "hint", t("y.move.dav.hint")));
    form.appendChild(el("div", "hint", t("y.dav.hint")));
    form.appendChild(davInput("url", t("y.dav.url"), "url", t("y.dav.url.ph"), "url"));
    form.appendChild(davInput("dir", t("y.dav.dir"), "text", "orOS", "off"));
    var rl = el("label", "check");
    var rc = el("input");
    rc.type = "checkbox";
    rc.setAttribute("data-k", "dav-relay");
    rc.checked = dav.relay;
    rc.addEventListener("change", function () { dav.relay = rc.checked; });
    rl.appendChild(rc);
    rl.appendChild(el("span", null, t("y.dav.relay")));
    form.appendChild(rl);
    form.appendChild(el("div", "hint", t("y.dav.relay.hint")));
    if (y.ncAvailable) {
      form.appendChild(actions(y.ncWaiting
        ? button(t("y.dav.nc.cancel"), "y.dav.nc.cancel", function () { act("sync.cancelNc"); })
        : button(t("y.dav.nc"), "y.dav.nc", function () {
            act("sync.connectNc", { url: dav.url, dir: dav.dir, relay: dav.relay, move: dav.move });
          })));
      form.appendChild(el("div", "hint", t("y.dav.nc.hint")));
    }
    form.appendChild(davInput("user", t("y.dav.user"), "text", "", "username"));
    form.appendChild(davInput("pass", t("y.dav.pass"), "password", "", "current-password"));
    var go = el("button", "btn primary", t(dav.move ? "y.move.go" : "y.dav.go"));
    go.type = "submit";
    go.setAttribute("data-k", dav.move ? "y.move.go" : "y.dav.go");
    form.appendChild(actions(go, button(t("y.dav.cancel"), "y.dav.cancel", function () {
      dav.open = false;
      dav.move = false;
      dav.pass = "";
      render();
    })));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var arg = { url: dav.url, user: dav.user, pass: dav.pass, dir: dav.dir, relay: dav.relay };
      dav.pass = "";
      act(dav.move ? "sync.moveDav" : "sync.connectDav", arg);
    });
    return form;
  }

  function secSync(host, s) {
    var y = s.sync;
    var st = C.syncState(y);
    // The form connects while off and moves while on; a change of
    // state (connected, moved) closes it.
    var formFor = st === "off" ? "connect" : st === "locked" ? "" : "move";
    if (dav.open && formFor !== (dav.move ? "move" : "connect")) { dav.open = false; dav.move = false; dav.pass = ""; }
    if (dav.move && y.provider !== "dropbox") { dav.open = false; dav.move = false; dav.pass = ""; }
    var c1 = card(null);
    var status = el("div", "status status-" + st);
    status.appendChild(el("span", "dot"));
    var txt = el("div", "status-txt");
    txt.appendChild(el("div", "status-main",
      st === "off" ? t("y.status.off") : st === "locked" ? t("y.status.locked") :
      st === "dirty" ? t("y.status.dirty") : t("y.status.on")));
    if (y.email) {
      txt.appendChild(el("div", "hint",
        t(y.provider === "webdav" ? "y.via.webdav" : "y.via.dropbox", { who: y.email })));
    }
    status.appendChild(txt);
    c1.appendChild(status);

    if (st === "off") {
      if (y.available) {
        c1.appendChild(el("p", "hint", t("y.connect.hint")));
        if (dav.open && y.davAvailable) {
          c1.appendChild(davForm(y));
        } else {
          c1.appendChild(actions(
            button(t("y.connect"), "y.connect", function () { act("sync.connect"); }, "primary"),
            y.davAvailable ? button(t("y.dav"), "y.dav", function () {
              dav.open = true;
              render();
              var f = $("f-dav-url");
              if (f) f.focus();
            }) : null));
        }
      }
    } else if (st === "locked") {
      var form = el("form", "pass");
      form.setAttribute("autocomplete", "off");
      var lab = el("label", "row-label", t("y.pass"));
      lab.htmlFor = "f-pass";
      form.appendChild(lab);
      var ir = el("div", "pass-row");
      var inp = el("input");
      inp.id = "f-pass";
      inp.type = pass.shown ? "text" : "password";
      inp.autocomplete = "off";
      inp.spellcheck = false;
      inp.placeholder = t("y.pass.ph");
      inp.value = pass.value;
      inp.setAttribute("data-k", "pass");
      inp.addEventListener("input", function () { pass.value = inp.value; });
      ir.appendChild(inp);
      var eye = el("button", "eye");
      eye.type = "button";
      eye.setAttribute("data-k", "pass-eye");
      eye.innerHTML = pass.shown ? ICON.eyeOff : ICON.eye;   // static icon
      eye.setAttribute("aria-label", t(pass.shown ? "y.pass.hide" : "y.pass.show"));
      eye.title = eye.getAttribute("aria-label");
      eye.addEventListener("click", function () {
        pass.shown = !pass.shown;
        render();
        var f = $("f-pass");
        if (f) f.focus();
      });
      ir.appendChild(eye);
      form.appendChild(ir);
      form.appendChild(el("div", "hint", t("y.pass.hint", { n: y.minPass })));
      var rl = el("label", "check");
      var rc = el("input");
      rc.type = "checkbox";
      rc.setAttribute("data-k", "pass-remember");
      rc.checked = pass.remember === null ? y.hasVault : pass.remember;
      rc.addEventListener("change", function () { pass.remember = rc.checked; });
      rl.appendChild(rc);
      rl.appendChild(el("span", null, t("y.remember")));
      form.appendChild(rl);
      var go = el("button", "btn primary", t("y.unlock"));
      go.type = "submit";
      go.setAttribute("data-k", "y.unlock");
      form.appendChild(actions(go));
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var pw = pass.value;
        var remember = pass.remember === null ? y.hasVault : pass.remember;
        pass.value = "";
        pass.shown = false;
        act("sync.unlock", { pw: pw, remember: remember });
      });
      c1.appendChild(form);
    } else {
      c1.appendChild(actions(
        button(t("y.pull"), "y.pull", function () { act("sync.pull"); }),
        button(t("y.push"), "y.push", function () { act("sync.push"); })));
      // WebDAV W4: move this cloud to the other provider.
      if (y.moveAvailable && dav.move && dav.open) {
        c1.appendChild(davForm(y));
      } else if (y.moveAvailable && y.provider === "dropbox" && y.davAvailable) {
        c1.appendChild(actions(button(t("y.move.dav"), "y.move.dav", function () {
          dav.open = true;
          dav.move = true;
          render();
          var f = $("f-dav-url");
          if (f) f.focus();
        })));
      } else if (y.moveAvailable && y.provider === "webdav") {
        c1.appendChild(actions(button(t("y.move.db"), "y.move.db", function () { act("sync.moveDb"); })));
        c1.appendChild(el("div", "hint", t("y.move.db.hint")));
      }
    }
    if (y.msg && y.msg.text) {
      var m = el("div", "msg msg-" + (y.msg.kind === "err" ? "err" : y.msg.kind === "ok" ? "ok" : "dim"), y.msg.text);
      m.setAttribute("role", "status");
      c1.appendChild(m);
    }
    host.appendChild(c1);

    if (st === "on" || st === "dirty") {
      var c2 = card(null);
      c2.appendChild(row(t("y.interval"), select(y.intervals.map(function (n) {
        return { value: n, label: C.intervalLabel(LANG, n) };
      }), y.interval, "y.interval", function (v) { set("syncInterval", parseInt(v, 10)); }),
        { scope: "syncInterval", forId: "f-y.interval" }));
      host.appendChild(c2);

      if (y.canRestore) host.appendChild(backupsCard(y));

      var c3 = card(null);
      c3.appendChild(actions(
        button(t("y.changePass"), "y.changePass", function () { act("sync.changePass"); }),
        button(t(y.hasVault ? "y.forgetVault" : "y.forget"), "y.forget", function () { act("sync.forget"); }),
        confirmBtn(t("y.disconnect"), t("y.disconnect.confirm"), "y.disconnect", function () {
          act("sync.disconnect");
        }, "danger")));
      host.appendChild(c3);
    }
  }

  // A43: the cloud's daily backups, newest first, each with Restore
  // (two taps). A backup sealed with an older passphrase asks for it
  // here; that field, like the unlock one, lives only in memory.
  var oldPass = { value: "" };
  function backupsCard(y) {
    var c = card(t("y.backups"));
    c.appendChild(el("p", "hint", t("y.backups.hint")));
    var b = y.backups;
    if (!b) {
      c.appendChild(actions(button(t("y.backups.show"), "y.backups.show", function () { act("sync.backups.load"); })));
      return c;
    }
    if (b.err) c.appendChild(el("div", "msg msg-err", b.err));
    if (b.loading && !b.list.length) c.appendChild(el("div", "hint", t("y.backups.loading")));
    else if (!b.list.length && !b.err) c.appendChild(el("div", "hint", t("y.backups.none")));
    var locale = LANG === "el" ? "el-GR" : "en-GB";
    b.list.forEach(function (e, i) {
      var d = new Date(e.at);
      var when = isNaN(d.getTime()) ? e.name : d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
      var size = e.size > 0 ? (e.size < 1048576 ? Math.max(1, Math.round(e.size / 1024)) + " KB"
                                                 : (e.size / 1048576).toFixed(1) + " MB") : "";
      var r = el("div", "row backup-row");
      var head = el("div", "row-head");
      head.appendChild(el("div", "row-label", when));
      r.appendChild(head);
      if (size) r.appendChild(el("div", "hint", size));
      var ctl = el("div", "row-ctl");
      if (y.restoring === e.name) {
        var w = button(t("y.backups.restoring"), "y.restore:" + i, function () {});
        w.disabled = true;
        ctl.appendChild(w);
      } else {
        var rb = confirmBtn(t("y.backups.restore"), t("y.backups.restore.confirm"), "y.restore:" + i, function () {
          act("sync.restore", { name: e.name });
        });
        if (y.restoring) rb.disabled = true;
        ctl.appendChild(rb);
      }
      r.appendChild(ctl);
      if (y.oldPassFor === e.name && !y.restoring) r.appendChild(oldPassForm(e.name));
      c.appendChild(r);
    });
    return c;
  }
  function oldPassForm(name) {
    var form = el("form", "pass");
    form.setAttribute("autocomplete", "off");
    var lab = el("label", "row-label", t("y.backups.old"));
    lab.htmlFor = "f-oldpass";
    form.appendChild(lab);
    var inp = el("input");
    inp.id = "f-oldpass";
    inp.type = "password";
    inp.autocomplete = "off";
    inp.spellcheck = false;
    inp.value = oldPass.value;
    inp.setAttribute("data-k", "oldpass");
    inp.addEventListener("input", function () { oldPass.value = inp.value; });
    var ir = el("div", "pass-row");
    ir.appendChild(inp);
    form.appendChild(ir);
    var go = el("button", "btn primary", t("y.backups.old.go"));
    go.type = "submit";
    go.setAttribute("data-k", "y.backups.old.go");
    form.appendChild(actions(go));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var pw = oldPass.value;
      oldPass.value = "";
      if (pw) act("sync.restore", { name: name, old: pw });
    });
    return form;
  }

  // ---------- 7. Section: Backups ----------
  function secBackup(host, s) {
    var b = s.backup;
    if (b.folderSupported) {
      var c1 = card(null);
      c1.appendChild(row(t("b.auto"), select(["off", "daily", "weekly", "monthly"].map(function (v) {
        return { value: v, label: t("b.auto." + v) };
      }), b.autoexport, "b.auto", function (v) { set("autoexport", v); }),
        { scope: "autoexport", forId: "f-b.auto" }));
      var fr = row(t("b.folder"), null, { scope: "folder", hint: t("b.folder.hint") });
      fr.appendChild(el("div", "folder" + (b.lapsed ? " lapsed" : ""),
        b.folder ? b.folder : t("b.folder.none")));
      if (b.lapsed) fr.appendChild(el("div", "hint warn", t("b.folder.lapsed")));
      // The picker and the permission prompt need this very click.
      fr.appendChild(actions(
        b.folder && b.lapsed ? button(t("b.folder.reconnect"), "b.reconnect", function () { act("backup.reconnectFolder"); }, "primary") : null,
        b.folder ? button(t("b.folder.stop"), "b.stop", function () { act("backup.stopFolder"); })
                 : button(t("b.folder.choose"), "b.choose", function () { act("backup.chooseFolder"); }, "primary")));
      c1.appendChild(fr);
      host.appendChild(c1);
    } else {
      host.appendChild(el("p", "hint card-note", t("b.noFolder")));
    }

    var c2 = card(null);
    c2.appendChild(actions(
      button(t("b.export"), "b.export", function () { act("backup.export"); }, "primary"),
      button(t("b.import"), "b.import", function () { act("backup.import"); }),
      b.folderSupported && b.folder && b.autoexport !== "off"
        ? button(t("b.now"), "b.now", function () { act("backup.now"); }) : null));
    c2.appendChild(el("p", "hint", t("b.hint")));
    host.appendChild(c2);
  }

  // ---------- 8. Section: Language & search ----------
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var v = window.orosI18n && window.orosI18n.ver;
      var sc = document.createElement("script");
      sc.src = src + (v ? "?v=" + encodeURIComponent(v) : "");
      sc.onload = resolve; sc.onerror = reject;
      document.head.appendChild(sc);
    });
  }
  // Open across a language switch (Try it reloads this frame).
  var TR_KEY = "oros-settings-tr";
  function openTranslate() {
    try { sessionStorage.setItem(TR_KEY, "1"); } catch (e) {}
    var go2 = function () {
      window.SettingsTranslate.open({
        t: t,
        setLang: function (code) { set("lang", code); },
        onClose: function () { try { sessionStorage.removeItem(TR_KEY); } catch (e) {} }
      });
    };
    if (window.SettingsTranslate) { go2(); return; }
    loadScript("../i18n-tables.js").then(function () { return loadScript("translate.js"); }).then(go2, function () {});
  }

  function secLanguage(host, s) {
    var c1 = card(t("l.lang"), "lang");
    // Each language under its own name; a pack language that is not
    // complete yet says so (the rest shows in English).
    var langs = Array.isArray(s.langs) && s.langs.length ? s.langs
      : [{ code: "en", name: "English" }, { code: "el", name: "Ελληνικά" }];
    c1.appendChild(segmented(langs.map(function (l) {
      return { value: l.code, label: l.name };
    }), s.lang, "lang", function (v) { set("lang", v); }, t("l.lang")));
    langs.forEach(function (l) {
      if (l.code === s.lang && l.partial) c1.appendChild(el("p", "hint", t("l.lang.partial")));
    });
    host.appendChild(c1);

    // Help translate (settings/translate.js, loaded on demand).
    if (window.orosI18n && window.orosI18n.LANGS.some(function (l) { return l.code !== "en" && l.code !== "el"; })) {
      var ct = card(t("tr.title"), "device");
      ct.appendChild(el("p", "hint", t("tr.card.hint")));
      ct.appendChild(actions(button(t("tr.open"), "tr.open", openTranslate)));
      host.appendChild(ct);
    }

    var c2 = card(t("l.search"), "search");
    c2.appendChild(el("p", "hint", s.search.length ? t("l.search.hint") : t("l.search.none")));
    if (s.search.length) {
      var list = el("div", "checks");
      s.search.forEach(function (a) {
        var lab = el("label", "check");
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = !!a.on;
        cb.setAttribute("data-k", "search:" + a.id);
        cb.addEventListener("change", function () { set("search:" + a.id, cb.checked); });
        lab.appendChild(cb);
        lab.appendChild(el("span", null, a.name));
        list.appendChild(lab);
      });
      c2.appendChild(list);
    }
    host.appendChild(c2);
  }

  // ---------- 8b. Section: Opening files ----------
  // Reads and writes the shell's fileopen.js (window.orosFileOpen);
  // the choices stay on this device.
  function fileOpen() {
    var p = parentWin();
    try { return (p && p.orosFileOpen && p.orosFileOpen.v >= 1) ? p.orosFileOpen : null; }
    catch (e) { return null; }
  }

  // Single apps (solo.js): "orOS Notes", "orOS Calendar" … installed on
  // their own. Install opens the app's page in a new tab, where the
  // browser offers its own install (a web page cannot install another).
  function soloApi() {
    var p = parentWin();
    try { return (p && p.orosSolo && p.orosSolo.v >= 1) ? p.orosSolo : null; }
    catch (e) { return null; }
  }
  function secSolo(host) {
    var S = soloApi();
    var c1 = card(t("so.apps"));
    if (!S) {
      c1.appendChild(el("p", "hint", t("so.none")));
      host.appendChild(c1);
      return;
    }
    c1.appendChild(el("p", "hint", t("so.intro")));
    S.ids().forEach(function (id) {
      var b = button(t("so.open"), "solo:" + id, function () {
        var u = S.installUrl ? S.installUrl(id, navigator.userAgent, location.origin, !!phone(), inBrowserTab()) : "/" + id + "/solo.html";
        // Android: an intent to Chrome, so the orOS app does not catch the
        // link; in the orOS app, the app itself opens Chrome.
        if (u.indexOf("intent:") === 0) { try { window.top.location.href = u; } catch (e) { location.href = u; } }
        else window.open(u, "_blank", "noopener");
      });
      b.title = t("so.open.title");
      var r = row(S.nameOf(id, LANG), b);
      // Android: the APK installs next to an installed orOS, which the
      // browser's own install cannot (orOS claims every page of the site)
      if (S.apkUrl && /Android/i.test(navigator.userAgent)) {
        var k = el("a", "btn", t("so.apk"));
        k.href = S.apkHref ? S.apkHref(id, navigator.userAgent, !inBrowserTab(), phone() ? "online.useoros.twa" : "") : S.apkUrl(id);
        k.title = t("so.apk.title");
        k.rel = "noopener";
        b.parentNode.insertBefore(k, b.nextSibling);
      }
      c1.appendChild(r);
    });
    host.appendChild(c1);
    // FDROID-1: updates for the APKs through the orOS F-Droid repository
    if (S.repoLink) {
      var cu = card(t("so.upd"));
      cu.appendChild(el("p", "hint", t("so.upd.hint")));
      var page = el("a", "btn", t("so.upd.page"));
      page.href = S.repoPage;
      page.target = "_blank";
      page.rel = "noopener";
      if (/Android/i.test(navigator.userAgent)) {
        var fd = el("a", "btn", t("so.upd.fdroid"));
        fd.href = S.repoLink();
        fd.title = t("so.upd.fdroid.title");
        var ob = el("a", "btn", t("so.upd.obtainium"));
        ob.href = S.obtainiumLink("oros");
        ob.title = t("so.upd.obtainium.title");
        var r2 = row(t("so.upd.add"), fd);
        fd.parentNode.appendChild(ob);
        cu.appendChild(r2);
      }
      cu.appendChild(row(t("so.upd.addr"), page, { hint: S.repoPage }));
      host.appendChild(cu);
    }
    var c2 = card(t("so.how"));
    ["desktop", "android", "iphone"].forEach(function (k) {
      c2.appendChild(el("p", "hint", t("so.how." + k)));
    });
    host.appendChild(c2);
  }

  function secFiles(host) {
    var F = fileOpen();
    var c1 = card(t("f.status"), "files");
    if (!F) {
      c1.appendChild(el("p", "hint", t("f.none")));
      host.appendChild(c1);
      return;
    }
    c1.appendChild(el("p", "hint", !F.supported() ? t("f.unsupported") : F.installed() ? t("f.ready") : t("f.install")));
    host.appendChild(c1);

    var c2 = card(t("f.apps"));
    F.handlers().forEach(function (h) {
      c2.appendChild(row(appName(h.app), null, { hint: h.exts.join("  ") }));
    });
    host.appendChild(c2);

    var sh = F.shared();
    if (sh.length) {
      var c3 = card(t("f.choose"), "files");
      c3.appendChild(el("p", "hint", t("f.choose.hint")));
      sh.forEach(function (ext) {
        var opts = [{ value: "", label: t("f.ask") }].concat(F.appsFor(ext).map(function (id) {
          return { value: id, label: appName(id) };
        }));
        var cur = F.choice(ext);
        var key = "file:" + ext.slice(1);
        c3.appendChild(row(ext, select(opts, cur === "ask" ? "" : cur, key, function (v) {
          F.setChoice(ext, v);
          render();
        }), { forId: "f-" + key }));
      });
      host.appendChild(c3);
    }

    var c4 = card(t("f.how"));
    c4.appendChild(el("p", "hint", t("f.how.hint")));
    ["win", "linux", "mac", "android"].forEach(function (k) {
      c4.appendChild(el("p", "hint", t("f.how." + k)));
    });
    host.appendChild(c4);
  }

  // ---------- 8c. Section: Connected services ----------
  // Everything goes through the shell's orosLinks (links/host.js): the
  // keys are typed here once, handed over and sealed there; this page
  // never stores them and never reads them back.
  function links() {
    var p = parentWin();
    try { return p && p.orosLinks && typeof p.orosLinks.list === "function" ? p.orosLinks : null; }
    catch (e) { return null; }
  }
  // page state (session only): the add form, per-account messages and
  // whether this device holds each account's keys
  var svc = { add: null, keysFor: null, keyForm: { ck: "", cs: "", key: "" }, msg: {}, has: {}, busy: {}, rename: null, off: null };
  // the platform's own wording first ("v.err.auth.tol"), else the shop's
  function svcErr(code, p) {
    var k = "v.err." + (code === "keys" ? "keys" : code);
    if (p && p !== "woo") {
      var own = t(k + "." + p);
      if (own !== k + "." + p) return own;
      var gen = t(k + ".svc", { name: pName(p) });       // any other platform, by name
      if (gen !== k + ".svc") return gen;
    }
    var txt = t(k);
    return txt === k ? t("v.err.server") : txt;
  }
  function pName(p) {
    var Lk = links(), x = Lk ? Lk.platforms().filter(function (y) { return y.id === p; })[0] : null;
    return x ? x.name : p;
  }
  function badKeys(p) {
    var own = t("v.err.badkeys." + p);
    return own !== "v.err.badkeys." + p ? own : t("v.err.badkeys");
  }
  function pOf(id) { var Lk = links(), a = Lk && Lk.get(id); return a ? a.p : ""; }
  function textInput(key, value, ph, onInput, type) {
    var inp = el("input");
    inp.id = "f-" + key;
    inp.type = type || "text";
    inp.autocomplete = "off";
    inp.spellcheck = false;
    if (ph) inp.placeholder = ph;
    inp.value = value || "";
    inp.setAttribute("data-k", key);
    inp.addEventListener("input", function () { onInput(inp.value); });
    var w = el("div", "pass-row");
    w.appendChild(inp);
    return w;
  }
  function labelled(label, key, control) {
    var lab = el("label", "row-label", label);
    lab.htmlFor = "f-" + key;
    var box = el("div", "pass");
    box.appendChild(lab);
    box.appendChild(control);
    return box;
  }
  function refreshKeys(id) {
    var Lk = links();
    if (!Lk) return;
    Lk.hasKeys(id).then(function (h) {
      if (svc.has[id] === h) return;
      svc.has[id] = h;
      render();
    }, function () {});
  }
  function runTest(id) {
    var Lk = links();
    if (!Lk) return;
    svc.busy[id] = true;
    svc.msg[id] = { cls: "msg-dim", text: t("v.checking") };
    render();
    var p = pOf(id);
    Lk.test(id).then(function (code) {
      if (!code && p === "tol") {
        // the probe is the credits balance: show it
        return Lk.call(id, [{ m: "GET", path: "/GetCreditsBalance" }]).then(function (res) {
          var n = res[0] && res[0].data && typeof res[0].data.creditsBalance === "number" ? res[0].data.creditsBalance : null;
          svc.busy[id] = false;
          svc.msg[id] = { cls: "msg-ok", text: t("v.ok.tol", { n: n === null ? "—" : n.toLocaleString(LANG === "el" ? "el-GR" : "en-GB") }) };
          render();
        }, function () { svc.busy[id] = false; svc.msg[id] = { cls: "msg-ok", text: t("v.ok.tol", { n: "—" }) }; render(); });
      }
      svc.busy[id] = false;
      svc.msg[id] = code ? { cls: "msg-err", text: svcErr(code, p) } : { cls: "msg-ok", text: p === "woo" ? t("v.ok") : t("v.ok.svc", { name: pName(p) }) };
      render();
    });
  }
  function secServices(host) {
    secPhoneHealth(host);
    var Lk = links();
    if (!Lk) { host.appendChild(el("p", "hint card-note", t("v.unsupported"))); return; }
    var c0 = card(null);
    c0.appendChild(el("p", "hint", t("v.intro")));
    var accts = Lk.list();
    if (!accts.length && !svc.add) c0.appendChild(el("p", "msg msg-dim", t("v.none")));
    if (!svc.add) {
      c0.appendChild(actions(button(t("v.add"), "v.add", function () {
        svc.add = { p: null, q: "", name: "", site: "", ck: "", cs: "", key: "", env: "test", vat: "", db: "", err: "" };
        render();
        var f = $("f-v-q");
        if (f) f.focus();
      }, "primary")));
    }
    host.appendChild(c0);
    if (svc.add) host.appendChild(addCard(Lk));
    var plats = {};
    Lk.platforms().forEach(function (p) { plats[p.id] = p; });
    accts.forEach(function (a) {
      if (!(a.id in svc.has)) { svc.has[a.id] = null; refreshKeys(a.id); }
      host.appendChild(acctCard(Lk, a, plats[a.p]));
    });
  }
  // The service picker: tiles grouped by what they are for, a coloured
  // monogram each (no third-party logos), a search box and how many
  // accounts of that service this orOS already has.
  var SVC_GROUPS = [
    { id: "shop", ps: ["woo", "tol", "ininja", "stripe"] },
    { id: "mail", ps: ["mlite", "mchimp", "brevo"] },
    { id: "crm", ps: ["hubspot", "pdrive", "odoo"] },
    { id: "work", ps: ["todoist", "trello", "github", "notion", "raindrop"] }
  ];
  // monogram per service; its brand colour is in settings.css (.svc-mark.m-<id>)
  var SVC_MARK = {
    woo: "Wo", tol: "t", ininja: "IN", stripe: "S", mlite: "ML", mchimp: "M", brevo: "B",
    hubspot: "H", pdrive: "P", odoo: "O", todoist: "Td", trello: "Tr", github: "GH", notion: "N", raindrop: "R"
  };
  function svcMark(p, name) {
    var m = SVC_MARK[p];
    var b = el("span", "svc-mark " + (m ? "m-" + p : "plain"), m || String(name || p).charAt(0).toUpperCase());
    b.setAttribute("aria-hidden", "true");
    return b;
  }
  function svcApps(plat) { return (plat.apps || []).map(appName).join(", "); }
  function svcFind(q, plat) {
    q = String(q || "").trim().toLowerCase();
    if (!q) return true;
    var lab = t("v.plat." + plat.id);
    return (plat.name + " " + svcApps(plat) + " " + (lab === "v.plat." + plat.id ? "" : lab) + " " + plat.id).toLowerCase().indexOf(q) >= 0;
  }
  function pickerCard(Lk) {
    var f = svc.add;
    var c = card(t("v.pick"));
    var plats = Lk.platforms(), byId = {}, count = {};
    plats.forEach(function (p) { byId[p.id] = p; });
    Lk.list().forEach(function (a) { count[a.p] = (count[a.p] || 0) + 1; });
    var srch = el("input", "svc-search");
    srch.id = "f-v-q";
    srch.type = "text";
    srch.autocomplete = "off";
    srch.spellcheck = false;
    srch.placeholder = t("v.pick.search");
    srch.setAttribute("aria-label", t("v.pick.search"));
    srch.setAttribute("data-k", "v-q");
    srch.value = f.q || "";
    c.appendChild(srch);
    var none = el("p", "msg msg-dim svc-none");
    var groups = [], seen = {};
    SVC_GROUPS.forEach(function (g) {
      var ps = g.ps.filter(function (id) { return byId[id]; });
      ps.forEach(function (id) { seen[id] = 1; });
      if (ps.length) groups.push({ id: g.id, ps: ps });
    });
    var rest = plats.filter(function (p) { return !seen[p.id]; }).map(function (p) { return p.id; });
    if (rest.length) groups.push({ id: "other", ps: rest });
    var blocks = [];
    groups.forEach(function (g) {
      var sec = el("div", "svc-group");
      sec.appendChild(el("h4", "svc-group-title", t("v.grp." + g.id)));
      var grid = el("div", "svc-grid");
      var tiles = g.ps.map(function (id) {
        var plat = byId[id];
        var b = el("button", "svc-tile");
        b.type = "button";
        b.setAttribute("data-k", "v.pick:" + id);
        b.appendChild(svcMark(id, plat.name));
        var txt = el("span", "svc-txt");
        txt.appendChild(el("span", "svc-name", plat.name));
        txt.appendChild(el("span", "svc-apps", svcApps(plat)));
        b.appendChild(txt);
        var n = count[id] || 0;
        if (n) b.appendChild(el("span", "svc-on", n > 1 ? t("v.pick.on.n", { n: n }) : t("v.pick.on")));
        b.setAttribute("aria-label", plat.name + ", " + t("v.pick.for", { apps: svcApps(plat) }) + (n ? ", " + (n > 1 ? t("v.pick.on.n", { n: n }) : t("v.pick.on")) : ""));
        b.addEventListener("click", function () {
          f.p = id;
          f.err = "";
          render();
          var nm = $("f-v-name");
          if (nm) nm.focus();
        });
        grid.appendChild(b);
        return { b: b, plat: plat };
      });
      sec.appendChild(grid);
      c.appendChild(sec);
      blocks.push({ sec: sec, tiles: tiles });
    });
    c.appendChild(none);
    // filter in place: no re-render, so typing never loses its place
    function filter() {
      var any = false;
      blocks.forEach(function (bk) {
        var vis = 0;
        bk.tiles.forEach(function (x) { var ok = svcFind(f.q, x.plat); x.b.hidden = !ok; if (ok) vis++; });
        bk.sec.hidden = !vis;
        if (vis) any = true;
      });
      none.hidden = any;
      none.textContent = any ? "" : t("v.pick.none", { q: String(f.q || "").trim() });
    }
    srch.addEventListener("input", function () { f.q = srch.value; filter(); });
    filter();
    c.appendChild(actions(button(t("v.cancel"), "v.cancel", function () { svc.add = null; render(); })));
    return c;
  }
  function addCard(Lk) {
    var f = svc.add;
    if (!f.p) return pickerCard(Lk);
    var c = card(t("v.add"));
    var form = el("form", "pass");
    form.setAttribute("autocomplete", "off");
    form.noValidate = true;                       // "shop.example.gr" is fine: core normalises it
    var chosen = Lk.platforms().filter(function (x) { return x.id === f.p; })[0] || { id: f.p, name: f.p, apps: [] };
    var head = el("div", "svc-chosen");
    head.appendChild(svcMark(chosen.id, chosen.name));
    var ht = el("span", "svc-txt");
    ht.appendChild(el("span", "svc-name", chosen.name));
    ht.appendChild(el("span", "svc-apps", t("v.pick.for", { apps: svcApps(chosen) })));
    head.appendChild(ht);
    head.appendChild(button(t("v.pick.change"), "v.pick.change", function () { f.p = null; f.err = ""; render(); var q = $("f-v-q"); if (q) q.focus(); }));
    form.appendChild(head);
    var pHint = t("v.plat." + f.p + ".hint");
    if (pHint !== "v.plat." + f.p + ".hint") form.appendChild(el("div", "hint", pHint));
    var pName = (Lk.platforms().filter(function (x) { return x.id === f.p; })[0] || {}).name;
    form.appendChild(labelled(t("v.name"), "v-name", textInput("v-name", f.name, f.p === "woo" ? t("v.name.ph") : pName, function (v) { f.name = v; })));
    var platInfo = Lk.platforms().filter(function (x) { return x.id === f.p; })[0] || {};
    var isSite = !!platInfo.site, hasDb = !!platInfo.db;
    if (f.p !== "woo") {
      if (isSite) form.appendChild(labelled(siteLabel(f.p), "v-site", textInput("v-site", f.site, t("v.site.ph." + f.p) === "v.site.ph." + f.p ? t("v.site.ph") : t("v.site.ph." + f.p), function (v) { f.site = v; }, "url")));
      if (hasDb) form.appendChild(labelled(t("v.db"), "v-db", textInput("v-db", f.db || "", t("v.db.ph"), function (v) { f.db = v; })));
      if (f.p === "tol") {
        form.appendChild(labelled(t("v.env"), "v-env", select([{ value: "test", label: t("v.env.test") }, { value: "live", label: t("v.env.live") }], f.env, "v-env", function (v) { f.env = v; })));
        var vin = textInput("v-vat", f.vat, t("v.vat.ph"), function (v) { f.vat = v; });
        vin.inputMode = "numeric";
        form.appendChild(labelled(t("v.vat"), "v-vat", vin));
      }
      form.appendChild(el("div", "hint", t("v.keys.hint." + f.p)));
      form.appendChild(labelled(t("v.key"), "v-key", textInput("v-key", f.key, "", function (v) { f.key = v; }, "password")));
      if (f.p === "trello") form.appendChild(labelled(t("v.token"), "v-token", textInput("v-token", f.token || "", "", function (v) { f.token = v; }, "password")));
    } else {
      form.appendChild(labelled(t("v.site"), "v-site", textInput("v-site", f.site, t("v.site.ph"), function (v) { f.site = v; }, "url")));
      form.appendChild(el("div", "hint", t("v.keys.hint")));
      form.appendChild(labelled(t("v.ck"), "v-ck", textInput("v-ck", f.ck, "ck_…", function (v) { f.ck = v; }, "password")));
      form.appendChild(labelled(t("v.cs"), "v-cs", textInput("v-cs", f.cs, "cs_…", function (v) { f.cs = v; }, "password")));
    }
    if (f.err) form.appendChild(el("p", "msg msg-err", f.err));
    var go = el("button", "btn primary", f.busy ? t("v.checking") : t("v.save"));
    go.type = "submit";
    go.disabled = !!f.busy;
    go.setAttribute("data-k", "v.save");
    form.appendChild(actions(button(t("v.cancel"), "v.cancel", function () { svc.add = null; render(); }), go));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (f.busy) return;
      f.busy = true;
      f.err = "";
      render();
      var o = f.p === "tol" ? { p: "tol", name: f.name, env: f.env, vat: f.vat, keys: { key: f.key } }
            : f.p !== "woo" ? { p: f.p, name: f.name, site: isSite ? f.site : undefined, db: hasDb ? f.db || "" : undefined, keys: f.p === "trello" ? { key: f.key, token: f.token || "" } : { key: f.key } }
            : { p: f.p, name: f.name, site: f.site, keys: { ck: f.ck, cs: f.cs } };
      Lk.add(o).then(function (id) {
        svc.add = null;
        svc.has[id] = true;
        render();
        runTest(id);
      }, function (er) {
        f.busy = false;
        var code = er && er.code;
        f.err = code === "site" ? t("v.err.site") : code === "vat" ? t("v.err.vat") : code === "db" ? t("v.err.db")
              : code === "keys" ? badKeys(f.p) : svcErr(code || "save", f.p);
        render();
      });
    });
    c.appendChild(form);
    return c;
  }
  function siteLabel(p) { var k = "v.site." + p; return t(k) === k ? t("v.site") : t(k); }
  function acctCard(Lk, a, plat) {
    var c = card(a.name);
    var info = el("dl", "keys info");
    info.appendChild(el("dt", null, t("v.platform")));
    info.appendChild(el("dd", null, a.platform));
    if (a.site) {
      info.appendChild(el("dt", null, siteLabel(a.p)));
      info.appendChild(el("dd", null, a.site.replace(/^https:\/\//, "")));
    }
    if (a.env) {
      info.appendChild(el("dt", null, t("v.env")));
      info.appendChild(el("dd", null, t("v.env." + a.env)));
    }
    if (a.vat) {
      info.appendChild(el("dt", null, t("v.vat")));
      info.appendChild(el("dd", null, a.vat));
    }
    if (a.db) {
      info.appendChild(el("dt", null, t("v.db")));
      info.appendChild(el("dd", null, a.db));
    }
    var m = Lk.mode(a.id);
    info.appendChild(el("dt", null, t("v.via")));
    info.appendChild(el("dd", null, t(m ? "v.via." + m : "v.via.none")));
    if (plat && plat.apps.length) {
      info.appendChild(el("dt", null, t("v.used")));
      info.appendChild(el("dd", null, plat.apps.map(appName).join(", ")));
    }
    c.appendChild(info);
    var has = svc.has[a.id];
    if (has === false) c.appendChild(el("p", "msg msg-dim", t("v.keysMissing")));
    if (svc.msg[a.id]) c.appendChild(el("p", "msg " + svc.msg[a.id].cls, svc.msg[a.id].text));

    if (svc.rename === a.id) {
      var rf = el("form", "pass");
      var val = { v: a.name };
      rf.appendChild(labelled(t("v.name"), "v-rn", textInput("v-rn", a.name, "", function (v) { val.v = v; })));
      var ok = el("button", "btn primary", t("v.rename"));
      ok.type = "submit";
      ok.setAttribute("data-k", "v.rn.ok");
      rf.appendChild(actions(button(t("v.cancel"), "v.rn.cancel", function () { svc.rename = null; render(); }), ok));
      rf.addEventListener("submit", function (e) { e.preventDefault(); Lk.edit(a.id, { name: val.v }); svc.rename = null; render(); });
      c.appendChild(rf);
    }
    if (svc.keysFor === a.id) {
      var kf = el("form", "pass");
      kf.setAttribute("autocomplete", "off");
      if (a.p !== "woo") {
        kf.appendChild(el("div", "hint", t("v.keys.hint." + a.p)));
        kf.appendChild(labelled(t("v.key"), "v-kck", textInput("v-kck", svc.keyForm.key, "", function (v) { svc.keyForm.key = v; }, "password")));
        if (a.p === "trello") kf.appendChild(labelled(t("v.token"), "v-ktok", textInput("v-ktok", svc.keyForm.token || "", "", function (v) { svc.keyForm.token = v; }, "password")));
      } else {
        kf.appendChild(el("div", "hint", t("v.keys.hint")));
        kf.appendChild(labelled(t("v.ck"), "v-kck", textInput("v-kck", svc.keyForm.ck, "ck_…", function (v) { svc.keyForm.ck = v; }, "password")));
        kf.appendChild(labelled(t("v.cs"), "v-kcs", textInput("v-kcs", svc.keyForm.cs, "cs_…", function (v) { svc.keyForm.cs = v; }, "password")));
      }
      var sk = el("button", "btn primary", t("v.saveKeys"));
      sk.type = "submit";
      sk.setAttribute("data-k", "v.k.ok");
      kf.appendChild(actions(button(t("v.cancel"), "v.k.cancel", function () { svc.keysFor = null; svc.keyForm = { ck: "", cs: "", key: "", token: "" }; render(); }), sk));
      kf.addEventListener("submit", function (e) {
        e.preventDefault();
        Lk.setKeys(a.id, a.p === "trello" ? { key: svc.keyForm.key, token: svc.keyForm.token || "" } : a.p !== "woo" ? { key: svc.keyForm.key } : { ck: svc.keyForm.ck, cs: svc.keyForm.cs }).then(function () {
          svc.keysFor = null;
          svc.keyForm = { ck: "", cs: "", key: "", token: "" };
          svc.has[a.id] = true;
          runTest(a.id);
        }, function (er) {
          svc.msg[a.id] = { cls: "msg-err", text: er && er.code === "keys" ? badKeys(a.p) : svcErr(er && er.code, a.p) };
          render();
        });
      });
      c.appendChild(kf);
    }

    var can = Lk.canKeySync();
    var ksRow = row(t("v.ks"), switchBtn(a.ks === 1, "v.ks:" + a.id, function (on) {
      if (on && !can) { svc.msg[a.id] = { cls: "msg-dim", text: t("v.ks.needSync") }; render(); return; }
      Lk.setKeySync(a.id, on);
      render();
    }, t("v.ks")), { hint: t("v.ks.hint") });
    c.appendChild(ksRow);

    var acts = actions(
      has !== false ? button(svc.busy[a.id] ? t("v.checking") : t("v.test"), "v.test:" + a.id, function () { if (!svc.busy[a.id]) runTest(a.id); }) : null,
      button(t("v.newKeys"), "v.keys:" + a.id, function () { svc.keysFor = a.id; svc.keyForm = { ck: "", cs: "", key: "", token: "" }; render(); var f = $("f-v-kck"); if (f) f.focus(); }, has === false ? "primary" : ""),
      button(t("v.rename"), "v.rn:" + a.id, function () { svc.rename = a.id; render(); var f = $("f-v-rn"); if (f) f.focus(); })
    );
    c.appendChild(acts);
    if (plat) plat.apps.forEach(function (id) {
      c.appendChild(linkRow(t("v.open", { app: appName(id) }), "v.open:" + id, function () {
        // Stock opens straight on its shop panel
        var p = parentWin();
        try { if (id === "stock" && p && typeof p.__orosOpenAt === "function") { p.__orosOpenAt("stock", { view: "shop" }); return; } } catch (e) {}
        act("openApp", id);
      }));
    });
    c.appendChild(el("p", "hint", t("v.remove.hint")));
    c.appendChild(actions(confirmBtn(t("v.remove"), t("v.remove.confirm"), "v.rm:" + a.id, function () {
      Lk.remove(a.id).then(function () { delete svc.has[a.id]; delete svc.msg[a.id]; render(); });
    }, "danger")));
    return c;
  }

  // ---------- 9. Section: System ----------
  function linkRow(label, key, onClick) {
    var b = el("button", "link-row");
    b.type = "button";
    b.setAttribute("data-k", key);
    b.appendChild(el("span", null, label));
    var ch = el("span", "chev");
    ch.innerHTML = ICON.chevron;                        // static icon
    b.appendChild(ch);
    b.addEventListener("click", onClick);
    return b;
  }

  function secSystem(host, s) {
    var c1 = card(null);
    var vr = row(t("x.version"), null);
    vr.appendChild(el("div", "version", "v" + s.version));
    c1.appendChild(vr);
    c1.appendChild(actions(button(t("x.updates"), "x.updates", function () { act("updates"); })));
    if (s.install) {
      c1.appendChild(row(t("x.install"), null, { hint: t("x.install.hint") }));
      c1.appendChild(actions(button(t("x.install"), "x.install", function () { act("install"); }, "primary")));
    }
    host.appendChild(c1);

    var has = {};
    (s.apps || []).forEach(function (id) { has[id] = true; });
    var c2 = card(t("x.more"));
    if (has.device) c2.appendChild(linkRow(t("x.device"), "x.device", function () { act("openApp", "device"); }));
    c2.appendChild(linkRow(t("x.about"), "x.about", function () { act("info"); }));
    c2.appendChild(linkRow(t("x.sharelinks"), "x.sharelinks", function () { act("shareLinks"); }));
    if (has.weather) c2.appendChild(linkRow(t("x.weather"), "x.weather", function () { act("openApp", "weather"); }));
    if (has.wallpaper) c2.appendChild(linkRow(t("x.wallgen"), "x.wallgen", function () { act("openApp", "wallpaper"); }));
    host.appendChild(c2);

    if (s.shortcuts && s.shortcuts.length) {
      var c3 = card(t("x.shortcuts"));
      var dl = el("dl", "keys");
      s.shortcuts.forEach(function (k) {
        dl.appendChild(el("dt", null, k.combo));
        dl.appendChild(el("dd", null, k.label));
      });
      c3.appendChild(dl);
      host.appendChild(c3);
    }

    // Multitasking: an experiment, off by default, this device only.
    if (s.multitask) {
      var mtc = card(t("mt.title"), "multitask");
      var h3 = mtc.querySelector("h3");
      if (h3) h3.parentNode.insertBefore(el("span", "scope badge-exp", t("mt.badge")), h3.nextSibling);
      mtc.appendChild(row(t("mt.on"), switchBtn(!!s.multitask.on, "multitask", function (v) { set("multitask", v); }, t("mt.on")),
        { hint: t("mt.hint", { n: s.multitask.slots }) }));
      if (s.multitask.on && s.multitask.open) mtc.appendChild(el("p", "hint", t("mt.open", { n: s.multitask.open })));
      host.appendChild(mtc);
    }

    var c4 = card(t("x.reset"));
    c4.classList.add("danger-card");
    c4.appendChild(el("p", "hint", t("x.reset.hint")));
    if (resetting) {
      c4.appendChild(el("p", "msg msg-dim", t("x.reset.working")));
    } else {
      c4.appendChild(actions(confirmBtn(t("x.reset"), t("x.reset.confirm"), "x.reset", function () {
        resetting = true;
        act("reset");
      }, "danger")));
    }
    host.appendChild(c4);
  }
  var resetting = false;

  // ---------- 10. Navigation + render ----------
  var current = null;        // open section id, or null = the list (narrow)

  function narrow() { return window.matchMedia(NARROW).matches; }

  function loadUi() {
    try {
      var v = JSON.parse(sessionStorage.getItem(UI_KEY) || "null");
      return v ? C.sectionOf(v.section) : null;
    } catch (e) { return null; }
  }
  function saveUi() {
    try { sessionStorage.setItem(UI_KEY, JSON.stringify({ section: current })); } catch (e) {}
  }

  function go(id, focusPage) {
    current = C.isSection(id) ? id : null;
    armed.key = null;
    saveUi();
    render();
    $("page").scrollTop = 0;
    if (focusPage) {
      var h = $("page-title");
      if (h) h.focus();
    }
  }

  var SECTION_FN = {
    appearance: secAppearance, menu: secMenu, notifications: secNotifications, sync: secSync,
    backup: secBackup, language: secLanguage, files: secFiles, solo: secSolo, services: secServices, system: secSystem
  };

  function renderNav(s) {
    var nav = $("nav");
    nav.innerHTML = "";
    var shown = current || (narrow() ? null : "appearance");
    C.SECTIONS.forEach(function (id) {
      var b = el("button", "nav-item" + (id === shown ? " on" : ""));
      b.type = "button";
      b.setAttribute("data-k", "nav:" + id);
      if (id === shown) b.setAttribute("aria-current", "page");
      var ic = el("span", "nav-ico");
      ic.innerHTML = ICON[id];                           // static icon
      b.appendChild(ic);
      var tx = el("span", "nav-txt");
      tx.appendChild(el("span", "nav-name", t("s." + id)));
      tx.appendChild(el("span", "nav-desc", t("d." + id)));
      b.appendChild(tx);
      if (id === "sync" && s) {
        var st = C.syncState(s.sync);
        b.appendChild(el("span", "nav-dot dot-" + st));
      }
      var ch = el("span", "chev");
      ch.innerHTML = ICON.chevron;                       // static icon
      b.appendChild(ch);
      b.addEventListener("click", function () { go(id, true); });
      nav.appendChild(b);
    });
  }

  // Repaint, keeping focus, caret and scroll (onChange can fire while
  // the user is typing the passphrase or holding a select).
  function render() {
    var s = snap();
    var page = $("page");
    var body = document.body;
    if (!s) {
      body.className = "no-shell";
      page.innerHTML = "";
      page.appendChild(el("p", "hint card-note", t("noShell")));
      $("nav").innerHTML = "";
      return;
    }
    var shown = current || (narrow() ? null : "appearance");
    body.className = shown ? "in-page" : "in-list";

    var ae = document.activeElement;
    var keepKey = ae && ae.getAttribute ? ae.getAttribute("data-k") : null;
    var caret = null;
    if (ae && ae.tagName === "INPUT" && /^(text|password)$/.test(ae.type)) {
      try { caret = [ae.selectionStart, ae.selectionEnd]; } catch (e) {}
    }
    var top = page.scrollTop;

    renderNav(s);
    $("back-btn").hidden = !(narrow() && shown);
    $("title").textContent = shown && narrow() ? t("s." + shown) : t("app");

    page.innerHTML = "";
    if (shown) {
      var h = el("h2", "page-title", t("s." + shown));
      h.id = "page-title";
      h.tabIndex = -1;
      page.appendChild(h);
      var inner = el("div", "page-body");
      SECTION_FN[shown](inner, s);
      page.appendChild(inner);
    }
    page.scrollTop = top;

    if (keepKey) {
      var again = document.querySelector('[data-k="' + keepKey.replace(/["\\]/g, "") + '"]');
      if (again) {
        again.focus();
        if (caret) { try { again.setSelectionRange(caret[0], caret[1]); } catch (e) {} }
      }
    }
  }

  // ---------- 11. Keyboard (Contract Β) + palette ----------
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = parentWin();
      if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // Escape on a phone page goes back to the list (not from a field).
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !narrow() || !current) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      e.preventDefault();
      e.stopPropagation();
      go(null);
    });
  }

  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      new MutationObserver(function () { inheritPalette(); }).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  // ---------- 12. Wiring & boot ----------
  var unsubscribe = null;

  function boot() {
    document.documentElement.lang = LANG;
    document.title = t("app") + " · orOS";
    $("nav").setAttribute("aria-label", t("sections"));
    var back = $("back-btn");
    back.setAttribute("aria-label", t("back"));
    back.title = t("back");
    back.addEventListener("click", function () { go(null); });

    inheritPalette();
    watchPalette();
    wireKeyboard();

    // Deep link: the shell staged one before opening us, or pushes one
    // while we are open (orosSettings.open, universal search).
    var target = null;
    try {
      var p = parentWin();
      if (p && typeof p.__orosTakeTarget === "function") target = p.__orosTakeTarget("settings");
    } catch (e) {}
    current = C.sectionOf(target) || loadUi();
    try { if (!target && sessionStorage.getItem(TR_KEY) === "1") { current = "language"; setTimeout(openTranslate, 0); } } catch (e) {}
    window.__orosOpenAt = function (tg) {
      var id = C.sectionOf(tg);
      if (id) go(id, true);
    };

    var S = shell();
    if (S) unsubscribe = S.onChange(render);
    var Lk = links(), unLinks = null;
    if (Lk && typeof Lk.onChange === "function") unLinks = Lk.onChange(function () { render(); });
    window.addEventListener("pagehide", function () {
      if (unsubscribe) { try { unsubscribe(); } catch (e) {} unsubscribe = null; }
      if (unLinks) { try { unLinks(); } catch (e) {} unLinks = null; }
    });
    var mq = window.matchMedia(NARROW);
    var onMq = function () { render(); };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);
    else if (typeof mq.addListener === "function") mq.addListener(onMq);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") render();
    });
    render();
  }

  boot();
})();
