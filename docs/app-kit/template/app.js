// ============================================================
// orOS My App — the app inside the shell frame
// Boot order (OROS_BIBLE.md Part VI "Boot sequence"):
//   load → applyI18n → wire → registerSync → inheritPalette →
//   watchPalette → render → take a pending deep link.
// Rules that apply to every orOS app:
//   - R8: this frame has no shell globals; read every shell API
//     from window.parent, guarded, so ?standalone still works;
//   - registerSlice gets FIVE arguments, the merge is the fifth;
//   - a pulled slice never marks the app dirty (R6);
//   - user text goes in with textContent, never innerHTML.
// ============================================================
(function () {
  "use strict";

  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("myapp/app.js v" + (SCRIPT_V || "?") + " boot");
  })();

  var APP_ID = "myapp";
  var STORAGE_KEY = "oros-myapp-data";
  var C = window.MyAppCore;

  // ---------- 1. Language (every string in English and Greek) ----------
  var STR = {
    en: {
      "app.name":  "My App",
      "add.label": "New item",
      "add.ph":    "Write something…",
      "btn.add":   "Add",
      "btn.del":   "Delete",
      "done":      "Done",
      "empty":     "Nothing here yet. Write something above and press Add.",
      "deleted":   "Deleted",
      "full":      "This device is out of storage space. The change was not saved."
    },
    el: {
      "app.name":  "Η εφαρμογή μου",
      "add.label": "Νέο στοιχείο",
      "add.ph":    "Γράψε κάτι…",
      "btn.add":   "Προσθήκη",
      "btn.del":   "Διαγραφή",
      "done":      "Έγινε",
      "empty":     "Δεν υπάρχει τίποτα ακόμα. Γράψε κάτι από πάνω και πάτησε Προσθήκη.",
      "deleted":   "Διαγράφηκε",
      "full":      "Ο χώρος αποθήκευσης της συσκευής γέμισε. Η αλλαγή δεν αποθηκεύτηκε."
    }
  };

  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  function t(k) { return STR[LANG][k] || STR.en[k] || k; }

  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) { n.placeholder = t(n.getAttribute("data-i18n-ph")); });
    document.title = t("app.name") + " · orOS";
  }

  // ---------- 2. Data: local first, then sync ----------
  var data = C.empty();

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function load() {
    try { data = C.normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch (e) { data = C.empty(); }
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, C.serialize(data)); return true; }
    catch (e) { toast(t("full")); return false; }
  }

  // Every edit by the user ends here: write, then tell sync.
  function save(next) {
    data = next;
    if (!persist()) return;
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
    render();
  }

  // The getter returns a canonical copy of what travels, nothing
  // device-local. The setter folds in local edits through the same
  // merge, persists with no markDirty (R6) and repaints, no toast.
  function sliceGet() { return C.normalize(data); }
  function sliceSet(incoming) {
    var merged = C.merge(data, incoming);
    if (C.serialize(merged) === C.serialize(data)) return;
    data = merged;
    persist();
    render();
  }

  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    try { api.registerSlice(APP_ID, sliceGet, sliceSet, STORAGE_KEY, C.merge); }   // 5 args, always
    catch (e) { /* engine busy: the next boot registers again */ }
  }

  // ---------- 3. Palette: follow the shell's theme and skin (G3) ----------
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--panel-bg", "--border", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }

  // ---------- 4. Screen ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  var toastTimer = 0;
  function toast(msg) {
    var box = $("toast");
    box.textContent = msg;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3000);
  }

  function render() {
    var list = $("list"), items = C.live(data);
    list.textContent = "";
    items.forEach(function (it) {
      var li = el("li", it.done ? "done" : "");
      li.dataset.id = it.id;
      var box = el("input");
      box.type = "checkbox";
      box.checked = it.done;
      box.setAttribute("aria-label", t("done"));
      box.addEventListener("change", function () { save(C.update(data, it.id, { done: box.checked }, Date.now())); });
      var del = el("button", "chip del", t("btn.del"));
      del.type = "button";
      del.addEventListener("click", function () { save(C.remove(data, it.id, Date.now())); toast(t("deleted")); });
      li.appendChild(box);
      li.appendChild(el("span", "txt", it.text));
      li.appendChild(del);
      list.appendChild(li);
    });
    $("empty").hidden = items.length > 0;
  }

  function wire() {
    $("add-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var inp = $("add-text");
      if (!inp.value.trim()) return;
      save(C.add(data, inp.value, Date.now()));
      inp.value = "";
      inp.focus();
    });
  }

  // ---------- 5. Deep link: search hits and other apps open an item ----------
  // target = { item: id }. Unknown ids are ignored.
  window.__orosOpenAt = function (target) {
    var id = target && typeof target.item === "string" ? target.item : "";
    var li = [].filter.call($("list").children, function (n) { return id && n.dataset.id === id; })[0];
    if (!li) return;
    li.scrollIntoView({ block: "center" });
    li.classList.add("flash");
    setTimeout(function () { li.classList.remove("flash"); }, 1500);
  };

  function takePending() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget(APP_ID);
        if (pending) window.__orosOpenAt(pending);
      }
    } catch (e) { /* standalone */ }
  }

  // ---------- 6. Boot (last, after every declaration) ----------
  function boot() {
    load();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    render();
    takePending();
  }
  boot();
})();
