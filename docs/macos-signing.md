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

The current publisher keeps the signing private key and notarization credentials
on the local Mac. No signing credentials have been uploaded to GitHub.

From a clean checkout on an Apple Silicon Mac:

```sh
# Check tools, local Developer ID identity and notarization access only:
npm run release:macos -- --check

# Build both apps, sign/notarize them, and keep the DMGs locally:
npm run release:macos

# At the exact release tag, upload both verified DMGs to its existing draft:
npm run release:macos -- --upload v1.5.23
```

The command selects the sole Developer ID Application identity in Keychain
(or accepts `--identity`), uses Keychain profile `talktome-notary` (or `--profile`),
and finds a compatible Node from PATH or the local standalone-build Node cache.
Xcode command-line tools, Rust and npm are required; upload also requires `gh`
authentication. Apple notarization needs internet access, and Keychain may ask
for local authorization to use the signing key.

Build inputs come from a clean Git archive of the selected checkout's HEAD,
without local configs, ignored files or credentials. Dependencies are installed
in the temporary source directory. Rust and source-built LGPL FFmpeg caches
stay under `~/Library/Caches/Talktome/macos-release`.
DMGs, notarization reports and a validation manifest with the commit and SHA-256
hashes are retained under
`~/Library/Application Support/Talktome/builds/macos/`.
The first build can take longer while dependencies and FFmpeg are compiled.

Upload requires a matching local/GitHub version tag and an existing draft.
It replaces only the Server/Bridge DMGs after both pass verification; it never
publishes the release or edits its text. GitHub macOS build checks still run,
but unsigned CI DMGs are retained only as workflow artifacts so they cannot
overwrite the locally signed release downloads. Windows and other release
artifacts continue through their existing workflows.

### Signing an existing app bundle

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

Automatic GitHub signing remains disabled for the local-only setup. The
following opt-in is documented for a possible later switch; it is not required
for the local command above.

Both desktop release workflows run the signing helper when repository variable
`MACOS_SIGNING_ENABLED` is `true`. Set `MACOS_SIGNING_IDENTITY` to the complete
Developer ID Application identity. Required repository secrets are
`MACOS_CERTIFICATE_P12` (base64 P12), `MACOS_CERTIFICATE_PASSWORD`,
`APP_STORE_CONNECT_PRIVATE_KEY` (PEM), `APP_STORE_CONNECT_KEY_ID`, and
`APP_STORE_CONNECT_ISSUER_ID`.

`scripts/ci-notarize-macos.py` imports the identity and API credentials into an
ephemeral runner Keychain, runs the verified local signing/notarization helper,
and replaces the build's original DMG only after all checks pass. It restores
the Keychain search list and removes credentials on exit. Enabled signing fails
the build when credentials are missing or Apple rejects notarization. The
certificate private key, P12 password and API-key contents belong only in secrets/Keychain.
Publishing an old unsigned DMG does not retroactively notarize it; replace it
with the newly verified signed artifact when making that release.
