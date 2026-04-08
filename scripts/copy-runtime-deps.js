const fs = require("fs");
const path = require("path");

const target = String(process.argv[2] || "").trim().toLowerCase();

if (!target) {
  console.error("Usage: node scripts/copy-runtime-deps.js <win64|mac_arm64|linux_x64>");
  process.exit(1);
}

const rootDir = path.resolve(__dirname, "..");
const sqliteSource = path.join(
  rootDir,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node"
);

const workerName = target === "win64" ? "mediasoup-worker.exe" : "mediasoup-worker";
const workerSource = path.join(
  rootDir,
  "node_modules",
  "mediasoup",
  "worker",
  "out",
  "Release",
  workerName
);

function copyRequiredFile(sourcePath, destinationName) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Required runtime file not found: ${sourcePath}`);
  }
  const destinationPath = path.join(rootDir, destinationName);
  fs.copyFileSync(sourcePath, destinationPath);
  console.log(`[build] copied ${destinationName}`);
}

copyRequiredFile(sqliteSource, "better_sqlite3.node");
copyRequiredFile(workerSource, workerName);
