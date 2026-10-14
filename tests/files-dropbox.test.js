// Files: the whole Dropbox next to the disk (files/dropbox-core.js).
// Pure helpers: header escaping, OAuth URL, token answers, paths,
// listing rows, the orOS sync folder guard, sorting, error words and
// Dropbox's content_hash.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const C = require("../files/dropbox-core.js");

test("app key: shape check; sync's App-folder key is never reused", () => {
  assert.equal(C.validKey("abc123def4"), true);
  assert.equal(C.validKey("ABC123def4"), false);
  assert.equal(C.validKey("short"), false);
  assert.equal(C.validKey("a".repeat(33)), false);
  assert.equal(C.validKey("abc-123-def"), false);
  assert.notEqual(C.APP_KEY, "wnohlxz79ie8w3e");
  assert.ok(C.validKey(C.APP_KEY));
});

test("Dropbox-API-Arg: non-ASCII escaped, JSON still parses to the same path", () => {
  const arg = C.headerArg({ path: "/Έγγραφα/σημείωση.txt" });
  assert.match(arg, /^[\x20-\x7e]+$/);
  assert.deepEqual(JSON.parse(arg), { path: "/Έγγραφα/σημείωση.txt" });
  assert.equal(C.headerArg({ path: "/a b" }), '{"path":"/a b"}');
});

test("authorize URL: PKCE S256, offline token, no secret", () => {
  const u = new URL(C.authorizeUrl({ key: "abc123def4", redirect: "https://useoros.online/files/dropbox-callback.html", state: "st", challenge: "ch" }));
  assert.equal(u.origin + u.pathname, "https://www.dropbox.com/oauth2/authorize");
  assert.equal(u.searchParams.get("client_id"), "abc123def4");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("token_access_type"), "offline");
  assert.equal(u.searchParams.get("redirect_uri"), "https://useoros.online/files/dropbox-callback.html");
  assert.equal(u.searchParams.get("client_secret"), null);
});

test("token answer", () => {
  assert.equal(C.tokenOf(null, 0), null);
  assert.equal(C.tokenOf({ access_token: "" }, 0), null);
  const t = C.tokenOf({ access_token: "a", refresh_token: "r", expires_in: 14400 }, 1000);
  assert.deepEqual(t, { access: "a", refresh: "r", exp: 1000 + 14100 * 1000 });
  assert.equal(C.tokenOf({ access_token: "a", expires_in: 10 }, 0).exp, 60000);
  assert.equal(C.tokenOf({ access_token: "a" }, 0).refresh, "");
});

test("paths: root, normalisation, refusals, crumbs, parent", () => {
  assert.equal(C.normPath(""), "");
  assert.equal(C.normPath("/"), "");
  assert.equal(C.normPath("a/b/"), "/a/b");
  assert.equal(C.normPath("/a/../b"), null);
  assert.equal(C.normPath("/a//b"), null);
  assert.equal(C.normPath("/a/\u0000"), null);
  assert.equal(C.normPath(5), null);
  assert.deepEqual(C.crumbs(""), [{ name: "", path: "" }]);
  assert.deepEqual(C.crumbs("/Photos/2024"), [{ name: "", path: "" }, { name: "Photos", path: "/Photos" }, { name: "2024", path: "/Photos/2024" }]);
  assert.equal(C.parentPath("/Photos/2024"), "/Photos");
  assert.equal(C.parentPath("/Photos"), "");
});

test("listing rows: files, folders, junk dropped, names cleaned", () => {
  const rows = C.mapList([
    { ".tag": "folder", name: "Photos", path_display: "/Photos", path_lower: "/photos", id: "id:1" },
    { ".tag": "file", name: "a.txt", path_display: "/a.txt", path_lower: "/a.txt", size: 12, server_modified: "2026-10-01T10:00:00Z",
      rev: "015f1a2b3c4d", content_hash: "e".repeat(64) },
    { ".tag": "deleted", name: "gone", path_display: "/gone" },
    { ".tag": "file", name: "x", path_display: "/../x" },
    { ".tag": "file", name: "b\u0007ad.txt", path_display: "/bad.txt", is_downloadable: false },
    null, "str"
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { name: "Photos", path: "/Photos", lower: "/photos", dir: true });
  assert.equal(rows[1].size, 12);
  assert.equal(rows[1].mtime, Date.parse("2026-10-01T10:00:00Z"));
  assert.equal(rows[1].rev, "015f1a2b3c4d");
  assert.equal(rows[1].hash, "e".repeat(64));
  assert.equal(rows[1].dl, true);
  assert.equal(rows[2].name, "bad.txt");     // the name follows the path
  assert.equal(rows[2].dl, false);
  assert.deepEqual(C.mapList(undefined), []);
});

test("orOS sync's own folder is recognised and stays hidden", () => {
  const sync = C.mapList([
    { ".tag": "file", name: "orOS-data.json", path_display: "/Apps/orOS/orOS-data.json" },
    { ".tag": "folder", name: "vault", path_display: "/Apps/orOS/vault" }
  ]);
  assert.equal(C.isSyncFolder(sync), true);
  const backups = C.mapList([
    { ".tag": "file", name: "orOS-backup-2026-10-01T10-00-00-000Z.json", path_display: "/Apps/orOS/orOS-backup-2026-10-01T10-00-00-000Z.json" },
    { ".tag": "folder", name: "vault", path_display: "/Apps/orOS/vault" }
  ]);
  assert.equal(C.isSyncFolder(backups), true);
  assert.equal(C.isSyncFolder(C.mapList([{ ".tag": "folder", name: "vault", path_display: "/vault" }])), false);
  assert.equal(C.isUnder("/Apps/orOS/vault/objects", ["/apps/oros"]), true);
  assert.equal(C.isUnder("/APPS/OROS", ["/apps/oros"]), true);
  assert.equal(C.isUnder("/Apps/orOS-other", ["/apps/oros"]), false);
  assert.equal(C.isUnder("/x", []), false);
});

test("sorting: folders first, then by field, stable by name", () => {
  const rows = [
    { name: "b.txt", dir: false, size: 5, mtime: 2 },
    { name: "Z", dir: true },
    { name: "a.txt", dir: false, size: 9, mtime: 1 },
    { name: "a", dir: true }
  ];
  assert.deepEqual(C.sortRows(rows, "name", true, "en").map((r) => r.name), ["a", "Z", "a.txt", "b.txt"]);
  assert.deepEqual(C.sortRows(rows, "size", false, "en").map((r) => r.name), ["Z", "a", "a.txt", "b.txt"]);
  assert.deepEqual(C.sortRows(rows, "date", true, "en").map((r) => r.name), ["a", "Z", "a.txt", "b.txt"]);
});

test("error words", () => {
  assert.equal(C.errorKind(401, { error_summary: "expired_access_token/" }), "expired");
  assert.equal(C.errorKind(401, { error_summary: "missing_scope/.." }), "scope");
  assert.equal(C.errorKind(401, { error_summary: "invalid_access_token/" }), "auth");
  assert.equal(C.errorKind(401, null), "auth");
  assert.equal(C.errorKind(409, { error_summary: "path/not_found/.." }), "notfound");
  assert.equal(C.errorKind(409, { error_summary: "path/conflict/file/" }), "conflict");
  assert.equal(C.errorKind(429, null), "busy");
  assert.equal(C.errorKind(500, null), "net");
});

test("content_hash matches Dropbox's algorithm (4 MB blocks)", async () => {
  const digest = (b) => Promise.resolve(crypto.createHash("sha256").update(b).digest());
  const ref = (buf) => {
    const parts = [];
    for (let o = 0; o < buf.length; o += 4 * 1024 * 1024) parts.push(crypto.createHash("sha256").update(buf.subarray(o, o + 4 * 1024 * 1024)).digest());
    return crypto.createHash("sha256").update(Buffer.concat(parts)).digest("hex");
  };
  assert.equal(await C.contentHash(new Uint8Array(0), digest), crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
  const small = new Uint8Array(Buffer.from("hello"));
  assert.equal(await C.contentHash(small, digest), ref(Buffer.from(small)));
  const big = new Uint8Array(9 * 1024 * 1024 + 7);
  for (let i = 0; i < big.length; i += 4096) big[i] = i & 255;
  assert.equal(await C.contentHash(big, digest), ref(Buffer.from(big)));
});

// ---------- Wave 2: copy / move into the orOS disk ----------

test("disk-safe names", () => {
  assert.equal(C.localName("a:b?.txt"), "a_b_.txt");
  assert.equal(C.localName('x<y>z|"*\\'), "x_y_z____");
  assert.equal(C.localName(".."), "_");
  assert.equal(C.localName(""), "_");
  assert.equal(C.localName("Έγγραφο.pdf"), "Έγγραφο.pdf");
});

const row = (path, o) => Object.assign({ name: path.split("/").pop(), path, lower: path.toLowerCase(), dir: false, size: 10, rev: "0123456789a", hash: "a".repeat(64), dl: true }, o || {});

test("plan: files, folders with their subfolders, never sync's folder", () => {
  const photos = row("/Photos", { dir: true });
  const listings = {
    "/Photos": [
      row("/Photos", { dir: true }),
      row("/Photos/2024", { dir: true }),
      row("/Photos/2024/b.jpg"),
      row("/Photos/a:1.jpg"),
      row("/Photos/doc", { dl: false })
    ]
  };
  const p = C.planItems([row("/note.txt"), photos, row("/Apps/orOS/orOS-data.json")], listings, ["/apps/oros"]);
  assert.deepEqual(p.items.map((i) => i.rel), ["note.txt", "Photos/2024/b.jpg", "Photos/a_1.jpg"]);
  assert.deepEqual(p.items[1], { src: "/Photos/2024/b.jpg", rev: "0123456789a", hash: "a".repeat(64), size: 10, rel: "Photos/2024/b.jpg" });
  assert.equal(p.bytes, 30);
  assert.deepEqual(p.skipped.map((s) => s.why).sort(), ["nodl", "sync"]);
  // a selected sync folder (or one inside it) brings nothing
  assert.equal(C.planItems([row("/Apps/orOS", { dir: true })], { "/Apps/orOS": [row("/Apps/orOS/x")] }, ["/apps/oros"]).items.length, 0);
  // the same file twice (selected and inside a selected folder) goes once
  assert.equal(C.planItems([row("/Photos/a:1.jpg"), photos], listings, []).items.length, 2);
});

test("plan: limits per file, per count and per size", () => {
  const big = C.planItems([row("/big", { size: C.MAX_FILE + 1 })], {}, []);
  assert.equal(big.items.length, 0);
  assert.equal(big.skipped[0].why, "big");
  const many = [];
  for (let i = 0; i < C.MAX_FILES + 2; i++) many.push(row("/f" + i, { size: 1 }));
  const m = C.planItems(many, {}, []);
  assert.equal(m.items.length, C.MAX_FILES);
  assert.equal(m.skipped.length, 2);
  const heavy = [];
  for (let i = 0; i < 5; i++) heavy.push(row("/h" + i, { size: 250 * 1024 * 1024 }));
  const h = C.planItems(heavy, {}, []);
  assert.equal(h.items.length, 4);
  assert.equal(h.skipped[0].why, "total");
});

test("an original is removed only for a confirmed encrypted copy", () => {
  const it = { src: "/a", rev: "0123456789a", dst: "/internal/a", h: "f".repeat(64) };
  assert.equal(C.confirmedCopy(it, { h: "f".repeat(64), s: 1 }, false), true);
  assert.equal(C.confirmedCopy(it, { h: "f".repeat(64) }, true), false);      // still queued
  assert.equal(C.confirmedCopy(it, { h: "e".repeat(64) }, false), false);     // other content
  assert.equal(C.confirmedCopy(it, null, false), false);                      // not in the manifest
  assert.equal(C.confirmedCopy({ src: "/a", dst: "/internal/a" }, { h: undefined }, false), false);
  assert.equal(C.confirmedCopy(Object.assign({}, it, { dst: "" }), { h: it.h }, false), false);
});

test("unique names never overwrite", () => {
  assert.equal(C.uniqueName("a.txt", []), "a.txt");
  assert.equal(C.uniqueName("a.txt", ["a.txt", "a (1).txt"]), "a (2).txt");
  assert.equal(C.uniqueName("noext", ["noext"]), "noext (1)");
});
