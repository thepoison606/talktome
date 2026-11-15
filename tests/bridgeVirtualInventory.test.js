const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('virtual devices supplied to announce_bridge contain every native inventory field',()=>{
  const source=fs.readFileSync('bridge-client/src/app.js','utf8');
  const ctx=vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function virtualSilenceDevice('),source.indexOf('function renderInventory(')),ctx);
  const expected=JSON.parse(fs.readFileSync('bridge-client/test-fixtures/silence-inventory.json','utf8'));
  const actual=['input','output'].map(d=>JSON.parse(JSON.stringify(ctx.virtualSilenceDevice(d))));
  assert.deepEqual(actual,expected.devices);
});

test('managed device choices default to None first and retain saved missing devices',()=>{
  const source=fs.readFileSync('bridge-client/src/app.js','utf8');
  const ctx=vm.createContext({devicesByDirection:()=>[{id:'mic',name:'Microphone'},{id:'bridge:none',name:'None'}],escapeHtml:s=>s,getDeviceLabel:d=>d.name});
  vm.runInContext(source.slice(source.indexOf('function buildManagedDeviceOptions('),source.indexOf('function buildManagedChannelOptions(')),ctx);
  const empty=ctx.buildManagedDeviceOptions('input','');
  assert.match(empty,/^<option value="bridge:none" selected>None<\/option>/);
  assert.doesNotMatch(empty,/Select device/);
  assert.equal((empty.match(/value="bridge:none"/g)||[]).length,1);
  assert.match(ctx.buildManagedDeviceOptions('input','unplugged'),/value="unplugged" selected/);
  assert.match(ctx.buildManagedDeviceOptions('input','mic'),/value="mic" selected/);
});

test('an empty or incomplete inventory is retried after the cooldown even without a topology change',()=>{
  const source=fs.readFileSync('bridge-client/src/app.js','utf8'),ctx=vm.createContext({Date});
  vm.runInContext(source.slice(source.indexOf('function inventoryNeedsRetry('),source.indexOf('function renderInventory(')),ctx);
  assert.equal(ctx.inventoryNeedsRetry({devices:[{id:'bridge:none'}]},1000,30000),false);
  assert.equal(ctx.inventoryNeedsRetry({devices:[{id:'bridge:none'}]},1000,31000),true);
  assert.equal(ctx.inventoryNeedsRetry({devices:[{id:'mic'}],warnings:['probe timed out']},1000,31000),true);
  assert.equal(ctx.inventoryNeedsRetry({devices:[{id:'mic'}],warnings:[]},1000,31000),false);
});

test('rendering inventory keeps real input/output devices alongside the None choices',()=>{
  const source=fs.readFileSync('bridge-client/src/app.js','utf8');
  const ctx=vm.createContext({Date,currentInventory:null,lastFullInventoryScanAt:0,lastAudioDeviceSnapshotSignature:'',audioDeviceSnapshotSignature:()=> 'snapshot',renderSummary(){},audioScanStatus:null,refreshButton:null,deviceList:null,renderAllPortControls(){}});
  vm.runInContext(source.slice(source.indexOf('function virtualSilenceDevice('),source.indexOf('async function announceBridge(')),ctx);
  const devices=[{id:'mic',direction:'input',name:'Microphone'},{id:'speaker',direction:'output',name:'Speakers'}];
  ctx.renderInventory({devices:[...devices],warnings:[]});
  assert.equal(ctx.currentInventory.devices.length,4);
  assert.equal(ctx.currentInventory.devices[0].id,'mic');assert.equal(ctx.currentInventory.devices[1].id,'speaker');
  ctx.renderInventory(ctx.currentInventory);
  assert.equal(ctx.currentInventory.devices.length,4);
});
