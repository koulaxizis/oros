// An in-memory D1 for relay/share.js that knows exactly the statements
// in SHR_SQL (and nothing else: any other SQL throws), shared by the
// share tests. changes() is the count of the statement before, as in
// one D1 batch. tests/share-short.test.js runs the same statements on
// a real SQLite instead.
"use strict";
const assert = require("node:assert/strict");

function fakeD1(Q, opts) {
  opts = opts || {};
  const objs = new Map(), chunks = new Map();     // chunks: "id|i" → {id,i,len,data}
  const log = [];
  let tot = null, last = 0;                       // shr_tot row; changes() of the statement before
  function chunksOf(id) { return [...chunks.values()].filter((c) => c.id === id); }
  function done(n) { last = n; return { meta: { changes: n } }; }
  function exec(sql, a) {
    log.push(sql);
    switch (sql) {
      case Q.obj: case Q.chunk: case Q.indexExp: case Q.indexOpen: case Q.shl: case Q.shlLast: case Q.shlDay: case Q.shlTot: case Q.shlTot1: case Q.tot: return done(0);
      case Q.tot1:
        if (tot !== null) return done(0);
        tot = [...objs.values()].reduce((x, o) => x + o.size, 0);
        return done(1);
      case Q.getObj: { const o = objs.get(a[0]); return { first: o ? { ...o } : null }; }
      case Q.used: return { first: { s: tot || 0 } };
      case Q.addObj:
        if (objs.has(a[0])) return done(0);
        objs.set(a[0], { exp: a[1], size: a[2], n: a[3], delh: a[4], tokh: a[5], at: a[6], fin: 0 });
        return done(1);
      case Q.totAdd: if (tot !== null && last > 0) { tot += a[0]; return done(1); } return done(0);
      case Q.totDrop: { const o = objs.get(a[0]); if (tot !== null && o) { tot -= o.size; return done(1); } return done(0); }
      case Q.got: { const cs = chunksOf(a[0]); return { first: { c: cs.length, s: cs.reduce((x, c) => x + c.len, 0) } }; }
      case Q.addChunk: {
        const k = a[0] + "|" + a[1];
        if (chunks.has(k)) return done(0);
        if (opts.blob !== false) assert.ok(a[3] instanceof ArrayBuffer, "pieces are stored as BLOB");
        chunks.set(k, { id: a[0], i: a[1], len: a[2], data: a[3] });
        return done(1);
      }
      case Q.dropChunk: chunks.delete(a[0] + "|" + a[1]); return done(1);
      case Q.fin: { const o = objs.get(a[0]); if (o && !o.fin) { o.fin = 1; return done(1); } return done(0); }
      case Q.finBox: { const o = objs.get(a[0]); if (o && !o.fin && o.n === -1 && last > 0) { o.fin = 1; return done(1); } return done(0); }
      case Q.read: {
        const o = objs.get(a[0]), c = chunks.get(a[0] + "|" + a[1]);
        return { first: o && c && o.fin === 1 && o.exp > a[2] && o.n > 0 ? { data: Array.from(new Uint8Array(c.data)) } : null };
      }
      case Q.readBox: { const c = chunks.get(a[0] + "|0"); return { first: c ? { data: Array.from(new Uint8Array(c.data)) } : null }; }
      case Q.dropChunks: { const cs = chunksOf(a[0]); for (const c of cs) chunks.delete(c.id + "|" + c.i); return done(cs.length); }
      case Q.dropObj: return done(objs.delete(a[0]) ? 1 : 0);
      case Q.stale: return { all: [...objs.entries()].filter(([, o]) => o.exp <= a[0] || (o.fin === 0 && o.at < a[1] && o.n > 0)).slice(0, a[2]).map(([id]) => ({ id })) };
    }
    throw new Error("unknown SQL " + sql);
  }
  function stmt(sql, args) {
    return { bind: (...b) => stmt(sql, b), first: async () => exec(sql, args || []).first,
             all: async () => ({ results: exec(sql, args || []).all }), run: async () => exec(sql, args || []),
             _run: () => exec(sql, args || []) };
  }
  return { objs, chunks, log, total: () => tot, prepare: (sql) => stmt(sql), batch: async (ss) => ss.map((s) => s._run()) };
}

module.exports = { fakeD1 };
