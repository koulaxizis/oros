# orOS Changelog

Static OS shell living in the browser. Hosted at https://useoros.online
(GitHub Pages via custom domain; repo: github.com/koulaxizis/oros).
Single permanent "dev" channel, always stable. Dark theme default with
light toggle in Appearance. EN default, EL secondary. 24h clock.
Privacy-first: no cookies, no tracking, no ads. MIT.

---

## MANTRA (design contract for EVERY orOS app — never violate)

Offline first · Mobile first · No external dependencies ·
Full project manual export · Full project automatic export ·
Full project snapshots · Full project auto-merge sync ·
**No guessing:** if unsure about ANYTHING, ASK. If a file is
missing, REQUEST it. Never guess, never assume, never infer
file contents or directory structure. Always work from the
files the user provides in-chat, verbatim.

Standing process rules (derived from live incidents):
- Never REGENERATE a working file wholesale when patching —
  append surgical deltas to the file the user confirms works.
- Version ritual is not optional: APP_VERSION (shell.js) +
  sw.js CACHE_VERSION + core index.html ?v= + app index.html ?v=
  + manifest — ALL of them, EVERY release. Undeployed/stale
  bundles look exactly like broken code (cost us TWO debug
  sessions: v0.13.1 sync, v0.14.1 labels).
- After delivering code, next deploy step is exact patch
  instructions ("paste location for every patch") — the user
  applies with zero ambiguity.
- Multi-device test rule (Lesson 4): verify BOTH devices run
  the new code (version badge + data ver + console markers)
  BEFORE interpreting test results.

---

## CURRENT STATE

- **VERIFIED WORKING:** merge sync end-to-end (To-Do, Kanban);
  Notes app shipped v0.14.1 with labels (data layer verified —
  state.labels populated, attach/detach, "lbl:" tombstones).
- **LIVE:** sync.js v0.8.1 (baselines + divergence guard),
  shell v0.13.1-era logic, Notes v0.14.1, Kanban v0.5
  (DATA_VER 4), To-Do v0.4 (DATA_VER 3).
- **NEXT (Wave 2, Notes — in order):**
  2) exports (.txt per page + notebook zip — must satisfy
     Full project manual export, mantra item)
  3) wiki-links [[Page]] with creation-on-click
  4) tags aggregation side-panel (built on labels layer —
     ZERO migration needed, by design)
  5) search (titles + content, ctrl+k, session-only)
- **Backlog:** Kanban/To-Do per-field merges; schema-aware
  generic union for mergeless closed apps; snapshot
  compression; Restore button dedicated icon.

---

## REFERENCE REGISTRIES (read first in a new chat)

### File tree (repo root)
- index.html — markup + INLINE update broker script (must stay inline!)
- style.css — shell styling (16-skin × 12-var palettes, dark/light)
- shell.js — shell logic; APP_VERSION constant on top (single release key)
- translations.js — OROS_TRANSLATIONS (EN/EL) + window.t() fallback
  chain (active → en → key)
- sync.js — window.orosSync v0.8.1 (loads BEFORE shell.js)
- apps.json — installed apps registry:
  {"name","url","category","icon"} internal; type "external" → new tab
- sw.js — CACHE_VERSION per deploy; PRECACHE includes notes/*, todo/*,
  kanban/*, fonts/*
- manifest.webmanifest — versioned; theme_color #1b1a18
- icon.svg + icons/ (4 PNGs: any+maskable 192/512, maskable 62%)
- todo/ — To-Do (DATA_VER 3, merge-capable)
- kanban/ — Kanban (DATA_VER 4, merge-capable)
- notes/ — Notes (index.html, notes.css, notes.js — DATA_VER 2)
- fonts/ — local Nunito woff2 (5 weights, Greek subset required)
- .github/workflows/bump-version.yml — stamps sw.js CACHE_VERSION +
  manifest version + ?v= on every relative .css/.js ref (root AND app
  index.html files) from shell.js APP_VERSION on push to main

### localStorage keys (registry)
- oros-lang / oros-theme / oros-skin / oros-wallpaper — synced (shell slice)
- oros-sync-interval — user-configurable, travels in shell slice
- oros-autoexport — mode off/daily/weekly/monthly, travels in shell slice
- oros-sync-dirty — dirty flag (persisted; discriminator part of v0.8.1)
- oros-sync-baselines — per-slice hash of last-synced content (v0.8.1)
- oros-vault-data — sealed passphrase (trusted device vault)
- oros-last-version — DEVICE-LOCAL (welcome/update toast)
- oros-slices — persisted registry name→storageKey (closed-app proxies)
- oros-remote-carry — mailbox: unknown remote slices + parked diverged remotes
- oros-auto-snapshots — rolling window, max 5, device-local, unencrypted
- oros-autoexport-last — epoch ms of last check, device-local
- oros-fs-folder-name / oros-fs-lapsed — FS Access folder backups (Chromium)
- oros-db-access/refresh/expiry/account — Dropbox tokens + cached account
- oros-todo-data — To-Do (slice "todo")
- oros-kanban-data — Kanban (slice "kanban")
- oros-notes-data — Notes (slice "notes", DATA_VER 2)
- oros-notes-prefs — Notes DEVICE-LOCAL prefs ({open, current, width})

### Sync architecture (sync.js v0.8.1 — merge era)
- Payload: { shell, apps: { <name>: ... }, meta }. One encrypted blob
  /orOS-data.json (Dropbox app folder), AES-GCM + PBKDF2 100k rounds,
  PKCE OAuth (redirect_uri MUST include trailing "/"), token refresh
  5-min early, automatic remote backups max 5 (pruned).
- **Slice contract:** registerSlice(name, get, set, storageKey?, mergeFn?).
  storageKey → persisted to oros-slices → closed-app boots hydrate
  mergeless proxies (app data travels even when the app is closed).
  mergeFn(local, remote) → merged. Must be DETERMINISTIC + SYMMETRIC:
  merge(A,B) === merge(B,A) INCLUDING ties. Tie-breaks: mtime first,
  then lexicographic JSON (NEVER `(a) >= (b) ? a : b` — favors local,
  causes ping-pong; burned us once, see v0.10.1). mergeFn throw
  degrades slice to LWW (sync never blocks).
- **Setter contract:** set(data, info) — info.merged===true = value
  came from a merge (apps show toast). Pull-fed setters NEVER
  markDirty (loop rule: pull → set → dirty → push → …). User-action
  handlers DO markDirty.
- **Baselines + divergence guard (v0.8.1):** oros-sync-baselines holds
  djb2 hash of last-synced content per slice (recorded on every push
  + clean apply). UNPUSHED = dirty flag OR baseline missing OR hash
  mismatch. A mergeless slice with unpushed local work NEVER accepts
  remote overwrite — remote parks in carry mailbox, local pushes as
  new truth. Parked remotes flush at live registration THROUGH
  mergeFn. ACCEPTED LIMIT: two devices offline-editing the same
  CLOSED app converge when one opens it live.
- **Engine triggers:** boot / interval (user-set, default 3min) /
  tab-VISIBLE / "online" event / app-register (~100ms) / debounce
  (5s after last edit) → full RECONCILE (pull → merge → push if
  dirty). Tab-HIDE → push-only. Guards: reconcileInFlight /
  pushInFlight; navigator.onLine gates all. DEBOUNCE_MS = 5000.
- **Convergence rule:** merge result ≠ remote ⇒ cloudStale ⇒ markDirty
  ⇒ next push uploads it. Deterministic merges make both devices
  push IDENTICAL payloads — ping-pong self-extinguishes.
- **importData** (manual backup restore) passes through the same
  merge-aware apply path — an old rescue file can't clobber newer
  local work.
- **Sync UI (shell):** connect/pull/push/interval select/forget/
  disconnect + passphrase flow (eye toggle, remember checkbox,
  device vault). Status dot pulses during auto-sync (onAutoSync).

### Shell slice
{ lang, theme, skin, wallpaper, syncInterval, autoexport } — all synced.
Defaults: skin "oros", wallpaper "sand", theme dark, lang en.
SKINS: 16 total (adwaita, lumo, oros, ubuntu, fedora, mint, arch,
debian, elementary, tux, manjaro, opensuse, nixos, gentoo, popos,
zorin) — each ships full 12-var palettes × dark/light in style.css.
WALLPAPERS: 15 pure-CSS gradients in a JS registry (inline styles —
WYSIWYG thumbs, specificity-proof). Wallpaper-skin pairing suggests
ONLY from default wallpaper, ONLY on user clicks, never on pulls.

### Palette vocabulary (shell contract for EVERY iframe app)
CSS vars: --bg, --bg-desktop, --bar-bg, --text, --text-dim, --accent,
--accent-hover, --accent-soft, --panel-bg, --border, --shadow.
Apps inherit them at boot via inheritPalette() (parent <html> computed
styles, same-origin iframe) + MutationObserver on data-skin/data-theme.
App :root values = oros-skin standalone fallback ONLY.

### orOS iframe-app contracts (v0.13.1 ARCHITECTURE REFERENCE)
- orosSync lives on window.parent when embedded — apps MUST resolve:
  syncApi() = (window.parent && window.parent.orosSync) || window.orosSync
  Asking window.orosSync directly silently kills slice registration
  inside the shell (the v0.13.1 Notes bug).
- i18n: apps carry their OWN STRINGS dicts; lang detected from parent
  orosLang. Keys must match the HTML data-i18n / data-i18n-ph
  attributes EXACTLY (v0.14.1 lesson: renaming keys leaks raw keys).
- HTML ships icon buttons EMPTY; JS injects inline SVGs at wire time
  (paintStaticIcons pattern). Handcrafted SVG only — ForkAwesome
  permanently rejected.
- Sw fetch strategy: cache-first assets (no revalidation) — the ONLY
  stale-asset escape hatch is CACHE_VERSION bump. Hence the ?v= ritual.

### Notes data model (notes.js v0.14.1, DATA_VER 2)
state = { ver: 2, pages: [...], labels: [...], tombs: {...} }
- page: { id, parent, title, text, mtime, pos, labels: [labelId,...] }
- label: { id, name, color, mtime, pos } — 8-color palette
  (e06c75, ecc75f, 87cf3e, 4fc4cf, 6d4aff, e09ecf, f28c5a, 9aa4b0)
- tombs: pageId → ts, AND "lbl:"+labelId → ts (shared map, additive
  so DATA_VER 1→2 needed no rewrite). Delete wins ties (>=); 30d prune.
- mergeNotesStates: pages per-id LWW (mtime, tie → lex JSON); labels
  per-id LWW + "lbl:" tomb filter; tombs union max-ts; dead label
  refs pruned from pages; normalizeState (idempotent: orphan → ROOT,
  cycle guard, label-ref pruning, dedupe) runs after EVERY apply.
- Autosave: debounced 500ms (queueSave/flushSave), flush on
  page-switch / tab-hide / beforeunload. saveNow() normalizes first.
- Labels UI: context menu → picker popover (toggle rows, inline
  create with swatches, delete with confirm) · chips in editor
  header (click chip → picker) · dots on tree rows.
- Prefs device-local: { open, current, width } in oros-notes-prefs.
- i18n key vocab (must match HTML): notes.app, notes.new.page,
  notes.title.ph, notes.text.ph — plus app-internal keys
  (page.*, labels.*, toast.*, tree.*).
- Debug handle: window.__notesDebug = { version, state, merge,
  sliceGet }.

### To-Do data model (todo.js v0.4, DATA_VER 3 — canonical merge template)
state = { ver: 3, sm, om, activeList, hideCompleted, deleted: {id: ts},
labels: [{id,name,color,mtime,pos}], lists: [{ id, name, mtime, om, pos,
recurrence, lastReset, nextReset, items: [{ id, text, done, due, notes,
labels, info, recurrence, mtime, om, pos }] }] }
- Entities carry mtime (content version); collections carry om
  (ordering version) + per-item pos; root scalars by sm. Missing
  stamps = 0 = oldest (real remote data always wins after migration).
- renderAll() re-syncs ALL DOM-bound controls (checkboxes etc.) —
  a merge state change must never leave stale visuals.
- Search/filter SESSION-ONLY (a pull must not resurrect stale views).

### Kanban data model (kanban.js v0.5, DATA_VER 4)
- Card mtime = content INCLUDING column placement (cross-column
  drags touch the card → moves win merges). Column om = card order;
  root om = column order. Orphan rule: card whose column died stays
  dead (cascade tombstones). Delete-label touches every card that
  wore it. Undo = stampAll() including ordering stamps.

---

## RELEASE RITUAL (locked)

1. Change whatever (shell.js, sync.js, translations.js, style.css, apps/…).
2. Bump APP_VERSION = "X.Y.Z" in shell.js — the single release key.
3. GitHub Action auto-stamps sw.js CACHE_VERSION, manifest version,
   AND ?v= on every relative .css/.js ref (root + app index.html) on
   push to main. Fails loudly if lines are missing. If the Action
   ever fails, stamp manually — never ship an unbumped deploy.
4. CHANGELOG entry per change (English, "why" included).
5. Multi-device features: verify BOTH devices run the new code before
   interpreting results (Lesson 4).

INCIDENT LESSON (twice now): deploys that change assets without a
version bump strand mobile on stale cache-first SW assets — the
symptom set is indistinguishable from broken code. The ?v= stamp
must include APP-LEVEL index.html refs (notes/index.html etc.), not
just root files.

---

## RELEASE HISTORY (condensed — details above in registries)

- v0.x — Core shell: GNOME top bar, fullscreen iframe apps, i18n,
  skins/wallpapers (16/15), PWA install, 24h clock.
- v0.1 — Offline-first SW + mobile-first CSS.
- v0.2 — Dropbox sync: PKCE OAuth, AES-GCM blob, slices.
  v0.2.1–2: menu/eye UX. v0.3: device vault + auto-sync engine.
  v0.3.5: update broker INLINE in index.html (root fix).
  v0.4: skins/wallpapers systems. v0.5: To-Do app + ?v= Action.
  v0.6: persisted slices + carry-forward (closed-app data loss fix).
  v0.7: Kanban app (waves 1–3: subtasks, labels, filters, reorder).
  v0.9: To-Do Kanban-pattern port (labels, search, info).
- v0.10.0 — MERGE ERA (verified live): mergeFn slice API,
  sync-on-change debounce, To-Do v0.4 full merge.
- v0.10.1 — Symmetric tie-breaks (5 patches), renderAll DOM re-sync,
  reconcile-on-register, Lesson 4 (verify both devices first).
- v0.11.0 — Kanban merge port (DATA_VER 4) + sync v0.8 divergence
  guard (offline closed-app wipe fix) + v0.8.1 bootstrap fix
  (unpushed = dirty OR baseline mismatch — armed dirty can NEVER
  accept remote overwrite).
- v0.12.0 — 6 new skins, 5 composite wallpapers, auto-backup
  snapshots (rolling 5, localStorage, on-change-only, device-local).
- v0.12.1 — Snapshot status line + FS Access folder backups
  (Chromium desktop, permission-lapse aware).
- v0.13.0 — NOTES app Wave 1: Zim-style tree, plain text, LWW merge,
  tombs, debounce autosave, device-local prefs, mobile overlay.
- v0.13.1 — Notes theming fix (palette vocabulary + inheritPalette)
  + sync bonding fix (parent-window orosSync resolution).
  ROOT CAUSE FOUND IN DEPLOY DEBUG: bundle was never deployed
  (sw.js never bumped, notes/* absent from precache) — the release
  ritual gap, not the code.
- v0.14.0 — Notes labels (Wave 2 item 1): registry, attach/detach,
  chips, dots, merge extension, DATA_VER 2. Regressed UI contracts
  (see 0.14.1 WHY).
- v0.14.1 — Regression fixes: button icon injection restored, i18n
  keys realigned to HTML vocabulary, label styles reach devices
  (?v= bumped), label chips in editor header. STANDING LESSON:
  never regenerate whole files when patching.