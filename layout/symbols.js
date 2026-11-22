// ============================================================
// orOS Layout — symbols (v1.0.0, LY-W14). A symbol is a set of objects
// kept once in the document (setup.ext.sym, a list of { id, n (name),
// w, h, it (the objects, their place from the symbol's top-left
// corner, each with a key k), st { k: paragraphs of a text frame } })
// and placed any number of times. Each placement is a group whose
// objects carry ext.sym { s (the symbol), k (the object's key) }: an
// older orOS shows it as a plain group. Redefining a symbol from one
// placement changes every other placement, each keeping its own place
// and size (objects are scaled with their placement). A symbol that
// would make the document's setup too big (all symbols at most
// MAX_BYTES) is refused.
// Pure part LY_SYM (list, find, make, place, instances, redefine,
// detach, remove, rename, groupOf) / module.exports; the browser part is
// LY.symbols (More › Symbols…).
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var M = node ? require("../designkit/model.js") : root.orosDK && root.orosDK.model;
  var MAX_SYMS = 60, MAX_ITEMS = 60, MAX_BYTES = 40000, NAME = 60;
  // what an object keeps in a symbol (its place is relative, its page,
  // id, group, order and story are the placement's)
  var DROP = ["id", "m", "pg", "grp", "z", "story", "seq", "side", "lock", "hide"];

  function str(v, n) { return String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n); }
  function plain(o) { return JSON.parse(JSON.stringify(o)); }
  function list(doc) {
    var l = doc.setup.ext && doc.setup.ext.sym;
    return Array.isArray(l) ? l.filter(function (s) { return s && typeof s === "object" && /^sy-[a-z0-9]{1,24}$/.test(String(s.id)) && Array.isArray(s.it) && s.w > 0 && s.h > 0; }) : [];
  }
  function find(doc, ref) {
    var l = list(doc), q = str(ref, NAME).toLocaleLowerCase();
    return l.filter(function (s) { return s.id === ref; })[0] || l.filter(function (s) { return str(s.n, NAME).toLocaleLowerCase() === q; })[0] || null;
  }
  // The definitions are kept as JSON strings (one per object, one per
  // story), so the document's ext stays within normX's depth; a setup
  // ext normX would drop is never written (→ false).
  var STR = 4000, SETUP_MAX = 65536;
  function enc(d) {
    var it = d.it.map(function (c) { return JSON.stringify(c); }), st = {};
    Object.keys(d.st).forEach(function (k) { st[k] = JSON.stringify(d.st[k]); });
    var all = it.concat(Object.keys(st).map(function (k) { return st[k]; }));
    return all.some(function (x) { return x.length > STR; }) ? null : { it: it, st: st };
  }
  function parse(v, def) { try { var o = typeof v === "string" ? JSON.parse(v) : v; return o && typeof o === "object" ? o : def; } catch (e) { return def; } }
  // a symbol's objects and stories → { it: [objects], st: { k: paras } }
  function def(sym) {
    var st = {};
    Object.keys(sym.st || {}).forEach(function (k) { var p = parse(sym.st[k], null); if (Array.isArray(p)) st[k] = p; });
    return { it: (sym.it || []).map(function (c) { return parse(c, null); }).filter(function (c) { return c && !Array.isArray(c) && typeof c.t === "string" && typeof c.k === "string"; }), st: st };
  }
  function save(doc, l, now) {
    var x = Object.assign({}, doc.setup.ext || {});
    if (l.length) x.sym = l; else delete x.sym;
    if (Object.keys(x).length && !M.normX(x, SETUP_MAX)) return false;
    doc.setup.ext = x;
    doc.setup.m = Math.max(now, (doc.setup.m || 0) + 1);
    doc.m = Math.max(now, (doc.m || 0) + 1);
    return true;
  }
  function bytes(l) { return JSON.stringify(l).length; }
  // the box around objects (lines can have a negative size)
  function box(items) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    items.forEach(function (it) {
      x0 = Math.min(x0, it.x, it.x + it.w); x1 = Math.max(x1, it.x, it.x + it.w);
      y0 = Math.min(y0, it.y, it.y + it.h); y1 = Math.max(y1, it.y, it.y + it.h);
    });
    return { x: x0, y: y0, w: Math.max(0.5, x1 - x0), h: Math.max(0.5, y1 - y0) };
  }
  function keyOf(it) { return it.ext && it.ext.sym && typeof it.ext.sym.k === "string" ? it.ext.sym.k : ""; }
  function symOf(it) { return it.ext && it.ext.sym && typeof it.ext.sym.s === "string" ? it.ext.sym.s : ""; }
  // a symbol's definition from objects on the page
  function defOf(doc, items, keys) {
    var b = box(items), st = {};
    var it = items.map(function (o, i) {
      var c = plain(o), k = keys ? keys[i] : "k" + i;
      DROP.forEach(function (f) { delete c[f]; });
      if (c.ext) { delete c.ext.sym; if (!Object.keys(c.ext).length) delete c.ext; }
      c.x = o.x - b.x; c.y = o.y - b.y; c.k = k;
      if (o.t === "text") { var s = M.story(doc, o.story); st[k] = plain((s && s.paras) || []); }
      return c;
    });
    return { w: b.w, h: b.h, it: it, st: st };
  }

  // The objects `ids` (one page, not locked) become a symbol named
  // `name`; they become its first placement. → the symbol, or
  // { err: "few" | "page" | "big" | "many" | "name" }
  function make(doc, ids, name, now, idf) {
    var nid = idf || M.newId;
    var items = (ids || []).map(function (id) { return M.find(doc.items, id); }).filter(function (it) { return it && !it.lock; }).slice(0, MAX_ITEMS + 1);
    if (!items.length) return { err: "few" };
    if (items.length > MAX_ITEMS) return { err: "many" };
    if (items.some(function (it) { return it.pg !== items[0].pg; })) return { err: "page" };
    var l = list(doc);
    if (l.length >= MAX_SYMS) return { err: "many" };
    name = str(name, NAME) || "Symbol " + (l.length + 1);
    if (find(doc, name) && find(doc, name).n === name) return { err: "name" };
    var d = defOf(doc, items), e = enc(d);
    if (!e) return { err: "big" };
    var sym = { id: "sy-" + nid("x").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-12), n: name, w: d.w, h: d.h, it: e.it, st: e.st };
    if (bytes(l.concat([sym])) > MAX_BYTES || !save(doc, l.concat([sym]), now)) return { err: "big" };
    var g = nid("gr");
    items.forEach(function (it, i) {
      it.grp = g;
      it.ext = Object.assign({}, it.ext || {}, { sym: { s: sym.id, k: d.it[i].k } });
      M.touch(it, now);
    });
    return sym;
  }

  // the objects of a definition placed in the box b on page pg
  function build(doc, sym, pg, b, now, idf, z0, g) {
    var nid = idf || M.newId, sx = b.w / sym.w, sy = b.h / sym.h, out = [], D = def(sym);
    D.it.forEach(function (c, i) {
      var it = plain(c);
      delete it.k;
      it.id = nid("it"); it.m = now; it.pg = pg; it.side = ""; it.grp = g; it.z = z0 + i;
      it.x = b.x + c.x * sx; it.y = b.y + c.y * sy; it.w = c.w * sx; it.h = c.h * sy;
      it.ext = Object.assign({}, it.ext || {}, { sym: { s: sym.id, k: c.k } });
      if (c.t === "text") {
        var s = { id: nid("st"), m: now, h: [], paras: plain(D.st[c.k] || [{ ps: "ps-body", runs: [] }]) };
        if (!s.paras.length) s.paras = [{ ps: "ps-body", runs: [] }];
        doc.stories.push(s);
        it.story = s.id; it.seq = 1024;
      }
      out.push(it);
    });
    return out;
  }
  // A placement of symbol `ref` on page `pg` at (x, y) (its top-left
  // corner, pt), at its own size or w wide. → the new objects
  function place(doc, ref, pg, x, y, now, idf, w) {
    var sym = find(doc, ref);
    if (!sym || !M.find(doc.pages, pg)) return [];
    if (doc.items.length + def(sym).it.length > M.MAX_ITEMS) return [];
    var k = w > 0 ? w / sym.w : 1, z0 = 1;
    doc.items.forEach(function (it) { if (it.pg === pg) z0 = Math.max(z0, (it.z || 0) + 1); });
    var made = build(doc, sym, pg, { x: x, y: y, w: sym.w * k, h: sym.h * k }, now, idf, z0, (idf || M.newId)("gr"));
    made.forEach(function (it) { doc.items.push(it); });
    return made;
  }
  // every placement: [{ g, pg, items }]
  function instances(doc, ref) {
    var sym = find(doc, ref), by = {}, out = [];
    if (!sym) return out;
    doc.items.forEach(function (it) {
      if (symOf(it) !== sym.id) return;
      var key = it.grp || it.id;
      if (!by[key]) { by[key] = { g: it.grp, pg: it.pg, items: [] }; out.push(by[key]); }
      by[key].items.push(it);
    });
    return out;
  }
  // the placement an object belongs to → { sym, g, items } or null
  function groupOf(doc, it) {
    var s = it && symOf(it), sym = s && find(doc, s);
    if (!sym) return null;
    var g = instances(doc, sym.id).filter(function (x) { return x.items.indexOf(it) >= 0; })[0];
    return g ? { sym: sym, g: g.g, items: g.items } : null;
  }
  function tomb(doc, id, now) { doc.tombs = doc.tombs || {}; doc.tombs[id] = Math.max(now, doc.tombs[id] || 0); }
  // The symbol becomes what the placement holding object `id` is now;
  // every other placement follows, in its own box. → placements changed
  function redefine(doc, id, now, idf) {
    var hit = groupOf(doc, M.find(doc.items, id));
    if (!hit) return 0;
    var sym = hit.sym, keys = hit.items.map(function (it, i) { return keyOf(it) || "n" + i; });
    var d = defOf(doc, hit.items, keys), l = list(doc), oldW = sym.w, oldH = sym.h;
    var e = enc(d);
    if (!e) return -1;
    var next = l.map(function (s) { return s.id === sym.id ? Object.assign({}, s, { w: d.w, h: d.h, it: e.it, st: e.st }) : s; });
    if (bytes(next) > MAX_BYTES || !save(doc, next, now)) return -1;
    sym = find(doc, sym.id);
    var n = 0;
    hit.items.forEach(function (it, i) {
      it.ext = Object.assign({}, it.ext || {}, { sym: { s: sym.id, k: keys[i] } });
      M.touch(it, now);
    });
    instances(doc, sym.id).forEach(function (inst) {
      if (inst.items.indexOf(hit.items[0]) >= 0) return;
      var b = box(inst.items), old = {};
      // the placement's box scales the old definition's box; keep that scale
      inst.items.forEach(function (it) { old[keyOf(it)] = it; });
      var z0 = Math.min.apply(null, inst.items.map(function (it) { return it.z || 0; }));
      var kx = b.w / Math.max(0.5, oldW), ky = b.h / Math.max(0.5, oldH);
      var made = build(doc, sym, inst.pg, { x: b.x, y: b.y, w: sym.w * kx, h: sym.h * ky }, now, idf, z0, inst.g || (idf || M.newId)("gr"));
      // objects with the same key keep their id (and their story)
      var gone = {};
      made.forEach(function (it) {
        var was = old[keyOf(it)];
        if (was && was.t === it.t) {
          if (it.t === "text") {
            var ns = M.story(doc, it.story), os = M.story(doc, was.story);
            if (os && ns) { os.paras = ns.paras; M.touch(os, now); }
            doc.stories = doc.stories.filter(function (s) { return s.id !== it.story; });
            it.story = was.story;
          }
          it.id = was.id; gone[was.id] = 0;
        }
      });
      inst.items.forEach(function (it) { if (gone[it.id] !== 0) gone[it.id] = 1; });
      doc.items = doc.items.filter(function (it) { return !(it.id in gone); }).concat(made);
      Object.keys(gone).forEach(function (gid) {
        if (!gone[gid]) return;
        tomb(doc, gid, now);
        var was = inst.items.filter(function (it) { return it.id === gid; })[0];
        if (was && was.t === "text" && !doc.items.some(function (o) { return o.story === was.story; })) {
          doc.stories = doc.stories.filter(function (s) { return s.id !== was.story; });
          tomb(doc, was.story, now);
        }
      });
      n++;
    });
    return n + 1;
  }
  // a placement (the one holding `id`) becomes plain objects
  function detach(doc, id, now) {
    var hit = groupOf(doc, M.find(doc.items, id));
    if (!hit) return 0;
    hit.items.forEach(function (it) { delete it.ext.sym; if (!Object.keys(it.ext).length) delete it.ext; M.touch(it, now); });
    return hit.items.length;
  }
  // the symbol goes; its placements stay as plain objects
  function remove(doc, ref, now) {
    var sym = find(doc, ref);
    if (!sym) return 0;
    var n = 0;
    doc.items.forEach(function (it) {
      if (symOf(it) !== sym.id) return;
      delete it.ext.sym; if (!Object.keys(it.ext).length) delete it.ext;
      M.touch(it, now); n++;
    });
    save(doc, list(doc).filter(function (s) { return s.id !== sym.id; }), now);
    return n + 1;
  }
  function rename(doc, ref, name, now) {
    var sym = find(doc, ref);
    name = str(name, NAME);
    if (!sym || !name || name === sym.n) return 0;
    var other = find(doc, name);
    if (other && other.id !== sym.id) return 0;
    save(doc, list(doc).map(function (s) { return s.id === sym.id ? Object.assign({}, s, { n: name }) : s; }), now);
    return 1;
  }

  var api = { list: list, find: find, def: def, make: make, place: place, instances: instances, redefine: redefine, detach: detach, remove: remove, rename: rename, groupOf: groupOf, box: box, MAX_BYTES: MAX_BYTES, MAX_ITEMS: MAX_ITEMS };
  if (node) { module.exports = api; return; }
  root.LY_SYM = api;

  // ---------- browser: LY.symbols ----------
  var LY = root.LY;
  if (!LY) return;
  var t = LY.t, el = LY.el;
  var ERR = { few: "sym.errFew", page: "sym.errPage", big: "sym.errBig", many: "sym.errMany", name: "sym.errName" };

  // More › Symbols…
  function dialog() {
    if (!LY.doc) return;
    LY.flushStory && LY.flushStory();
    LY.openDialog(t("sym.title"), function (body, close) {
      body.appendChild(el("p", "hint", t("sym.hint")));
      var sel = (LY.ed.selItems ? LY.ed.selItems() : []), hit = sel.length ? groupOf(LY.doc, sel[0]) : null;
      if (hit && sel.some(function (it) { return hit.items.indexOf(it) < 0; })) hit = null;
      if (hit) {
        var row0 = el("div", "pn-row wrap");
        row0.appendChild(el("span", "hint", t("sym.isPlacement", { name: hit.sym.n })));
        row0.appendChild(LY.ui.btn(t("sym.redefine"), function () {
          var n = 0, id = hit.items[0].id;
          LY.op(function (d, now) { n = redefine(d, id, now); if (n <= 0) return false; });
          LY.toast(n < 0 ? t("sym.errBig") : t("sym.redefined", { n: Math.max(0, n) }));
          close();
        }, "small"));
        row0.appendChild(LY.ui.btn(t("sym.detach"), function () {
          var id = hit.items[0].id;
          LY.op(function (d, now) { if (!detach(d, id, now)) return false; });
          LY.toast(t("sym.detached"));
          close();
        }, "small"));
        body.appendChild(row0);
      } else if (sel.length) {
        var nm = el("input", "inp"); nm.type = "text"; nm.maxLength = NAME; nm.placeholder = t("sym.namePh");
        var row1 = el("div", "pn-row wrap");
        row1.appendChild(LY.ui.field(t("sym.name"), nm));
        row1.appendChild(LY.ui.btn(t("sym.make"), function () {
          var ids = sel.map(function (it) { return it.id; }), res = null;
          LY.op(function (d, now) { res = make(d, ids, nm.value, now); if (res.err) return false; });
          if (!res || res.err) { LY.toast(t(ERR[res && res.err] || "sym.errFew", { n: MAX_ITEMS })); return; }
          LY.toast(t("sym.made", { name: res.n }));
          draw();
        }, "small primary"));
        body.appendChild(row1);
      } else {
        body.appendChild(el("p", "hint", t("sym.selectFirst")));
      }
      var box0 = el("div", "sym-list");
      body.appendChild(box0);
      function draw() {
        box0.innerHTML = "";
        var l = list(LY.doc);
        if (!l.length) { box0.appendChild(el("p", "hint", t("sym.none"))); return; }
        l.forEach(function (s) {
          var row = el("div", "sym-row");
          var ni = el("input", "inp sym-n"); ni.type = "text"; ni.maxLength = NAME; ni.value = s.n;
          ni.setAttribute("aria-label", t("sym.name"));
          ni.addEventListener("change", function () {
            var ok = false;
            LY.op(function (d, now) { ok = !!rename(d, s.id, ni.value, now); if (!ok) return false; });
            if (!ok) { ni.value = s.n; if (str(ni.value, NAME)) LY.toast(t("sym.errName")); }
          });
          row.appendChild(ni);
          row.appendChild(el("span", "hint", t("sym.count", { n: instances(LY.doc, s.id).length })));
          row.appendChild(LY.ui.btn(t("sym.place"), function () {
            var P = LY.ed.curP && LY.ed.curP();
            if (!P || P.master) { LY.toast(t("sym.noPage")); return; }
            var made = [], pw = P.w, ph = P.h;
            LY.op(function (d, now) {
              var k = Math.min(1, pw / s.w, ph / s.h);
              made = place(d, s.id, P.id, (pw - s.w * k) / 2, (ph - s.h * k) / 2, now, null, k < 1 ? s.w * k : 0);
              if (!made.length) return false;
            });
            if (!made.length) { LY.toast(t("sym.errPlace")); return; }
            close();
            LY.ed.select(made.map(function (it) { return it.id; }));
          }, "small"));
          var sure = false, rm = LY.ui.btn(t("sym.delete"), function () {
            if (!sure) { sure = true; rm.textContent = t("sym.deleteSure"); return; }
            LY.op(function (d, now) { if (!remove(d, s.id, now)) return false; });
            LY.toast(t("sym.deleted", { name: s.n }));
            draw();
          }, "small");
          row.appendChild(rm);
          box0.appendChild(row);
        });
      }
      draw();
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.close"), close));
      body.appendChild(act);
    }, true);
  }

  LY.symbols = { dialog: dialog };
})(typeof window !== "undefined" ? window : this);
