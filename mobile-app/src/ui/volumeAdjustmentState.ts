import { create } from 'zustand';

import { relativeVolume, type VolumePoint } from './volumeHoldGesture';

type Adjustment = {
  key: string;
  title: string;
  level: number;
  muted: boolean;
  origin: VolumePoint;
  fingerY: number;
  onChange: (level: number) => void;
};

/** Ephemeral gesture state only; the usual session volume path owns persistence and audio. */
export const useVolumeAdjustment = create<{ active: Adjustment | null }>(() => ({ active: null }));

export function beginVolumeAdjustment(adjustment: Omit<Adjustment, 'fingerY'>) {
  if (useVolumeAdjustment.getState().active) return false;
  useVolumeAdjustment.setState({ active: { ...adjustment, fingerY: adjustment.origin.pageY } });
  return true;
}

export function moveVolumeAdjustment(key: string, point: VolumePoint) {
  const active = useVolumeAdjustment.getState().active;
  if (!active || active.key !== key || point.identifier !== active.origin.identifier) return;
  const level = relativeVolume(active.level, active.origin.pageY, point.pageY);
  // Keep the original anchor throughout, including at either limit: no drift or jumps.
  useVolumeAdjustment.setState({ active: { ...active, fingerY: point.pageY } });
  active.onChange(level);
}

export function endVolumeAdjustment(key?: string) {
  const active = useVolumeAdjustment.getState().active;
  if (active && (key == null || active.key === key)) useVolumeAdjustment.setState({ active: null });
}
