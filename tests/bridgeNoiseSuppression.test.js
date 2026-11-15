const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const levels = require('../public/bridgeAudioLevels');

test('noise suppression is input-only, opt-in and does not change gain/mute defaults', () => {
  assert.deepEqual(levels.normalizeLevel({},'input'),{gainDb:0,muted:false});
  assert.equal(levels.normalizeLevel({noiseSuppression:true},'input').noiseSuppression,true);
  assert.throws(()=>levels.normalizeLevel({noiseSuppression:'yes'},'input',{strict:true}),/boolean/);
  assert.throws(()=>levels.normalizeLevel({noiseSuppression:true},'output',{strict:true}),/only available on inputs/);
});

test('per-input suppression persists, survives backup/restart, and legacy gain edits retain it', t => {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'talktome-noise-'));
  t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
  const run=script=>execFileSync(process.execPath,['-e',`const assert=require('node:assert/strict');const db=require('./src/server/dbHandler');${script}`],{
    cwd:path.resolve(__dirname,'..'),env:{...process.env,TALKTOME_DATA_DIR:dataDir},encoding:'utf8',
  });
  run(`
    const user=Number(db.createUser('Noise port','test-password'));
    const feed=Number(db.createFeed('Noise feed','test-password'));
    const routing={enabled:true,bridgeDevice:'test-bridge'};
    db.updateUserBridgeEndpoint(user,routing);db.updateFeedBridgeEndpoint(feed,routing);
    db.updateBridgePortAudioLevel('user',user,'input',{gainDb:6,muted:false,noiseSuppression:true});
    db.updateBridgePortAudioLevel('feed',feed,'input',{gainDb:-3,muted:false,noiseSuppression:true});
    db.updateBridgePortAudioLevel('user',user,'input',{gainDb:8,muted:true});
    assert.equal(db.getBridgePortAudioLevels('user',user).input.noiseSuppression,true);
    assert.throws(()=>db.updateBridgePortAudioLevel('user',user,'input','bad'),/object/);
    const backup=db.exportDatabaseSnapshot();db.importDatabaseSnapshot(backup);
  `);
  run(`
    const user=db.getAllUsers().find(u=>u.name==='Noise port').id;
    const feed=db.getAllFeeds().find(f=>f.name==='Noise feed').id;
    assert.deepEqual(db.getBridgePortAudioLevels('user',user).input,{gainDb:8,muted:true,noiseSuppression:true});
    assert.equal(db.getBridgePortAudioLevels('feed',feed).input.noiseSuppression,true);
    db.updateBridgePortAudioLevel('user',user,'input',{gainDb:8,muted:true,noiseSuppression:false});
    assert.equal(Boolean(db.getBridgePortAudioLevels('user',user).input.noiseSuppression),false);
    assert.equal(db.getBridgePortAudioLevels('feed',feed).input.noiseSuppression,true);
  `);
});

test('an older server cannot silently turn off a local suppression preview', async () => {
  const vm=require('node:vm');
  const source=fs.readFileSync(path.resolve(__dirname,'../bridge-client/src/app.js'),'utf8');
  const level={gainDb:0,muted:false,noiseSuppression:true};
  const edit={dirty:true,saving:false,revision:1,level,nativePromise:Promise.resolve()};
  const port={kind:'user',userId:7,audioLevels:{input:level}};
  const ctx=vm.createContext({managedAudioEdits:new Map([['input',edit]]),audioEditKey:()=> 'input',managedBridgeConfig:{bridgeId:'test',ports:[port]},bridgePortTargetId:()=>7,bridgePortKey:()=> 'user:7',updateManagedAudioControl(){},
    bridgeApi:async()=>({audioLevels:{input:{gainDb:0,muted:false}}}),
  });
  vm.runInContext(source.slice(source.indexOf('async function persistManagedAudioLevel('),source.indexOf('function changeManagedAudioLevel(')),ctx);
  await ctx.persistManagedAudioLevel(port,'input');
  assert.equal(edit.dirty,true);
  assert.match(edit.error,/not saved by the server/);
  assert.equal(port.audioLevels.input.noiseSuppression,true);
});

test('a confirmed server setting clears a stale save error; an unconfirmed one retries', () => {
  const vm=require('node:vm');const source=fs.readFileSync('bridge-client/src/app.js','utf8');
  const level={gainDb:0,muted:false,noiseSuppression:true};
  const edit={dirty:true,saving:false,error:'old error',level,retryAt:0};let retries=0;
  const ctx=vm.createContext({managedAudioEdits:new Map([['input',edit]]),audioEditKey:(_p,d)=>d,audioLevels:levels,Date,JSON,persistManagedAudioLevel(){retries++;}});
  vm.runInContext(source.slice(source.indexOf('function reconcileManagedAudioEdits('),source.indexOf('async function reconcileManagedBridgeConfig(')),ctx);
  ctx.reconcileManagedAudioEdits({ports:[{audioLevels:{input:{gainDb:0,muted:false}}}]});
  assert.equal(retries,1);assert.equal(edit.dirty,true);
  ctx.reconcileManagedAudioEdits({ports:[{audioLevels:{input:level}}]});
  assert.equal(edit.dirty,false);assert.equal(edit.error,null);
});

test('Bridge can save suppression on, off, then on against the real persistence layer', t => {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'talktome-noise-toggle-'));
  t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
  execFileSync(process.execPath,['-e',`
    const assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs');
    const db=require('./src/server/dbHandler'), levels=require('./public/bridgeAudioLevels');
    const source=fs.readFileSync('bridge-client/src/app.js','utf8');
    const id=Number(db.createUser('Toggle port','test-password'));
    db.updateUserBridgeEndpoint(id,{enabled:true,bridgeDevice:'test'});
    const port={kind:'user',userId:id,audioLevels:db.getBridgePortAudioLevels('user',id)};
    const edits=new Map();
    const context=vm.createContext({managedAudioEdits:edits,audioEditKey:()=> 'input',managedBridgeConfig:{bridgeId:'test',ports:[port]},bridgePortTargetId:()=>id,bridgePortKey:()=> 'user:'+id,updateManagedAudioControl(){},
      bridgeApi:async(_method,_path,body)=>({audioLevels:db.updateBridgePortAudioLevel('user',id,'input',body)})});
    vm.runInContext(source.slice(source.indexOf('async function persistManagedAudioLevel('),source.indexOf('function changeManagedAudioLevel(')),context);
    (async()=>{
      for(const enabled of [true,false,true,false]) {
        const edit={dirty:true,saving:false,revision:1,level:levels.normalizeLevel({gainDb:0,muted:false,noiseSuppression:enabled},'input'),nativePromise:Promise.resolve()};
        edits.set('input',edit);
        await context.persistManagedAudioLevel(port,'input');
        assert.equal(edit.error,null);assert.equal(edit.dirty,false);
        assert.equal(Boolean(db.getBridgePortAudioLevels('user',id).input.noiseSuppression),enabled);
      }
    })().catch(error=>{console.error(error);process.exitCode=1;});
  `],{cwd:path.resolve(__dirname,'..'),env:{...process.env,TALKTOME_DATA_DIR:dataDir},encoding:'utf8'});
});
