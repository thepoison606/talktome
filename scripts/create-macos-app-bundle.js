const fs = require("fs");
const path = require("path");

const [releaseDirName, appName, executableName, version] = process.argv.slice(2);

if (!releaseDirName || !appName || !executableName || !version) {
  console.error(
    "Usage: node scripts/create-macos-app-bundle.js <releaseDirName> <appName> <executableName> <version>"
  );
  process.exit(1);
}

const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.resolve(rootDir, releaseDirName);
const appDir = path.join(releaseDir, `${appName}.app`);
const contentsDir = path.join(appDir, "Contents");
const macosDir = path.join(contentsDir, "MacOS");
const resourcesDir = path.join(contentsDir, "Resources");
const payloadDir = path.join(resourcesDir, "server");
const executablePath = path.join(releaseDir, executableName);
const appVersion = normalizePlistVersion(version);

function normalizePlistVersion(value) {
  const match = String(value).replace(/^v/i, "").match(/\d+(?:\.\d+){0,2}/);
  return match?.[0] || "0.0.0";
}

if (!fs.existsSync(releaseDir)) {
  throw new Error(`Release directory not found: ${releaseDir}`);
}

if (!fs.existsSync(executablePath)) {
  throw new Error(`Executable not found: ${executablePath}`);
}

fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(macosDir, { recursive: true });
fs.mkdirSync(payloadDir, { recursive: true });

for (const entry of fs.readdirSync(releaseDir)) {
  if (entry === `${appName}.app`) continue;
  fs.cpSync(path.join(releaseDir, entry), path.join(payloadDir, entry), {
    recursive: true,
  });
}

const launcherPath = path.join(macosDir, appName);
fs.writeFileSync(
  launcherPath,
  `#!/bin/sh
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR/Resources/server" || exit 1
exec "$APP_DIR/Resources/server/${executableName}" "$@"
`,
  { mode: 0o755 }
);
fs.chmodSync(launcherPath, 0o755);
fs.chmodSync(path.join(payloadDir, executableName), 0o755);

const iconSource = path.join(rootDir, "bridge-client", "src-tauri", "icons", "icon.icns");
const iconName = "AppIcon.icns";
if (fs.existsSync(iconSource)) {
  fs.copyFileSync(iconSource, path.join(resourcesDir, iconName));
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${appName}</string>
  <key>CFBundleExecutable</key>
  <string>${appName}</string>
  <key>CFBundleIconFile</key>
  <string>${iconName}</string>
  <key>CFBundleIdentifier</key>
  <string>com.talktome.server</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${appName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${appVersion}</string>
  <key>CFBundleVersion</key>
  <string>${appVersion}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;

fs.writeFileSync(path.join(contentsDir, "Info.plist"), plist);

console.log(`[release] prepared ${appDir}`);
