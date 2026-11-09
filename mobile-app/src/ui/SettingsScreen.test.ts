import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
const f = vi.hoisted(() => ({
  path: [{ kind: 'session' }, { kind: 'layout' }, { kind: 'arrange' }],
  effects: [] as (() => void | (() => void))[],
  dismiss: vi.fn(), setPath: vi.fn(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [typeof initial === 'function' ? f.path : initial, typeof initial === 'function' ? f.setPath : vi.fn()],
  useRef: (current: unknown) => ({ current }), useEffect: vi.fn(),
  useLayoutEffect: (effect: () => void | (() => void)) => { f.effects.push(effect); },
  useCallback: (callback: unknown) => callback,
}));
vi.mock('react-native', () => ({
  View: 'View', Modal: 'Modal', Pressable: 'Pressable', SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView', Text: 'Text',
  Platform: { OS: 'ios', isPad: false }, BackHandler: {}, StyleSheet: { create: (s: object) => s },
  useColorScheme: () => 'dark', useWindowDimensions: () => ({ width: 430, height: 932 }),
}));
vi.mock('react-native-screens', () => ({ ScreenStack: 'Stack', ScreenStackItem: 'Screen' }));
vi.mock('../session/store', () => ({ useSessionStore: () => ({ bleBindings: [], identity: { kind: 'user' }, allowTargetAddRemove: true }), session: {} }));
vi.mock('./sessionSheetState', () => ({
  useSessionSheetOpen: { getState: () => ({ start: 'session' }) }, setSessionSheetDismissGestureEnabled: f.dismiss,
}));
vi.mock('../protocol/clientVersion', () => ({}));
vi.mock('../audio/routes', () => ({}));
vi.mock('../talk/talkLink', () => ({}));
vi.mock('../watch/native', () => ({}));
vi.mock('./PttSettingsScreens', () => ({}));
vi.mock('./SessionPage', () => ({}));
vi.mock('./settingsChrome', () => ({ SettingsThemeProvider: 'Theme', SettingsHeader: 'Header', useSettingsStyles: () => ({}) }));
vi.mock('./ArrangeTargetsPage', () => ({ ArrangeTargetsPage: 'Editor' }));
vi.mock('./VolumeSlider', () => ({}));
vi.mock('./IosSystemRoutePicker', () => ({}));
vi.mock('../keyboard/NativeKeyboard', () => ({ hardwareKeyboardAvailable: true, NativeKeyboard: 'NativeKeyboard' }));
import { SessionSheet } from './SettingsScreen';
type Element = ReactElement<Record<string, unknown>>;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const e = value as Element;
  return [e, ...elements(e.props.children)];
}
beforeEach(() => { f.path = [{ kind: 'session' }, { kind: 'layout' }, { kind: 'arrange' }]; f.effects = []; f.dismiss.mockClear(); f.setPath.mockReset().mockImplementation((update: (path: typeof f.path) => typeof f.path) => { f.path = update(f.path); }); });
describe('target editor presentation', () => {
  it('uses one native modal presentation, avoiding duplicate RN Modal touch handlers', () => {
    const all = elements(SessionSheet({ onClose() {} }));
    const modal = all.find(e => e.props.screenId === 'target-editor-modal')!;
    expect(modal.props.stackPresentation).toBe('fullScreenModal');
    expect(modal.props.gestureEnabled).toBe(false);
    expect(all.some(e => e.type === 'Modal')).toBe(false);
    expect(all.filter(e => e.type === 'Screen').map(e => e.props.screenId)).toEqual(['close', 'session', 'layout', 'target-editor-modal', 'editor-parent', 'editor:arrange']);
    expect(elements(modal).find(e => (e.props.page as { kind?: string })?.kind === 'arrange')).toBeDefined();
    f.effects.forEach(effect => effect());
    expect(f.dismiss).toHaveBeenLastCalledWith(false);
  });
  it('wires the editor header + and Back through to the live navigation path', () => {
    function header(kind: string) {
      const page = elements(SessionSheet({ onClose() {} })).find(e => (e.props.page as { kind?: string })?.kind === kind)!;
      const content = (page.type as (props: Record<string, unknown>) => unknown)(page.props);
      return elements(content).find(e => e.type === 'Header')!;
    }
    (header('arrange').props.onAdd as () => void)();
    expect(f.path.at(-1)?.kind).toBe('add-targets');
    (header('add-targets').props.onBack as () => void)();
    expect(f.path.at(-1)?.kind).toBe('arrange');
    (header('arrange').props.onBack as () => void)();
    expect(f.path.at(-1)?.kind).toBe('layout');
  });
  it('keeps Add targets in the editor and restores the original menu when leaving it', () => {
    f.path.push({ kind: 'add-targets' });
    let all = elements(SessionSheet({ onClose() {} }));
    expect(elements(all.find(e => e.props.screenId === 'target-editor-modal')).some(e => (e.props.page as { kind?: string })?.kind === 'add-targets')).toBe(true);
    f.path = [{ kind: 'session' }, { kind: 'layout' }];
    all = elements(SessionSheet({ onClose() {} }));
    expect(all.some(e => e.props.screenId === 'target-editor-modal')).toBe(false);
    f.effects.forEach(effect => effect());
    expect(f.dismiss).toHaveBeenLastCalledWith(true);
  });
});


describe('native target editor navigation', () => {
  function editorScreen(id: string) {
    return elements(SessionSheet({ onClose() {} })).find(e => e.type === 'Screen' && e.props.screenId === id)!;
  }
  it('provides a real native parent and native edge-pop gesture, without a JS responder on the safe area', () => {
    const all = elements(SessionSheet({ onClose() {} }));
    const parent = editorScreen('editor-parent');
    expect(parent.props.gestureEnabled).toBe(false);
    expect(elements(parent).some(e => (e.props.page as { kind?: string })?.kind === 'layout')).toBe(true);
    const editor = editorScreen('editor:arrange');
    expect(editor.props.gestureEnabled).toBe(true);
    expect(editor.props.fullScreenSwipeEnabled).toBe(false);
    expect(all.some(e => e.props.onStartShouldSetResponderCapture || e.props.onMoveShouldSetResponderCapture)).toBe(false);
  });
  it('returns to Layout when UIKit finishes popping Edit targets', () => {
    (editorScreen('editor:arrange').props.onDismissed as () => void)();
    expect(f.path.map(p => p.kind)).toEqual(['session', 'layout']);
    expect(elements(SessionSheet({ onClose() {} })).some(e => e.props.screenId === 'target-editor-modal')).toBe(false);
  });
  it('pops Add targets to Edit targets and keeps the full-screen editor open', () => {
    f.path.push({ kind: 'add-targets' });
    const add = editorScreen('editor:add-targets');
    expect(add.props.gestureEnabled).toBe(true);
    expect(add.props.fullScreenSwipeEnabled).toBe(false);
    (add.props.onDismissed as () => void)();
    expect(f.path.map(p => p.kind)).toEqual(['session', 'layout', 'arrange']);
    expect(elements(SessionSheet({ onClose() {} })).some(e => e.props.screenId === 'target-editor-modal')).toBe(true);
  });
});
