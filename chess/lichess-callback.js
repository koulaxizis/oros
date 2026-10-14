// orOS Chess — Lichess sign-in callback (chess/lichess-callback.html).
// Lichess redirects here with ?code&state (or ?error). This page only
// passes them on, same origin: BroadcastChannel to an open Chess, and
// localStorage "oros-chess-lichess-cb" for a Chess that opens later
// (redirect mode). Chess checks the state against its own PKCE record
// and does the token exchange; nothing here talks to the network.
(function () {
  "use strict";
  var el = (localStorage.getItem("oros-lang") === "el");
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
    msg.textContent = el ? "Μη έγκυρη απάντηση από το Lichess." : "Invalid answer from Lichess.";
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
    msg.textContent = ok
      ? (el ? "Έτοιμο. Μπορείς να κλείσεις αυτό το παράθυρο." : "Done. You can close this window.")
      : (el ? "Η σύνδεση ακυρώθηκε. Μπορείς να κλείσεις αυτό το παράθυρο." : "Sign-in cancelled. You can close this window.");
    setTimeout(function () { try { window.close(); } catch (e) {} }, 400);
  } else {
    msg.textContent = el ? "Επιστροφή στο Σκάκι…" : "Back to Chess…";
    location.replace("../?open=chess");
  }
})();
