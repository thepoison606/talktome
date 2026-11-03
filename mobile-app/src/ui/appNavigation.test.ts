import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const fixture = vi.hoisted(() => ({
  os: 'android', state: {} as Record<string, unknown>, effects: [] as (() => unknown)[],
  back: null as null | (() => boolean), cancelled: 0,
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: (effect: () => unknown) => { fixture.effects.push(effect); },
}));
vi.mock('react-native', () => ({
  Platform: { get OS() { return fixture.os; }, isPad: false },
  ActivityIndicator: 'ActivityIndicator', SafeAreaView: 'SafeAreaView', View: 'View',
  StyleSheet: { create: (styles: object) => styles, absoluteFill: {} }, useColorScheme: () => 'dark',
  BackHandler: { addEventListener: (_event: string, callback: () => boolean) => {
    fixture.back = callback; return { remove() {} };
  } },
  Linking: { addEventListener: () => ({ remove() {} }), getInitialURL: async () => null },
}));
vi.mock('react-native-screens', () => ({ ScreenStack: 'NativeStack', ScreenStackItem: 'NativeScreen' }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: vi.fn(), deactivateKeepAwake: vi.fn() }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'SafeAreaProvider' }));
vi.mock('./androidSafeArea', () => ({ useAndroidSafeArea: () => ({paddingTop:32,paddingBottom:8,paddingLeft:0,paddingRight:48}) }));
vi.mock('../session/store', () => ({
  useSessionStore: (selector: (state: Record<string, unknown>) => unknown) => selector(fixture.state),
  session: { hydrate: vi.fn(), handleTalkUrl: vi.fn(), cancelAddProfile() {
    fixture.cancelled++; fixture.state.addingProfile = false;
  } },
}));
vi.mock('./sessionSheetState', () => ({ closeSessionSheet: vi.fn(), useSessionSheetOpen: (selector: (state: object) => unknown) => selector({open:false}) }));
vi.mock('./LoginScreen', () => ({ LoginScreen: 'Login' }));
vi.mock('./ProfilePickerScreen', () => ({ ProfilePickerScreen: 'Profiles' }));
vi.mock('./OperatorScreen', () => ({ OperatorScreen: 'Operator' }));
vi.mock('./PausedScreen', () => ({ PausedScreen: 'Paused' }));
vi.mock('./ProductionPickerScreen', () => ({ ProductionPickerScreen: 'Productions' }));
vi.mock('./SettingsScreen', () => ({ SessionSheet: 'Sheet' }));
vi.mock('./settingsTheme', () => ({ settingsPalette: () => ({sheet:'#111'}), settingsScheme: () => 'dark' }));

import { AppContent } from '../../App';

type Element = ReactElement<Record<string, unknown>>;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function screens(tree: unknown): Element[] {
  return elements(tree).filter(element => typeof element.type === 'function' && element.props.screen);
}

beforeEach(() => {
  fixture.os = 'android'; fixture.effects = []; fixture.back = null; fixture.cancelled = 0;
  fixture.state = { hydrated:true, identity:null, operatorReady:false, status:'idle', paused:false,
    addingProfile:false, profiles:[{id:'first'}], cameraTally:{pgm:false,pvw:false} };
});

describe('profile navigation', () => {
  it('keeps Android Add profile in a single interactive RN page and handles hardware Back', () => {
    expect(screens(AppContent()).map(element => element.props.screen)).toEqual(['profiles']);
    fixture.state.addingProfile = true;
    const tree = AppContent();
    expect(screens(tree).map(element => element.props.screen)).toEqual(['login']);
    expect(elements(tree).some(element => element.type === 'NativeStack' || element.type === 'NativeScreen')).toBe(false);
    for (const effect of fixture.effects) effect();
    expect(fixture.back?.()).toBe(true);
    expect(fixture.cancelled).toBe(1);
    expect(screens(AppContent()).map(element => element.props.screen)).toEqual(['profiles']);
  });

  it('preserves iOS native stacked login and its swipe-back dismissal', () => {
    fixture.os = 'ios'; fixture.state.addingProfile = true;
    const tree = AppContent();
    expect(screens(tree).map(element => element.props.screen)).toEqual(['profiles','login']);
    const login = elements(tree).find(element => element.type === 'NativeScreen' && element.props.screenId === 'login');
    expect(login).toBeDefined();
    (login?.props.onDismissed as () => void)();
    expect(fixture.cancelled).toBe(1);
  });
});
