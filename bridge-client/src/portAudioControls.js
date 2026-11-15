import '../../public/bridgeAudioLevels.js';
import '../../public/audioMeter.js';

export const audioLevels = globalThis.TalktomeBridgeAudioLevels;
export const audioMeter = globalThis.TalktomeAudioMeter;
export function gainLabel(level) {
  return `${level.gainDb > 0 ? '+' : ''}${level.gainDb.toFixed(1)} dB${level.muted ? ' · Muted' : ''}${level.noiseSuppression ? ' · Noise suppression' : ''}`;
}

export function renderPortAudioControl(portId, direction, level) {
  const label = direction === 'input' ? 'Input gain' : 'Output volume';
  const [min, max] = audioLevels.LIMITS[direction];
  const id = `${portId}-audio-${direction}`;
  return `<div class="port-audio-control" data-audio-direction="${direction}">
    <button type="button" class="port-audio-toggle${level.gainDb || level.muted || level.noiseSuppression ? ' is-adjusted' : ''}" data-audio-open aria-label="${label}" aria-expanded="false" aria-controls="${id}" title="${label}: ${gainLabel(level)}">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 7h7m5 0h4M4 17h2m5 0h9"/><circle cx="13.5" cy="7" r="2.5"/><circle cx="8.5" cy="17" r="2.5"/></svg>
    </button>
    <div class="port-audio-popover" id="${id}" hidden role="dialog" aria-label="${label}">
      <div class="port-audio-heading"><strong>${label}</strong><button type="button" data-audio-close aria-label="Close ${label}">×</button></div>
      <div class="port-audio-actions">
        <label class="switch-row port-audio-mute"><input type="checkbox" role="switch" data-audio-mute aria-label="Mute ${direction}" ${level.muted ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span class="switch-label" data-audio-mute-label>${level.muted ? 'Muted' : 'Mute'}</span></label>
        <div class="port-audio-value">
          <button type="button" class="port-audio-step" data-audio-step="-0.5" aria-label="Decrease ${label.toLowerCase()} by 0.5 dB" title="Decrease by 0.5 dB" ${level.gainDb <= min ? 'disabled' : ''}>−</button>
          <button type="button" class="port-audio-step" data-audio-step="0.5" aria-label="Increase ${label.toLowerCase()} by 0.5 dB" title="Increase by 0.5 dB" ${level.gainDb >= max ? 'disabled' : ''}>+</button>
          <input type="number" data-audio-number min="${min}" max="${max}" step="0.5" value="${level.gainDb}" aria-label="${label} in dB"><span>dB</span>
        </div>
        <button type="button" data-audio-reset title="Reset to 0 dB and unmute">Reset</button>
      </div>

      <input type="range" data-audio-range min="${min}" max="${max}" step="0.5" value="${level.gainDb}" aria-label="${label}">
      <div class="port-audio-scale"><span>${min} dB</span><span>${max > 0 ? '+' : ''}${max} dB</span></div>
      ${direction === 'input' ? `<label class="switch-row port-audio-noise"><input type="checkbox" role="switch" data-audio-noise aria-label="Noise suppression" ${level.noiseSuppression ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span class="switch-label">Noise suppression</span></label>` : ''}
      ${direction === 'input' ? `<label class="port-audio-tone"><span>Test tone</span><select data-audio-tone aria-label="Input test tone" title="Replaces the input with a −20 dBFS RMS tone; bypasses noise suppression"><option value="0">Off</option><option value="400">400 Hz</option><option value="1000">1 kHz</option></select></label>` : ''}
      <div class="port-audio-meter" role="meter" aria-label="${label} RMS signal level" title="RMS signal level: −96 to 0 dBFS" aria-valuemin="-96" aria-valuemax="0" aria-valuenow="-96"><span data-audio-meter-fill></span></div>
      <div class="port-audio-meter-label"><span data-audio-meter-label>Waiting for audio…</span><span data-audio-clip hidden>CLIP</span></div>
      <div class="port-audio-feedback"><span class="port-audio-save" role="status" data-audio-save></span><button type="button" data-audio-retry hidden>Retry</button></div>
    </div>
  </div>`;
}
