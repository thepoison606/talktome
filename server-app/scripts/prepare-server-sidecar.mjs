import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const optional = process.argv.includes("--optional");
const force = process.argv.includes("--force");
const rootDir = path.resolve(import.meta.dirname, "..", "..");
const appDir = path.resolve(import.meta.dirname, "..");
const binariesDir = path.join(appDir, "src-tauri", "binaries");

function targetTriple() {
  if (process.platform === "darwin" && process.arch === "arm64") return "aarch64-apple-darwin";
  if (process.platform === "win32" && process.arch === "x64") return "x86_64-pc-windows-msvc";
  if (process.platform === "linux" && process.arch === "x64") return "x86_64-unknown-linux-gnu";
  throw new Error(`Unsupported platform for server sidecar: ${process.platform} ${process.arch}`);
}

function defaultSourceCandidates() {
  if (process.platform === "darwin") {
    return [path.join(rootDir, "talktome_arm64")];
  }
  if (process.platform === "win32") {
    return [path.join(rootDir, "talktome_win64.exe")];
  }
  return [path.join(rootDir, "talktome")];
}

const triple = targetTriple();
const targetName = process.platform === "win32"
  ? `talktome-server-${triple}.exe`
  : `talktome-server-${triple}`;
const targetPath = path.join(binariesDir, targetName);
const source = process.env.TALKTOME_SERVER_SIDECAR_SOURCE
  ? path.resolve(process.env.TALKTOME_SERVER_SIDECAR_SOURCE)
  : defaultSourceCandidates().find((candidate) => fs.existsSync(candidate));

if (!source || !fs.existsSync(source)) {
  const message = [
    "Server sidecar source not found.",
    "Set TALKTOME_SERVER_SIDECAR_SOURCE or build the server binary first.",
    `Expected target: ${targetPath}`,
  ].join(" ");
  if (optional) {
    console.warn(message);
    process.exit(0);
  }
  throw new Error(message);
}

fs.mkdirSync(binariesDir, { recursive: true });
if (fs.existsSync(targetPath) && !force) {
  console.log(`Server sidecar already exists: ${targetPath}`);
} else {
  fs.copyFileSync(source, targetPath);
  fs.chmodSync(targetPath, 0o755);
  console.log(`Prepared server sidecar: ${targetPath}`);
}

const sourceDir = path.dirname(source);
const runtimeFiles = process.platform === "win32"
  ? ["better_sqlite3.node", "mediasoup-worker.exe"]
  : ["better_sqlite3.node", "mediasoup-worker"];

for (const runtimeFile of runtimeFiles) {
  const runtimeSource = path.join(sourceDir, runtimeFile);
  const runtimeTarget = path.join(binariesDir, runtimeFile);
  if (!fs.existsSync(runtimeSource)) {
    const message = `Server runtime file not found: ${runtimeSource}`;
    if (optional) {
      console.warn(message);
      continue;
    }
    throw new Error(message);
  }
  fs.copyFileSync(runtimeSource, runtimeTarget);
  if (!runtimeFile.endsWith(".node")) {
    fs.chmodSync(runtimeTarget, 0o755);
  }
  console.log(`Prepared server runtime file: ${runtimeTarget}`);
}
