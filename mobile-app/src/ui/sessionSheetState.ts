import { create } from 'zustand';

export type SessionSheetStart = 'session' | 'accessories';

/**
 * Whether the session sheet is open. App.tsx uses the native screen stack on iOS and an ordinary
 * overlay on Android. Native stacks/modals can otherwise swallow Android Pressable events.
 * `start` picks the page the sheet opens on; Session always stays underneath it.
 */
export const useSessionSheetOpen = create<{ open: boolean; start: SessionSheetStart }>(() => ({
  open: false,
  start: 'session',
}));

export function openSessionSheet(start: SessionSheetStart = 'session'): void {
  useSessionSheetOpen.setState({ open: true, start });
}

export function closeSessionSheet(): void {
  useSessionSheetOpen.setState({ open: false });
}
