// Derived from talktome public/client.js didReachSlideToLockThreshold @ bbb8e09
// and talktome-apple SlideToLockPressGestureModifier @ 004d6e76 by Daniel Jocher.

export const SLIDE_TO_LOCK_THRESHOLD = 42;

export function didReachSlideToLockThreshold(
  currentX: number,
  startX: number,
  leftHanded: boolean,
): boolean {
  const delta = currentX - startX;
  return leftHanded ? delta >= SLIDE_TO_LOCK_THRESHOLD : delta <= -SLIDE_TO_LOCK_THRESHOLD;
}
