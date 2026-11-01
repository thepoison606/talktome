import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readNativeClientVersion } from './clientVersion';
const mocks = vi.hoisted(() => ({ requireNativeModule: vi.fn() }));
vi.mock('expo-modules-core', () => ({ requireNativeModule: mocks.requireNativeModule }));
beforeEach(() => { mocks.requireNativeModule.mockReset(); });
describe('installed client version', () => {
  it('reads the actual native binary version and build number', () => {
    mocks.requireNativeModule.mockReturnValue({ nativeApplicationVersion: '1.5.20', nativeBuildVersion: '70' });
    expect(readNativeClientVersion()).toEqual({ clientVersion: '1.5.20', clientBuild: '70' });
    expect(mocks.requireNativeModule).toHaveBeenCalledWith('ExpoApplication');
  });
  it('does not invent versions for an old binary without the native module', () => {
    mocks.requireNativeModule.mockImplementation(() => { throw new Error('Module absent'); });
    expect(readNativeClientVersion()).toEqual({ clientVersion: null, clientBuild: null });
  });
  it('keeps unavailable native fields empty', () => {
    mocks.requireNativeModule.mockReturnValue({});
    expect(readNativeClientVersion()).toEqual({ clientVersion: null, clientBuild: null });
  });
});
