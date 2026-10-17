// orOS Chess — Lichess sign-in callback (chess/lichess-callback.html).
// Lichess redirects here with ?code&state (or ?error). This page only
// passes them on, same origin: BroadcastChannel to an open Chess, and
// localStorage "oros-chess-lichess-cb" for a Chess that opens later
// (redirect mode). Chess checks the state against its own PKCE record
// and does the token exchange; nothing here talks to the network.
(function () {
  "use strict";
  // orosI18n (../i18n.js, data-app="chess"): the full language code,
  // a pack language included; its keys live in the "chess" pack.
  var LANG = "en";
  try { LANG = window.orosI18n ? window.orosI18n.lang() : (localStorage.getItem("oros-lang") === "el" ? "el" : "en"); } catch (e) {}
  var STRINGS = {
    en: {
      "cb.invalid": "Invalid answer from Lichess.",
      "cb.done": "Done. You can close this window.",
      "cb.cancel": "Sign-in cancelled. You can close this window.",
      "cb.back": "Back to Chess…"
    },
    el: {
      "cb.invalid": "Μη έγκυρη απάντηση από το Lichess.",
      "cb.done": "Έτοιμο. Μπορείς να κλείσεις αυτό το παράθυρο.",
      "cb.cancel": "Η σύνδεση ακυρώθηκε. Μπορείς να κλείσεις αυτό το παράθυρο.",
      "cb.back": "Επιστροφή στο Σκάκι…"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "chess", LANG);
  function t(k) { var p = STRINGS[LANG] || STRINGS.en; return p[k] || STRINGS.en[k]; }
  var msg = document.getElementById("msg");
  var q = new URLSearchParams(location.search);
  var cb = {
    code: (q.get("code") || "").slice(0, 512),
    error: (q.get("error") || "").slice(0, 64),
    state: (q.get("state") || "").slice(0, 128),
    t: Date.now()
  };
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  if (!cb.state) {
    msg.textContent = t("cb.invalid");
    return;
  }
  // The mode Chess stored with its PKCE record decides: a popup closes,
  // a whole-tab redirect goes back to orOS. Read it BEFORE posting,
  // because an open Chess deletes the record at once.
  var mode = "popup";
  try { mode = (JSON.parse(localStorage.getItem("oros-chess-lichess-pkce") || "{}") || {}).mode || "popup"; } catch (e) {}
  try { localStorage.setItem("oros-chess-lichess-cb", JSON.stringify(cb)); } catch (e) {}
  try { new BroadcastChannel("oros-chess-lichess").postMessage(cb); } catch (e) {}

  var ok = !cb.error && cb.code;
  if (mode !== "redirect") {
    msg.textContent = ok ? t("cb.done") : t("cb.cancel");
    setTimeout(function () { try { window.close(); } catch (e) {} }, 400);
  } else {
    msg.textContent = t("cb.back");
    location.replace("../?open=chess");
  }
})();
