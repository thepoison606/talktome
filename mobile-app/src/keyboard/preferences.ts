import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { readKeyOverrides, type KeyOverrides } from './bindings';

const STORAGE_KEY = 'talktome.keyboard-shortcuts';
export const useKeyboardPreferences = create<{ hydrated: boolean; scopes: Record<string, KeyOverrides> }>(() => ({ hydrated: false, scopes: {} }));
let loading: Promise<void> | undefined;
let saving = Promise.resolve();

export function hydrateKeyboardPreferences(): Promise<void> {
  return loading ??= (async () => {
    let scopes: Record<string, KeyOverrides> = {};
    try {
      const raw = JSON.parse(await AsyncStorage.getItem(STORAGE_KEY) ?? '{}');
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        scopes = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, readKeyOverrides(value)]));
      }
    } catch { /* Broken or unavailable storage leaves the default bindings usable. */ }
    useKeyboardPreferences.setState({ hydrated: true, scopes });
  })();
}

export function saveKeyboardOverrides(scope: string, overrides: KeyOverrides): void {
  if (!useKeyboardPreferences.getState().hydrated) return;
  const scopes = { ...useKeyboardPreferences.getState().scopes, [scope]: readKeyOverrides(overrides) };
  useKeyboardPreferences.setState({ scopes });
  saving = saving.catch(() => {}).then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(scopes)));
  void saving.catch(() => {});
}
