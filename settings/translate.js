// ============================================================
// orOS Settings — Help translate (settings/translate.js)
// Loaded on demand from Settings › Language & search. A translator
// picks a language (one of i18n.js's pack languages) and a part of
// orOS (i18n/apps.json), sees English and Greek next to an empty line
// for each string, and writes. Lines are kept on this device only
// (localStorage "oros-i18n-local", never synced) and i18n.js uses
// them at once, through the same checks as a pack. Send = the pack
// file (orosPack(…)) to download or share, plus the GitHub upload
// page of the language folder: a translation gets into orOS only
// through a reviewed pull request.
// The apps' scripts are read as TEXT (i18n-tables.js), never run.
// Versioning: orOS-wide version lives ONLY in shell.js.
// ============================================================

(function () {
  "use strict";

  var I = window.orosI18n, TB = window.orosI18nTables;
  var UPLOAD = "https://github.com/koulaxizis/oros/upload/main/i18n/";
  var PACK_RE = /^\s*orosPack\("([a-z]{2,3}(?:-[A-Z]{2})?)", "([a-z0-9][a-z0-9-]{0,40})", (\{[\s\S]*\})\);\s*$/;

  var ui = null;        // { t, uiLang, onClose }
  var st = null;        // current state, see open()
  var root = null, saveTimer = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function t(k, vars) { return ui.t(k, vars); }
  function stamp(url) { return url + (I.ver ? "?v=" + encodeURIComponent(I.ver) : ""); }

  function getText(url, fresh) {
    return fetch(url, fresh ? { cache: "no-cache" } : undefined).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  // ---- Data ----
  function packLangs() {
    return I.LANGS.filter(function (l) { return l.code !== "en" && l.code !== "el"; });
  }

  function localAll() {
    try {
      var v = JSON.parse(localStorage.getItem(I.LOCAL_KEY) || "null");
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }
  function localGet(code, app) {
    var a = localAll()[code];
    var t2 = a && a[app];
    return t2 && typeof t2 === "object" && !Array.isArray(t2) ? t2 : {};
  }
  function localPut(code, app, table) {
    var all = localAll();
    all[code] = all[code] && typeof all[code] === "object" ? all[code] : {};
    if (Object.keys(table).length) all[code][app] = table; else delete all[code][app];
    if (!Object.keys(all[code]).length) delete all[code];
    try { localStorage.setItem(I.LOCAL_KEY, JSON.stringify(all)); return true; } catch (e) { return false; }
  }

  // The pack file in the repository (text, parsed as JSON, never run).
  function repoPack(code, app) {
    return getText("../i18n/" + code + "/" + app + ".js", true).then(function (txt) {
      var m = PACK_RE.exec(txt);
      if (!m || m[1] !== code || m[2] !== app) return {};
      var o = JSON.parse(m[3]), out = {};
      Object.keys(o).forEach(function (k) { if (typeof o[k] === "string") out[k] = o[k]; });
      return out;
    }).catch(function () { return {}; });
  }

  // An app's English and Greek strings: every table of its files.
  function appStrings(entry) {
    return Promise.all(entry.files.map(function (f) {
      if (!/^[a-z0-9][a-z0-9/._-]{0,120}\.js$/.test(f) || f.indexOf("..") !== -1) return "";
      return getText(stamp("../" + f));
    })).then(function (texts) {
      var rows = [], seen = {};
      texts.forEach(function (txt, i) {
        TB.tablesIn(txt, entry.files[i]).forEach(function (tb) {
          tb.en.forEach(function (v, k) {
            if (seen[k] || typeof v !== "string") return;
            seen[k] = true;
            rows.push({ key: k, en: v, el: typeof tb.el.get(k) === "string" ? tb.el.get(k) : "" });
          });
        });
      });
      return rows;
    });
  }

  function marks(s) { return (String(s).match(/\{[A-Za-z0-9_.]+\}/g) || []).sort(); }
  function tags(s) { return (String(s).match(/<\/?[A-Za-z][^>]*>/g) || []).sort(); }

  // "" ok/empty, else the message for a value that would show English.
  function problem(row, v) {
    if (!v || !v.trim()) return "";
    if (marks(row.en).join("|") !== marks(v).join("|")) return t("tr.keep.ph", { list: marks(row.en).join(" ") || "—" });
    if (tags(row.en).join("|") !== tags(v).join("|")) return t("tr.keep.tags");
    return "";
  }
  function valueOf(row) {
    var l = st.local[row.key];
    return typeof l === "string" ? l : (st.repo[row.key] || "");
  }
  function done(row) { var v = valueOf(row); return !!v.trim() && I.fits(row.en, v); }

  // ---- Saving (debounced; only lines that differ from the repository) ----
  function save() {
    saveTimer = null;
    var out = {};
    st.rows.forEach(function (r) {
      var v = st.local[r.key];
      if (typeof v === "string" && v.trim() && v !== st.repo[r.key]) out[r.key] = v;
    });
    st.local = out;
    var ok = localPut(st.code, st.app, out);
    var s = root.querySelector(".tr-status");
    if (s) s.textContent = ok ? t("tr.saved") : t("tr.full");
    paintCount();
  }

  // The pack file: the repository's lines and this device's, fitting only.
  function packText() {
    var out = {}, keys = st.rows.map(function (r) { return r.key; }).sort();
    keys.forEach(function (k) {
      var r = st.byKey[k], v = valueOf(r);
      if (v.trim() && I.fits(r.en, v)) out[k] = v;
    });
    return 'orosPack("' + st.code + '", "' + st.app + '", ' + JSON.stringify(out, null, 1) + ");\n";
  }
  function packFile() {
    return new File([packText()], st.app + ".js", { type: "text/javascript" });
  }

  // ---- UI ----
  function paintCount() {
    var n = 0;
    st.rows.forEach(function (r) { if (done(r)) n++; });
    var c = root.querySelector(".tr-count");
    if (c) c.textContent = t("tr.count", { done: n, total: st.rows.length });
  }

  function rowNode(r) {
    var box = el("div", "tr-row");
    box.appendChild(el("div", "tr-key", r.key));
    var en = el("div", "tr-en", r.en);
    en.lang = "en";
    box.appendChild(en);
    if (r.el) { var gr = el("div", "tr-el", r.el); gr.lang = "el"; box.appendChild(gr); }
    var ta = el("textarea", "tr-in");
    ta.lang = st.code;
    ta.rows = Math.min(6, Math.max(1, Math.ceil(r.en.length / 40)));
    ta.value = valueOf(r);
    ta.setAttribute("data-k", "tr:" + r.key);
    ta.setAttribute("aria-label", r.en.slice(0, 120));
    ta.spellcheck = true;
    var msg = el("div", "tr-msg");
    msg.setAttribute("aria-live", "polite");
    function check() {
      var p = problem(r, ta.value);
      msg.textContent = p;
      box.classList.toggle("bad", !!p);
    }
    ta.addEventListener("input", function () {
      st.local[r.key] = ta.value;
      check();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 400);
    });
    check();
    box.appendChild(ta);
    box.appendChild(msg);
    return box;
  }

  function paintList() {
    var list = root.querySelector(".tr-list");
    list.innerHTML = "";
    if (st.error) { list.appendChild(el("p", "hint warn", t("tr.fail"))); return; }
    if (!st.rows) { list.appendChild(el("p", "hint", t("tr.loading"))); return; }
    var shown = st.rows.filter(function (r) { return !st.onlyMissing || !done(r) || st.local[r.key] !== undefined; });
    if (!shown.length) { list.appendChild(el("p", "hint", t("tr.none"))); return; }
    var frag = document.createDocumentFragment();
    shown.forEach(function (r) { frag.appendChild(rowNode(r)); });
    list.appendChild(frag);
  }

  function load() {
    var entry = null;
    st.apps.forEach(function (a) { if (a.app === st.app) entry = a; });
    st.rows = null; st.error = false;
    paintList();
    var code = st.code, app = st.app;
    Promise.all([entry ? appStrings(entry) : Promise.reject(new Error("no app")), repoPack(code, app)])
      .then(function (r) {
        if (!st || st.code !== code || st.app !== app) return;
        st.rows = r[0]; st.repo = r[1]; st.local = localGet(code, app);
        st.byKey = {};
        st.rows.forEach(function (x) { st.byKey[x.key] = x; });
        paintList(); paintCount();
      }, function () {
        if (!st || st.code !== code || st.app !== app) return;
        st.error = true; paintList();
      });
  }

  function appLabel(a) {
    if (a === "shell") return t("tr.app.shell");
    var p = window.parent, k = "app." + a, v = k;
    try { if (p && typeof p.t === "function") v = p.t(k); } catch (e) {}
    return v === k ? a : v;
  }

  function select(options, current, key, onPick, label) {
    var s = el("select", "sel");
    s.setAttribute("data-k", key);
    s.setAttribute("aria-label", label);
    options.forEach(function (o) {
      var op = el("option", null, o.label);
      op.value = o.value;
      if (o.value === current) op.selected = true;
      s.appendChild(op);
    });
    s.addEventListener("change", function () { onPick(s.value); });
    return s;
  }

  function btn(label, key, onClick, cls) {
    var b = el("button", "btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.setAttribute("data-k", key);
    b.addEventListener("click", onClick);
    return b;
  }

  function build() {
    root = el("div", "tr");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "tr-title");

    var head = el("header", "tr-head");
    var back = el("button", "icon-btn");
    back.type = "button";
    back.setAttribute("aria-label", t("tr.close"));
    back.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 6 9 12 15 18"/></svg>';   // static icon
    back.addEventListener("click", close);
    head.appendChild(back);
    var h = el("h2", null, t("tr.title"));
    h.id = "tr-title";
    head.appendChild(h);
    root.appendChild(head);

    var body = el("div", "tr-body");
    var bar = el("div", "tr-bar");
    bar.appendChild(select(packLangs().map(function (l) { return { value: l.code, label: l.name }; }),
      st.code, "tr-lang", function (v) { flush(); st.code = v; load(); }, t("tr.lang")));
    bar.appendChild(select(st.apps.map(function (a) { return { value: a.app, label: appLabel(a.app) }; }),
      st.app, "tr-app", function (v) { flush(); st.app = v; load(); }, t("tr.app")));
    var only = el("label", "check");
    var cb = el("input");
    cb.type = "checkbox";
    cb.checked = st.onlyMissing;
    cb.setAttribute("data-k", "tr-only");
    cb.addEventListener("change", function () { flush(); st.onlyMissing = cb.checked; paintList(); });
    only.appendChild(cb);
    only.appendChild(el("span", null, t("tr.missing")));
    bar.appendChild(only);
    body.appendChild(bar);
    var meta = el("p", "hint tr-meta");
    meta.appendChild(el("span", "tr-count"));
    meta.appendChild(document.createTextNode(" · "));
    meta.appendChild(el("span", "tr-status", t("tr.device")));
    body.appendChild(meta);
    body.appendChild(el("p", "hint", t("tr.intro")));
    body.appendChild(el("div", "tr-list"));
    body.appendChild(el("p", "hint tr-send", t("tr.send.hint")));
    root.appendChild(body);

    var foot = el("div", "tr-foot");
    var acts = el("div", "actions");
    acts.appendChild(btn(t("tr.try"), "tr-try", tryIt, "primary"));
    acts.appendChild(btn(t("tr.download"), "tr-download", download));
    try {
      if (navigator.canShare && navigator.canShare({ files: [new File([""], "x.js", { type: "text/javascript" })] })) {
        acts.appendChild(btn(t("tr.share"), "tr-share", share));
      }
    } catch (e) {}
    acts.appendChild(btn(t("tr.github"), "tr-github", github));
    var clr = btn(t("tr.clear"), "tr-clear", function () {
      if (!clr.classList.contains("armed")) {
        clr.classList.add("armed"); clr.textContent = t("tr.clear.confirm");
        setTimeout(function () { clr.classList.remove("armed"); clr.textContent = t("tr.clear"); }, 4000);
        return;
      }
      clr.classList.remove("armed"); clr.textContent = t("tr.clear");
      st.local = {}; localPut(st.code, st.app, {});
      paintList(); paintCount();
    }, "danger");
    acts.appendChild(clr);
    foot.appendChild(acts);
    root.appendChild(foot);

    root.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    document.body.appendChild(root);
    document.body.classList.add("tr-open");
    back.focus();
  }

  function flush() { if (saveTimer) { clearTimeout(saveTimer); save(); } }

  function tryIt() {
    flush();
    if (I.lang() !== st.code && ui.setLang) { ui.setLang(st.code); return; }
    try { window.top.location.reload(); } catch (e) {}
  }
  function download() {
    flush();
    var url = URL.createObjectURL(packFile());
    var a = el("a");
    a.href = url; a.download = st.app + ".js";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function share() {
    flush();
    navigator.share({ files: [packFile()], title: "orOS · " + st.code + " · " + st.app }).catch(function () {});
  }
  function github() {
    flush();
    window.open(UPLOAD + encodeURIComponent(st.code), "_blank", "noopener");
  }

  function close() {
    flush();
    if (root) root.remove();
    root = null; st = null;
    document.body.classList.remove("tr-open");
    if (ui && ui.onClose) ui.onClose();
  }

  // opts: { t(key, vars), setLang(code), onClose() }
  function open(opts) {
    if (root) return;
    ui = opts;
    var langs = packLangs();
    if (!langs.length) return;
    var cur = I.lang();
    st = { code: langs.some(function (l) { return l.code === cur; }) ? cur : langs[0].code,
           app: "shell", apps: [], rows: null, repo: {}, local: {}, byKey: {}, onlyMissing: true, error: false };
    getText("../i18n/apps.json", true).then(function (txt) {
      var j = JSON.parse(txt);
      st.apps = (j && Array.isArray(j.apps) ? j.apps : []).filter(function (a) {
        return a && /^[a-z0-9][a-z0-9-]{0,40}$/.test(a.app) && Array.isArray(a.files);
      });
      if (!st.apps.length) throw new Error("no apps");
      build(); load();
    }).catch(function () {
      st.apps = [{ app: "shell", files: ["translations.js"] }];
      build(); load();
    });
  }

  window.SettingsTranslate = { open: open, close: close };
})();
