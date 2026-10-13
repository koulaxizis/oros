// ============================================================
// orOS Connected services — Notes platforms (links/notes.js, v1.0.0)
// Pure: the requests that read a Notion workspace (the pages shared
// with the user's own integration, integrations wave 6D), what the
// answers mean, the page text, and the plan that brings them into
// Notes. No DOM, no storage, no network: notes/platforms.js makes the
// calls through the shell (orosLinks.call, always via the relay:
// Notion doesn't answer browsers) and notes.js applies the plan.
//   searchReq(cursor) → the POST that lists pages (100 a page)
//   readSearch(data) → { pages: [{ xid, title, parent }], next }
//   blocksReq(id, cursor) → the GET of one block's children
//   readBlocks(data) → { blocks: [{ id, type, text, … , kids }], next }
//   toText(blocks) → the page's text (Markdown-like, plain text)
//   plan(st, got, ctx) → what changes in Notes (st = its state)
//   count(plan) → { add, upd }
// The platform is only read; Notes stays the source of truth:
//   - one notebook per account ("Notion"); a page keeps its place under
//     its parent page when that page came too, else it is top level
//   - database rows are left out (they are records, not notes)
//   - ids from L.extId: a second import finds the pages again
//   - a page deleted here is not brought back unless asked
//   - an update (opt-in, off by default) replaces the title and text
//     of a page that came from Notion; labels, place and pins stay
// Everything from the platform is plain text from here on (textContent).
// ============================================================
(function (root) {
  "use strict";

  var L = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosLinksCore;

  var PLATFORMS = ["notion"];
  var PAGE = 100;
  var MAX = { pages: 300, blockPages: 5, depth: 2 };
  var TITLE_LEN = 200, TEXT_LEN = 100000, LINE_LEN = 4000;
  var ID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/;
  // blocks whose children are read too (and indented under them)
  var NEST = { bulleted_list_item: 1, numbered_list_item: 1, to_do: 1, toggle: 1, quote: 1, callout: 1,
               table: 1, column_list: 1, column: 1, synced_block: 1, paragraph: 1 };
  var FLAT = { table: 1, column_list: 1, column: 1, synced_block: 1 };   // containers: children not indented

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function nid(v) { return typeof v === "string" && ID_RE.test(v) ? v.replace(/-/g, "").toLowerCase().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5") : ""; }
  function line(v, max) { return L.cleanText(typeof v === "string" ? v : "", max); }
  function rich(arr) {
    if (!Array.isArray(arr)) return "";
    var s = arr.map(function (r) { return r && typeof r.plain_text === "string" ? r.plain_text : ""; }).join("");
    s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, " ");
    return s.length > LINE_LEN ? s.slice(0, LINE_LEN) : s;
  }
  function webUrl(v) { return typeof v === "string" && v.length <= 2048 && /^https?:\/\/[^\s]+$/i.test(v) ? v : ""; }

  var SEARCH_FILTER = { property: "object", value: "page" };
  function searchReq(cursor) {
    var body = { filter: SEARCH_FILTER, page_size: PAGE };
    if (cursor) body.start_cursor = cursor;
    return { m: "POST", path: "/search", body: body };
  }
  function blocksReq(id, cursor) {
    var b = nid(id);
    if (!b) return null;
    return { m: "GET", path: "/blocks/" + b + "/children?page_size=" + PAGE + (cursor ? "&start_cursor=" + nid(cursor) : "") };
  }
  function next(data) {
    return data && data.has_more === true ? nid(data.next_cursor) : "";
  }

  function titleOf(pg) {
    var props = pg.properties && typeof pg.properties === "object" ? pg.properties : {};
    var keys = Object.keys(props).sort();
    for (var i = 0; i < keys.length; i++) {
      var pr = props[keys[i]];
      if (pr && pr.type === "title") return line(rich(pr.title), TITLE_LEN);
    }
    return "";
  }
  function readSearch(data) {
    var list = data && Array.isArray(data.results) ? data.results : [];
    var pages = [];
    list.forEach(function (pg) {
      if (!pg || pg.object !== "page" || pg.archived === true || pg.in_trash === true) return;
      var id = nid(pg.id);
      if (!id) return;
      var par = pg.parent && typeof pg.parent === "object" ? pg.parent : {};
      if (par.type === "database_id" || par.type === "data_source_id") return;     // a database row
      pages.push({ xid: id, title: titleOf(pg), parent: par.type === "page_id" ? nid(par.page_id) : "" });
    });
    return { pages: pages, next: next(data) };
  }

  function readBlock(b) {
    if (!b || typeof b !== "object" || b.object !== "block" || b.archived === true || b.in_trash === true) return null;
    var id = nid(b.id), type = typeof b.type === "string" ? b.type : "";
    if (!id || !type) return null;
    var v = b[type] && typeof b[type] === "object" ? b[type] : {};
    var out = { id: id, type: type, text: "", kids: null, more: b.has_children === true && has(NEST, type) };
    if (Array.isArray(v.rich_text)) out.text = rich(v.rich_text);
    if (type === "to_do") out.checked = v.checked === true;
    if (type === "code") out.lang = line(v.language, 30);
    if (type === "equation") out.text = line(v.expression, LINE_LEN);
    if (type === "table_row") out.cells = (Array.isArray(v.cells) ? v.cells : []).slice(0, 30).map(rich);
    if (type === "bookmark" || type === "embed" || type === "link_preview") out.url = webUrl(v.url);
    if (type === "image" || type === "video" || type === "file" || type === "pdf" || type === "audio") {
      out.url = v.type === "external" && v.external ? webUrl(v.external.url) : "";   // Notion's own file links expire
      out.text = rich(v.caption);
    }
    if (type === "child_page" || type === "child_database") return null;           // pages come on their own
    return out;
  }
  function readBlocks(data) {
    var list = data && Array.isArray(data.results) ? data.results : [];
    var blocks = [];
    list.forEach(function (b) { var r = readBlock(b); if (r) blocks.push(r); });
    return { blocks: blocks, next: next(data) };
  }

  var MEDIA = { image: "Image", video: "Video", file: "File", pdf: "PDF", audio: "Audio" };
  function toText(blocks) {
    var out = [];
    function walk(list, depth) {
      var n = 0;
      (list || []).forEach(function (b) {
        var pad = new Array(depth + 1).join("  "), t = b.text || "", s = null;
        n = b.type === "numbered_list_item" ? n + 1 : 0;
        if (b.type === "paragraph") s = t;
        else if (b.type === "heading_1") s = "# " + t;
        else if (b.type === "heading_2") s = "## " + t;
        else if (b.type === "heading_3") s = "### " + t;
        else if (b.type === "bulleted_list_item") s = "- " + t;
        else if (b.type === "numbered_list_item") s = n + ". " + t;
        else if (b.type === "to_do") s = (b.checked ? "- [x] " : "- [ ] ") + t;
        else if (b.type === "toggle") s = "▸ " + t;
        else if (b.type === "quote" || b.type === "callout") s = "> " + t;
        else if (b.type === "code") s = "```" + (b.lang && b.lang !== "plain text" ? b.lang : "") + "\n" + t + "\n```";
        else if (b.type === "divider") s = "---";
        else if (b.type === "equation") s = t;
        else if (b.type === "table_row") s = (b.cells || []).join(" | ");
        else if (b.type === "bookmark" || b.type === "embed" || b.type === "link_preview") s = b.url || "";
        else if (has(MEDIA, b.type)) s = "[" + MEDIA[b.type] + "]" + (t ? " " + t : "") + (b.url ? " " + b.url : "");
        if (s !== null && (s !== "" || b.type === "paragraph")) out.push(s === "" ? "" : pad + s.split("\n").join("\n" + pad));
        if (b.kids && b.kids.length) walk(b.kids, has(FLAT, b.type) ? depth : depth + 1);
      });
    }
    walk(blocks, 0);
    var text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return text.length > TEXT_LEN ? text.slice(0, TEXT_LEN) : text;
  }

  // st: Notes' state { notebooks, pages, tombs }
  // got: { pages: [{ xid, title, parent, text }] } (search order)
  // ctx: { p, acct, name (the notebook's name), untitled, upd, revive }
  function plan(st, got, ctx) {
    var p = ctx.p, acct = ctx.acct;
    var notebooks = st && Array.isArray(st.notebooks) ? st.notebooks : [];
    var pages = st && Array.isArray(st.pages) ? st.pages : [];
    var tombs = st && st.tombs && typeof st.tombs === "object" ? st.tombs : {};
    var out = { notebook: null, nb: L.extId(p, acct, "notebook", "workspace"), pages: { add: [], upd: [] }, same: 0, gone: 0 };
    var byId = {};
    pages.forEach(function (pg) { if (pg && typeof pg.id === "string") byId[pg.id] = pg; });
    var haveNb = notebooks.some(function (n) { return n && n.id === out.nb; });
    var nbGone = !haveNb && has(tombs, "nb:" + out.nb) && !ctx.revive;

    var list = ((got && got.pages) || []).filter(function (x) { return x && x.xid; });
    var idOf = {}, inGot = {};
    list.forEach(function (x) { idOf[x.xid] = L.extId(p, acct, "page", x.xid); inGot[x.xid] = 1; });
    // parents first, so a child's parent is placed before it
    var placed = {}, order = [];
    function visit(x, guard) {
      if (placed[x.xid] || guard > 50) return;
      placed[x.xid] = 1;
      if (x.parent && inGot[x.parent] && !placed[x.parent]) {
        var par = list.filter(function (y) { return y.xid === x.parent; })[0];
        if (par) visit(par, guard + 1);
      }
      order.push(x);
    }
    list.forEach(function (x) { visit(x, 0); });

    var willHave = {};                              // page ids that exist here after the plan
    pages.forEach(function (pg) { willHave[pg.id] = 1; });
    var pos = {};
    order.forEach(function (x) {
      var id = idOf[x.xid], cur = byId[id];
      var title = x.title || line(ctx.untitled, TITLE_LEN) || "Untitled", text = typeof x.text === "string" ? x.text : "";
      if (cur) {
        if (ctx.upd && (cur.title !== title || (cur.text || "") !== text)) out.pages.upd.push({ id: id, title: title, text: text });
        else out.same++;
        return;
      }
      if (nbGone || (has(tombs, id) && !ctx.revive)) { out.gone++; return; }
      var parent = x.parent && inGot[x.parent] && willHave[idOf[x.parent]] ? idOf[x.parent] : null;
      var key = parent || "";
      pos[key] = (pos[key] || 0) + 1;
      willHave[id] = 1;
      out.pages.add.push({ id: id, parent: parent, title: title, text: text, pos: pos[key] });
    });
    if (out.pages.add.length && !haveNb) out.notebook = { id: out.nb, name: line(ctx.name, 60) || "Notion" };
    return out;
  }
  function count(pl) {
    return { add: (pl.notebook ? 1 : 0) + pl.pages.add.length, upd: pl.pages.upd.length };
  }

  var api = { PLATFORMS: PLATFORMS, PAGE: PAGE, MAX: MAX, NEST: NEST, SEARCH_FILTER: SEARCH_FILTER,
              searchReq: searchReq, readSearch: readSearch, blocksReq: blocksReq, readBlocks: readBlocks,
              toText: toText, plan: plan, count: count };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosLinksNotes = api;
})(typeof window !== "undefined" ? window : this);
