import { describe, expect, it, vi } from 'vitest';
import { createHoldGesture } from './holdGesture';

function callbacks(options = {}) {
  return { onPress: vi.fn(), onLock: vi.fn(), onRelease: vi.fn(), ...options };
}
const touch = (identifier: number, pageX = 100) => ({ identifier, pageX });

describe('independent talk touches', () => {
  it('allows two surfaces to be held and released independently in either order', () => {
    for (const first of [0, 1]) {
      const gestures = [createHoldGesture(), createHoldGesture()];
      const actions = [callbacks(), callbacks()];
      gestures.forEach((gesture, i) => gesture.start(touch(i), actions[i]!));
      actions.forEach(action => expect(action.onPress).toHaveBeenCalledOnce());
      gestures.forEach(gesture => gesture.end([touch(first)]));
      expect(actions[first]!.onRelease).toHaveBeenCalledOnce();
      expect(actions[1 - first]!.onRelease).not.toHaveBeenCalled();
      gestures.forEach(gesture => gesture.end([touch(1 - first)]));
      actions.forEach(action => expect(action.onRelease).toHaveBeenCalledOnce());
    }
  });

  it('uses only its own finger for slide-to-lock, including left-handed gestures', () => {
    for (const leftHanded of [false, true]) {
      const gesture = createHoldGesture(), action = callbacks({ leftHanded });
      const endX = leftHanded ? 150 : 50;
      gesture.start(touch(1), action);
      gesture.move([touch(2, endX)]); expect(action.onLock).not.toHaveBeenCalled();
      gesture.move([touch(1, endX)]); gesture.move([touch(1, endX)]);
      expect(action.onLock).toHaveBeenCalledOnce();
      gesture.end([touch(1, endX)]); expect(action.onRelease).toHaveBeenCalledOnce();
    }
  });

  it('cancels its own held touch once on unmount without leaving a pressed target', () => {
    const gesture = createHoldGesture(), action = callbacks();
    gesture.start(touch(1), action); gesture.cancel(); gesture.cancel(); gesture.end([touch(1)]);
    expect(action.onRelease).toHaveBeenCalledOnce();
  });

  it('does not move or acquire another finger on an already held surface', () => {
    const gesture = createHoldGesture(), action = callbacks();
    gesture.start(touch(1), action); gesture.start(touch(2), action);
    gesture.end([touch(2)]); expect(action.onRelease).not.toHaveBeenCalled();
    gesture.end([touch(1)]); expect(action.onPress).toHaveBeenCalledOnce();
    expect(action.onRelease).toHaveBeenCalledOnce();
  });

  it('keeps the touch-down callbacks when Reply or lock props change mid-gesture', () => {
    const gesture = createHoldGesture(), initial = callbacks(), next = callbacks();
    gesture.start(touch(1), initial); gesture.start(touch(1), next);
    gesture.move([touch(1, 50)]); gesture.end([touch(1)]);
    expect(initial.onLock).toHaveBeenCalledOnce(); expect(initial.onRelease).toHaveBeenCalledOnce();
    expect(next.onPress).not.toHaveBeenCalled(); expect(next.onLock).not.toHaveBeenCalled();
  });

  it('unlocks an already locked button without relocking from the same touch', () => {
    const gesture = createHoldGesture(), action = callbacks({ locked: true });
    gesture.start(touch(1), action); gesture.move([touch(1, 40)]); gesture.end([touch(1)]);
    expect(action.onPress).toHaveBeenCalledOnce(); expect(action.onLock).not.toHaveBeenCalled();
  });

  it('ignores touches on a disabled target', () => {
    const gesture = createHoldGesture(), action = callbacks({ disabled: true });
    gesture.start(touch(1), action); gesture.move([touch(1, 40)]); gesture.end([touch(1)]);
    expect(action.onPress).not.toHaveBeenCalled(); expect(action.onRelease).not.toHaveBeenCalled();
  });
});
