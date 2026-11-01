import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { endTalkTouches, HoldToTalk, moveTalkTouches } from './HoldToTalk';

const hooks = vi.hoisted(() => ({ nextId: 0, cleanups: [] as (() => void)[], platform: { OS: 'ios' } }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useId: () => `surface:${hooks.nextId++}`,
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => (() => void) | undefined) => { const cleanup = effect(); if (cleanup) hooks.cleanups.push(cleanup); },
}));
vi.mock('react-native', () => ({ Platform: hooks.platform, View: 'View', StyleSheet: { create: (styles: unknown) => styles } }));
afterEach(() => { hooks.cleanups.splice(0).forEach(cleanup => cleanup()); });

function surface(options: Partial<ComponentProps<typeof HoldToTalk>> = {}) {
  const actions = { onPress: vi.fn(), onLock: vi.fn(), onRelease: vi.fn() };
  const result = HoldToTalk({ accessibilityLabel: 'Talk', children: null, ...actions, ...options });
  const props = result.props as Record<string, any>;
  const capture = { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
  props.ref.current = capture;
  return { actions, props, capture };
}
const pointer = (pointerId: number, pageX = 100) => ({ nativeEvent: { pointerId, pageX } });
const touch = (identifier: number, pageX = 100) => ({ nativeEvent: { identifier, pageX, changedTouches: [{ identifier, pageX }] } });

describe('native talk surface events', () => {
  it('uses Android per-pointer events and retains capture outside the button for swipe-to-lock', () => {
    hooks.platform.OS = 'android'; const a = surface(), b = surface();
    expect(a.props.onStartShouldSetResponder).toBeUndefined(); expect(a.props.onTouchStart).toBeUndefined();
    a.props.onPointerDown(pointer(1)); b.props.onPointerDown(pointer(2));
    expect(a.actions.onPress).toHaveBeenCalledOnce(); expect(b.actions.onPress).toHaveBeenCalledOnce();
    expect(a.actions.onPress.mock.calls[0]![0]).not.toBe(b.actions.onPress.mock.calls[0]![0]);
    expect(a.capture.setPointerCapture).toHaveBeenCalledWith(1);
    a.props.onPointerMove(pointer(1, 40)); expect(a.actions.onLock).toHaveBeenCalledOnce();
    a.props.onPointerUp(pointer(1, 40)); expect(a.actions.onRelease).toHaveBeenCalledOnce();
    expect(b.actions.onRelease).not.toHaveBeenCalled();
    b.props.onPointerCancel(pointer(2)); expect(b.actions.onRelease).toHaveBeenCalledOnce();
  });

  it('routes iOS touch-end by finger and releases a held surface on unmount', () => {
    hooks.platform.OS = 'ios'; const a = surface(), b = surface();
    expect(a.props.onStartShouldSetResponder).toBeUndefined(); expect(a.props.onPointerDown).toBeUndefined();
    a.props.onTouchStart(touch(1)); b.props.onTouchStart(touch(2));
    a.props.onTouchEnd(touch(2)); expect(a.actions.onRelease).not.toHaveBeenCalled();
    b.props.onTouchEnd(touch(2)); expect(b.actions.onRelease).toHaveBeenCalledOnce();
    hooks.cleanups.splice(0).forEach(cleanup => cleanup());
    expect(a.actions.onRelease).toHaveBeenCalledOnce(); expect(b.actions.onRelease).toHaveBeenCalledOnce();
  });

  it('can swipe the second Android finger even when native pointer-move targets the first one', () => {
    hooks.platform.OS = 'android'; const a = surface(), b = surface();
    a.props.onPointerDown(pointer(1)); b.props.onPointerDown(pointer(2));
    moveTalkTouches([{ identifier: 1, pageX: 100 }, { identifier: 2, pageX: 40 }]);
    expect(a.actions.onLock).not.toHaveBeenCalled(); expect(b.actions.onLock).toHaveBeenCalledOnce();
    endTalkTouches([{ identifier: 2, pageX: 40 }]);
    expect(a.actions.onRelease).not.toHaveBeenCalled(); expect(b.actions.onRelease).toHaveBeenCalledOnce();
    b.props.onPointerUp(pointer(2, 40)); expect(b.actions.onRelease).toHaveBeenCalledOnce();
  });
});
