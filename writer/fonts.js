/* ============================================================
   orOS Writer — fonts.js (FM-4): a document's own fonts
   A document may set a font for its body text and one for its
   headings, from the font collections of Settings › Fonts and the
   font files on the orOS disk (/internal/Fonts). The choice is kept
   in the synced "fonts" slice (designkit/fonts.js cols, docs
   ["writer:<doc id>"] = { body, head }), not in the document itself,
   so devices with an older Writer keep the document as it is.
   Used on screen and in print (CSS @font-face from the same files)
   and in the PDF (each TrueType file embedded; a word a file cannot
   draw falls back to Noto, as before). Loaded by writer.js only for
   a document that has fonts, or when Page settings opens, with
   designkit/text.js and designkit/fonts.js.
   window.WriterFonts = { get, set, choices, apply, pdf }
   ============================================================ */
(function () {
  'use strict';

  const H = window.WriterFontsHost;
  const DK = window.orosDK, T = DK.text, F = DK.fonts, C = F.cols;
  T.setFetcher(F.fetcher);

  const VARS = ['r', 'b', 'i', 'bi'];
  const FACE = { r: ['normal', '1 549'], b: ['normal', '550 1000'], i: ['italic', '1 549'], bi: ['italic', '550 1000'] };
  const PDF_ST = { r: 'normal', b: 'bold', i: 'italic', bi: 'bolditalic' };
  const ready = {};      // family id → Promise<bool> (loaded and on the page)
  const own = {};        // family id → { r: true, b: bool, … } (a face of its own, not the regular one)
  let libP = null;
  let styleEl = null;

  const CB = C.bind(window, () => {
    apply(H.activeId());
    if (H.onChange) H.onChange();
  });

  function key(docId) { return 'writer:' + docId; }
  function famOf(f) { return f && typeof f.id === 'string' ? { id: f.id, name: f.name || f.id, fb: f.fb || 'serif' } : null; }

  // { body, head }: each { id, name, fb } or null.
  function get(docId) {
    const x = docId ? C.docFonts(CB.get(), key(docId)) : null;
    return { body: famOf(x && x.body), head: famOf(x && x.head) };
  }
  // role "body" | "head"; fam { id, name, fb } or null (Writer's own font).
  function set(docId, role, fam) {
    if (!docId || (role !== 'body' && role !== 'head')) return false;
    const o = {};
    o[role] = famOf(fam);
    const ok = CB.edit(d => C.setDocFonts(d, key(docId), o, Date.now()));
    apply(docId);
    return ok;
  }

  // The families on this disk (TrueType only, as in Layout: the PDF
  // must be able to embed what the screen shows).
  function library(fresh) {
    if (fresh || !libP) libP = F.library().then(F.families, () => []);
    return libP;
  }
  // What a document may choose: [{ name, fams: [{ id, name, fb }] }],
  // the collections by name, then "On this device".
  function choices(lang) {
    const d = CB.get();
    const groups = C.order(d, lang).map(cid => ({ name: d.cols[cid].name, fams: C.fams(d, cid, lang) }))
      .filter(g => g.fams.length);
    return library(true).then(fams => {
      if (fams.length) groups.push({ name: H.t('page.fontMine'), mine: true, fams: fams.map(famOf) });
      return groups;
    });
  }

  function urlsOf(fam) {
    if (fam.id.indexOf('fs_') === 0) return Promise.resolve(F.fontsourceUrls(fam.id));
    if (fam.id.indexOf('uf_') !== 0) return Promise.resolve(null);
    return library(false).then(list => {
      let f = list.filter(x => x.id === fam.id)[0];
      return f ? f : library(true).then(l2 => l2.filter(x => x.id === fam.id)[0] || null);
    }).then(f => {
      if (!f) return null;
      const u = {};
      VARS.forEach(v => { u[v] = f[v] ? ['asset:' + f[v]] : []; });
      return u;
    });
  }
  function sizes(k) { return T.faceParts(k).map(p => p.bytes().length).join(','); }
  // Loads the family's four faces (a missing one stands in with the
  // regular face) and adds them to the page as "wf-<id>".
  function ensure(fam) {
    if (!fam || !F.isFam(fam.id)) return Promise.resolve(false);
    if (ready[fam.id]) return ready[fam.id];
    const id = fam.id;
    const p = urlsOf(fam).then(urls => {
      if (!urls || !T.registerFamily(id, { name: fam.name, urls: urls, fallback: fam.fb === 'serif' ? 'serif' : fam.fb === 'mono' ? 'mono' : 'sans' })) return false;
      return T.load(VARS.map(v => id + '-' + v)).then(() => {
        if (!T.isLoaded(id + '-r')) return false;
        const r = sizes(id + '-r');
        own[id] = { r: true };
        VARS.slice(1).forEach(v => { own[id][v] = T.isLoaded(id + '-' + v) && sizes(id + '-' + v) !== r; });
        if (typeof FontFace === 'undefined' || !document.fonts) return true;
        return Promise.all(VARS.filter(v => own[id][v]).map(v => Promise.all(T.faceParts(id + '-' + v).map(part => {
          const desc = { style: FACE[v][0], weight: FACE[v][1] };
          if (part.range) desc.unicodeRange = part.range;
          try {
            const ff = new FontFace('wf-' + id, part.bytes().buffer, desc);
            return ff.load().then(x => { document.fonts.add(x); }, () => {});
          } catch (e) { return null; }
        })))).then(() => true);
      });
    }).then(ok => { if (!ok) delete ready[id]; return ok; }, () => { delete ready[id]; return false; });
    ready[id] = p;
    return p;
  }

  function cssName(id) { return '"wf-' + id + '"'; }
  // The editor in the document's fonts (none: Writer's own).
  function apply(docId) {
    const f = get(docId);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'writer-doc-fonts';
      document.head.appendChild(styleEl);
    }
    let css = '';
    if (f.body) css += '.rich-editor{font-family:' + cssName(f.body.id) + ',var(--font-stack)}';
    if (f.head) css += '.rich-editor h1,.rich-editor h2,.rich-editor h3,.rich-editor h4,.rich-editor h5,.rich-editor h6{font-family:' + cssName(f.head.id) + ',var(--font-stack)}';
    styleEl.textContent = css;
    return Promise.all([f.body, f.head].map(ensure));
  }

  // For the PDF: { body, head }, each null or { normal: [{ b64, map }],
  // bold?, italic?, bolditalic? } (the TrueType files of each face that
  // is the family's own; a missing one is drawn with normal).
  function pdfFaces(fam) {
    return ensure(fam).then(ok => {
      if (!ok) return null;
      const out = {};
      VARS.forEach(v => {
        if (!own[fam.id][v]) return;
        const parts = T.faceParts(fam.id + '-' + v).filter(p => !p.cff);
        if (parts.length) out[PDF_ST[v]] = parts.map(p => ({ b64: p.b64(), map: p.map }));
      });
      return out.normal ? out : null;
    });
  }
  function pdf(docId) {
    const f = get(docId);
    const same = f.body && f.head && f.body.id === f.head.id;
    return Promise.all([pdfFaces(f.body), same ? null : pdfFaces(f.head)]).then(r => ({ body: r[0], head: same ? r[0] : r[1] }));
  }

  window.WriterFonts = { get: get, set: set, choices: choices, apply: apply, pdf: pdf };
})();
