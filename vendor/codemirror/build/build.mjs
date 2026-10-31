import * as esbuild from "esbuild";
const SHARED = { "@codemirror/state": "state", "@codemirror/view": "view", "@codemirror/language": "language",
  "@codemirror/commands": "commands", "@codemirror/search": "search", "@codemirror/autocomplete": "autocomplete",
  "@lezer/highlight": "highlight", "@lezer/common": "common", "@lezer/lr": "lr" };
const shared = { name: "shared", setup(b) {
  b.onResolve({ filter: /^@(codemirror|lezer)\/[a-z-]+$/ }, (a) => SHARED[a.path] ? { path: a.path, namespace: "cmshared" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "cmshared" }, (a) => ({ contents: "module.exports = self.OrosCM." + SHARED[a.path] + ";", loader: "js" }));
} };
const banner = (n) => "/* orOS Pad: CodeMirror 6 " + n + " bundle. Built by vendor/codemirror/BUILD.md from the npm packages listed there. MIT licence, see vendor/codemirror/LICENSE. */";
const names = ["core", "web", "python", "go", "rust", "cpp", "java", "sql", "yaml", "legacy"];
for (const n of names) {
  await esbuild.build({ entryPoints: ["src/" + n + ".js"], bundle: true, minify: true, format: "iife", target: "es2019",
    outfile: "../" + (n === "core" ? "cm-core" : "cm-" + n) + ".min.js", legalComments: "none",
    banner: { js: banner(n) }, plugins: n === "core" ? [] : [shared] });
}
