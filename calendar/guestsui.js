// ============================================================
// orOS Calendar — the guest list of an event (wave E1): the window
// behind the event dialog's "Guests…" button, the Contacts picker,
// CSV, print and the To-Do tasks. The data rules are calendar/
// guests.js (OrosCalGuests); this file only draws and saves.
//
// Storage key oros-calendar-guests = the synced slice "calguests"
// (registered here with OrosCalGuests.merge). Every text goes in
// with textContent; nothing here uses innerHTML.
//
// window.OrosCalGuestsUI.init(ctx) — called once by calendar.js:
//   ctx = { t, loc, note(text), findEvent(id), canHave(ev),
//           whenText(ev), shellOpenAt(), mailReady(), dialogHost(),
//           contacts() → { contacts, labels, deleted }, ctName(c) }
// returns { open(evId), count(evId), cleanup(goneIds) }.
// ============================================================
(function (root) {
  "use strict";

  var KEY = "oros-calendar-guests";
  var G = root.OrosCalGuests;

  function init(ctx) {
    var t = ctx.t;
    function $(id) { return document.getElementById(id); }
    function fmt(k, o) {
      var s = t(k);
      Object.keys(o || {}).forEach(function (n) { s = s.split("{" + n + "}").join(String(o[n])); });
      return s;
    }
    function el(tag, cls, txt) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (txt !== undefined && txt !== null) e.textContent = txt;
      return e;
    }
    function gid() { return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

    // ---------- storage + sync ----------
    var data = G.empty(), lastText = null;
    function load() {
      try { data = G.merge(JSON.parse(localStorage.getItem(KEY) || "null"), null); }
      catch (e) { data = G.empty(); }
    }
    function save(next) {
      data = G.merge(next, null);
      var text = JSON.stringify(data);
      if (text === lastText) return;
      try { localStorage.setItem(KEY, text); lastText = text; }
      catch (e) { ctx.note(t("toast.quota")); return; }
      try { if (window.__orosSyncApi) window.__orosSyncApi.dirty(); } catch (e2) {}
    }
    load();
    try { lastText = localStorage.getItem(KEY); } catch (e) {}
    var syncApi = null;
    try { syncApi = (window.parent && window.parent.orosSync) || window.orosSync; } catch (e) {}
    try {
      if (syncApi && typeof syncApi.registerSlice === "function") {
        syncApi.registerSlice("calguests",
          function () {
            try { return G.merge(JSON.parse(localStorage.getItem(KEY) || "null"), null); }
            catch (e) { return G.merge(data, null); }
          },
          function (d) {          // pull-fed: never marks dirty (R6)
            if (!d || typeof d !== "object") return;
            data = G.merge(d, null);
            try { lastText = JSON.stringify(data); localStorage.setItem(KEY, lastText); } catch (e) {}
            if (openId && $("gu-dlg").open) render();
            if (ctx.onChange) ctx.onChange();
          },
          KEY, G.merge);
      }
    } catch (e) { console.warn("[Calendar] guests sync registration failed:", e); }

    // ---------- the guest window ----------
    var openId = null, editId = null, delArm = false, lastGiven = null;
    function list() { return G.listOf(data, openId); }
    function ev() { return openId ? ctx.findEvent(openId) : null; }

    function fillSelect(sel, items, val) {
      sel.textContent = "";
      items.forEach(function (it) {
        var o = el("option", "", it[1]); o.value = it[0]; sel.appendChild(o);
      });
      if (val !== undefined) sel.value = val;
    }
    var ORDER = ["y", "m", "i", "n", "w"];
    function statusItems() { return ORDER.map(function (s) { return [s, t("gu.s." + s)]; }); }

    function timeOf(ms) {
      try { return new Date(ms).toLocaleTimeString(ctx.loc(), { hour: "2-digit", minute: "2-digit" }); }
      catch (e) { return ""; }
    }
    function stamp(ms) {
      try { return new Date(ms).toLocaleString(ctx.loc(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
      catch (e) { return ""; }
    }

    function renderSum() {
      var l = list(), c = G.counts(l), box = $("gu-sum");
      box.textContent = "";
      box.appendChild(el("b", "", l && l.cap > 0
        ? fmt("gu.sum.places", { s: c.seats, cap: l.cap })
        : fmt("gu.sum.people", { s: c.seats })));
      box.appendChild(el("span", "gu-parts", fmt("gu.sum.parts", { y: c.yes, m: c.maybe, i: c.open, n: c.no, w: c.wait })));
      if (c.inN) box.appendChild(el("span", "gu-parts", fmt("gu.sum.in", { n: c.inN, s: c.inSeats })));
      var nx = G.nextUp(l);
      $("gu-next").hidden = !nx;
      if (nx) {
        $("gu-next-text").textContent = fmt(c.free === 1 ? "gu.free1" : "gu.free",
          { f: c.free, name: nx.n + (nx.k ? " (" + fmt("gu.plus", { k: nx.k }) + ")" : "") });
        $("gu-give").dataset.g = nx.id;
      }
      var b = $("ev-guests");
      if (b && !b.hidden) b.textContent = c.total ? fmt("gu.btn.n", { n: c.total }) : t("gu.btn");
    }

    function row(g, waitPos) {
      var li = el("li", "gu-row gu-" + g.s + (g["in"] ? " gu-isin" : ""));
      var main = el("button", "gu-main");
      main.type = "button";
      main.appendChild(el("span", "gu-name", g.n + (g.k ? " " + fmt("gu.plus", { k: g.k }) : "")));
      var sub = [g.m, g.p, g.x].filter(Boolean).join(" · ");
      if (sub) main.appendChild(el("span", "gu-sub", sub));
      main.setAttribute("aria-label", t("gu.edit") + ": " + g.n);
      main.addEventListener("click", function () { openForm(g); });
      li.appendChild(main);
      var ctl = el("div", "gu-ctl");
      var sel = el("select", "gu-st");
      sel.setAttribute("aria-label", t("gu.f.answer") + ": " + g.n);
      fillSelect(sel, statusItems(), g.s);
      sel.addEventListener("change", function () { setStatus(g, sel.value); });
      ctl.appendChild(sel);
      if (g.s === "w") ctl.appendChild(el("span", "gu-pos", fmt("gu.waitpos", { n: waitPos })));
      var inb = el("button", "btn gu-in" + (g["in"] ? " on" : ""), g["in"] ? fmt("gu.in.at", { time: timeOf(g["in"]) }) : t("gu.in"));
      inb.type = "button";
      inb.setAttribute("aria-pressed", g["in"] ? "true" : "false");
      inb.addEventListener("click", function () { toggleIn(g, inb); });
      ctl.appendChild(inb);
      li.appendChild(ctl);
      return li;
    }

    function renderList() {
      var l = list(), ul = $("gu-list"), q = $("gu-q").value, f = $("gu-f").value || "all";
      ul.textContent = "";
      var waitIdx = {};
      G.waiting(l).forEach(function (g, i) { waitIdx[g.id] = i + 1; });
      var shown = G.view(l, q, f);
      shown.forEach(function (g) { ul.appendChild(row(g, waitIdx[g.id])); });
      var none = !(l && l.g.length);
      $("gu-empty").hidden = shown.length > 0;
      $("gu-empty").textContent = none ? t("gu.none") : t("gu.nomatch");
    }
    function render() {
      var e = ev();
      if (!e) { $("gu-dlg").close(); return; }
      $("gu-dlg-title").textContent = t("gu.title") + " · " + (e.title || t("ev.untitled"));
      $("gu-when").textContent = ctx.whenText(e);
      var l = list(), capEl = $("gu-cap");
      if (document.activeElement !== capEl) capEl.value = l && l.cap > 0 ? String(l.cap) : "0";
      $("gu-todo").hidden = !ctx.shellOpenAt();
      renderSum();
      renderList();
    }

    function apply(r, name) {
      if (r.error) {
        ctx.note(t(r.error === "lists" ? "gu.err.lists" : r.error === "full-list" ? "gu.err.full" : "gu.err.name"));
        return false;
      }
      save(r.state);
      if (r.bumped) ctx.note(fmt("gu.full", { name: name || r.guest.n }));
      return true;
    }
    function setStatus(g, s) {
      apply(G.putGuest(data, openId, { id: g.id, s: s }, Date.now()), g.n);
      hideTell();
      render();
    }
    // Undoing a check-in takes a second tap within 4 s (a slip at the
    // door must not let a guest in twice).
    var undoArm = null, undoTimer = null;
    function toggleIn(g, btn) {
      if (g["in"]) {
        if (undoArm !== g.id) {
          undoArm = g.id;
          btn.textContent = t("gu.in.undo1");
          btn.setAttribute("aria-label", fmt("gu.in.undo", { name: g.n }));
          clearTimeout(undoTimer);
          undoTimer = setTimeout(function () { undoArm = null; renderList(); }, 4000);
          return;
        }
        undoArm = null; clearTimeout(undoTimer);
        save(G.checkIn(data, openId, g.id, false, Date.now()));
        render();
        return;
      }
      save(G.checkIn(data, openId, g.id, true, Date.now()));
      render();
    }

    // ---------- add / change one guest ----------
    function openForm(g) {
      editId = g ? g.id : null;
      delArm = false;
      $("gu-n").value = g ? g.n : "";
      $("gu-m").value = g && g.m ? g.m : "";
      $("gu-p").value = g && g.p ? g.p : "";
      fillSelect($("gu-s"), statusItems(), g ? g.s : "i");
      $("gu-k").value = g && g.k ? String(g.k) : "0";
      $("gu-x").value = g && g.x ? g.x : "";
      $("gu-del").hidden = !g;
      $("gu-del").textContent = t("gu.del");
      $("gu-form").hidden = false;
      setTimeout(function () { $("gu-n").focus(); }, 30);
    }
    function closeForm() { $("gu-form").hidden = true; editId = null; delArm = false; }
    $("gu-add").addEventListener("click", function () { openForm(null); });
    $("gu-form-no").addEventListener("click", closeForm);
    $("gu-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("gu-n").value.trim();
      if (!name) { ctx.note(t("gu.err.name")); $("gu-n").focus(); return; }
      var k = parseInt($("gu-k").value, 10);
      var raw = { id: editId || gid(), n: name, m: $("gu-m").value.trim(), p: $("gu-p").value.trim(),
                  s: $("gu-s").value, k: isFinite(k) ? k : 0, x: $("gu-x").value.trim() };
      if (apply(G.putGuest(data, openId, raw, Date.now()), name)) { closeForm(); hideTell(); render(); }
    });
    $("gu-del").addEventListener("click", function () {
      if (!editId) return;
      if (!delArm) { delArm = true; $("gu-del").textContent = t("gu.del.sure"); return; }
      var l = list(), g = l && l.g.filter(function (x) { return x.id === editId; })[0];
      save(G.removeGuest(data, openId, editId, Date.now()));
      closeForm();
      if (g) ctx.note(fmt("gu.removed", { name: g.n }));
      render();
    });

    // ---------- places + waiting list ----------
    $("gu-cap").addEventListener("change", function () {
      var v = $("gu-cap").value.trim(), n = v === "" ? 0 : Number(v);
      if (!isFinite(n) || n < 0 || Math.floor(n) !== n) { ctx.note(t("gu.err.cap")); render(); return; }
      save(G.setCap(data, openId, n, Date.now()));
      render();
    });
    $("gu-give").addEventListener("click", function () {
      var l = list(), id = $("gu-give").dataset.g;
      var g = l && l.g.filter(function (x) { return x.id === id; })[0];
      if (!g) return;
      if (!apply(G.putGuest(data, openId, { id: g.id, s: "y" }, Date.now()), g.n)) return;
      lastGiven = g.id;
      render();
      showTell(g);
    });
    function hideTell() { $("gu-tell").hidden = true; lastGiven = null; }
    function showTell(g) {
      var e = ev(), box = $("gu-tell-row");
      var msg = fmt("gu.tell.msg", { t: e ? (e.title || t("ev.untitled")) : "", when: e ? ctx.whenText(e) : "" });
      $("gu-tell-text").textContent = fmt("gu.tell", { name: g.n });
      box.textContent = "";
      var p = ctx.shellOpenAt();
      if (g.m) {
        var b = el("button", "btn", t("gu.tell.mail"));
        b.type = "button";
        b.addEventListener("click", function () {
          var subj = e ? String(e.title || "").slice(0, 300) : "";
          if (p && ctx.mailReady()) { p.__orosOpenAt("mail", { compose: { to: g.m, subject: subj, body: msg } }); return; }
          linkGo("mailto:" + encodeURIComponent(g.m) + "?subject=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(msg));
        });
        box.appendChild(b);
      }
      if (g.p && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || "")) {
        var s = el("button", "btn", t("gu.tell.sms"));
        s.type = "button";
        s.addEventListener("click", function () {
          linkGo("sms:" + g.p.replace(/[^0-9+]/g, "") + "?&body=" + encodeURIComponent(msg));
        });
        box.appendChild(s);
      }
      var c = el("button", "btn", t("gu.tell.copy"));
      c.type = "button";
      c.addEventListener("click", function () {
        var done = function () { ctx.note(t("gu.tell.copied")); };
        try { navigator.clipboard.writeText(msg).then(done, function () {}); } catch (err) {}
      });
      box.appendChild(c);
      $("gu-tell").hidden = false;
    }
    function linkGo(href) {
      var a = document.createElement("a");
      a.href = href; a.rel = "noopener"; a.target = "_blank";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    // ---------- search + filter ----------
    $("gu-q").addEventListener("input", renderList);
    $("gu-f").addEventListener("change", renderList);

    // ---------- from Contacts ----------
    var pickSel = {};
    function pickRows() {
      var raw = ctx.contacts() || {}, gone = {};
      (Array.isArray(raw.deleted) ? raw.deleted : []).forEach(function (d) { if (d && d.id) gone[d.id] = d.mtime || 0; });
      return (Array.isArray(raw.contacts) ? raw.contacts : []).filter(function (c) {
        return c && typeof c.id === "string" && !(gone[c.id] >= (c.mtime || 0));
      });
    }
    function had() {
      var l = list(), m = {};
      (l ? l.g : []).forEach(function (g) { if (g.c) m[g.c] = 1; });
      return m;
    }
    function fold(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
    function pickShown() {
      var q = fold($("gu-pick-q").value).trim(), lb = $("gu-pick-lbl").value;
      return pickRows().filter(function (c) {
        if (lb && !(Array.isArray(c.labelIds) && c.labelIds.indexOf(lb) !== -1)) return false;
        if (!q) return true;
        var em = (c.emails || []).map(function (x) { return x && x.v; }).join(" ");
        return fold(ctx.ctName(c) + " " + em + " " + (c.org || "")).indexOf(q) !== -1;
      }).sort(function (a, b) { return ctx.ctName(a).localeCompare(ctx.ctName(b)); });
    }
    function pickCount() {
      var n = Object.keys(pickSel).length;
      $("gu-pick-go").textContent = n ? fmt("gu.pick.go", { n: n }) : t("gu.pick.go0");
      $("gu-pick-go").disabled = !n;
    }
    function renderPick() {
      var ul = $("gu-pick-list"), have = had(), shown = pickShown(), all = true, any = false;
      ul.textContent = "";
      shown.slice(0, 500).forEach(function (c) {
        var li = el("li", "gu-pick-row"), lab = el("label", "chk");
        var cb = el("input");
        cb.type = "checkbox";
        var old = !!have[c.id];
        cb.disabled = old;
        cb.checked = old || !!pickSel[c.id];
        if (!old) { any = true; if (!cb.checked) all = false; }
        cb.addEventListener("change", function () {
          if (cb.checked) pickSel[c.id] = c; else delete pickSel[c.id];
          pickCount();
        });
        lab.appendChild(cb);
        var txt = el("span", "gu-pick-txt");
        txt.appendChild(el("span", "gu-name", ctx.ctName(c)));
        var em = c.emails && c.emails[0] ? c.emails[0].v : (c.phones && c.phones[0] ? c.phones[0].v : "");
        if (old) txt.appendChild(el("span", "gu-sub", t("gu.pick.had")));
        else if (em) txt.appendChild(el("span", "gu-sub", em));
        lab.appendChild(txt);
        li.appendChild(lab);
        ul.appendChild(li);
      });
      $("gu-pick-empty").hidden = shown.length > 0;
      $("gu-pick-all").checked = any && all;
      $("gu-pick-all").disabled = !any;
      pickCount();
    }
    $("gu-from-ct").addEventListener("click", function () {
      pickSel = {};
      $("gu-pick-q").value = "";
      var raw = ctx.contacts() || {}, items = [["", t("gu.pick.lblall")]];
      (Array.isArray(raw.labels) ? raw.labels : []).forEach(function (l) {
        if (l && typeof l.id === "string" && typeof l.name === "string") items.push([l.id, l.name.slice(0, 40)]);
      });
      fillSelect($("gu-pick-lbl"), items, "");
      renderPick();
      $("gu-pick").showModal();
    });
    $("gu-pick-q").addEventListener("input", renderPick);
    $("gu-pick-lbl").addEventListener("change", renderPick);
    $("gu-pick-all").addEventListener("change", function () {
      var on = $("gu-pick-all").checked, have = had();
      pickShown().slice(0, 500).forEach(function (c) {
        if (have[c.id]) return;
        if (on) pickSel[c.id] = c; else delete pickSel[c.id];
      });
      renderPick();
    });
    $("gu-pick-no").addEventListener("click", function () { $("gu-pick").close(); });
    $("gu-pick-go").addEventListener("click", function () {
      var ids = Object.keys(pickSel), st = data, n = 0, now = Date.now(), err = null;
      ids.forEach(function (id) {
        if (err) return;
        var c = pickSel[id], raw = G.fromContact(c, ctx.ctName(c));
        raw.id = gid() + n;
        raw.s = "i";
        var r = G.putGuest(st, openId, raw, now);
        if (r.error) { err = r.error; return; }
        st = r.state; n++;
      });
      if (n) save(st);
      if (err) ctx.note(t(err === "lists" ? "gu.err.lists" : err === "full-list" ? "gu.err.full" : "gu.err.name"));
      else ctx.note(fmt("gu.pick.added", { n: n }));
      $("gu-pick").close();
      render();
    });

    // ---------- CSV, print, To-Do ----------
    function fileName(ext) {
      var e = ev(), base = String((e && e.title) || t("gu.pr.title")).replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
      return (base || "guests") + " - " + t("gu.title") + "." + ext;
    }
    $("gu-csv").addEventListener("click", function () {
      var labels = {
        head: ["name", "mail", "phone", "answer", "plus", "wait", "in", "note"].map(function (k) { return t("gu.csv." + k); }),
        status: { i: t("gu.s.i"), y: t("gu.s.y"), m: t("gu.s.m"), n: t("gu.s.n"), w: t("gu.s.w") }
      };
      var text = G.csv(list(), labels, function (ms) { return new Date(ms).toISOString().slice(0, 16).replace("T", " "); });
      var blob = new Blob([text], { type: "text/csv;charset=utf-8" }), name = fileName("csv");
      var dh = ctx.dialogHost(), done = function () { ctx.note(t("gu.csv.done")); };
      if (dh && typeof dh.saveFile === "function") {
        dh.saveFile({ blob: blob, filename: name, mime: "text/csv;charset=utf-8",
                      types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }] })
          .then(function (r) { if (r && r.ok) done(); });
        return;
      }
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      done();
    });
    $("gu-print").addEventListener("click", function () {
      var e = ev(), l = list();
      if (!e) return;
      var box = $("print-area");
      if (!box) { box = el("div"); box.id = "print-area"; document.body.appendChild(box); }
      box.textContent = "";
      box.appendChild(el("h1", "pr-title", (e.title || t("ev.untitled")) + " · " + t("gu.pr.title")));
      box.appendChild(el("p", "pr-note", ctx.whenText(e)));
      var c = G.counts(l);
      box.appendChild(el("p", "pr-note", (l && l.cap > 0 ? fmt("gu.sum.places", { s: c.seats, cap: l.cap }) : fmt("gu.sum.people", { s: c.seats }))));
      var tbl = el("table", "pr-guests"), thead = el("thead"), hr = el("tr");
      [t("gu.pr.in"), t("gu.csv.name"), t("gu.csv.plus"), t("gu.csv.answer"), t("gu.csv.phone"), t("gu.csv.note")].forEach(function (h) { hr.appendChild(el("th", "", h)); });
      thead.appendChild(hr); tbl.appendChild(thead);
      var tb = el("tbody");
      (l ? l.g.slice() : []).filter(function (g) { return g.s !== "n"; }).sort(function (a, b) { return a.n.localeCompare(b.n); }).forEach(function (g) {
        var tr = el("tr");
        tr.appendChild(el("td", "pr-box", g["in"] ? "✓" : "☐"));
        tr.appendChild(el("td", "", g.n));
        tr.appendChild(el("td", "", g.k ? "+" + g.k : ""));
        tr.appendChild(el("td", "", t("gu.s." + g.s)));
        tr.appendChild(el("td", "", g.p || ""));
        tr.appendChild(el("td", "", g.x || ""));
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      box.appendChild(tbl);
      try { window.focus(); window.print(); } catch (err) {}
    });
    $("gu-todo").addEventListener("click", function () {
      var p = ctx.shellOpenAt(), e = ev();
      if (!p || !e) return;
      var title = String(e.title || t("ev.untitled")).replace(/\s+/g, " ").trim();
      var when = ctx.whenText(e), items = [];
      for (var i = 1; i <= 5; i++) items.push({ text: t("gu.todo." + i), note: (title + " · " + when).slice(0, 1000) });
      $("gu-dlg").close();
      p.__orosOpenAt("todo", { addItems: { newList: fmt("gu.todo.list", { t: title }).slice(0, 60), from: "Calendar", items: items } });
    });

    $("gu-done").addEventListener("click", function () { $("gu-dlg").close(); });
    $("gu-dlg").addEventListener("close", function () { closeForm(); hideTell(); openId = null; if (ctx.onChange) ctx.onChange(); });

    function open(evId) {
      var e = ctx.findEvent(evId);
      if (!e || !ctx.canHave(e)) return;
      openId = evId;
      closeForm(); hideTell();
      $("gu-q").value = "";
      fillSelect($("gu-f"), [["all", t("gu.f.all")]].concat(statusItems()).concat([["in", t("gu.f.in")]]), "all");
      render();
      $("gu-dlg").showModal();
    }
    function count(evId) { var l = G.listOf(data, evId); return l ? l.g.length : 0; }
    // Lists of events that are gone (a tombstone in the calendar, no
    // event): dropped, so guests' names do not stay behind.
    function cleanup(goneIds) {
      var st = data, now = Date.now(), any = false;
      (data.lists || []).forEach(function (l) {
        if (!goneIds[l.id]) return;
        var top = l.mtime;
        l.g.forEach(function (g) { if (g.mtime > top) top = g.mtime; });
        st = G.dropList(st, l.id, Math.max(now, top + 1));
        any = true;
      });
      if (any) save(st);
    }
    return { open: open, count: count, cleanup: cleanup };
  }

  root.OrosCalGuestsUI = { init: init };
})(window);
