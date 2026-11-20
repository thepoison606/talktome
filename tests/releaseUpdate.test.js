const assert = require("node:assert/strict");
const test = require("node:test");
const { createReleaseChecker } = require("../src/server/releaseUpdate");

function release(tag, metadata = {}) {
  return { ok: true, json: async () => ({ tag_name: tag, ...metadata }) };
}

test("reports only a stable release newer than the running version", async () => {
  for (const [current, latest, expected] of [
    ["1.6.9", release("v1.6.10"), "1.6.10"],
    ["v1.6.10+local", release("v1.6.10"), null],
    ["1.6.10", release("v1.6.9"), null],
    ["1.6.10-dev.3.dirty", release("v1.6.10"), null],
    ["1.6.10-rc.1", release("v1.6.10"), "1.6.10"],
    ["1.6.10", release("v1.7.0-rc.1", { prerelease: true }), null],
    ["1.6.10", release("v1.7.0", { draft: true }), null],
    ["1.6.10", release("latest"), null],
  ]) {
    const check = createReleaseChecker(current, { fetchImpl: async () => latest });
    assert.equal(await check(), expected, current);
  }

  let unknownCalls = 0;
  const checkUnknown = createReleaseChecker("unknown", { fetchImpl: async () => {
    unknownCalls += 1;
    return release("v1.7.0");
  } });
  assert.equal(await checkUnknown(), null);
  assert.equal(unknownCalls, 0);
});

test("shares a cached lookup and retains its result during a failed refresh", async () => {
  const minute = 60_000;
  let time = 0;
  let calls = 0;
  const check = createReleaseChecker("1.6.4", {
    now: () => time,
    fetchImpl: async (url) => {
      assert.equal(url, "https://api.github.com/repos/thepoison606/talktome/releases/latest");
      calls += 1;
      if (calls === 2) throw new Error("offline");
      return release(calls === 1 ? "v1.7.0" : "v1.8.0");
    },
  });
  assert.deepEqual(await Promise.all([check(), check()]), ["1.7.0", "1.7.0"]);
  assert.equal(calls, 1);
  time += 29 * minute;
  assert.equal(await check(), "1.7.0");
  assert.equal(calls, 1);
  time += minute;
  assert.equal(await check(), "1.7.0");
  assert.equal(calls, 2);
  time += 4 * minute;
  assert.equal(await check(), "1.7.0");
  assert.equal(calls, 2);
  time += minute;
  assert.equal(await check(), "1.8.0");
  assert.equal(calls, 3);
});
