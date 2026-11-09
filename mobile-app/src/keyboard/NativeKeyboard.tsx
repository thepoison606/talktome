import type { ComponentType } from 'react';
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';

export type KeyboardEvent = { code: string; pressed: boolean };
type Props = {
  listening: boolean;
  capture?: boolean;
  focusRequest?: number;
  codes?: string[];
  onKeyboardEvent: (event: { nativeEvent: KeyboardEvent }) => void;
  onReset: () => void;
  style?: object;
  pointerEvents?: 'none';
};

function load(): ComponentType<Props> | null {
  try {
    requireNativeModule('TalkToMeKeyboard');
    return requireNativeViewManager('TalkToMeKeyboard');
  } catch { return null; }
}
const Native = load();
export const hardwareKeyboardAvailable = Native !== null;

export function NativeKeyboard(props: Props) {
  return Native ? <Native {...props} pointerEvents="none" style={{ position: 'absolute', width: 1, height: 1, left: 0, top: 0 }} /> : null;
}
