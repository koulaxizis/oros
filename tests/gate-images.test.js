// GATE-IMG (Chris 2026-11-27, with the Mail thread's conditions): a picture
// files_read returns through orOS Gate reaches Claude as an MCP image part,
// only from an open device's answer and never stored; wrong type, wrong
// first bytes or too big stays text; at most 3; never for Mail, Passwords
// or the Assistant.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let G;
test.before(async () => { G = await import("../relay/gate.js"); });
const b64 = (bytes, n) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(n || 30, 7)]).toString("base64");
const PNG = b64([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const JPG = b64([0xFF, 0xD8, 0xFF, 0xE0]);
const GIF = b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = b64([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

test("an image part is passed through, after the text and before the version note", () => {
  const p = G.gateImages("files_read", { path: "Pictures/page12.jpg" }, [{ data: JPG, mimeType: "image/jpeg" }]);
  assert.deepEqual(p, { imgs: [{ type: "image", data: JPG, mimeType: "image/jpeg" }], dropped: 0 });
  const r = G.toolText("{\"path\":\"Pictures/page12.jpg\"}", false, "", p.imgs.concat(G.imgNote(p.dropped)));
  assert.deepEqual(r.content.map((c) => c.type), ["text", "image", "text"]);
  assert.equal(r.content[2].text, G.VER_NOTE);
  ["image/png", "image/gif", "image/webp"].forEach((mt, i) => {
    const d = [PNG, GIF, WEBP][i];
    assert.equal(G.gateImages("files_read", {}, [{ data: d, mimeType: mt }]).imgs.length, 1, mt);
  });
});

test("a wrong type or first bytes falls back to text", () => {
  for (const x of [{ data: PNG, mimeType: "image/jpeg" }, { data: JPG, mimeType: "image/svg+xml" }, { data: "PHN2Zz48L3N2Zz4=", mimeType: "image/png" },
                   { data: JPG.slice(0, -1), mimeType: "image/jpeg" }, { data: "/9j/" + "*".repeat(40), mimeType: "image/jpeg" }, { data: 5, mimeType: "image/png" }, null]) {
    const p = G.gateImages("files_read", {}, [x]);
    assert.equal(p.imgs.length, 0, JSON.stringify(x).slice(0, 60));
    assert.equal(p.dropped, 1);
  }
  assert.match(G.imgNote(1)[0].text, /could not be passed through orOS Gate.*ocr: true/);
  assert.deepEqual(G.imgNote(0), []);
});

test("an oversized picture is refused by its base64 length", () => {
  const J = b64([0xFF, 0xD8, 0xFF, 0xE0], 32);          // 36 bytes: no padding, so more base64 can follow
  const big = J + "A".repeat(G.IMG_B64 - J.length + 4);
  assert.ok(big.length > G.IMG_B64 && big.length % 4 === 0);
  assert.equal(G.gateImages("files_read", {}, [{ data: big, mimeType: "image/jpeg" }]).imgs.length, 0);
  const fits = J + "A".repeat(G.IMG_B64 - J.length - (G.IMG_B64 - J.length) % 4);
  assert.ok(fits.length <= G.IMG_B64);
  assert.equal(G.gateImages("files_read", {}, [{ data: fits, mimeType: "image/jpeg" }]).imgs.length, 1);
  assert.equal(G.IMG_B64, Math.ceil(512 * 1024 / 3) * 4);
});

test("at most 3 pictures per answer; only files_read; never the apps that are never offered", () => {
  const four = [1, 2, 3, 4].map(() => ({ data: PNG, mimeType: "image/png" }));
  const p = G.gateImages("files_read", {}, four);
  assert.equal(p.imgs.length, G.IMG_MAX);
  assert.equal(p.dropped, 1);
  assert.equal(G.gateImages("search_data", {}, four).imgs.length, 0);
  assert.equal(G.gateImages("files_read", { app: "passwords" }, four).imgs.length, 0);
  for (const pa of ["/internal/Mail/a.png", "Mail/x.jpg", "internal/Passwords/v.png", "Assistant/Chats/a.png", "./Mail/a.png", "././internal/Passwords/b.png"]) {
    assert.equal(G.gateImages("files_read", { path: pa }, four).imgs.length, 0, pa);
  }
  assert.equal(G.gateImages("files_read", { path: "Mailbox art/a.png" }, four).imgs.length, 3);
  assert.deepEqual(G.gateImages("files_read", {}, undefined), { imgs: [], dropped: 0 });
});

test("wiring: only an open device's answer, taken out at once; nothing stored", () => {
  const src = read("relay/gate.js");
  assert.match(src, /let ans = await this\.ask\(p\.name, args\);\n.*\n    const pics = ans && ans\.ok === true && !ans\.e \? gateImages\(p\.name, args, ans\.img\) : \{ imgs: \[\], dropped: 0 \};\n    if \(ans && ans\.img !== undefined\) delete ans\.img;/);
  assert.match(src, /toolText\(typeof ans\.c === "string" \? ans\.c : "", false, ans\.who, pics\.imgs\.concat\(imgNote\(pics\.dropped\)\)\)/);
  assert.equal((src.match(/pics\.imgs/g) || []).length, 1, "the pictures go only into the answer");
  // the device sends at most 3 from files_read, within the answer's room
  const gate = read("gate/gate.js");
  assert.match(gate, /img = res\.ok \? gateImgs\(q\.n, res\.img, 880000 - c\.length\) : null;/);
  assert.match(gate, /if \(name !== "files_read" \|\| !Array\.isArray\(list\)\) return null;/);
  // the Assistant in the Gate frame sends the picture instead of OCR only
  const as = read("assistant/assistant.js");
  assert.match(as, /see = GATE \|\| C\.attCaps\(pid, provConf\(pid\)\)\.img/);
  assert.match(as, /if \(GATE\) prep = prep\.then\(gateFit\);/);
  assert.match(as, /var img = name === "files_read" && Array\.isArray\(r\.pic\)/);
  assert.doesNotMatch(as, /Pictures do not pass through orOS Gate/);
});

test("gate.js gateImgs keeps types, size and room", () => {
  const src = read("gate/gate.js");
  const body = src.slice(src.indexOf("  var GATE_IMG_TYPES"), src.indexOf("  function onCall("));
  const f = new Function("isObj", body + "\nreturn gateImgs;")((o) => !!o && typeof o === "object" && !Array.isArray(o));
  const x = { data: "A".repeat(1000), mimeType: "image/png" };
  assert.equal(f("files_read", [x, x, x, x], 880000).length, 3);
  assert.equal(f("search_data", [x], 880000), null);
  assert.equal(f("files_read", [{ data: "A", mimeType: "image/svg+xml" }], 880000), null);
  assert.equal(f("files_read", [x, x], 1500).length, 1);
  assert.equal(f("files_read", [{ data: "A".repeat(699053), mimeType: "image/jpeg" }], 880000), null);
});
