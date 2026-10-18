// ============================================================
// orOS Time — Stage: paired devices (v1.2.0, wave 3)
// A phone, tablet, laptop or smart-TV browser pairs with Time on the
// PC (the host) and takes one of three roles, chosen on the PC:
//   remote     controls the clock (start / pause, next, ± minute,
//              black screen, messages to the speaker);
//   display    shows the speaker's picture on stage;
//   moderator  sees the clock and the rundown and can ask the
//              operator for time ("1 more minute please"), nothing else.
// Pairing and the link are Studio Remote's (remote-link.js, shared):
// a 6-digit code or QR, a relay room that passes sealed frames on,
// then a direct WebRTC channel on the same Wi-Fi. A room holds two
// devices, so the PC opens one room (one code) per device, up to 6.
//
// The PC stays where things happen: a command from a device becomes
// the same action as the PC's own buttons (time/stage.js, through
// window.OrosStage) and is checked first (OrosStageCore.devCommand).
// A device keeps what it is sent in memory only and writes nothing to
// the PC's data; its clock is the PC's, corrected by the measured
// offset (clockOffset). Device-local:
//   oros-time-stage-devices  (PC) the paired devices: code, role, id,
//                            so they come back after a reload
//   oros-time-stage-join     (device) the code and id it joined with,
//                            so a reload rejoins without a new "Allow"
// ============================================================
(function () {
  "use strict";
  var C = window.OrosStageCore, L = window.OrosRemoteLink, S = window.OrosStage, V = window.OrosStageView;
  if (!C || !L || !S || !V || !document.getElementById("sl-dev")) return;

  var NS = "oros-time-stage";
  var MAX_DEV = 6;
  var DEV_KEY = "oros-time-stage-devices";
  var JOIN_KEY = "oros-time-stage-join";
  var KEEP_MS = 3 * 24 * 3600 * 1000;      // a pairing is kept this long after its last use
  var LANG = S.lang || "en";     // the full code (stage.js, orosI18n)

  var STR = {
    en: {
      "sl.devs": "Other devices", "sl.add": "Connect a device",
      "sl.hint": "Use a phone as a remote, a tablet or TV as the stage screen, or give the moderator the rundown. Keep Time open on this computer.",
      "sl.join": "Join with a code",
      "sl.r.remote": "Remote control", "sl.r.display": "Stage display", "sl.r.moderator": "Moderator",
      "sl.rd.remote": "A phone controls the clock: start, pause, next, ± minute, messages.",
      "sl.rd.display": "A tablet, laptop or TV browser shows the speaker's picture.",
      "sl.rd.moderator": "Sees the clock and the rundown and can ask you for time. Changes nothing.",
      "sl.pair.h": "Connect a device", "sl.pair.role": "What will it do?",
      "sl.pair.go": "Show a code", "sl.pair.how": "On the other device open orOS › Time › Stage › Join with a code, or scan the QR code.",
      "sl.pair.full": "Six devices are connected. Disconnect one first.",
      "sl.ask": "A {dev} wants to connect as {role}. Allow it?", "sl.allow": "Allow", "sl.deny": "Deny",
      "sl.close": "Close", "sl.remove": "Disconnect {role}",
      "sl.dev.phone": "phone", "sl.dev.tablet": "tablet", "sl.dev.computer": "computer",
      "sl.s.connecting": "Connecting…", "sl.s.waiting": "Waiting for the device · code {code}",
      "sl.s.waitHost": "Waiting for Time on the computer…", "sl.s.pending": "Waiting for “Allow” on the computer…",
      "sl.s.direct": "Connected directly", "sl.s.relay": "Connected through the relay", "sl.s.closed": "Disconnected",
      "sl.s.denied": "The computer did not allow this device.", "sl.s.bad": "Enter the 6-digit code shown on the computer.",
      "sl.s.away": "Not connected", "sl.s.off": "The computer disconnected this device.", "sl.s.nocrypto": "This browser cannot pair (no Web Crypto).",
      "sl.join.h": "Join Time on another device", "sl.code": "Code", "sl.connect": "Connect",
      "sl.leave": "Leave", "sl.fs": "Full screen",
      "sl.go.start": "Start", "sl.go.pause": "Pause", "sl.go.resume": "Resume",
      "sl.prev": "◀ Previous", "sl.next": "Next ▶", "sl.minus": "−1 min", "sl.plus": "+1 min", "sl.reset": "Restart item",
      "sl.black": "Black screen", "sl.black.off": "Picture back on", "sl.isblack": "The stage screen is black",
      "sl.msg": "Message to the speaker", "sl.msg.ph": "Type a message", "sl.msg.send": "Show", "sl.msg.hide": "Hide message",
      "sl.msg.flash": "Flash", "sl.msg.color": "Colour",
      "sl.c.white": "White", "sl.c.yellow": "Yellow", "sl.c.red": "Red", "sl.c.green": "Green",
      "sl.p.wrap": "Please wrap up", "sl.p.five": "5 minutes left", "sl.p.two": "2 minutes left",
      "sl.p.up": "Time is up", "sl.p.qa": "Questions now", "sl.p.loud": "Louder please", "sl.p.slow": "Slow down a little",
      "sl.ask.h": "Ask the operator", "sl.ask.ph": "Your request", "sl.ask.send": "Send",
      "sl.q.one": "1 more minute please", "sl.q.five": "5 more minutes please", "sl.q.wrap": "Please wrap up now",
      "sl.q.qa": "Time for questions", "sl.q.late": "We are running late",
      "sl.ask.sent": "Sent: {text}", "sl.ask.seen": "Seen by the operator: {text}",
      "sl.asks.from": "Moderator: {text}", "sl.asks.show": "Show to speaker", "sl.asks.ok": "OK",
      "sl.cut": "Long rundown: only the items around the live one are shown here."
    },
    el: {
      "sl.devs": "Άλλες συσκευές", "sl.add": "Σύνδεση συσκευής",
      "sl.hint": "Χρησιμοποίησε ένα κινητό ως τηλεχειριστήριο, ένα tablet ή μια τηλεόραση ως οθόνη σκηνής, ή δώσε στον συντονιστή το πρόγραμμα. Κράτα την Ώρα ανοιχτή σε αυτόν τον υπολογιστή.",
      "sl.join": "Σύνδεση με κωδικό",
      "sl.r.remote": "Τηλεχειριστήριο", "sl.r.display": "Οθόνη σκηνής", "sl.r.moderator": "Συντονιστής",
      "sl.rd.remote": "Ένα κινητό χειρίζεται το ρολόι: έναρξη, παύση, επόμενο, ± λεπτό, μηνύματα.",
      "sl.rd.display": "Ένα tablet, laptop ή browser τηλεόρασης δείχνει την εικόνα του ομιλητή.",
      "sl.rd.moderator": "Βλέπει το ρολόι και το πρόγραμμα και μπορεί να σου ζητήσει χρόνο. Δεν αλλάζει τίποτα.",
      "sl.pair.h": "Σύνδεση συσκευής", "sl.pair.role": "Τι θα κάνει;",
      "sl.pair.go": "Εμφάνιση κωδικού", "sl.pair.how": "Στην άλλη συσκευή άνοιξε orOS › Ώρα › Σκηνή › Σύνδεση με κωδικό, ή σκάναρε τον κωδικό QR.",
      "sl.pair.full": "Είναι συνδεδεμένες έξι συσκευές. Αποσύνδεσε πρώτα μία.",
      "sl.ask": "Ένα {dev} θέλει να συνδεθεί ως {role}. Να επιτραπεί;", "sl.allow": "Επιτρέπεται", "sl.deny": "Απόρριψη",
      "sl.close": "Κλείσιμο", "sl.remove": "Αποσύνδεση: {role}",
      "sl.dev.phone": "κινητό", "sl.dev.tablet": "tablet", "sl.dev.computer": "υπολογιστής",
      "sl.s.connecting": "Σύνδεση…", "sl.s.waiting": "Αναμονή για τη συσκευή · κωδικός {code}",
      "sl.s.waitHost": "Αναμονή για την Ώρα στον υπολογιστή…", "sl.s.pending": "Αναμονή για «Επιτρέπεται» στον υπολογιστή…",
      "sl.s.direct": "Απευθείας σύνδεση", "sl.s.relay": "Σύνδεση μέσω relay", "sl.s.closed": "Αποσυνδέθηκε",
      "sl.s.denied": "Ο υπολογιστής δεν επέτρεψε αυτή τη συσκευή.", "sl.s.bad": "Γράψε τον 6ψήφιο κωδικό που δείχνει ο υπολογιστής.",
      "sl.s.away": "Χωρίς σύνδεση", "sl.s.off": "Ο υπολογιστής αποσύνδεσε αυτή τη συσκευή.", "sl.s.nocrypto": "Αυτός ο browser δεν μπορεί να συνδεθεί (δεν έχει Web Crypto).",
      "sl.join.h": "Σύνδεση με την Ώρα άλλης συσκευής", "sl.code": "Κωδικός", "sl.connect": "Σύνδεση",
      "sl.leave": "Έξοδος", "sl.fs": "Πλήρης οθόνη",
      "sl.go.start": "Έναρξη", "sl.go.pause": "Παύση", "sl.go.resume": "Συνέχεια",
      "sl.prev": "◀ Προηγούμενο", "sl.next": "Επόμενο ▶", "sl.minus": "−1 λεπτό", "sl.plus": "+1 λεπτό", "sl.reset": "Από την αρχή",
      "sl.black": "Μαύρη οθόνη", "sl.black.off": "Επαναφορά εικόνας", "sl.isblack": "Η οθόνη της σκηνής είναι μαύρη",
      "sl.msg": "Μήνυμα στον ομιλητή", "sl.msg.ph": "Γράψε ένα μήνυμα", "sl.msg.send": "Εμφάνιση", "sl.msg.hide": "Απόκρυψη μηνύματος",
      "sl.msg.flash": "Αναβοσβήνει", "sl.msg.color": "Χρώμα",
      "sl.c.white": "Λευκό", "sl.c.yellow": "Κίτρινο", "sl.c.red": "Κόκκινο", "sl.c.green": "Πράσινο",
      "sl.p.wrap": "Κλείσε παρακαλώ", "sl.p.five": "Μένουν 5 λεπτά", "sl.p.two": "Μένουν 2 λεπτά",
      "sl.p.up": "Ο χρόνος τελείωσε", "sl.p.qa": "Ώρα για ερωτήσεις", "sl.p.loud": "Πιο δυνατά παρακαλώ", "sl.p.slow": "Λίγο πιο αργά",
      "sl.ask.h": "Αίτημα στον χειριστή", "sl.ask.ph": "Το αίτημά σου", "sl.ask.send": "Αποστολή",
      "sl.q.one": "Ένα λεπτό ακόμη παρακαλώ", "sl.q.five": "Πέντε λεπτά ακόμη παρακαλώ", "sl.q.wrap": "Να κλείσει τώρα παρακαλώ",
      "sl.q.qa": "Ώρα για ερωτήσεις", "sl.q.late": "Έχουμε καθυστέρηση",
      "sl.ask.sent": "Στάλθηκε: {text}", "sl.ask.seen": "Το είδε ο χειριστής: {text}",
      "sl.asks.from": "Συντονιστής: {text}", "sl.asks.show": "Εμφάνιση στον ομιλητή", "sl.asks.ok": "OK",
      "sl.cut": "Μεγάλο πρόγραμμα: εδώ φαίνονται μόνο τα στοιχεία γύρω από το τρέχον."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STR, "time", LANG);
  function t(k, vars) {
    var s = (STR[LANG] && STR[LANG][k] !== undefined) ? STR[LANG][k] : (STR.en[k] !== undefined ? STR.en[k] : k);
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(vars[v]); });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeJSON(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function devName(kind) { return t("sl.dev." + (kind === "phone" || kind === "tablet" ? kind : "computer")); }
  function live(link) { return !!(link && (link.state === "relay" || link.state === "direct")); }
  function applyI18n() {
    var els = document.querySelectorAll("[data-i18n-l]");
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute("data-i18n-l"));
    var phs = document.querySelectorAll("[data-i18n-l-ph]");
    for (var j = 0; j < phs.length; j++) phs[j].placeholder = t(phs[j].getAttribute("data-i18n-l-ph"));
    var als = document.querySelectorAll("[data-i18n-l-a]");
    for (var k = 0; k < als.length; k++) als[k].setAttribute("aria-label", t(als[k].getAttribute("data-i18n-l-a")));
    var sel = $("sd-msg-color");
    sel.textContent = "";
    C.COLORS.forEach(function (c) { var o = el("option", null, t("sl.c." + c), sel); o.value = c; });
  }
  function closeOnBackdrop(dlg) {
    dlg.addEventListener("click", function (ev) {
      if (ev.target !== dlg) return;
      var r = dlg.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) dlg.close();
    });
  }
  function drawQr(cv, text) {
    var g = cv.getContext && cv.getContext("2d"), Q = window.orosQR, mods = null;
    if (text && Q && g) { try { mods = Q.encode(text, { ecl: "M" }).modules; } catch (e) { mods = null; } }
    cv.hidden = !mods;
    if (!mods) return;
    var n = mods.length, q = 4, px = Math.max(2, Math.floor(232 / (n + 2 * q)));
    cv.width = cv.height = px * (n + 2 * q);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#000000";
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (mods[y][x]) g.fillRect((x + q) * px, (y + q) * px, px, px);
  }
  function joinUrl(code) {
    var base = "";
    try { base = window.parent.location.origin + window.parent.location.pathname; } catch (e) {}
    if (!base) base = location.origin + "/";
    return base.replace(/\/index\.html$/, "/") + "?open=time#stage-join=" + code;
  }

  /* ---------- 1. Host (the PC running Time) ---------- */
  var devs = [];          // { code, role, rid, kind, at, link, last }
  var pairing = null;     // the device the pair dialog is showing
  var asks = [];          // moderator requests waiting for the operator

  function saveDevs() {
    writeJSON(DEV_KEY, devs.map(function (d) { return { code: d.code, role: d.role, rid: d.rid, kind: d.kind, at: d.at }; }));
  }
  function addDev(e) {
    var d = { code: e.code, role: e.role, rid: e.rid || "", kind: e.kind || "", at: e.at || Date.now(), link: null, last: "" };
    d.link = new L.Link({
      role: "host", code: d.code, relay: L.relayUrl(), ns: NS, label: "stage", dev: L.deviceName(), allow: d.rid,
      admit: function (dev, answer) { askAllow(d, dev, answer); },
      onAllow: function (rid) { d.rid = rid; d.at = Date.now(); saveDevs(); },
      onState: function () { if (live(d.link)) push(d, true); renderDevs(); renderPair(); },
      onPeer: function (dev) {
        if (dev) d.kind = dev === "phone" || dev === "tablet" ? dev : "computer";
        d.at = Date.now();
        saveDevs();
        push(d, true);
        renderDevs(); renderPair();
      },
      onGone: function () { renderDevs(); renderPair(); },
      onApp: function (m) { onCommand(d, m); }
    });
    devs.push(d);
    return d;
  }
  function removeDev(d) {
    if (d.answer) d.answer(false);
    if (live(d.link)) d.link.send({ t: "off" });                    // the device leaves its screen
    var link = d.link;
    setTimeout(function () { try { link.close(); } catch (e) {} }, 150);
    devs = devs.filter(function (x) { return x !== d; });
    if (pairing === d) pairing = null;
    saveDevs();
    renderDevs(); renderPair();
  }
  // Snapshot for one device, sent when it changes (the clock itself
  // runs on the device from the start instant, so this is rare).
  function push(d, force) {
    if (!live(d.link)) return;
    var st = C.devState(S.data(), S.run(), S.show(), d.role, Date.now());
    if (!st) return;
    var key = JSON.stringify(Object.assign({}, st, { now: 0 }));
    if (key === d.last && !force) return;
    d.last = key;
    d.link.send(st);
  }
  function onCommand(d, m) {
    var c = C.devCommand(d.role, m);
    if (!c) return;
    d.at = Date.now();
    if (c.t === "hi") { push(d, true); return; }
    if (c.t === "leave") { removeDev(d); return; }
    if (c.t === "tk") { d.link.send({ t: "tk", c: c.c, h: Date.now() }); return; }
    if (c.t === "a") S.act(c.a);
    else if (c.t === "add") S.act("add", c.s);
    else if (c.t === "black") S.setBlack(c.on);
    else if (c.t === "msg") S.setMsg({ text: c.text, color: c.color, flash: c.flash, on: true });
    else if (c.t === "msgoff") S.setMsg({ on: false });
    else if (c.t === "ask") addAsk(d, c);
    devs.forEach(function (x) { push(x, false); });
  }

  // A device knocked: only the person at the PC lets it in.
  function askAllow(d, dev, answer) {
    if (d.answer) d.answer(false);
    d.answer = function (yes) { d.answer = null; answer(yes); renderPair(); renderDevs(); };
    pairing = d;
    if (!$("sl-pair-dlg").open) $("sl-pair-dlg").showModal();
    $("sl-ask-text").textContent = t("sl.ask", { dev: devName(dev), role: t("sl.r." + d.role) });
    renderPair();
    try { $("sl-allow").focus(); } catch (e) {}
  }

  function stateText(d) {
    var s = d.link ? d.link.state : "closed";
    if (s === "direct") return t("sl.s.direct");
    if (s === "relay") return t("sl.s.relay");
    if (d.rid && s !== "closed") return t("sl.s.away");             // let in before: it comes back by itself
    if (s === "waiting") return t("sl.s.waiting", { code: d.code.slice(0, 3) + " " + d.code.slice(3) });
    if (s === "closed") return t("sl.s.closed");
    return t("sl.s.connecting");
  }
  function renderDevs() {
    var host = $("sl-list");
    host.textContent = "";
    devs.forEach(function (d) {
      var li = el("li", "sl-item" + (live(d.link) ? " on" : ""), null, host);
      var b = el("div", "sl-item-b", null, li);
      el("div", "sl-item-t", t("sl.r." + d.role) + (d.kind ? " · " + devName(d.kind) : ""), b);
      el("div", "sl-item-s", stateText(d), b);
      var x = el("button", "stg-ib", "×", li);
      x.type = "button";
      x.setAttribute("aria-label", t("sl.remove", { role: t("sl.r." + d.role) }));
      x.addEventListener("click", function () { removeDev(d); });
    });
    $("sl-add").disabled = devs.length >= MAX_DEV;
  }

  function role() {
    var r = document.querySelector('input[name="sl-role"]:checked');
    return r && C.ROLES.indexOf(r.value) >= 0 ? r.value : "remote";
  }
  function openPair() {
    pairing = null;
    $("sl-pair-dlg").showModal();
    renderPair();
  }
  function renderPair() {
    if (!$("sl-pair-dlg").open) return;
    var d = pairing && devs.indexOf(pairing) >= 0 ? pairing : null;
    var full = !d && devs.length >= MAX_DEV;
    $("sl-pick").hidden = !!d;
    $("sl-pair-go").hidden = !!d || full;
    $("sl-full").hidden = !full;
    $("sl-code-box").hidden = !d || !!d.rid;
    $("sl-ask-box").hidden = !(d && d.answer);
    $("sl-pair-st").textContent = d ? t("sl.r." + d.role) + ": " + stateText(d) : "";
    if (d && !d.rid) {
      $("sl-code").textContent = d.code.slice(0, 3) + " " + d.code.slice(3);
      $("sl-url").textContent = joinUrl(d.code);
      drawQr($("sl-qr"), joinUrl(d.code));
    }
  }
  $("sl-add").addEventListener("click", openPair);
  $("sl-pair-go").addEventListener("click", function () {
    if (devs.length >= MAX_DEV) { renderPair(); return; }
    pairing = addDev({ code: L.newCode(), role: role() });
    renderDevs(); renderPair();
  });
  $("sl-allow").addEventListener("click", function () { if (pairing && pairing.answer) pairing.answer(true); });
  $("sl-deny").addEventListener("click", function () { if (pairing && pairing.answer) pairing.answer(false); });
  $("sl-pair-close").addEventListener("click", function () { $("sl-pair-dlg").close(); });
  $("sl-pair-dlg").addEventListener("close", function () {
    // closing while a device is asking means no
    if (pairing && pairing.answer) pairing.answer(false);
    pairing = null;
  });
  closeOnBackdrop($("sl-pair-dlg"));

  // Moderator requests: on the operator's pane until handled.
  function addAsk(d, c) {
    var a = { d: d, id: c.id, text: c.text, at: Date.now() };
    asks = asks.filter(function (x) { return !(x.d === d && x.text === c.text); }).concat([a]).slice(-4);
    renderAsks();
  }
  function doneAsk(a, showIt) {
    if (showIt) S.setMsg({ text: a.text, on: true, color: "yellow", flash: false });
    asks = asks.filter(function (x) { return x !== a; });
    if (live(a.d.link)) a.d.link.send({ t: "seen", id: a.id, text: a.text });
    renderAsks();
  }
  function renderAsks() {
    var host = $("sl-asks");
    host.textContent = "";
    asks.forEach(function (a) {
      var row = el("div", "sl-ask", null, host);
      el("span", "sl-ask-t", t("sl.asks.from", { text: a.text }), row);
      var sh = el("button", "mini", t("sl.asks.show"), row);
      sh.type = "button";
      sh.addEventListener("click", function () { doneAsk(a, true); });
      var ok = el("button", "mini", t("sl.asks.ok"), row);
      ok.type = "button";
      ok.addEventListener("click", function () { doneAsk(a, false); });
    });
    host.hidden = !asks.length;
  }

  /* ---------- 2. Device (phone, tablet, TV) ---------- */
  var R = { link: null, code: "", st: null, samples: [], off: 0, tk: 0, tkN: 0, timer: 0, sent: "", view: null };

  function openJoin(code) {
    $("sl-join-code").value = code || "";
    $("sl-join-st").textContent = "";
    $("sl-join-dlg").showModal();
    if (code && L.CODE_RE.test(code)) joinStart(code, "");
    else setTimeout(function () { try { $("sl-join-code").focus(); } catch (e) {} }, 50);
  }
  function joinStart(code, rid) {
    code = String(code || "").replace(/\D/g, "");
    if (!L.CODE_RE.test(code)) { $("sl-join-st").textContent = t("sl.s.bad"); return; }
    joinStop(true);
    R.code = code; R.st = null; R.samples = []; R.off = 0;
    R.link = new L.Link({
      role: "remote", code: code, relay: L.relayUrl(), ns: NS, label: "stage", dev: L.deviceName(), rid: rid,
      onState: function (s) {
        $("sl-join-st").textContent = s === "nocrypto" ? t("sl.s.nocrypto") : devState(s);
        renderBadge();
        if (live(R.link)) { R.link.send({ t: "hi" }); clockStart(); }
      },
      onApp: onHost,
      onDeny: function () {
        joinStop(true);
        writeJSON(JOIN_KEY, null);
        $("sl-join-st").textContent = t("sl.s.denied");
        if (!$("sl-join-dlg").open) $("sl-join-dlg").showModal();
        leaveDev();
      },
      onGone: renderBadge
    });
    writeJSON(JOIN_KEY, { code: code, rid: R.link.rid(), at: Date.now() });
    $("sl-join-st").textContent = t("sl.s.connecting");
  }
  function joinStop(quiet) {
    if (R.link) R.link.close();
    R.link = null; R.st = null;
    clearInterval(R.tk); R.tk = 0;
    if (!quiet) { writeJSON(JOIN_KEY, null); leaveDev(); }
  }
  function devState(s) {
    if (s === "direct") return t("sl.s.direct");
    if (s === "relay") return t("sl.s.relay");
    if (s === "waiting") return t("sl.s.waitHost");
    if (s === "pending") return t("sl.s.pending");
    if (s === "closed") return t("sl.s.closed");
    return t("sl.s.connecting");
  }
  // The PC's clock: a few round trips at once, then one now and then.
  function clockStart() {
    clearInterval(R.tk);
    R.tkN = 0;
    var ping = function () {
      if (!live(R.link)) return;
      R.link.send({ t: "tk", c: Date.now() });
      R.tkN++;
      if (R.tkN === 5) { clearInterval(R.tk); R.tk = setInterval(ping, 15000); }
    };
    ping();
    R.tk = setInterval(ping, 400);
  }
  function onHost(m) {
    if (!m || typeof m.t !== "string") return;
    if (m.t === "st") {
      var a = C.devAdopt(m);
      if (!a) return;
      if (!R.samples.length && a.now) R.off = a.now - Date.now();   // until the first round trip
      R.st = a;
      if ($("sl-join-dlg").open) $("sl-join-dlg").close();
      enterDev();
      renderDev();
    } else if (m.t === "tk" && typeof m.c === "number" && typeof m.h === "number") {
      R.samples = R.samples.concat([{ c: m.c, h: m.h, r: Date.now() }]).slice(-8);
      R.off = C.clockOffset(R.samples);
    } else if (m.t === "off") {
      joinStop(false);
      $("sl-join-st").textContent = t("sl.s.off");
      $("sl-join-code").value = "";
      $("sl-join-dlg").showModal();
    } else if (m.t === "seen" && typeof m.text === "string") {
      $("sd-ask-st").textContent = t("sl.ask.seen", { text: String(m.text).slice(0, 120) });
    }
  }
  function send(c) { if (R.link) R.link.send(c); }

  // the overlay
  var devOpen = false, wake = null, toolsT = 0;
  function enterDev() {
    if (devOpen) return;
    devOpen = true;
    $("sl-dev").hidden = false;
    document.body.classList.add("sl-dev-on");
    if (!R.view) R.view = V.create($("sd-root"), { lang: LANG });
    try { if (navigator.wakeLock && !wake) navigator.wakeLock.request("screen").then(function (w) { wake = w; }).catch(function () {}); } catch (e) {}
    clearInterval(R.timer);
    R.timer = setInterval(paintDev, 250);
    poke();
  }
  function leaveDev() {
    if (!devOpen) return;
    devOpen = false;
    $("sl-dev").hidden = true;
    document.body.classList.remove("sl-dev-on");
    clearInterval(R.timer); R.timer = 0;
    try { if (wake) wake.release().catch(function () {}); } catch (e) {}
    wake = null;
    fullscreen(false);
  }
  function renderBadge() {
    var b = $("sd-link");
    var s = R.link ? R.link.state : "closed";
    b.textContent = live(R.link) ? devState(s) : t("sl.s.away");
    b.className = "sd-link " + (s === "direct" ? "ok" : s === "relay" ? "via" : "lost");
  }
  // What the picture shows on this device: the display role shows the
  // stage as it is; the remote and the moderator always see the clock
  // (a banner says when the stage is black).
  function viewState() {
    var st = R.st;
    var show = st.show;
    if (st.role !== "display") show = Object.assign({}, show, { black: false, mirror: false, layout: st.role === "moderator" ? "agenda" : "full" });
    return { data: st.data, run: st.run, show: show };
  }
  function paintDev() {
    if (!R.st || !R.view) return;
    R.view.paint(viewState(), Date.now() + R.off);
  }
  function renderDev() {
    var st = R.st;
    if (!st) return;
    var rl = st.role;
    $("sl-dev").className = "role-" + rl;
    $("sd-role").textContent = t("sl.r." + rl);
    $("sd-ctl").hidden = rl !== "remote";
    $("sd-askp").hidden = rl !== "moderator";
    $("sd-black-note").hidden = rl === "display" || !st.show.black;
    $("sd-cut").hidden = !st.cut;
    renderBadge();
    if (rl === "remote") {
      var r = st.run;
      $("sd-go").textContent = t(!r.cur || !r.startedAt ? "sl.go.start" : r.pausedAt ? "sl.go.resume" : "sl.go.pause");
      $("sd-black").textContent = t(st.show.black ? "sl.black.off" : "sl.black");
      $("sd-black").classList.toggle("prim", st.show.black);
      $("sd-msg-hide").hidden = !st.show.msg.on;
      var key = JSON.stringify(st.msgs);
      if (key !== R.sent) {
        R.sent = key;
        var host = $("sd-presets");
        host.textContent = "";
        ["sl.p.wrap", "sl.p.five", "sl.p.two", "sl.p.up", "sl.p.qa", "sl.p.loud", "sl.p.slow"].map(t).concat(st.msgs).forEach(function (txt) {
          var b = el("button", "qchip", txt, host);
          b.type = "button";
          b.addEventListener("click", function () { sendMsg(txt); });
        });
      }
    }
    paintDev();
  }
  function sendMsg(text) {
    text = String(text || "").trim().slice(0, 200);
    if (!text) return;
    send({ t: "msg", text: text, color: $("sd-msg-color").value, flash: $("sd-msg-flash").checked });
  }
  function ask(text) {
    text = String(text || "").trim().slice(0, 120);
    if (!text) return;
    var a = new Uint32Array(1);
    crypto.getRandomValues(a);
    send({ t: "ask", text: text, id: a[0].toString(36) + "aaaa" });
    $("sd-ask-st").textContent = t("sl.ask.sent", { text: text });
  }

  function fsDoc() { try { return window.frameElement ? window.parent.document : document; } catch (e) { return document; } }
  function fsOn() { var d = fsDoc(); return !!(d.fullscreenElement || d.webkitFullscreenElement); }
  function fullscreen(on) {
    var d = fsDoc();
    try {
      if (!on) {
        if (!fsOn()) return;
        var x = d.exitFullscreen || d.webkitExitFullscreen;
        var p1 = x && x.call(d); if (p1 && p1.catch) p1.catch(function () {});
      } else if (!fsOn()) {
        var node = window.frameElement || document.documentElement;
        var f = node.requestFullscreen || node.webkitRequestFullscreen;
        var p2 = f && f.call(node); if (p2 && p2.catch) p2.catch(function () {});
      }
    } catch (e) {}
  }
  // the bar of the display role hides itself after a while
  function poke() {
    $("sd-bar").classList.add("on");
    clearTimeout(toolsT);
    toolsT = setTimeout(function () { if (R.st && R.st.role === "display") $("sd-bar").classList.remove("on"); }, 3500);
  }

  $("stg-join").addEventListener("click", function () { openJoin(""); });
  $("sl-join-go").addEventListener("click", function () { joinStart($("sl-join-code").value, ""); });
  $("sl-join-code").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); joinStart($("sl-join-code").value, ""); }
  });
  $("sl-join-close").addEventListener("click", function () { $("sl-join-dlg").close(); });
  $("sl-join-dlg").addEventListener("close", function () { if (R.link && !R.st) joinStop(false); });
  closeOnBackdrop($("sl-join-dlg"));
  // leaving tells the PC to forget this device (a dropped link does not)
  $("sd-leave").addEventListener("click", function () { send({ t: "leave" }); setTimeout(function () { joinStop(false); }, 150); });
  $("sd-fs").addEventListener("click", function () { fullscreen(!fsOn()); });
  $("sl-dev").addEventListener("pointermove", poke);
  $("sl-dev").addEventListener("pointerdown", poke);
  $("sd-view").addEventListener("dblclick", function () { fullscreen(!fsOn()); });
  $("sd-go").addEventListener("click", function () { send({ t: "a", a: "go" }); });
  $("sd-prev").addEventListener("click", function () { send({ t: "a", a: "prev" }); });
  $("sd-next").addEventListener("click", function () { send({ t: "a", a: "next" }); });
  $("sd-reset").addEventListener("click", function () { send({ t: "a", a: "reset" }); });
  $("sd-black").addEventListener("click", function () { if (R.st) send({ t: "black", on: !R.st.show.black }); });
  $("sd-msg-send").addEventListener("click", function () { sendMsg($("sd-msg").value); });
  $("sd-msg").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); sendMsg($("sd-msg").value); } });
  $("sd-msg-hide").addEventListener("click", function () { send({ t: "msgoff" }); });
  // ±1 minute; a long press gives ±5 (as on the PC)
  [["sd-plus", 60], ["sd-minus", -60]].forEach(function (p) {
    var b = $(p[0]), timer = 0, long = false;
    b.addEventListener("pointerdown", function () {
      long = false; clearTimeout(timer);
      timer = setTimeout(function () { long = true; send({ t: "add", s: p[1] * 5 }); }, 550);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) { b.addEventListener(ev, function () { clearTimeout(timer); }); });
    b.addEventListener("click", function () { if (long) { long = false; return; } send({ t: "add", s: p[1] }); });
  });
  ["sl.q.one", "sl.q.five", "sl.q.wrap", "sl.q.qa", "sl.q.late"].forEach(function (k) {
    var b = el("button", "qchip", t(k), $("sd-asks"));
    b.type = "button";
    b.addEventListener("click", function () { ask(t(k)); });
  });
  $("sd-ask-send").addEventListener("click", function () { ask($("sd-ask").value); $("sd-ask").value = ""; });
  $("sd-ask").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); ask($("sd-ask").value); $("sd-ask").value = ""; }
  });

  // While this device is paired, the keys belong to the pairing, not to
  // this device's own Stage tab (stage.js listens on the document; this
  // runs first, on the window).
  window.addEventListener("keydown", function (e) {
    if (!devOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.querySelector("dialog[open]")) return;
    var k = e.key, rem = R.st && R.st.role === "remote", done = true;
    if (k === "f" || k === "F") fullscreen(!fsOn());
    else if (!rem) done = false;
    else if (k === " " || k === "Spacebar") send({ t: "a", a: "go" });
    else if (k === "ArrowRight" || k === "PageDown") send({ t: "a", a: "next" });
    else if (k === "ArrowLeft" || k === "PageUp") send({ t: "a", a: "prev" });
    else if (k === "+" || k === "=") send({ t: "add", s: 60 });
    else if (k === "-" || k === "_") send({ t: "add", s: -60 });
    else if (k === "b" || k === "B" || k === ".") { if (R.st) send({ t: "black", on: !R.st.show.black }); }
    else if (k === "m" || k === "M") { if (R.st && R.st.show.msg.on) send({ t: "msgoff" }); }
    else done = false;
    e.stopPropagation();
    if (done) e.preventDefault();
    poke();
  }, true);

  /* ---------- 3. Boot ---------- */
  applyI18n();
  renderBadge();
  // the PC: the devices paired before a reload come back
  var now = Date.now();
  (Array.isArray(readJSON(DEV_KEY)) ? readJSON(DEV_KEY) : []).forEach(function (e) {
    if (!e || typeof e.code !== "string" || !L.CODE_RE.test(e.code) || C.ROLES.indexOf(e.role) < 0) return;
    if (typeof e.rid !== "string" || !/^[0-9a-f]{32}$/.test(e.rid)) return;            // never let in
    if (!(e.at > now - KEEP_MS) || devs.length >= MAX_DEV) return;
    addDev({ code: e.code, role: e.role, rid: e.rid, kind: e.kind, at: e.at });
  });
  saveDevs();
  renderDevs();
  renderAsks();
  setInterval(function () { devs.forEach(function (d) { push(d, false); }); }, 250);
  // keep the "last used" stamp of live pairings fresh, now and then
  setInterval(function () {
    var n = Date.now(), any = false;
    devs.forEach(function (d) { if (live(d.link) && d.rid) { d.at = n; any = true; } });
    if (any) saveDevs();
  }, 60000);

  // a device: a QR scanned opens orOS at "?open=time#stage-join=<code>";
  // a reload rejoins with the code and id it had
  var code = "";
  try {
    var h = window.parent.location.hash || "", mm = h.match(/^#stage-join=([0-9]{6})$/);
    if (mm) {
      code = mm[1];
      window.parent.history.replaceState(window.parent.history.state, "", window.parent.location.pathname + window.parent.location.search);
    }
  } catch (e) {}
  var j = readJSON(JOIN_KEY);
  if (code) openJoin(code);
  else if (j && typeof j.code === "string" && L.CODE_RE.test(j.code) && typeof j.rid === "string" && /^[0-9a-f]{32}$/.test(j.rid) && j.at > now - KEEP_MS) {
    joinStart(j.code, j.rid);
  }

  window.OrosStageLink = { devices: function () { return devs.length; }, joined: function () { return !!R.link; } };
})();
