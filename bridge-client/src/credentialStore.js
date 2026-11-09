// Only public connection metadata belongs in localStorage. Secrets are scoped
// to one server and persisted through the native operating system keychain.
export function createCredentialStore(invoke, storage, legacyKeys) {
  const profiles = new Map();
  const persisted = new Map();
  const pending = new Map();
  let writes = Promise.resolve();
  const empty = () => ({ apiKey: '', bridgeToken: '' });
  const clean = value => ({ apiKey: String(value?.apiKey || ''), bridgeToken: String(value?.bridgeToken || '') });
  const save = (serverUrl, value) => {
    const credentials = clean(value);
    profiles.set(serverUrl, credentials);
    if (!invoke) return Promise.resolve(); // Browser UI preview: memory only.
    const encoded = JSON.stringify(credentials);
    const previous = pending.get(serverUrl);
    if (previous?.encoded === encoded) return previous.promise;
    if (!previous && persisted.get(serverUrl) === encoded) return Promise.resolve();
    const result = writes.catch(() => {}).then(async () => {
      await invoke('save_bridge_credentials', { serverUrl, credentials });
      persisted.set(serverUrl, encoded);
    });
    pending.set(serverUrl, { encoded, promise: result });
    result.finally(() => { if (pending.get(serverUrl)?.promise === result) pending.delete(serverUrl); }).catch(() => {});
    writes = result;
    return result;
  };
  return {
    get: serverUrl => profiles.get(serverUrl) || empty(),
    save,
    async load(serverUrl, migrate = false) {
      if (profiles.has(serverUrl)) return profiles.get(serverUrl);
      const stored = invoke ? clean(await invoke('load_bridge_credentials', { serverUrl })) : empty();
      if (profiles.has(serverUrl)) return profiles.get(serverUrl); // User edited during the keychain read.
      if (migrate) {
        const apiKey = storage.getItem(legacyKeys.apiKey) || '';
        const bridgeToken = storage.getItem(legacyKeys.bridgeToken) || '';
        if (apiKey || bridgeToken) {
          const credentials = { apiKey: stored.apiKey || apiKey, bridgeToken: stored.bridgeToken || bridgeToken };
          try {
            await save(serverUrl, credentials);
          } catch (error) {
            if (JSON.stringify(profiles.get(serverUrl)) === JSON.stringify(credentials)) profiles.delete(serverUrl);
            throw error;
          }
          // Keep the old copy until the secure write succeeds; never lose a key on a locked keychain.
          if (invoke) {
            storage.removeItem(legacyKeys.apiKey);
            storage.removeItem(legacyKeys.bridgeToken);
          }
          return credentials;
        }
      }
      persisted.set(serverUrl, JSON.stringify(stored));
      profiles.set(serverUrl, stored);
      return stored;
    },
  };
}
