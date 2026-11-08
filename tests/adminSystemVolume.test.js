const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/admin'), 'utf8');

function fixture() {
  const elements = new Map();
  const container = { html: '', active: false, querySelector() { return this.active; }, querySelectorAll() { return []; } };
  Object.defineProperty(container, 'innerHTML', {
    get() { return this.html; },
    set(value) {
      this.html = value;
      for (const key of ['admin-system-volume', 'admin-system-volume-value', 'admin-system-mute']) elements.delete(key);
      for (const match of value.matchAll(/id="([^"]+)"/g)) {
        elements.set(match[1], { value: '', textContent: '', listeners: {}, addEventListener(event, handler) { this.listeners[event] = handler; } });
      }
    },
  });
  elements.set('admin-system-volume-controls', container);
  const requests = [];
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id) || null },
    editingAudioSettingsUserId: 7, systemVolumeBusy: false,
    userAudioSettingsError: { textContent: '', classList: { remove() {} } },
    authedFetch: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, json: async () => ({ systemVolume: { volume: 0.35, muted: false, muteSupported: true } }) };
    },
  });
  vm.runInContext(source.slice(source.indexOf('function renderSystemVolume('), source.indexOf('function renderUserAudioSettingsFields(')), context);
  return { context, elements, container, requests };
}

test('admin shows a hardware control only when supported and preserves controls during external updates', () => {
  const f = fixture();
  f.context.renderSystemVolume(null);
  assert.equal(f.container.innerHTML, '');
  f.context.renderSystemVolume({ volume: 0.6, muted: false, muteSupported: true });
  assert.match(f.container.innerHTML, /Device main volume/);
  assert.match(f.container.innerHTML, /Changes apply immediately/);
  const slider = f.elements.get('admin-system-volume');
  f.context.renderSystemVolume({ volume: 0.35, muted: true, muteSupported: true });
  assert.equal(f.elements.get('admin-system-volume'), slider);
  assert.equal(slider.value, '35');
  assert.equal(f.elements.get('admin-system-mute').checked, true);
  f.container.active = true;
  f.context.renderSystemVolume({ volume: 0.9, muted: false, muteSupported: true });
  assert.equal(slider.value, '35', 'polling must not move a slider while it is being dragged');
  f.container.active = false;
  f.context.renderSystemVolume(null);
  assert.equal(f.container.innerHTML, '');
});

test('hardware volume applies independently from saving the user audio settings', async () => {
  const f = fixture();
  await f.context.changeSystemVolume({ volume: 0.35 });
  assert.equal(f.requests[0].url, '/admin/users/7/system-volume');
  assert.deepEqual(JSON.parse(f.requests[0].init.body), { volume: 0.35 });
  assert.equal(f.requests[0].init.method, 'PUT');
  assert.equal(f.requests.some(r => r.url.endsWith('/audio-settings')), false);
});
