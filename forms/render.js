// ============================================================
// orOS Forms — the form as people fill it in (forms/render.js,
// window.OrosFormsRender). Used by the app's preview and, from wave 2,
// by the public page. Draws one page at a time, hides and shows
// questions as answers change (engine.js shownMap), goes Back / Next
// along the form's jumps (engine.js nextPage) and checks every page
// before it moves on. On the last page Submit hands the clean answers
// (engine.js submit) to opts.onDone.
// Everything from the form is text: only textContent and attributes
// this file sets itself, never innerHTML with form data.
//   OrosFormsRender.mount(host, form, { t, preview, onDone }) → { destroy }
//   t(key, vars) = the page's string lookup (keys "f.*" below)
// ============================================================
(function (root) {
  "use strict";

  var E = root.OrosFormsEngine;

  var STRINGS = {
    en: {
      "f.req": "Required", "f.reqMark": "Required question",
      "f.back": "Back", "f.next": "Next", "f.submit": "Submit",
      "f.page": "Page {n} of {m}", "f.choose": "Choose…", "f.other": "Other", "f.otherText": "Your answer",
      "f.yes": "Yes", "f.no": "No", "f.stars": "{n} of {m} stars", "f.clear": "Clear choice",
      "f.thanks": "Thank you. Your answers have been recorded.",
      "f.preview": "This is a preview: nothing was sent.", "f.again": "Fill in again",
      "f.errs": "Some answers need a look before you go on.",
      "f.err.req": "This question needs an answer.",
      "f.err.short": "Write at least {n} characters.", "f.err.long": "Write at most {n} characters.",
      "f.err.email": "That doesn't look like an e-mail address.",
      "f.err.phone": "That doesn't look like a phone number.",
      "f.err.num": "Enter a number.", "f.err.int": "Enter a whole number.",
      "f.err.min": "The smallest allowed is {n}.", "f.err.max": "The largest allowed is {n}.",
      "f.err.date": "Enter a date.", "f.err.time": "Enter a time.",
      "f.err.opt": "Choose one of the answers.", "f.err.other": "Write your other answer.",
      "f.err.few": "Choose at least {n}.", "f.err.many": "Choose at most {n}.",
      "f.err.rows": "Answer every row.",
      "f.untitled": "Untitled form", "f.noQ": "Untitled question"
    },
    el: {
      "f.req": "Υποχρεωτικό", "f.reqMark": "Υποχρεωτική ερώτηση",
      "f.back": "Πίσω", "f.next": "Επόμενο", "f.submit": "Υποβολή",
      "f.page": "Σελίδα {n} από {m}", "f.choose": "Επιλέξτε…", "f.other": "Άλλο", "f.otherText": "Η απάντησή σας",
      "f.yes": "Ναι", "f.no": "Όχι", "f.stars": "{n} από {m} αστέρια", "f.clear": "Καθαρισμός επιλογής",
      "f.thanks": "Ευχαριστούμε. Οι απαντήσεις σας καταχωρίστηκαν.",
      "f.preview": "Αυτή είναι προεπισκόπηση: δεν στάλθηκε τίποτα.", "f.again": "Συμπλήρωση ξανά",
      "f.errs": "Κάποιες απαντήσεις θέλουν μια ματιά πριν συνεχίσετε.",
      "f.err.req": "Αυτή η ερώτηση χρειάζεται απάντηση.",
      "f.err.short": "Γράψτε τουλάχιστον {n} χαρακτήρες.", "f.err.long": "Γράψτε το πολύ {n} χαρακτήρες.",
      "f.err.email": "Δεν μοιάζει με διεύθυνση email.",
      "f.err.phone": "Δεν μοιάζει με αριθμό τηλεφώνου.",
      "f.err.num": "Γράψτε έναν αριθμό.", "f.err.int": "Γράψτε έναν ακέραιο αριθμό.",
      "f.err.min": "Το μικρότερο επιτρεπτό είναι {n}.", "f.err.max": "Το μεγαλύτερο επιτρεπτό είναι {n}.",
      "f.err.date": "Γράψτε μια ημερομηνία.", "f.err.time": "Γράψτε μια ώρα.",
      "f.err.opt": "Διαλέξτε μία από τις απαντήσεις.", "f.err.other": "Γράψτε την άλλη απάντησή σας.",
      "f.err.few": "Διαλέξτε τουλάχιστον {n}.", "f.err.many": "Διαλέξτε το πολύ {n}.",
      "f.err.rows": "Απαντήστε σε κάθε γραμμή.",
      "f.untitled": "Φόρμα χωρίς τίτλο", "f.noQ": "Ερώτηση χωρίς τίτλο"
    }
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // Text with line breaks, as paragraphs (no markup from the form).
  function paras(host, text) {
    String(text || "").split(/\n{2,}/).forEach(function (p) {
      var node = el("p", "ff-text");
      p.split("\n").forEach(function (l, i) {
        if (i) node.appendChild(document.createElement("br"));
        node.appendChild(document.createTextNode(l));
      });
      host.appendChild(node);
    });
  }

  function mount(host, rawForm, opts) {
    opts = opts || {};
    var t = opts.t || function (k) { return STRINGS.en[k] || k; };
    var form = E.normForm(rawForm);
    var list = E.pages(form);
    var ans = {}, stack = [0], uid = "ff" + Math.random().toString(36).slice(2, 7);
    var nodes = {};       // question id → its block
    var errShown = false;

    host.textContent = "";
    var root = el("div", "ff");
    host.appendChild(root);

    function errText(q, code) {
      var n = { short: q.minL, long: q.maxL, min: q.min, max: q.max, few: q.minC, many: q.maxC }[code];
      return t("f.err." + code, { n: n == null ? "" : n });
    }

    function setAns(id, v) {
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) delete ans[id];
      else ans[id] = v;
      refresh();
    }

    // Shown/hidden as the answers change; errors clear as they are fixed.
    function refresh() {
      var shown = E.shownMap(form, ans);
      Object.keys(nodes).forEach(function (id) { nodes[id].hidden = !shown[id]; });
      if (errShown) showErrs(E.checkPage(form, stack[stack.length - 1], ans), false);
      var nx = E.nextPage(form, stack[stack.length - 1], ans, shown);
      var btn = root.querySelector(".ff-go");
      if (btn) btn.textContent = nx < 0 ? t("f.submit") : t("f.next");
    }

    function showErrs(errs, focus) {
      var first = null;
      Object.keys(nodes).forEach(function (id) {
        var box = nodes[id].querySelector(".ff-err");
        if (!box) return;
        var code = errs[id];
        box.textContent = code ? errText(nodes[id]._q, code) : "";
        box.hidden = !code;
        nodes[id].classList.toggle("bad", !!code);
        var inp = nodes[id].querySelector("input, textarea, select");
        if (inp) { if (code) inp.setAttribute("aria-invalid", "true"); else inp.removeAttribute("aria-invalid"); }
        if (code && !first) first = nodes[id];
      });
      var sum = root.querySelector(".ff-sum");
      if (sum) sum.hidden = !first;
      if (first && focus) {
        var f = first.querySelector("input, textarea, select");
        if (f) f.focus();
        if (first.scrollIntoView) first.scrollIntoView({ block: "center" });
      }
      return !first;
    }

    // ---------- controls ----------
    function textInput(q, id) {
      var inp;
      if (q.t === "para") { inp = el("textarea", "ff-in"); inp.rows = 4; inp.maxLength = q.maxL || E.LIM.para; }
      else {
        inp = el("input", "ff-in");
        inp.type = { email: "email", phone: "tel", date: "date", time: "time" }[q.t] || "text";
        if (q.t === "number") inp.inputMode = q.int ? "numeric" : "decimal";
        if (q.t === "email") inp.autocomplete = "email";
        if (q.t === "phone") inp.autocomplete = "tel";
        if (q.t === "date") { if (q.min) inp.min = q.min; if (q.max) inp.max = q.max; }
        if (q.t === "text") inp.maxLength = q.maxL || E.LIM.text;
      }
      inp.id = id;
      if (ans[q.id] != null) inp.value = String(ans[q.id]);
      inp.addEventListener("input", function () { setAns(q.id, inp.value); });
      return inp;
    }

    function choiceList(q, id, multi) {
      var box = el("div", "ff-opts");
      var cur = ans[q.id];
      var items = q.t === "yesno"
        ? [{ id: "yes", label: t("f.yes") }, { id: "no", label: t("f.no") }]
        : q.opts.slice();
      if (q.other) items.push({ id: E.OTHER, label: t("f.other") });
      var otherIn = null;
      items.forEach(function (o, i) {
        var lab = el("label", "ff-opt");
        var inp = el("input");
        inp.type = multi ? "checkbox" : "radio";
        inp.name = id;
        inp.value = o.id;
        inp.id = id + "-" + i;
        inp.checked = multi ? Array.isArray(cur) && cur.indexOf(o.id) >= 0 : cur === o.id;
        inp.addEventListener("change", function () {
          if (multi) {
            var v = [].map.call(box.querySelectorAll("input[type=checkbox]:checked"), function (n) { return n.value; });
            setAns(q.id, v);
          } else setAns(q.id, inp.value);
          if (otherIn) otherIn.disabled = !box.querySelector("input[value='" + E.OTHER + "']").checked;
        });
        lab.appendChild(inp);
        lab.appendChild(el("span", "", o.label || (q.t === "yesno" ? "" : "…")));
        box.appendChild(lab);
        if (o.id === E.OTHER) {
          otherIn = el("input", "ff-in ff-other");
          otherIn.type = "text";
          otherIn.maxLength = E.LIM.other;
          otherIn.placeholder = t("f.otherText");
          otherIn.setAttribute("aria-label", t("f.otherText"));
          otherIn.value = ans[q.id + ".o"] || "";
          otherIn.disabled = !inp.checked;
          otherIn.addEventListener("input", function () {
            if (otherIn.value) ans[q.id + ".o"] = otherIn.value; else delete ans[q.id + ".o"];
            refresh();
          });
          box.appendChild(otherIn);
        }
      });
      if (!multi && !q.req) {
        var clr = el("button", "ff-clear", t("f.clear"));
        clr.type = "button";
        clr.addEventListener("click", function () {
          [].forEach.call(box.querySelectorAll("input[type=radio]"), function (n) { n.checked = false; });
          if (otherIn) otherIn.disabled = true;
          setAns(q.id, null);
        });
        box.appendChild(clr);
      }
      return box;
    }

    function selectInput(q, id) {
      var s = el("select", "ff-in");
      s.id = id;
      var none = el("option", "", t("f.choose"));
      none.value = "";
      s.appendChild(none);
      q.opts.forEach(function (o) {
        var op = el("option", "", o.label || "…");
        op.value = o.id;
        s.appendChild(op);
      });
      s.value = ans[q.id] || "";
      s.addEventListener("change", function () { setAns(q.id, s.value); });
      return s;
    }

    function scaleInput(q, id) {
      var wrap = el("div", "ff-scale" + (q.t === "stars" ? " stars" : ""));
      var lo = q.t === "scale" ? q.lo : 1;
      var row = el("div", "ff-scale-row");
      if (q.t === "scale" && q.loL) wrap.appendChild(el("span", "ff-end lo", q.loL));
      for (var n = lo; n <= q.hi; n++) (function (n) {
        var lab = el("label", "ff-pt");
        var inp = el("input");
        inp.type = "radio";
        inp.name = id;
        inp.value = String(n);
        inp.checked = ans[q.id] === n;
        if (q.t === "stars") inp.setAttribute("aria-label", t("f.stars", { n: n, m: q.hi }));
        inp.addEventListener("change", function () { setAns(q.id, n); paint(); });
        lab.appendChild(inp);
        lab.appendChild(el("span", "", q.t === "stars" ? "★" : String(n)));
        row.appendChild(lab);
      })(n);
      wrap.appendChild(row);
      if (q.t === "scale" && q.hiL) wrap.appendChild(el("span", "ff-end hi", q.hiL));
      function paint() {
        if (q.t !== "stars") return;
        [].forEach.call(row.querySelectorAll("label"), function (l, i) { l.classList.toggle("on", ans[q.id] >= i + 1); });
      }
      paint();
      return wrap;
    }

    function matrixInput(q, id) {
      var wrap = el("div", "ff-matrix");
      var tbl = el("table");
      var head = el("tr");
      head.appendChild(el("th"));
      q.opts.forEach(function (c) { head.appendChild(el("th", "", c.label)); });
      var thead = el("thead");
      thead.appendChild(head);
      tbl.appendChild(thead);
      var tb = el("tbody");
      var cur = ans[q.id] || {};
      q.rows.forEach(function (r, ri) {
        var tr = el("tr");
        tr.appendChild(el("th", "", r.label));
        q.opts.forEach(function (c, ci) {
          var td = el("td");
          var inp = el("input");
          inp.type = q.multi ? "checkbox" : "radio";
          inp.name = id + "-r" + ri;
          inp.value = c.id;
          inp.setAttribute("aria-label", (r.label || "") + ": " + (c.label || ""));
          inp.checked = q.multi ? Array.isArray(cur[r.id]) && cur[r.id].indexOf(c.id) >= 0 : cur[r.id] === c.id;
          inp.addEventListener("change", function () {
            var v = {};
            q.rows.forEach(function (rr, rj) {
              var picked = [].map.call(tb.querySelectorAll("input[name='" + id + "-r" + rj + "']:checked"),
                function (n) { return n.value; });
              if (picked.length) v[rr.id] = q.multi ? picked : picked[0];
            });
            setAns(q.id, Object.keys(v).length ? v : null);
          });
          td.appendChild(inp);
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      wrap.appendChild(tbl);
      return wrap;
    }

    function item(q) {
      var box = el("div", "ff-q");
      box._q = q;
      var id = uid + "-" + q.id;
      if (q.t === "info") {
        box.className = "ff-q ff-info";
        if (q.label) box.appendChild(el("h3", "ff-info-h", q.label));
        if (q.help) paras(box, q.help);
        return box;
      }
      var group = q.t === "choice" || q.t === "multi" || q.t === "yesno" || q.t === "scale" ||
                  q.t === "stars" || q.t === "matrix";
      var lab = el(group ? "div" : "label", "ff-label");
      lab.id = id + "-l";
      if (!group) lab.htmlFor = id;
      lab.appendChild(document.createTextNode(q.label || t("f.noQ")));
      if (q.req) {
        var star = el("span", "ff-star", " *");
        star.title = t("f.req");
        star.setAttribute("aria-label", t("f.reqMark"));
        lab.appendChild(star);
      }
      box.appendChild(lab);
      if (q.help) { var h = el("div", "ff-help"); h.id = id + "-h"; paras(h, q.help); box.appendChild(h); }
      var ctl;
      if (q.t === "choice" || q.t === "yesno") ctl = choiceList(q, id, false);
      else if (q.t === "multi") ctl = choiceList(q, id, true);
      else if (q.t === "select") ctl = selectInput(q, id);
      else if (q.t === "scale" || q.t === "stars") ctl = scaleInput(q, id);
      else if (q.t === "matrix") ctl = matrixInput(q, id);
      else ctl = textInput(q, id);
      if (group) { ctl.setAttribute("role", q.t === "multi" || q.t === "matrix" ? "group" : "radiogroup"); ctl.setAttribute("aria-labelledby", lab.id); }
      else if (q.help) ctl.setAttribute("aria-describedby", id + "-h");
      if (q.req && !group) ctl.required = true;
      box.appendChild(ctl);
      var err = el("div", "ff-err");
      err.setAttribute("role", "alert");
      err.hidden = true;
      box.appendChild(err);
      return box;
    }

    // ---------- pages ----------
    function drawPage() {
      var pi = stack[stack.length - 1], pg = list[pi];
      root.textContent = "";
      nodes = {};
      errShown = false;
      var card = el("div", "ff-card");
      if (pi === 0) {
        card.appendChild(el("h2", "ff-title", form.title || t("f.untitled")));
        if (form.desc) paras(card, form.desc);
        if (form.set.note) { var nb = el("div", "ff-note"); paras(nb, form.set.note); card.appendChild(nb); }
      } else {
        card.appendChild(el("div", "ff-formname", form.title || t("f.untitled")));
        if (pg.head.label) card.appendChild(el("h2", "ff-title", pg.head.label));
        if (pg.head.help) paras(card, pg.head.help);
      }
      if (form.set.prog && list.length > 1) {
        var bar = el("div", "ff-prog");
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-valuemin", "1");
        bar.setAttribute("aria-valuemax", String(list.length));
        bar.setAttribute("aria-valuenow", String(pi + 1));
        bar.setAttribute("aria-label", t("f.page", { n: pi + 1, m: list.length }));
        var fill = el("div", "fill");
        fill.style.width = Math.round((pi + 1) / list.length * 100) + "%";
        bar.appendChild(fill);
        card.appendChild(bar);
      }
      root.appendChild(card);
      pg.items.forEach(function (q) {
        var b = item(q);
        nodes[q.id] = b;
        root.appendChild(b);
      });
      var sum = el("div", "ff-sum", t("f.errs"));
      sum.setAttribute("role", "alert");
      sum.hidden = true;
      root.appendChild(sum);
      var nav = el("div", "ff-nav");
      if (stack.length > 1) {
        var back = el("button", "ff-btn", t("f.back"));
        back.type = "button";
        back.addEventListener("click", function () { stack.pop(); drawPage(); });
        nav.appendChild(back);
      }
      var go = el("button", "ff-btn pri ff-go", t("f.next"));
      go.type = "button";
      go.addEventListener("click", forward);
      nav.appendChild(go);
      root.appendChild(nav);
      refresh();
      if (root.scrollIntoView && stack.length > 1) root.scrollIntoView({ block: "start" });
    }

    function forward() {
      var pi = stack[stack.length - 1];
      errShown = true;
      if (!showErrs(E.checkPage(form, pi, ans), true)) return;
      var nx = E.nextPage(form, pi, ans);
      if (nx >= 0) { stack.push(nx); drawPage(); return; }
      var res = E.submit(form, ans);
      if (!res.ok) {
        // A page earlier on the way has a problem (it can only happen if
        // answers changed on a page left behind): go there.
        while (stack.length > 1 && stack[stack.length - 1] !== res.page) stack.pop();
        drawPage();
        errShown = true;
        showErrs(res.errs, true);
        return;
      }
      done(res.answers);
    }

    function done(answers) {
      root.textContent = "";
      var card = el("div", "ff-card ff-done");
      card.appendChild(el("h2", "ff-title", form.title || t("f.untitled")));
      paras(card, form.set.thanks || t("f.thanks"));
      if (opts.preview) {
        card.appendChild(el("p", "ff-dim", t("f.preview")));
        var again = el("button", "ff-btn", t("f.again"));
        again.type = "button";
        again.addEventListener("click", function () { ans = {}; stack = [0]; drawPage(); });
        card.appendChild(again);
      }
      root.appendChild(card);
      if (typeof opts.onDone === "function") opts.onDone(answers);
    }

    drawPage();
    return {
      destroy: function () { host.textContent = ""; },
      answers: function () { return JSON.parse(JSON.stringify(ans)); }
    };
  }

  root.OrosFormsRender = { mount: mount, STRINGS: STRINGS };
})(window);
