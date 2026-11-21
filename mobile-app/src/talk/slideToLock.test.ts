import { describe, expect, it } from 'vitest';

import { didReachSlideToLockThreshold } from './slideToLock';

describe('slideToLock', () => {
  it('locks when sliding left in right-handed mode', () => {
    expect(didReachSlideToLockThreshold(10, 60, false)).toBe(true);
    expect(didReachSlideToLockThreshold(40, 60, false)).toBe(false);
  });

  it('locks when sliding right in left-handed mode', () => {
    expect(didReachSlideToLockThreshold(90, 40, true)).toBe(true);
    expect(didReachSlideToLockThreshold(50, 40, true)).toBe(false);
  });
});
