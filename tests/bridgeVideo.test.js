const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = require('./helpers/projectRoot');

test('Bridge video selection survives restart, legacy audio edits and backup restore', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-bridge-video-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = script => execFileSync(process.execPath, ['-e', `const assert=require('node:assert/strict'); const db=require('./src/server/dbHandler'); ${script}`], {
    cwd: root, env: { ...process.env, TALKTOME_DATA_DIR: dir }, stdio: 'pipe',
  });
  run(`const feed=Number(db.createFeed('Camera','test-only')); const routing={enabled:true,bridgeDevice:'bridge-test'};
    db.updateFeedBridgeEndpoint(feed,{...routing,videoSource:'ndi:recv:0123456789abcdef'});
    db.updateFeedBridgeEndpoint(feed,routing);
    assert.equal(db.getAllFeeds()[0].bridge_video_source,'ndi:recv:0123456789abcdef');
    assert.throws(()=>db.updateFeedBridgeEndpoint(feed,{...routing,videoSource:'file:///etc/passwd'}),/NDI or OMT/);
    const snapshot=db.exportDatabaseSnapshot();
    db.updateFeedBridgeEndpoint(feed,{...routing,videoSource:''});
    db.importDatabaseSnapshot(snapshot);`);
  run(`const row=db.getAllFeeds()[0];
    assert.equal(row.bridge_video_source,'ndi:recv:0123456789abcdef');
    assert.equal(db.getFeedBridgeEndpointsForDevice('bridge-test')[0].video_source,row.bridge_video_source);
    const legacy=db.exportDatabaseSnapshot(); legacy.feedBridgeEndpoints.forEach(row=>delete row.video_source);
    db.importDatabaseSnapshot(legacy); assert.equal(db.getAllFeeds()[0].bridge_video_source,'');`);
});

const source = fs.readFileSync(path.join(root, 'bridge-client/src/app.js'), 'utf8');
function runtime() {
  let now=1000; const calls=[];
  const port={id:'feed-1',kind:'feed',videoSource:'ndi:recv:0123456789abcdef'};
  const session={port,sessionId:'session-1',ready:true,producerId:'audio-1',inputReady:true};
  const context=vm.createContext({ Map, Date:{now:()=>now}, managedSessions:new Map([['feed-1',session]]),
    withTimeout:p=>p, managedSessionPath:(s,suffix='')=>`/sessions/${s.sessionId}${suffix}`,
    invoke:async(command,payload)=>{calls.push({command,payload}); return [];},
    bridgeApi:async(method,url)=>{calls.push({method,url}); return url.endsWith('video-producer')?{id:'video-1'}:{ip:'127.0.0.1',port:40000,payloadType:102,ssrc:1111,cname:'feed-1'};},
  });
  vm.runInContext(source.slice(source.indexOf('async function stopManagedVideoPath('),source.indexOf('async function startManagedSession(')),context);
  return {context,session,calls,advance:ms=>now+=ms};
}

test('video failure/recovery leaves the feed audio producer and input running',async()=>{
  const {context,session,calls,advance}=runtime();
  context.invoke=async(command)=>{calls.push({command});if(command==='start_bridge_video')throw new Error('Source disappeared');return [];};
  await context.startManagedVideoPath(session);
  assert.match(session.videoError,/Source disappeared/);assert.equal(session.producerId,'audio-1');assert.equal(session.inputReady,true);
  assert(!calls.some(call=>call.command==='stop_bridge_input'));
  assert(!calls.some(call=>call.url==='/sessions/session-1'&&call.method==='DELETE'));
  advance(6000); context.invoke=async command=>{calls.push({command});return [];};
  await context.auditManagedVideoStatus();assert.equal(session.videoProducerId,'video-1');assert.equal(session.videoError,null);
  context.invoke=async command=>command==='get_bridge_video_status'?[{streamId:'feed-1:video',running:true,encodedFrames:20,lastFrameAgeMs:10}]:[];
  await context.auditManagedVideoStatus(); assert.equal(session.videoFrames,20);
  session.port.videoSource='';await context.stopManagedVideoPath(session);
  assert.equal(session.videoProducerId,null);assert.equal(session.producerId,'audio-1');
});

test('cancelling while a video transport is being created never starts native capture',async()=>{
  const {context,session,calls}=runtime();let finish;
  context.bridgeApi=async(method,url)=>{calls.push({method,url});if(url.endsWith('video-send-transport'))return new Promise(resolve=>finish=resolve);return {};};
  const pending=context.startManagedVideoPath(session);
  await context.stopManagedVideoPath(session);session.port.videoSource='';
  finish({port:40000,ip:'127.0.0.1'});await pending;
  assert(!calls.some(call=>call.command==='start_bridge_video'));
  assert.equal(session.videoStarting,false);assert.equal(session.producerId,'audio-1');
});

test('administrator permission prevents native video capture without disabling feed audio', async () => {
  const { context, session, calls } = runtime();
  session.port.videoAllowed = false;
  await context.startManagedVideoPath(session); await context.auditManagedVideoStatus();
  assert(!calls.some(call => call.command === 'start_bridge_video'));
  assert.equal(session.producerId, 'audio-1'); assert.equal(session.inputReady, true);
});

test('feed video overrides survive restart, backups and legacy restores', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-feed-video-permission-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = script => execFileSync(process.execPath, ['-e', `const assert=require('node:assert/strict'); const db=require('./src/server/dbHandler'); ${script}`], {
    cwd: root, env: { ...process.env, TALKTOME_DATA_DIR: dir }, stdio: 'pipe',
  });
  run(`const id=Number(db.createFeed('Camera','test-only'));
    assert.equal(db.getFeedById(id).allow_feed_video,null);
    assert.throws(()=>db.updateFeedVideoPermission(id,'true'),/boolean/);
    db.updateFeedVideoPermission(id,true); const snapshot=db.exportDatabaseSnapshot();
    db.updateFeedVideoPermission(id,false); db.importDatabaseSnapshot(snapshot);
    assert.equal(db.getAllFeeds()[0].allow_feed_video,1);`);
  run(`const id=db.getAllFeeds()[0].id; assert.equal(db.getFeedById(id).allow_feed_video,1);
    db.updateFeedVideoPermission(id,false); assert.equal(db.getFeedById(id).allow_feed_video,0);
    const old=db.exportDatabaseSnapshot(); old.feeds.forEach(row=>delete row.allow_feed_video);
    db.importDatabaseSnapshot(old); assert.equal(db.getFeedById(id).allow_feed_video,null);
    const bad=db.exportDatabaseSnapshot(); bad.feeds[0].allow_feed_video='false';
    assert.throws(()=>db.importDatabaseSnapshot(bad),/Invalid feed video permission/);
    assert.equal(db.getAllFeeds().length,1);`);
});
