import { requireNativeModule } from 'expo-modules-core';
import { readAudioRouteSnapshot } from '../audio/routes';
export type ClientDeviceStatus = {
  audioOutput: { kind: string; label: string } | null;
  batteryPercent: number | null;
  charging: boolean | null;
  networkType: string | null;
};
export function nativeNetworkType(value: unknown, connected?: boolean): string | null {
  if (value === 'UNKNOWN') return null;
  if (connected === false || value === 'NONE') return 'none';
  const types: Record<string, string> = { WIFI: 'wifi', CELLULAR: 'cellular', ETHERNET: 'ethernet', VPN: 'vpn', BLUETOOTH: 'bluetooth', OTHER: 'other' };
  return typeof value === 'string' ? types[value] ?? null : null;
}
async function optionalNativeCall(moduleName: string, method: string): Promise<unknown> {
  try {
    const native = requireNativeModule(moduleName) as Record<string, () => Promise<unknown>>;
    return await native[method]?.();
  } catch { return null; }
}
export async function readNativeDeviceStatus(): Promise<ClientDeviceStatus> {
  const [level, state, network] = await Promise.all([
    optionalNativeCall('ExpoBattery', 'getBatteryLevelAsync'),
    optionalNativeCall('ExpoBattery', 'getBatteryStateAsync'),
    optionalNativeCall('ExpoNetwork', 'getNetworkStateAsync'),
  ]);
  let audioOutput: ClientDeviceStatus['audioOutput'] = null;
  try {
    const snapshot = readAudioRouteSnapshot();
    const route = snapshot.routes.find(item => item.id === snapshot.currentId);
    // The route API has a UI fallback; never report that fallback as hardware fact.
    if (snapshot.outputLabel && snapshot.outputLabel !== 'Unknown') {
      audioOutput = { kind: route?.kind ?? 'other', label: snapshot.outputLabel };
    }
  } catch { /* Missing route information remains unavailable. */ }
  const net = network as { type?: unknown; isConnected?: boolean } | null;
  return {
    audioOutput,
    batteryPercent: typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1 ? Math.round(level * 100) : null,
    charging: state === 2 || state === 3 ? true : state === 1 || state === 4 ? false : null,
    networkType: nativeNetworkType(net?.type, net?.isConnected),
  };
}
