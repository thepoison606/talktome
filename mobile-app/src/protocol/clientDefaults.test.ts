import { describe, expect, it } from 'vitest';

import {
  normalizeServerClientDefaults,
  parseDefaultClientSettingsScript,
} from './clientDefaults';

describe('parseDefaultClientSettingsScript', () => {
  it('parses the script the server serves at /default-client-settings.js', () => {
    const body =
      'window.TALKTOME_DEFAULT_CLIENT_SETTINGS = {"audioProfile":"ultra-low","dimAmountDb":-12,' +
      '"dimFeedsWhileSpeaking":true,"dimWhenAddressed":true,"audioAutoProcessing":true,' +
      '"playConnectionSounds":false,"leftHandMode":false,"lockMultipleTargets":true};\n';
    expect(parseDefaultClientSettingsScript(body)).toEqual({
      audioProfile: 'ultra-low',
      dimAmountDb: -12,
      dimFeedsWhileSpeaking: true,
      dimWhenAddressed: true,
      audioAutoProcessing: true,
      playConnectionSounds: false,
      leftHandMode: false,
      lockMultipleTargets: true,
    });
  });

  it('returns only the keys the admin configured', () => {
    const body = 'window.TALKTOME_DEFAULT_CLIENT_SETTINGS = {"lockMultipleTargets":true};';
    expect(parseDefaultClientSettingsScript(body)).toEqual({ lockMultipleTargets: true });
  });

  it('returns empty defaults for old servers or bad payloads', () => {
    expect(parseDefaultClientSettingsScript('')).toEqual({});
    expect(parseDefaultClientSettingsScript('Cannot GET /default-client-settings.js')).toEqual({});
    expect(parseDefaultClientSettingsScript('window.TALKTOME_DEFAULT_CLIENT_SETTINGS = {broken};')).toEqual({});
  });
});

describe('normalizeServerClientDefaults', () => {
  it('accepts both big main button defaults but rejects truthy strings', () => {
    expect(normalizeServerClientDefaults({ bigMainButton: true })).toEqual({ bigMainButton: true });
    expect(normalizeServerClientDefaults({ bigMainButton: false })).toEqual({ bigMainButton: false });
    expect(normalizeServerClientDefaults({ bigMainButton: 'true' })).toEqual({});
  });
  it('drops values outside the web option lists', () => {
    expect(
      normalizeServerClientDefaults({
        audioProfile: 'turbo',
        dimAmountDb: -13,
        leftHandMode: 'yes',
        lockMultipleTargets: true,
      }),
    ).toEqual({ lockMultipleTargets: true });
  });

  it('accepts the same dim steps as the web picker', () => {
    expect(normalizeServerClientDefaults({ dimAmountDb: -24 })).toEqual({ dimAmountDb: -24 });
    expect(normalizeServerClientDefaults({ dimAmountDb: -15 })).toEqual({ dimAmountDb: -15 });
  });

  it('migrates TalkToMe 1.5.4 -14 dB to 1.5.5 -15 dB', () => {
    expect(normalizeServerClientDefaults({ dimAmountDb: -14 })).toEqual({ dimAmountDb: -15 });
  });
});
