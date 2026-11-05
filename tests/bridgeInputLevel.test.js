const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = require('./helpers/projectRoot');
const audioMeter = require('../public/audioMeter');

function fixture({ cardLevel = true } = {}) {
  const source = fs.readFileSync(path.join(root, 'bridge-client/src/app.js'), 'utf8');
  class Element {
    textContent = '';
    classes = new Set();
    classList = {
      add: key => this.classes.add(key),
      remove: key => this.classes.delete(key),
      toggle: (key, value) => value ? this.classes.add(key) : this.classes.delete(key),
    };
  }
  const display = new Element();
  const popoverLabel = new Element();
  const session = { port: { muted: false }, inputStartedAt: 1 };
  let now = 10_000;
  const context = vm.createContext({
    HTMLElement: Element, Date: { now: () => now }, MANAGED_INPUT_ACTIVITY_GRACE_MS: 2000,
    MANAGED_LEVEL_TEXT_REFRESH_MS: 250,
    managedAudioPopover: { direction: 'input', port: session.port, panel: { querySelector: () => popoverLabel } },
    bridgePortKey: () => 'user:7',
    getManagedPortElement: () => cardLevel === 'absent' ? null : ({ querySelector: () => cardLevel ? display : null }),
    getManagedAudioLevel: port => ({ muted: port.muted }),
  });
  vm.runInContext(source.slice(source.indexOf('function updateManagedInputLevelDisplay('), source.indexOf('async function sendManagedCommandResult(')), context);
  return { display, popoverLabel, session, setTime: value => { now = value; }, update: stats => context.updateManagedInputLevelDisplay(session, stats) };
}

test('muting identifies the silent input without suggesting a device or permission problem', () => {
  const { display, session, update } = fixture();
  session.port.muted = true;
  update({ rmsDb: -120, capturedFrames: 1000 });
  assert.match(display.textContent, /-120\.0 dBFS - Muted/);
  assert.doesNotMatch(display.textContent, /check device|permission/);
  assert.equal(display.classes.has('warning'), true);
  update({ rmsDb: -120, capturedFrames: 0 });
  assert.match(display.textContent, /Muted/);
  assert.doesNotMatch(display.textContent, /permission/);
});

test('device hint appears for an unmuted silent input and clears for a quiet working input', () => {
  const { display, update } = fixture();
  update({ rmsDb: -120, capturedFrames: 1000 });
  assert.match(display.textContent, /check device and channels/);
  assert.equal(display.classes.has('warning'), true);
  update({ rmsDb: -80, capturedFrames: 2000 });
  assert.equal(display.textContent, 'Input level: -80.0 dBFS');
  assert.equal(display.classes.has('warning'), false);
});

test('input dBFS numbers refresh slowly while mute changes remain immediate', () => {
  const { display, popoverLabel, session, update, setTime } = fixture();
  update({ rmsDb: -40, capturedFrames: 1000 });
  setTime(10_050);
  update({ rmsDb: -41, capturedFrames: 2000 });
  assert.equal(display.textContent, 'Input level: -40.0 dBFS');
  assert.equal(popoverLabel.textContent, display.textContent);
  setTime(10_250);
  update({ rmsDb: -45, capturedFrames: 3000 });
  assert.equal(display.textContent, 'Input level: -45.0 dBFS');
  assert.equal(popoverLabel.textContent, display.textContent);
  session.port.muted = true;
  setTime(10_260);
  update({ rmsDb: -120, capturedFrames: 4000 });
  assert.match(display.textContent, /Muted/);
  assert.equal(popoverLabel.textContent, display.textContent);
  session.port.muted = false;
  setTime(10_270);
  update({ rmsDb: -40, capturedFrames: 5000 });
  assert.equal(display.textContent, 'Input level: -40.0 dBFS');
});

for (const cardLevel of [false, 'absent']) test(`feed input popover updates with ${cardLevel === 'absent' ? 'no card during rerender' : 'no card-level label'}`, () => {
  const { popoverLabel, session, update, setTime } = fixture({ cardLevel });
  session.port.kind = 'feed';
  popoverLabel.textContent = 'Waiting for audio…';
  update({ rmsDb: -35, capturedFrames: 1000 });
  assert.equal(popoverLabel.textContent, 'Input level: -35.0 dBFS');
  setTime(10_050);
  update({ rmsDb: -30, capturedFrames: 2000 });
  assert.equal(popoverLabel.textContent, 'Input level: -35.0 dBFS', 'keep the same text refresh interval without a card label');
  setTime(10_250);
  update({ rmsDb: -30, capturedFrames: 3000 });
  assert.equal(popoverLabel.textContent, 'Input level: -30.0 dBFS');
  session.port.muted = true;
  setTime(10_260);
  update({ rmsDb: -120, capturedFrames: 4000 });
  assert.match(popoverLabel.textContent, /Muted/);
  assert.doesNotMatch(popoverLabel.textContent, /Waiting|permission/);
});

test('popover input levels show RMS with throttled numbers and reveal fixed color bands', async () => {
  const source = fs.readFileSync(path.join(root, 'bridge-client/src/app.js'), 'utf8');
  let now = 10_000;
  let rmsDb = -85;
  const label = { textContent: '' };
  const fill = { style: { setProperty(name, value) { this[name] = value; } } };
  const meter = { value: -96, getAttribute: () => '-96', setAttribute(name, value) { this.value = Number(value); } };
  const open = {
    port: { id: 'user-7' }, direction: 'input', meters: new Map(),
    panel: { querySelector: selector => selector === '[data-audio-meter-label]' ? label
      : selector === '[data-audio-meter-fill]' ? fill : selector === '[role="meter"]' ? meter : {} },
  };
  const context = vm.createContext({
    managedAudioPopover: open, managedAudioMeterBusy: false, document: { hidden: false },
    audioMeter, getManagedAudioLevel: () => ({ muted: false }),
    managedSessions: new Map(), bridgePortKey: port => port.id,
    Date: { now: () => now }, MANAGED_LEVEL_TEXT_REFRESH_MS: 250,
    invoke: async () => ({ inputStreamStats: [{ streamId: 'user-7:input', capturedFrames: now, rmsDb, peakDb: -1 }] }),
  });
  vm.runInContext(source.slice(source.indexOf('async function pollManagedAudioMeter('), source.indexOf('function handleManagedAudioClick(')), context);
  await context.pollManagedAudioMeter();
  assert.equal(label.textContent, 'Input level: -85.0 dBFS');
  const bands = fill.style.backgroundImage;
  assert.match(bands, /#22c55e 87\.5%, #facc15 87\.5%/);
  assert.match(bands, /#facc15 96\.875%, #ef4444 96\.875%/);
  const firstWidth = fill.style['--meter-level'];
  assert.ok(parseFloat(firstWidth) > 0, 'quiet noise floor remains visible');
  assert.ok(parseFloat(firstWidth) < 87.5, 'quiet noise reaches only the green band');
  assert.equal(meter.value, -85);
  now += 125; rmsDb = -5;
  await context.pollManagedAudioMeter();
  assert.equal(label.textContent, 'Input level: -85.0 dBFS');
  assert.equal(fill.style.backgroundImage, bands, 'color bands stay anchored as the level changes');
  assert.notEqual(fill.style['--meter-level'], firstWidth);
  assert.ok(parseFloat(fill.style['--meter-level']) > 87.5);
  assert.ok(parseFloat(fill.style['--meter-level']) < 96.875);
  now += 125; rmsDb = -35;
  await context.pollManagedAudioMeter();
  assert.equal(label.textContent, 'Input level: -35.0 dBFS');
  now += 250; rmsDb = -12;
  await context.pollManagedAudioMeter();
  assert.equal(fill.style['--meter-level'], '87.5%');
  now += 250; rmsDb = -3;
  await context.pollManagedAudioMeter();
  assert.equal(fill.style['--meter-level'], '96.875%');
  now += 250; rmsDb = -120;
  await context.pollManagedAudioMeter();
  assert.equal(fill.style['--meter-level'], '0%');
  assert.equal(meter.value, -96);
});
