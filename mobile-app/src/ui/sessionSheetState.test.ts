import { beforeEach, describe, expect, it } from 'vitest';
import { closeSessionSheet, openSessionSheet, setSessionSheetDismissGestureEnabled, useSessionSheetOpen } from './sessionSheetState';

beforeEach(closeSessionSheet);

describe('session-sheet dismissal gestures', () => {
  it('restores dismissal when leaving the editor and reopening the sheet', () => {
    openSessionSheet();
    setSessionSheetDismissGestureEnabled(false);
    expect(useSessionSheetOpen.getState().dismissGestureEnabled).toBe(false);
    closeSessionSheet();
    expect(useSessionSheetOpen.getState().dismissGestureEnabled).toBe(true);
    openSessionSheet('accessories');
    expect(useSessionSheetOpen.getState()).toEqual({ open: true, start: 'accessories', dismissGestureEnabled: true });
  });
});
