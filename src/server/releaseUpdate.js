const LATEST_RELEASE_API = "https://api.github.com/repos/thepoison606/talktome/releases/latest";
const CACHE_DURATION = 30 * 60 * 1000;
const RETRY_DELAY = 5 * 60 * 1000;

function parseVersion(version) {
  if (typeof version !== "string") return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/i.exec(version.trim());
  if (!match) return null;
  const numbers = match.slice(1, 4).map(Number);
  if (!numbers.every(Number.isSafeInteger)) return null;
  return { numbers, prerelease: match[4] };
}

function isNewerRelease(latest, current) {
  for (let index = 0; index < latest.numbers.length; index += 1) {
    const difference = latest.numbers[index] - current.numbers[index];
    if (difference !== 0) return difference > 0;
  }
  // A source build made after the corresponding stable tag already includes it.
  return Boolean(current.prerelease && !/^dev\.\d+(?:\.dirty)?$/.test(current.prerelease));
}

function createReleaseChecker(currentVersion, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const current = parseVersion(currentVersion);
  let availableVersion = null;
  let refreshAfter = 0;
  let pending = null;

  async function refresh() {
    try {
      const response = await fetchImpl(LATEST_RELEASE_API, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "Talktome" },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Could not check the latest release");
      const { tag_name: tag, draft, prerelease } = await response.json();
      const latest = parseVersion(tag);
      availableVersion = latest && !draft && !prerelease && !latest.prerelease && isNewerRelease(latest, current)
        ? latest.numbers.join(".")
        : null;
      refreshAfter = now() + CACHE_DURATION;
    } catch {
      refreshAfter = now() + RETRY_DELAY;
    }
    return availableVersion;
  }

  return async function checkRelease() {
    if (!current || current.numbers.every((part) => part === 0)) return null;
    if (pending) return pending;
    if (now() < refreshAfter) return availableVersion;
    pending = refresh().finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { createReleaseChecker };
