const { spawnSync } = require("child_process");

const targetVersion = process.version.replace(/^v/, "");
const result = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
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

if (result.status !== 0) {
  process.exit(result.status || 1);
}
