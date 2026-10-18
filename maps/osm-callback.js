// orOS Maps — OSM sign-in callback (maps/osm-callback.html).
// OSM redirects here with ?code&state (or ?error). This page only
// passes them on, same origin: BroadcastChannel to an open Maps, and
// localStorage "oros-maps-osm-cb" for a Maps that opens later
// (redirect mode). Maps checks the state against its own PKCE record
// and does the token exchange; nothing here talks to the network.
(function () {
  "use strict";
  var LANG = window.orosI18n ? window.orosI18n.lang() : (localStorage.getItem("oros-lang") === "el" ? "el" : "en");
  var STR = {
    en: {
      "cb.bad": "Invalid answer from OpenStreetMap.",
      "cb.done": "Done. You can close this window.",
      "cb.cancel": "Sign-in cancelled. You can close this window.",
      "cb.back": "Back to Maps…"
    },
    el: {
      "cb.bad": "Μη έγκυρη απάντηση από το OpenStreetMap.",
      "cb.done": "Έτοιμο. Μπορείς να κλείσεις αυτό το παράθυρο.",
      "cb.cancel": "Η σύνδεση ακυρώθηκε. Μπορείς να κλείσεις αυτό το παράθυρο.",
      "cb.back": "Επιστροφή στους Χάρτες…"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STR, "maps", LANG);
  function t(k) { return (STR[LANG] && STR[LANG][k]) || STR.en[k]; }
  document.documentElement.lang = LANG;
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
    msg.textContent = t("cb.bad");
    return;
  }
  // The popup can lose window.opener (OSM's cross-origin isolation),
  // so the mode Maps stored with its PKCE record decides: a popup
  // closes, a whole-tab redirect goes back to orOS. Read it BEFORE
  // posting, because an open Maps deletes the record at once.
  var mode = "popup";
  try { mode = (JSON.parse(localStorage.getItem("oros-maps-osm-pkce") || "{}") || {}).mode || "popup"; } catch (e) {}
  try { localStorage.setItem("oros-maps-osm-cb", JSON.stringify(cb)); } catch (e) {}
  try { new BroadcastChannel("oros-maps-osm").postMessage(cb); } catch (e) {}

  var ok = !cb.error && cb.code;
  if (mode !== "redirect") {
    msg.textContent = ok ? t("cb.done") : t("cb.cancel");
    setTimeout(function () { try { window.close(); } catch (e) {} }, 400);
  } else {
    msg.textContent = t("cb.back");
    location.replace("../?open=maps");
  }
})();
