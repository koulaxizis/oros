import * as esbuild from "esbuild";
await esbuild.build({ entryPoints: ["src/yaml.js"], bundle: true, minify: true, format: "iife", target: "es2019",
  outfile: "../yaml.min.js", legalComments: "none",
  banner: { js: "/* orOS Pad: yaml 2.9.1 by Eemeli Aro. Built by vendor/yaml/BUILD.md from the npm package. ISC licence, see vendor/yaml/LICENSE. */" } });
