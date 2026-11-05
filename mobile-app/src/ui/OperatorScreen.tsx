import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  cameraTallyColor,
  cameraTallyLabel,
  visibleProductionName,
  talkTargetIdentity,
  type TalkTarget,
} from '../protocol';
import { missingAccessoryNotice } from '../ble/bindings';
import { connectionHealthFromSession } from '../session/connectionHealth';
import { mainButtonStorageKey, resolveMainButton } from '../session/mainButton';
import { session, useSessionStore } from '../session/store';
import { slideToLockHint } from '../talk/slideToLock';
import { ConferenceMembersModal } from './ConferenceMembersModal';
import { AudioRouteButton, AudioRouteMenu } from './AudioRouteButton';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import { ChevronIcon, LockIcon, ReplyArrowIcon, WalkieTalkieIcon } from './icons';
import { endTalkTouches, HoldToTalk, moveTalkTouches } from './HoldToTalk';
import {
  COLLAPSED_HEADER_HEIGHT,
  estimateTargetListHeight,
  isCompactOperatorScreen,
  isTabletOperatorScreen,
  operatorLayout,
  shouldOfferHeaderCollapse,
} from './layers';
import { openSessionSheet } from './sessionSheetState';
import { feedVideoHeight, feedVideoLayers } from './feedVideoLayout';
import { TargetRow } from './TargetRow';
import { colors } from './theme';

/** Launch and short dropouts reconnect on their own; only warn when an accessory stays away. */
const ACCESSORY_NOTICE_DELAY_MS = 5000;

function useDelayedNotice(text: string | null, delayMs: number): string | null {
  const [shown, setShown] = useState(false);
  const active = text != null;
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return shown ? text : null;
}

export function OperatorScreen() {
  const store = useSessionStore();
  const window = useWindowDimensions();
  const [measured, setMeasured] = useState({ width: 0, height: 0 });
  const width = measured.width || window.width;
  const height = measured.height || window.height;
  const compact = isCompactOperatorScreen(width, height);
  const tablet = isTabletOperatorScreen(width, height);
  const [layerIndex, setLayerIndex] = useState(0);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [conferenceTarget, setConferenceTarget] = useState<TalkTarget | null>(null);
  const [headerCollapsed, setHeaderCollapsed] = useState(compact);
  const [headerHeight, setHeaderHeight] = useState(96);
  const [listHeight, setListHeight] = useState(0);
  const [listWidth, setListWidth] = useState(0);
  const [expandedVideos, setExpandedVideos] = useState<Set<string>>(() => new Set());
  const compactRef = useRef(compact);
  const reply = store.replyTarget;
  const mainButton = resolveMainButton({
    storedIdentity: store.mainButtonTargets[mainButtonStorageKey(store.activeProfileId, store.productionId)],
    targets: store.targets,
    replyTarget: reply,
    canTalk: (target) => session.canTalkTo(target),
  });
  const availableHeight = listHeight || estimateTargetListHeight(width, height, headerCollapsed);
  const layout = operatorLayout({
    width,
    height,
    availableHeight,
    headerCollapsed,
  });
  const replyBeside = layout.replyBeside;
  const videoHeight = feedVideoHeight((listWidth || width - 32) / layout.columns - layout.gap,
    height, availableHeight, layout.cardHeight,
    layout.landscape ? Math.min(layout.rows, Math.ceil(store.targets.length / layout.columns)) : 0, layout.gap);
  const pages = feedVideoLayers(store.targets, layout, expandedVideos, availableHeight, videoHeight);
  const layers = pages.length;
  const safeLayerIndex = Math.min(layerIndex, layers - 1);
  const grid = pages[safeLayerIndex]!;
  const visibleVideoKeys = grid.flatMap(row => row.targets)
    .filter(target => target.type === 'feed' && expandedVideos.has(talkTargetIdentity(target)))
    .map(talkTargetIdentity).sort().join(',');

  useEffect(() => {
    const update = () => session.mediaCoordinator.setVisibleFeedVideos(
      AppState.currentState === 'active' && store.operatorReady ? visibleVideoKeys.split(',').filter(Boolean) : []);
    update();
    const subscription = AppState.addEventListener('change', update);
    return () => { subscription.remove(); session.mediaCoordinator.setVisibleFeedVideos([]); };
  }, [visibleVideoKeys, store.operatorReady, store.productionId]);

  useEffect(() => { setExpandedVideos(new Set()); }, [store.productionId, store.activeProfileId]);

  const toggleVideo = (target: TalkTarget) => {
    const key = talkTargetIdentity(target);
    const next = new Set(expandedVideos);
    if (next.has(key)) next.delete(key); else next.add(key);
    const nextPages = feedVideoLayers(store.targets, layout, next, availableHeight, videoHeight);
    setExpandedVideos(next);
    // Expanding a row can move it to the next layer; keep the tapped feed on screen.
    setLayerIndex(Math.max(0, nextPages.findIndex(page => page.some(row =>
      row.targets.some(item => talkTargetIdentity(item) === key)))));
  };
  const offerCollapse =
    headerCollapsed ||
    shouldOfferHeaderCollapse({
      rows: layout.rows,
      availableHeight,
      headerHeight,
      maxRows: layout.maxRows,
      compact,
    });

  useEffect(() => {
    setLayerIndex(0);
  }, [store.productionId, store.targets.length, layout.columns, replyBeside]);

  useEffect(() => {
    if (compactRef.current === compact) {
      return;
    }
    compactRef.current = compact;
    setHeaderCollapsed(compact);
  }, [compact]);

  const collapseHeader = () => {
    setHeaderCollapsed(true);
  };
  const expandHeader = () => {
    setHeaderCollapsed(false);
  };

  const mainTarget = mainButton.target;
  const mainKey = mainTarget ? talkTargetIdentity(mainTarget) : '';
  const mainTalking = Boolean(mainTarget && store.talking && store.talkingTargetKeys.includes(mainKey));

  const productionLabel = visibleProductionName(store.productionName);
  const connection = connectionHealthFromSession(store);
  const mediaNotice =
    connection.kind === 'warning' || connection.kind === 'failed' ? connection.label : store.audioNotice;
  const accessoryNotice = useDelayedNotice(
    missingAccessoryNotice(store.bleBindings, store.bleDevices, store.bleKind),
    ACCESSORY_NOTICE_DELAY_MS,
  );
  const tallyColor = cameraTallyColor(store.cameraTally);
  const tallyLabel = cameraTallyLabel(store.cameraTally);
  const mainLocked = Boolean(mainKey && store.lockedTargetKeys.includes(mainKey));
  const layerLabel = compact
    ? `${(safeLayerIndex % layers) + 1}/${layers}`
    : `Layer ${(safeLayerIndex % layers) + 1}/${layers}`;

  const layerButton =
    layers > 1 ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={layerLabel}
        onPress={() => setLayerIndex((current) => (current + 1) % layers)}
        style={[styles.layer, compact && styles.layerCompact]}
      >
        {/* Reserve the widest page label, including the jump from 9 to 10. */}
        <Text
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.layerText, styles.layerSizer]}
        >
          {compact ? `${layers}/${layers}` : `Layer ${layers}/${layers}`}
        </Text>
        <View pointerEvents="none" style={styles.layerLabel}>
          <Text style={styles.layerText}>{layerLabel}</Text>
        </View>
      </Pressable>
    ) : null;

  const replyButton = (
    <HoldToTalk
      accessibilityLabel={mainButton.accessibilityLabel}
      disabled={!mainTarget}
      locked={mainLocked}
      leftHanded={store.leftHanded}
      onPress={(inputKey) => { if (mainTarget) void session.pressTalk(mainTarget, inputKey); }}
      onLock={() => { if (mainTarget) void session.lockTalk(mainTarget); }}
      onRelease={(inputKey) => void session.releaseTalk(undefined, inputKey)}
      style={[
        styles.reply,
        replyBeside && styles.replyLandscape,
        compact && !replyBeside && styles.replyCompact,
        store.bigMainButton && styles.replyBig,
        store.bigMainButton && replyBeside && styles.replyBigLandscape,
        mainTalking && styles.replyActive,
        !mainTarget && styles.replyDisabled,
      ]}
    >
      <View
        style={[
          styles.replyContent,
          (store.bigMainButton || replyBeside) && styles.replyContentStacked,
        ]}
      >
        <View
          style={[
            styles.replyTitle,
            store.bigMainButton && styles.replyTitleBig,
            replyBeside && styles.replyTitleLandscape,
          ]}
        >
          {mainLocked ? (
            <LockIcon color={colors.text} size={store.bigMainButton ? 28 : 22} />
          ) : mainButton.mode === 'target' ? (
            <WalkieTalkieIcon
              color={mainTarget ? colors.text : 'rgba(255,255,255,0.38)'}
              size={store.bigMainButton ? 32 : 22}
            />
          ) : (
            <ReplyArrowIcon
              color={mainTarget ? colors.text : 'rgba(255,255,255,0.38)'}
              size={store.bigMainButton ? 28 : 22}
            />
          )}
          <Text
            numberOfLines={replyBeside ? 3 : 2}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[
              styles.replyText,
              store.bigMainButton && styles.replyTextBig,
              replyBeside && styles.replyTextLandscape,
              replyBeside && store.bigMainButton && styles.replyTextBigLandscape,
              !mainTarget && styles.replyMuted,
            ]}
          >
            {mainButton.label}
          </Text>
        </View>
        {mainTarget && !compact ? (
          <Text style={styles.replyHint}>{slideToLockHint(store.leftHanded)}</Text>
        ) : null}
      </View>
    </HoldToTalk>
  );

  return (
    <View
      onTouchMove={(event) => moveTalkTouches(event.nativeEvent.changedTouches)}
      onTouchEnd={(event) => endTalkTouches(event.nativeEvent.changedTouches)}
      onTouchCancel={(event) => endTalkTouches(event.nativeEvent.changedTouches)}
      onLayout={(event) => {
        const next = event.nativeEvent.layout;
        setMeasured((current) =>
          current.width === next.width && current.height === next.height
            ? current
            : { width: next.width, height: next.height },
        );
      }}
      style={[
        styles.screen,
        replyBeside && styles.screenLandscape,
        compact && styles.screenCompact,
        tablet && styles.screenTablet,
        headerCollapsed && styles.screenPeek,
      ]}
    >
      <View style={{ flex: 1 }} accessibilityElementsHidden={audioMenuOpen} importantForAccessibility={audioMenuOpen ? 'no-hide-descendants' : 'auto'}>
        {headerCollapsed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show top bar"
            accessibilityHint="Reveals name, connection, audio route, and layers"
            onPress={expandHeader}
            style={styles.headerPeekCard}
          >
            <ChevronIcon color={colors.text} direction="down" size={14} />
            <Text style={styles.headerPeekLabel}>Show top bar</Text>
          </Pressable>
        ) : (
          <View
            style={[styles.header, compact && styles.headerCompact]}
            onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Session, ${connection.label}`}
              accessibilityHint="Server, layout, audio, accessories, debug, profiles, and disconnect"
              onPress={() => openSessionSheet()}
              style={styles.identity}
            >
              <View style={styles.nameRow}>
                <Text style={[styles.name, compact && styles.nameCompact]} numberOfLines={1}>
                  {store.identity?.name ?? 'talktome'}
                </Text>
                <ConnectionStatusBadge health={connection} compact={compact} />
              </View>
              {productionLabel ? (
                <Text style={styles.production} numberOfLines={1}>
                  {productionLabel}
                </Text>
              ) : null}
              {tallyLabel && tallyColor ? (
                <Text
                  accessibilityLabel={tallyLabel === 'PGM' ? 'On program' : 'On preview'}
                  style={[styles.tallyChip, { color: tallyColor }]}
                >
                  {tallyLabel}
                </Text>
              ) : null}
            </Pressable>
            <View style={styles.headerActions}>
              {offerCollapse ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Hide top bar"
                  accessibilityHint="Gives the target cards more room on small screens"
                  onPress={collapseHeader}
                  style={[styles.collapseButton, compact && styles.collapseButtonCompact]}
                >
                  <ChevronIcon color={colors.text} direction="up" />
                </Pressable>
              ) : null}
              <AudioRouteButton onPress={() => setAudioMenuOpen(true)} />
              {layerButton}
            </View>
          </View>
        )}

        {/* Reserve one line even when healthy: transient warnings must never
            change the target grid's measured height or move a held button. */}
        <View style={styles.noticeSlot}>
          {store.error || mediaNotice || store.overBudget ? (
            <Text style={store.error ? styles.error : styles.warn} numberOfLines={1}
              accessibilityLiveRegion="polite">
              {store.error || mediaNotice || 'Too many incoming streams — some feeds paused.'}
            </Text>
          ) : accessoryNotice ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={accessoryNotice}
              accessibilityHint="Opens Accessories"
              onPress={() => openSessionSheet('accessories')}
              style={styles.accessoryNotice}
            >
              <Text style={styles.accessoryNoticeText} numberOfLines={1}>{accessoryNotice}</Text>
              <Text style={styles.accessoryNoticeChevron}>›</Text>
            </Pressable>
          ) : null}
        </View>

        <View
          style={[
            styles.body,
            replyBeside && styles.bodyLandscape,
            replyBeside && store.leftHanded && styles.bodyLandscapeLeft,
          ]}
        >
          <View
            style={styles.list}
            onLayout={(event) => { setListHeight(event.nativeEvent.layout.height); setListWidth(event.nativeEvent.layout.width); }}
          >
            {grid.map((row, rowIndex) => (
              <View key={`row-${rowIndex}`} style={[styles.gridRow, { height: row.height, gap: layout.gap }]}>
                {row.targets.map((target) => (
                  <View key={`${target.type}-${target.id}`} style={styles.gridCell}>
                    <TargetRow
                      target={target}
                      compact={compact || replyBeside}
                      compactLabel={layout.columns > 1 && width / layout.columns < 400}
                      volumeReadout={compact}
                      height={layout.cardHeight}
                      videoAvailable={store.videoFeedKeys.includes(talkTargetIdentity(target))}
                      videoExpanded={expandedVideos.has(talkTargetIdentity(target))}
                      videoHeight={videoHeight}
                      videoStreamURL={store.feedVideos[talkTargetIdentity(target)]?.streamURL}
                      videoError={store.feedVideos[talkTargetIdentity(target)]?.error}
                      onToggleVideo={() => toggleVideo(target)}
                      edgeTalkAffordance={!replyBeside && store.edgeTalkAffordance}
                      onOpenConferenceMembers={setConferenceTarget}
                    />
                  </View>
                ))}
                {row.targets.length < layout.columns
                  ? Array.from({ length: layout.columns - row.targets.length }, (_, index) => (
                      <View key={`pad-${rowIndex}-${index}`} style={styles.gridCell} />
                    ))
                  : null}
              </View>
            ))}
          </View>
          {replyButton}
        </View>

        <ConferenceMembersModal target={conferenceTarget} onClose={() => setConferenceTarget(null)} />
      </View>
      {audioMenuOpen ? <AudioRouteMenu onClose={() => setAudioMenuOpen(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  screenLandscape: {
    paddingBottom: 8,
  },
  screenCompact: {
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 8,
  },
  screenTablet: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  screenPeek: {
    paddingTop: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerCompact: {
    marginBottom: 6,
    gap: 6,
  },
  headerPeekLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  headerPeekCard: {
    flexDirection: 'row',
    gap: 6,
    height: COLLAPSED_HEADER_HEIGHT,
    marginBottom: 8,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: {
    flexGrow: 1,
    flexShrink: 1,
    marginRight: 12,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  name: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '700',
    flexShrink: 1,
  },
  nameCompact: {
    fontSize: 22,
  },
  production: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  tallyChip: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  collapseButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  collapseButtonCompact: {
    width: 36,
    height: 36,
    borderRadius: 12,
  },
  layer: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    height: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  layerCompact: {
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  layerText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  layerSizer: {
    opacity: 0,
  },
  layerLabel: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeSlot: {
    height: 26,
    flexShrink: 0,
    justifyContent: 'center',
    marginBottom: 4,
  },
  warn: {
    color: colors.danger,
    fontSize: 13,
  },
  accessoryNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(245,194,107,0.35)',
    backgroundColor: 'rgba(245,194,107,0.10)',
  },
  accessoryNoticeText: {
    flexShrink: 1,
    color: colors.warning,
    fontSize: 13,
    fontWeight: '600',
  },
  accessoryNoticeChevron: {
    color: colors.warning,
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  body: {
    flex: 1,
    minHeight: 0,
    gap: 8,
  },
  bodyLandscape: {
    flexDirection: 'row',
    gap: 10,
  },
  bodyLandscapeLeft: {
    flexDirection: 'row-reverse',
  },
  list: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    justifyContent: 'flex-end',
    gap: 8,
    overflow: 'hidden',
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  gridCell: {
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 0,
  },
  reply: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(61,214,245,0.20)',
    borderRadius: 16,
    minHeight: 64,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(61,214,245,0.42)',
  },
  replyLandscape: {
    width: 96,
    minWidth: 88,
    maxWidth: 108,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: 8,
    minHeight: 0,
  },
  replyCompact: {
    minHeight: 52,
    paddingHorizontal: 12,
    gap: 8,
  },
  replyBig: {
    minHeight: 112,
    paddingVertical: 16,
    gap: 14,
  },
  replyBigLandscape: {
    width: 148,
    maxWidth: 168,
  },
  replyActive: {
    backgroundColor: 'rgba(122,71,199,0.28)',
    borderColor: 'rgba(158,112,230,0.68)',
  },
  replyDisabled: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  replyContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
    gap: 10,
  },
  replyContentStacked: {
    flexDirection: 'column',
    width: '100%',
    gap: 6,
  },
  replyTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
    gap: 10,
  },
  replyTitleBig: {
    gap: 14,
  },
  replyTitleLandscape: {
    flexDirection: 'column',
    width: '100%',
  },
  replyText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    flexShrink: 1,
  },
  replyTextLandscape: {
    fontSize: 14,
    textAlign: 'center',
    width: '100%',
  },
  replyTextBigLandscape: {
    fontSize: 18,
  },
  replyTextBig: {
    fontSize: 26,
    textAlign: 'center',
  },
  replyMuted: {
    color: 'rgba(255,255,255,0.5)',
  },
  replyHint: {
    color: colors.muted,
    fontSize: 11,
    textAlign: 'center',
  },
});
