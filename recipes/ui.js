// ============================================================
// orOS recipes — ui.js: the Automations panel for apps that plug in
// their own steps (v1.0.0, wave A2: Layout, Photo Lab). Atelier keeps
// its own panel (atelier/recipes.js, with Record).
// An app mounts it with an adapter:
//   orosRecipesUI.mount({
//     app: "layout", catalog, order: [ops in menu order],
//     t(key, vars)            the app's strings (op names "rc.op.<op>",
//                             field names "rc.f.<op>.<key>" or "rc.f.<key>")
//     enumLabel(op, key, v)   words for an enum value (optional)
//     choices(op, key, st)    [[value, label]] for a "str" field that is
//                             picked from a list (styles, masters), or null
//     newStep(op)             a new step with its defaults
//     describe(st)            a short line for the run summary
//     note(op)                a hint under a step's fields (optional)
//     dialog(title, build(body, close))   one modal dialog
//     toast(msg, actionLabel, fn), now(),
//     cls: { inp, lbl }       the app's class names for inputs / labels
//     targets()               [[value, label]] what a run can work on
//     preview(steps, target)  [lines] what a run would do
//     run(steps, target, ctl, recipe) Promise → { msg, undo? };
//                             ctl.status(text), ctl.signal (aborted
//                             when the person stops)
//   }) → { open(), list(), run, edit, draft(d) }
// With recipes/share.js loaded, each automation can be shared as a
// .orosrecipe file (Share) and one read back (Import); draft(d) opens
// the editor with a draft from the Assistant or another app
// (deep link { newRecipe }), saved only when the person presses Save.
// Fields are drawn from the catalog's argument specs (recipes/core.js):
// str → text (or a list when choices() gives one), color, num / int,
// enum → list, bool → tick box. Saving runs every step through the
// catalog; steps of a newer orOS are kept as they are and skipped.
// The list lives in the synced slice "recipes" (oros-recipes) shared
// with Atelier: whichever app registers it last carries every app's
// recipes, so the getter always returns the whole record.
// Exposes window.orosRecipesUI.
// ============================================================
(function (root) {
  "use strict";

  var R = root.orosRecipes, SH = root.orosRecipeShare || null;
  if (!R) return;
  var KEY = "oros-recipes";

  var STR = {
    en: {
      "title": "Automations",
      "hint": "Steps you set once and run again and again. No code: only the steps below.",
      "none": "No automations yet. Press New automation and pick the steps.",
      "new": "New automation", "run": "Run", "edit": "Edit", "dup": "Duplicate", "del": "Delete",
      "deleted": "Automation deleted.", "copyOf": "{name} (copy)", "untitled": "Automation",
      "steps": "{n} steps", "steps1": "1 step", "newer": "{n} steps need a newer orOS and will be skipped.",
      "name": "Name", "namePh": "e.g. Web pictures", "add": "Add a step",
      "up": "Move up", "down": "Move down", "remove": "Remove step",
      "bad": "Fill in the marked steps first.", "empty": "Add at least one step.", "saved": "Automation saved.",
      "on": "Run on", "go": "Run", "stop": "Stop", "working": "Working…",
      "stopped": "Stopped. What was done stays.", "fail": "Could not finish: {why}",
      "close": "Close", "cancel": "Cancel", "save": "Save", "undo": "Undo"
    },
    el: {
      "title": "Αυτοματισμοί",
      "hint": "Βήματα που ορίζεις μία φορά και τα τρέχεις ξανά και ξανά. Χωρίς κώδικα: μόνο τα παρακάτω βήματα.",
      "none": "Δεν υπάρχουν αυτοματισμοί ακόμα. Πάτα Νέος αυτοματισμός και διάλεξε τα βήματα.",
      "new": "Νέος αυτοματισμός", "run": "Εκτέλεση", "edit": "Επεξεργασία", "dup": "Αντίγραφο", "del": "Διαγραφή",
      "deleted": "Ο αυτοματισμός διαγράφηκε.", "copyOf": "{name} (αντίγραφο)", "untitled": "Αυτοματισμός",
      "steps": "{n} βήματα", "steps1": "1 βήμα", "newer": "{n} βήματα θέλουν νεότερο orOS και θα παραλειφθούν.",
      "name": "Όνομα", "namePh": "π.χ. Εικόνες για το web", "add": "Προσθήκη βήματος",
      "up": "Πάνω", "down": "Κάτω", "remove": "Αφαίρεση βήματος",
      "bad": "Συμπλήρωσε πρώτα τα σημειωμένα βήματα.", "empty": "Πρόσθεσε τουλάχιστον ένα βήμα.", "saved": "Ο αυτοματισμός αποθηκεύτηκε.",
      "on": "Εκτέλεση σε", "go": "Εκτέλεση", "stop": "Διακοπή", "working": "Γίνεται…",
      "stopped": "Διακόπηκε. Ό,τι έγινε μένει.", "fail": "Δεν ολοκληρώθηκε: {why}",
      "close": "Κλείσιμο", "cancel": "Άκυρο", "save": "Αποθήκευση", "undo": "Αναίρεση"
    }
  };
  function L() {
    var I = root.orosI18n;
    return I ? I.table(STR, "recipes") : STR.en;
  }
  function u(key, vars) {
    var s = L()[key] || STR.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }

  // ---------- 1. The synced list (shared by every app) ----------
  var D = R.empty();
  try { D = R.merge(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { D = R.empty(); }
  var listeners = [], suppress = false, registered = false;
  function sync() {
    try { return (root.parent && root.parent.orosSync) || root.orosSync || null; }
    catch (e) { return root.orosSync || null; }
  }
  function store() {
    try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) {}
    var s = sync();
    if (!suppress && s && typeof s.markDirty === "function") s.markDirty();
  }
  function register() {
    if (registered) return;
    var s = sync();
    if (!s || typeof s.registerSlice !== "function") return;
    registered = true;
    s.registerSlice("recipes", function () { return R.merge(D); }, function (incoming) {
      if (!incoming || typeof incoming !== "object") return;
      var next = R.merge(D, incoming);
      if (JSON.stringify(next) === JSON.stringify(D)) return;
      suppress = true;
      try { D = next; store(); } finally { suppress = false; }     // a pull never marks dirty
      listeners.forEach(function (f) { f(); });
    }, KEY, R.merge);
  }
  function find(id) { var r = null; D.list.forEach(function (x) { if (x.id === id) r = x; }); return r; }

  function mount(ad) {
    register();
    var APP = ad.app, CAT = ad.catalog;
    function t(k, v) { return ad.t(k, v); }
    function mine() { return R.ofApp(D, APP); }
    function put(rec) {
      var r = JSON.parse(JSON.stringify(rec));
      r.m = Math.max(ad.now(), (find(r.id) || { m: 0 }).m + 1);
      D = R.merge({ ver: 1, list: D.list.filter(function (x) { return x.id !== r.id; }).concat([r]), dt: D.dt });
      store();
      return find(r.id);
    }
    function remove(id) {
      var r = find(id);
      if (!r) return;
      var dt = JSON.parse(JSON.stringify(D.dt));
      dt[id] = Math.max(ad.now(), r.m);
      D = R.merge({ ver: 1, list: D.list, dt: dt });
      store();
    }
    function nextPos() { return mine().reduce(function (p, r) { return Math.max(p, r.pos); }, 0) + 1; }
    function opName(op) { return t("rc.op." + op); }
    function nSteps(n) { return n === 1 ? u("steps1") : u("steps", { n: n }); }

    // ---------- small builders ----------
    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }
    function btn(cls, label, fn) {
      var b = el("button", cls, label);
      b.type = "button";
      if (fn) b.addEventListener("click", fn);
      return b;
    }
    function field(label, input) {
      var f = el("label", "fld");
      f.appendChild(el("span", ad.cls.lbl, label));
      f.appendChild(input);
      return f;
    }
    function inp(type) {
      var i = el("input", ad.cls.inp);
      i.type = type;
      return i;
    }
    function select(opts, val, fn) {
      var s = el("select", ad.cls.inp);
      opts.forEach(function (o) { var x = el("option", "", o[1]); x.value = String(o[0]); if (String(o[0]) === String(val)) x.selected = true; s.appendChild(x); });
      s.addEventListener("change", function () { fn(s.value); });
      return s;
    }
    function check(label, on, fn) {
      var r = el("label", "chk"), cb = el("input");
      cb.type = "checkbox"; cb.checked = !!on;
      cb.addEventListener("change", function () { fn(cb.checked ? 1 : 0); });
      r.appendChild(cb); r.appendChild(el("span", "", label));
      return r;
    }
    function fieldLabel(op, key) {
      var a = t("rc.f." + op + "." + key);
      return a !== "rc.f." + op + "." + key ? a : t("rc.f." + key);
    }

    // ---------- 2. The list ----------
    var listOpen = null;
    listeners.push(function () { if (listOpen) listOpen(); });
    function open() {
      ad.dialog(u("title"), function (body, close) {
        function render() {
          body.textContent = "";
          body.appendChild(el("p", "hint", u("hint")));
          var list = mine();
          if (!list.length) body.appendChild(el("p", "hint", u("none")));
          var ul = el("div", "rc-list");
          list.forEach(function (r) {
            var row = el("div", "rc-row");
            var tx = el("div", "rc-txt");
            tx.appendChild(el("span", "rc-name", r.nm || u("untitled")));
            var chk = R.check(r, CAT);
            tx.appendChild(el("span", "rc-sub", chk.steps.map(function (s) { return opName(s.op); }).join(" · ") || nSteps(0)));
            row.appendChild(tx);
            var acts = el("div", "rc-acts");
            acts.appendChild(btn("btn small primary", u("run"), function () { stop(); close(); runDialog(r); }));
            acts.appendChild(btn("btn small", u("edit"), function () { stop(); close(); edit(r); }));
            acts.appendChild(btn("btn small", u("dup"), function () {
              var c = JSON.parse(JSON.stringify(r));
              c.id = R.newId(); c.nm = u("copyOf", { name: r.nm || u("untitled") }).slice(0, R.MAX_NAME); c.pos = nextPos();
              put(c); render();
            }));
            if (SH) acts.appendChild(btn("btn small", SH.str("sh.share"), function () { share(r); }));
            acts.appendChild(btn("btn small danger", u("del"), function () {
              remove(r.id); render();
              ad.toast(u("deleted"), u("undo"), function () { put(JSON.parse(JSON.stringify(r))); if (listOpen) listOpen(); });
            }));
            row.appendChild(acts);
            ul.appendChild(row);
          });
          body.appendChild(ul);
          var act = el("div", "dlg-actions");
          act.appendChild(btn("btn", u("close"), function () { stop(); close(); }));
          if (SH) act.appendChild(btn("btn", SH.str("sh.import"), function () { importFile(function () { stop(); close(); }); }));
          act.appendChild(btn("btn primary", u("new"), function () {
            stop(); close();
            edit({ id: R.newId(), app: APP, nm: "", steps: [], pos: nextPos() }, true);
          }));
          body.appendChild(act);
        }
        function stop() { if (listOpen === render) listOpen = null; }
        listOpen = render;
        render();
      });
    }

    // ---------- 3. Editing ----------
    function stepFields(st, box, changed) {
      var def = CAT[st.op], args = def.args || {};
      Object.keys(args).forEach(function (k) {
        var spec = args[k], label = fieldLabel(st.op, k);
        function set(v) { st[k] = v; changed(); }
        var ch = ad.choices ? ad.choices(st.op, k, st) : null;
        if (ch) { box.appendChild(field(label, select(ch, st[k], set))); return; }
        switch (spec.t) {
          case "bool":
            box.appendChild(check(label, st[k], set));
            break;
          case "enum":
            box.appendChild(field(label, select(spec.v.map(function (v) {
              return [v, ad.enumLabel ? ad.enumLabel(st.op, k, v) : String(v)];
            }), st[k], function (v) { set(typeof spec.v[0] === "number" ? +v : v); })));
            break;
          case "num": case "int":
            var n = inp("number");
            n.min = String(spec.lo); n.max = String(spec.hi); n.step = spec.t === "int" ? "1" : "any";
            n.value = st[k] == null ? "" : String(st[k]);
            n.addEventListener("input", function () { set(n.value === "" ? null : +n.value); });
            box.appendChild(field(label, n));
            break;
          case "color":
            var c = inp("color");
            c.value = st[k] || "#000000";
            c.addEventListener("input", function () { set(c.value.toLowerCase()); });
            box.appendChild(field(label, c));
            break;
          default:
            var s = inp("text");
            s.maxLength = spec.max || 500; s.value = st[k] || "";
            s.addEventListener("input", function () { set(s.value); });
            box.appendChild(field(label, s));
        }
      });
      var note = ad.note ? ad.note(st.op) : "";
      if (note) box.appendChild(el("p", "hint", note));
    }

    // notes: lines shown above the steps (a draft: check, then Save)
    function edit(rec, isNew, notes) {
      var work = JSON.parse(JSON.stringify(rec));
      var unknown = work.steps.filter(function (s) { return !CAT[s.op]; });
      work.steps = work.steps.filter(function (s) { return CAT[s.op]; });
      ad.dialog(isNew ? u("new") : u("edit"), function (body, close) {
        var nm = inp("text"); nm.maxLength = R.MAX_NAME; nm.value = work.nm; nm.placeholder = u("namePh");
        nm.addEventListener("input", function () { work.nm = nm.value; });
        body.appendChild(field(u("name"), nm));
        (notes || []).forEach(function (s) { body.appendChild(el("p", "hint rc-note", s)); });
        if (unknown.length) body.appendChild(el("p", "hint warn", u("newer", { n: unknown.length })));
        var list = el("ol", "rc-steps");
        body.appendChild(list);
        var add = el("div", "rc-add");
        var addSel = select([["", u("add") + "…"]].concat(ad.order.map(function (op) { return [op, opName(op)]; })), "", function (v) {
          if (!v || work.steps.length >= R.MAX_STEPS) return;
          work.steps.push(ad.newStep(v));
          draw();
          var last = list.lastElementChild && list.lastElementChild.querySelector("input, select");
          if (last) last.focus();
        });
        addSel.setAttribute("aria-label", u("add"));
        add.appendChild(addSel);
        body.appendChild(add);
        var warn = el("p", "hint warn");
        warn.hidden = true;
        body.appendChild(warn);
        function mark(li, st) { li.classList.toggle("bad", !R.normStep(st, CAT)); }
        function draw() {
          list.textContent = "";
          addSel.value = "";
          work.steps.forEach(function (st, i) {
            var li = el("li", "rc-step");
            var head = el("div", "rc-step-h");
            head.appendChild(el("span", "rc-step-t", (i + 1) + ". " + opName(st.op)));
            var up = btn("btn small", "↑", function () { if (i) { work.steps.splice(i - 1, 0, work.steps.splice(i, 1)[0]); draw(); } });
            up.setAttribute("aria-label", u("up")); up.title = u("up"); up.disabled = !i;
            var dn = btn("btn small", "↓", function () { if (i < work.steps.length - 1) { work.steps.splice(i + 1, 0, work.steps.splice(i, 1)[0]); draw(); } });
            dn.setAttribute("aria-label", u("down")); dn.title = u("down"); dn.disabled = i === work.steps.length - 1;
            var rm = btn("btn small", "×", function () { work.steps.splice(i, 1); draw(); });
            rm.setAttribute("aria-label", u("remove")); rm.title = u("remove");
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
        act.appendChild(btn("btn", u("cancel"), function () { close(); open(); }));
        act.appendChild(btn("btn primary", u("save"), function () {
          if (!work.steps.length && !unknown.length) { warn.textContent = u("empty"); warn.hidden = false; return; }
          var clean = [];
          for (var i = 0; i < work.steps.length; i++) {
            var c = R.normStep(work.steps[i], CAT);
            if (!c) { warn.textContent = u("bad"); warn.hidden = false; return; }
            clean.push(c);
          }
          work.steps = clean.concat(unknown);
          work.nm = (work.nm || "").trim() || u("untitled");
          put(work);
          close();
          ad.toast(u("saved"));
          open();
        }));
        body.appendChild(act);
        if (isNew) setTimeout(function () { try { nm.focus(); } catch (e) {} }, 0);
      });
    }

    // ---------- 4. Running ----------
    function runDialog(rec) {
      var chk = R.check(rec, CAT), steps = chk.steps;
      var targets = ad.targets(), on = targets.length ? targets[0][0] : "";
      ad.dialog(rec.nm || u("untitled"), function (body, close) {
        var ul = el("ol", "rc-sum");
        steps.forEach(function (st) {
          var li = el("li", "");
          li.appendChild(el("b", "", opName(st.op)));
          var ds = ad.describe(st);
          if (ds) li.appendChild(el("span", "", " " + ds));
          ul.appendChild(li);
        });
        body.appendChild(ul);
        if (chk.skipped) body.appendChild(el("p", "hint warn", u("newer", { n: chk.skipped })));
        if (targets.length > 1) body.appendChild(field(u("on"), select(targets, on, function (v) { on = v; info(); })));
        var will = el("div", "rc-will");
        body.appendChild(will);
        var act = el("div", "dlg-actions");
        var go = btn("btn primary", u("go"));
        act.appendChild(btn("btn", u("cancel"), close));
        act.appendChild(go);
        body.appendChild(act);
        function info() {
          will.textContent = "";
          (ad.preview(steps, on) || []).forEach(function (s) { will.appendChild(el("p", "hint", s)); });
          go.disabled = !steps.length || !targets.length;
        }
        info();
        go.addEventListener("click", function () { close(); run(rec, steps, on); });
      });
    }

    function run(rec, steps, target) {
      var ctl = new AbortController(), stat = null, closeIt = null;
      ad.dialog(rec.nm || u("untitled"), function (body, close) {
        closeIt = close;
        stat = el("p", "hint rc-stat", u("working"));
        stat.setAttribute("role", "status");
        body.appendChild(stat);
        var act = el("div", "dlg-actions");
        act.appendChild(btn("btn", u("stop"), function () { ctl.abort(); close(); }));
        body.appendChild(act);
      });
      var api = { signal: ctl.signal, status: function (s) { if (stat) stat.textContent = s; } };
      return Promise.resolve().then(function () { return ad.run(steps, target, api, rec); }).then(function (res) {
        var stopped = ctl.signal.aborted;
        if (closeIt) closeIt();
        res = res || {};
        var msg = stopped ? u("stopped") : res.msg || "";
        if (res.undo) ad.toast(msg, u("undo"), res.undo); else if (msg) ad.toast(msg);
      }, function (e) {
        if (closeIt) closeIt();
        try { console.error("[orOS] " + APP + ": automation failed", e); } catch (x) {}
        ad.toast(u("fail", { why: String(e && e.message || e).slice(0, 120) }));
      });
    }

    // ---------- 5. Sharing (recipes/share.js) ----------
    function host() {
      try { return root.orosDialog || (root.parent && root.parent.orosDialog) || null; }
      catch (e) { return root.orosDialog || null; }
    }
    function share(r) {
      var text = SH.pack(r);
      if (!text) return;
      var name = SH.fileName(r.nm || u("untitled")), blob = new Blob([text], { type: SH.MIME }), h = host(), done;
      if (h && typeof h.saveFile === "function") {
        var types = [{ description: "orOS automation", accept: {} }];
        types[0].accept[SH.MIME] = [SH.EXT];
        done = h.saveFile({ blob: blob, filename: name, mime: SH.MIME, types: types }).then(function (x) { return !!(x && x.ok); });
      } else {
        var url = URL.createObjectURL(blob), a = el("a");
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
        done = Promise.resolve(true);
      }
      done.then(function (ok) { if (ok) ad.toast(SH.str("sh.shared", { name: name })); }, function () {});
    }
    function pick() {
      var h = host(), accept = SH.EXT + ",application/json";
      if (h && typeof h.openFile === "function") return h.openFile(accept);
      return new Promise(function (resolve) {
        var i = inp("file");
        i.accept = accept;
        i.addEventListener("change", function () { resolve(i.files && i.files[0] || null); });
        i.click();
      });
    }
    // done(): closes the list once a file was read
    function importFile(done) {
      Promise.resolve(pick()).then(function (f) {
        if (!f) return;
        if (f.size > SH.MAX_FILE) { ad.toast(SH.str("sh.err.big")); return; }
        return f.text().then(function (text) {
          var res = SH.unpack(text);
          if (!res.ok) { ad.toast(SH.str("sh.err." + res.err)); return; }
          if (done) done();
          draft(res.draft);
        });
      }).then(null, function () { ad.toast(SH.str("sh.err.read")); });
    }
    function openAt() {
      try { var p = root.parent; return p && p !== root && typeof p.__orosOpenAt === "function" ? p : null; }
      catch (e) { return null; }
    }
    // A draft (file, Assistant, another app) → the editor, not saved.
    // A draft for another app offers to open it there.
    function draft(x) {
      var d = SH ? SH.draft(x) : null;
      if (!d) return false;
      if (d.app !== APP) {
        var p = openAt(), name = SH.appName(d.app);
        ad.dialog(d.nm || u("untitled"), function (body, close) {
          body.appendChild(el("p", "hint", SH.str("sh.other", { app: name })));
          var act = el("div", "dlg-actions");
          act.appendChild(btn("btn", u("close"), close));
          if (p) act.appendChild(btn("btn primary", SH.str("sh.openIn", { app: name }), function () {
            close();
            p.__orosOpenAt(d.app, { newRecipe: d });
          }));
          body.appendChild(act);
        });
        return true;
      }
      var pr = SH.prepare(d.steps, CAT, ad.newStep), notes = [SH.str("sh.check")];
      if (pr.bad) notes.push(pr.bad === 1 ? SH.str("sh.bad1") : SH.str("sh.bad", { n: pr.bad }));
      edit({ id: R.newId(), app: APP, nm: d.nm, steps: pr.steps, pos: nextPos() }, true, notes);
      return true;
    }

    return { open: open, list: mine, run: run, edit: edit, draft: draft };
  }

  root.orosRecipesUI = { mount: mount, str: u, _data: function () { return D; } };
})(typeof window !== "undefined" ? window : this);
