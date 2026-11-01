const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { canUserAddRemoveTargets } = require('../src/server/targetOrdering');
const { resolveDefaultClientSettings } = require('../src/server/defaultClientSettings');

test('target editing is opt-in, inherits server defaults and respects per-user overrides', () => {
  const user = { id: 1 };
  assert.equal(resolveDefaultClientSettings({}).allowTargetAddRemove, false);
  assert.equal(canUserAddRemoveTargets(user), false);
  assert.equal(canUserAddRemoveTargets(user, { allowTargetAddRemove: true }), true);
  assert.equal(canUserAddRemoveTargets({ ...user, allow_target_add_remove: 0 }, { allowTargetAddRemove: true }), false);
  assert.equal(canUserAddRemoveTargets({ ...user, allow_target_add_remove: 1 }), true);
  for (const extra of [{ is_superadmin: 1 }, { is_guest_profile: 1 }]) assert.equal(canUserAddRemoveTargets({ ...user, ...extra, allow_target_add_remove: 1 }), false);
});

test('self-service endpoints derive identity from login and reject disabled, guest and foreign-production edits', () => {
  const source = fs.readFileSync(require.resolve('../src/server/serverCore'), 'utf8');
  const start = source.indexOf('function clientTargetEditor(');
  const end = source.indexOf("app.put('/api/v1/client/targets/order'", start);
  const routes = new Map();
  let session = { kind: 'user', userId: 7 }, allowed = false, member = true, changed = [];
  const available = [{ targetType: 'feed', targetId: 3, name: 'Program', canTalk: false }];
  vm.runInNewContext(source.slice(start, end), {
    app: { get: (p, f) => routes.set(p, f), put: (p, f) => routes.set(p, f) },
    getBrowserSession: () => ({ session }), getUserById: id => ({ id }),
    isTargetAddRemoveAllowed: () => allowed, areMultipleProductionsEnabled: () => true,
    isUserInProduction: () => member, getAvailableProductionTargets: () => available,
    editProductionTarget: (...args) => changed.push(args), notifyTargetChange() {}, notifyConferenceMembersChanged() {},
  });
  const call = (route, body) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; } };
    routes.get(route)({ body, query: body }, res); return res;
  };
  const selection = '/api/v1/client/targets/selection', catalog = '/api/v1/client/targets/available';
  const body = { userId: 99, productionId: 2, action: 'add', targetType: 'feed', targetId: 3 };
  assert.equal(call(selection, body).code, 403);
  assert.equal(call(catalog, body).code, 403);
  allowed = true; member = false;
  assert.equal(call(selection, body).code, 403); member = true;
  session = { kind: 'guest', userId: 7 }; assert.equal(call(selection, body).code, 401);
  session = { kind: 'user', userId: 7 };
  assert.equal(call(selection, { ...body, targetId: '3' }).code, 400);
  assert.equal(call(selection, { ...body, action: 'replace' }).code, 400);
  assert.equal(call(selection, body).code, 200);
  assert.deepEqual(changed, [[2, 7, 'feed', 3, 'add']]);
  assert.deepEqual(call(catalog, body).payload, available);
});

test('target catalog and edits remain scoped to production, preserve existing listen-only roles and survive backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-target-edit-'));
  const modulePath = require.resolve('../src/server/dbHandler');
  try {
    execFileSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict'); const db = require(${JSON.stringify(modulePath)});
      const user = Number(db.createUser('Editor', 'password')), other = Number(db.createUser('Target', 'password')), foreign = Number(db.createUser('Outside', 'password'));
      const conf = Number(db.createConference('Stage')), feed = Number(db.createFeed('Feed', 'password'));
      const p = Number(db.createProduction('One')), q = Number(db.createProduction('Two'));
      db.setProductionUser(p, user); db.setProductionUser(p, other); db.setProductionUser(q, foreign);
      db.setProductionConference(p, conf); db.setProductionFeed(p, feed);
      assert.equal(db.getUserById(user).allow_target_add_remove, null);
      db.updateUserTargetAddRemovePermission(user, true);
      assert.equal(db.getAllUsers().find(u => u.id === user).allow_target_add_remove, 1);
      assert.throws(() => db.updateUserTargetAddRemovePermission(user, 'true'), /boolean/);
      assert.deepEqual(db.getAvailableProductionTargets(user, p).map(t => t.name), ['Target', 'Stage', 'Feed']);
      assert.throws(() => db.editProductionTarget(p, user, 'user', foreign, 'add'), /not available/);
      assert.throws(() => db.editProductionTarget(q, user, 'user', foreign, 'add'), /not a member/);
      for (const [type, id] of [['user',other],['conference',conf],['feed',feed]]) {
        db.editProductionTarget(p,user,type,id,'add');
        assert(db.getProductionTargets(user,p).some(t => t.targetType === type && t.targetId === id));
        db.editProductionTarget(p,user,type,id,'remove');
        assert(!db.getProductionTargets(user,p).some(t => t.targetType === type && t.targetId === id));
      }
      db.setProductionConferenceListenOnly(p,user,conf);
      db.editProductionTarget(p,user,'conference',conf,'add');
      assert.equal(db.getProductionTargets(user,p)[0].canTalk,false);
      const snapshot = db.exportDatabaseSnapshot();
      assert.equal(snapshot.users.find(u => u.id === user).allow_target_add_remove,1);
      db.updateUserTargetAddRemovePermission(user,false);
      db.importDatabaseSnapshot(snapshot);
      assert.equal(db.getUserById(user).allow_target_add_remove,1);
      db.updateUserTargetAddRemovePermission(user,null);
      assert.equal(db.getUserById(user).allow_target_add_remove,null);
    `], { env: { ...process.env, TALKTOME_DATA_DIR: dir }, stdio: 'pipe' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
