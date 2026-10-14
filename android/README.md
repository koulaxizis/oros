# orOS Android app

The Android package of orOS (`online.useoros.twa`): the installed web app
in a Trusted Web Activity, plus native code that shows orOS Contacts and
Calendar in the phone's own Contacts, dialer and Calendar
(BR-PHONE in `OROS_BIBLE.md`). It replaces the PWABuilder package and
uses the same package name and signing key, so it installs as an update.

## Build

GitHub Actions (`.github/workflows/android.yml`) builds it on every
change: open the run, download the `oros-android` artifact.

- `app-oros-debug.apk`: own id (`.debug`), opens with an address bar and has
  no phone bridge (a debug key cannot pass `assetlinks.json`). Proves the
  build only.
- `app-oros-release.apk` / `app-oros-release.aab`: signed when the repository has
  the secrets `OROS_KEYSTORE_BASE64`, `OROS_KEYSTORE_PASSWORD`,
  `OROS_KEY_ALIAS`, `OROS_KEY_PASSWORD` (the PWABuilder signing key).
  The APK is for installing on a phone, the AAB for Google Play.

Locally (Android SDK, JDK 17, Gradle 8.11+):

```
node android/tools/gen.js        # manifest + resources from manifest.webmanifest
gradle -p android assembleDebug
```

## Single apps (wave 7)

The same project also builds some orOS single apps (SOLO-1) as their
own Play packages, listed in `android/solo-apps.json` (app id →
package). Each is a product flavour: `oros` is the orOS app itself
(`online.useoros.twa`, unchanged), the others start at
`https://useoros.online/<id>/solo.html`, carry that app's name, icon,
shortcuts, share target and file types, and only catch links under
`/<id>/`. They leave out the phone bridge (no orOS account, no
Contacts, Calendar or Health Connect permissions, no reminders or
orOS widgets); the code is compiled in but never reached.

`node android/tools/gen.js` writes each overlay to `app/solo-gen/<id>/`
(git-ignored) from `/<id>/manifest.webmanifest` and `icons/solo/`.
Gradle tasks are per flavour (`assembleOrosRelease`,
`bundleNotesRelease`, …); CI uploads `oros-android` (orOS) and
`oros-single-apps` (one folder per app). Every package needs its
statement in `.well-known/assetlinks.json` (upload key, plus Play's
App signing key once the app is on Play).

To add an app: a line in `solo-apps.json` (the app must be in
`solo.js` APPS), its statement in `assetlinks.json`, a Play listing.

## Google Play

Play re-signs the app with its own key: add the "App signing key
certificate" SHA-256 from Play Console to `.well-known/assetlinks.json`
next to the upload key, or the app opens with an address bar and the
phone bridge stays off.
