// ============================================================
// orOS — commands/bar.js (command bar, shell side, v1.1.0)
// Loaded by shell.js on first use (with commands/core.js and
// calendar/quickadd.js), never at boot. A small bar in the middle of
// the screen, over whatever is open (Ctrl+K, Ctrl+Alt+Shift+K):
//   1. the command, when the line is one ("New event · Sun 18/10 ·
//      10:00 · Dentist → Calendar"); Enter runs it;
//   2. the apps whose name matches; Enter opens the first;
//   3. "Ask the Assistant: «…»" when the Assistant is installed.
// An answer (calc, unit conversion) is a command row whose Enter copies.
// With the field empty: the last commands run (device-local, newest
// first); a click puts one back in the field to look at before Enter.
// Escape or a click outside closes it. The menu search field shows the
// same command row (shell.js); this bar is the quick way in from an app.
// Text only through textContent; the line is never run.
// window.orosCmdBar.open(host, text?)  host = {
//   lang(), parse(q) → cmd|null, describe(cmd) → {verb, detail},
//   appName(id), apps(q) → [{ id, name }], run(cmd, q), openApp(id),
//   ask: null | function (q), history() → [line], forget() }
// ============================================================
(function () {
  "use strict";

  var STR = {
    en: { label: "Command or search", ph: "Type a command or an app… e.g. dentist tomorrow 10",
          ask: "Ask the Assistant: «{q}»", none: "Nothing found. Try “buy milk” or “spent 12€ coffee”.",
          close: "Close", apps: "Apps", recent: "Recent commands", forget: "Clear the list" },
    el: { label: "Εντολή ή αναζήτηση", ph: "Γράψε μια εντολή ή εφαρμογή… π.χ. οδοντίατρος αύριο 10",
          ask: "Ρώτα τον Βοηθό: «{q}»", none: "Δεν βρέθηκε τίποτα. Δοκίμασε «γάλα στη λίστα» ή «ξόδεψα 12€ καφές».",
          close: "Κλείσιμο", apps: "Εφαρμογές", recent: "Πρόσφατες εντολές", forget: "Καθαρισμός λίστας" }
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
    "@media (max-width:480px){#oros-cmdbar{padding-top:8px}}"
  ].join("");

  var box = null;

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
    var prevFocus = document.activeElement;
    box = el("div");
    box.id = "oros-cmdbar";
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

    var rows = [], sel = 0;

    function row(cls, verb, detail, app, fn) {
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
      rows.push(b);
      list.appendChild(b);
    }

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
            cmd.kind === "open" ? "" : d.hint || "→ " + host.appName(cmd.app), function () { close(); host.run(cmd, q); });
      }
      var apps = host.apps(q).slice(0, 6);
      if (apps.length) {
        list.appendChild(el("div", "cb-head", L.apps));
        apps.forEach(function (a) { row("", a.name, "", "", function () { close(); host.openApp(a.id); }); });
      }
      if (host.ask) row("cb-ask", L.ask.replace("{q}", q.length > 60 ? q.slice(0, 59) + "…" : q), "", "",
                        function () { close(); host.ask(q); });
      if (!rows.length) list.appendChild(el("p", "cb-none", L.none));
      pick(0);
    }

    function close() {
      if (!box) return;
      window.removeEventListener("keydown", onKey, true);
      if (box.parentNode) box.parentNode.removeChild(box);
      box = null;
      try { if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus(); } catch (e) {}
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
