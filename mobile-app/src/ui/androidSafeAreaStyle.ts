export type AndroidSafeArea = { paddingTop?: number; paddingBottom?: number; paddingLeft?: number; paddingRight?: number };

/**
 * Padding for the Android status and navigation bars (RN SafeAreaView only
 * insets iOS). The bottom follows the real navigation bar: the thin gesture
 * handle or the taller 3-button bar. In landscape that bar can move to either
 * side, so all four reported edges must be respected.
 */
export function androidSafeAreaStyle(
  platform: string,
  insets: { top: number; bottom: number; left?: number; right?: number },
  statusBarHeight: number | undefined,
): AndroidSafeArea {
  if (platform !== 'android') {
    return {};
  }
  return {
    paddingTop: Math.max(insets.top, statusBarHeight ?? 24) + 8,
    paddingBottom: Math.max(insets.bottom + 4, 8),
    paddingLeft: Math.max(insets.left ?? 0, 0),
    paddingRight: Math.max(insets.right ?? 0, 0),
  };
}
