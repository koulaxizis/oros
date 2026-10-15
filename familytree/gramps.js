// ============================================================
// orOS Family Tree — gramps.js (pure logic: Gramps XML import)
// Reads a Gramps family tree export as DATA only (nothing is run,
// nothing becomes HTML; no DOM, no entity expansion, no DTD):
//   - .gramps  Gramps › Family Trees › Export… › "Gramps XML": the
//              XML below, gzip-compressed
//   - .xml     the same XML, not compressed
//   <database>
//     <events><event handle><type>Birth|Death|Burial|Marriage|…
//       <dateval val="1950-03-02" type="about" quality/> (or
//       <daterange start stop/>, <datespan …/>, <datestr val/>)
//       <place hlink/><description/></event></events>
//     <people><person handle id><gender>M|F|U</gender>
//       <name type alt><first/><surname prefix/><suffix/></name>
//       <eventref hlink role/><childof hlink/><parentin hlink/>
//       <noteref hlink/></person></people>
//     <families><family handle><rel type/><father hlink/>
//       <mother hlink/><eventref hlink/><childref hlink frel mrel/>
//       </family></families>
//     <places><placeobj handle><pname value/><placeref hlink/>
//       </placeobj></places>
//     <notes><note handle><text/></note></notes>
//   </database>
// The rows go through Family Tree's own GEDCOM path (FTCore
// normalizers + checkRows: broken links and loops cut and counted),
// so the preview, merge and Undo are the GEDCOM ones.
// Stable ids: "imp-" + hashes of the Gramps handle (people and
// families), so importing the same file again adds only the people
// and families not there yet, into the tree they went to the first
// time; a person or family already here is never changed.
// Kept: names (birth name when the main one is a married name), sex,
// birth, death (burial / cremation = died), places (with the places
// they lie in), person notes, couples (married, partners, divorced,
// with marriage / divorce dates) and children (birth, adopted, step,
// foster). Left out: sources, media, other events, attributes,
// addresses, family notes, repositories, tags.
//   sniff(bytes, name)       → true for a Gramps file
//   decode(bytes)            → Promise<string> (gunzip when needed)
//   xml(text)                → element tree { n, a, k, t } | null
//   read(text)               → { people, families, events, places,
//                                notes } (by handle) | { error }
//   parse(text, local, opts) → as FTCore.parseGedcom: { ok, data,
//                                stats: { …, have }, into } | { ok:
//                                false, err }; opts = { name, now,
//                                newId }
// Caps: file size, inflated size, XML nodes, depth, people, text.
// Needs FTCore (ft-core.js) and OrosImportKit (../importkit.js).
// UMD: window.OrosGramps in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  var FT = NODE ? require("./ft-core.js") : root.FTCore;
  var K = NODE ? require("../importkit.js") : root.OrosImportKit;

  var MAX_FILE = 15 * 1024 * 1024;      // the file as picked
  var MAX_XML = 80 * 1024 * 1024;       // inflated bytes / characters
  var MAX_NODES = 3000000;
  var MAX_DEPTH = 64;
  var MAX_TEXT = 100000;                // characters in one element
  var MAX_PLACE_UP = 8;                 // "City, Region, Country"

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function dict() { return Object.create(null); }
  function sid(kind, h) { return "imp-" + K.hash(kind + "|" + h) + K.hash(h + "|" + kind + "#"); }

  // ---------- 1. Bytes ----------
  function isGzip(b) { return !!b && b.length > 2 && b[0] === 0x1f && b[1] === 0x8b; }
  function sniff(bytes, name) {
    if (/\.gramps$/i.test(name || "")) return true;
    if (isGzip(bytes)) return true;
    var head = "";
    for (var i = 0; i < Math.min(bytes ? bytes.length : 0, 2048); i++) head += String.fromCharCode(bytes[i] < 0x80 ? bytes[i] : 0x3f);
    return /^(\?\?\?)?\s*<(\?xml|!DOCTYPE\s+database|database)/i.test(head) && /<database/i.test(head);
  }
  // gzip → bytes, capped: zlib in Node, DecompressionStream in the
  // browser (read chunk by chunk, stopped as soon as it is too big)
  function inflate(bytes, max) {
    max = max || MAX_XML;
    if (NODE) {
      return new Promise(function (resolve, reject) {
        try { resolve(new Uint8Array(require("zlib").gunzipSync(Buffer.from(bytes), { maxOutputLength: max }))); }
        catch (e) { reject(new Error(e && e.code === "ERR_BUFFER_TOO_LARGE" ? "toobig" : "gzip")); }
      });
    }
    if (typeof DecompressionStream !== "function") return Promise.reject(new Error("gzip"));
    var reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    var parts = [], total = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total), at = 0;
          parts.forEach(function (p) { out.set(p, at); at += p.length; });
          return out;
        }
        total += r.value.length;
        if (total > max) { try { reader.cancel(); } catch (e) {} throw new Error("toobig"); }
        parts.push(r.value);
        return pump();
      });
    }
    return pump().catch(function (e) { throw new Error(e && e.message === "toobig" ? "toobig" : "gzip"); });
  }
  function decode(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var p = isGzip(b) ? inflate(b, MAX_XML) : Promise.resolve(b);
    return p.then(function (u) {
      if (u.length > MAX_XML) throw new Error("toobig");
      return K.text(u);
    });
  }

  // ---------- 2. XML (a small, tolerant tokenizer) ----------
  // Elements only: { n: local name, a: { attr: value }, k: [kids],
  // t: text }. Comments, <?…?>, <!DOCTYPE …> are skipped; entities
  // are the five predefined ones and &#…; (nothing is expanded from
  // a DTD, nothing is fetched). Unclosed or stray tags are forgiven.
  var ENT = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };
  function unent(s) {
    if (s.indexOf("&") < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,4});/g, function (all, e) {
      if (e[0] === "#") {
        var c = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return c > 0 && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) ? String.fromCodePoint(c) : "";
      }
      return own(ENT, e) ? ENT[e] : all;
    });
  }
  function local(n) { var i = n.indexOf(":"); return (i >= 0 ? n.slice(i + 1) : n).toLowerCase(); }
  var ATTR = /([^\s=\/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  function xml(text) {
    if (typeof text !== "string") return null;
    var top = { n: "#doc", a: dict(), k: [], t: "" }, stack = [top], nodes = 0;
    var i = 0, L = text.length;
    function addText(s) {
      var cur = stack[stack.length - 1];
      if (cur.t.length < MAX_TEXT) cur.t += s.slice(0, MAX_TEXT - cur.t.length);
    }
    while (i < L) {
      var lt = text.indexOf("<", i);
      if (lt < 0) { addText(unent(text.slice(i))); break; }
      if (lt > i) addText(unent(text.slice(i, lt)));
      var j;
      if (text.startsWith("<!--", lt)) {
        j = text.indexOf("-->", lt + 4);
        i = j < 0 ? L : j + 3;
      } else if (text.startsWith("<![CDATA[", lt)) {
        j = text.indexOf("]]>", lt + 9);
        addText(text.slice(lt + 9, j < 0 ? L : j));
        i = j < 0 ? L : j + 3;
      } else if (text.startsWith("<?", lt)) {
        j = text.indexOf("?>", lt + 2);
        i = j < 0 ? L : j + 2;
      } else if (text[lt + 1] === "!") {           // <!DOCTYPE …[ … ]>
        var br = text.indexOf("[", lt), gt = text.indexOf(">", lt);
        if (br >= 0 && gt >= 0 && br < gt) { j = text.indexOf("]", br); gt = j < 0 ? -1 : text.indexOf(">", j); }
        i = gt < 0 ? L : gt + 1;
      } else if (text[lt + 1] === "/") {           // </name>
        j = text.indexOf(">", lt);
        var cn = local(text.slice(lt + 2, j < 0 ? L : j).trim());
        for (var s = stack.length - 1; s > 0; s--) {
          if (stack[s].n === cn) { stack.length = s; break; }
        }
        i = j < 0 ? L : j + 1;
      } else {                                     // <name a="v" …> or />
        j = lt + 1;
        var q = 0;
        while (j < L && (q || text[j] !== ">")) {
          if (q) { if (text.charCodeAt(j) === q) q = 0; }
          else if (text[j] === "\"" || text[j] === "'") q = text.charCodeAt(j);
          j++;
        }
        var body = text.slice(lt + 1, j), self = body[body.length - 1] === "/";
        if (self) body = body.slice(0, -1);
        var m = /^[^\s\/>]+/.exec(body);
        i = j + 1;
        if (!m) { addText("<"); i = lt + 1; continue; }
        if (++nodes > MAX_NODES) return null;
        var node = { n: local(m[0]), a: dict(), k: [], t: "" };
        var rest = body.slice(m[0].length), am;
        ATTR.lastIndex = 0;
        while ((am = ATTR.exec(rest))) {
          var an = local(am[1]);
          if (!own(node.a, an)) node.a[an] = unent(am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : (am[4] || "")));
        }
        stack[stack.length - 1].k.push(node);
        if (!self && stack.length < MAX_DEPTH) stack.push(node);
      }
    }
    return top;
  }
  function kid(n, name) {
    for (var i = 0; n && i < n.k.length; i++) if (n.k[i].n === name) return n.k[i];
    return null;
  }
  function kids(n, name) { return n ? n.k.filter(function (k) { return k.n === name; }) : []; }
  function txt(n) { return n ? n.t.replace(/\s+/g, " ").trim() : ""; }
  function attr(n, a) { return n && own(n.a, a) ? n.a[a] : ""; }

  // ---------- 3. Gramps records ----------
  function pad2(v) { v = String(+v); return v.length < 2 ? "0" + v : v; }
  // "1950", "1950-03", "1950-03-02" ("-00" = unknown part) → d
  function gDate(v) {
    var m = /^\s*(\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(String(v || ""));
    if (!m || +m[1] < 1) return "";
    var y = m[1];
    while (y.length < 4) y = "0" + y;
    var d = y;
    if (m[2] && +m[2] > 0) {
      d += "-" + pad2(m[2]);
      if (m[3] && +m[3] > 0) d += "-" + pad2(m[3]);
    }
    return FT.validD(d) ? d : "";
  }
  var CALS = { "": 1, gregorian: 1, julian: 1 };
  function eventDate(ev) {
    var dv = kid(ev, "dateval"), rg = kid(ev, "daterange") || kid(ev, "datespan"), ds = kid(ev, "datestr");
    var n = dv || rg, d = "", q = "";
    if (n) {
      if (!own(CALS, attr(n, "cformat").toLowerCase())) return { d: "", q: "" };
      d = gDate(dv ? attr(dv, "val") : attr(rg, "start"));
      var ty = attr(n, "type").toLowerCase(), ql = attr(n, "quality").toLowerCase();
      if (rg || ty === "about" || ql === "estimated" || ql === "calculated") q = "abt";
      else if (ty === "before") q = "bef";
      else if (ty === "after") q = "aft";
    } else if (ds) {
      var x = FT.gedDate(attr(ds, "val"));
      if (x) { d = x.d; q = x.q; }
    }
    return { d: d, q: d ? q : "" };
  }
  function placeName(places, h) {
    var out = [], seen = dict();
    while (h && own(places, h) && !own(seen, h) && out.length < MAX_PLACE_UP) {
      seen[h] = 1;
      var p = places[h];
      var nm = attr(kid(p, "pname"), "value") || txt(kid(p, "ptitle")) || attr(p, "title");
      if (nm) out.push(nm);
      h = attr(kid(p, "placeref"), "hlink");
    }
    // an old-style title already holds the whole "A, B, C"
    return out.join(", ");
  }
  function byHandle(list, st) {
    var out = dict();
    list.forEach(function (n) {
      var h = attr(n, "handle");
      if (!h || own(out, h)) { st.dropped++; return; }
      out[h] = n;
    });
    return out;
  }
  function read(text) {
    if (typeof text !== "string") return { error: "format" };
    if (text.length > MAX_XML) return { error: "size" };
    var doc = xml(text);
    if (!doc) return { error: "toolarge" };
    var db = kid(doc, "database");
    if (!db) return { error: "format" };
    var st = { dropped: 0 };
    var people = kids(kid(db, "people"), "person");
    var fams = kids(kid(db, "families"), "family");
    if (people.length > FT.MAX_PEOPLE || fams.length > FT.MAX_PEOPLE) return { error: "toolarge" };
    return {
      people: byHandle(people, st), families: byHandle(fams, st),
      events: byHandle(kids(kid(db, "events"), "event"), { dropped: 0 }),
      places: byHandle(kids(kid(db, "places"), "placeobj"), { dropped: 0 }),
      notes: byHandle(kids(kid(db, "notes"), "note"), { dropped: 0 }),
      order: people.map(function (n) { return attr(n, "handle"); }).filter(Boolean),
      forder: fams.map(function (n) { return attr(n, "handle"); }).filter(Boolean),
      dropped: st.dropped
    };
  }

  function nameOf(n) {
    var given = txt(kid(n, "first"));
    var call = txt(kid(n, "call"));
    if (!given && call) given = call;
    var fam = kids(n, "surname").map(function (s) {
      return [attr(s, "prefix"), txt(s)].filter(Boolean).join(" ");
    }).filter(Boolean).join(" ");
    var suf = txt(kid(n, "suffix"));
    return { given: given, family: (fam + (suf ? " " + suf : "")).trim(), type: attr(n, "type").toLowerCase(),
             alt: attr(n, "alt") === "1" };
  }
  function rel(v) {
    var s = String(v || "").trim().toLowerCase();
    if (s.indexOf("adopt") === 0) return "adopted";
    if (s.indexOf("foster") === 0) return "foster";
    if (s.indexOf("step") === 0) return "step";
    return "birth";
  }
  function evType(ev) { return txt(kid(ev, "type")).toLowerCase(); }

  // ---------- 4. Rows → the GEDCOM import path ----------
  function parse(text, localData, opts) {
    opts = opts || {};
    var g = read(text);
    if (g.error) return { ok: false, err: g.error };
    if (!g.order.length) return { ok: false, err: "empty" };
    var now = opts.now, loc = localData && typeof localData === "object" ? FT.merge(localData, localData) : FT.emptyData();
    var st = { trees: 0, people: 0, unions: 0, dropped: g.dropped, refs: 0, cycles: 0, have: 0 };
    var haveP = dict(), haveU = dict(), treeCount = dict();
    loc.people.forEach(function (p) { haveP[p.id] = p; });
    loc.unions.forEach(function (u) { haveU[u.id] = u; });

    // The tree: the one most of the people already here are in (a
    // second import), else a new one named after the file.
    var pidOf = dict(), first = "";
    g.order.forEach(function (h) {
      var id = sid("p", h);
      pidOf[h] = id;
      if (!first || h < first) first = h;
      if (own(haveP, id)) { var t = haveP[id].tree; treeCount[t] = (treeCount[t] || 0) + 1; }
    });
    var into = "", best = 0;
    Object.keys(treeCount).sort().forEach(function (t) { if (treeCount[t] > best) { best = treeCount[t]; into = t; } });
    var treeId = into || sid("t", first), fileTrees = [];
    if (!into) {
      var known = null;
      loc.trees.forEach(function (t) { if (t.id === treeId) known = t; });
      if (known) into = treeId;
      else fileTrees.push(FT.normTree({ id: treeId, m: now, name: FT.line(opts.name, FT.TREE_LEN) || "Gramps", home: "" }));
    }

    var people = [], byH = dict();
    g.order.forEach(function (h) {
      var n = g.people[h], id = pidOf[h];
      if (own(haveP, id)) { st.have++; return; }
      var names = kids(n, "name").map(nameOf);
      var main = null, birth = null;
      names.forEach(function (x) { if (!x.alt && !main) main = x; });
      if (!main) main = names[0] || null;
      if (main && main.type === "married name") {
        names.forEach(function (x) { if (x !== main && x.type === "birth name" && !birth) birth = x; });
      }
      var gv = txt(kid(n, "gender")).toUpperCase();
      var p = {
        id: id, m: now, tree: treeId,
        given: main ? main.given : "", family: main ? main.family : "",
        birthName: birth && birth.family !== main.family ? birth.family : "",
        sex: gv === "F" ? "f" : (gv === "M" ? "m" : (gv === "X" ? "x" : "u")),
        birth: { d: "", q: "", place: "" }, death: { d: "", q: "", place: "" }, dead: false,
        note: "", photo: "", contact: "", parents: []
      };
      kids(n, "eventref").forEach(function (r) {
        var role = attr(r, "role").toLowerCase(), ev = g.events[attr(r, "hlink")];
        if (!ev) { if (attr(r, "hlink")) st.refs++; return; }
        if (role && role !== "primary") return;
        var ty = evType(ev);
        var e = eventDate(ev);
        e.place = placeName(g.places, attr(kid(ev, "place"), "hlink"));
        if (ty === "birth" && !p.birth.d && !p.birth.place) p.birth = e;
        else if (ty === "death" && !p.death.d && !p.death.place) { p.death = e; p.dead = true; }
        else if (ty === "burial" || ty === "cremation") p.dead = true;
      });
      p.note = kids(n, "noteref").map(function (r) {
        var nt = g.notes[attr(r, "hlink")];
        return nt ? (kid(nt, "text") ? kid(nt, "text").t : "").trim() : "";
      }).filter(Boolean).join("\n\n");
      byH[h] = { p: p, childof: kids(n, "childof") };
      people.push(p);
    });

    var unions = [], uidOf = dict(), kidsOf = dict();
    g.forder.forEach(function (h) {
      var f = g.families[h], id = sid("f", h);
      uidOf[h] = id;
      kidsOf[id] = [];
      kids(f, "childref").forEach(function (c) {
        var ch = attr(c, "hlink");
        if (!own(pidOf, ch)) { st.refs++; return; }
        var fr = rel(attr(c, "frel")), mr = rel(attr(c, "mrel"));
        kidsOf[id].push({ h: ch, kind: fr !== "birth" ? fr : mr });
      });
      if (own(haveU, id)) return;
      var ref = function (tag) {
        var x = attr(kid(f, tag), "hlink");
        if (!x) return "";
        if (own(pidOf, x)) return pidOf[x];
        st.refs++;
        return "";
      };
      var start = { d: "", q: "" }, end = { d: "", q: "" }, marr = false, div = false;
      kids(f, "eventref").forEach(function (r) {
        var ev = g.events[attr(r, "hlink")];
        if (!ev) return;
        var ty = evType(ev);
        if (ty === "marriage" && !start.d) { marr = true; start = eventDate(ev); }
        else if (ty === "divorce" && !end.d) { div = true; end = eventDate(ev); }
      });
      var rt = attr(kid(f, "rel"), "type").toLowerCase();
      var kind = div ? "divorced" : ((marr || rt === "married") ? "married" :
                 (rt === "unmarried" || rt === "civil union" ? "partner" : "unknown"));
      unions.push({ id: id, m: now, tree: treeId, a: ref("father"), b: ref("mother"), kind: kind, start: start, end: end });
    });
    // Parents of the NEW people: their own <childof> first, then the
    // families' <childref> they do not repeat (with frel / mrel).
    var unionTree = dict();
    loc.unions.forEach(function (u) { unionTree[u.id] = u.tree; });
    var okU = function (uid) { return !own(haveU, uid) || unionTree[uid] === treeId; };
    Object.keys(byH).forEach(function (h) {
      byH[h].childof.forEach(function (c) {
        var x = attr(c, "hlink");
        if (!own(uidOf, x)) { st.refs++; return; }
        if (okU(uidOf[x])) byH[h].p.parents.push({ u: uidOf[x], kind: "birth" });
      });
    });
    Object.keys(kidsOf).forEach(function (uid) {
      kidsOf[uid].forEach(function (k) {
        if (!own(byH, k.h) || !okU(uid)) return;
        var p = byH[k.h].p;
        for (var i = 0; i < p.parents.length; i++) {
          if (p.parents[i].u === uid) {
            if (p.parents[i].kind === "birth") p.parents[i].kind = k.kind;
            return;
          }
        }
        p.parents.push({ u: uid, kind: k.kind });
      });
    });
    // Normalize (cuts long text, > 4 parents, bad dates) and check.
    var ps = [], us = [];
    people.forEach(function (p) {
      if (p.parents.length > FT.MAX_PARENTS) st.refs += p.parents.length - FT.MAX_PARENTS;
      var x = FT.normPerson(p);
      if (x) ps.push(x); else st.dropped++;
    });
    unions.forEach(function (u) { var x = FT.normUnion(u); if (x) us.push(x); else st.dropped++; });
    if (fileTrees.length && ps.length) fileTrees[0].home = ps[0].id;
    var r = FT.checkRows(fileTrees, ps, us, {}, loc, st);
    if (r.ok) {
      r.into = into;
      // a tree already here rides along: make sure it is the one shown
      if (into) r.data.trees = r.data.trees.filter(function (t) { return t.id === into; });
      if (!r.data.trees.length) {
        loc.trees.forEach(function (t) { if (t.id === treeId) r.data.trees.push(t); });
      }
    }
    return r;
  }

  var API = { MAX_FILE: MAX_FILE, MAX_XML: MAX_XML, sniff: sniff, isGzip: isGzip, inflate: inflate,
              decode: decode, xml: xml, read: read, parse: parse, gDate: gDate, sid: sid };
  if (NODE) module.exports = API;
  else root.OrosGramps = API;
})(typeof self !== "undefined" ? self : this);
