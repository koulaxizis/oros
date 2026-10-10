// ============================================================
// orOS Mail — building outgoing messages (RFC 5322 + MIME)
// Pure functions, no DOM: plain-text messages in UTF-8, header
// words encoded per RFC 2047, reply / forward helpers.
// Exposed as window.orosMailCompose; module.exports in Node (tests).
// ============================================================
(function (root) {
  "use strict";

  var CRLF = "\r\n";

  // ---------- bytes ----------
  function utf8Bin(s) {
    var u8 = new TextEncoder().encode(String(s));
    var out = "";
    for (var i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return out;
  }
  function b64(bin) {
    if (typeof btoa === "function") return btoa(bin);
    return Buffer.from(bin, "latin1").toString("base64");
  }
  function wrap76(s) { return s.replace(/.{1,76}/g, "$&" + CRLF).replace(/\r\n$/, ""); }

  // ---------- addresses ----------
  var ADDR = /^[^\s@<>()",;:\\\[\]]+@[^\s@<>()",;:\\\[\]]+\.[^\s@<>()",;:\\\[\]]+$/;
  function validAddr(a) { return typeof a === "string" && a.length <= 254 && ADDR.test(a); }

  // "Name <a@b>, c@d; "Last, First" <e@f>" → [{ name, addr }], plus
  // the pieces that are not addresses (shown to the user as an error).
  function parseList(s) {
    var out = [], bad = [];
    var parts = [], cur = "", q = false, ang = false, esc = false;
    String(s || "").split("").forEach(function (c) {
      if (esc) { esc = false; cur += c; return; }
      if (c === "\\" && q) { esc = true; cur += c; return; }
      if (c === "\"" && !ang) q = !q;
      else if (c === "<" && !q) ang = true;
      else if (c === ">" && !q) ang = false;
      if ((c === "," || c === ";" || c === "\n") && !q && !ang) { parts.push(cur); cur = ""; return; }
      cur += c;
    });
    parts.push(cur);
    parts.forEach(function (p) {
      p = p.trim();
      if (!p) return;
      var m = /^(.*?)<\s*([^<>\s]+)\s*>\s*$/.exec(p);
      var name = "", addr = p;
      if (m) { name = m[1].trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1").trim(); addr = m[2]; }
      addr = addr.replace(/^mailto:/i, "");
      if (validAddr(addr)) out.push({ name: name.slice(0, 120), addr: addr });
      else bad.push(p);
    });
    return { list: out, bad: bad };
  }

  // ---------- header encoding ----------
  // An RFC 2047 "B" word per ≤ 45 bytes of UTF-8, never splitting a
  // character. Pure printable ASCII is left alone.
  function encodeWords(s) {
    s = String(s || "").replace(/[\r\n\t]+/g, " ");
    if (/^[\x20-\x7e]*$/.test(s)) return s;
    var words = [], chunk = "";
    Array.from(s).forEach(function (ch) {
      if (utf8Bin(chunk + ch).length > 45) { words.push(chunk); chunk = ""; }
      chunk += ch;
    });
    if (chunk) words.push(chunk);
    return words.map(function (w) { return "=?UTF-8?B?" + b64(utf8Bin(w)) + "?="; }).join(" ");
  }
  function fmtAddr(p) {
    var name = String(p.name || "").trim();
    if (!name) return p.addr;
    if (/^[\x20-\x7e]*$/.test(name)) {
      if (/^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~ .-]*$/.test(name) && !/^\.|\.$|\.\./.test(name)) return name + " <" + p.addr + ">";
      return "\"" + name.replace(/[\\"]/g, "\\$&") + "\" <" + p.addr + ">";
    }
    return encodeWords(name) + " <" + p.addr + ">";
  }
  // "To: a, b, c" folded before a comma once a line passes 76.
  function header(name, value) {
    var line = name + ": ", out = "";
    String(value).split(/(?<=,) /).forEach(function (piece, i) {
      if (i && line.length + piece.length + 1 > 76) { out += line + CRLF; line = " "; }
      else if (i) line += " ";
      line += piece;
    });
    // long encoded subjects: fold between words
    if (line.length > 78) {
      var words = line.split(" "), l = "";
      words.forEach(function (w, i) {
        if (i && l.length + w.length + 1 > 76) { out += l + CRLF; l = " " + w; }
        else l += (i ? " " : "") + w;
      });
      line = l;
    }
    return out + line + CRLF;
  }

  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function rfcDate(d) {
    var off = -d.getTimezoneOffset(), sign = off < 0 ? "-" : "+";
    off = Math.abs(off);
    return DAYS[d.getDay()] + ", " + d.getDate() + " " + MONS[d.getMonth()] + " " + d.getFullYear() + " " +
      p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()) + " " +
      sign + p2(Math.floor(off / 60)) + p2(off % 60);
  }
  function randomId() {
    var a = new Uint8Array(12);
    (root.crypto || require("crypto").webcrypto).getRandomValues(a);
    return Array.from(a, function (x) { return (x + 256).toString(16).slice(1); }).join("");
  }
  function msgIdFor(from) {
    var dom = String(from || "").split("@")[1] || "useoros.online";
    return "<" + randomId() + ".oros@" + dom.replace(/[^A-Za-z0-9.-]/g, "") + ">";
  }
  function cleanId(v) {
    var m = /<[^<>\s]{3,250}>/.exec(String(v || ""));
    return m ? m[0] : "";
  }

  // ---------- the message ----------
  // o: { from{name,addr}, to[], cc[], bcc[], subject, text, inReplyTo?,
  //      references?, date? }   → { bin, messageId, rcpt[] }
  function build(o) {
    var date = o.date instanceof Date ? o.date : new Date();
    var mid = msgIdFor(o.from.addr);
    var text = String(o.text || "").replace(/\r\n|\r/g, "\n");
    var body = text.split("\n").join(CRLF);
    var ascii = /^[\x00-\x7f]*$/.test(body) && body.split(CRLF).every(function (l) { return l.length <= 998; });
    var h = "";
    h += header("Date", rfcDate(date));
    h += header("From", fmtAddr(o.from));
    if (o.to && o.to.length) h += header("To", o.to.map(fmtAddr).join(", "));
    if (o.cc && o.cc.length) h += header("Cc", o.cc.map(fmtAddr).join(", "));
    h += header("Subject", encodeWords(o.subject || ""));
    h += header("Message-ID", mid);
    var irt = cleanId(o.inReplyTo);
    if (irt) h += header("In-Reply-To", irt);
    var refs = String(o.references || "").match(/<[^<>\s]{3,250}>/g) || [];
    if (irt && refs.indexOf(irt) < 0) refs.push(irt);
    if (refs.length) h += header("References", refs.slice(-20).join(" "));
    h += "MIME-Version: 1.0" + CRLF;
    h += "Content-Type: text/plain; charset=utf-8" + CRLF;
    h += "Content-Transfer-Encoding: " + (ascii ? "7bit" : "base64") + CRLF;
    h += "User-Agent: orOS Mail" + CRLF;
    var bin = h + CRLF + (ascii ? body : wrap76(b64(utf8Bin(body)))) + CRLF;
    var seen = {}, rcpt = [];
    [].concat(o.to || [], o.cc || [], o.bcc || []).forEach(function (p) {
      var k = p.addr.toLowerCase();
      if (!seen[k]) { seen[k] = 1; rcpt.push(p.addr); }
    });
    return { bin: bin, messageId: mid, rcpt: rcpt };
  }

  // ---------- reply / forward ----------
  function prefixed(subj, pre) {
    subj = String(subj || "").trim();
    var re = new RegExp("^(" + pre + "|" + (pre === "Re" ? "Απ|ΑΠ|Aw|Sv" : "Fw|Fwd|Προώθ|ΠΡΘ") + ")\\s*:", "i");
    return re.test(subj) ? subj : pre + ": " + subj;
  }
  function quote(text) {
    return String(text || "").replace(/\r\n|\r/g, "\n").replace(/\n+$/, "").split("\n").map(function (l) {
      return l.charAt(0) === ">" ? ">" + l : "> " + l;
    }).join("\n");
  }
  // msg: { from, to[], cc[], replyTo[], subject, messageId, references, date, text }
  // mode: "reply" | "all" | "forward"; me: own address.
  // labels: { wrote(date, who) → string, fwd → string }
  function draftFrom(msg, mode, me, labels) {
    var mine = String(me || "").toLowerCase();
    var notMe = function (p) { return p.addr.toLowerCase() !== mine; };
    var uniq = function (list) {
      var seen = {};
      return list.filter(function (p) { var k = p.addr.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; });
    };
    if (mode === "forward") {
      var head = [labels.fwd,
        labels.from + ": " + fmtPlain(msg.from),
        labels.date + ": " + labels.fmtDate(msg.date),
        labels.subject + ": " + (msg.subject || ""),
        msg.to && msg.to.length ? labels.to + ": " + msg.to.map(fmtPlain).join(", ") : ""].filter(Boolean).join("\n");
      return { to: [], cc: [], subject: prefixed(msg.subject, "Fwd"),
               text: "\n\n" + head + "\n\n" + String(msg.text || ""), inReplyTo: "", references: "" };
    }
    var back = msg.replyTo && msg.replyTo.length ? msg.replyTo : [msg.from];
    var to = back.filter(function (p) { return p && p.addr; });
    if (to.length && !to.some(notMe) && msg.to && msg.to.length) to = msg.to;   // replying to my own sent message
    var cc = [];
    if (mode === "all") {
      cc = uniq([].concat(msg.to || [], msg.cc || [])).filter(notMe)
        .filter(function (p) { return !to.some(function (q) { return q.addr.toLowerCase() === p.addr.toLowerCase(); }); });
    }
    var refs = (String(msg.references || "") + " " + (msg.messageId || "")).trim();
    return { to: uniq(to), cc: cc, subject: prefixed(msg.subject, "Re"),
             text: "\n\n" + labels.wrote(msg.date, fmtPlain(msg.from)) + "\n" + quote(msg.text),
             inReplyTo: msg.messageId || "", references: refs };
  }
  function fmtPlain(p) { return p ? (p.name ? p.name + " <" + p.addr + ">" : p.addr) : ""; }
  // For an editable address field: names with , ; " < > are quoted so
  // parseList reads the field back the same way.
  function fmtInput(p) {
    if (!p) return "";
    var name = String(p.name || "").trim();
    if (!name) return p.addr;
    if (/[,;"<>\\]/.test(name)) name = "\"" + name.replace(/[\\"]/g, "\\$&") + "\"";
    return name + " <" + p.addr + ">";
  }

  var api = {
    utf8Bin: utf8Bin, b64: b64, validAddr: validAddr, parseList: parseList,
    encodeWords: encodeWords, fmtAddr: fmtAddr, fmtPlain: fmtPlain, fmtInput: fmtInput, rfcDate: rfcDate,
    build: build, prefixed: prefixed, quote: quote, draftFrom: draftFrom
  };
  root.orosMailCompose = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
