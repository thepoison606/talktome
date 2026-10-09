(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TalktomeRemotePanelState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEVICE_KEYS = ['preferredAudioInputDeviceId', 'preferredAudioInputDeviceExplicit', 'preferredAudioOutputDeviceId'];
  function isPreferenceKey(key, userId) {
    if (DEVICE_KEYS.includes(key)) return true;
    const id = String(Number(userId));
    return key === `activeProduction:${id}`
      || key === `stoppedFeeds:user:${id}`
      || key === `conferenceListenExclusions:user:${id}`
      || key === `conferenceMemberLevels:user:${id}`
      || new RegExp(`^targetHotkeys:${id}(?::production:[0-9]+)?$`).test(key)
      || new RegExp(`^mainButtonTarget:user:${id}:(default|[0-9]+)$`).test(key);
  }
  function normalizeStorage(storage, userId, { strict = false } = {}) {
    if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
      if (strict) throw new Error('Invalid client preferences');
      return {};
    }
    const result = {};
    const entries = Object.entries(storage);
    if (entries.length > 128 && strict) throw new Error('Too many client preferences');
    for (const [key, value] of entries.slice(0, 128)) {
      if (!isPreferenceKey(key, userId) || (value !== null && (typeof value !== 'string' || value.length > 32768))) {
        if (strict) throw new Error('Invalid client preference');
        continue;
      }
      if (value !== null && (key.startsWith('conference') || key.startsWith('targetHotkeys:') || key.startsWith('stoppedFeeds:'))) {
        try {
          const parsed = JSON.parse(value);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        } catch {
          if (strict) throw new Error('Invalid client preference data');
          continue;
        }
      }
      result[key] = value;
    }
    return result;
  }
  function mergeStorage(storage, patch) {
    const result = { ...storage };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete result[key];
      else result[key] = value;
    }
    return result;
  }
  function createStorage(backing, changed = () => {}) {
    const memory = new Map();
    return {
      get length() { return backing ? backing.length : memory.size; },
      key(index) { return backing ? backing.key(index) : [...memory.keys()][index] ?? null; },
      getItem(key) { return backing ? backing.getItem(key) : memory.get(String(key)) ?? null; },
      setItem(key, value) {
        key = String(key); value = String(value);
        if (this.getItem(key) === value) return;
        if (backing) backing.setItem(key, value); else memory.set(key, value);
        changed(key, value);
      },
      removeItem(key) {
        key = String(key);
        if (this.getItem(key) === null) return;
        if (backing) backing.removeItem(key); else memory.delete(key);
        changed(key, null);
      },
    };
  }
  function collectStorage(storage, userId) {
    const result = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && isPreferenceKey(key, userId)) result[key] = storage.getItem(key);
    }
    return normalizeStorage(result, userId);
  }
  return { isPreferenceKey, normalizeStorage, mergeStorage, createStorage, collectStorage };
});
