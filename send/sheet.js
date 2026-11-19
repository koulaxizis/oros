// ============================================================
// orOS "Send to…" — send/sheet.js (shell side, v1.0.0)
// Loaded by shell.js on first use (after send/core.js), never at boot.
// open(opts, env) shows the sheet: the installed apps that take this
// item, one button each; a tap hands the item to that app through its
// own deep link (env.openAt = the shell's __orosOpenAt). The app opens
// a prefill (BR-W8-6): nothing is saved until the user saves there.
// "Copy" puts the item's text on the clipboard; "Keep in pocket"
// (POCKET-1, env.pocket) keeps it in the shell's Pocket; "Send to someone…"
// (when the sender gave a share item) opens share/ as before.
//   opts = { kind, data, share? }   (send/core.js kinds; share = the
//            sender's own "Send to someone" item { kind, data } for
//            share/, shown as one more button that calls env.share)
//   env  = { apps: [{ id, name }], icon(id) → Node|null, self, from,
//            openAt(app, target), share(item),
//            calendarNew(p), budgetNew(p),   (wave A3: BR-W8 / BR-B1)
//            pocket(kind, data) | null,   (POCKET-1: "Keep in pocket")
//            file(target, app) → Promise<bool>,   (files wave: a disk
//              file handed over as a one-shot token, BR-FO-4)
//            wallpaper(picture) → Promise<bool> } (files wave: after
//              this sheet's own "Use as wallpaper", THIS device only)
// Nothing is stored, nothing is synced. Text through textContent only;
// the icons are the shell's own constant SVG nodes.
// ES5, like the shell. Strings EN/EL here.
// ============================================================
(function () {
  "use strict";

  var C = window.OrosSendCore;
  var STR = {
    en: {
      title: "Send to an app", close: "Close", copy: "Copy", copied: "Copied", someone: "Send to someone…",
      copyFail: "Could not copy.", none: "No app in your orOS takes this.",
      failed: "Something went wrong. Try again.",
      hint: "It opens in the app you pick. Nothing is saved until you save it there.",
      wallAsk: "Use “{name}” as the wallpaper of this device?",
      wallHint: "Only on this device, nothing syncs. Settings › Wallpaper changes it back.",
      wallYes: "Use as wallpaper", cancel: "Cancel", wallDone: "The wallpaper of this device is set.",
      big: "This file is too big for that app.",
      pocket: "Keep in pocket"
    },
    el: {
      title: "Στείλε σε εφαρμογή", close: "Κλείσιμο", copy: "Αντιγραφή", copied: "Αντιγράφηκε", someone: "Στείλε σε κάποιον…",
      copyFail: "Η αντιγραφή απέτυχε.", none: "Καμία εφαρμογή του orOS σου δεν το δέχεται.",
      failed: "Κάτι πήγε στραβά. Δοκίμασε ξανά.",
      hint: "Ανοίγει στην εφαρμογή που θα διαλέξεις. Τίποτα δεν αποθηκεύεται πριν το αποθηκεύσεις εκεί.",
      wallAsk: "Να γίνει το «{name}» ταπετσαρία αυτής της συσκευής;",
      wallHint: "Μόνο σε αυτή τη συσκευή, δεν συγχρονίζεται. Το αλλάζεις πάλι στις Ρυθμίσεις › Ταπετσαρία.",
      wallYes: "Ως ταπετσαρία", cancel: "Άκυρο", wallDone: "Η ταπετσαρία αυτής της συσκευής άλλαξε.",
      big: "Το αρχείο είναι πολύ μεγάλο για αυτή την εφαρμογή.",
      pocket: "Στην τσέπη"
    }
  };
  function lang() { return window.orosLang === "el" ? "el" : "en"; }
  function T(k, name) {
    var s = (STR[lang()] || STR.en)[k];
    return name === undefined ? s : s.split("{name}").join(String(name).slice(0, 120));
  }
  function toast(text) {
    try {
      if (window.orosNotifs && typeof window.orosNotifs.transient === "function") {
        window.orosNotifs.transient({ ns: "system", title: text, body: "" });
      }
    } catch (e) {}
  }

  var CSS =
    "#osd-dlg{border:1px solid var(--border);border-radius:14px;background:var(--panel-bg);color:var(--text);" +
    "padding:18px;width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box}" +
    "#osd-dlg::backdrop{background:rgba(0,0,0,.45)}" +
    "#osd-dlg h3{margin:0 0 4px;font-size:16px}" +
    "#osd-dlg .osd-sum{margin:0 0 6px;font-weight:600;font-size:13.5px;overflow-wrap:anywhere}" +
    "#osd-dlg .osd-hint{margin:0 0 12px;font-size:12.5px;line-height:1.5;color:var(--text-dim)}" +
    "#osd-dlg .osd-apps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}" +
    "#osd-dlg .osd-app{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;padding:10px 6px;" +
    "border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--text);font:inherit;font-size:12.5px;" +
    "cursor:pointer;text-align:center;line-height:1.25}" +
    "#osd-dlg .osd-app:hover,#osd-dlg .osd-app:focus-visible,#osd-dlg .osd-foot button:hover{border-color:var(--accent)}" +
    "#osd-dlg .osd-app .osd-ico{width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:var(--accent)}" +
    "#osd-dlg .osd-app .osd-ico svg{width:24px;height:24px}" +
    "#osd-dlg .osd-app .osd-nm{overflow-wrap:anywhere}" +
    "#osd-dlg .osd-someone{display:block;width:100%;margin-top:8px;padding:10px 12px;border:1px solid var(--border);" +
    "border-radius:10px;background:transparent;color:var(--text);font:inherit;font-size:13.5px;cursor:pointer}" +
    "#osd-dlg .osd-someone:hover{border-color:var(--accent)}" +
    "#osd-dlg .osd-foot{display:flex;justify-content:space-between;gap:8px;margin-top:14px}" +
    "#osd-dlg .osd-foot button{padding:10px 14px;border:1px solid var(--border);border-radius:10px;background:transparent;" +
    "color:var(--text);font:inherit;font-size:13.5px;cursor:pointer}" +
    "#osd-dlg .osd-lead{display:flex;flex-wrap:wrap;gap:8px}" +
    "@media (max-width:360px){#osd-dlg .osd-apps{grid-template-columns:repeat(2,1fr)}}";
  function ensureCss() {
    if (document.getElementById("osd-css")) return;
    var st = document.createElement("style");
    st.id = "osd-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(text); });
    }
    return Promise.resolve(legacy(text));
  }
  function legacy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    (document.querySelector("dialog[open]") || document.body).appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    return ok;
  }
  function plain(kind, d) {
    if (kind === "text") return d.text;
    if (kind === "link") return d.url;
    if (kind === "items") return d.items.map(function (it) { return it.text; }).join("\n");
    if (kind === "files") return d.items.map(function (f) { return f.path; }).join("\n");
    return d.rows.map(function (r) { return r.join("\t"); }).join("\n");
  }

  function open(opts, env) {
    if (!C || !opts || !env) return;
    var kind = opts.kind, d = C.norm(kind, opts.data);
    if (!d) { toast(T("failed")); return; }
    var names = {};
    var ids = (env.apps || []).map(function (a) { names[a.id] = a.name; return a.id; });
    var list = C.appsFor(kind, d, ids, env.self);
    var share = opts.share && typeof opts.share === "object" && typeof env.share === "function" ? opts.share : null;
    // POCKET-1: env.pocket(kind, data) keeps it in the Pocket (null for
    // an item that is already there, and in Passwords and Settings).
    var pocket = typeof env.pocket === "function" ? env.pocket : null;
    if (!list.length && !share && !pocket) { toast(T("none")); return; }
    ensureCss();
    var stale = document.getElementById("osd-dlg");
    if (stale) { try { stale.close(); } catch (e) {} stale.remove(); }

    var dlg = el("dialog");
    dlg.id = "osd-dlg";
    dlg.setAttribute("aria-labelledby", "osd-h");
    var h = el("h3", "", T("title"));
    h.id = "osd-h";
    dlg.appendChild(h);
    dlg.appendChild(el("p", "osd-sum", C.summary(kind, d, lang())));
    dlg.appendChild(el("p", "osd-hint", T("hint")));
    var grid = el("div", "osd-apps");
    list.forEach(function (id) {
      var b = el("button", "osd-app");
      b.type = "button";
      b.setAttribute("data-app", id);
      var ico = el("span", "osd-ico");
      var node = null;
      try { node = env.icon ? env.icon(id) : null; } catch (e) { node = null; }
      if (node) ico.appendChild(node);
      b.appendChild(ico);
      b.appendChild(el("span", "osd-nm", names[id] || id));
      b.addEventListener("click", function () {
        var tg = C.target(id, kind, d, env.from, window.orosLang);
        dlg.close();
        if (!tg) { toast(T("failed")); return; }
        // Calendar and Budget open through the shell's own openers
        // (BR-W8, BR-B1); every other app through __orosOpenAt.
        var via = C.via ? C.via(id) : "";
        try {
          if (via === "wallpaper") askWallpaper(tg.picture, env);
          else if (via) { if (typeof env[via] !== "function" || settle(env[via](tg, id)) === false) toast(T("failed")); }
          else env.openAt(id, tg);
        } catch (e) { toast(T("failed")); }
      });
      grid.appendChild(b);
    });
    if (list.length) dlg.appendChild(grid);
    else dlg.appendChild(el("p", "osd-hint", T("none")));
    if (share) {
      var sb = el("button", "osd-someone", T("someone"));
      sb.type = "button";
      sb.addEventListener("click", function () { dlg.close(); env.share(share); });
      dlg.appendChild(sb);
    }
    var foot = el("div", "osd-foot");
    var cp = el("button", "", T("copy"));
    cp.type = "button";
    cp.addEventListener("click", function () {
      copy(plain(kind, d)).then(function (ok) { toast(T(ok ? "copied" : "copyFail")); });
    });
    var cl = el("button", "", T("close"));
    cl.type = "button";
    cl.addEventListener("click", function () { dlg.close(); });
    var lead = el("div", "osd-lead");
    lead.appendChild(cp);
    if (pocket) {
      var pk = el("button", "osd-pocket", T("pocket"));
      pk.type = "button";
      pk.addEventListener("click", function () { dlg.close(); try { pocket(kind, d); } catch (e) { toast(T("failed")); } });
      lead.appendChild(pk);
    }
    foot.appendChild(lead);
    foot.appendChild(cl);
    dlg.appendChild(foot);
    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    try { (grid.firstChild || dlg.querySelector("button")).focus(); } catch (e) {}
  }

  // A Promise from env.file / env.wallpaper: "big" or false → a toast.
  function settle(r) {
    if (r && typeof r.then === "function") {
      r.then(function (ok) { if (ok === "big") toast(T("big")); else if (!ok) toast(T("failed")); }, function () { toast(T("failed")); });
      return true;
    }
    return r;
  }
  // Wallpaper: a picture changes the desktop at once, so the sheet asks
  // first (BR-SEND-4: nothing changes before the person's own yes).
  function askWallpaper(pic, env) {
    if (!pic || typeof env.wallpaper !== "function") { toast(T("failed")); return; }
    var dlg = el("dialog");
    dlg.id = "osd-wall";
    dlg.className = "osd-wall";
    dlg.style.cssText = "border:1px solid var(--border);border-radius:14px;background:var(--panel-bg);color:var(--text);" +
      "padding:18px;width:min(380px,calc(100vw - 32px));box-sizing:border-box";
    var h = el("h3", "", T("wallAsk", pic.name));
    h.style.cssText = "margin:0 0 6px;font-size:15px;overflow-wrap:anywhere";
    dlg.appendChild(h);
    var p = el("p", "", T("wallHint"));
    p.style.cssText = "margin:0 0 14px;font-size:12.5px;line-height:1.5;color:var(--text-dim)";
    dlg.appendChild(p);
    var row = el("div");
    row.style.cssText = "display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap";
    function b(label, pri, fn) {
      var x = el("button", "", label);
      x.type = "button";
      x.style.cssText = "padding:10px 14px;border:1px solid " + (pri ? "var(--accent)" : "var(--border)") +
        ";border-radius:10px;background:transparent;color:var(--text);font:inherit;font-size:13.5px;cursor:pointer;min-height:40px";
      x.addEventListener("click", fn);
      row.appendChild(x);
      return x;
    }
    b(T("cancel"), false, function () { dlg.close(); });
    var yes = b(T("wallYes"), true, function () {
      dlg.close();
      var r;
      try { r = env.wallpaper(pic); } catch (e) { r = false; }
      Promise.resolve(r).then(function (ok) {
        toast(ok === true ? T("wallDone") : ok === "big" ? T("big") : T("failed"));
      }, function () { toast(T("failed")); });
    });
    dlg.appendChild(row);
    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    try { yes.focus(); } catch (e) {}
  }

  window.__orosSendImpl = { open: open };
})();
