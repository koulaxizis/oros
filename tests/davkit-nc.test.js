// CalDAV wave 6: davkit.ncLogin, the Nextcloud Login Flow v2 for the
// CalDAV / CardDAV account (the same flow as sync.js connectNextcloud),
// against tests/dav-fake.js with the two login calls in front of it.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../davkit.js");
const { fakeDav } = require("./dav-fake.js");

const json = (status, body) => ({ status, ok: status === 200, url: "", headers: new Headers({}),
  text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)) });

// A Nextcloud at https://dav.test: login/v2, its poll (approved after
// `after` polls), the app password delete, the rest is the fake server.
function nextcloud(o) {
  o = o || {};
  const S = fakeDav();
  const st = { polls: 0, deleted: [], seen: [] };
  const fetch = (url, init) => {
    init = init || {};
    const h = new Headers(init.headers || {});
    const target = h.get("X-Oros-Target") || url;
    st.seen.push(init.method + " " + url);
    const path = new URL(target).pathname;
    if (path === "/index.php/login/v2") {
      if (o.notNc) return Promise.resolve(json(404, "Not found"));
      return Promise.resolve(json(200, { login: "https://dav.test/login/v2/flow/abc",
        poll: { token: "tok", endpoint: o.otherHost ? "https://evil.test/poll" : "https://dav.test/index.php/login/v2/poll" } }));
    }
    if (path === "/index.php/login/v2/poll") {
      assert.equal(init.body, "token=tok");
      if (++st.polls <= (o.after || 0)) return Promise.resolve(json(404, ""));
      return Promise.resolve(json(200, { server: "https://dav.test", loginName: "u", appPassword: o.badPass ? "x" : "p" }));
    }
    if (path === "/ocs/v2.php/core/apppassword") {
      st.deleted.push(h.get("Authorization"));
      return Promise.resolve(json(200, ""));
    }
    if (h.get("X-Oros-Target")) {
      const i = Object.assign({}, init, { headers: Object.assign({}, init.headers) });
      delete i.headers["X-Oros-Target"];
      return S.fetch(target, i);
    }
    return S.fetch(url, init);
  };
  return { S, st, fetch };
}
const fast = { every: 1, wait: () => Promise.resolve() };

test("Nextcloud sign-in: the server's page opens, the app password connects, nothing else is asked", async () => {
  const N = nextcloud({ after: 2 });
  const store = D.memStore();
  const opened = [];
  const acc = await D.ncLogin({ url: "https://dav.test/remote.php/dav/files/u/" }, (u) => opened.push(u), N.fetch,
    Object.assign({ store }, fast));
  assert.deepEqual(opened, ["https://dav.test/login/v2/flow/abc"]);
  assert.equal(N.st.polls, 3, "polled until approved");
  assert.equal(acc.conf.user, "u");
  assert.equal(acc.conf.url, "https://dav.test/remote.php/dav/");
  assert.ok(acc.cols.length > 0);
  const saved = D.load(store);
  assert.equal(saved.pass, "p", "the app password, typed by nobody");
  assert.deepEqual(N.st.deleted, []);
});

test("Nextcloud sign-in through the relay: every call goes to the relay with the target", async () => {
  const N = nextcloud();
  const acc = await D.ncLogin({ url: "https://dav.test", relay: true }, () => {}, N.fetch,
    Object.assign({ store: D.memStore() }, fast));
  assert.equal(acc.conf.relay, true);
  assert.ok(N.st.seen.every((l) => l.endsWith(" " + D.RELAY)), "only the relay was called");
});

test("Nextcloud sign-in refuses: not a Nextcloud, a poll on another host, expired, cancelled; a failed connect removes the app password", async () => {
  const run = (o, form, opts) => {
    const N = nextcloud(o);
    return { N, p: D.ncLogin(form || { url: "https://dav.test" }, () => {}, N.fetch, Object.assign({ store: D.memStore() }, fast, opts)) };
  };
  await assert.rejects(run({ notNc: true }).p, /cd-notnc/);
  await assert.rejects(run({ otherHost: true }).p, /cd-notnc/);
  await assert.rejects(run({ after: 1e9 }, null, { limit: 1, wait: () => new Promise((r) => setTimeout(r, 5)) }).p, /cd-login-expired/);
  const c = run({ after: 1e9 }, null, { wait: () => new Promise((r) => setTimeout(r, 5)) });
  setTimeout(D.ncCancel, 20);
  await assert.rejects(c.p, /cd-cancelled/);
  const b = run({ badPass: true });
  await assert.rejects(b.p, /cd-auth/);
  assert.equal(b.N.st.deleted.length, 1, "the unused app password was removed");
  await assert.rejects(D.ncLogin({ url: "http://cloud.example.com" }, () => {}, () => {}), /cd-url/);
});
