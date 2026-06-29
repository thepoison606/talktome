import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const optional = process.argv.includes("--optional");
const force = process.argv.includes("--force");
const discover = process.argv.includes("--discover");
const releaseMode = process.argv.includes("--release") || isTruthy(process.env.CI);

const target = getTargetTriple();
const extension = process.platform === "win32" ? ".exe" : "";
const destination = resolve(
  projectRoot,
  "src-tauri",
  "binaries",
  `ffmpeg-${target}${extension}`,
);

async function main() {
  const existing = await fileExists(destination);
  if (existing && !force && !discover) {
    await validateSha256(destination);
    await validateBinary(destination, { releaseMode, sourceKind: "existing sidecar" });
    console.log(`FFmpeg sidecar already exists: ${destination}`);
    return;
  }

  const source = await findSource();
  if (!source.path) {
    const message =
      "No FFmpeg binary found. Set FFMPEG_SIDECAR_URL, FFMPEG_SIDECAR_SOURCE or TALKTOME_FFMPEG.";
    if (optional) {
      console.warn(`${message} Continuing without bundled sidecar.`);
      return;
    }
    throw new Error(message);
  }

  try {
    const binarySha256 = await validateSha256(source.path);
    await validateBinary(source.path, { releaseMode, sourceKind: source.kind });

    if (discover) {
      printDiscovery(source, binarySha256);
      return;
    }

    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source.path, destination);
    if (process.platform !== "win32") {
      await chmod(destination, 0o755);
    }
    console.log(`Prepared FFmpeg sidecar: ${destination}`);
  } finally {
    if (source.cleanupDir) {
      await rm(source.cleanupDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function findSource() {
  const downloaded = await findSourceFromUrl();
  if (downloaded) {
    return downloaded;
  }

  for (const [kind, value] of [
    ["FFMPEG_SIDECAR_SOURCE", process.env.FFMPEG_SIDECAR_SOURCE],
    ["TALKTOME_FFMPEG", process.env.TALKTOME_FFMPEG],
  ]) {
    if (value && (await fileExists(resolve(value)))) {
      return { kind, path: resolve(value) };
    }
  }

  if (releaseMode) {
    return {};
  }

  const pathBinary = findOnPath(ffmpegExecutableName());
  if (pathBinary && (await fileExists(pathBinary))) {
    return { kind: "PATH", path: pathBinary };
  }

  return {};
}

async function findSourceFromUrl() {
  const url = getTargetEnv("FFMPEG_SIDECAR_URL");
  if (!url) {
    return null;
  }

  const archiveSha = getTargetEnv("FFMPEG_SIDECAR_ARCHIVE_SHA256");
  const binarySha = getTargetEnv("FFMPEG_SIDECAR_SHA256");
  if (releaseMode && !discover && !archiveSha && !binarySha) {
    throw new Error(
      "Release FFmpeg downloads require FFMPEG_SIDECAR_ARCHIVE_SHA256 or FFMPEG_SIDECAR_SHA256.",
    );
  }

  const workDir = await mkdtemp(join(tmpdir(), "talktome-ffmpeg-"));
  const fileName = basename(new URL(url).pathname) || `ffmpeg-${target}`;
  const downloadPath = join(workDir, fileName);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download FFmpeg sidecar from ${url}: ${response.status}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  const archiveSha256 = validateArchiveSha256(body, url);
  await writeFile(downloadPath, body);

  if (!isArchive(fileName)) {
    if (process.platform !== "win32") {
      await chmod(downloadPath, 0o755);
    }
    return {
      kind: "FFMPEG_SIDECAR_URL",
      path: downloadPath,
      cleanupDir: workDir,
      url,
      archiveSha256,
    };
  }

  const extractDir = join(workDir, "extracted");
  await mkdir(extractDir, { recursive: true });
  extractArchive(downloadPath, extractDir);

  const binary = await findExtractedFfmpeg(extractDir);
  if (!binary) {
    throw new Error(`Downloaded FFmpeg archive did not contain ${ffmpegExecutableName()}.`);
  }
  if (process.platform !== "win32") {
    await chmod(binary, 0o755);
  }

  return {
    kind: "FFMPEG_SIDECAR_URL",
    path: binary,
    cleanupDir: workDir,
    url,
    archiveSha256,
  };
}

function findOnPath(binary) {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, [binary], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;
}

async function validateSha256(source) {
  const expected = getTargetEnv("FFMPEG_SIDECAR_SHA256").trim().toLowerCase();
  const actual = await sha256File(source);
  if (!expected) {
    return actual;
  }

  if (actual !== expected) {
    throw new Error(
      `FFmpeg SHA256 mismatch for ${source}. Expected ${expected}, got ${actual}.`,
    );
  }
  return actual;
}

function validateArchiveSha256(body, url) {
  const expected = getTargetEnv("FFMPEG_SIDECAR_ARCHIVE_SHA256").trim().toLowerCase();
  const actual = createHash("sha256").update(body).digest("hex");
  if (!expected) {
    return actual;
  }

  if (actual !== expected) {
    throw new Error(
      `FFmpeg archive SHA256 mismatch for ${url}. Expected ${expected}, got ${actual}.`,
    );
  }
  return actual;
}

async function sha256File(path) {
  const file = await readFile(path);
  return createHash("sha256").update(file).digest("hex");
}

function printDiscovery(source, binarySha256) {
  console.log("FFmpeg sidecar source validated.");
  console.log(`Target: ${target}`);
  console.log(`Source: ${source.kind}${source.url ? ` (${source.url})` : ""}`);
  console.log(`Archive SHA256: ${source.archiveSha256 ?? "-"}`);
  console.log(`Binary SHA256: ${binarySha256}`);
  console.log(`Binary path: ${source.path}`);
  console.log("No sidecar was copied because --discover was used.");
}

async function validateBinary(binary, { releaseMode, sourceKind }) {
  const version = runBinary(binary, ["-version"]);
  if (version.status !== 0) {
    throw new Error(`FFmpeg validation failed for ${binary}: ${version.output}`);
  }

  const encoders = runBinary(binary, ["-hide_banner", "-encoders"]);
  if (encoders.status !== 0 || !/\blibopus\b/.test(encoders.output)) {
    throw new Error(
      `FFmpeg binary ${binary} does not expose the libopus encoder required by the Bridge.`,
    );
  }

  const warnings = [];
  if (version.output.includes("--enable-gpl")) {
    warnings.push("binary was built with --enable-gpl");
  }
  if (sourceKind === "PATH") {
    warnings.push("binary was resolved from PATH");
  }
  if (process.platform === "darwin") {
    const linkedLibraries = runBinary("otool", ["-L", binary]);
    if (
      linkedLibraries.output.includes("/opt/homebrew/") ||
      linkedLibraries.output.includes("/usr/local/Cellar/")
    ) {
      warnings.push("binary links against Homebrew libraries");
    }
  }

  if (warnings.length === 0) {
    return;
  }

  const warningText = warnings.join("; ");
  if (releaseMode && !isTruthy(process.env.ALLOW_NON_PORTABLE_FFMPEG)) {
    throw new Error(
      `FFmpeg sidecar is not release-safe (${warningText}). ` +
        "Use FFMPEG_SIDECAR_URL or FFMPEG_SIDECAR_SOURCE with a portable LGPL/libopus build, " +
        "or set ALLOW_NON_PORTABLE_FFMPEG=1 to override intentionally.",
    );
  }

  console.warn(
    `Warning: FFmpeg sidecar may not be release-safe (${warningText}). ` +
      "This is acceptable for local development.",
  );
}

function runBinary(binary, args) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

function getTargetEnv(name) {
  const targetName = `${name}_${target.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return process.env[targetName] || process.env[name] || "";
}

function isArchive(fileName) {
  return /\.(zip|tar|tar\.gz|tgz|tar\.xz|txz)$/i.test(fileName);
}

function extractArchive(archivePath, extractDir) {
  const result = spawnSync("tar", ["-xf", archivePath, "-C", extractDir], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to extract FFmpeg archive ${archivePath}: ${result.stderr || result.stdout}`,
    );
  }
}

async function findExtractedFfmpeg(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findExtractedFfmpeg(path);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase() === ffmpegExecutableName()) {
      const info = await stat(path);
      if (info.size > 0) {
        return path;
      }
    }
  }
  return null;
}

function ffmpegExecutableName() {
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function isTruthy(value) {
  return /^(1|true|yes)$/i.test(String(value ?? ""));
}

async function fileExists(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

function getTargetTriple() {
  if (process.env.TAURI_TARGET_TRIPLE) {
    return process.env.TAURI_TARGET_TRIPLE;
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    return "aarch64-apple-darwin";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "x86_64-apple-darwin";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "x86_64-pc-windows-msvc";
  }
  if (process.platform === "win32" && process.arch === "arm64") {
    return "aarch64-pc-windows-msvc";
  }

  throw new Error(`Unsupported FFmpeg sidecar platform: ${process.platform}/${process.arch}`);
}
