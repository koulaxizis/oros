# CodeMirror 6 for Pad

Pad (`pad/`) edits text with [CodeMirror 6](https://codemirror.net/)
by Marijn Haverbeke and others, MIT licence (`LICENSE`). The files here
are built once from the npm packages and committed, so orOS itself has
no build step. Pad loads them from this folder only, never from a CDN.

| File | What it holds |
|---|---|
| `cm-core.min.js` | state, view, language, commands, search, autocomplete, @lezer/common, @lezer/lr, @lezer/highlight, exposed as `self.OrosCM` |
| `cm-web.min.js` | JavaScript/TypeScript/JSX, JSON, HTML, CSS, XML, PHP, Markdown |
| `cm-python.min.js`, `cm-go.min.js`, `cm-rust.min.js`, `cm-cpp.min.js`, `cm-java.min.js`, `cm-sql.min.js`, `cm-yaml.min.js` | one language each |
| `cm-legacy.min.js` | stream modes from @codemirror/legacy-modes: shell, TOML, Lua, INI/properties, diff, PowerShell, Dockerfile, Ruby, Perl, C#, Kotlin, Dart, Swift, R, nginx |

Each language file registers factories in `self.OrosCM.lang` and takes
the shared packages from `self.OrosCM`, so the core is loaded once.
Pad loads a language file only when a tab needs it. All files are in
the `sw.js` precache, so Pad works offline.

## Rebuild

The exact versions are pinned in `build/package.json`.

```sh
cd vendor/codemirror/build
npm ci           # the exact versions of package-lock.json
node build.mjs   # writes ../cm-*.min.js, byte for byte the committed files
```

Then run `node --test tests/pad*.test.js` and open Pad in the shell.
Do not edit the `.min.js` files by hand. `build/` is not served or
precached; `node_modules/` stays out of git.
