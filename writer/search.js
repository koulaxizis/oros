// ============================================================
// orOS Writer — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-writer-data, never writes.
// One hit per document (title; the plain text of its body, author,
// category and tags as text). Deleted documents stay in docs[] as
// del:true tombstones and are skipped. Body HTML is turned into
// text in an INERT document (DOMParser: no scripts run, nothing
// loads), footnote markers removed, like writer.js docPlainText();
// the text is cached per document and mtime.
// Opens through the generic deep link: target { doc }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-writer-data";
  var cache = {};       // id → { m: mtime, len: html length, text }

  function str(v) { return typeof v === "string" ? v.trim() : ""; }

  function plain(html) {
    html = String(html || "");
    if (!html) return "";
    if (typeof root.DOMParser === "function") {
      try {
        var doc = new root.DOMParser().parseFromString(html, "text/html");
        var fn = doc.querySelectorAll("sup.fn-ref");
        for (var i = 0; i < fn.length; i++) fn[i].parentNode.removeChild(fn[i]);
        var blocks = doc.querySelectorAll("p,div,li,h1,h2,h3,h4,h5,h6,br,tr,blockquote");
        for (var j = 0; j < blocks.length; j++) blocks[j].appendChild(doc.createTextNode(" "));
        return (doc.body ? doc.body.textContent : "").replace(/\s+/g, " ").trim();
      } catch (e) {}
    }
    // Fallback (node tests): strip tags, decode the common entities.
    return html.replace(/<sup class="fn-ref"[^>]*>.*?<\/sup>/g, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
      .replace(/\s+/g, " ").trim();
  }

  var PROVIDER = {
    id: "writer",
    keys: [KEY],
    plain: plain,
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], seen = {};
      if (!d || !Array.isArray(d.docs)) return out;
      d.docs.forEach(function (doc) {
        if (!doc || typeof doc.id !== "string" || doc.del) return;
        seen[doc.id] = true;
        var html = typeof doc.html === "string" ? doc.html : "";
        var c = cache[doc.id];
        if (!c || c.m !== doc.mtime || c.len !== html.length) {
          c = cache[doc.id] = { m: doc.mtime, len: html.length, text: plain(html) };
        }
        var title = str(doc.title) || c.text.slice(0, 32).trim() ||
                    (ctx.lang === "el" ? "Χωρίς τίτλο" : "Untitled");
        out.push({
          id: doc.id,
          title: title,
          text: [c.text, str(doc.author), str(doc.category),
                 (Array.isArray(doc.tags) ? doc.tags : []).map(str).filter(Boolean).join(" ")]
            .filter(Boolean).join(" · "),
          when: typeof doc.mtime === "number" ? doc.mtime : 0,
          target: { doc: doc.id }
        });
      });
      Object.keys(cache).forEach(function (id) { if (!seen[id]) delete cache[id]; });
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
