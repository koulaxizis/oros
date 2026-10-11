// orOS Mail — sender check (Authentication-Results) and suspicious
// links (mail/trust.js). The sanitizer's link marks are checked in the
// browser (no DOM here).
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../mail/trust.js");

const H = (ar, rcv) => {
  const h = {};
  if (ar !== undefined) h["authentication-results"] = [].concat(ar);
  h.received = [rcv || "from out.sender.gr by mx1.pmail.gr with ESMTPS id x; Sun, 11 Oct 2026 10:00:00 +0300"];
  return h;
};
const from = (addr, name) => ({ addr, name: name || "" });

test("trust: org domains", () => {
  assert.equal(T.orgDomain("mx1.pmail.gr"), "pmail.gr");
  assert.equal(T.orgDomain("mail.shop.com.gr"), "shop.com.gr");
  assert.equal(T.orgDomain("a.b.example.co.uk"), "example.co.uk");
  assert.equal(T.orgDomain("example.gr"), "example.gr");
});

test("trust: a pass from the receiving server gives the badge", () => {
  const ok = "mx1.pmail.gr; spf=pass smtp.mailfrom=bank.gr; dkim=pass header.d=bank.gr; dmarc=pass (p=reject) header.from=bank.gr";
  let v = T.sender(H(ok), from("info@bank.gr"), { hosts: ["mail.pmail.gr"] });
  assert.deepEqual([v.level, v.why, v.domain], ["ok", [], "bank.gr"]);
  // aligned DKIM alone (subdomain signer) is enough
  v = T.sender(H("mx1.pmail.gr; dkim=pass header.d=news.bank.gr; spf=none"), from("info@bank.gr"), {});
  assert.equal(v.level, "ok");
  // DKIM pass for someone else's domain is not a pass for this sender
  v = T.sender(H("mx1.pmail.gr; dkim=pass header.d=mailer.example; spf=neutral"), from("info@bank.gr"), {});
  assert.equal(v.level, "none");
  // Gmail: authserv-id mx.google.com, account host imap.gmail.com
  v = T.sender(H("mx.google.com; dmarc=pass header.from=bank.gr", "by 2002:a05:6000:1::1 with SMTP id z"),
               from("info@bank.gr"), { hosts: ["imap.gmail.com"] });
  assert.equal(v.level, "ok");
});

test("trust: a pass written by someone else is not believed", () => {
  // authserv-id of a stranger, not the receiving server (Received by mx1.pmail.gr)
  const v = T.sender(H("mx.forger.example; dmarc=pass header.from=bank.gr"), from("info@bank.gr"), { hosts: ["mail.pmail.gr"] });
  assert.equal(v.level, "none");
  // no Authentication-Results at all → no badge, no warning
  assert.equal(T.sender(H(undefined), from("info@bank.gr"), {}).level, "none");
  // a real DMARC pass, but for another domain than the From
  assert.equal(T.sender(H("mx1.pmail.gr; dmarc=pass header.from=bank.gr"), from("x@evil.example"), {}).level, "none");
});

test("trust: failures warn, whoever wrote them", () => {
  let v = T.sender(H("x.example; dmarc=fail (p=reject) header.from=bank.gr; spf=fail"), from("info@bank.gr"), {});
  assert.deepEqual([v.level, v.why], ["warn", ["dmarc"]]);
  v = T.sender(H("mx1.pmail.gr; spf=softfail smtp.mailfrom=bank.gr; dkim=fail header.d=bank.gr"), from("info@bank.gr"), {});
  assert.deepEqual([v.level, v.why], ["warn", ["dkim", "spf"]]);
  // SPF fails but an aligned DKIM passes (forwarding): fine
  v = T.sender(H("mx1.pmail.gr; spf=fail smtp.mailfrom=list.example; dkim=pass header.d=bank.gr"), from("info@bank.gr"), {});
  assert.equal(v.level, "ok");
  // failures about another domain (a mailing list's envelope) do not blame this sender
  v = T.sender(H("mx1.pmail.gr; spf=fail smtp.mailfrom=list.example; dkim=fail header.d=list.example"), from("info@bank.gr"), {});
  assert.deepEqual([v.level, v.why], ["none", []]);
});

test("trust: a display name with another address warns", () => {
  let v = T.sender(H(undefined), from("x@evil.example", "service@paypal.com"), {});
  assert.deepEqual([v.level, v.why, v.claimed], ["warn", ["name"], "paypal.com"]);
  v = T.sender(H(undefined), from("maria@pmail.gr", "Maria (maria@pmail.gr)"), {});
  assert.equal(v.level, "none");
});

test("trust: suspicious links", () => {
  const L = T.link;
  assert.equal(L("Read more", "https://www.example.gr/a"), null);
  assert.equal(L("https://www.bank.gr/login", "https://ebanking.bank.gr/x?y=1"), null);
  assert.equal(L("support@bank.gr", "mailto:support@bank.gr"), null);
  assert.deepEqual(L("www.bank.gr", "https://bank-gr.evil.example/login"), { code: "mismatch", host: "bank-gr.evil.example", shown: "bank.gr" });
  assert.equal(L("https://paypal.com", "https://paypa1.com/").code, "lookalike");
  assert.equal(L("Sign in", "https://secure.rnicrosoft.com/").code, "lookalike");
  assert.equal(L("x", "https://xn--pypal-4ve.com/").code, "puny");
  assert.equal(L("x", "http://192.168.10.5/login").code, "ip");
  const u = L("x", "https://www.bank.gr@evil.example/login");
  assert.deepEqual([u.code, u.host], ["userinfo", "evil.example"]);
  // a real brand with digits in its name is not flagged when spelt right
  assert.equal(L("x", "https://www.365.gr/"), null);
});
