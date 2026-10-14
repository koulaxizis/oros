// ============================================================
// orOS Library — online catalogues (OPDS) screen (wave 33)
// Browse and search OPDS 1.x / 2.0 catalogues and Atom feeds with
// ebook enclosures: Project Gutenberg and Standard Ebooks (new
// releases) are built in, the user can add others (synced in the
// "library" slice as cats[]). A book downloads into the library like
// a file from this device (store.addFile → /internal/Books).
// Network: the Reader's shared layer (feeds/core.js + feeds/fetch.js,
// loaded on first use): straight from the browser, and only when a
// site sends no CORS headers through the Mail relay's generic "web"
// op (5 MB per answer), if the user has a relay. Parsing is pure
// (opds.js); every text is drawn with textContent, pictures are https
// only with no referrer, nothing from a catalogue is ever run.
// A one-time note per device says what is sent (prefs.opds).
// ============================================================
(function () {
  "use strict";

  var LIB = window.LIB, C = LIB.C, t = LIB.t, el = LIB.el, UI = LIB.UI;
  var O = window.LibOpds;
  var ACCEPT = "application/atom+xml;profile=opds-catalog, application/opds+json, application/atom+xml;q=0.9, application/json;q=0.8, */*;q=0.5";
  var FMT_MIME = { epub: "application/epub+zip", pdf: "application/pdf", cbz: "application/vnd.comicbook+zip",
                   cbr: "application/vnd.comicbook-rar", fb2: "application/x-fictionbook+xml" };

  // ---------- Network layer (lazy) ----------
  var netP = null;
  function net() {
    if (window.orosFeedsFetch && window.orosFeedsCore) return Promise.resolve(window.orosFeedsFetch);
    if (netP) return netP;
    var me = document.querySelector('script[src*="catalog.js"]');
    var q = me && me.src.indexOf("?") >= 0 ? me.src.slice(me.src.indexOf("?")) : "";
    function load(rel) {
      return new Promise(function (res) {
        var sc = document.createElement("script");
        sc.src = rel + q;
        sc.onload = function () { res(true); };
        sc.onerror = function () { res(false); };
        document.head.appendChild(sc);
      });
    }
    netP = (window.orosFeedsCore ? Promise.resolve(true) : load("../feeds/core.js"))
      .then(function () { return window.orosFeedsFetch ? true : load("../feeds/fetch.js"); })
      .then(function () {
        if (!window.orosFeedsFetch) { netP = null; throw { code: "net" }; }
        return window.orosFeedsFetch;
      });
    return netP;
  }
  // GET → { status, url, type, bytes } straight, else through the relay.
  function getBytes(url, opts) {
    return net().then(function (F) {
      if (navigator.onLine === false) throw { code: "offline" };
      return F.direct(url, opts).then(function (r) { r.via = "direct"; return r; }, function (e) {
        if (!e || e.code !== "cors") throw e;
        if (!F.relayAvailable()) throw { code: "norelay" };
        return F.relay([{ url: url }], opts).then(function (list) {
          var r = list[0];
          if (!r || r.err) throw { code: r && r.err === "too-big" ? "relayBig" : (r && r.err) || "relay" };
          r.via = "relay";
          return r;
        });
      });
    });
  }
  function getText(url) {
    return getBytes(url, { accept: ACCEPT }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw { code: "auth" };
      if (r.status < 200 || r.status > 299 || !r.bytes) throw { code: "http", status: r.status };
      return { url: r.url || url, text: window.orosFeedsCore.decodeBytes(r.bytes, r.type) };
    });
  }
  function errText(e) {
    var c = e && e.code;
    if (c === "offline") return t("cat.err.offline");
    if (c === "norelay") return t("cat.err.norelay");
    if (c === "auth") return t("cat.err.auth");
    if (c === "http") return t("cat.err.http", { code: e.status || "?" });
    if (c === "parse") return t("cat.err.parse");
    if (c === "big") return t("cat.err.big");
    if (c === "relayBig") return t("cat.err.relayBig");
    if (c === "notBook") return t("cat.err.notBook");
    return t("cat.err.net");
  }

  // ---------- Catalogues ----------
  function catalogs() {
    var mine = (LIB.data.cats || []).filter(function (c) { return !(LIB.data.tombs[c.id] >= c.m); }).map(function (c) {
      return { id: c.id, name: c.name || hostOf(c.url), url: c.url, search: "", mine: true };
    }).sort(function (a, b) { return C.cmpStr(C.fold(a.name), C.fold(b.name)); });
    return O.BUILTIN.map(function (b) { return Object.assign({ mine: false }, b); }).concat(mine);
  }
  function hostOf(u) { try { return new URL(u).host; } catch (e) { return u; } }
  function newCatId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return "c" + Date.now().toString(36) + r[0].toString(36).slice(0, 6);
  }
  function addCat(url, name) {
    var list = LIB.data.cats || [];
    if (list.length >= C.MAX_CATS) { LIB.toast(t("cat.max", { n: C.MAX_CATS })); return false; }
    var exists = catalogs().some(function (c) { return c.url === url; });
    if (exists) { LIB.toast(t("cat.exists")); return false; }
    var rec = C.normCat({ id: newCatId(), m: LIB.now(), url: url, name: name });
    if (!rec) return false;
    LIB.data.cats = list.concat([rec]);
    LIB.commit(true);
    return true;
  }
  function removeCat(id) {
    var c = (LIB.data.cats || []).filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var keep = JSON.parse(JSON.stringify(c));
    LIB.data.tombs[id] = LIB.now(c.m);
    LIB.commit(true);
    render();
    LIB.undoToast(t("cat.removed"), function () {
      keep.m = LIB.now(LIB.data.tombs[id]);
      LIB.data.cats = (LIB.data.cats || []).filter(function (x) { return x.id !== id; }).concat([keep]);
      LIB.commit(true);
      render();
    });
  }

  // ---------- Screen ----------
  var dlg = null, body = null, cat = null, stack = [], gen = 0;

  function open() {
    if (!O) return;
    if (!LIB.prefs.opds) { note(); return; }
    dlg = LIB.dialog("lb-cat", t("cat.title"), "wide cat-dlg");
    body = el("div", "cat-body");
    dlg.appendChild(body);
    dlg.addEventListener("close", function () { gen++; dlg = null; });
    cat = null;
    stack = [];
    render();
    dlg.showModal();
  }
  // What is sent, once per device.
  function note() {
    var d = LIB.dialog("lb-cat-note", t("cat.title"), "small");
    d.appendChild(el("p", "dlg-text", t("cat.note")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(LIB.textBtn("btn", t("btn.cancel"), function () { d.close(); }));
    var ok = LIB.textBtn("btn primary", t("cat.ok"), function () {
      LIB.prefs.opds = true;
      LIB.savePrefs();
      d.close();
      setTimeout(open, 0);
    });
    acts.appendChild(ok);
    d.appendChild(acts);
    d.showModal();
    ok.focus();
  }

  function render() {
    if (!dlg) return;
    if (!cat) renderHome(); else renderFeed();
  }

  function renderHome() {
    body.textContent = "";
    var ul = el("ul", "cat-list");
    catalogs().forEach(function (c) {
      var li = el("li", "cat-row");
      var b = el("button", "cat-open");
      b.type = "button";
      b.innerHTML = UI.globe;
      var tx = el("span", "cat-tx");
      tx.appendChild(el("span", "cat-name", c.name));
      tx.appendChild(el("span", "cat-host", c.mine ? hostOf(c.url) : t("cat.builtin") + " · " + hostOf(c.url)));
      b.appendChild(tx);
      b.addEventListener("click", function () { cat = c; stack = []; go(c.url, c.name); });
      li.appendChild(b);
      if (c.mine) li.appendChild(LIB.btn("icon-btn small", t("cat.remove", { name: c.name }), UI.trash, function () { removeCat(c.id); }));
      ul.appendChild(li);
    });
    body.appendChild(ul);

    var form = el("form", "form cat-add");
    form.noValidate = true;
    form.appendChild(el("h3", "cat-h", t("cat.add")));
    var f1 = el("label", "field");
    f1.appendChild(el("span", "", t("cat.url")));
    var url = el("input");
    url.type = "url"; url.inputMode = "url"; url.autocomplete = "off"; url.spellcheck = false; url.maxLength = 500;
    url.placeholder = "https://";
    f1.appendChild(url);
    form.appendChild(f1);
    var f2 = el("label", "field");
    f2.appendChild(el("span", "", t("cat.name")));
    var name = el("input");
    name.type = "text"; name.maxLength = 80; name.autocomplete = "off";
    f2.appendChild(name);
    form.appendChild(f2);
    var acts = el("div", "dlg-actions");
    var sb = LIB.textBtn("btn primary", t("cat.save"));
    sb.type = "submit";
    acts.appendChild(sb);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var u = O.catUrl(url.value);
      if (!u) { LIB.toast(t("cat.badUrl")); url.focus(); return; }
      if (addCat(u, name.value)) { LIB.toast(t("cat.saved")); render(); }
    });
    body.appendChild(form);
    body.appendChild(el("p", "hint cat-foot", t("cat.foot")));
  }

  // Open a catalogue page (navigation, search results, a book page).
  function go(url, title, replaceTop) {
    var view = { url: url, title: title || "", feed: null, err: null, more: [] };
    if (replaceTop && stack.length) stack[stack.length - 1] = view; else stack.push(view);
    load(view);
  }
  function load(view) {
    var my = ++gen;
    view.feed = null; view.err = null;
    render();
    getText(view.url).then(function (r) {
      var feed = O.parseFeed(r.text, r.url);
      if (!feed) throw { code: "parse" };
      if (!feed.search && cat && cat.search) feed.search = cat.search;
      if (!feed.search && feed.osd) {
        return getText(feed.osd).then(function (o) { feed.search = O.parseOsd(o.text, o.url); return feed; }, function () { return feed; });
      }
      return feed;
    }).then(function (feed) {
      if (my !== gen) return;
      view.feed = feed;
      if (!view.title) view.title = feed.title;
      render();
    }, function (e) {
      if (my !== gen) return;
      view.err = e;
      render();
    });
  }

  function renderFeed() {
    var view = stack[stack.length - 1];
    var keepScroll = dlg.scrollTop;
    body.textContent = "";
    var bar = el("div", "cat-bar");
    bar.appendChild(LIB.btn("icon-btn", t("cat.back"), UI.back, function () {
      gen++;
      stack.pop();
      if (!stack.length) cat = null;
      render();
      if (!stack.length) return;
      var top = stack[stack.length - 1];
      if (!top.feed && !top.err) load(top);
    }));
    bar.appendChild(el("h3", "cat-h cat-where", view.title || (cat && cat.name) || ""));
    body.appendChild(bar);

    var feed = view.feed;
    var searchTpl = feed ? feed.search : (cat && cat.search);
    if (searchTpl) {
      var sf = el("form", "cat-search");
      sf.setAttribute("role", "search");
      var qi = el("input");
      qi.type = "search"; qi.maxLength = 120; qi.autocomplete = "off";
      qi.placeholder = t("cat.search");
      qi.setAttribute("aria-label", t("cat.search"));
      if (view.q) qi.value = view.q;
      sf.appendChild(qi);
      var sb = LIB.btn("icon-btn", t("cat.search"), UI.search);
      sb.type = "submit";
      sf.appendChild(sb);
      sf.addEventListener("submit", function (e) {
        e.preventDefault();
        var u = O.searchUrl(searchTpl, qi.value);
        if (!u) return;
        var v = { url: u, title: "“" + qi.value.trim().slice(0, 60) + "”", feed: null, err: null, more: [], q: qi.value };
        stack.push(v);
        load(v);
      });
      body.appendChild(sf);
    }
    if (view.err) {
      body.appendChild(el("p", "dlg-text cat-msg", errText(view.err)));
      body.appendChild(LIB.textBtn("btn", t("cat.retry"), function () { load(view); }));
      return;
    }
    if (!feed) { body.appendChild(el("p", "hint cat-msg", t("busy.loading"))); return; }
    var ul = el("ul", "cat-entries");
    var all = feed.entries.concat(view.more);
    all.forEach(function (x) { ul.appendChild(entryRow(x)); });
    if (!all.length) body.appendChild(el("p", "hint cat-msg", t("cat.empty")));
    body.appendChild(ul);
    var next = view.nextUrl !== undefined ? view.nextUrl : feed.next;
    if (next) {
      var mb = LIB.textBtn("btn cat-more", t("cat.more"), function () {
        mb.disabled = true;
        var my = gen;
        getText(next).then(function (r) {
          var f2 = O.parseFeed(r.text, r.url);
          if (!f2) throw { code: "parse" };
          if (my !== gen || stack[stack.length - 1] !== view) return;
          view.more = view.more.concat(f2.entries);
          view.nextUrl = f2.next || "";
          render();
        }).catch(function (e) {
          mb.disabled = false;
          LIB.toast(errText(e));
        });
      });
      body.appendChild(mb);
    }
    dlg.scrollTop = keepScroll;
  }

  function entryRow(x) {
    var li = el("li", "cat-entry" + (x.kind === "head" ? " head" : ""));
    if (x.kind === "head") {
      li.appendChild(el("h4", "cat-gh", x.title));
      if (x.nav) li.appendChild(LIB.textBtn("btn small-btn", t("cat.more"), function () { go(x.nav, x.title); }));
      return li;
    }
    var main = el(x.kind === "nav" ? "button" : "div", "cat-item");
    if (x.kind === "nav") {
      main.type = "button";
      main.addEventListener("click", function () { go(x.nav, x.title); });
    }
    if (x.thumb) {
      var im = el("img", "cat-thumb");
      im.alt = "";
      im.loading = "lazy";
      im.decoding = "async";
      im.referrerPolicy = "no-referrer";
      im.addEventListener("error", function () { im.remove(); });
      im.src = x.thumb;
      main.appendChild(im);
    } else if (x.kind === "nav") {
      var ic = el("span", "cat-ic");
      ic.innerHTML = UI.disk;
      main.appendChild(ic);
    }
    var tx = el("div", "cat-tx");
    tx.appendChild(el("span", "cat-name", x.title));
    var sub = [x.by, x.year ? String(x.year) : "", x.lang ? x.lang.toUpperCase() : ""].filter(Boolean).join(" · ");
    if (sub) tx.appendChild(el("span", "cat-host", sub));
    if (x.summary) tx.appendChild(el("span", "cat-sum", x.summary));
    if (x.kind === "book") {
      var acts = el("div", "cat-dl");
      x.links.forEach(function (l) {
        var b = LIB.textBtn("btn", (l.fmt || "").toUpperCase(), function () { download(x, l, b); });
        b.setAttribute("aria-label", t("cat.dlAs", { title: x.title, fmt: (l.fmt || "").toUpperCase() }));
        b.insertAdjacentHTML("afterbegin", UI.device);
        acts.appendChild(b);
      });
      if (x.nav && !x.links.length) acts.appendChild(LIB.textBtn("btn", t("cat.open"), function () { go(x.nav, x.title); }));
      tx.appendChild(acts);
    }
    main.appendChild(tx);
    li.appendChild(main);
    return li;
  }

  // ---------- Download into the library ----------
  function download(x, l, btn) {
    var max = l.fmt === "cbz" || l.fmt === "cbr" ? C.MAX_COMIC : C.MAX_BYTES;
    if (l.size && l.size > max) { LIB.toast(t("cat.err.big")); return; }
    // the dialog is modal (top layer): the progress shows on the button
    var label = btn.lastChild.textContent;
    btn.disabled = true;
    btn.lastChild.textContent = t("cat.dlShort");
    btn.setAttribute("aria-busy", "true");
    function done() { btn.disabled = false; btn.lastChild.textContent = label; btn.removeAttribute("aria-busy"); }
    getBytes(l.url, { accept: l.type || "*/*", timeout: 120000 }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw { code: "auth" };
      if (r.status < 200 || r.status > 299 || !r.bytes) throw { code: "http", status: r.status };
      if (r.bytes.length > max) throw { code: "big" };
      if (!O.sniffOk(l.fmt, r.bytes)) throw { code: "notBook" };
      var name = O.fileName(x.title, l.fmt);
      var file = new File([r.bytes], name, { type: FMT_MIME[l.fmt] || "application/octet-stream" });
      return LIB.store.addFile(file);
    }).then(function (res) {
      done();
      LIB.home.refresh();
      LIB.actionToast(t(res.isNew ? "cat.added" : "cat.already", { title: x.title }), t("cat.read"), function () {
        if (dlg) dlg.close();
        LIB.openBook(res.id);
      });
    }, function (e) {
      done();
      var m = e && e.message;
      if (m === "nofs") { LIB.toast(t("msg.nofs")); return; }
      if (m === "big") { LIB.toast(t("cat.err.big")); return; }
      if (m) { LIB.toast(t("msg.addFail", { name: x.title })); return; }
      LIB.toast(errText(e));
    });
  }

  LIB.catalog = { open: open };
})();
