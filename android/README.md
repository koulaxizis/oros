# orOS Android app

The Android package of orOS (`online.useoros.twa`): the installed web app
in a Trusted Web Activity, plus native code that shows orOS Contacts and
Calendar in the phone's own Contacts, dialer and Calendar
(BR-PHONE in `OROS_BIBLE.md`). It replaces the PWABuilder package and
uses the same package name and signing key, so it installs as an update.

## Build

GitHub Actions (`.github/workflows/android.yml`) builds it on every
change: open the run, download the `oros-android` artifact.

- `app-debug.apk`: own id (`.debug`), opens with an address bar and has
  no phone bridge (a debug key cannot pass `assetlinks.json`). Proves the
  build only.
- `app-release.apk` / `app-release.aab`: signed when the repository has
  the secrets `OROS_KEYSTORE_BASE64`, `OROS_KEYSTORE_PASSWORD`,
  `OROS_KEY_ALIAS`, `OROS_KEY_PASSWORD` (the PWABuilder signing key).
  The APK is for installing on a phone, the AAB for Google Play.

Locally (Android SDK, JDK 17, Gradle 8.11+):

```
node android/tools/gen.js        # manifest + resources from manifest.webmanifest
gradle -p android assembleDebug
```

## Google Play

Play re-signs the app with its own key: add the "App signing key
certificate" SHA-256 from Play Console to `.well-known/assetlinks.json`
next to the upload key, or the app opens with an address bar and the
phone bridge stays off.
