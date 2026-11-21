import { didReachSlideToLockThreshold } from './slideToLock';

export type HoldTouch = { identifier: string | number; pageX: number; pageY?: number };
type HoldOptions = {
  disabled?: boolean;
  locked?: boolean;
  leftHanded?: boolean;
  tapToLock?: boolean;
  onPress(): void;
  onLock(): void;
  onRelease(): void;
};

/** Each talk surface owns its touch, independently of React Native's single responder. */
export function createHoldGesture(now = () => performance.now()) {
  let active: { id: string; start: HoldTouch; startedAt: number; moved: boolean; latched: boolean; options: HoldOptions } | null = null;
  const movedTooFar = (start: HoldTouch, touch: HoldTouch) =>
    Math.hypot(touch.pageX - start.pageX, (touch.pageY ?? 0) - (start.pageY ?? 0)) > 12;
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
      active = { id: String(touch.identifier), start: touch, startedAt: now(), moved: false, latched: Boolean(options.locked), options };
      options.onPress();
    },
    move(changedTouches: readonly HoldTouch[]) {
      if (!active || active.latched) return;
      const touch = changedTouches.find(item => String(item.identifier) === active?.id);
      if (!touch) return;
      active.moved ||= movedTooFar(active.start, touch);
      if (didReachSlideToLockThreshold(touch.pageX, active.start.pageX, active.options.leftHanded ?? false)) {
        active.latched = true;
        active.options.onLock();
      }
    },
    end(changedTouches: readonly HoldTouch[], cancelled = false) {
      if (!active) return;
      const touch = changedTouches.find(item => String(item.identifier) === active?.id);
      if (!touch) return;
      if (!cancelled && active.options.tapToLock && !active.latched && !active.moved
        && !movedTooFar(active.start, touch) && now() - active.startedAt < 300) active.options.onLock();
      finish();
    },
    cancel: finish,
  };
}
