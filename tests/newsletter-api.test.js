// Newsletter phase 3C (app side): sending through a provider's HTTP API
// and reading its bounces, complaints and unsubscribes. The payloads are
// checked against the relay's own allowlist (relay/papi.js), and the
// engine in its sandbox talks to the real relay code with the provider
// mocked behind it. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../newsletter/core.js");
const R = require("../newsletter/render.js");
const M = require("../mail/compose.js");
const { sandbox } = require("./newsletter-sandbox.js");

let handle, P;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  P = await import("../relay/papi.js");
});

const LIST = { id: "list-1", m: 1, name: "Φίλοι", chan: "chan-1", from: "me@example.com", fromName: "Χρήστος", reply: "", lang: "en",
  addr: "1 Main St, Athens", why: "You signed up on my site.", theme: "classic", color: "#2f6fde", salt: "abcdefgh12" };
const API = { id: "chan-1", m: 1, name: "", kind: "smtp", preset: "postmark", via: "api", host: "smtp.postmarkapp.com", user: "x", rate: 1, cap: 300 };
const KEY = "pm-SECRET-123";
function sub(email, extra) {
  return Object.assign({ id: C.subId("list-1", email), m: 5, list: "list-1", email, name: "", tags: [], src: "manual",
    basis: "consent", at: 10, conf: 10, off: 0 }, extra || {});
}
function issue(id, extra) {
  return Object.assign({ id, m: 3, list: "list-1", subj: "Hello {first|friend}", pre: "News", fmt: "blocks",
    blocks: [{ k: "h", t: "Hi" }, { k: "p", t: "Some news." }], tags: [], st: "draft" }, extra || {});
}
function model(o, chan) {
  return C.normalize(Object.assign({ chans: [Object.assign({}, API, chan || {})], lists: [LIST], subs: [], issues: [] }, o || {}));
}
const ORIGIN = "https://useoros.online";
let ip = 0;
// The sandbox's fetch → the real relay; the provider behind it → prov(url, init)
function wire(S, prov) {
  const calls = [];
  const env = { ALLOWED_ORIGINS: ORIGIN };
  const provFetch = async (url, init) => { calls.push({ url, init, json: typeof init.body === "string" ? JSON.parse(init.body) : null }); return prov(url, init, calls.length); };
  S.ctx.fetch = async (url, o) => {
    const body = JSON.parse(o.body);
    S.relayLog.push(body.op);
    if (body.op !== "papi") return { json: async () => ({ ok: true, data: body.op === "search" ? { msgs: [] } : {} }) };
    const r = new Request(url, { method: "POST", body: o.body, headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.7.0." + (ip++ % 250) } });
    const res = await handle(r, env, null, Date.now(), provFetch);
    const text = await res.text();
    return { json: async () => JSON.parse(text) };
  };
  return calls;
}
const ok = () => new Response("{\"ErrorCode\":0,\"Message\":\"OK\"}", { status: 200 });

test("account: the API is offered for five providers, Mailgun keeps its domain", () => {
  const ch = C.normChan(Object.assign({}, API));
  assert.equal(ch.via, "api");
  assert.ok(C.isApi(ch));
  assert.equal(C.normChan(Object.assign({}, API, { preset: "gmail" })).via, "smtp");
  assert.equal(C.normChan(Object.assign({}, API, { kind: "mail", acct: "acct01" })).via, "smtp");
  const mg = C.normChan(Object.assign({}, API, { preset: "mailgun-eu", dom: " MG.Example.com " }));
  assert.equal(mg.dom, "mg.example.com");
  assert.equal(C.normChan(Object.assign({}, API, { preset: "mailgun", dom: "localhost" })).dom, "");
  assert.equal(C.normChan(Object.assign({}, API, { dom: "mg.example.com" })).dom, "", "only Mailgun has a domain");
});

test("payloads: one built message in each provider's format, all inside the relay's allowlist", () => {
  const o = { from: { name: "Χρήστος", addr: "me@example.com" }, to: { name: "Άννα", addr: "a@x.gr" }, reply: "box@example.com",
              subject: "Γεια σου Άννα", text: "Hi", html: "<p>Hi <img src=\"cid:pic.png@oros\"></p>",
              inline: [{ cid: "pic.png@oros", type: "image/png", bin: "\x89PNG" }],
              listId: "list-1", listName: "Φίλοι", unsub: "mailto:box@example.com?subject=unsubscribe%20nl-x",
              unsubWeb: "https://relay.example/nl/u/k/t", tag: "iss-1" };
  const pm = R.apiReq(M, "postmark", "", o);
  assert.equal(pm.path, "/email");
  const pj = JSON.parse(pm.body);
  assert.equal(pj.MessageStream, "broadcast");
  assert.equal(pj.Subject, "Γεια σου Άννα");
  assert.equal(pj.To, "\"Άννα\" <a@x.gr>");
  assert.equal(JSON.parse(R.apiReq(M, "postmark", "", Object.assign({}, o, { to: { name: "A \"B\"", addr: "a@x.gr" } })).body).To, "\"A B\" <a@x.gr>");
  assert.equal(pj.ReplyTo, "box@example.com");
  assert.deepEqual(pj.Headers.map((h) => h.Name), ["List-Id", "List-Unsubscribe", "List-Unsubscribe-Post", "X-Oros-Newsletter"]);
  assert.match(pj.Headers[1].Value, /^<https:\/\/relay\.example\/nl\/u\/k\/t>, <mailto:/);
  assert.deepEqual(pj.Attachments[0], { Name: "pic.png", Content: btoa("\x89PNG"), ContentType: "image/png", ContentID: "cid:pic.png@oros" });
  const sg = JSON.parse(R.apiReq(M, "sendgrid", "", o).body);
  assert.deepEqual(sg.personalizations, [{ to: [{ email: "a@x.gr", name: "Άννα" }] }]);
  assert.deepEqual(sg.content.map((c) => c.type), ["text/plain", "text/html"]);
  assert.equal(sg.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal(sg.attachments[0].content_id, "pic.png@oros");
  assert.equal(sg.attachments[0].disposition, "inline");
  const br = JSON.parse(R.apiReq(M, "brevo", "", o).body);
  assert.deepEqual(br.sender, { email: "me@example.com", name: "Χρήστος" });
  assert.equal(br.htmlContent, o.html);
  assert.equal(typeof br.headers["List-Id"], "string");
  const mg = R.apiReq(M, "mailgun", "mg.example.com", o);
  assert.equal(mg.path, "/mg.example.com/messages.mime");
  const mime = Buffer.from(mg.mime, "base64").toString("latin1");
  assert.match(mime, /List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n/);
  assert.match(mime, /Content-ID: <pic\.png@oros>/i);
  // the relay accepts every one of them, with nothing but ASCII in headers
  for (const [prov, req, dom] of [["postmark", pm], ["sendgrid", R.apiReq(M, "sendgrid", "", o)], ["brevo", R.apiReq(M, "brevo", "", o)], ["mailgun", mg, "mg.example.com"]]) {
    assert.equal(P.validPapi({ prov, key: KEY, dom, reqs: [req] }), "", prov);
  }
  for (const h of R.listHeaders(M, o)) assert.match(h[1], /^[\x20-\x7e]+$/);
});

test("answers: sent, refused address, bad key, slow down, try later, refused message", () => {
  const out = (prov, status, body, err) => C.apiOutcome(prov, err ? { err } : { status, body: JSON.stringify(body) }).k;
  assert.equal(out("postmark", 200, { ErrorCode: 0, Message: "OK" }), "ok");
  assert.equal(out("postmark", 422, { ErrorCode: 406, Message: "inactive recipient" }), "refused");
  assert.equal(out("postmark", 422, { ErrorCode: 300, Message: "Invalid email" }), "refused");
  assert.equal(out("postmark", 422, { ErrorCode: 412, Message: "trial" }), "no");
  assert.equal(out("sendgrid", 202, ""), "ok");
  assert.equal(out("sendgrid", 400, { errors: [{ field: "personalizations.0.to.0.email", message: "Does not contain a valid address." }] }), "refused");
  assert.equal(out("sendgrid", 400, { errors: [{ field: "from.email", message: "bad from" }] }), "no");
  assert.equal(out("brevo", 201, { messageId: "<x@y>" }), "ok");
  assert.equal(out("brevo", 400, { code: "invalid_parameter", message: "email is not valid in to" }), "refused");
  assert.equal(out("mailgun", 200, { id: "<x>", message: "Queued. Thank you." }), "ok");
  assert.equal(out("mailgun", 401, "Forbidden"), "auth");
  assert.equal(out("brevo", 429, {}), "rate");
  assert.equal(out("brevo", 503, {}), "retry");
  assert.equal(out("brevo", 0, null, "timeout"), "retry");
  const no = C.apiOutcome("postmark", { status: 422, body: "{\"ErrorCode\":412,\"Message\":\"Sender not confirmed\"}" });
  assert.equal(no.msg, "HTTP 422 Sender not confirmed");
});

test("events: each provider's documented answers → bounce, spam, off; soft ones are left out", () => {
  const ev = (prov, k, body) => C.apiEvents(prov, k, JSON.stringify(body)).map((e) => [e.addr, e.ev, e.at > 0]);
  assert.deepEqual(ev("brevo", "hardBounces", { events: [{ email: "A@x.gr", date: "2026-10-12T10:00:00.000+02:00", event: "hardBounces" }] }),
                   [["A@x.gr", "bounce", true]]);
  assert.deepEqual(ev("brevo", "spam", { events: [{ email: "b@x.gr", date: "2026-10-12T10:00:00Z" }] }), [["b@x.gr", "spam", true]]);
  assert.deepEqual(ev("postmark", "bounces", { TotalCount: 3, Bounces: [
    { Type: "HardBounce", Email: "a@x.gr", BouncedAt: "2026-10-12T10:00:00Z" },
    { Type: "SoftBounce", Email: "s@x.gr", BouncedAt: "2026-10-12T10:00:00Z" },
    { Type: "SpamComplaint", Email: "c@x.gr", BouncedAt: "2026-10-12T10:00:00Z" }] }),
    [["a@x.gr", "bounce", true], ["c@x.gr", "spam", true]]);
  assert.deepEqual(ev("sendgrid", "unsubscribes", [{ created: 1760000000, email: "u@x.gr" }]), [["u@x.gr", "off", true]]);
  assert.deepEqual(ev("mailgun", "bounces", { items: [{ address: "h@x.gr", code: "550", error: "No such user", created_at: "Mon, 12 Oct 2026 10:00:00 UTC" },
                                                       { address: "t@x.gr", code: "421", created_at: "Mon, 12 Oct 2026 10:00:00 UTC" }] }),
                   [["h@x.gr", "bounce", true]]);
  assert.deepEqual(ev("mailgun", "complaints", { items: [{ address: "c@x.gr", created_at: "x" }] }), [["c@x.gr", "spam", false]]);
  assert.deepEqual(C.apiEvents("brevo", "spam", "<html>"), []);
  assert.deepEqual(ev("sendgrid", "bounces", [{ email: "not an address" }]), []);
  // the reading requests stay inside the relay's allowlist
  const now = Date.UTC(2026, 9, 12), since = now - 7 * 864e5;
  for (const preset of ["brevo", "postmark", "sendgrid", "mailgun", "mailgun-eu"]) {
    const ch = C.normChan(Object.assign({}, API, { preset, dom: "mg.example.com" }));
    const reqs = C.apiEventReqs(ch, since, now);
    assert.equal(P.validPapi({ prov: preset, key: KEY, dom: ch.dom || undefined, reqs: reqs.map((r) => ({ m: r.m, path: r.path })) }), "", preset);
    assert.equal(P.validPapi({ prov: preset, key: KEY, dom: ch.dom || undefined, reqs: [C.apiCheckReq(ch)] }), "", preset + " check");
  }
});

test("pre-send check: Brevo's API refuses issues with pictures", () => {
  const d = model({ subs: [sub("a@x.gr")] }, { preset: "brevo" });
  const pic = C.normIssue(issue("iss-1", { blocks: [{ k: "img", f: "/internal/Newsletter/a.png", alt: "" }, { k: "p", t: "x" }] }));
  const ks = (x, ch) => C.preflight(d, x, { chan: ch, aud: 1 }).map((r) => r.k);
  assert.ok(ks(pic, d.chans[0]).includes("apiImg"));
  assert.ok(!ks(C.normIssue(issue("iss-1")), d.chans[0]).includes("apiImg"));
  assert.ok(!ks(pic, C.normChan(Object.assign({}, API))).includes("apiImg"), "Postmark carries pictures");
});

test("engine: 45 subscribers go in five relay calls of at most 10; a refused address bounces; the daily count adds up", async () => {
  const now = Date.now();
  const subs = Array.from({ length: 45 }, (_, i) => sub("p" + i + "@x.gr"));
  const S = await sandbox(model({ subs, issues: [issue("iss-1", { st: "sending", start: now, lock: { dev: "devaaa1", at: now } })] }));
  await S.E.savePass("chan-1", KEY);
  const calls = wire(S, (url, init) => {
    const j = JSON.parse(init.body);
    if (j.To === "p7@x.gr") return new Response("{\"ErrorCode\":406,\"Message\":\"inactive\"}", { status: 422 });
    return ok();
  });
  await S.run(30);
  assert.deepEqual(S.relayLog.filter((op) => op === "papi").length, 5);
  assert.equal(calls.length, 45);
  assert.equal(calls[0].url, "https://api.postmarkapp.com/email");
  assert.equal(calls[0].init.headers["X-Postmark-Server-Token"], KEY);
  assert.equal(calls[0].json.Subject, "Hello friend");
  const out = S.read();
  const x = out.issues.find((y) => y.id === "iss-1");
  assert.equal(x.st, "sent");
  assert.equal(x.n, 44);
  assert.equal(x.fail[C.subId("list-1", "p7@x.gr")], "refused");
  assert.equal(C.status(out.subs.find((s) => s.email === "p7@x.gr")), "bounce");
  assert.equal(Object.values(JSON.parse(S.localStorage.getItem("oros-newsletter-dev")).used)[0].n, 44);
});

test("engine: with only API accounts the 10-minute check runs once, then the issue goes", async () => {
  const now = Date.now();
  const S = await sandbox(model({ subs: [sub("a@x.gr")], issues: [issue("iss-1", { st: "sending", start: now, lock: { dev: "devaaa1", at: now } })] }));
  S.localStorage.setItem("oros-newsletter-dev", JSON.stringify({ dev: "devaaa1", used: {}, inbox: { at: 0 } }));
  await S.E.savePass("chan-1", KEY);
  const calls = wire(S, (url) => (/bounces/.test(url) ? new Response("{\"TotalCount\":0,\"Bounces\":[]}") : ok()));
  await S.run(12);
  assert.equal(S.read().issues[0].st, "sent");
  assert.deepEqual(calls.map((c) => c.url.replace(/\?.*/, "")), ["https://api.postmarkapp.com/bounces", "https://api.postmarkapp.com/email"]);
});

test("engine: a whole call failing at the relay retries with half the batch", async () => {
  const now = Date.now();
  const S = await sandbox(model({ subs: Array.from({ length: 10 }, (_, i) => sub("h" + i + "@x.gr")),
                                  issues: [issue("iss-1", { st: "sending", start: now, lock: { dev: "devaaa1", at: now } })] }));
  await S.E.savePass("chan-1", KEY);
  const calls = wire(S, ok);
  const real = S.ctx.fetch, sizes = [];
  S.ctx.fetch = async (url, o) => {
    const b = JSON.parse(o.body);
    if (b.op === "papi") { sizes.push(b.reqs.length); if (b.reqs.length > 5) return { json: async () => { throw new Error("error code: 1102"); } }; }
    return real(url, o);
  };
  await S.run(20);
  assert.deepEqual(sizes.slice(0, 3), [10, 5, 5]);
  assert.equal(S.read().issues[0].st, "sent");
  assert.equal(calls.length, 10);
});

test("engine: the daily limit caps a batch", async () => {
  const now = Date.now();
  const S = await sandbox(model({ subs: Array.from({ length: 10 }, (_, i) => sub("c" + i + "@x.gr")),
                                  issues: [issue("iss-1", { st: "sending", start: now, lock: { dev: "devaaa1", at: now } })] }, { cap: 3 }));
  await S.E.savePass("chan-1", KEY);
  const calls = wire(S, ok);
  await S.run(6);
  assert.equal(calls.length, 3);
  assert.equal(S.engine.state().k, "cap");
});

test("engine: a refused key pauses; a slow-down or a provider outage loses nothing", async () => {
  const now = Date.now();
  const mk = async () => {
    const S = await sandbox(model({ subs: [sub("a@x.gr"), sub("b@x.gr"), sub("c@x.gr")],
                                    issues: [issue("iss-1", { st: "sending", start: now, lock: { dev: "devaaa1", at: now } })] }));
    await S.E.savePass("chan-1", KEY);
    return S;
  };
  const A = await mk();
  wire(A, () => new Response("{\"ErrorCode\":10,\"Message\":\"Bad or missing Server API token.\"}", { status: 401 }));
  await A.run(8);
  const xa = A.read().issues[0];
  assert.equal(xa.st, "paused");
  assert.equal(xa.err, "apikey");
  // 503 for b@ only: a@ and c@ are sent, b@ waits for the next round
  const B = await mk();
  let down = true;
  const calls = wire(B, (url, init) => (JSON.parse(init.body).To === "b@x.gr" && down ? new Response("busy", { status: 503 }) : ok()));
  await B.run(8);
  let sent = B.read().sent["iss-1"] || [];
  assert.equal(sent.length, 2);
  assert.equal(B.read().issues[0].st, "sending");
  down = false;
  await B.run(10);
  assert.equal(B.read().issues[0].st, "sent");
  assert.ok(calls.filter((c) => c.json.To === "b@x.gr").length >= 2);
  // 429: nothing counted, nothing lost
  const Cc = await mk();
  wire(Cc, () => new Response("{}", { status: 429 }));
  await Cc.run(8);
  assert.equal(Cc.engine.state().k, "wait");
  assert.equal((Cc.read().sent["iss-1"] || []).length, 0);
  assert.equal(Cc.read().issues[0].st, "sending");
  // no key on this device
  const D = await sandbox(model({ subs: [sub("a@x.gr")], issues: [issue("iss-1", { st: "sending", start: now, lock: { dev: "devaaa1", at: now } })] }));
  wire(D, ok);
  await D.run(8);
  assert.equal(D.read().issues[0].err, "nopass");
});

test("engine: confirmation requests go through the API too", async () => {
  const S = await sandbox(model({ subs: [sub("new@x.gr", { basis: "optin", conf: 0, at: Date.now() - 1000 })] }, { preset: "sendgrid" }));
  await S.E.savePass("chan-1", KEY);
  const calls = wire(S, () => new Response("", { status: 202 }));
  await S.run(4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal(calls[0].json.personalizations[0].to[0].email, "new@x.gr");
  assert.ok(S.read().subs[0].inv > 0);
});

test("reading events: bounces, complaints and unsubscribes reach the right list; a later sign-up stands", async () => {
  const now = Date.now();
  const other = { id: "list-2", m: 1, name: "Other", chan: "chan-9", from: "me@example.com", lang: "en", addr: "x", salt: "abcdefgh13" };
  const S = await sandbox(C.normalize({
    chans: [Object.assign({}, API, { preset: "sendgrid" }), { id: "chan-9", m: 1, kind: "mail", acct: "acct01" }],
    lists: [LIST, other],
    subs: [sub("bad@x.gr"), sub("spam@x.gr"), sub("bye@x.gr"), sub("back@x.gr", { at: now, conf: now }),
           Object.assign(sub("bad@x.gr"), { id: C.subId("list-2", "bad@x.gr"), list: "list-2" })],
    issues: []
  }));
  await S.E.savePass("chan-1", KEY);
  const old = Math.floor((now - 864e5) / 1000);
  const calls = wire(S, (url) => {
    if (/bounces/.test(url)) return new Response(JSON.stringify([{ created: old, email: "BAD@x.gr", reason: "550", status: "5.1.1" },
                                                                 { created: old, email: "back@x.gr", reason: "550", status: "5.1.1" }]));
    if (/spam_reports/.test(url)) return new Response(JSON.stringify([{ created: old, email: "spam@x.gr", ip: "1.2.3.4" }]));
    return new Response(JSON.stringify([{ created: old, email: "bye@x.gr" }]));
  });
  const t = await S.engine.checkInbox();
  assert.equal(t.err, null);
  assert.equal(t.b, 1);
  assert.equal(t.u, 2);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /^https:\/\/api\.sendgrid\.com\/v3\/suppression\/bounces\?start_time=\d+&limit=500$/);
  const d = S.read();
  const st = (id) => C.status(d.subs.find((s) => s.id === id));
  assert.equal(st(C.subId("list-1", "bad@x.gr")), "bounce");
  assert.equal(st(C.subId("list-1", "spam@x.gr")), "spam");
  assert.equal(st(C.subId("list-1", "bye@x.gr")), "off");
  assert.equal(st(C.subId("list-1", "back@x.gr")), "on", "signed up again after the bounce");
  assert.equal(st(C.subId("list-2", "bad@x.gr")), "on", "another account's list");
  const dev = JSON.parse(S.localStorage.getItem("oros-newsletter-dev"));
  assert.ok(dev.papi["chan-1"] >= now);
  // a refused key is reported; no key on the device is not an error
  wire(S, () => new Response("{}", { status: 401 }));
  assert.equal((await S.engine.checkInbox()).err.code, "apikey");
  await S.E.delPass("chan-1");
  assert.equal((await S.engine.checkInbox()).err, null);
});

test("presets: MailerSend (MailerLite's sending service) is an SMTP preset, not an API one", () => {
  assert.equal(C.PRESETS.mailersend.host, "smtp.mailersend.net");
  assert.equal(C.PRESETS.mailersend.port, 587);
  const ch = C.normChan({ id: "chan-2", m: 1, kind: "smtp", preset: "mailersend", via: "api", host: "smtp.mailersend.net", user: "MS_x@example.com" });
  assert.equal(ch.preset, "mailersend");
  assert.equal(ch.via, "smtp");
  assert.equal(ch.sec, "starttls");
});
