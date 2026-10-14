// ============================================================
// orOS Writer — tracked changes (pure logic, no DOM)
// In the document a tracked change is plain, sanitised HTML:
//   <ins class="tc" data-tc="ID" data-au="Name" data-ts="ms">new</ins>
//   <del class="tc" data-tc="ID" data-au="Name" data-ts="ms">old</del>
// (a <del> without class="tc" is ordinary strikethrough).
//   · diffEdit(old, new, caret): what one edit of a text node did
//   · resolveHtml(html, "accept"|"reject", id?): accept / reject all
//     changes (or one) in an html string (exports, mail merge)
//   · cleanAttrs(au, ts, id): the only attribute values allowed
//   · colorIndex(author): a stable colour per author
//   · docxOpen / docxClose: <w:ins> / <w:del> for the DOCX writer
//   · deviceName(userAgent): the default author name
// Loaded by writer.js (window.WriterTrack) and the tests (require).
// ============================================================
(function (root) {
  "use strict";

  // Old text → new text of one text node: { p, removed, inserted }
  // (p = where the change starts). caret (position in the new text,
  // -1 when unknown) settles the ambiguous cases ("aa" → "aaa").
  // A no-break space and a space count as the same character: browsers
  // swap one for the other around the caret while typing, and that is
  // not an edit.
  function diffEdit(oldT, newT, caret) {
    oldT = String(oldT || ""); newT = String(newT || "");
    var o = oldT.replace(/ /g, " "), n = newT.replace(/ /g, " ");
    var d = n.length - o.length;
    if (caret >= 0 && caret <= n.length) {
      if (d > 0 && caret - d >= 0 &&
          n.slice(0, caret - d) === o.slice(0, caret - d) && n.slice(caret) === o.slice(caret - d)) {
        return { p: caret - d, removed: "", inserted: newT.slice(caret - d, caret) };
      }
      if (d < 0 && caret - d <= o.length &&
          o.slice(0, caret) === n.slice(0, caret) && o.slice(caret - d) === n.slice(caret)) {
        return { p: caret, removed: oldT.slice(caret, caret - d), inserted: "" };
      }
    }
    var p = 0, max = Math.min(o.length, n.length);
    while (p < max && o.charCodeAt(p) === n.charCodeAt(p)) p++;
    var s = 0;
    while (s < max - p && o.charCodeAt(o.length - 1 - s) === n.charCodeAt(n.length - 1 - s)) s++;
    // keep surrogate pairs whole
    if (p > 0 && /[\uD800-\uDBFF]/.test(newT[p - 1])) p--;
    return { p: p, removed: oldT.slice(p, oldT.length - s), inserted: newT.slice(p, newT.length - s) };
  }

  /* ----- accept / reject in an html string ----- */
  var TAG_RE = /<(\/?)(ins|del)\b([^>]*)>/gi;
  function isTc(attrs) { return /\bclass\s*=\s*["']?tc["'\s>]/i.test(attrs + ">"); }
  function idOf(attrs) { var m = /\bdata-tc\s*=\s*["']?([A-Za-z0-9_-]+)/.exec(attrs); return m ? m[1] : ""; }

  // accept: insertions stay (unwrapped), deletions go. reject: the
  // other way round. With id, only that change is resolved.
  function resolveHtml(html, mode, onlyId) {
    html = String(html || "");
    var drop = mode === "reject" ? "ins" : "del";
    var out = "", last = 0, stack = [], skip = 0, m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(html))) {
      var closing = m[1] === "/", tag = m[2].toLowerCase(), attrs = m[3];
      if (!skip) out += html.slice(last, m.index);
      last = TAG_RE.lastIndex;
      if (!closing) {
        var tc = isTc(attrs) && (!onlyId || idOf(attrs) === onlyId);
        stack.push({ tag: tag, tc: tc });
        if (tc && tag === drop) skip++;
        else if (!tc && !skip) out += m[0];
      } else {
        // pop the matching open tag of this name
        var k = stack.length - 1;
        while (k >= 0 && stack[k].tag !== tag) k--;
        if (k < 0) { if (!skip) out += m[0]; continue; }
        var top = stack[k];
        stack.splice(k, 1);
        if (top.tc && tag === drop) skip--;
        else if (!top.tc && !skip) out += m[0];
      }
    }
    if (!skip) out += html.slice(last);
    return out;
  }

  function hasChanges(html) {
    TAG_RE.lastIndex = 0;
    var m;
    while ((m = TAG_RE.exec(String(html || "")))) if (!m[1] && isTc(m[3])) return true;
    return false;
  }

  // Attribute values that may stay on a change mark (imports, DOCX).
  function cleanAttrs(au, ts, id) {
    var a = String(au == null ? "" : au).replace(/[\u0000-\u001F<>"]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    var n = Math.round(Number(ts));
    if (!Number.isFinite(n) || n < 0 || n > 8.64e15) n = 0;
    var i = /^[A-Za-z0-9_-]{1,40}$/.test(String(id || "")) ? String(id) : "";
    return { au: a, ts: n, id: i };
  }

  function colorIndex(author, n) {
    var h = 0x811c9dc5, s = String(author || "");
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0) % (n || 8);
  }

  function xmlEsc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  // <w:ins> / <w:del> around runs. n: a number unique in the file.
  function docxOpen(kind, n, au, ts) {
    var c = cleanAttrs(au, ts, "");
    var date = c.ts ? new Date(c.ts).toISOString().replace(/\.\d{3}Z$/, "Z") : "";
    return "<w:" + (kind === "del" ? "del" : "ins") + " w:id=\"" + (Math.max(0, n | 0)) + "\" w:author=\"" +
      xmlEsc(c.au || "orOS") + "\"" + (date ? " w:date=\"" + date + "\"" : "") + ">";
  }
  function docxClose(kind) { return kind === "del" ? "</w:del>" : "</w:ins>"; }
  // w:date → ms (0 when missing or bad)
  function parseDocxDate(s) {
    var n = Date.parse(String(s || ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // A readable default author for this device.
  function deviceName(ua) {
    ua = String(ua || "");
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua)) return "iPad";
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
    if (/CrOS/.test(ua)) return "Chromebook";
    if (/Windows/.test(ua)) return "Windows PC";
    if (/Mac OS X|Macintosh/.test(ua)) return "Mac";
    if (/Linux/.test(ua)) return "Linux PC";
    return "orOS";
  }

  var api = {
    diffEdit: diffEdit, resolveHtml: resolveHtml, hasChanges: hasChanges, cleanAttrs: cleanAttrs,
    colorIndex: colorIndex, docxOpen: docxOpen, docxClose: docxClose, parseDocxDate: parseDocxDate,
    deviceName: deviceName
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WriterTrack = api;
})(typeof window !== "undefined" ? window : this);
