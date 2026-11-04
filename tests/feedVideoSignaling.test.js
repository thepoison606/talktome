const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { io } = require('socket.io-client');
const root = require('./helpers/projectRoot');

// Real mediasoup worker + authenticated Socket.IO, not a mock of the routing policy.
test('audio and camera coexist; discovery, replacement and consumption respect video capability and feed assignment', { timeout: 25000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-video-signaling-'));
  const clients = []; let child, exited, output = '';
  t.after(async () => {
    clients.forEach(socket => socket.disconnect());
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (exited) await exited;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ tlsMode: 'proxy', httpsPort: port, httpPort: 'off', mdnsHost: 'off',
    multipleProductions: true, mediaNetworkMode: 'manual', mediaAnnouncedAddress: '127.0.0.1' }));
  const env = { ...process.env, TALKTOME_DATA_DIR: dir, TALKTOME_CONFIG_PATH: configPath, TALKTOME_NO_WIZARD: '1',
    TALKTOME_TLS_MODE: 'proxy', PORT: String(port), HTTPS_PORT: String(port), HTTP_PORT: 'off', MDNS_HOST: 'off', PUBLIC_IP: '127.0.0.1', COMPANION_API_KEY: 'video-test-only-key' };
  execFileSync(process.execPath, ['-e', `
    const db = require('./src/server/dbHandler');
    const feed = Number(db.createFeed('Camera', 'test-only'));
    const production = db.getPrimaryProduction().id;
    db.setProductionFeed(production, feed);
    db.updateFeedBridgeEndpoint(feed, { enabled: true, bridgeDevice: 'video-test' });
    const bridgeUser = Number(db.createUser('Bridge user', 'test-only'));
    db.updateUserBridgeEndpoint(bridgeUser, { enabled: true, bridgeDevice: 'video-test' });
    for (const name of ['Viewer','Native','Unassigned']) {
      const id = Number(db.createUser(name,'test-only')); db.setProductionUser(production,id);
      if(name !== 'Unassigned') db.addProductionTarget(production,id,'feed',feed);
    }
    require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'fixture.json'))}, JSON.stringify({feed,production,bridgeUser}));
  `], { cwd: root, env, stdio: 'pipe' });
  const fixture = JSON.parse(fs.readFileSync(path.join(dir, 'fixture.json')));
  child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-24000); });
  exited = new Promise(resolve => child.once('exit', resolve));
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100 && child.exitCode === null; i++) {
    try { if ((await fetch(`${origin}/api/v1/health`)).ok && output.includes('Router created')) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert(ready, output);
  const html = await (await fetch(origin)).text();
  assert(html.includes('id="feed-video-source"'));
  for (const asset of ['/feedVideo.js', '/feedVideo.css', '/targetLayers.js']) {
    assert(html.includes(asset)); assert.equal((await fetch(origin + asset)).status, 200);
  }
  const request = (socket, event, payload) => socket.timeout(5000).emitWithAck(event, ...(payload === undefined ? [] : [payload]));
  async function login(name, video) {
    const response = await fetch(`${origin}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'test-only' }) });
    assert.equal(response.status, 200);
    const identity = await response.json();
    const socket = io(origin, { transports: ['websocket'], forceNew: true, extraHeaders: { Cookie: response.headers.get('set-cookie').split(';')[0] } });
    clients.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const result = await request(socket, 'register-user', { id: identity.id, name: identity.name, kind: identity.kind,
      productionId: fixture.production, feedVideo: video });
    assert(result.ok, JSON.stringify(result));
    return socket;
  }
  const feed = await login('Camera', true), viewer = await login('Viewer', true), native = await login('Native', false), unassigned = await login('Unassigned', true);
  const announcements = [], nativeAnnouncements = [], closed = [];
  viewer.on('new-producer', event => announcements.push(event));
  native.on('new-producer', event => nativeAnnouncements.push(event));
  viewer.on('producer-closed', event => closed.push(event));
  const caps = await request(viewer, 'get-router-rtp-capabilities');
  assert(caps.codecs.some(c => c.mimeType === 'video/VP8'));
  assert(caps.codecs.some(c => c.mimeType === 'video/H264'));
  assert((await request(feed, 'create-send-transport', null)).id);
  const produce = (kind, ssrc) => request(feed, 'produce', { kind, appData: { type: 'feed', id: fixture.feed }, rtpParameters: {
    mid: String(ssrc), codecs: kind === 'audio'
      ? [{ mimeType: 'audio/opus', payloadType: 111, clockRate: 48000, channels: 2 }]
      : [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }],
    encodings: [{ ssrc }], rtcp: { cname: `video-test-${ssrc}` },
  } });
  const audio = await produce('audio', 10001); assert(audio.id, JSON.stringify(audio));
  const video = await produce('video', 10002); assert(video.id, JSON.stringify(video));
  await delay(30);
  assert(announcements.some(p => p.kind === 'video' && p.producerId === video.id));
  assert(nativeAnnouncements.every(p => p.kind === 'audio'));
  let active = await request(viewer, 'request-active-producers');
  assert(active.some(p => p.producerId === audio.id)); assert(active.some(p => p.producerId === video.id));
  assert((await request(native, 'request-active-producers')).every(p => p.kind === 'audio'));
  assert.deepEqual(await request(unassigned, 'request-active-producers'), []);
  for (const socket of [viewer, native, unassigned]) assert((await request(socket, 'create-recv-transport', null)).id);
  const consumption = await request(viewer, 'consume', { producerId: video.id, rtpCapabilities: caps });
  assert.equal(consumption.kind, 'video'); assert(consumption.id);
  await request(viewer, 'resume-consumer', { consumerId: consumption.id });
  for (const socket of [native, unassigned]) {
    assert.match((await request(socket, 'consume', { producerId: video.id, rtpCapabilities: caps })).error, /Not authorized/);
  }
  assert.match((await request(viewer, 'produce', { kind: 'video', appData: { type: 'feed', id: fixture.feed }, rtpParameters: {} })).error, /assigned browser feed/);
  assert.match((await request(feed, 'produce', { kind: 'video', appData: { type: 'feed', id: fixture.feed + 1 }, rtpParameters: {} })).error, /assigned browser feed/);
  assert.match((await request(viewer, 'consume-plain', { producerId: video.id, ip: '127.0.0.1', port: 45999 })).error, /browser WebRTC/);
  const replacement = await produce('video', 10003); assert(replacement.id);
  await delay(30);
  assert(closed.some(p => p.producerId === video.id));
  active = await request(viewer, 'request-active-producers');
  assert(active.some(p => p.producerId === audio.id), 'camera replacement must not close feed audio');
  assert(!active.some(p => p.producerId === video.id)); assert(active.some(p => p.producerId === replacement.id));
  assert((await request(feed, 'producer-close', { producerId: replacement.id })).ok);
  await delay(20);
  assert(closed.some(p => p.producerId === replacement.id));
  active = await request(viewer, 'request-active-producers'); assert.deepEqual(active.map(p => p.producerId), [audio.id]);
  const lastVideo = await produce('video', 10004); assert(lastVideo.id);
  await delay(20); feed.disconnect(); await delay(30);
  assert(closed.some(p => p.producerId === lastVideo.id), 'disconnect must withdraw video availability even without consumers');

  // The same router accepts H.264 from a native Bridge, without exposing video
  // to legacy native clients or tearing down the independent Opus producer.
  async function api(method, route, body, expected = 200) {
    const response = await fetch(origin + route, { method, headers: {
      'Content-Type': 'application/json', 'x-api-key': 'video-test-only-key',
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result)); return result;
  }
  const inventory = { host: 'Test', devices: [], videoSources: [
    { id: 'ndi:recv:0123456789abcdef', name: 'NDI · Test', protocol: 'ndi' },
    { id: 'file:///tmp/no-video', name: 'Rejected' },
  ] };
  const announced = await api('POST', '/api/v1/bridge/announce', { bridgeId: 'video-test', inventory });
  assert.equal(announced.bridge.inventory.videoSources.length, 1);
  const bridge = await api('POST', '/api/v1/bridge/sessions', { bridgeId: 'video-test', portId: `feed-${fixture.feed}` });
  const route = `/api/v1/bridge/sessions/${bridge.sessionId}`;
  await api('POST', route + '/video-send-transport', {}, 403);
  const userBridge = await api('POST', '/api/v1/bridge/sessions', { bridgeId: 'video-test', portId: `user-${fixture.bridgeUser}` });
  await api('POST', `/api/v1/bridge/sessions/${userBridge.sessionId}/video-send-transport`, {}, 403);
  const configured = await api('PUT', `/api/v1/bridge/video-test/ports/feed/${fixture.feed}`, {
    videoSource: inventory.videoSources[0].id,
  });
  assert.equal(configured.ports.find(port => port.kind === 'feed').videoSource, inventory.videoSources[0].id);
  const audioTransport = await api('POST', route + '/plain-send-transport', {});
  const bridgeAudio = await api('POST', route + '/producers', audioTransport);
  const videoTransport = await api('POST', route + '/video-send-transport', {});
  assert.equal(videoTransport.payloadType, 102);
  const bridgeVideo = await api('POST', route + '/video-producer', {});
  assert(!(await request(viewer, 'request-active-producers')).some(p => p.producerId === bridgeVideo.id), 'source must not be advertised before its first encoded picture');
  await api('POST', route + `/producers/${bridgeVideo.id}/resume`, {});
  let bridgeActive = await request(viewer, 'request-active-producers');
  assert(bridgeActive.some(p => p.producerId === bridgeAudio.id));
  assert(bridgeActive.some(p => p.producerId === bridgeVideo.id && p.kind === 'video'));
  assert((await request(native, 'request-active-producers')).every(p => p.kind === 'audio'));
  assert.deepEqual(await request(unassigned, 'request-active-producers'), []);
  const h264 = await request(viewer, 'consume', { producerId: bridgeVideo.id, rtpCapabilities: caps });
  assert.equal(h264.kind, 'video'); assert(h264.id);
  const audioReplacement = await api('POST', route + '/producers', audioTransport);
  bridgeActive = await request(viewer, 'request-active-producers');
  assert(bridgeActive.some(p => p.producerId === bridgeVideo.id), 'audio restart retains video');
  await api('DELETE', route + '/video');
  bridgeActive = await request(viewer, 'request-active-producers');
  assert.deepEqual(bridgeActive.map(p => p.producerId), [audioReplacement.id]);
  assert(closed.some(p => p.producerId === bridgeVideo.id));
  await api('POST', route + '/video-send-transport', {});
  const lastBridgeVideo = await api('POST', route + '/video-producer', {});
  await api('POST', route + `/producers/${lastBridgeVideo.id}/resume`, {});
  await api('DELETE', route);
  await delay(20);
  assert(closed.some(p => p.producerId === lastBridgeVideo.id));
  assert.deepEqual(await request(viewer, 'request-active-producers'), []);

});
