import { volumeFromMeterFill, volumeMeterFill } from '../protocol/audioPreference';

export const VOLUME_DOUBLE_TAP_MS = 280;
export const VOLUME_HOLD_MS = 320;
export const VOLUME_HOLD_SLOP = 8;
export const VOLUME_DRAG_RANGE = 220;

export type VolumePoint = { pageX: number; pageY: number; identifier: number | string };
export type VolumeHoldOptions = {
  onTap?: () => void;
  onDoubleTap?: () => void;
  onBegin?: (point: VolumePoint) => boolean;
  onMove?: (point: VolumePoint) => void;
  onEnd?: () => void;
};

/** The same touch owns tap, double tap and hold, so a hold never also mutes/opens a sheet. */
export function createVolumeHoldGesture() {
  let options: VolumeHoldOptions = {};
  let start: VolumePoint | null = null;
  let held = false;
  let cancelled = false;
  let secondTap = false;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let tapTimer: ReturnType<typeof setTimeout> | null = null;
  const clearHold = () => { if (holdTimer) clearTimeout(holdTimer); holdTimer = null; };
  const clearTap = () => { if (tapTimer) clearTimeout(tapTimer); tapTimer = null; };
  const cancel = () => {
    clearHold(); clearTap();
    if (held) options.onEnd?.();
    start = null; held = false; cancelled = false; secondTap = false;
  };
  return {
    start(point: VolumePoint, next: VolumeHoldOptions) {
      if (start) return;
      secondTap = tapTimer != null;
      clearTap(); options = next; start = { ...point }; cancelled = false;
      if (options.onBegin) holdTimer = setTimeout(() => {
        holdTimer = null;
        if (start && !cancelled) {
          held = options.onBegin!(start);
          if (!held) cancelled = true;
        }
      }, VOLUME_HOLD_MS);
    },
    move(point: VolumePoint) {
      if (!start || point.identifier !== start.identifier) return;
      if (held) options.onMove?.(point);
      else if (Math.hypot(point.pageX - start.pageX, point.pageY - start.pageY) > VOLUME_HOLD_SLOP) {
        cancelled = true; clearHold();
      }
    },
    end(identifier: number | string) {
      if (!start || identifier !== start.identifier) return;
      clearHold(); start = null;
      if (held) { held = false; options.onEnd?.(); }
      else if (!cancelled) {
        if (secondTap && options.onDoubleTap) options.onDoubleTap();
        else if (options.onDoubleTap) {
          const tap = options.onTap;
          tapTimer = setTimeout(() => { tapTimer = null; tap?.(); }, VOLUME_DOUBLE_TAP_MS);
        } else options.onTap?.();
      }
      cancelled = false; secondTap = false;
    },
    cancel,
    isAdjusting: () => held,
  };
}

/** Anchor in meter space, retaining the exact original value until the finger moves. */
export function relativeVolume(level: number, originY: number, fingerY: number) {
  if (fingerY === originY) return level;
  return volumeFromMeterFill(volumeMeterFill(level) + (originY - fingerY) / VOLUME_DRAG_RANGE);
}
