/* PW-AF7: the list inside a page's form (inline.html). This page is the
   add-on's own origin, so the web page around it cannot read it. It gets
   the names of the entries that fit from background.js with the token
   in its address (#…), shows them with textContent only, and on a click
   asks background.js to fill the one picked. Values never come here.
   Clickjacking guard (with inline.js): where the browser has
   IntersectionObserver v2, a pick counts only after the list has been
   fully visible, with nothing drawn over it, for 500 ms. */
"use strict";
(function () {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const msg = (k, subs) => api.i18n.getMessage(k, subs) || k;
  const token = location.hash.slice(1);
  const $ = (id) => document.getElementById(id);
  document.documentElement.lang = api.i18n.getUILanguage().slice(0, 2);
  document.querySelectorAll("[data-i18n]").forEach((el) => { const s = api.i18n.getMessage(el.getAttribute("data-i18n")); if (s) el.textContent = s; });

  /* visibility: null = the browser cannot tell (inline.js still checks) */
  let visibleSince = null, canTell = false;
  try {
    const io = new IntersectionObserver((list) => {
      const e = list[list.length - 1];
      if (!("isVisible" in e)) return;
      canTell = true;
      if (e.isVisible) { if (visibleSince == null) visibleSince = Date.now(); }
      else visibleSince = null;
    }, { threshold: [1.0], trackVisibility: true, delay: 100 });
    io.observe(document.body);
  } catch (e) { /* no IntersectionObserver v2 */ }
  const seen = () => !canTell || (visibleSince != null && Date.now() - visibleSince >= 500);

  const send = (m) => api.runtime.sendMessage(Object.assign({ token: token }, m)).catch(() => null);
  const done = (refocus) => send({ t: "ii-done", refocus: !!refocus });

  let busy = false;
  async function pick(id) {
    if (busy) return;
    if (!seen()) return;            // not (long enough) on screen: ignore the click
    busy = true;
    await send({ t: "ii-fill", id: id });
    busy = false;
  }

  function render(r) {
    const ul = $("list");
    ul.textContent = "";
    if (!r || !r.ok) { done(false); return; }
    if (r.locked) {
      ul.hidden = true;
      $("locked").hidden = false;
      $("unlock").onclick = async () => {
        if (!seen()) return;
        const a = await send({ t: "ii-unlock" });
        if (!a || !a.ok) $("lockedHint").hidden = false;
      };
      return;
    }
    (r.rows || []).forEach((x) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "option");
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = (x.fav ? "★ " : "") + (x.title || x.sub || "—");
      b.appendChild(t);
      if (x.sub) { const s = document.createElement("span"); s.className = "s"; s.textContent = x.sub; b.appendChild(s); }
      b.addEventListener("click", (ev) => { if (ev.isTrusted) pick(x.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    if (!ul.children.length) done(false);
  }

  /* keyboard: arrows move, Escape goes back to the field */
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); done(true); return; }
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const bs = Array.from(document.querySelectorAll("button:not([hidden])")).filter((b) => b.offsetParent);
    if (!bs.length) return;
    ev.preventDefault();
    const i = bs.indexOf(document.activeElement);
    if (ev.key === "ArrowUp" && i <= 0) { done(true); return; }
    bs[Math.max(0, Math.min(bs.length - 1, i < 0 ? 0 : i + (ev.key === "ArrowDown" ? 1 : -1)))].focus();
  });
  /* the parent focuses this frame on ArrowDown: put focus on the first entry */
  window.addEventListener("focus", () => {
    if (document.activeElement === document.body) { const b = document.querySelector("button:not([hidden])"); if (b && b.offsetParent) b.focus(); }
  });

  if (!/^[0-9a-f]{32}$/.test(token)) return;
  send({ t: "ii-list" }).then(render);
})();
