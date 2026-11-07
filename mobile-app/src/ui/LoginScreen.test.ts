import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { ReactElement } from 'react';

const f = vi.hoisted(() => ({
  state: { hydrated: true, profiles: [], serverAddress: 'https://intercom.test', username: 'Mella',
    rememberPassword: true, conflictName: undefined as string | undefined, openLoginScanner: false,
    pendingCertificate: null, error: null, statusMessage: '', setField: vi.fn() },
  tokenLogin: vi.fn(async (_input: unknown) => {}), takeOver: vi.fn(async () => {}), login: vi.fn(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [initial, vi.fn()], useEffect: vi.fn(),
}));
vi.mock('react-native', () => ({
  Image: 'Image', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' },
  Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch', Text: 'Text', TextInput: 'TextInput', View: 'View',
  StyleSheet: { create: (styles: object) => styles }, useWindowDimensions: () => ({ width: 430, height: 932 }),
}));
vi.mock('../session/store', () => ({
  useSessionStore: Object.assign((select?: (state: typeof f.state) => unknown) => select ? select(f.state) : f.state,
    { setState: (patch: Partial<typeof f.state>) => Object.assign(f.state, patch), getState: () => f.state }),
  session: { rememberedPassword: () => '', loginWithToken: f.tokenLogin, takeOver: f.takeOver, login: f.login },
}));
vi.mock('./icons', () => ({ QrIcon: 'QrIcon' }));
vi.mock('./QrScannerModal', () => ({ QrScannerModal: 'Scanner' }));
vi.mock('./PrivacyPolicyLink', () => ({ PrivacyPolicyLink: 'PrivacyPolicy' }));
import { LoginScreen } from './LoginScreen';

const assetRequire = createRequire(import.meta.url);
const logoPath = assetRequire.resolve('../../assets/talktome-mark.png');
const previousLogo = assetRequire.cache[logoPath];
assetRequire.cache[logoPath] = { exports: 'talktome-logo' } as NodeModule;
afterAll(() => {
  if (previousLogo) assetRequire.cache[logoPath] = previousLogo;
  else delete assetRequire.cache[logoPath];
});

type Element = ReactElement<Record<string, unknown>>;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function takeOverButton(tree: unknown): Element {
  return elements(tree).find(element => element.type === 'Pressable'
    && elements(element.props.children).some(child => child.props.children === 'Take over other session'))!;
}
beforeEach(() => {
  f.login.mockClear(); f.tokenLogin.mockClear(); f.takeOver.mockClear(); f.state.conflictName = undefined;
});

describe('login session takeover', () => {
  it('resumes the QR login after the connecting screen has unmounted and reset the form', async () => {
    const scanner = elements(LoginScreen()).find(e => e.type === 'Scanner')!;
    (scanner.props.onScanned as (raw: string) => void)('https://intercom.test/#login=qr-token-for-regression');
    expect(f.tokenLogin).toHaveBeenCalledWith(expect.objectContaining({ token: 'qr-token-for-regression', force: false }));
    // A conflict returns from the loading screen to a new LoginScreen with empty local fields.
    f.state.conflictName = 'Mella';
    const remounted = LoginScreen();
    expect(elements(remounted).find(e => e.props.accessibilityLabel === 'Password')?.props.value).toBe('');
    (takeOverButton(remounted).props.onPress as () => void)();
    expect(f.takeOver).toHaveBeenCalledTimes(1);
    expect(f.login).not.toHaveBeenCalled();
  });

  it('uses the stored attempt for password-login conflicts too', () => {
    f.state.conflictName = 'Mella';
    (takeOverButton(LoginScreen()).props.onPress as () => void)();
    expect(f.takeOver).toHaveBeenCalledTimes(1);
    expect(f.login).not.toHaveBeenCalled();
  });
});
