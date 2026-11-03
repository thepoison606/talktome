import { describe, expect, it } from 'vitest';

import { androidSafeAreaStyle } from './androidSafeAreaStyle';

describe('androidSafeAreaStyle', () => {
  it('keeps Reply above the 3-button navigation bar', () => {
    // Gesture handle (about 24 dp) and the 3-button bar (about 48 dp).
    expect(androidSafeAreaStyle('android', { top: 32, bottom: 24 }, 32).paddingBottom).toBe(28);
    expect(androidSafeAreaStyle('android', { top: 32, bottom: 48 }, 32).paddingBottom).toBe(52);
  });

  it('pads below the status bar and never sits flush at the bottom', () => {
    expect(androidSafeAreaStyle('android', { top: 0, bottom: 0 }, 24)).toEqual({
      paddingTop: 32,
      paddingBottom: 8,
      paddingLeft: 0,
      paddingRight: 0,
    });
  });

  it('keeps landscape Reply and audio controls clear of a right-side navigation bar', () => {
    expect(androidSafeAreaStyle('android', { top: 24, bottom: 0, left: 0, right: 48 }, 24)).toEqual({
      paddingTop: 32, paddingBottom: 8, paddingLeft: 0, paddingRight: 48,
    });
  });

  it('respects the opposite landscape rotation and a display cutout', () => {
    expect(androidSafeAreaStyle('android', { top: 0, bottom: 0, left: 48, right: 28 }, 24)).toMatchObject({
      paddingLeft: 48, paddingRight: 28,
    });
  });

  it('leaves iOS to SafeAreaView', () => {
    expect(androidSafeAreaStyle('ios', { top: 47, bottom: 34 }, undefined)).toEqual({});
  });
});
