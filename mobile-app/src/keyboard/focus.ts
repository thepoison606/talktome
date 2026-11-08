import { create } from 'zustand';

// iOS completes a sheet dismissal after JS has already marked it closed.
// Refocus only once the native operator screen has actually appeared again.
export const useKeyboardFocus = create<{ request: number }>(() => ({ request: 0 }));
export function requestKeyboardFocus(): void {
  useKeyboardFocus.setState(state => ({ request: state.request + 1 }));
}
