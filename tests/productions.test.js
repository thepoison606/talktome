const PROJECT_ROOT = require('./helpers/projectRoot');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('keeps production layouts separate from the global target matrix', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-productions-'));
  const projectDir = PROJECT_ROOT;
  const script = `
    const assert = require('node:assert/strict');
    const db = require(${JSON.stringify(path.join(projectDir, 'src/server/dbHandler.js'))});

    const anna = Number(db.createUser('Anna', 'test-password'));
    const daniel = Number(db.createUser('Daniel', 'test-password'));
    const luis = Number(db.createUser('Luis', 'test-password'));
    const regie = Number(db.createConference('Regie'));
    const program = Number(db.createFeed('Program', 'test-password'));

    assert.equal(db.getUserById(anna).allow_target_rearrange, null);
    db.updateUserTargetRearrangePermission(anna, false);
    db.updateUserTargetRearrangePermission(daniel, true);
    assert.equal(db.getAllUsers().find(user => user.id === anna).allow_target_rearrange, 0);
    assert.throws(() => db.updateUserTargetRearrangePermission(anna, 'false'), /boolean/);

    db.addUserTargetToUser(anna, daniel);
    db.addUserToConference(daniel, regie);
    assert.deepEqual(
      db.getUserTargets(daniel).map((target) => target.targetType),
      ['conference']
    );
    const production = db.createProduction('Morning show');
    db.setProductionUser(production, anna);
    db.setProductionUser(production, daniel, { isAdmin: true });
    db.setProductionConference(production, regie);
    db.setProductionFeed(production, program);
    db.addProductionTarget(production, anna, 'conference', regie);
    db.addProductionTarget(production, anna, 'feed', program);
    db.updateUserBridgeEndpoint(anna, {
      enabled: true,
      bridgeDevice: 'test-bridge',
      triggerMode: 'audio-level',
      triggerTargetType: 'conference',
      triggerTargetId: regie,
    });
    db.updateFeedBridgeEndpoint(program, {
      enabled: true,
      bridgeDevice: 'test-bridge',
    });
    assert.equal('bridge_production_id' in db.getUserById(anna), false);
    assert.equal('bridge_production_id' in db.getAllFeeds().find((feed) => feed.id === program), false);
    assert.equal('production_id' in db.getBridgeEndpointsForDevice('test-bridge')[0], false);
    assert.equal('production_id' in db.getFeedBridgeEndpointsForDevice('test-bridge')[0], false);
    assert.deepEqual(
      db.getBridgeTargetsForUser(anna).map((target) => target.targetType),
      ['user', 'user', 'conference']
    );

    const secondProduction = db.createProduction('Evening show');
    db.setProductionUser(secondProduction, luis);
    db.setProductionConference(secondProduction, regie);
    db.setProductionConferenceMembership(secondProduction, luis, regie);

    const originalPrimary = db.getPrimaryProduction();
    assert.equal(originalPrimary.name, 'Default');
    assert.equal(db.updateProductionName(originalPrimary.id, 'Main matrix'), true);
    assert.equal(db.deleteProduction(originalPrimary.id), true);
    assert.equal(db.getPrimaryProduction().id, secondProduction);
    assert.equal(db.getPrimaryProduction().name, 'Evening show');
    assert.deepEqual(
      db.getPrimaryProductionTargets(luis).map((target) => ({
        targetType: target.targetType,
        name: target.name,
        canTalk: target.canTalk,
      })),
      [{ targetType: 'conference', name: 'Regie', canTalk: true }]
    );

    assert.deepEqual(db.getUserTargets(anna).map((target) => target.targetType), ['user']);
    assert.deepEqual(
      db.getProductionTargets(anna, production).map((target) => target.targetType),
      ['conference', 'feed']
    );
    assert.throws(() => db.setProductionConferenceListenOnly(production, anna, regie), /Configured by Bridge/);
    db.updateUserBridgeEndpoint(anna, { enabled: false });
    db.setProductionConferenceListenOnly(production, anna, regie);
    assert.equal(
      db.getProductionTargets(anna, production).find((target) => target.targetType === 'conference').canTalk,
      false
    );
    assert.equal(db.isUserInProduction(anna, production), true);
    assert.equal(db.isUserProductionAdmin(daniel, production), true);
    assert.deepEqual(db.getProductionConferences(production).map(({ name }) => name), ['Regie']);
    assert.deepEqual(db.getProductionFeeds(production).map(({ name }) => name), ['Program']);
    assert.deepEqual(db.getProductionConferencesForUser(anna, production).map(({ name }) => name), ['Regie']);
    assert.deepEqual(db.getProductionConferencesForUser(luis, secondProduction).map(({ name }) => name), ['Regie']);
    assert.deepEqual(db.getAllConfiguredUsersForConference(regie).map(({ name }) => name), ['Anna', 'Luis']);
    assert.deepEqual(db.getProductionFeedIdsForUser(anna, production), [program]);

    db.updateProductionTargetOrder(production, anna, [
      { targetType: 'feed', targetId: program },
      { targetType: 'conference', targetId: regie },
    ]);
    assert.deepEqual(
      db.getProductionTargets(anna, production).map((target) => target.targetType),
      ['feed', 'conference']
    );

    const snapshot = db.exportDatabaseSnapshot();
    assert.equal(snapshot.productions.length, 2);
    assert.equal(snapshot.productionUsers.length, 3);
    assert.equal(snapshot.productionUserTargets.length, 1);
    assert.equal(snapshot.productionConferences.length, 2);
    assert.equal(snapshot.productionFeeds.length, 1);
    assert.equal(snapshot.productionConferenceMemberships.length, 2);
    assert.equal(snapshot.userBridgeEndpoints[0].production_id, null);
    assert.equal(snapshot.feedBridgeEndpoints[0].production_id, null);
    assert.equal(
      snapshot.productionConferenceMemberships.find((membership) => (
        Number(membership.production_id) === Number(production)
        && Number(membership.user_id) === Number(anna)
        && Number(membership.conference_id) === Number(regie)
      )).can_talk,
      0
    );

    // Older backups may still contain the retired bridge production scope.
    snapshot.userBridgeEndpoints[0].production_id = production;
    snapshot.feedBridgeEndpoints[0].production_id = production;
    db.importDatabaseSnapshot(snapshot);
    assert.equal(db.getUserById(anna).allow_target_rearrange, 0);
    assert.equal(db.getUserById(daniel).allow_target_rearrange, 1);
    assert.equal(db.getUserById(luis).allow_target_rearrange, null);
    db.updateUserTargetRearrangePermission(anna, null);
    assert.equal(db.getUserById(anna).allow_target_rearrange, null);
    assert.equal(db.getProductionById(production).name, 'Morning show');
    assert.equal(db.getProductionTargets(anna, production).length, 2);
    assert.equal('bridge_production_id' in db.getUserById(anna), false);
    assert.equal('bridge_production_id' in db.getAllFeeds().find((feed) => feed.id === program), false);
    const restoredSnapshot = db.exportDatabaseSnapshot();
    assert.equal(restoredSnapshot.userBridgeEndpoints[0].production_id, null);
    assert.equal(restoredSnapshot.feedBridgeEndpoints[0].production_id, null);
    assert.equal(
      db.getProductionTargets(anna, production).find((target) => target.targetType === 'conference').canTalk,
      false
    );
    db.setProductionConferenceMembership(production, anna, regie);
    assert.equal(
      db.getProductionTargets(anna, production).find((target) => target.targetType === 'conference').canTalk,
      true
    );
    db.setProductionConferenceListenOnly(production, anna, regie);
    assert.equal(db.getProductionUsersForConference(regie, production).length, 1);
    db.removeProductionTarget(production, anna, 'conference', regie);
    assert.equal(db.getProductionConferencesForUser(anna, production).length, 0);
    assert.deepEqual(db.getProductionTargets(anna, production).map((target) => target.targetType), ['feed']);
    db.setProductionConferenceListenOnly(production, anna, regie);
    assert.equal(
      db.getProductionTargets(anna, production).find((target) => target.targetType === 'conference').canTalk,
      false
    );
    db.removeProductionTarget(production, anna, 'conference', regie);

    const legacySnapshot = { ...snapshot };
    delete legacySnapshot.productions;
    delete legacySnapshot.productionUsers;
    delete legacySnapshot.productionConferences;
    delete legacySnapshot.productionFeeds;
    delete legacySnapshot.productionConferenceMemberships;
    delete legacySnapshot.productionUserTargets;
    delete legacySnapshot.productionTargetOrder;
    db.importDatabaseSnapshot(legacySnapshot);
    assert.equal(db.getAllProductions().length, 1);
    assert.equal(db.getPrimaryProduction().name, 'Default');
    assert.deepEqual(db.getUserTargets(anna).map((target) => target.targetType), ['user']);
  `;

  try {
    execFileSync(process.execPath, ['-e', script], {
      cwd: projectDir,
      env: { ...process.env, TALKTOME_DATA_DIR: dataDir },
      stdio: 'pipe',
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('migrates legacy production layouts once without restoring removed memberships', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-production-migration-'));
  const projectDir = PROJECT_ROOT;
  const firstRun = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const Database = require('better-sqlite3');
    fs.mkdirSync(process.env.TALKTOME_DATA_DIR, { recursive: true });
    const legacy = new Database(path.join(process.env.TALKTOME_DATA_DIR, 'app.db'));
    legacy.exec(\`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, password TEXT NOT NULL);
      CREATE TABLE conferences (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
      CREATE TABLE feeds (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, password TEXT NOT NULL);
      CREATE TABLE user_conference (user_id INTEGER NOT NULL, conference_id INTEGER NOT NULL, PRIMARY KEY (user_id, conference_id));
      CREATE TABLE user_conf_targets (user_id INTEGER NOT NULL, target_conf INTEGER NOT NULL, PRIMARY KEY (user_id, target_conf));
      CREATE TABLE user_target_order (user_id INTEGER NOT NULL, target_type TEXT NOT NULL, target_id INTEGER NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (user_id, target_type, target_id));
      CREATE TABLE productions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE production_users (production_id INTEGER NOT NULL, user_id INTEGER NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (production_id, user_id));
      CREATE TABLE production_user_targets (production_id INTEGER NOT NULL, user_id INTEGER NOT NULL, target_type TEXT NOT NULL, target_id INTEGER NOT NULL, PRIMARY KEY (production_id, user_id, target_type, target_id));
      CREATE TABLE production_target_order (production_id INTEGER NOT NULL, user_id INTEGER NOT NULL, target_type TEXT NOT NULL, target_id INTEGER NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (production_id, user_id, target_type, target_id));
      INSERT INTO users (id, name, password) VALUES (1, 'Legacy user', 'hash');
      INSERT INTO conferences (id, name) VALUES (1, 'Legacy conference');
      INSERT INTO feeds (id, name, password) VALUES (1, 'Legacy feed', 'hash');
      INSERT INTO user_conf_targets (user_id, target_conf) VALUES (1, 1);
      INSERT INTO productions (id, name, created_at, updated_at) VALUES (1, 'Legacy production', 'now', 'now');
      INSERT INTO production_users (production_id, user_id, is_admin) VALUES (1, 1, 0);
      INSERT INTO production_user_targets (production_id, user_id, target_type, target_id) VALUES (1, 1, 'conference', 1);
      INSERT INTO production_user_targets (production_id, user_id, target_type, target_id) VALUES (1, 1, 'feed', 1);
    \`);
    legacy.close();

    const db = require(${JSON.stringify(path.join(projectDir, 'src/server/dbHandler.js'))});
    const primary = db.getPrimaryProduction();
    assert.equal(primary.name, 'Default');
    assert.deepEqual(db.getProductionMembers(primary.id).map((item) => item.id), [1]);
    assert.deepEqual(db.getProductionConferencesForUser(1, primary.id).map((item) => item.id), [1]);
    assert.deepEqual(db.getUserTargets(1).map((target) => target.targetType), []);
    assert.deepEqual(db.getProductionConferences(1).map((item) => item.id), [1]);
    assert.deepEqual(db.getProductionFeeds(1).map((item) => item.id), [1]);
    assert.deepEqual(db.getProductionConferencesForUser(1, 1).map((item) => item.id), [1]);
    const snapshot = db.exportDatabaseSnapshot();
    assert.equal(snapshot.userConfTargets.length, 0);
    assert.deepEqual(snapshot.productionUserTargets.map((target) => target.target_type), ['feed']);
    db.removeProductionConferenceMembership(1, 1, 1);
  `;
  const secondRun = `
    const assert = require('node:assert/strict');
    const db = require(${JSON.stringify(path.join(projectDir, 'src/server/dbHandler.js'))});
    assert.equal(db.getAllProductions().length, 2);
    assert.deepEqual(db.getProductionConferencesForUser(1, 1), []);
    assert.deepEqual(db.getProductionTargets(1, 1).map((target) => target.targetType), ['feed']);
  `;

  try {
    for (const script of [firstRun, secondRun]) {
      execFileSync(process.execPath, ['-e', script], {
        cwd: projectDir,
        env: { ...process.env, TALKTOME_DATA_DIR: dataDir },
        stdio: 'pipe',
      });
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
