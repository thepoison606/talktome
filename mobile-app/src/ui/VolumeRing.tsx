import { useEffect, useRef } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { VOLUME_METER_TICKS, formatLinearLevelDbShort, volumeMeterFill } from '../protocol';
import { SpeakerIcon } from './icons';
import { colors } from './theme';
import { createVolumeHoldGesture, type VolumePoint } from './volumeHoldGesture';

const START_DEG = 218;
const SWEEP_DEG = 284;

type Props = {
  level: number;
  muted?: boolean;
  dimmed?: boolean;
  compact?: boolean;
  variant?: 'ring' | 'readout';
  accessibilityLabel: string;
  onPress?: () => void;
  onDoublePress?: () => void;
  onAdjustBegin?: (point: VolumePoint) => boolean;
  onAdjustMove?: (point: VolumePoint) => void;
  onAdjustEnd?: () => void;
};

export function VolumeRing({
  level,
  muted = false,
  dimmed = false,
  compact = false,
  variant = 'ring',
  accessibilityLabel,
  onPress,
  onDoublePress,
  onAdjustBegin, onAdjustMove, onAdjustEnd,
}: Props) {
  const gesture = useRef(createVolumeHoldGesture()).current;
  const callbacks = useRef({ onPress, onDoublePress, onAdjustBegin, onAdjustMove, onAdjustEnd });
  callbacks.current = { onPress, onDoublePress, onAdjustBegin, onAdjustMove, onAdjustEnd };
  const size = compact ? 44 : 52;
  const filled = muted ? 0 : Math.round(volumeMeterFill(level) * VOLUME_METER_TICKS);
  const accent = muted ? colors.danger : dimmed ? 'rgba(255,255,255,0.38)' : colors.accent;
  const track = muted ? 'rgba(255,140,140,0.28)' : 'rgba(255,255,255,0.16)';
  const label = muted ? null : formatLinearLevelDbShort(level);
  const readout = variant === 'readout';

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') gesture.cancel(); });
    return () => { sub.remove(); gesture.cancel(); };
  }, [gesture]);

  const face = readout ? (
    <View
      pointerEvents="none"
      style={[styles.readout, muted && styles.readoutMuted, dimmed && styles.readoutDimmed]}
    >
      {muted ? (
        <SpeakerIcon muted color={colors.danger} size={14} />
      ) : (
        <Text style={[styles.readoutValue, dimmed && styles.dimText]}>
          {label}
          <Text style={[styles.readoutUnit, dimmed && styles.dimText]}> dB</Text>
        </Text>
      )}
    </View>
  ) : (
    <>
      {Array.from({ length: VOLUME_METER_TICKS }, (_, index) => (
        <View
          key={index}
          pointerEvents="none"
          style={[
            styles.spoke,
            {
              width: size,
              height: size,
              transform: [{ rotate: `${START_DEG + (index / (VOLUME_METER_TICKS - 1)) * SWEEP_DEG}deg` }],
            },
          ]}
        >
          <View
            style={[
              styles.tick,
              {
                backgroundColor: index < filled ? accent : track,
                height: size * 0.12,
              },
            ]}
          />
        </View>
      ))}
      <View pointerEvents="none" style={styles.label}>
        {muted ? (
          <SpeakerIcon muted color={colors.danger} size={compact ? 14 : 16} />
        ) : (
          <>
            <Text style={[styles.value, dimmed && styles.dimText, compact && styles.valueCompact]}>{label}</Text>
            <Text style={[styles.unit, dimmed && styles.dimText]}>dB</Text>
          </>
        )}
      </View>
    </>
  );

  const box = readout ? styles.readoutHit : [styles.hit, { width: size, height: size }];

  if (!onPress && !onDoublePress) {
    return <View style={box}>{face}</View>;
  }

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={onAdjustBegin ? 'Tap for volume controls, double tap to mute, or hold and slide up or down to adjust' : onDoublePress ? 'Double tap to mute or unmute' : undefined}
      onAccessibilityTap={onPress}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => !gesture.isAdjusting()}
      onResponderGrant={event => gesture.start(event.nativeEvent, {
        onTap: () => callbacks.current.onPress?.(),
        onDoubleTap: onDoublePress ? () => callbacks.current.onDoublePress?.() : undefined,
        onBegin: onAdjustBegin ? point => callbacks.current.onAdjustBegin?.(point) ?? false : undefined,
        onMove: point => callbacks.current.onAdjustMove?.(point),
        onEnd: () => callbacks.current.onAdjustEnd?.(),
      })}
      onResponderMove={event => event.nativeEvent.changedTouches.forEach(touch => gesture.move(touch))}
      onResponderRelease={event => { gesture.move(event.nativeEvent); gesture.end(event.nativeEvent.identifier); }}
      onResponderTerminate={() => gesture.cancel()}
      hitSlop={6}
      style={box}
    >
      {face}
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spoke: {
    position: 'absolute',
    alignItems: 'center',
  },
  tick: {
    width: 2.5,
    borderRadius: 1.5,
  },
  label: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    lineHeight: 14,
  },
  valueCompact: {
    fontSize: 11,
    lineHeight: 13,
  },
  unit: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: '600',
    marginTop: -1,
  },
  dimText: {
    color: 'rgba(255,255,255,0.45)',
  },
  readoutHit: {
    minWidth: 44,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readout: {
    minWidth: 44,
    minHeight: 28,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  readoutMuted: {
    backgroundColor: 'rgba(255,90,90,0.16)',
  },
  readoutDimmed: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  readoutValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  readoutUnit: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '600',
  },
});
