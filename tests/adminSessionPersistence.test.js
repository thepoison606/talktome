const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const projectRoot = require('./helpers/projectRoot');

test('Admin HTTP and status-stream sessions survive restart, retain isolation and honor logout and revoked rights', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-admin-restart-'));
  let child, exited;
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (exited) await exited;
    child = null;
  }
  t.after(async () => { await stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const configPath = path.join(directory, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ tlsMode: 'proxy', httpsPort: port, httpPort: 'off', mdnsHost: 'off', mediaNetworkMode: 'manual', mediaAnnouncedAddress: '127.0.0.1' }));
  const env = { ...process.env, TALKTOME_DATA_DIR: directory, TALKTOME_NO_WIZARD: '1', TALKTOME_CONFIG_PATH: configPath, TALKTOME_TLS_MODE: 'proxy', HTTPS_PORT: String(port), PORT: String(port), HTTP_PORT: 'off', MDNS_HOST: 'off', PUBLIC_IP: '127.0.0.1' };
  const database = script => execFileSync(process.execPath, ['-e', script], { cwd: projectRoot, env, stdio: 'pipe' });
  database(`const db = require('./src/server/dbHandler'); db.updateUserPassword(db.getUserByName('admin').id, 'Admin-test-secret'); db.createUser('operator', 'Operator-test-secret'); require('./src/server/db').prepare('UPDATE users SET admin_must_change = 0').run();`);
  const origin = `http://127.0.0.1:${port}`;
  async function start() {
    child = spawn(process.execPath, [path.join(projectRoot, 'server.js')], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-8000); });
    exited = new Promise(resolve => child.once('exit', resolve));
    for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
      try { if ((await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
      await delay(100);
    }
    assert.fail(output);
  }
  const request = (url, cookie, method = 'GET', body) => fetch(`${origin}${url}`, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  async function login() {
    const response = await request('/admin/login', null, 'POST', { name: 'admin', password: 'Admin-test-secret' });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  await start();
  const cookie = await login();
  assert.equal((await request('/admin/me', cookie)).status, 200);
  const operator = await request('/login', null, 'POST', { name: 'operator', password: 'Operator-test-secret' });
  const operatorToken = operator.headers.get('set-cookie').split(';')[0].split('=')[1];
  assert.equal((await request('/admin/me', `admin_session=${operatorToken}`)).status, 401);
  assert.equal((await request('/login/session', cookie.replace('admin_session=', 'talktome_session='))).status, 204);
  await stop(); await start();
  assert.equal((await request('/admin/me', cookie)).status, 200);
  assert.equal((await request('/users', cookie)).status, 200);
  const stream = await request('/admin/status/events', cookie);
  assert.equal(stream.status, 200);
  await stream.body.cancel();
  assert.equal((await request('/admin/logout', cookie, 'POST')).status, 204);
  await stop(); await start();
  assert.equal((await request('/admin/me', cookie)).status, 401);
  const newCookie = await login();
  database(`require('./src/server/db').prepare('UPDATE users SET is_admin = 0, is_superadmin = 0 WHERE name = ?').run('admin');`);
  assert.equal((await request('/users', newCookie)).status, 401);
  await stop();
  const sqlite = fs.readFileSync(path.join(directory, 'app.db'));
  assert.equal(sqlite.includes(Buffer.from(cookie.split('=')[1])), false, 'persist token hashes only');
});

test('an expired Admin session opens the login view without needing a page refresh', async () => {
  const source = fs.readFileSync(path.join(projectRoot, 'public/admin.js'), 'utf8');
  const notices = [];
  const context = vm.createContext({ fetch: async () => ({ status: 401 }), adminState: { isAuthenticated: true }, showLogin: message => notices.push(message) });
  vm.runInContext(source.slice(source.indexOf('async function authedFetch('), source.indexOf('async function fetchJSON(')), context);
  await assert.rejects(context.authedFetch('/users'), /Unauthorized/);
  assert.equal(context.adminState.isAuthenticated, false);
  assert.deepEqual(notices, ['Session expired. Please sign in again.']);
});
