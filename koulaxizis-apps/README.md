# Koulaxizis Apps

One place on an Android phone to install and update every app of our
projects: orOS, NULL JSFX, Noxpress and Glarolykoi. Package `gr.koulaxizis.apps` (permanent). Free and open source
(MIT), no ads, no account, no Google services. Bible: `OROS_BIBLE.md`
APPS-M1, APPS-M2, APPS-M3.

## How it works

- **Sources** (`Source.java`): our own F-Droid repositories, each with its
  signing certificate's SHA-256 pinned in the app.
  | Project | Repository | Fingerprint |
  |---|---|---|
  | orOS | https://koulaxizis.github.io/oros-fdroid/repo | `2A066758DF27F6AFDF6D96F72D575E3E04844B9F85A22A54B7F2C03905A11846` |
  | NULL JSFX | https://koulaxizis.github.io/null-jsfx-fdroid/repo | `1C071614D51503C5ED3260A1B69A0D44CEA6057A5DC6A3ACC3FA7AD130EF64EB` |
  | Noxpress | https://koulaxizis.github.io/noxpress-fdroid/repo | `21441E31A60A89708C6CECE649390C1863EC8CA147F08DA7399AE7646E02EE4E` |
  Glarolykoi (`net.glarolykoi.android`) is published in the orOS repository
  and shown as its own section (`Source.section`): the repository is read
  once and the section takes its packages out of the orOS list.
- **Checks** (`RepoEntry.java`, `Catalog.java`): `entry.jar` must be signed by
  the pinned key; `index-v2.json` must have the size and SHA-256 that the
  signed `entry.json` names; an entry older than the last accepted one is
  refused. A verified index is kept on the phone, so the list also shows
  offline.
- **Install** (`Installer.java`): the APK must come from its repository and
  match the index's size, SHA-256 and signer (checked on the downloaded
  file too) before Android's PackageInstaller gets it. Android asks before
  every first install. Nothing is ever uninstalled.
- **Download count** (`Net.apk`, APPS-DL): APKs of our Pages repositories are
  fetched through the counter `https://apps.koulaxizis.workers.dev/<repo>/…`
  (same bytes, same checks; only a number per app and channel is kept), and
  straight from the repository when the counter fails.
- **Screen** (`MainActivity.java`, `Rows.java`): one section per project,
  featured apps first, then "More apps"; Install, Update, Open, or Why? for
  a copy signed with another key.
- **Updates** (`Updates.java`, `UpdateJob.java`, APPS-M2): "Update all" one
  app after the other; a daily check (JobScheduler, every 12 hours,
  network, battery not low; put back after a restart or an update) shows
  one quiet notification for waiting updates (a new set at once, the same
  set again after three days) and never installs by itself; a bar says
  when notices are off; the manager's own new version shows in a bar at the
  top (signed build only).
- Languages: English, Greek, German.

## Adding a project

Publish its apps in an F-Droid repository (index-v2, `fdroid update`), add
one `Source` line with the repository address and fingerprint, add its
test fixture, and release a new manager version (raise `versionCode` and
`versionName` in `app/build.gradle`).

## Build and test

```
gradle -p koulaxizis-apps testDebugUnitTest assembleDebug     # Android SDK, JDK 17, Gradle 8.11+
python3 koulaxizis-apps/tests/device_test.py app-debug.apk out # running emulator or phone (adb)
```

CI: `.github/workflows/koulaxizis-apps.yml` (unit tests, debug and release
builds, the emulator test against the live repositories; on main the signed
APK as `koulaxizis-apps.apk` on the release `koulaxizis-apps`). The debug
build is `gr.koulaxizis.apps.debug` and never replaces the signed app.

## Where phones get it

The signed APK from the `koulaxizis-apps` release is also in the orOS F-Droid
repository (`.github/workflows/fdroid.yml`, store texts and pictures in
`tools/fdroid/koulaxizis-apps/`), so the manager updates itself from there.
Raise `versionCode` with every change, or phones keep the old one. The
download page links it under "Koulaxizis Apps".

## Signing

Release APKs are signed with the orOS key from the environment
(`OROS_KEYSTORE_FILE`, `OROS_KEYSTORE_PASSWORD`, `OROS_KEY_ALIAS`,
`OROS_KEY_PASSWORD`), filled by the workflow from the repository secrets.
No key is ever committed.
