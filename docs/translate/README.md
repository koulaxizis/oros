# Translating orOS

orOS ships in English and Greek. Any other language is a folder of
plain-text files, `i18n/<code>/`, which you can write without touching
code. Whatever is not translated yet shows in English, so a language can
grow one app at a time. Ελληνικά: [README.el.md](README.el.md).

## What is in a language folder

```
i18n/de/
  shell.js        the top bar, the menu, notifications, dialogs
  settings.js     the Settings app
  help.js         the Help app's own buttons
  notes.js        one file per app, named after the app's folder
  help/notes.txt  an app's help page (translated from notes/help.en.txt)
  help/topics/sync.txt   a guide page (from help/topics/sync.en.txt)
  STATUS.md       what is left, per app (written by a script)
  manifest.json   the file list orOS downloads for offline use (script)
```

A pack file looks like this, and nothing else may be in it:

```js
orosPack("de", "notes", {
 "tree.empty": "Noch keine Seiten",
 "page.count": "{n} Seiten"
});
```

The keys and the English text come from the app's `{ en: { … } }` table
(for the shell: `translations.js`). Copy a key, write your text after it.

## The rules (the tests check them)

- Only `"key": "text"` pairs, in double quotes, as JSON. No code.
- Keep every `{name}` placeholder exactly as in English: orOS puts a
  number or a name there. You may move it inside the sentence.
- Keep the same HTML tags as English (`<b>…</b>`), no more, no fewer.
- Only keys the English table has. A key you do not translate yet: leave
  it out (it shows in English), do not copy the English text.
- Product names (Dropbox, orOS, app names that are brands) stay as they are.
- Help pages use the same small format as the English page: `# Title`,
  `## Section`, `- list`, `` `button` ``, `[[Ctrl+Alt+Shift+K]]`,
  `[Text](app:settings)`. Translate the text, keep the marks.
- Greek-only features (name days, Greek holidays, myDATA) stay as they are.

A value that breaks a rule is never shown: orOS falls back to English for
that line, and the pull request's tests say what to fix.

## How to send a translation

Without git: open the file on GitHub, press the pencil (Edit), write,
then "Propose changes". GitHub opens the pull request for you. A new file:
"Add file › Create new file" in the language folder.

With git:

```
node .github/i18n/new-language.js fr "Français" fr-FR   # a new language
node .github/i18n/coverage.js                           # STATUS.md + manifest.json
node --test tests/i18n.test.js tests/i18n-packs.test.js
```

Run `coverage.js` after adding or removing a file: the tests fail when
`manifest.json` is out of date. Every translation gets in only through a
pull request that the maintainer reviews.

## Trying it

Open orOS with `?lang=<code>` (for example `https://useoros.online/?lang=de`).
A new language stays out of the language list ("hidden" in `i18n.js`)
until the shell, Settings and Help are translated; then it is shown, marked
as partly translated until every app is.

## Where orOS stands

Apps switch to packs wave by wave (plan: the apps that load `i18n.js` in
their `index.html`). `STATUS.md` marks the others "English for now". Some
text is still written inside the code instead of the tables; each wave moves
it into the tables, and `tests/i18n.test.js` keeps new code from adding more
(`.github/i18n/inline-baseline.json`).

## For app developers

- Load `i18n.js` first in `index.html`:
  `<script src="../i18n.js" data-app="<id>"></script>`.
- Read the language with `orosI18n.lang()`, build your table once with
  `orosI18n.table(STRINGS, "<id>")`, then look keys up as before
  (`STRINGS[LANG][key]`, English fallback).
- Dates and numbers: `orosI18n.locale()` instead of `el ? "el-GR" : "en-GB"`.
- Plurals: `orosI18n.plural(table, "key", n)` reads `key.one` / `key.few` /
  `key.many` / `key.other` (the language's rules), else `key.one` / `key.some`.
- Every visible text goes into the `{ en, el }` table. No
  `lang === "el" ? "…" : "…"` in new code.
