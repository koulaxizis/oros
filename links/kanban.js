// ============================================================
// orOS Connected services — Kanban platforms (links/kanban.js, v1.0.0)
// Pure: the requests that read a Trello board or a GitHub repository's
// issues (integrations wave 6B), and what the answers mean. No DOM, no
// storage, no network: kanban.js makes the calls through the shell
// (orosLinks.call) and feeds the result to its own Trello importer
// (trelloAdapter + the idempotent merge of "Import from other apps"),
// so a board read from the account and one from an exported file land
// the same way.
//   listReq(p, page) → the GET that lists boards / repositories
//   readList(p, data) → { items: [{ id, name }], more }
//   boardReq(p, id, page) → one GET of the board / one page of issues
//   readIssues(data) → { items, more } (pull requests left out)
//   toExport(p, id, got, names) → a Trello-export-shaped board:
//     { id, name, lists, cards, labels, checklists }
//     GitHub: two lists (open, closed; names from the app), an issue →
//     a card "#12 Title" with its body as notes, its milestone's date
//     as due, its labels, and the body's "- [ ]" / "- [x]" lines as a
//     checklist.
// Everything from the platform is plain text from here on (textContent).
// ============================================================
(function (root) {
  "use strict";

  var PLATFORMS = ["trello", "github"];
  var PAGE = 100, MAX_PAGES = { list: 10, issues: 10 };
  var TRELLO_ID = /^[0-9a-f]{24}$/, REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
  var NAME_LEN = 120, NOTE_LEN = 5000, ITEM_LEN = 300, MAX_CHECK = 50;

  function line(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  function block(v, max) {
    if (typeof v !== "string") return "";
    v = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, " ");
    v = v.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return v.length > max ? v.slice(0, max).trim() : v;
  }
  function okRepo(id) { return typeof id === "string" && REPO.test(id) && !/(^|\/)\.\.?($|\/)/.test(id); }

  function listReq(p, page) {
    if (p === "trello") return { m: "GET", path: "/members/me/boards?filter=open&fields=name" };
    return { m: "GET", path: "/user/repos?per_page=" + PAGE + "&page=" + (page || 1) + "&sort=updated" };
  }
  function readList(p, data) {
    var list = Array.isArray(data) ? data : [], items = [];
    list.forEach(function (x) {
      if (!x || typeof x !== "object") return;
      if (p === "trello") {
        if (typeof x.id === "string" && TRELLO_ID.test(x.id)) items.push({ id: x.id, name: line(x.name, NAME_LEN) || x.id });
      } else if (okRepo(x.full_name) && !x.archived) {
        items.push({ id: x.full_name, name: x.full_name });
      }
    });
    return { items: items, more: p === "github" && list.length >= PAGE };
  }
  function boardReq(p, id, page) {
    if (p === "trello") {
      if (!TRELLO_ID.test(id)) return null;
      return { m: "GET", path: "/boards/" + id + "?fields=name&lists=open&cards=open&labels=all&checklists=all" +
        "&card_fields=name,desc,due,idList,idLabels,closed,pos&list_fields=name,closed,pos" };
    }
    if (!okRepo(id)) return null;
    return { m: "GET", path: "/repos/" + id + "/issues?state=all&per_page=" + PAGE + "&page=" + (page || 1) };
  }
  function readIssues(data) {
    var list = Array.isArray(data) ? data : [];
    return { items: list.filter(function (x) { return x && typeof x === "object" && !x.pull_request && typeof x.id === "number"; }), more: list.length >= PAGE };
  }
  // "- [ ] buy milk" / "* [x] done" lines of an issue body
  function checks(body) {
    var out = [];
    String(body || "").split("\n").forEach(function (l) {
      var m = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/.exec(l);
      if (m && out.length < MAX_CHECK) { var t = line(m[2], ITEM_LEN); if (t) out.push({ name: t, done: m[1] !== " " }); }
    });
    return out;
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80); }

  // got: Trello: the board's JSON; GitHub: the issues (all pages)
  // names: { open, closed } (the app's words for the two lists)
  function toExport(p, id, got, names) {
    if (p === "trello") {
      var b = got && typeof got === "object" && !Array.isArray(got) ? got : null;
      if (!b || b.id !== id || !Array.isArray(b.lists) || !Array.isArray(b.cards)) return null;
      return {
        id: id, name: line(b.name, NAME_LEN) || "Trello",
        lists: b.lists.filter(function (l) { return l && typeof l.id === "string"; })
          .map(function (l) { return { id: l.id, name: line(l.name, NAME_LEN), closed: !!l.closed, pos: +l.pos || 0 }; })
          .sort(function (x, y) { return x.pos - y.pos; }),
        cards: b.cards.filter(function (c) { return c && typeof c.id === "string" && typeof c.idList === "string"; })
          .map(function (c) {
            return { id: c.id, name: line(c.name, NAME_LEN * 4), desc: block(c.desc, NOTE_LEN), due: typeof c.due === "string" ? c.due : null,
                     idList: c.idList, idLabels: Array.isArray(c.idLabels) ? c.idLabels.filter(function (x) { return typeof x === "string"; }) : [],
                     closed: !!c.closed, pos: +c.pos || 0 };
          })
          .sort(function (x, y) { return x.pos - y.pos; }),
        labels: (Array.isArray(b.labels) ? b.labels : []).filter(function (l) { return l && typeof l.id === "string"; })
          .map(function (l) { return { id: l.id, name: line(l.name, 60), color: typeof l.color === "string" ? l.color : "" }; }),
        checklists: (Array.isArray(b.checklists) ? b.checklists : []).filter(function (c) { return c && typeof c.idCard === "string"; })
          .map(function (c) {
            return { idCard: c.idCard, checkItems: (Array.isArray(c.checkItems) ? c.checkItems : []).slice(0, 200)
              .filter(function (i) { return i && typeof i.id === "string"; })
              .map(function (i) { return { id: i.id, name: line(i.name, ITEM_LEN), state: i.state === "complete" ? "complete" : "incomplete" }; }) };
          })
      };
    }
    if (!okRepo(id) || !Array.isArray(got)) return null;
    var bid = "gh-" + slug(id), labels = [], seen = {}, cards = [], lists = [];
    lists.push({ id: bid + "-open", name: line(names && names.open, 60) || "Open", closed: false });
    lists.push({ id: bid + "-closed", name: line(names && names.closed, 60) || "Closed", closed: false });
    var cl = [];
    got.forEach(function (x) {
      if (!x || x.pull_request || typeof x.id !== "number") return;
      var title = line(x.title, NAME_LEN * 4);
      if (!title) return;
      var cid = "gh" + x.id, ids = [];
      (Array.isArray(x.labels) ? x.labels : []).forEach(function (l) {
        if (!l || typeof l.id !== "number") return;
        var lid = "gh" + l.id;
        if (!seen[lid]) { seen[lid] = 1; labels.push({ id: lid, name: line(l.name, 60), color: "" }); }
        ids.push(lid);
      });
      var due = x.milestone && typeof x.milestone.due_on === "string" ? x.milestone.due_on : null;
      cards.push({ id: cid, name: "#" + (+x.number || 0) + " " + title, desc: block(x.body, NOTE_LEN), due: due,
                   idList: x.state === "closed" ? bid + "-closed" : bid + "-open", idLabels: ids, closed: false });
      var items = checks(x.body);
      if (items.length) cl.push({ idCard: cid, checkItems: items.map(function (it, i) { return { id: cid + "-" + i, name: it.name, state: it.done ? "complete" : "incomplete" }; }) });
    });
    return { id: bid, name: id, lists: lists, cards: cards, labels: labels, checklists: cl };
  }

  var api = { PLATFORMS: PLATFORMS, PAGE: PAGE, MAX_PAGES: MAX_PAGES, listReq: listReq, readList: readList,
              boardReq: boardReq, readIssues: readIssues, toExport: toExport, checks: checks };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosLinksKanban = api;
})(typeof window !== "undefined" ? window : this);
