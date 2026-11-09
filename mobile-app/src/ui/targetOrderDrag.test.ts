import { describe, expect, it } from 'vitest';
import { targetOrderDropIndex, targetOrderScrollStep } from './targetOrderDrag';

const rows = [{ y: 0, height: 60 }, { y: 60, height: 100 }, { y: 160, height: 60 }];

describe('target drag positions', () => {
  it('crosses the other rows at their midpoints, including differently sized rows', () => {
    expect(targetOrderDropIndex(rows, 0, 109)).toBe(0);
    expect(targetOrderDropIndex(rows, 0, 111)).toBe(1);
    expect(targetOrderDropIndex(rows, 0, 191)).toBe(2);
    expect(targetOrderDropIndex(rows, 2, 29)).toBe(0);
    expect(targetOrderDropIndex(rows, 2, 31)).toBe(1);
  });

  it('supports dropping at both ends without losing an item', () => {
    expect(targetOrderDropIndex(rows, 1, -500)).toBe(0);
    expect(targetOrderDropIndex(rows, 1, 1000)).toBe(2);
    expect(targetOrderDropIndex(rows, 1, 110)).toBe(1);
  });

  it('scrolls only near the measured viewport edges and bounds the speed', () => {
    expect(targetOrderScrollStep(400, 200, 400)).toBe(0);
    expect(targetOrderScrollStep(230, 200, 400)).toBeLessThan(0);
    expect(targetOrderScrollStep(570, 200, 400)).toBeGreaterThan(0);
    expect(targetOrderScrollStep(-100, 200, 400)).toBe(-14);
    expect(targetOrderScrollStep(1000, 200, 400)).toBe(14);
    expect(targetOrderScrollStep(0, 0, 0)).toBe(0);
  });
});
