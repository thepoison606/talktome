# macOS distribution signing

The Apple Developer Program permits Developer ID distribution outside the Mac
App Store. An iOS Apple Distribution certificate or a local Apple Development
certificate does not replace **Developer ID Application** signing and notarization.
See [Apple Developer ID](https://developer.apple.com/developer-id/) and
[Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

## Initial account setup

1. The Account Holder creates a Developer ID Application certificate in the Apple
   Developer portal using a CSR whose private key stays on the build Mac. Import
   the matching certificate/key pair into Keychain. Verify with
   `security find-identity -v -p codesigning`.
2. Store notarization credentials outside the repository using
   `xcrun notarytool store-credentials talktome-notary`. An App Store Connect API
   key or an Apple ID with an app-specific password may be used. Never paste
   private keys or passwords into GitHub source files.

## Local Server and Bridge builds

Build the app bundle as usual. The helper below works on a copy, signs embedded
Mach-O binaries (including Node native modules and FFmpeg/media libraries), and
checks Hardened Runtime signatures. It submits the app to Apple, staples its
ticket, creates a DMG, then notarizes and staples that DMG as well. The app and
DMG both need Apple's Accepted status before this is a distributable artifact.

```sh
export APPLE_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)'
python3 scripts/notarize-macos.py \
  --app '/path/to/Talktome Bridge.app' \
  --entitlements bridge-client/src-tauri/Entitlements.plist \
  --output-dmg '/path/to/talktome_bridge_macos_arm64_signed.dmg'
```

For Server, use `Talktome Server.app` and
`server-app/src-tauri/Entitlements.plist`. The helper refuses to overwrite an
existing DMG. Keep its notarization JSON reports with the build validation data.
It never changes the source app bundle or removes quarantine attributes.

The Bridge entitlements allow its selected camera/microphone and loading the
separately installed NDI runtime. Server enables V8 JIT and native module loading.
Test startup, audio, cameras and native modules under Hardened Runtime before
publishing a signed build. Notarization is a separate automated Apple check;
it is not an App Store release.

## CI

The existing release workflows still build their current artifacts. Before
enabling signed releases in CI, install the Developer ID identity into an
ephemeral runner Keychain and supply notarization credentials from GitHub
Secrets. Run the same helper before uploading the final DMGs. The certificate
private key, P12 password and API-key contents belong only in secrets/Keychain.
Publishing an old unsigned DMG does not retroactively notarize it; replace it
with the newly verified signed artifact when making that release.
