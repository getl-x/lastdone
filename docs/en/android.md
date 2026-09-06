# Android application

The Android client is a thin Capacitor wrapper around the shared React
application. It packages the web assets inside the APK while connecting data
requests to the public HTTPS LastDone server.

## Server address

There are two supported modes:

1. Set `VITE_LASTDONE_SERVER_URL=https://lastdone.example.com` while building.
   The APK is permanently associated with that origin.
2. Leave the variable empty. The first launch displays a server setup screen,
   verifies `/api/lastdone/health`, and saves the origin in Capacitor
   Preferences. The address can later be reset from Settings.

Only an HTTPS origin without a path, credentials, query, or fragment is
accepted.

## Local notifications

Android does not register a Web Push subscription and does not use FCM. The
application reads synchronized items and user settings from IndexedDB, then
schedules native local notifications for the next 90 days.

The schedule is reconciled after:

- application launch;
- successful synchronization;
- item or reminder-setting changes;
- returning to the foreground;
- network restoration;
- changing notification preferences.

Reminders use inexact Android alarms. The app manifest explicitly removes the
local-notifications plugin's exact-alarm permission. A stable notification ID
and a local schedule ledger prevent repeated catch-up alerts for the same due
occurrence.

## Redmi and HyperOS

After enabling notifications inside LastDone:

1. Open Android settings for LastDone and allow notifications.
2. Set the battery policy to No restrictions.
3. If reminders do not survive a reboot, allow autostart.

System battery management can delay inexact alarms. LastDone intentionally does
not request critical or exact-alarm access.

## Local build inputs

Required tooling:

- Node.js 22.12 or newer
- JDK 21
- Android SDK platform 36 and matching build tools

Create a local web bundle and copy it into the Android project:

```bash
cd source
npm ci
npm run android:sync --workspace @lastdone/web
```

For an unsigned local APK, run Gradle from `source/apps/web/android`. For a
signed release, set:

```text
LASTDONE_KEYSTORE_PATH
LASTDONE_KEYSTORE_PASSWORD
LASTDONE_KEY_ALIAS
LASTDONE_KEY_PASSWORD
LASTDONE_VERSION_NAME
LASTDONE_VERSION_CODE
```

Never place a keystore or its passwords in the repository.

## GitHub release workflow

`.github/workflows/android-release.yml` builds and uploads an APK plus its
SHA-256 file when a `v*` tag is pushed or the workflow is started manually.

Configure these repository secrets:

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

`ANDROID_KEYSTORE_BASE64` is the Base64 representation of the complete JKS
file. Optionally set the repository variable `LASTDONE_SERVER_URL` to bake a
fixed HTTPS origin into the APK. If omitted, the first-launch setup remains
enabled.
