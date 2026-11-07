const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const vm = require('node:vm');
const root = require('./helpers/projectRoot');

test('bulk connections are scoped, additive, idempotent, and transactional', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-matrix-connect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const d = require('./src/server/dbHandler');
    const sql = require('./src/server/db');
    const a = Number(d.createUser('Alice', 'test-only'));
    const b = Number(d.createUser('Bob', 'test-only'));
    const guest = Number(d.createUser('Guest profile', 'test-only'));
    sql.prepare('UPDATE users SET is_guest_profile = 1 WHERE id = ?').run(guest);
    const outsider = Number(d.createUser('Other show', 'test-only'));
    const p = d.createProduction('Main show'), other = d.createProduction('Other show');
    for (const id of [a, b, guest]) d.setProductionUser(p, id);
    d.setProductionUser(other, outsider);
    const c = Number(d.createConference('Show conference'));
    const outside = Number(d.createConference('Outside conference'));
    const feed = Number(d.createFeed('Show feed', 'test-only'));
    const outsideFeed = Number(d.createFeed('Outside feed', 'test-only'));
    d.setProductionConference(p, c); d.setProductionFeed(p, feed);
    d.setProductionConference(other, outside); d.setProductionFeed(other, outsideFeed);
    d.addProductionTarget(p, a, 'user', b);
    d.setProductionConferenceListenOnly(p, a, c);
    const order = d.getProductionTargets(a, p).map(t => t.targetType + ':' + t.targetId);
    const result = d.connectProductionMatrixTargets(p, a);
    assert.equal(result.connections, 2);
    const targets = d.getProductionTargets(a, p);
    assert.equal(targets.length, 3);
    assert.equal(targets.find(t => t.targetType === 'conference').canTalk, true);
    assert.deepEqual(targets.slice(0, 2).map(t => t.targetType + ':' + t.targetId), order);
    assert.equal(d.getProductionTargets(b, p).length, 0);
    assert.equal(d.getProductionTargets(guest, p).length, 0);
    assert.throws(() => d.connectProductionMatrixTargets(p, outsider), /not a member/);
    assert.throws(() => d.connectProductionMatrixTargets(p, 'invalid'), /not a member/);
    assert.throws(() => d.connectProductionMatrixTargets(999999), /not found/);
    assert.equal(d.connectProductionMatrixTargets(p).connections, 7);
    assert.equal(d.connectProductionMatrixTargets(p).connections, 0);
    for (const id of [a, b, guest]) {
      const row = d.getProductionTargets(id, p);
      assert(!row.some(t => t.targetType === 'user' && [id, guest, outsider].includes(t.targetId)));
      assert(!row.some(t => t.targetType === 'conference' && t.targetId === outside));
      assert(!row.some(t => t.targetType === 'feed' && t.targetId === outsideFeed));
    }
    assert.equal(d.getProductionTargets(outsider, other).length, 0);
    const fresh = d.createProduction('Atomic');
    d.setProductionUser(fresh, a); d.setProductionUser(fresh, b);
    d.setProductionFeed(fresh, feed);
    sql.exec("CREATE TRIGGER reject_bulk_feed BEFORE INSERT ON production_user_targets WHEN NEW.target_type = 'feed' BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
    assert.throws(() => d.connectProductionMatrixTargets(fresh, a), /test rollback/);
    assert.equal(d.getProductionTargets(a, fresh).length, 0);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM production_target_order WHERE production_id = ?').get(fresh).n, 0);
    sql.exec('DROP TRIGGER reject_bulk_feed');
    d.setProductionConference(fresh, c);
    d.updateUserBridgeEndpoint(a, { enabled: true, bridgeDevice: 'test-bridge', triggerMode: 'always-on', triggerTargets: [{ type: 'conference', id: c }] });
    d.connectProductionMatrixTargets(fresh, a);
    const managed = d.getProductionTargets(a, fresh).find(t => t.targetType === 'conference');
    assert.equal(managed.bridgeManaged, true);
    assert.equal(managed.manualAssigned, false);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM production_user_conference WHERE production_id = ? AND user_id = ?').get(fresh, a).n, 0);
    assert.throws(() => d.disconnectProductionMatrixTargets(p, outsider), /not a member/);
    assert.throws(() => d.disconnectProductionMatrixTargets(999999), /not found/);
    d.setProductionConferenceListenOnly(p, b, c);
    const otherRow = d.getProductionTargets(b, p);
    assert.equal(d.disconnectProductionMatrixTargets(p, a).connections, 2);
    assert.equal(d.getProductionTargets(a, p).length, 1); // Bridge conference remains.
    assert.deepEqual(d.getProductionTargets(b, p), otherRow);
    assert.equal(d.getProductionTargets(a, fresh).length, 3); // Other production is untouched.
    assert.equal(d.disconnectProductionMatrixTargets(p).connections, 7);
    assert.equal(d.getProductionTargets(b, p).length, 0); // Includes listen-only conferences.
    assert.equal(d.disconnectProductionMatrixTargets(p).connections, 0);
    sql.exec("CREATE TRIGGER reject_bulk_remove BEFORE DELETE ON production_user_targets WHEN OLD.target_type = 'feed' BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
    assert.throws(() => d.disconnectProductionMatrixTargets(fresh, a), /test rollback/);
    assert.equal(d.getProductionTargets(a, fresh).length, 3);

  `], { cwd: root, env: { ...process.env, TALKTOME_DATA_DIR: dir }, stdio: 'pipe' });
});

const source = fs.readFileSync(path.join(root, 'public/admin.js'), 'utf8');
function uiFixture(confirmed) {
  const requests = [], confirmations = [];
  const container = { querySelectorAll: () => [] };
  const context = vm.createContext({
    productionTargetMatrixContainer: {}, selectedProductionId: null,
    adminConfirm: async (message, options) => { confirmations.push({ message, options }); return confirmed; },
    productionRequest: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { json: async () => ({ connections: 0, userIds: [], conferenceIds: [] }) }; },
    currentAdminCatalog: { users: [], conferences: [], feeds: [] }, renderTargetMatrix() {}, showMessage() {},
    escapeHtml: text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
  });
  vm.runInContext(source.slice(source.indexOf('function matrixConnectButton('), source.indexOf('function renderProductionTargetMatrix(')), context);
  return { context, container, requests, confirmations };
}

test('both bulk icons require confirmation before sending any request', async () => {
  for (const id of ['all', '12']) {
    const f = uiFixture(false);
    await f.context.handleMatrixConnectAll(f.container, { dataset: { matrixConnect: id, userName: 'Alice' } });
    assert.equal(f.confirmations.length, 1);
    assert.equal(f.requests.length, 0);
    assert.match(f.confirmations[0].message, /Conferences will be set to talk and listen/);
    assert.match(f.context.matrixConnectButton(id === 'all' ? null : { id: 12, name: 'Alice' }), /title="Connect all/);
  }
});

test('confirmation connects the selected row or whole matrix without sending a client-controlled target list', async () => {
  for (const id of ['all', '12']) {
    const f = uiFixture(true);
    await f.context.handleMatrixConnectAll(f.container, { dataset: { matrixConnect: id, userName: 'Alice' } });
    assert.deepEqual(f.requests, [{ url: '/admin/matrix/connect-all', body: { userId: id === 'all' ? null : 12 } }]);
  }
});


test('dialog defaults to Connect all on submit and keeps Disconnect all as a separate button', async () => {
  const nodes = new Map();
  let focused;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      classList: { add() {}, remove() {}, toggle() {} },
      parentElement: { classList: { toggle() {} } },
      setAttribute() {}, reset() {}, focus() { focused = id; },
      addEventListener(event, callback) { this[event] = callback; },
    });
    return nodes.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: node, body: node('body'), addEventListener() {} },
    window: { requestAnimationFrame(callback) { callback(); }, setTimeout() {} },
  });
  vm.runInContext(source.slice(source.indexOf('const adminActionDialog ='), source.indexOf('function syncExpandedAdminBarOffset(')), context);
  const options = { confirmLabel: 'Connect all', alternativeLabel: 'Disconnect all' };
  const connected = context.openAdminActionDialog(options);
  assert.equal(focused, 'admin-action-dialog-confirm');
  node('admin-action-dialog-form').submit({ preventDefault() {} });
  assert.equal(await connected, true);
  const disconnected = context.openAdminActionDialog(options);
  node('admin-action-dialog-alternative').click();
  assert.equal(await disconnected, 'alternative');
  const html = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
  assert.match(html, /type="button" id="admin-action-dialog-cancel"[^>]*>Cancel<\/button>\s*<button type="button" id="admin-action-dialog-alternative"[^>]*>Disconnect all<\/button>\s*<button type="submit" id="admin-action-dialog-confirm"/);
});

test('disconnect choice removes connections for the selected row or whole matrix', async () => {
  for (const id of ['all', '12']) {
    const f = uiFixture('alternative');
    await f.context.handleMatrixConnectAll(f.container, { dataset: { matrixConnect: id, userName: 'Alice' } });
    assert.equal(f.confirmations[0].options.alternativeLabel, 'Disconnect all');
    assert.deepEqual(f.requests, [{ url: '/admin/matrix/disconnect-all', body: { userId: id === 'all' ? null : 12 } }]);
  }
});

test('HTTP bulk connections require admin access and respect production-manager scope', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-matrix-http-'));
  let child, exited;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (exited) await exited;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const configPath = path.join(directory, 'config.json');
  const config = {
    tlsMode: 'proxy', httpsPort: port, httpPort: 'off', mdnsHost: 'off', multipleProductions: true,
    mediaNetworkMode: 'manual', mediaAnnouncedAddress: '127.0.0.1',
  };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const env = {
    ...process.env, TALKTOME_DATA_DIR: directory, TALKTOME_NO_WIZARD: '1',
    TALKTOME_CONFIG_PATH: configPath, TALKTOME_TLS_MODE: 'proxy',
    HTTPS_PORT: String(port), PORT: String(port), HTTP_PORT: 'off', MDNS_HOST: 'off', PUBLIC_IP: '127.0.0.1',
  };
  const ids = JSON.parse(execFileSync(process.execPath, ['-e', `
    console.log = () => {};
    const d = require('./src/server/dbHandler'), sql = require('./src/server/db');
    const manager = Number(d.createUser('Manager', 'matrix-test-only'));
    const member = Number(d.createUser('Member', 'matrix-test-only'));
    const primary = d.getPrimaryProduction().id;
    const own = d.createProduction('Managed'), other = d.createProduction('Other');
    d.setProductionUser(own, manager, { isAdmin: true }); d.setProductionUser(own, member);
    d.setProductionUser(other, member);
    d.updateUserPassword(d.getUserByName('admin').id, 'matrix-test-only');
    sql.prepare('UPDATE users SET admin_must_change = 0').run();
    process.stdout.write(JSON.stringify({ manager, member, primary, own, other }));
  `], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }));
  child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-16000); });
  exited = new Promise(resolve => child.once('exit', resolve));
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
    try {
      if ((await (await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(500) })).json()).ok) { ready = true; break; }
    } catch {}
    await delay(100);
  }
  assert.equal(ready, true, output);
  const post = (endpoint, body = {}, cookie = '') => fetch(`${origin}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body),
  });
  const login = async name => {
    const response = await post('/admin/login', { name, password: 'matrix-test-only' });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const ownEndpoint = `/admin/productions/${ids.own}/targets/connect-all`;
  assert.equal((await post(ownEndpoint)).status, 401);
  assert.equal((await post('/admin/matrix/connect-all')).status, 401);
  assert.equal((await post('/admin/login', { name: 'Member', password: 'matrix-test-only' })).status, 403);
  const manager = await login('Manager');
  assert.equal((await post('/admin/matrix/connect-all', {}, manager)).status, 403);
  assert.equal((await post(`/admin/productions/${ids.other}/targets/connect-all`, {}, manager)).status, 403);
  assert.equal((await post(ownEndpoint, { userId: 999999 }, manager)).status, 400);
  const connected = await post(ownEndpoint, { userId: ids.manager }, manager);
  assert.equal(connected.status, 200);
  assert.equal((await connected.json()).connections, 1);
  const all = await post(ownEndpoint, {}, manager);
  assert.equal(all.status, 200);
  assert.equal((await all.json()).connections, 1);
  const disconnectEndpoint = ownEndpoint.replace('connect-all', 'disconnect-all');
  assert.equal((await post(disconnectEndpoint)).status, 401);
  assert.equal((await post('/admin/matrix/disconnect-all', {}, manager)).status, 403);
  assert.equal((await post(`/admin/productions/${ids.other}/targets/disconnect-all`, {}, manager)).status, 403);
  assert.equal((await post(disconnectEndpoint, { userId: 999999 }, manager)).status, 400);
  const disconnected = await post(disconnectEndpoint, { userId: ids.manager }, manager);
  assert.equal(disconnected.status, 200);
  assert.equal((await disconnected.json()).connections, 1);
  assert.equal((await (await post(disconnectEndpoint, {}, manager)).json()).connections, 1);
  const admin = await login('admin');
  assert.equal((await post('/admin/matrix/connect-all', {}, admin)).status, 409);
  assert.equal((await post('/admin/matrix/disconnect-all', {}, admin)).status, 409);
  config.multipleProductions = false;
  fs.writeFileSync(configPath, JSON.stringify(config));
  assert.equal((await post('/admin/matrix/connect-all', {}, admin)).status, 200);
  assert.equal((await post('/admin/matrix/disconnect-all', {}, admin)).status, 200);
});
