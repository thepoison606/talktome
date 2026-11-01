import { AUDIO_PROFILES, normalizeServerClientDefaults, type ServerClientDefaults } from './clientDefaults';
import { normalizeAudioPreference, type TargetAudioPreference } from './audioPreference';

export type PanelAudioState = TargetAudioPreference & {
  targetType: 'user' | 'conference' | 'feed';
  targetId: number;
};

export type PanelSettings = {
  revision: number;
  storage: Record<string, string>;
  pendingProductionId?: number;
};

export type PanelAudioSettings = Required<Omit<ServerClientDefaults, 'bigMainButton'>> & {
  userInputGainDb: number;
  voiceTriggerEnabled: boolean;
  voiceTriggerTarget: string;
  voiceTriggerThresholdDb: number;
};

export const PANEL_AUDIO_DEFAULTS: PanelAudioSettings = {
  audioProfile: 'ultra-low', dimAmountDb: -15,
  dimFeedsWhileSpeaking: false, dimWhenAddressed: true, audioAutoProcessing: false,
  playConnectionSounds: true, leftHandMode: false, lockMultipleTargets: false,
  userInputGainDb: 18, voiceTriggerEnabled: false, voiceTriggerTarget: '', voiceTriggerThresholdDb: -32,
};

export type PanelCommand = (
  | { kind: 'talk'; action: 'press' | 'release' | 'lock' | 'unlock' | 'stop'; inputKey?: string;
      targetType?: 'user' | 'conference' | 'reply'; targetId?: number }
  | { kind: 'target-audio'; audio: PanelAudioState }
  | { kind: 'audio-settings'; settings: PanelAudioSettings }
  | { kind: 'preferences'; patch: Record<string, string | null> }
  | { kind: 'production'; productionId: number }
  | { kind: 'order' }
) & { panelSettings?: PanelSettings };

export type PanelClientReport = {
  revision: number;
  storage: Record<string, string>;
  audioStates: PanelAudioState[];
  runtime: {
    devices: { kind: 'audiooutput'; deviceId: string; label: string }[];
    inputDeviceId: string;
    outputDeviceId: string;
    outputSupported: boolean;
    talking: boolean;
    targets: { type: string; id: number | string }[];
    lockedTargets: { type: string; id: number | string }[];
  };
};

export type PanelCommandResult = { ok: boolean; error?: string; report?: PanelClientReport };

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function positiveId(value: unknown): number | null {
  const numeric = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof numeric === 'number' && Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

export function parsePanelSettings(value: unknown): PanelSettings | null {
  const raw = asRecord(value);
  const storage = asRecord(raw?.storage);
  if (!raw || !storage || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0) return null;
  const entries = Object.entries(storage);
  if (entries.length > 128 || entries.some(([key, value]) => key.length > 512 || typeof value !== 'string' || value.length > 32768)) return null;
  return {
    revision: Number(raw.revision), storage: Object.fromEntries(entries) as Record<string, string>,
    ...(positiveId(raw.pendingProductionId) ? { pendingProductionId: positiveId(raw.pendingProductionId)! } : {}),
  };
}

export function parsePanelAudioState(value: unknown): PanelAudioState | null {
  const raw = asRecord(value);
  const id = positiveId(raw?.targetId);
  if (!raw || id == null || !['user', 'conference', 'feed'].includes(String(raw.targetType))
    || typeof raw.muted !== 'boolean' || typeof raw.volume !== 'number'
    || !Number.isFinite(raw.volume) || raw.volume < 0 || raw.volume > 1) return null;
  return { targetType: raw.targetType as PanelAudioState['targetType'], targetId: id, ...normalizeAudioPreference(raw) };
}

export function parsePanelAudioSettings(value: unknown): PanelAudioSettings | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const defaults = normalizeServerClientDefaults(raw);
  const booleanKeys = ['dimFeedsWhileSpeaking', 'dimWhenAddressed', 'audioAutoProcessing', 'playConnectionSounds', 'leftHandMode', 'lockMultipleTargets', 'voiceTriggerEnabled'];
  if (booleanKeys.some(key => typeof raw[key] !== 'boolean') || !AUDIO_PROFILES.includes(raw.audioProfile as never)
    || defaults.dimAmountDb == null || typeof raw.voiceTriggerTarget !== 'string'
    || (raw.voiceTriggerTarget !== '' && !/^(user|conference):\d+$/.test(raw.voiceTriggerTarget))) return null;
  for (const [key, min, max] of [['userInputGainDb', -30, 40], ['voiceTriggerThresholdDb', -60, -6]] as const) {
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]) || raw[key] < min || raw[key] > max) return null;
  }
  return { ...PANEL_AUDIO_DEFAULTS, ...defaults, userInputGainDb: Number(raw.userInputGainDb),
    voiceTriggerEnabled: raw.voiceTriggerEnabled as boolean, voiceTriggerTarget: raw.voiceTriggerTarget,
    voiceTriggerThresholdDb: Number(raw.voiceTriggerThresholdDb) };
}

export function parsePanelCommand(value: unknown): PanelCommand {
  const raw = asRecord(value);
  if (!raw) throw new Error('Invalid panel command.');
  const settings = raw.panelSettings === undefined ? undefined : parsePanelSettings(raw.panelSettings);
  if (settings === null) throw new Error('Invalid panel settings.');
  const base = settings ? { panelSettings: settings } : {};
  switch (raw.kind) {
    case 'talk': {
      if (!['press', 'release', 'lock', 'unlock', 'stop'].includes(String(raw.action))) break;
      const inputKey = typeof raw.inputKey === 'string' && raw.inputKey.startsWith('panel:') && raw.inputKey.length <= 512 ? raw.inputKey : undefined;
      if ((raw.action === 'press' || raw.action === 'release') && !inputKey) break;
      const targetId = positiveId(raw.targetId);
      const targetType = raw.targetType as 'user' | 'conference' | 'reply';
      if (['press', 'lock', 'unlock'].includes(String(raw.action)) && (targetType !== 'reply' && (!['user', 'conference'].includes(targetType) || targetId == null))) break;
      return { ...base, kind: 'talk', action: raw.action as Extract<PanelCommand, { kind: 'talk' }>['action'], inputKey,
        targetType, ...(targetId == null ? {} : { targetId }) };
    }
    case 'target-audio': {
      const audio = parsePanelAudioState(raw.audio);
      if (audio) return { ...base, kind: 'target-audio', audio };
      break;
    }
    case 'audio-settings': {
      const settings = parsePanelAudioSettings(raw.settings);
      if (settings) return { ...base, kind: 'audio-settings', settings };
      break;
    }
    case 'preferences': {
      const patch = asRecord(raw.patch);
      if (patch && Object.entries(patch).length <= 128 && Object.values(patch).every(value => value === null || (typeof value === 'string' && value.length <= 32768))) {
        return { ...base, kind: 'preferences', patch: patch as Record<string, string | null> };
      }
      break;
    }
    case 'production': {
      const productionId = positiveId(raw.productionId);
      if (productionId != null) return { ...base, kind: 'production', productionId };
      break;
    }
    case 'order': return { ...base, kind: 'order' };
  }
  throw new Error('Invalid or unsupported panel command.');
}
