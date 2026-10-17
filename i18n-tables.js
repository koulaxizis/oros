// ============================================================
// orOS — en/el string-table reader (no DOM, no storage)
// Finds the { en: {…}, el: {…} } tables in a script's TEXT with a small
// tokenizer (strings, template literals, comments); never runs it.
// Used by Settings › Help translate (settings/translate.js) to show an
// app's English and Greek strings, and by the CI checks
// (tests/i18n.test.js through the scanner of the translator tools).
// Versioning: orOS-wide version lives ONLY in shell.js.
// ============================================================
(function (root) {
  "use strict";

  // Index just past the literal / comment that starts at i, or i itself.
  function skipToken(s, i) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      for (let j = i + 1; j < s.length; j++) {
        if (s[j] === "\\") { j++; continue; }
        if (s[j] === c) return j + 1;
      }
      return s.length;
    }
    if (c === "/" && s[i + 1] === "/") { const j = s.indexOf("\n", i); return j < 0 ? s.length : j; }
    if (c === "/" && s[i + 1] === "*") { const j = s.indexOf("*/", i + 2); return j < 0 ? s.length : j + 2; }
    return i;
  }

  // The balanced { … } block starting at the brace at index i: [i, end).
  function blockEnd(s, i) {
    let depth = 0;
    for (let j = i; j < s.length;) {
      const k = skipToken(s, j);
      if (k !== j) { j = k; continue; }
      if (s[j] === "{") depth++;
      else if (s[j] === "}") { depth--; if (depth === 0) return j + 1; }
      j++;
    }
    return -1;
  }

  const unquote = (lit) => {
    try { return lit[0] === "`" ? lit.slice(1, -1) : JSON.parse(lit[0] === "'" ? '"' + lit.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"' : lit); }
    catch (e) { return null; }
  };

  // Top-level entries of an object literal body: key → string value | null.
  function entries(s, from, to) {
    const out = new Map();
    let depth = 0, expectKey = true;
    for (let j = from + 1; j < to - 1;) {
      if (depth === 0 && expectKey) {
        const m = /^\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([A-Za-z_$][\w$]*))\s*:\s*/.exec(s.slice(j, j + 300));
        if (m) {
          const key = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
          j += m[0].length;
          let val = null;
          const q = s[j];
          if (q === '"' || q === "'" || q === "`") {
            const e = skipToken(s, j);
            const after = /^\s*([,}]|$)/.exec(s.slice(e, e + 50));
            if (after && !(q === "`" && s.slice(j, e).includes("${"))) val = unquote(s.slice(j, e));
          }
          out.set(key, val);
          expectKey = false;
          continue;
        }
      }
      const k = skipToken(s, j);
      if (k !== j) { j = k; continue; }
      const c = s[j];
      if (c === "{" || c === "[" || c === "(") depth++;
      else if (c === "}" || c === "]" || c === ")") depth--;
      else if (c === "," && depth === 0) expectKey = true;
      j++;
    }
    return out;
  }

  const line = (s, i) => s.slice(0, i).split("\n").length;
  const GREEK = /[\u0370-\u03ff\u1f00-\u1fff]/;
  // An English sentence: three or more lowercase words, no Greek letter.
  const sentence = (v) => typeof v === "string" && !GREEK.test(v) &&
    (v.replace(/\{[^}]*\}|https?:\/\/\S+/g, " ").match(/(^|\s)[a-z]{2,}(?=[\s,.;:!?…]|$)/g) || []).length >= 3;

  function tablesIn(s, rel) {
    const out = [];
    const re = /(^|[\s{,(])(?:en|"en"|'en')\s*:\s*\{/g;
    let m;
    while ((m = re.exec(s))) {
      const open = m.index + m[0].length - 1;
      // An "en" inside a string or comment is not a table: re-check by scanning from the line start.
      const enEnd = blockEnd(s, open);
      if (enEnd < 0) continue;
      const next = /^\s*,\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(?:el|"el"|'el')\s*:\s*\{/.exec(s.slice(enEnd, enEnd + 400));
      if (!next) continue;
      const elOpen = enEnd + next[0].length - 1;
      const elEnd = blockEnd(s, elOpen);
      if (elEnd < 0) continue;
      out.push({ at: rel + ":" + line(s, open), en: entries(s, open, enEnd), el: entries(s, elOpen, elEnd), range: [open, elEnd] });
      re.lastIndex = elEnd;
    }
    // Keys added after the table: NAME.en["k"] = … / NAME.el["k"] = …
    const added = {};
    const re2 = /\b([A-Za-z_$][\w$]*)\.(en|el)\[\s*(["'])([^"']+)\3\s*\]\s*=(?!=)/g;
    while ((m = re2.exec(s))) {
      const o = (added[m[1]] = added[m[1]] || { en: new Map(), el: new Map(), at: rel + ":" + line(s, m.index) });
      o[m[2]].set(m[4], null);
    }
    for (const o of Object.values(added)) out.push(o);
    return out;
  }

  var api = { skipToken: skipToken, blockEnd: blockEnd, unquote: unquote, entries: entries,
              tablesIn: tablesIn, line: line, GREEK: GREEK, sentence: sentence };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.orosI18nTables = api;
})(typeof window !== "undefined" ? window : null);
