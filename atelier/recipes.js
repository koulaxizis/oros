// ============================================================
// orOS Atelier — recipes.js: Automations (v1.0.0)
// Steps saved once and run on one design or many: replace words,
// colours and fonts, text sizes, photo filters, centring, background
// removal, new sizes, download. An automation is data (recipes/
// core.js + recipesteps.js), never code.
//   - make one from a list of steps, or Record: do it by hand once,
//     Stop, and the changes become steps
//   - run it on the open design (one Undo), on the designs picked on
//     the home screen, or on all designs; it first says what it will
//     change; after a run one Undo brings every design back
//   - saved in the synced slice "recipes" (oros-recipes), shared with
//     the other apps that get automations
// Opened from the home screen (Automations, Select › Automation) and
// the editor's More menu.
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, M = AT.M, A = AT.A, AX = AT.AX, FX = AT.FX, T = AT.T, t = AT.t, el = AT.el;
  var R = window.orosRecipes, S = window.AtelierRecipes, CUT = window.AtelierCutout;
  if (!R || !S) return;
  var APP = "atelier", KEY = "oros-recipes";
  var CAT = S.CATALOG;

  var STR = {
    en: {
      "rc.title": "Automations",
      "rc.hint": "Steps you set once and run on one design or many. No code: only the steps below.",
      "rc.none": "No automations yet. Make one from a list of steps, or open a design and record what you do.",
      "rc.new": "New automation", "rc.record": "Record", "rc.run": "Run", "rc.edit": "Edit", "rc.dup": "Duplicate", "rc.del": "Delete",
      "rc.delAsk": "Delete “{name}”?", "rc.deleted": "Automation deleted.", "rc.copyOf": "{name} (copy)",
      "rc.steps": "{n} steps", "rc.steps1": "1 step", "rc.newer": "{n} steps need a newer orOS and will be skipped.",
      "rc.name": "Name", "rc.namePh": "e.g. Summer → Autumn", "rc.untitled": "Automation",
      "rc.add": "Add a step", "rc.up": "Move up", "rc.down": "Move down", "rc.remove": "Remove step",
      "rc.bad": "Fill in the marked steps first.", "rc.empty": "Add at least one step.", "rc.saved": "Automation saved.",
      "rc.op.text": "Replace text", "rc.op.color": "Replace colour", "rc.op.font": "Change font", "rc.op.size": "Resize text",
      "rc.op.filter": "Photo filter", "rc.op.center": "Centre on the page", "rc.op.cutout": "Remove photo backgrounds",
      "rc.op.resize": "New sizes", "rc.op.export": "Download",
      "rc.find": "Find", "rc.repl": "Replace with", "rc.cs": "Match case", "rc.word": "Whole words only",
      "rc.from": "From", "rc.to": "To", "rc.anyFont": "Any font", "rc.inDesign": "In this design:",
      "rc.pct": "Size (%)", "rc.what": "What", "rc.whatText": "Text boxes", "rc.whatAll": "Every element",
      "rc.cutHint": "Runs on this device. The first time it downloads the model (about {mb} MB).",
      "rc.sizes": "Sizes", "rc.addSize": "Add a size", "rc.custom": "Custom", "rc.copies": "Make copies (the next steps work on the copies)",
      "rc.inPlace": "Without copies, the design takes the first size.",
      "rc.fmt": "Format", "rc.scale": "Size", "rc.dpi": "Quality",
      "rc.on": "Run on", "rc.onThis": "This design", "rc.onPicked": "The {n} designs you picked", "rc.onAll": "All designs ({n})",
      "rc.will": "Will change {n} elements in {d} designs.", "rc.will1": "Will change {n} elements in 1 design.",
      "rc.willNone": "Nothing to change with the edit steps.", "rc.willCut": "Remove the background of {n} photos.",
      "rc.willSize": "Make {n} new designs.", "rc.willSize1": "Resize the design.", "rc.willOut": "Download the pages ({fmt}).",
      "rc.go": "Run", "rc.working": "Design {i} of {n}…", "rc.cutting": "Background {i} of {n}…", "rc.stop": "Stop",
      "rc.stopped": "Stopped. What was done stays (Undo brings it back).",
      "rc.done": "Done: {n} elements changed in {d} designs.", "rc.done1": "Done: {n} elements changed in 1 design.", "rc.done0": "Done. Nothing needed changing.",
      "rc.made": " {n} new designs.", "rc.fail": "Could not finish: {why}", "rc.zip": "{name}",
      "rc.recOn": "Recording. Change the design by hand, then press Stop.", "rc.recBar": "Recording",
      "rc.recStop": "Stop", "rc.recCancel": "Cancel", "rc.recNone": "Nothing to keep: change words, colours, fonts, text sizes or filters, or use Resize, Background removal or Download.",
      "rc.recName": "Recorded {date}"
    },
    el: {
      "rc.title": "Αυτοματισμοί",
      "rc.hint": "Βήματα που ορίζεις μία φορά και τρέχεις σε ένα ή πολλά σχέδια. Χωρίς κώδικα: μόνο τα παρακάτω βήματα.",
      "rc.none": "Δεν υπάρχουν αυτοματισμοί. Φτιάξε έναν από λίστα βημάτων ή άνοιξε ένα σχέδιο και κάνε εγγραφή.",
      "rc.new": "Νέος αυτοματισμός", "rc.record": "Εγγραφή", "rc.run": "Εκτέλεση", "rc.edit": "Επεξεργασία", "rc.dup": "Αντίγραφο", "rc.del": "Διαγραφή",
      "rc.delAsk": "Διαγραφή του «{name}»;", "rc.deleted": "Ο αυτοματισμός διαγράφηκε.", "rc.copyOf": "{name} (αντίγραφο)",
      "rc.steps": "{n} βήματα", "rc.steps1": "1 βήμα", "rc.newer": "{n} βήματα θέλουν νεότερο orOS και θα παραλειφθούν.",
      "rc.name": "Όνομα", "rc.namePh": "π.χ. Καλοκαίρι → Φθινόπωρο", "rc.untitled": "Αυτοματισμός",
      "rc.add": "Προσθήκη βήματος", "rc.up": "Πάνω", "rc.down": "Κάτω", "rc.remove": "Αφαίρεση βήματος",
      "rc.bad": "Συμπλήρωσε πρώτα τα σημειωμένα βήματα.", "rc.empty": "Πρόσθεσε τουλάχιστον ένα βήμα.", "rc.saved": "Ο αυτοματισμός αποθηκεύτηκε.",
      "rc.op.text": "Αντικατάσταση κειμένου", "rc.op.color": "Αντικατάσταση χρώματος", "rc.op.font": "Αλλαγή γραμματοσειράς", "rc.op.size": "Μέγεθος κειμένου",
      "rc.op.filter": "Φίλτρο φωτογραφιών", "rc.op.center": "Κεντράρισμα στη σελίδα", "rc.op.cutout": "Αφαίρεση φόντου φωτογραφιών",
      "rc.op.resize": "Νέα μεγέθη", "rc.op.export": "Λήψη",
      "rc.find": "Εύρεση", "rc.repl": "Αντικατάσταση με", "rc.cs": "Ίδια πεζά/κεφαλαία", "rc.word": "Μόνο ολόκληρες λέξεις",
      "rc.from": "Από", "rc.to": "Σε", "rc.anyFont": "Οποιαδήποτε", "rc.inDesign": "Σε αυτό το σχέδιο:",
      "rc.pct": "Μέγεθος (%)", "rc.what": "Τι", "rc.whatText": "Πλαίσια κειμένου", "rc.whatAll": "Όλα τα στοιχεία",
      "rc.cutHint": "Τρέχει στη συσκευή. Την πρώτη φορά κατεβάζει το μοντέλο (περίπου {mb} MB).",
      "rc.sizes": "Μεγέθη", "rc.addSize": "Προσθήκη μεγέθους", "rc.custom": "Δικό σου", "rc.copies": "Αντίγραφα (τα επόμενα βήματα γίνονται στα αντίγραφα)",
      "rc.inPlace": "Χωρίς αντίγραφα, το σχέδιο παίρνει το πρώτο μέγεθος.",
      "rc.fmt": "Μορφή", "rc.scale": "Μέγεθος", "rc.dpi": "Ποιότητα",
      "rc.on": "Εκτέλεση σε", "rc.onThis": "Αυτό το σχέδιο", "rc.onPicked": "Τα {n} σχέδια που διάλεξες", "rc.onAll": "Όλα τα σχέδια ({n})",
      "rc.will": "Θα αλλάξουν {n} στοιχεία σε {d} σχέδια.", "rc.will1": "Θα αλλάξουν {n} στοιχεία σε 1 σχέδιο.",
      "rc.willNone": "Τα βήματα επεξεργασίας δεν έχουν τι να αλλάξουν.", "rc.willCut": "Αφαίρεση φόντου σε {n} φωτογραφίες.",
      "rc.willSize": "Θα φτιαχτούν {n} νέα σχέδια.", "rc.willSize1": "Αλλαγή μεγέθους του σχεδίου.", "rc.willOut": "Λήψη των σελίδων ({fmt}).",
      "rc.go": "Εκτέλεση", "rc.working": "Σχέδιο {i} από {n}…", "rc.cutting": "Φόντο {i} από {n}…", "rc.stop": "Διακοπή",
      "rc.stopped": "Σταμάτησε. Ό,τι έγινε μένει (η Αναίρεση το φέρνει πίσω).",
      "rc.done": "Έγινε: άλλαξαν {n} στοιχεία σε {d} σχέδια.", "rc.done1": "Έγινε: άλλαξαν {n} στοιχεία σε 1 σχέδιο.", "rc.done0": "Έγινε. Δεν χρειάστηκε αλλαγή.",
      "rc.made": " {n} νέα σχέδια.", "rc.fail": "Δεν ολοκληρώθηκε: {why}", "rc.zip": "{name}",
      "rc.recOn": "Εγγραφή. Άλλαξε το σχέδιο με το χέρι και πάτα Τέλος.", "rc.recBar": "Εγγραφή",
      "rc.recStop": "Τέλος", "rc.recCancel": "Άκυρο", "rc.recNone": "Δεν υπάρχει κάτι να κρατηθεί: άλλαξε λέξεις, χρώματα, γραμματοσειρές, μέγεθος κειμένου ή φίλτρα, ή κάνε Αλλαγή μεγέθους, Αφαίρεση φόντου ή Λήψη.",
      "rc.recName": "Εγγραφή {date}"
    }
  };
  AT.addStrings(STR);

  // ---------- 1. The synced list ----------
  var D = R.empty();
  try { D = R.merge(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { D = R.empty(); }
  function api() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  var suppress = false;
  function store() {
    try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { AT.toast(t("toast.save")); }
    var s = api();
    if (!suppress && s && typeof s.markDirty === "function") s.markDirty();
  }
  (function register() {
    var s = api();
    if (!s || typeof s.registerSlice !== "function") return;
    s.registerSlice("recipes", function () { return R.merge(D); }, function (incoming) {
      if (!incoming || typeof incoming !== "object") return;
      var next = R.merge(incoming);
      if (JSON.stringify(next) === JSON.stringify(D)) return;
      suppress = true;
      try { D = next; store(); } finally { suppress = false; }     // R6: a pull never marks dirty
      if (listOpen) listOpen();
    }, KEY, R.merge);
  })();
  function mine() { return R.ofApp(D, APP); }
  function find(id) { var r = null; D.list.forEach(function (x) { if (x.id === id) r = x; }); return r; }
  function put(rec) {
    var r = JSON.parse(JSON.stringify(rec));
    r.m = Math.max(AT.now(), (find(r.id) || { m: 0 }).m + 1);
    D = R.merge({ ver: 1, list: D.list.filter(function (x) { return x.id !== r.id; }).concat([r]), dt: D.dt });
    store();
    return find(r.id);
  }
  function remove(id) {
    var r = find(id);
    if (!r) return;
    var dt = JSON.parse(JSON.stringify(D.dt));
    dt[id] = Math.max(AT.now(), r.m);
    D = R.merge({ ver: 1, list: D.list, dt: dt });
    store();
  }
  function nextPos() { return mine().reduce(function (p, r) { return Math.max(p, r.pos); }, 0) + 1; }

  // ---------- 2. Words for a step ----------
  function fontLbl(f) { return f ? AX.fontName(f) : t("rc.anyFont"); }
  function filterLbl(id) { var f = null; FX.FILTERS.forEach(function (x) { if (x.id === id) f = x; }); return f ? AT.lbl(f) : id; }
  function sizeLbl(z) {
    var p = null;
    if (z.p) AT.PRESETS.list.forEach(function (q) { if (q[0] === z.p) p = q; });
    return p ? AT.presetName(p) : z.w + " × " + z.h + " " + z.u;
  }
  function fmtLbl(st) { return st.fmt === "pdf" ? "PDF " + st.dpi + " dpi" : st.fmt.toUpperCase() + " ×" + st.scale; }
  function describe(st) {
    switch (st.op) {
      case "text": return "«" + st.find + "» → «" + st.repl + "»";
      case "color": return st.from + " → " + st.to;
      case "font": return fontLbl(st.from) + " → " + fontLbl(st.to);
      case "size": return st.pct + "%";
      case "filter": return filterLbl(st.flt);
      case "center": return st.what === "all" ? t("rc.whatAll") : t("rc.whatText");
      case "resize": return st.sizes.map(sizeLbl).join(", ");
      case "export": return fmtLbl(st);
    }
    return "";
  }
  function nSteps(n) { return n === 1 ? t("rc.steps1") : t("rc.steps", { n: n }); }

  function btn(cls, label, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function field(label, input) {
    var f = el("label", "fld");
    f.appendChild(el("span", "fld-lbl", label));
    f.appendChild(input);
    return f;
  }
  function check(label, on, fn) {
    var r = el("label", "chk-row"), cb = el("input");
    cb.type = "checkbox"; cb.checked = !!on;
    cb.addEventListener("change", function () { fn(cb.checked ? 1 : 0); });
    r.appendChild(cb); r.appendChild(el("span", "", label));
    return r;
  }
  function select(opts, val, fn) {
    var s = el("select", "inp sm");
    opts.forEach(function (o) { var x = el("option", "", o[1]); x.value = String(o[0]); if (String(o[0]) === String(val)) x.selected = true; s.appendChild(x); });
    s.addEventListener("change", function () { fn(s.value); });
    return s;
  }

  // ---------- 3. The list ----------
  var listOpen = null;          // re-renders the list while it is shown
  function open(ids) {
    var picked = Array.isArray(ids) ? ids.filter(function (id) { return AT.findDoc(id); }) : null;
    AT.openDialog(t("rc.title"), function (body, close) {
      var dlg = AT.$("dlg");
      function render() {
        body.textContent = "";
        body.appendChild(el("p", "hint", t("rc.hint")));
        var list = mine();
        if (!list.length) body.appendChild(el("p", "hint", t("rc.none")));
        var ul = el("div", "rc-list");
        list.forEach(function (r) {
          var row = el("div", "rc-row");
          var tx = el("div", "rc-txt");
          tx.appendChild(el("span", "rc-name", r.nm || t("rc.untitled")));
          var chk = R.check(r, CAT);
          tx.appendChild(el("span", "rc-sub", chk.steps.map(function (s) { return t("rc.op." + s.op); }).join(" · ") || nSteps(0)));
          row.appendChild(tx);
          row.appendChild(btn("btn small primary", t("rc.run"), function () { close(); runDialog(r, picked); }));
          var more = btn("icon-btn small", "");
          AT.setIcon(more, "more", t("ed.more"));
          more.addEventListener("click", function () {
            AT.menu(more, [
              { label: t("rc.edit"), fn: function () { close(); edit(r); } },
              { label: t("rc.dup"), fn: function () {
                var c = JSON.parse(JSON.stringify(r));
                c.id = R.newId(); c.nm = t("rc.copyOf", { name: r.nm || t("rc.untitled") }).slice(0, R.MAX_NAME); c.pos = nextPos();
                put(c); render();
              } },
              { label: t("rc.del"), danger: true, fn: function () {
                remove(r.id); render();
                AT.toast(t("rc.deleted"), t("btn.undo"), function () { var b = JSON.parse(JSON.stringify(r)); put(b); if (listOpen) listOpen(); });
              } }
            ]);
          });
          row.appendChild(more);
          ul.appendChild(row);
        });
        body.appendChild(ul);
        var act = el("div", "dlg-actions");
        if (AT.doc) act.appendChild(btn("btn", t("rc.record"), function () { close(); record(); }));
        act.appendChild(btn("btn", t("btn.close"), close));
        act.appendChild(btn("btn primary", t("rc.new"), function () {
          close();
          edit({ id: R.newId(), app: APP, nm: "", steps: [], pos: nextPos() }, true);
        }));
        body.appendChild(act);
      }
      listOpen = render;
      dlg.addEventListener("close", function onClose() {
        if (dlg.open) return;                     // a close queued from the dialog before
        dlg.removeEventListener("close", onClose);
        if (listOpen === render) listOpen = null;
      });
      render();
    }, true);
  }

  // ---------- 4. Editing the steps ----------
  function newStep(op) {
    switch (op) {
      case "text": return { op: op, find: "", repl: "", cs: 0, word: 0 };
      case "color": return { op: op, from: "#000000", to: "#ffffff" };
      case "font": return { op: op, from: "", to: "serif" };
      case "size": return { op: op, pct: 120 };
      case "filter": return { op: op, flt: "vivid" };
      case "center": return { op: op, what: "text" };
      case "resize": return { op: op, sizes: [{ w: 1080, h: 1080, u: "px", p: "ig-post" }], copies: 1 };
      case "export": return { op: op, fmt: "png", scale: 1, dpi: 300 };
    }
    return { op: op };
  }
  // fonts to offer: designkit families, recently used, the open design's
  function fontList(extra) {
    var ids = T.FAMILY_IDS.slice(), seen = {};
    (AT.prefs.fonts || []).forEach(function (f) { ids.push(f.id); });
    if (AT.doc) AT.doc.items.forEach(function (it) { if (it.ax && it.ax.font) ids.push(it.ax.font); });
    if (extra) ids.push(extra);
    return ids.filter(function (id) { if (!id || seen[id]) return false; seen[id] = 1; return true; });
  }
  function docColors() {
    var c = {};
    if (!AT.doc) return [];
    AT.doc.items.forEach(function (it) {
      var ax = it.ax;
      if (!ax) return;
      [ax.fc, ax.sc, ax.g && ax.g.a, ax.g && ax.g.b].forEach(function (v) { if (v) c[v] = 1; });
    });
    return Object.keys(c).slice(0, 24);
  }

  function stepFields(st, box, changed) {
    function set(k, v) { st[k] = v; changed(); }
    function textIn(k, max) {
      var i = el("input", "inp sm"); i.type = "text"; i.maxLength = max; i.value = st[k] || "";
      i.addEventListener("input", function () { set(k, i.value); });
      return i;
    }
    function colorIn(k) {
      var i = el("input", "inp rc-col"); i.type = "color"; i.value = st[k] || "#000000";
      i.addEventListener("input", function () { set(k, i.value.toLowerCase()); });
      return i;
    }
    switch (st.op) {
      case "text":
        box.appendChild(field(t("rc.find"), textIn("find", 500)));
        box.appendChild(field(t("rc.repl"), textIn("repl", 2000)));
        box.appendChild(check(t("rc.cs"), st.cs, function (v) { set("cs", v); }));
        box.appendChild(check(t("rc.word"), st.word, function (v) { set("word", v); }));
        break;
      case "color":
        var fromIn = colorIn("from");
        var row = el("div", "rc-inline");
        row.appendChild(field(t("rc.from"), fromIn));
        row.appendChild(field(t("rc.to"), colorIn("to")));
        box.appendChild(row);
        var cols = docColors();
        if (cols.length) {
          var chips = el("div", "rc-chips");
          chips.appendChild(el("span", "hint", t("rc.inDesign")));
          cols.forEach(function (c) {
            var b = btn("rc-chip", "", function () { fromIn.value = c; set("from", c); });
            b.style.background = c;
            b.setAttribute("aria-label", c); b.title = c;
            chips.appendChild(b);
          });
          box.appendChild(chips);
        }
        break;
      case "font":
        var fr = el("div", "rc-inline");
        fr.appendChild(field(t("rc.from"), select([["", t("rc.anyFont")]].concat(fontList(st.from).map(function (f) { return [f, AX.fontName(f)]; })), st.from, function (v) { set("from", v); })));
        fr.appendChild(field(t("rc.to"), select(fontList(st.to).map(function (f) { return [f, AX.fontName(f)]; }), st.to, function (v) { set("to", v); })));
        box.appendChild(fr);
        break;
      case "size":
        var n = el("input", "inp sm num"); n.type = "number"; n.min = "10"; n.max = "1000"; n.step = "5"; n.value = st.pct;
        n.addEventListener("input", function () { set("pct", +n.value); });
        box.appendChild(field(t("rc.pct"), n));
        break;
      case "filter":
        box.appendChild(field(t("rc.op.filter"), select(FX.FILTERS.map(function (f) { return [f.id, AT.lbl(f)]; }), st.flt, function (v) { set("flt", v); })));
        break;
      case "center":
        box.appendChild(field(t("rc.what"), select([["text", t("rc.whatText")], ["all", t("rc.whatAll")]], st.what, function (v) { set("what", v); })));
        break;
      case "cutout":
        box.appendChild(el("p", "hint", t("rc.cutHint", { mb: CUT ? CUT.APPROX_MB : 16 })));
        break;
      case "resize":
        var sl = el("div", "rc-sizes");
        var presets = AT.PRESETS.list.map(function (p) { return [p[0], AT.presetName(p) + " · " + p[4] + "×" + p[5] + " " + p[6]]; });
        function drawSizes() {
          sl.textContent = "";
          st.sizes.forEach(function (z, i) {
            var r = el("div", "rc-size");
            r.appendChild(select(presets.concat([["", t("rc.custom")]]), z.p || "", function (v) {
              var p = null;
              AT.PRESETS.list.forEach(function (q) { if (q[0] === v) p = q; });
              st.sizes[i] = p ? { w: p[4], h: p[5], u: p[6], p: p[0] } : { w: z.w, h: z.h, u: z.u, p: "" };
              changed(); drawSizes();
            }));
            if (!z.p) {
              ["w", "h"].forEach(function (k) {
                var i2 = el("input", "inp sm num rc-num"); i2.type = "number"; i2.min = "1"; i2.max = "20000"; i2.value = z[k];
                i2.setAttribute("aria-label", t(k === "w" ? "resize.w" : "resize.h"));
                i2.addEventListener("input", function () { z[k] = +i2.value; changed(); });
                r.appendChild(i2);
              });
              r.appendChild(select([["px", "px"], ["mm", "mm"]], z.u, function (v) { z.u = v; changed(); }));
            }
            if (st.sizes.length > 1) {
              var x = btn("icon-btn small", "", function () { st.sizes.splice(i, 1); changed(); drawSizes(); });
              AT.setIcon(x, "close", t("rc.remove"));
              r.appendChild(x);
            }
            sl.appendChild(r);
          });
          if (st.sizes.length < 12) sl.appendChild(btn("btn small", t("rc.addSize"), function () {
            st.sizes.push({ w: 1080, h: 1920, u: "px", p: "story" }); changed(); drawSizes();
          }));
        }
        drawSizes();
        box.appendChild(field(t("rc.sizes"), sl));
        box.appendChild(check(t("rc.copies"), st.copies, function (v) { set("copies", v); }));
        box.appendChild(el("p", "hint", t("rc.inPlace")));
        break;
      case "export":
        var er = el("div", "rc-inline"), q = el("span", "");
        er.appendChild(field(t("rc.fmt"), select([["png", "PNG"], ["jpg", "JPG"], ["pdf", "PDF"]], st.fmt, function (v) { set("fmt", v); drawQ(); })));
        er.appendChild(q);
        function drawQ() {
          q.textContent = "";
          if (st.fmt === "pdf") q.appendChild(field(t("rc.dpi"), select([[150, "150 dpi"], [300, "300 dpi"]], st.dpi, function (v) { set("dpi", +v); })));
          else q.appendChild(field(t("rc.scale"), select([[1, "×1"], [2, "×2"], [3, "×3"]], st.scale, function (v) { set("scale", +v); })));
        }
        drawQ();
        box.appendChild(er);
        break;
    }
  }

  function edit(rec, isNew) {
    var work = JSON.parse(JSON.stringify(rec));
    var known = R.check(work, CAT);
    var unknown = work.steps.filter(function (s) { return !R.normStep(s, CAT) && !CAT[s.op]; });
    // steps this copy knows are edited; the rest are kept as they are
    work.steps = work.steps.filter(function (s) { return CAT[s.op]; });
    AT.openDialog(isNew ? t("rc.new") : t("rc.edit"), function (body, close) {
      var nm = el("input", "inp"); nm.type = "text"; nm.maxLength = R.MAX_NAME; nm.value = work.nm; nm.placeholder = t("rc.namePh");
      nm.addEventListener("input", function () { work.nm = nm.value; });
      body.appendChild(field(t("rc.name"), nm));
      if (unknown.length) body.appendChild(el("p", "hint warn", t("rc.newer", { n: unknown.length })));
      var list = el("ol", "rc-steps");
      body.appendChild(list);
      var add = el("div", "rc-add");
      add.appendChild(select([["", t("rc.add") + "…"]].concat(S.ORDER.map(function (op) { return [op, t("rc.op." + op)]; })), "", function (v) {
        if (!v || work.steps.length >= R.MAX_STEPS) return;
        work.steps.push(newStep(v));
        draw();
        var last = list.lastElementChild && list.lastElementChild.querySelector("input, select");
        if (last) last.focus();
      }));
      body.appendChild(add);
      var warn = el("p", "hint warn");
      warn.hidden = true;
      body.appendChild(warn);
      function mark(li, st) { li.classList.toggle("bad", !R.normStep(st, CAT)); }
      function draw() {
        list.textContent = "";
        add.querySelector("select").value = "";
        work.steps.forEach(function (st, i) {
          var li = el("li", "rc-step");
          var head = el("div", "rc-step-h");
          head.appendChild(el("span", "rc-step-t", (i + 1) + ". " + t("rc.op." + st.op)));
          var up = btn("icon-btn small", "", function () { if (i) { work.steps.splice(i - 1, 0, work.steps.splice(i, 1)[0]); draw(); } });
          AT.setIcon(up, "up", t("rc.up")); up.disabled = !i;
          var dn = btn("icon-btn small", "", function () { if (i < work.steps.length - 1) { work.steps.splice(i + 1, 0, work.steps.splice(i, 1)[0]); draw(); } });
          AT.setIcon(dn, "down", t("rc.down")); dn.disabled = i === work.steps.length - 1;
          var rm = btn("icon-btn small", "", function () { work.steps.splice(i, 1); draw(); });
          AT.setIcon(rm, "close", t("rc.remove"));
          head.appendChild(up); head.appendChild(dn); head.appendChild(rm);
          li.appendChild(head);
          var box = el("div", "rc-step-b");
          stepFields(st, box, function () { mark(li, st); });
          li.appendChild(box);
          mark(li, st);
          list.appendChild(li);
        });
      }
      draw();
      var act = el("div", "dlg-actions");
      act.appendChild(btn("btn", t("btn.cancel"), function () { close(); open(); }));
      act.appendChild(btn("btn primary", t("btn.save"), function () {
        if (!work.steps.length && !unknown.length) { warn.textContent = t("rc.empty"); warn.hidden = false; return; }
        var clean = [];
        for (var i = 0; i < work.steps.length; i++) {
          var c = R.normStep(work.steps[i], CAT);
          if (!c) { warn.textContent = t("rc.bad"); warn.hidden = false; return; }
          clean.push(c);
        }
        work.steps = clean.concat(unknown);
        work.nm = (work.nm || "").trim() || t("rc.untitled");
        put(work);
        close();
        AT.toast(t("rc.saved"));
        open();
      }));
      body.appendChild(act);
      if (!known.steps.length && !unknown.length && isNew) setTimeout(function () { nm.focus(); }, 0);
    }, true);
  }

  // ---------- 5. Running ----------
  function photos(doc) {
    return doc.items.filter(function (it) {
      return it.ax && it.ax.k === "photo" && it.a && !it.ax.vid && !/-cutout\.png$/i.test(it.nm || "");
    });
  }
  function ptSize(z) { var mm = z.u === "mm"; return { w: mm ? M.fromUnit(z.w, "mm") : z.w, h: mm ? M.fromUnit(z.h, "mm") : z.h, unit: z.u }; }

  // What a run would do, without doing it.
  function preview(steps, ids) {
    var n = 0, d = 0, cut = 0, made = 0, inPlace = false, out = null;
    ids.forEach(function (id) {
      var doc = AT.findDoc(id);
      if (!doc) return;
      var w = [JSON.parse(JSON.stringify(doc))], k = 0;
      steps.forEach(function (st) {
        var def = CAT[st.op];
        if (def.kind === "doc") w.forEach(function (x) { k += S.apply(x, st, { now: AT.now() }); });
        else if (st.op === "cutout") w.forEach(function (x) { cut += photos(x).length; });
        else if (st.op === "resize") {
          if (st.copies) {
            made += w.length * st.sizes.length;
            w = [].concat.apply([], w.map(function (x) { return st.sizes.map(function () { return JSON.parse(JSON.stringify(x)); }); }));
          } else inPlace = true;
        } else if (st.op === "export") out = st;
      });
      n += k;
      if (k) d++;
    });
    return { n: n, d: d, cut: cut, made: made, inPlace: inPlace, out: out };
  }

  function runDialog(rec, picked) {
    var chk = R.check(rec, CAT), steps = chk.steps;
    var all = AT.data().docs.map(function (d) { return d.id; });
    var on = AT.doc ? "this" : picked && picked.length ? "picked" : "all";
    AT.openDialog(rec.nm || t("rc.untitled"), function (body, close) {
      var ul = el("ol", "rc-sum");
      steps.forEach(function (st) {
        var li = el("li", "");
        li.appendChild(el("b", "", t("rc.op." + st.op)));
        var ds = describe(st);
        if (ds) li.appendChild(el("span", "", " " + ds));
        ul.appendChild(li);
      });
      body.appendChild(ul);
      if (chk.skipped) body.appendChild(el("p", "hint warn", t("rc.newer", { n: chk.skipped })));
      var opts = [];
      if (AT.doc) opts.push(["this", t("rc.onThis")]);
      if (picked && picked.length) opts.push(["picked", t("rc.onPicked", { n: picked.length })]);
      opts.push(["all", t("rc.onAll", { n: all.length })]);
      body.appendChild(field(t("rc.on"), select(opts, on, function (v) { on = v; info(); })));
      var will = el("div", "rc-will");
      body.appendChild(will);
      var act = el("div", "dlg-actions");
      var go = btn("btn primary", t("rc.go"));
      act.appendChild(btn("btn", t("btn.cancel"), close));
      act.appendChild(go);
      body.appendChild(act);
      function ids() { return on === "this" ? [AT.doc.id] : on === "picked" ? picked.slice() : all.slice(); }
      function info() {
        var p = preview(steps, ids());
        will.textContent = "";
        function line(s) { will.appendChild(el("p", "hint", s)); }
        if (steps.some(function (s) { return CAT[s.op].kind === "doc"; })) {
          line(p.n ? (p.d === 1 ? t("rc.will1", { n: p.n }) : t("rc.will", { n: p.n, d: p.d })) : t("rc.willNone"));
        }
        if (p.cut) line(t("rc.willCut", { n: p.cut }));
        if (p.made) line(t("rc.willSize", { n: p.made }));
        if (p.inPlace) line(t("rc.willSize1"));
        if (p.out) line(t("rc.willOut", { fmt: fmtLbl(p.out) }));
        go.disabled = !steps.length || !ids().length;
      }
      info();
      go.addEventListener("click", function () { close(); run(rec, steps, ids()); });
    }, true);
  }

  function cutOne(doc, it, signal) {
    return A.load(it.a).then(function (img) {
      if (!img) throw new Error(t("ai.noPic"));
      return CUT.cut(img, { signal: signal });
    }).then(function (res) {
      if (signal.aborted) return;
      var cv = res.render(CUT.LO);
      return new Promise(function (resolve, reject) {
        cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("PNG")); }, "image/png");
      }).then(function (blob) {
        var nm = (it.nm || "picture").replace(/\.[a-z0-9]+$/i, "") + "-cutout.png";
        return A.importFile(new File([blob], nm, { type: "image/png" }));
      }).then(function (r) {
        if (AT.noteUpload) AT.noteUpload(r.id);
        it.a = r.id; it.iw = r.w; it.ih = r.h; it.nm = (it.nm || "picture").replace(/\.[a-z0-9]+$/i, "") + "-cutout.png";
        M.touch(it, AT.now());
      });
    });
  }

  function run(rec, steps, ids) {
    if (AT.ed && AT.ed.exitText) AT.ed.exitText();
    AT.endGesture();
    var ctl = new AbortController(), snaps = [], made = [], files = [], changed = 0, docsChanged = 0;
    var stat;
    AT.openDialog(rec.nm || t("rc.untitled"), function (body, close) {
      stat = el("p", "hint rc-stat", t("rc.working", { i: 1, n: ids.length }));
      body.appendChild(stat);
      var act = el("div", "dlg-actions");
      act.appendChild(btn("btn", t("rc.stop"), function () { ctl.abort(); close(); }));
      body.appendChild(act);
    });
    var dlg = AT.$("dlg");
    // a close still queued from the dialog before must not stop the run
    dlg.addEventListener("close", function onClose() {
      if (dlg.open) return;
      dlg.removeEventListener("close", onClose);
      ctl.abort();
    });

    function oneDoc(id, idx) {
      var src = AT.findDoc(id);
      if (!src || ctl.signal.aborted) return Promise.resolve();
      if (stat) stat.textContent = t("rc.working", { i: idx + 1, n: ids.length });
      snaps.push({ id: id, doc: JSON.parse(JSON.stringify(src)) });
      var work = [JSON.parse(JSON.stringify(src))], k = 0, chain = Promise.resolve();
      steps.forEach(function (st) {
        chain = chain.then(function () {
          if (ctl.signal.aborted) return;
          var def = CAT[st.op];
          if (def.kind === "doc") { work.forEach(function (w) { k += S.apply(w, st, { now: AT.now() }); }); return; }
          if (st.op === "cutout") {
            var jobs = [];
            work.forEach(function (w) { photos(w).forEach(function (it) { jobs.push({ w: w, it: it }); }); });
            var c2 = Promise.resolve();
            jobs.forEach(function (j, i) {
              c2 = c2.then(function () {
                if (ctl.signal.aborted) return;
                if (stat) stat.textContent = t("rc.cutting", { i: i + 1, n: jobs.length });
                return cutOne(j.w, j.it, ctl.signal).then(function () { k++; });
              });
            });
            return c2;
          }
          if (st.op === "resize") {
            if (!st.copies) {
              var z0 = ptSize(st.sizes[0]);
              work.forEach(function (w) {
                var r = AT.io.relaid(w, z0.w, z0.h, z0.unit), nw = AT.now();
                w.setup = r.setup; w.items = r.items; w.m = Math.max(nw, w.m + 1);
                w.items.forEach(function (it) { M.touch(it, nw); });
                k++;
              });
              return;
            }
            // the designs so far are saved; the copies are the new work
            work.forEach(function (w) { AT.putDoc(w); });
            var next = [];
            work.forEach(function (w) {
              var list = st.sizes.map(function (z) {
                var p = ptSize(z), c = AT.io.relaid(w, p.w, p.h, p.unit);
                c.name = t("resize.copy", { name: AT.docTitle(w), size: sizeLbl(z) }).slice(0, 120);
                return c;
              });
              AT.addCopies(list, w.id).forEach(function (nid) {
                made.push(nid);
                next.push(JSON.parse(JSON.stringify(AT.findDoc(nid))));
              });
            });
            work = next;
            return;
          }
          if (st.op === "export") {
            var c3 = Promise.resolve();
            work.forEach(function (w) {
              c3 = c3.then(function () {
                if (ctl.signal.aborted) return;
                return AT.io.renderFiles(M.normDoc(JSON.parse(JSON.stringify(w))), st).then(function (fl) { files = files.concat(fl); });
              });
            });
            return c3;
          }
        });
      });
      return chain.then(function () {
        work.forEach(function (w) { AT.putDoc(w); });
        changed += k;
        if (k) docsChanged++;
      });
    }

    var chain = Promise.resolve();
    if (steps.some(function (s) { return s.op === "cutout"; }) && !CUT) steps = steps.filter(function (s) { return s.op !== "cutout"; });
    ids.forEach(function (id, i) { chain = chain.then(function () { return oneDoc(id, i); }); });
    chain.then(function () {
      if (!files.length) return;
      if (files.length === 1) return AT.io.saveBlob(files[0].blob, files[0].name, files[0].blob.type, files[0].name, files[0].name.replace(/^.*(\.[a-z]+)$/, "$1"));
      return Promise.all(files.map(function (f) { return f.blob.arrayBuffer(); })).then(function (bufs) {
        var taken = {}, list = files.map(function (f, i) {
          var nm = f.name, b = nm.replace(/(\.[a-z]+)$/, ""), ext = nm.slice(b.length), j = 2;
          while (taken[nm.toLowerCase()]) nm = b + " (" + (j++) + ")" + ext;
          taken[nm.toLowerCase()] = 1;
          return { name: nm, data: new Uint8Array(bufs[i]) };
        });
        var zip = window.AtelierZip.write(list, new Date());
        var name = String(rec.nm || "atelier").replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "atelier";
        return AT.io.saveBlob(new Blob([zip], { type: "application/zip" }), name + ".zip", "application/zip", "ZIP", ".zip");
      });
    }).then(function () {
      var stopped = ctl.signal.aborted;
      if (dlg.open) dlg.close();
      finish(stopped);
    }, function (e) {
      if (dlg.open) dlg.close();
      try { console.error("[orOS] atelier: automation failed", e); } catch (x) {}
      finish(false, e);
    });

    function finish(stopped, err) {
      if (AT.dropThumbs) AT.dropThumbs();
      if (!AT.doc) AT.renderHome();
      var msg = err ? t("rc.fail", { why: String(err && err.message || err).slice(0, 120) })
        : stopped ? t("rc.stopped")
        : (changed ? t(docsChanged === 1 ? "rc.done1" : "rc.done", { n: changed, d: docsChanged }) : t("rc.done0")) + (made.length ? t("rc.made", { n: made.length }) : "");
      if (!snaps.length && !made.length) { AT.toast(msg); return; }
      AT.toast(msg, t("btn.undo"), function () {
        made.forEach(function (id) { AT.dropDoc(id); });
        snaps.forEach(function (s) { AT.restoreDoc(s.id, s.doc); });
        if (AT.dropThumbs) AT.dropThumbs();
        if (!AT.doc) AT.renderHome();
      });
    }
  }

  // ---------- 6. Record ----------
  var rec = null;               // { id, before, notes }
  var bar = null;
  function showBar(on) {
    if (!bar) {
      bar = el("div", "rc-recbar");
      bar.setAttribute("role", "status");
      bar.appendChild(el("span", "rc-dot"));
      bar.appendChild(el("span", "rc-lbl", t("rc.recBar")));
      bar.appendChild(btn("btn small", t("rc.recCancel"), function () { rec = null; showBar(false); }));
      bar.appendChild(btn("btn small primary", t("rc.recStop"), stopRecord));
      // on top of the stage, clear of the bars; taps stay off the canvas
      ["pointerdown", "mousedown", "touchstart"].forEach(function (ev) { bar.addEventListener(ev, function (e) { e.stopPropagation(); }); });
      (AT.$("stage") || AT.$("editor") || document.body).appendChild(bar);
    }
    bar.hidden = !on;
  }
  function record() {
    if (!AT.doc) return;
    if (AT.ed && AT.ed.exitText) AT.ed.exitText();
    AT.endGesture();
    rec = { id: AT.doc.id, before: JSON.parse(JSON.stringify(AT.doc)), notes: [] };
    showBar(true);
    AT.toast(t("rc.recOn"));
  }
  AT.on("rc-note", function (n) {
    if (!rec || !AT.doc || AT.doc.id !== rec.id) return;
    var c = R.normStep(n, CAT);
    if (!c) return;
    if (c.op === "cutout" && rec.notes.some(function (x) { return x.op === "cutout"; })) return;
    rec.notes.push(c);
  });
  AT.on("open", function () { if (bar) bar.hidden = !(rec && AT.doc && AT.doc.id === rec.id); });
  function stopRecord() {
    if (!rec) return;
    if (AT.ed && AT.ed.exitText) AT.ed.exitText();
    AT.endGesture();
    var r = rec, now = AT.doc && AT.doc.id === r.id ? AT.doc : AT.findDoc(r.id);
    rec = null; showBar(false);
    var steps = (now ? S.learn(r.before, now) : []).concat(r.notes)
      .map(function (s) { return R.normStep(s, CAT); }).filter(Boolean);
    if (!steps.length) { AT.toast(t("rc.recNone")); return; }
    var d = new Date(), date = d.toLocaleDateString(AT.locale(), { day: "numeric", month: "short" }) + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    edit({ id: R.newId(), app: APP, nm: t("rc.recName", { date: date }), steps: steps, pos: nextPos() }, true);
  }

  AT.recipes = { open: open, record: record, recording: function () { return !!rec; } };
})();
