import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CARD_MAX_HEIGHT,
  CARD_MIN_HEIGHT,
  CARD_PREFERRED_HEIGHT,
  COLLAPSED_HEADER_HEIGHT,
  HEADER_PEEK_CARD_HEIGHT,
  chunkTargets,
  estimateTargetListHeight,
  isCompactOperatorScreen,
  isTabletOperatorScreen,
  operatorLayout,
  operatorViewport,
  replyBesideTargets,
  shouldOfferHeaderCollapse,
  targetGridColumns,
  targetLayerCount,
  targetLayerSize,
  visibleTargets,
} from './layers';

describe('target layers', () => {
  it('fits 8 portrait rows on an iPhone-sized screen', () => {
    const layout = operatorLayout({ width: 390, height: 844 });
    expect(layout.columns).toBe(1);
    expect(layout.rows).toBe(8);
    expect(layout.layerSize).toBe(8);
    expect(layout.cardHeight).toBeGreaterThanOrEqual(CARD_MIN_HEIGHT);
    expect(layout.cardHeight).toBeLessThanOrEqual(CARD_MAX_HEIGHT);
    expect(targetLayerCount(9, 390, 844)).toBe(2);
    expect(visibleTargets(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], 1, 390, 844)).toEqual(['i']);
  });

  it('uses two landscape columns and a narrower row cap', () => {
    const layout = operatorLayout({ width: 844, height: 390 });
    expect(layout.landscape).toBe(true);
    expect(layout.tablet).toBe(false);
    expect(layout.replyBeside).toBe(true);
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(4);
    expect(layout.layerSize).toBe(8);
    expect(targetLayerCount(9, 844, 390)).toBe(2);
    expect(replyBesideTargets(844, 390)).toBe(true);
  });

  it('keeps Reply at the bottom when a portrait transition reports a short frame', () => {
    const portrait = { width: 430, height: 932 };
    const clipped = { width: 430, height: 320 };
    expect(operatorLayout(operatorViewport(portrait, clipped))).toMatchObject({
      replyBeside: false, columns: 1,
    });
    const landscape = { width: 932, height: 430 };
    expect(operatorLayout(operatorViewport(landscape, clipped))).toMatchObject({
      replyBeside: true, columns: 2,
    });
    const settled = { width: 430, height: 839 };
    expect(operatorViewport(portrait, settled)).toEqual(settled);
  });

  it('pages sooner on a short screen instead of scrolling', () => {
    const layout = operatorLayout({ width: 320, height: 534 });
    expect(layout.rows).toBeLessThan(8);
    expect(layout.layerSize).toBe(layout.rows);
    expect(targetLayerCount(8, 320, 534)).toBeGreaterThan(1);
  });

  it('fits more rows when the measured list is taller', () => {
    const cramped = operatorLayout({ width: 320, height: 534, availableHeight: 248 });
    const roomy = operatorLayout({ width: 320, height: 534, availableHeight: 390 });
    expect(cramped.rows).toBeLessThanOrEqual(4);
    expect(roomy.rows).toBeGreaterThan(cramped.rows);
  });

  it('compresses cards slightly in a realistic iPhone list height', () => {
    const layout = operatorLayout({ width: 390, height: 844, availableHeight: 575 });
    expect(layout.rows).toBe(8);
    expect(layout.cardHeight).toBeGreaterThanOrEqual(64);
    expect(layout.cardHeight).toBeLessThanOrEqual(CARD_PREFERRED_HEIGHT);
  });

  it('clamps card height so leftover space can sit above the list', () => {
    const layout = operatorLayout({ width: 390, height: 844, availableHeight: 800 });
    expect(layout.rows).toBe(8);
    expect(layout.cardHeight).toBe(CARD_MAX_HEIGHT);
  });

  it('hides paging when everything fits', () => {
    expect(targetLayerCount(7, 390, 844)).toBe(1);
    expect(visibleTargets([1, 2, 3], 0, 390, 844)).toEqual([1, 2, 3]);
  });

  it('chunks a page into landscape columns', () => {
    expect(chunkTargets(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('offers header collapse on small pages or when hiding chrome adds a row', () => {
    expect(
      shouldOfferHeaderCollapse({ rows: 4, availableHeight: 248, headerHeight: 96, maxRows: 8 }),
    ).toBe(true);
    expect(
      shouldOfferHeaderCollapse({ rows: 5, availableHeight: 326, headerHeight: 96, maxRows: 8 }),
    ).toBe(true);
    expect(
      shouldOfferHeaderCollapse({ rows: 8, availableHeight: 636, headerHeight: 96, maxRows: 8 }),
    ).toBe(false);
  });

  it('treats RG440-class short sides as compact and iPhone 390 as not', () => {
    expect(isCompactOperatorScreen(320, 533)).toBe(true);
    expect(isCompactOperatorScreen(533, 320)).toBe(true);
    expect(isCompactOperatorScreen(390, 844)).toBe(false);
    expect(isCompactOperatorScreen(844, 390)).toBe(false);
  });

  it('reserves a 28px full-width bar for the collapsed header', () => {
    expect(HEADER_PEEK_CARD_HEIGHT).toBe(56);
    expect(COLLAPSED_HEADER_HEIGHT).toBe(28);
    const expanded = estimateTargetListHeight(320, 534, false);
    const collapsed = estimateTargetListHeight(320, 534, true);
    expect(collapsed - expanded).toBe(96 - COLLAPSED_HEADER_HEIGHT);
  });

  it('always offers header collapse on compact screens', () => {
    expect(
      shouldOfferHeaderCollapse({
        rows: 8,
        availableHeight: 200,
        headerHeight: 44,
        maxRows: 8,
        compact: true,
      }),
    ).toBe(true);
    expect(
      shouldOfferHeaderCollapse({
        rows: 2,
        availableHeight: 160,
        headerHeight: 48,
        maxRows: 8,
        compact: true,
      }),
    ).toBe(true);
  });

  it('still hides collapse on a full iPhone page when recovered height is tiny', () => {
    expect(
      shouldOfferHeaderCollapse({ rows: 8, availableHeight: 636, headerHeight: 48, maxRows: 8 }),
    ).toBe(false);
  });

  it('keeps the iPhone portrait layer size helper at 8', () => {
    expect(targetLayerSize(390, 844)).toBe(8);
  });
});

describe('tablet operator layout', () => {
  it('treats iPad-class short sides as tablets and phone landscape as not', () => {
    expect(isTabletOperatorScreen(820, 1180)).toBe(true);
    expect(isTabletOperatorScreen(1180, 820)).toBe(true);
    expect(isTabletOperatorScreen(744, 1133)).toBe(true);
    expect(isTabletOperatorScreen(600, 960)).toBe(true);
    expect(isTabletOperatorScreen(390, 844)).toBe(false);
    expect(isTabletOperatorScreen(844, 390)).toBe(false);
    expect(isTabletOperatorScreen(320, 533)).toBe(false);
  });

  it('keeps Reply on the bottom of tablet screens', () => {
    expect(replyBesideTargets(820, 1180)).toBe(false);
    expect(replyBesideTargets(1180, 820)).toBe(false);
    expect(replyBesideTargets(1440, 900)).toBe(false);
    const portrait = operatorLayout({ width: 820, height: 1180 });
    const landscape = operatorLayout({ width: 1180, height: 820 });
    expect(portrait.replyBeside).toBe(false);
    expect(landscape.replyBeside).toBe(false);
    expect(landscape.maxRows).toBe(8);
  });

  it('uses two columns on iPad-class portrait, like the web 700–899 band', () => {
    expect(targetGridColumns(744, 1133)).toBe(2);
    expect(targetGridColumns(820, 1180)).toBe(2);
    const layout = operatorLayout({ width: 820, height: 1180 });
    expect(layout.columns).toBe(2);
    expect(layout.layerSize).toBe(layout.rows * 2);
  });

  it('uses three columns on typical tablet landscape', () => {
    expect(targetGridColumns(1024, 768)).toBe(3);
    expect(targetGridColumns(1180, 820)).toBe(3);
    expect(targetGridColumns(1366, 1024)).toBe(3);
    const layout = operatorLayout({ width: 1180, height: 820 });
    expect(layout.columns).toBe(3);
    expect(layout.rows).toBe(8);
    expect(layout.layerSize).toBe(24);
  });

  it('uses four columns on wide tablets', () => {
    expect(targetGridColumns(1367, 900)).toBe(4);
    expect(targetGridColumns(1440, 900)).toBe(4);
    const layout = operatorLayout({ width: 1440, height: 900 });
    expect(layout.columns).toBe(4);
    expect(layout.replyBeside).toBe(false);
    expect(layout.layerSize).toBe(layout.rows * 4);
  });

  it('fills a page row-major, same order as the web CSS grid', () => {
    expect(chunkTargets(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 3)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['g', 'h'],
    ]);
    expect(chunkTargets(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 4)).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e', 'f', 'g', 'h'],
    ]);
    expect(visibleTargets(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], 0, 1180, 820).slice(0, 3)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps tablet Reply in the bottom bar instead of a landscape side column', () => {
    const operator = readFileSync(resolve(__dirname, 'OperatorScreen.tsx'), 'utf8');
    expect(operator).toContain('replyBeside && styles.bodyLandscape');
    expect(operator).toContain('replyBeside && styles.replyLandscape');
    expect(operator).not.toContain('landscape && styles.bodyLandscape');
    expect(operator).toContain('tablet && styles.screenTablet');
    expect(operator).toContain('event.nativeEvent.layout');
    expect(operator).toContain('styles.headerPeekCard');
    expect(operator).toContain('headerCollapsed && styles.screenPeek');
    expect(operator).toContain('borderTopWidth: 0');
    expect(operator).not.toContain('styles.collapsedHeader');
    expect(operator).not.toContain('styles.collapsedIdentity');
    expect(operator).not.toContain('styles.headerPeekClip');
  });
});
