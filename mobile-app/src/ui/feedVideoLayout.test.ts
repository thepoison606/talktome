import { describe, expect, it } from 'vitest';
import type { TalkTarget } from '../protocol';
import { operatorLayout } from './layers';
import { feedVideoHeight, feedVideoLayers } from './feedVideoLayout';
const targets: TalkTarget[] = Array.from({ length: 8 }, (_, i) => ({ type: 'feed', id: i + 1, label: `Feed ${i}`, canTalk: false }));
describe('inline video layers', () => {
  it('retains normal page capacity while video is collapsed', () => {
    const layout = operatorLayout({ width: 390, height: 844, availableHeight: 590 });
    expect(feedVideoLayers(targets, layout, new Set(), 590, 180)).toHaveLength(1);
  });
  it('moves complete rows to another layer without clipping or shrinking controls', () => {
    const layout = operatorLayout({ width: 390, height: 844, availableHeight: 590 });
    const pages = feedVideoLayers(targets, layout, new Set(['feed-1', 'feed-4']), 590, 180);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page.reduce((n, row) => n + row.height, 0) + (page.length - 1) * layout.gap).toBeLessThanOrEqual(590);
    expect(pages.flat().flatMap(row => row.targets)).toEqual(targets);
    expect(pages[0]![0]!.height).toBe(layout.cardHeight + 180);
  });
  it('keeps an expanded feed in its own tablet column', () => {
    const layout = operatorLayout({ width: 1200, height: 800, availableHeight: 540 });
    const pages = feedVideoLayers(targets, layout, new Set(['feed-2']), 540, 180);
    expect(layout.columns).toBe(3); expect(pages[0]![0]!.targets).toEqual(targets.slice(0, 3));
    expect(pages[0]![0]!.height).toBe(layout.cardHeight + 180);
  });
  it('caps video height for short landscape screens while preserving the controls', () => {
    expect(feedVideoHeight(150, 390, 110, 60)).toBe(50);
    expect(feedVideoHeight(1000, 1000, 700, 72)).toBe(260);
  });
  it('uses spare landscape height for four targets without losing either target row', () => {
    const layout = operatorLayout({ width: 844, height: 390, availableHeight: 300 });
    const videoHeight = feedVideoHeight(310, 390, 300, layout.cardHeight, 2, layout.gap);
    expect(videoHeight).toBeGreaterThan(390 * 0.30);
    const pages = feedVideoLayers(targets.slice(0, 4), layout, new Set(['feed-2']), 300, videoHeight);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(2);
    expect(pages[0]!.reduce((sum, row) => sum + row.height, layout.gap)).toBeLessThanOrEqual(300);
  });
});
