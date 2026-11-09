import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { formatLinearLevelDb, volumeMeterFill } from '../protocol';
import { endVolumeAdjustment, useVolumeAdjustment } from './volumeAdjustmentState';
import { relativeVolume, VOLUME_DRAG_RANGE } from './volumeHoldGesture';
import { colors } from './theme';

export function VolumeAdjustmentHUD() {
  const active = useVolumeAdjustment(state => state.active);
  const root = useRef<View>(null);
  const [bounds, setBounds] = useState({ x: 0, y: 0, width: 0, height: 0 });
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') endVolumeAdjustment();
    });
    return () => { sub.remove(); endVolumeAdjustment(); };
  }, []);
  useEffect(() => {
    if (active) root.current?.measureInWindow((x, y, width, height) => setBounds({ x, y, width, height }));
  }, [active?.key]);

  const width = 88;
  const x = active ? active.origin.pageX - bounds.x : 0;
  const y = active ? active.origin.pageY - bounds.y : 0;
  // Keep the fader off the thumb; prefer the side with more free space.
  const left = x > bounds.width / 2 ? Math.max(8, x - width - 38) : Math.min(bounds.width - width - 8, x + 38);
  const level = active ? relativeVolume(active.level, active.origin.pageY, active.fingerY) : 0;
  // The rail is translated to put the current-value handle exactly at finger height.
  // Crop its ends at screen edges rather than relocating the handle or changing gain.
  const virtualTop = y - (1 - volumeMeterFill(active?.level ?? 0)) * VOLUME_DRAG_RANGE;
  const top = Math.max(12, virtualTop);
  const bottom = Math.min(bounds.height - 12, virtualTop + VOLUME_DRAG_RANGE);
  const thumbY = Math.max(top, Math.min(bottom, y + (active ? active.fingerY - active.origin.pageY : 0)));
  const labelTop = y > 90 ? Math.max(8, Math.min(top - 64, y - 64)) : Math.min(bounds.height - 64, Math.max(bottom + 10, y + 28));
  return (
    <View ref={root} collapsable={false} pointerEvents="none" style={styles.root}
      onLayout={() => root.current?.measureInWindow((x, y, width, height) => setBounds({ x, y, width, height }))}>
      {active && bounds.width > 0 ? <>
        <View style={[styles.readout, { left, top: labelTop, width }]}>
          <Text style={styles.title} numberOfLines={1}>{active.title}</Text>
          <Text style={styles.value}>{formatLinearLevelDb(level)}</Text>
          {active.muted ? <Text style={styles.muted}>Muted</Text> : null}
        </View>
        <View style={[styles.railPlate, { left: left + width / 2 - 15, top: top - 10, height: Math.max(20, bottom - top + 20) }]} />
        <View style={[styles.rail, { left: left + width / 2 - 2, top, height: Math.max(0, bottom - top) }]} />
        <View style={[styles.fill, { left: left + width / 2 - 2, top: thumbY, height: Math.max(0, bottom - thumbY) }]} />
        <View style={[styles.origin, { left: left + width / 2 - 9, top: y - 1 }]} />
        <View style={[styles.thumb, { left: left + width / 2 - 14, top: thumbY - 5 }]} />
      </> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, zIndex: 100, elevation: 100 },
  readout: { position: 'absolute', paddingVertical: 8, paddingHorizontal: 5, borderRadius: 12, backgroundColor: '#10283b', borderWidth: 1, borderColor: colors.accent, alignItems: 'center' },
  title: { color: colors.muted, fontSize: 10, fontWeight: '600' },
  value: { color: colors.text, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  muted: { color: colors.danger, fontSize: 10 },
  railPlate: { position: 'absolute', width: 30, borderRadius: 15, backgroundColor: '#10283b', borderWidth: 1, borderColor: 'rgba(61,214,245,0.35)' },
  rail: { position: 'absolute', width: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.24)' },
  fill: { position: 'absolute', width: 4, borderRadius: 2, backgroundColor: colors.accent },
  origin: { position: 'absolute', width: 18, height: 2, backgroundColor: 'rgba(255,255,255,0.4)' },
  thumb: { position: 'absolute', width: 28, height: 10, borderRadius: 5, backgroundColor: colors.text, borderWidth: 1, borderColor: colors.accent },
});
