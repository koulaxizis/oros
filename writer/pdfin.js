// ============================================================
// orOS Writer — pdfin.js: a PDF as a flowing Writer document
// Writer's Open (and the Converter) read a PDF's text layer with
// PDF.js (vendor/pdfjs, Mozilla, Apache-2.0), loaded only when a PDF
// is opened, with eval, XFA forms and scripts off: nothing in the
// file runs and no link is followed. What is kept:
//   · paragraphs (pieces on one baseline → lines → paragraphs, also
//     across pages; a word broken with "-" at a line end is joined);
//   · headings (text larger than the body text: H1–H3 by size; a
//     short paragraph that is all bold: one level lower);
//   · bold and italic (from the font's name and flags);
//   · alignment (left, centre, right, justified, from where the
//     lines start and end against the page's text column);
//   · lists with bullets or numbers (1. 1) a) α) i. …), nested by
//     indent, numbered lists with their start number;
//   · page headers, footers and page numbers that repeat are left out.
// A PDF without a text layer (a scan) is refused with code "notext".
// Pure part (fromPages) is testable under Node; open() needs a
// browser. window.WriterPdfIn (browser) or module.exports (Node).
// i18n-inline-ok: Greek letters and page words read from PDF text (a parser).
// ============================================================
(function (root) {
  "use strict";

  const MAX_PAGES = 500;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ----- 1. Pieces → lines (one page) -----
     piece: { s, x, y (baseline start, page pt, y down), w, size, b, i, rot }
     line:  { x0, x1, y, size, runs: [{ t, b, i }] } */
  function toLines(pieces) {
    const out = [];
    let cur = null;
    pieces.forEach(p => {
      const s = String(p.s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u00ad\ufeff]/g, '').replace(/\s+/g, ' ');
      if (!s || !(p.size > 0) || Math.abs(p.rot || 0) > 1) return;
      const x0 = p.x, x1 = p.x + Math.max(0, p.w || 0);
      const fits = cur && Math.abs(cur.y - p.y) < Math.max(cur.size, p.size) * 0.35 &&
        x0 > cur.x1 - cur.size * 0.6 && x0 < cur.x1 + cur.size * 40;
      if (!fits) {
        // a piece that continues an earlier line of this page (pieces
        // written out of order): the nearest line on its baseline
        cur = null;
        for (let k = out.length - 1; k >= 0 && k >= out.length - 6; k--) {
          const l = out[k];
          if (Math.abs(l.y - p.y) < Math.max(l.size, p.size) * 0.35 && x0 > l.x1 - l.size * 0.6) { cur = l; break; }
        }
      }
      if (cur) {
        const last = cur.runs[cur.runs.length - 1], gap = x0 - cur.x1;
        let t = s;
        if (gap > cur.size * 0.15 && !/\s$/.test(last.t) && t[0] !== ' ') t = (gap > cur.size * 3 ? '  ' : ' ') + t;
        if (last.b === !!p.b && last.i === !!p.i) last.t += t;
        else cur.runs.push({ t: t, b: !!p.b, i: !!p.i });
        cur.x1 = Math.max(cur.x1, x1);
        cur.chars.push([p.size, s.length]);
      } else {
        cur = { x0: x0, x1: x1, y: p.y, size: p.size, runs: [{ t: s, b: !!p.b, i: !!p.i }], chars: [[p.size, s.length]] };
        out.push(cur);
      }
    });
    out.forEach(l => {
      // the line's size: the one most of its letters have
      const by = {};
      l.chars.forEach(c => { const k = Math.round(c[0] * 2) / 2; by[k] = (by[k] || 0) + c[1]; });
      l.size = +Object.keys(by).sort((a, b) => by[b] - by[a])[0];
      delete l.chars;
      l.runs[0].t = l.runs[0].t.replace(/^\s+/, '');
      const rl = l.runs[l.runs.length - 1];
      rl.t = rl.t.replace(/\s+$/, '');
      l.runs = l.runs.filter(r => r.t);
    });
    return out.filter(l => l.runs.length)
      .sort((a, b) => Math.abs(a.y - b.y) < Math.min(a.size, b.size) * 0.35 ? a.x0 - b.x0 : a.y - b.y);
  }
  function textOf(l) { return l.runs.map(r => r.t).join(''); }

  /* ----- 2. Headers, footers, page numbers ----- */
  const PAGE_NO = /^[-–—\s]*(?:(?:page|p\.|σελίδα|σελ\.)\s*)?\d{1,4}(?:\s*(?:\/|of|από|-)\s*\d{1,4})?[-–—\s]*$/i;
  function dropFurniture(pages) {
    const n = pages.length, seen = {};
    const key = l => textOf(l).toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
    const edge = (p, l) => l.y < p.h * 0.12 || l.y > p.h * 0.9;
    pages.forEach(p => {
      const keys = {};
      p.lines.forEach(l => { if (edge(p, l)) keys[key(l)] = 1; });
      Object.keys(keys).forEach(k => { seen[k] = (seen[k] || 0) + 1; });
    });
    pages.forEach(p => {
      p.lines = p.lines.filter(l => {
        if (!edge(p, l)) return true;
        if (PAGE_NO.test(textOf(l))) return false;
        return !(n >= 2 && seen[key(l)] >= Math.max(2, Math.ceil(n * 0.6)));
      });
    });
  }

  /* ----- 3. Lists ----- */
  const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω';
  const BULLET_RE = /^(?:[•●▪■◦○‣∙·▸►✓✔\-–—*]\s+|[\uf000-\uf0ff]\s*)/;
  const ORDER_RE = /^\(?(\d{1,3}|[a-z]|[α-ω]|[ivx]{2,5})([.)])\s+/i;
  // → { type: 'ul' | 'ol', style, n, cut } or null
  function markerOf(text) {
    let m = BULLET_RE.exec(text);
    if (m) return { type: 'ul', style: '', n: 1, cut: m[0].length };
    m = ORDER_RE.exec(text);
    if (!m) return null;
    const v = m[1], lo = v.toLowerCase();
    if (/^\d+$/.test(v)) return { type: 'ol', style: '', n: parseInt(v, 10), cut: m[0].length };
    if (/^[ivx]+$/.test(lo) && v.length > 1) {
      const R = { i: 1, v: 5, x: 10 };
      let n = 0;
      for (let k = 0; k < lo.length; k++) {
        const c = R[lo[k]], nx = R[lo[k + 1]] || 0;
        n += c < nx ? -c : c;
      }
      return { type: 'ol', style: v === lo ? 'lower-roman' : 'upper-roman', n: n, cut: m[0].length };
    }
    // Greek letters as CSS counts them (α β γ δ ε ζ …); "στ)" has no
    // CSS form and stays text
    if (/^[α-ω]$/.test(lo)) {
      const i = GREEK.indexOf(lo);
      if (v !== lo || i < 0) return null;        // "Α. Name": an initial, not a list
      return { type: 'ol', style: 'greek', n: i + 1, cut: m[0].length };
    }
    if (/^[a-z]$/.test(lo)) {
      if (m[2] === '.' && v !== lo) return null; // "A. Smith"
      return { type: 'ol', style: v === lo ? 'lower-alpha' : 'upper-alpha', n: lo.charCodeAt(0) - 96, cut: m[0].length };
    }
    return null;
  }

  /* ----- 4. Lines → paragraphs ----- */
  function median(a) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[s.length >> 1];
  }
  function mode(vals, bucket) {
    const by = {};
    let best = null;
    vals.forEach(v => {
      const k = Math.round(v / bucket);
      by[k] = (by[k] || 0) + 1;
      if (best === null || by[k] > by[best]) best = k;
    });
    return best === null ? 0 : best * bucket;
  }
  function paragraphs(pages, body) {
    // the text column of each page (body-size lines; the whole document
    // when a page has too few)
    const all = [];
    pages.forEach(p => p.lines.forEach(l => { if (Math.abs(l.size - body) <= body * 0.1) all.push(l); }));
    const gL = mode(all.map(l => l.x0), 2), gR = Math.max.apply(null, all.map(l => l.x1).concat([0]));
    const steps = [];
    pages.forEach(p => {
      const bl = p.lines.filter(l => Math.abs(l.size - body) <= body * 0.1);
      p.L = bl.length >= 4 ? mode(bl.map(l => l.x0), 2) : gL;
      p.R = bl.length >= 4 ? Math.max.apply(null, bl.map(l => l.x1)) : gR;
      if (p.R - p.L < body * 5) { p.L = gL; p.R = gR; }
      for (let k = 1; k < bl.length; k++) {
        const dy = bl[k].y - bl[k - 1].y;
        if (dy > body * 0.6 && dy < body * 2.2) steps.push(dy);
      }
    });
    const step = median(steps) || body * 1.25;
    const paras = [];
    let cur = null;
    pages.forEach((p, pi) => {
      p.lines.forEach((l, li) => {
        const tol = Math.max(2.5, l.size * 0.6), txt = textOf(l);
        const mk = markerOf(txt);
        l.page = p;
        let join = false;
        if (cur && !mk) {
          const prev = cur.lines[cur.lines.length - 1], pp = prev.page;
          const same = Math.abs(l.size - cur.size) <= cur.size * 0.1;
          const st = cur.size === body ? step : cur.size * 1.25;
          const dy = pp === p ? l.y - prev.y : null;
          const near = dy === null ? (li === 0 && pages.indexOf(pp) === pi - 1) : (dy > l.size * 0.5 && dy < st * 1.3);
          // the previous line ends at the right edge, or the next line's
          // first word would not have fitted on it (ragged text wraps)
          const pt = textOf(prev), cw = (prev.x1 - prev.x0) / Math.max(1, pt.length);
          const word = (/^\S+/.exec(txt) || [''])[0].length;
          const full = prev.x1 >= pp.R - tol * 2 || prev.x1 + cw * (word + 1) > pp.R - tol * 0.5;
          const cen = !full && Math.abs((prev.x0 + prev.x1) / 2 - (pp.L + pp.R) / 2) < tol &&
            Math.abs((l.x0 + l.x1) / 2 - (p.L + p.R) / 2) < tol && prev.x1 - prev.x0 > (pp.R - pp.L) * 0.6;
          // a first-line indent starts a paragraph; a list item's second
          // line may hang under its text
          const indentStart = !(cur.mk && cur.lines.length === 1) && l.x0 - cur.cx > l.size * 0.8;
          const sameBold = allBold(prev) === allBold(l);
          join = same && near && (full || cen) && !indentStart && sameBold;
        }
        if (join) {
          cur.lines.push(l);
          if (cur.lines.length === 2) cur.cx = l.x0;
        } else {
          cur = { lines: [l], size: l.size, mk: mk, cx: l.x0 };
          paras.push(cur);
        }
      });
    });
    return paras;
  }
  function allBold(l) { return l.runs.every(r => r.b || !r.t.trim()); }

  // alignment of a paragraph: '' (left), 'center', 'right', 'justify'
  function alignOf(pa) {
    const ls = pa.lines, n = ls.length, p0 = ls[0].page;
    const tol = Math.max(2.5, pa.size * 0.6);
    const mid = l => (l.x0 + l.x1) / 2, L = l => l.page.L, R = l => l.page.R;
    const away = ls.some(l => l.x0 - L(l) > tol * 2);
    if (pa.mk) {
      return n >= 3 && ls.slice(0, -1).every(l => R(l) - l.x1 < tol) && ls[n - 1].x1 < R(ls[n - 1]) - tol ? 'justify' : '';
    }
    if (away && ls.every(l => Math.abs(mid(l) - (L(l) + R(l)) / 2) < tol)) return 'center';
    if (away && ls.every(l => R(l) - l.x1 < tol)) return 'right';
    if (n >= 2 && ls.slice(0, -1).every(l => R(l) - l.x1 < tol) &&
        ls.slice(1).every(l => Math.abs(l.x0 - L(l)) < tol * 2) && p0) {
      // a last line that also reaches the right edge: left-aligned text
      // that happens to fill; justified needs a short last line or 3+ lines
      if (n >= 3 || ls[n - 1].x1 < R(ls[n - 1]) - tol) return 'justify';
    }
    return '';
  }

  // runs of a paragraph's lines → inline HTML (a word broken at a line
  // end with "-" is joined again)
  function inlineHtml(lines, cut, noBold) {
    const runs = [];
    lines.forEach((l, k) => {
      l.runs.forEach((r, j) => {
        let t = r.t;
        if (k === 0 && j === 0 && cut) t = t.slice(cut);
        if (j === 0 && k > 0) {
          const pr = runs[runs.length - 1];
          if (pr && /[A-Za-zΑ-Ωα-ωά-ώΆ-Ώϊϋΐΰ]-$/.test(pr.t) && /^[a-zα-ωά-ώϊϋΐΰ]/.test(t)) pr.t = pr.t.slice(0, -1);
          else if (pr) t = ' ' + t;
        }
        const b = r.b && !noBold, i = r.i;
        const last = runs[runs.length - 1];
        if (last && last.b === b && last.i === i) last.t += t;
        else runs.push({ t: t, b: b, i: i });
      });
    });
    return runs.map(r => {
      let h = esc(r.t).replace(/  /g, '&emsp;&emsp;');
      if (!h) return '';
      if (!r.t.trim()) return h;
      // keep the spaces outside the tags
      const lead = /^\s*/.exec(h)[0], trail = /\s*$/.exec(h)[0];
      h = h.slice(lead.length, h.length - trail.length);
      if (r.i) h = '<em>' + h + '</em>';
      if (r.b) h = '<strong>' + h + '</strong>';
      return lead + h + trail;
    }).join('').trim();
  }

  /* ----- 5. Document ----- */
  // pages: [{ w, h, pieces }] → { title, html, footnotes, comments }
  function fromPages(pages) {
    pages = (pages || []).map(p => ({ w: p.w || 595, h: p.h || 842, lines: toLines(p.pieces || []) }));
    dropFurniture(pages);
    const by = {};
    pages.forEach(p => p.lines.forEach(l => {
      const k = Math.round(l.size * 2) / 2;
      by[k] = (by[k] || 0) + textOf(l).length;
    }));
    const keys = Object.keys(by);
    if (!keys.length) { const e = new Error('no text'); e.code = 'notext'; throw e; }
    const body = +keys.sort((a, b) => by[b] - by[a])[0];
    const paras = paragraphs(pages, body);

    // heading levels: sizes above the body text, largest first (≤ 3)
    const big = [];
    paras.forEach(pa => {
      const k = Math.round(pa.size * 2) / 2;
      if (k >= body * 1.12 && big.indexOf(k) === -1) big.push(k);
    });
    big.sort((a, b) => b - a);
    const sizeLevel = s => {
      const i = big.indexOf(Math.round(s * 2) / 2);
      return i < 0 ? 0 : Math.min(3, i + 1);
    };
    const boldLevel = Math.min(4, Math.min(3, big.length) + 1);
    const plain = paras.filter(pa => !pa.mk && sizeLevel(pa.size) === 0);
    const boldHeads = plain.filter(boldHead);
    const useBold = boldHeads.length <= Math.max(1, plain.length * 0.4);

    let html = '';
    const stack = [];   // open lists: { tag, x, style }
    const closeTo = depth => { while (stack.length > depth) html += '</li></' + stack.pop().tag + '>'; };
    paras.forEach(pa => {
      const al = alignOf(pa), st = al ? ' style="text-align:' + al + '"' : '';
      if (pa.mk) {
        const tol = Math.max(2.5, pa.size * 0.6), x = pa.lines[0].x0, tag = pa.mk.type;
        while (stack.length && stack[stack.length - 1].x > x + tol) closeTo(stack.length - 1);
        let top = stack[stack.length - 1];
        if (top && Math.abs(top.x - x) <= tol && (top.tag !== tag || top.style !== pa.mk.style)) { closeTo(stack.length - 1); top = stack[stack.length - 1]; }
        if (top && Math.abs(top.x - x) <= tol) html += '</li>';
        else {
          const ls = pa.mk.style === 'greek' ? 'lower-greek' : pa.mk.style;
          html += '<' + tag + (tag === 'ol' && pa.mk.n !== 1 ? ' start="' + pa.mk.n + '"' : '') +
            (ls ? ' style="list-style-type:' + ls + '"' : '') + '>';
          stack.push({ tag: tag, x: x, style: pa.mk.style });
        }
        html += '<li' + st + '>' + inlineHtml(pa.lines, pa.mk.cut, false);
        return;
      }
      closeTo(0);
      const lv = sizeLevel(pa.size) || (useBold && boldHead(pa) ? boldLevel : 0);
      if (lv) html += '<h' + lv + st + '>' + inlineHtml(pa.lines, 0, true) + '</h' + lv + '>';
      else html += '<p' + st + '>' + inlineHtml(pa.lines, 0, false) + '</p>';
    });
    closeTo(0);
    const first = paras.find(pa => sizeLevel(pa.size)) || paras[0];
    const title = first ? first.lines.map(textOf).join(' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    return { title: title, html: html, footnotes: [], comments: [] };
  }
  // a short paragraph that is all bold and reads as a title
  function boldHead(pa) {
    if (pa.mk || pa.lines.length > 2 || !pa.lines.every(allBold)) return false;
    const t = pa.lines.map(textOf).join(' ').trim();
    return t.length > 0 && t.length <= 120 && !/[,;]$/.test(t);
  }

  /* ----- 6. Browser: PDF.js ----- */
  // the vendored PDF.js next to this file: ../vendor/pdfjs/
  const HERE = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  function libUrl(f) {
    try { return new URL('../vendor/pdfjs/' + f, HERE || location.href).href; } catch (e) { return '../vendor/pdfjs/' + f; }
  }
  let libP = null;
  function loadLib() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (libP) return libP;
    libP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.type = 'module';
      s.src = libUrl('pdf.min.js');
      s.onload = () => { if (root.pdfjsLib) res(root.pdfjsLib); else rej(new Error('pdfjs')); };
      s.onerror = () => { libP = null; rej(new Error('pdfjs')); };
      document.head.appendChild(s);
    });
    return libP;
  }
  function fontOf(page, name, styles) {
    let f = null;
    try { f = page.commonObjs.has(name) ? page.commonObjs.get(name) : null; } catch (e) { f = null; }
    const nm = (f ? String(f.name || '') : '').replace(/^[A-Z]{6}\+/, '') + ' ' + ((styles && styles[name] && styles[name].fontFamily) || '');
    const suf = (/[-_ ,](b|bd|bi|bdit|i|it)\b/i.exec(nm) || ['', ''])[1].toLowerCase();
    return {
      b: !!(f && (f.bold || f.black)) || /bold|black|heavy|semibold|demi|extrabold/i.test(nm) || /^b/.test(suf),
      i: !!(f && f.italic) || /italic|oblique/i.test(nm) || /i/.test(suf)
    };
  }
  // buf: ArrayBuffer → Promise of the payload ({ kind: 'doc', … })
  function open(buf, onProgress) {
    return loadLib().then(lib => {
      lib.GlobalWorkerOptions.workerSrc = libUrl('pdf.worker.min.js');
      return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, enableXfa: false,
        disableAutoFetch: true, disableStream: true, stopAtErrors: false }).promise;
    }).then(pdf => {
      const lib = root.pdfjsLib, n = Math.min(pdf.numPages, MAX_PAGES), pages = [];
      let chain = Promise.resolve();
      for (let k = 1; k <= n; k++) {
        chain = chain.then(() => pdf.getPage(k)).then(page => {
          const vp = page.getViewport({ scale: 1 });
          // the operator list loads the fonts (their names and flags)
          return page.getOperatorList().then(() => page.getTextContent()).then(tc => {
            pages.push({ w: vp.width, h: vp.height, pieces: tc.items.map(it => {
              if (typeof it.str !== 'string') return { s: '' };
              const m = lib.Util.transform(vp.transform, it.transform);
              const f = fontOf(page, it.fontName, tc.styles);
              return { s: it.str, x: m[4], y: m[5], w: it.width || 0, size: Math.hypot(m[2], m[3]),
                       rot: Math.atan2(m[1], m[0]) * 180 / Math.PI, b: f.b, i: f.i };
            }) });
            if (page.cleanup) page.cleanup();
            if (typeof onProgress === 'function') { try { onProgress(k / n); } catch (e) {} }
          });
        });
      }
      return chain.then(() => {
        if (pdf.destroy) pdf.destroy();
        return Object.assign({ kind: 'doc' }, fromPages(pages));
      });
    });
  }

  const api = { fromPages: fromPages, markerOf: markerOf, toLines: toLines, open: open, MAX_PAGES: MAX_PAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WriterPdfIn = api;
})(typeof window !== 'undefined' ? window : this);
