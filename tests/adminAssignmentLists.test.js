const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/admin'), 'utf8');

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.isConnected = true;
    this.children = [];
    this.dataset = {};
    this.handlers = {};
    this.className = '';
    this.classList = { add: name => { this.className += ` ${name}`; } };
  }
  append(...children) { this.children.push(...children); }
  prepend(child) { this.children.unshift(child); }
  replaceChildren(...children) { this.children = children; }
  insertBefore(child, sibling) {
    const index = this.children.indexOf(sibling);
    assert.notEqual(index, -1);
    this.children.splice(index, 0, child);
  }
  get lastElementChild() { return this.children.at(-1); }
  addEventListener(name, listener) { this.handlers[name] = listener; }
  set innerHTML(html) {
    // These lists must remain safe even when server-returned text contains HTML
    // or quotes. Unrelated target dropdowns still use their existing renderer.
    assert.equal(this.tagName, 'SELECT', 'assignment lists must not parse HTML');
    this.optionHtml = html;
  }
}

function fixture() {
  const elements = new Map();
  const add = (id, tag) => {
    const element = new Element(tag);
    elements.set(id, element);
    return element;
  };
  const conferences = add('user-confs-1', 'ul');
  const participants = add('conf-users-2', 'ul');
  const targets = add('user-targets-1', 'ul');
  add('user-targets-status-1', 'p');
  add('add-target-type-1', 'select').value = 'user';
  add('add-target-id-1', 'select');
  add('add-target-btn-1', 'button');
  const responses = new Map();
  const calls = { unassign: [], remove: [], membership: [], ordering: [] };
  const context = vm.createContext({
    document: { createElement: tag => new Element(tag), getElementById: id => elements.get(id) },
    window: { targetEditor: {
      createRemoveButton(name, onRemove, className) {
        const button = new Element('button');
        Object.assign(button, { type: 'button', title: `Remove ${name}`, className });
        button.addEventListener('click', onRemove);
        return button;
      },
    } },
    fetchJSON: async path => responses.get(path) || [],
    confirmUnassign: (...args) => calls.unassign.push(args),
    removeTarget: (...args) => calls.remove.push(args),
    cacheConferenceMemberships: (...args) => calls.membership.push(args),
    cacheUserTargetAssignments() {}, updateBridgeTriggerTargetOptions() {},
    targetAssignmentKey: (type, id) => `${type}:${id}`,
    productionSummaries: [],
    initTargetOrdering: (...args) => calls.ordering.push(args),
    executed: false,
  });
  vm.runInContext(source.slice(source.indexOf('function createAssignmentChip('), source.indexOf('function initTargetOrdering(')), context);
  return { context, responses, calls, conferences, participants, targets };
}

const hostileName = '<img src=x onerror="executed=true"><script>executed=true</script> & "Studio"';
const hostileId = "1'); executed=true; //";

test('conference assignment names remain literal text and Remove keeps its arguments', async () => {
  const f = fixture();
  f.responses.set('/users/1/conferences', [{ id: hostileId, name: hostileName }]);
  await f.context.renderUserConferenceList(1);
  const chip = f.conferences.children[0];
  assert.equal(chip.children[0].textContent, hostileName);
  assert.equal(chip.children[0].tagName, 'SPAN');
  assert.equal(chip.lastElementChild.type, 'button');
  chip.lastElementChild.handlers.click();
  assert.deepEqual(f.calls.unassign, [[1, hostileId]]);
  assert.equal(f.context.executed, false);
  f.responses.set('/users/1/conferences', []);
  await f.context.renderUserConferenceList(1);
  assert.equal(f.conferences.children.length, 0);
});

test('participant assignments retain membership caching and remove only the selected user', async () => {
  const f = fixture();
  const users = [{ id: 3, name: 'First user' }, { id: hostileId, name: hostileName }];
  f.responses.set('/conferences/2/users', users);
  await f.context.renderConferenceParticipantList(2);
  assert.deepEqual(f.calls.membership, [[2, users]]);
  assert.equal(f.participants.children[1].children[0].textContent, hostileName);
  f.participants.children[1].lastElementChild.handlers.click();
  assert.deepEqual(f.calls.unassign, [[hostileId, 2]]);
  assert.equal(f.context.executed, false);
  f.responses.set('/conferences/2/users', []);
  await f.context.renderConferenceParticipantList(2);
  assert.equal(f.participants.children.length, 0);
});

test('target assignments preserve drag metadata and badges without inline JavaScript', async () => {
  const f = fixture();
  const hostileType = "user'); executed=true; //";
  f.responses.set('/users/1/targets', [
    { targetType: hostileType, targetId: hostileId, name: hostileName },
    { targetType: 'conference', targetId: 7, name: 'Studio' },
    { targetType: 'conference', targetId: 8, name: 'Program', canTalk: false },
  ]);
  await f.context.loadUserTargets(1, [], [], []);
  const [hostile, conference, listenOnly] = f.targets.children;
  assert.equal(hostile.draggable, true);
  assert.match(hostile.className, /draggable-target/);
  assert.equal(hostile.dataset.type, hostileType);
  assert.equal(hostile.dataset.id, hostileId);
  assert.equal(hostile.children[0].className, 'drag-handle');
  assert.equal(hostile.children[1].textContent, hostileName);
  assert.equal(hostile.children[2].textContent, hostileType);
  assert.equal(hostile.lastElementChild.onclick, undefined);
  assert.equal(hostile.lastElementChild.title, `Remove ${hostileName}`);
  assert.match(hostile.lastElementChild.className, /icon-button/);
  hostile.lastElementChild.handlers.click();
  conference.lastElementChild.handlers.click();
  assert.deepEqual(f.calls.remove, [[1, hostileType, hostileId, undefined], [1, 'conference', '7', undefined]]);
  assert.deepEqual(conference.children.filter(child => child.className === 'badge').map(child => child.textContent), ['conference']);
  assert.deepEqual(listenOnly.children.filter(child => child.className === 'badge').map(child => child.textContent), ['conference', 'Listen only']);
  assert.equal(f.calls.ordering[0][0], 1);
  assert.equal(f.calls.ordering[0][1], f.targets);
  assert.equal(f.context.executed, false);
  f.responses.set('/users/1/targets', []);
  await f.context.loadUserTargets(1, [], [], []);
  assert.equal(f.targets.children.length, 0);
});
