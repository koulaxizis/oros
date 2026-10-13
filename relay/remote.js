// Studio Remote's meeting point: a tablet or phone and the PC running
// Studio find each other here (studio/remote.js). One Durable Object per
// room; a room holds at most two WebSockets and forwards each text frame
// to the other one, as is. The clients encrypt everything with a key
// derived from the pairing code, so the relay only ever sees ciphertext;
// the room id is a hash of the code. Nothing is stored: rooms live in
// memory and close after REMOTE_LIMITS.idleMs without traffic.
//
// Used two ways: to exchange the WebRTC offer/answer (after which the
// devices talk directly), and as the path itself when a direct link is
// not possible (a VPN, different networks).

export const REMOTE_LIMITS = {
  frameBytes: 16384,     // one text frame
  burst: 400,            // frames per socket per window
  windowMs: 10000,
  idleMs: 120000         // no frame from anyone for this long: the room closes
};

export const ROOM_RE = /^\/rt\/([0-9a-f]{64})$/;

// GET /rt/<room> with Upgrade: websocket. Origin and rate limit are
// checked by core.js before this is called.
export async function handleRemote(request, env, room) {
  if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
    return new Response("expected a WebSocket", { status: 426 });
  }
  if (!env || !env.REMOTE) return new Response("remote not available", { status: 503 });
  try {
    const stub = env.REMOTE.get(env.REMOTE.idFromName(room));
    return await stub.fetch(request);
  } catch (e) {
    return new Response("remote unavailable", { status: 502 });
  }
}

// The other socket of the room, or null.
function others(state, ws) {
  return state.getWebSockets().filter((s) => s !== ws);
}
function sys(ws, what) {
  try { ws.send(JSON.stringify({ sys: what })); } catch (e) {}
}

// A bare "ping" text frame is answered "pong" by the runtime itself, so
// keep-alives on an otherwise direct link neither wake the room nor
// count as requests. The room needs no env (no secrets).
export class RemoteRoom {
  constructor(state) {
    this.state = state;
    if (typeof state.setWebSocketAutoResponse === "function" && typeof WebSocketRequestResponsePair === "function") {
      state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    }
  }

  async fetch(request) {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("expected a WebSocket", { status: 426 });
    }
    const socks = this.state.getWebSockets();
    if (socks.length >= 2) return new Response("room full", { status: 409 });
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    const now = Date.now();
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ w: now, n: 0, at: now });
    if (socks.length === 1) { sys(socks[0], "peer"); sys(server, "peer"); }
    else sys(server, "wait");
    await this.state.storage.setAlarm(now + REMOTE_LIMITS.idleMs);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg !== "string") { ws.close(1003, "text frames only"); return; }
    if (msg.length > REMOTE_LIMITS.frameBytes) { ws.close(1009, "frame too large"); return; }
    const now = Date.now(), a = ws.deserializeAttachment() || { w: now, n: 0 };
    if (now - a.w > REMOTE_LIMITS.windowMs) { a.w = now; a.n = 0; }
    if (++a.n > REMOTE_LIMITS.burst) { ws.close(1008, "too many frames"); return; }
    a.at = now;
    ws.serializeAttachment(a);
    if (msg === "ping") { try { ws.send("pong"); } catch (e) {} return; }   // where auto-response is missing
    for (const o of others(this.state, ws)) {
      try { o.send(msg); } catch (e) {}
    }
  }

  async webSocketClose(ws) {
    for (const o of others(this.state, ws)) sys(o, "left");
    try { ws.close(1000, "bye"); } catch (e) {}
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  // Closes the room once nobody has sent anything (a keep-alive counts)
  // for idleMs.
  async alarm() {
    const now = Date.now(), socks = this.state.getWebSockets();
    if (!socks.length) return;
    let last = 0;
    for (const s of socks) {
      const a = s.deserializeAttachment();
      if (a && a.at > last) last = a.at;
      const t = typeof this.state.getWebSocketAutoResponseTimestamp === "function" && this.state.getWebSocketAutoResponseTimestamp(s);
      if (t && +t > last) last = +t;
    }
    if (now - last >= REMOTE_LIMITS.idleMs) {
      for (const s of socks) { try { s.close(1001, "idle"); } catch (e) {} }
      return;
    }
    await this.state.storage.setAlarm(last + REMOTE_LIMITS.idleMs);
  }
}
