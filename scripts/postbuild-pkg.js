const { spawnSync } = require("child_process");

if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") {
  console.log("[build] skipping postbuild better-sqlite3 restore on CI");
  process.exit(0);
}

const targetVersion = process.version.replace(/^v/, "");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
  npmCommand,
  [
    "rebuild",
    "better-sqlite3",
    `--target=${targetVersion}`,
    "--runtime=node",
    "--dist-url=https://nodejs.org/dist",
  ],
  {
    stdio: "inherit",
  }
);

if (result.error) {
  console.error(`[build] failed to launch ${npmCommand}:`, result.error);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status || 1);
}
