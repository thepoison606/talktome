import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  DEFAULT_AUDIO_PREFERENCE,
  formatLinearLevelDb,
  nudgeVolume,
  talkTargetIdentity,
  type TalkTarget,
} from '../protocol';
import { session, useSessionStore } from '../session/store';
import { incomingHighlightsTarget } from '../talk/replyTarget';
import { HoldToTalk } from './HoldToTalk';
import {
  ConferenceIcon,
  HeadphonesIcon,
  ListenOnlyIcon,
  LockIcon,
  PersonIcon,
  PlayIcon,
  StopIcon,
  WalkieTalkieIcon,
  WEB_AVATAR,
  targetAvatarBackground,
} from './icons';
import { FeedVideoPlayer } from './FeedVideoPlayer';
import { colors } from './theme';
import { conferenceSpeakingLabel, targetActivity } from './targetActivity';
import { VolumeOverlay } from './VolumeOverlay';
import { VolumeRing } from './VolumeRing';

type Props = {
  target: TalkTarget;
  compact?: boolean;
  compactLabel?: boolean;
  volumeReadout?: boolean;
  height?: number;
  edgeTalkAffordance?: boolean;
  videoAvailable?: boolean;
  videoExpanded?: boolean;
  videoHeight?: number;
  videoStreamURL?: string;
  videoError?: string;
  onToggleVideo?: () => void;
  onOpenConferenceMembers?: (target: TalkTarget) => void;
};

export function TargetRow({
  target,
  compact = false,
  compactLabel = false,
  volumeReadout = false,
  height,
  edgeTalkAffordance = false,
  onOpenConferenceMembers,
  videoAvailable = false, videoExpanded = false, videoHeight = 0,
  videoStreamURL, videoError, onToggleVideo,
}: Props) {
  const key = talkTargetIdentity(target);
  const canToggleVideo = target.type === 'feed' && (videoAvailable || videoExpanded);
  const talking = useSessionStore((state) => state.talkingTargetKeys.includes(key));
  const locked = useSessionStore((state) => state.lockedTargetKeys.includes(key));
  const incomingEntries = useSessionStore((state) => state.incoming.addressedNow);
  const incoming = incomingEntries.some((entry) => incomingHighlightsTarget(entry, target));
  const peers = useSessionStore((state) => state.peers);
  const preference = useSessionStore(
    (state) => state.audioPreferences[key] ?? DEFAULT_AUDIO_PREFERENCE,
  );
  const leftHanded = useSessionStore((state) => state.leftHanded);
  const feedStopped = useSessionStore((state) => state.stoppedFeedKeys.includes(key));
  const feedOnline = useSessionStore((state) => state.activeFeedKeys.includes(key));
  const volumeFader = useSessionStore((state) => state.operatorAudio.volumeFader);
  const canTalk = session.canTalkTo(target);
  // Web `#targets-list .talk-btn` always paints the walkie, including offline
  // users. Feeds and listen-only conferences have no talk button.
  const showTalkIcon = target.canTalk && target.type !== 'feed';
  const userOnline =
    target.type !== 'user' || peers.some((peer) => peer.kind === 'user' && peer.userId === target.id);
  const { offline: dimmed, receiving } = targetActivity({
    type: target.type, incoming, feedOnline, feedStopped, userOnline,
  });
  const listenOnly = target.type === 'conference' && !target.canTalk;
  const [volumeOpen, setVolumeOpen] = useState(false);
  const tight = compact || (height != null && height < 64);

  const speaking = receiving;

  const meta =
    target.type === 'feed'
      ? !feedOnline
        ? 'Offline'
        : feedStopped
          ? 'Stopped'
          : // TalkToMe 1.5.17: the green border already says it is streaming.
            'Feed'
      : target.type === 'conference'
        ? speaking
          ? conferenceSpeakingLabel(target, incomingEntries, peers)
          : listenOnly
            ? 'Listen only'
            : 'Conference'
        : userOnline
          ? speaking
            ? 'Speaking'
            : 'Online'
          : 'Offline';

  const avatarColor = dimmed ? WEB_AVATAR.offlineGlyph : WEB_AVATAR.glyph;
  const avatar =
    target.type === 'conference' ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose who you hear in ${target.label}`}
        onPress={() => onOpenConferenceMembers?.(target)}
        style={[styles.avatar, { backgroundColor: targetAvatarBackground('conference', dimmed) }]}
      >
        <ConferenceIcon />
        {listenOnly ? (
          <View style={styles.listenBadge}>
            <ListenOnlyIcon color={colors.muted} size={10} />
          </View>
        ) : null}
      </Pressable>
    ) : canToggleVideo ? (
      <View pointerEvents="none" style={[styles.avatar, { backgroundColor: targetAvatarBackground('feed', dimmed) }]}>
        <Text style={{ fontSize: 22 }}>📺</Text>
      </View>
    ) : (
      <View style={[styles.avatar, { backgroundColor: targetAvatarBackground(target.type, dimmed) }]}>
        {target.type === 'feed' ? (
          <HeadphonesIcon />
        ) : (
          <PersonIcon color={avatarColor} letter={target.label} />
        )}
      </View>
    );

  const identity = (
    <View style={styles.identity} pointerEvents="none">
      <View style={styles.nameRow}>
        {locked ? <LockIcon color={colors.text} size={14} /> : null}
        <Text
          style={[styles.label, compactLabel && styles.labelCompact, dimmed && styles.dimText]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          {target.label}
        </Text>
      </View>
      <Text style={styles.meta} numberOfLines={1}>
        {meta}
      </Text>
    </View>
  );

  const wrapTalk = (children: ReactNode, style: StyleProp<ViewStyle>, accessibilityLabel: string) => {
    if (canTalk) {
      return (
        <HoldToTalk
          accessibilityLabel={locked ? `Unlock ${target.label}` : accessibilityLabel}
          disabled={!canTalk}
          locked={locked}
          leftHanded={leftHanded}
          onPress={(inputKey) => void session.pressTalk(target, inputKey)}
          onLock={() => void session.lockTalk(target)}
          onRelease={(inputKey) => void session.releaseTalk(target, inputKey)}
          style={style}
        >
          {children}
        </HoldToTalk>
      );
    }
    return <View pointerEvents={canToggleVideo ? "none" : "auto"} style={style}>{children}</View>;
  };

  const talkZone = wrapTalk(
    identity,
    [styles.talkZone, talking ? styles.talkZoneActive : null],
    `Talk to ${target.label}`,
  );

  const edgeIconColor = talking ? colors.talking : dimmed ? 'rgba(255,255,255,0.28)' : colors.text;
  const talkSlotStyle = [styles.talkControl, edgeTalkAffordance && styles.edgeTalk];

  const talkControl = target.type === 'feed' ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={feedStopped ? 'Start receiving feed' : 'Stop receiving feed'}
      accessibilityState={{ disabled: !feedOnline, selected: feedStopped }}
      disabled={!feedOnline}
      onPress={() => session.toggleFeedReception(target)}
      style={[...talkSlotStyle, styles.feedButton, dimmed && styles.controlOffline]}
    >
      {feedStopped ? (
        <PlayIcon color={feedOnline ? colors.text : WEB_AVATAR.offlineGlyph} size={18} />
      ) : (
        <StopIcon color={colors.text} />
      )}
    </Pressable>
  ) : showTalkIcon ? (
    wrapTalk(
      <WalkieTalkieIcon color={edgeIconColor} size={tight ? 18 : 22} />,
      [...talkSlotStyle, talking && styles.talkZoneActive],
      edgeTalkAffordance ? `Talk to ${target.label} from the phone edge` : `Talk to ${target.label}`,
    )
  ) : (
    <View style={talkSlotStyle} />
  );

  const rowStyle = [
    styles.row,
    leftHanded && styles.rowLeft,
    tight && styles.rowCompact,
    talking && styles.rowTalking,
    speaking && !talking && styles.rowSpeaking,
    dimmed && styles.rowOffline,
    height != null ? { height, minHeight: height, flex: 1, paddingVertical: tight ? 4 : 8 } : null,
  ];

  return (
    <View style={videoExpanded ? [styles.videoCard, speaking && styles.rowSpeaking, dimmed && styles.rowOffline,
      height != null && { height: height + videoHeight }] : height != null ? { height } : undefined}>
      {canToggleVideo ? <Pressable
        accessibilityRole="button" accessibilityLabel={`${videoExpanded ? 'Hide' : 'Show'} video, ${target.label}`}
        accessibilityState={{ expanded: videoExpanded }} onPress={onToggleVideo}
        style={StyleSheet.absoluteFill}
      /> : null}
      {videoExpanded ? <View pointerEvents="none"><FeedVideoPlayer streamURL={videoStreamURL} error={videoError}
        stopped={feedStopped} height={Math.max(0, videoHeight - 2)} /></View> : null}
    <View pointerEvents={canToggleVideo ? "box-none" : "auto"} style={[rowStyle, videoExpanded && { flex: 0, borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent', opacity: 1 }]}>
      {avatar}
      {talkZone}
      <View
        pointerEvents={canToggleVideo ? "box-none" : "auto"}
        style={[
          styles.meterCluster,
          leftHanded && styles.meterClusterLeft,
          volumeReadout && styles.meterClusterReadout,
        ]}
      >
        <VolumeRing
          level={preference.volume}
          muted={preference.muted}
          dimmed={dimmed}
          compact={tight}
          variant={volumeReadout ? 'readout' : 'ring'}
          accessibilityLabel={
            preference.muted ? `Volume muted, ${target.label}` : `Volume ${formatLinearLevelDb(preference.volume)}`
          }
          onPress={() => setVolumeOpen(true)}
          onDoublePress={() => session.toggleTargetMuted(target)}
        />
      </View>
      {talkControl}
    </View>
      <VolumeOverlay
        visible={volumeOpen}
        title={target.label}
        level={preference.volume}
        muted={preference.muted}
        fader={volumeFader}
        onNudge={(direction) => {
          const current = useSessionStore.getState().audioPreferences[key] ?? DEFAULT_AUDIO_PREFERENCE;
          session.setTargetVolume(target, nudgeVolume(current.volume, direction));
        }}
        onChange={(volume) => session.setTargetVolume(target, volume)}
        onToggleMute={() => session.toggleTargetMuted(target)}
        onClose={() => setVolumeOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  videoCard: { borderRadius: 6, overflow: 'hidden', backgroundColor: '#1f2937',
    borderWidth: 1, borderColor: 'transparent' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  rowLeft: {
    flexDirection: 'row-reverse',
  },
  rowCompact: {
    minHeight: 62,
    paddingHorizontal: 8,
  },
  rowTalking: {
    backgroundColor: 'rgba(139,92,246,0.12)',
    borderColor: 'rgba(139,92,246,0.8)',
  },
  rowSpeaking: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderColor: 'rgba(34,197,94,0.8)',
  },
  rowOffline: {
    opacity: 0.6,
    borderColor: 'rgba(148,163,184,0.25)',
    backgroundColor: 'rgba(15,23,42,0.35)',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listenBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#121826',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  talkZone: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'flex-start',
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 0,
  },
  talkZoneActive: {
    opacity: 1,
  },
  identity: {
    width: '100%',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
    flexShrink: 1,
  },
  dimText: {
    color: 'rgba(255,255,255,0.55)',
  },
  labelCompact: {
    fontSize: 14,
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  meterCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  meterClusterLeft: {
    flexDirection: 'row-reverse',
  },
  meterClusterReadout: {
    gap: 4,
  },
  feedButton: {
    minWidth: 40,
    minHeight: 40,
  },
  controlOffline: {
    opacity: 0.55,
  },
  talkControl: {
    width: 36,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  edgeTalk: {
    width: 44,
  },
});
