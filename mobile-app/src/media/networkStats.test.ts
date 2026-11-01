import { describe, expect, it } from 'vitest';
import { summarizeNetworkReports } from './networkStats';
const report = (...rows: Record<string, unknown>[]) => new Map(rows.map((row, index) => [String(index), row]));

describe('native WebRTC network stats', () => {
  it('uses the selected ICE pair and averages send/receive RTT', () => {
    expect(summarizeNetworkReports([
      report({ type: 'transport', selectedCandidatePairId: 'chosen' }, { type: 'candidate-pair', id: 'chosen', currentRoundTripTime: 0.02 }, { type: 'candidate-pair', id: 'other', currentRoundTripTime: 9 }),
      report({ type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.04 }),
    ]).roundTripMs).toBe(30);
  });
  it('uses remote RTCP RTT only when no selected ICE RTT is available', () => {
    expect(summarizeNetworkReports([report(
      { type: 'candidate-pair', nominated: true, state: 'failed', currentRoundTripTime: 5 },
      { type: 'remote-inbound-rtp', kind: 'audio', roundTripTime: 0.012 },
    )]).roundTripMs).toBe(12);
  });
  it('calculates weighted audio packet loss across transports without including video', () => {
    expect(summarizeNetworkReports([
      report({ type: 'inbound-rtp', kind: 'audio', packetsReceived: 90, packetsLost: 10 }),
      [{ type: 'remote-inbound-rtp', mediaType: 'audio', packetsReceived: 900, packetsLost: 0 }, { type: 'inbound-rtp', kind: 'video', packetsReceived: 0, packetsLost: 900 }],
    ])).toMatchObject({ packetLossPercent: 1, packetsReceived: 990, packetsLost: 10 });
  });
  it('keeps missing RTT and idle loss unavailable instead of reporting healthy zeros', () => {
    for (const rows of [[], [{ type: 'candidate-pair', selected: true, currentRoundTripTime: null }], [{ type: 'inbound-rtp', kind: 'audio', packetsReceived: 0, packetsLost: 0 }]]) {
      expect(summarizeNetworkReports([rows])).toMatchObject({ roundTripMs: null, packetLossPercent: null });
    }
    expect(summarizeNetworkReports([[{ type: 'inbound-rtp', kind: 'audio', packetsReceived: 100, packetsLost: -1 }]])).toMatchObject({ packetLossPercent: 0 });
  });
});
