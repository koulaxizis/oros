// Whiteboard wave DG4: draw.io files in and out, Mermaid flowcharts in
// (whiteboard/diagram.js), and the Assistant's mermaid command.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const C = require("../whiteboard/core.js");
const D = require("../whiteboard/diagram.js");
const CMD = require("../whiteboard/commands.js");

const SAMPLE = fs.readFileSync(path.join(__dirname, "fixtures/whiteboard-sample.drawio"), "utf8");
const inflate = (b) => Promise.resolve(zlib.inflateRawSync(Buffer.from(b)).toString("utf8"));
const ids = () => { let n = 0; return () => "o" + n++; };
const read = (txt) => D.readDrawio(txt, inflate, ids());
const byText = (objs, tx) => objs.find((o) => o.tx === tx);

test("draw.io in: shapes become symbols, colours the nearest of the ten, the page starts at 0, 0", async () => {
  const r = await read(SAMPLE);
  assert.equal(r.pages.length, 1); assert.equal(r.pages[0].name, "Flow");
  const o = r.pages[0].objs;
  const start = byText(o, "Start"), db = byText(o, "Orders"), done = byText(o, "Done"), srv = byText(o, "Web server");
  assert.deepEqual([start.shp, start.c, start.f, start.x, start.y], ["ellipse", "green", "soft", 0, 0]);
  assert.deepEqual([db.sym, db.c, db.f], ["database", "blue", "soft"]);
  assert.deepEqual([done.sym, done.c, done.f], ["terminator", "red", "solid"]);
  assert.equal(srv.sym, "server", "a network stencil of another library still finds its icon");
  const dec = byText(o, "Paid?\nyes & no");
  assert.ok(dec, "HTML label: <br> is a new line, tags and entities go");
  assert.deepEqual([dec.shp, dec.f, dec.c], ["diamond", "none", "ink"], "draw.io's default white box with a black line");
  assert.equal(r.simplified, 1, "the BPMN task came in as a plain shape");
  assert.equal(byText(o, "Odd").shp, "rect");
  // a swimlane is a frame, and what is inside it is placed absolutely
  const lane = o.find((x) => x.k === "frame"), inv = byText(o, "Invoice");
  assert.equal(lane.tx, "Billing");
  assert.deepEqual([inv.x - lane.x, inv.y - lane.y, inv.shp], [20, 40, "round"]);
  // a UML class (swimlane with a stack of rows) keeps its compartments
  const cls = o.find((x) => x.sym === "class");
  assert.equal(cls.tx, "Order\n--\n+ id: int\n--\n+ pay(): void");
  // a free text, its label as plain text
  const note = o.find((x) => x.k === "text");
  assert.equal(note.fs, 18);
  assert.ok(!/[<>]/.test(note.tx), "no markup gets through: " + note.tx);
  // every object passes the core's own checks unchanged
  const d = C.apply(C.putBoard(C.empty(), "b1", "x", 1), C.index(o.map((x) => Object.assign({ b: "b1" }, x))), 2);
  assert.equal(d.objs.length, o.length);
});

test("draw.io in: edges stick to their ends, with route, sides, UML heads, dashes and labels", async () => {
  const o = (await read(SAMPLE)).pages[0].objs, m = C.index(o);
  const arrows = o.filter((x) => x.k === "arrow");
  assert.equal(arrows.length, 5);
  const [e1, e2, e3, e4, e5] = arrows;
  assert.deepEqual([m[e1.ao].tx, m[e1.bo].tx.split("\n")[0], e1.rt, e1.ap, e1.bp], ["Start", "Paid?", "elbow", "b", "t"]);
  assert.deepEqual([e2.tx, e2.ds, e2.ha, e2.hb, e2.hd], ["save", true, "none", "tri", "end"]);
  assert.deepEqual([e3.tx, e3.rt, e3.ha, e3.hb, e3.hd], ["done", "curve", "dot", "dia", "both"], "the edge label cell joins the edge");
  assert.equal(m[e4.ao].sym, "class", "an edge from a row of a class starts at the class");
  assert.deepEqual([e4.ha, e4.hb, e4.hd], ["none", "none", "none"]);
  assert.deepEqual([e5.ao, e5.bo, e5.bx - e5.ax], ["", "", 80], "a free line keeps its points");
});

test("draw.io in: compressed pages, several pages, a .drawio.svg; bare models too", async () => {
  const model = SAMPLE.slice(SAMPLE.indexOf("<mxGraphModel"), SAMPLE.indexOf("</mxGraphModel>") + 15);
  const packed = zlib.deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64");
  const two = '<mxfile><diagram name="One">' + packed + '</diagram><diagram name="Two">' + model + "</diagram></mxfile>";
  const r = await read(two);
  assert.deepEqual(r.pages.map((p) => p.name), ["One", "Two"]);
  const key = (p) => p.objs.map((o) => [o.k, o.sym || o.shp || "", o.tx, o.x, o.y].join("|")).join("\n");
  assert.equal(key(r.pages[0]), key(r.pages[1]));
  await assert.rejects(D.readDrawio(two, null, ids()), /compressed/, "no inflate given");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" content="' + two.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;") + '"><g/></svg>';
  assert.equal((await read(svg)).pages.length, 2);
  assert.equal((await read(model)).pages.length, 1);
});

test("draw.io in: a DOCTYPE or ENTITY, broken XML, other files and huge files are refused", async () => {
  await assert.rejects(read('<!DOCTYPE x [<!ENTITY a "b">]><mxfile><diagram>&a;</diagram></mxfile>'), /doctype/);
  await assert.rejects(read("<mxfile><diagram><mxGraphModel><root></mxGraphModel></diagram></mxfile>"), /xml/);
  await assert.rejects(read("<html><body>hi</body></html>"), /notdrawio/);
  await assert.rejects(read("not xml at all"), /xml/);
  await assert.rejects(read("x".repeat(D.MAX_FILE + 1)), /big/);
  // deep nesting stops
  await assert.rejects(read("<mxfile>" + "<a>".repeat(70) + "</a>".repeat(70) + "</mxfile>"), /deep/);
  // numeric references decode, unknown ones stay as written
  const x = D.parseXml('<a v="&#65;&#x42;&bogus;&lt;"/>');
  assert.equal(x.attrs.v, "AB&bogus;<");
});

test("draw.io out: what goes out comes back the same (symbols, colours, fills, heads, frames, notes, text, pictures)", async () => {
  const o = (await read(SAMPLE)).pages[0].objs.concat([
    { id: "n1", k: "note", x: 900, y: 0, w: 200, h: 200, tx: "Idea \"quoted\" & <tagged>\nline 2", c: "yellow", z: 50 },
    { id: "p1", k: "pen", x: 0, y: 700, w: 100, h: 50, pts: [0, 0, 50, 50, 100, 0], sw: 3, c: "ink", z: 51 },
    { id: "i1", k: "image", x: 300, y: 700, w: 10, h: 10, src: "data:image/png;base64,iVBORw0KGgo=", c: "ink", z: 52 },
  ]);
  const xml = D.writeDrawio(o, "Flow & <co>");
  assert.ok(D.parseXml(xml), "well-formed");
  assert.match(xml, /<diagram name="Flow &amp; &lt;co&gt;"/);
  assert.match(xml, /orosSym=database;/);
  assert.match(xml, /image=data:image\/png,iVBORw0KGgo=;/, "draw.io's data URI form");
  const back = (await read(xml)).pages[0].objs;
  const key = (x) => [x.k, x.sym || x.shp || "", x.tx || "", x.c, x.f || "", x.rt || "", x.ha || "", x.hb || "", x.ds ? 1 : 0, x.src || ""].join("|");
  assert.deepEqual(back.map(key).sort(), o.map(key).sort(), "same objects");
  // places and sizes too, and the drawing's points
  const at = (x) => x.k === "arrow" ? "" : [x.k, x.tx || "", x.x, x.y, x.w, x.h].join("|");
  assert.deepEqual(back.map(at).sort(), o.map(at).sort());
  assert.deepEqual(back.find((x) => x.k === "pen").pts, [0, 0, 50, 50, 100, 0]);
});

test("Mermaid: boxes, shapes, links, labels, dashes, heads, &, chains and subgraphs", () => {
  const r = D.readMermaid([
    "flowchart TD",
    "  A([Start]) --> B{Is it ok?}",
    "  B -- yes --> C[Ship it]",
    "  B -->|no| D[(Fix DB)]",
    "  D -.-> B",
    "  C & D --> E((End))",
    "  E --- oscar[\"Oscar <b>bold</b>\"]",
    "  F[/In/] <--> G{{Prep}} --o H[[Sub]]",
    "  subgraph S1 [Release]",
    "    C",
    "  end",
    "  %% a comment",
    "  click A call x()",
    "  classDef big font-size:20px",
  ].join("\n"), ids());
  assert.equal(r.err, undefined);
  const o = r.objs, sh = (t) => o.find((x) => x.k === "shape" && x.tx === t);
  assert.deepEqual(["Start", "Is it ok?", "Ship it", "Fix DB", "End", "In", "Prep", "Sub"].map((t) => sh(t).sym || sh(t).shp),
    ["terminator", "decision", "rect", "database", "ellipse", "data", "preparation", "predefined"]);
  assert.ok(sh("Oscar bold"), "quoted text, tags dropped, the id after --- is a node (not a head)");
  const ar = o.filter((x) => x.k === "arrow"), lab = (t) => ar.find((x) => x.tx === t);
  assert.ok(lab("yes") && lab("no"));
  assert.equal(ar.filter((x) => x.ds).length, 1);
  assert.equal(r.edges, 9);
  assert.ok(ar.some((x) => x.ha === "arrow" && x.hb === "arrow" && x.hd === "both"));
  assert.ok(ar.some((x) => x.hb === "dot"));
  assert.ok(ar.some((x) => x.ha === "none" && x.hb === "none" && x.hd === "none"));
  const fr = o.find((x) => x.k === "frame");
  assert.equal(fr.tx, "Release");
  const c = sh("Ship it");
  assert.ok(c.x > fr.x && c.y > fr.y && c.x + c.w < fr.x + fr.w && c.y + c.h < fr.y + fr.h, "the frame holds its box");
  // top to bottom: Start above the decision above the end
  assert.ok(sh("Start").y < sh("Is it ok?").y && sh("Is it ok?").y < sh("End").y);
  // no two boxes overlap
  const boxes = o.filter((x) => x.k === "shape");
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), a.tx + " / " + b.tx)));
  // every object passes the core's checks
  const d = C.apply(C.putBoard(C.empty(), "b1", "x", 1), C.index(o.map((x) => Object.assign({}, x, { b: "b1" }))), 2);
  assert.equal(d.objs.length, o.length);
});

test("Mermaid: LR goes left to right; not a flowchart, empty and too long are refused; big ones are cut", () => {
  const r = D.readMermaid("graph LR; a-->b; b-->c", ids()), s = (t) => r.objs.find((x) => x.tx === t);
  assert.ok(s("a").x < s("b").x && s("b").x < s("c").x);
  assert.match(D.readMermaid("sequenceDiagram\nA->>B: hi", ids()).err, /only flowcharts/);
  assert.match(D.readMermaid("   ", ids()).err, /empty/);
  assert.match(D.readMermaid("graph TD\n" + "x".repeat(D.MAX_MERMAID), ids()).err, /longer/);
  const many = ["graph TD"];
  for (let i = 0; i < 520; i++) many.push("n" + i + " --> n" + (i + 1));
  const big = D.readMermaid(many.join("\n").slice(0, D.MAX_MERMAID), ids());
  assert.equal(big.nodes, D.MAX_NODES); assert.equal(big.cut, true);
});

test("Assistant: mermaid draws to the right of the board; bad text goes back to the model", () => {
  assert.match(CMD.GUIDE, /^mermaid: /m);
  assert.match(CMD.check([{ op: "mermaid", text: "sequenceDiagram\nA->>B: hi" }]).err, /only flowcharts/);
  assert.match(CMD.check([{ op: "mermaid" }]).err, /text is missing/);
  const d = C.apply(C.putBoard(C.empty(), "b1", "B", 1), { s: { id: "s", b: "b1", k: "shape", shp: "rect", f: "soft", c: "blue", x: 0, y: 0, w: 100, h: 60, tx: "Old", z: 1 } }, 2);
  const w = CMD.work(d, "b1"), env = { now: 10, newId: ids(), notes: [] };
  CMD.apply(w, { op: "mermaid", text: "graph TD\nA[One] --> B[Two]" }, env);
  const all = C.objsOf(w.data, "b1"), m = C.index(all), one = all.find((x) => x.tx === "One"), two = all.find((x) => x.tx === "Two");
  assert.ok(one.x >= 100 + 80, "to the right of what was there");
  assert.ok(one.y < two.y);
  const ar = all.find((x) => x.k === "arrow");
  assert.deepEqual([m[ar.ao].tx, m[ar.bo].tx], ["One", "Two"]);
  const e = C.ends(ar, m);
  assert.deepEqual([ar.ax, ar.ay], [Math.round(e.a.x), Math.round(e.a.y)], "the kept ends are where it is drawn");
});

test("the app speaks of draw.io and Mermaid in EN, EL and DE, exports .drawio, loads diagram.js on use, and the help says so", () => {
  const app = fs.readFileSync(path.join(__dirname, "../whiteboard/app.js"), "utf8");
  const de = fs.readFileSync(path.join(__dirname, "../i18n/de/whiteboard.js"), "utf8");
  ["m.drawio", "m.mermaid", "dio.added", "dio.added1", "dio.simpl", "dio.skip", "dio.cut", "dio.bad", "dio.big", "dio.old",
    "mmd.title", "mmd.lbl", "mmd.hint", "mmd.draw", "mmd.bad", "mmd.added", "mmd.cut"].forEach((k) => {
    assert.equal((app.match(new RegExp('"' + k.replace(/[.]/g, "\\.") + '":', "g")) || []).length, 2, "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  });
  assert.match(app, /drawio: \{ ext: "\.drawio", mime: "application\/vnd\.jgraph\.mxfile"/);
  assert.match(app, /\["drawio", "draw\.io"\]/);
  assert.match(app, /loadScript\("diagram\.js"\)/);
  assert.ok(!fs.readFileSync(path.join(__dirname, "../whiteboard/index.html"), "utf8").includes("diagram.js"), "loaded on first use");
  ["en", "el"].forEach((l) => {
    const h = fs.readFileSync(path.join(__dirname, "../whiteboard/help." + l + ".txt"), "utf8");
    assert.match(h, /draw\.io/); assert.match(h, /Mermaid/);
  });
});
