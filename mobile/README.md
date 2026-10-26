# Glimpse for Android

The Android app, built with Capacitor. It is separate from the server: nothing in this folder goes into the Docker image,
and the server's `package.json` has no Capacitor packages. The app bundles the same interface as the website
(`../src/client`) and talks to whichever Glimpse server the person enters on first launch.

## What you need

- Node 22 or newer
- Java 21 (`JAVA_HOME`)
- The Android SDK (`ANDROID_HOME`) with `platform-tools`, `platforms/android-36` and `build-tools/36.1.0`.
  Android Studio installs all of this.

## Build

```sh
cd mobile
npm install
npm run apk          # debug APK: android/app/build/outputs/apk/debug/app-debug.apk
npm run open         # open the project in Android Studio
```

`npm run build` only bundles the interface into `www/`; `npm run sync` also copies it into the Android project.

## Install on a phone

- **APK file:** copy `app-debug.apk` to the phone and open it (allow "Install unknown apps" for your file manager).
- **USB:** turn on Developer options › USB debugging, plug in, then `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.

## How it fits with the server

- **Sign-in:** the app sends `X-Glimpse-App: 1`; the server then returns a session token instead of setting a cookie.
  The token is kept in the Android Keystore (secure storage) and sent as `Authorization: Bearer`.
- **Media and fonts:** loaded by the WebView itself, so their links carry a file key (`?k=`) that only the file routes accept.
- **Single sign-on:** opens in the phone's browser and returns through `glimpse://auth` with a one-time code, which only
  this app can exchange (PKCE-style) at `/api/auth/app-token`.
- **Plain `http://` home servers:** allowed. The app's pages are served from `http://localhost`, so Android doesn't
  "upgrade" images and videos from an `http://` server to `https://` (which would break them).
- **Versions:** the server reports `server.appApi`; the app refuses servers older than `MIN_SERVER_API` in `src/native.js`
  and asks for an update instead.
