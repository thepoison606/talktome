# Talktome Mobile App

Native iOS and Android intercom client for Talktome, built with Expo,
React Native and TypeScript. The server is selected at runtime.

The app includes:

- Server/account profiles, guest login, production selection and QR login links.
- WebRTC talk/listen, per-target volume and mute, Reply and locked talk buttons.
  Hold several target buttons at once to address them together; releasing one
  button leaves the others active. Main/Reply and target cards own separate holds.
- Server remote-panel control and synchronized operator preferences.
- Drag target handles in Edit targets to reorder them, with edge scrolling and automatic saving.
  The order is shared with the browser for the selected production.
- Live speaker names on conference cards, including listen-only conferences.
- Automatic reconnect with cancellation of superseded connection attempts.
- Admin Status diagnostics: installed app version/build, active audio output, battery
  percentage/charging state, network type, and WebRTC RTT/audio packet loss. Diagnostics
  are sent to the selected Talktome server while connected; unavailable values stay empty.
  Battery and network reporting require a native rebuild after installing these modules.
- Background audio, the native iOS audio route picker and Android foreground service.
  iOS owns the selected output; saved choices from the former app menu are ignored.
- BLE push-to-talk accessories, including PTT-Z01 and Herda HB980-Plus profiles.
- iOS Live Activities, widgets and shortcuts; Android session widget.
- Apple Watch talk remote; audio stays on the iPhone. Under Accessories → Watch targets,
  choose Reply and/or fixed talk targets per profile and production. One chosen target
  fills the Watch screen; two targets use fixed upper/lower buttons, and more use a list.
  Reply keeps its own button even when it addresses a selected fixed target; without
  a recent caller it stays visible but unavailable, keeping the chosen layout stable.
  Hold and swipe left to lock talk in any layout; tap the full-screen display to stop.
  While talking, the target and swipe hint sit near the top of the full-screen display. The ready
  beep plays through the selected external iPhone audio output, or on Watch when
  no external output is selected. The default is all targets.
- Per-host certificate pinning for self-hosted servers with self-signed TLS.

## Development

Use Node.js 22, an Android SDK/JDK 17 for Android, and macOS/Xcode for iOS.
This app requires native modules and a development build; Expo Go is insufficient.
Install dependencies independently of the server at the repository root:

```bash
cd mobile-app
npm ci
npm test
npm run typecheck
# On macOS, also test the native audio-route preference logic:
npm run test:ios-audio-routes
npx expo run:android
# On macOS:
npx expo run:ios
```

Start Metro for an installed development build with `npm start`.
Rebuild the native binary after changing native modules or config plugins.
The generated `android/` and `ios/` folders are ignored; local Expo modules in
`modules/` and Apple extension sources in `targets/` are committed.

### Dependency security

CI runs `npm audit --audit-level=high` for the complete mobile dependency tree,
including development tools. The SDK 56 toolchain needs four overrides:

- `@expo/metro` 56.1.0 uses Metro 0.84.6, which replaces the vulnerable
  `image-size` dependency with Metro's own image readers.
- `@xmldom/xmldom` versions below 0.9 use the patched 0.8 line. This also covers
  the older plist parser used by the Apple-targets Xcode plugin; the 0.9 line
  keeps its own patched version.
- Zod 4.6.6 or newer fixes collection-validation memory exhaustion. Its only
  consumer here is Expo CLI's dev-tool/MCP schema handling.
- UUID stays on the patched CommonJS-compatible 11.x line for the Xcode project
  tooling. UUID 12 and later require ESM.

`src/config/toolingCompatibility.test.ts` exercises the actual plist parser,
Metro image reader and Expo dev-tool schemas. Revisit these overrides when
upgrading Expo SDK, and verify native prebuild plus iOS/Android exports.

For local iPhone builds with a separate signing identity:

```bash
cp ios.local.example.json ios.local.json
# Enter your unique bundleIdentifier and Apple team ID, then quit Xcode.
npm run ios:local:prepare
open ios/TalkToMe.xcworkspace
```

The helper backs up the existing native project under `.expo/ios-backups/`,
generates a fresh project and configures Release execution without Metro.
`ios.local.json` is ignored and used only with `TALKTOME_IOS_LOCAL=1`.
All iOS builds use scene-based startup, including compatibility with the iOS 27 SDK.
Prebuild also enables verbose output for ExpoModulesJSI’s nested framework build
to avoid Xcode 27’s false archive failure with `-quiet`; build errors remain visible.
Run `pod install` in `ios/` after native dependency
changes, or regenerate after config-plugin changes.

## CI and releases

The root **Pull Request Checks** workflow runs mobile tests, TypeScript and Expo
configuration checks alongside the existing server and desktop checks.

**Mobile Android Builds** follows the desktop release convention: builds on
`main` changes and `v*` tags, plus manual dispatch with an optional
`release_version`. It uses the root `scripts/resolve-build-version.js` and
`scripts/upload-release-asset.sh`. Builds always upload an Actions artifact;
tag/manual-version builds also upload the APK to the shared GitHub release
draft. This APK uses debug signing for sideload testing. It is not a Play Store
upload artifact. The Android package defaults to `com.talktome.mobile`;
repository variable `TALKTOME_ANDROID_PACKAGE` can override it for a fork.
The APK appends `.sideload` to that base (`com.talktome.mobile.sideload` by default)
so it can coexist with the differently signed Play app. Profiles are separate;
the two installations do not update each other.

**Mobile iOS EAS Release** starts when a GitHub release is published. It checks
out that release's tag, builds in EAS Cloud and submits to App Store Connect /
TestFlight. Manual dispatch accepts an existing tag in `release_version`; leave
`submit` unchecked for a build without submission. App Store public release
still requires the publisher's review/release process in App Store Connect.

**Mobile Google Play EAS Release** runs on the same published-release event,
with a separate manual build/submit option. It builds a production Android App
Bundle (`.aab`) in EAS and uploads to an **internal-track draft** in Play Console.
The publisher completes store setup and promotes the draft there. Enable it
with repository variable `MOBILE_PLAY_RELEASE_ENABLED=true` after provisioning
Android credentials and assigning a Google service account key in EAS.

Each EAS workflow run starts a cloud build and consumes the publisher's EAS
build quota. Each store workflow serializes its own builds and does not cancel
an active build when a newer workflow run arrives.

All mobile workflows derive the marketing version from the repository's Git
version
(the numeric `x.y.z` portion) and set the mobile build number to
`29 + GITHUB_RUN_NUMBER` (the first run is build 30). Local iOS and Android
builds default to 30. Reruns keep the same number; the iOS pre-check rejects
numbers already used or active in EAS, and also checks App Store Connect when
API credentials are configured. Start a new workflow run rather than resubmitting
a successful build. If moving to an existing app with a higher build counter,
adjust the offset in the release workflows first. The APK and Play counters are
independent because they use different package identifiers.

## Publisher setup for EAS and the stores

The app is linked to `@talktomecomm/talktome` (EAS project ID
`28c1fc0f-12d6-4b3a-a40d-dbf24dd2dcd2`) in `app.config.ts`. These public defaults
also let EAS CLI resolve the project without relying on local `.env` loading.
`TALKTOME_EXPO_OWNER` and `TALKTOME_EAS_PROJECT_ID` can override them for a fork.
After `npx eas-cli@latest login`, verify access from `mobile-app/` with
`npx eas-cli@latest project:info`.

Register the main iOS bundle ID,
`.widget` and `.watchkitapp` extensions and the `group.<bundle ID>` App Group
in the publisher's Apple team. Provision the app and extensions in EAS once
interactively, including App Store Connect submission credentials. Run EAS
commands from `mobile-app/`, for example `npx eas-cli credentials --platform ios`.
A non-interactive CI run cannot perform the initial account/provisioning setup.

Configure these **GitHub repository variables**:

| Variable | Value |
| --- | --- |
| `TALKTOME_EXPO_OWNER` | Publisher's Expo account or organization |
| `TALKTOME_EAS_PROJECT_ID` | Publisher's Expo project UUID |
| `TALKTOME_IOS_BUNDLE_IDENTIFIER` | Registered main iOS bundle identifier |
| `TALKTOME_APPLE_TEAM_ID` | Publisher's ten-character Apple team ID |
| `APP_STORE_CONNECT_APP_ID` | Numeric App Store Connect app ID |
| `MOBILE_IOS_RELEASE_ENABLED` | `true` once Apple setup is complete |
| `TALKTOME_ANDROID_PACKAGE` | Final Google Play package name (without `.sideload`) |
| `MOBILE_PLAY_RELEASE_ENABLED` | `true` once Play setup is complete |

Configure **GitHub repository secret** `EXPO_TOKEN` for that Expo account.
Signing and submission credentials are managed by EAS. For Google Play,
create the app in the publisher's Play Console, configure Play App Signing and
an Android upload keystore through `npx eas-cli credentials --platform android`.
Publisher setup, tester-link instructions and the Android-specific store copy are
in [the Google Play checklist](store/google-play-setup.de.md) and
[google-play.json](store/google-play.json). Concrete Console answers and foreground-service
video instructions are in [the Console handoff](store/google-play-console-answers.de.md);
[beta tester instructions](store/google-play-beta-test.de.md) are ready to share after
the closed test is available.
Create a Google Cloud service account, enable the Android Publisher API, grant
the service account the required app/release permissions in Play Console and
assign its JSON key to the app in EAS Credentials. The key is not a GitHub
repository variable and is never committed. See
[Expo's Google Play submission setup](https://docs.expo.dev/submit/android/). Optionally configure
`APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_ID`, and
`APP_STORE_CONNECT_PRIVATE_KEY` as repository secrets for the build-number
pre-check against Apple; without them it checks EAS history only.

`scripts/prepare-eas-release.cjs` validates the required publisher settings and
writes the platform-specific public identity/version into the production profile in `eas.json`
for that run. This ensures EAS workers use the same settings as GitHub even
though runner environment variables are not automatically forwarded to cloud
builds. For iOS, the App Store Connect app ID is also written into the submission
profile. No signing key is written to the repository or the uploaded source.
The committed config contains the public Talktome Expo project identity. The
production profile in `eas.json` uses iOS bundle ID `de.talktome.app`, Apple team
`FRVSN9AQLM` and App Store Connect app ID `6827440765`; signing credentials stay
in EAS. Android defaults to `com.talktome.mobile`. The iOS app config also defaults
to `de.talktome.app` and `FRVSN9AQLM`, so standalone commands such as `eas submit`
resolve the same app without shell exports or a selected build profile. Forks can
override the publisher identity with the corresponding environment variables.
See [Expo's build-profile environment documentation](https://docs.expo.dev/build/eas-json/).

For interactive EAS development/preview builds, export the same identity
variables locally and configure them in the corresponding EAS environment.
Keep publisher identity consistent across profiles.

## Assets and attribution

The icon source is `assets/talktome-mark.png`. To regenerate derived assets,
install `pngjs` as a local tool and make `ffmpeg` available, then run
`node scripts/sync-talktome-icons.js`. Android adaptive icons use a transparent
white glyph on black. Web-client icon assets are checked against `../public/`.

The app's filtered Git history retains its original authors. To preserve
per-commit attribution upstream, merge the PR with a merge commit rather than
squashing it. The app uses the repository's [Apache-2.0 license](../LICENSE).
See `AUTHORS` and `NOTICE` for contributor and source attribution. Research, prototype archives and standalone development-environment
scripts are not part of this folder.

Physical-device testing is still required for background audio, hardware PTT,
widgets, signing and the Watch extension. In particular, validate the signed
Watch embed in the publisher's EAS build before store distribution.
