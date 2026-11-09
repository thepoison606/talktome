const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(require('./helpers/projectRoot'), 'bridge-client/src/app.js'), 'utf8');

function fixture() {
  class Element {}
  class Select extends Element {
    constructor(field, value) { super(); this.dataset = { field }; this.value = value; this.listeners = {}; }
    matches() { return true; }
    closest() { return card; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
  }
  const label = { title: '' };
  const targets = { hidden: false, querySelector: () => label };
  const threshold = { hidden: true };
  const meter = { hidden: true };
  let simple = true;
  const grid = { classList: { toggle: (name, value) => { simple = value; } } };
  const channel = new Select('inputChannel', '1/2');
  channel.options = [{ value: '' }, { value: '1/2' }];
  const card = new Element();
  card.dataset = { managedPortKey: 'user-1' };
  card.querySelector = selector => ({
    '.managed-port-trigger-grid': grid,
    '.managed-port-control--threshold': threshold,
    '.managed-port-control--targets': targets,
    '[data-managed-input-level]': meter,
    '[data-field="inputChannel"]': channel,
    '[data-field="outputChannel"]': channel,
  })[selector];
  const saved = [], drafts = [], channelRebuilds = [];
  const context = vm.createContext({
    HTMLElement: Element, HTMLSelectElement: Select, HTMLInputElement: class extends Element {},
    managedSelectValues: new WeakMap(), bridgeTalkTrigger: require('../public/bridgeTalkTrigger'),
    updateManagedPortDraftFromElement: () => drafts.push(true),
    scheduleManagedPortAutoSave: key => saved.push(key), requestBridgeWindowResize() {},
    findDeviceByDirectionAndId: (direction, id) => ({ direction, id }),
    buildManagedChannelOptions: device => { channelRebuilds.push(device); return '<option>1/2</option>'; },
  });
  vm.runInContext(source.slice(source.indexOf('function managedTriggerHint('), source.indexOf('function renderManagedTriggerControls(')), context);
  vm.runInContext(source.slice(source.indexOf('function listenForSelectValueChange('), source.indexOf('function startManagedRangeInteraction(')), context);
  return { context, Select, saved, drafts, channelRebuilds, channel, threshold, targets, meter, label, isSimple: () => simple };
}

for (const field of ['triggerMode', 'inputDevice', 'outputDevice', 'inputChannel', 'outputChannel', 'videoSource']) {
  test(`${field} applies on input without blur, and a delayed change cannot save/reset it twice`, () => {
    const f = fixture();
    const select = new f.Select(field, field === 'triggerMode' ? 'always-on' : 'new-selection');
    f.context.handleManagedPortControlChange({ target: select, type: 'input' });
    assert.deepEqual(f.saved, ['user-1']);
    assert.equal(f.drafts.length, 1);
    if (field.endsWith('Device')) {
      assert.equal(f.channelRebuilds.length, 1);
      f.channel.value = '3/4'; // user chooses another channel before WebView2 emits change
    }
    f.context.handleManagedPortControlChange({ target: select, type: 'change' });
    assert.equal(f.saved.length, 1);
    assert.equal(f.drafts.length, 1);
    if (field.endsWith('Device')) {
      assert.equal(f.channelRebuilds.length, 1);
      assert.equal(f.channel.value, '3/4');
    }
    select.value = field === 'triggerMode' ? 'external' : 'another-selection';
    f.context.handleManagedPortControlChange({ target: select, type: 'input' });
    assert.equal(f.saved.length, 2);
  });
}

test('trigger-dependent fields update while the dropdown retains focus', () => {
  const f = fixture();
  const select = new f.Select('triggerMode', 'audio-level');
  f.context.handleManagedPortControlChange({ target: select, type: 'input' });
  assert.equal(f.threshold.hidden, false);
  assert.equal(f.targets.hidden, false);
  assert.equal(f.meter.hidden, false);
  assert.equal(f.isSimple(), false);
  select.value = 'always-on';
  f.context.handleManagedPortControlChange({ target: select, type: 'input' });
  assert.equal(f.threshold.hidden, true);
  assert.equal(f.targets.hidden, false);
  assert.equal(f.meter.hidden, true);
  assert.equal(f.isSimple(), true);
  assert.match(f.label.title, /continuously/);
  select.value = 'external';
  f.context.handleManagedPortControlChange({ target: select, type: 'input' });
  assert.equal(f.targets.hidden, true);
  assert.match(f.label.title, /API/);
});

test('manual device/channel dropdowns accept input and change-only engines without duplicates', () => {
  const f = fixture();
  const select = new f.Select('inputDevice', 'old');
  let applied = 0;
  f.context.listenForSelectValueChange(select, () => applied++);
  select.value = 'new';
  select.listeners.input();
  assert.equal(applied, 1);
  select.listeners.change();
  assert.equal(applied, 1);
  select.value = 'keyboard-selection';
  select.listeners.change();
  assert.equal(applied, 2);
});
