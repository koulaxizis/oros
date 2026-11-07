// ============================================================
// orOS Gate — Claude reads this orOS through this open device
// (optional, off by default; Settings › Connected services).
// The device holds a WebSocket to its gate box on the relay
// (relay/gate.js). A tool call from Claude arrives there, is checked
// HERE against the gate, the lock and each app's level, runs on this
// device's own data and goes back as text. The relay stores nothing
// of it. Phase 1 is read-only; nothing here writes app data.
//
// Per device, never synced:
//   localStorage "oros-gate"     { on, id, tok, lv{appId: "read"}, at }
//   localStorage "oros-gate-log" [{ t, n, a[app ids], k (items), ok }] ≤ 300
// Pure core (Node-tested, tests/gate-core.test.js): window.orosGateCore.
// ============================================================
(function (root) {
  "use strict";

  var PREF_KEY = "oros-gate", LOG_KEY = "oros-gate-log", LOG_MAX = 300;
  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // = mail.js; the gate box lives there
  // Never offered, whatever a setting says (BR-GATE).
  var NEVER = ["assistant", "baby", "cycle", "diary", "health", "mail", "mood", "passwords"];
  var SUMMARY = { budget: 1, stock: 1 };
  var PAGE = 500, TEXT_MAX = 1500, HITS_MAX = 60, SPAN_DAYS = 400;
  var YMD = /^\d{4}-\d{2}-\d{2}$/;

  /* ---------- pure core ---------- */
  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function cents(a) {
    var n = Math.round(Number(a) || 0), s = n < 0 ? "-" : "";
    n = Math.abs(n);
    return s + Math.floor(n / 100) + "." + ("0" + (n % 100)).slice(-2);
  }
  // i18n-inline-ok: final sigma folded for name matching, data not text
  function fold(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ").trim();
  }
  function dayDiff(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
  function deadIn(tombs, prefix, x) {
    var ts = tombs[prefix + ":" + x.id];
    return typeof ts === "number" && ts >= (Number(x.m) || 0);
  }
  // Fields an entry may carry that are not Budget's own (forward
  // compatibility, Part IV): passed on as they are, flat values only.
  var OWN_TX = { id: 1, m: 1, d: 1, a: 1, k: 1, c: 1, n: 1, ac: 1, ot: 1, fit: 1, src: 1, pp: 1, oc: 1, oa: 1, rc: 1 };

  // budget_lines: raw = the parsed oros-budget-data, args from Claude.
  // → { ok:true, data } | { ok:false, err }
  function budgetLines(raw, args) {
    if (!isObj(args)) return { ok: false, err: "The arguments must be an object." };
    var from = String(args.from || ""), to = String(args.to || "");
    if (!YMD.test(from) || !YMD.test(to) || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) return { ok: false, err: "from and to must be days as YYYY-MM-DD." };
    if (to < from) return { ok: false, err: "to is before from." };
    if (dayDiff(from, to) > SPAN_DAYS) return { ok: false, err: "At most " + SPAN_DAYS + " days per call." };
    var offset = args.offset === undefined ? 0 : args.offset;
    if (!(typeof offset === "number" && Math.floor(offset) === offset && offset >= 0)) return { ok: false, err: "offset must be a whole number ≥ 0." };
    var d = isObj(raw) ? raw : {};
    var tombs = isObj(d.tombs) ? d.tombs : {};
    var cur = isObj(d.set) && typeof d.set.cur === "string" && /^[A-Z]{3}$/.test(d.set.cur) ? d.set.cur : "EUR";
    var accs = {}, cats = {};
    (Array.isArray(d.acc) ? d.acc : []).forEach(function (a) { if (isObj(a) && typeof a.id === "string" && !deadIn(tombs, "acc", a)) accs[a.id] = String(a.n || a.id); });
    (Array.isArray(d.cats) ? d.cats : []).forEach(function (c) { if (isObj(c) && typeof c.id === "string" && !deadIn(tombs, "cat", c)) cats[c.id] = String(c.name || c.id); });
    var acc = null;
    if (args.account !== undefined && args.account !== null && args.account !== "") {
      var want = fold(args.account);
      Object.keys(accs).forEach(function (id) { if (!acc && (id === String(args.account) || fold(accs[id]) === want)) acc = id; });
      if (!acc) return { ok: false, err: "No Budget account with that name or id. Accounts: " + Object.keys(accs).map(function (id) { return accs[id]; }).join(", ") };
    }
    var rows = (Array.isArray(d.tx) ? d.tx : []).filter(function (x) {
      if (!isObj(x) || typeof x.id !== "string" || typeof x.d !== "string" || deadIn(tombs, "tx", x)) return false;
      if (x.d < from || x.d > to) return false;
      if (acc && x.ac !== acc) return false;
      if (args.bank === true && !(x.src === "bank" || x.pp === 1 || typeof x.fit === "string")) return false;
      return true;
    }).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    var page = rows.slice(offset, offset + PAGE).map(function (x) {
      var o = { id: x.id, date: x.d, kind: x.k === "i" ? "income" : "expense", amount: cents(x.a) };
      if (x.c) o.category = cats[x.c] || String(x.c);
      if (x.ac) o.account = accs[x.ac] || "(deleted account)";
      if (x.n) o.note = String(x.n);
      if (x.ot) o.bank_text = String(x.ot);
      if (x.fit) o.bank_id = String(x.fit);
      if (x.src) o.source = String(x.src);
      if (x.pp === 1) o.paypal = true;
      if (typeof x.oc === "string" && x.oa !== undefined) { o.original_currency = x.oc; o.original_amount = cents(x.oa); }
      if (x.rc) o.receipts = String(x.rc).split(" ").length;
      Object.keys(x).sort().forEach(function (k) {
        if (OWN_TX[k] || o[k] !== undefined) return;
        var v = x[k];
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") o[k] = v;
      });
      return o;
    });
    var data = { currency: cur, from: from, to: to, total: rows.length, lines: page };
    if (offset + PAGE < rows.length) data.next_offset = offset + PAGE;
    if (acc) data.account = accs[acc];
    return { ok: true, data: data };
  }

  // search_data: groups from orosAssistSearch → items for Claude.
  function packHits(groups, names) {
    var out = [];
    (Array.isArray(groups) ? groups : []).forEach(function (g) {
      (g && Array.isArray(g.hits) ? g.hits : []).forEach(function (h) {
        if (!h || out.length >= HITS_MAX) return;
        var text = String(h.text || "").replace(/\r\n?/g, "\n");
        var it = { app: g.id, app_name: names[g.id] || g.id, id: String(h.id == null ? "" : h.id), title: String(h.title || "") };
        if (h.when) { var dt = new Date(h.when); if (!isNaN(dt)) it.date = dt.toISOString().slice(0, 10); }
        if (text) it.text = text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) + "…" : text;
        out.push(it);
      });
    });
    return out;
  }

  // The apps Claude may read: offered (searchable and installed), not
  // NEVER, and set to "read" on this device.
  function allowed(offered, lv) {
    var l = isObj(lv) ? lv : {};
    return (Array.isArray(offered) ? offered : []).filter(function (a) {
      return a && NEVER.indexOf(a.id) < 0 && l[a.id] === "read";
    });
  }
  function toolsOf(id) {
    var t = ["search_data"];
    if (SUMMARY[id]) t.push("app_summary");
    if (id === "budget") t.push("budget_lines");
    return t;
  }
  function pushLog(list, entry) {
    var l = Array.isArray(list) ? list.slice() : [];
    l.push(entry);
    return l.length > LOG_MAX ? l.slice(l.length - LOG_MAX) : l;
  }

  var core = { NEVER: NEVER, budgetLines: budgetLines, packHits: packHits, allowed: allowed, toolsOf: toolsOf,
               pushLog: pushLog, cents: cents, LOG_MAX: LOG_MAX, PAGE: PAGE };
  if (typeof module !== "undefined" && module.exports) module.exports = core;
  if (!root || !root.document) return;
  root.orosGateCore = core;

  /* ---------- device ---------- */
  function readJSON(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast(tr("gate.saveFail")); return false; }   // R30: never silent
  }
  function pref() { var p = readJSON(PREF_KEY); return isObj(p) ? p : { on: false }; }
  function tr(k) { return typeof root.t === "function" ? root.t(k) : k; }
  function toast(text) {
    try { if (root.orosNotifs && root.orosNotifs.transient) root.orosNotifs.transient({ ns: "system", title: text }); } catch (e) {}
  }
  function randomB64u(n) {
    var b = new Uint8Array(n), s = "";
    crypto.getRandomValues(b);
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function sha256hex(s) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
    });
  }
  function devCall(body) {
    return fetch(RELAY + "/gate/dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok || !j || !j.ok) { var e = new Error("gate"); e.code = j && j.error && j.error.code || ("http-" + r.status); throw e; }
        return j.data;
      }); });
  }

  var listeners = [];
  function changed() { listeners.slice().forEach(function (fn) { try { fn(); } catch (e) {} }); }

  var ws = null, wsState = "off", retry = 0, retryTimer = null, pingTimer = null;
  function setWs(s) { if (wsState !== s) { wsState = s; changed(); } }
  function connect() {
    var p = pref();
    if (!p.on || !p.id || !p.tok || ws) return;
    clearTimeout(retryTimer);
    setWs("connecting");
    var sock;
    try { sock = new WebSocket(RELAY.replace(/^https:/, "wss:") + "/gate/ws/" + p.id, ["gt1", "t." + p.tok]); }
    catch (e) { schedule(); return; }
    ws = sock;
    sock.onopen = function () {
      retry = 0;
      setWs("on");
      clearInterval(pingTimer);
      pingTimer = setInterval(function () { try { sock.send("ping"); } catch (e) {} }, 45000);
    };
    sock.onmessage = function (ev) { if (typeof ev.data === "string" && ev.data !== "pong") onCall(sock, ev.data); };
    sock.onclose = function (ev) {
      if (ws === sock) ws = null;
      clearInterval(pingTimer);
      // 4001: a newer connection of this gate took over; 4004: the gate is gone.
      if (ev && ev.code === 4004) { setWs("gone"); return; }
      if (ev && ev.code === 4001) { setWs("other"); return; }
      schedule();
    };
    sock.onerror = function () {};
  }
  function schedule() {
    if (!pref().on) { setWs("off"); return; }
    setWs("connecting");
    retry = Math.min(retry + 1, 6);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, [2, 4, 8, 15, 30, 60][retry - 1] * 1000);
  }
  function drop() {
    clearTimeout(retryTimer); clearInterval(pingTimer);
    if (ws) { var s = ws; ws = null; try { s.close(1000, "off"); } catch (e) {} }
    setWs("off");
  }

  function offered() {
    try { return typeof root.orosAssistApps === "function" ? root.orosAssistApps() : []; } catch (e) { return []; }
  }
  function appNames(list) { var n = {}; list.forEach(function (a) { n[a.id] = a.name; }); return n; }
  function readStore(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }

  var summaryP = null;
  function summary() {
    if (root.OrosAssistSummary) return Promise.resolve(root.OrosAssistSummary);
    if (!summaryP) {
      summaryP = new Promise(function (ok, no) {
        var s = document.createElement("script");
        var v = root.orosTodayEnv && root.orosTodayEnv.version ? "?v=" + encodeURIComponent(root.orosTodayEnv.version) : "";
        s.src = "assistant/summary.js" + v;
        s.onload = function () { root.OrosAssistSummary ? ok(root.OrosAssistSummary) : no(new Error("summary")); };
        s.onerror = function () { summaryP = null; no(new Error("summary")); };
        document.head.appendChild(s);
      });
    }
    return summaryP;
  }

  // One call from Claude → { ok, c (text), a (apps), k (items) }.
  function run(name, args) {
    if (root.orosLock && typeof root.orosLock.isLocked === "function" && root.orosLock.isLocked()) {
      return Promise.resolve({ ok: false, c: "orOS is locked on the owner's device. Ask the owner to unlock it." });
    }
    var p = pref();
    var all = offered(), ok = allowed(all, p.lv), names = appNames(all), okIds = ok.map(function (a) { return a.id; });
    args = isObj(args) ? args : {};
    if (name === "list_apps") {
      return Promise.resolve({ ok: true, a: [], k: ok.length, c: JSON.stringify({
        apps: ok.map(function (a) { return { id: a.id, name: a.name, tools: toolsOf(a.id) }; }),
        note: ok.length ? undefined : "The owner has not allowed any app yet (orOS › Settings › Connected services › orOS Gate)."
      }) });
    }
    if (name === "search_data") {
      var q = String(args.query || "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!q) return Promise.resolve({ ok: false, c: "query is empty." });
      var ids = okIds;
      if (Array.isArray(args.apps) && args.apps.length) {
        var want = args.apps.slice(0, 50).map(function (x) { return String(x).toLowerCase(); });
        ids = okIds.filter(function (id) { return want.indexOf(id) >= 0; });
      }
      if (!ids.length) return Promise.resolve({ ok: false, c: "None of these apps may be read. Call list_apps." });
      if (typeof root.orosAssistSearch !== "function") return Promise.resolve({ ok: false, c: "Search is not available on this device." });
      return Promise.resolve(root.orosAssistSearch(q, ids)).then(function (groups) {
        var items = packHits(groups, names);
        var used = [];
        items.forEach(function (it) { if (used.indexOf(it.app) < 0) used.push(it.app); });
        return { ok: true, a: used, k: items.length, c: JSON.stringify({ query: q, items: items }) };
      });
    }
    if (name === "app_summary") {
      var app = String(args.app || "");
      if (!SUMMARY[app]) return Promise.resolve({ ok: false, c: "app must be budget or stock." });
      if (okIds.indexOf(app) < 0) return Promise.resolve({ ok: false, c: "The owner does not let Claude read " + app + "." });
      return summary().then(function (S) {
        var today = new Date(), ymd = today.getFullYear() + "-" + ("0" + (today.getMonth() + 1)).slice(-2) + "-" + ("0" + today.getDate()).slice(-2);
        var n = S.normArgs({ app: app, month: args.month }, ymd);
        if (!n.ok) return { ok: false, c: n.err };
        var lang = (root.orosLang || "en").slice(0, 2);
        var out = app === "budget" ? S.budgetMonth(readStore("oros-budget-data"), n.month, lang)
                                   : S.stockMonth(readStore("oros-stock-data"), n.month, lang);
        return { ok: true, a: [app], k: 1, c: JSON.stringify(out) };
      });
    }
    if (name === "budget_lines") {
      if (okIds.indexOf("budget") < 0) return Promise.resolve({ ok: false, c: "The owner does not let Claude read Budget." });
      var r = budgetLines(readStore("oros-budget-data"), args);
      if (!r.ok) return Promise.resolve({ ok: false, c: r.err });
      return Promise.resolve({ ok: true, a: ["budget"], k: r.data.lines.length, c: JSON.stringify(r.data) });
    }
    return Promise.resolve({ ok: false, c: "Unknown tool." });
  }

  function onCall(sock, text) {
    var q;
    try { q = JSON.parse(text); } catch (e) { return; }
    if (!isObj(q) || typeof q.q !== "string" || typeof q.n !== "string") return;
    var p = pref();
    var done = function (res) {
      var c = typeof res.c === "string" ? res.c : "";
      if (c.length > 880000) { res = { ok: false, c: "The answer is too big; ask for a shorter period or fewer apps." }; c = res.c; }
      try { sock.send(JSON.stringify({ r: q.q, ok: !!res.ok, c: c })); } catch (e) {}
      writeJSON(LOG_KEY, pushLog(readJSON(LOG_KEY), { t: Date.now(), n: q.n.slice(0, 20), a: (res.a || []).slice(0, 10), k: res.k || 0, ok: res.ok ? 1 : 0 }));
      changed();
    };
    if (!p.on) { done({ ok: false, c: "The gate is off." }); return; }
    run(q.n, q.a).then(done, function () { done({ ok: false, c: "The call failed on the device." }); });
  }

  /* ---------- API for Settings ---------- */
  var api = {
    relayUrl: RELAY + "/mcp",
    never: NEVER.slice(),
    state: function () {
      var p = pref();
      return { on: !!p.on, conn: wsState, at: p.at || 0, lv: isObj(p.lv) ? JSON.parse(JSON.stringify(p.lv)) : {} };
    },
    apps: function () {
      var lv = pref().lv || {};
      return offered().filter(function (a) { return NEVER.indexOf(a.id) < 0; }).map(function (a) {
        return { id: a.id, name: a.name, read: lv[a.id] === "read", tools: toolsOf(a.id) };
      });
    },
    setApp: function (id, read) {
      var p = pref();
      if (NEVER.indexOf(id) >= 0) return false;
      p.lv = isObj(p.lv) ? p.lv : {};
      if (read) p.lv[id] = "read"; else delete p.lv[id];
      var okW = writeJSON(PREF_KEY, p);
      changed();
      return okW;
    },
    enable: function () {
      var p = pref();
      if (p.on && p.id && p.tok) { connect(); return Promise.resolve(); }
      var id = randomB64u(16).slice(0, 22), tok = randomB64u(32);
      return sha256hex(tok).then(function (th) { return devCall({ act: "new", id: id, th: th }); }).then(function () {
        p.on = true; p.id = id; p.tok = tok; p.at = Date.now(); p.lv = isObj(p.lv) ? p.lv : {};
        if (!writeJSON(PREF_KEY, p)) throw new Error("save");
        changed();
        connect();
      });
    },
    disable: function () {
      var p = pref();
      var gone = p.id && p.tok ? devCall({ act: "del", id: p.id, tok: p.tok }).catch(function () {}) : Promise.resolve();
      drop();
      return gone.then(function () {
        writeJSON(PREF_KEY, { on: false, lv: isObj(p.lv) ? p.lv : {} });
        changed();
      });
    },
    revoke: function () {
      var p = pref();
      if (!p.on) return Promise.resolve();
      return devCall({ act: "revoke", id: p.id, tok: p.tok }).then(function () { changed(); });
    },
    info: function () {
      var p = pref();
      if (!p.on) return Promise.resolve({ links: 0, last: 0 });
      return devCall({ act: "info", id: p.id, tok: p.tok });
    },
    reconnect: function () { if (!ws) { retry = 0; connect(); } },
    log: function () { var l = readJSON(LOG_KEY); return Array.isArray(l) ? l.slice().reverse() : []; },
    clearLog: function () { try { localStorage.removeItem(LOG_KEY); } catch (e) {} changed(); },
    onChange: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    }
  };
  root.orosGate = api;

  /* ---------- Claude's sign-in: ?gate=… (from the relay's /gate/authorize) ---------- */
  function readAsk() {
    var m = /[?&]gate=([A-Za-z0-9_-]{10,2000})/.exec(location.search);
    if (!m) return null;
    try {
      var s = atob(m[1].replace(/-/g, "+").replace(/_/g, "/") + "===".slice((m[1].length + 3) % 4));
      var o = JSON.parse(decodeURIComponent(escape(s)));
      if (!isObj(o) || ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"].indexOf(o.r) < 0) return null;
      if (typeof o.c !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(o.c) || typeof o.s !== "string" || o.s.length > 500) return null;
      return o;
    } catch (e) { return null; }
  }
  function back(ask, query) {
    location.href = ask.r + "?" + query + (ask.s ? "&state=" + encodeURIComponent(ask.s) : "");
  }
  function consent(ask) {
    var wrap = document.createElement("div");
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "gate-ask-title");
    wrap.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55)";
    var box = document.createElement("div");
    box.style.cssText = "max-width:440px;width:100%;background:var(--panel-bg,#2a2a2e);color:var(--text,#fff);border-radius:12px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.4);font:inherit";
    var h = document.createElement("h2");
    h.id = "gate-ask-title";
    h.style.cssText = "margin:0 0 10px;font-size:1.15rem";
    h.textContent = tr("gate.ask.title");
    var pTxt = document.createElement("p");
    pTxt.style.cssText = "margin:0 0 10px;line-height:1.45";
    pTxt.textContent = tr("gate.ask.body");
    var note = document.createElement("p");
    note.style.cssText = "margin:0 0 16px;line-height:1.45;opacity:.8;font-size:.92rem";
    note.textContent = pref().on ? tr("gate.ask.on") : tr("gate.ask.off");
    var err = document.createElement("p");
    err.style.cssText = "margin:0 0 12px;color:#ff7b72";
    err.hidden = true;
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap";
    function btn(label, primary) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = "min-height:40px;padding:0 16px;border-radius:8px;border:1px solid rgba(127,127,127,.4);font:inherit;cursor:pointer;" +
        (primary ? "background:var(--accent,#3584e4);color:var(--accent-ink,#fff);border-color:transparent" : "background:transparent;color:inherit");
      return b;
    }
    var no = btn(tr("gate.ask.deny"), false), yes = btn(tr("gate.ask.allow"), true);
    no.addEventListener("click", function () { wrap.remove(); back(ask, "error=access_denied"); });
    yes.addEventListener("click", function () {
      yes.disabled = true; no.disabled = true; err.hidden = true;
      api.enable().then(function () {
        var p = pref();
        return devCall({ act: "code", id: p.id, tok: p.tok, c: ask.c, r: ask.r });
      }).then(function (d) {
        back(ask, "code=" + encodeURIComponent(pref().id + "." + d.code));
      }, function (e) {
        yes.disabled = false; no.disabled = false;
        err.textContent = tr("gate.ask.fail") + (e && e.code ? " (" + String(e.code).replace(/[^a-z0-9-]/gi, "").slice(0, 20) + ")" : "");
        err.hidden = false;
      });
    });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") no.click(); });
    row.appendChild(no); row.appendChild(yes);
    box.appendChild(h); box.appendChild(pTxt); box.appendChild(note); box.appendChild(err); box.appendChild(row);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    yes.focus();
  }
  // Never over the lock screen: the dialog waits until orOS is unlocked.
  function whenUnlocked(fn) {
    var L = root.orosLock;
    if (L && typeof L.isLocked === "function" && L.isLocked()) { setTimeout(function () { whenUnlocked(fn); }, 800); return; }
    fn();
  }
  function start() {
    var ask = readAsk();
    if (/[?&]gate=/.test(location.search)) {
      try { history.replaceState(null, "", location.pathname + location.search.replace(/([?&])gate=[^&]*&?/, "$1").replace(/[?&]$/, "") + location.hash); } catch (e) {}
    }
    if (ask) whenUnlocked(function () { consent(ask); });
    connect();
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") api.reconnect(); });
    root.addEventListener("online", function () { api.reconnect(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof window !== "undefined" ? window : globalThis);
