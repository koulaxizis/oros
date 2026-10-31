// ============================================================
// orOS Writer — io.js: opening other formats and writing .orosdoc
// The pure part of Writer's Open and "Save as orOS file", shared by
// writer.js (window.WriterIO) and writer/convert.js (the Converter),
// so the two never drift. No app state, no storage, no UI: it needs
// a DOM (DOMParser, an inert document) only while it parses.
//   · parseTextOf(text, ext)  .orosdoc (JSON) .json .txt .html .htm
//                             .rtf .md .markdown → payload
//   · parseZipBuf(buf, ext)   .docx / .odt (ArrayBuffer) → Promise<payload>
//   · prepareImport(payload)  sanitised html + footnotes / comments
//                             with fresh ids (what "Open" keeps)
//   · sanitizeHtml, inertDiv, badUrl, normalizeBlocks, unwrap
//   · docContent(doc)         content.json of a document
//   · standaloneHtml(doc, c, lang, untitled)  preview/document.html
//   · writeBundle(obj, doc, page, lang)       → Promise<Uint8Array>
//   · liftImages / dropImages  data: pictures ↔ media/<sha256>.<ext>
// payload = { kind: 'doc', title, html, footnotes, comments, … }
// Needs window.OrosBundle (bundle.js) for the bundle and, for tracked
// changes in DOCX, window.WriterTrack (track.js). Loaded by
// writer/index.html before writer.js and listed in convert.js deps.
// ============================================================
(function (root) {
  "use strict";

  const IO_BUNDLE_MIME = 'application/x-oros-doc';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // bundle.js: window.OrosBundle, or required in Node (tests)
  function bundle() {
    if (root.OrosBundle) return root.OrosBundle;
    if (typeof require === 'function') return require('../bundle.js');
    throw new Error('bundle.js is not loaded');
  }

  /* ----- Block normalisation (every exporter) ----- */
  const IO_INLINE_RE = /^(#text|A|ABBR|B|BR|CITE|CODE|DEL|EM|FONT|I|IMG|INS|KBD|MARK|Q|S|SMALL|SPAN|STRIKE|STRONG|SUB|SUP|TIME|U)$/;

  function ioNormalizeBlocks(container) {
    const d = container.ownerDocument;
    // Chrome's indent writes <ul><li>a</li><ul>…</ul></ul> — a list as a
    // DIRECT child of a list. Every exporter skipped non-LI children, so
    // indented items vanished. Re-home each one into the previous <li>.
    container.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol').forEach(nl => {
      const prev = nl.previousElementSibling;
      if (prev && prev.nodeName === 'LI') prev.appendChild(nl);
      else {
        const li = d.createElement('li');
        nl.parentNode.insertBefore(li, nl);
        li.appendChild(nl);
      }
    });
    const isInline = n => n.nodeType === 3 ||
      (n.nodeType === 1 && IO_INLINE_RE.test(n.nodeName) &&
       !(n.classList && n.classList.contains('page-break-marker')));
    Array.from(container.children).forEach(el => {
      if (el.nodeName !== 'DIV' || el.classList.contains('page-break-marker') ||
          el.classList.contains('toc-inline')) return;
      if (Array.from(el.childNodes).every(isInline)) {
        const p = d.createElement('p');
        Array.from(el.attributes).forEach(a => p.setAttribute(a.name, a.value));
        while (el.firstChild) p.appendChild(el.firstChild);
        el.replaceWith(p);
      } else {
        ioNormalizeBlocks(el);
      }
    });
    let run = null;
    Array.from(container.childNodes).forEach(n => {
      if (n.nodeType === 8) return;
      if (isInline(n)) {
        if (!run && n.nodeType === 3 && !n.nodeValue.trim()) return;
        if (!run) { run = d.createElement('p'); container.insertBefore(run, n); }
        run.appendChild(n);
      } else run = null;
    });
    return container;
  }

  function ioUnwrap(el) {
    const frag = el.ownerDocument.createDocumentFragment();
    while (el.firstChild) frag.appendChild(el.firstChild);
    el.replaceWith(frag);
  }

  // html → a normalised container in an inert document (nothing loads)
  function ioCloneOf(html) {
    const c = ioInertDiv();
    c.innerHTML = html;
    return ioNormalizeBlocks(c);
  }

  /* ----- Standalone page (preview/document.html, HTML export) ----- */
  // c: the document's html as a normalised container (exportClone / cloneOf)
  function ioStandaloneHtml(doc, c, lang, untitled) {
    c.querySelectorAll('mark.cmt-mark').forEach(ioUnwrap);   // comments stay private
    lang = lang === 'el' ? 'el' : 'en';
    const metaBits = [];

    // Footnotes appendix — ref DOM order, numbered (never alphabetical)
    const seen = new Set();
    const fns = [];
    c.querySelectorAll('sup.fn-ref').forEach(ref => {
      const id = ref.getAttribute('data-fn');
      if (!id || seen.has(id)) return;
      seen.add(id);
      const e = (doc.footnotes || []).find(f => f.id === id);
      if (e) fns.push({ n: ref.textContent, text: e.text || '' });
    });

    if (doc.author) metaBits.push('<meta name="author" content="' + escAttr(doc.author) + '">');
    if (doc.tags && doc.tags.length)
      metaBits.push('<meta name="keywords" content="' + escAttr(doc.tags.join(', ')) + '">');
    if (doc.category) metaBits.push('<meta name="subject" content="' + escAttr(doc.category) + '">');

    let body = c.innerHTML;
    if (fns.length) {
      body += '<section class="footnotes"><hr><ol>' +
        fns.map(f => '<li id="fn' + escAttr(f.n) + '">' + esc(f.text) + '</li>').join('') +
        '</ol></section>';
    }

    return '<!DOCTYPE html>\n<html lang="' + lang + '">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<title>' + esc(doc.title || untitled || 'Untitled') + '</title>\n' + metaBits.join('\n') + '\n' +
      '<style>\n' +
      'body{font-family:"Nunito",-apple-system,"Segoe UI",sans-serif;line-height:1.8;' +
      'max-width:720px;margin:0 auto;padding:48px 24px;color:#222;background:#fff}\n' +
      'sup.fn-ref{font-size:0.72em;vertical-align:super}\n' +
      '.footnotes{margin-top:3em;font-size:0.9em;color:#444}\n' +
      'blockquote{border-left:3px solid #bbb;margin:1em 0;padding:0.3em 1em;color:#444}\n' +
      'code,pre{font-family:"Courier New",monospace;background:#f4f4f4;border-radius:4px}\n' +
      'code{padding:2px 6px}pre{padding:12px 16px;overflow-x:auto}\n' +
      'table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}\n' +
      'img{max-width:100%}figure{margin:1em 0;text-align:center}\n' +
      '.page-break-marker{border:none;border-top:1px solid #bbb;height:0;margin:2em 0}\n' +
      '@media print{body{padding:0}}\n' +
      '</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';
  }

  /* ----- content.json ----- */
  function ioDocContent(doc) {
    return JSON.parse(JSON.stringify({
      orosWriter: true, ver: 1,
      doc: {
        title: doc.title, author: doc.author, tags: doc.tags,
        category: doc.category, html: doc.html,
        footnotes: doc.footnotes || [], comments: doc.comments || [],
        pageSize: doc.pageSize, margins: doc.margins,
        header: doc.header || '', footer: doc.footer || ''
      }
    }));
  }

  /* ----- .orosdoc bundle (bundle.js, docs/oros-bundle.md) ----- */
  const IO_DATA_IMG = /(<img\b[^>]*?\bsrc=")data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=\s]+)"/gi;
  function ioB64Bytes(b64) {
    const bin = atob(String(b64).replace(/\s+/g, ''));
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function ioBytesB64(u) {
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function ioLiftImages(html, prefix, media) {
    const keys = {}, jobs = [];
    String(html).replace(IO_DATA_IMG, (m, head, sub, b64) => {
      if (keys[b64] !== undefined) return m;
      keys[b64] = null;
      let bytes = null;
      try { bytes = ioB64Bytes(b64); } catch (e) { return m; }
      jobs.push(bundle().sha256(bytes).then(h => {
        const key = h + '.' + (sub.toLowerCase() === 'jpeg' ? 'jpg' : sub.toLowerCase());
        keys[b64] = key;
        media[key] = bytes;
      }));
      return m;
    });
    return Promise.all(jobs).then(() => String(html).replace(IO_DATA_IMG,
      (m, head, sub, b64) => keys[b64] ? head + prefix + keys[b64] + '"' : m));
  }
  function ioDropImages(html, media) {
    return String(html).replace(/(<img\b[^>]*?\bsrc=")media\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})"/gi, (m, head, key) => {
      const f = Object.prototype.hasOwnProperty.call(media, key) ? media[key] : null;
      if (!f || !/^image\/(png|jpeg|gif|webp)$/.test(f.type)) return head + '"';
      return head + 'data:' + f.type + ';base64,' + ioBytesB64(f.bytes) + '"';
    });
  }
  // The .orosdoc bundle of one document: obj = ioDocContent(doc), page =
  // ioStandaloneHtml(…). Pictures leave both for media/<sha256>.<ext>.
  function ioWriteBundle(obj, doc, page, lang) {
    const media = {};
    return Promise.all([
      ioLiftImages(obj.doc.html, 'media/', media),
      ioLiftImages(page, '../media/', media)
    ]).then(([html, page]) => {
      obj.doc.html = html;
      return bundle().write({
        mime: IO_BUNDLE_MIME, app: 'writer', schema: 'writer/1', content: obj,
        meta: { title: doc.title || '', creator: doc.author || '', subjects: doc.tags || [],
          description: doc.category || '', created: doc.fm && doc.fm.c, modified: doc.mtime, id: doc.id,
          language: lang === 'el' ? 'el' : 'en', generator: 'orOS Writer' },
        media: media, preview: [{ name: 'document.html', data: page, type: 'text/html' }], date: new Date()
      });
    });
  }

  /* ----- RTF ----- */
  /* ----- RTF → HTML: bold, italic, underline, strike, superscript,
     alignment, headings (style names / outline levels), lists (list
     table, or the list text Word writes before each item). Tables
     come as text, one row per paragraph. Pictures and objects are
     skipped (never run). ----- */
  // the group that starts at raw[i] ('{') → its end index (the '}')
  function ioRtfGroupEnd(raw, i) {
    let depth = 0;
    for (let k = i; k < raw.length; k++) {
      const c = raw[k];
      if (c === '\\') { k++; continue; }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return k;
    }
    return raw.length - 1;
  }
  // the direct sub-groups of a group's text
  function ioRtfKids(s) {
    const out = [];
    for (let k = 1; k < s.length - 1; k++) {
      if (s[k] === '\\') { k++; continue; }
      if (s[k] === '{') { const e = ioRtfGroupEnd(s, k); out.push(s.slice(k, e + 1)); k = e; }
    }
    return out;
  }
  function ioRtfDest(raw, word) {
    const m = new RegExp('\\{\\s*(?:\\\\\\*\\s*)?\\\\' + word + '(?![a-zA-Z])').exec(raw);
    return m ? raw.slice(m.index, ioRtfGroupEnd(raw, m.index) + 1) : '';
  }
  // \stylesheet → s number → { name, outline }
  function ioRtfStyles(raw) {
    const map = {};
    ioRtfKids(ioRtfDest(raw, 'stylesheet')).forEach(g => {
      const m = /\\s(\d+)(?![a-zA-Z\d])/.exec(g);
      if (!m || /^\{\s*\\\*\s*\\cs/.test(g)) return;
      const ol = /\\outlinelevel(\d+)/.exec(g);
      const name = g.slice(1, -1).replace(/\{[^{}]*\}/g, '').replace(/\\[a-zA-Z]+-?\d* ?/g, '').replace(/[{}]/g, '').split(';')[0].trim();
      map[m[1]] = { name: name, outline: ol ? +ol[1] : -1 };
    });
    return map;
  }
  // \listtable + \listoverridetable → ls number → [ { nfc, start } per level ]
  function ioRtfLists(raw) {
    const byId = {}, map = {};
    ioRtfKids(ioRtfDest(raw, 'listtable')).forEach(g => {
      const kids = ioRtfKids(g);
      const levels = kids.filter(k => /^\{\s*\\listlevel/.test(k)).map(k => {
        const nfc = /\\levelnfc(\d+)/.exec(k), st = /\\levelstartat(\d+)/.exec(k);
        return { nfc: nfc ? +nfc[1] : 0, start: st ? +st[1] : 1 };
      });
      // the list's own \listid, outside its levels
      let own = g;
      kids.forEach(k => { own = own.replace(k, ''); });
      const id = /\\listid(-?\d+)/.exec(own);
      if (id) byId[id[1]] = levels;
    });
    ioRtfKids(ioRtfDest(raw, 'listoverridetable')).forEach(g => {
      const id = /\\listid(-?\d+)/.exec(g), ls = /\\ls(\d+)/.exec(g);
      if (id && ls && byId[id[1]]) map[ls[1]] = byId[id[1]];
    });
    return map;
  }
  const IO_RTF_NFC = { 1: 'upper-roman', 2: 'lower-roman', 3: 'upper-alpha', 4: 'lower-alpha' };

  function ioParseRtf(raw) {
    raw = String(raw || '');
    const SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|listtable|listoverridetable|themedata|colorschememapping|latentstyles|datastore|generator|header|headerl|headerr|headerf|footer|footerl|footerr|footerf|object|rsidtbl|xmlnstbl|mmathPr|filetbl|revtbl|footnote|annotation|shp|shppict|nonshppict|fldinst|bkmkstart|bkmkend)$/;
    const styles = ioRtfStyles(raw), lists = ioRtfLists(raw);
    const cpg = (raw.match(/\\ansicpg(\d+)/) || [])[1] || '1252';
    let dec = null;
    try { dec = new TextDecoder('windows-' + cpg); } catch (e) { dec = null; }
    const byteChar = b => {
      if (dec) { try { return dec.decode(new Uint8Array([b])); } catch (e) {} }
      return String.fromCharCode(b);
    };
    const paras = [];
    let fmt = { b: false, i: false, u: false, s: false, sup: false };
    let para = { align: '', s: -1, ls: 0, ilvl: 0, outline: -1 };
    let segs = [], marker = null;           // marker: the list text, while it is read
    let uc = 1, i = 0;
    const stack = [];                       // { fmt, skip, mark }
    let skip = false, mark = false;
    const put = t => {
      if (!t) return;
      if (mark) { marker += t; return; }
      const last = segs[segs.length - 1];
      if (last && !last.br && last.b === fmt.b && last.i === fmt.i && last.u === fmt.u && last.s === fmt.s && last.sup === fmt.sup) last.t += t;
      else segs.push(Object.assign({ t: t }, fmt));
    };
    const endPara = () => {
      paras.push({ p: Object.assign({}, para), segs: segs, marker: marker });
      segs = []; marker = null;
    };
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '{') {
        stack.push({ fmt: Object.assign({}, fmt), skip: skip, mark: mark });
        if (!skip) {
          const head = /^\{\s*(\\\*)?\s*\\([a-zA-Z]+)/.exec(raw.slice(i, i + 48));
          if (head && head[2] === 'listtext' || head && head[2] === 'pntext') { mark = true; marker = ''; }
          else if (head && (head[1] || SKIP.test(head[2]))) skip = true;
        }
        i++; continue;
      }
      if (ch === '}') {
        const st = stack.pop();
        if (st) { fmt = st.fmt; skip = st.skip; mark = st.mark; }
        i++; continue;
      }
      if (skip) { if (ch === '\\') i++; i++; continue; }
      if (ch === '\\') {
        const cw = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(raw.slice(i, i + 40));
        if (cw) {
          const w = cw[1], num = cw[2], n = num === undefined ? null : parseInt(num, 10);
          i += cw[0].length;
          if (w === 'par' || w === 'sect' || w === 'page' || w === 'row') { if (!mark) endPara(); }
          else if (w === 'line') { if (!mark) segs.push({ br: true }); }
          else if (w === 'tab' || w === 'cell') put('\t');
          else if (w === 'pard') para = { align: '', s: -1, ls: 0, ilvl: 0, outline: -1 };
          else if (w === 'plain') fmt = { b: false, i: false, u: false, s: false, sup: false };
          else if (w === 'b') fmt.b = n !== 0;
          else if (w === 'i') fmt.i = n !== 0;
          else if (w === 'ulnone') fmt.u = false;
          else if (/^ul/.test(w) && !/^ulc$/.test(w)) fmt.u = n !== 0;
          else if (w === 'strike' || w === 'striked') fmt.s = n !== 0;
          else if (w === 'super') fmt.sup = true;
          else if (w === 'up') fmt.sup = n !== 0;
          else if (w === 'nosupersub') fmt.sup = false;
          else if (w === 'ql') para.align = '';
          else if (w === 'qc') para.align = 'center';
          else if (w === 'qr') para.align = 'right';
          else if (w === 'qj' || w === 'qd') para.align = 'justify';
          else if (w === 's' && n !== null) para.s = n;
          else if (w === 'ls' && n !== null) para.ls = n;
          else if (w === 'ilvl' && n !== null) para.ilvl = Math.min(8, Math.max(0, n));
          else if (w === 'outlinelevel' && n !== null) para.outline = n;
          else if (w === 'emdash') put('—');
          else if (w === 'endash') put('–');
          else if (w === 'bullet') put('•');
          else if (w === 'lquote') put('‘');
          else if (w === 'rquote') put('’');
          else if (w === 'ldblquote') put('“');
          else if (w === 'rdblquote') put('”');
          else if (w === 'uc' && n !== null) uc = Math.max(0, n);
          else if (w === 'u' && n !== null) {
            put(String.fromCharCode(n < 0 ? n + 65536 : n));
            // swallow the fallback characters (\'hh or plain) Word writes after \uN
            for (let k = 0; k < uc && i < raw.length; k++) {
              if (/^\\'[0-9a-fA-F]{2}/.test(raw.slice(i, i + 4))) i += 4;
              else if (raw[i] !== '\\' && raw[i] !== '{' && raw[i] !== '}') i++;
            }
          }
          continue;
        }
        const hex = /^\\'([0-9a-fA-F]{2})/.exec(raw.slice(i, i + 4));
        if (hex) { put(byteChar(parseInt(hex[1], 16))); i += 4; continue; }
        if (/^\\[{}\\]/.test(raw.slice(i, i + 2))) { put(raw[i + 1]); i += 2; continue; }
        if (raw[i + 1] === '~') { put(' '); i += 2; continue; }
        i += 2; continue;
      }
      if (ch === '\r' || ch === '\n') { i++; continue; }   // raw newlines are not text in RTF
      put(ch); i++;
    }
    if (segs.some(s => s.br || s.t.trim())) endPara();

    const inline = sg => {
      const out = sg.map(s => {
        if (s.br) return '<br>';
        let h = esc(s.t).replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
        if (!s.t.trim()) return h;
        if (s.s)   h = '<del>' + h + '</del>';
        if (s.u)   h = '<u>' + h + '</u>';
        if (s.i)   h = '<em>' + h + '</em>';
        if (s.b)   h = '<strong>' + h + '</strong>';
        if (s.sup) h = '<sup>' + h + '</sup>';
        return h;
      }).join('');
      return out.replace(/^(?:\s|&nbsp;)+|(?:\s|&nbsp;)+$/g, '');
    };
    // pure (no DOM): Node reads RTF too
    let html = '', title = '';
    const stackL = [];   // open lists: { tag, ilvl, key }
    const closeTo = n => { while (stackL.length > n) html += '</li></' + stackL.pop().tag + '>'; };
    const counts = {};
    paras.forEach(pa => {
      const p = pa.p, body = inline(pa.segs);
      if (!body && !pa.marker) { closeTo(0); return; }
      if (!title) title = body.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim().slice(0, 80);
      const st = styles[p.s] || { name: '', outline: -1 };
      const al = p.align ? ' style="text-align:' + p.align + '"' : '';
      // a list item: the list table says how, else the list text
      let kind = null;
      const lv = p.ls && lists[p.ls] ? lists[p.ls][p.ilvl] || lists[p.ls][0] : null;
      if (lv) kind = lv.nfc === 23 || lv.nfc === 255 ? { tag: 'ul', type: '', start: 1 } : { tag: 'ol', type: IO_RTF_NFC[lv.nfc] || '', start: lv.start };
      else if (pa.marker !== null && pa.marker.trim()) {
        const mt = pa.marker.trim().replace(/[.)]$/, '');
        kind = /^\d+$/.test(mt) ? { tag: 'ol', type: '', start: parseInt(mt, 10), fixed: true } : { tag: 'ul', type: '', start: 1 };
      }
      if (!kind) {
        closeTo(0);
        const m = /^heading\s*(\d)/i.exec(st.name);
        let lvl = m ? +m[1] : 0;
        const ol = p.outline >= 0 ? p.outline : st.outline;
        if (!lvl && ol >= 0 && ol <= 5) lvl = ol + 1;
        if (!lvl && /^title$/i.test(st.name)) lvl = 1;
        // a heading is bold already: its bold is not repeated
        html += lvl >= 1 && lvl <= 6
          ? '<h' + lvl + al + '>' + inline(pa.segs.map(g => g.br ? g : Object.assign({}, g, { b: false }))) + '</h' + lvl + '>'
          : '<p' + al + '>' + body + '</p>';
        return;
      }
      // numbering goes on after a break in the same list
      const key = String(p.ls || 'm');
      const c = counts[key] || (counts[key] = []);
      c[p.ilvl] = kind.fixed || c[p.ilvl] === undefined ? kind.start : c[p.ilvl] + 1;
      c.length = p.ilvl + 1;
      while (stackL.length && stackL[stackL.length - 1].ilvl > p.ilvl) closeTo(stackL.length - 1);
      let top = stackL[stackL.length - 1];
      if (top && top.ilvl === p.ilvl && (top.tag !== kind.tag || top.key !== key)) { closeTo(stackL.length - 1); top = stackL[stackL.length - 1]; }
      if (top && top.ilvl === p.ilvl) html += '</li>';
      else {
        html += '<' + kind.tag + (kind.tag === 'ol' && c[p.ilvl] !== 1 ? ' start="' + c[p.ilvl] + '"' : '') +
          (kind.type ? ' style="list-style-type:' + kind.type + '"' : '') + '>';
        stackL.push({ tag: kind.tag, ilvl: p.ilvl, key: key });
      }
      html += '<li' + al + '>' + body;
    });
    closeTo(0);
    return { title: title, html: html, footnotes: [], comments: [] };
  }

  /* ----- Sanitizer (all imports) — runs in an INERT document: no
     browsing context → no image loads, no handlers fire while parsing. ----- */
  function ioInertDiv() {
    return document.implementation.createHTMLDocument('').createElement('div');
  }
  function ioBadUrl(v) {
    const s = String(v || '').replace(/[\u0000-\u0020]/g, '').toLowerCase();
    return /^(?:javascript|vbscript):/.test(s) || /^data:text\/html/.test(s);
  }
  function ioSanitizeHtml(html) {
    const box = ioInertDiv();
    box.innerHTML = String(html || '');
    box.querySelectorAll('script,style,iframe,frame,frameset,object,embed,noscript,' +
      'link,meta,base,form,input,button,textarea,select,svg,math,template')
      .forEach(n => n.remove());
    box.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(a => {
        const n = a.name.toLowerCase();
        if (n.startsWith('on') || n === 'srcdoc' || n === 'formaction' ||
            (/(^|:)(href|src|action|data)$/.test(n) && ioBadUrl(a.value))) {
          el.removeAttribute(a.name);
        }
      });
    });
    // tracked changes (wave 22): only class / data-tc / data-au / data-ts,
    // with checked values
    if (root.WriterTrack) box.querySelectorAll('ins.tc, del.tc').forEach(el => {
      const c = root.WriterTrack.cleanAttrs(el.getAttribute('data-au'), el.getAttribute('data-ts'), el.getAttribute('data-tc'));
      Array.from(el.attributes).forEach(a => el.removeAttribute(a.name));
      el.className = 'tc';
      el.setAttribute('data-tc', c.id || ('tc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)));
      el.setAttribute('data-au', c.au);
      el.setAttribute('data-ts', String(c.ts));
    });
    return box.innerHTML;
  }

  /* ----- Mini Markdown parser ----- */
  function ioMdInline(s) {
    s = esc(s);
    // esc() leaves quotes alone → attribute values MUST be quote-escaped
    // (`[x](a"onmouseover=…)` used to break out of href="…").
    const q = v => String(v).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const u = v => ioBadUrl(v) ? '#' : q(v);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (m, alt, src) => '<img src="' + u(src) + '" alt="' + q(alt) + '">');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      (m, label, href) => '<a href="' + u(href) +
        '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // _italic_, outside the tags made above (a link's address may hold "_")
    s = s.split(/(<[^>]*>)/).map((x, k) => k % 2 ? x : x.replace(/(^|[^\w])_([^_]+)_(?![\w])/g, '$1<em>$2</em>')).join('');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/\[\^(\d+)\]/g, '<sup class="fn-ref" data-mdfn="$1">$1</sup>');
    return s;
  }

  // A block may end with an alignment mark, as in Pandoc: "{.center}",
  // "{.right}", "{.justify}" or "{.left}" → [text, ' style="…"' or '']
  const IO_MD_ALIGN_RE = /\s*\{\s*\.(center|centre|right|justify|left)\s*\}\s*$/i;
  function ioMdAlign(s) {
    const m = IO_MD_ALIGN_RE.exec(s);
    if (!m) return [s, ''];
    const a = m[1].toLowerCase();
    return [s.slice(0, m.index), a === 'left' ? '' : ' style="text-align:' + (a === 'centre' ? 'center' : a) + '"'];
  }
  const IO_MD_ITEM_RE = /^(\s*)([-*+]|(\d{1,9})[.)])\s+(.*)$/;

  function ioParseMd(text, footnoteDefs) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    footnoteDefs = footnoteDefs || {};

    function block(from, to) {
      let html = '', para = [], i = from;
      const flush = () => {
        if (para.length) {
          const a = ioMdAlign(para.join(' '));
          html += '<p' + a[1] + '>' + ioMdInline(a[0]) + '</p>';
          para = [];
        }
      };
      while (i <= to) {
        const L = lines[i];
        const h = L.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
          flush();
          const a = ioMdAlign(h[2].replace(/\s+#+\s*$/, ''));
          html += '<h' + h[1].length + a[1] + '>' + ioMdInline(a[0]) + '</h' + h[1].length + '>';
          i++; continue;
        }
        if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(L)) { flush(); html += '<hr>'; i++; continue; }
        if (/^\s*```/.test(L)) {
          flush(); i++;
          const buf = [];
          while (i <= to && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
          i++;   // closing fence
          html += '<pre>' + esc(buf.join('\n')) + '</pre>';
          continue;
        }
        if (/^\s*>\s?/.test(L)) {
          flush();
          const buf = [];
          while (i <= to && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
          html += '<blockquote>' + blockFromLines(buf) + '</blockquote>';
          continue;
        }
        if (IO_MD_ITEM_RE.test(L)) {
          // items, nested by indent; an indented line goes on the item
          // above; numbered lists keep their first number
          flush();
          const items = [];
          while (i <= to) {
            const m = IO_MD_ITEM_RE.exec(lines[i]);
            if (m) {
              items.push({ ind: m[1].replace(/\t/g, '    ').length, tag: m[3] ? 'ol' : 'ul', n: m[3] ? parseInt(m[3], 10) : 1, t: m[4] });
              i++;
            } else if (items.length && /^\s{2,}\S/.test(lines[i])) {
              items[items.length - 1].t += ' ' + lines[i].trim();
              i++;
            } else break;
          }
          const stack = [];
          items.forEach(it => {
            while (stack.length && stack[stack.length - 1].ind > it.ind + 1) html += '</li></' + stack.pop().tag + '>';
            let top = stack[stack.length - 1];
            if (top && Math.abs(top.ind - it.ind) <= 1 && top.tag !== it.tag) { html += '</li></' + stack.pop().tag + '>'; top = stack[stack.length - 1]; }
            if (top && Math.abs(top.ind - it.ind) <= 1) html += '</li>';
            else {
              html += '<' + it.tag + (it.tag === 'ol' && it.n !== 1 ? ' start="' + it.n + '"' : '') + '>';
              stack.push({ ind: it.ind, tag: it.tag });
            }
            const a = ioMdAlign(it.t);
            html += '<li' + a[1] + '>' + ioMdInline(a[0]);
          });
          while (stack.length) html += '</li></' + stack.pop().tag + '>';
          continue;
        }
        if (/^\s*\|.*\|\s*$/.test(L)) {
          // table: header row + separator + body rows
          flush();
          const rows = [];
          while (i <= to && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
          if (rows.length >= 2 && /^[\s|:-]+$/.test(rows[1])) {
            const cells = r => r.trim().replace(/^\||\|$/g, '').split('|')
              .map(c => c.trim());
            html += '<table><tr>' + cells(rows[0]).map(c => '<th>' + ioMdInline(c) + '</th>').join('') + '</tr>';
            for (let r = 2; r < rows.length; r++)
              html += '<tr>' + cells(rows[r]).map(c => '<td>' + ioMdInline(c) + '</td>').join('') + '</tr>';
            html += '</table>';
            continue;
          }
          // not a real table — fall through as paragraph text
          para.push(rows.join(' '));
          continue;
        }
        if (/^\[\^(\d+)\]:\s?(.*)$/.test(L)) {   // footnote def — strip, stored separately
          i++; continue;
        }
        if (!L.trim()) { flush(); i++; continue; }
        para.push(L.trim());
        i++;
      }
      flush();
      return html;
    }

    function blockFromLines(buf) {
      let html = '';
      // simple: paragraphs only inside quotes (nesting rare in practice)
      html = buf.map(l => l.trim()).filter(Boolean)
        .map(l => { const a = ioMdAlign(l); return '<p' + a[1] + '>' + ioMdInline(a[0]) + '</p>'; }).join('');
      return html;
    }

    const html = block(0, lines.length - 1);

    // footnotes: convert data-mdfn refs into real ids + entries
    const wrap = ioInertDiv();                 // inert: nothing loads/fires
    wrap.innerHTML = ioSanitizeHtml(html);
    const footnotes = [];
    wrap.querySelectorAll('sup.fn-ref[data-mdfn]').forEach(sup => {
      const n = sup.getAttribute('data-mdfn');
      const txt = footnoteDefs[n];
      if (txt === undefined) { sup.remove(); return; }
      const nid = 'fn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      sup.removeAttribute('data-mdfn');
      sup.setAttribute('data-fn', nid);
      footnotes.push({ id: nid, text: txt });
    });

    const firstH = wrap.querySelector('h1,h2,h3,h4,h5,h6,p');
    const title = firstH ? firstH.textContent.trim().slice(0, 80) : '';
    return { title: title, html: wrap.innerHTML, footnotes: footnotes, comments: [] };
  }

  /* ----- TXT (writer.js keeps its own copy for openSearchTarget; the
     tests check that both give the same result) ----- */
  function ioParseTxt(text) {
    const clean = String(text).replace(/\r\n?/g, '\n');
    const paras = clean.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const html = paras.map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
    const first = paras[0] || '';
    const title = first && first.length <= 80 ? first : '';
    return { title: title, html: html, footnotes: [], comments: [] };
  }

  /* ----- HTML (sanitized) ----- */
  function ioParseHtml(text) {
    const dom = new DOMParser().parseFromString(String(text), 'text/html');
    dom.querySelectorAll('script,style,iframe,object,embed,noscript,link,meta,form,input,button')
      .forEach(n => n.remove());
    dom.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(a => {
        const n = a.name.toLowerCase();
        if (n.startsWith('on') || n === 'srcdoc' ||
            ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(a.value))) {
          el.removeAttribute(a.name);
        }
      });
    });
    const ttl = dom.querySelector('title');
    const h1 = dom.querySelector('h1');
    const title = (ttl && ttl.textContent.trim()) ||
                  (h1 && h1.textContent.trim().slice(0, 80)) || '';
    return { title: title, html: dom.body ? dom.body.innerHTML : '', footnotes: [], comments: [] };
  }

  /* ----- OROSDOC (JSON, before OBF 1.0) ----- */
  function ioParseOrosDoc(text) {
    return ioParseOrosObj(JSON.parse(text));
  }
  function ioParseOrosObj(obj) {
    if (!obj || obj.orosWriter !== true || !obj.doc) throw new Error('not orosdoc');
    const d = obj.doc;
    return {
      title: typeof d.title === 'string' ? d.title : '',
      author: typeof d.author === 'string' ? d.author : '',
      category: typeof d.category === 'string' ? d.category : '',
      tags: Array.isArray(d.tags) ? d.tags : [],
      html: typeof d.html === 'string' ? d.html : '',
      footnotes: Array.isArray(d.footnotes) ? d.footnotes : [],
      comments: Array.isArray(d.comments) ? d.comments : []
    };
  }

  // text of a .orosdoc (JSON) / .json / .txt / .html / .rtf / .md file → payload
  function ioParseTextOf(text, ext) {
    if (ext === 'orosdoc') return Object.assign({ kind: 'doc' }, ioParseOrosDoc(text));

    if (ext === 'json') {
      const obj = JSON.parse(text);
      if (obj && Array.isArray(obj.docs)) {
        // full Writer database export → restore offer
        return { kind: 'db', data: obj };
      }
      if (obj && obj.orosWriter === true) {
        return Object.assign({ kind: 'doc' }, ioParseOrosDoc(text));
      }
      throw new Error('unknown json');
    }

    if (ext === 'txt')  return Object.assign({ kind: 'doc' }, ioParseTxt(text));
    if (ext === 'html' || ext === 'htm') return Object.assign({ kind: 'doc' }, ioParseHtml(text));
    if (ext === 'rtf') return Object.assign({ kind: 'doc' }, ioParseRtf(text));
    if (ext === 'md' || ext === 'markdown') {
      // peel footnote definitions first ([^n]: text)
      const defs = {};
      const peeled = String(text).replace(/\r\n?/g, '\n').replace(/^\[\^(\d+)\]:\s?(.*)$/gm,
        (m, n, d) => { defs[n] = d; return ''; });
      return Object.assign({ kind: 'doc' }, ioParseMd(peeled, defs));
    }
    throw new Error('unsupported: ' + ext);
  }

  /* ----- Annotation remap (fresh ids — append/replace never clash) ----- */
  function ioPrepareImport(parsed) {
    const wrap = ioInertDiv();                 // inert: nothing loads/fires
    wrap.innerHTML = ioSanitizeHtml(parsed.html || '');
    const footnotes = [], comments = [];
    wrap.querySelectorAll('sup.fn-ref').forEach(sup => {
      const old = sup.getAttribute('data-fn');
      const e = (parsed.footnotes || []).find(f => f.id === old);
      const nid = 'fn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      sup.setAttribute('data-fn', nid);
      sup.textContent = '*';
      if (e) footnotes.push({ id: nid, text: e.text || '' });
      else sup.remove();
    });
    wrap.querySelectorAll('mark.cmt-mark').forEach(mark => {
      const old = mark.getAttribute('data-cmt');
      const e = (parsed.comments || []).find(f => f.id === old);
      const nid = 'cm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      mark.setAttribute('data-cmt', nid);
      if (e) comments.push({ id: nid, quote: e.quote || mark.textContent, text: e.text || '', ts: e.ts || Date.now() });
      else ioUnwrap(mark);
    });
    return { html: wrap.innerHTML, footnotes: footnotes, comments: comments };
  }

  /* ----- DOCX / ODT: ZIP reader (EOCD scan → central dir → inflate) ----- */
  function ioReadZip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('zip: no eocd'));
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const nameLen  = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commLen  = dv.getUint16(p + 32, true);
      entries.push({
        method: dv.getUint16(p + 10, true),
        csize:  dv.getUint32(p + 20, true),
        lho:     dv.getUint32(p + 42, true),
        name:    new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen))
      });
      p += 46 + nameLen + extraLen + commLen;
    }
    return Promise.all(entries.map(e => {
      const lName  = dv.getUint16(e.lho + 26, true);
      const lExtra = dv.getUint16(e.lho + 28, true);
      const start  = e.lho + 30 + lName + lExtra;
      const data   = u8.subarray(start, start + e.csize);
      if (e.method === 0) return { name: e.name, data: data };
      if (e.method === 8) {
        return new Response(
          new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
        ).arrayBuffer().then(ab => ({ name: e.name, data: new Uint8Array(ab) }));
      }
      return { name: e.name, data: new Uint8Array(0) };
    }));
  }

  // buf: the file's ArrayBuffer
  function ioParseZipBuf(buf, ext) {
    const isDocx = ext === 'docx';
    const text = e => e ? new TextDecoder().decode(e.data) : '';
    return ioReadZip(buf)
      .then(entries => {
        const f = entries.find(e => e.name === (isDocx ? 'word/document.xml' : 'content.xml'));
        if (!f) throw new Error(isDocx ? 'not a docx package' : 'not an odt package');
        const dom = new DOMParser().parseFromString(text(f), 'application/xml');
        if (dom.getElementsByTagName('parsererror').length) throw new Error('xml parse error');
        if (!isDocx) {
          // named styles (styles.xml) under the document's own ones
          const st = entries.find(e => e.name === 'styles.xml');
          let sdom = null;
          if (st) {
            sdom = new DOMParser().parseFromString(text(st), 'application/xml');
            if (sdom.getElementsByTagName('parsererror').length) sdom = null;
          }
          return ioParseOdtXml(dom, sdom);
        }
        const num = entries.find(e => e.name === 'word/numbering.xml');
        const sty = entries.find(e => e.name === 'word/styles.xml');
        const styles = ioDxStyles(text(sty));
        styles.img = ioDxPictures(text(entries.find(e => e.name === 'word/_rels/document.xml.rels')), entries);
        styles.notes = ioDxNotes(text(entries.find(e => e.name === 'word/footnotes.xml')),
                                 text(entries.find(e => e.name === 'word/endnotes.xml')));
        return ioParseDocxXml(dom, ioDxNumbering(text(num)), styles);
      })
      .then(res => Object.assign({ kind: 'doc' }, res));
  }

  /* ----- DOCX: pictures (word/_rels/document.xml.rels → word/media/…) ----- */
  // rId → data: URL of every picture the document points to inside the
  // package (PNG, JPEG, GIF, WebP; ≤ 15 MB each, ≤ 60 MB in all).
  // External targets (TargetMode="External") are never fetched.
  const IO_DX_IMG_TYPES = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', jpe: 'jpeg', gif: 'gif', webp: 'webp' };
  function ioDxPictures(relsText, entries) {
    const out = {};
    if (!relsText) return out;
    const dom = new DOMParser().parseFromString(relsText, 'application/xml');
    if (dom.getElementsByTagName('parsererror').length) return out;
    let total = 0;
    Array.from(dom.getElementsByTagName('Relationship')).forEach(r => {
      if (!/\/image$/.test(r.getAttribute('Type') || '') || /^external$/i.test(r.getAttribute('TargetMode') || '')) return;
      let target = String(r.getAttribute('Target') || '');
      target = target.charAt(0) === '/' ? target.slice(1) : 'word/' + target;
      const parts = [];
      target.split('/').forEach(x => { if (x === '..') parts.pop(); else if (x && x !== '.') parts.push(x); });
      const name = parts.join('/');
      const type = IO_DX_IMG_TYPES[(name.split('.').pop() || '').toLowerCase()];
      const e = type && entries.find(en => en.name === name);
      if (!e || !e.data.length || e.data.length > 15 * 1024 * 1024 || total + e.data.length > 60 * 1024 * 1024) return;
      total += e.data.length;
      out[r.getAttribute('Id')] = 'data:image/' + type + ';base64,' + ioBytesB64(e.data);
    });
    return out;
  }
  // <w:drawing> (a:blip r:embed) or old <w:pict> (v:imagedata r:id) →
  // <img> at the size the document shows it (EMU / 9525 = px)
  const IO_NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  function ioDxPicture(el, styles) {
    const img = styles && styles.img;
    if (!img) return '';
    const blip = el.getElementsByTagNameNS('*', 'blip')[0] || el.getElementsByTagNameNS('*', 'imagedata')[0];
    if (!blip) return '';
    const rid = blip.getAttributeNS(IO_NS_R, 'embed') || blip.getAttributeNS(IO_NS_R, 'id') ||
                blip.getAttribute('r:embed') || blip.getAttribute('r:id') || '';
    const src = Object.prototype.hasOwnProperty.call(img, rid) ? img[rid] : '';
    if (!src) return '';
    const ext = el.getElementsByTagNameNS('*', 'extent')[0];
    const pr = el.getElementsByTagNameNS('*', 'docPr')[0];
    const w = ext ? Math.round((parseInt(ext.getAttribute('cx'), 10) || 0) / 9525) : 0;
    const alt = pr ? (pr.getAttribute('descr') || '') : '';
    return '<img src="' + src + '" alt="' + escAttr(alt) + '" style="' + (w > 0 ? 'width:' + Math.min(w, 4000) + 'px;' : '') + 'max-width:100%">';
  }

  /* ----- DOCX: word/document.xml → HTML ----- */
  const IO_NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  function ioDxAttr(el, name) {
    return el.getAttributeNS(IO_NS_W, name) || el.getAttribute('w:' + name) || '';
  }
  function ioDxKid(el, name) {
    return el ? Array.from(el.children).find(c => c.localName === name) || null : null;
  }

  const IO_DX_WRAP = /^(hyperlink|ins|moveTo|smartTag|sdt|sdtContent|fldSimple|customXml|bdo|dir)$/;
  // w:jc → text-align ('' = left, the default)
  const IO_DX_JC = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify',
                     lowKashida: 'justify', mediumKashida: 'justify', highKashida: 'justify', thaiDistribute: 'justify' };

  // run properties that matter here: { b, i, u, s, sup } (true / false,
  // or missing = not set at this level)
  function ioDxRpr(rPr) {
    const out = {};
    if (!rPr) return out;
    const on = pr => !/^(0|false|none|off)$/i.test(ioDxAttr(pr, 'val'));
    Array.from(rPr.children).forEach(pr => {
      const pl = pr.localName;
      if (pl === 'b') out.b = on(pr);
      if (pl === 'i') out.i = on(pr);
      if (pl === 'u') out.u = on(pr);
      if (pl === 'strike' || pl === 'dstrike') out.s = on(pr);
      if (pl === 'vertAlign') out.sup = ioDxAttr(pr, 'val') === 'superscript';
    });
    return out;
  }

  // word/styles.xml → { p: { id → {…} }, c: { id → {…} }, def: the
  // default paragraph style's id }; each style
  // { name, based, outline (0-based, or -1), jc, rpr, num: { numId, ilvl } | null }
  function ioDxStyles(xmlText) {
    const res = { p: {}, c: {}, def: '' };
    if (!xmlText) return res;
    const dom = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (dom.getElementsByTagName('parsererror').length) return res;
    Array.from(dom.getElementsByTagNameNS(IO_NS_W, 'style')).forEach(s => {
      const id = ioDxAttr(s, 'styleId'), type = ioDxAttr(s, 'type');
      if (!id || (type !== 'paragraph' && type !== 'character')) return;
      if (type === 'paragraph' && /^(1|true|on)$/i.test(ioDxAttr(s, 'default'))) res.def = id;
      const nm = ioDxKid(s, 'name'), bo = ioDxKid(s, 'basedOn'), pPr = ioDxKid(s, 'pPr');
      const ol = ioDxKid(pPr, 'outlineLvl'), jc = ioDxKid(pPr, 'jc'), numPr = ioDxKid(pPr, 'numPr');
      let num = null;
      if (numPr) {
        const ni = ioDxKid(numPr, 'numId'), il = ioDxKid(numPr, 'ilvl');
        num = { numId: ni ? ioDxAttr(ni, 'val') : '', ilvl: il ? parseInt(ioDxAttr(il, 'val'), 10) || 0 : 0 };
      }
      (type === 'paragraph' ? res.p : res.c)[id] = {
        name: nm ? ioDxAttr(nm, 'val') : '', based: bo ? ioDxAttr(bo, 'val') : '',
        outline: ol ? parseInt(ioDxAttr(ol, 'val'), 10) : -1,
        jc: jc ? ioDxAttr(jc, 'val') : '', rpr: ioDxRpr(ioDxKid(s, 'rPr')), num: num
      };
    });
    return res;
  }
  // one style with what it inherits (basedOn chain, ≤ 10 steps)
  function ioDxStyle(map, id) {
    const out = { name: '', outline: -1, jc: '', rpr: {}, num: null };
    const chain = [];
    for (let k = 0; id && map[id] && k < 10 && chain.indexOf(id) === -1; k++) { chain.push(id); id = map[id].based; }
    chain.reverse().forEach(cid => {
      const s = map[cid];
      out.name = s.name || out.name;
      if (s.outline >= 0) out.outline = s.outline;
      if (s.jc) out.jc = s.jc;
      if (s.num) out.num = s.num;
      Object.assign(out.rpr, s.rpr);
    });
    out.id = chain.length ? chain[chain.length - 1] : '';
    return out;
  }

  // word/footnotes.xml + word/endnotes.xml → { map: { "f1" | "e1" →
  // plain text (paragraphs joined by a line break) }, out: [] (the
  // payload's footnotes, in the order their marks appear), n }.
  // Word's separator notes (w:type) are left out.
  function ioDxNotes(fnXml, enXml) {
    const res = { map: {}, out: [], n: 0 };
    [[fnXml, 'footnote', 'f'], [enXml, 'endnote', 'e']].forEach(x => {
      if (!x[0]) return;
      const dom = new DOMParser().parseFromString(x[0], 'application/xml');
      if (dom.getElementsByTagName('parsererror').length) return;
      Array.from(dom.getElementsByTagNameNS(IO_NS_W, x[1])).forEach(fn => {
        if (ioDxAttr(fn, 'type')) return;
        const paras = Array.from(fn.getElementsByTagNameNS(IO_NS_W, 'p')).map(p => {
          let t = '';
          Array.from(p.getElementsByTagNameNS(IO_NS_W, '*')).forEach(c => {
            if (c.localName === 't') t += c.textContent;
            else if (c.localName === 'tab') t += ' ';
          });
          return t.replace(/\s+/g, ' ').trim();
        }).filter(Boolean);
        if (paras.length) res.map[x[2] + ioDxAttr(fn, 'id')] = paras.join('\n').slice(0, 20000);
      });
    });
    return res;
  }

  function ioDxRuns(node, base, styles) {
    let out = '';
    base = base || {};
    Array.from(node.childNodes).forEach(n => {
      if (n.nodeType !== 1) return;
      const ln = n.localName;
      if (ln === 'r') {
        let txt = '', mark = '';
        const f = Object.assign({}, base);
        Array.from(n.children).forEach(c => {
          const cl = c.localName;
          if (cl === 'rPr') {
            const rs = ioDxKid(c, 'rStyle');
            if (rs && styles) Object.assign(f, ioDxStyle(styles.c, ioDxAttr(rs, 'val')).rpr);
            Object.assign(f, ioDxRpr(c));
          } else if (cl === 't' || cl === 'delText') txt += c.textContent;
          else if (cl === 'tab') txt += '\t';
          else if (cl === 'br' || cl === 'cr') txt += '\n';
          else if (cl === 'noBreakHyphen') txt += '‑';
          else if (cl === 'drawing' || cl === 'pict' || cl === 'AlternateContent') mark += ioDxPicture(c, styles);
          else if ((cl === 'footnoteReference' || cl === 'endnoteReference') && styles && styles.notes) {
            // a note's mark → Writer's <sup class="fn-ref"> + a footnote
            const nt = styles.notes, body = nt.map[cl.charAt(0) + ioDxAttr(c, 'id')];
            if (body === undefined) return;
            const id = 'fn' + Date.now().toString(36) + (++nt.n);
            nt.out.push({ id: id, text: body });
            mark += '<sup class="fn-ref" data-fn="' + id + '">' + nt.out.length + '</sup>';
          }
        });
        if (!txt) { out += mark; return; }
        let h = esc(txt).replace(/\n/g, '<br>').replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
        if (f.s)   h = '<del>' + h + '</del>';
        if (f.u)   h = '<u>' + h + '</u>';
        if (f.i)   h = '<em>' + h + '</em>';
        if (f.b)   h = '<strong>' + h + '</strong>';
        if (f.sup) h = '<sup>' + h + '</sup>';
        out += h + mark;
      } else if ((ln === 'ins' || ln === 'del') && root.WriterTrack) {
        // tracked changes (wave 22) → <ins class="tc"> / <del class="tc">
        const inner = ioDxRuns(n, base, styles);
        if (!inner) return;
        const c = root.WriterTrack.cleanAttrs(ioDxAttr(n, 'author'), root.WriterTrack.parseDocxDate(ioDxAttr(n, 'date')), '');
        out += '<' + ln + ' class="tc" data-tc="tc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) +
          '" data-au="' + escAttr(c.au) + '" data-ts="' + c.ts + '">' + inner + '</' + ln + '>';
      } else if (IO_DX_WRAP.test(ln)) {
        out += ioDxRuns(n, base, styles);
      } else if (ln === 'br') {
        out += '<br>';
      }
      // moveFrom / pPr / bookmarks … → nothing
    });
    return out;
  }

  // a paragraph's style (styles.xml), alignment and outline level
  function ioDxParaInfo(p, styles) {
    const pPr = ioDxKid(p, 'pPr'), ps = ioDxKid(pPr, 'pStyle');
    const id = ps ? ioDxAttr(ps, 'val') : '';
    const st = styles ? ioDxStyle(styles.p, id || styles.def) : { name: '', outline: -1, jc: '', rpr: {}, num: null };
    const jc = ioDxKid(pPr, 'jc'), ol = ioDxKid(pPr, 'outlineLvl');
    return {
      id: id, st: st,
      align: IO_DX_JC[jc ? ioDxAttr(jc, 'val') : st.jc] || '',
      outline: ol ? parseInt(ioDxAttr(ol, 'val'), 10) : st.outline
    };
  }

  function ioDxPara(p, inList, styles) {
    const info = ioDxParaInfo(p, styles);
    if (inList) return ioDxRuns(p, info.st.rpr, styles);
    const sa = info.align ? ' style="text-align:' + info.align + '"' : '';
    // headings by style name ("heading 1" also in a Greek Word, whose
    // style ids are "1", "2"…), outline level, or Title
    const name = info.st.name || info.id;
    const m = /^heading\s*(\d)/i.exec(name) || /^heading\s*(\d)/i.exec(info.id);
    let lvl = m ? +m[1] : 0;
    if (!lvl && info.outline >= 0 && info.outline <= 3) lvl = info.outline + 1;
    if (!lvl && (/^title$/i.test(name) || /^title$/i.test(info.id))) lvl = 1;
    // a heading is bold already: the style's own bold is not repeated
    // (nor a caption's own italic: Writer draws a caption so)
    const cap = /^caption$/i.test(name) || /^caption$/i.test(info.id);
    const inner = ioDxRuns(p, lvl ? Object.assign({}, info.st.rpr, { b: false }) : cap ? Object.assign({}, info.st.rpr, { i: false }) : info.st.rpr, styles);
    if (lvl >= 1 && lvl <= 6) return '<h' + lvl + sa + '>' + inner + '</h' + lvl + '>';
    if (cap) return '<p data-cap="1"' + sa + '>' + inner + '</p>';
    if (/quote/i.test(name) || /quote/i.test(info.id)) return '<blockquote' + sa + '>' + inner + '</blockquote>';
    return '<p' + sa + '>' + inner + '</p>';
  }

  // word/numbering.xml → numId → { ilvl → { fmt, start } }
  function ioDxNumbering(xmlText) {
    const map = {};
    if (!xmlText) return map;
    const dom = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (dom.getElementsByTagName('parsererror').length) return map;
    const abs = {};
    const lvlOf = l => {
      let f = ioDxKid(l, 'numFmt');
      // Word 2010+ custom formats sit in <mc:AlternateContent><mc:Choice>
      const alt = !f && ioDxKid(l, 'AlternateContent');
      if (alt) f = ioDxKid(ioDxKid(alt, 'Choice'), 'numFmt') || ioDxKid(ioDxKid(alt, 'Fallback'), 'numFmt');
      let fmt = f ? ioDxAttr(f, 'val') : 'bullet';
      if (fmt === 'custom') fmt = /^\u03b1/.test(ioDxAttr(f, 'format')) ? 'lowerGreek' : 'decimal';
      const s = ioDxKid(l, 'start');
      return { fmt: fmt, start: s ? parseInt(ioDxAttr(s, 'val'), 10) || 0 : 1 };
    };
    Array.from(dom.getElementsByTagNameNS(IO_NS_W, 'abstractNum')).forEach(a => {
      const lv = {};
      Array.from(a.getElementsByTagNameNS(IO_NS_W, 'lvl')).forEach(l => { lv[ioDxAttr(l, 'ilvl')] = lvlOf(l); });
      abs[ioDxAttr(a, 'abstractNumId')] = lv;
    });
    Array.from(dom.getElementsByTagNameNS(IO_NS_W, 'num')).forEach(n => {
      const an = ioDxKid(n, 'abstractNumId');
      const lv = Object.assign({}, (an && abs[ioDxAttr(an, 'val')]) || {});
      // <w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/> (or a whole <w:lvl>)
      Array.from(n.children).forEach(o => {
        if (o.localName !== 'lvlOverride') return;
        const il = ioDxAttr(o, 'ilvl'), so = ioDxKid(o, 'startOverride'), l = ioDxKid(o, 'lvl');
        if (l) lv[il] = lvlOf(l);
        if (so) lv[il] = Object.assign({}, lv[il] || { fmt: 'decimal' }, { start: parseInt(ioDxAttr(so, 'val'), 10) || 0 });
      });
      map[ioDxAttr(n, 'numId')] = lv;
    });
    return map;
  }

  function ioDxNumInfo(p, styles) {
    const pPr = ioDxKid(p, 'pPr');
    if (!pPr) return null;
    const numPr = ioDxKid(pPr, 'numPr');
    let ilvl = 0, numId = '';
    if (numPr) {
      Array.from(numPr.children).forEach(c => {
        if (c.localName === 'ilvl') ilvl = parseInt(ioDxAttr(c, 'val'), 10) || 0;
        if (c.localName === 'numId') numId = ioDxAttr(c, 'val');
      });
      if (!numId || numId === '0') return null;
      return { ilvl: Math.min(8, Math.max(0, ilvl)), numId: numId };
    }
    // numbering that comes with the paragraph's style (styles.xml)
    const ps = ioDxKid(pPr, 'pStyle'), id = ps ? ioDxAttr(ps, 'val') : '';
    if (styles && id) {
      const st = ioDxStyle(styles.p, id);
      if (st.num && st.num.numId && st.num.numId !== '0') return { ilvl: Math.min(8, Math.max(0, st.num.ilvl)), numId: st.num.numId };
    }
    // style-defined lists ("List Bullet 2", "List Number") with no
    // styles.xml to say how
    const m = /^List\s?(Bullet|Number)\s?(\d)?$/i.exec(id);
    if (!m) return null;
    return { ilvl: m[2] ? Math.max(0, +m[2] - 1) : 0, numId: '__style',
             fmt: /bullet/i.test(m[1]) ? 'bullet' : 'decimal' };
  }

  // Word number format → [tag, list-style-type]
  function ioDxListKind(fmt) {
    if (fmt === 'bullet' || fmt === 'none') return ['UL', ''];
    return ['OL', { lowerLetter: 'lower-alpha', upperLetter: 'upper-alpha', lowerRoman: 'lower-roman',
      upperRoman: 'upper-roman', lowerGreek: 'lower-greek' }[fmt] || ''];
  }

  function ioParseDocxXml(dom, numbering, styles) {
    numbering = numbering || {};
    const body = dom.getElementsByTagNameNS(IO_NS_W, 'body')[0];
    if (!body) throw new Error('docx: no body');
    const box = ioInertDiv();
    const d = box.ownerDocument;
    let stack = [];   // open lists: [{ list, ilvl, lastLi }]
    const counts = {};   // numId → [count per level]: numbering goes on after a break

    function emitTable(tbl) {
      let html = '<table style="border-collapse:collapse;width:100%;">';
      Array.from(tbl.children).forEach(tr => {
        if (tr.localName !== 'tr') return;
        html += '<tr>';
        Array.from(tr.children).forEach(tc => {
          if (tc.localName !== 'tc') return;
          let cells = '';
          Array.from(tc.children).forEach(tcp => {
            if (tcp.localName === 'p') cells += ioDxPara(tcp, false, styles);
          });
          html += '<td style="border:1px solid var(--border);padding:6px 10px;">' + cells + '</td>';
        });
        html += '</tr>';
      });
      box.insertAdjacentHTML('beforeend', html + '</table>');
    }

    function emitPara(p) {
      const info = ioDxNumInfo(p, styles);
      if (!info) { stack = []; box.insertAdjacentHTML('beforeend', ioDxPara(p, false, styles)); return; }
      const lv = numbering[info.numId] && numbering[info.numId][String(info.ilvl)];
      const fmt = info.fmt || (lv && lv.fmt) || 'bullet';
      const kind = ioDxListKind(fmt), tag = kind[0];
      const c = counts[info.numId] || (counts[info.numId] = []);
      const start = lv && typeof lv.start === 'number' ? lv.start : 1;
      c[info.ilvl] = (c[info.ilvl] === undefined ? start : c[info.ilvl] + 1);
      c.length = info.ilvl + 1;   // a deeper level starts again under a new item
      while (stack.length && stack[stack.length - 1].ilvl > info.ilvl) stack.pop();
      let top = stack[stack.length - 1];
      if (top && top.ilvl === info.ilvl && (top.list.nodeName !== tag || top.numId !== info.numId)) { stack.pop(); top = stack[stack.length - 1]; }
      if (!top || top.ilvl < info.ilvl) {
        const list = d.createElement(tag);
        if (tag === 'OL' && c[info.ilvl] !== 1) list.setAttribute('start', String(c[info.ilvl]));
        if (kind[1]) list.setAttribute('style', 'list-style-type:' + kind[1]);
        if (top && top.lastLi) top.lastLi.appendChild(list); else box.appendChild(list);
        top = { list: list, ilvl: info.ilvl, lastLi: null, numId: info.numId };
        stack.push(top);
      }
      const li = d.createElement('li');
      const al = ioDxParaInfo(p, styles).align;
      if (al) li.setAttribute('style', 'text-align:' + al);
      li.innerHTML = ioDxPara(p, true, styles);
      top.list.appendChild(li);
      top.lastLi = li;
    }

    (function walk(container) {
      Array.from(container.children).forEach(ch => {
        const ln = ch.localName;
        if (ln === 'p') emitPara(ch);
        else if (ln === 'tbl') { stack = []; emitTable(ch); }
        else if (ln === 'sdt' || ln === 'sdtContent' || ln === 'customXml' || ln === 'ins') walk(ch);
        // sectPr, bookmarks, deletions … skipped
      });
    })(body);

    // a picture alone in its paragraph + a Caption paragraph → Writer's
    // <figure> with its <figcaption>; any other caption stays a paragraph
    Array.from(box.querySelectorAll('p[data-cap]')).forEach(c => {
      c.removeAttribute('data-cap');
      const prev = c.previousElementSibling;
      if (!prev || prev.nodeName !== 'P' || prev.children.length !== 1 || prev.firstElementChild.nodeName !== 'IMG' || prev.textContent.trim()) return;
      const fig = d.createElement('figure');
      fig.setAttribute('style', 'margin:1em 0;text-align:center');
      fig.appendChild(prev.firstElementChild);
      const fc = d.createElement('figcaption');
      fc.setAttribute('style', 'font-size:0.85em;color:var(--text-dim)');
      fc.innerHTML = c.innerHTML;
      fig.appendChild(fc);
      prev.replaceWith(fig);
      c.remove();
    });

    const first = box.querySelector('h1,h2,h3,h4,h5,h6,p,li');
    return { title: first ? first.textContent.trim().slice(0, 80) : '',
             html: box.innerHTML, footnotes: styles && styles.notes ? styles.notes.out : [], comments: [] };
  }

  /* ----- ODT: content.xml (+ styles.xml) → HTML ----- */
  const IO_NS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';

  function ioOdAttr(el, local) {
    if (!el || !el.attributes) return '';
    for (const a of Array.from(el.attributes)) if (a.localName === local) return a.value;
    return '';
  }
  const IO_OD_ALIGN = { center: 'center', end: 'right', right: 'right', justify: 'justify' };
  const IO_OD_FMT = { a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' };

  // styles.xml then content.xml (its automatic styles win) →
  // { s: { name → { parent, align, f: {b,i,u,s,sup}, list } },
  //   l: { list style name → { level → { num, type, start } } } }
  function ioOdStyles(dom, sdom) {
    const res = { s: {}, l: {} };
    [sdom, dom].forEach(d => {
      if (!d) return;
      Array.from(d.getElementsByTagNameNS('*', 'style')).forEach(st => {
        if (st.localName !== 'style') return;
        const name = ioOdAttr(st, 'name');
        if (!name) return;
        const tp = Array.from(st.children).find(c => c.localName === 'text-properties');
        const pp = Array.from(st.children).find(c => c.localName === 'paragraph-properties');
        const f = {};
        if (tp) {
          const fw = ioOdAttr(tp, 'font-weight'), fs = ioOdAttr(tp, 'font-style');
          const ul = ioOdAttr(tp, 'text-underline-style'), lt = ioOdAttr(tp, 'text-line-through-style');
          const pos = ioOdAttr(tp, 'text-position');
          if (fw) f.b = /^(bold|[6-9]00)$/.test(fw);
          if (fs) f.i = /^(italic|oblique)$/.test(fs);
          if (ul) f.u = ul !== 'none';
          if (lt) f.s = lt !== 'none';
          if (pos) f.sup = /^super/.test(pos);
        }
        const ta = pp ? ioOdAttr(pp, 'text-align') : '';
        res.s[name] = { parent: ioOdAttr(st, 'parent-style-name'), f: f,
          align: ta ? (IO_OD_ALIGN[ta] || 'left') : '', list: ioOdAttr(st, 'list-style-name') };
      });
      Array.from(d.getElementsByTagNameNS('*', 'list-style')).forEach(ls => {
        const name = ioOdAttr(ls, 'name');
        if (!name) return;
        const lv = {};
        Array.from(ls.children).forEach(c => {
          const n = parseInt(ioOdAttr(c, 'level'), 10) || 1;
          if (c.localName === 'list-level-style-number') {
            lv[n] = { num: true, type: IO_OD_FMT[ioOdAttr(c, 'num-format')] || '',
                      start: parseInt(ioOdAttr(c, 'start-value'), 10) || 1 };
            // num-format="" (no number shown) is a plain list
            if (Array.from(c.attributes).some(a => a.localName === 'num-format' && a.value === '')) lv[n].num = false;
          } else if (c.localName === 'list-level-style-bullet' || c.localName === 'list-level-style-image') {
            lv[n] = { num: false, type: '', start: 1 };
          }
        });
        res.l[name] = lv;
      });
    });
    return res;
  }
  // a style with what it inherits: { f, align, list }
  function ioOdStyle(styles, name) {
    const out = { f: {}, align: '', list: '' }, chain = [];
    for (let k = 0; name && styles.s[name] && k < 10 && chain.indexOf(name) === -1; k++) { chain.push(name); name = styles.s[name].parent; }
    chain.reverse().forEach(n => {
      const s = styles.s[n];
      Object.assign(out.f, s.f);
      if (s.align) out.align = s.align === 'left' ? '' : s.align;
      if (s.list) out.list = s.list;
    });
    return out;
  }

  function ioOdWrap(html, f) {
    if (!f || !html) return html;
    if (f.s)   html = '<del>' + html + '</del>';
    if (f.u)   html = '<u>' + html + '</u>';
    if (f.i)   html = '<em>' + html + '</em>';
    if (f.b)   html = '<strong>' + html + '</strong>';
    if (f.sup) html = '<sup>' + html + '</sup>';
    return html;
  }

  function ioOdInline(el, styles) {
    let out = '';
    Array.from(el.childNodes).forEach(n => {
      if (n.nodeType === 3) { out += esc(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      const ln = n.localName;
      if (ln === 'line-break') out += '<br>';
      else if (ln === 'tab') out += ' ';
      else if (ln === 's') out += ' '.repeat(Math.max(1, parseInt(ioOdAttr(n, 'c'), 10) || 1));
      else if (ln === 'span') out += ioOdWrap(ioOdInline(n, styles), styles ? ioOdStyle(styles, ioOdAttr(n, 'style-name')).f : null);
      else if (ln === 'a') out += ioOdInline(n, styles);
      else if (ln === 'note' || ln === 'annotation' || ln === 'bookmark' ||
               ln === 'bookmark-start' || ln === 'bookmark-end' || ln === 'soft-page-break') { /* skip */ }
      else out += esc(n.textContent);   // unknown inline → safe text only
    });
    return out;
  }

  function ioParseOdtXml(dom, sdom) {
    let body = null;
    Array.from(dom.getElementsByTagNameNS('*', 'text')).forEach(el => {
      if (!body && el.localName === 'text') body = el;   // office:text
    });
    if (!body) throw new Error('odt: no body');
    const styles = ioOdStyles(dom, sdom);
    const pst = el => ioOdStyle(styles, ioOdAttr(el, 'style-name'));
    // a heading is bold already: the style's own bold is not repeated
    const inner = (el, noBold) => {
      const f = Object.assign({}, pst(el).f);
      if (noBold) f.b = false;
      return ioOdWrap(ioOdInline(el, styles), f);
    };
    const sa = el => { const a = pst(el).align; return a ? ' style="text-align:' + a + '"' : ''; };
    const counts = {};   // list style name → items numbered so far (level 1)
    let html = '';
    function odList(list, level, lsName) {
      lsName = ioOdAttr(list, 'style-name') || lsName;
      if (!lsName) {
        // a list without a style takes it from its first paragraph's style
        const fp = list.getElementsByTagNameNS(IO_NS_TEXT, 'p')[0];
        if (fp) lsName = pst(fp).list;
      }
      const lv = (styles.l[lsName] || {})[level] || { num: false, type: '', start: 1 };
      const tag = lv.num ? 'ol' : 'ul';
      const key = lsName + '|' + level;
      const goOn = level === 1 && (ioOdAttr(list, 'continue-numbering') === 'true' || !!ioOdAttr(list, 'continue-list'));
      let n = goOn && counts[key] ? counts[key] : lv.start - 1;
      let h = '';
      Array.from(list.children).forEach(li => {
        if (li.localName !== 'list-item' && li.localName !== 'list-header') return;
        const sv = parseInt(ioOdAttr(li, 'start-value'), 10);
        if (sv > 0) n = sv - 1;
        if (!h) {
          h = '<' + tag + (lv.num && n + 1 !== 1 ? ' start="' + (n + 1) + '"' : '') +
            (lv.type ? ' style="list-style-type:' + lv.type + '"' : '') + '>';
        }
        n++;
        let inn = '', st = '';
        Array.from(li.children).forEach(c => {
          if (c.localName === 'p' || c.localName === 'h') {
            inn += (inn && !/<\/[ou]l>$/.test(inn) ? '<br>' : '') + inner(c, false);
            if (!st) st = sa(c);
          } else if (c.localName === 'list') inn += odList(c, level + 1, lsName);
        });
        h += '<li' + st + '>' + inn + '</li>';
      });
      if (level === 1) counts[key] = n;
      return h ? h + '</' + tag + '>' : '';
    }
    (function walk(container) {
      Array.from(container.children).forEach(ch => {
        const ln = ch.localName;
        if (ln === 'section') { walk(ch); return; }
        if (ln === 'h') {
          const lvl = parseInt(
            ch.getAttributeNS(IO_NS_TEXT, 'outline-level') ||
            ch.getAttribute('text:outline-level') || '1', 10) || 1;
          const l = Math.min(6, Math.max(1, lvl));
          html += '<h' + l + sa(ch) + '>' + inner(ch, true) + '</h' + l + '>';
        } else if (ln === 'p') {
          html += '<p' + sa(ch) + '>' + inner(ch, false) + '</p>';
        } else if (ln === 'list') {
          html += odList(ch, 1, '');
        } else if (ln === 'table') {
          html += '<table style="border-collapse:collapse;width:100%;">';
          Array.from(ch.getElementsByTagNameNS('*', 'table-row')).forEach(tr => {
            html += '<tr>';
            Array.from(tr.children).forEach(tc => {
              if (tc.localName !== 'table-cell') return;
              let cells = '';
              Array.from(tc.getElementsByTagNameNS(IO_NS_TEXT, 'p')).forEach(tp => {
                cells += '<p' + sa(tp) + '>' + inner(tp, false) + '</p>';
              });
              html += '<td style="border:1px solid var(--border);padding:6px 10px;">' + cells + '</td>';
            });
            html += '</tr>';
          });
          html += '</table>';
        }
      });
    })(body);
    const wrap = ioInertDiv();
    wrap.innerHTML = html;
    const first = wrap.querySelector('h1,h2,h3,h4,h5,h6,p');
    return { title: first ? first.textContent.trim().slice(0, 80) : '',
             html: html, footnotes: [], comments: [] };
  }

  var api = {
    MIME: IO_BUNDLE_MIME,
    esc: esc, escAttr: escAttr,
    normalizeBlocks: ioNormalizeBlocks, unwrap: ioUnwrap, cloneOf: ioCloneOf,
    standaloneHtml: ioStandaloneHtml, docContent: ioDocContent, writeBundle: ioWriteBundle,
    b64Bytes: ioB64Bytes, bytesB64: ioBytesB64, liftImages: ioLiftImages, dropImages: ioDropImages,
    parseRtf: ioParseRtf, inertDiv: ioInertDiv, badUrl: ioBadUrl, sanitizeHtml: ioSanitizeHtml,
    mdInline: ioMdInline, parseMd: ioParseMd, parseTxt: ioParseTxt, parseHtml: ioParseHtml,
    parseOrosDoc: ioParseOrosDoc, parseOrosObj: ioParseOrosObj, parseTextOf: ioParseTextOf,
    prepareImport: ioPrepareImport, readZip: ioReadZip, parseZipBuf: ioParseZipBuf,
    parseDocxXml: ioParseDocxXml, docxNumbering: ioDxNumbering, parseOdtXml: ioParseOdtXml
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WriterIO = api;
})(typeof window !== "undefined" ? window : this);
