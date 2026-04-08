const fs = require("fs");
const path = require("path");

const [
  releaseDirName,
  executableName,
  workerName,
] = process.argv.slice(2);

if (!releaseDirName || !executableName || !workerName) {
  console.error(
    "Usage: node scripts/create-release-dir.js <releaseDirName> <executableName> <workerName>"
  );
  process.exit(1);
}

const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, releaseDirName);

fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

const entriesToCopy = [
  executableName,
  "better_sqlite3.node",
  workerName,
  "public",
  "README.md",
  "LICENSE",
];

for (const entry of entriesToCopy) {
  const source = path.join(rootDir, entry);
  const destination = path.join(releaseDir, entry);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing release input: ${entry}`);
  }
  fs.cpSync(source, destination, { recursive: true });
}

console.log(`[release] prepared ${releaseDir}`);
