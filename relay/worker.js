// orOS Mail relay — Cloudflare Worker entry. See relay/README.md.
import { connect } from "cloudflare:sockets";
import { handle } from "./core.js";
import { purgeShares } from "./share.js";
import { purgeShort } from "./short.js";
export { RemoteRoom } from "./remote.js";
export { PushBox } from "./push.js";
export { HouseBox } from "./house.js";
export { HookBox } from "./hook.js";
export { GateBox } from "./gate.js";

function connectFn(host, port, mode) {
  return connect({ hostname: host, port: port },
                 { secureTransport: mode === "starttls" ? "starttls" : "on", allowHalfOpen: false });
}

export default {
  fetch(request, env) {
    return handle(request, env, connectFn);
  },
  // Hourly cron (wrangler.toml [triggers]): expired share links and
  // unfinished uploads leave the database, and so do short links for
  // songs nobody opened for a year (short.js).
  scheduled(event, env, ctx) {
    ctx.waitUntil(purgeShares(env, Date.now()));
    ctx.waitUntil(purgeShort(env, Date.now()));
  }
};
