// ============================================================
// orOS "Send to…" — send/sheet.js (shell side, v1.0.0)
// Loaded by shell.js on first use (after send/core.js), never at boot.
// open(opts, env) shows the sheet: the installed apps that take this
// item, one button each; a tap hands the item to that app through its
// own deep link (env.openAt = the shell's __orosOpenAt). The app opens
// a prefill (BR-W8-6): nothing is saved until the user saves there.
// "Copy" puts the item's text on the clipboard; "Send to someone…"
// (when the sender gave a share item) opens share/ as before.
//   opts = { kind, data, share? }   (send/core.js kinds; share = the
//            sender's own "Send to someone" item { kind, data } for
//            share/, shown as one more button that calls env.share)
//   env  = { apps: [{ id, name }], icon(id) → Node|null, self, from,
//            openAt(app, target), share(item) }
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
      hint: "It opens in the app you pick. Nothing is saved until you save it there."
    },
    el: {
      title: "Στείλε σε εφαρμογή", close: "Κλείσιμο", copy: "Αντιγραφή", copied: "Αντιγράφηκε", someone: "Στείλε σε κάποιον…",
      copyFail: "Η αντιγραφή απέτυχε.", none: "Καμία εφαρμογή του orOS σου δεν το δέχεται.",
      failed: "Κάτι πήγε στραβά. Δοκίμασε ξανά.",
      hint: "Ανοίγει στην εφαρμογή που θα διαλέξεις. Τίποτα δεν αποθηκεύεται πριν το αποθηκεύσεις εκεί."
    }
  };
  function lang() { return window.orosLang === "el" ? "el" : "en"; }
  function T(k) { return (STR[lang()] || STR.en)[k]; }
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
    if (!list.length && !share) { toast(T("none")); return; }
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
        var tg = C.target(id, kind, d, env.from);
        dlg.close();
        if (!tg) { toast(T("failed")); return; }
        try { env.openAt(id, tg); } catch (e) { toast(T("failed")); }
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
    foot.appendChild(cp);
    foot.appendChild(cl);
    dlg.appendChild(foot);
    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    try { (grid.firstChild || dlg.querySelector("button")).focus(); } catch (e) {}
  }

  window.__orosSendImpl = { open: open };
})();
