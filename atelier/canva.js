// ============================================================
// orOS Atelier — Canva account (v1.0.0): bring many designs over
// Home › Import › From your Canva account. Signs in to Canva (Canva
// Connect API, OAuth with PKCE) in a small window, lists the user's
// designs, and for each chosen one asks Canva for a PowerPoint
// export, downloads it and opens it with the .pptx import (pptx.js).
// Every call goes through the orOS relay (relay/canva.js): Canva
// keeps sign-in to servers and sends no CORS headers.
//   - the Canva tokens stay on this device (localStorage), never
//     synced; Disconnect forgets them
//   - nothing from Canva runs as code: names are text, thumbnails
//     are <img> with no referrer, the export is parsed as data
//   - one design at a time (Canva limits exports per minute)
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, t = AT.t, el = AT.el;
  var KEY = "oros-atelier-canva";
  var CB_KEY = "oros-atelier-canva-cb";            // callback hand-over (canva-callback.js)
  var CHANNEL = "oros-atelier-canva";
  var DEFAULT_RELAY = "https://oros-mail-relay.koulaxizis-25b.workers.dev";   // same as Mail
  var SCOPES = "design:meta:read design:content:read";
  var POLL = 2500, POLL_MAX = 180000, CALL_TIMEOUT = 30000;

  // ---------- device-local state ----------
  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
    if (!s || typeof s !== "object") s = {};
    return {
      access: typeof s.access === "string" ? s.access : "",
      refresh: typeof s.refresh === "string" ? s.refresh : "",
      exp: +s.exp || 0,
      done: s.done && typeof s.done === "object" ? s.done : {},
      docs: s.docs && typeof s.docs === "object" ? s.docs : {}       // Canva design id → the design made from it here
    };
  }
  var st = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function connected() { return !!(st.access && st.refresh); }

  function relayUrl() {
    var u = "";
    try {
      var m = JSON.parse(localStorage.getItem("oros-mail-data") || "null");
      u = m && m.relay && typeof m.relay.url === "string" ? m.relay.url.trim().replace(/\/+$/, "") : "";
    } catch (e) {}
    return /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w.~-]*)*$/i.test(u) ? u : DEFAULT_RELAY;
  }

  function CanvaErr(code, msg) { var e = new Error(msg || code); e.code = code; return e; }

  function relay(body, binary) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, binary ? CALL_TIMEOUT * 4 : CALL_TIMEOUT);
    body.op = "canva";
    return fetch(relayUrl() + "/v1", {
      method: "POST", mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal
    }).then(function (r) {
      var type = r.headers.get("Content-Type") || "";
      if (binary && r.ok && type.indexOf("application/octet-stream") === 0) return r.arrayBuffer();
      return r.json().then(function (j) {
        if (j && j.ok) return j.data;
        var e = j && j.error || {};
        throw CanvaErr(e.code || "proto", e.msg);
      });
    }, function () {
      throw CanvaErr(navigator.onLine === false ? "offline" : "network");
    }).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }

  // a call with the user's token, refreshed when it ran out
  var refreshing = null;
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = relay({ act: "refresh", refresh: st.refresh }).then(function (tk) {
      setTokens(tk); refreshing = null;
    }, function (e) {
      refreshing = null;
      if (e.code === "auth" || e.code === "canva") { st.access = st.refresh = ""; st.exp = 0; save(); throw CanvaErr("auth"); }
      throw e;
    });
    return refreshing;
  }
  function setTokens(tk) {
    st.access = tk.access; st.refresh = tk.refresh;
    st.exp = Date.now() + Math.max(60, tk.expires || 3600) * 1000;
    save();
  }
  function authed(body) {
    var go = function () { body.token = st.access; return relay(body); };
    var first = st.exp - Date.now() < 60000 ? refresh().then(go) : go();
    return first.then(null, function (e) {
      if (e.code !== "auth" || !st.refresh) throw e;
      return refresh().then(go);
    });
  }

  // ---------- sign-in (PKCE) ----------
  function b64url(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomStr(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
  var pending = null;     // { state, verifier, challenge, redirect }
  function prepareSignIn() {
    var verifier = randomStr(48);
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)).then(function (h) {
      pending = {
        state: randomStr(24), verifier: verifier, challenge: b64url(new Uint8Array(h)),
        redirect: new URL("canva-callback.html", location.href).href
      };
      return pending;
    });
  }
  // must run inside the click (pop-up blockers)
  function openSignIn(clientId) {
    if (!pending) return false;
    var q = new URLSearchParams({
      response_type: "code", client_id: clientId, scope: SCOPES, redirect_uri: pending.redirect,
      code_challenge: pending.challenge, code_challenge_method: "S256", state: pending.state
    });
    var w = window.open("https://www.canva.com/api/oauth/authorize?" + q.toString(), "oros-canva", "popup,width=560,height=760");
    return !!w;
  }
  var onSigned = null;
  function received(msg) {
    if (!msg || typeof msg !== "object" || !pending || msg.state !== pending.state) return;
    var p = pending; pending = null;
    try { localStorage.removeItem(CB_KEY); } catch (e) {}
    var done = onSigned; onSigned = null;
    if (msg.error || typeof msg.code !== "string") { if (done) done(CanvaErr("denied")); return; }
    relay({ act: "token", code: msg.code, verifier: p.verifier, redirect: p.redirect }).then(function (tk) {
      setTokens(tk);
      if (done) done(null);
    }, function (e) { if (done) done(e); });
  }
  try { new BroadcastChannel(CHANNEL).onmessage = function (e) { received(e.data); }; } catch (e) {}
  window.addEventListener("storage", function (e) {
    if (e.key !== CB_KEY || !e.newValue) return;
    try { received(JSON.parse(e.newValue)); } catch (x) {}
  });

  // ---------- one design: export → wait → download → import ----------
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function exportOne(d) {
    var t0 = Date.now();
    function poll(job) {
      if (job.status === "success") {
        if (!job.urls.length) throw CanvaErr("canva");
        return job.urls[0];
      }
      if (job.status === "failed") throw CanvaErr(job.err === "license_required" ? "license" : job.err === "approval_required" ? "approval" : "canva");
      if (Date.now() - t0 > POLL_MAX) throw CanvaErr("timeout");
      return wait(POLL).then(function () { return authed({ act: "job", job: job.job }); }).then(poll);
    }
    return authed({ act: "export", id: d.id }).then(poll).then(function (url) {
      return relay({ act: "file", url: url }, true);
    }).then(function (ab) {
      if (!(ab instanceof ArrayBuffer)) throw CanvaErr("canva");
      return AT.io.importPptx(new File([ab], fileName(d) + ".pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), true)
        .then(null, function (e) {
          if (e && e.message === "nofs") throw e;
          throw CanvaErr("read", e && e.message);
        });
    });
  }
  // Passing trouble (network, a slow export, too many calls) gets two
  // more tries; what Canva refuses does not.
  var AGAIN = { network: 1, timeout: 1, rate: 1, proto: 1, url: 1 };
  function exportTry(d, left) {
    return exportOne(d).then(null, function (e) {
      var c = e && e.code;
      if (!left || !AGAIN[c] || (ui && ui.run && ui.run.stop)) throw e;
      return wait(c === "rate" ? 30000 : 5000).then(function () { return exportTry(d, left - 1); });
    });
  }

  // ---------- dialog ----------
  var ui = null;     // dialog state while open

  function errText(e) {
    var c = e && (e.code || e.message);
    if (c === "offline") return t("src.offline");
    if (c === "canva-off") return t("cv.off");
    if (c === "auth") return t("cv.auth");
    if (c === "rate") return t("cv.rate");
    if (c === "denied") return t("cv.denied");
    if (c === "license") return t("cv.license");
    if (c === "approval") return t("cv.approval");
    if (c === "nofs") return t("img.nofs");
    if (c === "timeout") return t("cv.slow");
    if (c === "too-big") return t("cv.big");
    if (c === "network") return t("cv.net");
    if (c === "canva" && e.message && e.message !== "canva") return t("cv.said", { msg: String(e.message).slice(0, 200) });
    if (c === "read") return t("cv.read", { msg: String(e.message || "").slice(0, 120) });
    return t("cv.fail");
  }

  function btn(cls, label, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }

  function open() {
    ui = { cfg: null, items: [], cont: "", q: "", busy: false, err: "", sel: {}, run: null, msg: "", again: [], replace: true };
    AT.openDialog(t("cv.title"), function (body, close) {
      ui.body = body; ui.close = close;
      render();
      relay({ act: "config" }).then(function (c) {
        ui.cfg = c;
        if (!c.configured) { ui.err = t("cv.off"); render(); return; }
        if (connected()) list(false);
        else prepareSignIn().then(render);
      }, function (e) { ui.err = errText(e); render(); });
    }, true);
    var d = document.getElementById("dlg");
    d.addEventListener("close", function stop() { d.removeEventListener("close", stop); if (ui && ui.run) ui.run.stop = true; ui = null; });
  }

  function list(more) {
    if (!ui) return;
    ui.busy = true; ui.err = "";
    if (!more) { ui.items = []; ui.cont = ""; }
    render();
    var body = { act: "designs" };
    if (more && ui.cont) body.cont = ui.cont;
    if (ui.q) body.query = ui.q;
    authed(body).then(function (r) {
      if (!ui) return;
      ui.busy = false;
      ui.items = ui.items.concat(r.items || []);
      ui.cont = r.cont || "";
      render();
    }, function (e) {
      if (!ui) return;
      ui.busy = false; ui.err = errText(e);
      if (e.code === "auth") prepareSignIn().then(render); else render();
    });
  }

  function chosen() { return ui.items.filter(function (d) { return ui.sel[d.id]; }); }

  function fileName(d) { return (d.title || t("cv.untitled")).replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 100) || "Canva"; }
  // imported before this device kept track: the one other design
  // with the same name (none when the name is not unique)
  function legacyDoc(d, now) {
    if (!st.done[d.id]) return "";
    var name = fileName(d), hits = AT.data().docs.filter(function (x) { return x.id !== now && x.name === name; });
    return hits.length === 1 ? hits[0].id : "";
  }

  function runImport(list) {
    var todo = list || chosen();
    if (!todo.length) return;
    var run = ui.run = { stop: false, i: 0, n: todo.length, ok: 0, lost: 0, failed: [], again: [], replaced: 0 };
    render();
    var chain = Promise.resolve();
    todo.forEach(function (d) {
      chain = chain.then(function () {
        if (run.stop) return;
        run.i++; run.name = d.title || t("cv.untitled");
        if (ui && ui.run === run) render();
        return exportTry(d, 2).then(function (r) {
          run.ok++; run.lost += (r && r.lost) || 0;
          var before = st.docs[d.id] || legacyDoc(d, r && r.id);
          if (ui.replace && before && r && before !== r.id && AT.dropDoc(before)) run.replaced++;
          st.done[d.id] = Date.now();
          if (r && r.id) st.docs[d.id] = r.id;
          save();
        }, function (e) {
          try { console.error("[orOS] atelier: Canva import failed", e); } catch (x) {}
          run.again.push(d);
          run.failed.push((d.title || t("cv.untitled")) + ": " + errText(e));
          var c = e && (e.code || e.message);
          if (c === "auth" || c === "nofs" || c === "offline") run.stop = true;
        });
      });
    });
    chain.then(function () {
      var msg = t("cv.done", { n: run.ok }) + (run.lost ? " " + t("cv.lost", { n: run.lost }) : "") + (run.replaced ? " " + t("cv.replaced", { n: run.replaced }) : "");
      AT.toast(msg);
      if (ui && ui.run === run) {
        ui.run = null; ui.sel = {}; ui.again = run.again;
        ui.msg = msg + (run.failed.length ? "\n" + run.failed.join("\n") : "");
        render();
      }
    });
  }

  function render() {
    if (!ui) return;
    var body = ui.body;
    body.innerHTML = "";
    body.appendChild(el("p", "hint", t("cv.intro")));
    var act = el("div", "dlg-actions");

    if (ui.run) {
      var r = ui.run;
      body.appendChild(el("p", "cv-progress", t("cv.working", { i: r.i, n: r.n })));
      if (r.name) body.appendChild(el("p", "hint", r.name));
      act.appendChild(btn("btn", t("cv.stop"), function () { r.stop = true; render(); }));
      if (r.stop) body.appendChild(el("p", "hint", t("cv.stopping")));
      body.appendChild(act);
      return;
    }
    if (ui.err) body.appendChild(el("p", "hint warn", ui.err));
    if (ui.msg) { var m = el("p", "hint cv-msg", ui.msg); body.appendChild(m); }
    if (ui.again && ui.again.length && connected()) {
      body.appendChild(btn("btn small block", t("cv.retry") + " (" + ui.again.length + ")", function () {
        var list = ui.again; ui.again = []; ui.msg = ""; runImport(list);
      }));
    }

    if (!ui.cfg || !ui.cfg.configured) {
      if (!ui.cfg && !ui.err) body.appendChild(el("p", "hint", t("cv.checking")));
      act.appendChild(btn("btn", t("btn.close"), ui.close));
      body.appendChild(act);
      return;
    }

    if (!connected()) {
      body.appendChild(el("p", "hint", t("cv.connectHint")));
      var c = btn("btn primary", t("cv.connect"), function () {
        ui.err = "";
        onSigned = function (e) {
          if (!ui) return;
          ui.msg = "";
          if (e) { ui.err = errText(e); prepareSignIn().then(render); return; }
          list(false);
        };
        if (!openSignIn(ui.cfg.clientId)) { ui.err = t("cv.popup"); render(); return; }
        ui.msg = t("cv.waiting");
        render();
      });
      c.disabled = !pending;
      act.appendChild(btn("btn", t("btn.close"), ui.close));
      act.appendChild(c);
      body.appendChild(act);
      return;
    }

    // connected: search + grid
    var form = el("form", "src-form");
    var q = el("input", "inp sm");
    q.type = "search"; q.placeholder = t("cv.search"); q.setAttribute("aria-label", t("cv.search"));
    q.value = ui.q; q.maxLength = 255;
    form.appendChild(q);
    var go = btn("btn small primary", t("src.go")); go.type = "submit";
    form.appendChild(go);
    form.addEventListener("submit", function (e) { e.preventDefault(); ui.q = q.value.trim().slice(0, 255); ui.msg = ""; list(false); });
    body.appendChild(form);

    var grid = el("div", "cv-grid");
    ui.items.forEach(function (d) {
      var lab = el("label", "cv-tile" + (ui.sel[d.id] ? " on" : ""));
      var cb = el("input"); cb.type = "checkbox"; cb.checked = !!ui.sel[d.id];
      cb.addEventListener("change", function () { if (cb.checked) ui.sel[d.id] = 1; else delete ui.sel[d.id]; render(); });
      lab.appendChild(cb);
      var th = el("span", "cv-thumb");
      if (d.thumb) {
        var img = el("img");
        img.alt = ""; img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer";
        img.src = d.thumb;
        th.appendChild(img);
      }
      lab.appendChild(th);
      lab.appendChild(el("span", "cv-name", d.title || t("cv.untitled")));
      var meta = d.pages ? t(d.pages === 1 ? "cv.page1" : "cv.pages", { n: d.pages }) : "";
      if (st.done[d.id]) meta = (meta ? meta + " · " : "") + t("cv.imported");
      if (meta) lab.appendChild(el("span", "cv-meta", meta));
      grid.appendChild(lab);
    });
    body.appendChild(grid);
    if (ui.busy) body.appendChild(el("p", "hint", t("src.searching")));
    else if (!ui.items.length && !ui.err) body.appendChild(el("p", "hint", t("cv.none")));
    else if (ui.cont) body.appendChild(btn("btn small block", t("src.more"), function () { list(true); }));

    var n = chosen().length;
    var all = ui.items.length && n === ui.items.length;
    act.classList.add("cv-actions");
    act.appendChild(btn("btn ghost", t("cv.disconnect"), function () {
      st.access = st.refresh = ""; st.exp = 0; save();
      ui.items = []; ui.sel = {}; ui.msg = "";
      prepareSignIn().then(render);
    }));
    act.appendChild(el("span", "spacer"));
    if (ui.items.length) act.appendChild(btn("btn", all ? t("cv.none.sel") : t("cv.all"), function () {
      ui.sel = {};
      if (!all) ui.items.forEach(function (d) { ui.sel[d.id] = 1; });
      render();
    }));
    if (Object.keys(st.done).length) {
      var rl = el("label", "chk-row");
      var rc = el("input"); rc.type = "checkbox"; rc.checked = ui.replace !== false;
      ui.replace = rc.checked;
      rc.addEventListener("change", function () { ui.replace = rc.checked; });
      rl.appendChild(rc); rl.appendChild(el("span", "", t("cv.replace")));
      body.appendChild(rl);
    }
    var imp = btn("btn primary", t("cv.import", { n: n }), function () { runImport(); });
    imp.disabled = !n;
    act.appendChild(imp);
    body.appendChild(act);
  }

  AT.canva = { open: open };
})();
