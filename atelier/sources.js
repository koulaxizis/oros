// ============================================================
// orOS Atelier — Sources (v1.0.0): open media in the rail
// Photos, illustrations and icons / clipart from open libraries
// (designkit/media.js): Openverse, Wikimedia Commons, Iconify, and
// Pixabay / Pexels with the user's own key. A result is downloaded
// once (no cookies, no referrer, type and size checked, SVG
// sanitized), stored like an upload (designkit/assets.js, synced
// through Vault Drive) and placed with its credit (ax.cr), so the
// design works offline afterwards and Credits lists it.
//   - keys stay on this device (prefs, R10), never synced
//   - by default only results that allow commercial use and edits;
//     "Show licences with limits" adds the rest, labelled
//   - search results are cached in memory for the session
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, A = AT.A, t = AT.t, el = AT.el, ED = AT.ed;
  var MEDIA = window.orosDK && window.orosDK.media;
  var KINDS = ["photo", "illus", "icon"];
  var DEFAULT_SRC = { photo: "openverse", illus: "openverse", icon: "iconify" };

  var st = { kind: "photo", src: "", q: "", restricted: false, page: 1, items: [], more: false, busy: false, error: "", seq: 0, keysOpen: false };
  var mem = {};
  var cache = {
    get: function (k) { return Promise.resolve(mem[k] || null); },
    put: function (k, v) { mem[k] = v; return Promise.resolve(); }
  };

  function keys() { return AT.prefs.keys || {}; }
  function env() {
    return { fetch: window.fetch.bind(window), now: function () { return Date.now(); }, cache: cache, keys: keys() };
  }
  function sources() { return MEDIA ? MEDIA.sourcesFor(st.kind, keys()) : []; }
  function curSrc() {
    var list = sources();
    if (list.indexOf(st.src) < 0) st.src = list.indexOf(DEFAULT_SRC[st.kind]) >= 0 ? DEFAULT_SRC[st.kind] : list[0] || "";
    return st.src;
  }

  function btn(cls, label, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }

  function run(more) {
    var src = curSrc();
    if (!st.q || !src || !MEDIA) return;
    var my = ++st.seq;
    st.busy = true; st.error = "";
    if (!more) { st.page = 1; st.items = []; st.more = false; }
    AT.renderDrawer();
    MEDIA.search(src, st.kind, st.q, { page: st.page, restricted: st.restricted, lang: AT.LANG }, env()).then(function (res) {
      if (my !== st.seq) return;
      st.busy = false;
      st.error = res.error || "";
      st.items = st.items.concat(res.items || []);
      st.more = !!res.more;
      AT.renderDrawer();
    });
  }

  function licLabel(it) {
    var L = MEDIA.licenseOf(it.lic, it.licVer);
    return L ? L.label : "";
  }

  // download → asset → photo with its credit
  function place(it) {
    if (!navigator.onLine) { AT.toast(t("src.offline")); return; }
    AT.toast(t("src.getting"));
    var E = env();
    var get = MEDIA.fetchMedia(it, E).then(null, function (e) {
      // a provider's full file may refuse CORS: the thumbnail is the fallback
      if (it.thumb && it.thumb !== it.full && e && e.message === "offline") return MEDIA.fetchMedia(it, E, it.thumb);
      throw e;
    });
    get.then(function (blob) {
      var ext = blob.type === "image/svg+xml" ? ".svg" : blob.type === "image/png" ? ".png" : ".jpg";
      return A.importFile(new File([blob], (it.title || it.src).slice(0, 60) + ext, { type: blob.type }));
    }).then(function (res) {
      AT.noteUpload(res.id);
      var s = AT.doc.setup;
      var k = Math.min(s.w * 0.6 / res.w, s.h * 0.6 / res.h);
      if (it.kind === "icon") k = Math.min(s.w, s.h) * 0.25 / Math.max(res.w, res.h);
      ED.add({ k: "photo", a: res.id, iw: res.w, ih: res.h, nm: "", w: res.w * k, h: res.h * k, fit: "fill", cr: MEDIA.normCredit(it) });
      AT.toast(t("src.added"));
    }, function (e) {
      var m = e && e.message;
      AT.toast(m === "nofs" ? t("img.nofs") : m === "size" ? t("src.tooBig") : m === "offline" ? t("src.offline") : t("src.fail"));
    });
  }

  function keysSection(body) {
    var s = el("div", "pn-sec");
    var head = btn("src-keys-toggle", t("src.keys"), function () { st.keysOpen = !st.keysOpen; AT.renderDrawer(); });
    head.setAttribute("aria-expanded", st.keysOpen ? "true" : "false");
    s.appendChild(head);
    if (st.keysOpen) {
      s.appendChild(el("p", "hint", t("src.keysHint")));
      ["pixabay", "pexels"].forEach(function (id) {
        var row = el("label", "src-key");
        row.appendChild(el("span", "", MEDIA.SOURCES[id].name));
        var inp = el("input", "inp sm");
        inp.type = "password"; inp.autocomplete = "off"; inp.spellcheck = false;
        inp.value = keys()[id] || "";
        inp.setAttribute("aria-label", MEDIA.SOURCES[id].name);
        inp.addEventListener("change", function () {
          var v = inp.value.trim().slice(0, 120);
          var k = {}; Object.keys(keys()).forEach(function (x) { k[x] = keys()[x]; });
          if (v && /^[A-Za-z0-9_-]+$/.test(v)) k[id] = v; else delete k[id];
          AT.prefs.keys = k; AT.savePrefs();
          AT.renderDrawer();
        });
        row.appendChild(inp);
        var a = el("a", "src-link", t("src.getKey"));
        a.href = MEDIA.SOURCES[id].home; a.target = "_blank"; a.rel = "noopener noreferrer";
        row.appendChild(a);
        s.appendChild(row);
      });
    }
    body.appendChild(s);
  }

  function view(body) {
    if (!MEDIA) { body.appendChild(el("p", "hint", t("src.fail"))); return; }
    var s = el("div", "pn-sec");
    var kinds = el("div", "chips");
    KINDS.forEach(function (k) {
      kinds.appendChild(btn("chip-btn" + (st.kind === k ? " on" : ""), t("src.k." + k), function () {
        if (st.kind === k) return;
        st.kind = k; st.items = []; st.more = false; st.error = "";
        if (st.q) run(false); else AT.renderDrawer();
      }));
    });
    s.appendChild(kinds);

    var form = el("form", "src-form");
    var q = el("input", "inp sm");
    q.type = "search"; q.placeholder = t("src.search"); q.setAttribute("aria-label", t("src.search"));
    q.value = st.q; q.enterKeyHint = "search";
    form.appendChild(q);
    var go = btn("btn small primary", t("src.go"));
    go.type = "submit";
    form.appendChild(go);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      st.q = q.value.replace(/\s+/g, " ").trim().slice(0, 120);
      if (st.q) run(false);
    });
    s.appendChild(form);

    var srcs = el("div", "chips");
    var cur = curSrc();
    sources().forEach(function (id) {
      srcs.appendChild(btn("chip-btn" + (cur === id ? " on" : ""), MEDIA.SOURCES[id].name, function () {
        if (st.src === id) return;
        st.src = id; st.items = []; st.more = false; st.error = "";
        if (st.q) run(false); else AT.renderDrawer();
      }));
    });
    s.appendChild(srcs);

    var lim = el("label", "chk-row");
    var cb = el("input");
    cb.type = "checkbox"; cb.checked = st.restricted;
    cb.addEventListener("change", function () { st.restricted = cb.checked; if (st.q) run(false); });
    lim.appendChild(cb);
    lim.appendChild(el("span", "", t("src.restricted")));
    s.appendChild(lim);
    body.appendChild(s);

    var r = el("div", "pn-sec");
    if (!navigator.onLine) r.appendChild(el("p", "hint", t("src.offline")));
    if (st.error) r.appendChild(el("p", "hint warn", t("src.err." + (["offline", "rate", "key", "server"].indexOf(st.error) >= 0 ? st.error : "server"))));
    if (!st.q) r.appendChild(el("p", "hint", t("src.intro")));
    else if (!st.busy && !st.items.length && !st.error) r.appendChild(el("p", "hint", t("src.none")));
    var grid = el("div", "src-grid" + (st.kind === "icon" ? " icons" : ""));
    st.items.forEach(function (it) {
      var b = el("button", "src-tile");
      b.type = "button";
      var lab = (it.title || t("src.untitled")) + (it.author ? " · " + it.author : "") + " · " + licLabel(it);
      b.title = lab; b.setAttribute("aria-label", lab);
      var img = el("img");
      img.alt = ""; img.loading = "lazy"; img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.src = it.thumb;
      b.appendChild(img);
      if (!MEDIA.allowed(it, { restricted: false })) b.appendChild(el("span", "src-badge", t("src.limited")));
      b.addEventListener("click", function () { place(it); });
      grid.appendChild(b);
    });
    r.appendChild(grid);
    if (st.busy) r.appendChild(el("p", "hint", t("src.searching")));
    else if (st.more) r.appendChild(btn("btn small block", t("src.more"), function () { st.page++; run(true); }));
    if (st.items.length && cur) {
      var by = el("p", "hint src-by");
      var a = el("a", "src-link", MEDIA.SOURCES[cur].name);
      a.href = MEDIA.SOURCES[cur].home; a.target = "_blank"; a.rel = "noopener noreferrer";
      by.appendChild(document.createTextNode(t("src.from") + " "));
      by.appendChild(a);
      r.appendChild(by);
    }
    r.appendChild(el("p", "hint", t("src.creditHint")));
    body.appendChild(r);
    keysSection(body);
    if (!st.q && window.innerWidth > 760) setTimeout(function () { try { q.focus({ preventScroll: true }); } catch (e) {} }, 0);
  }

  AT.registerView("sources", view);
})();
