import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { TalkTarget } from '../protocol';

const f = vi.hoisted(() => ({
  state: { targets: [] as TalkTarget[], allowTargetRearrange: true, allowTargetAddRemove: true,
    activeProfileId: 'profile', productionId: 1 },
  effects: [] as (() => void | (() => void))[],
  states: [] as unknown[], refs: [] as { current: unknown }[], stateCursor: 0, refCursor: 0,
  save: vi.fn(async (_targets: TalkTarget[]) => {}),
  remove: vi.fn(async () => {}),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useRef: (current: unknown) => {
    const index = f.refCursor++;
    return f.refs[index] ?? (f.refs[index] = { current });
  },
  useState: (value: unknown) => {
    const states = f.states, index = f.stateCursor++;
    if (!(index in states)) states[index] = value;
    return [states[index], (next: unknown) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
  },
  useEffect: (effect: () => void | (() => void)) => { f.effects.push(effect); },
}));
vi.mock('react-native', () => ({
  Animated: { View: 'AnimatedView', Value: class { setValue() {} } },
  findNodeHandle: (node: { tag: number }) => node.tag,
  ScrollView: 'ScrollView', Pressable: 'Pressable', View: 'View', Text: 'Text',
  StyleSheet: { create: (styles: object) => styles },
}));
vi.mock('../session/store', () => ({
  useSessionStore: Object.assign((select: (state: typeof f.state) => unknown) => select(f.state), { getState: () => f.state }),
  session: { saveTargetOrder: f.save, editTargetSelection: f.remove },
}));
vi.mock('./settingsChrome', () => ({
  SettingsButton: 'Pressable', SettingsFootnote: 'Footnote', SettingsHint: 'Hint', SettingsSection: 'Section',
  useSettingsStyles: () => ({}), useSettingsTheme: () => ({ palette: {} }),
}));
vi.mock('./icons', () => ({ TrashIcon: 'Trash' }));

import { ArrangeTargetsPage } from './ArrangeTargetsPage';

type Element = ReactElement<Record<string, unknown>>;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function call(element: Element, name: string, event?: unknown) {
  return (element.props[name] as (event?: unknown) => unknown)(event);
}
const touch = (pageY: number) => ({ nativeEvent: { pageY } });
function renderPage() {
  f.stateCursor = 0; f.refCursor = 0;
  return ArrangeTargetsPage();
}
function fixture() {
  const surface = renderPage();
  const all = elements(surface);
  const tree = all.find(e => e.type === 'ScrollView')!;
  const rows = all.filter(e => e.type === 'AnimatedView');
  rows.forEach((row, index) => call(row, 'onLayout', { nativeEvent: { layout: { y: index * 60, height: 60 } } }));
  for (const effect of f.effects) effect();
  const handles = all.filter(e => e.props.accessibilityRole === 'adjustable');
  handles.forEach((handle, index) => (handle.props.ref as (node: unknown) => void)({ tag: 100 + index }));
  return { tree, surface, all, handles };
}

beforeEach(() => {
  vi.useFakeTimers(); f.effects = []; f.states = []; f.refs = []; f.stateCursor = 0; f.refCursor = 0; f.save.mockClear(); f.remove.mockClear();
  f.state = { targets: ['Alice', 'Stage', 'Feed'].map((label, id) => ({ label, id, type: 'user', canTalk: true })),
    allowTargetRearrange: true, allowTargetAddRemove: true, activeProfileId: 'profile', productionId: 1 };
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('mobile target drag', () => {
  it('owns the gesture above the ScrollView and blocks native responders before React re-renders', () => {
    const { tree, surface } = fixture();
    const setNativeProps = vi.fn();
    (tree.props.ref as { current: unknown }).current = {
      getNativeScrollRef: () => ({ setNativeProps, measureInWindow: vi.fn() }),
    };
    expect(tree.props.canCancelContentTouches).toBe(true);
    expect(tree.props.scrollEnabled).toBe(true);
    expect(call(surface, 'onStartShouldSetResponderCapture', { nativeEvent: { target: 100 } })).toBe(true);
    call(surface, 'onStartShouldSetResponderCapture', { nativeEvent: { target: '100' } });
    expect(call(surface, 'onResponderGrant', touch(230))).toBe(true);
    expect(setNativeProps).toHaveBeenLastCalledWith({ scrollEnabled: false });
    expect(call(surface, 'onResponderTerminationRequest')).toBe(false);
    call(surface, 'onResponderTerminate');
    expect(setNativeProps).toHaveBeenLastCalledWith({ scrollEnabled: true });
    expect(f.save).not.toHaveBeenCalled();
  });

  it('locks scrolling only while a handle is held and restores it on drop or cancellation', () => {
    const { surface } = fixture();
    const scrollProps = () => elements(renderPage()).find(e => e.type === 'ScrollView')!.props;
    expect(scrollProps().scrollEnabled).toBe(true);
    expect(scrollProps().canCancelContentTouches).toBe(true);
    call(surface, 'onStartShouldSetResponderCapture', { nativeEvent: { target: 100 } });
    call(surface, 'onResponderGrant', touch(230));
    expect(scrollProps().scrollEnabled).toBe(false);
    expect(scrollProps().canCancelContentTouches).toBe(false);
    call(surface, 'onResponderRelease', touch(230));
    expect(scrollProps().scrollEnabled).toBe(true);
    expect(scrollProps().canCancelContentTouches).toBe(true);
    call(surface, 'onStartShouldSetResponderCapture', { nativeEvent: { target: 100 } });
    call(surface, 'onResponderGrant', touch(230)); call(surface, 'onResponderTerminate');
    expect(scrollProps().scrollEnabled).toBe(true);
  });

  it('leaves ordinary list and remove-button touches available for scrolling and tapping', () => {
    const { surface } = fixture();
    expect(call(surface, 'onStartShouldSetResponderCapture', { nativeEvent: { target: 999 } })).toBe(false);
    expect(call(surface, 'onResponderGrant', touch(230))).toBe(false);
    expect(f.save).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('saves once on drop, with the complete reordered target list', () => {
    const { surface } = fixture();
    call(surface, 'onStartShouldSetResponderCapture', { nativeEvent: { target: '100' } });
    expect(call(surface, 'onResponderGrant', touch(230))).toBe(true);
    call(surface, 'onResponderMove', touch(350));
    expect(f.save).not.toHaveBeenCalled();
    call(surface, 'onResponderRelease', touch(350));
    expect(f.save.mock.calls[0]?.[0].map(t => t.label)).toEqual(['Stage', 'Feed', 'Alice']);
    call(surface, 'onResponderRelease', touch(350));
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not save taps, tiny movements, or cancelled drags', () => {
    const { surface } = fixture();
    call(surface, 'onStartShouldSetResponderCapture', { nativeEvent: { target: '100' } });
    expect(call(surface, 'onResponderGrant', touch(230))).toBe(true); call(surface, 'onResponderRelease', touch(232));
    call(surface, 'onStartShouldSetResponderCapture', { nativeEvent: { target: '100' } });
    expect(call(surface, 'onResponderGrant', touch(230))).toBe(true); call(surface, 'onResponderMove', touch(350));
    call(surface, 'onResponderTerminate');
    expect(f.save).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['permission', 'production', 'profile', 'targets'])('discards a drop after a remote %s change', change => {
    const { surface } = fixture();
    call(surface, 'onStartShouldSetResponderCapture', { nativeEvent: { target: '100' } });
    expect(call(surface, 'onResponderGrant', touch(230))).toBe(true); call(surface, 'onResponderMove', touch(350));
    if (change === 'permission') f.state.allowTargetRearrange = false;
    if (change === 'production') f.state.productionId = 2;
    if (change === 'profile') f.state.activeProfileId = 'other';
    if (change === 'targets') f.state.targets = f.state.targets.slice().reverse();
    call(surface, 'onResponderRelease', touch(350));
    expect(f.save).not.toHaveBeenCalled();
  });

  it('hides the handles for accounts that can only remove targets', () => {
    f.state.allowTargetRearrange = false;
    const { handles, all } = fixture();
    expect(handles).toHaveLength(0);
    expect(all.filter(e => e.type === 'Pressable')).toHaveLength(3);
  });

  it('keeps reordering available to screen readers without arrow buttons', () => {
    const { handles } = fixture();
    call(handles[1]!, 'onAccessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(f.save.mock.calls[0]?.[0].map(t => t.label)).toEqual(['Stage', 'Alice', 'Feed']);
  });

  it('scrolls long lists at the edge and stops at content boundaries', () => {
    const { tree, surface } = fixture();
    const scrollTo = vi.fn();
    (tree.props.ref as { current: unknown }).current = { scrollTo,
      getNativeScrollRef: () => ({ setNativeProps: vi.fn(), measureInWindow: (cb: (...args: number[]) => void) => cb(0, 200, 300, 120) }) };
    (tree.props.onContentSizeChange as (w: number, h: number) => void)(300, 600);
    call(surface, 'onStartShouldSetResponderCapture', { nativeEvent: { target: '100' } });
    expect(call(surface, 'onResponderGrant', touch(230))).toBe(true); call(surface, 'onResponderMove', touch(320));
    vi.advanceTimersByTime(3000);
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 480, animated: false });
    call(surface, 'onResponderRelease', touch(320));
    expect(f.save.mock.calls[0]?.[0].map(t => t.label)).toEqual(['Stage', 'Feed', 'Alice']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
