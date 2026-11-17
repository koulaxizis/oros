# yaml for Pad

Pad (`pad/`) checks and formats YAML and turns it into JSON with
[yaml](https://eemeli.org/yaml/) by Eemeli Aro, ISC licence
(`LICENSE`). The file here is built once from the npm package and
committed, so orOS itself has no build step. Pad loads it from this
folder only, never from a CDN, and only the first time a YAML tool is
used. It is in the `sw.js` precache, so the tools work offline.

| File | What it holds |
|---|---|
| `yaml.min.js` | the whole `yaml` package, exposed as `self.OrosYAML` |

## Rebuild

The exact versions are pinned in `build/package.json`.

```sh
cd vendor/yaml/build
npm ci           # the exact versions of package-lock.json
node build.mjs   # writes ../yaml.min.js, byte for byte the committed file
```

Then run `node --test tests/pad*.test.js` and open Pad in the shell.
Do not edit `yaml.min.js` by hand. `build/` is not served or
precached; `node_modules/` stays out of git.
