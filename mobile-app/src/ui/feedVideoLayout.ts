import type { TalkTarget } from '../protocol';
import { talkTargetIdentity } from '../protocol';
import { chunkTargets, type OperatorLayout } from './layers';

export type VideoTargetRow = { targets: TalkTarget[]; height: number; videoHeight: number };

/** Pack complete rows into layers. Expanded video never squeezes the audio controls. */
export function feedVideoLayers(targets: TalkTarget[], layout: OperatorLayout,
  expanded: ReadonlySet<string>, availableHeight: number, videoHeight: number,
  maxVideoHeight = videoHeight): VideoTargetRow[][] {
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
    page.push({ targets: row, height, videoHeight: hasVideo ? videoHeight : 0 });
  }
  // Pack all full target rows first, then give the remaining landscape space to
  // the pictures on each page. Growing a picture must not push another row out.
  if (layout.landscape && maxVideoHeight > videoHeight) {
    for (const page of pages) {
      const videos = page.filter(row => row.videoHeight > 0);
      if (!videos.length) continue;
      const usedHeight = page.reduce((sum, row) => sum + row.height, 0) + (page.length - 1) * layout.gap;
      const extra = Math.max(0, Math.min(maxVideoHeight - videoHeight,
        (availableHeight - usedHeight) / videos.length));
      for (const row of videos) { row.height += extra; row.videoHeight += extra; }
    }
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
