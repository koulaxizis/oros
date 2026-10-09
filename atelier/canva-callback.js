// orOS Atelier — Canva sign-in comes back here (canva-callback.html).
// Hands the one-time code to the Atelier window that asked for it
// (same origin: BroadcastChannel, with localStorage as a fallback),
// removes it from the address bar and closes. The code is useless
// without the PKCE verifier, which only that Atelier window holds.
(function () {
  "use strict";
  var q = new URLSearchParams(location.search);
  var msg = { state: (q.get("state") || "").slice(0, 200) };
  if (q.get("code")) msg.code = q.get("code").slice(0, 2000);
  else msg.error = (q.get("error") || "denied").slice(0, 100);
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  try { var ch = new BroadcastChannel("oros-atelier-canva"); ch.postMessage(msg); ch.close(); } catch (e) {}
  try { localStorage.setItem("oros-atelier-canva-cb", JSON.stringify(msg)); } catch (e) {}
  setTimeout(function () { try { localStorage.removeItem("oros-atelier-canva-cb"); } catch (e) {} try { window.close(); } catch (e) {} }, 1500);
})();
