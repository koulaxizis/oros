// ============================================================
// orOS — commands/bar.js (command bar, shell side, v1.2.0)
// Loaded by shell.js on first use (with commands/core.js and
// calendar/quickadd.js), never at boot. A small bar in the middle of
// the screen, over whatever is open (Ctrl+K, Ctrl+Alt+Shift+K):
//   1. the command, when the line is one ("New event · Sun 18/10 ·
//      10:00 · Dentist → Calendar"); Enter runs it;
//   2. (1.2.0, Quick window) "Add task: «…»" when the line is no
//      command and To-Do is installed; Enter adds it at once (To-Do
//      writes it and offers Undo). An app whose name is the whole line
//      comes before it;
//   3. the apps whose name matches; Enter opens the first;
//   4. (1.2.0) "In your data": up to DATA_MAX hits of the universal
//      search, only the apps switched on for search on this device;
//   5. "Ask the Assistant: «…»" when the Assistant is installed.
// An answer (calc, unit conversion) is a command row whose Enter copies.
// With the field empty: the last commands run (device-local, newest
// first); a click puts one back in the field to look at before Enter.
// Escape or a click outside closes it. The menu search field shows the
// same command row (shell.js); this bar is the quick way in from an app.
// Text only through textContent; the line is never run.
// window.orosCmdBar.open(host, text?)  host = {
//   lang(), parse(q) → cmd|null, describe(cmd) → {verb, detail},
//   appName(id), apps(q) → [{ id, name }], run(cmd, q), openApp(id),
//   ask: null | function (q), history() → [line], forget(),
//   addTask: null | function (q), data: null | function (q) →
//   Promise<[{ app, title, snippet, open() }]>, closed(acted),
//   full: true = fill the window (the Quick window) }
// closed(true) after a row ran, closed(false) when dismissed.
// ============================================================
(function () {
  "use strict";

  var STR = {
    en: { label: "Command or search", ph: "Type a command or an app… e.g. dentist tomorrow 10",
          ask: "Ask the Assistant: «{q}»", none: "Nothing found. Try “buy milk” or “spent 12€ coffee”.",
          close: "Close", apps: "Apps", recent: "Recent commands", forget: "Clear the list",
          task: "Add task: «{q}»", data: "In your data", busy: "Searching…" },
    el: { label: "Εντολή ή αναζήτηση", ph: "Γράψε μια εντολή ή εφαρμογή… π.χ. οδοντίατρος αύριο 10",
          ask: "Ρώτα τον Βοηθό: «{q}»", none: "Δεν βρέθηκε τίποτα. Δοκίμασε «γάλα στη λίστα» ή «ξόδεψα 12€ καφές».",
          close: "Κλείσιμο", apps: "Εφαρμογές", recent: "Πρόσφατες εντολές", forget: "Καθαρισμός λίστας",
          task: "Προσθήκη εργασίας: «{q}»", data: "Στα δεδομένα σου", busy: "Αναζήτηση…" }
  };

  var CSS = [
    "#oros-cmdbar{position:fixed;inset:0;z-index:10040;background:rgba(0,0,0,.35);display:flex;justify-content:center;",
    "align-items:flex-start;padding:12vh 16px 16px;box-sizing:border-box}",
    "#oros-cmdbar .cb-card{width:min(600px,100%);max-height:76vh;display:flex;flex-direction:column;background:var(--panel-bg);",
    "color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 34px var(--shadow);overflow:hidden}",
    "#oros-cmdbar input{box-sizing:border-box;width:100%;min-height:52px;padding:0 16px;border:none;border-bottom:1px solid var(--border);",
    "background:transparent;color:var(--text);font:inherit;font-size:16px;outline:none}",
    "#oros-cmdbar .cb-list{overflow-y:auto;padding:6px}",
    "#oros-cmdbar .cb-row{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:6px 10px;box-sizing:border-box;",
    "border:none;border-radius:8px;background:transparent;color:var(--text);font:inherit;font-size:14px;text-align:left;cursor:pointer}",
    "#oros-cmdbar .cb-row[aria-selected=true]{background:var(--accent-soft)}",
    "#oros-cmdbar .cb-row .cb-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
    "#oros-cmdbar .cb-row .cb-verb{font-weight:600}",
    "#oros-cmdbar .cb-row .cb-detail{color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "#oros-cmdbar .cb-row .cb-app{flex:0 0 auto;font-size:12px;color:var(--text-dim);max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "#oros-cmdbar .cb-row.cb-cmd .cb-verb{color:var(--accent)}",
    "#oros-cmdbar .cb-head{margin:6px 10px 2px;font-size:12px;color:var(--text-dim)}",
    "#oros-cmdbar .cb-none{margin:10px;font-size:13px;color:var(--text-dim)}",
    "#oros-cmdbar .cb-past .cb-verb{font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "#oros-cmdbar .cb-forget .cb-verb{font-weight:400;font-size:13px;color:var(--text-dim)}",
    "#oros-cmdbar .cb-cmd .cb-verb{overflow-wrap:anywhere}",
    "#oros-cmdbar .cb-hit .cb-verb{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "#oros-cmdbar.cb-full{padding:0;background:var(--panel-bg)}",
    "#oros-cmdbar.cb-full .cb-card{width:100%;max-height:100%;height:100%;border:none;border-radius:0;box-shadow:none}",
    "@media (max-width:480px){#oros-cmdbar{padding-top:8px}}"
  ].join("");

  var box = null;
  var DATA_MAX = 6;

  function style() {
    if (document.getElementById("oros-cmdbar-css")) return;
    var s = document.createElement("style");
    s.id = "oros-cmdbar-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function open(host, text) {
    if (box) { var i0 = box.querySelector("input"); if (i0) { i0.focus(); i0.select(); } return; }
    style();
    // en / el here; another language from the "commands" pack (the shell loads it).
    var I = window.orosI18n, code = I ? I.lang() : host.lang();
    var L = (code === "en" || code === "el") ? STR[code] : I && I.known(code) ? I.table(STR, "commands", code) : STR.en;
    Object.keys(STR.en).forEach(function (k) { if (!L[k]) L[k] = STR.en[k]; });   // a pack older than 1.2.0
    var prevFocus = document.activeElement;
    box = el("div");
    box.id = "oros-cmdbar";
    if (host.full) box.className = "cb-full";   // the Quick window: the bar is the whole page
    var card = el("div", "cb-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", L.label);
    var input = el("input");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = L.ph;
    input.setAttribute("aria-label", L.label);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "cb-list");
    input.value = typeof text === "string" ? text : "";
    var list = el("div", "cb-list");
    list.id = "cb-list";
    list.setAttribute("role", "listbox");
    card.appendChild(input);
    card.appendChild(list);
    box.appendChild(card);

    var rows = [], sel = 0, token = 0, acted = false;

    function row(cls, verb, detail, app, fn, at) {
      var b = el("button", "cb-row" + (cls ? " " + cls : ""));
      b.type = "button";
      b.tabIndex = -1;
      b.id = "cb-r" + rows.length;
      b.setAttribute("role", "option");
      var main = el("span", "cb-main");
      main.appendChild(el("span", "cb-verb", verb));
      if (detail) main.appendChild(el("span", "cb-detail", detail));
      b.appendChild(main);
      if (app) b.appendChild(el("span", "cb-app", app));
      b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
      b.addEventListener("mousemove", function () { pick(rows.indexOf(b)); });
      (at || list).appendChild(b);
      rows = Array.prototype.slice.call(list.querySelectorAll(".cb-row"));
      return b;
    }
    function short(q) { return q.length > 60 ? q.slice(0, 59) + "…" : q; }
    // i18n-inline-ok: Greek folding (final ς = σ) is matching data, not UI text
    function fold(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ς/g, "σ").trim(); }

    function pick(i) {
      if (!rows.length) { input.removeAttribute("aria-activedescendant"); return; }
      sel = Math.max(0, Math.min(i, rows.length - 1));
      rows.forEach(function (r, j) { r.setAttribute("aria-selected", String(j === sel)); });
      input.setAttribute("aria-activedescendant", rows[sel].id);
      try { rows[sel].scrollIntoView({ block: "nearest" }); } catch (e) {}
    }

    function paint() {
      list.textContent = "";
      rows = [];
      var q = input.value.trim();
      if (!q) {
        var past = host.history ? host.history() : [];
        if (past.length) {
          list.appendChild(el("div", "cb-head", L.recent));
          past.forEach(function (line) {
            row("cb-past", line, "", "", function () { input.value = line; paint(); input.focus(); });
          });
          row("cb-forget", L.forget, "", "", function () { if (host.forget) host.forget(); paint(); input.focus(); });
        }
        pick(0);
        return;
      }
      var cmd = host.parse(q);
      if (cmd) {
        var d = host.describe(cmd);
        row("cb-cmd", d.verb + (cmd.kind === "open" ? " " + host.appName(cmd.app) : ""), d.detail,
            cmd.kind === "open" ? "" : d.hint || "→ " + host.appName(cmd.app), function () { done(); host.run(cmd, q); });
      }
      var apps = host.apps(q).slice(0, 6);
      var exact = apps.length && fold(apps[0].name) === fold(q);
      function appRows() {
        if (!apps.length) return;
        list.appendChild(el("div", "cb-head", L.apps));
        apps.forEach(function (a) { row("", a.name, "", "", function () { done(); host.openApp(a.id); }); });
      }
      if (exact) appRows();
      if (!cmd && host.addTask && q.length <= 300) {
        row("cb-cmd cb-task", L.task.replace("{q}", short(q)), "", "", function () { done(); host.addTask(q); });
      }
      if (!exact) appRows();
      var dataAt = null;
      if (host.data) {
        dataAt = el("div", "cb-data");
        list.appendChild(dataAt);
        fillData(q, dataAt);
      }
      if (host.ask) row("cb-ask", L.ask.replace("{q}", short(q)), "", "",
                        function () { done(); host.ask(q); });
      if (!rows.length && !dataAt) list.appendChild(el("p", "cb-none", L.none));
      pick(0);
    }

    // The data rows come later (providers load on the first search);
    // a newer line, or a closed bar, drops an older answer.
    function fillData(q, at) {
      var my = ++token;
      var p;
      try { p = host.data(q); } catch (e) { p = null; }
      if (!p || typeof p.then !== "function") return;
      var wait = setTimeout(function () {
        if (my === token && box && !at.firstChild) at.appendChild(el("div", "cb-head", L.busy));
      }, 300);
      p.then(function (hits) {
        clearTimeout(wait);
        if (my !== token || !box || !at.isConnected) return;
        at.textContent = "";
        hits = Array.isArray(hits) ? hits.slice(0, DATA_MAX) : [];
        var keep = rows[sel];
        rows = Array.prototype.slice.call(list.querySelectorAll(".cb-row"));
        if (hits.length) {
          at.appendChild(el("div", "cb-head", L.data));
          hits.forEach(function (h) {
            row("cb-hit", String(h.title || ""), String(h.snippet || ""), String(h.app || ""),
                function () { done(); h.open(); }, at);
          });
        }
        var none = list.querySelector(".cb-none");
        if (none && rows.length) none.parentNode.removeChild(none);
        if (!rows.length && !none) list.appendChild(el("p", "cb-none", L.none));
        pick(keep && rows.indexOf(keep) >= 0 ? rows.indexOf(keep) : 0);
      }, function () { clearTimeout(wait); if (my === token) at.textContent = ""; });
    }

    function done() { acted = true; close(); }

    function close() {
      if (!box) return;
      token++;
      window.removeEventListener("keydown", onKey, true);
      if (box.parentNode) box.parentNode.removeChild(box);
      box = null;
      try { if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus(); } catch (e) {}
      if (host.closed) { try { host.closed(acted); } catch (e) {} }
    }

    function onKey(e) {
      if (!box) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); pick(sel + 1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); pick(sel - 1); return; }
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        if (rows[sel]) rows[sel].click();
        return;
      }
      if (e.key === "Tab") { e.preventDefault(); input.focus(); return; }
      // Ctrl+K again closes; other shell shortcuts wait.
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyK") { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
      if (e.ctrlKey && e.altKey && e.shiftKey) e.stopImmediatePropagation();
    }

    input.addEventListener("input", paint);
    box.addEventListener("click", function (e) { if (e.target === box) close(); e.stopPropagation(); });
    document.body.appendChild(box);
    window.addEventListener("keydown", onKey, true);
    paint();
    input.focus();
    try { input.select(); } catch (e) {}
  }

  window.orosCmdBar = { open: open, isOpen: function () { return !!box; } };
})();
