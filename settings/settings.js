// ============================================================
// orOS Settings — App logic (v1.0.0)
// One place for the system settings that used to sit under the
// app list in the menu: appearance, notifications, sync, backups,
// language and search, system.
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
//   5. Section: Notifications
//   6. Section: Sync
//   7. Section: Backups
//   8. Section: Language & search
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
    system: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
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
          c5.appendChild(row(t("k.magnify"), switchBtn(d.magnify, "dock:magnify", function (v) { set("dock:magnify", v); }, t("k.magnify"))));
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

  // ---------- 5. Section: Notifications ----------
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

    var c2 = card(null);
    c2.appendChild(row(t("n.position"), select(C.POSITIONS.map(function (p) {
      return { value: p, label: t("n.pos." + p) };
    }), N.getSetting("position", "bottom-right"), "n.position", function (v) { nSet("position", v); }),
      { forId: "f-n.position" }));
    c2.appendChild(row(t("n.style"), select(C.STYLES.map(function (v) {
      return { value: v, label: v.charAt(0).toUpperCase() + v.slice(1) };
    }), N.getSetting("style", "oros"), "n.style", function (v) { nSet("style", v); }),
      { forId: "f-n.style" }));
    c2.appendChild(row(t("n.sound"), select(C.SOUNDS.map(function (v) {
      return { value: v, label: t("n.sound." + v) };
    }), N.getSetting("sound", "none"), "n.sound", function (v) { nSet("sound", v); }),
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

  // ---------- 6. Section: Sync ----------
  // The passphrase lives only in this field and in the shell call;
  // it survives repaints in memory and is cleared once used.
  var pass = { value: "", shown: false, remember: null };

  function secSync(host, s) {
    var y = s.sync;
    var st = C.syncState(y);
    var c1 = card(null);
    var status = el("div", "status status-" + st);
    status.appendChild(el("span", "dot"));
    var txt = el("div", "status-txt");
    txt.appendChild(el("div", "status-main",
      st === "off" ? t("y.status.off") : st === "locked" ? t("y.status.locked") :
      st === "dirty" ? t("y.status.dirty") : t("y.status.on")));
    if (y.email) txt.appendChild(el("div", "hint", y.email));
    status.appendChild(txt);
    c1.appendChild(status);

    if (st === "off") {
      if (y.available) {
        c1.appendChild(el("p", "hint", t("y.connect.hint")));
        c1.appendChild(actions(button(t("y.connect"), "y.connect", function () { act("sync.connect"); }, "primary")));
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
  function secLanguage(host, s) {
    var c1 = card(t("l.lang"), "lang");
    c1.appendChild(segmented([
      { value: "en", label: "English" }, { value: "el", label: "Ελληνικά" }
    ], s.lang, "lang", function (v) { set("lang", v); }, t("l.lang")));
    host.appendChild(c1);

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
    appearance: secAppearance, notifications: secNotifications, sync: secSync,
    backup: secBackup, language: secLanguage, system: secSystem
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
    window.__orosOpenAt = function (tg) {
      var id = C.sectionOf(tg);
      if (id) go(id, true);
    };

    var S = shell();
    if (S) unsubscribe = S.onChange(render);
    window.addEventListener("pagehide", function () {
      if (unsubscribe) { try { unsubscribe(); } catch (e) {} unsubscribe = null; }
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
