// orOS Mail — List-Unsubscribe (mail/unsub.js). Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../mail/unsub.js");
const M = require("../mail/mime.js");

const hdrs = (s) => M.parseHeaders(s);

test("unsubscribe: mailto and https, with the one-click marker", () => {
  const h = hdrs("List-Unsubscribe: <mailto:leave@list.example.com?subject=unsubscribe%20me>,\r\n" +
                 " <https://list.example.com/u?id=42&t=abc>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n");
  const u = U.parse(h);
  assert.deepEqual(u.mailto, { to: "leave@list.example.com", subject: "unsubscribe me", body: "" });
  assert.equal(u.web, "https://list.example.com/u?id=42&t=abc");
  assert.equal(u.oneClick, true);
});

test("unsubscribe: only a web link, no POST header", () => {
  const u = U.parse(hdrs("List-Unsubscribe: <https://x.example/unsub>\r\n"));
  assert.equal(u.mailto, null);
  assert.equal(u.web, "https://x.example/unsub");
  assert.equal(u.oneClick, false);
});

test("unsubscribe: the first usable one of each kind; junk ignored", () => {
  const u = U.parse(hdrs("List-Unsubscribe: <mailto:not-an-address>, <javascript:alert(1)>, <ftp://x/y>, " +
                         "<mailto:a%40b.example>, <http://plain.example/u>, <https://second.example/u>\r\n"));
  assert.equal(u.mailto.to, "a@b.example");
  assert.equal(u.web, "http://plain.example/u");
  assert.equal(U.parse(hdrs("List-Unsubscribe: <javascript:alert(1)>\r\n")), null);
  assert.equal(U.parse(hdrs("List-Unsubscribe: https://no-brackets.example\r\n")), null);
  assert.equal(U.parse(hdrs("Subject: hi\r\n")), null);
  assert.equal(U.parse(null), null);
  // user:pass@host links are not offered
  assert.equal(U.parse(hdrs("List-Unsubscribe: <https://user:pw@evil.example/>\r\n")), null);
});

test("mailto (RFC 6068): to= in the query, body, plus stays a plus, line breaks", () => {
  assert.deepEqual(U.mailto("mailto:?to=x%2Bunsub@l.example&subject=Stop&body=Please%0D%0Aremove+me"),
    { to: "x+unsub@l.example", subject: "Stop", body: "Please\nremove+me" });
  assert.deepEqual(U.mailto("MAILTO:one@a.example,two@b.example"), { to: "one@a.example", subject: "", body: "" });
  // header injection: a subject with line breaks is flattened
  assert.equal(U.mailto("mailto:a@b.example?subject=x%0D%0ABcc:%20evil@c.example").subject, "x Bcc: evil@c.example");
  assert.equal(U.mailto("https://x.example"), null);
  assert.equal(U.mailto("mailto:%E0%A4%A"), null);
});
