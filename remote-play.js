/* ============================================================
   orOS — Remote play (shared): one game on two devices
   Two people, each on their own phone, tablet or computer, play one
   game (Backgammon, Xeri, Connect 4, Battleship). One device shows a
   6-digit code and a QR code ("Show a code"), the other enters it
   ("Enter a code"), the first lets it in (Allow). The link is the
   shared remote-link.js (OrosRemoteLink, as Time › Stage and Slides use
   it): a room on the orOS relay that only passes AES-GCM sealed frames,
   then a direct WebRTC channel on the same network. No relay change:
   each game passes its own namespace (oros-<app>-play).

   This module is only the pairing and the pipe: the dialogs, the
   badge in the toolbar, reconnecting after a reload, leaving. What a
   message means, and checking it, is the game's job (each game's
   net section); a message here is any plain object with a short type
   "t" (okMsg), at most OrosRemoteLink.MAX_MSG characters.

   Device-local (never synced): oros-<app>-pair = { role "host" |
   "guest", code, rid, kind, at } so a reload comes back to the same
   game (kept 24 h from the last contact).

   window.OrosRemotePlay = { create(o), okMsg, STR }
   create({ app, lang, game (its name), dialog: { make, el, button },
     onPeer(role) (the other device is (back) on the line),
     onMsg(m), onLink() (state changed), onEnd(why: "left" | "peer" |
     "denied") }) → { open, host, join, send, leave, boot, role,
     active, live, badge }
   ============================================================ */
(function (root) {
  "use strict";

  var KEEP_MS = 24 * 3600 * 1000;
  var RID_RE = /^[0-9a-f]{32}$/;
  var TYPE_RE = /^[a-z_]{1,12}$/;

  var STR = {
    en: {
      "title": "Play on two devices",
      "intro": "Each player uses their own phone, tablet or computer. One device shows a code, the other enters it.",
      "host": "Show a code", "join": "Enter a code", "code": "Code", "connect": "Connect",
      "how": "On the other device open orOS › {game} › Two devices › Enter a code, or scan the QR code.",
      "waiting": "Waiting for the other device · code {code}",
      "ask": "A {dev} wants to play {game} with you. Let it in?",
      "allow": "Allow", "deny": "Don't allow",
      "s.connecting": "Connecting…", "s.waitHost": "Waiting for the device with the code…",
      "s.pending": "Waiting for the other device to let you in…",
      "s.direct": "Connected (same network)", "s.relay": "Connected (through the orOS relay)",
      "s.away": "The other device is away. It comes back by itself.",
      "s.closed": "Not connected", "s.nocrypto": "This browser can't encrypt the link.",
      "s.bad": "Enter the 6-digit code", "s.denied": "The other device didn't let you in.",
      "dev.phone": "phone", "dev.tablet": "tablet", "dev.computer": "computer",
      "role.host": "You host this game", "role.guest": "You joined this game",
      "leave": "Leave the game", "close": "Close", "cancel": "Cancel",
      "badge": "Two devices", "badge.away": "Reconnecting…",
      "privacy": "Moves go straight between the two devices, or sealed through the orOS relay. Nothing is kept online.",
      "left": "You left the game on two devices", "peerLeft": "The other player left the game",
      "joined": "The other device is in. Have a good game!"
    },
    el: {
      "title": "Παιχνίδι σε δύο συσκευές",
      "intro": "Κάθε παίκτης παίζει από το δικό του κινητό, tablet ή υπολογιστή. Η μία συσκευή δείχνει έναν κωδικό και η άλλη τον πληκτρολογεί.",
      "host": "Δείξε κωδικό", "join": "Βάλε κωδικό", "code": "Κωδικός", "connect": "Σύνδεση",
      "how": "Στην άλλη συσκευή άνοιξε orOS › {game} › Δύο συσκευές › Βάλε κωδικό, ή σκάναρε τον κωδικό QR.",
      "waiting": "Αναμονή για την άλλη συσκευή · κωδικός {code}",
      "ask": "Ένα {dev} θέλει να παίξει {game} μαζί σου. Να μπει;",
      "allow": "Να μπει", "deny": "Όχι",
      "s.connecting": "Σύνδεση…", "s.waitHost": "Αναμονή για τη συσκευή με τον κωδικό…",
      "s.pending": "Περιμένουμε την άλλη συσκευή να σε αφήσει να μπεις…",
      "s.direct": "Συνδέθηκε (ίδιο δίκτυο)", "s.relay": "Συνδέθηκε (μέσω του relay του orOS)",
      "s.away": "Η άλλη συσκευή χάθηκε. Θα επανέλθει μόνη της.",
      "s.closed": "Χωρίς σύνδεση", "s.nocrypto": "Αυτός ο browser δεν μπορεί να κρυπτογραφήσει τη σύνδεση.",
      "s.bad": "Βάλε τον εξαψήφιο κωδικό", "s.denied": "Η άλλη συσκευή δεν σε άφησε να μπεις.",
      "dev.phone": "κινητό", "dev.tablet": "tablet", "dev.computer": "υπολογιστής",
      "role.host": "Φιλοξενείς αυτό το παιχνίδι", "role.guest": "Μπήκες σε αυτό το παιχνίδι",
      "leave": "Έξοδος από το παιχνίδι", "close": "Κλείσιμο", "cancel": "Άκυρο",
      "badge": "Δύο συσκευές", "badge.away": "Επανασύνδεση…",
      "privacy": "Οι κινήσεις πάνε κατευθείαν από τη μία συσκευή στην άλλη ή σφραγισμένες μέσω του relay του orOS. Τίποτα δεν μένει online.",
      "left": "Βγήκες από το παιχνίδι σε δύο συσκευές", "peerLeft": "Ο άλλος παίκτης βγήκε από το παιχνίδι",
      "joined": "Η άλλη συσκευή μπήκε. Καλό παιχνίδι!"
    }
  };

  // A message from the other device: a plain object with a short type.
  function okMsg(m) {
    return !!m && typeof m === "object" && !Array.isArray(m) && typeof m.t === "string" && TYPE_RE.test(m.t);
  }

  var styled = false;
  function addStyle() {
    if (styled || typeof document === "undefined") return;
    styled = true;
    var s = document.createElement("style");
    s.textContent =
      ".rp-pair{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin:10px 0}" +
      ".rp-qr{width:150px;height:150px;border-radius:8px;image-rendering:pixelated;background:#fff}" +
      ".rp-codebox{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 140px}" +
      ".rp-lbl{font-size:12px;font-weight:700;color:var(--text-dim)}" +
      ".rp-code{font-size:30px;font-weight:800;letter-spacing:.08em;color:var(--accent);font-variant-numeric:tabular-nums}" +
      ".rp-url{font-size:11px;color:var(--text-dim);overflow-wrap:anywhere}" +
      ".rp-st{font-size:13px;font-weight:700;margin:8px 0;color:var(--text-dim)}" +
      ".rp-st.ok{color:var(--accent)}" +
      ".rp-in{width:100%;min-height:44px;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);" +
      "font:inherit;font-size:22px;font-weight:800;letter-spacing:.12em;text-align:center}" +
      ".rp-in:focus{outline:none;border-color:var(--accent)}" +
      ".rp-col{display:flex;flex-direction:column;gap:8px;margin-top:10px}" +
      ".rp-badge{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:4px 10px;border-radius:999px;" +
      "border:1px solid var(--accent);background:var(--accent-soft);color:var(--accent);font:inherit;font-size:12px;font-weight:800;white-space:nowrap;cursor:pointer}" +
      ".rp-badge::before{content:'';width:8px;height:8px;border-radius:50%;background:currentColor}" +
      ".rp-badge.away{border-color:var(--danger);color:var(--danger);background:transparent}" +
      "@media (pointer:coarse){.rp-badge{min-height:44px}}";
    document.head.appendChild(s);
  }

  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeJSON(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function spaced(code) { return code.slice(0, 3) + " " + code.slice(3); }

  function create(o) {
    var L = root.OrosRemoteLink;
    var S0 = STR[o.lang === "el" ? "el" : "en"];
    function t(k, p) {
      var s = S0[k] || STR.en[k] || k;
      if (p) Object.keys(p).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
      return s;
    }
    var NS = "oros-" + o.app + "-play", KEY = "oros-" + o.app + "-pair";
    var D = o.dialog;
    var S = { link: null, role: "", code: "", rid: "", kind: "", answer: null, askDev: "", dlg: null, render: null, badge: null, status: "" };

    function live() { return !!(S.link && (S.link.state === "relay" || S.link.state === "direct")); }
    function devName(k) { return t("dev." + (k === "phone" || k === "tablet" ? k : "computer")); }
    function stateText(s) {
      if (s === "direct" || s === "relay" || s === "closed" || s === "nocrypto") return t("s." + s);
      return t("s.connecting");
    }
    function save() {
      writeJSON(KEY, S.role ? { role: S.role, code: S.code, rid: S.rid, kind: S.kind, at: Date.now() } : null);
    }
    function joinUrl(code) {
      var base = "";
      try { base = root.parent.location.origin + root.parent.location.pathname; } catch (e) {}
      if (!base) base = location.origin + "/";
      return base.replace(/\/index\.html$/, "/") + "?open=" + o.app + "#" + o.app + "-play=" + code;
    }
    function drawQr(cv, text) {
      var g = cv.getContext && cv.getContext("2d"), Q = root.orosQR, mods = null;
      if (text && Q && g) { try { mods = Q.encode(text, { ecl: "M" }).modules; } catch (e) { mods = null; } }
      cv.hidden = !mods;
      if (!mods) return;
      var n = mods.length, q = 4, px = Math.max(2, Math.floor(200 / (n + 2 * q)));
      cv.width = cv.height = px * (n + 2 * q);
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = "#000000";
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (mods[y][x]) g.fillRect((x + q) * px, (y + q) * px, px, px);
    }

    // ----- the link -----
    function start(role, code, rid, kind, seen) {
      stop();
      S.role = role; S.code = code; S.rid = rid || ""; S.kind = kind || ""; S.seen = !!seen;
      var common = {
        code: code, relay: L.relayUrl(), ns: NS, label: o.app, dev: L.deviceName(),
        onState: function (s) {
          if (s === "nocrypto") S.status = t("s.nocrypto");
          changed();
        },
        onPeer: function (dev) {
          S.seen = true;
          if (dev) S.kind = dev === "phone" || dev === "tablet" ? dev : "computer";
          save();
          var first = S.dlg && S.dlg.open;
          if (first) { try { S.dlg.close(); } catch (e) {} }
          changed();
          o.onPeer(S.role);
        },
        onGone: changed,
        onApp: function (m) {
          if (!okMsg(m)) return;
          if (m.t === "_bye") { end("peer"); return; }
          o.onMsg(m);
        }
      };
      if (role === "host") {
        common.role = "host";
        common.allow = S.rid;
        common.admit = function (dev, answer) { askAllow(dev, answer); };
        common.onAllow = function (r) { S.rid = r; save(); };
      } else {
        common.role = "remote";
        common.rid = S.rid;
        common.onDeny = function () {
          var keepDlg = S.dlg && S.dlg.open;
          stop();
          S.role = "";
          save();
          if (keepDlg) { S.status = t("s.denied"); renderDlg(); }
          o.onEnd("denied");
        };
      }
      S.link = new L.Link(common);
      if (role === "guest") { S.rid = S.link.rid(); }
      save();
      changed();
    }
    function stop() {
      if (S.answer) { var a = S.answer; S.answer = null; a(false); }
      var link = S.link;
      S.link = null;
      if (link) setTimeout(function () { try { link.close(); } catch (e) {} }, 150);
    }
    function end(why) {
      stop();
      S.role = ""; S.code = ""; S.rid = ""; S.kind = "";
      save();
      if (S.dlg && S.dlg.open) { try { S.dlg.close(); } catch (e) {} }
      changed();
      o.onEnd(why);
    }
    function leave() {
      if (S.link && live()) S.link.send({ t: "_bye" });
      end("left");
    }
    function send(m) { return !!(S.link && live() && S.link.send(m)); }
    function changed() {
      paintBadge();
      renderDlg();
      if (o.onLink) o.onLink();
    }

    // ----- the host lets a device in -----
    function askAllow(dev, answer) {
      if (S.answer) S.answer(false);
      S.askDev = dev;
      S.answer = function (yes) { S.answer = null; answer(yes); renderDlg(); };
      if (!S.dlg || !S.dlg.open) openDlg();
      else renderDlg();
    }

    // ----- the dialog -----
    function openDlg() {
      addStyle();
      var dlg = D.make(o.app + "-rp");
      S.dlg = dlg;
      dlg.appendChild(D.el("div", "dlg-title", t("title")));
      var box = D.el("div", "rp-box");
      dlg.appendChild(box);
      S.render = function () {
        box.textContent = "";
        var s = S.link ? S.link.state : "closed";
        if (S.answer) {
          box.appendChild(D.el("div", "dlg-msg", t("ask", { dev: devName(S.askDev), game: o.game })));
          var acts = D.el("div", "dlg-actions");
          acts.appendChild(D.button(t("deny"), "", function () { if (S.answer) S.answer(false); }));
          var yes = D.button(t("allow"), "primary", function () { if (S.answer) S.answer(true); });
          acts.appendChild(yes);
          box.appendChild(acts);
          setTimeout(function () { try { yes.focus(); } catch (e) {} }, 0);
          return;
        }
        if (!S.role) {
          box.appendChild(D.el("div", "dlg-msg", t("intro")));
          if (S.status) box.appendChild(D.el("div", "rp-st", S.status));
          var col = D.el("div", "rp-col");
          col.appendChild(D.button(t("host"), "primary", function () { S.status = ""; start("host", L.newCode(), "", ""); }));
          col.appendChild(D.button(t("join"), "", function () { S.status = ""; S.joining = true; renderDlg(); }));
          if (S.joining) {
            col.textContent = "";
            var inp = D.el("input", "rp-in");
            inp.type = "text"; inp.inputMode = "numeric"; inp.autocomplete = "off"; inp.maxLength = 7;
            inp.placeholder = "000 000";
            inp.setAttribute("aria-label", t("code"));
            col.appendChild(D.el("span", "rp-lbl", t("code")));
            col.appendChild(inp);
            var go = D.button(t("connect"), "primary", function () { joinCode(inp.value); });
            inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); joinCode(inp.value); } });
            col.appendChild(go);
            setTimeout(function () { try { inp.focus(); } catch (e) {} }, 0);
          }
          box.appendChild(col);
          box.appendChild(D.el("div", "dlg-foot", t("privacy")));
        } else if (S.role === "host" && !S.seen) {
          box.appendChild(D.el("div", "dlg-msg", t("how", { game: o.game })));
          var pair = D.el("div", "rp-pair");
          var cv = D.el("canvas", "rp-qr");
          cv.setAttribute("aria-hidden", "true");
          pair.appendChild(cv);
          var side = D.el("div", "rp-codebox");
          side.appendChild(D.el("span", "rp-lbl", t("code")));
          side.appendChild(D.el("span", "rp-code", spaced(S.code)));
          side.appendChild(D.el("span", "rp-url", joinUrl(S.code)));
          pair.appendChild(side);
          box.appendChild(pair);
          drawQr(cv, joinUrl(S.code));
          box.appendChild(D.el("div", "rp-st", s === "waiting" ? t("waiting", { code: spaced(S.code) }) : stateText(s)));
        } else {
          box.appendChild(D.el("div", "dlg-msg", t(S.role === "host" ? "role.host" : "role.guest") +
            (S.kind ? " · " + devName(S.kind) : "")));
          var stx = live() ? stateText(s) : S.seen ? t("s.away") :
            s === "pending" ? t("s.pending") : s === "waiting" ? t("s.waitHost") : stateText(s);
          box.appendChild(D.el("div", "rp-st" + (live() ? " ok" : ""), S.status || stx));
        }
        var act = D.el("div", "dlg-actions");
        if (S.role) act.appendChild(D.button(t("leave"), "danger", function () { leave(); }));
        act.appendChild(D.button(t(S.role ? "close" : "cancel"), "", function () { dlg.close(); }));
        box.appendChild(act);
      };
      dlg.addEventListener("close", function onClose() {
        dlg.removeEventListener("close", onClose);
        if (S.answer) S.answer(false);            // closing while a device asks means no
        S.render = null; S.joining = false;
        if (S.dlg === dlg) S.dlg = null;
        // a code nobody used (or a join nobody answered) goes with the dialog
        if (S.role && !S.seen) { stop(); S.role = ""; save(); changed(); }
      });
      document.body.appendChild(dlg);
      dlg.showModal();
      S.render();
    }
    function renderDlg() { if (S.render && S.dlg && S.dlg.open) S.render(); }
    function joinCode(v) {
      var code = String(v || "").replace(/\D/g, "");
      if (!L.CODE_RE.test(code)) { S.status = t("s.bad"); renderDlg(); return; }
      S.status = "";
      start("guest", code, "", "");
    }

    // ----- the badge in the toolbar -----
    function badge() {
      if (S.badge) return S.badge;
      addStyle();
      var b = document.createElement("button");
      b.type = "button";
      b.className = "rp-badge";
      b.hidden = true;
      b.addEventListener("click", function () { openDlg(); });
      S.badge = b;
      paintBadge();
      return b;
    }
    function paintBadge() {
      var b = S.badge;
      if (!b) return;
      b.hidden = !S.role || !S.seen;
      var on = live();
      b.textContent = on ? t("badge") : t("badge.away");
      b.classList.toggle("away", !on);
      b.title = t("title");
    }

    // ----- boot: the pairing before a reload, or a scanned QR -----
    function boot() {
      var now = Date.now(), code = "";
      try {
        var hs = root.parent.location.hash || "", re = new RegExp("^#" + o.app + "-play=([0-9]{6})$"), mm = hs.match(re);
        if (mm) {
          code = mm[1];
          root.parent.history.replaceState(null, "", root.parent.location.pathname + root.parent.location.search);
        }
      } catch (e) {}
      var p = readJSON(KEY);
      if (code) {
        writeJSON(KEY, null);
        openDlg();
        start("guest", code, "", "");
        return;
      }
      if (p && (p.role === "host" || p.role === "guest") && typeof p.code === "string" && L.CODE_RE.test(p.code) &&
          typeof p.rid === "string" && RID_RE.test(p.rid) && p.at > now - KEEP_MS) {
        start(p.role, p.code, p.rid, p.kind, true);
      } else writeJSON(KEY, null);
    }
    // the "last contact" stamp stays fresh while the devices talk
    setInterval(function () { if (S.role && live()) save(); }, 60000);

    return {
      open: openDlg, send: send, leave: leave, boot: boot, badge: badge,
      role: function () { return S.role && S.seen ? S.role : ""; },
      active: function () { return !!S.role && !!S.seen; },
      live: live, t: t
    };
  }

  root.OrosRemotePlay = { create: create, okMsg: okMsg, STR: STR };
})(typeof window !== "undefined" ? window : this);
