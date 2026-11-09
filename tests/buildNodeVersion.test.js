const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { verifyBuildNode } = require("../scripts/verify-build-node");

test("standalone builds reject runtimes below the build baseline and other Node majors", () => {
  for (const version of ["22.23.4", "24.18.1", "24.22.0", "24.22.1", "25.0.0", "26.12.1", "24.22.2-rc.1"]) {
    assert.throws(() => verifyBuildNode(version), /standalone builds require Node/);
  }
});

test("standalone builds accept the pinned Node runtime and newer Node 24 versions", () => {
  for (const version of ["24.22.2", "24.22.3", "24.23.0"]) {
    assert.doesNotThrow(() => verifyBuildNode(version));
  }
});

test("server reports its Node runtime without starting services", () => {
  const output = execFileSync(process.execPath, [path.join(__dirname, "..", "server.js"), "--node-version"], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(output.trim(), process.versions.node);
});
