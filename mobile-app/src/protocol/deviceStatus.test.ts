import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeNetworkType, readNativeDeviceStatus } from './deviceStatus';
const mocks = vi.hoisted(() => ({ requireNativeModule: vi.fn(), readAudioRouteSnapshot: vi.fn() }));
vi.mock('expo-modules-core', () => ({ requireNativeModule: mocks.requireNativeModule }));
vi.mock('../audio/routes', () => ({ readAudioRouteSnapshot: mocks.readAudioRouteSnapshot }));
beforeEach(() => {
  mocks.requireNativeModule.mockReset(); mocks.readAudioRouteSnapshot.mockReset();
  mocks.readAudioRouteSnapshot.mockReturnValue({ routes: [], outputLabel: 'Unknown' });
});
describe('native device diagnostics', () => {
  it('reads actual Bluetooth output, battery percentage and charging state', async () => {
    mocks.requireNativeModule.mockImplementation(name => name === 'ExpoBattery'
      ? { getBatteryLevelAsync: async () => 0.15, getBatteryStateAsync: async () => 2 }
      : { getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true }) });
    mocks.readAudioRouteSnapshot.mockReturnValue({ currentId: 'bt', outputLabel: 'AirPods Pro', routes: [{ id: 'bt', kind: 'bluetooth' }] });
    expect(await readNativeDeviceStatus()).toEqual({ audioOutput: { kind: 'bluetooth', label: 'AirPods Pro' }, batteryPercent: 15, charging: true, networkType: 'wifi' });
  });
  it('keeps unsupported old binaries and UI fallback routes unavailable', async () => {
    mocks.requireNativeModule.mockImplementation(() => { throw new Error('Module unavailable'); });
    expect(await readNativeDeviceStatus()).toEqual({ audioOutput: null, batteryPercent: null, charging: null, networkType: null });
  });
  it('reports unplugged empty batteries and does not mislabel unknown network as offline', async () => {
    mocks.requireNativeModule.mockImplementation(name => name === 'ExpoBattery'
      ? { getBatteryLevelAsync: async () => 0, getBatteryStateAsync: async () => 1 }
      : { getNetworkStateAsync: async () => ({ type: 'UNKNOWN', isConnected: false }) });
    expect(await readNativeDeviceStatus()).toMatchObject({ batteryPercent: 0, charging: false, networkType: null });
    expect(nativeNetworkType('CELLULAR', true)).toBe('cellular');
    expect(nativeNetworkType('NONE', false)).toBe('none');
  });
});
