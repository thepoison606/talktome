import type { TalkTarget } from '../protocol';
import { talkTargetIdentity } from '../protocol';
import { chunkTargets, type OperatorLayout } from './layers';

export type VideoTargetRow = { targets: TalkTarget[]; height: number };

/** Pack complete rows into layers. Expanded video never squeezes the audio controls. */
export function feedVideoLayers(targets: TalkTarget[], layout: OperatorLayout,
  expanded: ReadonlySet<string>, availableHeight: number, videoHeight: number): VideoTargetRow[][] {
  const pages: VideoTargetRow[][] = [[]];
  let used = 0;
  for (const row of chunkTargets(targets, layout.columns)) {
    const hasVideo = row.some(target => target.type === 'feed' && expanded.has(talkTargetIdentity(target)));
    const height = layout.cardHeight + (hasVideo ? videoHeight : 0);
    let page = pages[pages.length - 1]!;
    const gap = page.length ? layout.gap : 0;
    if (page.length && (page.length >= layout.rows || used + gap + height > availableHeight + 0.5)) {
      page = []; pages.push(page); used = 0;
    }
    used += (page.length ? layout.gap : 0) + height;
    page.push({ targets: row, height });
  }
  return pages;
}

export function feedVideoHeight(cellWidth: number, screenHeight: number, availableHeight: number, cardHeight: number,
  landscapeRows = 0, gap = 0): number {
  const natural = cellWidth * 9 / 16 + 4;
  const normal = Math.max(0, Math.min(260, screenHeight * 0.30, natural, availableHeight - cardHeight));
  if (landscapeRows <= 0) return normal;
  // Use spare height above a short landscape grid while retaining every row
  // and its full controls, rather than limiting the picture to 30% of the screen.
  const spare = availableHeight - landscapeRows * cardHeight - (landscapeRows - 1) * gap;
  return Math.max(normal, Math.min(260, natural, spare));
}
