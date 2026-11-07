export type TargetRowLayout = { y: number; height: number };

/** Insertion index after removing the dragged row, matching the browser's midpoint rule. */
export function targetOrderDropIndex(rows: readonly TargetRowLayout[], source: number, centerY: number): number {
  const others = rows.filter((_, index) => index !== source);
  const before = others.findIndex(row => centerY < row.y + row.height / 2);
  return before < 0 ? others.length : before;
}

/** Pixels per scroll tick; the speed increases towards either viewport edge. */
export function targetOrderScrollStep(pageY: number, viewportTop: number, viewportHeight: number): number {
  if (viewportHeight <= 0) return 0;
  const edge = Math.min(64, viewportHeight / 3);
  if (pageY < viewportTop + edge) return -14 * Math.min(1, (viewportTop + edge - pageY) / edge);
  if (pageY > viewportTop + viewportHeight - edge) {
    return 14 * Math.min(1, (pageY - viewportTop - viewportHeight + edge) / edge);
  }
  return 0;
}
