const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { HTTP_RATE_LIMITS, installHttpRateLimits } = require('../src/server/httpRateLimits');
const { resolveWebAccess } = require('../src/server/webAccess');

async function fixture(t, overrides = {}, access = resolveWebAccess({}, {})) {
  const app = express();
  const policies = Object.fromEntries(Object.entries(HTTP_RATE_LIMITS).map(([name, value]) => [
    name, { ...value, limit: { all: 50, login: 2, admin: 3, control: 4 }[name], ...overrides[name] },
  ]));
  const limiters = installHttpRateLimits(app, { policies, getWebAccess: () => access });
  app.use(express.json());
  let handled = 0;
  app.use((req, res) => {
    handled++;
    const isLogin = /login/i.test(req.path) && req.method === 'POST';
    res.status(isLogin && req.get('x-test-result') !== 'success' ? 401 : 200).json({ handled });
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (path, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path, ...options }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
  return { request, limiters, getHandled: () => handled };
}

test('limits run before JSON parsing and file/route handlers, with retry headers', async t => {
  const { request, getHandled } = await fixture(t, { all: { limit: 2 } });
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/socket.io.js')).status, 200);
  const denied = await request('/admin/config/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalid',
  });
  assert.equal(denied.status, 429);
  assert(Number(denied.headers['retry-after']) > 0);
  assert(denied.headers['ratelimit']);
  assert.match(JSON.parse(denied.body).error, /Too many requests/);
  assert.equal(getHandled(), 2);
});

test('failed logins share a quota across identities, routes, case and trailing slash', async t => {
  const { request } = await fixture(t);
  const post = path => request(path, { method: 'POST' });
  assert.equal((await post('/login')).status, 401);
  assert.equal((await post('/LOGIN/token/')).status, 401);
  for (const path of ['/admin/login', '/api/v1/companion/auth/login', '/login/guest', '/login/sso']) {
    assert.equal((await post(path)).status, 429, path);
  }
  assert.equal((await request('/login/options')).status, 200);
  assert.equal((await request('/api/v1/bridge/sessions/one/heartbeat', { method: 'POST' })).status, 200);
});

test('successful logins do not consume the failure quota', async t => {
  const { request } = await fixture(t, { admin: { limit: 20 }, control: { limit: 20 } });
  for (const path of ['/login', '/login/token', '/admin/login', '/api/v1/companion/auth/login']) {
    assert.equal((await request(path, { method: 'POST', headers: { 'x-test-result': 'success' } })).status, 200);
  }
  assert.equal((await request('/login', { method: 'POST' })).status, 401);
  assert.equal((await request('/login', { method: 'POST' })).status, 401);
  assert.equal((await request('/login', { method: 'POST' })).status, 429);
});

test('Admin/Panel and API quotas are independent and cover nested routes', async t => {
  const { request } = await fixture(t);
  for (const path of ['/admin/status', '/users/1', '/feeds/2']) assert.equal((await request(path)).status, 200);
  assert.equal((await request('/panel?userId=1')).status, 429);
  for (const path of ['/api/v1/companion/state', '/api/v1/bridge/announce', '/api/v1/client/targets/available', '/api/v1/health']) {
    assert.equal((await request(path)).status, 200);
  }
  assert.equal((await request('/api/v1/bridge/sessions/one/events/stream')).status, 429);
  assert.equal((await request('/client.js')).status, 200);
});

test('untrusted forwarding headers cannot bypass limits', async t => {
  const { request } = await fixture(t, { all: { limit: 2 } });
  for (let i = 1; i <= 3; i++) {
    const result = await request('/', { headers: { 'x-forwarded-for': `192.0.2.${i}`, forwarded: `for=192.0.2.${i}` } });
    assert.equal(result.status, i <= 2 ? 200 : 429);
  }
});

test('trusted proxy chains separate clients but stop at the first untrusted hop', async t => {
  const access = resolveWebAccess({ trustedProxies: '127.0.0.1' }, {});
  const { request } = await fixture(t, { all: { limit: 1 } }, access);
  const forwarded = value => request('/', { headers: { 'x-forwarded-for': value } });
  assert.equal((await forwarded('192.0.2.1')).status, 200);
  assert.equal((await forwarded('192.0.2.2')).status, 200);
  assert.equal((await forwarded('192.0.2.99, 192.0.2.1')).status, 429);
});

test('IPv6 address rotation within a /56 subnet shares the quota', async t => {
  const access = resolveWebAccess({ trustedProxies: '127.0.0.1' }, {});
  const { request } = await fixture(t, { all: { limit: 1 } }, access);
  const forwarded = value => request('/', { headers: { 'x-forwarded-for': value } });
  assert.equal((await forwarded('2001:db8:1234:5600::1')).status, 200);
  assert.equal((await forwarded('2001:db8:1234:56ff::2')).status, 429);
  assert.equal((await forwarded('2001:db8:1234:5700::1')).status, 200);
});

test('expired windows allow requests again without retaining the old quota', async t => {
  const { request } = await fixture(t, { all: { limit: 1, windowMs: 400 } });
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/')).status, 429);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal((await request('/')).status, 200);
});

test('reaching the quota does not interrupt an already-open SSE stream', async t => {
  const app = express();
  installHttpRateLimits(app, {
    policies: { ...HTTP_RATE_LIMITS, all: { windowMs: 60_000, limit: 2 } },
  });
  let stream;
  app.get('/admin/status/events', (req, res) => {
    stream = res;
    res.setHeader('Content-Type', 'text/event-stream');
    res.write('data: connected\n\n');
  });
  app.get('/api/v1/health', (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/admin/status/events`, { signal: AbortSignal.timeout(5000) });
  const reader = response.body.getReader();
  t.after(() => reader.cancel());
  assert.match(new TextDecoder().decode((await reader.read()).value), /connected/);
  assert.equal((await fetch(`${origin}/api/v1/health`)).status, 200);
  assert.equal((await fetch(`${origin}/api/v1/health`)).status, 429);
  stream.write('data: still-connected\n\n');
  assert.match(new TextDecoder().decode((await reader.read()).value), /still-connected/);
  stream.end();
});
