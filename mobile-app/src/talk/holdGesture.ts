import { didReachSlideToLockThreshold } from './slideToLock';

export type HoldTouch = { identifier: string | number; pageX: number };
type HoldOptions = {
  disabled?: boolean;
  locked?: boolean;
  leftHanded?: boolean;
  onPress(): void;
  onLock(): void;
  onRelease(): void;
};

/** Each talk surface owns its touch, independently of React Native's single responder. */
export function createHoldGesture() {
  let active: { id: string; startX: number; latched: boolean; options: HoldOptions } | null = null;
  function finish() {
    const previous = active;
    active = null;
    // Release this finger's hold even after a swipe; the coordinator owns the lock.
    // Otherwise a hidden hold would keep a target live after its lock is removed.
    if (previous) previous.options.onRelease();
  }
  return {
    start(touch: HoldTouch, options: HoldOptions) {
      if (active || options.disabled) return;
      // Keep the callbacks/target from touch-down, even if Reply changes while held.
      active = { id: String(touch.identifier), startX: touch.pageX, latched: Boolean(options.locked), options };
      options.onPress();
    },
    move(changedTouches: readonly HoldTouch[]) {
      if (!active || active.latched) return;
      const touch = changedTouches.find(item => String(item.identifier) === active?.id);
      if (touch && didReachSlideToLockThreshold(touch.pageX, active.startX, active.options.leftHanded ?? false)) {
        active.latched = true;
        active.options.onLock();
      }
    },
    end(changedTouches: readonly HoldTouch[]) {
      if (active && changedTouches.some(item => String(item.identifier) === active?.id)) finish();
    },
    cancel: finish,
  };
}
