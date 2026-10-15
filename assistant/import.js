// ============================================================
// orOS Assistant — import.js (pure logic: "Import conversations")
// Reads the data export of another AI chat service, as DATA only
// (nothing is run, nothing becomes HTML; the app draws the text with
// its own safe Markdown subset, core.js parseMd → textContent):
//   - ChatGPT  Settings › Data controls › Export data: a ZIP with
//              conversations.json = [{ id, title, create_time,
//              update_time, mapping: { nodeId: { message: { author:
//              { role }, content: { content_type, parts | text },
//              create_time, recipient, metadata }, parent, children }
//              }, current_node }]. The branch on screen is the one
//              from current_node up through the parents; other
//              branches (edited prompts, regenerated answers) are
//              left out.
//   - Claude   Settings › Privacy › Export data: a ZIP with
//              conversations.json = [{ uuid, name, created_at,
//              updated_at, chat_messages: [{ sender: "human" |
//              "assistant", text, content: [{ type, text }],
//              created_at, attachments: [{ file_name }], files:
//              [{ file_name }] }] }]
// The conversations.json alone (not zipped) works too.
// Kept: the user's and the assistant's text. Left out: system and
// tool messages, tool calls, hidden context, thinking; a picture
// becomes "[image]", an attached file "[file: name]".
//   readBytes(bytes, name) → Promise<{ source, convs } | { error:
//                            "bad" | "empty" | "big" }>
//   parseJson(value)       → the same (sync) from parsed JSON
//   plan(res, have, room)  → { list: [conv + { have }], stats: {
//                            convs, msgs, from, to, have, fresh },
//                            room }: what an import would add
//   toChat(conv, m)        → the Assistant's own chat record { id, m,
//                            title, msgs: [{ r: "user" | "asst", text
//                            }], refs, refN }; the first message
//                            carries imp (the source) and at (when
//                            the conversation was last updated)
// conv = { id, src, srcId, title, from, to, msgs: [{ r, text }],
//          cut: n messages shortened }
// Stable ids: "cimp" + source letter + two hashes of the source's own
// conversation id (core.js CHAT_ID: c + 6–40 of a-z0-9), so importing
// the same export twice adds nothing.
// Caps: file size, conversations (MAX_CONVS), messages per
// conversation, characters per message, branch walk length.
// Needs OrosImportKit (../importkit.js); ZIP needs AtelierZip.
// UMD: window.OrosAssistantImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var K = (typeof module !== "undefined" && module.exports && typeof require === "function")
    ? require("../importkit.js") : root.OrosImportKit;

  var MAX_FILE = 300 * 1024 * 1024;     // the file as picked
  var MAX_JSON = 80 * 1024 * 1024;      // conversations.json inflated (AtelierZip's own cap)
  var MAX_CONVS = 2000;                 // conversations read from one file
  var MAX_MSGS = 2000;                  // messages kept per conversation
  var MAX_TEXT = 60000;                 // characters per message
  var MAX_WALK = 50000;                 // nodes walked on one branch
  var MAX_TITLE = 200;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function str(v) { return typeof v === "string" ? v : ""; }
  // seconds (ChatGPT) or ISO text (Claude) → ms, or 0
  function when(v) {
    if (typeof v === "number" && isFinite(v) && v > 0) return Math.round(v > 1e11 ? v : v * 1000);
    if (typeof v === "string" && v) { var t = Date.parse(v); if (isFinite(t)) return t; }
    return 0;
  }
  function chatIdOf(src, srcId) {
    var s = String(srcId);
    var h = (K.hash(src + ":" + s) + K.hash("x" + s + "#" + src)).replace(/[^a-z0-9]/g, "");
    return ("cimp" + (src === "claude" ? "c" : "g") + h).slice(0, 41);
  }
  function cut(text, conv) {
    text = K.cleanText(text);
    if (text.length > MAX_TEXT) { conv.cut++; text = text.slice(0, MAX_TEXT) + "\n\n[…]"; }
    return text;
  }
  // consecutive messages of one side become one (the providers expect
  // user / assistant turns), empty ones go
  function tidy(msgs) {
    var out = [];
    msgs.forEach(function (m) {
      if (!m.text) return;
      var last = out[out.length - 1];
      if (last && last.r === m.r) last.text += "\n\n" + m.text;
      else out.push({ r: m.r, text: m.text, ts: m.ts });
    });
    return out;
  }

  // ---------- ChatGPT ----------
  function gptText(msg) {
    var c = isObj(msg.content) ? msg.content : {}, type = str(c.content_type);
    if (type === "text" || type === "multimodal_text") {
      var parts = Array.isArray(c.parts) ? c.parts : [];
      return parts.map(function (p) {
        if (typeof p === "string") return p;
        if (isObj(p)) {
          if (/image/.test(str(p.content_type)) || p.asset_pointer) return "[image]";
          if (/audio/.test(str(p.content_type))) return typeof p.text === "string" ? p.text : "";
          if (typeof p.text === "string") return p.text;
        }
        return "";
      }).filter(Boolean).join("\n");
    }
    // code, execution output, browsing, thoughts, hidden context: tool
    // traffic or the model's own notes, not the conversation
    return "";
  }
  function gptConv(c) {
    var srcId = str(c.id) || str(c.conversation_id) || (str(c.title) + "@" + String(c.create_time));
    var conv = { id: chatIdOf("chatgpt", srcId), src: "chatgpt", srcId: srcId, title: K.clean(str(c.title), MAX_TITLE),
      from: when(c.create_time), to: when(c.update_time), msgs: [], cut: 0 };
    var map = isObj(c.mapping) ? c.mapping : {};
    var node = str(c.current_node);
    if (!node || !isObj(map[node])) {
      // no current node: the newest leaf
      var best = null, bt = -1;
      Object.keys(map).forEach(function (k) {
        var n = map[k];
        if (!isObj(n) || (Array.isArray(n.children) && n.children.length)) return;
        var t = n.message ? when(n.message.create_time) : 0;
        if (t >= bt) { bt = t; best = k; }
      });
      node = best;
    }
    var chain = [], seen = {}, steps = 0;
    while (node && isObj(map[node]) && !seen[node] && steps++ < MAX_WALK) {
      seen[node] = 1;
      chain.push(map[node]);
      node = str(map[node].parent);
    }
    chain.reverse();
    var msgs = [];
    chain.forEach(function (n) {
      var m = isObj(n.message) ? n.message : null;
      if (!m) return;
      var role = isObj(m.author) ? str(m.author.role) : "";
      if (role !== "user" && role !== "assistant") return;
      var meta = isObj(m.metadata) ? m.metadata : {};
      if (meta.is_visually_hidden_from_conversation || meta.is_user_system_message) return;
      if (role === "assistant" && m.recipient && m.recipient !== "all") return;     // a tool call
      var text = cut(gptText(m), conv);
      if (text) msgs.push({ r: role === "user" ? "user" : "asst", text: text, ts: when(m.create_time) });
    });
    conv.msgs = tidy(msgs);
    return conv;
  }

  // ---------- Claude ----------
  function claudeText(m) {
    var out = [];
    if (Array.isArray(m.content) && m.content.length) {
      m.content.forEach(function (b) {
        if (!isObj(b)) return;
        if (b.type === "text" && typeof b.text === "string") out.push(b.text);
        else if (b.type === "image") out.push("[image]");
      });
    } else if (typeof m.text === "string") out.push(m.text);
    var names = [];
    [m.attachments, m.files].forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (f) {
        var n = isObj(f) ? K.clean(f.file_name || f.name, 120) : "";
        if (n && names.indexOf(n) < 0) names.push(n);
      });
    });
    names.forEach(function (n) { out.push("[file: " + n + "]"); });
    return out.join("\n");
  }
  function claudeConv(c) {
    var srcId = str(c.uuid) || str(c.id) || (str(c.name) + "@" + str(c.created_at));
    var conv = { id: chatIdOf("claude", srcId), src: "claude", srcId: srcId, title: K.clean(str(c.name), MAX_TITLE),
      from: when(c.created_at), to: when(c.updated_at), msgs: [], cut: 0 };
    var list = Array.isArray(c.chat_messages) ? c.chat_messages : [];
    var msgs = [];
    list.forEach(function (m) {
      if (!isObj(m)) return;
      var who = str(m.sender);
      if (who !== "human" && who !== "assistant") return;
      var text = cut(claudeText(m), conv);
      if (text) msgs.push({ r: who === "human" ? "user" : "asst", text: text, ts: when(m.created_at) });
    });
    conv.msgs = tidy(msgs);
    return conv;
  }

  // ---------- File ----------
  function parseJson(v) {
    if (isObj(v) && Array.isArray(v.conversations)) v = v.conversations;
    if (!Array.isArray(v)) return { error: "bad" };
    var first = null;
    for (var i = 0; i < v.length && !first; i++) if (isObj(v[i])) first = v[i];
    if (!first) return { error: "empty" };
    var src = isObj(first.mapping) ? "chatgpt" : Array.isArray(first.chat_messages) ? "claude" : "";
    if (!src) return { error: "bad" };
    var convs = [], total = 0, skipped = 0;
    for (var k = 0; k < v.length; k++) {
      var c = v[k];
      if (!isObj(c)) continue;
      total++;
      if (convs.length >= MAX_CONVS) { skipped++; continue; }
      var conv = src === "chatgpt" ? (isObj(c.mapping) ? gptConv(c) : null) : (Array.isArray(c.chat_messages) ? claudeConv(c) : null);
      if (!conv || !conv.msgs.length) { skipped++; continue; }
      if (conv.msgs.length > MAX_MSGS) { conv.msgs = conv.msgs.slice(conv.msgs.length - MAX_MSGS); conv.cut++; }
      if (!conv.title) conv.title = K.clean(conv.msgs[0].text, 60);
      var ts = conv.msgs.map(function (m) { return m.ts; }).filter(Boolean);
      if (!conv.from && ts.length) conv.from = Math.min.apply(null, ts);
      if (!conv.to) conv.to = ts.length ? Math.max.apply(null, ts) : conv.from;
      if (conv.to < conv.from) conv.to = conv.from;
      convs.push(conv);
    }
    if (!convs.length) return { error: "empty" };
    // the same conversation twice in one file: the first one
    var seen = {};
    convs = convs.filter(function (c) { if (seen[c.id]) { skipped++; return false; } seen[c.id] = 1; return true; });
    return { source: src, convs: convs, total: total, skipped: skipped };
  }
  function readBytes(bytes, name) {
    return Promise.resolve().then(function () {
      if (!bytes || !bytes.length) return { error: "empty" };
      if (bytes.length > MAX_FILE) return { error: "big" };
      if (K.isZip(bytes)) {
        var z = K.unzip(bytes);
        var hit = null;
        z.names.forEach(function (n) {
          if (/(^|\/)conversations\.json$/i.test(n) && (!hit || n.length < hit.length)) hit = n;
        });
        if (!hit) return { error: "bad" };
        return z.text(hit, MAX_JSON).then(function (t) {
          var v = K.json(t);
          return v === null ? { error: "bad" } : parseJson(v);
        }, function (e) { return { error: e && e.message === "toobig" ? "big" : "bad" }; });
      }
      var v = K.json(K.text(bytes));
      return v === null ? { error: "bad" } : parseJson(v);
    });
  }

  // ---------- Plan ----------
  // have: { chatId: true } of the chats on this device; room: how many
  // more the Assistant keeps. Newest first; a conversation already
  // here is marked and never chosen again.
  function plan(res, have, room) {
    have = have || {};
    var list = res.convs.map(function (c) {
      var o = {};
      Object.keys(c).forEach(function (k) { o[k] = c[k]; });
      o.have = !!have[c.id];
      return o;
    }).sort(function (a, b) { return (b.to - a.to) || (a.id < b.id ? -1 : 1); });
    var st = { convs: list.length, msgs: 0, from: 0, to: 0, have: 0, fresh: 0, cut: 0 };
    list.forEach(function (c) {
      st.msgs += c.msgs.length;
      if (c.from && (!st.from || c.from < st.from)) st.from = c.from;
      if (c.to > st.to) st.to = c.to;
      if (c.have) st.have++; else st.fresh++;
      if (c.cut) st.cut++;
    });
    return { list: list, stats: st, room: Math.max(0, room == null ? MAX_CONVS : room) };
  }

  // The Assistant's chat record. m: when it counts as changed (the
  // app picks it; see assistant.js applyImport).
  function toChat(c, m) {
    var msgs = c.msgs.map(function (x) { return { r: x.r, text: x.text }; });
    msgs[0].imp = c.src;
    msgs[0].at = c.to || c.from || m;
    return { id: c.id, m: m, title: c.title, msgs: msgs, refs: {}, refN: 0 };
  }
  // the source of an imported chat ("chatgpt" | "claude") or ""
  function sourceOf(chat) {
    var m = chat && Array.isArray(chat.msgs) ? chat.msgs[0] : null;
    return m && (m.imp === "chatgpt" || m.imp === "claude") ? m.imp : "";
  }

  var API = {
    MAX_FILE: MAX_FILE, MAX_CONVS: MAX_CONVS, MAX_MSGS: MAX_MSGS, MAX_TEXT: MAX_TEXT,
    readBytes: readBytes, parseJson: parseJson, plan: plan, toChat: toChat, sourceOf: sourceOf, chatIdOf: chatIdOf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosAssistantImport = API;
})(typeof self !== "undefined" ? self : this);
