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
      renderRv();
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
      $("gu-tix-btn").hidden = !g || !subtle;
      var lr = list();
      $("gu-inv-btn").hidden = !g || !subtle || !lr || !lr.rv || !!lr.off;
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
      rvPublish(list(), false).catch(function () {});
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
      var e = ev();
      var msg = fmt("gu.tell.msg", { t: e ? (e.title || t("ev.untitled")) : "", when: e ? ctx.whenText(e) : "" });
      showSend(g, fmt("gu.tell", { name: g.n }), msg, false);
    }
    // A message to one guest: Email (Mail or mailto), SMS on phones,
    // Share (phones: WhatsApp, Viber, …) when asked, or copy.
    function showSend(g, head, msg, share) {
      var e = ev(), box = $("gu-tell-row");
      $("gu-tell-text").textContent = head;
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
      if (share && navigator.share) {
        var sh = el("button", "btn", t("gu.rv.share"));
        sh.type = "button";
        sh.addEventListener("click", function () { navigator.share({ text: msg }).catch(function () {}); });
        box.appendChild(sh);
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

    // ---------- tickets + the door (wave E3) ----------
    // The QR encoder (../qr/qr-encode.js) and, where the browser has no
    // BarcodeDetector, jsQR (../vendor/jsqr, Apache-2.0) load only on
    // first use; both are in the orOS precache, so the door works offline.
    var subtle = (window.crypto && window.crypto.subtle) || null;
    var scripts = {};
    function loadScript(src, ready) {
      if (ready()) return Promise.resolve();
      if (scripts[src]) return scripts[src];
      scripts[src] = new Promise(function (resolve, reject) {
        var sc = document.createElement("script");
        sc.src = src;
        sc.onload = function () { if (ready()) resolve(); else { scripts[src] = null; reject(new Error("load")); } };
        sc.onerror = function () { scripts[src] = null; reject(new Error("load")); };
        document.head.appendChild(sc);
      });
      return scripts[src];
    }
    function qrLib() { return loadScript("../qr/qr-encode.js", function () { return !!window.orosQR; }); }
    function keyed() {   // the list with its ticket key (made on first use)
      var l = list();
      if (l && l.sk) return l;
      var r = new Uint8Array(32);
      window.crypto.getRandomValues(r);
      save(G.withKey(data, openId, r, Date.now()));
      return list();
    }
    function drawQr(cv, text, px) {
      var q = window.orosQR.encode(text, { ecl: "M" }), m = 4, n = q.size + m * 2;
      var scale = Math.max(1, Math.floor(px / n));
      cv.width = cv.height = n * scale;
      var g = cv.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = "#000";
      for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) {
        if (q.modules[y][x]) g.fillRect((x + m) * scale, (y + m) * scale, scale, scale);
      }
      return cv;
    }
    function guestById(id) {
      var l = list();
      return l ? l.g.filter(function (x) { return x.id === id; })[0] || null : null;
    }
    function nameLine(g) { return g.n + (g.k ? " " + fmt("gu.plus", { k: g.k }) : ""); }
    // The ticket as a picture: code, name, event (for Save and Share).
    function ticketPicture(code, g) {
      var e = ev(), qr = drawQr(document.createElement("canvas"), code, 480);
      var cv = document.createElement("canvas"), w = qr.width + 80, h = qr.height + 190;
      cv.width = w; cv.height = h;
      var c = cv.getContext("2d");
      c.fillStyle = "#fff"; c.fillRect(0, 0, w, h);
      c.drawImage(qr, 40, 30);
      c.fillStyle = "#000"; c.textAlign = "center";
      c.font = "bold 30px system-ui, sans-serif";
      c.fillText(nameLine(g).slice(0, 40), w / 2, qr.height + 80);
      c.font = "22px system-ui, sans-serif";
      c.fillText(String((e && e.title) || "").slice(0, 50), w / 2, qr.height + 120);
      c.fillText(e ? ctx.whenText(e).slice(0, 60) : "", w / 2, qr.height + 152);
      return cv;
    }
    var tixGuest = null, tixCode = "";
    function openTicket(g) {
      if (!subtle) return;
      var l = keyed();
      if (!l) return;
      Promise.all([qrLib(), G.ticket(subtle, l, g.id)]).then(function (r) {
        tixGuest = g; tixCode = r[1];
        drawQr($("gu-tix-qr"), tixCode, 264);
        $("gu-tix-name").textContent = nameLine(g);
        var e = ev();
        $("gu-tix-ev").textContent = e ? (e.title || t("ev.untitled")) + " · " + ctx.whenText(e) : "";
        var canShare = !!(navigator.canShare && navigator.share);
        $("gu-tix-share").hidden = !canShare;
        $("gu-tix").showModal();
      }, function () { ctx.note(t("gu.tix.fail")); });
    }
    function ticketBlob() {
      return new Promise(function (resolve, reject) {
        ticketPicture(tixCode, tixGuest).toBlob(function (b) { if (b) resolve(b); else reject(new Error("blob")); }, "image/png");
      });
    }
    function ticketName() {
      return (t("gu.tix.file") + " " + String(tixGuest ? tixGuest.n : "")).replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) + ".png";
    }
    $("gu-tix-btn").addEventListener("click", function () {
      var g = editId ? guestById(editId) : null;
      if (g) openTicket(g);
    });
    $("gu-tix-done").addEventListener("click", function () { $("gu-tix").close(); });
    $("gu-tix-save").addEventListener("click", function () {
      ticketBlob().then(function (blob) {
        var name = ticketName(), dh = ctx.dialogHost(), done = function () { ctx.note(t("gu.tix.saved")); };
        if (dh && typeof dh.saveFile === "function") {
          return dh.saveFile({ blob: blob, filename: name, mime: "image/png", types: [{ description: "PNG", accept: { "image/png": [".png"] } }] })
            .then(function (r) { if (r && r.ok) done(); });
        }
        var url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        done();
      }).catch(function () { ctx.note(t("gu.tix.fail")); });
    });
    $("gu-tix-share").addEventListener("click", function () {
      ticketBlob().then(function (blob) {
        var f = new File([blob], ticketName(), { type: "image/png" }), e = ev();
        var d = { files: [f], title: t("gu.tix.title"), text: (e ? (e.title || "") + " · " + ctx.whenText(e) : "") };
        if (!navigator.canShare(d)) { delete d.files; }
        return navigator.share(d);
      }).catch(function () {});
    });
    // Print every coming guest's ticket (paper tickets), 2 per row.
    $("gu-tixall").addEventListener("click", function () {
      if (!subtle) return;
      var l = keyed(), e = ev();
      if (!l || !e) return;
      var coming = l.g.filter(function (g) { return g.s === "y"; }).sort(function (a, b) { return a.n.localeCompare(b.n); });
      if (!coming.length) { ctx.note(t("gu.tixall.none")); return; }
      qrLib().then(function () {
        return Promise.all(coming.map(function (g) { return G.ticket(subtle, l, g.id); }));
      }).then(function (codes) {
        var box = $("print-area");
        if (!box) { box = el("div"); box.id = "print-area"; document.body.appendChild(box); }
        box.textContent = "";
        var grid = el("div", "pr-tix");
        coming.forEach(function (g, i) {
          var card = el("div", "pr-tix-card"), img = el("img");
          img.alt = "";
          img.src = drawQr(document.createElement("canvas"), codes[i], 360).toDataURL("image/png");
          card.appendChild(img);
          card.appendChild(el("b", "", nameLine(g)));
          card.appendChild(el("span", "", e.title || t("ev.untitled")));
          card.appendChild(el("span", "", ctx.whenText(e)));
          grid.appendChild(card);
        });
        box.appendChild(grid);
        setTimeout(function () { try { window.focus(); window.print(); } catch (err) {} }, 50);
      }, function () { ctx.note(t("gu.tix.fail")); });
    });

    // The door: camera → code → check offline → big answer.
    var door = { stream: null, live: false, timer: 0, busy: false, hold: 0, pending: null, det: null };
    function nativeDetector() {
      if (door.det) return door.det;
      door.det = Promise.resolve(null);
      if (typeof window.BarcodeDetector !== "function") return door.det;
      var BD = window.BarcodeDetector;
      door.det = (typeof BD.getSupportedFormats === "function" ? BD.getSupportedFormats() : Promise.resolve(["qr_code"]))
        .then(function (f) { return f && f.indexOf("qr_code") >= 0 ? new BD({ formats: ["qr_code"] }) : null; })
        .catch(function () { return null; });
      return door.det;
    }
    var grab = null;
    function readFrame(v) {
      return nativeDetector().then(function (det) {
        if (det) return det.detect(v).then(function (r) { var h = (r || [])[0]; return h && h.rawValue ? h.rawValue : ""; }, function () { return ""; });
        return loadScript("../vendor/jsqr/jsQR.js", function () { return typeof window.jsQR === "function"; }).then(function () {
          var w = v.videoWidth, h = v.videoHeight, k = Math.min(1, 640 / Math.max(w, h, 1));
          if (!grab) grab = document.createElement("canvas");
          grab.width = Math.max(1, Math.round(w * k)); grab.height = Math.max(1, Math.round(h * k));
          var g = grab.getContext("2d", { willReadFrequently: true });
          g.drawImage(v, 0, 0, grab.width, grab.height);
          var px = g.getImageData(0, 0, grab.width, grab.height);
          var r = window.jsQR(px.data, px.width, px.height, { inversionAttempts: "dontInvert" });
          return r && r.data ? r.data : "";
        });
      });
    }
    function doorCount() {
      var c = G.counts(list());
      $("gu-door-count").textContent = fmt("gu.door.count", { n: c.inN, y: c.yes, s: c.inSeats });
    }
    function doorSay(kind, text) {
      var box = $("gu-door-res");
      box.className = "gu-door-res" + (kind ? " " + kind : "");
      box.textContent = text || "";
    }
    function doorStop() {
      door.live = false;
      clearTimeout(door.timer); clearTimeout(door.hold);
      if (door.stream) door.stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
      door.stream = null;
      try { $("gu-door-video").srcObject = null; } catch (e) {}
      $("gu-door-video").parentNode.hidden = true;
      $("gu-door-cam").textContent = t("gu.door.cam.on");
    }
    function doorLoop() {
      var v = $("gu-door-video");
      if (!door.live) return;
      if (door.pending || door.busy || v.readyState < 2) { door.timer = setTimeout(doorLoop, 200); return; }
      door.busy = true;
      readFrame(v).then(function (text) {
        door.busy = false;
        if (!door.live) return;
        if (text && text !== door.last) { door.last = text; doorRead(text); }
        door.timer = setTimeout(doorLoop, 150);
      }, function () { door.busy = false; if (door.live) door.timer = setTimeout(doorLoop, 400); });
    }
    function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
    function doorRead(text) {
      var l = list();
      if (!subtle || !l) return;
      G.check(subtle, l, text).then(function (r) {
        clearTimeout(door.hold);
        $("gu-door-ask").hidden = true;
        door.pending = null;
        if (r.r === "ok") {
          save(G.checkIn(data, openId, r.g.id, true, Date.now()));
          doorSay("ok", fmt("gu.door.ok", { name: r.g.n }) + (r.g.k ? " · " + fmt("gu.door.plus", { k: r.g.k }) : ""));
          buzz(60);
        } else if (r.r === "in") {
          doorSay("warn", fmt("gu.door.in", { name: r.g.n, time: timeOf(r.g["in"]) }));
          buzz([80, 60, 80]);
        } else if (r.r === "ask") {
          door.pending = r.g;
          doorSay("ask", fmt("gu.door.ask", { name: nameLine(r.g), s: t("gu.s." + r.g.s) }));
          $("gu-door-ask").hidden = false;
          buzz([40, 40, 40]);
        } else {
          doorSay("bad", t(r.r === "removed" ? "gu.door.removed" : "gu.door.bad"));
          buzz([200]);
        }
        doorCount();
        render();
        // the same code is read again only after a pause
        if (!door.pending) door.hold = setTimeout(function () { door.last = ""; }, 3000);
      });
    }
    function doorStart() {
      if (door.live) { doorStop(); doorSay("", ""); return; }
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { doorSay("bad", t("gu.door.nocam")); return; }
      door.live = true;
      $("gu-door-cam").textContent = t("gu.door.cam.off");
      doorSay("", t("gu.door.wait"));
      nativeDetector().then(function (d) {
        if (!d) return loadScript("../vendor/jsqr/jsQR.js", function () { return typeof window.jsQR === "function"; });
      }).catch(function () {});
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then(function (st) {
        if (!door.live) { st.getTracks().forEach(function (tr) { tr.stop(); }); return; }
        door.stream = st;
        var v = $("gu-door-video");
        v.srcObject = st;
        v.parentNode.hidden = false;
        return v.play().then(function () { doorSay("", t("gu.door.aim")); doorLoop(); });
      }).catch(function () { doorStop(); doorSay("bad", t("gu.door.denied")); });
    }
    function doorAnswer(admit) {
      var g = door.pending;
      door.pending = null;
      $("gu-door-ask").hidden = true;
      if (g && admit) {
        save(G.checkIn(data, openId, g.id, true, Date.now()));
        doorSay("ok", fmt("gu.door.ok", { name: g.n }));
        buzz(60);
      } else doorSay("", door.live ? t("gu.door.aim") : "");
      doorCount(); render();
      door.hold = setTimeout(function () { door.last = ""; }, 3000);
    }
    $("gu-door-let").addEventListener("click", function () { doorAnswer(true); });
    $("gu-door-skip").addEventListener("click", function () { doorAnswer(false); });
    $("gu-door-cam").addEventListener("click", doorStart);
    $("gu-door-done").addEventListener("click", function () { $("gu-door").close(); });
    $("gu-door").addEventListener("close", function () { doorStop(); door.pending = null; door.last = ""; render(); });
    $("gu-door-btn").addEventListener("click", function () {
      if (!subtle) return;
      if (!keyed()) return;
      door.last = ""; door.pending = null;
      $("gu-door-ask").hidden = true;
      doorSay("", "");
      doorCount();
      $("gu-door-video").parentNode.hidden = true;
      $("gu-door-cam").textContent = t("gu.door.cam.on");
      $("gu-door").showModal();
      doorStart();
    });
    // test hook: what a scan of `text` would do (no camera needed)
    if (/[?&]standalone\b/.test(location.search)) window.__guDoorRead = doorRead;

    // ---------- invitation links (wave E2, relay/forms.js via forms/pub.js) ----------
    // One relay form per event: the page (calendar/rsvp.html) shows the
    // event, the guest answers there, the answer comes back sealed for
    // this list's key and waits at the relay until a device of the
    // organiser picks it up ("Check answers", or quietly every 10 minutes
    // while the Calendar is open), then it is deleted there.
    // Device-local, never synced: localStorage "oros-calguests-pub"
    //   { <event id>: { h: what was published, last: ms of the last check } }
    var PUB_KEY = "oros-calguests-pub", CHECK_EVERY = 600000;
    function pubLib() { return loadScript("../forms/pub.js", function () { return !!window.OrosFormsPub; }); }
    function pubState() {
      var m = null;
      try { m = JSON.parse(localStorage.getItem(PUB_KEY) || "null"); } catch (e) {}
      return m && typeof m === "object" && !Array.isArray(m) ? m : {};
    }
    function pubSave(m) { try { localStorage.setItem(PUB_KEY, JSON.stringify(m)); } catch (e) {} }
    function pubOf(id) { return pubState()[id] || {}; }
    function pubSet(id, o) {
      var m = pubState();
      if (o === null) delete m[id]; else m[id] = Object.assign({}, m[id] || {}, o);
      pubSave(m);
    }
    function lang() { var l = ctx.lang ? ctx.lang() : "en"; return l === "el" || l === "de" ? l : "en"; }
    function online() { return !(typeof navigator !== "undefined" && navigator.onLine === false); }
    function rvCall(body) {
      if (!online()) return Promise.reject({ code: "offline" });
      var P = window.OrosFormsPub;
      return P.call(P.RELAY, Object.assign({ k: body.l.rv.k, sec: body.l.rv.sec }, body.b));
    }
    function rvLive(l) { return !!(l && l.rv && !l.off); }
    // Put the page at the relay when what it shows changed (title, time,
    // place, notes, places, seats per answer, open sign-up).
    function rvPublish(l, force) {
      if (!rvLive(l)) return Promise.resolve(false);
      var e = ctx.findEvent(l.id);
      if (!e || !ctx.evInfo) return Promise.resolve(false);
      return pubLib().then(function () {
        var P = window.OrosFormsPub, info = ctx.evInfo(e);
        var def = G.rsvpDef(l, info, lang());
        def.pub = P.pubOf(l.rv.priv);
        var close = G.rsvpClose(info, Date.now());
        var h = JSON.stringify(def) + "|" + l.cap + "|" + Math.floor(close / 86400000);
        if (!force && pubOf(l.id).h === h) return false;
        return P.encDef(l.rv.key, l.rv.k, def).then(function (enc) {
          return rvCall({ l: l, b: { act: "put", def: enc, open: 1, close: close, cap: l.cap || 0, maxSeats: G.maxSeats(l) } });
        }).then(function () { pubSet(l.id, { h: h }); return true; });
      });
    }
    // Pick up the answers of one list → { added, bad } (saved as they come)
    var checking = {};
    function rvCheck(evId) {
      if (checking[evId]) return checking[evId];
      var tally = { n: 0, bad: 0 };
      var p = pubLib().then(function () {
        var l0 = G.listOf(data, evId);
        if (!rvLive(l0)) return tally;
        return rvPublish(l0, false).then(function () {
          var P = window.OrosFormsPub, taken = null;
          function page(n) {
            var l = G.listOf(data, evId);
            if (!rvLive(l)) return null;
            return rvCall({ l: l, b: { act: "pull", after: 0 } }).then(function (res) {
              taken = res.taken | 0;
              var rows = Array.isArray(res.rows) ? res.rows : [];
              if (!rows.length) return null;
              return rows.reduce(function (q, r) {
                return q.then(function () {
                  return P.open(l.rv.priv, r.v).then(function (o) {
                    return G.rsvpAnswer(subtle, data, evId, r, o, Date.now());
                  }, function () { return { r: "bad" }; }).then(function (res2) {
                    if (res2.r === "upd" || res2.r === "new") { save(res2.state); tally.n++; }
                    else tally.bad++;
                  });
                });
              }, Promise.resolve()).then(function () {
                return rvCall({ l: l, b: { act: "ack", upto: rows[rows.length - 1].id } });
              }).then(function () { if (res.more && n < 10) return page(n + 1); });
            });
          }
          return Promise.resolve(page(1)).then(function () {
            // The relay counts seats only up ("yes" answers); this device
            // knows the real number after cancellations and its own edits.
            var l = G.listOf(data, evId);
            if (rvLive(l) && l.cap > 0 && taken !== null) {
              var seats = Math.min(l.cap, G.counts(l).seats);
              if (seats !== taken) return rvCall({ l: l, b: { act: "upd", taken: seats } }).catch(function () {});
            }
          });
        });
      }).then(function () {
        pubSet(evId, { last: Date.now() });
        return tally;
      });
      checking[evId] = p;
      p.then(function () { delete checking[evId]; }, function () { delete checking[evId]; });
      return p;
    }
    function rvErr(e) {
      var c = e && e.code;
      ctx.note(t(c === "offline" || c === "network" || c === "timeout" ? "gu.rv.err.net" : c === "full" ? "gu.rv.err.full" : "gu.rv.err"));
    }
    function renderRv() {
      var l = list(), on = rvLive(l), st = $("gu-rv-state");
      $("gu-rv").hidden = !subtle || !ctx.evInfo;
      $("gu-rv-off").hidden = on;
      $("gu-rv-on").hidden = !on;
      if (!on) { st.textContent = t("gu.rv.none"); return; }
      var last = pubOf(l.id).last;
      st.textContent = last ? fmt("gu.rv.last", { time: stamp(last) }) : t("gu.rv.never");
      var ms = $("gu-rv-ms"), items = [];
      for (var i = 1; i <= G.LIM.seats; i++) items.push([String(i), String(i)]);
      if (document.activeElement !== ms) fillSelect(ms, items, String(G.maxSeats(l)));
      $("gu-rv-op").checked = !!l.op;
      $("gu-rv-op-row").hidden = !l.op;
      $("gu-rv-share").hidden = !navigator.share;
    }
    function rvAfterChange() {
      render();
      rvPublish(list(), false).catch(rvErr);
    }
    $("gu-rv-make").addEventListener("click", function () {
      if (!subtle) return;
      if (!online()) { rvErr({ code: "offline" }); return; }
      var btn = $("gu-rv-make"), id = openId;
      btn.disabled = true;
      if (!keyed()) { btn.disabled = false; return; }
      pubLib().then(function () {
        var l = G.listOf(data, id);
        if (l && l.rv) return null;
        return window.OrosFormsPub.newKeys();
      }).then(function (keys) {
        var now = Date.now();
        if (keys) save(G.withRsvp(data, id, { k: keys.k, sec: keys.sec, key: keys.key, priv: keys.priv }, now));
        if (G.listOf(data, id).off) save(G.setRsvp(data, id, { off: 0 }, now + 1));
        return rvPublish(G.listOf(data, id), true);
      }).then(function () {
        btn.disabled = false;
        ctx.note(t("gu.rv.made"));
        render();
      }, function (e) { btn.disabled = false; rvErr(e); render(); });
    });
    $("gu-rv-check").addEventListener("click", function () {
      var btn = $("gu-rv-check"), id = openId;
      btn.disabled = true;
      rvCheck(id).then(function (r) {
        btn.disabled = false;
        ctx.note(r.n ? fmt("gu.rv.got", { n: r.n }) : t("gu.rv.nothing"));
        if (openId === id) render();
      }, function (e) { btn.disabled = false; rvErr(e); });
    });
    var stopArm = false;
    $("gu-rv-stop").addEventListener("click", function () {
      var btn = $("gu-rv-stop"), l = list();
      if (!rvLive(l)) return;
      if (!stopArm) { stopArm = true; btn.textContent = t("gu.rv.stop.sure"); setTimeout(function () { stopArm = false; btn.textContent = t("gu.rv.stop"); }, 4000); return; }
      stopArm = false;
      btn.textContent = t("gu.rv.stop");
      btn.disabled = true;
      // answers still waiting come in first, then the link stops working
      rvCheck(l.id)["catch"](function () {}).then(function () {
        return rvCall({ l: list(), b: { act: "drop" } })["catch"](function (e) { if (!(e && e.code === "gone")) throw e; });
      }).then(function () {
        btn.disabled = false;
        save(G.setRsvp(data, openId, { off: 1 }, Date.now()));
        pubSet(l.id, null);
        ctx.note(t("gu.rv.stopped"));
        render();
      }, function (e) { btn.disabled = false; rvErr(e); });
    });
    $("gu-rv-ms").addEventListener("change", function () {
      save(G.setRsvp(data, openId, { ms: Number($("gu-rv-ms").value) }, Date.now()));
      rvAfterChange();
    });
    $("gu-rv-op").addEventListener("change", function () {
      save(G.setRsvp(data, openId, { op: $("gu-rv-op").checked ? 1 : 0 }, Date.now()));
      rvAfterChange();
    });
    function openLinkMsg() {
      var e = ev(), l = list();
      return fmt("gu.rv.msg.open", { t: e ? (e.title || t("ev.untitled")) : "", when: e ? ctx.whenText(e) : "", link: G.rsvpLink(l) });
    }
    $("gu-rv-copy").addEventListener("click", function () {
      var l = list();
      if (!rvLive(l)) return;
      try { navigator.clipboard.writeText(G.rsvpLink(l)).then(function () { ctx.note(t("gu.rv.copied")); }, function () {}); } catch (err) {}
    });
    $("gu-rv-share").addEventListener("click", function () {
      if (navigator.share) navigator.share({ text: openLinkMsg() }).catch(function () {});
    });
    // One guest's own link (with the ticket code: proof and ticket)
    $("gu-inv-btn").addEventListener("click", function () {
      var g = guestById(editId), l0 = keyed();
      if (!g || !rvLive(l0)) return;
      G.ticket(subtle, l0, g.id).then(function (code) {
        var e = ev(), link = G.rsvpLink(list(), code, g.n);
        var msg = fmt("gu.rv.msg", { name: g.n, t: e ? (e.title || t("ev.untitled")) : "", when: e ? ctx.whenText(e) : "", link: link });
        closeForm();
        showSend(g, fmt("gu.rv.send", { name: g.n }), msg, true);
      }, function () { ctx.note(t("gu.tix.fail")); });
    });
    // Quietly, while the Calendar is open: lists with live links whose
    // event has not been over for more than a day, every 10 minutes.
    function sweep() {
      if (!subtle || !online()) return;
      var now = Date.now();
      (data.lists || []).forEach(function (l, i) {
        if (!rvLive(l) || now - (pubOf(l.id).last || 0) < CHECK_EVERY - 5000) return;
        var e = ctx.findEvent(l.id), info = e && ctx.evInfo ? ctx.evInfo(e) : null;
        if (!info || (info.e || info.s || 0) < now - 86400000) return;
        setTimeout(function () {
          rvCheck(l.id).then(function (r) {
            if (r.n && openId === l.id && $("gu-dlg").open) render();
            if (r.n && ctx.onChange) ctx.onChange();
          }, function () {});
        }, 1500 + i * 2000);
      });
    }
    setTimeout(sweep, 4000);
    setInterval(sweep, CHECK_EVERY);

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
      var l = list();
      if (rvLive(l) && subtle && online() && Date.now() - (pubOf(evId).last || 0) > 60000) {
        rvCheck(evId).then(function (r) { if (openId === evId) { render(); if (r.n) ctx.note(fmt("gu.rv.got", { n: r.n })); } }, function () {});
      }
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
        if (l.rv && !l.off && online()) {
          var rv = l.rv;
          pubLib().then(function () {
            return window.OrosFormsPub.call(window.OrosFormsPub.RELAY, { act: "drop", k: rv.k, sec: rv.sec });
          })["catch"](function () {});
          pubSet(l.id, null);
        }
        st = G.dropList(st, l.id, Math.max(now, top + 1));
        any = true;
      });
      if (any) save(st);
    }
    return { open: open, count: count, cleanup: cleanup };
  }

  root.OrosCalGuestsUI = { init: init };
})(window);
