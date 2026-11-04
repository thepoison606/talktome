const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = require('./helpers/projectRoot');
const source = fs.readFileSync(path.join(root, 'public/client.js'), 'utf8');
const start = source.indexOf('function getMobileTargetLayerSize()');
const end = source.indexOf('function emitTargetAudioStateSnapshot(', start);
assert(start >= 0 && end > start);

function fixture({ heights = Array(12).fill(80), available = 440, landscape = false, expanded = false } = {}) {
  const rows = heights.map(height => {
    const classes = new Set();
    return {
      dataset: {},
      classList: {
        contains: name => classes.has(name),
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        toggle: (name, active) => active ? classes.add(name) : classes.delete(name),
      },
      getBoundingClientRect: () => ({ height: classes.has('layer-hidden') ? 0 : height }),
    };
  });
  const list = { classList: { contains: name => expanded && name === 'has-expanded-video' }, style: { setProperty() {} }, clientHeight: available, dataset: {}, scrollTop: 0, querySelectorAll: () => rows };
  const button = { setAttribute() {}, textContent: '' };
  const switcher = { hidden: true };
  const context = vm.createContext({
    window: {
      TalktomeTargetLayers: require('../public/targetLayers'),
      innerWidth: landscape ? 844 : 430,
      matchMedia: query => ({ matches: query.includes('landscape') && landscape }),
      getComputedStyle: item => item === list ? { rowGap: '8px' } : { marginTop: '0', marginBottom: '0' },
    },
    document: { getElementById: () => list },
    targetLayerButton: button, targetLayerSwitcher: switcher,
    currentTargetLayerIndex: 0,
    MOBILE_TARGET_LAYER_MAX_WIDTH: 699, MOBILE_TARGET_LAYER_COMPACT_MAX_WIDTH: 414,
    MOBILE_TARGET_LAYER_LANDSCAPE_SIZE: 4, MOBILE_TARGET_LAYER_DEFAULT_SIZE: 8,
    MOBILE_TARGET_LAYER_COMPACT_SIZE: 7,
    isOperatorSession: () => true,
    schedulePttButtonSizing() {},
  });
  vm.runInContext(source.slice(start, end), context);
  return { rows, list, button, switcher, context, run: code => vm.runInContext(code, context) };
}

test('touch devices paginate below the old eight-row limit when the viewport shrinks', () => {
  const f = fixture();
  f.run('updateTargetLayerControls()');
  assert.equal(f.rows.filter(row => !row.classList.contains('layer-hidden')).length, 5);
  assert.equal(f.button.textContent, 'Layer 1/3');
  f.list.clientHeight = 264;
  f.run('updateTargetLayerControls()');
  assert.equal(f.rows.filter(row => !row.classList.contains('layer-hidden')).length, 3);
  assert.equal(f.button.textContent, 'Layer 1/4');
});

test('extra available height fits more full rows instead of retaining the fixed page limit', () => {
  const f = fixture({ available: 880 });
  f.run('updateTargetLayerControls()');
  assert.equal(f.rows.filter(row => !row.classList.contains('layer-hidden')).length, 10);
});

test('hidden taller rows are measured and restored so page sizes stay stable', () => {
  const f = fixture({ heights: [80, 80, 100, 80, 80, 80], available: 320 });
  f.rows[2].classList.add('layer-hidden');
  assert.equal(f.run('getTargetLayerSize(document.getElementById(), document.getElementById().querySelectorAll())'), 3);
  assert(f.rows[2].classList.contains('layer-hidden'));
  f.run('updateTargetLayerControls(); advanceTargetLayer()');
  assert.equal(f.button.textContent, 'Layer 2/2');
  assert.deepEqual(f.rows.map(row => row.classList.contains('layer-hidden')), [true, true, true, false, false, false]);
});

test('landscape pages also reduce capacity and all targets remain reachable', () => {
  const f = fixture({ landscape: true, heights: Array(7).fill(80), available: 176 });
  f.run('updateTargetLayerControls()');
  assert.equal(f.button.textContent, 'Layer 1/4');
  const seen = new Set();
  for (let page = 0; page < 4; page++) {
    f.rows.forEach((row, i) => { if (!row.classList.contains('layer-hidden')) seen.add(i); });
    f.run('advanceTargetLayer()');
  }
  assert.equal(seen.size, 7);
  assert.equal(f.button.textContent, 'Layer 1/4');
});

test('expanded videos pack actual row heights on desktop too and preserve every target', () => {
  const f = fixture({ heights: [80, 260, 80, 80, 80], available: 440, expanded: true });
  f.context.window.innerWidth = 1280;
  f.run('updateTargetLayerControls()');
  assert.equal(f.button.textContent, 'Layer 1/2');
  assert.deepEqual(f.rows.map(row => row.classList.contains('layer-hidden')), [false, false, false, true, true]);
  f.run('advanceTargetLayer()');
  assert.equal(f.button.textContent, 'Layer 2/2');
  assert.deepEqual(f.rows.map(row => row.classList.contains('layer-hidden')), [true, true, true, false, false]);
});
