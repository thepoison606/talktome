const PROJECT_ROOT = require('./helpers/projectRoot');
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const clientSource = fs.readFileSync(
  path.join(PROJECT_ROOT, "public", "client.js"),
  "utf8",
);
const clientHtml = fs.readFileSync(
  path.join(PROJECT_ROOT, "public", "index.html"),
  "utf8",
);

function sourceBetween(startMarker, endMarker) {
  const start = clientSource.indexOf(startMarker);
  const end = clientSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return clientSource.slice(start, end);
}

test("settings handlers do not reference the closure-scoped cached user list", () => {
  const openHandler = sourceBetween(
    "function handleSettingsMenuOpened()",
    "function handleSettingsMenuClosed()",
  );
  const viewHandler = sourceBetween(
    "function setActiveSettingsView(",
    "function bindSettingsViewButton(",
  );

  assert.match(openHandler, /refreshTargetHotkeyUiHandler\(\);/);
  assert.doesNotMatch(openHandler, /cachedUsers/);
  assert.match(viewHandler, /renderTargetHotkeySettingsHandler\(\);/);
  assert.doesNotMatch(viewHandler, /cachedUsers/);
});

test("both settings subviews start at the top and focus their Back button without scrolling", () => {
  for (const view of ["shortcuts", "arrange"]) {
    const menu = { scrollTop: 400 };
    const focusCalls = [];
    const loaded = [];
    const context = vm.createContext({
      activeSettingsView: "main",
      settingsMainView: {},
      settingsShortcutsView: { parentElement: menu },
      settingsArrangeView: { parentElement: menu },
      shortcutSettingsBackButton: { focus: options => focusCalls.push(["shortcuts", options.preventScroll]) },
      arrangeTargetsBackButton: { focus: options => focusCalls.push(["arrange", options.preventScroll]) },
      canEditTargets: () => true,
      stopHotkeyCaptureHandler() {},
      cancelArrangeTargetsDragHandler() {},
      renderTargetHotkeySettingsHandler: () => loaded.push("shortcuts"),
      loadArrangeTargetsHandler: () => loaded.push("arrange"),
    });
    vm.runInContext(sourceBetween("function setActiveSettingsView(", "function bindSettingsViewButton("), context);
    context.setActiveSettingsView(view);
    assert.equal(menu.scrollTop, 0);
    assert.deepEqual(focusCalls, [[view, true]]);
    assert.deepEqual(loaded, [view]);
  }
});

test("feed ducking does not change listen-only conference playback levels", () => {
  const playbackLevel = sourceBetween(
    "function setPlaybackEntryLevel(",
    "function mutePlaybackEntry(",
  );
  const feedDucking = sourceBetween(
    "function applyFeedDucking()",
    "async function startFeedStream(",
  );

  assert.doesNotMatch(playbackLevel, /listenOnlyConferenceKeys|feedDuckingFactor/);
  assert.doesNotMatch(feedDucking, /listenOnlyConferenceKeys/);
});

test("settings footer shows the current server version beside logout", () => {
  assert.match(clientHtml, /<div class="settings-actions">\s*<span id="settings-server-version"[^>]*><\/span>\s*<button id="logout-btn"/s);
  assert.match(clientHtml, /\.settings-actions\s*\{[^}]*justify-content:\s*space-between;[^}]*padding-bottom:\s*0\.2rem;/s);
  assert.match(clientSource, /settingsServerVersion\.textContent = `Server \$\{displayVersion\}`/);
});
