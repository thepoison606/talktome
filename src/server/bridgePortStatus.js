const VIRTUAL_NONE = 'bridge:none';
function sanitizePortReport(value = {}) {
  const meter = raw => ({
    rmsDb: Number.isFinite(raw?.rmsDb) ? Math.max(-120, Math.min(40, raw.rmsDb)) : -120,
    peakDb: Number.isFinite(raw?.peakDb) ? Math.max(-120, Math.min(40, raw.peakDb)) : -120,
  });
  return { error: String(value.error || '').slice(0, 1000), state: String(value.state || '').slice(0, 80),
    input: meter(value.input), output: meter(value.output) };
}
function endpointIssues(row, bridge, kind) {
  if (!bridge || bridge.stale) return [];
  const issues = [];
  for (const direction of kind === 'feed' ? ['input'] : ['input', 'output']) {
    const id = row[`bridge_${direction}_device`];
    if (id === VIRTUAL_NONE || (!id && (direction === 'output' || row.bridge_video_source))) continue;
    const device = (bridge.inventory?.devices || []).find(d => d.direction === direction && d.id === id);
    const left = Number(row[`bridge_${direction}_left_channel`]);
    const right = Number(row[`bridge_${direction}_right_channel`]);
    if (!device || !Number.isInteger(left) || !Number.isInteger(right) || Math.min(left, right) < 1
      || Number(device.max_channels ?? device.maxChannels ?? 0) < Math.max(left, right)) issues.push(`${direction} device missing`);
  }
  return issues;
}
module.exports = { VIRTUAL_NONE, sanitizePortReport, endpointIssues };
