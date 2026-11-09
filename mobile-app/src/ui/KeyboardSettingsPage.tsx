import { useEffect, useState } from 'react';
import { session, useSessionStore } from '../session/store';
import { mainButtonStorageKey } from '../session/mainButton';
import { keyAssignments, keyBinding } from '../keyboard/bindings';
import { hydrateKeyboardPreferences, saveKeyboardOverrides, useKeyboardPreferences } from '../keyboard/preferences';
import { hardwareKeyboardAvailable, NativeKeyboard } from '../keyboard/NativeKeyboard';
import { SettingsActionRow, SettingsFootnote, SettingsSection } from './settingsChrome';

export function KeyboardSettingsPage() {
  const state = useSessionStore();
  const preferences = useKeyboardPreferences();
  const [recording, setRecording] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const scope = mainButtonStorageKey(state.activeProfileId, state.productionId);
  const overrides = preferences.scopes[scope] ?? {};
  const rows = keyAssignments(state.targets, overrides, session.talk.resolvedMainButton().target, state.replyTarget);
  useEffect(() => { void hydrateKeyboardPreferences(); }, []);
  useEffect(() => { setRecording(null); }, [scope]);
  return <>
    <SettingsSection title="Keyboard shortcuts">
      <SettingsFootnote>Hold a key to talk; release it to stop. Defaults: 1–9 in target order, Space for the main button. Number-pad digits work too. Shortcuts are paused while settings are open.</SettingsFootnote>
      {!hardwareKeyboardAvailable ? <SettingsFootnote>This app build needs a native update to support hardware keyboards.</SettingsFootnote> : null}
      {rows.map(row => <SettingsActionRow key={row.identity}
        label={`${row.label} · ${recording === row.identity ? 'Press a key…' : row.binding?.label ?? 'Not assigned'}`}
        onPress={() => {
          if (!preferences.hydrated || !hardwareKeyboardAvailable) return;
          setNotice(''); setRecording(row.identity);
        }} />)}
      {recording ? <SettingsActionRow label="Cancel recording" onPress={() => setRecording(null)} /> : null}
      {notice ? <SettingsFootnote>{notice}</SettingsFootnote> : null}
    </SettingsSection>
    <SettingsSection title="Reset bindings">
      {rows.filter(row => overrides[row.identity]).map(row => <SettingsActionRow key={row.identity} label={`Reset ${row.label}`} onPress={() => {
        const next = { ...overrides }; delete next[row.identity];
        saveKeyboardOverrides(scope, next); setRecording(null); setNotice('');
      }} />)}
      <SettingsActionRow label="Reset all to defaults" onPress={() => { saveKeyboardOverrides(scope, {}); setRecording(null); setNotice(''); }} />
      <SettingsFootnote>Bindings are saved for this profile and production. Custom assignments stay with their target when you reorder it. Tap a row, then press a key on the connected keyboard. Escape cancels recording.</SettingsFootnote>
    </SettingsSection>
    <NativeKeyboard listening={recording !== null} capture onReset={() => setRecording(null)} onKeyboardEvent={({ nativeEvent }) => {
      if (!recording || !nativeEvent.pressed) return;
      if (nativeEvent.code === 'Escape') { setRecording(null); return; }
      const binding = keyBinding(nativeEvent.code);
      if (!binding) return;
      const conflict = Object.entries(overrides).find(([identity, value]) => identity !== recording && value.id === binding.id);
      if (conflict) { setNotice(`This key is already assigned to ${rows.find(row => row.identity === conflict[0])?.label ?? 'another target'}. Reset that binding first.`); return; }
      saveKeyboardOverrides(scope, { ...overrides, [recording]: binding });
      setNotice(''); setRecording(null);
    }} />
  </>;
}
