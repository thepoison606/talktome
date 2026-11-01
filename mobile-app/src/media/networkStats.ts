export type MediaNetworkStats = {
  roundTripMs: number | null;
  packetLossPercent: number | null;
  packetsReceived?: number;
  packetsLost?: number;
};

type Stat = Record<string, unknown>;
function rows(report: unknown): Stat[] {
  const result: Stat[] = [];
  if (report && typeof (report as Map<string, Stat>).forEach === 'function') {
    (report as Map<string, Stat>).forEach(value => { if (value && typeof value === 'object') result.push(value); });
  }
  return result;
}
function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function summarizeNetworkReports(reports: unknown[]): MediaNetworkStats {
  const rtts: number[] = [];
  let received = 0, lost = 0, packetReports = 0;
  for (const report of reports) {
    const stats = rows(report);
    const selected = new Set(stats.filter(s => s.type === 'transport').map(s => s.selectedCandidatePairId));
    let hasCandidateRtt = false;
    for (const stat of stats) {
      if (stat.type === 'candidate-pair' && (selected.has(stat.id) || stat.selected === true || (stat.nominated === true && stat.state === 'succeeded'))) {
        const rtt = numeric(stat.currentRoundTripTime);
        if (rtt !== null && rtt >= 0 && rtt <= 60) { rtts.push(rtt * 1000); hasCandidateRtt = true; }
      }
      if (!['inbound-rtp', 'remote-inbound-rtp'].includes(String(stat.type)) || (stat.kind !== 'audio' && stat.mediaType !== 'audio')) continue;
      const packetsReceived = numeric(stat.packetsReceived), packetsLost = numeric(stat.packetsLost);
      if (packetsReceived !== null && packetsReceived >= 0 && packetsLost !== null) {
        received += packetsReceived; lost += Math.max(0, packetsLost); packetReports++;
      }
    }
    if (!hasCandidateRtt) {
      for (const stat of stats) {
        if (stat.type !== 'remote-inbound-rtp' || (stat.kind !== 'audio' && stat.mediaType !== 'audio')) continue;
        const rtt = numeric(stat.roundTripTime);
        if (rtt !== null && rtt >= 0 && rtt <= 60) rtts.push(rtt * 1000);
      }
    }
  }
  return {
    roundTripMs: rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : null,
    packetLossPercent: packetReports && received + lost > 0 ? Math.round(1000 * lost / (received + lost)) / 10 : null,
    ...(packetReports ? { packetsReceived: received, packetsLost: lost } : {}),
  };
}
