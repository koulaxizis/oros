// Universal search, phase 2 — media group providers: Mail, Reader
// (feeds), Podcasts, Radio, Television, Maps. Plain node, no DOM:
// providers read localStorage through ctx.readJSON over an
// in-memory storage, and IndexedDB through a small read-only fake
// (it has no put/delete: a provider that tried to write would throw).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const S = require(path.join(ROOT, "search.js"));
const P = (id) => require(path.join(ROOT, id, "search.js"));
const APPS = ["mail", "feeds", "podcasts", "radio", "television", "maps"];

function store(obj) {
  const m = new Map(Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)]));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}
function ctxFor(storage, q, lang) {
  return { q, words: S.parseQuery(q), fold: S.fold, lang: lang || "en", limit: 50,
           readJSON: S.makeReader(storage) };
}
// Runs the provider through the real core (ranking + matching).
async function run(id, storage, q, lang) {
  const groups = await S.run([P(id)], q, { readJSON: S.makeReader(storage), lang, timeoutMs: 2000 });
  return groups.length ? groups[0].hits : [];
}

// ---------- a tiny read-only IndexedDB ----------
// dbs = { name: { store: [[key, value], …] } }
function fakeIDB(dbs) {
  const log = { opened: [], created: [] };
  const later = (fn) => setImmediate(fn);
  function makeTx(db, names) {
    const tx = { oncomplete: null, onerror: null, onabort: null };
    let pending = 0, done = false;
    function req(compute) {
      const r = { result: undefined, onsuccess: null };
      pending++;
      later(() => {
        r.result = compute();
        if (r.onsuccess) r.onsuccess();
        pending--;
        if (pending === 0) later(() => {
          if (pending === 0 && !done) { done = true; if (tx.oncomplete) tx.oncomplete(); }
        });
      });
      return r;
    }
    tx.objectStore = (n) => {
      if (!(Array.isArray(names) ? names : [names]).includes(n)) throw new Error("not in tx: " + n);
      const rows = db.stores[n];
      return {
        getAll: () => req(() => rows.map((r) => r[1])),
        getAllKeys: () => req(() => rows.map((r) => r[0])),
        get: (k) => req(() => { const r = rows.find((x) => x[0] === k); return r ? r[1] : undefined; }),
        openCursor: () => {
          let i = 0;
          const cr = { result: null, onsuccess: null };
          function step() {
            pending++;
            later(() => {
              cr.result = i < rows.length ? { key: rows[i][0], value: rows[i][1], continue: () => { i++; step(); } } : null;
              if (cr.onsuccess) cr.onsuccess();
              pending--;
              if (pending === 0) later(() => {
                if (pending === 0 && !done) { done = true; if (tx.oncomplete) tx.oncomplete(); }
              });
            });
          }
          step();
          return cr;
        }
      };
    };
    return tx;
  }
  return {
    log,
    open(name, version) {
      assert.equal(version, undefined, "providers open without a version");
      log.opened.push(name);
      const rq = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      later(() => {
        const def = dbs[name];
        if (!def) {
          let aborted = false;
          rq.transaction = { abort: () => { aborted = true; } };
          rq.result = { objectStoreNames: { contains: () => false }, createObjectStore: () => { log.created.push(name); } };
          if (rq.onupgradeneeded) rq.onupgradeneeded();
          if (!aborted) log.created.push(name);
          if (rq.onerror) rq.onerror({ preventDefault() {} });
          return;
        }
        const db = {
          stores: def,
          closed: false,
          objectStoreNames: { contains: (n) => Object.prototype.hasOwnProperty.call(def, n) },
          transaction: (names, mode) => { assert.equal(mode, "readonly"); return makeTx(db, names); },
          close() { db.closed = true; }
        };
        rq.result = db;
        if (rq.onsuccess) rq.onsuccess();
      });
      return rq;
    }
  };
}
function withIDB(idb, fn) {
  const prev = globalThis.indexedDB;
  globalThis.indexedDB = idb;
  return Promise.resolve().then(fn).finally(() => {
    if (prev === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = prev;
  });
}

// ---------- read-only ----------
test("media providers: read-only, template shape", () => {
  for (const id of APPS) {
    const src = fs.readFileSync(path.join(ROOT, id, "search.js"), "utf8");
    assert.doesNotMatch(src, /setItem|removeItem|registerSlice|innerHTML/, id);
    const p = P(id);
    assert.equal(p.id, id);
    assert.ok(Array.isArray(p.keys) && p.keys.length === 1 && p.keys[0] === "oros-" + id + "-data", id);
    assert.equal(typeof p.search, "function");
  }
});

// ---------- radio ----------
test("radio: favourite stations, tombstone, open through the bridge", async () => {
  const st = store({ "oros-radio-data": { ver: 1, favorites: [
    { stationuuid: "u1", name: "Ελληνικός Ραδιοφωνικός Σταθμός", country: "Greece", tags: ["news", "talk"],
      homepage: "https://ert.gr", mtime: 20 },
    { stationuuid: "u2", name: "", country: "Greece", tags: "jazz, blues", mtime: 10 },
    { stationuuid: "u3", name: "Jazz FM old", tags: "jazz", mtime: 5 }
  ], deleted: { u3: 6, u9: 1 } }, "oros-radio-recents": [{ stationuuid: "r1", name: "Jazz Recent" }] });
  const hits = P("radio").search(ctxFor(st, "jazz"));
  assert.deepEqual(hits.map((h) => h.id), ["u1", "u2"]);
  assert.equal(hits[1].title, "Unnamed station");
  assert.equal(P("radio").search(ctxFor(st, "x", "el"))[1].title, "Σταθμός χωρίς όνομα");
  assert.equal(hits[0].text, "Greece · news, talk · https://ert.gr");
  assert.equal(hits[0].target, "u1");
  const found = await run("radio", st, "ραδιοφωνικος");
  assert.deepEqual(found.map((h) => h.id), ["u1"]);
  assert.deepEqual((await run("radio", st, "jazz")).map((h) => h.id), ["u2"]);   // u3 tombstoned, recents not read
  let opened = null;
  P("radio").open("u1", { __orosOpenRadio: (id) => { opened = id; } });
  assert.equal(opened, "u1");
  assert.deepEqual(P("radio").search(ctxFor(store({}), "x")), []);
});

// ---------- television ----------
test("television: favourite channels, tombstone, open through the bridge", async () => {
  const st = store({ "oros-television-data": { ver: 1, favorites: [
    { id: "ERT1.gr", name: "ΕΡΤ1", url: "https://x/1.m3u8", country: "GR", categories: ["general"],
      languages: ["ell"], website: "https://ert.gr", mtime: 30 },
    { id: "Old.gr", name: "Old News", categories: ["news"], mtime: 3 }
  ], deleted: { "Old.gr": 3 } } });
  const hits = P("television").search(ctxFor(st, "news"));
  assert.deepEqual(hits.map((h) => h.id), ["ERT1.gr"]);
  assert.equal(hits[0].text, "GR · general · ell · https://ert.gr");
  assert.equal(hits[0].target, "ERT1.gr");
  assert.deepEqual((await run("television", st, "ερτ1")).map((h) => h.title), ["ΕΡΤ1"]);
  let opened = null;
  P("television").open("ERT1.gr", { __orosOpenTelevision: (id) => { opened = id; } });
  assert.equal(opened, "ERT1.gr");
});

// ---------- maps ----------
test("maps: saved places only, tombstone by placeId, open through the bridge", async () => {
  const st = store({
    "oros-maps-data": { ver: 1, places: [
      { id: "p37.971500,23.725700", name: "Γιαγιά", sub: "Πλάκα, Αθήνα", lat: 37.9715, lon: 23.7257, mtime: 50 },
      { id: "p40.640100,22.944400", name: "?", sub: "Thessaloniki", lat: 40.6401, lon: 22.9444, mtime: 40 },
      { id: "p38.000000,23.000000", name: "Old office", sub: "Athens", lat: 38, lon: 23, mtime: 10 }
    ], deleted: { "p38.000000,23.000000": 10 } },
    "oros-maps-recent": [{ name: "Athens Airport", lat: 37.9, lon: 23.9 }]
  });
  const hits = P("maps").search(ctxFor(st, "athens"));
  assert.deepEqual(hits.map((h) => h.title), ["Γιαγιά", "Thessaloniki"]);
  assert.equal(hits[0].text, "Πλάκα, Αθήνα");
  assert.deepEqual(hits[0].target, { lat: 37.9715, lon: 23.7257, name: "Γιαγιά" });
  assert.deepEqual((await run("maps", st, "αθηνα")).map((h) => h.title), ["Γιαγιά"]);
  assert.deepEqual(await run("maps", st, "airport"), []);           // recents are not searched
  assert.deepEqual(await run("maps", st, "office"), []);            // tombstoned
  let call = null;
  P("maps").open(hits[0].target, { __orosOpenMaps: (lat, lon, label) => { call = [lat, lon, label]; } });
  assert.deepEqual(call, [37.9715, 23.7257, "Γιαγιά"]);
});

// ---------- feeds ----------
const FID = "fabc1234567", FID2 = "fzzz9999999", FGONE = "fgone000000";
const feedsData = {
  ver: 1,
  feeds: [
    { id: FID, url: "https://example.com/feed.xml", title: "Καθημερινή", site: "https://example.com", folder: "dnews00001", m: 5 },
    { id: FID2, url: "https://blog.example.org/rss", title: "", site: "", folder: "", m: 5 },
    { id: FGONE, url: "https://gone.example/rss", title: "Gone feed", m: 2 }
  ],
  folders: [{ id: "dnews00001", name: "News", ord: 0, m: 1 }],
  items: [
    { id: "isaved00001", feed: FGONE, title: "Saved boiler guide", link: "", date: 1000, author: "Nikos",
      sum: "How to service a boiler", star: 1, later: 0, tags: [], m: 9 },
    { id: "idead000001", feed: FID, title: "Removed boiler story", sum: "", star: 1, later: 0, tags: [], m: 3 }
  ],
  tags: [], rules: [], set: {}, read: { old: 0, cut: {}, ids: {} },
  tombs: { ["f:" + FGONE]: 2, "i:idead000001": 3 }
};

test("feeds: subscriptions + saved + stored articles, tombstones, no IndexedDB", async () => {
  const st = store({ "oros-feeds-data": feedsData });
  await withIDB(undefined, async () => {
    const hits = await P("feeds").search(ctxFor(st, "boiler"));
    assert.deepEqual(hits.map((h) => h.id), ["f:" + FID, "f:" + FID2, "i:isaved00001"]);
    assert.equal(hits[0].text, "News · https://example.com · https://example.com/feed.xml");
    assert.equal(hits[1].title, "blog.example.org");
    assert.deepEqual(hits[2].target, { item: "isaved00001", feed: FGONE });
    assert.equal(hits[2].when, 1000);
    assert.equal(hits[2].text, "How to service a boiler · Nikos");
  });
});

test("feeds: articles stored on the device (IndexedDB heads), read-only open", async () => {
  const st = store({ "oros-feeds-data": feedsData });
  const idb = fakeIDB({ "oros-feeds": { heads: [
    ["ihead000001", { id: "ihead000001", feed: FID, title: "Σεισμός στην Κρήτη", snip: "Ισχυρή δόνηση", author: "", date: 2000 }],
    ["ihead000002", { id: "ihead000002", feed: FGONE, title: "Σεισμός παλιός", snip: "", date: 1500 }],
    ["isaved00001", { id: "isaved00001", feed: FID, title: "dup of saved", snip: "", date: 1 }]
  ], bodies: [] } });
  await withIDB(idb, async () => {
    const hits = await run("feeds", st, "σεισμος");
    assert.deepEqual(hits.map((h) => h.id), ["i:ihead000001"]);      // unsubscribed feed's head skipped
    assert.equal(hits[0].text, "Ισχυρή δόνηση · Καθημερινή");
    assert.deepEqual(hits[0].target, { item: "ihead000001", feed: FID });
    const sv = await P("feeds").search(ctxFor(st, "boiler"));
    assert.equal(sv.filter((h) => h.id === "i:isaved00001").length, 1);   // saved wins, listed once
    assert.equal(sv.find((h) => h.id === "i:isaved00001").title, "Saved boiler guide");
  });
  assert.deepEqual(idb.log.opened, ["oros-feeds"]);

  const empty = fakeIDB({});
  await withIDB(empty, async () => {
    const hits = await run("feeds", st, "καθημερινη");
    assert.deepEqual(hits.map((h) => h.id), ["f:" + FID]);
  });
  assert.deepEqual(empty.log.created, []);                            // no database created
});

// ---------- podcasts ----------
const SID = "sabcdefghijk1", SID2 = "szyxwvutsrqp1", SGONE = "sgone00000000";
test("podcasts: subscriptions + episode titles, tombstone, cache of unsubscribed shows", async () => {
  const st = store({ "oros-podcasts-data": { ver: 1, shows: [
    { id: SID, m: 10, url: "https://pod.example/feed", title: "Ιστορία της Ελλάδας", by: "Μαρία" },
    { id: SID2, m: 10, url: "https://daily.example/rss", title: "The Daily", by: "NYT" },
    { id: SGONE, m: 1, url: "https://gone.example/rss", title: "Gone Show" }
  ], eps: [], floors: {}, queue: { m: 0, ids: [], sh: {} }, prefs: {}, tombs: { [SGONE]: 1 } } });
  const idb = fakeIDB({ "oros-podcasts": { feeds: [
    [SID, { id: SID, at: 1, show: {}, eps: [
      { id: "eaaaaaaaaaaaa", title: "Η Επανάσταση του 1821", pub: 5000, notes: "<p>long notes about history</p>" },
      { id: "ebbbbbbbbbbbb", title: "Βυζάντιο", pub: 4000 }
    ] }],
    [SID2, { id: SID2, at: 1, show: {}, eps: [{ id: "ecccccccccccc", title: "Election night", pub: 7000 }] }],
    [SGONE, { id: SGONE, at: 1, show: {}, eps: [{ id: "edddddddddddd", title: "Election recap", pub: 1 }] }]
  ], files: [] } });
  await withIDB(idb, async () => {
    const h1 = await run("podcasts", st, "επανασταση");
    assert.deepEqual(h1.map((h) => h.id), ["eaaaaaaaaaaaa"]);
    assert.equal(h1[0].text, "Ιστορία της Ελλάδας");
    assert.equal(h1[0].when, 5000);
    assert.deepEqual(h1[0].target, { show: SID, ep: "eaaaaaaaaaaaa" });
    assert.deepEqual((await run("podcasts", st, "election")).map((h) => h.id), ["ecccccccccccc"]);
    assert.deepEqual((await run("podcasts", st, "daily election")).map((h) => h.id), ["ecccccccccccc"]);
    const show = await run("podcasts", st, "ιστορια");
    assert.deepEqual(show.map((h) => h.id), [SID]);                  // the show, not all its episodes
    assert.deepEqual(show[0].target, { show: SID });
    assert.equal(show[0].text, "Μαρία · https://pod.example/feed");
    assert.deepEqual(await run("podcasts", st, "history"), []);      // notes are not searched
    assert.deepEqual(await run("podcasts", st, "gone"), []);
  });
  await withIDB(undefined, async () => {
    assert.deepEqual((await run("podcasts", st, "daily")).map((h) => h.id), [SID2]);
  });
});

// ---------- mail ----------
function b64(s) { return Buffer.from(s, "utf8").toString("base64"); }
const RAW_TEXT = b64([
  "From: Νίκος <nikos@example.com>", "Subject: =?UTF-8?B?" + b64("Λέβητας") + "?=",
  "Content-Type: text/plain; charset=utf-8", "", "Ο τεχνικός έρχεται Τρίτη για το σέρβις.", ""
].join("\r\n"));
const RAW_HTML = b64([
  "From: Shop <shop@example.com>", "Subject: Your order", "Content-Type: text/html; charset=utf-8", "",
  "<html><head><style>.x{color:red}</style></head><body><p>Order <b>4711</b> shipped</p>" +
  "<script>alert(1)</script></body></html>", ""
].join("\r\n"));

function mailStore() {
  return store({ "oros-mail-data": { ver: 1, accounts: [
    { id: "acct000001", m: 5, name: "Home", email: "me@example.com", imap: { host: "imap.example.com", port: 993 } },
    { id: "acctgone01", m: 1, name: "Old", email: "old@example.com", imap: { host: "imap.example.com", port: 993 } }
  ], relay: { url: "", m: 0 }, imgOk: {}, tombs: { acctgone01: 2 } } });
}
function mailIDB() {
  const msg = (uid, subj, from, extra) => Object.assign(
    { uid, flags: [], size: 1, date: 1000 + uid, from, to: [], cc: [], subj, att: false, mid: "<m" + uid + "@x>" }, extra || {});
  const nikos = { name: "Νίκος", addr: "nikos@example.com" }, shop = { name: "Shop", addr: "shop@example.com" };
  return fakeIDB({ "oros-mail": {
    keys: [["device", { secret: true }]], creds: [["acct000001", { secret: true }]],
    folders: [["acct000001", { list: [
      { name: "INBOX", flags: [], delim: "/" },
      { name: "[Gmail]/All Mail", flags: ["\\All"], delim: "/" },
      { name: "Bin", flags: [], delim: "/" }
    ] }]],
    heads: [
      ["acct000001|[Gmail]/All Mail", { acct: "acct000001", folder: "[Gmail]/All Mail", uidv: 9, msgs: [
        msg(1, "Λέβητας", nikos), msg(50, "Archived note", nikos, { mid: "<only-all@x>" })] }],
      ["acct000001|INBOX", { acct: "acct000001", folder: "INBOX", uidv: 7, msgs: [
        msg(1, "Λέβητας", nikos), msg(2, "Your order", shop), msg(3, "Gone message", shop, { flags: ["\\Deleted"] }),
        msg(4, "", shop, { mid: "" })] }],
      ["acct000001|Bin", { acct: "acct000001", folder: "Bin", uidv: 7, msgs: [msg(9, "Trashed order", shop)] }],
      ["acctgone01|INBOX", { acct: "acctgone01", folder: "INBOX", uidv: 1, msgs: [msg(1, "Old account order", shop)] }]
    ],
    bodies: [
      ["acct000001|INBOX|7|1", { raw: RAW_TEXT, at: 1, size: RAW_TEXT.length }],
      ["acct000001|INBOX|7|2", { raw: RAW_HTML, at: 1, size: RAW_HTML.length }]
    ]
  } });
}

test("mail: stored messages, bodies decoded with mime.js, trash/deleted/gone skipped", async () => {
  const prevM = globalThis.orosMailMime;
  globalThis.orosMailMime = require(path.join(ROOT, "mail", "mime.js"));
  try {
    const st = mailStore(), idb = mailIDB();
    await withIDB(idb, async () => {
      const body = await run("mail", st, "σερβις");
      assert.deepEqual(body.map((h) => h.id), ["acct000001|INBOX|1"]);   // INBOX copy, not All Mail
      assert.equal(body[0].title, "Λέβητας");
      assert.ok(body[0].text.startsWith("Νίκος · nikos@example.com · Ο τεχνικός"));
      assert.deepEqual(body[0].target, { acct: "acct000001", folder: "INBOX", uid: 1 });
      assert.equal(body[0].when, 1001);

      const html = await run("mail", st, "4711 shipped");
      assert.deepEqual(html.map((h) => h.id), ["acct000001|INBOX|2"]);
      assert.ok(html[0].text.includes("Order 4711 shipped"));
      assert.ok(!/color|alert|</.test(html[0].text));

      const order = await run("mail", st, "order");
      assert.deepEqual(order.map((h) => h.id), ["acct000001|INBOX|2"]);  // Bin, gone account skipped
      assert.deepEqual(await run("mail", st, "gone"), []);                // \Deleted
      assert.deepEqual((await run("mail", st, "archived")).map((h) => h.id), ["acct000001|[Gmail]/All Mail|50"]);
      assert.equal((await run("mail", st, "no subject")).length, 1);
      assert.equal((await run("mail", st, "nikos@example")).length, 2);
    });
  } finally {
    if (prevM === undefined) delete globalThis.orosMailMime; else globalThis.orosMailMime = prevM;
  }
});

test("mail: without mime.js still finds subjects and senders; no accounts → nothing", async () => {
  const prevM = globalThis.orosMailMime;
  delete globalThis.orosMailMime;
  try {
    const st = mailStore();
    await withIDB(mailIDB(), async () => {
      assert.deepEqual((await run("mail", st, "λεβητας")).map((h) => h.id), ["acct000001|INBOX|1"]);
    });
    const empty = fakeIDB({});
    await withIDB(empty, async () => {
      assert.deepEqual(await run("mail", st, "order"), []);
    });
    assert.deepEqual(empty.log.created, []);
    assert.deepEqual(await P("mail").search(ctxFor(store({}), "order")), []);
  } finally {
    if (prevM !== undefined) globalThis.orosMailMime = prevM;
  }
});

test("mail: plain() drops style/script, keeps text", () => {
  assert.equal(P("mail").plain("<style>p{}</style><p>Hello&nbsp;<b>there</b></p><script>x()</script>"), "Hello there");
});
