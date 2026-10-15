// ============================================================
// orOS Notes — .orosnotes package (notes/package.js,
// window.OrosNotesPackage). One notebook = one orOS bundle
// (../bundle.js, docs/oros-bundle.md). Pure (no DOM, no storage),
// so the app and `node --test` run the same code:
//   build(data, nbId)   the notebook in the app's own model →
//                       { content, preview[], title, created, modified }
//     content = { kind: "oros-notes-package", ver: 1,
//                 notebook { id, name, mtime, pos },
//                 labels [{ id, name, color, mtime, pos }],
//                 pages  [{ id, parent, title, text, mtime, pos,
//                           labels[], pinned }] }
//     preview = index.md (the outline, linked) + pages/NNN-slug.md,
//               one Markdown file per page, depth-first order
//   parse(content, o)   content.json → the payload the app's import
//                       writes (importApply): a NEW notebook, fresh
//                       ids for it, its pages and labels, parents and
//                       labels remapped; everything else dropped.
//                       Throws Error("notpackage") for anything else.
// Notes pages are plain Markdown text with no pictures (md.js renders
// no images), so a notebook has no media/.
// ============================================================
(function (root) {
  "use strict";

  var KIND = "oros-notes-package", VER = 1;
  var LIM = { pages: 5000, text: 1024 * 1024, title: 200, name: 120, labels: 500 };
  var COLOR_RE = /^#[0-9a-f]{6}$/i;

  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function oneLine(v, max) { return str(v, max * 2).replace(/\s+/g, " ").trim().slice(0, max); }

  // Depth-first, the tree's own order: pinned first, then pos, then title.
  function ordered(pages) {
    var byParent = {}, ids = {};
    pages.forEach(function (p) { ids[p.id] = true; });
    pages.forEach(function (p) {
      var k = p.parent && ids[p.parent] ? p.parent : "";
      (byParent[k] = byParent[k] || []).push(p);
    });
    Object.keys(byParent).forEach(function (k) {
      byParent[k].sort(function (a, b) {
        var ap = a.pinned ? 1 : 0, bp = b.pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return (a.pos || 0) - (b.pos || 0) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
      });
    });
    var out = [], seen = {};
    (function walk(k, depth) {
      (byParent[k] || []).forEach(function (p) {
        if (seen[p.id] || depth > 50) return;
        seen[p.id] = true;
        out.push({ page: p, depth: depth });
        walk(p.id, depth + 1);
      });
    })("", 0);
    // pages a cycle hid from the walk still go in, at the top level
    pages.forEach(function (p) { if (!seen[p.id]) out.push({ page: p, depth: 0 }); });
    return out;
  }

  // A preview file name: ASCII only (bundle paths are printable ASCII).
  var GR = { "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th", "ι": "i", "κ": "k",
    "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s", "ς": "s", "τ": "t", "υ": "y",
    "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o" };
  function slug(s) {
    var t = String(s || "").toLowerCase();
    if (t.normalize) t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    t = t.replace(/[α-ω]|ς/g, function (c) { return GR[c] || ""; });
    return t.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  }

  function pageMd(title, text) {
    var t = oneLine(title, LIM.title);
    return (t ? "# " + t + "\n\n" : "") + String(text || "").replace(/\s+$/, "") + "\n";
  }

  function build(data, nbId) {
    data = data || {};
    var nb = (data.notebooks || []).filter(function (n) { return n && n.id === nbId; })[0];
    if (!nb) throw new Error("nonotebook");
    var pages = (data.pages || []).filter(function (p) { return p && p.nb === nbId && typeof p.id === "string"; });
    var labels = (data.labels || []).filter(function (l) { return l && l.nb === nbId && typeof l.id === "string"; });
    var list = ordered(pages);
    var created = 0, modified = num(nb.mtime);
    pages.forEach(function (p) {
      var m = num(p.mtime);
      if (m > modified) modified = m;
      if (m && (!created || m < created)) created = m;
    });
    var content = {
      kind: KIND, ver: VER,
      notebook: { id: nb.id, name: str(nb.name, LIM.name), mtime: num(nb.mtime), pos: num(nb.pos) },
      labels: labels.map(function (l) {
        return { id: l.id, name: str(l.name, LIM.name), color: str(l.color, 7), mtime: num(l.mtime), pos: num(l.pos) };
      }),
      pages: list.map(function (e) {
        var p = e.page;
        return { id: p.id, parent: typeof p.parent === "string" ? p.parent : null, title: str(p.title, LIM.title),
          text: typeof p.text === "string" ? p.text : "", mtime: num(p.mtime), pos: num(p.pos),
          labels: Array.isArray(p.labels) ? p.labels.filter(function (x) { return typeof x === "string"; }) : [],
          pinned: !!p.pinned };
      })
    };
    // preview: one .md per page, and an index.md outline that links them
    var preview = [], index = ["# " + (oneLine(nb.name, LIM.name) || "Notes"), ""];
    var width = String(list.length).length < 3 ? 3 : String(list.length).length;
    list.forEach(function (e, i) {
      var n = String(i + 1);
      while (n.length < width) n = "0" + n;
      var file = "pages/" + n + "-" + (slug(e.page.title) || "page") + ".md";
      preview.push({ name: file, data: pageMd(e.page.title, e.page.text), type: "text/markdown" });
      var label = oneLine(e.page.title, LIM.title).replace(/[\[\]]/g, "") || "—";
      index.push(new Array(e.depth + 1).join("  ") + "- [" + label + "](" + file + ")");
    });
    index.push("", "---", "", "Made with orOS | useoros.online", "");
    preview.unshift({ name: "index.md", data: index.join("\n"), type: "text/markdown" });
    return { content: content, preview: preview, title: content.notebook.name,
      created: created || modified || 0, modified: modified || 0 };
  }

  // o: { uid(prefix) → a fresh id, colors [allowed label colours],
  //      name (fallback notebook name), untitled }
  function parse(content, o) {
    o = o || {};
    var c = content;
    if (!c || typeof c !== "object" || c.kind !== KIND || !Array.isArray(c.pages)) throw new Error("notpackage");
    var used = {};
    function fresh(prefix) {
      var id;
      do { id = o.uid ? o.uid(prefix) : prefix + Math.random().toString(36).slice(2, 12); } while (used[id]);
      used[id] = true;
      return id;
    }
    var colors = Array.isArray(o.colors) ? o.colors : [];
    var nb = c.notebook && typeof c.notebook === "object" ? c.notebook : {};
    var nbId = fresh("nb");
    var out = {
      notebook: { id: nbId, name: oneLine(nb.name, LIM.name) || o.name || "Notes" },
      nb: nbId, labels: [], pages: { add: [], upd: [] }, capped: 0
    };
    var lmap = {};
    (Array.isArray(c.labels) ? c.labels : []).slice(0, LIM.labels).forEach(function (l) {
      if (!l || typeof l.id !== "string" || lmap[l.id]) return;
      var name = oneLine(l.name, LIM.name);
      if (!name) return;
      var col = COLOR_RE.test(l.color || "") ? String(l.color).toLowerCase() : "";
      if (colors.length && colors.indexOf(col) < 0) col = "";
      lmap[l.id] = fresh("l");
      out.labels.push({ id: lmap[l.id], name: name, color: col || null, pos: num(l.pos) });
    });
    var src = c.pages.filter(function (p) { return p && typeof p === "object" && typeof p.id === "string"; });
    var pmap = {};
    src.forEach(function (p) { if (!pmap[p.id]) pmap[p.id] = null; });
    var keep = [];
    src.forEach(function (p) {
      if (pmap[p.id] !== null) return;            // a twin id: the first one wins
      if (keep.length >= LIM.pages) { out.capped++; return; }
      pmap[p.id] = fresh("p");
      keep.push(p);
    });
    keep.forEach(function (p) {
      var seen = {};
      out.pages.add.push({
        id: pmap[p.id],
        parent: typeof p.parent === "string" && pmap[p.parent] && p.parent !== p.id ? pmap[p.parent] : null,
        title: oneLine(p.title, LIM.title) || o.untitled || "Untitled",
        text: str(p.text, LIM.text).replace(/\r\n?/g, "\n"),
        pos: num(p.pos),
        labels: (Array.isArray(p.labels) ? p.labels : []).filter(function (x) {
          if (typeof x !== "string" || !lmap[x] || seen[x]) return false;
          return (seen[x] = true);
        }).map(function (x) { return lmap[x]; }),
        pinned: !!p.pinned
      });
    });
    return out;
  }

  var api = { KIND: KIND, VER: VER, LIMITS: LIM, build: build, parse: parse, slug: slug, ordered: ordered };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosNotesPackage = api;
})(this);
