// ============================================================
// orOS Notes — import from other note apps (notes/import.js,
// window.OrosNotesImport). Pure (no DOM): the app and `node --test`
// run the same code.
//   1. collect(inputs, Zip)  picked files / a folder / .zip files →
//      text files by relative path (+ the paths of everything else,
//      so a vault is recognised by its .obsidian folder). Limits keep
//      a hostile archive from eating the device.
//   2. parse(col, opts)      → { source, name, notes[], skipped }:
//      Obsidian vault, Standard Notes backup (decrypted), any folder
//      of Markdown / text files (Bear, Logseq, Joplin MD, Notion MD,
//      Typora, iA Writer, Zettlr, an orOS .md export…).
//   3. plan(state, parsed, opts) → what one write would add / change,
//      with stable ids (hash of source + path), so importing the same
//      source again updates pages instead of duplicating them.
// Only TEXT ever reaches the data: Markdown stays Markdown, Standard
// Notes "Super" notes (Lexical JSON) become Markdown, and the page
// renderer (md.js) escapes everything as before. Nothing imported is
// ever inserted as HTML or run.
// ============================================================
(function (root) {
  "use strict";

  var LIMITS = {
    total: 200 * 1024 * 1024,   // bytes of text read, all files together
    file: 1024 * 1024,          // characters kept per page
    notes: 5000,                // pages per import
    labels: 300                 // new labels per import
  };
  var TEXT_EXT = /\.(md|markdown|mdown|mkd|txt|text)$/i;
  var JSON_EXT = /\.json$/i;
  var ZIP_EXT = /\.zip$/i;
  var KNOWN_FM = { tags: 1, tag: 1, title: 1, aliases: 1, alias: 1, cssclasses: 1, cssclass: 1 };

  // ---------- helpers ----------
  function hash(s) {                       // cyrb53 → base36
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function decode(bytes) {
    var s = new TextDecoder("utf-8").decode(bytes);
    return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
  }
  function clean(s) {
    // line ends, and control characters other than tab / newline
    return String(s || "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  }
  function oneLine(s, max) {
    return String(s || "").replace(/\s+/g, " ").trim().slice(0, max || 200);
  }
  function baseName(p) { var i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1); }
  function dirName(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
  function stripExt(n) { return n.replace(/\.[^./]+$/, ""); }
  function normPath(p) {
    return String(p || "").replace(/\\/g, "/").split("/").filter(function (s) { return s && s !== "."; }).join("/");
  }
  // .obsidian, .trash, .git, __MACOSX, ._resource forks: never notes
  function hiddenPath(p) {
    return p.split("/").some(function (s) { return s.charAt(0) === "." || s === "__MACOSX"; });
  }

  // ---------- 1. collect ----------
  // inputs: [{ path, bytes: Uint8Array }] (path = name, or the folder
  // picker's relative path). Zip: AtelierZip (atelier/zip.js).
  // → Promise<{ files: [{ path, text }], paths: [all paths seen],
  //             roots: [top folder or archive names], tooBig, unreadable }>
  function collect(inputs, Zip) {
    var out = { files: [], paths: [], roots: [], tooBig: 0, unreadable: 0 };
    var total = 0;
    function addText(path, bytes) {
      if (total + bytes.length > LIMITS.total) { out.tooBig++; return; }
      total += bytes.length;
      out.files.push({ path: path, text: clean(decode(bytes)) });
    }
    function seen(path) {
      out.paths.push(path);
      var top = path.split("/")[0];
      if (path.indexOf("/") > 0 && out.roots.indexOf(top) < 0) out.roots.push(top);
    }
    var chain = Promise.resolve();
    (inputs || []).forEach(function (inp) {
      var path = normPath(inp.path || inp.name);
      if (!path) return;
      if (ZIP_EXT.test(path) && Zip) {
        chain = chain.then(function () {
          var z;
          try { z = Zip.open(inp.bytes); } catch (e) { out.unreadable++; return; }
          var base = stripExt(baseName(path));
          if (out.roots.indexOf(base) < 0) out.roots.push(base);
          var step = Promise.resolve();
          z.names.forEach(function (n) {
            var p = normPath(n);
            if (!p) return;
            var full = base + "/" + p;
            out.paths.push(full);
            if (hiddenPath(p) || !(TEXT_EXT.test(p) || JSON_EXT.test(p))) return;
            step = step.then(function () {
              if (total + z.size(n) > LIMITS.total) { out.tooBig++; return; }
              return z.bytes(n).then(function (b) { if (b) addText(full, b); }, function () { out.unreadable++; });
            });
          });
          return step;
        });
        return;
      }
      seen(path);
      if (hiddenPath(path) || !(TEXT_EXT.test(path) || JSON_EXT.test(path))) return;
      chain = chain.then(function () { addText(path, inp.bytes); });
    });
    return chain.then(function () { return out; });
  }

  // ---------- Markdown helpers ----------
  // Front matter: "---" first line … "---" / "...". Returns
  // { text (without it, other keys kept), tags[], title }.
  function frontMatter(text) {
    var res = { text: text, tags: [], title: "" };
    if (!/^---[ \t]*\n/.test(text)) return res;
    var m = /\n(---|\.\.\.)[ \t]*(\n|$)/.exec(text.slice(3));
    if (!m) return res;
    var body = text.slice(4, 3 + m.index), rest = text.slice(3 + m.index + m[0].length);
    var lines = body.split("\n"), keep = [], key = null, known = false;
    lines.forEach(function (ln) {
      var kv = /^([A-Za-z_][\w -]*?)\s*:\s*(.*)$/.exec(ln);
      if (kv && !/^\s/.test(ln)) {
        key = kv[1].toLowerCase();
        known = !!KNOWN_FM[key];
        var v = kv[2].trim();
        if (key === "tags" || key === "tag") res.tags = res.tags.concat(listValue(v));
        else if (key === "title" && v) res.title = unquote(v);
        if (!known) keep.push(ln);
        return;
      }
      var item = /^\s*-\s+(.*)$/.exec(ln);
      if (item && (key === "tags" || key === "tag")) { res.tags.push(unquote(item[1].trim())); return; }
      if (!known) keep.push(ln);
    });
    res.text = (keep.join("\n").trim() ? "---\n" + keep.join("\n") + "\n---\n" : "") + rest.replace(/^\n+/, "");
    return res;
  }
  function unquote(s) { return String(s).replace(/^(["'])(.*)\1$/, "$2"); }
  function listValue(v) {
    if (!v) return [];
    v = v.replace(/^\[/, "").replace(/\]$/, "");
    return v.split(/[,\s]+/).map(function (x) { return unquote(x.trim()); }).filter(Boolean);
  }
  // #tags in the text, outside code. A tag needs a non-digit.
  var TAG_RE = /(^|[\s(])#([^\s#.,;:!?()[\]{}"'`<>|\\=+*&%$@~]+)/g;
  function inlineTags(text) {
    var tags = [], fence = false;
    text.split("\n").forEach(function (ln) {
      if (/^\s*(```|~~~)/.test(ln)) { fence = !fence; return; }
      if (fence || /^( {4}|\t)/.test(ln)) return;
      var s = ln.replace(/`[^`]*`/g, " ");
      var m;
      TAG_RE.lastIndex = 0;
      while ((m = TAG_RE.exec(s))) {
        var tg = m[2].replace(/[/_-]+$/, "");
        if (tg && /[^\d]/.test(tg)) tags.push(tg);
      }
    });
    return tags;
  }
  function normTag(tg) {
    return oneLine(String(tg || "").replace(/^#/, ""), 60);
  }
  function uniqTags(list) {
    var seen = {}, out = [];
    list.forEach(function (tg) {
      tg = normTag(tg);
      var k = tg.toLowerCase();
      if (tg && !seen[k]) { seen[k] = 1; out.push(tg); }
    });
    return out;
  }
  // Obsidian links → orOS links: [[a/b/Note#Heading|label]] →
  // [[Note|label]] when "Note" is one of the imported titles; ".md"
  // dropped; ![[embeds]] stay as written.
  function fixWiki(text, titles) {
    return text.replace(/(!?)\[\[([^\]\n]+)\]\]/g, function (all, bang, inner) {
      if (bang) return all;
      var bar = inner.indexOf("|");
      var target = bar < 0 ? inner : inner.slice(0, bar), label = bar < 0 ? "" : inner.slice(bar + 1);
      var t2 = target.replace(/[#^].*$/, "").replace(/\.md$/i, "").trim();
      if (!t2) return all;
      if (t2.indexOf("/") >= 0) {
        var last = baseName(t2);
        if (titles[last.toLowerCase()]) t2 = last;
      }
      if (t2 === target && !label) return all;
      return "[[" + t2 + (label ? "|" + label : "") + "]]";
    });
  }
  // An orOS .md export ("# Title", text, "---", orOS line) and Bear
  // ("# Title" first): the heading equal to the title is dropped.
  function dropTitleLine(text, title) {
    var m = /^#[ \t]+(.+?)[ \t]*\n/.exec(text);
    if (m && oneLine(m[1]).toLowerCase() === oneLine(title).toLowerCase()) text = text.slice(m[0].length).replace(/^\n+/, "");
    return text.replace(/\n*---\n+Made with orOS \| useoros\.online\n*$/, "\n");
  }
  function cap(text, skipped) {
    if (text.length > LIMITS.file) { skipped.cut++; return text.slice(0, LIMITS.file); }
    return text;
  }

  // ---------- 2. parse ----------
  function emptySkipped() { return { attachments: 0, trashed: 0, encrypted: 0, cut: 0, capped: 0, other: 0 }; }

  // Markdown / text files (a folder, a vault, a zip of either)
  function fromMarkdown(col, opts) {
    opts = opts || {};
    var skipped = emptySkipped();
    var obsidian = col.paths.some(function (p) { return /(^|\/)\.obsidian\//.test(p) || /(^|\/)\.obsidian$/.test(p); });
    var files = col.files.filter(function (f) { return TEXT_EXT.test(f.path) && !hiddenPath(f.path); });
    skipped.attachments = col.paths.filter(function (p) {
      return !hiddenPath(p) && !TEXT_EXT.test(p) && !JSON_EXT.test(p) && !ZIP_EXT.test(p);
    }).length;
    // one common top folder → that is the vault, not a page
    var top = "";
    if (files.length) {
      var first = files[0].path.split("/")[0];
      if (files.every(function (f) { return f.path.indexOf("/") > 0 && f.path.split("/")[0] === first; })) top = first;
    }
    function rel(p) { return top ? p.slice(top.length + 1) : p; }
    var name = top || (col.roots.length === 1 ? col.roots[0] : "");
    var notes = [], byKey = {}, titles = {};
    files.forEach(function (f) { titles[stripExt(baseName(f.path)).toLowerCase()] = 1; });
    function folder(dir) {
      if (!dir) return null;
      var key = "d:" + dir;
      if (!byKey[key]) {
        var parent = folder(dirName(dir));
        byKey[key] = { key: key, parentKey: parent, title: oneLine(baseName(dir)), text: "", tags: [], pinned: false, folder: true };
        notes.push(byKey[key]);
      }
      return key;
    }
    files.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
    files.forEach(function (f) {
      var r = rel(f.path), dir = dirName(r);
      var title = oneLine(stripExt(baseName(r))) || opts.untitled || "Untitled";
      var fm = frontMatter(f.text);
      if (fm.title) title = oneLine(fm.title) || title;
      var text = fixWiki(dropTitleLine(fm.text, title), titles);
      var tags = uniqTags(fm.tags.concat(inlineTags(text)));
      text = cap(text, skipped);
      // folder note: "A.md" next to folder "A/" is that folder's page
      var dkey = "d:" + (dir ? dir + "/" : "") + stripExt(baseName(r));
      var parentKey = folder(dir);
      if (byKey[dkey] && byKey[dkey].folder && !byKey[dkey].text) {
        byKey[dkey].text = text; byKey[dkey].tags = tags;
        return;
      }
      var n = { key: "f:" + stripExt(r), parentKey: parentKey, title: title, text: text, tags: tags, pinned: false };
      byKey[n.key] = n;
      notes.push(n);
    });
    // folder notes whose folder appeared after the file
    notes = notes.filter(function (n) {
      if (n.folder || n.key.indexOf("f:") !== 0) return true;
      var d = byKey["d:" + n.key.slice(2)];
      if (d && d.folder && !d.text) { d.text = n.text; d.tags = n.tags; return false; }
      return true;
    });
    return { source: obsidian ? "obsidian" : "markdown", name: name, notes: notes, skipped: skipped };
  }

  // Standard Notes backup: { items: [ Note | Tag | … ] }, decrypted.
  function isStandardNotes(obj) {
    return !!obj && typeof obj === "object" && Array.isArray(obj.items) &&
      obj.items.some(function (it) { return it && (it.content_type === "Note" || it.content_type === "Tag"); });
  }
  function snFlag(c, k) {
    if (!c || typeof c !== "object") return false;
    if (c[k]) return true;
    var ad = c.appData && c.appData["org.standardnotes.sn"];
    return !!(ad && ad[k]);
  }
  function fromStandardNotes(obj, opts) {
    opts = opts || {};
    var skipped = emptySkipped(), notes = [], tagsOf = {}, tagById = {};
    var items = obj.items.filter(function (it) { return it && typeof it === "object" && !it.deleted; });
    items.forEach(function (it) {
      if (typeof it.content === "string") { if (it.content_type === "Note" || /^00\d:/.test(it.content)) skipped.encrypted++; return; }
      if (it.content_type === "Tag" && it.content) tagById[it.uuid] = it;
    });
    function tagName(tg, depth) {
      var c = tg.content, own = oneLine(c.title, 60);
      var par = (c.references || []).filter(function (r) { return r && r.content_type === "Tag" && r.reference_type === "TagToParentTag"; })[0];
      if (par && tagById[par.uuid] && (depth || 0) < 8) return tagName(tagById[par.uuid], (depth || 0) + 1) + "/" + own;
      return own;
    }
    Object.keys(tagById).forEach(function (id) {
      var tg = tagById[id], nm = tagName(tg);
      (tg.content.references || []).forEach(function (r) {
        if (!r || r.content_type !== "Note") return;
        (tagsOf[r.uuid] = tagsOf[r.uuid] || []).push(nm);
      });
    });
    var archive = null;
    items.forEach(function (it) {
      if (it.content_type !== "Note" || typeof it.content !== "object" || !it.content) return;
      var c = it.content;
      if (snFlag(c, "trashed")) { skipped.trashed++; return; }
      var text = clean(c.text || "");
      if (c.noteType === "super" || /^\s*\{\s*"root"\s*:/.test(text)) {
        try { text = lexicalToMd(JSON.parse(text)); } catch (e) { /* keep the raw text */ }
      }
      var title = oneLine(c.title) || oneLine(text.split("\n")[0].replace(/^#+\s*/, ""), 80) || opts.untitled || "Untitled";
      var parentKey = null;
      if (snFlag(c, "archived")) {
        if (!archive) {
          archive = { key: "sn:archive", parentKey: null, title: opts.archiveTitle || "Archive", text: "", tags: [], pinned: false, folder: true };
          notes.push(archive);
        }
        parentKey = archive.key;
      }
      notes.push({ key: "sn:" + it.uuid, parentKey: parentKey, title: title, text: cap(text, skipped),
                   tags: uniqTags(tagsOf[it.uuid] || []), pinned: snFlag(c, "pinned") });
    });
    notes.sort(function (a, b) {
      if (!!a.folder !== !!b.folder) return a.folder ? 1 : -1;
      return a.title.localeCompare(b.title);
    });
    return { source: "standardnotes", name: "", notes: notes, skipped: skipped };
  }

  // Lexical (Standard Notes "Super") → Markdown
  function lexicalToMd(doc) {
    var rootNode = doc && (doc.root || (doc.editorState && doc.editorState.root));
    if (!rootNode) throw new Error("lexical");
    var depthCap = 0;
    function inline(nodes) {
      return (nodes || []).map(function (n) {
        if (!n || typeof n !== "object") return "";
        if (n.type === "linebreak") return "\n";
        if (n.type === "tab") return "\t";
        if (n.type === "link" || n.type === "autolink") {
          var label = inline(n.children);
          return n.url ? "[" + label + "](" + String(n.url).replace(/[()\s]/g, encodeURIComponent) + ")" : label;
        }
        if (typeof n.text === "string") {
          var s = n.text, f = n.format || 0;
          if (!s) return "";
          if (f & 16) return "`" + s + "`";
          if (f & 4) s = "~~" + s + "~~";
          if (f & 2) s = "*" + s + "*";
          if (f & 1) s = "**" + s + "**";
          return s;
        }
        return inline(n.children);
      }).join("");
    }
    function codeText(nodes) {
      return (nodes || []).map(function (n) {
        if (!n) return "";
        if (n.type === "linebreak") return "\n";
        if (n.type === "tab") return "\t";
        return typeof n.text === "string" ? n.text : codeText(n.children);
      }).join("");
    }
    function list(n, indent) {
      var out = [], i = n.start || 1;
      (n.children || []).forEach(function (li) {
        var kids = li.children || [], sub = kids.filter(function (k) { return k && k.type === "list"; });
        var own = kids.filter(function (k) { return !k || k.type !== "list"; });
        if (sub.length && !own.length) { sub.forEach(function (s) { out.push(list(s, indent + "  ")); }); return; }
        var mark = n.listType === "number" ? (i++) + "." : n.listType === "check" ? (li.checked ? "- [x]" : "- [ ]") : "-";
        out.push(indent + mark + " " + inline(own).replace(/\n/g, "\n" + indent + "  "));
        sub.forEach(function (s) { out.push(list(s, indent + "  ")); });
      });
      return out.join("\n");
    }
    function block(n) {
      if (!n || typeof n !== "object" || ++depthCap > 100000) return "";
      switch (n.type) {
        case "heading": return "######".slice(0, Math.min(6, Math.max(1, parseInt(String(n.tag || "h1").slice(1), 10) || 1))) + " " + inline(n.children);
        case "quote": return "> " + inline(n.children).replace(/\n/g, "\n> ");
        case "code": return "```" + oneLine(n.language || "", 20).replace(/`/g, "") + "\n" + codeText(n.children) + "\n```";
        case "list": return list(n, "");
        case "horizontalrule": return "---";
        case "table":
          var rows = (n.children || []).map(function (r) {
            return "| " + (r.children || []).map(function (c) { return blocks(c.children).replace(/\n+/g, " ").replace(/\|/g, "\\|"); }).join(" | ") + " |";
          });
          if (rows.length) {
            var cols = ((n.children[0] || {}).children || []).length || 1;
            rows.splice(1, 0, "|" + new Array(cols + 1).join(" --- |"));
          }
          return rows.join("\n");
        case "paragraph": return inline(n.children);
        default:
          if (n.children && n.children.some(function (k) { return k && (k.children || k.type === "list" || k.type === "heading"); })) return blocks(n.children);
          return inline(n.children) || (typeof n.text === "string" ? n.text : "");
      }
    }
    function blocks(nodes) {
      return (nodes || []).map(block).join("\n\n");
    }
    return clean(blocks(rootNode.children)).replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  // Which kind of export is this?
  function parse(col, opts) {
    opts = opts || {};
    var jsons = col.files.filter(function (f) { return JSON_EXT.test(f.path) || /^\s*\{/.test(f.text) && /\.txt$/i.test(f.path); });
    for (var i = 0; i < jsons.length; i++) {
      var obj = null;
      try { obj = JSON.parse(jsons[i].text); } catch (e) { continue; }
      if (isStandardNotes(obj)) {
        var sn = fromStandardNotes(obj, opts);
        sn.skipped.attachments = 0;
        return sn;
      }
    }
    var md = fromMarkdown(col, opts);
    md.skipped.tooBig = col.tooBig || 0;
    md.skipped.unreadable = col.unreadable || 0;
    return md;
  }

  // ---------- 3. plan ----------
  var SOURCE_NAMES = { obsidian: "Obsidian", standardnotes: "Standard Notes", markdown: "" };
  // state: the Notes state; parsed: parse(); opts: { upd, imported
  // ("Imported notes" in the user's language), now }.
  // → { notebook: {id,name}|null, nb, labels: [{id,name}], pages: { add:
  //     [{id,parent,title,text,pos,labels[],pinned}], upd: [{id,title,text}] },
  //     same, gone, capped }
  function plan(state, parsed, opts) {
    opts = opts || {};
    var src = parsed.source, label = SOURCE_NAMES[src] || "";
    var nbName = label && parsed.name ? label + " – " + parsed.name : label || parsed.name || opts.imported || "Imported notes";
    var nbId = "nb-imp-" + hash(src + "|" + (parsed.name || ""));
    var nb = (state.notebooks || []).filter(function (n) { return n.id === nbId; })[0];
    var fresh = !nb, tombs = state.tombs || {};
    var res = { notebook: fresh ? { id: nbId, name: oneLine(nbName, 80) } : null, nb: nbId, labels: [],
                pages: { add: [], upd: [] }, same: 0, gone: 0, capped: 0 };
    var pagesById = {};
    (state.pages || []).forEach(function (p) { pagesById[p.id] = p; });
    // labels: reuse one of the same name in this notebook
    var labelByName = {}, newLabels = 0;
    (state.labels || []).forEach(function (l) { if (l.nb === nbId) labelByName[String(l.name).toLowerCase()] = l.id; });
    function labelId(name) {
      var k = name.toLowerCase();
      if (labelByName[k]) return labelByName[k];
      if (newLabels >= LIMITS.labels) return null;
      newLabels++;
      var id = "lbl-imp-" + hash(nbId + "|" + k);
      labelByName[k] = id;
      res.labels.push({ id: id, name: name });
      return id;
    }
    var idOf = {};
    parsed.notes.forEach(function (n) { idOf[n.key] = "imp-" + hash(src + "|" + (parsed.name || "") + "|" + n.key); });
    var posNext = {};
    (state.pages || []).forEach(function (p) {
      if (p.nb !== nbId) return;
      var k = p.parent || "";
      posNext[k] = Math.max(posNext[k] || 0, (p.pos || 0) + 1);
    });
    var kept = {};
    parsed.notes.forEach(function (n) {
      var id = idOf[n.key], old = pagesById[id];
      if (old) {
        kept[id] = 1;
        if (old.title === n.title && old.text === n.text) res.same++;
        else if (opts.upd && !n.folder) res.pages.upd.push({ id: id, title: n.title, text: n.text });
        else res.same++;
        return;
      }
      if (!fresh && tombs[id]) { res.gone++; return; }
      if (res.pages.add.length >= LIMITS.notes) { res.capped++; return; }
      kept[id] = 1;
      var parent = n.parentKey ? idOf[n.parentKey] : null;
      var pk = parent || "";
      var pos = posNext[pk] || 0;
      posNext[pk] = pos + 1;
      res.pages.add.push({ id: id, parent: parent, title: n.title, text: n.text, pos: pos,
                           labels: n.tags.map(labelId).filter(Boolean), pinned: !!n.pinned });
    });
    // a parent that is not coming (deleted here, capped) → top level
    res.pages.add.forEach(function (p) { if (p.parent && !kept[p.parent]) p.parent = null; });
    // labels nobody uses (capped pages) stay out
    var used = {};
    res.pages.add.forEach(function (p) { p.labels.forEach(function (l) { used[l] = 1; }); });
    res.labels = res.labels.filter(function (l) { return used[l.id]; });
    return res;
  }
  function count(pl) {
    return { add: pl.pages.add.length, upd: pl.pages.upd.length, labels: pl.labels.length };
  }

  var api = {
    LIMITS: LIMITS, hash: hash, collect: collect, parse: parse, plan: plan, count: count,
    frontMatter: frontMatter, inlineTags: inlineTags, fixWiki: fixWiki, dropTitleLine: dropTitleLine,
    fromMarkdown: fromMarkdown, fromStandardNotes: fromStandardNotes, isStandardNotes: isStandardNotes,
    lexicalToMd: lexicalToMd
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosNotesImport = api;
})(this);
