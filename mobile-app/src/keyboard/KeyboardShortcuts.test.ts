import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
const f = vi.hoisted(() => ({
  online: false, press: vi.fn(), release: vi.fn(), state: {} as Record<string, unknown>,
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useRef: (current: unknown) => ({ current }), useEffect: vi.fn() }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active' } }));
vi.mock('../session/store', () => ({ useSessionStore: () => f.state, session: { canTalkTo: () => f.online, pressTalk: f.press, releaseTalk: f.release } }));
vi.mock('../ui/sessionSheetState', () => ({ useSessionSheetOpen: () => false }));
vi.mock('./focus', () => ({ useKeyboardFocus: () => 0 }));
vi.mock('./preferences', () => ({ useKeyboardPreferences: () => ({ hydrated: true, scopes: {} }), hydrateKeyboardPreferences: vi.fn() }));
vi.mock('./NativeKeyboard', () => ({ NativeKeyboard: 'NativeKeyboard' }));
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { useKeyboardActivity } from './activity';

function listener() {
  const element = KeyboardShortcuts() as ReactElement<{ onKeyboardEvent(event: { nativeEvent: { code: string; pressed: boolean } }): void; onReset(): void }>;
  return { key: (code: string, pressed: boolean) => element.props.onKeyboardEvent({ nativeEvent: { code, pressed } }), reset: element.props.onReset };
}
beforeEach(() => {
  f.online = false; f.press.mockClear(); f.release.mockClear();
  f.state = {
    targets: [{ type: 'user', id: 2, label: 'Offline user', canTalk: true }],
    operatorReady: true, status: 'ready', signalingStatus: 'connected',
    activeProfileId: 'profile', productionId: 7, mainButtonTargets: {}, replyTarget: null,
  };
  useKeyboardActivity.setState({ targetKeys: [] });
});

describe('offline hotkey feedback', () => {
  it('highlights an offline target without attempting transmission or showing a PTT error', () => {
    const keyboard = listener();
    keyboard.key('Digit1', true);
    expect(useKeyboardActivity.getState().targetKeys).toEqual(['user-2']);
    expect(f.press).not.toHaveBeenCalled();
    keyboard.key('Digit1', false);
    expect(useKeyboardActivity.getState().targetKeys).toEqual([]);
  });

  it('does not start transmitting automatically when an offline held target comes online', () => {
    const keyboard = listener();
    keyboard.key('Digit1', true); f.online = true;
    keyboard.key('Digit1', true);
    expect(f.press).not.toHaveBeenCalled();
    keyboard.key('Digit1', false); keyboard.key('Digit1', true);
    expect(f.press).toHaveBeenCalledOnce();
    keyboard.reset();
    expect(useKeyboardActivity.getState().targetKeys).toEqual([]);
  });

  it('keeps offline feedback for independent keys and clears it on focus loss', () => {
    const keyboard = listener();
    keyboard.key('Digit1', true); keyboard.key('Numpad1', true);
    keyboard.key('Digit1', false);
    expect(useKeyboardActivity.getState().targetKeys).toEqual(['user-2']);
    keyboard.reset();
    expect(useKeyboardActivity.getState().targetKeys).toEqual([]);
  });

  it('also highlights a pinned offline Main destination', () => {
    f.state.mainButtonTargets = { 'profile:7': 'user-2' };
    const keyboard = listener(); keyboard.key('Space', true);
    expect(useKeyboardActivity.getState().targetKeys).toEqual(['user-2']);
    expect(f.press).not.toHaveBeenCalled();
    keyboard.key('Space', false);
    expect(useKeyboardActivity.getState().targetKeys).toEqual([]);
  });
});
