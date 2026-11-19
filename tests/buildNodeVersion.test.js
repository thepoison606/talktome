const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { verifyBuildNode } = require("../scripts/verify-build-node");
const { scripts } = require("../package.json");
const root = path.join(__dirname, "..");

test("standalone builds reject runtimes below the build baseline and other Node majors", () => {
  for (const version of ["22.23.4", "24.18.1", "24.22.1", "24.22.2", "25.0.0", "26.12.1", "24.22.3-rc.1"]) {
    assert.throws(() => verifyBuildNode(version), /standalone builds require Node/);
  }
});

test("standalone builds accept the pinned Node runtime and newer Node 24 versions", () => {
  for (const version of ["24.22.3", "24.23.0"]) {
    assert.doesNotThrow(() => verifyBuildNode(version));
  }
});

test("CI, Docker and standalone builds use the same Node version", () => {
  const version = fs.readFileSync(path.join(root, ".node-version"), "utf8").trim();
  const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
  const dockerVersion = dockerfile.match(/^FROM node:(\d+\.\d+\.\d+)/m)?.[1];
  assert.equal(dockerVersion, version);
  assert.ok(scripts["build:win64"].includes(`--targets node${version}-win-x64 `));
  assert.ok(scripts["build:mac_arm64"].includes(`--targets node${version}-macos-arm64 `));
});

test("server reports its Node runtime without starting services", () => {
  const output = execFileSync(process.execPath, [path.join(root, "server.js"), "--node-version"], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(output.trim(), process.versions.node);
});
