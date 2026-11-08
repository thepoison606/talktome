import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { session, useSessionStore } from '../session/store';
import { mainButtonStorageKey, resolveMainButton } from '../session/mainButton';
import { useSessionSheetOpen } from '../ui/sessionSheetState';
import { keyAssignments, KeyboardHolds } from './bindings';
import { hydrateKeyboardPreferences, useKeyboardPreferences } from './preferences';
import { NativeKeyboard } from './NativeKeyboard';
import { useKeyboardFocus } from './focus';
import { publishKeyboardHolds } from './activity';

export function KeyboardShortcuts() {
  const state = useSessionStore();
  const preferences = useKeyboardPreferences();
  const sheetOpen = useSessionSheetOpen(s => s.open);
  const focusRequest = useKeyboardFocus(s => s.request);
  const active = preferences.hydrated && state.operatorReady && state.status === 'ready' && state.signalingStatus === 'connected' && !sheetOpen;
  const holds = useRef<KeyboardHolds | null>(null);
  if (!holds.current) holds.current = new KeyboardHolds(
    (target, key) => { if (session.canTalkTo(target)) void session.pressTalk(target, key); },
    key => { void session.releaseTalk(undefined, key); },
    publishKeyboardHolds,
  );
  const scope = mainButtonStorageKey(state.activeProfileId, state.productionId);
  const main = resolveMainButton({ storedIdentity: state.mainButtonTargets[scope], targets: state.targets, replyTarget: state.replyTarget });
  const assignments = keyAssignments(state.targets, preferences.scopes[scope] ?? {}, main.target, state.replyTarget);
  const codes = assignments.flatMap(row => row.binding?.type === 'digit' ? [`Digit${row.binding.value}`, `Numpad${row.binding.value}`] : row.binding ? [row.binding.value] : []);

  useEffect(() => { void hydrateKeyboardPreferences(); }, []);
  useEffect(() => { if (preferences.hydrated) session.remotePanel.publish(); }, [preferences.hydrated, preferences.scopes]);
  useEffect(() => {
    holds.current?.reset();
    return () => holds.current?.reset();
  }, [active, scope]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') holds.current?.reset(); });
    return () => { subscription.remove(); holds.current?.reset(); };
  }, []);
  return <NativeKeyboard listening={active} focusRequest={focusRequest} codes={codes} onKeyboardEvent={({ nativeEvent }) => {
    if ((active && AppState.currentState === 'active') || !nativeEvent.pressed) holds.current?.event(nativeEvent.code, nativeEvent.pressed, assignments);
  }} onReset={() => holds.current?.reset()} />;
}
