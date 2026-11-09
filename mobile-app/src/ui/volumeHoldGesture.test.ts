import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dbToLinear, volumeMeterFill } from '../protocol/audioPreference';
import { createVolumeHoldGesture, relativeVolume, VOLUME_HOLD_MS } from './volumeHoldGesture';
import { beginVolumeAdjustment, endVolumeAdjustment, moveVolumeAdjustment, useVolumeAdjustment } from './volumeAdjustmentState';

const point = (pageY = 300, pageX = 240, identifier = 1) => ({ pageY, pageX, identifier });
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); endVolumeAdjustment(); });

describe('volume ring touch ownership', () => {
  it('retains the tap delay and double-tap mute without opening the overlay', () => {
    const g = createVolumeHoldGesture(), onTap = vi.fn(), onDoubleTap = vi.fn(), onBegin = vi.fn(() => true);
    const opts = { onTap, onDoubleTap, onBegin };
    g.start(point(), opts); g.end(1);
    vi.advanceTimersByTime(180);
    expect(onTap).not.toHaveBeenCalled();
    g.start(point(), opts); g.end(1); vi.advanceTimersByTime(400);
    expect(onDoubleTap).toHaveBeenCalledOnce(); expect(onTap).not.toHaveBeenCalled(); expect(onBegin).not.toHaveBeenCalled();
  });
  it('opens the existing overlay after one short tap', () => {
    const g = createVolumeHoldGesture(), onTap = vi.fn();
    g.start(point(), { onTap, onDoubleTap: vi.fn() }); g.end(1);
    vi.advanceTimersByTime(280); expect(onTap).toHaveBeenCalledOnce();
  });
  it('activates while still held and releases without a tap or mute', () => {
    const g = createVolumeHoldGesture(), onTap = vi.fn(), onDoubleTap = vi.fn(), onBegin = vi.fn(() => true), onMove = vi.fn(), onEnd = vi.fn();
    g.start(point(), { onTap, onDoubleTap, onBegin, onMove, onEnd });
    vi.advanceTimersByTime(VOLUME_HOLD_MS - 1); expect(g.isAdjusting()).toBe(false);
    vi.advanceTimersByTime(1); expect(onBegin).toHaveBeenCalledWith(point()); expect(g.isAdjusting()).toBe(true);
    g.move(point(250)); expect(onMove).toHaveBeenCalledWith(point(250));
    g.end(1); vi.advanceTimersByTime(1000);
    expect(onEnd).toHaveBeenCalledOnce(); expect(onTap).not.toHaveBeenCalled(); expect(onDoubleTap).not.toHaveBeenCalled();
  });
  it('movement before activation cancels both hold and accidental tap', () => {
    const g = createVolumeHoldGesture(), onTap = vi.fn(), onBegin = vi.fn(() => true);
    g.start(point(), { onTap, onBegin }); g.move(point(309));
    vi.advanceTimersByTime(1000); g.end(1); expect(onBegin).not.toHaveBeenCalled(); expect(onTap).not.toHaveBeenCalled();
  });
  it('a first tap followed by a hold does not open a sheet during the hold', () => {
    const g = createVolumeHoldGesture(), onTap = vi.fn(), onDoubleTap = vi.fn(), onBegin = vi.fn(() => true);
    const opts = { onTap, onDoubleTap, onBegin };
    g.start(point(), opts); g.end(1); vi.advanceTimersByTime(100);
    g.start(point(), opts); vi.advanceTimersByTime(400); g.end(1); vi.advanceTimersByTime(400);
    expect(onBegin).toHaveBeenCalledOnce(); expect(onTap).not.toHaveBeenCalled(); expect(onDoubleTap).not.toHaveBeenCalled();
  });
  it('ignores unrelated fingers and clears everything on cancellation', () => {
    const g = createVolumeHoldGesture(), onTap = vi.fn(), onBegin = vi.fn(() => true), onMove = vi.fn(), onEnd = vi.fn();
    g.start(point(), { onTap, onBegin, onMove, onEnd }); g.move(point(100, 240, 2)); g.end(2);
    vi.advanceTimersByTime(320); expect(g.isAdjusting()).toBe(true);
    g.move(point(100, 240, 2)); expect(onMove).not.toHaveBeenCalled();
    g.cancel(); g.end(1); vi.runAllTimers(); expect(onEnd).toHaveBeenCalledOnce(); expect(onTap).not.toHaveBeenCalled();
    g.start(point(), { onTap, onDoubleTap: vi.fn() }); g.end(1); g.cancel(); vi.runAllTimers(); expect(onTap).not.toHaveBeenCalled();
  });
});

describe('relative fader', () => {
  it('has no initial jump at any starting value and moves consistently in meter space', () => {
    for (const level of [0, 0.9, dbToLinear(-17), 1]) expect(relativeVolume(level, 300, 300)).toBe(level);
    const initial = dbToLinear(-21);
    expect(volumeMeterFill(relativeVolume(initial, 300, 278))).toBeCloseTo(volumeMeterFill(initial) + 0.1);
    expect(relativeVolume(initial, 300, 330)).toBeLessThan(initial);
    expect(relativeVolume(initial, 300, -1000)).toBe(1);
    expect(relativeVolume(initial, 300, 1000)).toBe(0);
  });
  it('only changes volume when moving, retains the original anchor, and ends without resetting the value', () => {
    const onChange = vi.fn(); const origin = point();
    expect(beginVolumeAdjustment({ key: 'user:1', title: 'Test', level: 0.9, muted: false, origin, onChange })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(beginVolumeAdjustment({ key: 'user:2', title: 'Other', level: 1, muted: false, origin, onChange })).toBe(false);
    moveVolumeAdjustment('user:1', point(340)); moveVolumeAdjustment('user:1', point(320));
    expect(onChange).toHaveBeenLastCalledWith(relativeVolume(0.9, 300, 320));
    moveVolumeAdjustment('user:2', point(200)); expect(onChange).toHaveBeenCalledTimes(2);
    endVolumeAdjustment('user:2'); expect(useVolumeAdjustment.getState().active).not.toBeNull();
    endVolumeAdjustment('user:1'); expect(useVolumeAdjustment.getState().active).toBeNull(); expect(onChange).toHaveBeenCalledTimes(2);
  });
});
