// ============================================================
// orOS Notes — import from other note apps (notes/import.js,
// window.OrosNotesImport). Pure (no DOM): the app and `node --test`
// run the same code.
//   1. collect(inputs, Zip)  picked files / a folder / .zip files →
//      text files by relative path (+ the paths of everything else,
//      so a vault is recognised by its .obsidian folder). Limits keep
//      a hostile archive from eating the device.
//   2. parse(col, opts)      → { source, name, notes[], skipped }:
//      Obsidian vault, Standard Notes backup (decrypted), Evernote
//      .enex, Google Keep (Takeout), Simplenote export, Joplin .jex /
//      RAW folder, any folder of Markdown / text files (Bear, Logseq,
//      Notion MD, Typora, iA Writer, Zettlr, an orOS .md export…).
//   3. plan(state, parsed, opts) → what one write would add / change,
//      with stable ids (hash of source + path), so importing the same
//      source again updates pages instead of duplicating them.
// Only TEXT ever reaches the data: Markdown stays Markdown, Standard
// Notes "Super" notes (Lexical JSON) and Evernote's HTML become
// Markdown through small tokenizers of our own (no DOM, nothing is
// ever parsed by the browser as HTML or loaded), and the page
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
  var TAR_EXT = /\.(jex|tar)$/i;
  var ENEX_EXT = /\.enex$/i;
  function readable(p) { return TEXT_EXT.test(p) || JSON_EXT.test(p) || ENEX_EXT.test(p); }
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

  // ---------- tar (Joplin .jex) ----------
  // ustar / GNU long names / pax "path"; regular files only. Same
  // shape as AtelierZip.open: { names, size(n), bytes(n) → Promise }.
  function tarOpen(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 512) throw new Error("tar");
    var entries = {}, names = [], off = 0, longName = null;
    function str(a, b) {
      var e = a;
      while (e < b && bytes[e] !== 0) e++;
      return new TextDecoder("utf-8").decode(bytes.subarray(a, e));
    }
    while (off + 512 <= bytes.length && names.length < 50000) {
      var empty = true;
      for (var i = off; i < off + 512; i++) if (bytes[i]) { empty = false; break; }
      if (empty) break;
      var name = str(off, off + 100), size = parseInt(str(off + 124, off + 136).trim() || "0", 8) || 0;
      var type = String.fromCharCode(bytes[off + 156] || 48);
      if (str(off + 257, off + 262) === "ustar") { var pre = str(off + 345, off + 500); if (pre) name = pre + "/" + name; }
      var start = off + 512;
      if (start + size > bytes.length) throw new Error("tar");
      if (type === "L") longName = str(start, start + size);
      else if (type === "x") {
        var m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(new TextDecoder("utf-8").decode(bytes.subarray(start, start + size)));
        if (m) longName = m[1];
      } else {
        if (longName) { name = longName; longName = null; }
        if (type === "0" || type === "\u0000") {
          if (!Object.prototype.hasOwnProperty.call(entries, name)) names.push(name);
          entries[name] = { start: start, size: size };
        }
      }
      off = start + Math.ceil(size / 512) * 512;
    }
    return {
      names: names,
      size: function (n) { return entries[n] ? entries[n].size : 0; },
      bytes: function (n) {
        var e = entries[n];
        return Promise.resolve(e ? bytes.slice(e.start, e.start + e.size) : null);
      }
    };
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
      if ((ZIP_EXT.test(path) && Zip) || TAR_EXT.test(path)) {
        chain = chain.then(function () {
          var z;
          try { z = TAR_EXT.test(path) ? tarOpen(inp.bytes) : Zip.open(inp.bytes); } catch (e) { out.unreadable++; return; }
          var base = stripExt(baseName(path));
          if (out.roots.indexOf(base) < 0) out.roots.push(base);
          var step = Promise.resolve();
          z.names.forEach(function (n) {
            var p = normPath(n);
            if (!p) return;
            var full = base + "/" + p;
            out.paths.push(full);
            if (hiddenPath(p) || !readable(p)) return;
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
      if (hiddenPath(path) || !readable(path)) return;
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

  // ---------- HTML (Evernote ENML) → Markdown ----------
  // A tolerant tokenizer builds a tiny tree ({ t, a, k } / strings);
  // nothing here is ever handed to a browser parser. Scripts, styles,
  // comments, doctype and processing instructions are dropped first.
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", copy: "©", reg: "®", hellip: "…",
              mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
              euro: "€", middot: "·", bull: "•", trade: "™", deg: "°", times: "×" };
  function entities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, e) {
      if (e.charAt(0) === "#") {
        var n = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 && !(n >= 0xD800 && n < 0xE000) ? String.fromCodePoint(n) : "";
      }
      var v = ENT[e.toLowerCase()];
      return v !== undefined ? v : all;
    });
  }
  var VOID = { br: 1, hr: 1, img: 1, "en-media": 1, "en-todo": 1, input: 1, meta: 1, link: 1, col: 1, wbr: 1, area: 1, source: 1 };
  function htmlTree(html) {
    html = String(html || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<!DOCTYPE[^>]*>/gi, "").replace(/<(script|style|head|title|object|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "");
    var rootN = { t: "#root", a: {}, k: [] }, stack = [rootN], depth = 0;
    var re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g, m;
    while ((m = re.exec(html))) {
      var top = stack[stack.length - 1];
      if (m[5] !== undefined || m[0] === "<") { top.k.push(entities(m[5] !== undefined ? m[5] : "<")); continue; }
      var tag = m[2].toLowerCase();
      if (m[1]) {
        for (var i = stack.length - 1; i > 0; i--) if (stack[i].t === tag) { stack.length = i; break; }
        continue;
      }
      var attrs = {}, am, ar = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      while ((am = ar.exec(m[3] || ""))) attrs[am[1].toLowerCase()] = entities(am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] || "");
      var node = { t: tag, a: attrs, k: [] };
      top.k.push(node);
      if (!VOID[tag] && !m[4] && stack.length < 200) stack.push(node);
      if (++depth > 200000) break;
    }
    return rootN;
  }
  var BLOCK2 = { p: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, ul: 1, ol: 1, blockquote: 1, pre: 1, table: 1, hr: 1 };
  var BLOCK1 = { div: 1, li: 1, tr: 1, section: 1, article: 1, header: 1, footer: 1, figure: 1, dl: 1, dt: 1, dd: 1,
                 "en-note": 1, body: 1, html: 1, main: 1, nav: 1, aside: 1, center: 1, tbody: 1, thead: 1 };
  function isBlock(n) { return n && typeof n === "object" && (BLOCK2[n.t] || BLOCK1[n.t]); }
  function htmlToMd(html, ctx) {
    ctx = ctx || {};
    var media = 0;
    function textOf(n) {
      if (typeof n === "string") return n;
      if (n.t === "br") return "\n";
      return n.k.map(textOf).join("");
    }
    function inl(nodes) {
      return nodes.map(function (n) {
        if (typeof n === "string") return n.replace(/\s+/g, " ");
        var x;
        switch (n.t) {
          case "br": return "\n";
          case "b": case "strong": x = inl(n.k); return x.trim() ? "**" + x.trim() + "**" + (/\s$/.test(x) ? " " : "") : x;
          case "i": case "em": x = inl(n.k); return x.trim() ? "*" + x.trim() + "*" + (/\s$/.test(x) ? " " : "") : x;
          case "s": case "strike": case "del": x = inl(n.k); return x.trim() ? "~~" + x.trim() + "~~" : x;
          case "code": case "tt": case "kbd": x = textOf(n); return x ? "`" + x.replace(/`/g, "'") + "`" : "";
          case "a":
            x = inl(n.k).trim();
            var href = String(n.a.href || "").trim();
            if (/^(https?:|mailto:)/i.test(href) && !/[\s<>"]/.test(href)) return "[" + (x || href) + "](" + href.replace(/[()]/g, encodeURIComponent) + ")";
            return x;
          case "img": return n.a.alt ? n.a.alt : "";
          case "en-media":
            var r = (ctx.resources || [])[media++] || {};
            return "📎 " + (r.name || n.a.type || "file");
          case "en-todo": return n.a.checked === "true" ? "[x] " : "[ ] ";
          case "en-crypt": return "🔒";
          case "input": return n.a.type === "checkbox" ? (n.a.checked !== undefined ? "[x] " : "[ ] ") : "";
          default:
            if (isBlock(n)) return "\n" + blk(n) + "\n";
            return inl(n.k);
        }
      }).join("");
    }
    function list(n, indent) {
      var out = [], i = parseInt(n.a.start, 10) || 1, todo = /--en-todo\s*:\s*true/.test(n.a.style || "");
      n.k.forEach(function (li) {
        if (typeof li === "string") { if (li.trim()) out.push(indent + "- " + li.trim()); return; }
        if (li.t === "ul" || li.t === "ol") { out.push(list(li, indent + "  ")); return; }
        var own = li.k.filter(function (k) { return !(k && (k.t === "ul" || k.t === "ol")); });
        var subs = li.k.filter(function (k) { return k && (k.t === "ul" || k.t === "ol"); });
        var mark = n.t === "ol" ? (i++) + "." : todo ? (/--en-checked\s*:\s*true/.test(li.a.style || "") ? "- [x]" : "- [ ]") : "-";
        var body = tidy(inl(own)).replace(/\n+/g, "\n" + indent + "  ");
        if (/^\[[ x]\] /.test(body) && mark === "-") { mark = "- " + body.slice(0, 3); body = body.slice(4); }
        out.push(indent + mark + " " + body);
        subs.forEach(function (s2) { out.push(list(s2, indent + "  ")); });
      });
      return out.join("\n");
    }
    function blk(n) {
      switch (n.t) {
        case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
          return "######".slice(0, +n.t.charAt(1)) + " " + tidy(inl(n.k)).replace(/\n/g, " ");
        case "ul": case "ol": return list(n, "");
        case "hr": return "---";
        case "pre": return "```\n" + textOf(n).replace(/\n$/, "") + "\n```";
        case "blockquote": return blocks(n.k).split("\n").map(function (l) { return "> " + l; }).join("\n");
        case "table":
          var rows = [];
          (function walk(k) {
            k.forEach(function (c) {
              if (!c || typeof c !== "object") return;
              if (c.t === "tr") rows.push(c.k.filter(function (d) { return d && (d.t === "td" || d.t === "th"); })
                .map(function (d) { return tidy(inl(d.k)).replace(/\n+/g, " ").replace(/\|/g, "\\|"); }));
              else if (c.t !== "table") walk(c.k);
            });
          })(n.k);
          if (!rows.length) return "";
          var cols = Math.max.apply(null, rows.map(function (r) { return r.length; })) || 1;
          var lines = rows.map(function (r) { while (r.length < cols) r.push(""); return "| " + r.join(" | ") + " |"; });
          lines.splice(1, 0, "|" + new Array(cols + 1).join(" --- |"));
          return lines.join("\n");
        case "div":
          // legacy Evernote checkbox line: <div><en-todo/>text</div>
          var first = n.k.filter(function (k) { return !(typeof k === "string" && !k.trim()); })[0];
          if (first && first.t === "en-todo" && !n.k.some(isBlock)) return "- " + tidy(inl(n.k));
          return blocks(n.k);
        default: return blocks(n.k);
      }
    }
    function blocks(nodes) {
      var out = "", run = [];
      function flush() {
        var x = tidy(inl(run));
        run = [];
        if (x) out += (out ? "\n" : "") + x;
      }
      nodes.forEach(function (n) {
        if (!isBlock(n)) { run.push(n); return; }
        flush();
        var b = blk(n);
        if (BLOCK2[n.t]) out += (out ? "\n\n" : "") + b + "\n\n";
        else out += (out && !/\n$/.test(out) ? "\n" : "") + b;
      });
      flush();
      return out.replace(/\n{3,}/g, "\n\n");
    }
    function tidy(x) { return x.split("\n").map(function (l) { return l.replace(/[ \t]+$/, ""); }).join("\n").replace(/^[ \n]+|[ \n]+$/g, ""); }
    return clean(blocks(htmlTree(html).k)).replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  // ---------- Evernote .enex ----------
  function xmlText(s) {
    s = String(s || "");
    var c = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
    return c ? c[1] : entities(s);
  }
  function parseEnex(text) {
    var notes = [], m, re = /<note>([\s\S]*?)<\/note>/g;
    while ((m = re.exec(text))) {
      var body = m[1].replace(/<data\b[^>]*>[\s\S]*?<\/data>/g, "");
      var tm = /<title>([\s\S]*?)<\/title>/.exec(body), cm = /<content>([\s\S]*?)<\/content>/.exec(body);
      var tags = [], tg, tr = /<tag>([\s\S]*?)<\/tag>/g;
      while ((tg = tr.exec(body))) tags.push(xmlText(tg[1]));
      var res = [], rs, rr = /<resource>([\s\S]*?)<\/resource>/g;
      while ((rs = rr.exec(body))) {
        var fn = /<file-name>([\s\S]*?)<\/file-name>/.exec(rs[1]), mm = /<mime>([\s\S]*?)<\/mime>/.exec(rs[1]);
        res.push({ name: fn ? xmlText(fn[1]) : "", mime: mm ? xmlText(mm[1]) : "" });
      }
      notes.push({ title: oneLine(xmlText(tm ? tm[1] : "")), html: cm ? xmlText(cm[1]) : "", tags: tags, resources: res });
    }
    return notes;
  }
  function fromEvernote(col, opts) {
    var skipped = emptySkipped(), notes = [];
    var files = col.files.filter(function (f) { return ENEX_EXT.test(f.path); });
    var many = files.length > 1;
    files.forEach(function (f) {
      var book = oneLine(stripExt(baseName(f.path))), parentKey = null;
      if (many) {
        parentKey = "en:" + f.path;
        notes.push({ key: parentKey, parentKey: null, title: book, text: "", tags: [], pinned: false, folder: true });
      }
      parseEnex(f.text).forEach(function (n, i) {
        if (notes.length >= LIMITS.notes + 100) { skipped.capped++; return; }
        skipped.attachments += n.resources.length;
        var text = htmlToMd(n.html, { resources: n.resources });
        notes.push({ key: "en:" + f.path + "#" + i + ":" + n.title, parentKey: parentKey,
                     title: n.title || oneLine(text.split("\n")[0], 80) || opts.untitled || "Untitled",
                     text: cap(text, skipped), tags: uniqTags(n.tags), pinned: false });
      });
    });
    return { source: "evernote", name: files.length === 1 ? oneLine(stripExt(baseName(files[0].path))) : "", notes: notes, skipped: skipped };
  }

  // ---------- Google Keep (Takeout: Keep/*.json, one note each) ----------
  function isKeepNote(o) {
    return !!o && typeof o === "object" && !Array.isArray(o) && ("textContent" in o || "listContent" in o) &&
      ("isTrashed" in o || "isArchived" in o || "userEditedTimestampUsec" in o);
  }
  function fromKeep(list, opts) {
    var skipped = emptySkipped(), notes = [], archive = null;
    list.forEach(function (x) {
      var o = x.obj;
      if (o.isTrashed) { skipped.trashed++; return; }
      var text = "";
      if (Array.isArray(o.listContent)) {
        text = o.listContent.map(function (it) { return "- [" + (it && it.isChecked ? "x" : " ") + "] " + oneLine(it && it.text, 2000); }).join("\n");
      } else text = clean(o.textContent || "");
      (o.annotations || []).forEach(function (a) {
        if (a && /^https?:\/\//i.test(a.url || "")) text += (text ? "\n\n" : "") + "[" + (oneLine(a.title, 200) || a.url) + "](" + String(a.url).replace(/[()\s]/g, encodeURIComponent) + ")";
      });
      skipped.attachments += (o.attachments || []).length;
      var parentKey = null;
      if (o.isArchived) {
        if (!archive) { archive = { key: "kp:archive", parentKey: null, title: opts.archiveTitle || "Archive", text: "", tags: [], pinned: false, folder: true }; notes.push(archive); }
        parentKey = archive.key;
      }
      var title = oneLine(o.title) || oneLine(text.split("\n")[0].replace(/^- \[[ x]\] /, ""), 80) || opts.untitled || "Untitled";
      notes.push({ key: "kp:" + stripExt(baseName(x.path)), parentKey: parentKey, title: title, text: cap(text + (text ? "\n" : ""), skipped),
                   tags: uniqTags((o.labels || []).map(function (l) { return l && l.name; })), pinned: !!o.isPinned });
    });
    notes.sort(function (a, b) { return !!a.folder !== !!b.folder ? (a.folder ? 1 : -1) : a.title.localeCompare(b.title); });
    return { source: "keep", name: "", notes: notes, skipped: skipped };
  }

  // ---------- Simplenote (notes.json: activeNotes / trashedNotes) ----------
  function isSimplenote(o) { return !!o && typeof o === "object" && Array.isArray(o.activeNotes); }
  function fromSimplenote(o, opts) {
    var skipped = emptySkipped(), notes = [];
    skipped.trashed = Array.isArray(o.trashedNotes) ? o.trashedNotes.length : 0;
    o.activeNotes.forEach(function (n) {
      if (!n || typeof n !== "object") return;
      var all = clean(n.content || ""), nl = all.indexOf("\n");
      var first = nl < 0 ? all : all.slice(0, nl), rest = nl < 0 ? "" : all.slice(nl + 1).replace(/^\n+/, "");
      notes.push({ key: "sp:" + oneLine(n.id || first, 120), parentKey: null,
                   title: oneLine(first.replace(/^#+\s*/, ""), 120) || opts.untitled || "Untitled",
                   text: cap(rest, skipped), tags: uniqTags(n.tags || []), pinned: (n.systemTags || []).indexOf("pinned") >= 0 || !!n.pinned });
    });
    notes.sort(function (a, b) { return a.title.localeCompare(b.title); });
    return { source: "simplenote", name: "", notes: notes, skipped: skipped };
  }

  // ---------- Joplin (.jex = tar, or a RAW export folder) ----------
  // Each item is "<id>.md": title, blank line, body, blank line, then
  // "key: value" lines ending with "type_: N" (1 note, 2 notebook,
  // 4 resource, 5 tag, 6 note ↔ tag).
  function joplinItem(text) {
    var lines = text.replace(/\n+$/, "").split("\n"), meta = {}, i = lines.length - 1;
    for (; i >= 0; i--) {
      var m = /^([a-z_]+):\s?(.*)$/.exec(lines[i]);
      if (!m) break;
      meta[m[1]] = m[2];
    }
    if (!meta.type_ || !/^[0-9a-f]{32}$/.test(meta.id || "")) return null;
    var head = lines.slice(0, i + 1).join("\n").replace(/\n+$/, "");
    var nl = head.indexOf("\n");
    return { meta: meta, title: oneLine(nl < 0 ? head : head.slice(0, nl)), body: nl < 0 ? "" : head.slice(nl + 1).replace(/^\n+/, "") };
  }
  function fromJoplin(items, opts) {
    var skipped = emptySkipped(), notes = [], folders = {}, tags = {}, noteTags = {}, titles = {};
    items.forEach(function (it) {
      var t = it.meta.type_;
      if (t === "2") folders[it.meta.id] = it;
      else if (t === "5") tags[it.meta.id] = it.title;
      else if (t === "4") skipped.attachments++;
      else if (t === "1") titles[it.meta.id] = it.title;
    });
    items.forEach(function (it) {
      if (it.meta.type_ === "6" && tags[it.meta.tag_id]) (noteTags[it.meta.note_id] = noteTags[it.meta.note_id] || []).push(tags[it.meta.tag_id]);
    });
    Object.keys(folders).forEach(function (id) {
      var f = folders[id];
      notes.push({ key: "jp:" + id, parentKey: folders[f.meta.parent_id] ? "jp:" + f.meta.parent_id : null,
                   title: f.title || opts.untitled || "Untitled", text: "", tags: [], pinned: false, folder: true });
    });
    items.forEach(function (it) {
      if (it.meta.type_ !== "1") return;
      if (it.meta.deleted_time && it.meta.deleted_time !== "0") { skipped.trashed++; return; }
      var text = it.body.replace(/(^|[^!])\[([^\]\n]*)\]\(:\/([0-9a-f]{32})\)/g, function (all, pre, label, id) {
        var tt = titles[id];
        return tt ? pre + "[[" + tt + (label && label !== tt ? "|" + label : "") + "]]" : all;
      });
      if (it.meta.is_todo === "1") text = "- [" + (it.meta.todo_completed && it.meta.todo_completed !== "0" ? "x" : " ") + "] " + it.title + (text ? "\n\n" + text : "");
      notes.push({ key: "jp:" + it.meta.id, parentKey: folders[it.meta.parent_id] ? "jp:" + it.meta.parent_id : null,
                   title: it.title || opts.untitled || "Untitled", text: cap(text ? text + "\n" : "", skipped),
                   tags: uniqTags(noteTags[it.meta.id] || []), pinned: false });
    });
    // notebooks before their notes, so parents are known in order
    notes.sort(function (a, b) { return !!a.folder !== !!b.folder ? (a.folder ? -1 : 1) : a.title.localeCompare(b.title); });
    return { source: "joplin", name: "", notes: notes, skipped: skipped };
  }

  // Which kind of export is this?
  function parse(col, opts) {
    opts = opts || {};
    function done(r) {
      r.skipped.tooBig = col.tooBig || 0;
      r.skipped.unreadable = col.unreadable || 0;
      return r;
    }
    var jsons = col.files.filter(function (f) { return JSON_EXT.test(f.path) || /^\s*\{/.test(f.text) && /\.txt$/i.test(f.path); });
    var keep = [];
    for (var i = 0; i < jsons.length; i++) {
      var obj = null;
      try { obj = JSON.parse(jsons[i].text); } catch (e) { continue; }
      if (isStandardNotes(obj)) return done(fromStandardNotes(obj, opts));
      if (isSimplenote(obj)) return done(fromSimplenote(obj, opts));
      if (isKeepNote(obj)) keep.push({ path: jsons[i].path, obj: obj });
    }
    if (keep.length) return done(fromKeep(keep, opts));
    if (col.files.some(function (f) { return ENEX_EXT.test(f.path); })) return done(fromEvernote(col, opts));
    var mds = col.files.filter(function (f) { return /\.md$/i.test(f.path); }), jop = [];
    mds.forEach(function (f) { var it = joplinItem(f.text); if (it) jop.push(it); });
    if (jop.length && jop.length * 2 >= mds.length) return done(fromJoplin(jop, opts));
    return done(fromMarkdown(col, opts));
  }

  // ---------- 3. plan ----------
  var SOURCE_NAMES = { obsidian: "Obsidian", standardnotes: "Standard Notes", evernote: "Evernote", keep: "Google Keep",
                       simplenote: "Simplenote", joplin: "Joplin", markdown: "" };
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
    lexicalToMd: lexicalToMd, htmlToMd: htmlToMd, parseEnex: parseEnex, tarOpen: tarOpen, joplinItem: joplinItem
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosNotesImport = api;
})(this);
