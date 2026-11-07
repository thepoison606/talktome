import { create } from 'zustand';

export type SessionSheetStart = 'session' | 'accessories';

/**
 * Whether the session sheet is open. App.tsx uses the native screen stack on iOS and an ordinary
 * overlay on Android. Native stacks/modals can otherwise swallow Android Pressable events.
 * `start` picks the page the sheet opens on; Session always stays underneath it.
 */
export const useSessionSheetOpen = create<{ open: boolean; start: SessionSheetStart; dismissGestureEnabled: boolean }>(() => ({
  open: false,
  start: 'session',
  dismissGestureEnabled: true,
}));

export function openSessionSheet(start: SessionSheetStart = 'session'): void {
  useSessionSheetOpen.setState({ open: true, start, dismissGestureEnabled: true });
}

export function closeSessionSheet(): void {
  useSessionSheetOpen.setState({ open: false, dismissGestureEnabled: true });
}

/** Native sheet dismissal competes with vertical target dragging on iOS. */
export function setSessionSheetDismissGestureEnabled(enabled: boolean): void {
  useSessionSheetOpen.setState({ dismissGestureEnabled: enabled });
}
