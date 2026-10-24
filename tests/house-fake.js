// Stand-ins for the relay's household boxes (relay/house.js): the
// Durable Object's SQLite storage and its WebSockets. Shared by
// tests/house-relay.test.js and tests/household-engine.test.js.
let H = null;
async function load() { if (!H) H = await import("../relay/house.js"); return H; }
const ORIGIN = "https://useoros.online";

// A tiny SQLite stand-in that knows exactly the statements house.js runs.
function fakeStorage() {
  const st = { meta: null, docs: new Map(), inv: new Map(), req: new Map(), env: new Map(), alarm: null, wiped: 0 };
  const res = (a) => ({ toArray: () => a });
  st.sql = {
    exec(q, ...v) {
      if (q.startsWith("CREATE")) return res([]);
      if (q.startsWith("SELECT v FROM meta")) return res(st.meta ? [{ v: st.meta }] : []);
      if (q.startsWith("INSERT OR REPLACE INTO meta")) { st.meta = v[0]; return res([]); }
      if (q === "SELECT k, rev FROM docs") return res(Array.from(st.docs, ([k, d]) => ({ k, rev: d.rev })));
      if (q.startsWith("SELECT COALESCE(SUM(len)")) {
        let s = 0; st.docs.forEach((d) => { s += d.len; });
        return res([{ s, n: st.docs.size }]);
      }
      if (q.startsWith("SELECT rev, data FROM docs")) { const d = st.docs.get(v[0]); return res(d ? [{ rev: d.rev, data: d.data }] : []); }
      if (q.startsWith("SELECT rev, len FROM docs")) { const d = st.docs.get(v[0]); return res(d ? [{ rev: d.rev, len: d.len }] : []); }
      if (q.startsWith("INSERT OR REPLACE INTO docs")) { st.docs.set(v[0], { rev: v[1], len: v[2], data: new Uint8Array(v[3]) }); return res([]); }
      if (q.startsWith("DELETE FROM docs")) { st.docs.delete(v[0]); return res([]); }
      if (q.startsWith("SELECT COUNT(*) AS n FROM inv")) return res([{ n: Array.from(st.inv.values()).filter((i) => i.exp > v[0]).length }]);
      if (q.startsWith("SELECT exp, n FROM inv")) { const i = st.inv.get(v[0]); return res(i ? [Object.assign({}, i)] : []); }
      if (q.startsWith("INSERT OR REPLACE INTO inv")) { st.inv.set(v[0], { exp: v[1], n: v[2] }); return res([]); }
      if (q.startsWith("UPDATE inv SET n")) { const i = st.inv.get(v[0]); if (i) i.n--; return res([]); }
      if (q.startsWith("DELETE FROM inv WHERE ih")) { st.inv.delete(v[0]); return res([]); }
      if (q.startsWith("DELETE FROM inv WHERE exp")) { st.inv.forEach((i, k) => { if (i.exp <= v[0] || i.n <= 0) st.inv.delete(k); }); return res([]); }
      if (q.startsWith("SELECT rid FROM req")) return res(Array.from(st.req, ([rid, r]) => ({ rid, r })).filter((x) => x.r.st === 0 && x.r.at > v[0]).map((x) => ({ rid: x.rid })));
      if (q.startsWith("INSERT INTO req")) { st.req.set(v[0], { ih: v[1], at: v[2], st: 0, data: new Uint8Array(v[3]), ans: null }); return res([]); }
      if (q.startsWith("SELECT ih, at, st")) { const r = st.req.get(v[0]); return res(r ? [Object.assign({}, r)] : []); }
      if (q.startsWith("UPDATE req SET st = 1")) { const r = st.req.get(v[1]); if (r && r.st === 0) { r.st = 1; r.ans = new Uint8Array(v[0]); } return res([]); }
      if (q.startsWith("UPDATE req SET st = 2")) { const r = st.req.get(v[1]); if (r && r.st === 0) { r.st = 2; r.data = new Uint8Array(v[0]); } return res([]); }
      if (q.startsWith("DELETE FROM req WHERE at")) { st.req.forEach((r, k) => { if (r.at <= v[0]) st.req.delete(k); }); return res([]); }
      if (q === "DELETE FROM env") { st.env.clear(); return res([]); }
      if (q.startsWith("INSERT OR REPLACE INTO env")) { st.env.set(v[0], new Uint8Array(v[1])); return res([]); }
      if (q.startsWith("SELECT data FROM env")) { const e = st.env.get(v[0]); return res(e ? [{ data: e }] : []); }
      if (q.startsWith("SELECT COUNT(*) AS n FROM env")) return res([{ n: st.env.size }]);
      throw new Error("unknown SQL " + q);
    }
  };
  st.storage = {
    sql: st.sql,
    setAlarm(t) { st.alarm = t; },
    deleteAlarm() { st.alarm = null; },
    deleteAll() { st.meta = null; st.docs.clear(); st.inv.clear(); st.req.clear(); st.env.clear(); st.wiped++; },
    transactionSync(fn) { return fn(); }
  };
  return st;
}

function fakeSocket(wh) {
  const s = { sent: [], closed: null, att: { wh } };
  s.send = (m) => { if (s.closed) throw new Error("closed"); s.sent.push(m); };
  s.close = (c) => { s.closed = c; };
  s.deserializeAttachment = () => s.att;
  return s;
}

function world() {
  if (!H) throw new Error("call load() first");
  const boxes = new Map();
  const env = { ALLOWED_ORIGINS: ORIGIN };
  env.HOUSE = {
    idFromName: (n) => n,
    get(id) {
      if (!boxes.has(id)) {
        const st = fakeStorage(), socks = [];
        const state = { storage: st.storage, getWebSockets: () => socks.filter((s) => !s.closed) };
        boxes.set(id, { st, socks, box: new H.HouseBox(state, env) });
      }
      const b = boxes.get(id);
      return { fetch: (u, o) => b.box.fetch(u instanceof Request ? u : new Request(u, o)) };
    }
  };
  return { env, boxes };
}

module.exports = { load, fakeStorage, fakeSocket, world, ORIGIN };
