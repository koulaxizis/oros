// orOS — account sign-in callback (contacts/oauth-callback.html), for
// Contacts (accounts.js) and every one-time Google import
// (google-import.js: Calendar, To-Do, Feeds, Shelf): the one redirect
// address registered with Google.
// Google answers with #access_token&state (token flow), Microsoft with
// ?code&state (PKCE code flow), either may answer ?error / #error.
// This page only passes the answer on, same origin: BroadcastChannel
// to the open app, plus a localStorage record the app reads and
// deletes at once (the channel can be missed). The app checks the
// state against its own and does the rest; nothing here talks to the
// network, and the address bar is cleared first.
(function () {
  "use strict";
  var LANG = window.orosI18n ? window.orosI18n.lang() : (localStorage.getItem("oros-lang") === "el" ? "el" : "en");
  var T = {
    en: {
      "oauthcb.title": "Sign-in · orOS",
      "oauthcb.invalid": "Invalid sign-in answer.",
      "oauthcb.done": "Done. orOS is reading your data now. You can close this window.",
      "oauthcb.cancelled": "Sign-in cancelled. You can close this window."
    },
    el: {
      "oauthcb.title": "Σύνδεση · orOS",
      "oauthcb.invalid": "Μη έγκυρη απάντηση σύνδεσης.",
      "oauthcb.done": "Έτοιμο. Το orOS διαβάζει τώρα τα δεδομένα σου. Μπορείς να κλείσεις αυτό το παράθυρο.",
      "oauthcb.cancelled": "Η σύνδεση ακυρώθηκε. Μπορείς να κλείσεις αυτό το παράθυρο."
    }
  };
  if (window.orosI18n) window.orosI18n.table(T, "contacts", LANG);
  function t(k) { return (T[LANG] || T.en)[k] || T.en[k]; }
  var msg = document.getElementById("msg");
  document.title = t("oauthcb.title");
  var q = new URLSearchParams(location.search);
  var h = new URLSearchParams(location.hash.replace(/^#/, ""));
  function get(k) { return h.get(k) || q.get(k) || ""; }
  var cb = {
    token: get("access_token").slice(0, 4096),
    code: get("code").slice(0, 4096),
    error: get("error").slice(0, 64),
    state: get("state").slice(0, 128),
    t: Date.now()
  };
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  if (!cb.state) {
    msg.textContent = t("oauthcb.invalid");
    return;
  }
  try { localStorage.setItem("oros-contacts-oauth-cb", JSON.stringify(cb)); } catch (e) {}
  try { new BroadcastChannel("oros-contacts-oauth").postMessage(cb); } catch (e) {}
  var ok = !cb.error && (cb.token || cb.code);
  msg.textContent = ok ? t("oauthcb.done") : t("oauthcb.cancelled");
  setTimeout(function () { try { window.close(); } catch (e) {} }, 400);
})();
