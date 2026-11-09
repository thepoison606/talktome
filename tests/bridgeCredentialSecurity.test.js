const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../src/server/serverCore.js'), 'utf8');
const api = {};
vm.runInNewContext(source.slice(source.indexOf('function parseBearerToken('), source.indexOf('function isValidCompanionApiKey(')), api);
const request = (headers = {}, query = {}) => ({ get: name => headers[name], query });

test('HTTP API authentication uses headers and never URL query credentials', () => {
  assert.equal(api.extractCompanionApiKeyFromRequest(request({}, { apiKey: 'url-secret' })), null);
  assert.equal(api.extractCompanionApiKeyFromRequest(request({ authorization: 'Bearer header-secret' }, { apiKey: 'url-secret' })), 'header-secret');
  assert.equal(api.extractCompanionApiKeyFromRequest(request({ 'x-api-key': ' header-key ' })), 'header-key');
});

test('Socket.IO API authentication uses auth/headers instead of the URL query', () => {
  assert.equal(api.extractCompanionApiKeyFromSocket({ handshake: { query: { apiKey: 'url-secret' } } }), null);
  assert.equal(api.extractCompanionApiKeyFromSocket({ handshake: { auth: { apiKey: 'auth-secret' } } }), 'auth-secret');
  assert.equal(api.extractCompanionApiKeyFromSocket({ handshake: { headers: { authorization: 'Bearer header-secret' } } }), 'header-secret');
});

test('Companion command waits have a bounded lifetime even for hostile input', () => {
  const context = { COMPANION_DEFAULT_WAIT_MS: 1500, COMPANION_MAX_WAIT_MS: 10000 };
  const start = source.indexOf('function parseCompanionWaitMs(');
  vm.runInNewContext(source.slice(start, source.indexOf('\nfunction ', start + 1)), context);
  for (const value of [Infinity, NaN, undefined, 'invalid', -100, 0]) assert.equal(context.parseCompanionWaitMs(value), 1500);
  assert.equal(context.parseCompanionWaitMs(1e20), 10000);
  assert.equal(context.parseCompanionWaitMs('250'), 250);
  assert.equal(context.parseCompanionWaitMs(0.1), 100);
});

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key), values };
}
const legacyKeys = { apiKey: 'old-key', bridgeToken: 'old-token' };
const url = 'https://intercom.local:8443';

test('Bridge migrates old secrets to native storage and removes plaintext only after success', async () => {
  const { createCredentialStore } = await import('../bridge-client/src/credentialStore.js');
  const local = storage({ 'old-key': 'api-secret', 'old-token': 'token-secret' });
  const calls = [];
  const store = createCredentialStore(async (command, args) => {
    calls.push(command);
    if (command === 'load_bridge_credentials') return {};
    assert.equal(local.getItem('old-key'), 'api-secret');
    assert.deepEqual(args, { serverUrl: url, credentials: { apiKey: 'api-secret', bridgeToken: 'token-secret' } });
  }, local, legacyKeys);
  assert.deepEqual(await store.load(url, true), { apiKey: 'api-secret', bridgeToken: 'token-secret' });
  assert.equal(local.getItem('old-key'), null);
  assert.equal(local.getItem('old-token'), null);
  assert.deepEqual(calls, ['load_bridge_credentials', 'save_bridge_credentials']);
  assert.deepEqual(store.get('https://another.local'), { apiKey: '', bridgeToken: '' });
  await store.save(url, store.get(url));
  assert.equal(calls.length, 2, 'unchanged secrets do not repeatedly touch the keychain');
});

test('a failed keychain migration retains the original key for retry without a plaintext fallback write', async () => {
  const { createCredentialStore } = await import('../bridge-client/src/credentialStore.js');
  const local = storage({ 'old-key': 'api-secret' });
  let locked = true;
  const store = createCredentialStore(async command => {
    if (command === 'load_bridge_credentials') return {};
    if (locked) throw new Error('keychain locked');
  }, local, legacyKeys);
  await assert.rejects(store.load(url, true), /keychain locked/);
  assert.equal(local.getItem('old-key'), 'api-secret');
  locked = false;
  assert.equal((await store.load(url, true)).apiKey, 'api-secret');
  assert.equal(local.getItem('old-key'), null);
});

test('native credentials take precedence over old WebView credentials', async () => {
  const { createCredentialStore } = await import('../bridge-client/src/credentialStore.js');
  const local = storage({ 'old-key': 'old-secret', 'old-token': 'old-token' });
  const store = createCredentialStore(async command => command === 'load_bridge_credentials'
    ? { apiKey: 'native-secret', bridgeToken: 'native-token' } : undefined, local, legacyKeys);
  assert.deepEqual(await store.load(url, true), { apiKey: 'native-secret', bridgeToken: 'native-token' });
  assert.equal(local.values.size, 0);
});

test('browser preview keeps credentials in memory without persisting plaintext', async () => {
  const { createCredentialStore } = await import('../bridge-client/src/credentialStore.js');
  const local = storage(); const store = createCredentialStore(null, local, legacyKeys);
  await store.save(url, { apiKey: 'session-secret' });
  assert.equal(store.get(url).apiKey, 'session-secret');
  assert.equal(local.values.size, 0);
});

test('queued keychain writes preserve the last edit even when reverting to the saved value', async () => {
  const { createCredentialStore } = await import('../bridge-client/src/credentialStore.js');
  const written = [];
  const store = createCredentialStore(async (command, args) => {
    if (command === 'load_bridge_credentials') return { apiKey: 'original' };
    await new Promise(resolve => setTimeout(resolve, 5));
    written.push(args.credentials.apiKey);
  }, storage(), legacyKeys);
  await store.load(url);
  const first = store.save(url, { apiKey: 'edited' });
  const last = store.save(url, { apiKey: 'original' });
  await Promise.all([first, last]);
  assert.deepEqual(written, ['edited', 'original']);
  assert.equal(store.get(url).apiKey, 'original');
});
