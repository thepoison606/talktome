// Phone portrait aims for 8 target rows plus chrome, matching the web client.
// Cards compress/expand slightly; leftover space sits above the list (bottom-justified).
// Phone landscape uses two columns and a shorter row cap so Reply can sit in a narrow side column.
// Tablets keep Reply on the bottom (like the web client) and use 2–4 columns by width.

export const CARD_GAP = 8;
export const CARD_MIN_HEIGHT = 56;
export const CARD_PREFERRED_HEIGHT = 72;
export const CARD_MAX_HEIGHT = 88;
export const PORTRAIT_MAX_ROWS = 8;
export const LANDSCAPE_MAX_ROWS = 4;
export const LANDSCAPE_COLUMNS = 2;
export const HEADER_COLLAPSE_ROW_THRESHOLD = 4;
/** Target-card minimum. The collapsed header is half of this height. */
export const HEADER_PEEK_CARD_HEIGHT = CARD_MIN_HEIGHT;
/** Collapsed header: a 28px full-width bar (flat top, rounded bottom). */
export const COLLAPSED_HEADER_HEIGHT = HEADER_PEEK_CARD_HEIGHT / 2;
/** Short side at or below this is RG440-class; iPhone 390 stays above it. */
export const COMPACT_SHORT_SIDE_MAX = 360;
/** Android sw600dp / iPad mini. Phone landscape (844×390) stays below this. */
export const TABLET_SHORT_SIDE_MIN = 600;
/** Web `#targets-list` 2-column band (`min-width: 700px` / `max-width: 899px`). */
export const TABLET_TWO_COLUMN_MIN_WIDTH = 700;
/** Web 3-column tablet band (`min-width: 900px`, coarse landscape up to 1366). */
export const TABLET_THREE_COLUMN_MIN_WIDTH = 900;
/** Web 4-column band (`min-width: 1367px`). */
export const TABLET_FOUR_COLUMN_MIN_WIDTH = 1367;
export const TABLET_MAX_COLUMNS = 4;

const ESTIMATED_HEADER_HEIGHT = 96;
const ESTIMATED_REPLY_HEIGHT = 72;
const ESTIMATED_SCREEN_PADDING = 20;

export type OperatorLayoutInput = {
  width: number;
  height: number;
  availableHeight?: number;
  headerCollapsed?: boolean;
};

export type OperatorLayout = {
  landscape: boolean;
  tablet: boolean;
  replyBeside: boolean;
  columns: number;
  rows: number;
  layerSize: number;
  cardHeight: number;
  gap: number;
  maxRows: number;
};

export function isLandscape(width: number, height: number): boolean {
  return width > height;
}

type Viewport = { width: number; height: number };

export function operatorViewport(window: Viewport, measured: Viewport): Viewport {
  // A newly mounted screen can briefly report a clipped frame during a native transition.
  if (measured.width <= 0 || measured.height <= 0 ||
    isLandscape(measured.width, measured.height) !== isLandscape(window.width, window.height)) {
    return window;
  }
  return measured;
}

export function isCompactOperatorScreen(width: number, height: number): boolean {
  return Math.min(width, height) <= COMPACT_SHORT_SIDE_MAX;
}

export function isTabletOperatorScreen(width: number, height: number): boolean {
  return Math.min(width, height) >= TABLET_SHORT_SIDE_MIN;
}

/** Phone landscape only: Reply is a side column. Tablets keep it on the bottom. */
export function replyBesideTargets(width: number, height: number): boolean {
  return isLandscape(width, height) && !isTabletOperatorScreen(width, height);
}

export function targetGridColumns(width: number, height: number): number {
  if (isTabletOperatorScreen(width, height)) {
    if (width >= TABLET_FOUR_COLUMN_MIN_WIDTH) {
      return TABLET_MAX_COLUMNS;
    }
    if (width >= TABLET_THREE_COLUMN_MIN_WIDTH) {
      return 3;
    }
    return 2;
  }
  return isLandscape(width, height) ? LANDSCAPE_COLUMNS : 1;
}

export function targetGridMaxRows(width: number, height: number): number {
  return replyBesideTargets(width, height) ? LANDSCAPE_MAX_ROWS : PORTRAIT_MAX_ROWS;
}

export function estimateTargetListHeight(
  width: number,
  height: number,
  headerCollapsed = false,
): number {
  const header = headerCollapsed ? COLLAPSED_HEADER_HEIGHT : ESTIMATED_HEADER_HEIGHT;
  const reply = replyBesideTargets(width, height) ? 0 : ESTIMATED_REPLY_HEIGHT;
  return Math.max(CARD_MIN_HEIGHT, height - header - reply - ESTIMATED_SCREEN_PADDING);
}

export function rowsThatFit(availableHeight: number, maxRows: number): number {
  const cap = Math.max(1, Math.floor(maxRows));
  if (!(availableHeight > 0)) {
    return 1;
  }
  for (let rows = cap; rows >= 1; rows -= 1) {
    const cardHeight = (availableHeight - (rows - 1) * CARD_GAP) / rows;
    if (cardHeight >= CARD_MIN_HEIGHT) {
      return rows;
    }
  }
  return 1;
}

export function cardHeightForRows(availableHeight: number, rows: number): number {
  const count = Math.max(1, rows);
  const raw = (availableHeight - (count - 1) * CARD_GAP) / count;
  if (!Number.isFinite(raw)) {
    return CARD_PREFERRED_HEIGHT;
  }
  return Math.min(CARD_MAX_HEIGHT, Math.max(CARD_MIN_HEIGHT, raw));
}

export function operatorLayout(input: OperatorLayoutInput): OperatorLayout {
  const landscape = isLandscape(input.width, input.height);
  const tablet = isTabletOperatorScreen(input.width, input.height);
  const replyBeside = replyBesideTargets(input.width, input.height);
  const columns = targetGridColumns(input.width, input.height);
  const maxRows = targetGridMaxRows(input.width, input.height);
  const available =
    input.availableHeight ?? estimateTargetListHeight(input.width, input.height, input.headerCollapsed);
  const rows = rowsThatFit(available, maxRows);
  return {
    landscape,
    tablet,
    replyBeside,
    columns,
    rows,
    layerSize: rows * columns,
    cardHeight: cardHeightForRows(available, rows),
    gap: CARD_GAP,
    maxRows,
  };
}

export function targetLayerSize(
  width: number,
  height: number,
  availableHeight?: number,
  headerCollapsed = false,
): number {
  return operatorLayout({ width, height, availableHeight, headerCollapsed }).layerSize;
}

export function targetLayerCount(
  total: number,
  width: number,
  height: number,
  availableHeight?: number,
  headerCollapsed = false,
): number {
  const size = targetLayerSize(width, height, availableHeight, headerCollapsed);
  if (total <= size) {
    return 1;
  }
  return Math.max(1, Math.ceil(total / size));
}

export function visibleTargets<T>(
  items: T[],
  layerIndex: number,
  width: number,
  height: number,
  availableHeight?: number,
  headerCollapsed = false,
): T[] {
  const size = targetLayerSize(width, height, availableHeight, headerCollapsed);
  if (items.length <= size) {
    return items;
  }
  const count = targetLayerCount(items.length, width, height, availableHeight, headerCollapsed);
  const index = Math.min(Math.max(layerIndex, 0), count - 1);
  const start = index * size;
  return items.slice(start, start + size);
}

/** Row-major pages, same fill order as the web client's CSS grid. */
export function chunkTargets<T>(items: T[], columns: number): T[][] {
  const count = Math.max(1, Math.floor(columns));
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += count) {
    rows.push(items.slice(index, index + count));
  }
  return rows;
}

export function shouldOfferHeaderCollapse(input: {
  rows: number;
  availableHeight: number;
  headerHeight: number;
  maxRows: number;
  compact?: boolean;
}): boolean {
  if (input.compact) {
    return true;
  }
  const recovered = Math.max(0, input.headerHeight - COLLAPSED_HEADER_HEIGHT);
  if (recovered < 8) {
    return false;
  }
  if (input.rows <= HEADER_COLLAPSE_ROW_THRESHOLD) {
    return true;
  }
  return rowsThatFit(input.availableHeight + recovered, input.maxRows) > input.rows;
}
