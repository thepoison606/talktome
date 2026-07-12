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

function copyWindowsCppRuntime() {
  if (target !== "win64") return;

  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!systemRoot) {
    throw new Error("SystemRoot is required to bundle the Windows C++ runtime");
  }

  const systemDir = path.join(systemRoot, "System32");
  // mediasoup-worker is built with MSVC.  These app-local redistributable
  // DLLs prevent STATUS_DLL_NOT_FOUND (0xC0000135) on clean Windows installs.
  const runtimeFiles = fs.readdirSync(systemDir).filter((file) =>
    /^(?:concrt140|msvcp140(?:_[a-z0-9_]+)?|vcruntime140(?:_[a-z0-9_]+)?)\.dll$/i.test(file)
  );

  const normalizedRuntimeFiles = new Set(runtimeFiles.map((file) => file.toLowerCase()));
  if (!normalizedRuntimeFiles.has("vcruntime140.dll") || !normalizedRuntimeFiles.has("msvcp140.dll")) {
    throw new Error(`Microsoft Visual C++ runtime DLLs not found in ${systemDir}`);
  }

  for (const runtimeFile of runtimeFiles) {
    copyRequiredFile(path.join(systemDir, runtimeFile), runtimeFile);
  }
}

copyRequiredFile(sqliteSource, "better_sqlite3.node");
copyRequiredFile(workerSource, workerName);
copyWindowsCppRuntime();
