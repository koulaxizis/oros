// ============================================================
// orOS Newsletter — products and customers from a connected shop
// (newsletter/shop.js, editor wave E4)
// A WooCommerce or Shopify account lives in the shell (Settings ›
// Connected services, parent.orosLinks); this file never sees a key.
// Everything here only READS the shop:
//   - WooCommerce: GET /products (published, 100 a page), GET
//     /products/<id> (fresh prices), GET /data/currencies/current,
//     GET /customers (they become subscribers with basis "customer")
//   - Shopify: the Storefront API's fixed queries (links/core.js
//     SHOPIFY_Q): products a page at a time, products by id
// Product pictures are copied into the issue like every other picture
// (/internal/Newsletter/img-*.jpg): first straight from the browser,
// and for a WooCommerce shop that doesn't allow that, through the
// relay's "ext" operation (only the shop's own /wp-content/uploads/).
// Pure part (Node tests): plain, cents, wooItem, sfReq, sfPage,
// refreshReqs, applyFresh, wooPeople, imgPath. UI part: init(A),
// pick(block, done), refresh(block, done), customers().
// UMD: window.OrosNewsletterShop; module.exports in Node.
// ============================================================
(function (root) {
  "use strict";
  var NODE = typeof module === "object" && module.exports && typeof require === "function";
  var C = root.OrosNewsletterCore || (NODE ? require("./core.js") : null);
  var L = root.OrosLinksCore || (NODE ? require("../links/core.js") : null);
  var A = null;                                   // the app's helpers (init)

  var S = {
    en: {
      "shop.title": "Products from your shop", "shop.btn": "Choose products…", "shop.noItems": "No products yet: choose them from your shop.",
      "shop.none": "Connect a WooCommerce or Shopify shop in Settings › Connected services first.",
      "shop.open": "Open Connected services", "shop.noShell": "Open Newsletter from the orOS desktop to use your shop.",
      "shop.acct": "Shop", "shop.search": "Search products", "shop.allCats": "All categories",
      "shop.loading": "Reading the shop… {n}", "shop.more": "Load more", "shop.empty": "No products match.",
      "shop.noProducts": "The shop has no published products.", "shop.picked": "{n} chosen, up to {max} in a block",
      "shop.add": "Add {n}", "shop.copying": "Copying pictures… {n}",
      "shop.imgFail": "{n} pictures couldn't be copied: those products show without a picture.",
      "shop.refresh": "Refresh prices", "shop.refreshing": "Reading prices…", "shop.refreshed": "Prices refreshed.",
      "shop.gone": "{n} products are no longer in the shop: remove them or choose them again.",
      "shop.at": "Prices from {t}", "shop.never": "Prices not read from the shop yet.", "shop.out": "sold out",
      "shop.per": "Per row", "shop.bt": "Button text", "shop.btPh": "Buy now", "shop.remove": "Remove",
      "shop.otherShop": "This block's products come from another shop. Remove them first to choose from this one.",
      "shop.cust": "From the shop", "shop.custTitle": "Customers from the shop",
      "shop.custNone": "No customers with an e-mail address in this shop.",
      "shop.custHint": "Your shop's customers, for news about similar products. They count as \"Existing customer\" and every issue lets them unsubscribe. Anyone who left this list is never brought back.",
      "shop.custTags": "Tag them with the shop's name",
      "shop.custWoo": "Customers are read from WooCommerce shops. From Shopify, export the customers (Customers › Export) and use Import CSV: only those who accept e-mail marketing come in.",
      "shop.err.auth": "The shop refused the keys. Check them in Settings › Connected services.",
      "shop.err.keys": "This device doesn't have the shop's keys yet. Enter them in Settings › Connected services.",
      "shop.err.offline": "You're offline.", "shop.err.busy": "The shop asks to slow down. Try again in a minute.",
      "shop.err.notfound": "The shop answered with \"not found\". Check its address in Settings › Connected services.",
      "shop.err.other": "Couldn't reach the shop. Try again later."
    },
    el: {
      "shop.title": "Προϊόντα από το κατάστημά σου", "shop.btn": "Επιλογή προϊόντων…", "shop.noItems": "Δεν υπάρχουν ακόμα προϊόντα: διάλεξέ τα από το κατάστημά σου.",
      "shop.none": "Σύνδεσε πρώτα ένα κατάστημα WooCommerce ή Shopify στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "shop.open": "Άνοιγμα Συνδεδεμένων υπηρεσιών", "shop.noShell": "Άνοιξε το Newsletter από την επιφάνεια εργασίας του orOS για να χρησιμοποιήσεις το κατάστημά σου.",
      "shop.acct": "Κατάστημα", "shop.search": "Αναζήτηση προϊόντων", "shop.allCats": "Όλες οι κατηγορίες",
      "shop.loading": "Ανάγνωση του καταστήματος… {n}", "shop.more": "Φόρτωση περισσότερων", "shop.empty": "Κανένα προϊόν δεν ταιριάζει.",
      "shop.noProducts": "Το κατάστημα δεν έχει δημοσιευμένα προϊόντα.", "shop.picked": "Επιλέχθηκαν {n}, έως {max} σε ένα block",
      "shop.add": "Προσθήκη {n}", "shop.copying": "Αντιγραφή εικόνων… {n}",
      "shop.imgFail": "{n} εικόνες δεν αντιγράφηκαν: αυτά τα προϊόντα εμφανίζονται χωρίς εικόνα.",
      "shop.refresh": "Ανανέωση τιμών", "shop.refreshing": "Ανάγνωση τιμών…", "shop.refreshed": "Οι τιμές ανανεώθηκαν.",
      "shop.gone": "{n} προϊόντα δεν υπάρχουν πια στο κατάστημα: αφαίρεσέ τα ή διάλεξέ τα ξανά.",
      "shop.at": "Τιμές από {t}", "shop.never": "Οι τιμές δεν έχουν διαβαστεί ακόμα από το κατάστημα.", "shop.out": "εξαντλήθηκε",
      "shop.per": "Ανά σειρά", "shop.bt": "Κείμενο κουμπιού", "shop.btPh": "Αγορά", "shop.remove": "Αφαίρεση",
      "shop.otherShop": "Τα προϊόντα αυτού του block είναι από άλλο κατάστημα. Αφαίρεσέ τα πρώτα για να διαλέξεις από αυτό.",
      "shop.cust": "Από το κατάστημα", "shop.custTitle": "Πελάτες από το κατάστημα",
      "shop.custNone": "Κανένας πελάτης με email σε αυτό το κατάστημα.",
      "shop.custHint": "Οι πελάτες του καταστήματός σου, για νέα για παρόμοια προϊόντα. Μετράνε ως «Υπάρχων πελάτης» και κάθε τεύχος τους δίνει δυνατότητα διαγραφής. Όποιος έφυγε από αυτή τη λίστα δεν ξαναμπαίνει ποτέ.",
      "shop.custTags": "Ετικέτα με το όνομα του καταστήματος",
      "shop.custWoo": "Οι πελάτες διαβάζονται από καταστήματα WooCommerce. Από το Shopify, κάνε εξαγωγή πελατών (Customers › Export) και χρησιμοποίησε την Εισαγωγή CSV: μπαίνουν μόνο όσοι δέχονται email μάρκετινγκ.",
      "shop.err.auth": "Το κατάστημα απέρριψε τα κλειδιά. Έλεγξέ τα στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "shop.err.keys": "Αυτή η συσκευή δεν έχει ακόμα τα κλειδιά του καταστήματος. Πέρασέ τα στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "shop.err.offline": "Είσαι εκτός σύνδεσης.", "shop.err.busy": "Το κατάστημα ζητά να πάμε πιο αργά. Δοκίμασε ξανά σε ένα λεπτό.",
      "shop.err.notfound": "Το κατάστημα απάντησε «δεν βρέθηκε». Έλεγξε τη διεύθυνσή του στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "shop.err.other": "Δεν ήταν δυνατή η σύνδεση με το κατάστημα. Δοκίμασε αργότερα."
    }
  };
  function t(k, params) {
    var code = A && A.lang ? A.lang : "en", I = root.orosI18n;
    var tab = S[code] || (I ? I.table(S, "newsletter", code) : S.en);
    var s = tab[k] !== undefined ? tab[k] : S.en[k] !== undefined ? S.en[k] : k;
    return s.replace(/\{(\w+)\}/g, function (m, n) { return params && params[n] !== undefined ? String(params[n]) : m; });
  }

  var MAX = 9;                                    // products in one block (= core normBlock)
  var WOO_PER = 100, WOO_PAGES = 3, WOO_MAX_PAGES = 30, SF_PER = 50, CUST_PAGES = 50;

  // ---------- pure ----------
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
              rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", euro: "€", pound: "£",
              laquo: "«", raquo: "»", times: "×", deg: "°", copy: "©", reg: "®", trade: "™",
              eacute: "é", egrave: "è", agrave: "à", aacute: "á", ccedil: "ç", auml: "ä",
              ouml: "ö", uuml: "ü", szlig: "ß", ntilde: "ñ" };
  // Shop text is DATA: tags out, entities decoded, one line.
  function plain(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, function (all, e) {
      if (e[0] !== "#") return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : all;
      var cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!(cp > 31 && cp < 0x110000) || (cp >= 0xd800 && cp <= 0xdfff) || cp === 127) return all;
      return String.fromCodePoint(cp);
    });
    return C.oneLine(s, max || 200);
  }
  // "12.50" / 12.5 → 1250; -1 when it is not money
  function cents(v) {
    var n = typeof v === "string" && /^[0-9]{1,10}(\.[0-9]{1,6})?$/.test(v.trim()) ? parseFloat(v) : (typeof v === "number" && isFinite(v) && v >= 0 ? v : NaN);
    return isFinite(n) && n <= 999999999 ? Math.round(n * 100) : -1;
  }
  function webUrl(u) { return typeof u === "string" && /^https:\/\/[^\s"'<>\\`]{3,1990}$/i.test(u.trim()) ? u.trim() : ""; }
  function curOf(v) { return typeof v === "string" && /^[A-Z]{3}$/.test(v) ? v : ""; }

  // A WooCommerce product (REST v3) → a block item (without its
  // picture file) + its categories; null when it can't be shown.
  function wooItem(p, cur) {
    if (!p || typeof p !== "object" || !(typeof p.id === "number" && p.id > 0 && p.id < 1e12)) return null;
    if (p.status && p.status !== "publish") return null;
    var name = plain(p.name, 200), href = webUrl(p.permalink);
    if (!name || !href) return null;
    var price = cents(p.price), reg = cents(p.regular_price);
    var im = Array.isArray(p.images) && p.images[0] && typeof p.images[0] === "object" ? p.images[0] : {};
    return {
      id: String(p.id), name: name, t: plain(p.short_description, 300), href: href,
      price: price, was: p.on_sale && reg > price && price >= 0 ? reg : 0, cur: curOf(cur) || "EUR",
      src: webUrl(im.src), alt: plain(im.alt, 300),
      out: p.stock_status === "outofstock" ? 1 : 0,
      cats: (Array.isArray(p.categories) ? p.categories : []).slice(0, 10).map(function (c) { return c ? plain(c.name, 80) : ""; }).filter(Boolean)
    };
  }
  function wooReqs(page) {
    var out = [];
    for (var i = 0; i < WOO_PAGES; i++) out.push({ m: "GET", path: "/products?status=publish&per_page=" + WOO_PER + "&page=" + (page + i) + "&orderby=date&order=desc" });
    return out;
  }

  // Shopify Storefront: one page of products, a search typed by the
  // person goes as a GraphQL variable (never into the query text).
  function sfReq(after, query) {
    var v = { first: SF_PER };
    if (after) v.after = after;
    var q = C.oneLine(String(query || ""), 100);
    if (q) v.query = q;
    return { m: "POST", path: "/graphql.json", body: { query: L.SHOPIFY_Q.products, variables: v } };
  }
  function sfImg(u) {
    u = webUrl(u);
    if (!u) return "";
    return u + (u.indexOf("?") < 0 ? "?" : "&") + "width=1200";   // Shopify's CDN sends a smaller copy
  }
  function sfNode(n, site) {
    if (!n || typeof n !== "object" || typeof n.id !== "string" || !/^gid:\/\/shopify\/Product\/[0-9]{1,20}$/.test(n.id)) return null;
    var name = plain(n.title, 200);
    var handle = typeof n.handle === "string" && /^[a-z0-9][a-z0-9-]{0,200}$/.test(n.handle) ? n.handle : "";
    var href = webUrl(n.onlineStoreUrl) || (handle && site ? site + "/products/" + handle : "");
    if (!name || !href) return null;
    var mv = n.priceRange && n.priceRange.minVariantPrice || {}, cv = n.compareAtPriceRange && n.compareAtPriceRange.minVariantPrice || {};
    var price = cents(mv.amount), was = cents(cv.amount);
    var im = n.featuredImage && typeof n.featuredImage === "object" ? n.featuredImage : {};
    return {
      id: n.id, name: name, t: plain(n.description, 300), href: href,
      price: price, was: was > price && price >= 0 ? was : 0, cur: curOf(mv.currencyCode) || "EUR",
      src: sfImg(im.url), alt: plain(im.altText, 300), out: n.availableForSale === false ? 1 : 0,
      cats: (n.collections && Array.isArray(n.collections.nodes) ? n.collections.nodes : []).slice(0, 10)
        .map(function (c) { return c ? plain(c.title, 80) : ""; }).filter(Boolean)
    };
  }
  // A Storefront answer → { items, next } or null when it isn't one
  function sfPage(data, site) {
    var p = data && data.data && data.data.products;
    if (!p || !Array.isArray(p.nodes)) return null;
    var info = p.pageInfo || {};
    return {
      items: p.nodes.map(function (n) { return sfNode(n, site); }).filter(Boolean),
      next: info.hasNextPage && typeof info.endCursor === "string" && info.endCursor.length <= 400 ? info.endCursor : ""
    };
  }

  // Fresh prices for a block's products: the requests, then the
  // answers applied. → { items, gone }
  function refreshReqs(b) {
    var ids = b.items.map(function (p) { return p.id; }).filter(Boolean);
    if (b.sh === "shopify") {
      ids = ids.filter(function (id) { return /^gid:\/\/shopify\/Product\/[0-9]{1,20}$/.test(id); });
      return ids.length ? [{ m: "POST", path: "/graphql.json", body: { query: L.SHOPIFY_Q.nodes, variables: { ids: ids } } }] : [];
    }
    return [{ m: "GET", path: "/data/currencies/current" }].concat(ids.filter(function (id) { return /^[0-9]{1,12}$/.test(id); })
      .map(function (id) { return { m: "GET", path: "/products/" + id }; }));
  }
  // fresh: id → item (as wooItem / sfNode make them); an id missing
  // there is gone from the shop: kept as it was, counted.
  function applyFresh(b, fresh) {
    var gone = 0;
    var items = b.items.map(function (p) {
      var f = p.id ? fresh[p.id] : null;
      if (!f) { gone++; return p; }
      var q = JSON.parse(JSON.stringify(p));
      q.name = f.name; q.href = f.href; q.price = f.price; q.was = f.was; q.cur = f.cur;
      if (f.out) q.out = 1; else delete q.out;
      return q;
    });
    return { items: items, gone: gone };
  }
  // A block item from a shop product (the picture is set when copied)
  function toItem(p) {
    return C.normProd({ id: p.id, name: p.name, t: p.t, href: p.href, price: p.price, was: p.was, cur: p.cur, src: p.src, alt: p.alt, out: p.out });
  }

  // WooCommerce customers → people for the import (planImport keeps
  // its rules: no duplicates, never back who left, the suppression list)
  function wooPeople(customers, tag) {
    var out = [];
    (Array.isArray(customers) ? customers : []).forEach(function (c) {
      if (!c || typeof c !== "object") return;
      var b = c.billing && typeof c.billing === "object" ? c.billing : {};
      var email = C.normEmail(String(c.email || b.email || ""));
      if (!email) return;
      var name = C.oneLine(plain(c.first_name || b.first_name, 60) + " " + plain(c.last_name || b.last_name, 60), C.LIM.name);
      out.push({ email: email, name: name, c: "", lt: tag ? [C.oneLine(tag, 40)] : [] });
    });
    return out;
  }

  // The relay path of a WooCommerce picture: only the shop's own
  // /wp-content/uploads/ (links/core.js checkImg); "" otherwise.
  function imgPath(src, site) {
    var sp = L.siteParts(site || "");
    if (!sp || typeof src !== "string") return "";
    var m = /^https:\/\/([^\/?#:@]+)(\/[^?#]*)$/i.exec(src);
    if (!m || m[1].toLowerCase() !== sp.host) return "";
    var path = m[2];
    if (sp.base) { if (path.indexOf(sp.base + "/") !== 0) return ""; path = path.slice(sp.base.length); }
    return L.checkReq("woo", { m: "GET", path: path, img: 1 }) ? "" : path;
  }

  // ---------- with the shell ----------
  function links() {
    try { var p = root.parent; return p && p !== root && p.orosLinks && typeof p.orosLinks.call === "function" ? p.orosLinks : null; }
    catch (e) { return null; }
  }
  function accounts(only) {
    var Lk = links();
    if (!Lk) return [];
    return Lk.list().filter(function (a) { return (only || C.SHOP_PS).indexOf(a.p) >= 0; });
  }
  function acctOf(id) { return accounts().filter(function (a) { return a.id === id; })[0] || null; }
  function errOf(code) { var e = new Error(code); e.code = code; return e; }
  function errText(e) {
    var c = e && e.code;
    return t(c === "auth" || c === "keys" || c === "offline" || c === "busy" || c === "notfound" ? "shop.err." + c : "shop.err.other");
  }
  // requests → answers (data; null for one that failed on its own, like
  // a product deleted since), or a thrown code when the shop refused
  // us or nothing at all came back
  var HARD = { auth: 1, keys: 1, busy: 1, offline: 1 };
  function ask(acct, reqs) {
    var Lk = links();
    return Lk.call(acct, reqs).then(function (res) {
      var codes = res.map(function (r) { return Lk.statusCode(r); });
      var hard = codes.filter(function (c) { return HARD[c]; })[0];
      if (hard) throw errOf(hard);
      if (codes.every(Boolean)) throw errOf(codes[0]);
      return res.map(function (r, i) { return codes[i] ? null : r.data; });
    });
  }
  function sfData(d) {
    if (!d || typeof d !== "object" || !d.data) throw errOf("server");
    return d;
  }
  // One page of products. state: { acct, page (Woo) / next (Shopify),
  // done, cur } → Promise<items[]>, state moved on.
  function loadMore(st, query) {
    var a = acctOf(st.acct);
    if (!a) return Promise.reject(errOf("gone"));
    if (a.p === "shopify") {
      return ask(a.id, [sfReq(st.next, query)]).then(function (r) {
        var pg = sfPage(sfData(r[0]), a.site);
        if (!pg) throw errOf("server");
        st.next = pg.next;
        st.done = !pg.next;
        return pg.items;
      });
    }
    var reqs = wooReqs(st.page);
    if (!st.cur) reqs.unshift({ m: "GET", path: "/data/currencies/current" });
    return ask(a.id, reqs).then(function (r) {
      if (!st.cur) { var c = r.shift(); st.cur = curOf(c && c.code) || "EUR"; }
      var items = [], short = false;
      r.forEach(function (list) {
        if (!Array.isArray(list)) { short = true; return; }
        if (list.length < WOO_PER) short = true;
        list.forEach(function (p) { var x = wooItem(p, st.cur); if (x) items.push(x); });
      });
      st.page += WOO_PAGES;
      st.done = short || st.page > WOO_MAX_PAGES;
      return items;
    });
  }

  // A picture from the shop → { blob } (the app shrinks and stores it)
  function b64Blob(b64, type) {
    var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: type || "image/jpeg" });
  }
  function fetchImage(a, src) {
    if (!src) return Promise.reject(errOf("noimg"));
    return fetch(src, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", cache: "force-cache" }).then(function (res) {
      if (!res.ok) throw errOf("img");
      return res.blob();
    }).then(function (b) {
      if (!/^image\//.test(b.type || "image/")) throw errOf("img");
      return b;
    })["catch"](function () {
      var path = a.p === "woo" ? imgPath(src, a.site) : "";
      if (!path) throw errOf("img");
      return links().call(a.id, [{ m: "GET", path: path, img: 1 }]).then(function (res) {
        var r = res && res[0];
        if (!r || typeof r.b64 !== "string") throw errOf("img");
        return b64Blob(r.b64, r.type);
      });
    });
  }
  // Copy each item's picture into the issue (one after another)
  function copyPics(a, items, onStep) {
    var fails = 0, i = 0;
    function next() {
      if (i >= items.length) return Promise.resolve(fails);
      var it = items[i++];
      if (onStep) onStep(i, items.length);
      if (!it.src) return next();
      return fetchImage(a, it.src).then(function (blob) { return A.storeImage(blob); }).then(function (r) {
        it.f = r.path; it.w = r.w; it.h = r.h; it.b = r.b;
      }, function () { fails++; }).then(next);
    }
    return next();
  }

  // ---------- the picker ----------
  function noShop(dlg, text) {
    dlg.appendChild(A.el("p", "dlg-text", text));
    A.actionsRow(dlg, links() ? [A.btn(t("shop.open"), "", function () {
      dlg.close();
      try { root.parent.__orosOpenAt("settings", { section: "services" }); } catch (e) {}
    })] : [], "", null);
    A.openDialog(dlg);
  }
  function thumb(src) {
    var w = A.el("span", "shop-thumb");
    if (src) {
      var im = A.el("img");
      im.alt = "";
      im.loading = "lazy";
      im.referrerPolicy = "no-referrer";
      im.src = src;
      im.addEventListener("error", function () { im.remove(); });
      w.appendChild(im);
    }
    return w;
  }
  // pick(block, done): choose products for a product block; done(items,
  // sh, acct) gets the new block items (pictures copied), or nothing.
  function pick(b, done) {
    var dlg = A.makeDialog("nl-shop", t("shop.title"), true);
    if (!links()) { noShop(dlg, t("shop.noShell")); return; }
    var accts = accounts();
    if (!accts.length) { noShop(dlg, t("shop.none")); return; }
    if (b.acct && b.items.length && !acctOf(b.acct)) { noShop(dlg, t("shop.otherShop")); return; }
    var room = MAX - b.items.length;
    var f = {};
    var start = b.items.length && b.acct ? b.acct : accts[0].id;
    f.acct = A.sel(accts.map(function (a) { return [a.id, a.name + " · " + (a.p === "shopify" ? "Shopify" : "WooCommerce")]; }), start);
    f.acct.disabled = !!(b.acct && b.items.length);
    var top = A.el("div", "shop-top");
    top.appendChild(A.field(t("shop.acct"), f.acct));
    dlg.appendChild(top);
    var bar = A.el("div", "shop-bar");
    f.q = A.el("input");
    f.q.type = "search";
    f.q.maxLength = 100;
    f.q.placeholder = t("shop.search");
    f.q.setAttribute("aria-label", t("shop.search"));
    bar.appendChild(f.q);
    f.cat = A.sel([["", t("shop.allCats")]], "");
    f.cat.setAttribute("aria-label", t("shop.allCats"));
    bar.appendChild(f.cat);
    dlg.appendChild(bar);
    var msg = A.el("p", "hint", "");
    msg.setAttribute("aria-live", "polite");
    dlg.appendChild(msg);
    var box = A.el("div", "pick-list shop-list");
    dlg.appendChild(box);
    var more = A.btn(t("shop.more"), "", function () { load(); });
    more.hidden = true;
    dlg.appendChild(more);
    var countEl = A.el("p", "hint", "");
    dlg.appendChild(countEl);
    var st = null, all = [], chosen = {}, order = [], busy = false, gen = 0, sfTimer = 0;
    var acts = A.actionsRow(dlg, [], t("shop.add", { n: 0 }), function () { add(); });
    var okBtn = acts.lastChild;
    okBtn.disabled = true;
    function isSf() { var a = acctOf(st.acct); return a && a.p === "shopify"; }
    function counts() {
      countEl.textContent = t("shop.picked", { n: order.length, max: room });
      okBtn.textContent = t("shop.add", { n: order.length });
      okBtn.disabled = !order.length || busy;
    }
    function reset() {
      st = { acct: f.acct.value, page: 1, next: "", done: false, cur: "" };
      all = []; chosen = {}; order = [];
      box.innerHTML = "";
      f.cat.length = 1;
      counts();
      load();
    }
    function cats() {
      var seen = {}, list = [];
      all.forEach(function (p) { p.cats.forEach(function (c) { if (!seen[c]) { seen[c] = 1; list.push(c); } }); });
      list.sort(function (x, y) { return C.fold(x) < C.fold(y) ? -1 : 1; });
      var cur = f.cat.value;
      f.cat.length = 1;
      list.forEach(function (c) { var op = A.el("option", "", c); op.value = c; f.cat.appendChild(op); });
      f.cat.value = seen[cur] ? cur : "";
      f.cat.hidden = !list.length;
    }
    function draw() {
      var q = C.fold(f.q.value.trim()), c = f.cat.value, shown = 0;
      box.innerHTML = "";
      all.forEach(function (p) {
        if (c && p.cats.indexOf(c) < 0) return;
        if (q && !isSf() && C.fold(p.name + " " + p.t).indexOf(q) < 0) return;
        shown++;
        var row = A.el("label", "pick-row shop-row");
        var cb = A.el("input");
        cb.type = "checkbox";
        cb.checked = !!chosen[p.id];
        cb.addEventListener("change", function () {
          if (cb.checked && order.length >= room) { cb.checked = false; return; }
          if (cb.checked) { chosen[p.id] = p; order.push(p.id); }
          else { delete chosen[p.id]; order = order.filter(function (id) { return id !== p.id; }); }
          counts();
        });
        row.appendChild(cb);
        row.appendChild(thumb(p.src));
        var tx = A.el("span", "pick-t");
        tx.appendChild(A.el("span", "", p.name));
        var price = p.out ? t("shop.out") : A.money(p.price, p.cur);
        tx.appendChild(A.el("small", "", [price, p.cats.join(", ")].filter(Boolean).join(" · ")));
        row.appendChild(tx);
        box.appendChild(row);
      });
      if (!shown && !busy) box.appendChild(A.el("p", "hint", all.length ? t("shop.empty") : t("shop.noProducts")));
    }
    function load() {
      if (busy || !st || st.done) return;
      busy = true;
      var my = ++gen;
      more.hidden = true;
      msg.textContent = t("shop.loading", { n: all.length || "" }).trim();
      counts();
      loadMore(st, isSf() ? f.q.value : "").then(function (items) {
        if (my !== gen) return;
        var have = {};
        all.forEach(function (p) { have[p.id] = 1; });
        items.forEach(function (p) { if (!have[p.id]) all.push(p); });
        busy = false;
        msg.textContent = "";
        more.hidden = st.done;
        cats();
        draw();
        counts();
      }, function (e) {
        if (my !== gen) return;
        busy = false;
        msg.textContent = errText(e);
        counts();
      });
    }
    f.acct.addEventListener("change", reset);
    f.cat.addEventListener("change", draw);
    f.q.addEventListener("input", function () {
      if (!isSf()) { draw(); return; }
      // Shopify searches in the shop (a page at a time)
      clearTimeout(sfTimer);
      sfTimer = setTimeout(function () {
        gen++;
        busy = false;
        var keep = order.map(function (id) { return chosen[id]; });
        st = { acct: st.acct, page: 1, next: "", done: false, cur: st.cur };
        all = keep.slice();
        load();
      }, 400);
    });
    function add() {
      if (!order.length || busy) return;
      var a = acctOf(st.acct);
      if (!a) return;
      busy = true;
      counts();
      var items = order.map(function (id) { return toItem(chosen[id]); }).filter(Boolean);
      copyPics(a, items, function (i, n) { msg.textContent = t("shop.copying", { n: i + "/" + n }); }).then(function (fails) {
        busy = false;
        dlg.close();
        done(items, a.p, a.id);
        if (fails) A.toast(t("shop.imgFail", { n: fails }));
      });
    }
    A.openDialog(dlg, f.q);
    reset();
  }

  // refresh(block, done): read the block's products again; done(items,
  // gone) with fresh prices, or nothing when the shop couldn't answer.
  function refresh(b, done) {
    var a = b.acct ? acctOf(b.acct) : null;
    if (!a || !links()) { A.toast(t("shop.none")); return; }
    var reqs = refreshReqs(b);
    if (!reqs.length) return;
    A.toast(t("shop.refreshing"));
    ask(a.id, reqs).then(function (r) {
      var fresh = {};
      if (a.p === "shopify") {
        var nodes = sfData(r[0]).data.nodes;
        (Array.isArray(nodes) ? nodes : []).forEach(function (n) { var x = sfNode(n, a.site); if (x) fresh[x.id] = x; });
      } else {
        var c = r.shift(), cur = curOf(c && c.code) || (b.items[0] && b.items[0].cur) || "EUR";
        r.forEach(function (p) { var x = wooItem(p, cur); if (x) fresh[x.id] = x; });
      }
      var res = applyFresh(b, fresh);
      done(res.items, res.gone);
      A.toast(res.gone ? t("shop.gone", { n: res.gone }) : t("shop.refreshed"));
    }, function (e) { A.toast(errText(e)); });
  }

  // Customers of a WooCommerce shop → the app's people picker
  function customers() {
    var dlg = A.makeDialog("nl-shopc", t("shop.custTitle"), true);
    if (!links()) { noShop(dlg, t("shop.noShell")); return; }
    var accts = accounts(["woo"]);
    if (!accts.length) { dlg.appendChild(A.el("p", "hint", t("shop.custWoo"))); noShop(dlg, t("shop.none")); return; }
    var f = { acct: A.sel(accts.map(function (a) { return [a.id, a.name]; }), accts[0].id) };
    dlg.appendChild(A.field(t("shop.acct"), f.acct));
    dlg.appendChild(A.el("p", "hint", t("shop.custWoo")));
    var msg = A.el("p", "hint", "");
    msg.setAttribute("aria-live", "polite");
    dlg.appendChild(msg);
    var busy = false;
    A.actionsRow(dlg, [], t("imp.next"), function () {
      if (busy) return;
      busy = true;
      var a = acctOf(f.acct.value), got = [], page = 1;
      function step() {
        msg.textContent = t("shop.loading", { n: got.length || "" }).trim();
        var reqs = [];
        for (var i = 0; i < 5 && page + i <= CUST_PAGES; i++) reqs.push({ m: "GET", path: "/customers?role=customer&per_page=100&page=" + (page + i) + "&orderby=id&order=asc" });
        return ask(a.id, reqs).then(function (r) {
          var short = false;
          r.forEach(function (list) {
            if (!Array.isArray(list)) { short = true; return; }
            if (list.length < 100) short = true;
            got = got.concat(list);
          });
          page += reqs.length;
          return short || page > CUST_PAGES ? null : step();
        });
      }
      step().then(function () {
        dlg.close();
        A.pickPeople({ id: "nl-shopp", title: t("shop.custTitle"), none: t("shop.custNone"), hint: t("shop.custHint"),
                       tags: t("shop.custTags"), people: wooPeople(got, a.name), src: "shop", basis: "customer" });
      }, function (e) { busy = false; msg.textContent = errText(e); });
    });
    A.openDialog(dlg, f.acct);
  }

  var api = {
    plain: plain, cents: cents, wooItem: wooItem, wooReqs: wooReqs, sfReq: sfReq, sfNode: sfNode, sfPage: sfPage,
    refreshReqs: refreshReqs, applyFresh: applyFresh, toItem: toItem, wooPeople: wooPeople, imgPath: imgPath, MAX: MAX,
    init: function (helpers) { A = helpers; },
    has: function () { return !!links() && accounts().length > 0; },
    hasWoo: function () { return !!links() && accounts(["woo"]).length > 0; },
    pick: pick, refresh: refresh, customers: customers, t: t
  };
  if (NODE) module.exports = api;
  else root.OrosNewsletterShop = api;
})(typeof window !== "undefined" ? window : globalThis);
