// ============================================================
// orOS Prompter — the .orosscript file (io.js)
// ------------------------------------------------------------
// One custom prompt = one .orosscript, an orOS bundle (bundle.js,
// docs/oros-bundle.md). Pure logic, no DOM: prompter.js calls
// OrosBundle.write / read and the tests run it in Node.
//   content.json { kind: "oros-prompter-package", ver: 1,
//                  prompt: { id, cat, en, el, var_en, var_el, tags,
//                            mtime, pos },      (as the slice holds it)
//                  favorite: mtime | null, completed: ts | null }
//   preview/script.txt   both languages, variations, tags
// bundleOpts() builds the options for OrosBundle.write; fromContent()
// reads content.json back as a NEW custom prompt (fresh "c…" id), with
// the same rules the prompt editor applies, or null.
// UMD: window.PrompterIO in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var MIME = "application/x-oros-script";
  var KIND = "oros-prompter-package";
  var MAX_TEXT = 4000, MAX_VAR = 1000, MAX_TAGS = 30, MAX_TAG = 40;
  // The category ids of prompter.js CATEGORIES (without "all").
  var CATS = ["micro", "haiku", "poetry_free", "poetry_metred", "song", "aphorism",
              "theatrical", "novel", "monologue", "letter"];

  function isTs(v) { return typeof v === "number" && isFinite(v) && v > 0 && Math.floor(v) === v; }
  function text(v, max) {
    return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "";
  }
  // The editor's tag rule: trimmed, lower case, no empties (and no dupes).
  function tagList(v) {
    var out = [];
    (Array.isArray(v) ? v : []).forEach(function (x) {
      var s = typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f,]/g, "").trim().toLowerCase().slice(0, MAX_TAG) : "";
      if (s && out.indexOf(s) < 0 && out.length < MAX_TAGS) out.push(s);
    });
    return out;
  }
  function oneLine(s, n) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n); }
  function title(p, lang) {
    return oneLine((lang === "el" ? p.el || p.en : p.en || p.el), 60);
  }
  function fileName(name, ext) {
    var base = oneLine(name, 40).replace(/[\\/:*?"<>|.\u0000-\u001f]+/g, "").replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
    return (base || "prompt") + "." + ext;
  }

  // preview/script.txt: what any text editor shows
  function scriptText(p) {
    var l = [];
    if (p.en) { l.push(p.en); if (p.var_en) l.push("+ " + p.var_en); l.push(""); }
    if (p.el) { l.push(p.el); if (p.var_el) l.push("+ " + p.var_el); l.push(""); }
    if (p.tags && p.tags.length) { l.push(p.tags.map(function (x) { return "#" + x; }).join(" ")); l.push(""); }
    return l.join("\r\n");
  }

  // p: the custom prompt; st: { favorites, completed } maps of the state;
  // o: { lang, date }.
  function bundleOpts(p, st, o) {
    o = o || {}; st = st || {};
    var prompt = JSON.parse(JSON.stringify(p));
    var fav = st.favorites && isTs(st.favorites[p.id]) ? st.favorites[p.id] : null;
    var done = st.completed && isTs(st.completed[p.id]) ? st.completed[p.id] : null;
    var lang = o.lang === "el" ? "el" : "en";
    return {
      mime: MIME, app: "prompter", schema: "prompter/1",
      content: { kind: KIND, ver: 1, prompt: prompt, favorite: fav, completed: done },
      meta: { title: title(p, lang), subjects: tagList(p.tags), description: p.cat || "",
        created: p.mtime, modified: p.mtime, id: p.id, language: lang, generator: "orOS Prompter" },
      preview: [{ name: "script.txt", data: scriptText(p), type: "text/plain" }],
      date: o.date
    };
  }

  // content.json → { prompt, favorite (bool), completed (ts | null) } or null.
  // o: { id (fresh), now, pos }. Both languages are required by the
  // editor; a file with one gets it copied into the other.
  function fromContent(c, o) {
    o = o || {};
    if (!c || typeof c !== "object" || c.kind !== KIND) return null;
    var s = c.prompt;
    if (!s || typeof s !== "object") return null;
    var en = text(s.en, MAX_TEXT), el = text(s.el, MAX_TEXT);
    if (!en && !el) return null;
    var now = isTs(o.now) ? o.now : Date.now();
    return {
      prompt: {
        id: o.id, cat: CATS.indexOf(s.cat) >= 0 ? s.cat : "micro",
        en: en || el, el: el || en,
        var_en: text(s.var_en, MAX_VAR), var_el: text(s.var_el, MAX_VAR),
        tags: tagList(s.tags), mtime: now, pos: typeof o.pos === "number" ? o.pos : 0
      },
      favorite: c.favorite != null && c.favorite !== false,
      completed: isTs(c.completed) && c.completed <= now ? c.completed : null
    };
  }

  var api = { MIME: MIME, KIND: KIND, CATS: CATS, bundleOpts: bundleOpts, fromContent: fromContent,
    scriptText: scriptText, title: title, fileName: fileName };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PrompterIO = api;
})(typeof window !== "undefined" ? window : this);
