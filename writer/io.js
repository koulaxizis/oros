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
  function ioParseRtf(raw) {
    const SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|listtable|listoverridetable|themedata|colorschememapping|latentstyles|datastore|generator|header|headerl|headerr|headerf|footer|footerl|footerr|footerf|object|rsidtbl|xmlnstbl|mmathPr|filetbl|revtbl)$/;
    const cpg = (raw.match(/\\ansicpg(\d+)/) || [])[1] || '1252';
    let dec = null;
    try { dec = new TextDecoder('windows-' + cpg); } catch (e) { dec = null; }
    const byteChar = b => {
      if (dec) { try { return dec.decode(new Uint8Array([b])); } catch (e) {} }
      return String.fromCharCode(b);
    };
    let uc = 1;                                 // \ucN: fallback chars after \uN
    let out = '', i = 0, depth = 0, skipDepth = -1;
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '{') {
        depth++;
        if (skipDepth === -1) {
          const head = /^\{\s*(\\\*)?\s*\\([a-zA-Z]+)/.exec(raw.slice(i, i + 48));
          if (head && (head[1] || SKIP.test(head[2]))) skipDepth = depth;
        }
        i++; continue;
      }
      if (ch === '}') {
        if (skipDepth === depth) skipDepth = -1;
        depth--;
        i++; continue;
      }
      if (skipDepth !== -1) { i++; continue; }
      if (ch === '\\') {
        const cw = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(raw.slice(i, i + 40));
        if (cw) {
          const w = cw[1], num = cw[2];
          i += cw[0].length;
          if (w === 'par' || w === 'sect' || w === 'page') out += '\n\n';
          else if (w === 'line') out += '\n';
          else if (w === 'tab') out += '\t';
          else if (w === 'cell') out += '\t';
          else if (w === 'row') out += '\n';
          else if (w === 'emdash') out += '\u2014';
          else if (w === 'endash') out += '\u2013';
          else if (w === 'bullet') out += '\u2022';
          else if (w === 'lquote') out += '\u2018';
          else if (w === 'rquote') out += '\u2019';
          else if (w === 'ldblquote') out += '\u201C';
          else if (w === 'rdblquote') out += '\u201D';
          else if (w === 'uc' && num !== undefined) uc = Math.max(0, parseInt(num, 10) || 0);
          else if (w === 'u' && num !== undefined) {
            let n = parseInt(num, 10);
            if (n < 0) n += 65536;
            out += String.fromCharCode(n);
            // swallow the fallback characters (\'hh or plain) Word writes after \uN
            for (let k = 0; k < uc && i < raw.length; k++) {
              if (/^\\'[0-9a-fA-F]{2}/.test(raw.slice(i, i + 4))) i += 4;
              else if (raw[i] !== '\\' && raw[i] !== '{' && raw[i] !== '}') i++;
            }
          }
          continue;
        }
        const hex = /^\\'([0-9a-fA-F]{2})/.exec(raw.slice(i, i + 4));
        if (hex) {
          out += byteChar(parseInt(hex[1], 16));
          i += 4; continue;
        }
        if (/^\\[{}\\]/.test(raw.slice(i, i + 2))) { out += raw[i + 1]; i += 2; continue; }
        if (raw[i + 1] === '~') { out += '\u00A0'; i += 2; continue; }
        if (raw[i + 1] === '-' || raw[i + 1] === '_') { i += 2; continue; }
        i++; continue;
      }
      if (ch === '\r' || ch === '\n') { i++; continue; }   // raw newlines are not text in RTF
      out += ch; i++;
    }
    return out;
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
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/\[\^(\d+)\]/g, '<sup class="fn-ref" data-mdfn="$1">$1</sup>');
    return s;
  }

  function ioParseMd(text, footnoteDefs) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    footnoteDefs = footnoteDefs || {};

    function block(from, to) {
      let html = '', para = [], i = from;
      const flush = () => {
        if (para.length) {
          html += '<p>' + ioMdInline(para.join(' ')) + '</p>';
          para = [];
        }
      };
      while (i <= to) {
        const L = lines[i];
        const h = L.match(/^(#{1,4})\s+(.*)$/);
        if (h) { flush(); html += '<h' + h[1].length + '>' + ioMdInline(h[2]) + '</h' + h[1].length + '>'; i++; continue; }
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
        if (/^\s*[-*+]\s+/.test(L) || /^\s*\d+\.\s+/.test(L)) {
          flush();
          const ordered = /^\s*\d+\./.test(L);
          html += ordered ? '<ol>' : '<ul>';
          while (i <= to && (/^\s*[-*+]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
            html += '<li>' + ioMdInline(lines[i].replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')) + '</li>';
            i++;
          }
          html += ordered ? '</ol>' : '</ul>';
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
        .map(l => '<p>' + ioMdInline(l) + '</p>').join('');
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

    const firstH = wrap.querySelector('h1,h2,h3,h4,p');
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
    if (ext === 'rtf') {
      const txt = ioParseRtf(text);
      return Object.assign({ kind: 'doc' }, ioParseTxt(txt));
    }
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
    return ioReadZip(buf)
      .then(entries => {
        const f = entries.find(e => e.name === (isDocx ? 'word/document.xml' : 'content.xml'));
        if (!f) throw new Error(isDocx ? 'not a docx package' : 'not an odt package');
        const dom = new DOMParser().parseFromString(
          new TextDecoder().decode(f.data), 'application/xml');
        if (dom.getElementsByTagName('parsererror').length) throw new Error('xml parse error');
        if (!isDocx) return ioParseOdtXml(dom);
        const num = entries.find(e => e.name === 'word/numbering.xml');
        return ioParseDocxXml(dom, ioDxNumbering(num ? new TextDecoder().decode(num.data) : ''));
      })
      .then(res => Object.assign({ kind: 'doc' }, res));
  }

  /* ----- DOCX: word/document.xml → HTML ----- */
  const IO_NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  function ioDxAttr(el, name) {
    return el.getAttributeNS(IO_NS_W, name) || el.getAttribute('w:' + name) || '';
  }

  const IO_DX_WRAP = /^(hyperlink|ins|moveTo|smartTag|sdt|sdtContent|fldSimple|customXml|bdo|dir)$/;

  function ioDxRuns(node) {
    let out = '';
    Array.from(node.childNodes).forEach(n => {
      if (n.nodeType !== 1) return;
      const ln = n.localName;
      if (ln === 'r') {
        let b = false, i = false, u = false, strike = false, sup = false, txt = '';
        const on = pr => !/^(0|false|none|off)$/i.test(ioDxAttr(pr, 'val'));
        Array.from(n.children).forEach(c => {
          const cl = c.localName;
          if (cl === 'rPr') {
            Array.from(c.children).forEach(pr => {
              const pl = pr.localName;
              if (pl === 'b') b = on(pr);
              if (pl === 'i') i = on(pr);
              if (pl === 'u') u = on(pr);
              if (pl === 'strike' || pl === 'dstrike') strike = on(pr);
              if (pl === 'vertAlign' && ioDxAttr(pr, 'val') === 'superscript') sup = true;
            });
          } else if (cl === 't' || cl === 'delText') txt += c.textContent;
          else if (cl === 'tab') txt += '\t';
          else if (cl === 'br' || cl === 'cr') txt += '\n';
          else if (cl === 'noBreakHyphen') txt += '\u2011';
        });
        if (!txt) return;
        let h = esc(txt).replace(/\n/g, '<br>').replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
        if (strike) h = '<del>' + h + '</del>';
        if (u)      h = '<u>' + h + '</u>';
        if (i)      h = '<em>' + h + '</em>';
        if (b)      h = '<strong>' + h + '</strong>';
        if (sup)    h = '<sup>' + h + '</sup>';
        out += h;
      } else if ((ln === 'ins' || ln === 'del') && root.WriterTrack) {
        // tracked changes (wave 22) → <ins class="tc"> / <del class="tc">
        const inner = ioDxRuns(n);
        if (!inner) return;
        const c = root.WriterTrack.cleanAttrs(ioDxAttr(n, 'author'), root.WriterTrack.parseDocxDate(ioDxAttr(n, 'date')), '');
        out += '<' + ln + ' class="tc" data-tc="tc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) +
          '" data-au="' + escAttr(c.au) + '" data-ts="' + c.ts + '">' + inner + '</' + ln + '>';
      } else if (IO_DX_WRAP.test(ln)) {
        out += ioDxRuns(n);
      } else if (ln === 'br') {
        out += '<br>';
      }
      // moveFrom / pPr / bookmarks … → nothing
    });
    return out;
  }

  function ioDxPara(p, inList) {
    let style = '';
    Array.from(p.children).forEach(c => {
      if (c.localName === 'pPr') {
        Array.from(c.children).forEach(pp => {
          if (pp.localName === 'pStyle') style = ioDxAttr(pp, 'val');
        });
      }
    });
    const inner = ioDxRuns(p);
    if (inList) return inner;
    const m = /^heading\s*(\d)/i.exec(style);
    if (m && +m[1] >= 1 && +m[1] <= 4) return '<h' + m[1] + '>' + inner + '</h' + m[1] + '>';
    if (/^title$/i.test(style)) return '<h1>' + inner + '</h1>';
    if (/quote/i.test(style)) return '<blockquote>' + inner + '</blockquote>';
    return '<p>' + inner + '</p>';
  }

  function ioDxNumbering(xmlText) {
    const map = {};
    if (!xmlText) return map;
    const dom = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (dom.getElementsByTagName('parsererror').length) return map;
    const abs = {};
    Array.from(dom.getElementsByTagNameNS(IO_NS_W, 'abstractNum')).forEach(a => {
      const lv = {};
      Array.from(a.getElementsByTagNameNS(IO_NS_W, 'lvl')).forEach(l => {
        const f = l.getElementsByTagNameNS(IO_NS_W, 'numFmt')[0];
        lv[ioDxAttr(l, 'ilvl')] = f ? ioDxAttr(f, 'val') : 'bullet';
      });
      abs[ioDxAttr(a, 'abstractNumId')] = lv;
    });
    Array.from(dom.getElementsByTagNameNS(IO_NS_W, 'num')).forEach(n => {
      const an = n.getElementsByTagNameNS(IO_NS_W, 'abstractNumId')[0];
      map[ioDxAttr(n, 'numId')] = (an && abs[ioDxAttr(an, 'val')]) || {};
    });
    return map;
  }

  function ioDxNumInfo(p) {
    const pPr = Array.from(p.children).find(c => c.localName === 'pPr');
    if (!pPr) return null;
    const numPr = Array.from(pPr.children).find(c => c.localName === 'numPr');
    if (!numPr) {
      // style-defined lists ("List Bullet 2", "List Number") carry their
      // numbering in styles.xml, not in the paragraph
      const ps = Array.from(pPr.children).find(c => c.localName === 'pStyle');
      const m = ps && /^List\s?(Bullet|Number)\s?(\d)?$/i.exec(ioDxAttr(ps, 'val'));
      if (!m) return null;
      return { ilvl: m[2] ? Math.max(0, +m[2] - 1) : 0, numId: '__style',
               fmt: /bullet/i.test(m[1]) ? 'bullet' : 'decimal' };
    }
    let ilvl = 0, numId = '';
    Array.from(numPr.children).forEach(c => {
      if (c.localName === 'ilvl') ilvl = parseInt(ioDxAttr(c, 'val'), 10) || 0;
      if (c.localName === 'numId') numId = ioDxAttr(c, 'val');
    });
    if (!numId || numId === '0') return null;
    return { ilvl: Math.min(8, Math.max(0, ilvl)), numId: numId };
  }

  function ioParseDocxXml(dom, numbering) {
    numbering = numbering || {};
    const body = dom.getElementsByTagNameNS(IO_NS_W, 'body')[0];
    if (!body) throw new Error('docx: no body');
    const box = ioInertDiv();
    const d = box.ownerDocument;
    let stack = [];   // open lists: [{ list, ilvl, lastLi }]

    function emitTable(tbl) {
      let html = '<table style="border-collapse:collapse;width:100%;">';
      Array.from(tbl.children).forEach(tr => {
        if (tr.localName !== 'tr') return;
        html += '<tr>';
        Array.from(tr.children).forEach(tc => {
          if (tc.localName !== 'tc') return;
          let cells = '';
          Array.from(tc.children).forEach(tcp => {
            if (tcp.localName === 'p') cells += ioDxPara(tcp, false);
          });
          html += '<td style="border:1px solid var(--border);padding:6px 10px;">' + cells + '</td>';
        });
        html += '</tr>';
      });
      box.insertAdjacentHTML('beforeend', html + '</table>');
    }

    function emitPara(p) {
      const info = ioDxNumInfo(p);
      if (!info) { stack = []; box.insertAdjacentHTML('beforeend', ioDxPara(p, false)); return; }
      const fmt = info.fmt ||
        (numbering[info.numId] && numbering[info.numId][String(info.ilvl)]) || 'bullet';
      const tag = (fmt === 'bullet' || fmt === 'none') ? 'UL' : 'OL';
      while (stack.length && stack[stack.length - 1].ilvl > info.ilvl) stack.pop();
      let top = stack[stack.length - 1];
      if (top && top.ilvl === info.ilvl && top.list.nodeName !== tag) { stack.pop(); top = stack[stack.length - 1]; }
      if (!top || top.ilvl < info.ilvl) {
        const list = d.createElement(tag);
        if (top && top.lastLi) top.lastLi.appendChild(list); else box.appendChild(list);
        top = { list: list, ilvl: info.ilvl, lastLi: null };
        stack.push(top);
      }
      const li = d.createElement('li');
      li.innerHTML = ioDxPara(p, true);
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

    const first = box.querySelector('h1,h2,h3,h4,p,li');
    return { title: first ? first.textContent.trim().slice(0, 80) : '',
             html: box.innerHTML, footnotes: [], comments: [] };
  }

  /* ----- ODT: content.xml → HTML ----- */
  const IO_NS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';

  function ioOdAttr(el, local) {
    if (!el || !el.attributes) return '';
    for (const a of Array.from(el.attributes)) if (a.localName === local) return a.value;
    return '';
  }

  function ioOdStyles(dom) {
    const map = {};
    Array.from(dom.getElementsByTagNameNS('*', 'style')).forEach(st => {
      if (st.localName !== 'style') return;
      const name = ioOdAttr(st, 'name');
      if (!name) return;
      const tp = Array.from(st.children).find(c => c.localName === 'text-properties');
      if (!tp) return;
      const ul = ioOdAttr(tp, 'text-underline-style');
      const lt = ioOdAttr(tp, 'text-line-through-style');
      map[name] = {
        b: /^(bold|[6-9]00)$/.test(ioOdAttr(tp, 'font-weight')),
        i: /^(italic|oblique)$/.test(ioOdAttr(tp, 'font-style')),
        u: !!ul && ul !== 'none',
        s: !!lt && lt !== 'none',
        sup: /^super/.test(ioOdAttr(tp, 'text-position'))
      };
    });
    return map;
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
    styles = styles || {};
    let out = '';
    Array.from(el.childNodes).forEach(n => {
      if (n.nodeType === 3) { out += esc(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      const ln = n.localName;
      if (ln === 'line-break') out += '<br>';
      else if (ln === 'tab') out += ' ';
      else if (ln === 's') out += ' '.repeat(Math.max(1, parseInt(ioOdAttr(n, 'c'), 10) || 1));
      else if (ln === 'span') out += ioOdWrap(ioOdInline(n, styles), styles[ioOdAttr(n, 'style-name')]);
      else if (ln === 'a') out += ioOdInline(n, styles);
      else if (ln === 'note' || ln === 'annotation' || ln === 'bookmark' ||
               ln === 'bookmark-start' || ln === 'bookmark-end' || ln === 'soft-page-break') { /* skip */ }
      else out += esc(n.textContent);   // unknown inline → safe text only
    });
    return out;
  }

  function ioParseOdtXml(dom) {
    let root = null;
    Array.from(dom.getElementsByTagNameNS('*', 'text')).forEach(el => {
      if (!root && el.localName === 'text') root = el;   // office:text
    });
    if (!root) throw new Error('odt: no body');
    const styles = ioOdStyles(dom);
    const para = el => ioOdWrap(ioOdInline(el, styles), styles[ioOdAttr(el, 'style-name')]);
    let html = '';
    (function walk(container) {
    Array.from(container.children).forEach(ch => {
      const ln = ch.localName;
      if (ln === 'section') { walk(ch); return; }
      if (ln === 'h') {
        const lvl = parseInt(
          ch.getAttributeNS(IO_NS_TEXT, 'outline-level') ||
          ch.getAttribute('text:outline-level') || '1', 10) || 1;
        const l = Math.min(4, Math.max(1, lvl));
        html += '<h' + l + '>' + ioOdInline(ch, styles) + '</h' + l + '>';
      } else if (ln === 'p') {
        html += '<p>' + para(ch) + '</p>';
      } else if (ln === 'list') {
        // direct list-items only; nested text:list recurses (the old
        // getElementsByTagNameNS walk flattened every level into one)
        html += (function odList(list) {
          let h = '<ul>';
          Array.from(list.children).forEach(li => {
            if (li.localName !== 'list-item') return;
            let inner = '';
            Array.from(li.children).forEach(c => {
              if (c.localName === 'p' || c.localName === 'h') inner += para(c);
              else if (c.localName === 'list') inner += odList(c);
            });
            h += '<li>' + inner + '</li>';
          });
          return h + '</ul>';
        })(ch);
      } else if (ln === 'table') {
        html += '<table style="border-collapse:collapse;width:100%;">';
        Array.from(ch.getElementsByTagNameNS('*', 'table-row')).forEach(tr => {
          html += '<tr>';
          Array.from(tr.children).forEach(tc => {
            if (tc.localName !== 'table-cell') return;
            let cells = '';
            Array.from(tc.getElementsByTagNameNS(IO_NS_TEXT, 'p')).forEach(tp => {
              cells += '<p>' + para(tp) + '</p>';
            });
            html += '<td style="border:1px solid var(--border);padding:6px 10px;">' + cells + '</td>';
          });
          html += '</tr>';
        });
        html += '</table>';
      }
    });
    })(root);
    const wrap = ioInertDiv();
    wrap.innerHTML = html;
    const first = wrap.querySelector('h1,h2,h3,h4,p');
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
