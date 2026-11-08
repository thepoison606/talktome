import { beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
beforeEach(() => { vi.resetModules(); storage.getItem.mockReset(); storage.setItem.mockReset().mockResolvedValue(undefined); });

describe('keyboard preference storage', () => {
  it('restores per-profile/production keys, normalizes web identities and serializes concurrent writes', async () => {
    storage.getItem.mockResolvedValue(JSON.stringify({ 'server::me:7': { 'user:2': { type: 'digit', value: '8' } } }));
    const p = await import('./preferences');
    const { keyBinding } = await import('./bindings');
    await p.hydrateKeyboardPreferences();
    expect(p.useKeyboardPreferences.getState().scopes['server::me:7']?.['user-2']?.value).toBe('8');
    p.saveKeyboardOverrides('server::me:7', { main: keyBinding('KeyM')! });
    p.saveKeyboardOverrides('server::other:8', { main: keyBinding('KeyN')! });
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(2));
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1])).toMatchObject({ 'server::me:7': { main: { value: 'KeyM' } }, 'server::other:8': { main: { value: 'KeyN' } } });
  });

  it('keeps defaults usable after corrupt storage without unhandled rejections', async () => {
    storage.getItem.mockResolvedValue('invalid');
    const p = await import('./preferences');
    await p.hydrateKeyboardPreferences();
    expect(p.useKeyboardPreferences.getState()).toEqual({ hydrated: true, scopes: {} });
  });
});
