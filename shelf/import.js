// ============================================================
// orOS Media Shelf — import.js ("Import from another app", v1.0.0)
// Reads the files the user exported from another tracker and turns
// them into rows for the Shelf's own import road (planImport in
// shelf.js, kind "ext"): the same duplicate check, the same preview,
// one write and Undo. Pure: no DOM, no storage.
//
// Sources (detected from CSV headers, JSON shape, XML root, zip
// entries; several files may be picked together and are merged):
//   storygraph  StoryGraph CSV export → books. Read Status: read →
//               done, currently-reading / paused → now, to-read →
//               want, did-not-finish → dropped. Dates Read ("A-B, C")
//               → a start and a finish per read; Star Rating (0.25
//               steps) → half stars; Format audio / digital → format.
//   imdb        IMDb ratings.csv / watchlist.csv (or a list .csv):
//               Title Type → film (movie, TV movie, short, video,
//               special) / series (TV series, mini series) / game
//               (video game) / podcast; episodes are skipped. Your
//               Rating 1-10 = the Shelf's half stars (done on Date
//               Rated); unrated watchlist rows → want.
//   trakt       Trakt JSON export (watched-*, ratings-*, watchlist-*,
//               history-*.json) or the ZIP. Watched movie → done on
//               last_watched_at (history: every watch); a show with
//               watched episodes → now with the episode count (done
//               when it says how many have aired and all are seen);
//               rating 1-10 → half stars; watchlist → want.
//   tvtime      TV Time GDPR export CSVs (followed_tv_show, seen_
//               episode, tracking-prod-records…): a followed show →
//               want, one with seen episodes → now + the count;
//               watched films → done.
//   mal         MyAnimeList XML (anime / manga list, .xml or .xml.gz):
//               Completed → done, Watching / Reading / On-Hold → now,
//               Plan to … → want, Dropped → dropped; anime Movie →
//               film, other anime → series (episodes), manga → book;
//               tags "anime" / "manga" and your own MAL tags.
//   discogs     Discogs collection CSV → music, done on Date Added
//               (a wantlist CSV, no CollectionFolder → want); rating
//               1-5 → stars; the first word of Format as a tag.
//   bgg         BoardGameGeek collection CSV → games (platform "board
//               game"): played or rated → done, owned / wishlist /
//               want to play → want; rating 1-10 → half stars.
// Goodreads and Letterboxd CSVs (also inside a ZIP) are handed on as
// text: shelf.js has read them since 1.1.0.
//
// Ids: "imp" + two hashes of the source id (imdb const — shared by
// IMDb and Trakt, so the same film from both is one row — trakt id,
// MAL id, discogs release_id, bgg objectid, StoryGraph ISBN/UID, TV
// Time show id or name). The Shelf's ids are [a-z0-9] only, so no
// dash. Re-importing yields the same rows; planImport skips titles
// already on the shelf.
//
// parse(files [{ name, bytes }], opts) → Promise<result>
// parseText(text, name, opts) → result (CSV / JSON / XML, sync)
//   opts: { today: "YYYY-MM-DD", board: "board game label" }
//   result: { files: [{ name, kind: "ext", list: [rows] } | { name,
//             text }], sources: [ids], skipped: n, unknown: [names] }
//   row: { id, type, title, by, year, size, fmt, plat, st, rate, fav,
//          tags, rev, rel, added, sess: [{ id, k, d, v }] }
// UMD: window.OrosShelfImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }

  var MAX_ROWS = 5000;               // titles from one import (the Shelf's cap)
  var MAX_ENTRY = 40 * 1024 * 1024;  // inflated bytes per zip entry / gzip
  var MAX_ZIP_FILES = 60;            // data files read from one zip
  var TITLE_LEN = 200, BY_LEN = 120, REV_LEN = 4000, TAG_LEN = 30, MAX_TAGS = 10;
  var RANK = { want: 0, now: 1, drop: 2, done: 3 };
  var NAMES = { storygraph: "StoryGraph", imdb: "IMDb", trakt: "Trakt", tvtime: "TV Time",
                mal: "MyAnimeList", discogs: "Discogs", bgg: "BoardGameGeek" };
  var ACCEPT = ".csv,.json,.xml,.gz,.zip,text/csv,application/json,text/xml,application/zip,application/gzip";

  // ---------- small helpers ----------
  function line(v, n) { return kit().clean(v, n); }
  function low(v) { return String(v == null ? "" : v).trim().toLowerCase(); }
  function key(v) { return low(v).replace(/[^a-z0-9]+/g, ""); }
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  }
  function idOf(k) { var h = kit().hash; return "imp" + h(k) + h("shelf|" + k); }
  function day(v) {
    var s = line(v, 80);
    if (!s || /^0000/.test(s)) return "";
    var y = kit().ymd(s);
    return y && y >= "1900-01-01" ? y : "";
  }
  function int(v, lo, hi) {
    var n = kit().num(v);
    n = isFinite(n) ? Math.round(n) : 0;
    return n >= lo && n <= hi ? n : 0;
  }
  // a rating on a 1-10 scale → the Shelf's 0-10 (half stars)
  function rate10(v) {
    var n = kit().num(v);
    return isFinite(n) && n > 0 ? Math.max(1, Math.min(10, Math.round(n))) : 0;
  }
  function addTag(r, s) {
    s = line(s, TAG_LEN).replace(/,/g, " ").trim();
    if (s && r.tags.indexOf(s) < 0 && r.tags.length < MAX_TAGS) r.tags.push(s);
  }

  // ---------- the rows being built (one per source id) ----------
  function Acc(opts) {
    this.by = {};
    this.order = [];
    this.skipped = 0;
    this.sources = [];
    this.today = opts && /^\d{4}-\d{2}-\d{2}$/.test(opts.today) ? opts.today : kit().ymd(Date.now());
    this.board = line(opts && opts.board, 40) || "Board game";
  }
  Acc.prototype.src = function (s) { if (this.sources.indexOf(s) < 0) this.sources.push(s); };
  // the row for source id k (created with the fields of `base`)
  Acc.prototype.row = function (k, base) {
    var title = line(base.title, TITLE_LEN);
    var r = this.by[k];
    if (!r) {
      if (!title || this.order.length >= MAX_ROWS) { this.skipped++; return null; }
      r = this.by[k] = {
        id: idOf(k), key: k, type: base.type, title: title, by: line(base.by, BY_LEN),
        year: int(base.year, 1, 9999), size: 0, fmt: "", plat: "", st: "want", rate: 0, fav: 0,
        tags: [], rev: "", rel: "", added: "", sess: [], at: {}, eps: null
      };
      this.order.push(k);
    } else {
      if (!r.by && base.by) r.by = line(base.by, BY_LEN);
      if (!r.year && base.year) r.year = int(base.year, 1, 9999);
    }
    return r;
  };
  function status(r, st) { if (RANK[st] > RANK[r.st]) r.st = st; }
  function added(r, d) { if (d && (!r.added || d < r.added)) r.added = d; }
  // a dated entry in the title's history: s start, d done, x drop, p progress
  function log(r, k, d, v) {
    if (!d) return;
    var sid = idOf(r.key + "|" + k + "|" + d + (k === "p" ? "|" + v : ""));
    if (r.sess.some(function (s) { return s.id === sid; })) return;
    var s = { id: sid, k: k, d: d };
    if (k === "p") s.v = v;
    r.sess.push(s);
  }
  // a date to use for the status entry when the file has no better one
  function hint(r, k, d) { if (d && (!r.at[k] || d > r.at[k])) r.at[k] = d; }

  // Every row gets the history entry its status needs (as the
  // Goodreads import does): done → a finish, now → a start, dropped →
  // a drop, on the best date known, else today.
  Acc.prototype.result = function (files, unknown) {
    var today = this.today, list = [], self = this;
    this.order.forEach(function (k) {
      var r = self.by[k];
      if (r.eps) {
        var n = Object.keys(r.eps.seen).length;
        if (n) {
          if (r.type === "series" && n > r.size && r.size) r.size = n;
          if (r.eps.total && n >= r.eps.total) { status(r, "done"); hint(r, "d", r.eps.last); }
          else {
            status(r, "now");
            hint(r, "s", r.eps.first);
            if (r.st === "now") log(r, "p", r.eps.last || today, Math.min(n, 100000));
          }
        }
      }
      var has = function (kk) { return r.sess.some(function (s) { return s.k === kk; }); };
      if (r.st === "done" && !has("d")) log(r, "d", r.at.d || r.added || today);
      if (r.st === "now" && !has("s")) log(r, "s", r.at.s || r.added || today);
      if (r.st === "drop" && !has("x")) log(r, "x", r.at.x || r.added || today);
      if (r.type === "book" && !r.fmt) r.fmt = "p";
      list.push({
        id: r.id, type: r.type, title: r.title, by: r.by, year: r.year, size: r.size, fmt: r.fmt, plat: r.plat,
        st: r.st, rate: r.rate, fav: r.fav, tags: r.tags, rev: r.rev, rel: r.rel, added: r.added,
        sess: r.sess.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; })
      });
    });
    var names = this.sources.map(function (s) { return NAMES[s] || s; }).join(" + ");
    if (list.length || this.sources.length) files.unshift({ name: names || "?", kind: "ext", list: list });
    return { files: files, sources: this.sources.slice(), skipped: this.skipped, unknown: unknown };
  };

  // ---------- StoryGraph ----------
  function storygraph(A, rows) {
    A.src("storygraph");
    rows.forEach(function (o) {
      var g = function (n) { return kit().get(o, n); };
      var title = g(["Title"]), by = g(["Authors", "Author"]);
      var uid = line(g(["ISBN/UID", "ISBN", "UID"]), 40);
      var r = A.row(uid ? "sg|" + uid : "sg|" + fold(title) + "|" + fold(by), { type: "book", title: title, by: by });
      if (!r) return;
      var rs = low(g(["Read Status", "Status"]));
      var st = rs === "read" ? "done" : (rs === "currently-reading" || rs === "paused") ? "now" :
               /did-?not-?finish|dnf/.test(rs) ? "drop" : "want";
      status(r, st);
      var fm = low(g(["Format"]));
      r.fmt = /audio/.test(fm) ? "a" : /digital|ebook|e-book|kindle/.test(fm) ? "e" : "p";
      var star = kit().num(g(["Star Rating", "Rating"]));
      if (isFinite(star) && star > 0) r.rate = Math.max(1, Math.min(10, Math.round(star * 2)));
      added(r, day(g(["Date Added"])));
      var last = day(g(["Last Date Read"]));
      // "2023/01/02-2023/01/15, 2024/05/01" → one read per piece
      String(g(["Dates Read"]) || "").split(/[,;]/).forEach(function (piece) {
        var ds = (piece.match(/\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}/g) || []).map(day).filter(Boolean);
        if (!ds.length) return;
        var end = ds[ds.length - 1];
        if (ds.length > 1) log(r, "s", ds[0]);
        if (st === "done") log(r, "d", end);
        else if (ds.length === 1) log(r, "s", end);
      });
      if (st === "done") hint(r, "d", last);
      if (st === "drop") hint(r, "x", last);
      String(g(["Tags"]) || "").split(",").forEach(function (x) { addTag(r, x); });
      var rev = kit().cleanText(g(["Review"]), REV_LEN);
      if (rev && !r.rev) r.rev = rev;
    });
  }

  // ---------- IMDb ----------
  var IMDB_TYPE = { movie: "film", tvmovie: "film", short: "film", tvshort: "film", video: "film", tvspecial: "film",
                    feature: "film", tvseries: "series", tvminiseries: "series", videogame: "game", podcastseries: "podcast" };
  function imdb(A, rows, isWatch) {
    A.src("imdb");
    rows.forEach(function (o) {
      var g = function (n) { return kit().get(o, n); };
      var tp = IMDB_TYPE[key(g(["Title Type", "Type"]))];
      var cst = line(g(["Const", "tconst"]), 20);
      if (!tp || !/^tt\d{1,12}$/.test(cst)) { A.skipped++; return; }
      var r = A.row("imdb|" + cst, { type: tp, title: g(["Title"]) || g(["Original Title"]),
        by: tp === "film" ? g(["Directors", "Director"]) : "", year: g(["Year"]) });
      if (!r) return;
      if (tp === "film" && !r.size) r.size = int(g(["Runtime (mins)", "Runtime"]), 0, 100000);
      var rel = day(g(["Release Date"]));
      if (rel && !r.rel) r.rel = rel;
      var rt = rate10(g(["Your Rating"]));
      added(r, day(g(["Created", "Date Added"])));
      if (rt) {
        r.rate = rt;
        status(r, "done");
        hint(r, "d", day(g(["Date Rated"])));
      } else if (!isWatch) status(r, "done");
    });
  }

  // ---------- Trakt ----------
  function traktItem(A, x) {
    var tp = x && (x.movie ? "movie" : x.show ? "show" : "");
    if (!tp || (x.type && x.type !== tp && x.type !== "episode")) { A.skipped++; return null; }
    var m = x[tp] || {}, ids = m.ids || {};
    var k = typeof ids.imdb === "string" && /^tt\d{1,12}$/.test(ids.imdb) ? "imdb|" + ids.imdb :
            isFinite(+ids.trakt) && +ids.trakt > 0 ? "trakt|" + tp + "|" + (+ids.trakt) :
            "trakt|" + tp + "|" + fold(m.title) + "|" + (m.year || "");
    var r = A.row(k, { type: tp === "movie" ? "film" : "series", title: m.title, year: m.year });
    if (r && tp === "show" && x.type !== "episode" && isFinite(+m.aired_episodes) && +m.aired_episodes > 0) {
      r.size = Math.min(100000, +m.aired_episodes);
    }
    return r;
  }
  function eps(r) { return r.eps || (r.eps = { seen: {}, first: "", last: "", total: 0 }); }
  function epSeen(r, id, d) {
    var e = eps(r);
    e.seen[id] = 1;
    if (d && (!e.first || d < e.first)) e.first = d;
    if (d && d > e.last) e.last = d;
  }
  function trakt(A, arr, name) {
    A.src("trakt");
    var nm = low(name);
    arr.forEach(function (x) {
      if (!x || typeof x !== "object") return;
      // seasons and episodes count only as watched episodes of a show (history)
      if (x.type === "season" || (x.type === "episode" && !(x.show && x.watched_at))) { A.skipped++; return; }
      var r = traktItem(A, x);
      if (!r) return;
      if (x.type === "episode") {
        var ep = x.episode || {};
        epSeen(r, (ep.season || 0) + "x" + (ep.number || 0), day(x.watched_at));
        return;
      }
      if (/watchlist/.test(nm) || (x.listed_at && !x.rating && !x.last_watched_at && !x.watched_at)) {
        status(r, "want");
        added(r, day(x.listed_at));
        return;
      }
      if (x.rating != null && (/rating/.test(nm) || x.rated_at)) {
        var rt = rate10(x.rating);
        if (rt) r.rate = rt;
        status(r, "done");
        hint(r, "d", day(x.rated_at));
        return;
      }
      if (x.watched_at && x.movie) { status(r, "done"); log(r, "d", day(x.watched_at)); return; }
      if (x.show && Array.isArray(x.seasons)) {
        if (isFinite(+x.show.aired_episodes) && +x.show.aired_episodes > 0) eps(r).total = +x.show.aired_episodes;
        x.seasons.forEach(function (s) {
          (s && Array.isArray(s.episodes) ? s.episodes : []).forEach(function (e) {
            if (e && isFinite(+e.number)) epSeen(r, (+s.number || 0) + "x" + (+e.number), day(e.last_watched_at) || day(x.last_watched_at));
          });
        });
        if (!r.eps || !Object.keys(r.eps.seen).length) { status(r, "done"); hint(r, "d", day(x.last_watched_at)); }
        return;
      }
      if (x.last_watched_at || x.plays) {
        status(r, "done");
        if (day(x.last_watched_at)) log(r, "d", day(x.last_watched_at));
        return;
      }
      A.skipped++;
    });
  }

  // ---------- TV Time ----------
  var TVT_SHOW = ["tv_show_name", "series_name", "show_name", "tv show name", "series"];
  var TVT_SHOW_ID = ["tv_show_id", "series_id", "show_id", "tvdb_id", "s_id"];
  var TVT_MOVIE = ["movie_name", "movie_title", "film_name"];
  function tvtime(A, rows, name) {
    A.src("tvtime");
    var nm = low(name);
    rows.forEach(function (o) {
      var g = function (n) { return kit().get(o, n); };
      var show = line(g(TVT_SHOW), TITLE_LEN), movie = line(g(TVT_MOVIE), TITLE_LEN);
      var d = day(g(["created_at", "updated_at", "date", "watched_at", "seen_at"]));
      var kind = low(g(["type", "action", "event", "status"]));
      if (show) {
        var sid = line(g(TVT_SHOW_ID), 20);
        var r = A.row(sid && /^\d+$/.test(sid) ? "tvtime|" + sid : "tvtime|" + fold(show), { type: "series", title: show });
        if (!r) return;
        var epn = line(g(["episode_number", "episode", "episode_id", "number"]), 20);
        var sn = line(g(["season_number", "season", "episode_season_number"]), 10);
        if (/fav/.test(kind) || /^(1|true|yes)$/.test(low(g(["is_favorite", "favorite"])))) r.fav = 1;
        if (epn && !/follow|want|towatch|watchlist/.test(kind)) epSeen(r, (sn || "0") + "x" + epn, d);
        else added(r, d);
        if (/seen_episode|watched_episode/.test(nm) && !epn) epSeen(r, "row" + Object.keys(eps(r).seen).length, d);
        return;
      }
      if (movie) {
        var f = A.row("tvtime|movie|" + fold(movie), { type: "film", title: movie,
          year: g(["movie_year", "year", "release_year"]) });
        if (!f) return;
        if (/follow|want|towatch|watchlist/.test(kind)) { status(f, "want"); added(f, d); }
        else { status(f, "done"); log(f, "d", d || A.today); }
        return;
      }
      A.skipped++;
    });
  }

  // ---------- MyAnimeList (XML) ----------
  function xmlText(s) {
    s = String(s || "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d{1,7});/g, function (m, n) { n = +n; return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; })
      .replace(/&#x([0-9a-f]{1,6});/gi, function (m, n) { n = parseInt(n, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; })
      .replace(/&amp;/g, "&");
  }
  function xmlField(block, tag) {
    var m = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">").exec(block);
    return m ? xmlText(m[1]).trim() : "";
  }
  var MAL_NUM = { 1: "now", 2: "done", 3: "now", 4: "drop", 6: "want" };
  function mal(A, text) {
    A.src("mal");
    var re = /<(anime|manga)>([\s\S]*?)<\/\1>/g, m, n = 0;
    while ((m = re.exec(text)) && n++ < MAX_ROWS * 2) {
      var isA = m[1] === "anime", b = m[2];
      var id = xmlField(b, isA ? "series_animedb_id" : "manga_mangadb_id");
      var title = xmlField(b, isA ? "series_title" : "manga_title");
      var stype = low(xmlField(b, "series_type"));
      var tp = isA ? (stype === "movie" ? "film" : "series") : "book";
      var r = A.row("mal|" + m[1] + "|" + (/^\d+$/.test(id) ? id : fold(title)), { type: tp, title: title });
      if (!r) continue;
      var ms = low(xmlField(b, "my_status"));
      var st = MAL_NUM[ms] || (/complet/.test(ms) ? "done" : /watching|reading|on-?hold/.test(ms) ? "now" :
               /drop/.test(ms) ? "drop" : "want");
      status(r, st);
      addTag(r, isA ? "anime" : "manga");
      xmlField(b, "my_tags").split(",").forEach(function (x) { addTag(r, x); });
      var sc = rate10(xmlField(b, "my_score"));
      if (sc) r.rate = sc;
      if (tp === "series") r.size = int(xmlField(b, "series_episodes"), 0, 100000);
      var start = day(xmlField(b, "my_start_date")), fin = day(xmlField(b, "my_finish_date"));
      if (start && st !== "want") log(r, "s", start);
      hint(r, "d", fin);
      hint(r, "x", fin || start);
      var seen = int(xmlField(b, "my_watched_episodes"), 0, 100000);
      if (tp === "series" && st === "now" && seen) log(r, "p", start || A.today, seen);
      var com = kit().cleanText(xmlField(b, "my_comments"), REV_LEN);
      if (com && !r.rev) r.rev = com;
    }
  }

  // ---------- Discogs ----------
  function discogs(A, rows, head) {
    A.src("discogs");
    var coll = kit().col(head, ["CollectionFolder", "Collection Folder"]) >= 0;
    rows.forEach(function (o) {
      var g = function (n) { return kit().get(o, n); };
      var rid = line(g(["release_id", "Release ID"]), 20);
      var artist = line(g(["Artist"]), BY_LEN).replace(/\s\(\d+\)(?=$|,)/g, "");
      var title = g(["Title"]);
      var r = A.row(/^\d+$/.test(rid) ? "discogs|" + rid : "discogs|" + fold(artist) + "|" + fold(title),
        { type: "album", title: title, by: artist, year: String(g(["Released", "Year"]) || "").slice(0, 4) });
      if (!r) return;
      var d = day(g(["Date Added"]));
      added(r, d);
      status(r, coll ? "done" : "want");
      if (coll) hint(r, "d", d);
      var rt = int(g(["Rating"]), 0, 5);
      if (rt) r.rate = rt * 2;
      addTag(r, line(g(["Format"]), 60).split(/[,\s]/)[0]);
    });
  }

  // ---------- BoardGameGeek ----------
  function bgg(A, rows) {
    A.src("bgg");
    rows.forEach(function (o) {
      var g = function (n) { return kit().get(o, n); };
      var on = function (n) { return /^(1|true|yes)$/.test(low(g([n]))); };
      var oid = line(g(["objectid"]), 20);
      var plays = int(g(["numplays"]), 0, 1e6), rt = rate10(g(["rating"]));
      var wanted = on("own") || on("wishlist") || on("wanttoplay") || on("want") || on("wanttobuy") || on("preordered");
      if (!plays && !rt && !wanted) { A.skipped++; return; }
      var r = A.row(/^\d+$/.test(oid) ? "bgg|" + oid : "bgg|" + fold(g(["objectname"])),
        { type: "game", title: g(["objectname", "originalname"]), year: g(["yearpublished"]) });
      if (!r) return;
      r.plat = A.board;
      if (rt) r.rate = rt;
      status(r, plays || rt ? "done" : "want");
      var d = day(g(["acquisitiondate"]));
      added(r, d);
      hint(r, "d", d);
      var com = kit().cleanText(g(["comment"]), REV_LEN);
      if (com && !r.rev) r.rev = com;
    });
  }

  // ---------- one file ----------
  var SIGS = [
    { id: "storygraph", need: ["Title", "Authors", "Read Status"] },
    { id: "imdb", need: ["Const", "Title Type"] },
    { id: "imdb", need: ["Const", "Your Rating"] },
    { id: "discogs", need: ["release_id", "Artist", "Title"] },
    { id: "bgg", need: ["objectname", "objectid"] }
  ];
  // inZip: a CSV nobody knows is left out quietly (an export zip holds
  // many other files); a picked one goes on to shelf.js, which names it
  function csvFile(A, text, name, files, inZip) {
    var t = kit().records(text, { maxRows: 50000 });
    var src = kit().detect(t.head, SIGS);
    if (!src && (kit().col(t.head, TVT_SHOW) >= 0 || kit().col(t.head, TVT_MOVIE) >= 0)) src = "tvtime";
    if (src === "storygraph") storygraph(A, t.rows);
    else if (src === "imdb") imdb(A, t.rows, kit().col(t.head, ["Position"]) >= 0 || /watchlist/.test(low(name)));
    else if (src === "discogs") discogs(A, t.rows, t.head);
    else if (src === "bgg") bgg(A, t.rows);
    else if (src === "tvtime") tvtime(A, t.rows, name);
    else if (!inZip || /Letterboxd URI|Exclusive Shelf/.test(text.slice(0, 2000))) files.push({ name: name, text: text });
  }
  // Goodreads / Letterboxd (or unknown) CSVs go to shelf.js as text
  function textFile(A, text, name, files, unknown, inZip) {
    var s = String(text || "").replace(/^﻿/, "");
    var head = s.slice(0, 2000).replace(/^\s+/, "");
    if (head.charAt(0) === "<") {
      if (/<myanimelist[\s>]/.test(s.slice(0, 5000))) mal(A, s);
      else if (!inZip) unknown.push(name);
      return;
    }
    if (head.charAt(0) === "[" || head.charAt(0) === "{") {
      var j = kit().json(s);
      var arr = Array.isArray(j) ? j : null;
      if (arr && arr.some(function (x) { return x && typeof x === "object" && (x.movie || x.show); })) trakt(A, arr, name);
      else if (!inZip && (!arr || arr.length)) unknown.push(name);
      return;
    }
    csvFile(A, s, name, files, inZip);
  }
  function parseText(text, name, opts) {
    var A = new Acc(opts), files = [], unknown = [];
    textFile(A, text, line(name, 120), files, unknown);
    return A.result(files, unknown);
  }

  // ---------- bytes: zip, gzip, text ----------
  function gunzip(bytes) {
    if (typeof DecompressionStream !== "function") return Promise.reject(new Error("gzip"));
    var ds = new DecompressionStream("gzip"), w = ds.writable.getWriter();
    w.write(bytes).then(null, function () {});
    w.close().then(null, function () {});
    var reader = ds.readable.getReader(), parts = [], total = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total), o = 0;
          parts.forEach(function (c) { out.set(c, o); o += c.length; });
          return out;
        }
        total += r.value.length;
        if (total > MAX_ENTRY) { try { reader.cancel(); } catch (e) {} throw new Error("toobig"); }
        parts.push(r.value);
        return pump();
      });
    }
    return pump();
  }
  var DATA_RE = /\.(csv|json|xml)$/i;
  function parse(list, opts) {
    var A = new Acc(opts), files = [], unknown = [];
    list = (Array.isArray(list) ? list : [list]).filter(Boolean);
    return list.reduce(function (p, f) {
      return p.then(function () {
        var name = line(f.name, 120), b = f.bytes;
        if (typeof b === "string") { textFile(A, b, name, files, unknown); return; }
        if (kit().isZip(b)) {
          var z;
          try { z = kit().unzip(b); } catch (e) { unknown.push(name); return; }
          var names = z.names.filter(function (n) { return DATA_RE.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n); }).slice(0, MAX_ZIP_FILES);
          if (!names.length) { unknown.push(name); return; }
          var before = A.order.length + files.length;
          return names.reduce(function (q, n) {
            return q.then(function () {
              if (z.size(n) > MAX_ENTRY) { unknown.push(n); return; }
              return z.text(n, MAX_ENTRY).then(function (txt) {
                textFile(A, txt || "", n.split("/").pop(), files, unknown, true);
              }, function () { unknown.push(n); });
            });
          }, Promise.resolve()).then(function () {
            if (A.order.length + files.length === before) unknown.push(name);
          });
        }
        if (b && b[0] === 0x1f && b[1] === 0x8b) {
          return gunzip(b).then(function (raw) {
            textFile(A, kit().text(raw), name.replace(/\.gz$/i, ""), files, unknown);
          }, function () { unknown.push(name); });
        }
        textFile(A, kit().text(b), name, files, unknown);
      });
    }, Promise.resolve()).then(function () { return A.result(files, unknown); });
  }

  var api = { parse: parse, parseText: parseText, idOf: idOf, NAMES: NAMES, ACCEPT: ACCEPT, MAX_ROWS: MAX_ROWS };
  if (NODE) module.exports = api;
  else root.OrosShelfImport = api;
})(typeof self !== "undefined" ? self : this);
