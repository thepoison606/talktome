// Server-configured default client settings (server 1.4.4+, defaultClientSettings.js).
// The server serves only the keys the admin actually configured; personal choices
// saved on this device always take precedence, exactly like the web client.

export const AUDIO_PROFILES = ['ultra-low', 'low', 'standard'] as const;
export type AudioProfileName = (typeof AUDIO_PROFILES)[number];

/** TalkToMe 1.5.5 replaced -14 dB with -15 dB. Stored -14 still maps to -15. */
export const DIM_AMOUNT_DB_OPTIONS = [-6, -12, -15, -18, -24] as const;
export const DEFAULT_DIM_AMOUNT_DB = -15;

export type TargetAppearance = {
  colors: Record<string, string>;
  keepBackgroundWhileTalking: boolean;
};

export const DEFAULT_TARGET_APPEARANCE: TargetAppearance = { colors: {}, keepBackgroundWhileTalking: false };

export function targetColorForeground(color: string): string {
  const channels = color.slice(1).match(/../g) ?? [];
  const [r = 0, g = 0, b = 0] = channels.map(hex => {
    const channel = parseInt(hex, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000' : '#fff';
}

export type ServerClientDefaults = {
  audioProfile?: AudioProfileName;
  dimAmountDb?: number;
  dimFeedsWhileSpeaking?: boolean;
  dimWhenAddressed?: boolean;
  audioAutoProcessing?: boolean;
  playConnectionSounds?: boolean;
  leftHandMode?: boolean;
  bigMainButton?: boolean;
  lockMultipleTargets?: boolean;
  tapToLock?: boolean;
  targetAppearance?: TargetAppearance;
};

const BOOLEAN_KEYS = [
  'dimFeedsWhileSpeaking',
  'dimWhenAddressed',
  'audioAutoProcessing',
  'playConnectionSounds',
  'leftHandMode',
  'bigMainButton',
  'lockMultipleTargets',
  'tapToLock',
] as const;

export function migrateDimAmountDb(value: number): number {
  return value === -14 ? DEFAULT_DIM_AMOUNT_DB : value;
}

export function normalizeServerClientDefaults(value: unknown): ServerClientDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const raw = value as Record<string, unknown>;
  const normalized: ServerClientDefaults = {};
  if (AUDIO_PROFILES.includes(raw.audioProfile as AudioProfileName)) {
    normalized.audioProfile = raw.audioProfile as AudioProfileName;
  }
  const dimAmountDb = migrateDimAmountDb(Number(raw.dimAmountDb));
  if (DIM_AMOUNT_DB_OPTIONS.includes(dimAmountDb as (typeof DIM_AMOUNT_DB_OPTIONS)[number])) {
    normalized.dimAmountDb = dimAmountDb;
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof raw[key] === 'boolean') {
      normalized[key] = raw[key] as boolean;
    }
  }
  const appearance = raw.targetAppearance as Partial<TargetAppearance> | undefined;
  if (appearance && typeof appearance === 'object' && !Array.isArray(appearance)) {
    const hex = /^#[0-9a-f]{6}$/;
    const colors = Object.fromEntries(Object.entries(appearance.colors ?? {}).filter(
      ([key, color]) => hex.test(key) && typeof color === 'string' && hex.test(color),
    ));
    normalized.targetAppearance = { colors, keepBackgroundWhileTalking: appearance.keepBackgroundWhileTalking === true };
  }
  return normalized;
}

/**
 * Parses the body of `GET /default-client-settings.js`, which is a script of
 * the form `window.TALKTOME_DEFAULT_CLIENT_SETTINGS = {...};`.
 */
export function parseDefaultClientSettingsScript(body: string): ServerClientDefaults {
  const json = /TALKTOME_DEFAULT_CLIENT_SETTINGS\s*=\s*(\{[\s\S]*?\})\s*;/.exec(body)?.[1];
  if (!json) {
    return {};
  }
  try {
    return normalizeServerClientDefaults(JSON.parse(json));
  } catch {
    return {};
  }
}
