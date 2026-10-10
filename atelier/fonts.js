// ============================================================
// orOS Atelier — Fonts (v1.0.0): the font panel
// Atelier's own families (Sans, Serif, Mono, always offline) plus
// any Fontsource family (open licences, mostly SIL OFL), with
// Greek-capable ones first. A family is stored in the design as
// "fs_<id>" (atelier/ax.js) and fetched on demand as TTF subset
// files (designkit/media.js fontsourceUrls → designkit/text.js).
//   - files are kept in the browser's Cache Storage on this device,
//     so a font works offline after its first use here; another
//     device fetches it when it opens the design (until then, and
//     whenever it cannot, the text shows in Sans)
//   - "Your fonts" (recently used) stays on this device (prefs)
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, T = AT.T, AX = AT.AX, t = AT.t, el = AT.el, ED = AT.ed;
  var MEDIA = window.orosDK && window.orosDK.media;
  var CACHE = "oros-atelier-fonts";
  var MAX_FILE = 5e6, RECENT_MAX = 24;
  var BUILTIN = ["sans", "serif", "mono"];

  // ---------- files: cache first, then the network ----------
  function cached(url) {
    if (typeof caches === "undefined") return Promise.resolve(null);
    return caches.open(CACHE).then(function (c) { return c.match(url); }, function () { return null; });
  }
  function keep(url, res) {
    if (typeof caches === "undefined") return;
    caches.open(CACHE).then(function (c) { return c.put(url, res); }).then(null, function () {});
  }
  T.setFetcher(function (url) {
    return cached(url).then(function (hit) {
      if (hit) return hit.status === 204 ? null : hit.arrayBuffer();
      return fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", mode: "cors" }).then(function (r) {
        if (r.status === 404 || r.status === 403) {          // no such subset / weight: remember
          keep(url, new Response(null, { status: 204 }));
          return null;
        }
        if (!r.ok) throw new Error("font " + r.status);
        return r.arrayBuffer().then(function (ab) {
          if (ab.byteLength > MAX_FILE) throw new Error("font size");
          keep(url, new Response(ab, { headers: { "Content-Type": "font/ttf" } }));
          return ab;
        });
      });
    });
  });

  // ---------- recent fonts (this device) ----------
  function recent() {
    var l = Array.isArray(AT.prefs.fonts) ? AT.prefs.fonts : [];
    return l.filter(function (f) { return f && AX.isExtraFont(f.id); });
  }
  function remember(id, name) {
    if (!AX.isExtraFont(id)) return;
    var l = recent().filter(function (f) { return f.id !== id; });
    l.unshift({ id: id, name: String(name || AX.fontName(id)).slice(0, 60) });
    AT.prefs.fonts = l.slice(0, RECENT_MAX);
    AT.savePrefs();
  }

  // ---------- applying ----------
  function textSel() { return ED.selItems().filter(function (it) { return it.ax.k === "text" && !it.lock; }); }
  function keysFor(id, items) {
    var keys = {};
    items.forEach(function (it) {
      var k = T.fontKey(id, it.ax.b, it.ax.i);
      keys[k] = 1; keys["sans-" + k.split("-")[1]] = 1;
    });
    return Object.keys(keys);
  }
  var busy = "";
  function apply(id, name) {
    var list = textSel();
    if (!list.length) { AT.toast(t("fn.pick")); return; }
    AX.ensureFont(id, name);
    var keys = keysFor(id, list);
    var extra = AX.isExtraFont(id);
    if (extra && !keys.every(T.isLoaded)) {
      if (navigator.onLine === false) { AT.toast(t("fn.offline")); return; }
      busy = id; AT.renderDrawer();
      AT.toast(t("fn.loading"));
    }
    T.load(keys).then(function () {
      busy = "";
      var mine = keys.filter(function (k) { return k.split("-")[0] === id; });
      if (extra && !mine.every(T.isLoaded)) { AT.toast(t("fn.fail")); AT.renderDrawer(); return; }
      AT.editItems(list.map(function (it) { return it.id; }), function (it) { it.ax.font = id; });
      if (extra) remember(id, name);
      AT.emit("fonts");
      AT.renderDrawer();
    }, function () { busy = ""; AT.toast(t("fn.fail")); AT.renderDrawer(); });
  }

  // ---------- catalog search (Fontsource, online) ----------
  var st = { q: "", greek: AT.LANG === "el", items: [], more: false, page: 1, busy: false, error: "", seq: 0 };
  var mem = {};
  var memCache = { get: function (k) { return Promise.resolve(mem[k] || null); }, put: function (k, v) { mem[k] = v; return Promise.resolve(); } };
  function search(more) {
    if (!MEDIA) return;
    var my = ++st.seq;
    st.busy = true; st.error = "";
    if (!more) { st.page = 1; st.items = []; }
    AT.renderDrawer();
    var env = { fetch: window.fetch.bind(window), now: function () { return Date.now(); }, cache: memCache, keys: {} };
    MEDIA.search("fontsource", "font", st.q, { page: st.page, greek: st.greek, lang: AT.LANG }, env).then(function (res) {
      if (my !== st.seq) return;
      st.busy = false;
      st.error = res.error || "";
      st.items = st.items.concat(res.items || []);
      st.more = !!res.more;
      AT.renderDrawer();
    });
  }

  // ---------- panel ----------
  function btn(cls, label, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function row(id, name, cur, badge) {
    var b = btn("fn-row" + (cur === id ? " on" : "") + (busy === id ? " busy" : ""), "", function () { if (cur !== id) apply(id, name); });
    var n = el("span", "fn-name", name);
    // shown in its own face once this device has it
    var k = T.fontKey(id, 0, 0);
    if (T.FAMILIES[id] && T.isLoaded(k)) n.style.fontFamily = T.cssStack(k) + ", sans-serif";
    b.appendChild(n);
    if (badge) b.appendChild(el("span", "fn-badge", badge));
    if (busy === id) b.appendChild(el("span", "fn-badge", "…"));
    b.setAttribute("aria-pressed", cur === id ? "true" : "false");
    return b;
  }
  function sec(title) {
    var s = el("div", "pn-sec");
    if (title) s.appendChild(el("div", "pn-h", title));
    return s;
  }

  function view(body) {
    var list = textSel();
    var cur = list.length ? list[0].ax.font || "sans" : "";
    if (!list.length) body.appendChild(el("p", "hint", t("fn.pick")));

    // in this design + built in + yours
    var used = {};
    (AT.doc ? AT.doc.items : []).forEach(function (it) { if (it.ax && it.ax.k === "text" && AX.isExtraFont(it.ax.font)) used[it.ax.font] = 1; });
    var s1 = sec(t("fn.mine"));
    var shown = {};
    BUILTIN.forEach(function (id) { shown[id] = 1; s1.appendChild(row(id, T.FAMILIES[id].name, cur, t("fn.offlineOk"))); });
    Object.keys(used).forEach(function (id) { if (!shown[id]) { shown[id] = 1; s1.appendChild(row(id, AX.fontName(id), cur, t("fn.inDesign"))); } });
    recent().forEach(function (f) { if (!shown[f.id]) { shown[f.id] = 1; s1.appendChild(row(f.id, f.name, cur, "")); } });
    body.appendChild(s1);

    // catalog
    var s2 = sec(t("fn.more"));
    if (!MEDIA) { s2.appendChild(el("p", "hint", t("fn.fail"))); body.appendChild(s2); return; }
    var form = el("form", "src-form");
    var q = el("input", "inp sm");
    q.type = "search"; q.placeholder = t("fn.search"); q.setAttribute("aria-label", t("fn.search"));
    q.value = st.q; q.maxLength = 60;
    form.appendChild(q);
    var go = btn("btn small primary", t("src.go")); go.type = "submit";
    form.appendChild(go);
    form.addEventListener("submit", function (e) { e.preventDefault(); st.q = q.value.trim().slice(0, 60); search(false); });
    s2.appendChild(form);
    var lim = el("label", "chk-row");
    var cb = el("input"); cb.type = "checkbox"; cb.checked = st.greek;
    cb.addEventListener("change", function () { st.greek = cb.checked; search(false); });
    lim.appendChild(cb); lim.appendChild(el("span", "", t("fn.greek")));
    s2.appendChild(lim);
    if (navigator.onLine === false) s2.appendChild(el("p", "hint", t("src.offline")));
    if (st.error) s2.appendChild(el("p", "hint warn", t("fn.fail")));
    st.items.forEach(function (it) {
      var id = AX.fsIdOf(String(it.id || "").replace(/^fontsource:/, ""));
      if (!AX.isExtraFont(id)) return;
      s2.appendChild(row(id, it.family || it.title, cur, it.greek ? t("fn.hasGreek") : ""));
    });
    if (st.busy) s2.appendChild(el("p", "hint", t("src.searching")));
    else if (st.more) s2.appendChild(btn("btn small block", t("src.more"), function () { st.page++; search(true); }));
    else if (!st.items.length) s2.appendChild(btn("btn small block", t("fn.browse"), function () { search(false); }));
    s2.appendChild(el("p", "hint", t("fn.hint")));
    body.appendChild(s2);
  }
  AT.registerView("fonts", view);

  AT.fonts = { apply: apply, name: function (id) { return AX.fontName(id || "sans"); } };
})();
