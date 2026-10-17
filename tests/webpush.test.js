// Notifications with orOS closed, the device side (webpush.js): RFC 8291
// encryption checked by an independent decrypt, Calendar reminder rows,
// the synced device list merge, and phone.js reminderRows' longer horizon.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../webpush.js");
const Phone = require("../phone.js");
const OCC = require("../calendar/occur.js");
const fs = require("fs");
const path = require("path");

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
const enc = (s) => new TextEncoder().encode(s);
// The receiving browser's side of RFC 8291, written from the RFC.
async function decrypt(b64, uaKeys, auth) {
  const buf = Buffer.from(b64, "base64url");
  const salt = buf.subarray(0, 16), rs = buf.readUInt32BE(16), idlen = buf[20];
  const asPub = buf.subarray(21, 21 + idlen), ct = buf.subarray(21 + idlen);
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", uaKeys.publicKey));
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaKeys.privateKey, 256));
  const prkKey = await hmac(auth, ecdh);
  const ikm = await hmac(prkKey, Buffer.concat([enc("WebPush: info\0"), uaPub, asPub, Buffer.from([1])]));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, Buffer.concat([enc("Content-Encoding: aes128gcm\0"), Buffer.from([1])]))).slice(0, 16);
  const nonce = (await hmac(prk, Buffer.concat([enc("Content-Encoding: nonce\0"), Buffer.from([1])]))).slice(0, 12);
  const k = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, k, ct));
  assert.equal(plain[plain.length - 1], 2, "last record delimiter");
  return new TextDecoder().decode(plain.subarray(0, plain.length - 1));
}

test("encrypt: aes128gcm the receiving browser can open, fresh salt and key each time", async () => {
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = Buffer.from(await crypto.subtle.exportKey("raw", ua.publicKey)).toString("base64url");
  const authB = Buffer.from(auth).toString("base64url");
  const msg = W.payload({ id: "time:alarm-a1-2026-10-17", at: 1, ns: "time", kind: "alarm", title: "Ξυπνητήρι", body: "Πρωί ☀", link: "time:alarms" });
  const a = await W.encrypt(msg, p256dh, authB), b = await W.encrypt(msg, p256dh, authB);
  assert.notEqual(a, b);
  assert.equal(await decrypt(a, ua, auth), msg);
  assert.deepEqual(JSON.parse(await decrypt(b, ua, auth)).title, "Ξυπνητήρι");
  // a long reminder still fits the relay's packet limit (4096 base64url chars)
  const big = W.payload({ id: "x".repeat(300), at: 1, ns: "todo", kind: "note", title: "Τ".repeat(500), body: "Β".repeat(900), link: "l".repeat(400) });
  assert.ok((await W.encrypt(big, p256dh, authB)).length <= 4096);
});

test("rowKey: opaque, stable, different per device", async () => {
  const t1 = "a".repeat(43), t2 = "b".repeat(43);
  const k = await W.rowKey(t1, "calendar:rem:ev1:2026-10-20");
  assert.match(k, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(k, await W.rowKey(t1, "calendar:rem:ev1:2026-10-20"));
  assert.notEqual(k, await W.rowKey(t2, "calendar:rem:ev1:2026-10-20"));
  assert.ok(!k.includes("ev1"));
});

test("calendarRows: remindMin before each occurrence inside the week, same keys as the shell", () => {
  const now = new Date(2026, 9, 17, 10, 0).getTime(), end = now + 7 * 86400000;
  const data = { events: [
    { id: "ev1", title: "Dentist", date: "2026-10-18", start: "09:30", remindMin: 30 },
    { id: "ev2", title: "Gym", date: "2026-10-01", start: "18:00", remindMin: 15, recur: { freq: "W", interval: 1 } },
    { id: "ev3", title: "No reminder", date: "2026-10-18", start: "09:00" },
    { id: "ev4", title: "Past", date: "2026-10-16", start: "09:00", remindMin: 10 },
    { id: "ev5", title: "Far", date: "2026-11-30", start: "09:00", remindMin: 10 }
  ] };
  const rows = W.calendarRows(data, OCC, now, end, "en");
  const d = rows.find((r) => r.id === "calendar:rem:ev1:2026-10-18");
  assert.ok(d);
  assert.equal(d.at, new Date(2026, 9, 18, 9, 0).getTime());
  assert.equal(d.link, "calendar:ev1:2026-10-18");
  assert.equal(d.ns, "calendar");
  const gym = rows.filter((r) => r.id.startsWith("calendar:rem:ev2:"));
  assert.equal(gym.length, 1);                                   // 2026-10-22 only (weekly from Thu 1 Oct)
  assert.equal(gym[0].id, "calendar:rem:ev2:2026-10-22");
  assert.ok(!rows.some((r) => /ev3|ev4|ev5/.test(r.id)));
  assert.deepEqual(W.calendarRows(null, OCC, now, end, "en"), []);
});

test("device list: merge is the same both ways, newer wins, off stays off", () => {
  const dev = (m, extra) => Object.assign({ tok: "t".repeat(43), ep: "https://fcm.googleapis.com/fcm/send/x", k1: "p", k2: "a", n: "Chrome · Linux", m }, extra || {});
  const A = { v: 1, d: { AAAAAAAAAAAAAAAAAAAAAA: dev(10), BBBBBBBBBBBBBBBBBBBBBB: dev(5) } };
  const B = { v: 1, d: { AAAAAAAAAAAAAAAAAAAAAA: { m: 20, x: true }, CCCCCCCCCCCCCCCCCCCCCC: dev(7), "bad id": dev(1) } };
  const ab = W.mergeLists(A, B), ba = W.mergeLists(B, A);
  assert.deepEqual(ab, ba);
  assert.equal(ab.d.AAAAAAAAAAAAAAAAAAAAAA.x, true);
  assert.equal(ab.d["bad id"], undefined);
  assert.deepEqual(W.liveDevices(ab).map((d) => d.id).sort(), ["BBBBBBBBBBBBBBBBBBBBBB", "CCCCCCCCCCCCCCCCCCCCCC"]);
  // same m: the tie is settled the same way on both sides
  const t1 = { v: 1, d: { DDDDDDDDDDDDDDDDDDDDDD: dev(9, { n: "one" }) } }, t2 = { v: 1, d: { DDDDDDDDDDDDDDDDDDDDDD: dev(9, { n: "two" }) } };
  assert.deepEqual(W.mergeLists(t1, t2), W.mergeLists(t2, t1));
  // junk never survives
  assert.deepEqual(W.cleanList({ d: { EEEEEEEEEEEEEEEEEEEEEE: { m: 1, tok: "short", ep: "x", k1: "p", k2: "a" } } }).d, {});
});

test("phone reminderRows: a week when asked, the two days as before otherwise", () => {
  const now = new Date(2026, 9, 17, 10, 0).getTime();
  const src = { lang: "en", alarms: [{ id: "a1", at: now + 3600000, label: "Up", repeat: "daily", state: "pending" }] };
  assert.equal(Phone.reminderRows(src, now).length, 2);
  assert.equal(Phone.reminderRows(Object.assign({ hours: 168 }, src), now).length, 7);
  assert.equal(Phone.reminderRows(Object.assign({ hours: 168, max: 3 }, src), now).length, 3);
});

test("Android app: Calendar reminders ring natively only while events are not copied to the phone's Calendar", () => {
  const ph = fs.readFileSync(path.join(__dirname, "..", "phone.js"), "utf8");
  assert.ok(/concat\(calendarReminders\(now\)\)/.test(ph), "the reminders snapshot includes Calendar");
  assert.ok(/prefs\(\)\.calendar && appState && appState\.calendar === "granted"\) return \[\]/.test(ph), "skipped when the phone's Calendar rings them");
  assert.ok(/localStorage\.getItem\("oros-calendar-data"\)/.test(ph.slice(ph.indexOf("function pushReminders"))), "a Calendar change re-sends the reminders");
  const wp = fs.readFileSync(path.join(__dirname, "..", "webpush.js"), "utf8");
  assert.ok(/root\.orosPush = \{\s*calendarRows: calendarRows/.test(wp), "webpush.js shares calendarRows");
});
