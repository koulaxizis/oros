// orOS Mail relay — Cloudflare Worker entry. See relay/README.md.
import { connect } from "cloudflare:sockets";
import { handle } from "./core.js";

function connectFn(host, port, mode) {
  return connect({ hostname: host, port: port },
                 { secureTransport: mode === "starttls" ? "starttls" : "on", allowHalfOpen: false });
}

export default {
  fetch(request, env) {
    return handle(request, env, connectFn);
  }
};
